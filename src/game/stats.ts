/** Per-level (and whole-run) performance numbers shown on the result screens. */
export interface RunStats {
  /** Seconds. */
  time: number;
  kills: number;
  shots: number;
  hits: number;
  headshots: number;
  /** Silent melee kills from behind. */
  takedowns: number;
  damageTaken: number;
  /** Hidden rooms found (loose panels pried open). */
  secrets: number;
}

export function freshStats(): RunStats {
  return { time: 0, kills: 0, shots: 0, hits: 0, headshots: 0, takedowns: 0, damageTaken: 0, secrets: 0 };
}

export function addStats(into: RunStats, s: RunStats): void {
  into.time += s.time;
  into.kills += s.kills;
  into.shots += s.shots;
  into.hits += s.hits;
  into.headshots += s.headshots;
  into.takedowns += s.takedowns;
  into.damageTaken += s.damageTaken;
  into.secrets += s.secrets;
}

export function accuracy(s: RunStats): number {
  return s.shots > 0 ? s.hits / s.shots : 0;
}
