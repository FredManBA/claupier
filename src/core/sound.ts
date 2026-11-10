// Sonidos sintetizados con WebAudio: sin archivos ni licencias que revisar.
//
// La ficha usa síntesis modal: una ficha de casino que cae sobre otra suena
// como un golpe seco con unas pocas resonancias inarmónicas que se apagan en
// milisegundos, más uno o dos rebotes al asentarse. Un pasa bajos general
// (5,2 kHz) quita el brillo que cansa sin perder el «clac».

import type { Cue } from "../designs/design";
import type { ChipStyle, Settings } from "./types";

/** Separación mínima entre dos sonidos iguales, para que no se amontonen. */
const MIN_GAP_MS: Record<Cue, number> = { chip: 45, reel: 35, lever: 300, ball: 70, rake: 250 };

/** [frecuencia Hz, ganancia relativa, caída en s] de cada resonancia. */
type Mode = [number, number, number];

interface ChipVoice {
  modes: Mode[];
  /** Momento de cada golpe (el primero y los rebotes), en segundos. */
  hits: number[];
  /** Cuánto pierde cada rebote respecto al anterior. */
  bounceLoss: number;
  /** Clic de contacto: frecuencia central del ruido y ganancia. */
  click: [number, number];
  level: number;
}

const CHIP_VOICES: Record<ChipStyle, ChipVoice> = {
  // Arcilla: el «clac» seco y algo apagado de las fichas de casino reales.
  clay: {
    modes: [
      [2280, 1.0, 0.016],
      [3420, 0.55, 0.011],
      [1520, 0.4, 0.022],
      [4150, 0.25, 0.008],
    ],
    hits: [0, 0.028, 0.049, 0.064],
    bounceLoss: 0.42,
    click: [2600, 0.5],
    level: 0.55,
  },
  // Cerámica: más clara y con un poco más de cola.
  ceramic: {
    modes: [
      [2950, 1.0, 0.03],
      [4380, 0.45, 0.02],
      [1980, 0.35, 0.034],
    ],
    hits: [0, 0.036, 0.06],
    bounceLoss: 0.45,
    click: [3200, 0.4],
    level: 0.45,
  },
  // Suave: la misma idea, más grave y amortiguada, para jugar.
  soft: {
    modes: [
      [1650, 1.0, 0.018],
      [2480, 0.45, 0.012],
      [980, 0.4, 0.026],
    ],
    hits: [0, 0.034],
    bounceLoss: 0.4,
    click: [1800, 0.35],
    level: 0.5,
  },
};

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
  private chipStyle: ChipStyle = "clay";

  configure(sound: Settings["sound"], quiet: boolean) {
    this.enabled = sound.enabled;
    this.volume = sound.volume;
    this.muteInGame = sound.muteInGame;
    this.chipStyle = sound.chipStyle ?? "clay";
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
  preview(cue: Cue, style?: ChipStyle) {
    const prev = { enabled: this.enabled, quiet: this.quiet, style: this.chipStyle };
    this.enabled = true;
    this.quiet = false;
    if (style) this.chipStyle = style;
    this.last[cue] = undefined;
    this.play(cue);
    this.enabled = prev.enabled;
    this.quiet = prev.quiet;
    this.chipStyle = prev.style;
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
        this.chip(t, CHIP_VOICES[this.chipStyle], jitter);
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
      case "rake":
        this.noiseSweep(t, 0.18, 400, 1300, 0.14);
        break;
    }
  }

  private chip(t: number, voice: ChipVoice, jitter: number) {
    let amp = voice.level;
    voice.hits.forEach((offset, i) => {
      // Cada rebote cambia un poco el tono, como una ficha que se asienta.
      const detune = jitter * (1 + (i % 2 === 0 ? 0.012 : -0.018) * i);
      const at = t + offset * (0.9 + Math.random() * 0.2);
      const modes = voice.modes.map(([f, g, d]): Mode => [f * detune, g, d * (i === 0 ? 1 : 0.8)]);
      this.modal(at, modes, amp);
      this.noiseHit(at, 0.006, voice.click[0] * detune, 0.9, voice.click[1] * amp);
      amp *= voice.bounceLoss;
    });
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
