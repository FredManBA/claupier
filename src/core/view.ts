// Dibuja un diseño en un canvas: arte a resolución baja, escalado con
// píxeles enteros y un bucle que solo trabaja cuando algo se mueve.
// Lo usan la mesa (main.ts) y las vistas previas de los ajustes.

import type { Design, DesignContext } from "../designs/design";
import type { Snapshot } from "./types";

export class DesignView {
  private ctx: CanvasRenderingContext2D;
  private low = document.createElement("canvas");
  private lowCtx = this.low.getContext("2d")!;
  private k = 1;
  private frameQueued = false;
  private wakeTimer: number | undefined;
  private stopped = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private design: Design,
    /** Escala lógica (2, 3 o 4) antes de multiplicar por el DPR. */
    private scale: number,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.fit();
  }

  get current() {
    return this.design;
  }

  /** Tamaño del canvas en píxeles físicos. */
  get physicalSize() {
    return { width: this.design.width * this.k, height: this.design.height * this.k };
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
    this.k = Math.max(1, Math.round(this.scale * dpr));
    const { width, height } = this.design;
    this.low.width = width;
    this.low.height = height;
    this.canvas.width = width * this.k;
    this.canvas.height = height * this.k;
    this.canvas.style.width = `${(width * this.k) / dpr}px`;
    this.canvas.style.height = `${(height * this.k) / dpr}px`;
    this.ctx.imageSmoothingEnabled = false;
    this.requestFrame();
  }

  feed(snap: Snapshot, ctx: DesignContext, first: boolean) {
    this.design.setSnapshot(snap, ctx, performance.now(), first);
    this.requestFrame();
  }

  requestFrame() {
    if (this.frameQueued || this.stopped) return;
    this.frameQueued = true;
    requestAnimationFrame((now) => this.frame(now));
  }

  stop() {
    this.stopped = true;
    window.clearTimeout(this.wakeTimer);
  }

  private frame(now: number) {
    this.frameQueued = false;
    const busy = this.design.update(now);
    this.design.draw(this.lowCtx, now);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.low, 0, 0, this.canvas.width, this.canvas.height);

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
