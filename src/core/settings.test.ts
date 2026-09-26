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
    expect(s.quality).toBe("high");
    expect(s.musicVolume).toBe(defaultSettings().musicVolume);
  });

  it("validates the display and accessibility options", () => {
    const s = normalizeSettings({ quality: "ultra", subtitleSize: "huge", hudScale: 5, reducedShake: "yes", colorBlind: true });
    expect(s.quality).toBe(defaultSettings().quality);
    expect(s.subtitleSize).toBe("medium");
    expect(s.hudScale).toBe(1.4);
    expect(s.reducedShake).toBe(false);
    expect(s.colorBlind).toBe(true);
  });

  it("keeps a valid character look and drops an unknown one", () => {
    expect(normalizeSettings({ look: "woman" }).look).toBe("woman");
    expect(normalizeSettings({ look: "dark" }).look).toBe("dark");
    expect(normalizeSettings({ look: "alien" }).look).toBe(defaultSettings().look);
  });
});
