// Bolas de acero del pachinko.

import { spriteFrom } from "./sprite";

const STEEL = { W: "#f2f5f9", h: "#d2d8e2", m: "#a1a9b7", d: "#687081", k: "#454c5a" };

const MAPS = {
  /** Para la tolva y el tubo, donde van muchas. */
  small: [".hm.", "hWmd", "hmmd", ".dk."],
  /** Para las que caen y las de las casillas. */
  big: [".hhm.", "hWhmd", "hhmmd", "mmmdk", ".dkk."],
};

export type BallSize = keyof typeof MAPS;
export const BALL: Record<BallSize, number> = { small: 4, big: 5 };

const cache = new Map<BallSize, HTMLCanvasElement>();

export function ballSprite(size: BallSize): HTMLCanvasElement {
  let s = cache.get(size);
  if (!s) {
    s = spriteFrom(MAPS[size], STEEL);
    cache.set(size, s);
  }
  return s;
}

export function drawBall(g: CanvasRenderingContext2D, size: BallSize, x: number, y: number) {
  g.drawImage(ballSprite(size), Math.round(x), Math.round(y));
}
