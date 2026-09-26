import { describe, expect, it } from "vitest";
import { parseLevel } from "../levelParser";
import { validateLevel } from "../levelValidator";
import { LEVELS } from ".";

describe("shipped levels", () => {
  it("form a ten-level campaign that ends in the finale", () => {
    expect(LEVELS).toHaveLength(10);
    expect(LEVELS[LEVELS.length - 1].finale).toBe(true);
    expect(LEVELS.slice(0, -1).some((l) => l.finale)).toBe(false);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))("%s has rows of equal width", (_, def) => {
    expect(new Set(def.map.map((r) => r.length)).size).toBe(1);
  });

  it("have unique ids", () => {
    const ids = LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))("%s parses and is completable", (_, def) => {
    expect(validateLevel(parseLevel(def))).toEqual([]);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))("%s has text for every note it places", (_, def) => {
    const placed = new Set(def.map.join("").match(/[0-9]/g) ?? []);
    for (const key of Object.keys(def.notes)) expect(placed.has(key), `note ${key} is never placed`).toBe(true);
  });
});
