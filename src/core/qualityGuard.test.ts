import { describe, expect, it } from "vitest";
import { QualityGuard } from "./qualityGuard";

const run = (g: QualityGuard, fps: number, seconds: number) => {
  let fired = 0;
  for (let t = 0; t < seconds; t += 1 / fps) if (g.frame(1 / fps)) fired++;
  return fired;
};

describe("automatic quality", () => {
  it("leaves a smooth game alone", () => {
    expect(run(new QualityGuard(), 60, 60)).toBe(0);
  });
  it("steps down once a slow game has stayed slow, after the warm-up", () => {
    const g = new QualityGuard();
    expect(run(g, 20, 6)).toBe(0); // still warming up
    expect(run(g, 20, 9)).toBe(1);
  });
  it("doesn't count one slow moment", () => {
    const g = new QualityGuard();
    run(g, 60, 8);
    expect(run(g, 20, 4) + run(g, 60, 8)).toBe(0);
  });
  it("ignores a single long hitch", () => {
    const g = new QualityGuard(28, 4, 2, 0);
    expect(g.frame(2)).toBe(false);
    expect(run(g, 60, 10)).toBe(0);
  });
});
