// Pachinko: la tolva de arriba guarda lo que te queda de las 5 h. Cuando
// gastas, salen bolas que rebotan entre los clavos y caen en la casilla de su
// ficha ($1 a $500); cada bola que entra suma una ficha. El tubo de la derecha
// es lo que te queda de la semana.

import {
  PERIOD_LABEL,
  STATUS_TEXT,
  bankUrgency,
  bankValue,
  formatMoney,
  formatReset,
  formatTokens,
  periodTotals,
} from "../core/format";
import { drawText, textWidth } from "../core/pixel";
import { DENOMS, Stack, chipsFor } from "../core/stack";
import type { Snapshot } from "../core/types";
import type { Design, DesignContext } from "./design";

const W = 104;
const H = 164;

const C = {
  ink: "#0b1a12",
  wood: "#5a3a22",
  woodLight: "#8a5a32",
  board: "#1b2440",
  boardDot: "#232e52",
  glass: "#2a3760",
  pin: "#e0b04a",
  pinShadow: "#0f1528",
  ball: "#c3c8d2",
  ballLight: "#e6e9ee",
  ballDark: "#6f7684",
  wall: "#c99a3e",
  pocket: "#141b33",
  cream: "#f1e6c8",
  dim: "#9fb0d0",
  gold: "#f0b64e",
  warn: "#f0a24a",
  bad: "#e56a5f",
  ok: "#6fdc8c",
  brass: "#b8862f",
  brassLight: "#d9a948",
  brassDark: "#6e4c16",
  ghost: "#cfe3ff",
};

const DENOM_TEXT = ["#e6dfcf", "#e0646a", "#5fc782", "#9a98a8", "#ffac4f"];

const HOPPER = { x: 34, y: 13, w: 36, h: 18 };
const HOPPER_COLS = 8;
const HOPPER_ROWS = 4;
const OUTLET = { x: 51, y: 36 };
const PIN_ROWS = 9;
const PIN_TOP = 42;
const PIN_GAP = 8;
const POCKET_X = (i: number) => 7 + i * 17;
const POCKET_W = 16;
const POCKET_TOP = 114;
const POCKET_BASE = 138;
const TUBE = { x: 92, y: 40, h: 80 };
const ROW_MS = 85;
const RELEASE_EVERY = 170;
/** Más bolas que esto en cola entran sin animación. */
const MAX_QUEUE = 16;

interface Ball {
  pocket: number;
  /** x de la bola en cada fila de clavos, y al final la casilla. */
  path: number[];
  start: number;
  lastRow: number;
}

function pathTo(pocket: number): number[] {
  const target = POCKET_X(pocket) + POCKET_W / 2 - 1;
  const path: number[] = [];
  let x = OUTLET.x;
  for (let r = 0; r < PIN_ROWS; r++) {
    // Rebota a un lado del clavo; tiende hacia su casilla pero con azar.
    const remaining = PIN_ROWS - r;
    const need = (target - x) / remaining;
    const bias = Math.max(-0.8, Math.min(0.8, need / 4));
    const dir = Math.random() < 0.5 + bias / 2 ? 1 : -1;
    x = Math.max(10, Math.min(86, x + dir * 4));
    path.push(x);
  }
  path.push(target);
  return path;
}

export class Pachinko implements Design {
  readonly id = "pachinko" as const;
  readonly width = W;
  readonly height = H;

  private pockets = DENOMS.map((d, i) => new Stack(POCKET_X(i) + 3, POCKET_BASE, d.palette, 9, C.pocket, "mini"));
  /** Fichas que ya entraron en cada casilla. */
  private committed = [0, 0, 0, 0, 0];
  private queue: number[] = [];
  private balls: Ball[] = [];
  private nextRelease = 0;
  private snap: Snapshot | null = null;
  private ctx: DesignContext | null = null;

  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean) {
    this.ctx = ctx;
    const target = chipsFor(periodTotals(snap, ctx.settings.period).costUsd);
    const animate = !first && ctx.motion === "full";

    target.forEach((n, i) => {
      const inFlight = this.balls.filter((b) => b.pocket === i).length + this.queue.filter((p) => p === i).length;
      if (!animate || n < this.committed[i]) {
        // Al bajar (periodo nuevo) o sin animación: directo.
        this.queue = this.queue.filter((p) => p !== i);
        this.balls = this.balls.filter((b) => b.pocket !== i);
        this.committed[i] = n;
        this.pockets[i].setTarget(n, now, first ? "instant" : ctx.motion);
        return;
      }
      const missing = n - this.committed[i] - inFlight;
      for (let k = 0; k < missing; k++) this.queue.push(i);
    });

    // Demasiadas bolas: las que sobran entran sin animación.
    while (this.queue.length > MAX_QUEUE) {
      const i = this.queue.pop()!;
      this.committed[i]++;
      this.pockets[i].setTarget(this.committed[i], now, "instant");
    }
    this.snap = snap;
  }

  update(now: number): boolean {
    let busy = false;
    for (const s of this.pockets) busy = s.update(now) || busy;

    if (this.queue.length > 0 && now >= this.nextRelease) {
      const pocket = this.queue.shift()!;
      this.balls.push({ pocket, path: pathTo(pocket), start: now, lastRow: -1 });
      this.nextRelease = now + RELEASE_EVERY;
    }

    for (const ball of [...this.balls]) {
      const row = Math.floor((now - ball.start) / ROW_MS);
      if (row !== ball.lastRow && row < PIN_ROWS) {
        ball.lastRow = row;
        this.ctx?.cue("ball");
      }
      if (row >= PIN_ROWS + 2) {
        // Entró en la casilla: suma su ficha.
        this.balls.splice(this.balls.indexOf(ball), 1);
        this.committed[ball.pocket]++;
        this.pockets[ball.pocket].setTarget(this.committed[ball.pocket], now, this.ctx?.motion ?? "full");
        this.ctx?.cue("chip");
      }
    }
    return busy || this.balls.length > 0 || this.queue.length > 0;
  }

  msUntilIdleEvent(): number {
    return 30_000;
  }

  // ── Dibujo ───────────────────────────────────────────────────────────────

  draw(g: CanvasRenderingContext2D, now: number) {
    g.clearRect(0, 0, W, H);
    const snap = this.snap;
    const plan = snap?.plan;
    const settings = this.ctx?.settings;
    const shows = settings?.bankShows ?? "left";

    this.drawFrame(g);
    drawText(g, "CLAUPIER", Math.floor((W - textWidth("CLAUPIER")) / 2), 6, C.gold);
    this.drawStatus(g, plan?.status);
    if (snap?.ghost) this.drawGhost(g, 7, 6);

    // Banca de 5 h: texto a la izquierda, tolva al centro
    const five = bankValue(plan?.fiveHour, shows);
    const statusWord = STATUS_TEXT[plan?.status ?? "loading"]?.[0] || "...";
    drawText(g, "5H", 7, 15, C.dim);
    drawText(g, five === null ? statusWord : `${five}%`, 7, 22, five === null ? C.warn : this.urgency(plan?.fiveHour));
    const r5 = formatReset(plan?.fiveHour?.resetsAt);
    if (r5) drawText(g, `@${r5}`, 7, 29, C.dim);
    const left5 = plan?.fiveHour ? Math.max(0, 100 - plan.fiveHour.used) : 0;
    this.drawHopper(g, Math.round((left5 / 100) * HOPPER_COLS * HOPPER_ROWS));

    // Semana: texto a la derecha y tubo
    const week = bankValue(plan?.sevenDay, shows);
    drawText(g, "SEM", 74, 15, C.dim);
    drawText(g, week === null ? "..." : `${week}%`, 74, 22, week === null ? C.warn : this.urgency(plan?.sevenDay));
    const rw = formatReset(plan?.sevenDay?.resetsAt);
    if (rw) drawText(g, `@${rw}`, 74, 29, C.dim);
    const leftW = plan?.sevenDay ? Math.max(0, 100 - plan.sevenDay.used) : 0;
    this.drawTube(g, leftW);

    this.drawPins(g);
    this.drawPockets(g, now);
    for (const ball of this.balls) this.drawFallingBall(g, ball, now);
    this.drawPlate(g, snap);
  }

  private urgency(win: Parameters<typeof bankUrgency>[0]) {
    return [C.cream, C.warn, C.bad][bankUrgency(win)];
  }

  private drawFrame(g: CanvasRenderingContext2D) {
    const rect = (x: number, y: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, w, h);
    };
    const rounded = (inset: number, c: string) => {
      const x0 = inset, y0 = inset, w = W - inset * 2, h = H - inset * 2;
      rect(x0 + 2, y0, w - 4, h, c);
      rect(x0 + 1, y0 + 1, w - 2, h - 2, c);
      rect(x0, y0 + 2, w, h - 4, c);
    };
    rounded(0, C.ink);
    rounded(1, C.wood);
    rect(3, 2, W - 6, 1, C.woodLight);
    rounded(3, C.ink);
    rounded(4, C.board);
    g.fillStyle = C.boardDot;
    for (let y = 6; y < H - 5; y += 4) {
      for (let x = 6 + ((y / 4) % 2) * 2; x < W - 5; x += 4) g.fillRect(x, y, 1, 1);
    }
  }

  private drawStatus(g: CanvasRenderingContext2D, status: string | undefined) {
    const color = status === "ok" ? C.ok : status === "loading" || !status ? C.dim : status === "rate_limited" ? C.warn : C.bad;
    g.fillStyle = C.ink;
    g.fillRect(91, 5, 6, 6);
    g.fillStyle = color;
    g.fillRect(92, 6, 4, 4);
  }

  private ball(g: CanvasRenderingContext2D, x: number, y: number) {
    const px = Math.round(x);
    const py = Math.round(y);
    g.fillStyle = C.ballDark;
    g.fillRect(px, py, 3, 3);
    g.fillStyle = C.ball;
    g.fillRect(px, py, 2, 2);
    g.fillStyle = C.ballLight;
    g.fillRect(px, py, 1, 1);
  }

  private drawHopper(g: CanvasRenderingContext2D, balls: number) {
    const { x, y, w, h } = HOPPER;
    g.fillStyle = C.ink;
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = C.glass;
    g.fillRect(x, y, w, h);
    // Embudo hasta la salida
    g.fillStyle = C.ink;
    for (let i = 0; i < 5; i++) {
      g.fillRect(x + 4 + i * 3, y + h + 1 + i, 1, 1);
      g.fillRect(x + w - 5 - i * 3, y + h + 1 + i, 1, 1);
    }
    // Bolas apiladas desde abajo
    for (let k = 0; k < balls; k++) {
      const row = Math.floor(k / HOPPER_COLS);
      const col = k % HOPPER_COLS;
      this.ball(g, x + 2 + col * 4 + (row % 2), y + h - 5 - row * 4);
    }
  }

  private drawTube(g: CanvasRenderingContext2D, leftPct: number) {
    const { x, y, h } = TUBE;
    g.fillStyle = C.ink;
    g.fillRect(x - 1, y - 1, 7, h + 2);
    g.fillStyle = C.glass;
    g.fillRect(x, y, 5, h);
    const slots = Math.floor(h / 4);
    const filled = Math.round((leftPct / 100) * slots);
    for (let k = 0; k < filled; k++) this.ball(g, x + 1, y + h - 4 - k * 4);
  }

  private drawPins(g: CanvasRenderingContext2D) {
    for (let r = 0; r < PIN_ROWS; r++) {
      const y = PIN_TOP + r * PIN_GAP;
      for (let x = 10 + (r % 2) * 4; x <= 86; x += 8) {
        g.fillStyle = C.pinShadow;
        g.fillRect(x + 1, y + 1, 1, 1);
        g.fillStyle = C.pin;
        g.fillRect(x + 1, y, 1, 1);
      }
    }
  }

  private drawFallingBall(g: CanvasRenderingContext2D, ball: Ball, now: number) {
    const t = (now - ball.start) / ROW_MS; // filas recorridas
    const row = Math.min(Math.floor(t), ball.path.length - 1);
    const frac = Math.min(1, t - Math.floor(t));
    const fromX = row === 0 ? OUTLET.x : ball.path[row - 1];
    const toX = ball.path[row];
    const fromY = row === 0 ? OUTLET.y : PIN_TOP + (row - 1) * PIN_GAP - 3;
    const toY = row < PIN_ROWS ? PIN_TOP + row * PIN_GAP - 3 : POCKET_BASE - 10;
    // Pequeño salto al rebotar en cada clavo
    const hop = Math.sin(frac * Math.PI) * 2;
    this.ball(g, fromX + (toX - fromX) * frac, fromY + (toY - fromY) * frac * frac - hop);
  }

  private drawPockets(g: CanvasRenderingContext2D, now: number) {
    DENOMS.forEach((d, i) => {
      const x = POCKET_X(i);
      g.fillStyle = C.pocket;
      g.fillRect(x + 1, POCKET_TOP, POCKET_W - 2, POCKET_BASE - POCKET_TOP + 1);
      g.fillStyle = C.wall;
      g.fillRect(x, POCKET_TOP, 1, POCKET_BASE - POCKET_TOP + 2);
      g.fillRect(x + POCKET_W - 1, POCKET_TOP, 1, POCKET_BASE - POCKET_TOP + 2);
      g.fillRect(x, POCKET_BASE + 1, POCKET_W, 1);
      const stack = this.pockets[i];
      const extra = stack.count - stack.maxVisible;
      if (extra > 0) drawText(g, `+${extra}`, x + 2, POCKET_TOP - 7, C.gold);
      stack.draw(g, now);
      const label = d.label;
      drawText(g, label, x + Math.floor((POCKET_W - textWidth(label)) / 2), POCKET_BASE + 3, DENOM_TEXT[i]);
    });
  }

  private drawPlate(g: CanvasRenderingContext2D, snap: Snapshot | null) {
    const x = 6, y = 148, w = 92, h = 13;
    g.fillStyle = C.ink;
    g.fillRect(x, y, w, h);
    g.fillStyle = C.brassDark;
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle = C.brass;
    g.fillRect(x + 1, y + 1, w - 2, h - 3);
    g.fillStyle = C.brassLight;
    g.fillRect(x + 1, y + 1, w - 2, 1);
    const settings = this.ctx?.settings;
    if (!snap || !settings) return;
    const totals = periodTotals(snap, settings.period);
    drawText(g, `${PERIOD_LABEL[settings.period]} ${formatMoney(totals.costUsd, settings)}`, x + 4, y + 4, C.ink);
    const tokens = `${formatTokens(totals.totalTokens)} TOK`;
    drawText(g, tokens, x + w - 4 - textWidth(tokens), y + 4, C.brassDark);
  }

  private drawGhost(g: CanvasRenderingContext2D, x: number, y: number) {
    const rows = [".###.", "#####", "#.#.#", "#####", "#.#.#"];
    g.fillStyle = C.ghost;
    rows.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && g.fillRect(x + c, y + r, 1, 1)));
  }
}
