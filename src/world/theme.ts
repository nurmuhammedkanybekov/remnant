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
