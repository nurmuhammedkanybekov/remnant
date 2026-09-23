import * as THREE from "three";

/** All sound effects are synthesized at runtime — no external audio assets. */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientNodes: AudioNode[] = [];

  /** Must be called from within a user-gesture handler (browsers block audio otherwise). */
  init(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.createNoiseBuffer(1);
    this.startAmbient();
  }

  private createNoiseBuffer(duration: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  private attenuationGain(distance: number, maxDist: number): number {
    const t = THREE.MathUtils.clamp(1 - distance / maxDist, 0, 1);
    return t * t;
  }

  playGunshot(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const noise = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1400;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.9, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.2);

    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.setValueAtTime(140, now);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.5, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    click.connect(clickGain).connect(this.master);
    click.start(now);
    click.stop(now + 0.05);
  }

  playEmptyClick(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.setValueAtTime(400, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    click.connect(gain).connect(this.master);
    click.start(now);
    click.stop(now + 0.04);
  }

  playFootstep(sprinting: boolean): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const noise = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(sprinting ? 0.35 : 0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.1);
  }

  playPickup(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(1040, now + 0.15);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  playPlayerDamage(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  playEnemyAlert(distance: number): void {
    if (!this.ctx || !this.master) return;
    const vol = this.attenuationGain(distance, 14);
    if (vol <= 0.01) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.4);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol * 0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  private startAmbient(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const noise = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 120;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start();
    this.ambientNodes.push(noise, filter, gain);
  }
}
