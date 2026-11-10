// Sonidos sintetizados con WebAudio: sin archivos ni licencias que revisar.
// Todo pasa por un pasa bajos (~2,5 kHz) para que nada suene agudo, con
// envolventes cortas y volumen moderado.

import type { Cue } from "../designs/design";
import type { Settings } from "./types";

/** Separación mínima entre dos sonidos iguales, para que no se amontonen. */
const MIN_GAP_MS: Record<Cue, number> = { chip: 45, reel: 35, lever: 300, ball: 70, rake: 250 };

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
    return this.volume * 0.55;
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
      lowpass.frequency.value = 2500;
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

  play(cue: Cue) {
    if (!this.audible) return;
    const now = performance.now();
    if (now - (this.last[cue] ?? -Infinity) < MIN_GAP_MS[cue]) return;
    this.last[cue] = now;

    const ctx = this.setup();
    if (!ctx || !this.out) return;
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime + 0.005;
    const jitter = 0.94 + Math.random() * 0.12;

    switch (cue) {
      case "chip":
        // Clic de ficha: un golpe de ruido filtrado y un tono grave que cae.
        this.noiseHit(t, 0.035, 1700 * jitter, 1.4, 0.32);
        this.tone(t, "triangle", 620 * jitter, 380 * jitter, 0.07, 0.12);
        this.noiseHit(t + 0.045, 0.02, 1500 * jitter, 1.6, 0.12); // segundo toque suave
        break;
      case "reel":
        this.tone(t, "square", 240 * jitter, 200 * jitter, 0.018, 0.05);
        break;
      case "lever":
        this.tone(t, "sine", 140, 60, 0.16, 0.35);
        this.noiseHit(t, 0.08, 500, 0.8, 0.2);
        break;
      case "ball":
        this.tone(t, "triangle", 880 * jitter, 760 * jitter, 0.03, 0.08);
        break;
      case "rake":
        this.noiseSweep(t, 0.18, 400, 1300, 0.14);
        break;
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
    env.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(env).connect(this.out!);
    src.start(t, Math.random() * 0.2);
    src.stop(t + dur + 0.02);
  }

  private noiseSweep(t: number, dur: number, from: number, to: number, gain: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(from, t);
    band.frequency.exponentialRampToValueAtTime(to, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + dur * 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(env).connect(this.out!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
