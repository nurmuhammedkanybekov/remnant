/**
 * Difficulty modes. Every tunable that changes between modes lives here, so
 * balancing is a data change rather than a code change.
 */
export interface DifficultyDef {
  id: DifficultyId;
  name: string;
  description: string;
  enemyHealth: number;
  enemyDamage: number;
  /** Scales how far enemies see and hear. */
  enemyPerception: number;
  /** Scales how fast creatures run once they're hunting you. */
  enemySpeed: number;
  /** Extra creatures on each level, as a fraction of its own (0.6 = 60% more). See `world/reinforcements.ts`. */
  extraEnemies: number;
  /** Scales ammo, medkit and battery pickups. */
  pickupMultiplier: number;
  /** Scales how fast the flashlight drains. */
  batteryDrain: number;
  /** Reserve ammo at the start of a new campaign. */
  startingReserve: number;
  /** Medkits carried at the start of a new campaign. */
  startingMedkits: number;
  /** Health and battery are topped up to at least these between levels. */
  carryHealthFloor: number;
  carryBatteryFloor: number;
  /** One life for the whole campaign: death ends the run and deletes the save. */
  permadeath: boolean;
}

export type DifficultyId = "story" | "normal" | "nightmare" | "ironman";

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  story: {
    id: "story",
    name: "Story",
    description: "For the plot. The fewest creatures, slow to notice you, soft hits.",
    enemyHealth: 0.7,
    enemyDamage: 0.5,
    enemyPerception: 0.75,
    enemySpeed: 0.9,
    extraEnemies: 0,
    pickupMultiplier: 1.5,
    batteryDrain: 0.6,
    startingReserve: 32,
    startingMedkits: 2,
    carryHealthFloor: 70,
    carryBatteryFloor: 50,
    permadeath: false,
  },
  normal: {
    id: "normal",
    name: "Normal",
    description: "The intended experience. Scarce, tense, dangerous.",
    enemyHealth: 1,
    enemyDamage: 1.25,
    enemyPerception: 1.1,
    enemySpeed: 1.1,
    extraEnemies: 0.6,
    pickupMultiplier: 1,
    batteryDrain: 1,
    startingReserve: 16,
    startingMedkits: 1,
    carryHealthFloor: 40,
    carryBatteryFloor: 30,
    permadeath: false,
  },
  nightmare: {
    id: "nightmare",
    name: "Nightmare",
    description: "Twice the creatures. They hear everything. Every bullet counts.",
    enemyHealth: 1.35,
    enemyDamage: 1.75,
    enemyPerception: 1.3,
    enemySpeed: 1.2,
    extraEnemies: 1,
    pickupMultiplier: 0.75,
    batteryDrain: 1.3,
    startingReserve: 8,
    startingMedkits: 0,
    carryHealthFloor: 25,
    carryBatteryFloor: 20,
    permadeath: false,
  },
  ironman: {
    id: "ironman",
    name: "Ironman",
    description: "Normal balance, one life. Die and the run is over.",
    enemyHealth: 1,
    enemyDamage: 1.25,
    enemyPerception: 1.1,
    enemySpeed: 1.1,
    extraEnemies: 0.6,
    pickupMultiplier: 1,
    batteryDrain: 1,
    startingReserve: 16,
    startingMedkits: 1,
    carryHealthFloor: 40,
    carryBatteryFloor: 30,
    permadeath: true,
  },
};

export const DIFFICULTY_ORDER: DifficultyId[] = ["story", "normal", "nightmare", "ironman"];

export function isDifficultyId(v: unknown): v is DifficultyId {
  return typeof v === "string" && v in DIFFICULTIES;
}
