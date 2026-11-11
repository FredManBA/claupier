// Tragamonedas: tres rodillos (banca de 5 h, semana y dinero del periodo).
// Cuando un valor cambia, la palanca baja y su rodillo gira hasta el nuevo.
// El gasto cae por la ranura central a la bandeja, cambiado en monedas de
// colores ($1 a $500, como las fichas). Si el cambio junta varias monedas en
// una de más valor, las que sobran se desvanecen y cae la nueva. Las de más
// valor quedan arriba del montón, que es lo que se ve.

import {
  periodLabel,
  statusShort,
  weekLabel,
  bankUrgency,
  bankValue,
  formatMoneyShort,
  resetLabels,
  tokensLabel,
  periodTotals,
} from "../core/format";
import { type CoinPalette, type CoinSpot, coinSprite, layoutHeap } from "../core/coins";
import { drawText, textWidth } from "../core/font";
import { lerp } from "../core/anim";
import { BRASS, LED, LOGO_GRADIENT, drawGhost, layer, ledKind, rect, rounded } from "../core/paint";
import { DENOMS, chipsFor } from "../core/stack";
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
/** Sin placa abajo: la bandeja ocupa todo el pie de la máquina. */
const TRAY = { x: 5, y: 85, w: 94, h: 50 };
/** Suelo de la bandeja: la fila de abajo de las monedas. */
const FLOOR = TRAY.y + TRAY.h - 3;
/** La ranura, centrada sobre la bandeja. */
const CHUTE = { x: Math.floor((BODY_W - 28) / 2), y: 79, w: 28 };
const HEAP_X = 8;
const HEAP_W = 88;

// Monedas
const FALL_MS = 360;
const SETTLE_MS = 90;
const DROP_EVERY = 90;
const FADE_MS = 260;
/** Monedas que se dibujan; si hay más, se cuentan. */
const MAX_COINS = 36;
/** Más monedas que esto en cola: las primeras entran sin animación. */
const MAX_QUEUE = 16;

// El montón se apoya justo sobre el labio de la bandeja, para que no lo tape.
const SPOTS: CoinSpot[] = layoutHeap(MAX_COINS, HEAP_W, FLOOR - 1, HEAP_W / 2, "big", true).map((s) => ({ ...s, x: s.x + HEAP_X }));
const COIN_COLORS = DENOMS.map((d) => d.palette as CoinPalette);
const COIN_PITCH = [1.12, 1, 0.9, 0.8, 0.72];

interface Reel {
  value: string;
  color: string;
  /** Valores que pasan durante el giro, del anterior al nuevo. */
  strip: string[];
  spinStart?: number;
  lastTick: number;
}

interface FlyingCoin {
  /** Índice del valor en `DENOMS`. */
  denom: number;
  start: number;
  landed: boolean;
  /** De dónde sale: la ranura, con un poco de variación. */
  fromX: number;
}

/** Moneda que se va (el cambio la juntó con otras en una de más valor). */
interface FadingCoin {
  denom: number;
  spot: CoinSpot;
  start: number;
}

/** Frena con un pequeño rebote al final, como un rodillo de verdad. */
const easeOutBack = (t: number) => {
  const c = 1.4;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

function filler(kind: number): string {
  if (kind === 2) return `$${Math.floor(Math.random() * 900 + 10)}`;
  return `${Math.floor(Math.random() * 100)}%`;
}

export class Tragamonedas implements Design {
  readonly id = "tragamonedas" as const;
  readonly width = W;
  readonly height = H;

  private reels: Reel[] = [0, 1, 2].map(() => ({ value: "", color: C.reelText, strip: [], lastTick: -1 }));
  private leverStart?: number;
  private snap: Snapshot | null = null;
  private ctx: DesignContext | null = null;

  // Monedas: el montón en orden de llegada (cada número es un valor de `DENOMS`)
  private heap: number[] = [];
  private queue: number[] = [];
  private flying: FlyingCoin[] = [];
  private fading: FadingCoin[] = [];
  private nextDrop = 0;

  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean) {
    this.ctx = ctx;
    const s = ctx.settings;
    const statusWord = statusShort(snap.plan.status);
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

    this.setCoins(chipsFor(cost), animate, now);
    this.snap = snap;
  }

  private urgencyColor(u: 0 | 1 | 2) {
    return [C.reelText, "#b5651d", "#b0322b"][u];
  }

  // ── Monedas ──────────────────────────────────────────────────────────────

  /** Monedas de cada valor que habrá cuando termine todo lo que está cayendo. */
  private coinCounts(): number[] {
    const counts = DENOMS.map(() => 0);
    for (const d of this.heap) counts[d]++;
    for (const c of this.flying) counts[c.denom]++;
    for (const d of this.queue) counts[d]++;
    return counts;
  }

  /**
   * Lleva la bandeja al cambio nuevo. Sin animación, el montón se arma de una
   * vez, con las de más valor arriba. Con animación, las que sobran se
   * desvanecen y las que faltan caen por la ranura, de la más barata a la más
   * cara (así las caras quedan encima).
   */
  private setCoins(target: number[], animate: boolean, now: number) {
    if (!animate) {
      this.heap = target.flatMap((n, d) => Array.from({ length: n }, () => d));
      this.queue = [];
      this.flying = [];
      this.fading = [];
      return;
    }
    const current = this.coinCounts();
    for (let d = 0; d < DENOMS.length; d++) {
      let extra = current[d] - target[d];
      // Primero las que aún no salieron, luego las que caen, luego las del montón (de arriba abajo).
      for (let i = this.queue.length - 1; extra > 0 && i >= 0; i--) {
        if (this.queue[i] === d) {
          this.queue.splice(i, 1);
          extra--;
        }
      }
      for (let i = this.flying.length - 1; extra > 0 && i >= 0; i--) {
        if (this.flying[i].denom === d) {
          this.flying.splice(i, 1);
          extra--;
        }
      }
      for (let i = this.heap.length - 1; extra > 0 && i >= 0; i--) {
        if (this.heap[i] === d) {
          if (i < SPOTS.length) this.fading.push({ denom: d, spot: SPOTS[i], start: now });
          this.heap.splice(i, 1);
          extra--;
        }
      }
    }
    for (let d = 0; d < DENOMS.length; d++) {
      for (let k = 0; k < target[d] - current[d]; k++) this.queue.push(d);
    }
    // Demasiadas: las primeras se colocan ya y caen solo las últimas.
    while (this.queue.length > MAX_QUEUE) this.heap.push(this.queue.shift()!);
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
        // Más grave cuanto más vale la moneda.
        this.ctx?.cue("coin", COIN_PITCH[coin.denom]);
      }
    }
    while (this.flying.length > 0 && now - this.flying[0].start >= FALL_MS + SETTLE_MS) {
      this.heap.push(this.flying.shift()!.denom);
    }
    this.fading = this.fading.filter((f) => now - f.start < FADE_MS);

    // Siguiente moneda por la ranura
    if (this.queue.length > 0 && now >= this.nextDrop) {
      this.flying.push({
        denom: this.queue.shift()!,
        start: now,
        landed: false,
        fromX: CHUTE.x + 10 + Math.round(Math.random() * 8),
      });
      this.nextDrop = now + DROP_EVERY;
    }

    return busy || this.flying.length > 0 || this.queue.length > 0 || this.fading.length > 0;
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
    const labels = ["5H", weekLabel(), periodLabel(period)];
    const subs = [
      ...resetLabels([
        { iso: snap?.plan.fiveHour?.resetsAt, room: REEL_W - 1 },
        { iso: snap?.plan.sevenDay?.resetsAt, room: REEL_W - 1 },
      ]),
      snap && settings ? tokensLabel(periodTotals(snap, period).totalTokens, REEL_W) : "",
    ];
    REEL_X.forEach((x, i) => {
      const center = (t: string) => x + Math.floor((REEL_W - textWidth(t)) / 2);
      drawText(g, labels[i], center(labels[i]), 66, C.cream, { shadow: C.shadow });
      const sub = subs[i];
      if (sub) drawText(g, sub, center(sub), 73, C.dim, { shadow: C.shadow });
    });

    this.drawLever(g, now);
    this.drawTrayContents(g, now);
    g.drawImage(layer("traga:labio", W, H, (b) => this.drawTrayLip(b)), 0, 0);
    // Si hay más monedas de las que caben, se cuentan las que no se ven.
    const hidden = this.heap.length - SPOTS.length;
    if (hidden > 0) {
      const label = `+${Math.min(999, hidden)}`;
      drawText(g, label, TRAY.x + TRAY.w - 5 - textWidth(label), TRAY.y + 5, C.gold, { outline: C.ink });
    }
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
    drawText(g, logo, s.x + Math.floor((s.w - textWidth(logo, "big", true)) / 2), s.y + 4, LOGO_GRADIENT, { font: "big", shadow: "#120305" });

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
    const [dark, mid, light] = LED[ledKind(status)];
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
      const font = (t: string) => (textWidth(t, "big") <= REEL_W - 2 ? "big" : "small");
      const center = (t: string) => x + Math.floor((REEL_W - textWidth(t, font(t))) / 2);
      const clip = { x, y: REEL_Y, w: REEL_W, h: REEL_H };
      const put = (t: string, y: number, color: string) =>
        drawText(g, t, center(t), font(t) === "big" ? y : y + 1, color, { font: font(t), clip });
      const spinning = reel.spinStart !== undefined && now >= reel.spinStart;
      if (spinning) {
        const t = Math.min(1, (now - reel.spinStart!) / SPIN_MS);
        const pos = easeOutBack(t) * (reel.strip.length - 1) * ITEM;
        reel.strip.forEach((value, j) => {
          const y = Math.round(mid - j * ITEM + pos);
          if (y < REEL_Y - 9 || y > REEL_Y + REEL_H) return;
          const last = j === reel.strip.length - 1;
          put(value, y, last ? reel.color : C.reelFaint);
        });
      } else {
        // En reposo: el valor en la línea y marcas arriba y abajo
        for (const dy of [-ITEM, ITEM]) {
          const mx = x + Math.floor(REEL_W / 2) - 4;
          rect(g, mx, mid + dy + 2, 8, 2, C.reelFaint);
        }
        put(reel.value, mid, reel.color);
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
    const shown = Math.min(this.heap.length, SPOTS.length);
    for (let i = 0; i < shown; i++) {
      const s = SPOTS[i];
      g.drawImage(coinSprite(s.pose, COIN_COLORS[this.heap[i]], "big"), s.x, s.y);
    }
    // Las que se van suben un poco y se desvanecen en dos pasos.
    for (const f of this.fading) {
      const t = Math.min(1, (now - f.start) / FADE_MS);
      g.globalAlpha = t < 0.5 ? 0.6 : 0.3;
      g.drawImage(coinSprite(f.spot.pose, COIN_COLORS[f.denom], "big"), f.spot.x, f.spot.y - Math.round(t * 4));
      g.globalAlpha = 1;
    }
    this.flying.forEach((coin, i) => this.drawFlyingCoin(g, coin, this.heap.length + i, now));
  }

  private drawFlyingCoin(g: CanvasRenderingContext2D, coin: FlyingCoin, spot: number, now: number) {
    const color = COIN_COLORS[coin.denom];
    const target = SPOTS[Math.min(spot, SPOTS.length - 1)];
    const t = (now - coin.start) / FALL_MS;
    if (t >= 1) {
      // Rebote corto al tocar el montón
      const s = (now - coin.start - FALL_MS) / SETTLE_MS;
      const hop = s < 1 ? Math.round(Math.sin(s * Math.PI) * 2) : 0;
      g.drawImage(coinSprite(target.pose, color, "big"), target.x, target.y - hop);
      return;
    }
    const fromY = CHUTE.y + 2;
    const x = lerp(coin.fromX, target.x, t);
    const y = lerp(fromY, target.y, t * t);
    // Siempre tumbada: cae plana, con un leve vaivén, sin girar de canto.
    const sway = Math.round(Math.sin((now - coin.start) / 60) * 0.6);
    g.drawImage(coinSprite("flat", color, "big"), Math.round(x) + sway, Math.round(y));
  }

}
