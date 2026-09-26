import type { DifficultyDef } from "../content/difficulty";
import { WEAPONS } from "../content/weapons";
import { MAX_BATTERY } from "../player/flashlight";

/** What the player carries from one level into the next. */
export interface Loadout {
  health: number;
  battery: number;
  mag: number;
  reserve: number;
}

export function startingLoadout(difficulty: DifficultyDef): Loadout {
  return { health: 100, battery: MAX_BATTERY, mag: WEAPONS.pistol.magSize, reserve: difficulty.startingReserve };
}

/** The loadout for the next level: what you finished with, plus a breather so a bad run isn't unwinnable. */
export function carryOver(end: Loadout, difficulty: DifficultyDef): Loadout {
  return {
    ...end,
    health: Math.max(end.health, difficulty.carryHealthFloor),
    battery: Math.max(end.battery, difficulty.carryBatteryFloor),
  };
}
