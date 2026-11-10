// Pixel art de Claupier: fuente de 3×5, sprites de fichas y paletas.
// Todo se dibuja a resolución baja y luego se escala con píxeles enteros.

const GLYPHS: Record<string, string[]> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", ".##", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  // 7 filas: el palito sobresale una fila arriba y otra abajo.
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "%": ["#..", "..#", ".#.", "#..", "..#"],
  ".": ["...", "...", "...", "...", ".#."],
  ",": ["...", "...", "...", ".#.", "#.."],
  ":": ["...", ".#.", "...", ".#.", "..."],
  "-": ["...", "...", "###", "...", "..."],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  "+": ["...", ".#.", "###", ".#.", "..."],
  "@": [".###.", "#.#.#", "#.###", "#...#", ".###."], // reloj
  " ": ["...", "...", "...", "...", "..."],
};

function glyph(ch: string): string[] {
  return GLYPHS[ch] ?? GLYPHS[" "];
}

export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text.toUpperCase()) w += glyph(ch)[0].length + 1;
  return Math.max(0, w - 1);
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  for (const ch of text.toUpperCase()) {
    const g = glyph(ch);
    const top = Math.round(y) - (g.length - 5) / 2;
    for (let row = 0; row < g.length; row++) {
      const line = g[row];
      for (let col = 0; col < line.length; col++) {
        if (line[col] === "#") ctx.fillRect(cx + col, top + row, 1, 1);
      }
    }
    cx += g[0].length + 1;
  }
}

// ── Fichas ────────────────────────────────────────────────────────────────
// o contorno · b base · s marcas del borde · i centro · l brillo
// e canto · d sombra del canto
export const CHIP_W = 16;
export const CHIP_H = 9;
/** Altura que suma cada ficha a la pila. */
export const CHIP_STEP = 3;

const CHIP: string[] = [
  "....oooooooo....",
  "..oobbsbbsbboo..",
  ".obsbiiiiiibsbo.",
  "obbbiilliiiibbbo",
  "obsbbiiiiiibbsbo",
  "oebbbbsbbsbbbbeo",
  "oseeesseeesseeso",
  ".oddddddddddddo.",
  "...oooooooooo...",
];

const SLOT: string[] = [
  "....xxxxxxxx....",
  "..xxxxxxxxxxxx..",
  ".xxxxxxxxxxxxxx.",
  ".xxxxxxxxxxxxxx.",
  "..xxxxxxxxxxxx..",
  "....xxxxxxxx....",
];

export interface ChipPalette {
  o: string;
  b: string;
  s: string;
  i: string;
  l: string;
  e: string;
  d: string;
}

const OUTLINE = "#14101c";

export const PALETTES = {
  white: { o: OUTLINE, b: "#e6dfcf", s: "#4f7fc4", i: "#f4efe2", l: "#fbf8f0", e: "#c4bba6", d: "#8b8270" },
  red: { o: OUTLINE, b: "#c9383e", s: "#f1e6d2", i: "#de5d63", l: "#ea7a7f", e: "#9a252b", d: "#6a191f" },
  green: { o: OUTLINE, b: "#2f9a52", s: "#f1e6d2", i: "#4fb771", l: "#6fd08f", e: "#216f3d", d: "#154a29" },
  black: { o: "#08070b", b: "#35333f", s: "#e6dfcf", i: "#4b4958", l: "#64627a", e: "#25232d", d: "#17161c" },
  orange: { o: OUTLINE, b: "#f28a1e", s: "#fff0cf", i: "#ffac4f", l: "#ffc477", e: "#c3640b", d: "#874405" },
  bank: { o: OUTLINE, b: "#3c7fd0", s: "#f1e6d2", i: "#5f9de3", l: "#86b8ef", e: "#2a5d9f", d: "#1b3f70" },
} satisfies Record<string, ChipPalette>;

export type PaletteName = keyof typeof PALETTES;

function spriteFrom(map: string[], colors: Record<string, string>): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = map[0].length;
  c.height = map.length;
  const ctx = c.getContext("2d")!;
  map.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = colors[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return c;
}

export interface ChipSprites {
  face: HTMLCanvasElement;
  /** La ficha vista de canto, para el centro del giro. */
  edge: HTMLCanvasElement;
}

const cache = new Map<string, ChipSprites>();

export function chipSprites(name: PaletteName): ChipSprites {
  const hit = cache.get(name);
  if (hit) return hit;
  const p: ChipPalette = PALETTES[name];
  const face = spriteFrom(CHIP, { ...p });
  const edge = spriteFrom(CHIP, { o: p.o, b: p.e, s: p.s, i: p.e, l: p.b, e: p.d, d: p.d });
  const sprites = { face, edge };
  cache.set(name, sprites);
  return sprites;
}

let slotSprite: HTMLCanvasElement | null = null;
export function slot(color: string): HTMLCanvasElement {
  slotSprite ??= spriteFrom(SLOT, { x: color });
  return slotSprite;
}

/**
 * Dibuja una ficha. `scaleX` (0–1) la estrecha horizontalmente para el giro,
 * muestreando columnas del sprite para conservar los píxeles nítidos.
 */
export function drawChip(
  ctx: CanvasRenderingContext2D,
  sprites: ChipSprites,
  x: number,
  y: number,
  scaleX = 1,
) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (scaleX >= 0.999) {
    ctx.drawImage(sprites.face, px, py);
    return;
  }
  const src = scaleX < 0.34 ? sprites.edge : sprites.face;
  const w = Math.max(2, Math.round(CHIP_W * scaleX));
  const off = Math.floor((CHIP_W - w) / 2);
  for (let c = 0; c < w; c++) {
    const sc = Math.min(CHIP_W - 1, Math.floor(((c + 0.5) / w) * CHIP_W));
    ctx.drawImage(src, sc, 0, 1, CHIP_H, px + off + c, py, 1, CHIP_H);
  }
}
