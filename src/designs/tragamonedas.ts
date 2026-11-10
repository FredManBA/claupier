// Tragamonedas: tres rodillos (banca de 5 h, semana y dinero del periodo).
// Cuando un valor cambia, la palanca baja y su rodillo gira hasta el nuevo.
// Abajo, en la bandeja, caen las fichas del gasto.

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
import { drawText, textWidth } from "../core/pixel";
import { DENOMS, Stack, chipsFor } from "../core/stack";
import type { Snapshot } from "../core/types";
import type { Design, DesignContext } from "./design";

const W = 104;
const H = 138;

const C = {
  ink: "#0b1a12",
  body: "#6b1a20",
  bodyLight: "#8a2830",
  bodyDark: "#4a1015",
  trim: "#c99a3e",
  trimDark: "#7d5a1e",
  sign: "#2a0c10",
  bulbA: "#ffcf5a",
  bulbB: "#f0a24a",
  reel: "#efe6cf",
  reelShade: "#cfc3a6",
  reelDeep: "#a99d82",
  reelText: "#2a1a14",
  reelFaint: "#b9ad92",
  tray: "#2a0c10",
  cream: "#f1e6c8",
  dim: "#d9b3a0",
  gold: "#f0b64e",
  warn: "#f0a24a",
  bad: "#e56a5f",
  ok: "#6fdc8c",
  knob: "#c9383e",
  knobLight: "#ea7a7f",
  stick: "#b9b2a6",
  brass: "#b8862f",
  brassLight: "#d9a948",
  brassDark: "#6e4c16",
  ghost: "#cfe3ff",
};

const REEL_X = [10, 37, 64];
const REEL_W = 26;
const REEL_Y = 26;
const REEL_H = 30;
const ITEM = 11; // separación entre valores del rodillo
const SPIN_MS = 900;
const SPIN_STAGGER = 150;
const LEVER_MS = 520;
const TRAY_BASE = 110;

interface Reel {
  value: string;
  color: string;
  /** Valores que pasan durante el giro, del anterior al nuevo. */
  strip: string[];
  spinStart?: number;
  lastTick: number;
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
  private tray = DENOMS.map((d, i) => new Stack(12 + i * 15, TRAY_BASE, d.palette, 8, C.tray, "mini"));
  private leverStart?: number;
  private snap: Snapshot | null = null;
  private ctx: DesignContext | null = null;

  constructor() {
    for (const s of this.tray) s.onLand = () => this.ctx?.cue("chip");
  }

  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean) {
    this.ctx = ctx;
    const s = ctx.settings;
    const statusWord = STATUS_TEXT[snap.plan.status]?.[0] || "...";
    const five = bankValue(snap.plan.fiveHour, s.bankShows);
    const week = bankValue(snap.plan.sevenDay, s.bankShows);
    const cost = periodTotals(snap, s.period).costUsd;
    const next: [string, string][] = [
      [five === null ? statusWord : `${five}%`, five === null ? C.bad : this.urgencyColor(bankUrgency(snap.plan.fiveHour))],
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

    const motion = first ? "instant" : ctx.motion;
    chipsFor(cost).forEach((n, i) => this.tray[i].setTarget(n, now, motion));
    this.snap = snap;
  }

  private urgencyColor(u: 0 | 1 | 2) {
    return [C.reelText, "#b5651d", "#b0322b"][u];
  }

  update(now: number): boolean {
    let busy = false;
    for (const s of this.tray) busy = s.update(now) || busy;
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
    return busy;
  }

  msUntilIdleEvent(): number {
    return 30_000;
  }

  draw(g: CanvasRenderingContext2D, now: number) {
    g.clearRect(0, 0, W, H);
    const snap = this.snap;
    const settings = this.ctx?.settings;
    this.drawCabinet(g, snap?.plan.status);
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
      drawText(g, labels[i], center(labels[i]), 61, C.cream);
      const sub = i < 2 && subs[i] ? `@${subs[i]}` : subs[i];
      if (sub) drawText(g, sub, center(sub), 68, C.dim);
    });

    this.drawLever(g, now);
    this.drawTray(g, now);
    this.drawPlate(g, snap);
    if (snap?.ghost) this.drawGhost(g, 84, 7);
  }

  private drawCabinet(g: CanvasRenderingContext2D, status: string | undefined) {
    const rect = (x: number, y: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, w, h);
    };
    const bodyW = 96;
    // Cuerpo con esquinas en escalón
    rect(2, 4, bodyW - 4, H - 4, C.ink);
    rect(1, 5, bodyW - 2, H - 6, C.ink);
    rect(0, 7, bodyW, H - 10, C.ink);
    rect(3, 5, bodyW - 6, H - 6, C.body);
    rect(1, 7, bodyW - 2, H - 10, C.body);
    rect(3, 5, bodyW - 6, 1, C.bodyLight);
    rect(1, 7, 1, H - 10, C.bodyLight);
    rect(bodyW - 2, 7, 1, H - 10, C.bodyDark);

    // Luz de estado sobre el cartel
    const light = status === "ok" ? C.ok : status === "loading" || !status ? "#86b39a" : status === "rate_limited" ? C.warn : C.bad;
    rect(44, 0, 8, 5, C.ink);
    rect(45, 1, 6, 4, light);
    rect(46, 1, 2, 1, C.cream);

    // Cartel con bombillas fijas
    rect(5, 6, bodyW - 10, 15, C.ink);
    rect(6, 7, bodyW - 12, 13, C.sign);
    for (let x = 8; x < bodyW - 8; x += 4) {
      const c = (x / 4) % 2 === 0 ? C.bulbA : C.bulbB;
      rect(x, 8, 2, 1, c);
      rect(x, 18, 2, 1, c);
    }
    drawText(g, "CLAUPIER", Math.floor((bodyW - textWidth("CLAUPIER")) / 2), 11, C.gold);

    // Marco de los rodillos
    rect(7, REEL_Y - 3, 84, REEL_H + 6, C.ink);
    rect(8, REEL_Y - 2, 82, REEL_H + 4, C.trimDark);
    rect(8, REEL_Y - 2, 82, 1, C.trim);
    // Marcadores de la línea de premio
    const mid = REEL_Y + Math.floor(REEL_H / 2);
    rect(4, mid - 2, 2, 5, C.gold);
    rect(6, mid - 1, 1, 3, C.gold);
    rect(92, mid - 2, 2, 5, C.gold);
    rect(91, mid - 1, 1, 3, C.gold);
  }

  private drawReels(g: CanvasRenderingContext2D, now: number) {
    const mid = REEL_Y + Math.floor(REEL_H / 2) - 2; // y del texto centrado
    this.reels.forEach((reel, i) => {
      const x = REEL_X[i];
      // Cilindro: más oscuro arriba y abajo
      g.fillStyle = C.reelDeep;
      g.fillRect(x, REEL_Y, REEL_W, REEL_H);
      g.fillStyle = C.reelShade;
      g.fillRect(x, REEL_Y + 3, REEL_W, REEL_H - 6);
      g.fillStyle = C.reel;
      g.fillRect(x, REEL_Y + 8, REEL_W, REEL_H - 16);

      g.save();
      g.beginPath();
      g.rect(x, REEL_Y, REEL_W, REEL_H);
      g.clip();
      const center = (t: string) => x + Math.floor((REEL_W - textWidth(t)) / 2);
      const spinning = reel.spinStart !== undefined && now >= reel.spinStart;
      if (spinning) {
        const t = Math.min(1, (now - reel.spinStart!) / SPIN_MS);
        const pos = easeOutBack(t) * (reel.strip.length - 1) * ITEM;
        reel.strip.forEach((value, j) => {
          const y = Math.round(mid - j * ITEM + pos);
          if (y < REEL_Y - 6 || y > REEL_Y + REEL_H) return;
          const last = j === reel.strip.length - 1;
          drawText(g, value, center(value), y, last ? reel.color : C.reelText);
        });
      } else {
        // En reposo: el valor en la línea y guiones arriba y abajo
        drawText(g, "- -", center("- -"), mid - ITEM, C.reelFaint);
        drawText(g, reel.value, center(reel.value), mid, reel.color);
        drawText(g, "- -", center("- -"), mid + ITEM, C.reelFaint);
      }
      g.restore();
      // Separación entre rodillos
      g.fillStyle = C.ink;
      g.fillRect(x + REEL_W, REEL_Y, 1, REEL_H);
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
    const baseY = 52;
    const knobY = Math.round(22 + pull * 36);
    // Soporte en el costado del gabinete
    g.fillStyle = C.ink;
    g.fillRect(95, baseY - 4, 4, 9);
    g.fillStyle = C.trimDark;
    g.fillRect(95, baseY - 3, 3, 7);
    // Barra
    const top = Math.min(knobY + 3, baseY);
    const bottom = Math.max(knobY + 3, baseY);
    g.fillStyle = C.ink;
    g.fillRect(99, top, 3, bottom - top + 1);
    g.fillStyle = C.stick;
    g.fillRect(100, top, 1, bottom - top + 1);
    // Bola
    g.fillStyle = C.ink;
    g.fillRect(97, knobY - 1, 7, 7);
    g.fillStyle = C.knob;
    g.fillRect(98, knobY, 5, 5);
    g.fillStyle = C.knobLight;
    g.fillRect(99, knobY + 1, 2, 1);
  }

  private drawTray(g: CanvasRenderingContext2D, now: number) {
    // Ranura por donde caen las fichas
    g.fillStyle = C.ink;
    g.fillRect(34, 76, 28, 4);
    g.fillStyle = C.trimDark;
    g.fillRect(34, 76, 28, 1);
    // Bandeja hundida
    g.fillStyle = C.ink;
    g.fillRect(7, 84, 82, 29);
    g.fillStyle = C.tray;
    g.fillRect(8, 85, 80, 27);
    g.fillStyle = C.bodyDark;
    g.fillRect(8, 85, 80, 1);
    for (const s of this.tray) {
      const extra = s.count - s.maxVisible;
      if (extra > 0) {
        const label = `+${extra}`;
        drawText(g, label, s.x + 4 - Math.floor(textWidth(label) / 2), 87, C.gold);
      }
      s.draw(g, now);
    }
  }

  private drawPlate(g: CanvasRenderingContext2D, snap: Snapshot | null) {
    const x = 6, y = 117, w = 84, h = 15;
    g.fillStyle = C.ink;
    g.fillRect(x, y, w, h);
    g.fillStyle = C.brassDark;
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle = C.brass;
    g.fillRect(x + 1, y + 1, w - 2, h - 3);
    g.fillStyle = C.brassLight;
    g.fillRect(x + 1, y + 1, w - 2, 1);
    const settings = this.ctx?.settings;
    if (!snap || !settings) return;
    const totals = periodTotals(snap, settings.period);
    drawText(g, formatMoney(totals.costUsd, settings), x + 5, y + 5, C.ink);
    const tokens = `${formatTokens(totals.totalTokens)} TOK`;
    drawText(g, tokens, x + w - 5 - textWidth(tokens), y + 5, C.brassDark);
  }

  private drawGhost(g: CanvasRenderingContext2D, x: number, y: number) {
    const rows = [".###.", "#####", "#.#.#", "#####", "#.#.#"];
    g.fillStyle = C.ghost;
    rows.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && g.fillRect(x + c, y + r, 1, 1)));
  }
}
