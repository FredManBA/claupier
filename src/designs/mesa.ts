// Mesa de casino: la banca (lo que queda del plan) y las fichas del periodo.
// En la E2 se rehace como «El crupier»; aquí está la v1 sobre la nueva estructura.

import { PERIOD_LABEL, STATUS_TEXT, bankUrgency, bankValue, formatMoney, formatReset, formatTokens, periodTotals } from "../core/format";
import { drawText, textWidth } from "../core/pixel";
import { DENOMS, Stack, chipsFor } from "../core/stack";
import type { LimitWindow, Snapshot } from "../core/types";
import type { Design, DesignContext } from "./design";

const W = 100;
const H = 117;

const C = {
  outline: "#0b1a12",
  trim: "#c99a3e",
  trimDark: "#7d5a1e",
  felt: "#1a4532",
  feltDark: "#123326",
  cream: "#f1e6c8",
  dim: "#86b39a",
  gold: "#f0b64e",
  warn: "#f0a24a",
  bad: "#e56a5f",
  ok: "#6fdc8c",
  ghost: "#cfe3ff",
};

export class Mesa implements Design {
  readonly id = "mesa" as const;
  readonly width = W;
  readonly height = H;

  private bank5h = new Stack(6, 64, "bank", 10);
  private bank7d = new Stack(52, 64, "bank", 10);
  private pot = DENOMS.map((d, i) => new Stack(4 + i * 19, 104, d.palette, 8));
  private snap: Snapshot | null = null;
  private ctx: DesignContext | null = null;
  private shownCost = 0;
  private costFrom = 0;
  private costTo = 0;
  private costStart = 0;
  private nextFlip = 0;

  constructor() {
    for (const s of this.pot) s.onLand = () => this.ctx?.cue("chip");
  }

  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean) {
    this.ctx = ctx;
    const motion = first ? "instant" : ctx.motion;
    const shows = ctx.settings.bankShows;
    const chips = (win: LimitWindow | null | undefined) => {
      const v = bankValue(win, shows);
      return v === null ? 0 : Math.max(0, Math.min(10, Math.ceil(v / 10)));
    };
    this.bank5h.setTarget(chips(snap.plan.fiveHour), now, motion);
    this.bank7d.setTarget(chips(snap.plan.sevenDay), now, motion);

    const cost = periodTotals(snap, ctx.settings.period).costUsd;
    chipsFor(cost).forEach((n, i) => this.pot[i].setTarget(n, now, motion));
    this.costFrom = this.shownCost;
    this.costTo = cost;
    this.costStart = now;
    if (motion !== "full") this.shownCost = cost;
    this.snap = snap;
  }

  update(now: number): boolean {
    let busy = false;
    for (const s of this.stacks()) busy = s.update(now) || busy;

    if (this.shownCost !== this.costTo) {
      const t = Math.min(1, (now - this.costStart) / 600);
      this.shownCost = t >= 1 ? this.costTo : this.costFrom + (this.costTo - this.costFrom) * (1 - (1 - t) ** 3);
      busy = true;
    }

    // De vez en cuando gira la ficha de arriba de alguna pila.
    if (this.ctx?.motion === "full" && now >= this.nextFlip) {
      if (this.nextFlip !== 0) {
        const candidates = this.stacks()
          .map((s) => s.topRestingChip())
          .filter((c) => c !== undefined);
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        if (pick) {
          pick.flipStart = now;
          busy = true;
        }
      }
      this.nextFlip = now + 5000 + Math.random() * 5000;
    }
    return busy;
  }

  msUntilIdleEvent(now: number): number {
    return this.ctx?.motion === "full" ? Math.max(0, this.nextFlip - now) : 30_000;
  }

  private stacks(): Stack[] {
    return [this.bank5h, this.bank7d, ...this.pot];
  }

  draw(g: CanvasRenderingContext2D, now: number) {
    g.clearRect(0, 0, W, H);
    this.drawPanel(g);

    const snap = this.snap;
    const plan = snap?.plan;
    const settings = this.ctx?.settings;

    drawText(g, "CLAUPIER", 6, 5, C.gold);
    const pip =
      plan?.status === "ok" ? C.ok : plan?.status === "loading" || !plan ? C.dim : plan.status === "rate_limited" ? C.warn : C.bad;
    g.fillStyle = C.outline;
    g.fillRect(89, 5, 5, 5);
    g.fillStyle = pip;
    g.fillRect(90, 6, 3, 3);
    if (snap?.ghost) this.drawGhost(g, 80, 5);
    this.dottedLine(g, 13);

    drawText(g, settings?.bankShows === "used" ? "USADO" : "BANCA", 6, 17, C.dim);
    const bankPalette = (win: LimitWindow | null | undefined) =>
      (["bank", "bankWarn", "bankBad"] as const)[bankUrgency(win)];
    this.bank5h.draw(g, now, bankPalette(plan?.fiveHour));
    this.bank7d.draw(g, now, bankPalette(plan?.sevenDay));
    this.drawBankLabel(g, 25, "5H", plan?.fiveHour, plan?.status);
    this.drawBankLabel(g, 71, "SEM", plan?.sevenDay, plan?.status);
    this.dottedLine(g, 67);

    drawText(g, PERIOD_LABEL[settings?.period ?? "today"], 6, 70, C.dim);
    for (const s of this.pot) {
      const extra = s.count - s.maxVisible;
      if (extra > 0) {
        const label = `+${extra}`;
        drawText(g, label, s.x + 8 - Math.floor(textWidth(label) / 2), 69, C.gold);
      }
      s.draw(g, now);
    }

    const money = settings ? formatMoney(this.shownCost, settings) : "";
    drawText(g, money, 6, 108, C.gold);
    const tokens = `${formatTokens(snap ? periodTotals(snap, settings?.period ?? "today").totalTokens : 0)} TOK`;
    drawText(g, tokens, 94 - textWidth(tokens), 108, C.dim);
  }

  private drawBankLabel(
    g: CanvasRenderingContext2D,
    x: number,
    name: string,
    win: LimitWindow | null | undefined,
    status: string | undefined,
  ) {
    drawText(g, name, x, 31, C.dim);
    const value = bankValue(win, this.ctx?.settings.bankShows ?? "left");
    if (value === null) {
      const [a, b] = STATUS_TEXT[status ?? "loading"] ?? STATUS_TEXT.loading;
      drawText(g, a || "...", x, 40, C.warn);
      if (b) drawText(g, b, x, 47, C.warn);
      return;
    }
    const color = [C.cream, C.warn, C.bad][bankUrgency(win)];
    drawText(g, `${value}%`, x, 40, color);
    const reset = formatReset(win?.resetsAt);
    if (reset) drawText(g, `@${reset}`, x, 49, C.dim);
  }

  private drawPanel(g: CanvasRenderingContext2D) {
    const rect = (x: number, y: number, w: number, h: number, color: string) => {
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
    };
    const rounded = (inset: number, color: string) => {
      const x0 = inset,
        y0 = inset,
        x1 = W - inset,
        y1 = H - inset;
      rect(x0 + 2, y0, x1 - x0 - 4, y1 - y0, color);
      rect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2, color);
      rect(x0, y0 + 2, x1 - x0, y1 - y0 - 4, color);
    };
    rounded(0, C.outline);
    rounded(1, C.trim);
    rect(3, H - 3, W - 6, 1, C.trimDark);
    rounded(2, C.outline);
    rounded(3, C.felt);
    g.fillStyle = C.feltDark;
    for (let y = 5; y < H - 4; y += 4) {
      for (let x = 5 + ((y / 4) % 2) * 2; x < W - 4; x += 4) g.fillRect(x, y, 1, 1);
    }
  }

  private dottedLine(g: CanvasRenderingContext2D, y: number) {
    g.fillStyle = C.trimDark;
    for (let x = 5; x < W - 5; x += 2) g.fillRect(x, y, 1, 1);
  }

  private drawGhost(g: CanvasRenderingContext2D, x: number, y: number) {
    const rows = [".###.", "#####", "#.#.#", "#####", "#.#.#"];
    g.fillStyle = C.ghost;
    rows.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && g.fillRect(x + c, y + r, 1, 1)));
  }
}
