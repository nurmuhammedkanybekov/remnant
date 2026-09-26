export class Clock {
  private last = performance.now();

  /** Delta time in seconds, clamped to avoid huge jumps after tab-switch/pause. */
  tick(): number {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    return Math.min(dt, 1 / 20);
  }
}
