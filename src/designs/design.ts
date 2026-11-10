import type { DesignId, Motion, Settings, Snapshot } from "../core/types";

/** Señales de sonido. Los diseños las emiten; `core/sound.ts` decide si suenan. */
export type Cue = "chip" | "reel" | "lever" | "ball" | "rake";

export interface DesignContext {
  settings: Settings;
  /** Nivel de animación efectivo: ya tiene en cuenta prefers-reduced-motion. */
  motion: Motion;
  cue(name: Cue): void;
}

export interface Design {
  readonly id: DesignId;
  /** Tamaño en píxeles lógicos del arte, antes de escalar. */
  readonly width: number;
  readonly height: number;
  /**
   * Recibe datos nuevos o ajustes nuevos. `first` es `true` la primera vez,
   * para entrar sin animar.
   */
  setSnapshot(snap: Snapshot, ctx: DesignContext, now: number, first: boolean): void;
  /** Avanza un fotograma. Devuelve `true` si hay que seguir animando. */
  update(now: number): boolean;
  draw(g: CanvasRenderingContext2D, now: number): void;
  /** Milisegundos hasta el próximo evento sin datos nuevos (un giro, la cuenta atrás). */
  msUntilIdleEvent(now: number): number;
}

export interface DesignInfo {
  id: DesignId;
  name: string;
  description: string;
  ready: boolean;
  create(): Design;
}
