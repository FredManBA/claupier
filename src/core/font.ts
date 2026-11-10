// Fuentes de Claupier.
//   small: 5 filas, proporcional (casi todo mide 3 de ancho; M y W, 5).
//   big:   7 filas, para cifras grandes y el logotipo.
// Los glifos más altos que la fila (el $ de la chica) se centran en vertical.
// Las letras van en mayúscula salvo las que tienen glifo propio en minúscula
// (d, h y m, para que «2h 17m» se lea mejor).
//
// Con el texto «normal» (setTextStyle("smooth")), el texto de los datos no se
// dibuja en píxeles: se apunta y la vista lo pinta después a resolución real
// con una fuente del sistema. El logotipo y los letreros de las capas fijas
// siguen en pixel.

export type Font = "small" | "big";
export type TextStyle = "pixel" | "smooth";

const SMALL: Record<string, string[]> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", ".##", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", "..#", ".#.", ".#."],
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
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  // 7 filas: el palito sobresale una fila arriba y otra abajo.
  $: [".#.", "###", "#..", "###", "..#", "###", ".#."],
  "₡": [".###.", "#.#.#", "#.#..", "#.#.#", ".###."],
  "%": ["#..", "..#", ".#.", "#..", "..#"],
  ".": [".", ".", ".", ".", "#"],
  ",": ["..", "..", "..", ".#", "#."],
  ":": [".", "#", ".", "#", "."],
  "-": ["...", "...", "###", "...", "..."],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  "+": ["...", ".#.", "###", ".#.", "..."],
  "×": ["...", "#.#", ".#.", "#.#", "..."],
  "@": [".###.", "#.#.#", "#.###", "#...#", ".###."], // reloj
  " ": ["..", "..", "..", "..", ".."],
  // Unidades de tiempo en minúscula.
  d: ["..#", "..#", ".##", "#.#", ".##"],
  h: ["#..", "#..", "##.", "#.#", "#.#"],
  m: [".....", ".....", "####.", "#.#.#", "#.#.#"],
  // 7 filas con la última vacía: la tilde queda una fila por encima.
  Ó: ["..#", ".#.", "#.#", "#.#", "#.#", ".#.", "..."],
  // Monedas
  "€": [".###", "#...", "###.", "#...", ".###"],
  "£": [".##", "#..", "##.", "#..", "###"],
  "¥": ["#.#", ".#.", "###", ".#.", ".#."],
  "₩": ["#...#", "#.#.#", "#####", "#.#.#", ".#.#."],
  "₹": ["###", "..#", "###", "##.", "..#"],
  "₱": ["##.", "###", "##.", "#..", "#.."],
  "₽": ["##.", "#.#", "##.", "###", "#.."],
  "₦": ["#..#", "####", "#.##", "####", "#..#"],
};

const BIG: Record<string, string[]> = {
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", "..#..", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".###.", "#...#", "#....", ".###.", "....#", "#...#", ".###."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  // 9 filas: el palito sobresale una fila arriba y otra abajo.
  $: ["..#..", ".####", "#.#..", "#.#..", ".###.", "..#.#", "..#.#", "####.", "..#.."],
  "₡": ["..#.#", ".####", "#.#.#", "#.#..", "#.#..", "#.#.#", ".####", "..#.#", "....."],
  "%": ["##...", "##..#", "...#.", "..#..", ".#...", "#..##", "...##"],
  ".": ["..", "..", "..", "..", "..", "##", "##"],
  ",": ["..", "..", "..", "..", "..", ".#", "#."],
  "-": ["...", "...", "...", "###", "...", "...", "..."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
  " ": ["..", "..", "..", "..", "..", "..", ".."],
  // 9 filas con la última vacía: la tilde queda una fila por encima.
  Ó: ["...#.", ".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###.", "....."],
  // Monedas
  "€": ["..###", ".#...", "####.", ".#...", "####.", ".#...", "..###"],
  "£": ["..##.", ".#..#", ".#...", "####.", ".#...", ".#...", "#####"],
  "¥": ["#...#", ".#.#.", "..#..", "#####", "..#..", "#####", "..#.."],
  "₩": ["#...#", "#...#", "#####", "#.#.#", "#####", "##.##", "#...#"],
  "₹": ["#####", "...#.", "#####", "...#.", "###..", "..#..", "...##"],
  "₱": ["####.", "#...#", "#####", "#...#", "#####", "#....", "#...."],
  "₽": ["####.", "#...#", "#...#", "####.", "####.", "#....", "#...."],
  "₦": ["#...#", "##..#", "#####", "#.#.#", "#####", "#..##", "#...#"],
};

const FONTS: Record<Font, { glyphs: Record<string, string[]>; rows: number; gap: number }> = {
  small: { glyphs: SMALL, rows: 5, gap: 1 },
  big: { glyphs: BIG, rows: 7, gap: 1 },
};

/** Caracteres que la fuente pixel sabe dibujar (para avisar en los ajustes). */
export function pixelSupports(ch: string): boolean {
  return ch in SMALL || ch.toUpperCase() in SMALL;
}

function glyph(font: Font, ch: string): string[] {
  const set = FONTS[font].glyphs;
  return set[ch] ?? set[ch.toUpperCase()] ?? set[" "];
}

// ── Texto normal ─────────────────────────────────────────────────────────

let style: TextStyle = "pixel";

/** Pixel o normal, para todas las vistas. */
export function setTextStyle(next: TextStyle) {
  style = next;
}

/** Fuente del sistema para el texto normal: clara y con cifras de ancho fijo. */
const SMOOTH_FAMILY = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
const SMOOTH_WEIGHT: Record<Font, number> = { small: 600, big: 700 };

let measurer: CanvasRenderingContext2D | null = null;
let capRatio = 0;

/** Altura de las mayúsculas respecto al tamaño de la fuente (≈0,7). */
function capHeightRatio(): number {
  if (capRatio) return capRatio;
  const g = measureCtx();
  g.font = `${SMOOTH_WEIGHT.big} 100px ${SMOOTH_FAMILY}`;
  const m = g.measureText("H");
  capRatio = m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent / 100 : 0.7;
  return capRatio;
}

function measureCtx(): CanvasRenderingContext2D {
  measurer ??= document.createElement("canvas").getContext("2d")!;
  return measurer;
}

/** CSS de la fuente normal para un tamaño de letra pixel, en píxeles lógicos × `k`. */
export function smoothFont(font: Font, k: number): string {
  const size = (FONTS[font].rows / capHeightRatio()) * k;
  return `${SMOOTH_WEIGHT[font]} ${size}px ${SMOOTH_FAMILY}`;
}

/** El reloj de la fuente pixel, en texto normal. */
const smoothText = (text: string) => text.replace(/@/g, "◷ ");

/** Un texto apuntado para pintarlo después a resolución real. */
export interface TextCommand {
  text: string;
  x: number;
  y: number;
  color: string | string[];
  font: Font;
  shadow?: string;
  outline?: string;
  alpha: number;
  clip?: Rect;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let capture: { g: CanvasRenderingContext2D; list: TextCommand[] } | null = null;

/** A partir de aquí, el texto normal dibujado en `g` se apunta en vez de pintarse. */
export function beginTextCapture(g: CanvasRenderingContext2D): TextCommand[] {
  const list: TextCommand[] = [];
  capture = style === "smooth" ? { g, list } : null;
  return list;
}

export function endTextCapture() {
  capture = null;
}

/** Pinta los textos apuntados en el canvas final, con `k` píxeles por píxel lógico. */
export function paintTextCommands(g: CanvasRenderingContext2D, list: TextCommand[], k: number) {
  for (const c of list) {
    g.save();
    g.globalAlpha = c.alpha;
    if (c.clip) {
      g.beginPath();
      g.rect(c.clip.x * k, c.clip.y * k, c.clip.w * k, c.clip.h * k);
      g.clip();
    }
    g.font = smoothFont(c.font, k);
    g.textBaseline = "alphabetic";
    const text = smoothText(c.text);
    const x = c.x * k;
    // La línea base va al pie de las mayúsculas, como en la fuente pixel.
    const base = (c.y + FONTS[c.font].rows) * k;
    if (c.outline) {
      g.lineJoin = "round";
      g.lineWidth = 2 * k;
      g.strokeStyle = c.outline;
      g.strokeText(text, x, base);
    }
    if (c.shadow) {
      g.fillStyle = c.shadow;
      g.fillText(text, x, base + k);
    }
    if (typeof c.color === "string") {
      g.fillStyle = c.color;
    } else {
      const grad = g.createLinearGradient(0, c.y * k, 0, base);
      c.color.forEach((col, i) => grad.addColorStop(i / Math.max(1, c.color.length - 1), col));
      g.fillStyle = grad;
    }
    g.fillText(text, x, base);
    g.restore();
  }
}

/**
 * Ancho del texto en píxeles lógicos, con el estilo actual. `pixel` fuerza la
 * medida de la fuente pixel (para el logotipo y las capas fijas).
 */
export function textWidth(text: string, font: Font = "small", pixel = false): number {
  if (style === "smooth" && !pixel) {
    const g = measureCtx();
    g.font = smoothFont(font, 1);
    return g.measureText(smoothText(text)).width;
  }
  const { gap } = FONTS[font];
  let w = 0;
  for (const ch of text) w += glyph(font, ch)[0].length + gap;
  return Math.max(0, w - gap);
}

export interface TextOpts {
  font?: Font;
  /** Sombra de 1 px hacia abajo. */
  shadow?: string;
  /** Contorno de 1 px alrededor (va debajo de la sombra). */
  outline?: string;
  /** Siempre en pixel, aunque el texto sea normal (el logotipo). */
  pixel?: boolean;
  /** Recorte para el texto normal (el pixel usa el recorte del canvas). */
  clip?: Rect;
}

/**
 * Dibuja texto. `color` puede ser una lista de colores, uno por fila, para un
 * degradado vertical (la fila 0 es la de arriba de la línea).
 */
export function drawText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string | string[],
  opts: TextOpts = {},
) {
  const font = opts.font ?? "small";
  if (capture && capture.g === g && !opts.pixel) {
    const { shadow, outline, clip } = opts;
    capture.list.push({ text, x, y, color, font, shadow, outline, clip, alpha: g.globalAlpha });
    return;
  }
  const ox = Math.round(x);
  const oy = Math.round(y);
  if (opts.outline) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      paint(g, text, ox + dx, oy + dy, opts.outline, font);
    }
  }
  if (opts.shadow) paint(g, text, ox, oy + 1, opts.shadow, font);
  paint(g, text, ox, oy, color, font);
}

function paint(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string | string[], font: Font) {
  const { rows, gap } = FONTS[font];
  const ramp = typeof color === "string" ? null : color;
  if (!ramp) g.fillStyle = color as string;
  let cx = x;
  for (const ch of text) {
    const gl = glyph(font, ch);
    const top = y - Math.floor((gl.length - rows) / 2);
    for (let r = 0; r < gl.length; r++) {
      const line = gl[r];
      if (ramp) g.fillStyle = ramp[Math.max(0, Math.min(ramp.length - 1, top + r - y))];
      for (let c = 0; c < line.length; c++) if (line[c] === "#") g.fillRect(cx + c, top + r, 1, 1);
    }
    cx += line0(gl) + gap;
  }
}

function line0(gl: string[]) {
  return gl[0].length;
}
