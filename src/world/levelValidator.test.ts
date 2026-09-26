import { describe, expect, it } from "vitest";
import type { LevelDef } from "./levelDef";
import { parseLevel } from "./levelParser";
import { validateLevel } from "./levelValidator";

const check = (map: string[]) =>
  validateLevel(parseLevel({ id: "t", name: "", subtitle: "", objective: "", map, notes: {}, spawnYaw: 0 } satisfies LevelDef));

describe("validateLevel", () => {
  it("accepts a sound level", () => {
    expect(check(["#######", "#S...X#", "#.#.#.#", "#...E.#", "#######"])).toEqual([]);
  });

  it("flags an unreachable exit", () => {
    expect(check(["#######", "#S.#.X#", "#######"])).toContain("t: exit is not reachable from the spawn");
  });

  it("flags an unreachable keycard", () => {
    expect(check(["########", "#S..#K.#", "#..X#..#", "########"]).join()).toMatch(/keycard at 5,1 is not reachable/);
  });

  it("flags an open outer edge", () => {
    expect(check(["#####", "#S.X.", "#####"]).join()).toMatch(/open edge at row 1/);
  });

  it("flags enemies spawning on top of the player", () => {
    expect(check(["#######", "#SE..X#", "#######"]).join()).toMatch(/husk at 2,1 spawns within 3 cells/);
  });
});
