import { describe, expect, it } from "vitest";
import { lineDuration } from "./script";

describe("lineDuration", () => {
  it("scales with length within sensible bounds", () => {
    expect(lineDuration("Go.")).toBe(2.4);
    expect(lineDuration("one two three four five six seven eight nine ten")).toBeGreaterThan(4);
    expect(lineDuration("word ".repeat(100))).toBe(8);
  });
});
