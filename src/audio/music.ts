import type { MusicOutput } from "./soundManager";

/**
 * Adaptive music, synthesized like everything else. Less a tune than
 * horror sound design on a slow clock (72 bpm, four-bar loop over
 * dissonant low clusters), arranged in layers that fade in and out with
 * how much danger the player is in:
 *
 *   pad      — a low cluster drone that drifts out of tune; the bed under everything
 *   texture  — bowed-metal tones and distant booms (calm exploration)
 *   tension  — a heartbeat and a high, trembling semitone cluster (something is looking for you)
 *   chase    — deep drum hits, a grinding bass, metal scrapes and climbing strings (something has found you)
 *
 * All layers follow one clock, so they always fit together however they're
 * mixed. Outside a level the music is silent and the menus are left to the
 * ambient drone (see `SoundManager`).
 */
export type MusicMode = "silent" | "game";

export interface MusicMix {
  pad: number;
  texture: number;
  tension: number;
  chase: number;
}

const BPM = 72;
const STEP = 60 / BPM / 4; // a sixteenth note
const STEPS = 64; // four bars
const LOOKAHEAD = 0.25;

/**
 * Each bar's cluster (MIDI notes), all low and built from semitones and
 * tritones so nothing ever resolves: D–E♭–A, C♯–D–G♯, D–F–G♯, C–C♯–F♯.
 */
const CLUSTERS = [
  [38, 39, 45],
  [37, 38, 44],
  [38, 41, 44],
  [36, 37, 42],
];

/** Partials of a struck or bowed metal plate: inharmonic, so it never sounds like a note. */
const METAL_PARTIALS: [number, number][] = [
  [1, 1],
  [2.76, 0.5],
  [5.4, 0.25],
  [8.93, 0.12],
];

/** Balance between layers at full mix. */
const LAYER_LEVEL: MusicMix = { pad: 1, texture: 1, tension: 1, chase: 0.9 };

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
  if (mode === "silent") return { pad: 0, texture: 0, tension: 0, chase: 0 };
  const tension = smoothstep(0.2, 0.55, intensity);
  const chase = smoothstep(0.8, 0.97, intensity);
  const calm = 1 - smoothstep(0.3, 0.7, intensity);
  return { pad: Math.min(1, calm * 0.9 + tension * 0.4), texture: calm, tension: tension * (1 - chase * 0.3), chase };
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
    this.layers = { pad: make(), texture: make(), tension: make(), chase: make() };
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
    const cluster = CLUSTERS[bar];
    const root = cluster[0];
    const m = this.mix;
    const L = this.layers!;
    const pick = () => cluster[Math.floor(Math.random() * cluster.length)];
    if (s === 0 && m.pad > 0.01) this.drone(L.pad, cluster, t, 16 * STEP);
    if (m.texture > 0.01) {
      if (s % 4 === 0 && Math.random() < 0.16) this.metal(L.texture, pick() + (Math.random() < 0.5 ? 24 : 36), t, Math.random() < 0.5);
      if (s === 8 && Math.random() < 0.35) this.boom(L.texture, t);
    }
    if (m.tension > 0.01) {
      // Lub-dub on every beat.
      if (s % 4 === 0) this.thump(L.tension, root - 12, t, 1);
      if (s % 4 === 1) this.thump(L.tension, root - 12, t + STEP * 0.2, 0.6);
      if (s === 0) this.strings(L.tension, root + 36, t, 16 * STEP);
    }
    if (m.chase > 0.01) {
      // Heavy drum hits on the eighths, accented on the beat.
      if (s % 2 === 0) this.throb(L.chase, t, s % 8 === 0 ? 1 : s % 4 === 0 ? 0.75 : 0.45);
      // Grinding bass: the root and the semitone above it at once, chopped on every sixteenth. No melody.
      this.grind(L.chase, root - 12, t, s % 4 === 0 ? 1 : 0.6);
      // Metal scraping somewhere in the dark, on an uneven pattern.
      if ((s * 7 + bar * 5) % 11 === 0) this.scrape(L.chase, t);
      // Strings that climb all bar long: dread rising, never resolving.
      if (s === 0) this.rise(L.chase, root + 30, t, 16 * STEP);
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

  /** Slow LFO on an AudioParam. */
  private wobble(param: AudioParam, rate: number, depth: number, t: number, dur: number): void {
    const ctx = this.out!.ctx;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    lfo.connect(g).connect(param);
    lfo.start(t);
    lfo.stop(t + dur + 0.1);
  }

  /** The bed: a low cluster whose voices drift in and out of tune against each other. */
  private drone(dest: AudioNode, cluster: number[], t: number, dur: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.045, 2.5, dur - 2.5, 3);
    const lp = this.filter("lowpass", 380, 1.2);
    this.wobble(lp.frequency, 0.05 + Math.random() * 0.04, 140, t, dur + 3);
    lp.connect(g);
    for (const n of cluster) {
      for (const d of [-9, 9]) {
        const o = this.osc(lp, "sawtooth", freq(n), t, dur + 3, d);
        this.wobble(o.detune, 0.06 + Math.random() * 0.1, 22, t, dur + 3);
      }
    }
    this.osc(lp, "sine", freq(cluster[0] - 12), t, dur + 3);
  }

  /** A bowed or struck metal plate: inharmonic partials, slowly bending flat. */
  private metal(dest: AudioNode, note: number, t: number, bowed: boolean): void {
    const g = this.gain(dest);
    this.env(g, t, 0.03, bowed ? 0.9 : 0.004, 0, bowed ? 3 : 3.6);
    const f = freq(note);
    for (const [ratio, amp] of METAL_PARTIALS) {
      const pg = this.gain(g);
      pg.gain.value = amp;
      const o = this.osc(pg, "sine", f * ratio, t, 4.2);
      o.frequency.setValueAtTime(f * ratio, t);
      o.frequency.exponentialRampToValueAtTime(f * ratio * 0.97, t + 4);
    }
    if (bowed) {
      // Bow noise on the edge of the plate.
      const bp = this.filter("bandpass", f * 2.76, 12);
      const ng = this.gain(g);
      ng.gain.value = 0.6;
      bp.connect(ng);
      this.noise(bp, t, 3.5);
    }
  }

  /** Something heavy, far away, somewhere in the mountain. */
  private boom(dest: AudioNode, t: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.12, 0.02, 0, 2.2);
    const o = this.osc(g, "sine", 55, t, 2.4);
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.8);
    const lp = this.filter("lowpass", 180);
    const ng = this.gain(g);
    ng.gain.value = 0.7;
    lp.connect(ng);
    this.noise(lp, t, 1.5);
  }

  /** One beat of a heart: a dull, low thump. */
  private thump(dest: AudioNode, note: number, t: number, vol: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.2 * vol, 0.006, 0.02, 0.2);
    const lp = this.filter("lowpass", 150);
    lp.connect(g);
    const o = this.osc(lp, "sine", freq(note) * 1.6, t, 0.3);
    o.frequency.setValueAtTime(freq(note) * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq(note), t + 0.12);
    this.osc(lp, "triangle", freq(note), t, 0.3);
  }

  /** A high cluster a semitone apart, trembling. */
  private strings(dest: AudioNode, note: number, t: number, dur: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.02, 1.2, dur - 1.2, 1.5);
    const bp = this.filter("bandpass", 1500, 0.8);
    bp.connect(g);
    for (const n of [note, note + 1]) this.osc(bp, "sawtooth", freq(n), t, dur + 1.5, (Math.random() - 0.5) * 14);
    this.wobble(g.gain, 7, 0.012, t, dur + 1.5);
  }

  /** The chase's pulse: a deep drum hit, felt more than heard. */
  private throb(dest: AudioNode, t: number, vol: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.36 * vol, 0.004, 0.03, 0.35);
    const o = this.osc(g, "sine", 62, t, 0.45);
    o.frequency.setValueAtTime(62, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const lp = this.filter("lowpass", 260);
    const ng = this.gain(g);
    ng.gain.value = 0.5;
    lp.connect(ng);
    this.noise(lp, t, 0.15);
  }

  /** Two notes a semitone apart, low and filthy, chopped short. */
  private grind(dest: AudioNode, note: number, t: number, vol: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.07 * vol, 0.006, 0.05, 0.12);
    const lp = this.filter("lowpass", 520, 3);
    lp.connect(g);
    this.osc(lp, "sawtooth", freq(note), t, 0.22);
    this.osc(lp, "sawtooth", freq(note + 1), t, 0.22);
    this.osc(lp, "sawtooth", freq(note - 12), t, 0.22);
  }

  /** Metal dragged across concrete: narrow bands of noise, no pitch to hum along to. */
  private scrape(dest: AudioNode, t: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.05, 0.08, 0.15, 0.5);
    const base = 900 + Math.random() * 900;
    for (const [ratio, amp] of METAL_PARTIALS) {
      const bp = this.filter("bandpass", base * ratio, 30);
      const pg = this.gain(g);
      pg.gain.value = amp * 2;
      bp.connect(pg);
      this.noise(bp, t, 0.8);
    }
  }

  /** A trembling string cluster that creeps upward through the bar. */
  private rise(dest: AudioNode, note: number, t: number, dur: number): void {
    const g = this.gain(dest);
    this.env(g, t, 0.028, dur * 0.6, dur * 0.35, 0.4);
    const bp = this.filter("bandpass", 1300, 0.9);
    bp.connect(g);
    for (const d of [0, 1, 2]) {
      const o = this.osc(bp, "sawtooth", freq(note + d), t, dur + 0.5, (Math.random() - 0.5) * 16);
      o.frequency.setValueAtTime(freq(note + d), t);
      o.frequency.linearRampToValueAtTime(freq(note + d + 2), t + dur);
    }
    this.wobble(g.gain, 9, 0.014, t, dur + 0.5);
  }
}
