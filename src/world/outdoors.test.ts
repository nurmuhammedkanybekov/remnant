import { describe, expect, it } from "vitest";
import type { LevelDef } from "./levelDef";
import { parseLevel } from "./levelParser";
import { LEVELS } from "./levels";
import { skyCells } from "./outdoors";

const level = (map: string[], outdoor?: "streets" | "water") =>
  parseLevel({ id: "t", name: "", subtitle: "", tagline: "", objective: "", map, notes: {}, spawnYaw: 0, theme: { outdoor } } as LevelDef);

describe("skyCells", () => {
  it("is empty underground", () => {
    expect(skyCells(level(["#####", "#S.X#", "#####"])).size).toBe(0);
    for (const def of LEVELS.slice(0, 10)) expect(skyCells(parseLevel(def)).size, def.id).toBe(0);
    const village = LEVELS.find((l) => l.id === "ak-suu-village")!;
    expect(skyCells(parseLevel(village)).size).toBeGreaterThan(40);
  });

  it("opens the streets and keeps the houses roofed", () => {
    // A house (left, behind a door) off a long street.
    const l = level(["##########", "#S.D.....#", "#..#....X#", "##########"], "streets");
    const sky = skyCells(l);
    expect(sky.has(1 * l.cols + 5)).toBe(true); // the street
    expect(sky.has(1 * l.cols + 1)).toBe(false); // inside the house
    expect(sky.has(1 * l.cols + 3)).toBe(false); // the door itself
  });

  it("opens the water and the walkways across it", () => {
    const l = level(["#######", "#S~.~X#", "#..~..#", "#######"], "water");
    const sky = skyCells(l);
    expect(sky.has(1 * l.cols + 2)).toBe(true); // water
    expect(sky.has(1 * l.cols + 3)).toBe(true); // walkway between water
    expect(sky.has(2 * l.cols + 1)).toBe(false); // dry floor
  });
});
