// Píldora compacta: una sola fila, pensada para dejarla encima de un juego.
//   [ficha] 73% @2h 17m ┆ SEM 58% ┆ [ficha] $59.31   ●
// Las cifras que importan (tu banca y el dinero) van en la fuente grande.

import { CountUp } from "../core/anim";
import { bankUrgency, bankValue, formatMoney, formatMoneyShort, periodTotals, resetForms, statusLine } from "../core/format";
import { type PaletteName, chipSprites, drawChip } from "../core/chips";
import { drawText, textWidth } from "../core/font";
import { BRASS, drawGhost, drawLed, layer, rect, rounded } from "../core/paint";
import { DENOMS, chipsFor } from "../core/stack";
import type { Snapshot } from "../core/types";
import type { Design, DesignContext } from "./design";

const W = 196;
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
  private cost = new CountUp();
  /** Inicio del giro de cada ficha (banca y dinero). */
  private flips: { bank?: number; money?: number } = {};
  private lastBank: number | null = null;

  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean) {
    this.ctx = ctx;
    const animate = !first && ctx.motion === "full";
    const bank = bankValue(snap.plan.fiveHour, ctx.settings.bankShows);
    const cost = periodTotals(snap, ctx.settings.period).costUsd;

    if (animate && bank !== this.lastBank && this.lastBank !== null) this.flips.bank = now;
    if (animate && Math.floor(cost) > Math.floor(this.cost.target)) {
      this.flips.money = now;
      ctx.cue("chip");
    }
    this.lastBank = bank;

    this.cost.set(cost, now, animate);
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
    if (this.cost.update(now)) busy = true;
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
    const bank = bankValue(plan?.fiveHour, shows);
    const week = bankValue(plan?.sevenDay, shows);
    const weekText = week === null ? "..." : `${week}%`;
    const bankText = bank === null ? statusLine(plan?.status) : `${bank}%`;
    const bankW = bank === null ? textWidth(bankText) + 5 : textWidth(bankText, "big") + 3;
    /** Lo que ocupa la cuenta atrás (o el hueco que deja si no va). */
    const resetSpace = (text: string) => (bank === null ? 0 : text ? textWidth(text) + 5 : 2);

    // Todo tiene que acabar antes del piloto (o del fantasma, si se ve). Si no
    // cabe, la cuenta atrás se compacta («@2h18m», «@2h») antes de quitar los
    // centavos, y solo al final desaparece.
    const limit = snap?.ghost ? LED_X - 10 : LED_X - 2;
    const fixed = 6 + 15 + bankW + 5 + textWidth("SEM") + 3 + textWidth(weekText) + 5 + 5 + 15;
    const resets = bank === null ? [] : resetForms(plan?.fiveHour?.resetsAt).filter((t) => t.startsWith("@"));
    const full = settings ? formatMoney(this.cost.shown, settings) : "";
    const short = settings ? formatMoneyShort(this.cost.shown, settings) : "";
    const options = [
      ...resets.slice(0, 2).flatMap((reset) => [{ money: full, reset }]),
      ...resets.slice(0, 2).flatMap((reset) => [{ money: short, reset }]),
      ...resets.slice(2).flatMap((reset) => [{ money: full, reset }, { money: short, reset }]),
      { money: full, reset: "" },
      { money: short, reset: "" },
    ];
    const fits = (o: (typeof options)[number]) => fixed + resetSpace(o.reset) + textWidth(o.money, "big") <= limit;
    const { money, reset: resetText } = options.find(fits) ?? options[options.length - 1];

    let x = 6;

    // Banca de 5 h
    const urgency = bankUrgency(plan?.fiveHour);
    const bankPalette = (["bank", "bankWarn", "bankBad"] as const)[urgency];
    drawChip(g, chipSprites(bankPalette, "mini"), x, CHIP_Y, this.flipScale("bank", now));
    x += 11 + 4;
    const tone = (u: 0 | 1 | 2) => [C.cream, C.warn, C.bad][u];
    if (bank === null) {
      drawText(g, bankText, x, SMALL_Y, C.warn, shadow);
    } else {
      drawText(g, bankText, x, BIG_Y, tone(urgency), { font: "big", ...shadow });
    }
    x += bankW;
    if (bank !== null && resetText) drawText(g, resetText, x, SMALL_Y, C.dim, shadow);
    x += resetSpace(resetText);
    x = this.separator(g, x);

    // Semana
    drawText(g, "SEM", x, SMALL_Y, C.dim, shadow);
    x += textWidth("SEM") + 3;
    drawText(g, weekText, x, SMALL_Y, week === null ? C.warn : tone(bankUrgency(plan?.sevenDay)), shadow);
    x += textWidth(weekText) + 5;
    x = this.separator(g, x);

    // Dinero del periodo, con la ficha de mayor valor que tenga
    const counts = chipsFor(this.cost.target);
    let top = -1;
    counts.forEach((n, i) => n > 0 && (top = i));
    const palette: PaletteName = top >= 0 ? DENOMS[top].palette : "white";
    drawChip(g, chipSprites(palette, "mini"), x, CHIP_Y, this.flipScale("money", now));
    x += 11 + 4;
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
