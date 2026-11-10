// Sonidos sintetizados con WebAudio: sin archivos ni licencias que revisar.
//
// La ficha suena como una moneda: tres resonancias de metal y un clic corto.
// Un pasa bajos general (5,2 kHz) quita el brillo que cansa.

import type { Cue } from "../designs/design";
import type { Settings } from "./types";

/** Separación mínima entre dos sonidos iguales, para que no se amontonen. */
const MIN_GAP_MS: Record<Cue, number> = { chip: 45, reel: 35, lever: 300, ball: 70, bag: 300 };

/** [frecuencia Hz, ganancia relativa, caída en s] de cada resonancia. */
type Mode = [number, number, number];

/**
 * Moneda: un «ting» metálico. Las proporciones 1 : 2,76 : 5,40 son las de un
 * disco de metal que vibra libre, y le dan el timbre de moneda. El parcial más
 * alto queda casi entero bajo el pasa bajos, así que no pincha.
 */
const COIN: Mode[] = [
  [1, 1.0, 0.22],
  [2.76, 0.35, 0.11],
  [5.4, 0.12, 0.05],
];
const COIN_BASE_HZ = 1180;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  /** Entrada de la cadena: pasa bajos → volumen maestro → altavoces. */
  private out: AudioNode | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last: Partial<Record<Cue, number>> = {};
  private enabled = false;
  private volume = 0.5;
  private muteInGame = true;
  private quiet = false;

  configure(sound: Settings["sound"], quiet: boolean) {
    this.enabled = sound.enabled;
    this.volume = sound.volume;
    this.muteInGame = sound.muteInGame;
    this.quiet = quiet;
    if (this.master) this.master.gain.value = this.masterGain();
  }

  private masterGain() {
    return this.volume * 0.6;
  }

  get audible() {
    return this.enabled && this.volume > 0 && !(this.muteInGame && this.quiet);
  }

  private setup(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 5200;
      lowpass.Q.value = 0.5;
      const master = ctx.createGain();
      master.gain.value = this.masterGain();
      lowpass.connect(master).connect(ctx.destination);

      const noise = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      this.ctx = ctx;
      this.out = lowpass;
      this.master = master;
      this.noise = noise;
      return ctx;
    } catch {
      return null;
    }
  }

  /** Suena aunque el sonido esté apagado: para probar desde los ajustes. */
  preview(cue: Cue) {
    const prev = { enabled: this.enabled, quiet: this.quiet };
    this.enabled = true;
    this.quiet = false;
    this.last[cue] = undefined;
    this.play(cue);
    this.enabled = prev.enabled;
    this.quiet = prev.quiet;
  }

  play(cue: Cue) {
    if (!this.audible) return;
    const now = performance.now();
    if (now - (this.last[cue] ?? -Infinity) < MIN_GAP_MS[cue]) return;
    this.last[cue] = now;

    const ctx = this.setup();
    if (!ctx || !this.out) return;
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime + 0.005;
    const jitter = 0.95 + Math.random() * 0.1;

    switch (cue) {
      case "chip":
        this.coin(t, COIN_BASE_HZ * jitter);
        break;
      case "reel":
        this.tone(t, "square", 240 * jitter, 200 * jitter, 0.018, 0.05);
        break;
      case "lever":
        this.tone(t, "sine", 140, 60, 0.16, 0.35);
        this.noiseHit(t, 0.08, 500, 0.8, 0.2);
        break;
      case "ball":
        this.modal(t, [[1320 * jitter, 1, 0.02], [2050 * jitter, 0.4, 0.012]], 0.18);
        break;
      case "bag":
        // «Cha-ching»: tres monedas seguidas que caen en la bolsa.
        [0, 0.06, 0.12].forEach((dt, i) => this.coin(t + dt, COIN_BASE_HZ * [0.92, 1, 0.86][i] * jitter, 1 - i * 0.2));
        break;
    }
  }

  private coin(t: number, base: number, level = 1) {
    this.modal(t, COIN.map(([ratio, gain, decay]): Mode => [base * ratio, gain, decay]), 0.32 * level);
    this.noiseHit(t, 0.005, 3000, 0.8, 0.12 * level); // contacto
  }

  /** Varias resonancias senoidales con caída exponencial muy corta. */
  private modal(t: number, modes: Mode[], gain: number) {
    const ctx = this.ctx!;
    for (const [freq, rel, decay] of modes) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * rel), t + 0.0015);
      env.gain.exponentialRampToValueAtTime(0.0001, t + decay * 4);
      osc.connect(env).connect(this.out!);
      osc.start(t);
      osc.stop(t + decay * 4 + 0.02);
    }
  }

  private tone(t: number, type: OscillatorType, from: number, to: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.out!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseHit(t: number, dur: number, freq: number, q: number, gain: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq;
    band.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(env).connect(this.out!);
    src.start(t, Math.random() * 0.2);
    src.stop(t + dur + 0.02);
  }
}
