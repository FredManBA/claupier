// Laboratorio de sprites (solo desarrollo): /lab.html muestra ampliadas las
// fichas, las monedas, la bolsa, las bolas y las fuentes. No entra en la
// compilación; sirve para revisar el pixel art antes de tocar un diseño.
// Parámetro: ?zoom=6 (por defecto).

import { BALL, drawBall } from "./core/balls";
import { CHIP_DIMS, PALETTES, type PaletteName, chipSprites, drawChip } from "./core/chips";
import { SPIN, bagSprite, coinSprite, layoutHeap } from "./core/coins";
import { drawText } from "./core/font";
import { LOGO_GRADIENT } from "./core/paint";

const ZOOM = Number(new URLSearchParams(location.search).get("zoom") ?? 6);

function sheet(w: number, h: number, bg: string, draw: (g: CanvasRenderingContext2D) => void) {
  const low = document.createElement("canvas");
  low.width = w;
  low.height = h;
  const g = low.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  draw(g);
  const big = document.createElement("canvas");
  big.width = w * ZOOM;
  big.height = h * ZOOM;
  const bg2 = big.getContext("2d")!;
  bg2.imageSmoothingEnabled = false;
  bg2.drawImage(low, 0, 0, big.width, big.height);
  document.body.append(big);
}

const names = Object.keys(PALETTES) as PaletteName[];

// Fichas grandes: una sola y una pila de 5, sobre paño.
sheet(names.length * 22 + 4, 40, "#1a4532", (g) => {
  names.forEach((n, i) => {
    const s = chipSprites(n, "big");
    const x = 4 + i * 22;
    drawChip(g, s, x, 2);
    for (let k = 0; k < 5; k++) drawChip(g, s, x, 36 - CHIP_DIMS.big.h - k * CHIP_DIMS.big.step);
  });
});

// Fichas mini (la píldora).
sheet(names.length * 14 + 4, 12, "#173f2e", (g) => {
  names.forEach((n, i) => drawChip(g, chipSprites(n, "mini"), 3 + i * 14, 2));
});

// Monedas: poses, giro, bolsa y un montón de 60.
sheet(150, 40, "#1d0609", (g) => {
  (["flat", "round", "tilt", "edge"] as const).forEach((p, i) => g.drawImage(coinSprite(p), 3 + i * 10, 3));
  SPIN.forEach((p, i) => g.drawImage(coinSprite(p), 46 + i * 9, 3));
  g.drawImage(bagSprite(), 86, 2);
  for (const s of layoutHeap(60, 64, 38, 32)) g.drawImage(coinSprite(s.pose), 82 + s.x, s.y);
});

// Bolas del pachinko.
sheet(60, 16, "#1b2440", (g) => {
  drawBall(g, "small", 3, 3);
  drawBall(g, "big", 10, 3);
  for (let k = 0; k < 10; k++) drawBall(g, "big", 20 + (k % 5) * BALL.big, 3 + Math.floor(k / 5) * 5);
});

// Fuentes.
sheet(150, 44, "#3c1519", (g) => {
  drawText(g, "CLAUPIER", 4, 3, LOGO_GRADIENT, {
    font: "big",
    shadow: "#250a0d",
  });
  drawText(g, "78% $38.40 ₡19K", 60, 3, "#f1e6c8", { font: "big", shadow: "#250a0d" });
  drawText(g, "TU BANCA 5H  POZO HOY  SEM 59% @3D3H", 4, 16, "#f1e6c8");
  drawText(g, "MW NQ 4.8M TOK $38.40 ₡19K ×12", 4, 24, "#f0b64e");
  drawText(g, "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ", 4, 33, "#8fbaa2");
});
