// La mesa de Claupier: la banca (lo que queda del plan) y las fichas del día.

import { CHIP_H, CHIP_STEP, PaletteName, chipSprites, drawChip, drawText, slot, textWidth } from "./pixel";
import type { Snapshot } from "./types";

export const W = 100;
export const H = 117;

const C = {
  outline: "#0b1a12",
  trim: "#c99a3e",
  trimDark: "#7d5a1e",
  felt: "#1a4532",
  feltDark: "#123326",
  feltSpot: "#143a2a",
  cream: "#f1e6c8",
  dim: "#86b39a",
  gold: "#f0b64e",
  warn: "#f0a24a",
  bad: "#e56a5f",
  ok: "#6fdc8c",
  ghost: "#cfe3ff",
};

const DENOMS: { value: number; palette: PaletteName; label: string }[] = [
  { value: 1, palette: "white", label: "1" },
  { value: 5, palette: "red", label: "5" },
  { value: 25, palette: "green", label: "25" },
  { value: 100, palette: "black", label: "100" },
  { value: 500, palette: "orange", label: "500" },
];

const DROP_MS = 260;
const BOUNCE_MS = 90;
const POP_MS = 260;
const FLIP_MS = 520;

interface Chip {
  state: "drop" | "rest" | "pop";
  start: number;
  flipStart?: number;
}

class Stack {
  chips: Chip[] = [];
  constructor(
    public x: number,
    public base: number,
    public palette: PaletteName,
    public maxVisible: number,
  ) {}

  /** Número de fichas que la pila tendrá al terminar las animaciones. */
  get count() {
    return this.chips.filter((c) => c.state !== "pop").length;
  }

  setTarget(n: number, now: number, animate: boolean) {
    // Las que se estaban yendo desaparecen ya, para no mezclar animaciones.
    this.chips = this.chips.filter((c) => c.state !== "pop");
    const current = this.chips.length;
    if (!animate) {
      this.chips = Array.from({ length: n }, () => ({ state: "rest" as const, start: now }));
      return;
    }
    // Solo se animan las que se ven; las de arriba del tope entran sin más.
    if (n > current) {
      for (let i = current; i < n; i++) {
        const delay = i < this.maxVisible ? (i - current) * 90 : 0;
        this.chips.push({ state: i < this.maxVisible ? "drop" : "rest", start: now + delay });
      }
    } else if (n < current) {
      for (let i = current - 1, j = 0; i >= n; i--, j++) {
        this.chips[i] = { state: "pop", start: now + Math.min(j, 6) * 70 };
      }
    }
  }

  /** Avanza las animaciones. Devuelve `true` si sigue habiendo movimiento. */
  update(now: number): boolean {
    let busy = false;
    for (const c of this.chips) {
      if (c.state === "drop") {
        if (now - c.start >= DROP_MS + BOUNCE_MS) c.state = "rest";
        else busy = true;
      }
      if (c.flipStart !== undefined) {
        if (now - c.flipStart >= FLIP_MS) c.flipStart = undefined;
        else busy = true;
      }
    }
    const before = this.chips.length;
    this.chips = this.chips.filter((c) => !(c.state === "pop" && now - c.start >= POP_MS));
    return busy || this.chips.some((c) => c.state === "pop") || before !== this.chips.length;
  }

  topRestingChip(): Chip | undefined {
    const visible = this.chips.slice(0, this.maxVisible);
    const top = visible[visible.length - 1];
    return top?.state === "rest" ? top : undefined;
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    ctx.drawImage(slot(C.feltSpot), this.x, this.base - 6);
    const sprites = chipSprites(this.palette);
    const visible = this.chips.slice(0, this.maxVisible);
    visible.forEach((c, i) => {
      if (c.state === "drop" && now < c.start) return; // aún no cae
      let y = this.base - CHIP_H - i * CHIP_STEP;
      let alpha = 1;
      let scaleX = 1;
      if (c.state === "drop") {
        const t = (now - c.start) / DROP_MS;
        if (t < 1) y -= Math.round((1 - t * t) * 30);
        else y -= 1; // pequeño rebote al aterrizar
      } else if (c.state === "pop" && now >= c.start) {
        const t = Math.min(1, (now - c.start) / POP_MS);
        y -= Math.round(t * 6);
        alpha = t < 0.34 ? 1 : t < 0.67 ? 0.6 : 0.3;
      }
      if (c.flipStart !== undefined) {
        const t = Math.min(1, (now - c.flipStart) / FLIP_MS);
        scaleX = Math.abs(Math.cos(t * Math.PI));
      }
      ctx.globalAlpha = alpha;
      drawChip(ctx, sprites, this.x, y, scaleX);
      ctx.globalAlpha = 1;
    });
  }
}

/** Cambio del gasto en fichas, de la más cara a la más barata. */
export function chipsFor(costUsd: number): number[] {
  let rest = Math.floor(Math.max(0, costUsd));
  return [...DENOMS].reverse().map((d) => {
    const n = Math.floor(rest / d.value);
    rest -= n * d.value;
    return n;
  }).reverse();
}

export function formatUsd(v: number): string {
  if (v >= 100_000) return `$${Math.round(v / 1000)}K`;
  if (v >= 10_000) return `$${(v / 1000).toFixed(1)}K`;
  if (v >= 1000) return `$${Math.round(v)}`;
  return `$${v.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${n}`;
}

export function formatReset(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "YA";
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d}D${h}H`;
  if (h > 0) return `${h}H${String(m).padStart(2, "0")}`;
  return `${m}M`;
}

const STATUS_TEXT: Record<string, [string, string]> = {
  loading: ["...", ""],
  expired: ["ABRE", "CLAUDE"],
  no_credentials: ["SIN", "SESION"],
  rate_limited: ["ESPERA", ""],
  error: ["SIN RED", ""],
};

export class Scene {
  private bank5h = new Stack(6, 64, "bank", 10);
  private bank7d = new Stack(52, 64, "bank", 10);
  private today = DENOMS.map((d, i) => new Stack(4 + i * 19, 104, d.palette, 8));
  private snap: Snapshot | null = null;
  private shownCost = 0;
  private costFrom = 0;
  private costTo = 0;
  private costStart = 0;
  private nextFlip = 0;

  constructor(private reducedMotion: () => boolean) {}

  setSnapshot(snap: Snapshot, now: number) {
    const animate = this.snap !== null && !this.reducedMotion();
    const bankChips = (used: number | undefined) =>
      used === undefined ? 0 : Math.max(0, Math.min(10, Math.ceil((100 - used) / 10)));
    this.bank5h.setTarget(bankChips(snap.plan.fiveHour?.used), now, animate);
    this.bank7d.setTarget(bankChips(snap.plan.sevenDay?.used), now, animate);
    chipsFor(snap.today.costUsd).forEach((n, i) => this.today[i].setTarget(n, now, animate));

    this.costFrom = this.shownCost;
    this.costTo = snap.today.costUsd;
    this.costStart = now;
    if (!animate) this.shownCost = this.costTo;
    this.snap = snap;
  }

  /** Avanza un fotograma. Devuelve `true` si hay que seguir animando. */
  update(now: number): boolean {
    let busy = false;
    for (const s of this.stacks()) busy = s.update(now) || busy;

    if (this.shownCost !== this.costTo) {
      const t = Math.min(1, (now - this.costStart) / 600);
      this.shownCost = t >= 1 ? this.costTo : this.costFrom + (this.costTo - this.costFrom) * (1 - (1 - t) ** 3);
      busy = true;
    }

    // De vez en cuando gira la ficha de arriba de alguna pila.
    if (!this.reducedMotion() && now >= this.nextFlip) {
      if (this.nextFlip !== 0) {
        const candidates = this.stacks()
          .map((s) => s.topRestingChip())
          .filter((c): c is Chip => c !== undefined);
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

  /** Milisegundos hasta el próximo giro, para dormir mientras tanto. */
  msUntilIdleEvent(now: number): number {
    return Math.max(0, this.nextFlip - now);
  }

  private stacks(): Stack[] {
    return [this.bank5h, this.bank7d, ...this.today];
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    ctx.clearRect(0, 0, W, H);
    this.drawPanel(ctx);

    const snap = this.snap;
    const plan = snap?.plan;

    // Cabecera
    drawText(ctx, "CLAUPIER", 6, 5, C.gold);
    const pip =
      plan?.status === "ok" ? C.ok : plan?.status === "loading" || !plan ? C.dim : plan.status === "rate_limited" ? C.warn : C.bad;
    ctx.fillStyle = C.outline;
    ctx.fillRect(89, 5, 5, 5);
    ctx.fillStyle = pip;
    ctx.fillRect(90, 6, 3, 3);
    if (snap?.ghost) this.drawGhost(ctx, 80, 5);
    this.dottedLine(ctx, 13);

    // Banca
    drawText(ctx, "BANCA", 6, 17, C.dim);
    this.bank5h.draw(ctx, now);
    this.bank7d.draw(ctx, now);
    this.drawBankLabel(ctx, 25, "5H", plan?.fiveHour, plan?.status);
    this.drawBankLabel(ctx, 71, "SEM", plan?.sevenDay, plan?.status);
    this.dottedLine(ctx, 67);

    // Hoy
    drawText(ctx, "HOY", 6, 70, C.dim);
    this.today.forEach((s) => {
      const extra = s.count - s.maxVisible;
      if (extra > 0) {
        const label = `+${extra}`;
        drawText(ctx, label, s.x + 8 - Math.floor(textWidth(label) / 2), 69, C.gold);
      }
      s.draw(ctx, now);
    });

    drawText(ctx, formatUsd(this.shownCost), 6, 108, C.gold);
    const tokens = `${formatTokens(snap?.today.totalTokens ?? 0)} TOK`;
    drawText(ctx, tokens, 94 - textWidth(tokens), 108, C.dim);
  }

  private drawBankLabel(
    ctx: CanvasRenderingContext2D,
    x: number,
    name: string,
    win: { used: number; resetsAt?: string | null } | null | undefined,
    status: string | undefined,
  ) {
    drawText(ctx, name, x, 31, C.dim);
    if (!win) {
      const [a, b] = STATUS_TEXT[status ?? "loading"] ?? STATUS_TEXT.loading;
      drawText(ctx, a, x, 40, C.warn);
      if (b) drawText(ctx, b, x, 47, C.warn);
      return;
    }
    const left = Math.max(0, Math.round(100 - win.used));
    const color = left <= 10 ? C.bad : left <= 25 ? C.warn : C.cream;
    drawText(ctx, `${left}%`, x, 40, color);
    const reset = formatReset(win.resetsAt);
    if (reset) drawText(ctx, `@${reset}`, x, 49, C.dim);
  }

  private drawPanel(ctx: CanvasRenderingContext2D) {
    // Contorno, ribete dorado y paño, con esquinas recortadas en escalón.
    const rect = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };
    const rounded = (inset: number, color: string) => {
      const x0 = inset, y0 = inset, x1 = W - inset, y1 = H - inset;
      rect(x0 + 2, y0, x1 - x0 - 4, y1 - y0, color);
      rect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2, color);
      rect(x0, y0 + 2, x1 - x0, y1 - y0 - 4, color);
    };
    rounded(0, C.outline);
    rounded(1, C.trimDark);
    rounded(1, C.trim);
    rect(3, H - 3, W - 6, 1, C.trimDark);
    rounded(2, C.outline);
    rounded(3, C.felt);
    // Textura sutil del paño
    ctx.fillStyle = C.feltDark;
    for (let y = 5; y < H - 4; y += 4) {
      for (let x = 5 + ((y / 4) % 2) * 2; x < W - 4; x += 4) ctx.fillRect(x, y, 1, 1);
    }
  }

  private dottedLine(ctx: CanvasRenderingContext2D, y: number) {
    ctx.fillStyle = C.trimDark;
    for (let x = 5; x < W - 5; x += 2) ctx.fillRect(x, y, 1, 1);
  }

  private drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const g = [".###.", "#####", "#.#.#", "#####", "#.#.#"];
    ctx.fillStyle = C.ghost;
    g.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && ctx.fillRect(x + c, y + r, 1, 1)));
  }
}
