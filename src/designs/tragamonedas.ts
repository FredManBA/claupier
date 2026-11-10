// Tragamonedas: tres rodillos (banca de 5 h, semana y dinero del periodo).
// Cuando un valor cambia, la palanca baja y su rodillo gira hasta el nuevo.
// Por cada dólar gastado sale una moneda que cae en la bandeja; el montón
// solo crece, y al llegar a $100 se embolsa y la bolsa pasa a la pila de la
// derecha.

import {
  PERIOD_LABEL,
  STATUS_TEXT,
  bankUrgency,
  bankValue,
  formatMoney,
  formatMoneyShort,
  formatReset,
  formatTokens,
  periodTotals,
} from "../core/format";
import { BAG_H, BAG_W, COINS_PER_BAG, type CoinSpot, SPIN, bagSprite, coinSprite, layoutHeap } from "../core/coins";
import { drawText, textWidth } from "../core/font";
import { BRASS, drawGhost, drawPlate, engrave, layer, ledKind, rect, rounded } from "../core/paint";
import type { PlanStatus, Snapshot } from "../core/types";
import type { Design, DesignContext } from "./design";

const W = 112;
const H = 142;
const BODY_W = 104;

const C = {
  ink: "#1a0507",
  body: "#8a1d24",
  bodyLight: "#a32c34",
  bodyShine: "#c0464c",
  bodyDark: "#5e1118",
  bodyDeep: "#420a10",
  panel: "#2a0a0e",
  panelLight: "#3a1015",
  reel: "#f1e9d4",
  reelShade: "#d6caae",
  reelDeep: "#ad9f82",
  reelText: "#2a1a14",
  reelFaint: "#c2b597",
  chrome: "#d7dbe2",
  chromeMid: "#9ba2ae",
  chromeDark: "#5d6470",
  trayBack: "#1d0609",
  trayBackLight: "#2c0b0f",
  cream: "#f4e8cc",
  dim: "#e0b5a5",
  gold: "#f0b64e",
  knob: "#d23a40",
  knobLight: "#f07a7c",
  knobDark: "#8c1c22",
  shadow: "#1a0507",
};

const LOGO = ["#ffe9a8", "#ffd873", "#f7c35a", "#efb04c", "#e09c3e", "#cc8733", "#b47228"];
const TOWER: Record<string, [string, string, string]> = {
  ok: ["#2f9a52", "#5fdc86", "#c4f7d2"],
  wait: ["#a06818", "#f0a24a", "#ffd9a6"],
  bad: ["#9a2e28", "#e5604f", "#ffb4a8"],
  idle: ["#3c4a44", "#6f8279", "#a9b8b1"],
};

// Geometría
const SIGN = { x: 6, y: 8, w: 92, h: 16 };
const REEL_X = [6, 37, 68];
const REEL_W = 30;
const REEL_Y = 30;
const REEL_H = 30;
const ITEM = 12; // separación entre valores del rodillo
const SPIN_MS = 900;
const SPIN_STAGGER = 150;
const LEVER_MS = 520;
const TRAY = { x: 5, y: 85, w: 94, h: 33 };
/** Suelo de la bandeja: la fila de abajo de las monedas. */
const FLOOR = 115;
/** Zona del montón (a la izquierda) y de las bolsas (a la derecha). */
const HEAP_X = 8;
const HEAP_W = 64;
const BAGS_X = 73;
const CHUTE = { x: 26, y: 79, w: 28 };
const PLATE = { x: 6, y: 122, w: 92, h: 15 };

// Monedas
const FALL_MS = 330;
const SETTLE_MS = 90;
const DROP_EVERY = 60;
/** Más monedas que esto en cola: las primeras entran sin animación. */
const MAX_QUEUE = 24;
const BAG_DROP_MS = 260;
const BAG_FILL_MS = 420;
const BAG_HOP_MS = 300;
const BAG_MS = BAG_DROP_MS + BAG_FILL_MS + BAG_HOP_MS;
/** Bolsas que se ven en la pila; si hay más, se cuentan. */
const BAG_SLOTS = 6;

const SPOTS: CoinSpot[] = layoutHeap(COINS_PER_BAG, HEAP_W, FLOOR + 1, 32).map((s) => ({ ...s, x: s.x + HEAP_X }));

interface Reel {
  value: string;
  color: string;
  /** Valores que pasan durante el giro, del anterior al nuevo. */
  strip: string[];
  spinStart?: number;
  lastTick: number;
}

interface FlyingCoin {
  spot: number;
  start: number;
  landed: boolean;
  /** De dónde sale: la ranura, con un poco de variación. */
  fromX: number;
}

/** Frena con un pequeño rebote al final, como un rodillo de verdad. */
const easeOutBack = (t: number) => {
  const c = 1.4;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function filler(kind: number): string {
  if (kind === 2) return `$${Math.floor(Math.random() * 900 + 10)}`;
  return `${Math.floor(Math.random() * 100)}%`;
}

/** Posición de la bolsa `i` en la pila: 3 abajo, 2 en medio y 1 arriba. */
function bagSlot(i: number) {
  const row = i < 3 ? 0 : i < 5 ? 1 : 2;
  const col = row === 0 ? i : row === 1 ? i - 3 : 0;
  return { x: BAGS_X + row * 4 + col * 8, y: FLOOR + 1 - BAG_H - row * 8 };
}

export class Tragamonedas implements Design {
  readonly id = "tragamonedas" as const;
  readonly width = W;
  readonly height = H;

  private reels: Reel[] = [0, 1, 2].map(() => ({ value: "", color: C.reelText, strip: [], lastTick: -1 }));
  private leverStart?: number;
  private snap: Snapshot | null = null;
  private ctx: DesignContext | null = null;

  // Monedas
  private heap = 0;
  private bags = 0;
  private queue = 0;
  private flying: FlyingCoin[] = [];
  private bagging: { start: number; cued: boolean } | null = null;
  private nextDrop = 0;

  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean) {
    this.ctx = ctx;
    const s = ctx.settings;
    const statusWord = STATUS_TEXT[snap.plan.status]?.[0] || "...";
    const five = bankValue(snap.plan.fiveHour, s.bankShows);
    const week = bankValue(snap.plan.sevenDay, s.bankShows);
    const cost = periodTotals(snap, s.period).costUsd;
    const next: [string, string][] = [
      [five === null ? statusWord : `${five}%`, five === null ? "#b0322b" : this.urgencyColor(bankUrgency(snap.plan.fiveHour))],
      [week === null ? "..." : `${week}%`, this.urgencyColor(bankUrgency(snap.plan.sevenDay))],
      [formatMoneyShort(cost, s), C.reelText],
    ];

    const animate = !first && ctx.motion === "full";
    let spun = 0;
    next.forEach(([value, color], i) => {
      const reel = this.reels[i];
      reel.color = color;
      if (value === reel.value) return;
      if (animate && reel.value) {
        reel.strip = [reel.value, ...Array.from({ length: 6 }, () => filler(i)), value];
        reel.spinStart = now + spun * SPIN_STAGGER;
        reel.lastTick = -1;
        spun++;
      }
      reel.value = value;
    });
    if (spun > 0) {
      this.leverStart = now;
      ctx.cue("lever");
    }

    this.setCoins(Math.floor(Math.max(0, cost)), animate, now);
    this.snap = snap;
  }

  private urgencyColor(u: 0 | 1 | 2) {
    return [C.reelText, "#b5651d", "#b0322b"][u];
  }

  // ── Monedas ──────────────────────────────────────────────────────────────

  /** Total que habrá cuando terminen de caer las monedas. */
  private get coinTotal() {
    return this.bags * COINS_PER_BAG + this.heap + this.flying.length + this.queue;
  }

  private setCoins(total: number, animate: boolean, now: number) {
    if (!animate || total < this.coinTotal) {
      // Al empezar, sin animación o con un periodo nuevo: directo.
      this.flying = [];
      this.queue = 0;
      this.bagging = null;
      this.bags = Math.floor(total / COINS_PER_BAG);
      this.heap = total % COINS_PER_BAG;
      return;
    }
    this.queue += total - this.coinTotal;
    if (this.queue > MAX_QUEUE) {
      // Demasiadas: las primeras se colocan ya y caen solo las últimas.
      if (this.bagging) {
        this.bags++;
        this.heap = 0;
        this.bagging = null;
      }
      this.heap += this.flying.length;
      this.flying = [];
      const before = this.bags * COINS_PER_BAG + this.heap + this.queue - MAX_QUEUE;
      this.bags = Math.floor(before / COINS_PER_BAG);
      this.heap = before % COINS_PER_BAG;
      this.queue = MAX_QUEUE;
    }
    if (this.nextDrop < now) this.nextDrop = now;
  }

  update(now: number): boolean {
    let busy = false;

    // Rodillos
    for (const reel of this.reels) {
      if (reel.spinStart === undefined) continue;
      const t = (now - reel.spinStart) / SPIN_MS;
      if (t >= 1) {
        reel.spinStart = undefined;
        continue;
      }
      busy = true;
      if (t > 0) {
        // Un tic cada vez que pasa un valor por la línea de premio.
        const passed = Math.floor(easeOutBack(t) * (reel.strip.length - 1));
        if (passed !== reel.lastTick) {
          reel.lastTick = passed;
          this.ctx?.cue("reel");
        }
      }
    }
    if (this.leverStart !== undefined) {
      if (now - this.leverStart >= LEVER_MS) this.leverStart = undefined;
      else busy = true;
    }

    // Monedas que tocan el montón
    for (const coin of this.flying) {
      if (!coin.landed && now - coin.start >= FALL_MS) {
        coin.landed = true;
        this.ctx?.cue("chip");
      }
    }
    const settled = this.flying.filter((c) => now - c.start >= FALL_MS + SETTLE_MS);
    if (settled.length > 0) {
      this.heap += settled.length;
      this.flying = this.flying.filter((c) => !settled.includes(c));
    }

    // Embolsado
    if (this.bagging) {
      const t = now - this.bagging.start;
      if (!this.bagging.cued && t >= BAG_MS) {
        this.bagging.cued = true;
        this.ctx?.cue("bag");
      }
      if (t >= BAG_MS) {
        this.bags++;
        this.heap = 0;
        this.bagging = null;
      }
    } else if (this.heap >= COINS_PER_BAG && this.flying.length === 0) {
      this.bagging = { start: now, cued: false };
    }

    // Siguiente moneda por la ranura
    if (!this.bagging && this.queue > 0 && now >= this.nextDrop && this.heap + this.flying.length < COINS_PER_BAG) {
      this.flying.push({
        spot: this.heap + this.flying.length,
        start: now,
        landed: false,
        fromX: CHUTE.x + 10 + Math.round(Math.random() * 8),
      });
      this.queue--;
      this.nextDrop = now + DROP_EVERY;
    }

    return busy || this.flying.length > 0 || this.queue > 0 || this.bagging !== null;
  }

  msUntilIdleEvent(): number {
    return 30_000;
  }

  // ── Dibujo ───────────────────────────────────────────────────────────────

  draw(g: CanvasRenderingContext2D, now: number) {
    g.clearRect(0, 0, W, H);
    const snap = this.snap;
    const settings = this.ctx?.settings;
    g.drawImage(layer("traga:gabinete", W, H, (b) => this.drawCabinet(b)), 0, 0);
    this.drawTower(g, snap?.plan.status);
    if (snap?.ghost) drawGhost(g, SIGN.x + 5, SIGN.y + 5);
    this.drawReels(g, now);

    // Etiquetas y datos debajo de cada rodillo
    const period = settings?.period ?? "today";
    const labels = ["5H", "SEM", PERIOD_LABEL[period]];
    const subs = [
      formatReset(snap?.plan.fiveHour?.resetsAt),
      formatReset(snap?.plan.sevenDay?.resetsAt),
      snap && settings ? formatTokens(periodTotals(snap, period).totalTokens) : "",
    ];
    REEL_X.forEach((x, i) => {
      const center = (t: string) => x + Math.floor((REEL_W - textWidth(t)) / 2);
      drawText(g, labels[i], center(labels[i]), 66, C.cream, { shadow: C.shadow });
      const sub = i < 2 && subs[i] ? `@${subs[i]}` : subs[i];
      if (sub) drawText(g, sub, center(sub), 73, C.dim, { shadow: C.shadow });
    });

    this.drawLever(g, now);
    this.drawTrayContents(g, now);
    g.drawImage(layer("traga:labio", W, H, (b) => this.drawTrayLip(b)), 0, 0);
    if (this.bags > BAG_SLOTS) {
      const label = `×${this.bags}`;
      drawText(g, label, BAGS_X + 13 - Math.floor(textWidth(label) / 2), TRAY.y + 4, C.gold, { outline: C.ink });
    }
    this.drawPlate(g, snap);
  }

  private drawCabinet(g: CanvasRenderingContext2D) {
    // Cuerpo laqueado con esquinas redondeadas
    rounded(g, 0, 4, BODY_W, H - 4, C.ink, 3);
    rounded(g, 1, 5, BODY_W - 2, H - 6, C.body, 3);
    rect(g, 4, 5, BODY_W - 8, 1, C.bodyShine);
    rect(g, 2, 7, 1, H - 12, C.bodyLight);
    rect(g, BODY_W - 3, 7, 1, H - 12, C.bodyDark);
    rect(g, 4, H - 3, BODY_W - 8, 1, C.bodyDeep);
    // Brillo vertical del lacado
    for (let y = 9; y < H - 6; y += 2) rect(g, 4, y, 1, 1, C.bodyLight);

    // Cartel
    const s = SIGN;
    rounded(g, s.x, s.y, s.w, s.h, C.ink, 2);
    rounded(g, s.x + 1, s.y + 1, s.w - 2, s.h - 2, BRASS.base, 1);
    rect(g, s.x + 2, s.y + 1, s.w - 4, 1, BRASS.shine);
    rect(g, s.x + 2, s.y + s.h - 2, s.w - 4, 1, BRASS.dark);
    rect(g, s.x + 2, s.y + 2, s.w - 4, s.h - 4, C.ink);
    rect(g, s.x + 3, s.y + 3, s.w - 6, s.h - 6, C.panel);
    rect(g, s.x + 3, s.y + 3, s.w - 6, 1, C.panelLight);
    const logo = "CLAUPIER";
    drawText(g, logo, s.x + Math.floor((s.w - textWidth(logo, "big")) / 2), s.y + 4, LOGO, { font: "big", shadow: "#120305" });

    // Ventana de los rodillos: marco de latón y cristal
    const wx = REEL_X[0] - 3;
    const ww = REEL_X[2] + REEL_W - REEL_X[0] + 6;
    rounded(g, wx, REEL_Y - 4, ww, REEL_H + 8, C.ink, 2);
    rounded(g, wx + 1, REEL_Y - 3, ww - 2, REEL_H + 6, BRASS.base, 1);
    rect(g, wx + 2, REEL_Y - 3, ww - 4, 1, BRASS.shine);
    rect(g, wx + 2, REEL_Y + REEL_H + 2, ww - 4, 1, BRASS.dark);
    rect(g, wx + 2, REEL_Y - 2, ww - 4, REEL_H + 4, C.ink);
    // Flechas de la línea de premio, en el marco
    const mid = REEL_Y + Math.floor(REEL_H / 2) - 1;
    for (const [x, tip] of [[wx + 1, wx + 2], [wx + ww - 2, wx + ww - 3]]) {
      rect(g, x, mid - 1, 1, 3, BRASS.shine);
      rect(g, tip, mid, 1, 1, BRASS.shine);
    }

    // Ranura de las monedas
    const c = CHUTE;
    rounded(g, c.x - 1, c.y - 1, c.w + 2, 5, C.ink, 1);
    rect(g, c.x, c.y, c.w, 1, C.chromeMid);
    rect(g, c.x + 1, c.y + 1, c.w - 2, 2, "#080102");
    rect(g, c.x, c.y + 3, c.w, 1, C.chromeDark);

    // Fondo de la bandeja
    const t = TRAY;
    rounded(g, t.x, t.y, t.w, t.h, C.ink, 2);
    rect(g, t.x + 2, t.y + 1, t.w - 4, t.h - 2, C.trayBack);
    // Fondo curvo: más claro arriba, donde le da la luz
    rect(g, t.x + 2, t.y + 1, t.w - 4, 2, C.trayBackLight);
    for (let x = t.x + 2; x < t.x + t.w - 2; x += 2) rect(g, x, t.y + 3, 1, 1, C.trayBackLight);
    rect(g, t.x + 1, t.y + 2, 1, t.h - 4, C.chromeDark);
    rect(g, t.x + t.w - 2, t.y + 2, 1, t.h - 4, C.chromeDark);

    // Soporte de la palanca
    rect(g, BODY_W - 1, 44, 4, 12, C.ink);
    rect(g, BODY_W - 1, 45, 3, 10, C.chromeMid);
    rect(g, BODY_W - 1, 45, 3, 1, C.chrome);
  }

  /** El labio de cromo de la bandeja, por delante de las monedas. */
  private drawTrayLip(g: CanvasRenderingContext2D) {
    const t = TRAY;
    const y = FLOOR - 1;
    rect(g, t.x, y, t.w, t.y + t.h - y, C.ink);
    rect(g, t.x + 1, y + 1, t.w - 2, 1, C.chrome);
    rect(g, t.x + 1, y + 2, t.w - 2, 1, C.chromeMid);
    rect(g, t.x + 1, y + 3, t.w - 2, t.y + t.h - y - 4, C.chromeDark);
  }

  private drawTower(g: CanvasRenderingContext2D, status: PlanStatus | undefined) {
    const [dark, mid, light] = TOWER[ledKind(status)];
    const x = Math.floor(BODY_W / 2) - 4;
    rect(g, x + 1, 0, 6, 1, C.ink);
    rect(g, x, 1, 8, 4, C.ink);
    rect(g, x + 1, 1, 6, 3, mid);
    rect(g, x + 2, 1, 2, 1, light);
    rect(g, x + 5, 2, 2, 2, dark);
    rect(g, x - 1, 4, 10, 2, C.ink);
    rect(g, x, 4, 8, 1, C.chromeMid);
  }

  private drawReels(g: CanvasRenderingContext2D, now: number) {
    const mid = REEL_Y + Math.floor(REEL_H / 2) - 4; // y del texto centrado
    this.reels.forEach((reel, i) => {
      const x = REEL_X[i];
      // Cilindro: más oscuro arriba y abajo
      rect(g, x, REEL_Y, REEL_W, REEL_H, C.reelDeep);
      rect(g, x, REEL_Y + 3, REEL_W, REEL_H - 6, C.reelShade);
      rect(g, x, REEL_Y + 7, REEL_W, REEL_H - 14, C.reel);

      g.save();
      g.beginPath();
      g.rect(x, REEL_Y, REEL_W, REEL_H);
      g.clip();
      const center = (t: string) => x + Math.floor((REEL_W - textWidth(t, "big")) / 2);
      const spinning = reel.spinStart !== undefined && now >= reel.spinStart;
      if (spinning) {
        const t = Math.min(1, (now - reel.spinStart!) / SPIN_MS);
        const pos = easeOutBack(t) * (reel.strip.length - 1) * ITEM;
        reel.strip.forEach((value, j) => {
          const y = Math.round(mid - j * ITEM + pos);
          if (y < REEL_Y - 9 || y > REEL_Y + REEL_H) return;
          const last = j === reel.strip.length - 1;
          drawText(g, value, center(value), y, last ? reel.color : C.reelFaint, { font: "big" });
        });
      } else {
        // En reposo: el valor en la línea y marcas arriba y abajo
        for (const dy of [-ITEM, ITEM]) {
          const mx = x + Math.floor(REEL_W / 2) - 4;
          rect(g, mx, mid + dy + 2, 8, 2, C.reelFaint);
        }
        drawText(g, reel.value, center(reel.value), mid, reel.color, { font: "big" });
      }
      g.restore();
      // Cristal: un reflejo fino arriba
      g.fillStyle = "rgba(255, 255, 255, 0.18)";
      g.fillRect(x + 2, REEL_Y + 1, REEL_W - 4, 1);
      // Separación entre rodillos
      if (i < 2) rect(g, x + REEL_W, REEL_Y, 1, REEL_H, C.ink);
    });
  }

  private drawLever(g: CanvasRenderingContext2D, now: number) {
    // Cuánto está bajada: 0 arriba, 1 abajo
    let pull = 0;
    if (this.leverStart !== undefined) {
      const t = (now - this.leverStart) / LEVER_MS;
      pull = t < 0.35 ? t / 0.35 : t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
      pull = Math.max(0, Math.min(1, pull));
    }
    const pivot = 50;
    const knobY = Math.round(20 + pull * 40);
    const sx = BODY_W + 3;
    // Barra cromada
    const top = Math.min(knobY + 4, pivot);
    const bottom = Math.max(knobY + 4, pivot);
    rect(g, sx - 1, top, 4, bottom - top + 1, C.ink);
    rect(g, sx, top, 1, bottom - top + 1, C.chrome);
    rect(g, sx + 1, top, 1, bottom - top + 1, C.chromeMid);
    // Bola
    rect(g, sx - 3, knobY, 8, 8, C.ink);
    rect(g, sx - 2, knobY - 1, 6, 10, C.ink);
    rect(g, sx - 2, knobY, 6, 8, C.knob);
    rect(g, sx - 3, knobY + 1, 8, 6, C.knob);
    rect(g, sx + 2, knobY + 4, 3, 3, C.knobDark);
    rect(g, sx - 1, knobY + 1, 2, 2, C.knobLight);
  }

  private drawTrayContents(g: CanvasRenderingContext2D, now: number) {
    const bag = bagSprite();
    // Pila de bolsas
    const shownBags = Math.min(this.bags, BAG_SLOTS);
    for (let i = 0; i < shownBags; i++) {
      const s = bagSlot(i);
      g.drawImage(bag, s.x, s.y);
    }

    // Montón: durante el embolsado se vacía desde arriba.
    let visible = this.heap;
    const bagging = this.bagging;
    const bt = bagging ? now - bagging.start : 0;
    if (bagging && bt > BAG_DROP_MS) {
      const k = Math.min(1, (bt - BAG_DROP_MS) / BAG_FILL_MS);
      visible = Math.round(this.heap * (1 - easeInOut(k)));
    }
    for (let i = 0; i < Math.min(visible, SPOTS.length); i++) {
      const s = SPOTS[i];
      g.drawImage(coinSprite(s.pose), s.x, s.y);
    }

    // Monedas en el aire
    for (const coin of this.flying) this.drawFlyingCoin(g, coin, now);

    if (bagging) this.drawBagging(g, bag, bt, visible);
  }

  private drawFlyingCoin(g: CanvasRenderingContext2D, coin: FlyingCoin, now: number) {
    const target = SPOTS[coin.spot];
    const t = (now - coin.start) / FALL_MS;
    if (t >= 1) {
      // Rebote corto al tocar el montón
      const s = (now - coin.start - FALL_MS) / SETTLE_MS;
      const hop = s < 1 ? Math.round(Math.sin(s * Math.PI) * 2) : 0;
      g.drawImage(coinSprite(target.pose), target.x, target.y - hop);
      return;
    }
    const fromY = CHUTE.y + 2;
    const x = lerp(coin.fromX, target.x, t);
    const y = lerp(fromY, target.y, t * t);
    const frame = SPIN[Math.floor((now - coin.start) / 55) % SPIN.length];
    const sprite = coinSprite(frame);
    g.drawImage(sprite, Math.round(x + (8 - sprite.width) / 2), Math.round(y));
  }

  /** La bolsa cae sobre el montón, se traga las monedas y salta a la pila. */
  private drawBagging(g: CanvasRenderingContext2D, bag: HTMLCanvasElement, bt: number, visibleCoins: number) {
    // Encima del montón, centrada en la zona de caída
    const restX = HEAP_X + 32 - Math.floor(BAG_W / 2);
    let topY = FLOOR - BAG_H;
    for (let i = 0; i < Math.min(visibleCoins, SPOTS.length); i++) topY = Math.min(topY, SPOTS[i].y - BAG_H + 6);
    const slot = bagSlot(Math.min(this.bags, BAG_SLOTS - 1));
    let x = restX;
    let y = topY;
    if (bt < BAG_DROP_MS) {
      const t = bt / BAG_DROP_MS;
      y = lerp(CHUTE.y - 2, topY, t * t);
    } else if (bt > BAG_DROP_MS + BAG_FILL_MS) {
      const t = Math.min(1, (bt - BAG_DROP_MS - BAG_FILL_MS) / BAG_HOP_MS);
      const k = easeInOut(t);
      x = lerp(restX, slot.x, k);
      y = lerp(FLOOR - BAG_H, slot.y, k) - Math.sin(k * Math.PI) * 10;
    } else {
      // Mientras se llena, baja con el montón
      const t = (bt - BAG_DROP_MS) / BAG_FILL_MS;
      y = lerp(topY, FLOOR - BAG_H, easeInOut(t));
    }
    g.drawImage(bag, Math.round(x), Math.round(y));
  }

  private drawPlate(g: CanvasRenderingContext2D, snap: Snapshot | null) {
    const { x, y, w, h } = PLATE;
    g.drawImage(layer("traga:placa", W, H, (b) => drawPlate(b, x, y, w, h)), 0, 0);
    const settings = this.ctx?.settings;
    if (!snap || !settings) return;
    const totals = periodTotals(snap, settings.period);
    engrave(g, formatMoney(totals.costUsd, settings), x + 5, y + 4, BRASS.ink, { font: "big" });
    const tokens = `${formatTokens(totals.totalTokens)} TOK`;
    engrave(g, tokens, x + w - 6 - textWidth(tokens), y + 5, "#4a3210");
  }
}
