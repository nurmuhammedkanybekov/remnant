import type { LevelDef } from "../levelDef";
import { LEVEL_1 } from "./level1";
import { LEVEL_2 } from "./level2";

/** Played in order. Reaching the exit of the last one wins the game. */
export const LEVELS: LevelDef[] = [LEVEL_1, LEVEL_2];
