import type * as THREE from "three";

const MERCY_TIME = 0.35; // brief invulnerability so two simultaneous hits don't stack

export class Health {
  current: number;
  readonly max: number;
  private mercy = 0;
  onDeath: (() => void) | null = null;
  onDamage: ((amount: number, source?: THREE.Vector2) => void) | null = null;

  constructor(max = 100) {
    this.max = max;
    this.current = max;
  }

  get isDead(): boolean {
    return this.current <= 0;
  }

  get fraction(): number {
    return this.current / this.max;
  }

  update(dt: number): void {
    this.mercy = Math.max(0, this.mercy - dt);
  }

  takeDamage(amount: number, source?: THREE.Vector2): void {
    if (this.isDead || this.mercy > 0) return;
    this.mercy = MERCY_TIME;
    const before = this.current;
    this.current = Math.max(0, this.current - amount);
    this.onDamage?.(before - this.current, source);
    if (this.isDead) this.onDeath?.();
  }

  heal(amount: number): void {
    this.current = Math.min(this.max, this.current + amount);
  }
}
