import { describe, expect, it } from "vitest";
import { apparition, blackout, lineDuration, sound } from "./script";

describe("lineDuration", () => {
  it("scales with length within sensible bounds", () => {
    expect(lineDuration("Go.")).toBe(2.4);
    expect(lineDuration("one two three four five six seven eight nine ten")).toBeGreaterThan(4);
    expect(lineDuration("word ".repeat(100))).toBe(8);
  });
});

describe("horror actions", () => {
  it("place sounds at a cell, or behind you without one", () => {
    expect(sound("knock", 3, 4)).toEqual({ type: "sound", sound: "knock", at: { col: 3, row: 4 } });
    expect(sound("breath")).toEqual({ type: "sound", sound: "breath", at: null });
  });
  it("stand figures facing you unless told otherwise", () => {
    expect(apparition("husk", 2, 2)).toMatchObject({ facing: "toward", at: { col: 2, row: 2 } });
    expect(apparition("husk", 2, 2, "away").type === "apparition" && apparition("husk", 2, 2, "away")).toMatchObject({ facing: "away" });
    expect(blackout(8)).toEqual({ type: "blackout", seconds: 8 });
  });
});
