import { describe, expect, it } from "vitest";
import { ENEMY_GLYPHS, type EnemyKind } from "../../content/enemies";
import { ITEM_GLYPHS, ITEMS } from "../../content/items";
import { WEAPONS } from "../../content/weapons";
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

  it("never place ammo for a weapon the player can't have yet", () => {
    LEVELS.forEach((def, index) => {
      const glyphs = new Set(def.map.join(""));
      const types = [...ITEM_GLYPHS].filter(([g]) => glyphs.has(g)).map(([, t]) => t);
      for (const t of types) {
        const weapon = ITEMS[t].ammoFor;
        if (!weapon) continue;
        const found = WEAPONS[weapon].foundIn;
        const foundAt = found === null ? -1 : LEVELS.findIndex((l) => l.id === found);
        const inLevel = types.some((u) => ITEMS[u].weapon === weapon);
        expect(foundAt < index || inLevel, `${def.id} has ${t} before the ${weapon} is found`).toBe(true);
      }
    });
  });

  it("introduce each creature where the story does", () => {
    const kinds = (id: string) =>
      new Set(
        [...LEVELS.find((l) => l.id === id)!.map.join("")].flatMap((ch) => {
          const k = ENEMY_GLYPHS.get(ch);
          return k ? [k] : [];
        })
      );
    const firstLevel = (k: EnemyKind) => LEVELS.findIndex((l) => kinds(l.id).has(k));
    const intro: [EnemyKind, string][] = [
      ["brute", "cold-storage"],
      ["listener", "pumping-station"],
      ["watcher", "containment-labs"],
      ["crawler", "ventilation"],
      ["mimic", "ventilation"],
      ["spitter", "power-plant"],
      ["swarm", "armory"],
      ["remnant", "hive"],
    ];
    for (const [kind, id] of intro) expect(LEVELS[firstLevel(kind)]?.id, kind).toBe(id);
  });

  it("find the shotgun in the armory and the rivet gun in the ducts", () => {
    for (const w of Object.values(WEAPONS)) {
      if (!w.foundIn) continue;
      const level = LEVELS.find((l) => l.id === w.foundIn)!;
      const glyph = [...ITEM_GLYPHS].find(([, t]) => ITEMS[t].weapon === w.id)![0];
      expect(level.map.join("").includes(glyph), `${w.id} in ${level.id}`).toBe(true);
    }
  });
});
