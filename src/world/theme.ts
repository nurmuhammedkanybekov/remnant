/** Per-level atmosphere. Levels override only what they need. */
export interface LevelTheme {
  fog: number;
  fogDensity: number;
  /** Hemisphere fill light: sky colour, ground colour, intensity. */
  skyLight: number;
  groundLight: number;
  fillIntensity: number;
  /** Multiplied into the wall and floor textures. */
  wallTint: number;
  floorTint: number;
  /** Colour of warm ceiling lamps (`L`). */
  lampColor: number;
  /**
   * Out under the sky (Part Two's valley): "streets" opens the largest area
   * you can walk without passing a door (the village's streets and square;
   * the houses keep their roofs), "water" opens the water and the walkways
   * between it (the dam's reservoir). Snow falls there.
   */
  outdoor?: "streets" | "water";
  /**
   * What the walls are built from. Concrete unless said otherwise: timber for
   * the village's houses, rock for caverns, tile for the old laboratories.
   */
  walls?: "concrete" | "timber" | "rock" | "tile";
  /**
   * Out on the mountain: every wall that faces the open sky and isn't part of
   * a building becomes a tall, broken face of rock, so the open ground reads
   * as a ledge, a gully or a valley floor rather than a maze.
   */
  cliffs?: boolean;
  /** What's on the horizon under the open sky: a low ridge (the valley floor) or the high peaks (up on the mountain). */
  skyline?: "ridge" | "peaks";
}

export const DEFAULT_THEME: LevelTheme = {
  fog: 0x050607,
  fogDensity: 0.06,
  skyLight: 0x55606a,
  groundLight: 0x1a1510,
  fillIntensity: 1.1,
  wallTint: 0xffffff,
  floorTint: 0xffffff,
  lampColor: 0xffd9a0,
};

export function resolveTheme(t: Partial<LevelTheme> | undefined): LevelTheme {
  return { ...DEFAULT_THEME, ...t };
}
