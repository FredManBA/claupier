// Fichas de casino en pixel art. Se ven desde arriba en ángulo: cara elíptica
// con el canto debajo. Luz de arriba a la izquierda.
//
// Letras de los mapas:
//   o contorno · b borde de la cara · h brillo del borde · s marca del borde
//   r anillo · i centro · l brillo del centro
//   e canto · t marca en el canto · d sombra del canto

import { spriteFrom } from "./sprite";

export type ChipSize = "big" | "mini";

/** Ficha grande (18×11): seis marcas en el borde y tres en el canto. */
const BIG: string[] = [
  ".....oooooooo.....",
  "..ooohhhssbbbooo..",
  ".osshhrrrrrrbbsso.",
  "ohhhrlliiiiiirbbbo",
  "ohhriiiiiiiiiirbbo",
  "obssriiiiiiiirssbo",
  "oebbbbrrrrrrbbbbeo",
  "oettebbbssbbbetteo",
  ".otteeeetteeeetto.",
  "..ooodddttdddooo..",
  ".....oooooooo.....",
];

/** Ficha mini (11×7) para la píldora. */
const MINI: string[] = [
  "...ooooo...",
  ".oobbsbboo.",
  "osbhlibbbso",
  "obbiiiiibbo",
  "oebbbsbbbeo",
  ".oteeteeto.",
  "..ooooooo..",
];

export const CHIP_DIMS: Record<ChipSize, { w: number; h: number; step: number }> = {
  big: { w: 18, h: 11, step: 3 },
  mini: { w: 11, h: 7, step: 2 },
};

export interface ChipPalette {
  o: string;
  b: string;
  h: string;
  s: string;
  r: string;
  i: string;
  l: string;
  e: string;
  t: string;
  d: string;
}

export const PALETTES = {
  white: {
    o: "#2a2733", b: "#e4dcc7", h: "#f3ecdc", s: "#3d6cb4", r: "#c3b89e",
    i: "#efe8d8", l: "#fbf6ea", e: "#b5aa90", t: "#2c5291", d: "#857b66",
  },
  red: {
    o: "#3a0e16", b: "#c8363d", h: "#dc5254", s: "#f1e8d6", r: "#9c2430",
    i: "#df5a5c", l: "#ef8a84", e: "#962230", t: "#c4b7a0", d: "#661520",
  },
  green: {
    o: "#0c2a1c", b: "#2c9653", h: "#45af68", s: "#f1e8d6", r: "#1d6e41",
    i: "#4cb76f", l: "#82d29a", e: "#1d6c40", t: "#c4b7a0", d: "#144a2e",
  },
  black: {
    o: "#08070b", b: "#3a3845", h: "#4d4a5b", s: "#ece3cf", r: "#25232c",
    i: "#4b4859", l: "#6b6881", e: "#28262f", t: "#b3a994", d: "#18171d",
  },
  // La ficha más cara: marcas, anillo y centro dorados.
  orange: {
    o: "#3a1b05", b: "#ee861b", h: "#ffa53c", s: "#ffe28a", r: "#ffd35e",
    i: "#ffbb42", l: "#ffdf8c", e: "#bc5f0a", t: "#d6a13a", d: "#864106",
  },
  bank: {
    o: "#0d1d38", b: "#3b7dce", h: "#5896de", s: "#f1e8d6", r: "#2b5d9f",
    i: "#62a0e5", l: "#93c1f2", e: "#2a5b9b", t: "#c4b7a0", d: "#1a3d6c",
  },
  // La banca semanal de la mesa: morada, para no confundirla con la de 5 h.
  week: {
    o: "#1f0f33", b: "#7e4fc4", h: "#9667d6", s: "#f1e8d6", r: "#5e3a99",
    i: "#9f72de", l: "#c3a2ef", e: "#5b3895", t: "#c4b7a0", d: "#3b2366",
  },
  bankWarn: {
    o: "#3a2506", b: "#d6972a", h: "#e9b049", s: "#fff0cf", r: "#a9741c",
    i: "#eeba56", l: "#f8d58c", e: "#a5701a", t: "#d3bf98", d: "#6c4810",
  },
  bankBad: {
    o: "#3a1010", b: "#c6443a", h: "#da6157", s: "#f3e6d2", r: "#982f28",
    i: "#de695f", l: "#ee988e", e: "#932e27", t: "#c7b6a0", d: "#621d19",
  },
} satisfies Record<string, ChipPalette>;

export type PaletteName = keyof typeof PALETTES;

export interface ChipSprites {
  face: HTMLCanvasElement;
  /** La ficha casi de canto, para el centro del giro. */
  edge: HTMLCanvasElement;
  w: number;
  h: number;
}

const cache = new Map<string, ChipSprites>();

export function chipSprites(name: PaletteName, size: ChipSize = "big"): ChipSprites {
  const key = `${name}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p: ChipPalette = PALETTES[name];
  const map = size === "big" ? BIG : MINI;
  const face = spriteFrom(map, { ...p });
  // De canto solo se ve el canto: la cara se pinta con sus colores.
  const edge = spriteFrom(map, { ...p, b: p.e, h: p.e, i: p.e, l: p.e, r: p.d, s: p.t });
  const sprites = { face, edge, w: map[0].length, h: map.length };
  cache.set(key, sprites);
  return sprites;
}

/**
 * Dibuja una ficha. `scaleX` (0–1) la estrecha horizontalmente para el giro,
 * muestreando columnas del sprite para conservar los píxeles nítidos.
 */
export function drawChip(g: CanvasRenderingContext2D, sprites: ChipSprites, x: number, y: number, scaleX = 1) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (scaleX >= 0.999) {
    g.drawImage(sprites.face, px, py);
    return;
  }
  const src = scaleX < 0.34 ? sprites.edge : sprites.face;
  const w = Math.max(2, Math.round(sprites.w * scaleX));
  const off = Math.floor((sprites.w - w) / 2);
  for (let c = 0; c < w; c++) {
    const sc = Math.min(sprites.w - 1, Math.floor(((c + 0.5) / w) * sprites.w));
    g.drawImage(src, sc, 0, 1, sprites.h, px + off + c, py, 1, sprites.h);
  }
}
