/**
 * Watches the frame rate while you play and says when the graphics should
 * come down a step: a run of slow windows in a row, after a warm-up (the
 * first seconds of a level are full of one-off work). Pure, so it can be
 * tested without a GPU.
 */
export class QualityGuard {
  private elapsed = 0;
  private frames = 0;
  private slowWindows = 0;
  private warmup: number;
  private cooldown = 0;

  constructor(
    /** Below this many frames a second, a window counts as slow. */
    private readonly minFps = 28,
    /** Seconds per window, and how many slow ones in a row it takes. */
    private readonly window = 4,
    private readonly needed = 2,
    warmup = 6
  ) {
    this.warmup = warmup;
  }

  /** A level started (or the game came back from a pause): give it time to settle. */
  reset(warmup = 6): void {
    this.elapsed = 0;
    this.frames = 0;
    this.slowWindows = 0;
    this.warmup = warmup;
  }

  /** One rendered frame of `dt` seconds. True when it's time to step the quality down. */
  frame(dt: number): boolean {
    if (dt > 0.5) return false; // a hitch (tab switch, level load), not the frame rate
    if (this.warmup > 0) {
      this.warmup -= dt;
      return false;
    }
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return false;
    }
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < this.window) return false;
    const fps = this.frames / this.elapsed;
    this.elapsed = 0;
    this.frames = 0;
    this.slowWindows = fps < this.minFps ? this.slowWindows + 1 : 0;
    if (this.slowWindows < this.needed) return false;
    this.slowWindows = 0;
    this.cooldown = 15;
    return true;
  }
}
