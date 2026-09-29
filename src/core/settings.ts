import { isCharacterLook, type CharacterLook } from "../content/characters";
import { normalizeBindings, type Bindings } from "./actions";
import { isQualityId, type QualityId } from "./quality";
import { readJson, writeJson } from "./storage";

export type SubtitleSize = "small" | "medium" | "large";
export const SUBTITLE_SIZES: SubtitleSize[] = ["small", "medium", "large"];
/** Co-op voice: talk while holding a key, always on, or not at all. */
export type VoiceMode = "ptt" | "open" | "off";
export const VOICE_MODES: VoiceMode[] = ["ptt", "open", "off"];

export interface Settings {
  /** Mouse sensitivity multiplier, 0.2..3. */
  sensitivity: number;
  /** Gamepad look speed multiplier, 0.2..3. */
  padSensitivity: number;
  /** Master volume, 0..1. */
  volume: number;
  /** Music volume relative to master, 0..1. */
  musicVolume: number;
  /** Vertical field of view in degrees. */
  fov: number;
  invertY: boolean;
  quality: QualityId;
  subtitleSize: SubtitleSize;
  /** Scales the HUD, 0.8..1.4. */
  hudScale: number;
  /** Tones camera shake, head bob and recoil kick right down. */
  reducedShake: boolean;
  /** Swaps the HUD's red/green signals for a colour-blind safe palette. */
  colorBlind: boolean;
  /** How you look to your co-op partner, and your own hands. */
  look: CharacterLook;
  voice: VoiceMode;
  bindings: Bindings;
}

const KEY = "remnant.settings.v1";

export function defaultSettings(): Settings {
  return {
    sensitivity: 1,
    padSensitivity: 1,
    volume: 0.8,
    musicVolume: 0.7,
    fov: 75,
    invertY: false,
    quality: "high",
    subtitleSize: "medium",
    hudScale: 1,
    reducedShake: false,
    colorBlind: false,
    look: "light",
    voice: "ptt",
    bindings: normalizeBindings(null),
  };
}

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Validates stored settings field by field, so one bad value can't break the rest. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== "object") return d;
  const s = raw as Record<string, unknown>;
  return {
    sensitivity: clamp(s.sensitivity, 0.2, 3, d.sensitivity),
    padSensitivity: clamp(s.padSensitivity, 0.2, 3, d.padSensitivity),
    volume: clamp(s.volume, 0, 1, d.volume),
    musicVolume: clamp(s.musicVolume, 0, 1, d.musicVolume),
    fov: clamp(s.fov, 60, 100, d.fov),
    invertY: bool(s.invertY, d.invertY),
    quality: isQualityId(s.quality) ? s.quality : d.quality,
    subtitleSize: SUBTITLE_SIZES.includes(s.subtitleSize as SubtitleSize) ? (s.subtitleSize as SubtitleSize) : d.subtitleSize,
    hudScale: clamp(s.hudScale, 0.8, 1.4, d.hudScale),
    reducedShake: bool(s.reducedShake, d.reducedShake),
    colorBlind: bool(s.colorBlind, d.colorBlind),
    look: isCharacterLook(s.look) ? s.look : d.look,
    voice: VOICE_MODES.includes(s.voice as VoiceMode) ? (s.voice as VoiceMode) : d.voice,
    bindings: normalizeBindings(s.bindings),
  };
}

export function loadSettings(): Settings {
  return normalizeSettings(readJson(KEY));
}

export function saveSettings(s: Settings): void {
  writeJson(KEY, s);
}
