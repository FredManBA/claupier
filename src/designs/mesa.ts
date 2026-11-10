// Mesa «El crupier». Se lee de arriba abajo:
//   marquesina — las bombillas son lo que te queda de la semana
//   lámpara    — la luz de estado del plan
//   pozo       — el gasto del periodo, en fichas por denominación
//   rastrillo  — cuando baja tu banca, el crupier se lleva tus fichas al pozo
//   tu banca   — tus fichas de la ventana de 5 h, del lado del jugador
//   placa      — dinero y tokens del periodo

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
import { CHIP_H, CHIP_STEP, chipSprites, drawChip, drawText, textWidth } from "../core/pixel";
import { DENOMS, Stack, chipsFor } from "../core/stack";
import type { LimitWindow, Snapshot } from "../core/types";
import type { Design, DesignContext } from "./design";

const W = 100;
const H = 156;

const C = {
  ink: "#0b1a12",
  rail: "#5a3a22",
  railLight: "#8a5a32",
  trim: "#c99a3e",
  trimDark: "#7d5a1e",
  felt: "#1a4532",
  feltDark: "#143a2a",
  feltEdge: "#123326",
  sign: "#3a1418",
  signDark: "#260c10",
  bulbOn: "#ffcf5a",
  bulbBright: "#ffe08a",
  bulbOff: "#4a2a20",
  cream: "#f1e6c8",
  dim: "#86b39a",
  gold: "#f0b64e",
  warn: "#f0a24a",
  bad: "#e56a5f",
  ok: "#6fdc8c",
  ghost: "#cfe3ff",
  brass: "#b8862f",
  brassLight: "#d9a948",
  brassDark: "#6e4c16",
  wood: "#a8743e",
  woodDark: "#5a3a22",
};

// Geometría
const MARQUEE = { x: 4, y: 4, w: 92, h: 27 };
const BULBS = 10;
const LAMP_X = 50;
const POT_BASE = 84;
const BANK_BASE = 125;
const BANK_X = [8, 26];
const PLATE = { x: 6, y: 132, w: 88, h: 17 };
/** Dónde descansa la cabeza del rastrillo, del lado del crupier. */
const RAKE_REST = { x: 74, y: 37 };
const RAKE_DROP = { x: 46, y: 68 };

const REACH_MS = 380;
const DRAG_MS = 520;
const RETURN_MS = 320;
const CHASE_MS = 450;

interface RakeTrip {
  phase: "reach" | "drag" | "return";
  start: number;
  /** Fichas que se lleva en este viaje. */
  take: number;
  /** Desde dónde las agarra. */
  from: { x: number; y: number };
}

const ease = (t: number) => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Mesa implements Design {
  readonly id = "mesa" as const;
  readonly width = W;
  readonly height = H;

  private pot = DENOMS.map((d, i) => new Stack(4 + i * 19, POT_BASE, d.palette, 8, C.feltDark));
  private bank = BANK_X.map((x) => new Stack(x, BANK_BASE, "bank", 5, C.feltDark));
  private snap: Snapshot | null = null;
  private ctx: DesignContext | null = null;
  /** Fichas de la banca que se ven (sin contar las que el rastrillo ya se llevó). */
  private bankChips = 0;
  /** Fichas que el rastrillo todavía tiene que llevarse. */
  private pendingTake = 0;
  private trip: RakeTrip | null = null;
  private shownCost = 0;
  private costFrom = 0;
  private costTo = 0;
  private costStart = 0;
  private nextFlip = 0;
  private chaseStep = 0;
  private nextChase = 0;

  constructor() {
    for (const s of this.pot) s.onLand = () => this.ctx?.cue("chip");
  }

  // ── Datos ────────────────────────────────────────────────────────────────

  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean) {
    this.ctx = ctx;
    const motion = first ? "instant" : ctx.motion;
    const shows = ctx.settings.bankShows;

    const v = bankValue(snap.plan.fiveHour, shows);
    const target = v === null ? 0 : Math.max(0, Math.min(10, Math.ceil(v / 10)));
    const showing = this.bankChips - this.pendingTake;
    if (motion === "full" && shows === "left" && target < showing) {
      // El crupier se las lleva con el rastrillo.
      this.pendingTake += showing - target;
    } else {
      this.pendingTake = 0;
      this.trip = null;
      this.setBank(target, now, motion);
    }

    const cost = periodTotals(snap, ctx.settings.period).costUsd;
    chipsFor(cost).forEach((n, i) => this.pot[i].setTarget(n, now, motion));
    this.costFrom = this.shownCost;
    this.costTo = cost;
    this.costStart = now;
    if (motion !== "full") this.shownCost = cost;
    this.snap = snap;
  }

  private setBank(n: number, now: number, motion: Parameters<Stack["setTarget"]>[2]) {
    this.bankChips = n;
    this.bank[0].setTarget(Math.min(5, n), now, motion);
    this.bank[1].setTarget(Math.max(0, n - 5), now, motion);
  }

  /** Posición de la ficha de arriba de tu banca. */
  private bankTop() {
    const n = this.bankChips;
    const stack = n > 5 ? this.bank[1] : this.bank[0];
    const i = Math.max(0, (n > 5 ? n - 5 : n) - 1);
    return { x: stack.x + 8, y: stack.chipY(i) + 2 };
  }

  // ── Animación ────────────────────────────────────────────────────────────

  update(now: number): boolean {
    let busy = false;
    for (const s of [...this.pot, ...this.bank]) busy = s.update(now) || busy;

    // Rastrillo
    if (!this.trip && this.pendingTake > 0) {
      this.trip = { phase: "reach", start: now, take: this.pendingTake, from: this.bankTop() };
      this.ctx?.cue("rake");
    }
    if (this.trip) {
      busy = true;
      const t = now - this.trip.start;
      if (this.trip.phase === "reach" && t >= REACH_MS) {
        // Agarra las fichas: desaparecen de tu banca y viajan en el rastrillo.
        this.setBank(this.bankChips - this.trip.take, now, "instant");
        this.pendingTake -= this.trip.take;
        this.trip = { ...this.trip, phase: "drag", start: now };
      } else if (this.trip.phase === "drag" && t >= DRAG_MS) {
        this.ctx?.cue("chip");
        this.trip = { ...this.trip, phase: "return", start: now };
      } else if (this.trip.phase === "return" && t >= RETURN_MS) {
        this.trip = null;
      }
    }

    // El monto cuenta hasta el valor nuevo.
    if (this.shownCost !== this.costTo) {
      const t = Math.min(1, (now - this.costStart) / 600);
      this.shownCost = t >= 1 ? this.costTo : lerp(this.costFrom, this.costTo, ease(t));
      busy = true;
    }

    if (this.ctx?.motion === "full") {
      // Recorrido lento de las bombillas encendidas.
      if (now >= this.nextChase) {
        this.chaseStep++;
        this.nextChase = now + CHASE_MS;
      }
      // De vez en cuando gira la ficha de arriba de alguna pila.
      if (now >= this.nextFlip) {
        if (this.nextFlip !== 0) {
          const pick = [...this.pot, ...this.bank]
            .map((s) => s.topRestingChip())
            .filter((c) => c !== undefined)
            .sort(() => Math.random() - 0.5)[0];
          if (pick) {
            pick.flipStart = now;
            busy = true;
          }
        }
        this.nextFlip = now + 5000 + Math.random() * 5000;
      }
    }
    return busy;
  }

  msUntilIdleEvent(now: number): number {
    if (this.ctx?.motion !== "full") return 30_000;
    return Math.max(0, Math.min(this.nextFlip, this.nextChase) - now);
  }

  // ── Dibujo ───────────────────────────────────────────────────────────────

  draw(g: CanvasRenderingContext2D, now: number) {
    g.clearRect(0, 0, W, H);
    const snap = this.snap;
    const plan = snap?.plan;
    const settings = this.ctx?.settings;
    const shows = settings?.bankShows ?? "left";

    this.drawTable(g);
    this.drawMarquee(g, plan?.sevenDay, plan?.status);
    this.drawLamp(g, plan?.status);
    if (snap?.ghost) this.drawGhost(g, 89, 34);

    // Pozo
    const period = settings?.period ?? "today";
    drawText(g, `POZO ${PERIOD_LABEL[period]}`, 8, 39, C.dim);
    for (const s of this.pot) {
      const extra = s.count - s.maxVisible;
      if (extra > 0) {
        const label = `+${extra}`;
        drawText(g, label, s.x + 8 - Math.floor(textWidth(label) / 2), 46, C.gold);
      }
      s.draw(g, now);
    }

    // Línea de apuestas
    g.fillStyle = C.trimDark;
    for (let x = 8; x < W - 8; x += 2) g.fillRect(x, 89, 1, 1);

    // Tu banca
    drawText(g, shows === "used" ? "USADO 5H" : "TU BANCA 5H", 8, 93, C.dim);
    const palette = (["bank", "bankWarn", "bankBad"] as const)[bankUrgency(plan?.fiveHour)];
    for (const s of this.bank) s.draw(g, now, palette);
    this.drawBankText(g, plan?.fiveHour, plan?.status);

    this.drawRake(g, now, palette);
    this.drawPlate(g, snap);
  }

  private drawTable(g: CanvasRenderingContext2D) {
    const rect = (x: number, y: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, w, h);
    };
    // Baranda de madera con esquinas en escalón
    const rounded = (inset: number, c: string) => {
      const x0 = inset, y0 = inset, w = W - inset * 2, h = H - inset * 2;
      rect(x0 + 2, y0, w - 4, h, c);
      rect(x0 + 1, y0 + 1, w - 2, h - 2, c);
      rect(x0, y0 + 2, w, h - 4, c);
    };
    rounded(0, C.ink);
    rounded(1, C.rail);
    rect(3, 2, W - 6, 1, C.railLight);
    rounded(3, C.ink);
    rounded(4, C.felt);

    // Paño: textura de puntos y bordes un poco más oscuros (sin movimiento)
    g.fillStyle = C.feltDark;
    for (let y = 6; y < H - 5; y += 4) {
      for (let x = 6 + ((y / 4) % 2) * 2; x < W - 5; x += 4) g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = C.feltEdge;
    rect(5, 5, W - 10, 1, C.feltEdge);
    rect(5, H - 6, W - 10, 1, C.feltEdge);
    rect(5, 5, 1, H - 10, C.feltEdge);
    rect(W - 6, 5, 1, H - 10, C.feltEdge);
  }

  private drawMarquee(g: CanvasRenderingContext2D, week: LimitWindow | null | undefined, status: string | undefined) {
    const { x, y, w, h } = MARQUEE;
    g.fillStyle = C.ink;
    g.fillRect(x, y, w, h);
    g.fillStyle = C.trim;
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle = C.sign;
    g.fillRect(x + 2, y + 2, w - 4, h - 4);
    g.fillStyle = C.signDark;
    g.fillRect(x + 2, y + h - 3, w - 4, 1);

    // Bombillas: lo que queda (o lo usado) de la semana, 10 % cada una
    const shows = this.ctx?.settings.bankShows ?? "left";
    const v = bankValue(week, shows);
    const lit = v === null ? 0 : Math.max(0, Math.min(BULBS, Math.ceil(v / 10)));
    const chase = this.ctx?.motion === "full" && lit > 0 ? this.chaseStep % lit : -1;
    for (let i = 0; i < BULBS; i++) {
      const bx = x + 6 + i * 9;
      const by = y + 4;
      const on = i < lit;
      g.fillStyle = C.ink;
      g.fillRect(bx - 1, by - 1, 5, 5);
      g.fillStyle = on ? (i === chase ? C.bulbBright : C.bulbOn) : C.bulbOff;
      g.fillRect(bx, by, 3, 3);
      if (on) {
        g.fillStyle = C.bulbBright;
        g.fillRect(bx, by, 1, 1);
      }
    }

    // Texto: el nombre y, debajo, la semana
    const center = (text: string) => x + Math.floor((w - textWidth(text)) / 2);
    drawText(g, "CLAUPIER", center("CLAUPIER"), y + 10, C.gold);
    const label = v === null ? STATUS_TEXT[status ?? "loading"]?.[0] || "..." : `SEM ${v}%`;
    const reset = v === null ? "" : formatReset(week?.resetsAt);
    const line = reset ? `${label}  @${reset}` : label;
    const color = v === null ? C.warn : [C.cream, C.warn, C.bad][bankUrgency(week)];
    drawText(g, line, center(line), y + 17, color);
  }

  private drawLamp(g: CanvasRenderingContext2D, status: string | undefined) {
    const color = status === "ok" ? C.ok : status === "loading" || !status ? C.dim : status === "rate_limited" ? C.warn : C.bad;
    g.fillStyle = C.ink;
    g.fillRect(LAMP_X, 31, 1, 2); // cable
    g.fillRect(LAMP_X - 3, 33, 7, 3); // pantalla
    g.fillStyle = C.brassDark;
    g.fillRect(LAMP_X - 2, 33, 5, 2);
    g.fillStyle = color;
    g.fillRect(LAMP_X - 1, 35, 3, 1); // luz
  }

  private drawBankText(g: CanvasRenderingContext2D, win: LimitWindow | null | undefined, status: string | undefined) {
    const x = 48;
    const value = bankValue(win, this.ctx?.settings.bankShows ?? "left");
    if (value === null) {
      const [a, b] = STATUS_TEXT[status ?? "loading"] ?? STATUS_TEXT.loading;
      drawText(g, a || "...", x, 104, C.warn);
      if (b) drawText(g, b, x, 111, C.warn);
      return;
    }
    const color = [C.cream, C.warn, C.bad][bankUrgency(win)];
    drawText(g, `${value}%`, x, 102, color, 2);
    const reset = formatReset(win?.resetsAt);
    if (reset) drawText(g, `@${reset}`, x, 116, C.dim);
  }

  private drawRake(g: CanvasRenderingContext2D, now: number, palette: Parameters<typeof chipSprites>[0]) {
    let head = RAKE_REST;
    let carrying = 0;
    const trip = this.trip;
    if (trip) {
      const t = Math.min(1, (now - trip.start) / { reach: REACH_MS, drag: DRAG_MS, return: RETURN_MS }[trip.phase]);
      const k = ease(t);
      if (trip.phase === "reach") head = { x: lerp(RAKE_REST.x, trip.from.x, k), y: lerp(RAKE_REST.y, trip.from.y, k) };
      else if (trip.phase === "drag") {
        head = { x: lerp(trip.from.x, RAKE_DROP.x, k), y: lerp(trip.from.y, RAKE_DROP.y, k) };
        carrying = trip.take;
      } else head = { x: lerp(RAKE_DROP.x, RAKE_REST.x, k), y: lerp(RAKE_DROP.y, RAKE_REST.y, k) };
    }
    const hx = Math.round(head.x);
    const hy = Math.round(head.y);

    // Fichas que arrastra, delante de la cabeza del rastrillo
    if (carrying > 0) {
      const sprites = chipSprites(palette);
      const shown = Math.min(3, carrying);
      for (let i = 0; i < shown; i++) drawChip(g, sprites, hx - 8, hy + 2 - CHIP_H - i * CHIP_STEP + 6);
    }

    // Mango: del centro de la cabeza hacia la esquina del crupier
    const endX = W - 6;
    const endY = 32;
    const steps = Math.max(Math.abs(endX - hx), Math.abs(endY - hy));
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(lerp(hx, endX, i / steps));
      const py = Math.round(lerp(hy - 1, endY, i / steps));
      g.fillStyle = C.ink;
      g.fillRect(px, py + 1, 1, 1);
      g.fillStyle = C.wood;
      g.fillRect(px, py, 1, 1);
    }
    // Cabeza
    g.fillStyle = C.ink;
    g.fillRect(hx - 8, hy - 1, 16, 4);
    g.fillStyle = C.wood;
    g.fillRect(hx - 7, hy, 14, 1);
    g.fillStyle = C.woodDark;
    g.fillRect(hx - 7, hy + 1, 14, 1);
  }

  private drawPlate(g: CanvasRenderingContext2D, snap: Snapshot | null) {
    const { x, y, w, h } = PLATE;
    g.fillStyle = C.ink;
    g.fillRect(x, y, w, h);
    g.fillStyle = C.brassDark;
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle = C.brass;
    g.fillRect(x + 1, y + 1, w - 2, h - 3);
    g.fillStyle = C.brassLight;
    g.fillRect(x + 1, y + 1, w - 2, 1);
    // Tornillos
    g.fillStyle = C.brassDark;
    for (const sx of [x + 2, x + w - 3]) {
      g.fillRect(sx, y + 3, 1, 1);
      g.fillRect(sx, y + h - 5, 1, 1);
    }

    const settings = this.ctx?.settings;
    const money = settings ? formatMoney(this.shownCost, settings) : "";
    drawText(g, money, x + 5, y + 6, C.ink);
    const totals = snap && settings ? periodTotals(snap, settings.period) : null;
    const tokens = `${formatTokens(totals?.totalTokens ?? 0)} TOK`;
    drawText(g, tokens, x + w - 5 - textWidth(tokens), y + 6, C.brassDark);
  }

  private drawGhost(g: CanvasRenderingContext2D, x: number, y: number) {
    const rows = [".###.", "#####", "#.#.#", "#####", "#.#.#"];
    g.fillStyle = C.ghost;
    rows.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && g.fillRect(x + c, y + r, 1, 1)));
  }
}
