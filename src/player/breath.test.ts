import { describe, expect, it } from "vitest";
import { Breath, BREATH_NOISE, HOLD_TIME, REFILL_TIME } from "./breath";

const step = (b: Breath, seconds: number, want: boolean) => {
  const events: string[] = [];
  for (let t = 0; t < seconds; t += 0.05) {
    const e = b.update(0.05, want);
    if (e) events.push(e);
  }
  return events;
};

describe("holding your breath", () => {
  it("silences your breathing while held", () => {
    const b = new Breath();
    expect(b.noise).toBe(BREATH_NOISE);
    expect(b.update(0.05, true)).toBe("hold");
    expect(b.noise).toBe(0);
  });

  it("lets it out quietly when you let go, loudly when you run out", () => {
    const b = new Breath();
    expect(step(b, 2, true)).toEqual(["hold"]);
    expect(b.update(0.05, false)).toBe("release");
    b.reset();
    expect(step(b, HOLD_TIME + 0.5, true)).toEqual(["hold", "gasp"]);
    expect(b.held).toBe(false);
  });

  it("can't be held again until the lungs refill a little", () => {
    const b = new Breath();
    step(b, HOLD_TIME + 0.5, true);
    expect(step(b, 0.5, true)).toEqual([]);
    step(b, REFILL_TIME, false);
    expect(b.air).toBeGreaterThan(0.5);
    expect(b.update(0.05, true)).toBe("hold");
  });
});
