// Píldora compacta: una sola fila, pensada para dejarla encima de un juego.
//   [ficha] 73% @2H17 ┆ SEM 58% ┆ [ficha] $59.31   ●
// Las cifras que importan (tu banca y el dinero) van en la fuente grande.

import { STATUS_TEXT, bankUrgency, bankValue, formatMoney, formatReset, periodTotals } from "../core/format";
import { type PaletteName, chipSprites, drawChip } from "../core/chips";
import { drawText, textWidth } from "../core/font";
import { BRASS, drawGhost, drawLed, layer, rect, rounded } from "../core/paint";
import { DENOMS, chipsFor } from "../core/stack";
import type { Snapshot } from "../core/types";
import type { Design, DesignContext } from "./design";

const W = 170;
const H = 18;
const FLIP_MS = 520;
const BIG_Y = 6;
const SMALL_Y = 7;
const CHIP_Y = 6;
const LED_X = W - 11;

const C = {
  ink: "#0b1a12",
  felt: "#173f2e",
  feltLight: "#21523c",
  feltDark: "#12321f",
  sep: "#6e5a24",
  cream: "#f1e6c8",
  dim: "#8fbaa2",
  gold: "#f0b64e",
  warn: "#f0a24a",
  bad: "#e56a5f",
  shadow: "#0a1d14",
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
    g.drawImage(layer("pildora:fondo", W, H, (b) => this.drawPill(b)), 0, 0);

    const snap = this.snap;
    const plan = snap?.plan;
    const settings = this.ctx?.settings;
    const shows = settings?.bankShows ?? "left";
    const shadow = { shadow: C.shadow };
    let x = 6;

    // Banca de 5 h
    const urgency = bankUrgency(plan?.fiveHour);
    const bankPalette = (["bank", "bankWarn", "bankBad"] as const)[urgency];
    drawChip(g, chipSprites(bankPalette, "mini"), x, CHIP_Y, this.flipScale("bank", now));
    x += 11 + 4;
    const bank = bankValue(plan?.fiveHour, shows);
    const tone = (u: 0 | 1 | 2) => [C.cream, C.warn, C.bad][u];
    if (bank === null) {
      const word = STATUS_TEXT[plan?.status ?? "loading"]?.[0] || "...";
      drawText(g, word, x, SMALL_Y, C.warn, shadow);
      x += textWidth(word) + 5;
    } else {
      const value = `${bank}%`;
      drawText(g, value, x, BIG_Y, tone(urgency), { font: "big", ...shadow });
      x += textWidth(value, "big") + 3;
      const reset = formatReset(plan?.fiveHour?.resetsAt);
      if (reset) {
        drawText(g, `@${reset}`, x, SMALL_Y, C.dim, shadow);
        x += textWidth(`@${reset}`) + 5;
      } else x += 2;
    }
    x = this.separator(g, x);

    // Semana
    drawText(g, "SEM", x, SMALL_Y, C.dim, shadow);
    x += textWidth("SEM") + 3;
    const week = bankValue(plan?.sevenDay, shows);
    const weekText = week === null ? "..." : `${week}%`;
    drawText(g, weekText, x, SMALL_Y, week === null ? C.warn : tone(bankUrgency(plan?.sevenDay)), shadow);
    x += textWidth(weekText) + 5;
    x = this.separator(g, x);

    // Dinero del periodo, con la ficha de mayor valor que tenga
    const counts = chipsFor(this.costTo);
    let top = -1;
    counts.forEach((n, i) => n > 0 && (top = i));
    const palette: PaletteName = top >= 0 ? DENOMS[top].palette : "white";
    drawChip(g, chipSprites(palette, "mini"), x, CHIP_Y, this.flipScale("money", now));
    x += 11 + 4;
    const money = settings ? formatMoney(this.shownCost, settings) : "";
    drawText(g, money, x, BIG_Y, C.gold, { font: "big", ...shadow });

    // Fantasma y piloto de estado
    if (snap?.ghost) drawGhost(g, LED_X - 8, 6);
    drawLed(g, LED_X, 6, plan?.status, C.ink);
  }

  private drawPill(g: CanvasRenderingContext2D) {
    rounded(g, 0, 0, W, H, C.ink, 3);
    rounded(g, 1, 1, W - 2, H - 2, BRASS.base, 3);
    rect(g, 4, 1, W - 8, 1, BRASS.shine);
    rect(g, 4, H - 2, W - 8, 1, BRASS.dark);
    rounded(g, 2, 2, W - 4, H - 4, C.ink, 2);
    rounded(g, 3, 3, W - 6, H - 6, C.felt, 2);
    rect(g, 5, 3, W - 10, 1, C.feltLight);
    rect(g, 5, H - 4, W - 10, 1, C.feltDark);
  }

  /** Separador punteado; devuelve la x donde sigue el texto. */
  private separator(g: CanvasRenderingContext2D, x: number) {
    g.fillStyle = C.sep;
    for (let y = 5; y < H - 5; y += 2) g.fillRect(x, y, 1, 1);
    return x + 5;
  }
}
