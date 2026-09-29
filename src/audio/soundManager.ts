import { currentCharacter } from "../content/characters";
import type { SampleId } from "../content/sounds";
import type { VocalKind } from "../enemies/enemy";
import { SampleBank } from "./samples";

/**
 * All audio is synthesized at runtime with the Web Audio API — no sound files.
 *
 * Signal flow:
 *   voice → [lowpass if behind a wall] → panner → dry bus ─┐
 *                                               └→ reverb ─┴→ master → out
 */
/** What the music engine needs from the sound engine. */
export interface MusicOutput {
  ctx: AudioContext;
  /** The music bus: goes to the master (and a little to the reverb). */
  out: AudioNode;
  noise: AudioBuffer;
}

export interface Spatial {
  /** -1 (left) .. 1 (right) */
  pan: number;
  distance: number;
  /** true if a wall is between source and listener */
  muffled: boolean;
}

const CENTER: Spatial = { pan: 0, distance: 0, muffled: false };

export class SoundManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private reverbIn!: GainNode;
  private noiseBuf!: AudioBuffer;
  private musicBus!: GainNode;
  /** Recorded weapon sounds; anything missing falls back to synthesis. */
  private readonly samples = new SampleBank();
  private musicVolume = 0.7;
  /** Called once the audio context exists (the music hooks in here). */
  onReady: ((music: MusicOutput) => void) | null = null;
  private heartbeatTimer = 0;
  private breathTimer = 0;
  private ambientTimer = 4;
  private volume = 0.8;
  private stepFlip = false;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture (browsers block audio otherwise). Safe to call repeatedly. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(this.master);

    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(2.4, 2.8);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverbIn.connect(convolver).connect(wet).connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.5;
    this.musicBus.connect(musicSend).connect(this.reverbIn);

    void this.samples.load(ctx);
    this.startAmbient();
    this.onReady?.({ ctx, out: this.musicBus, noise: this.noiseBuf });
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Duck everything (pause menu) without losing the ambience. */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(paused ? this.volume * 0.25 : this.volume, this.ctx.currentTime, 0.1);
  }

  /** Everything fades to silence (the title screen after Exit); `setPaused(false)` brings it back. */
  silence(): void {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** Output chain for one voice. Returns the node to connect the voice into. */
  private out(sp: Spatial, maxDist: number, reverb = 0.4): AudioNode | null {
    const ctx = this.ctx!;
    const t = Math.max(0, 1 - sp.distance / maxDist);
    const att = t * t;
    if (att < 0.005) return null;
    const g = ctx.createGain();
    g.gain.value = att;
    let node: AudioNode = g;
    if (sp.muffled) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 380;
      g.connect(lp);
      node = lp;
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, sp.pan)) * 0.85;
    node.connect(pan);
    pan.connect(this.dry);
    const send = ctx.createGain();
    send.gain.value = reverb * (sp.muffled ? 1.5 : 1);
    pan.connect(send).connect(this.reverbIn);
    return g;
  }

  private noise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    return src;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(
    dest: AudioNode,
    type: OscillatorType,
    f0: number,
    f1: number,
    t: number,
    dur: number,
    peak: number,
    attack = 0.005
  ): OscillatorNode {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, attack, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  private burst(
    dest: AudioNode,
    filter: BiquadFilterType,
    freq: number,
    q: number,
    t: number,
    dur: number,
    peak: number,
    attack = 0.002
  ): BiquadFilterNode {
    const ctx = this.ctx!;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, attack, dur);
    n.connect(f).connect(g).connect(dest);
    n.start(t, Math.random() * 1.5); // random offset so bursts don't sound identical
    n.stop(t + attack + dur + 0.05);
    return f;
  }

  // ---------------------------------------------------------------- weapon

  /** Plays a recording if there is one. `reverb` is how much of it goes to the room; `rate` shifts its pitch. */
  private sample(id: SampleId, when: number, sp: Spatial = CENTER, gain = 1, reverb = 0.3, rate = 1, maxDist = 40): boolean {
    if (!this.ctx || !this.samples.has(id)) return false;
    const o = this.out(sp, sp === CENTER ? 1 : maxDist, reverb);
    // Out of earshot still counts as handled: no synthesized fallback either.
    return !o || this.samples.play(this.ctx, id, o, when, gain, rate);
  }

  playGunshot(weapon: "pistol" | "shotgun" | "rivet" = "pistol"): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const recorded: Record<typeof weapon, SampleId> = { pistol: "pistolShot", shotgun: "shotgunShot", rivet: "rivetShot" };
    if (this.sample(recorded[weapon], t, CENTER, 1, weapon === "rivet" ? 0.3 : 0.9)) {
      if (weapon !== "rivet") {
        // Field recordings miss the thump you feel in your chest; add it, and let the shot roll away down the level.
        const o = this.out(CENTER, 1, 0.6)!;
        const big = weapon === "shotgun";
        this.tone(o, "sine", big ? 105 : 130, big ? 38 : 48, t, big ? 0.3 : 0.2, big ? 0.75 : 0.55, 0.002);
        this.burst(o, "lowpass", 380, 0.6, t + 0.05, big ? 1.6 : 1.1, 0.12, 0.05);
      }
      if (weapon === "shotgun") {
        if (!this.sample("pump", t + 0.34)) {
          this.action(t + 0.36, 1100, 0.35);
          this.action(t + 0.52, 1500, 0.4);
        }
        if (!this.sample("shellCasing", t + 0.8)) this.casings(t + 0.8, 1, 1500);
      } else if (weapon === "pistol" && !this.sample("casing", t + 0.38 + Math.random() * 0.08)) {
        this.casings(t + 0.38 + Math.random() * 0.08, 1, 3800);
      }
      return;
    }
    if (weapon === "rivet") {
      // Pneumatic: a hiss and a hard "chunk". Quiet — that's the point.
      const o = this.out(CENTER, 1, 0.3)!;
      this.burst(o, "highpass", 3500, 0.8, t, 0.07, 0.25);
      this.tone(o, "square", 900, 300, t, 0.03, 0.18);
      this.burst(o, "bandpass", 1200, 4, t + 0.01, 0.05, 0.35);
      this.burst(o, "lowpass", 600, 1, t + 0.06, 0.12, 0.08, 0.02); // air bleed
      return;
    }
    if (weapon === "shotgun") {
      this.blast(t, { boom: 48, body: 1500, bodyDecay: 0.32, crack: 0.9, size: 1.6 });
      // Pump: back, then forward — heavy steel on steel.
      this.action(t + 0.36, 1100, 0.35);
      this.action(t + 0.52, 1500, 0.4);
      this.casings(t + 0.8, 1, 1500);
      return;
    }
    this.blast(t, { boom: 70, body: 2400, bodyDecay: 0.18, crack: 1, size: 1 });
    this.action(t + 0.035, 2600, 0.22); // the slide cycling
    this.casings(t + 0.38 + Math.random() * 0.08, 1, 3800);
  }

  private shaperCurve: Float32Array<ArrayBuffer> | null = null;

  /** Soft clipping for the overdriven punch of a gunshot. Voices go into `input`; `output` carries the result. */
  private distortion(drive: number): { input: GainNode; output: WaveShaperNode } {
    const ctx = this.ctx!;
    if (!this.shaperCurve) {
      const n = 1024;
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 3);
      this.shaperCurve = c;
    }
    const input = ctx.createGain();
    input.gain.value = drive;
    const output = ctx.createWaveShaper();
    output.curve = this.shaperCurve;
    output.oversample = "2x";
    input.connect(output);
    return { input, output };
  }

  /**
   * A gunshot in a concrete corridor: an overdriven blast (crack, body and
   * low punch), a hard slap of early reflections off the walls, and a
   * rumble that rolls away down the level.
   */
  private blast(t: number, v: { boom: number; body: number; bodyDecay: number; crack: number; size: number }): void {
    const ctx = this.ctx!;
    const o = this.out(CENTER, 1, 1.4 * v.size)!;
    const drive = this.distortion(2.2);
    const post = ctx.createGain();
    post.gain.value = 0.55;
    drive.output.connect(post).connect(o);
    // The crack: a few milliseconds of everything at once.
    this.burst(drive.input, "highpass", 900, 0.5, t, 0.012, 1.3 * v.crack, 0.0005);
    // The body: the gas and the room, a dark roar that dies fast.
    this.burst(drive.input, "lowpass", v.body, 0.8, t, v.bodyDecay, 1.0, 0.001);
    // The punch you feel in your chest.
    this.tone(drive.input, "sine", v.boom * 2.2, v.boom, t, 0.22 * v.size, 1.2, 0.002);
    this.tone(o, "sine", v.boom * 0.7, 30, t, 0.35 * v.size, 0.6, 0.004);
    // Early reflections: the walls slapping it back, darker and quieter each time.
    [0.019, 0.037, 0.061, 0.094].forEach((d, i) => {
      this.burst(o, "lowpass", v.body * (0.8 - i * 0.15), 0.7, t + d * v.size, 0.07, 0.42 * Math.pow(0.62, i), 0.001);
    });
    // The tail: the shot rolling away through the facility.
    this.burst(o, "lowpass", 380, 0.6, t + 0.05, 1.3 * v.size, 0.22, 0.05);
    // Your ears ring, a little.
    this.tone(this.out(CENTER, 1, 0)!, "sine", 5200 + Math.random() * 600, 5100, t + 0.02, 0.9 * v.size, 0.012, 0.05);
  }

  /** A slide or pump moving: a short metallic clack. */
  private action(t: number, f: number, vol: number): void {
    const o = this.out(CENTER, 1, 0.15)!;
    this.burst(o, "bandpass", f, 4, t, 0.035, vol, 0.001);
    this.burst(o, "bandpass", f * 2.3, 6, t + 0.004, 0.02, vol * 0.6, 0.001);
    this.burst(o, "lowpass", 500, 1, t, 0.04, vol * 0.5, 0.001);
  }

  /** Brass (or a plastic shell) hitting concrete and bouncing. */
  private casings(t: number, vol: number, f: number): void {
    const o = this.out(CENTER, 1, 0.25)!;
    let at = t;
    for (let i = 0; i < 3; i++) {
      const v = 0.05 * vol * Math.pow(0.5, i);
      this.tone(o, "sine", f * (1 + Math.random() * 0.05), f * 0.98, at, 0.07, v, 0.001);
      this.tone(o, "sine", f * 2.71, f * 2.65, at, 0.05, v * 0.5, 0.001);
      at += 0.09 * Math.pow(0.6, i) + Math.random() * 0.02;
    }
  }

  /** One shotgun shell pushed into the tube. */
  playShellLoad(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.sample("shellInsert", t)) return;
    const o = this.out(CENTER, 1, 0.15)!;
    this.burst(o, "bandpass", 1100, 3, t, 0.05, 0.22);
    this.tone(o, "square", 650, 450, t + 0.02, 0.025, 0.1);
  }

  playWeaponSwitch(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.1)!;
    this.burst(o, "bandpass", 700, 1, t, 0.12, 0.1, 0.02); // cloth
    this.burst(o, "bandpass", 1600, 3, t + 0.2, 0.04, 0.2);
    this.tone(o, "square", 1100, 700, t + 0.2, 0.02, 0.08);
  }

  /** A swing; `hit` adds the impact. */
  playMelee(hit: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.2)!;
    this.burst(o, "bandpass", 900, 0.8, t, 0.16, 0.14, 0.05); // whoosh
    if (hit) {
      this.burst(o, "lowpass", 350, 1, t + 0.12, 0.12, 0.6);
      this.tone(o, "sine", 110, 50, t + 0.12, 0.12, 0.5);
    }
  }

  /** A silent kill up close: muffled, wet, final. */
  playTakedown(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.1)!;
    this.burst(o, "lowpass", 500, 1, t + 0.1, 0.18, 0.55);
    this.burst(o, "bandpass", 1500, 2, t + 0.12, 0.08, 0.2); // crack
    this.tone(o, "sine", 80, 40, t + 0.1, 0.25, 0.4);
  }

  playHeal(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.1)!;
    this.tone(o, "square", 1800, 1600, t, 0.02, 0.08); // cap off
    this.burst(o, "highpass", 5000, 1, t + 0.55, 0.25, 0.12, 0.02); // injector hiss
    this.burst(o, "bandpass", 300, 1, t + 0.6, 0.35, 0.18, 0.05); // exhale
  }

  playAcidSplash(sp: Spatial): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(sp, 26, 0.4);
    if (!o) return;
    this.burst(o, "bandpass", 700, 1.2, t, 0.18, 0.4);
    this.burst(o, "highpass", 4000, 0.8, t + 0.05, 0.6, 0.12, 0.1); // sizzle
  }

  /** A Mimic's imitation of your own footsteps, or of an item being picked up — from over there. */
  playLure(kind: "footsteps" | "pickup", sp: Spatial): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(sp, 30, 0.6);
    if (!o) return;
    if (kind === "pickup") {
      this.burst(o, "bandpass", 1800, 3, t, 0.05, 0.3);
      this.burst(o, "bandpass", 2400, 3, t + 0.07, 0.05, 0.25);
      return;
    }
    for (let i = 0; i < 4; i++) {
      this.burst(o, "lowpass", i % 2 ? 420 : 520, 1, t + i * 0.5, 0.09, 0.3);
      this.burst(o, "bandpass", i % 2 ? 2200 : 2600, 2, t + i * 0.5 + 0.01, 0.04, 0.08);
    }
  }

  playEmptyClick(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.sample("dryFire", t)) return;
    const o = this.out(CENTER, 1, 0.1)!;
    this.tone(o, "square", 2400, 1200, t, 0.02, 0.18);
    this.burst(o, "highpass", 3000, 1, t, 0.03, 0.15);
  }

  /** Timed to match the viewmodel's reload animation (1.5s). */
  playReload(duration: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.15)!;
    const click = (at: number, f: number, vol: number) => {
      this.tone(o, "square", f, f * 0.5, t + at, 0.025, vol);
      this.burst(o, "bandpass", f * 1.5, 2, t + at, 0.04, vol);
    };
    // Each stage uses a recording if there is one, timed to the animation.
    if (!this.sample("magOut", t + duration * 0.16)) {
      click(duration * 0.18, 900, 0.18); // mag release
      this.burst(o, "bandpass", 500, 1, t + duration * 0.3, 0.12, 0.08); // mag slides out
    }
    if (!this.sample("magIn", t + duration * 0.58)) click(duration * 0.62, 700, 0.25); // mag seated
    if (!this.sample("slideRack", t + duration * 0.78)) {
      click(duration * 0.8, 1200, 0.2); // slide back
      click(duration * 0.9, 1500, 0.25); // slide forward
    }
  }

  /** Your round going into flesh: a wet, heavy thud, and a crunch for a headshot. */
  playHitmarker(headshot: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.1)!;
    if (this.sample("impactFlesh", t, CENTER, headshot ? 1.2 : 1, 0.1)) {
      this.tone(o, "triangle", headshot ? 1500 : 1100, headshot ? 1300 : 950, t, 0.03, 0.05);
      return;
    }
    this.burst(o, "lowpass", 420, 1.2, t, 0.1, 0.5, 0.002); // the thud
    this.burst(o, "bandpass", 900, 3, t + 0.01, 0.06, 0.18, 0.003); // wet
    if (headshot) {
      this.burst(o, "bandpass", 2400, 2, t, 0.04, 0.3, 0.001); // bone giving way
      this.burst(o, "highpass", 3000, 1, t + 0.02, 0.05, 0.12, 0.002);
    }
    // A faint tick so you always know it landed.
    this.tone(o, "triangle", headshot ? 1500 : 1100, headshot ? 1300 : 950, t, 0.03, 0.05);
  }

  /** A round hitting concrete: a crack, a thud, grit falling, and now and then a ricochet. */
  playImpact(sp: Spatial): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(sp, 40, 0.6);
    if (!o) return;
    if (this.sample("impactConcrete", t, sp, 1, 0.6)) {
      // The recording is the stone; add the bullet's own crack and the grit it knocks loose.
      this.burst(o, "bandpass", 2400 + Math.random() * 800, 1.5, t, 0.015, 0.22, 0.0005);
      for (let i = 0; i < 4; i++) {
        this.burst(o, "highpass", 4000 + Math.random() * 3000, 1, t + 0.05 + Math.random() * 0.3, 0.012, 0.05 * Math.random(), 0.0005);
      }
      if (Math.random() < 0.18) this.sample("ricochet", t + 0.01, sp, 0.8, 0.6);
      return;
    }
    this.burst(o, "bandpass", 1600 + Math.random() * 800, 1.2, t, 0.03, 0.35, 0.0005);
    this.burst(o, "lowpass", 300, 1, t, 0.07, 0.3, 0.001);
    for (let i = 0; i < 5; i++) {
      this.burst(o, "highpass", 4000 + Math.random() * 3000, 1, t + 0.04 + Math.random() * 0.3, 0.012, 0.06 * Math.random(), 0.0005);
    }
    if (Math.random() < 0.18) {
      // Ricochet: a thin whine tearing off into the dark.
      this.tone(o, "sine", 2600 + Math.random() * 900, 900, t + 0.01, 0.35, 0.05, 0.005);
    }
  }

  // ---------------------------------------------------------------- player

  playFootstep(gait: "crouch" | "walk" | "sprint" | "still"): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.stepFlip = !this.stepFlip;
    const vol = gait === "sprint" ? 0.5 : gait === "crouch" ? 0.08 : 0.25;
    if (gait !== "still" && this.sample(gait === "sprint" ? "stepRun" : "stepWalk", t, CENTER, gait === "crouch" ? 0.3 : 1, 0.25)) return;
    const o = this.out(CENTER, 1, 0.25)!;
    this.burst(o, "lowpass", this.stepFlip ? 420 : 520, 1, t, 0.09, vol);
    this.burst(o, "bandpass", this.stepFlip ? 2200 : 2600, 2, t + 0.01, 0.04, vol * 0.25); // grit
  }

  playFlashlight(on: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.sample("flashlight", t, CENTER, 1, 0.05, on ? 1 : 0.9)) return;
    const o = this.out(CENTER, 1, 0.05)!;
    this.tone(o, "square", on ? 3200 : 2600, 1500, t, 0.015, 0.12);
    this.burst(o, "highpass", 4000, 1, t, 0.02, 0.12);
  }

  playPickup(kind: string): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.3)!;
    if ((kind === "ammo" || kind === "shells" || kind === "rivets") && this.sample("ammoPickup", t, CENTER, 1, 0.2)) return;
    if (kind === "ammo" || kind === "shells" || kind === "rivets") {
      this.burst(o, "bandpass", 1800, 3, t, 0.05, 0.3);
      this.burst(o, "bandpass", 2400, 3, t + 0.07, 0.05, 0.25);
    } else if (kind === "shotgun" || kind === "rivetGun") {
      this.burst(o, "lowpass", 500, 1, t, 0.12, 0.35);
      this.burst(o, "bandpass", 1400, 3, t + 0.15, 0.05, 0.3);
      this.burst(o, "bandpass", 1900, 3, t + 0.3, 0.05, 0.35);
    } else if (kind === "note") {
      this.burst(o, "bandpass", 3000, 0.8, t, 0.25, 0.12, 0.05); // paper rustle
    } else if (kind === "keycard") {
      this.tone(o, "sine", 880, 880, t, 0.12, 0.2);
      this.tone(o, "sine", 1320, 1320, t + 0.12, 0.25, 0.2);
    } else {
      this.tone(o, "sine", 520, 1040, t, 0.15, 0.2);
    }
  }

  playPlayerHurt(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.3)!;
    this.tone(o, "sine", 150, 45, t, 0.3, 0.9);
    // Nur's voice, if there's a recording; otherwise a breathy grunt.
    if (!this.sample("playerHurt", t + 0.02, CENTER, 1, 0.2, currentCharacter().voice))
      this.burst(o, "bandpass", 900, 1.5, t, 0.25, 0.35, 0.02);
  }

  playDeath(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 1.5)!;
    this.tone(o, "sawtooth", 110, 30, t, 2.5, 0.4, 0.05);
    this.tone(o, "sine", 55, 25, t, 3, 0.6, 0.1);
  }

  playLevelComplete(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 1)!;
    [220, 277, 330, 440].forEach((f, i) => this.tone(o, "triangle", f, f, t + i * 0.12, 1.2, 0.12, 0.02));
  }

  playLocked(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.2)!;
    this.tone(o, "square", 220, 200, t, 0.12, 0.12);
    this.tone(o, "square", 180, 160, t + 0.15, 0.18, 0.12);
  }

  playUi(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(this.out(CENTER, 1, 0.1)!, "sine", 1400, 1200, t, 0.04, 0.06);
  }

  /**
   * Call every frame. The heart beats when you're badly hurt (below ~40%)
   * or when something is close and you can't see it (`dread` 0..1), faster
   * and louder the worse it gets.
   */
  updateHeartbeat(dt: number, healthFrac: number, dread = 0): void {
    if (!this.ctx || healthFrac <= 0) return;
    const hurt = healthFrac < 0.4 ? 1 - healthFrac / 0.4 : 0;
    const danger = Math.max(hurt, dread);
    this.heartbeatTimer -= dt;
    if (danger < 0.08 || this.heartbeatTimer > 0) return;
    this.heartbeatTimer = 1.1 - danger * 0.55;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0)!;
    const v = 0.25 + danger * 0.6;
    this.tone(o, "sine", 70, 40, t, 0.12, v);
    this.tone(o, "sine", 65, 38, t + 0.2, 0.12, v * 0.7);
  }

  /**
   * Your own breathing, heard when you're afraid (`dread` 0..1) or out of
   * breath (`winded` 0..1): quick, shaky, close. Nothing while you hold it.
   */
  updateBreathing(dt: number, dread: number, winded: number, held: boolean): void {
    if (!this.ctx) return;
    const level = Math.max(dread, winded * 0.8);
    this.breathTimer -= dt;
    if (held || level < 0.2 || this.breathTimer > 0) return;
    const period = 2.8 - level * 1.5;
    this.breathTimer = period * (0.9 + Math.random() * 0.2);
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.05)!;
    const pitch = currentCharacter().voice;
    const v = 0.05 + level * 0.12;
    // In through the mouth, then out.
    this.burst(o, "bandpass", 1300 * pitch, 0.8, t, period * 0.3, v, period * 0.12);
    this.burst(o, "bandpass", 700 * pitch, 0.7, t + period * 0.45, period * 0.35, v * 1.2, period * 0.08);
  }

  /** A loose panel pried out of the wall: a metal scrape, then it drops with a thud. */
  playPanel(sp: Spatial): void {
    if (!this.ctx) return;
    const o = this.out(sp, 30, 0.5);
    if (!o) return;
    const t = this.ctx.currentTime;
    this.burst(o, "bandpass", 1800, 4, t, 0.35, 0.25, 0.05);
    this.tone(o, "sawtooth", 220, 160, t + 0.05, 0.3, 0.05);
    this.tone(o, "sine", 90, 45, t + 0.7, 0.3, 0.6);
    this.burst(o, "lowpass", 400, 0.8, t + 0.7, 0.25, 0.4);
  }

  /** A bottle leaving your hand: a quick swish. */
  playThrow(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(this.out(CENTER, 1, 0.1)!, "bandpass", 900, 0.6, t, 0.16, 0.12, 0.04);
  }

  /** Glass breaking somewhere: a crack, a spray of high glints, the tinkle of pieces landing. */
  playShatter(sp: Spatial): void {
    if (!this.ctx) return;
    const o = this.out(sp, 45, 0.6);
    if (!o) return;
    const t = this.ctx.currentTime;
    this.burst(o, "highpass", 2500, 0.7, t, 0.12, 0.9, 0.001);
    this.burst(o, "bandpass", 5200, 3, t + 0.01, 0.35, 0.4, 0.002);
    for (let i = 0; i < 7; i++) {
      const at = t + 0.03 + Math.random() * 0.45;
      this.tone(
        o,
        "sine",
        3000 + Math.random() * 4000,
        2500 + Math.random() * 3000,
        at,
        0.05 + Math.random() * 0.08,
        0.06 + Math.random() * 0.08
      );
    }
  }

  /** Holding your breath, letting it out, or gasping when you run out. */
  playBreath(kind: "hold" | "release" | "gasp"): void {
    if (!this.ctx) return;
    this.breathTimer = kind === "hold" ? 0 : 1.2;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.1)!;
    const pitch = currentCharacter().voice;
    if (kind === "hold") {
      this.burst(o, "bandpass", 1500 * pitch, 1, t, 0.18, 0.12, 0.05);
    } else if (kind === "release") {
      this.burst(o, "bandpass", 650 * pitch, 0.8, t, 0.5, 0.1, 0.06);
    } else {
      this.burst(o, "bandpass", 1100 * pitch, 1.2, t, 0.35, 0.5, 0.02);
      this.burst(o, "bandpass", 600 * pitch, 0.8, t + 0.4, 0.6, 0.3, 0.05);
      this.burst(o, "bandpass", 1200 * pitch, 1, t + 1.1, 0.3, 0.25, 0.04);
    }
  }

  // ---------------------------------------------------------------- world & radio

  /**
   * A voice over a bad radio: a click, then a murmur of band-passed
   * "syllables" riding on static for `duration` seconds. Not words — the
   * subtitles carry the words — but it sells a person talking.
   */
  playRadioVoice(duration: number, distorted = false, sp: Spatial = CENTER): void {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.out(sp, sp === CENTER ? 1 : 32, sp === CENTER ? 0.15 : 0.7);
    if (!o) return;
    this.burst(o, "highpass", 3000, 0.7, t0, 0.06, 0.12); // key-up click
    this.burst(o, "bandpass", 2500, 0.6, t0, duration, 0.018, 0.05); // static bed
    const base = distorted ? 78 : 118;
    let t = t0 + 0.12;
    const end = t0 + duration - 0.25;
    while (t < end) {
      const syl = 0.08 + Math.random() * 0.14;
      const formant = (distorted ? 450 : 700) + Math.random() * 900;
      const f = this.tone(o, "sawtooth", base * (0.9 + Math.random() * 0.25), base * (0.85 + Math.random() * 0.2), t, syl, 0.05, 0.02);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = formant;
      bp.Q.value = 3;
      f.disconnect();
      const g = this.ctx.createGain();
      this.env(g, t, 0.07, 0.02, syl);
      f.connect(bp).connect(g).connect(o);
      this.burst(o, "bandpass", formant * 2.2, 5, t, syl * 0.6, 0.015);
      // Words come in clumps with short pauses between them.
      t += syl + (Math.random() < 0.22 ? 0.18 + Math.random() * 0.2 : 0.02);
    }
    this.burst(o, "highpass", 2600, 0.7, end + 0.05, 0.05, 0.1); // key-down click
  }

  playDoor(sp: Spatial, security: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(sp, 30, 0.7);
    if (!o) return;
    if (security) {
      this.tone(o, "square", 660, 660, t, 0.08, 0.08);
      this.tone(o, "square", 990, 990, t + 0.1, 0.1, 0.08);
    }
    if (!this.sample("door", t + 0.05, sp, 1, 0.7, 1, 30)) {
      this.tone(o, "sawtooth", 55, 70, t + 0.1, 0.9, 0.18, 0.1); // motor
      this.burst(o, "lowpass", 400, 1, t + 0.1, 0.9, 0.3, 0.15); // grind
    }
    this.burst(o, "lowpass", 220, 1, t + 1.0, 0.25, 0.6); // clunk at the top
  }

  playGeneratorStart(sp: Spatial): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(sp, 40, 0.8);
    if (!o) return;
    this.burst(o, "lowpass", 300, 1, t, 0.4, 0.5); // crank
    this.tone(o, "sawtooth", 30, 120, t + 0.3, 1.6, 0.25, 0.4); // spin-up whine
    this.tone(o, "square", 60, 60, t + 1.7, 0.8, 0.12, 0.1);
  }

  /** One low thrum of a running generator. Called every few seconds per generator. */
  playGeneratorHum(sp: Spatial): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(sp, 22, 0.5);
    if (!o) return;
    this.tone(o, "sawtooth", 60, 58, t, 2.6, 0.08, 0.4);
    this.tone(o, "sine", 120, 118, t, 2.6, 0.05, 0.4);
  }

  playSplash(gait: "crouch" | "walk" | "sprint" | "still"): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = gait === "sprint" ? 0.45 : gait === "crouch" ? 0.12 : 0.28;
    if (this.sample("splash", t, CENTER, vol / 0.45, 0.5)) return;
    const o = this.out(CENTER, 1, 0.5)!;
    this.burst(o, "bandpass", 900 + Math.random() * 500, 1.2, t, 0.18, vol, 0.01);
    this.burst(o, "highpass", 3500, 0.8, t + 0.03, 0.12, vol * 0.4, 0.01);
  }

  // ---------------------------------------------------------------- the other player (co-op)

  /** Their gun, from where they are. Loud guns carry across the level; the rivet gun barely leaves the room. */
  playGunshotAt(weapon: "pistol" | "shotgun" | "rivet", sp: Spatial): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const recorded: Record<typeof weapon, SampleId> = { pistol: "pistolShot", shotgun: "shotgunShot", rivet: "rivetShot" };
    const reach = weapon === "rivet" ? 16 : 70;
    if (this.sample(recorded[weapon], t, sp, 0.9, weapon === "rivet" ? 0.3 : 1.2, 1, reach)) return;
    const o = this.out(sp, reach, 1.2);
    if (!o) return;
    this.burst(o, "lowpass", weapon === "rivet" ? 1200 : 1800, 0.8, t, weapon === "shotgun" ? 0.35 : 0.22, 0.9, 0.001);
    if (weapon !== "rivet") this.tone(o, "sine", 140, 45, t, 0.25, 0.6, 0.002);
  }

  /** Their footsteps. */
  playFootstepAt(gait: "crouch" | "walk" | "sprint" | "still", wet: boolean, sp: Spatial): void {
    if (!this.ctx || gait === "still") return;
    const t = this.ctx.currentTime;
    const gain = gait === "sprint" ? 1 : gait === "crouch" ? 0.3 : 0.7;
    if (wet) this.sample("splash", t, sp, gain, 0.5, 1, 22);
    else this.sample(gait === "sprint" ? "stepRun" : "stepWalk", t, sp, gain, 0.3, 1, 22);
  }

  playCheckpoint(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 0.6)!;
    this.tone(o, "triangle", 392, 392, t, 0.25, 0.1, 0.02);
    this.tone(o, "triangle", 587, 587, t + 0.14, 0.5, 0.1, 0.02);
  }

  playIntercom(sp: Spatial): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(sp, 12, 0.3);
    if (!o) return;
    this.tone(o, "sine", 1000, 1000, t, 0.06, 0.1);
    this.tone(o, "sine", 1500, 1500, t + 0.08, 0.08, 0.1);
  }

  /** The final choice: charges going off in sequence, then the mountain coming down. */
  playDetonation(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(CENTER, 1, 1.6)!;
    for (let i = 0; i < 4; i++) {
      this.burst(o, "lowpass", 180, 1, t + i * 0.55, 1.2, 0.9, 0.01);
      this.tone(o, "sine", 60, 20, t + i * 0.55, 1.4, 0.8, 0.01);
    }
    this.burst(o, "lowpass", 120, 0.7, t + 2.2, 5, 0.9, 0.5);
  }

  // ---------------------------------------------------------------- enemies

  /** `p` is the creature's voice pitch multiplier (1 = husk, lower = bigger). */
  playEnemy(kind: "alert" | VocalKind, p: number, sp: Spatial): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.creatureVoice(kind, p, sp, t)) return;
    switch (kind) {
      case "alert": {
        // It has you: a ragged scream torn out of a throat that isn't built for it.
        const o = this.out(sp, 34, 0.9);
        if (!o) return;
        // Breath and rasp through two vocal-tract resonances, sliding a little as it opens up.
        for (const [f0, f1, peak] of [
          [700, 1100, 0.45],
          [1900, 2600, 0.3],
        ]) {
          const f = this.burst(o, "bandpass", f0 * p, 6, t, 0.75, peak, 0.04);
          f.frequency.setValueAtTime(f0 * p, t);
          f.frequency.linearRampToValueAtTime(f1 * p, t + 0.25);
          f.frequency.linearRampToValueAtTime(f1 * 0.8 * p, t + 0.75);
        }
        // Vocal folds straining: a buzzy tone with an irregular flutter, not a clean siren.
        const osc = this.tone(o, "sawtooth", 170 * p, 150 * p, t, 0.7, 0.12, 0.05);
        const lfo = this.ctx.createOscillator();
        lfo.type = "square";
        lfo.frequency.value = 31;
        const lg = this.ctx.createGain();
        lg.gain.value = 18 * p;
        lfo.connect(lg).connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + 0.8);
        this.burst(o, "lowpass", 260 * p, 1, t, 0.8, 0.35, 0.03); // chest growl underneath
        break;
      }
      case "idle": {
        const o = this.out(sp, 18, 0.7);
        if (!o) return;
        if (Math.random() < 0.5) {
          // Clicking — a rapid series of short ticks.
          const n = 4 + Math.floor(Math.random() * 6);
          for (let i = 0; i < n; i++) this.burst(o, "bandpass", 2400 * p, 8, t + i * 0.06, 0.02, 0.45);
        } else {
          // Wet, low breathing growl.
          this.burst(o, "lowpass", 300 * p, 3, t, 0.9, 0.5, 0.3);
          this.tone(o, "sawtooth", 70 * p, 55 * p, t, 0.9, 0.12, 0.3);
        }
        break;
      }
      case "windup": {
        const o = this.out(sp, 20, 0.4);
        if (!o) return;
        this.burst(o, "highpass", 2000, 1, t, 0.3, 0.4, 0.05); // hiss
        this.tone(o, "sawtooth", 180 * p, 90 * p, t, 0.35, 0.2);
        break;
      }
      case "hurt": {
        const o = this.out(sp, 30, 0.5);
        if (!o) return;
        this.tone(o, "sawtooth", 420 * p, 200 * p, t, 0.18, 0.3);
        this.burst(o, "bandpass", 1200 * p, 3, t, 0.12, 0.2);
        break;
      }
      case "death": {
        const o = this.out(sp, 30, 0.8);
        if (!o) return;
        this.tone(o, "sawtooth", 300 * p, 60 * p, t, 1.0, 0.3, 0.02);
        this.burst(o, "lowpass", 500, 1, t + 0.6, 0.3, 0.4); // body hits floor
        break;
      }
      case "takedown": {
        // A choked-off gurgle; barely carries.
        const o = this.out(sp, 10, 0.2);
        if (!o) return;
        this.tone(o, "sawtooth", 180 * p, 70 * p, t, 0.35, 0.12, 0.02);
        this.burst(o, "lowpass", 500, 1, t + 0.4, 0.25, 0.3); // body lowered to the floor
        break;
      }
      case "drop": {
        // Lands from the ceiling: a thud and a skitter of claws.
        const o = this.out(sp, 26, 0.5);
        if (!o) return;
        this.burst(o, "lowpass", 260, 1, t, 0.2, 0.6);
        for (let i = 0; i < 5; i++) this.burst(o, "bandpass", 3000 * p, 6, t + 0.15 + i * 0.05, 0.02, 0.25);
        break;
      }
      case "spit": {
        // A wet, rising gurgle as the throat sac fills.
        const o = this.out(sp, 26, 0.5);
        if (!o) return;
        this.burst(o, "bandpass", 500 * p, 2, t, 0.6, 0.35, 0.3);
        this.tone(o, "sawtooth", 90 * p, 180 * p, t, 0.6, 0.12, 0.3);
        this.burst(o, "highpass", 2500, 1, t + 0.6, 0.15, 0.3); // the spit
        break;
      }
      case "slam": {
        const o = this.out(sp, 40, 0.9);
        if (!o) return;
        this.burst(o, "lowpass", 160, 1, t, 0.5, 1.0);
        this.tone(o, "sine", 55, 25, t, 0.7, 0.9);
        break;
      }
      case "roar": {
        // The whole mass screams: a chord of voices, low to high.
        const o = this.out(sp, 60, 1.2);
        if (!o) return;
        for (const f of [55, 82, 110, 165, 247]) {
          const osc = this.tone(o, "sawtooth", f * p * 2, f * p * 1.6, t, 2.2, 0.08, 0.3);
          const lfo = this.ctx.createOscillator();
          lfo.frequency.value = 5 + Math.random() * 4;
          const lg = this.ctx.createGain();
          lg.gain.value = f * 0.08;
          lfo.connect(lg).connect(osc.frequency);
          lfo.start(t);
          lfo.stop(t + 2.6);
        }
        this.burst(o, "lowpass", 300, 1, t, 2.2, 0.5, 0.3);
        break;
      }
    }
  }

  /**
   * Recorded creature voices. One voice for everything the Remnant has
   * rewritten, pitched per creature (`p`: Brutes low, Listeners high); rats
   * have their own. Kinds without a recording stay synthesized.
   */
  private creatureVoice(kind: "alert" | VocalKind, p: number, sp: Spatial, t: number): boolean {
    if (p >= 2.5) {
      const rat: Partial<Record<typeof kind, number>> = { idle: 0.6, alert: 1, windup: 0.8, hurt: 0.9, death: 1, takedown: 0.6 };
      const g = rat[kind];
      return g !== undefined && this.sample("ratVoice", t, sp, g, 0.4, p / 3, 22);
    }
    const map: Partial<Record<typeof kind, [SampleId, number, number]>> = {
      idle: ["creatureIdle", 0.55, 22],
      alert: ["creatureAlert", 1, 36],
      windup: ["creatureWindup", 1, 24],
      hurt: ["creatureHurt", 1, 30],
      death: ["creatureDeath", 1, 30],
      // Choked off, close and muffled.
      takedown: ["creatureDeath", 0.35, 10],
    };
    const m = map[kind];
    if (!m) return false;
    const rate = Math.min(1.4, Math.max(0.45, p));
    const where = kind === "takedown" ? { ...sp, muffled: true } : sp;
    return this.sample(m[0], t, where, m[1], kind === "alert" ? 0.9 : 0.6, rate, m[2]);
  }

  // ---------------------------------------------------------------- ambience

  private startAmbient(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.09;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 140;
    for (const f of [41, 41.6, 62]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const n = this.noise();
    const nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.value = 220;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    n.connect(nf).connect(ng).connect(lp);
    n.start();
    // Slow swell in the drone
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 60;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    lp.connect(g).connect(this.master);
  }

  /** Random distant sounds (drips, metal groans, clanks) — call every frame. */
  updateAmbient(dt: number): void {
    if (!this.ctx) return;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 3 + Math.random() * 9;
    const t = this.ctx.currentTime;
    const sp: Spatial = { pan: Math.random() * 2 - 1, distance: 6 + Math.random() * 10, muffled: Math.random() < 0.6 };
    const o = this.out(sp, 20, 1.6);
    if (!o) return;
    const r = Math.random();
    if (r < 0.4) {
      // Water drip
      this.tone(o, "sine", 1800 + Math.random() * 800, 600, t, 0.08, 0.35);
    } else if (r < 0.7) {
      // Metal groan
      this.tone(o, "triangle", 90 + Math.random() * 60, 60, t, 2.2, 0.25, 0.6);
      this.burst(o, "bandpass", 400, 12, t, 2, 0.12, 0.6);
    } else {
      // Clank
      this.burst(o, "bandpass", 900 + Math.random() * 900, 10, t, 0.4, 0.6);
      this.tone(o, "sine", 600, 580, t, 0.6, 0.15);
    }
  }
}
