import type { LevelDef } from "../levelDef";
import { ARMORY } from "./armory";
import { COLD_STORAGE } from "./coldStorage";
import { CONTAINMENT_LABS } from "./containmentLabs";
import { HIVE } from "./hive";
import { INFIRMARY } from "./infirmary";
import { LIFT_SHAFT } from "./liftShaft";
import { MAINTENANCE_WING } from "./maintenanceWing";
import { POWER_PLANT } from "./powerPlant";
import { PUMPING_STATION } from "./pumpingStation";
import { VENTILATION } from "./ventilation";
import { VILLAGE_CLINIC } from "./part2/villageClinic";
import { VILLAGE } from "./part2/village";
import { HYDRO_DAM } from "./part2/hydroDam";
import { OBSERVATORY } from "./part2/observatory";
import { RAIL_TUNNEL } from "./part2/railTunnel";
import { THE_DEEP } from "./part2/theDeep";
import { THE_SOURCE } from "./part2/theSource";

/** Part One, Object 9: bottom of the mountain to the top. */
const PART_ONE: LevelDef[] = [
  INFIRMARY,
  MAINTENANCE_WING,
  COLD_STORAGE,
  PUMPING_STATION,
  CONTAINMENT_LABS,
  VENTILATION,
  POWER_PLANT,
  ARMORY,
  HIVE,
  LIFT_SHAFT,
];

/** Part Two, The Valley: the village below, then back into the mountain from underneath. Each level harder than the last. */
const PART_TWO: LevelDef[] = [VILLAGE_CLINIC, VILLAGE, HYDRO_DAM, OBSERVATORY, RAIL_TUNNEL, THE_DEEP, THE_SOURCE];

/** The whole campaign, in order. Indices are what saves and checkpoints store, so levels are only ever added at the end. */
export const LEVELS: LevelDef[] = [...PART_ONE, ...PART_TWO];

export interface Part {
  id: 1 | 2;
  /** "Part One" */
  title: string;
  /** "Object 9" */
  name: string;
  /** Indices into LEVELS, inclusive. */
  first: number;
  last: number;
}

export const PARTS: readonly Part[] = [
  { id: 1, title: "Part One", name: "Object 9", first: 0, last: PART_ONE.length - 1 },
  { id: 2, title: "Part Two", name: "The Valley", first: PART_ONE.length, last: PART_ONE.length + PART_TWO.length - 1 },
];

/** The part a level belongs to. */
export function partOf(levelIndex: number): Part {
  return PARTS.find((p) => levelIndex >= p.first && levelIndex <= p.last) ?? PARTS[0];
}
