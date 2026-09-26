import { describe, expect, it } from "vitest";
import { IntensityTracker, mixFor } from "./music";

function run(t: IntensityTracker, threat: number, seconds: number): number {
  for (let s = 0; s < seconds; s += 1 / 30) t.update(1 / 30, threat);
  return t.level;
}

describe("music intensity", () => {
  it("rises fast when you're hunted and falls slowly afterwards", () => {
    const t = new IntensityTracker();
    expect(run(t, 1, 1)).toBe(1);
    // Holds through the first few seconds after the chase ends...
    expect(run(t, 0, 3)).toBe(1);
    // ...then drifts back down over several seconds, not instantly.
    const later = run(t, 0, 4);
    expect(later).toBeLessThan(1);
    expect(later).toBeGreaterThan(0.5);
    expect(run(t, 0, 20)).toBe(0);
  });

  it("settles on a suspicious creature's threat without a chase", () => {
    const t = new IntensityTracker();
    expect(run(t, 0.6, 3)).toBeCloseTo(0.6);
  });
});

describe("music mix", () => {
  it("is silent when told to be", () => {
    expect(Object.values(mixFor("silent", 1)).every((v) => v === 0)).toBe(true);
  });

  it("moves from calm to tension to chase as danger grows", () => {
    const calm = mixFor("game", 0);
    const tense = mixFor("game", 0.6);
    const chase = mixFor("game", 1);
    expect(calm.texture).toBe(1);
    expect(calm.tension).toBe(0);
    expect(tense.tension).toBeGreaterThan(0.9);
    expect(tense.chase).toBe(0);
    expect(tense.texture).toBeLessThan(calm.texture);
    expect(chase.chase).toBe(1);
    expect(chase.texture).toBe(0);
  });
});
