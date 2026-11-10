// Píldora compacta: una sola fila, pensada para dejarla encima de un juego.
//   [ficha] 73% ⏱2H17 │ SEM 58% │ [ficha] $59.31 •

import { STATUS_TEXT, bankUrgency, bankValue, formatMoney, formatReset, periodTotals } from "../core/format";
import { type PaletteName, chipSprites, drawChip, drawText } from "../core/pixel";
import { DENOMS, chipsFor } from "../core/stack";
import type { Snapshot } from "../core/types";
import type { Design, DesignContext } from "./design";

const W = 158;
const H = 16;
const FLIP_MS = 520;
const TEXT_Y = 6;

const C = {
  ink: "#0b1a12",
  trim: "#c99a3e",
  felt: "#143a2a",
  feltLight: "#1f5040",
  sep: "#7d5a1e",
  cream: "#f1e6c8",
  dim: "#86b39a",
  gold: "#f0b64e",
  warn: "#f0a24a",
  bad: "#e56a5f",
  ok: "#6fdc8c",
  ghost: "#cfe3ff",
};

export class Pildora implements Design {
  readonly id = "pildora" as const;
  readonly width = W;
  readonly height = H;

  private snap: Snapshot | null = null;
  private ctx: DesignContext | null = null;
  private shownCost = 0;
  private costFrom = 0;
  private costTo = 0;
  private costStart = 0;
  /** Inicio del giro de cada ficha (banca y dinero). */
  private flips: { bank?: number; money?: number } = {};
  private lastBank: number | null = null;

  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean) {
    this.ctx = ctx;
    const animate = !first && ctx.motion === "full";
    const bank = bankValue(snap.plan.fiveHour, ctx.settings.bankShows);
    const cost = periodTotals(snap, ctx.settings.period).costUsd;

    if (animate && bank !== this.lastBank && this.lastBank !== null) this.flips.bank = now;
    if (animate && Math.floor(cost) > Math.floor(this.costTo)) {
      this.flips.money = now;
      ctx.cue("chip");
    }
    this.lastBank = bank;

    this.costFrom = this.shownCost;
    this.costTo = cost;
    this.costStart = now;
    if (first || ctx.motion !== "full") this.shownCost = cost;
    this.snap = snap;
  }

  update(now: number): boolean {
    let busy = false;
    for (const key of ["bank", "money"] as const) {
      const start = this.flips[key];
      if (start === undefined) continue;
      if (now - start >= FLIP_MS) this.flips[key] = undefined;
      else busy = true;
    }
    if (this.shownCost !== this.costTo) {
      const t = Math.min(1, (now - this.costStart) / 600);
      this.shownCost = t >= 1 ? this.costTo : this.costFrom + (this.costTo - this.costFrom) * (1 - (1 - t) ** 3);
      busy = true;
    }
    return busy;
  }

  msUntilIdleEvent(): number {
    return 30_000; // solo la cuenta atrás del reinicio
  }

  private flipScale(key: "bank" | "money", now: number) {
    const start = this.flips[key];
    if (start === undefined) return 1;
    return Math.abs(Math.cos(Math.min(1, (now - start) / FLIP_MS) * Math.PI));
  }

  draw(g: CanvasRenderingContext2D, now: number) {
    g.clearRect(0, 0, W, H);
    this.drawPill(g);

    const snap = this.snap;
    const plan = snap?.plan;
    const settings = this.ctx?.settings;
    const shows = settings?.bankShows ?? "left";
    const statusWord = STATUS_TEXT[plan?.status ?? "loading"]?.[0] || "...";

    // Banca de 5 h
    const urgency = bankUrgency(plan?.fiveHour);
    const bankPalette = (["bank", "bankWarn", "bankBad"] as const)[urgency];
    drawChip(g, chipSprites(bankPalette, "mini"), 4, 5, this.flipScale("bank", now));
    const bank = bankValue(plan?.fiveHour, shows);
    const valueColor = (u: 0 | 1 | 2) => [C.cream, C.warn, C.bad][u];
    if (bank === null) {
      drawText(g, statusWord, 15, TEXT_Y, C.warn);
    } else {
      drawText(g, `${bank}%`, 15, TEXT_Y, valueColor(urgency));
      const reset = formatReset(plan?.fiveHour?.resetsAt);
      if (reset) drawText(g, `@${reset}`, 33, TEXT_Y, C.dim);
    }
    this.separator(g, 57);

    // Semana
    drawText(g, "SEM", 62, TEXT_Y, C.dim);
    const week = bankValue(plan?.sevenDay, shows);
    drawText(g, week === null ? "..." : `${week}%`, 76, TEXT_Y, valueColor(bankUrgency(plan?.sevenDay)));
    this.separator(g, 94);

    // Dinero del periodo, con la ficha de mayor valor que tenga
    const counts = chipsFor(this.costTo);
    let top = -1;
    counts.forEach((n, i) => n > 0 && (top = i));
    const palette: PaletteName = top >= 0 ? DENOMS[top].palette : "white";
    drawChip(g, chipSprites(palette, "mini"), 99, 5, this.flipScale("money", now));
    drawText(g, settings ? formatMoney(this.shownCost, settings) : "", 110, TEXT_Y, C.gold);

    // Fantasma y luz de estado
    if (snap?.ghost) this.drawGhost(g, 142, 5);
    const status = plan?.status;
    const dot = status === "ok" ? C.ok : status === "loading" || !status ? C.dim : status === "rate_limited" ? C.warn : C.bad;
    g.fillStyle = C.ink;
    g.fillRect(149, 6, 5, 5);
    g.fillStyle = dot;
    g.fillRect(150, 7, 3, 3);
  }

  private drawPill(g: CanvasRenderingContext2D) {
    const rect = (x: number, y: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, w, h);
    };
    // Extremos redondeados en escalón
    const pill = (inset: number, c: string) => {
      const x0 = inset, y0 = inset, w = W - inset * 2, h = H - inset * 2;
      rect(x0 + 3, y0, w - 6, h, c);
      rect(x0 + 1, y0 + 1, w - 2, h - 2, c);
      rect(x0, y0 + 3, w, h - 6, c);
    };
    pill(0, C.ink);
    pill(1, C.trim);
    pill(2, C.felt);
    rect(4, 3, W - 8, 1, C.feltLight);
  }

  private separator(g: CanvasRenderingContext2D, x: number) {
    g.fillStyle = C.sep;
    for (let y = 4; y < H - 4; y += 2) g.fillRect(x, y, 1, 1);
  }

  private drawGhost(g: CanvasRenderingContext2D, x: number, y: number) {
    const rows = [".###.", "#####", "#.#.#", "#####", "#.#.#"];
    g.fillStyle = C.ghost;
    rows.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && g.fillRect(x + c, y + r, 1, 1)));
  }
}
