// Curvas de animación y un contador que sube hasta el valor nuevo.

export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const COUNT_MS = 600;

/** Un número que, al cambiar, cuenta hasta el valor nuevo en vez de saltar. */
export class CountUp {
  /** Lo que se muestra ahora. */
  shown = 0;
  /** El valor al que va. */
  target = 0;
  private from = 0;
  private start = 0;

  /** Con `animate = false` salta directo al valor nuevo. */
  set(value: number, now: number, animate: boolean) {
    this.from = this.shown;
    this.target = value;
    this.start = now;
    if (!animate) this.shown = value;
  }

  /** Avanza la cuenta. Devuelve `true` mientras se mueve. */
  update(now: number): boolean {
    if (this.shown === this.target) return false;
    const t = Math.min(1, (now - this.start) / COUNT_MS);
    this.shown = t >= 1 ? this.target : lerp(this.from, this.target, easeOut(t));
    return true;
  }
}
