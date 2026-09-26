/**
 * Graphics quality presets. Everything that costs GPU time and can be
 * turned down lives here, so a slow machine is one setting away from
 * playable.
 */
export type QualityId = "low" | "medium" | "high";

export interface QualityPreset {
  id: QualityId;
  name: string;
  /** Cap on the device pixel ratio the game renders at. */
  pixelRatioCap: number;
  /** Real-time lights shared between the nearest lamps (see `LampSystem`). */
  lampLights: number;
  /** Bump-mapped walls and floors. */
  bumpMaps: boolean;
  /** Dust motes floating in the flashlight beam. */
  dustMotes: number;
  /** Film grain and chromatic aberration in the final pass. */
  filmEffects: boolean;
}

export const QUALITY: Record<QualityId, QualityPreset> = {
  low: { id: "low", name: "Low", pixelRatioCap: 0.75, lampLights: 3, bumpMaps: false, dustMotes: 80, filmEffects: false },
  medium: { id: "medium", name: "Medium", pixelRatioCap: 1, lampLights: 4, bumpMaps: true, dustMotes: 160, filmEffects: true },
  high: { id: "high", name: "High", pixelRatioCap: 1.5, lampLights: 6, bumpMaps: true, dustMotes: 260, filmEffects: true },
};

export const QUALITY_ORDER: QualityId[] = ["low", "medium", "high"];

export function isQualityId(v: unknown): v is QualityId {
  return typeof v === "string" && v in QUALITY;
}
