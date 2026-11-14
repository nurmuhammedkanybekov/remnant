import { describe, expect, it } from "vitest";
import type { LevelDef } from "./levelDef";
import { parseLevel } from "./levelParser";
import { LEVELS } from "./levels";
import { cliffCells, skyCells } from "./outdoors";

const level = (map: string[], outdoor?: "streets" | "water") =>
  parseLevel({ id: "t", name: "", subtitle: "", tagline: "", objective: "", map, notes: {}, spawnYaw: 0, theme: { outdoor } } as LevelDef);

describe("skyCells", () => {
  it("is empty underground", () => {
    expect(skyCells(level(["#####", "#S.X#", "#####"])).size).toBe(0);
    // Inside the mountain there's no sky — until the Surface, where you come out under it.
    for (const def of LEVELS.slice(0, 9)) expect(skyCells(parseLevel(def)).size, def.id).toBe(0);
    expect(skyCells(parseLevel(LEVELS[9])).size, "the Surface").toBeGreaterThan(100);
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

describe("cliffCells", () => {
  it("turns walls round open ground into cliffs, but not a building's walls", () => {
    const def = {
      id: "t",
      name: "",
      subtitle: "",
      tagline: "",
      objective: "",
      notes: {},
      spawnYaw: 0,
      theme: { outdoor: "streets" as const, cliffs: true },
      // A hut (left, behind a door) on a wide yard.
      map: ["##########", "#S.D.....#", "#..#....X#", "##########"],
    };
    const l = parseLevel(def as LevelDef);
    const cliffs = cliffCells(l, skyCells(l));
    expect(cliffs.has(0 * l.cols + 6)).toBe(true); // the yard's back wall
    expect(cliffs.has(0 * l.cols + 1)).toBe(false); // the hut's wall
    expect(cliffs.has(2 * l.cols + 3)).toBe(false); // the wall between hut and yard (beside the hut's floor)
    expect(cliffCells(l, new Set()).size).toBe(0);
  });
});
