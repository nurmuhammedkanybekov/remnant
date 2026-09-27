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
  /** Extra creatures on each level, as a fraction of its own (0.8 = 80% more). See `world/reinforcements.ts`. */
  extraEnemies: number;
  /** Scales what each ammo, medkit and battery pickup gives. */
  pickupMultiplier: number;
  /** How many ammo, medkit and battery pickups a level has, relative to its map (0.55 = 45% fewer). See `world/loot.ts`. */
  lootSupply: number;
  /** Scales how fast the flashlight drains. */
  batteryDrain: number;
  /** Reserve ammo at the start of a new campaign. */
  startingReserve: number;
  /** Medkits carried at the start of a new campaign. */
  startingMedkits: number;
  /** Health and battery are topped up to at least these between levels. */
  carryHealthFloor: number;
  carryBatteryFloor: number;
  /** Pistol rounds (magazine + reserve) topped up to at least this between levels and when retrying after a death. */
  carryAmmoFloor: number;
  /** One life for the whole campaign: death ends the run and deletes the save. */
  permadeath: boolean;
}

export type DifficultyId = "story" | "normal" | "nightmare" | "ironman" | "aizi";

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
    lootSupply: 1.4,
    batteryDrain: 0.6,
    startingReserve: 32,
    startingMedkits: 2,
    carryHealthFloor: 70,
    carryBatteryFloor: 50,
    carryAmmoFloor: 32,
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
    extraEnemies: 0.8,
    pickupMultiplier: 1,
    lootSupply: 1,
    batteryDrain: 1,
    startingReserve: 16,
    startingMedkits: 1,
    carryHealthFloor: 40,
    carryBatteryFloor: 30,
    carryAmmoFloor: 24,
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
    extraEnemies: 1.3,
    pickupMultiplier: 1,
    lootSupply: 1,
    batteryDrain: 1.3,
    startingReserve: 12,
    startingMedkits: 0,
    carryHealthFloor: 25,
    carryBatteryFloor: 20,
    carryAmmoFloor: 16,
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
    extraEnemies: 0.8,
    pickupMultiplier: 1,
    lootSupply: 1,
    batteryDrain: 1,
    startingReserve: 16,
    startingMedkits: 1,
    carryHealthFloor: 40,
    carryBatteryFloor: 30,
    carryAmmoFloor: 24,
    permadeath: true,
  },
  aizi: {
    id: "aizi",
    name: "Aizi",
    description: "Beyond Nightmare, one life. The station is full, it never stops listening, and nothing is spared.",
    enemyHealth: 1.6,
    enemyDamage: 2.2,
    enemyPerception: 1.5,
    enemySpeed: 1.3,
    extraEnemies: 1.8,
    pickupMultiplier: 0.7,
    lootSupply: 0.65,
    batteryDrain: 1.5,
    startingReserve: 8,
    startingMedkits: 0,
    carryHealthFloor: 15,
    carryBatteryFloor: 15,
    carryAmmoFloor: 8,
    permadeath: true,
  },
};

export const DIFFICULTY_ORDER: DifficultyId[] = ["story", "normal", "nightmare", "ironman", "aizi"];

export function isDifficultyId(v: unknown): v is DifficultyId {
  return typeof v === "string" && v in DIFFICULTIES;
}
