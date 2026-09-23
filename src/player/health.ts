export class Health {
  current: number;
  readonly max: number;
  onDeath: (() => void) | null = null;
  onDamage: ((amount: number) => void) | null = null;

  constructor(max = 100) {
    this.max = max;
    this.current = max;
  }

  get isDead(): boolean {
    return this.current <= 0;
  }

  takeDamage(amount: number): void {
    if (this.isDead) return;
    this.current = Math.max(0, this.current - amount);
    this.onDamage?.(amount);
    if (this.isDead) this.onDeath?.();
  }

  heal(amount: number): void {
    this.current = Math.min(this.max, this.current + amount);
  }
}
