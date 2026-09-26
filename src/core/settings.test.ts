import { describe, expect, it } from "vitest";
import { defaultSettings, normalizeSettings } from "./settings";

describe("normalizeSettings", () => {
  it("returns defaults for missing or corrupt data", () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings("{")).toEqual(defaultSettings());
  });

  it("clamps out-of-range values and keeps valid ones", () => {
    const s = normalizeSettings({ sensitivity: 99, volume: -1, fov: 90, invertY: true });
    expect(s.sensitivity).toBe(3);
    expect(s.volume).toBe(0);
    expect(s.fov).toBe(90);
    expect(s.invertY).toBe(true);
  });

  it("upgrades v1 settings saved before key rebinding existed", () => {
    const s = normalizeSettings({ sensitivity: 1.5, volume: 0.5, fov: 80, invertY: false });
    expect(s.bindings.fire).toEqual(["Mouse0", null]);
  });
});
