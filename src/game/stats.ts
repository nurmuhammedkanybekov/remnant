/** Per-level (and whole-run) performance numbers shown on the result screens. */
export interface RunStats {
  /** Seconds. */
  time: number;
  kills: number;
  shots: number;
  hits: number;
  headshots: number;
  damageTaken: number;
}

export function freshStats(): RunStats {
  return { time: 0, kills: 0, shots: 0, hits: 0, headshots: 0, damageTaken: 0 };
}

export function addStats(into: RunStats, s: RunStats): void {
  into.time += s.time;
  into.kills += s.kills;
  into.shots += s.shots;
  into.hits += s.hits;
  into.headshots += s.headshots;
  into.damageTaken += s.damageTaken;
}

export function accuracy(s: RunStats): number {
  return s.shots > 0 ? s.hits / s.shots : 0;
}
