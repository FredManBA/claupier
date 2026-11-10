// Pilas de fichas animadas (mesa) y el cambio de dinero a fichas.

import { CHIP_DIMS, type ChipSize, type PaletteName, chipSprites, drawChip } from "./chips";
import { shadow } from "./paint";
import type { Motion } from "./types";

export const DENOMS: { value: number; palette: PaletteName; label: string }[] = [
  { value: 1, palette: "white", label: "1" },
  { value: 5, palette: "red", label: "5" },
  { value: 25, palette: "green", label: "25" },
  { value: 100, palette: "black", label: "100" },
  { value: 500, palette: "orange", label: "500" },
];

/** Cambio de un monto en dólares a fichas, de la más cara a la más barata. */
export function chipsFor(costUsd: number): number[] {
  let rest = Math.floor(Math.max(0, costUsd));
  return [...DENOMS]
    .reverse()
    .map((d) => {
      const n = Math.floor(rest / d.value);
      rest -= n * d.value;
      return n;
    })
    .reverse();
}

const DROP_MS = 240;
const SETTLE_MS = 110;
const POP_MS = 240;
const FADE_MS = 200;
const FLIP_MS = 520;

interface Chip {
  state: "drop" | "fade" | "rest" | "pop";
  start: number;
  landed?: boolean;
  flipStart?: number;
}

export class Stack {
  chips: Chip[] = [];
  /** Se llama cuando una ficha toca la pila (para el sonido). */
  onLand: (() => void) | null = null;

  constructor(
    public x: number,
    public base: number,
    public palette: PaletteName,
    public maxVisible: number,
    public size: ChipSize = "big",
  ) {}

  /** Número de fichas que la pila tendrá al terminar las animaciones. */
  get count() {
    return this.chips.filter((c) => c.state !== "pop").length;
  }

  /**
   * - `full`: las fichas caen y se asientan; las que se van suben y se desvanecen.
   * - `reduced`: aparecen y desaparecen en su sitio, sin moverse.
   * - `off`: cambian al instante.
   */
  setTarget(n: number, now: number, motion: Motion | "instant") {
    this.chips = this.chips.filter((c) => c.state !== "pop");
    const current = this.chips.length;
    if (motion === "off" || motion === "instant") {
      this.chips = Array.from({ length: n }, () => ({ state: "rest" as const, start: now }));
      return;
    }
    if (n > current) {
      for (let i = current; i < n; i++) {
        const visible = i < this.maxVisible;
        const delay = visible ? (i - current) * 80 : 0;
        const state = !visible ? "rest" : motion === "full" ? "drop" : "fade";
        this.chips.push({ state, start: now + delay });
      }
    } else if (n < current) {
      for (let i = current - 1, j = 0; i >= n; i--, j++) {
        this.chips[i] = { state: "pop", start: now + Math.min(j, 6) * 60 };
      }
    }
  }

  /** Avanza las animaciones. Devuelve `true` si sigue habiendo movimiento. */
  update(now: number): boolean {
    let busy = false;
    for (const c of this.chips) {
      if (c.state === "drop") {
        if (!c.landed && now - c.start >= DROP_MS) {
          c.landed = true;
          this.onLand?.();
        }
        if (now - c.start >= DROP_MS + SETTLE_MS) c.state = "rest";
        else busy = true;
      } else if (c.state === "fade") {
        if (now - c.start >= FADE_MS) c.state = "rest";
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

  /** Y del borde superior de la ficha en la posición `i` (0 = abajo). */
  chipY(i: number) {
    const d = CHIP_DIMS[this.size];
    return this.base - d.h - i * d.step;
  }

  draw(g: CanvasRenderingContext2D, now: number, palette: PaletteName = this.palette) {
    const d = CHIP_DIMS[this.size];
    const sprites = chipSprites(palette, this.size);
    const visible = this.chips.slice(0, this.maxVisible);
    if (visible.some((c) => c.state === "rest" || now >= c.start)) {
      shadow(g, this.x + d.w / 2 + 1, this.base - 2, d.w + 2, 5, 0.3);
    }
    const fall = this.size === "big" ? 26 : 12;
    visible.forEach((c, i) => {
      if ((c.state === "drop" || c.state === "fade") && now < c.start) return; // aún no entra
      let y = this.chipY(i);
      let alpha = 1;
      let scaleX = 1;
      if (c.state === "drop") {
        const t = (now - c.start) / DROP_MS;
        // Cae con gravedad y, al tocar, se hunde 1 px y vuelve.
        if (t < 1) y -= Math.round((1 - t * t) * fall);
        else if (now - c.start < DROP_MS + SETTLE_MS / 2) y += 1;
      } else if (c.state === "fade") {
        const t = (now - c.start) / FADE_MS;
        alpha = t < 0.34 ? 0.3 : t < 0.67 ? 0.6 : 1;
      } else if (c.state === "pop" && now >= c.start) {
        const t = Math.min(1, (now - c.start) / POP_MS);
        y -= Math.round(t * 5);
        alpha = t < 0.34 ? 1 : t < 0.67 ? 0.6 : 0.3;
      }
      if (c.flipStart !== undefined) {
        const t = Math.min(1, (now - c.flipStart) / FLIP_MS);
        scaleX = Math.abs(Math.cos(t * Math.PI));
      }
      g.globalAlpha = alpha;
      drawChip(g, sprites, this.x, y, scaleX);
      g.globalAlpha = 1;
    });
  }
}
