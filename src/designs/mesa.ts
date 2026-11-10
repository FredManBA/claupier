// Mesa «El crupier». Se lee de arriba abajo:
//   cartel    — el nombre, el piloto del plan y lo que queda de la semana
//   pozo      — el gasto del periodo, en fichas sobre su casilla impresa
//   tu banca  — tus fichas de la ventana de 5 h; cuando baja, se deslizan al pozo
//   placa     — dinero y tokens del periodo

import {
  PERIOD_LABEL,
  STATUS_TEXT,
  statusLine,
  bankUrgency,
  bankValue,
  formatMoney,
  resetLabel,
  tokensLabel,
  periodTotals,
} from "../core/format";
import { CHIP_DIMS, type PaletteName, chipSprites, drawChip } from "../core/chips";
import { drawText, textWidth } from "../core/font";
import { CountUp, easeInOut, lerp } from "../core/anim";
import { BRASS, LOGO_GRADIENT, drawFelt, drawGhost, drawLed, drawPlate, drawWoodFrame, engrave, layer, rect, rounded, shadow } from "../core/paint";
import { DENOMS, Stack, chipsFor } from "../core/stack";
import type { LimitWindow, Motion, PlanStatus, Snapshot } from "../core/types";
import type { Design, DesignContext } from "./design";

const W = 112;
const H = 150;

const C = {
  ink: "#0b1a12",
  wood: { ink: "#120b06", dark: "#3e2716", base: "#5c3a22", light: "#7a4d2c", shine: "#9a653a" },
  felt: { base: "#1a4532", dark: "#153a2a", light: "#20503a", edge: "#10301f" },
  print: "#2a5d43",
  printText: "#5f9b7b",
  line: "#7d6a2e",
  sign: "#3c1519",
  signLight: "#4d1c21",
  signDark: "#250a0d",
  signText: "#d9b2a2",
  cream: "#f1e6c8",
  dim: "#8fbaa2",
  gold: "#f0b64e",
  warn: "#f0a24a",
  bad: "#e56a5f",
  shadow: "#0a1a12",
};


// Geometría
const SIGN = { x: 7, y: 7, w: 98, h: 24 };
const POT_BASE = 75;
const POT_X = (i: number) => 7 + i * 20;
const BANK_BASE = 122;
const BANK_X = [8, 28];
const PLATE = { x: 7, y: 127, w: 98, h: 16 };
/** Adonde se deslizan tus fichas: el centro del pozo. */
const POT_CENTER = { x: 47, y: 44 };

const GLIDE_MS = 560;
const GLIDE_STAGGER = 90;

interface Glider {
  from: { x: number; y: number };
  start: number;
  palette: PaletteName;
  landed: boolean;
}


export class Mesa implements Design {
  readonly id = "mesa" as const;
  readonly width = W;
  readonly height = H;

  private pot = DENOMS.map((d, i) => new Stack(POT_X(i), POT_BASE, d.palette, 6));
  private bank = BANK_X.map((x) => new Stack(x, BANK_BASE, "bank", 5));
  private snap: Snapshot | null = null;
  private ctx: DesignContext | null = null;
  /** Fichas de tu banca que se ven ahora mismo. */
  private bankChips = 0;
  private gliders: Glider[] = [];
  private cost = new CountUp();
  private nextFlip = 0;

  constructor() {
    for (const s of this.pot) s.onLand = () => this.ctx?.cue("chip");
  }

  // ── Datos ────────────────────────────────────────────────────────────────

  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean) {
    this.ctx = ctx;
    const motion = first ? "instant" : ctx.motion;
    const shows = ctx.settings.bankShows;

    const v = bankValue(snap.plan.fiveHour, shows);
    const target = v === null ? 0 : Math.max(0, Math.min(10, Math.ceil(v / 10)));
    if (motion === "full" && shows === "left" && target < this.bankChips) {
      // Las que sobran se deslizan al pozo, la de arriba primero.
      const palette = this.bankPalette(snap.plan.fiveHour);
      for (let k = this.bankChips - 1, j = 0; k >= target; k--, j++) {
        this.gliders.push({ from: this.chipAt(k), start: now + j * GLIDE_STAGGER, palette, landed: false });
      }
      this.setBank(target, now, "instant");
    } else {
      if (motion !== "full") this.gliders = [];
      this.setBank(target, now, motion);
    }

    const cost = periodTotals(snap, ctx.settings.period).costUsd;
    chipsFor(cost).forEach((n, i) => this.pot[i].setTarget(n, now, motion));
    this.cost.set(cost, now, motion === "full");
    this.snap = snap;
  }

  private setBank(n: number, now: number, motion: Motion | "instant") {
    this.bankChips = n;
    this.bank[0].setTarget(Math.min(5, n), now, motion);
    this.bank[1].setTarget(Math.max(0, n - 5), now, motion);
  }

  /** Posición de la ficha `k` de tu banca (0 = la de abajo de la primera pila). */
  private chipAt(k: number) {
    const stack = k >= 5 ? this.bank[1] : this.bank[0];
    return { x: stack.x, y: stack.chipY(k % 5) };
  }

  private bankPalette(win: LimitWindow | null | undefined): PaletteName {
    return (["bank", "bankWarn", "bankBad"] as const)[bankUrgency(win)];
  }

  // ── Animación ────────────────────────────────────────────────────────────

  update(now: number): boolean {
    let busy = false;
    for (const s of [...this.pot, ...this.bank]) busy = s.update(now) || busy;

    for (const gl of this.gliders) {
      if (!gl.landed && now - gl.start >= GLIDE_MS) {
        gl.landed = true;
        this.ctx?.cue("chip");
      }
    }
    this.gliders = this.gliders.filter((gl) => now - gl.start < GLIDE_MS);
    if (this.gliders.length > 0) busy = true;

    // El monto cuenta hasta el valor nuevo.
    if (this.cost.update(now)) busy = true;

    // De vez en cuando gira la ficha de arriba de alguna pila.
    if (this.ctx?.motion === "full" && now >= this.nextFlip) {
      if (this.nextFlip !== 0) {
        const tops = [...this.pot, ...this.bank].map((s) => s.topRestingChip()).filter((c) => c !== undefined);
        const pick = tops[Math.floor(Math.random() * tops.length)];
        if (pick) {
          pick.flipStart = now;
          busy = true;
        }
      }
      this.nextFlip = now + 7000 + Math.random() * 6000;
    }
    return busy;
  }

  msUntilIdleEvent(now: number): number {
    if (this.ctx?.motion !== "full") return 30_000;
    return Math.max(0, this.nextFlip - now);
  }

  // ── Dibujo ───────────────────────────────────────────────────────────────

  draw(g: CanvasRenderingContext2D, now: number) {
    g.clearRect(0, 0, W, H);
    const snap = this.snap;
    const plan = snap?.plan;
    const settings = this.ctx?.settings;
    const shows = settings?.bankShows ?? "left";

    g.drawImage(layer("mesa:fondo", W, H, (b) => this.drawTable(b)), 0, 0);
    this.drawSign(g, plan?.sevenDay, plan?.status, snap?.ghost ?? false);

    // Pozo, con el valor impreso bajo cada casilla
    const period = settings?.period ?? "today";
    drawText(g, `POZO ${PERIOD_LABEL[period]}`, 9, 34, C.dim);
    DENOMS.forEach((d, i) => {
      const cx = POT_X(i) + 9;
      drawText(g, d.label, cx - Math.floor(textWidth(d.label) / 2), POT_BASE + 3, C.printText);
    });
    for (const s of this.pot) {
      const extra = s.count - s.maxVisible;
      if (extra > 0) {
        const label = extra > 999 ? "+999" : `+${extra}`;
        drawText(g, label, s.x + 9 - Math.floor(textWidth(label) / 2), s.chipY(s.maxVisible - 1) - 7, C.gold, { shadow: C.shadow });
      }
      s.draw(g, now);
    }

    // Tu banca
    drawText(g, shows === "used" ? "USADO 5H" : "TU BANCA 5H", 9, 90, C.dim);
    const palette = this.bankPalette(plan?.fiveHour);
    for (const s of this.bank) s.draw(g, now, palette);
    this.drawBankText(g, plan?.fiveHour, plan?.status);

    this.drawGliders(g, now);
    this.drawPlate(g, snap);
  }

  /** Lo que no cambia: marco, paño, casillas impresas y la línea de puntos. */
  private drawTable(g: CanvasRenderingContext2D) {
    drawWoodFrame(g, W, H, C.wood);
    drawFelt(g, 5, 5, W - 10, H - 10, C.felt);

    // Casillas del pozo, impresas en el paño (su valor se escribe en cada fotograma).
    DENOMS.forEach((_, i) => ring(g, POT_X(i) + 9, POT_BASE - 3, 20, 8, C.print));

    // Línea de apuestas
    g.fillStyle = C.line;
    for (let x = 9; x < W - 9; x += 2) g.fillRect(x, 86, 1, 1);
  }

  private drawSign(g: CanvasRenderingContext2D, week: LimitWindow | null | undefined, status: PlanStatus | undefined, ghost: boolean) {
    g.drawImage(
      layer("mesa:cartel", W, 34, (b) => {
        const { x, y, w, h } = SIGN;
        rounded(b, x, y, w, h, C.ink, 2);
        rounded(b, x + 1, y + 1, w - 2, h - 2, BRASS.base, 1);
        rect(b, x + 2, y + 1, w - 4, 1, BRASS.shine);
        rect(b, x + 2, y + h - 2, w - 4, 1, BRASS.dark);
        rect(b, x + 2, y + 2, w - 4, h - 4, C.ink);
        rect(b, x + 3, y + 3, w - 6, h - 6, C.sign);
        rect(b, x + 3, y + 3, w - 6, 2, C.signLight);
        rect(b, x + 3, y + h - 4, w - 6, 1, C.signDark);
        const logo = "CLAUPIER";
        drawText(b, logo, x + Math.floor((w - textWidth(logo, "big", true)) / 2), y + 4, LOGO_GRADIENT, { font: "big", shadow: C.signDark });
      }),
      0,
      0,
    );
    const { x, y, w } = SIGN;
    drawLed(g, x + w - 10, y + 5, status);
    if (ghost) drawGhost(g, x + 6, y + 5);

    // La semana, debajo del nombre
    const shows = this.ctx?.settings.bankShows ?? "left";
    const v = bankValue(week, shows);
    const parts: [string, string][] =
      v === null
        ? [[statusLine(status), C.warn]]
        : [
            ["SEMANA ", C.signText],
            [`${v}%`, [C.cream, C.warn, C.bad][bankUrgency(week)]],
          ];
    const reset = v === null ? "" : resetLabel(week?.resetsAt, 40);
    if (reset) parts.push([`  ${reset}`, C.signText]);
    const total = textWidth(parts.map((p) => p[0]).join(""));
    let cx = x + Math.floor((w - total) / 2);
    for (const [text, color] of parts) {
      drawText(g, text, cx, y + 13, color, { shadow: C.signDark });
      cx += textWidth(text) + (text.endsWith(" ") ? 0 : 1);
    }
  }

  private drawBankText(g: CanvasRenderingContext2D, win: LimitWindow | null | undefined, status: string | undefined) {
    const x = 52;
    const value = bankValue(win, this.ctx?.settings.bankShows ?? "left");
    if (value === null) {
      const [a, b] = STATUS_TEXT[status ?? "loading"] ?? STATUS_TEXT.loading;
      drawText(g, a || "...", x, 101, C.warn, { shadow: C.shadow });
      if (b) drawText(g, b, x, 108, C.warn, { shadow: C.shadow });
      return;
    }
    const color = [C.cream, C.warn, C.bad][bankUrgency(win)];
    drawText(g, `${value}%`, x, 100, color, { font: "big", shadow: C.shadow });
    const reset = resetLabel(win?.resetsAt, W - 6 - x);
    if (reset) drawText(g, reset, x, 111, C.dim);
  }

  private drawGliders(g: CanvasRenderingContext2D, now: number) {
    const d = CHIP_DIMS.big;
    for (const gl of this.gliders) {
      const t = (now - gl.start) / GLIDE_MS;
      const sprites = chipSprites(gl.palette);
      if (t <= 0) {
        drawChip(g, sprites, gl.from.x, gl.from.y);
        continue;
      }
      const k = easeInOut(Math.min(1, t));
      // Arco: sube un poco al despegar y baja al llegar.
      const x = lerp(gl.from.x, POT_CENTER.x, k);
      const y = lerp(gl.from.y, POT_CENTER.y, k) - Math.sin(k * Math.PI) * 10;
      shadow(g, x + d.w / 2 + 1, lerp(gl.from.y + d.h, POT_CENTER.y + d.h, k) + 2, d.w - 2, 4, 0.2);
      // Al llegar al pozo se desvanece en dos pasos, sin posarse.
      g.globalAlpha = t < 0.72 ? 1 : t < 0.86 ? 0.6 : 0.3;
      drawChip(g, sprites, x, y);
      g.globalAlpha = 1;
    }
  }

  private drawPlate(g: CanvasRenderingContext2D, snap: Snapshot | null) {
    const { x, y, w, h } = PLATE;
    g.drawImage(layer("mesa:placa", W, H, (b) => drawPlate(b, x, y, w, h)), 0, 0);
    const settings = this.ctx?.settings;
    if (!settings) return;
    const money = formatMoney(this.cost.shown, settings);
    engrave(g, money, x + 5, y + 4, BRASS.ink, { font: "big" });
    const totals = snap ? periodTotals(snap, settings.period) : null;
    const tokens = tokensLabel(totals?.totalTokens ?? 0, w - 15 - textWidth(money, "big"));
    engrave(g, tokens, x + w - 6 - textWidth(tokens), y + 6, "#4a3210");
  }
}

/** Anillo elíptico de 1 px (la casilla impresa en el paño). */
function ring(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, color: string) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const r = c.getContext("2d")!;
  ellipse(r, w, h, 0, color);
  r.globalCompositeOperation = "destination-out";
  ellipse(r, w, h, 1, "#000");
  g.drawImage(c, Math.round(cx - w / 2), Math.round(cy - h / 2));
}

/** Elipse rellena, fila por fila, metida `inset` píxeles hacia dentro. */
function ellipse(g: CanvasRenderingContext2D, w: number, h: number, inset: number, color: string) {
  g.fillStyle = color;
  const a = w / 2 - inset;
  const b = h / 2 - inset;
  for (let y = inset; y < h - inset; y++) {
    const dy = (y + 0.5 - h / 2) / b;
    const half = Math.round(a * Math.sqrt(Math.max(0, 1 - dy * dy)));
    if (half > 0) g.fillRect(Math.round(w / 2 - half), y, half * 2, 1);
  }
}
