/**
 * Your nerve: how frightened you are, 0 (steady) to 1 (barely holding it
 * together). Dread is the moment (something is close); nerve is what it
 * leaves behind. It climbs while something you can't see is near, while you
 * stand in the dark without a light, when you're hurt, and in a jolt when
 * something makes you jump. It settles slowly once it's quiet, and faster in
 * a lamp's light: people calm down where they can see.
 *
 * A frightened person shakes and breathes hard, so it costs you: your aim
 * wanders (see `tremor`), your breathing carries further (see
 * `breathScale`), and the edges of your sight close in.
 */

/** Per second, at full dread. */
const DREAD_RATE = 0.22;
/** Per second, standing in the dark with no light of your own. */
const DARK_RATE = 0.018;
/** Per second, settling when nothing's near. */
const CALM_RATE = 0.045;
/** How much faster you settle in a lamp's light. */
const LIGHT_CALM = 2.6;
/** Dread below this counts as quiet. */
const QUIET = 0.15;
/** Darkness alone only takes you this far. */
const DARK_CEILING = 0.45;

export interface NerveInput {
  /** 0..1: how close something is that you can't see (see LevelSession.updateDread). */
  dread: number;
  /** No light of your own and none from a lamp. */
  dark: boolean;
  /** Standing in a lamp's light. */
  lamplit: boolean;
}

export class Nerve {
  level = 0;

  update(dt: number, input: NerveInput): void {
    let v = this.level;
    if (input.dread > QUIET) v += DREAD_RATE * input.dread * dt;
    else if (input.dark && v < DARK_CEILING) v = Math.min(DARK_CEILING, v + DARK_RATE * dt);
    else v -= CALM_RATE * (input.lamplit ? LIGHT_CALM : 1) * dt;
    this.level = Math.min(1, Math.max(0, v));
  }

  /** A jolt: a scare, a hit, something bursting out at you. */
  shock(amount: number): void {
    this.level = Math.min(1, this.level + amount);
  }

  reset(): void {
    this.level = 0;
  }

  /** 0..1: how much your hands shake. Nothing until you're properly frightened. */
  get tremor(): number {
    const t = Math.min(1, Math.max(0, (this.level - 0.35) / 0.65));
    return t * t * (3 - 2 * t);
  }

  /** Your breathing's noise radius is multiplied by this: panting carries. */
  get breathScale(): number {
    return 1 + this.level * 0.8;
  }
}
