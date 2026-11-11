// Dibuja un diseño en un canvas: arte a resolución baja, escalado con
// píxeles enteros y un bucle que solo trabaja cuando algo se mueve.
// Lo usan la mesa (main.ts) y las vistas previas de los ajustes.

import type { Design, DesignContext } from "../designs/design";
import { beginTextCapture, endTextCapture, paintTextCommands } from "./font";
import type { Motion, Snapshot } from "./types";

/** Si Windows pide reducir el movimiento, la animación completa pasa a reducida. */
export function effectiveMotion(motion: Motion, prefersReduced: boolean): Motion {
  return motion === "full" && prefersReduced ? "reduced" : motion;
}

export class DesignView {
  private ctx: CanvasRenderingContext2D;
  private low = document.createElement("canvas");
  private lowCtx = this.low.getContext("2d")!;
  private k = 1;
  /**
   * Con una escala que no es entera (1,5×, 2,5× o la pantalla al 125 %), el arte
   * se amplía primero a la escala entera de arriba, sin suavizar, y después se
   * reduce suavizando: así todos los píxeles miden lo mismo.
   */
  private mid: HTMLCanvasElement | null = null;
  private frameQueued = false;
  private wakeTimer: number | undefined;
  private paused = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private design: Design,
    /** Escala lógica (de 1 a 4, con medios) antes de multiplicar por el DPR. */
    private scale: number,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.fit();
  }

  /** Tamaño del canvas en píxeles físicos. */
  get physicalSize() {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  setDesign(design: Design) {
    this.design = design;
    this.fit();
  }

  setScale(scale: number) {
    this.scale = scale;
    this.fit();
  }

  /** Ajusta el canvas a la escala y al DPR actuales. */
  fit() {
    const dpr = window.devicePixelRatio || 1;
    // Casi entero (por ejemplo 3× con la pantalla al 100 % o 2× al 150 %): se
    // redondea para que quede nítido. Si no, se usa tal cual.
    const exact = Math.max(1, this.scale * dpr);
    this.k = Math.abs(exact - Math.round(exact)) < 0.13 ? Math.round(exact) : exact;
    const { width, height } = this.design;
    this.low.width = width;
    this.low.height = height;
    this.canvas.width = Math.round(width * this.k);
    this.canvas.height = Math.round(height * this.k);
    this.canvas.style.width = `${this.canvas.width / dpr}px`;
    this.canvas.style.height = `${this.canvas.height / dpr}px`;
    if (Number.isInteger(this.k)) {
      this.mid = null;
    } else {
      const up = Math.ceil(this.k);
      this.mid ??= document.createElement("canvas");
      this.mid.width = width * up;
      this.mid.height = height * up;
    }
    this.requestFrame();
  }

  feed(snap: Snapshot, ctx: DesignContext, first: boolean) {
    this.design.setSnapshot(snap, ctx, performance.now(), first);
    this.requestFrame();
  }

  requestFrame() {
    if (this.frameQueued || this.paused) return;
    this.frameQueued = true;
    requestAnimationFrame((now) => this.frame(now));
  }

  /** En pausa no dibuja ni programa nada; al reanudar dibuja el estado actual. */
  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    window.clearTimeout(this.wakeTimer);
    if (!paused) this.requestFrame();
  }

  private frame(now: number) {
    this.frameQueued = false;
    const busy = this.design.update(now);
    // Con texto normal, el diseño apunta sus textos y se pintan aquí encima a
    // resolución real, en vez de escalar los píxeles.
    const texts = beginTextCapture(this.lowCtx);
    try {
      this.design.draw(this.lowCtx, now);
    } finally {
      endTextCapture();
    }
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.mid) {
      const m = this.mid.getContext("2d")!;
      m.imageSmoothingEnabled = false;
      m.clearRect(0, 0, this.mid.width, this.mid.height);
      m.drawImage(this.low, 0, 0, this.mid.width, this.mid.height);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(this.mid, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      g.imageSmoothingEnabled = false;
      g.drawImage(this.low, 0, 0, this.canvas.width, this.canvas.height);
    }
    paintTextCommands(this.ctx, texts, this.k);

    if (busy) {
      this.requestFrame();
    } else {
      // Dormir hasta el próximo evento o, como mucho, 30 s (para la cuenta atrás).
      window.clearTimeout(this.wakeTimer);
      const wait = Math.min(30_000, this.design.msUntilIdleEvent(performance.now()) + 16);
      this.wakeTimer = window.setTimeout(() => this.requestFrame(), wait);
    }
  }
}
