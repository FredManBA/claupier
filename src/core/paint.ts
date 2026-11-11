// Materiales compartidos por los diseños: paño, madera, latón, pilotos de
// estado y el fantasma. Lo que no cambia se dibuja una vez en una capa.

import type { PlanStatus } from "./types";

export type G = CanvasRenderingContext2D;

export function rect(g: G, x: number, y: number, w: number, h: number, color: string) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

/** Rectángulo con esquinas en escalón de `r` píxeles (0–3). */
export function rounded(g: G, x: number, y: number, w: number, h: number, color: string, r = 2) {
  g.fillStyle = color;
  if (r <= 0) return void g.fillRect(x, y, w, h);
  if (r === 1) {
    g.fillRect(x + 1, y, w - 2, h);
    g.fillRect(x, y + 1, w, h - 2);
    return;
  }
  if (r === 2) {
    g.fillRect(x + 2, y, w - 4, h);
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillRect(x, y + 2, w, h - 4);
    return;
  }
  g.fillRect(x + 3, y, w - 6, h);
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillRect(x, y + 3, w, h - 6);
}

/** Ruido fijo por píxel (0–1), para texturas que no cambian. */
export function hash(x: number, y: number) {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface FeltColors {
  base: string;
  dark: string;
  light: string;
  /** La franja de sombra junto a la baranda. */
  edge: string;
}

/**
 * Paño con fibras sueltas y una sombra suave junto al borde, como si la
 * baranda le hiciera sombra. Sin brillos ni movimiento.
 */
export function drawFelt(g: G, x: number, y: number, w: number, h: number, c: FeltColors) {
  rect(g, x, y, w, h, c.base);
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const n = hash(px, py);
      if (n < 0.05) rect(g, px, py, 1, 1, c.light);
      else if (n > 0.93) rect(g, px, py, 1, 1, c.dark);
    }
  }
  // Sombra interior: una fila llena y otra a cuadros.
  g.fillStyle = c.edge;
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillRect(x + w - 1, y, 1, h);
  for (let px = x + 1; px < x + w - 1; px += 2) g.fillRect(px, y + 1, 1, 1);
  for (let py = y + 2; py < y + h; py += 2) {
    g.fillRect(x + 1, py, 1, 1);
    g.fillRect(x + w - 2, py + 1, 1, 1);
  }
}

export interface WoodColors {
  ink: string;
  dark: string;
  base: string;
  light: string;
  shine: string;
}

/** Marco de madera con esquinas redondeadas: borde, brillo arriba, sombra abajo. */
export function drawWoodFrame(g: G, w: number, h: number, c: WoodColors, thick = 3) {
  rounded(g, 0, 0, w, h, c.ink, 3);
  rounded(g, 1, 1, w - 2, h - 2, c.base, 3);
  // Luz arriba a la izquierda y sombra abajo a la derecha.
  rect(g, 4, 1, w - 8, 1, c.shine);
  rect(g, 2, 2, w - 4, 1, c.light);
  rect(g, 1, 4, 1, h - 8, c.light);
  rect(g, 3, h - 2, w - 6, 1, c.dark);
  rect(g, w - 2, 4, 1, h - 8, c.dark);
  // Vetas
  g.fillStyle = c.dark;
  for (let i = 0; i < w; i += 1) {
    const n = hash(i, 911);
    if (n < 0.12 && i > 4 && i < w - 6) g.fillRect(i, 2 + (n < 0.06 ? 1 : 0), 2, 1);
  }
  rounded(g, thick + 1, thick + 1, w - (thick + 1) * 2, h - (thick + 1) * 2, c.ink, 2);
}

export interface BrassColors {
  ink: string;
  dark: string;
  base: string;
  light: string;
  shine: string;
}

export const BRASS: BrassColors = {
  ink: "#1c1206",
  dark: "#7a5418",
  base: "#bf8d34",
  light: "#d9ab4d",
  shine: "#f2cd6e",
};

// ── Piloto de estado ──────────────────────────────────────────────────────

/** Degradado dorado del letrero «CLAUPIER», de arriba abajo. */
export const LOGO_GRADIENT = ["#ffe9a8", "#ffd873", "#f7c35a", "#efb04c", "#e09c3e", "#cc8733", "#b47228"];

/** Colores del piloto (oscuro, medio, brillo) para cada estado. */
export const LED: Record<"ok" | "wait" | "bad" | "idle", [string, string, string]> = {
  ok: ["#2f9a52", "#5fdc86", "#c4f7d2"],
  wait: ["#a06818", "#f0a24a", "#ffd9a6"],
  bad: ["#9a2e28", "#e5604f", "#ffb4a8"],
  idle: ["#3c4a44", "#6f8279", "#a9b8b1"],
};

export function ledKind(status: PlanStatus | undefined): keyof typeof LED {
  if (status === "ok") return "ok";
  if (!status || status === "loading") return "idle";
  if (status === "rate_limited") return "wait";
  return "bad";
}

/** Piloto redondo de 5×5. */
export function drawLed(g: G, x: number, y: number, status: PlanStatus | undefined, ink = "#0b0d10") {
  const [dark, mid, light] = LED[ledKind(status)];
  rect(g, x + 1, y, 3, 5, ink);
  rect(g, x, y + 1, 5, 3, ink);
  rect(g, x + 1, y + 1, 3, 3, mid);
  rect(g, x + 3, y + 2, 1, 2, dark);
  rect(g, x + 2, y + 3, 1, 1, dark);
  rect(g, x + 1, y + 1, 1, 1, light);
}

/** Fantasma del modo fantasma, de 5×6. */
export function drawGhost(g: G, x: number, y: number, color = "#cfe3ff", shade = "#8fa9cf") {
  const rows = [".###.", "#####", "#.#.#", "#####", "#####", "#.#.#"];
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch !== "#") return;
      rect(g, x + c, y + r, 1, 1, r >= 4 || c === 4 ? shade : color);
    }),
  );
}

/** Sombra suave en el suelo (una elipse sin bordes duros). */
export function shadow(g: G, cx: number, cy: number, w: number, h: number, alpha = 0.28) {
  g.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  const a = w / 2;
  const b = h / 2;
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5 - b) / b;
    const half = Math.round(a * Math.sqrt(Math.max(0, 1 - dy * dy)));
    if (half > 0) g.fillRect(Math.round(cx - half), Math.round(cy - b + y), half * 2, 1);
  }
}

// ── Capas fijas ───────────────────────────────────────────────────────────

const layers = new Map<string, HTMLCanvasElement>();

/** Dibuja una vez lo que no cambia y lo reutiliza en cada cuadro. */
export function layer(key: string, w: number, h: number, draw: (g: G) => void): HTMLCanvasElement {
  let c = layers.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!);
    layers.set(key, c);
  }
  return c;
}
