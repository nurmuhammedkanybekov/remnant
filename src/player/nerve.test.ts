import { describe, expect, it } from "vitest";
import { Nerve, type NerveInput } from "./nerve";

const run = (n: Nerve, seconds: number, input: Partial<NerveInput>) => {
  for (let t = 0; t < seconds; t += 1 / 30) n.update(1 / 30, { dread: 0, dark: false, lamplit: false, ...input });
};

describe("Nerve", () => {
  it("climbs while something is close and settles when it's gone", () => {
    const n = new Nerve();
    run(n, 3, { dread: 1 });
    expect(n.level).toBeGreaterThan(0.5);
    const scared = n.level;
    run(n, 5, {});
    expect(n.level).toBeLessThan(scared);
  });

  it("settles faster in a lamp's light", () => {
    const a = new Nerve();
    const b = new Nerve();
    a.shock(0.8);
    b.shock(0.8);
    run(a, 5, {});
    run(b, 5, { lamplit: true });
    expect(b.level).toBeLessThan(a.level);
  });

  it("the dark alone unsettles you, but only so far", () => {
    const n = new Nerve();
    run(n, 120, { dark: true });
    expect(n.level).toBeGreaterThan(0.3);
    expect(n.level).toBeLessThanOrEqual(0.45);
    expect(n.tremor).toBeLessThan(0.1);
  });

  it("only shakes your hands and lungs once you're really frightened", () => {
    const n = new Nerve();
    expect(n.tremor).toBe(0);
    expect(n.breathScale).toBe(1);
    n.shock(2);
    expect(n.level).toBe(1);
    expect(n.tremor).toBe(1);
    expect(n.breathScale).toBeGreaterThan(1.5);
    n.reset();
    expect(n.level).toBe(0);
  });
});
