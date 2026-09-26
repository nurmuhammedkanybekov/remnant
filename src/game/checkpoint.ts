import { parseLoadout, type Loadout } from "./loadout";
import { freshStats, type RunStats } from "./stats";

/**
 * Everything needed to resume a level mid-way. Indices refer to the order
 * things appear in the parsed level, which is deterministic for a given map.
 * Enemies that were alive restart from their spawn points.
 */
export interface CheckpointState {
  x: number;
  z: number;
  yaw: number;
  loadout: Loadout;
  stats: RunStats;
  collected: number[];
  killed: number[];
  doorsOpen: number[];
  generatorsOn: number[];
  intercomsUsed: number[];
  markersReached: number[];
  firedTriggers: string[];
  hasKeycard: boolean;
  objective: string;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const indices = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 0) : []);

/** Validates a checkpoint read from storage. Anything structurally wrong → null (restart the level instead). */
export function parseCheckpoint(raw: unknown): CheckpointState | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const loadout = parseLoadout(c.loadout);
  if (!isNum(c.x) || !isNum(c.z) || !isNum(c.yaw) || !loadout || typeof c.objective !== "string") return null;
  const stats = freshStats();
  const s = c.stats as Record<string, unknown> | undefined;
  if (s) for (const k of Object.keys(stats) as (keyof RunStats)[]) if (isNum(s[k])) stats[k] = Math.max(0, s[k] as number);
  return {
    x: c.x,
    z: c.z,
    yaw: c.yaw,
    loadout,
    stats,
    collected: indices(c.collected),
    killed: indices(c.killed),
    doorsOpen: indices(c.doorsOpen),
    generatorsOn: indices(c.generatorsOn),
    intercomsUsed: indices(c.intercomsUsed),
    markersReached: indices(c.markersReached),
    firedTriggers: Array.isArray(c.firedTriggers) ? c.firedTriggers.filter((t): t is string => typeof t === "string") : [],
    hasKeycard: c.hasKeycard === true,
    objective: c.objective,
  };
}
