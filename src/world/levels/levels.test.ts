import { describe, expect, it } from "vitest";
import { parseLevel } from "../levelParser";
import { validateLevel } from "../levelValidator";
import { LEVELS } from ".";

describe("shipped levels", () => {
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
