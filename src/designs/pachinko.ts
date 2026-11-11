// Pachinko: la tolva de arriba guarda lo que te queda de las 5 h. Cuando
// gastas, salen bolas que rebotan entre los clavos y se quedan en la casilla
// de su valor ($1 a $500): cada bola de una casilla vale lo que dice su
// etiqueta. Si el cambio junta varias bolas en una de más valor, las de abajo
// se van por el desagüe. El tubo de la derecha es lo que te queda de la semana.

import {
  periodLabel,
  statusShort,
  weekLabel,
  bankUrgency,
  bankValue,
  formatMoney,
  resetLabels,
  tokensLabel,
  periodTotals,
} from "../core/format";
import { BALL, drawBall } from "../core/balls";
import { drawText, textWidth } from "../core/font";
import { LOGO_GRADIENT, drawGhost, drawLed, drawWoodFrame, layer, rect } from "../core/paint";
import { DENOMS, chipsFor } from "../core/stack";
import type { LimitWindow, Snapshot } from "../core/types";
import type { Design, DesignContext } from "./design";

const W = 104;
const H = 150;

const C = {
  ink: "#0b0f1c",
  wood: { ink: "#120b06", dark: "#3e2716", base: "#5c3a22", light: "#7a4d2c", shine: "#9a653a" },
  board: "#1b2440",
  boardDot: "#222d50",
  boardDeep: "#141b33",
  glass: "#2a3760",
  glassLight: "#3a4a7c",
  glassEdge: "#56689e",
  rail: "#d7dbe2",
  railMid: "#9ba2ae",
  railDark: "#5d6470",
  pin: "#f2cd6e",
  pinShadow: "#0c1226",
  pocket: "#10162b",
  wall: "#c99a3e",
  wallLight: "#f0c766",
  cream: "#f1e6c8",
  dim: "#a9b8d6",
  gold: "#f0b64e",
  warn: "#f0a24a",
  bad: "#e56a5f",
  shadow: "#070a14",
};

/** Color de la etiqueta de cada casilla: el de su ficha. */
const DENOM_TEXT = ["#ece6d6", "#ee6b70", "#5fcf86", "#a8a6b8", "#ffac4f"];

// Tolva: un embudo de 4 filas (9, 8, 7 y 6 bolas, de arriba abajo).
const HOPPER_ROWS = [6, 7, 8, 9];
const HOPPER_CAP = HOPPER_ROWS.reduce((a, b) => a + b, 0);
const HOPPER = { cx: 52, bottom: 33 };
const OUTLET = { x: 50, y: 36 };

const RAIL = { x: 6, y: 38, w: 85, h: 96, r: 10 };
const PIN_ROWS = 8;
const PIN_TOP = 46;
const PIN_GAP = 8;
const PIN_X0 = 12;
const PIN_X1 = 84;
const POCKET_X = (i: number) => 8 + i * 16;
const POCKET_TOP = 113;
/** Suelo de las casillas: la fila de abajo de las bolas. */
const POCKET_FLOOR = 129;
const POCKET_SLOTS = 10;
const TUBE = { x: 93, y: 40, h: 81 };
/** Línea del gasto y los tokens, debajo de las etiquetas de las casillas. */
const FOOTER_Y = 139;
const TUBE_CAP = 20;

const ROW_MS = 80;
const RELEASE_EVERY = 160;
const DRAIN_MS = 280;
/** Más bolas que esto en cola entran sin animación. */
const MAX_QUEUE = 16;

/** Posición de la bola `k` dentro de una casilla: filas de 3 y de 2, alternas. */
function slotPos(pocket: number, k: number) {
  const x0 = POCKET_X(pocket) + 1;
  const pair = Math.floor(k / 5);
  const r = k % 5;
  const lower = r < 3;
  const row = pair * 2 + (lower ? 0 : 1);
  const order = lower ? [5, 0, 10][r] : [2, 7][r - 3];
  return { x: x0 + order, y: POCKET_FLOOR - BALL.big + 1 - row * 4 };
}

interface Ball {
  pocket: number;
  slot: number;
  /** x de la bola en cada fila de clavos. */
  path: number[];
  start: number;
  lastRow: number;
  landed: boolean;
}

interface Drain {
  x: number;
  y: number;
  start: number;
}

function pathTo(pocket: number, slot: number): number[] {
  const target = slotPos(pocket, slot).x;
  const path: number[] = [];
  let x = OUTLET.x;
  for (let r = 0; r < PIN_ROWS; r++) {
    // Rebota a un lado del clavo; tiende hacia su casilla pero con azar.
    const remaining = PIN_ROWS - r;
    const need = (target - x) / remaining;
    const bias = Math.max(-0.85, Math.min(0.85, need / 4));
    const dir = Math.random() < 0.5 + bias / 2 ? 1 : -1;
    x = Math.max(PIN_X0 - 2, Math.min(PIN_X1 - 2, x + dir * 4));
    path.push(x);
  }
  return path;
}

export class Pachinko implements Design {
  readonly id = "pachinko" as const;
  readonly width = W;
  readonly height = H;

  /** Bolas quietas en cada casilla. */
  private counts = [0, 0, 0, 0, 0];
  private queue: number[] = [];
  private balls: Ball[] = [];
  private drains: Drain[] = [];
  private nextRelease = 0;
  private snap: Snapshot | null = null;
  private ctx: DesignContext | null = null;

  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean) {
    this.ctx = ctx;
    const target = chipsFor(periodTotals(snap, ctx.settings.period).costUsd);
    const animate = !first && ctx.motion === "full";

    target.forEach((n, i) => {
      const flying = this.balls.filter((b) => b.pocket === i).length;
      const queued = this.queue.filter((p) => p === i).length;
      if (!animate) {
        this.queue = this.queue.filter((p) => p !== i);
        this.balls = this.balls.filter((b) => b.pocket !== i);
        this.counts[i] = n;
        return;
      }
      if (n < this.counts[i] + flying + queued) {
        // El cambio juntó bolas en otra casilla: las que sobran se van.
        this.queue = this.queue.filter((p) => p !== i);
        this.balls = this.balls.filter((b) => b.pocket !== i);
        for (let k = this.counts[i] - 1; k >= n; k--) {
          if (k < POCKET_SLOTS) this.drains.push({ ...slotPos(i, k), start: now });
        }
        this.counts[i] = Math.min(this.counts[i], n);
      }
      const missing = n - this.counts[i] - this.balls.filter((b) => b.pocket === i).length - this.queue.filter((p) => p === i).length;
      // Demasiadas bolas: las que no caben en la cola entran sin animación.
      const animated = Math.max(0, Math.min(missing, MAX_QUEUE - this.queue.length));
      for (let k = 0; k < animated; k++) this.queue.push(i);
      this.counts[i] += Math.max(0, missing - animated);
    });
    this.snap = snap;
  }

  update(now: number): boolean {
    if (this.queue.length > 0 && now >= this.nextRelease) {
      const pocket = this.queue.shift()!;
      const slot = this.counts[pocket] + this.balls.filter((b) => b.pocket === pocket).length;
      this.balls.push({ pocket, slot, path: pathTo(pocket, slot), start: now, lastRow: -1, landed: false });
      this.nextRelease = now + RELEASE_EVERY;
    }

    for (const ball of this.balls) {
      const row = Math.floor((now - ball.start) / ROW_MS);
      if (row !== ball.lastRow && row < PIN_ROWS) {
        ball.lastRow = row;
        this.ctx?.cue("ball");
      }
      if (!ball.landed && row >= PIN_ROWS + 2) {
        // Entró en su casilla y se queda ahí.
        ball.landed = true;
        this.counts[ball.pocket]++;
        this.ctx?.cue("pocket");
      }
    }
    this.balls = this.balls.filter((b) => !b.landed);
    this.drains = this.drains.filter((d) => now - d.start < DRAIN_MS);
    return this.balls.length > 0 || this.queue.length > 0 || this.drains.length > 0;
  }

  msUntilIdleEvent(): number {
    return 30_000;
  }

  // ── Dibujo ───────────────────────────────────────────────────────────────

  draw(g: CanvasRenderingContext2D, now: number) {
    g.clearRect(0, 0, W, H);
    const snap = this.snap;
    const plan = snap?.plan;
    const shows = this.ctx?.settings.bankShows ?? "left";

    g.drawImage(layer("pachinko:fondo", W, H, (b) => this.drawMachine(b)), 0, 0);
    // El valor de cada casilla (fuera de la capa fija, para que siga el estilo de texto).
    DENOMS.forEach((d, i) => {
      const x = POCKET_X(i) + 1 + Math.floor((15 - textWidth(d.label)) / 2);
      drawText(g, d.label, x, POCKET_FLOOR + 4, DENOM_TEXT[i], { shadow: C.shadow });
    });
    drawLed(g, W - 14, 8, plan?.status);
    if (snap?.ghost) drawGhost(g, 9, 8);

    // Banca de 5 h a la izquierda; la semana a la derecha.
    // Cada lectura tiene su hueco (la izquierda hasta la tolva, la derecha hasta
    // el marco) y las dos cuentas atrás usan la misma forma.
    const [reset5, resetWeek] = resetLabels([
      { iso: plan?.fiveHour?.resetsAt, room: 30 },
      { iso: plan?.sevenDay?.resetsAt, room: W - 6 - 76 },
    ]);
    this.drawReading(g, 9, reset5, "5H", plan?.fiveHour, plan?.status, shows);
    this.drawReading(g, 76, resetWeek, weekLabel(), plan?.sevenDay, undefined, shows);
    const left5 = plan?.fiveHour ? Math.max(0, 100 - plan.fiveHour.used) : 0;
    this.drawHopper(g, Math.round((left5 / 100) * HOPPER_CAP));
    const leftW = plan?.sevenDay ? Math.max(0, 100 - plan.sevenDay.used) : 0;
    this.drawTube(g, Math.round((leftW / 100) * TUBE_CAP));

    this.drawPockets(g, now);
    for (const ball of this.balls) this.drawFallingBall(g, ball, now);
    this.drawFooter(g, snap);
  }

  private drawReading(
    g: CanvasRenderingContext2D,
    x: number,
    reset: string,
    label: string,
    win: LimitWindow | null | undefined,
    status: string | undefined,
    shows: "left" | "used",
  ) {
    drawText(g, label, x, 17, C.dim);
    const v = bankValue(win, shows);
    if (v === null) {
      const word = statusShort(status);
      drawText(g, word, x, 24, C.warn, { shadow: C.shadow });
      return;
    }
    drawText(g, `${v}%`, x, 24, [C.cream, C.warn, C.bad][bankUrgency(win)], { shadow: C.shadow });
    if (reset) drawText(g, reset, x, 31, C.dim);
  }

  /** Lo que no cambia: marco, tablero, riel, clavos, casillas y tubo vacío. */
  private drawMachine(g: CanvasRenderingContext2D) {
    drawWoodFrame(g, W, H, C.wood);
    rect(g, 5, 5, W - 10, H - 10, C.board);
    g.fillStyle = C.boardDot;
    for (let y = 7; y < H - 6; y += 4) {
      for (let x = 7 + ((y / 4) % 2) * 2; x < W - 6; x += 4) g.fillRect(x, y, 1, 1);
    }
    // Sombra bajo el marco
    rect(g, 5, 5, W - 10, 1, C.boardDeep);
    rect(g, 5, 5, 1, H - 10, C.boardDeep);

    const logo = "CLAUPIER";
    drawText(g, logo, Math.floor((W - textWidth(logo, "big", true)) / 2), 7, LOGO_GRADIENT, { font: "big", shadow: C.shadow });

    // Riel cromado con las esquinas de arriba redondeadas
    this.drawRail(g);

    // Clavos
    for (let r = 0; r < PIN_ROWS; r++) {
      const y = PIN_TOP + r * PIN_GAP;
      for (let x = PIN_X0 + (r % 2) * 4; x <= PIN_X1; x += 8) {
        rect(g, x + 1, y + 1, 1, 1, C.pinShadow);
        rect(g, x, y, 1, 1, C.pin);
      }
    }

    // Casillas
    DENOMS.forEach((_, i) => {
      const x = POCKET_X(i);
      rect(g, x + 1, POCKET_TOP, 15, POCKET_FLOOR - POCKET_TOP + 1, C.pocket);
      for (const wx of [x, x + 16]) {
        rect(g, wx, POCKET_TOP - 1, 1, POCKET_FLOOR - POCKET_TOP + 3, C.wall);
        rect(g, wx, POCKET_TOP - 1, 1, 1, C.wallLight);
      }
      rect(g, x, POCKET_FLOOR + 1, 17, 1, C.wall);
    });

    // Tubo de la semana, vacío
    const t = TUBE;
    rect(g, t.x - 1, t.y - 1, 7, t.h + 2, C.ink);
    rect(g, t.x, t.y, 5, t.h, C.glass);
    rect(g, t.x, t.y, 1, t.h, C.glassLight);
  }

  private drawRail(g: CanvasRenderingContext2D) {
    const { x, y, w, h, r } = RAIL;
    // Dos líneas de 1 px con las esquinas de arriba redondeadas: luz y sombra.
    g.drawImage(archLine(w, h, r, 0, C.rail), x, y);
    g.drawImage(archLine(w, h, r, 1, C.railDark), x, y);
    // El lado derecho queda en sombra.
    g.save();
    g.beginPath();
    g.rect(x + Math.floor(w / 2), y, w, h);
    g.clip();
    g.drawImage(archLine(w, h, r, 0, C.railMid), x, y);
    g.restore();
  }

  private drawHopper(g: CanvasRenderingContext2D, balls: number) {
    const s = BALL.small;
    // Cristal del embudo, fila por fila
    const rowBox = (n: number, row: number) => {
      const width = n * s + 2;
      return { x: HOPPER.cx - Math.floor(width / 2), y: HOPPER.bottom - (row + 1) * s, width };
    };
    HOPPER_ROWS.forEach((n, row) => {
      const b = rowBox(n, row);
      rect(g, b.x - 1, b.y - 1, b.width + 2, s + 2, C.ink);
    });
    HOPPER_ROWS.forEach((n, row) => {
      const b = rowBox(n, row);
      rect(g, b.x, b.y, b.width, s, C.glass);
    });
    const topW = HOPPER_ROWS[HOPPER_ROWS.length - 1] * s + 2;
    // Cuello hasta la salida
    rect(g, OUTLET.x - 1, HOPPER.bottom, 6, OUTLET.y - HOPPER.bottom + 1, C.ink);
    rect(g, OUTLET.x, HOPPER.bottom, 4, OUTLET.y - HOPPER.bottom, C.glass);
    // Bolas apiladas desde abajo
    let left = balls;
    HOPPER_ROWS.forEach((n, row) => {
      const width = n * s + 2;
      const x = HOPPER.cx - Math.floor(width / 2) + 1;
      const y = HOPPER.bottom - (row + 1) * s;
      for (let k = 0; k < n && left > 0; k++, left--) drawBall(g, "small", x + k * s, y);
    });
    // Reflejo del cristal
    g.fillStyle = "rgba(255, 255, 255, 0.12)";
    const tx = HOPPER.cx - Math.floor(topW / 2);
    g.fillRect(tx + 1, HOPPER.bottom - HOPPER_ROWS.length * s, 1, s * 2);
  }

  private drawTube(g: CanvasRenderingContext2D, filled: number) {
    const t = TUBE;
    for (let k = 0; k < filled; k++) drawBall(g, "small", t.x + 1, t.y + t.h - BALL.small - k * 4);
    g.fillStyle = "rgba(255, 255, 255, 0.14)";
    g.fillRect(t.x, t.y, 1, t.h);
  }

  private drawPockets(g: CanvasRenderingContext2D, now: number) {
    this.counts.forEach((n, i) => {
      const shown = Math.min(n, POCKET_SLOTS);
      for (let k = 0; k < shown; k++) {
        const p = slotPos(i, k);
        drawBall(g, "big", p.x, p.y);
      }
      const extra = n - POCKET_SLOTS;
      if (extra > 0) {
        const label = extra > 999 ? "+999" : `+${extra}`;
        drawText(g, label, POCKET_X(i) + 1 + Math.floor((15 - textWidth(label)) / 2), POCKET_TOP - 7, C.gold, { shadow: C.shadow });
      }
    });
    // Bolas que se van por el desagüe: bajan y se apagan.
    for (const d of this.drains) {
      const t = Math.min(1, (now - d.start) / DRAIN_MS);
      g.save();
      g.beginPath();
      g.rect(0, 0, W, POCKET_FLOOR + 1);
      g.clip();
      g.globalAlpha = t < 0.5 ? 1 : 0.5;
      drawBall(g, "big", d.x, d.y + Math.round(t * t * 8));
      g.restore();
    }
  }

  private drawFallingBall(g: CanvasRenderingContext2D, ball: Ball, now: number) {
    const t = (now - ball.start) / ROW_MS; // filas recorridas
    const row = Math.floor(t);
    const frac = Math.min(1, t - row);
    const end = slotPos(ball.pocket, ball.slot);
    const rowX = (r: number) => (r < 0 ? OUTLET.x : r < PIN_ROWS ? ball.path[r] : end.x);
    const rowY = (r: number) => (r < 0 ? OUTLET.y : r < PIN_ROWS ? PIN_TOP + r * PIN_GAP - 5 : end.y);
    if (row >= PIN_ROWS) {
      // Último tramo: de la fila de abajo hasta su sitio en la casilla.
      const k = Math.min(1, (t - PIN_ROWS) / 2);
      drawBall(g, "big", rowX(PIN_ROWS - 1) + (end.x - rowX(PIN_ROWS - 1)) * k, rowY(PIN_ROWS - 1) + (end.y - rowY(PIN_ROWS - 1)) * k * k);
      return;
    }
    const fromX = rowX(row - 1);
    const fromY = rowY(row - 1);
    const toX = rowX(row);
    const toY = rowY(row);
    // Pequeño salto al rebotar en cada clavo
    const hop = Math.sin(frac * Math.PI) * 2;
    drawBall(g, "big", fromX + (toX - fromX) * frac, fromY + (toY - fromY) * frac * frac - hop);
  }

  /** Al pie del tablero: el gasto del periodo en dorado y los tokens, discretos. */
  private drawFooter(g: CanvasRenderingContext2D, snap: Snapshot | null) {
    const settings = this.ctx?.settings;
    if (!snap || !settings) return;
    const totals = periodTotals(snap, settings.period);
    const label = `${periodLabel(settings.period)} `;
    const money = formatMoney(totals.costUsd, settings);
    const y = FOOTER_Y;
    drawText(g, label, 8, y, C.dim, { shadow: C.shadow });
    const mx = 8 + textWidth(label);
    drawText(g, money, mx, y, C.gold, { shadow: C.shadow });
    const room = W - 8 - (mx + textWidth(money) + 4);
    const tokens = tokensLabel(totals.totalTokens, room);
    drawText(g, tokens, W - 8 - textWidth(tokens), y, C.dim, { shadow: C.shadow });
  }
}

/** Contorno de 1 px de un arco: rectángulo con las esquinas de arriba redondas. */
function archLine(w: number, h: number, r: number, inset: number, color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  archFill(g, w, h, r, inset, color);
  g.globalCompositeOperation = "destination-out";
  archFill(g, w, h, r, inset + 1, "#000");
  return c;
}

function archFill(g: CanvasRenderingContext2D, w: number, h: number, r: number, inset: number, color: string) {
  g.fillStyle = color;
  const rr = r - inset;
  for (let row = inset; row < h; row++) {
    const k = row - inset;
    const cut = k >= rr ? 0 : rr - Math.round(Math.sqrt(rr * rr - (rr - k - 0.5) ** 2));
    g.fillRect(inset + cut, row, w - (inset + cut) * 2, 1);
  }
}
