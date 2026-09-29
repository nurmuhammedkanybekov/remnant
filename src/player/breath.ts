/**
 * Your breathing. Creatures right next to you can hear it; holding your
 * breath (a key you hold) silences it for a few seconds, so something can
 * walk past you in the dark. Let go early and you breathe out quietly; run
 * out of air and you gasp, loud enough to be heard down the corridor.
 */

/** How far (world units, before a creature's hearing) your breathing carries. */
export const BREATH_NOISE = 1.8;
/** A gasp for air after holding it too long. */
export const GASP_NOISE = 6;
/** Letting it out on purpose. */
export const EXHALE_NOISE = 1.2;
/** Seconds you can hold it from full lungs. */
export const HOLD_TIME = 7;
/** Seconds to get back to full lungs. */
export const REFILL_TIME = 4;
/** Pause after breathing out before the lungs start to refill. */
const REFILL_DELAY = 0.8;
/** You can't start holding with less air than this. */
const MIN_TO_HOLD = 0.25;

export type BreathEvent = "hold" | "release" | "gasp";

export class Breath {
  /** 0..1 air left. */
  air = 1;
  held = false;
  private delay = 0;

  /** Your breathing's noise radius this frame. */
  get noise(): number {
    return this.held ? 0 : BREATH_NOISE;
  }

  /** `want`: the key is down and holding is allowed (not sprinting, not down). */
  update(dt: number, want: boolean): BreathEvent | null {
    if (this.held) {
      this.air = Math.max(0, this.air - dt / HOLD_TIME);
      if (this.air <= 0) return this.let("gasp");
      if (!want) return this.let("release");
      return null;
    }
    if (want && this.air >= MIN_TO_HOLD && this.delay <= 0) {
      this.held = true;
      return "hold";
    }
    if (this.delay > 0) this.delay -= dt;
    else this.air = Math.min(1, this.air + dt / REFILL_TIME);
    return null;
  }

  /** Breathe normally again (a level restart, being knocked down). */
  reset(): void {
    this.air = 1;
    this.held = false;
    this.delay = 0;
  }

  private let(kind: "release" | "gasp"): BreathEvent {
    this.held = false;
    // A gasp leaves you winded a little longer.
    this.delay = kind === "gasp" ? REFILL_DELAY * 2 : REFILL_DELAY;
    return kind;
  }
}
