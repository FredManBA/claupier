// Monedas y bolsas de la tragamonedas.
//
// Cada moneda vale $1. Caen a la bandeja y forman un montón que solo crece;
// al llegar a 100, el montón se embolsa y vuelve a empezar. Las posiciones del
// montón se calculan una vez y siempre igual, así que el mismo monto se ve
// siempre igual y cada moneda nueva cae encima de las anteriores.

import { spriteFrom } from "./sprite";

export const COINS_PER_BAG = 100;

const GOLD = {
  o: "#4a2a08",
  l: "#fff0b0",
  h: "#f7cf63",
  b: "#e0a43a",
  f: "#c98a2a",
  d: "#a8691c",
  e: "#8a5414",
};

/** La moneda tumbada, vista en ángulo: así quedan casi todas en el montón. */
const FLAT = ["..oooo..", ".ohlhho.", "ohffffdo", "obbbbbdo", ".oeeeeo.", "..oooo.."];
/** Apoyada de frente (también es el primer cuadro del giro). */
const ROUND = ["..ooo..", ".ohlho.", "ohhfbdo", "ohfffdo", "ohbfbdo", ".obbdo.", "..ooo.."];
/** Girando: de tres cuartos y de canto. */
const TILT = [".ooo.", "ohldo", "ohfdo", "ohfdo", "ohfdo", "ohbdo", ".ooo."];
const EDGE = [".o.", "oho", "oho", "obo", "obo", "oeo", ".o."];

export type CoinPose = "flat" | "round" | "tilt" | "edge";

const POSES: Record<CoinPose, string[]> = { flat: FLAT, round: ROUND, tilt: TILT, edge: EDGE };
const coinCache = new Map<CoinPose, HTMLCanvasElement>();

export function coinSprite(pose: CoinPose): HTMLCanvasElement {
  let s = coinCache.get(pose);
  if (!s) {
    s = spriteFrom(POSES[pose], GOLD);
    coinCache.set(pose, s);
  }
  return s;
}

/** Cuadros del giro de una moneda que cae. */
export const SPIN: CoinPose[] = ["round", "tilt", "edge", "tilt"];

// ── Bolsa de $100 ─────────────────────────────────────────────────────────

const SACK = { o: "#3b2412", S: "#c9a26b", L: "#e3c28c", D: "#9c774a", R: "#7a4e22", P: "#5a3a1a" };
const BAG = [
  "..o....o..",
  "..oo..oo..",
  "...oRRo...",
  "...oSSo...",
  "..oLSSSo..",
  ".oLLSPSDo.",
  "oLLSPPPSDo",
  "oLSSPSSSDo",
  "oLSSPPPSDo",
  "oLSSSSPSDo",
  ".oSSPPPDo.",
  "..ooSPoo..",
  "....oo....",
];
export const BAG_W = 10;
export const BAG_H = 13;

let bagCache: HTMLCanvasElement | null = null;
export function bagSprite(): HTMLCanvasElement {
  return (bagCache ??= spriteFrom(BAG, SACK));
}

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
export function layoutHeap(count: number, width: number, floor: number, dropX: number): CoinSpot[] {
  const COL = 4;
  const RISE = 2;
  const rnd = seeded(7);
  const cols = Math.floor((width - 8) / COL) + 1;
  const h = new Array<number>(cols).fill(0);
  const spots: CoinSpot[] = [];
  const center = Math.round((dropX - 4) / COL);
  for (let i = 0; i < count; i++) {
    const roll = rnd();
    const pose: CoinPose = roll < 0.07 ? "round" : roll < 0.12 ? "tilt" : "flat";
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
    const sprite = POSES[pose];
    const jitter = Math.round((rnd() - 0.5) * 2);
    const x = Math.max(0, Math.min(width - sprite[0].length, c * COL + jitter + Math.floor((8 - sprite[0].length) / 2)));
    // Se hunde un poco entre las de abajo (en el suelo, no).
    const sink = layer === 0 ? 0 : pose === "flat" ? 2 : 3;
    spots.push({ x, y: floor - layer * RISE - sprite.length + sink, pose });
  }
  return spots;
}
