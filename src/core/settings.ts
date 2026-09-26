import { normalizeBindings, type Bindings } from "./actions";
import { readJson, writeJson } from "./storage";

export interface Settings {
  /** Mouse sensitivity multiplier, 0.2..3. */
  sensitivity: number;
  /** Master volume, 0..1. */
  volume: number;
  /** Vertical field of view in degrees. */
  fov: number;
  invertY: boolean;
  bindings: Bindings;
}

const KEY = "remnant.settings.v1";

export function defaultSettings(): Settings {
  return { sensitivity: 1, volume: 0.8, fov: 75, invertY: false, bindings: normalizeBindings(null) };
}

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Validates stored settings field by field, so one bad value can't break the rest. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== "object") return d;
  const s = raw as Record<string, unknown>;
  return {
    sensitivity: clamp(s.sensitivity, 0.2, 3, d.sensitivity),
    volume: clamp(s.volume, 0, 1, d.volume),
    fov: clamp(s.fov, 60, 100, d.fov),
    invertY: typeof s.invertY === "boolean" ? s.invertY : d.invertY,
    bindings: normalizeBindings(s.bindings),
  };
}

export function loadSettings(): Settings {
  return normalizeSettings(readJson(KEY));
}

export function saveSettings(s: Settings): void {
  writeJson(KEY, s);
}
