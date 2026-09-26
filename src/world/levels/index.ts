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

/** The campaign, bottom to top. Reaching the end of the last one finishes the game. */
export const LEVELS: LevelDef[] = [
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
