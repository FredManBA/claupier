// Monedas de la tragamonedas.
//
// Hay una moneda por valor, con el color de su ficha: plateada $1, roja $5,
// verde $25, negra $100 y naranja $500. Caen a la bandeja y forman un montón.
// Las posiciones del montón se calculan una vez y siempre igual, así que el
// mismo monto se ve siempre igual y cada moneda nueva cae encima de las demás.

import type { PaletteName } from "./chips";
import { spriteFrom } from "./sprite";

/** Rampa de cada moneda: contorno, brillo, luz, base, cara, sombra y canto. */
type CoinRamp = Record<"o" | "l" | "h" | "b" | "f" | "d" | "e", string>;

const COIN_PALETTES: Partial<Record<PaletteName, CoinRamp>> = {
  white: { o: "#363b44", l: "#ffffff", h: "#eef1f5", b: "#d3d9e1", f: "#b6bdc8", d: "#8f97a5", e: "#6d7583" },
  red: { o: "#3d0a0c", l: "#ffd6cf", h: "#f47b72", b: "#dc4a43", f: "#bd3431", d: "#952420", e: "#701817" },
  green: { o: "#082a14", l: "#d9ffdc", h: "#74db8e", b: "#41b062", f: "#2f904d", d: "#226f3a", e: "#18512b" },
  black: { o: "#08090b", l: "#d0d5dd", h: "#737985", b: "#50555f", f: "#3c4049", d: "#2c2f36", e: "#1e2026" },
  orange: { o: "#4a2306", l: "#fff0b0", h: "#ffc35c", b: "#f39a2e", f: "#d97d1f", d: "#ad5c15", e: "#80410e" },
};

/** Paletas que tienen moneda (las de los cinco valores). */
export type CoinPalette = "white" | "red" | "green" | "black" | "orange";

/** La moneda tumbada, vista en ángulo: así quedan casi todas en el montón. */
const FLAT = ["..oooo..", ".ohlhho.", "ohffffdo", "obbbbbdo", ".oeeeeo.", "..oooo.."];
/** Apoyada de frente (también es el primer cuadro del giro). */
const ROUND = ["..ooo..", ".ohlho.", "ohhfbdo", "ohfffdo", "ohbfbdo", ".obbdo.", "..ooo.."];
/** Girando: de tres cuartos y de canto. */
const TILT = [".ooo.", "ohldo", "ohfdo", "ohfdo", "ohfdo", "ohbdo", ".ooo."];
const EDGE = [".o.", "oho", "oho", "obo", "obo", "oeo", ".o."];

export type CoinPose = "flat" | "round" | "tilt" | "edge";

// Monedas grandes (12 px de ancho), para la bandeja de la tragamonedas.
const FLAT_BIG = ["...oooooo...", ".oohhllhhboo", "ohhlffffffbo", "ohffffffffdo", "obfffffffddo", "oebbbbbbbbeo", ".oeeeeeeeeo.", "...oooooo..."];
const ROUND_BIG = ["...oooo...", ".oohllhbo.", "ohhffffbdo", "ohffbbffdo", "ohfbffbfdo", "ohfbffbfdo", "ohffbbffdo", "obfffffddo", ".obbbbddo.", "...oooo..."];
const TILT_BIG = [".ooooo.", "ohhlbdo", "ohfffdo", "ohfbfdo", "ohfbfdo", "ohfbfdo", "ohfbfdo", "ohfffdo", "ohbbbdo", ".ooooo."];
const EDGE_BIG = [".oo.", "ohdo", "ohdo", "ohdo", "obdo", "obdo", "obeo", "obeo", "oeeo", ".oo."];

export type CoinSize = "small" | "big";

const POSES: Record<CoinSize, Record<CoinPose, string[]>> = {
  small: { flat: FLAT, round: ROUND, tilt: TILT, edge: EDGE },
  big: { flat: FLAT_BIG, round: ROUND_BIG, tilt: TILT_BIG, edge: EDGE_BIG },
};
/** Ancho de la moneda tumbada, que marca la rejilla del montón. */
export const COIN_W: Record<CoinSize, number> = { small: 8, big: 12 };
const coinCache = new Map<string, HTMLCanvasElement>();

export function coinSprite(pose: CoinPose, palette: CoinPalette = "orange", size: CoinSize = "small"): HTMLCanvasElement {
  const key = `${size}:${palette}:${pose}`;
  let s = coinCache.get(key);
  if (!s) {
    s = spriteFrom(POSES[size][pose], COIN_PALETTES[palette]!);
    coinCache.set(key, s);
  }
  return s;
}

/** Cuadros del giro de una moneda que cae. */
export const SPIN: CoinPose[] = ["round", "tilt", "edge", "tilt"];

// ── El montón ─────────────────────────────────────────────────────────────

export interface CoinSpot {
  x: number;
  /** y del borde superior del sprite. */
  y: number;
  pose: CoinPose;
}

/** Generador pseudoaleatorio con semilla, para que el montón no cambie. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Coloca `count` monedas en una bandeja de `width` × `floor` píxeles soltándolas
 * cerca de `dropX`. Funciona como un montón de arena: la bandeja se divide en
 * columnas de 4 px; cada moneda se centra en una y rueda hacia el lado más bajo
 * mientras el vecino esté bastante más abajo (dos o tres capas, al azar, para
 * que el montón no salga demasiado regular). Cada capa sube 2 px.
 */
/** `flat`: todas tumbadas (la tragamonedas); si no, algunas quedan de canto. */
export function layoutHeap(
  count: number,
  width: number,
  floor: number,
  dropX: number,
  size: CoinSize = "small",
  flat = false,
): CoinSpot[] {
  const FULL = COIN_W[size];
  const COL = FULL / 2;
  const RISE = size === "big" ? 3 : 2;
  const rnd = seeded(7);
  const cols = Math.floor((width - 8) / COL) + 1;
  const h = new Array<number>(cols).fill(0);
  const spots: CoinSpot[] = [];
  const center = Math.round((dropX - COL) / COL);
  for (let i = 0; i < count; i++) {
    const roll = rnd();
    const pose: CoinPose = flat ? "flat" : roll < 0.07 ? "round" : roll < 0.12 ? "tilt" : "flat";
    let c = Math.max(0, Math.min(cols - 1, center + Math.round((rnd() - 0.5) * 2.4)));
    for (let step = 0; step < 60; step++) {
      const left = c > 0 ? h[c - 1] : Infinity;
      const right = c < cols - 1 ? h[c + 1] : Infinity;
      const lowest = Math.min(left, right);
      const limit = rnd() < 0.5 ? 2 : 3;
      if (lowest > h[c] - limit) break;
      c = left < right || (left === right && rnd() < 0.5) ? c - 1 : c + 1;
    }
    const layer = h[c]++;
    const sprite = POSES[size][pose];
    const jitter = Math.round((rnd() - 0.5) * 2);
    const x = Math.max(0, Math.min(width - sprite[0].length, c * COL + jitter + Math.floor((FULL - sprite[0].length) / 2)));
    // Se hunde un poco entre las de abajo (en el suelo, no).
    const sink = layer === 0 ? 0 : (pose === "flat" ? 2 : 3) + (size === "big" ? 1 : 0);
    spots.push({ x, y: floor - layer * RISE - sprite.length + sink, pose });
  }
  return spots;
}
