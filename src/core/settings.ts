export interface Settings {
  sensitivity: number; // multiplier, 0.2..3
  volume: number; // 0..1
  fov: number; // degrees
  invertY: boolean;
}

const KEY = "remnant.settings.v1";
const DEFAULTS: Settings = { sensitivity: 1, volume: 0.8, fov: 75, invertY: false };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable — fall back to defaults */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
