import { describe, expect, it } from "vitest";
import type { LevelDef } from "./levelDef";
import { parseLevel } from "./levelParser";
import { validateLevel } from "./levelValidator";

const check = (map: string[], extra: Partial<LevelDef> = {}) =>
  validateLevel(parseLevel({ id: "t", name: "", subtitle: "", objective: "", map, notes: {}, spawnYaw: 0, ...extra } satisfies LevelDef));

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

  it("plain doors can always be opened", () => {
    expect(check(["#########", "#S...D.X#", "#########"])).toEqual([]);
  });

  it("security doors need the keycard reachable before them", () => {
    expect(check(["##########", "#S.K.=..X#", "##########"])).toEqual([]);
    expect(check(["##########", "#S...=.KX#", "##########"]).join()).toMatch(/keycard is locked behind a security door/);
    expect(check(["#########", "#S...=.X#", "#########"]).join()).toMatch(/security doors but no keycard/);
  });

  it("flags a door that isn't in a doorway", () => {
    expect(check(["#######", "#S....#", "#..D..#", "#....X#", "#######"]).join()).toMatch(/door at 3,2 is not in a doorway/);
  });

  it("generators are reachable from beside them", () => {
    expect(check(["########", "#S..G.X#", "########"])).toEqual(["t: exit is not reachable from the spawn"]);
    expect(check(["########", "#S....X#", "#...G..#", "########"])).toEqual([]);
  });

  it("the finale needs a detonator", () => {
    expect(check(["######", "#S..X#", "######"], { finale: true }).join()).toMatch(/needs a detonator console/);
  });
});
