import type { MusicOutput } from "./soundManager";

/**
 * Adaptive music, synthesized like everything else. One piece in D minor
 * (i – VI – iv – V, 72 bpm) arranged in layers that fade in and out with
 * how much danger the player is in:
 *
 *   pad      — slow chords; the bed under everything
 *   bells    — sparse music-box notes (calm exploration)
 *   tension  — a low pulse and a high, clashing string drone (something is looking for you)
 *   chase    — drums and a driving bass (something has found you)
 *
 * All layers follow one clock, so they always fit together however they're
 * mixed. Outside a level the music is silent and the menus are left to the
 * ambient drone (see `SoundManager`).
 */
export type MusicMode = "silent" | "game";

export interface MusicMix {
  pad: number;
  bells: number;
  tension: number;
  chase: number;
}

const BPM = 72;
const STEP = 60 / BPM / 4; // a sixteenth note
const STEPS = 64; // four bars
const LOOKAHEAD = 0.25;

/** MIDI notes of each bar's chord: Dm, B♭, Gm, A. */
const CHORDS = [
  [50, 53, 57],
  [46, 50, 53],
  [43, 46, 50],
  [45, 49, 52],
];

/** Balance between layers at full mix. */
const LAYER_LEVEL: MusicMix = { pad: 1, bells: 1, tension: 1, chase: 0.9 };

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Seconds the chase music keeps going after the last creature stops hunting you. */
const CHASE_HOLD = 5;
const RISE_PER_SEC = 1.6;
const FALL_PER_SEC = 0.12;

/**
 * Smooths the raw threat (0 = unseen, ~0.6 = something is suspicious or
 * searching, 1 = hunted) into a music intensity: rises fast, falls slowly,
 * and holds at full for a few seconds after a chase ends so the music
 * doesn't flap on and off.
 */
export class IntensityTracker {
  level = 0;
  private hold = 0;

  update(dt: number, threat: number): number {
    this.hold = threat >= 1 ? CHASE_HOLD : Math.max(0, this.hold - dt);
    const target = this.hold > 0 ? 1 : Math.min(1, Math.max(0, threat));
    const rate = target > this.level ? RISE_PER_SEC : FALL_PER_SEC;
    this.level += Math.max(-rate * dt, Math.min(rate * dt, target - this.level));
    return this.level;
  }

  reset(): void {
    this.level = 0;
    this.hold = 0;
  }
}

/** How loud each layer should be. Pure, so it can be tested. */
export function mixFor(mode: MusicMode, intensity: number): MusicMix {
  if (mode === "silent") return { pad: 0, bells: 0, tension: 0, chase: 0 };
  const tension = smoothstep(0.2, 0.55, intensity);
  const chase = smoothstep(0.8, 0.97, intensity);
  const calm = 1 - smoothstep(0.3, 0.7, intensity);
  return { pad: Math.min(1, calm * 0.9 + tension * 0.4), bells: calm, tension: tension * (1 - chase * 0.3), chase };
}

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class MusicDirector {
  private out: MusicOutput | null = null;
  private layers: Record<keyof MusicMix, GainNode> | null = null;
  private mode: MusicMode = "silent";
  private readonly intensity = new IntensityTracker();
  private mix: MusicMix = mixFor("silent", 0);
  private step = 0;
  private nextStepTime = 0;

  /** Called once the audio context exists. */
  attach(out: MusicOutput): void {
    this.out = out;
    const make = () => {
      const g = out.ctx.createGain();
      g.gain.value = 0;
      g.connect(out.out);
      return g;
    };
    this.layers = { pad: make(), bells: make(), tension: make(), chase: make() };
    this.nextStepTime = out.ctx.currentTime + 0.1;
  }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    // Coming into a level starts calm, whatever happened last time.
    if (mode === "game") this.intensity.reset();
    this.mode = mode;
  }

  get level(): number {
    return this.intensity.level;
  }

  /** Call every frame. `threat` only matters in game mode. */
  update(dt: number, threat = 0): void {
    const level = this.mode === "game" ? this.intensity.update(dt, threat) : this.intensity.level;
    this.mix = mixFor(this.mode, level);
    if (!this.out || !this.layers) return;
    const ctx = this.out.ctx;
    const now = ctx.currentTime;
    for (const k of Object.keys(this.layers) as (keyof MusicMix)[]) {
      // The chase kicks in fast; everything else drifts.
      const tc = k === "chase" && this.mix.chase > this.layers.chase.gain.value ? 0.25 : 1.2;
      this.layers[k].gain.setTargetAtTime(this.mix[k] * LAYER_LEVEL[k], now, tc);
    }
    if (ctx.state !== "running") return;
    // After the tab was hidden the clock jumps; don't try to catch up.
    if (this.nextStepTime < now - 0.5) this.nextStepTime = now + 0.05;
    while (this.nextStepTime < now + LOOKAHEAD) {
      this.schedule(this.step, this.nextStepTime);
      this.step = (this.step + 1) % STEPS;
      this.nextStepTime += STEP;
    }
  }

  private schedule(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = CHORDS[bar];
    const m = this.mix;
    const L = this.layers!;
    if (s === 0 && m.pad > 0.01) this.pad(L.pad, chord, t, 16 * STEP);
    if (m.bells > 0.01 && s % 4 === 0 && Math.random() < 0.28) {
      this.bell(L.bells, chord[Math.floor(Math.random() * 3)] + 24, t, 0.5);
    }
    if (m.tension > 0.01) {
      if (s % 2 === 0) this.pulse(L.tension, chord[0] - 12, t, s % 8 === 0 ? 1 : 0.55);
      if (s === 0) this.strings(L.tension, chord[0] + 24, t, 16 * STEP);
    }
    if (m.chase > 0.01) {
      if (s % 4 === 0) this.kick(L.chase, t);
      if (s === 4 || s === 12) this.snare(L.chase, t);
      this.hat(L.chase, t, s % 2 === 1 ? 1 : 0.45);
      this.bass(L.chase, chord[0] - 12 + (s % 4 === 2 ? 12 : 0), t);
      if (s === 0) this.stab(L.chase, chord, t);
    }
  }

  // ---------------------------------------------------------------- voices

  private env(g: GainNode, t: number, peak: number, attack: number, hold: number, release: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  private osc(dest: AudioNode, type: OscillatorType, f: number, t: number, dur: number, detune = 0): OscillatorNode {
    const o = this.out!.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.1);
    return o;
  }

  private noise(dest: AudioNode, t: number, dur: number): void {
    const src = this.out!.ctx.createBufferSource();
    src.buffer = this.out!.noise;
    src.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private filter(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const b = this.out!.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  private gain(dest: AudioNode): GainNode {
    const g = this.out!.ctx.createGain();
    g.connect(dest);
    return g;
  }

  private pad(dest: AudioNode, chord: number[], t: number, dur: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.05, 1.4, dur - 1.4, 2);
    const lp = this.filter("lowpass", 700);
    lp.connect(g);
    for (const n of chord) for (const d of [-7, 7]) this.osc(lp, "sawtooth", freq(n), t, dur + 2, d);
    this.osc(lp, "sine", freq(chord[0] - 12), t, dur + 2);
  }

  private bell(dest: AudioNode, note: number, t: number, vol: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.09 * vol, 0.005, 0, 2.4);
    this.osc(g, "sine", freq(note), t, 2.5);
    const h = this.gain(g);
    h.gain.value = 0.25;
    this.osc(h, "triangle", freq(note + 12), t, 2.5);
  }

  private pulse(dest: AudioNode, note: number, t: number, vol: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.16 * vol, 0.005, 0.02, 0.22);
    const lp = this.filter("lowpass", 260);
    lp.connect(g);
    this.osc(lp, "sawtooth", freq(note), t, 0.3);
    this.osc(g, "sine", freq(note), t, 0.3);
  }

  /** A high cluster a semitone apart, trembling. */
  private strings(dest: AudioNode, note: number, t: number, dur: number): void {
    const ctx = this.out!.ctx;
    const g = this.gain(dest);
    this.env(g, t, 0.022, 0.8, dur - 0.8, 1.2);
    const bp = this.filter("bandpass", 1600, 0.8);
    bp.connect(g);
    for (const n of [note, note + 1]) this.osc(bp, "sawtooth", freq(n), t, dur + 1.2, (Math.random() - 0.5) * 10);
    const trem = ctx.createOscillator();
    trem.frequency.value = 6.5;
    const tg = ctx.createGain();
    tg.gain.value = 0.012;
    trem.connect(tg).connect(g.gain);
    trem.start(t);
    trem.stop(t + dur + 1.3);
  }

  private kick(dest: AudioNode, t: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.4, 0.003, 0, 0.3);
    const o = this.osc(g, "sine", 120, t, 0.35);
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
  }

  private snare(dest: AudioNode, t: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.16, 0.002, 0, 0.16);
    const bp = this.filter("bandpass", 1900, 0.9);
    bp.connect(g);
    this.noise(bp, t, 0.2);
    const tg = this.gain(dest);
    this.env(tg, t, 0.08, 0.002, 0, 0.08);
    this.osc(tg, "triangle", 190, t, 0.1);
  }

  private hat(dest: AudioNode, t: number, vol: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.035 * vol, 0.001, 0, 0.04);
    const hp = this.filter("highpass", 7000);
    hp.connect(g);
    this.noise(hp, t, 0.06);
  }

  private bass(dest: AudioNode, note: number, t: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.1, 0.004, 0.03, 0.1);
    const lp = this.filter("lowpass", 900, 4);
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.13);
    lp.connect(g);
    this.osc(lp, "sawtooth", freq(note), t, 0.18);
  }

  private stab(dest: AudioNode, chord: number[], t: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.05, 0.005, 0.05, 0.35);
    const lp = this.filter("lowpass", 1800);
    lp.connect(g);
    for (const n of chord) this.osc(lp, "sawtooth", freq(n + 12), t, 0.5);
  }
}
