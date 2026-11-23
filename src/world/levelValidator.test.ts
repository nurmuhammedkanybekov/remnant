import { describe, expect, it } from "vitest";
import type { LevelDef } from "./levelDef";
import { parseLevel } from "./levelParser";
import { validateLevel } from "./levelValidator";
import { apparition, beacon, bid, guide, shutDoors, sound } from "../game/script";

const check = (map: string[], extra: Partial<LevelDef> = {}) =>
  validateLevel(
    parseLevel({ id: "t", name: "", subtitle: "", tagline: "", objective: "", map, notes: {}, spawnYaw: 0, ...extra } satisfies LevelDef)
  );

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

  it("places script sounds on the map and figures on floor you can reach", () => {
    const map = ["#######", "#S...X#", "#######"];
    expect(check(map, { events: { start: [sound("knock", 0, 1), apparition("husk", 4, 1)] } })).toEqual([]);
    expect(check(map, { events: { start: [sound("knock", 9, 1)] } }).join()).toMatch(/sound at 9,1 is off the map/);
    expect(check(map, { triggers: {}, events: { start: [apparition("husk", 0, 1)] } }).join()).toMatch(/apparition at 0,1 is not on floor/);
  });

  it("checks what the voice's scripts point at", () => {
    const map = ["############", "#S...D..a.X#", "#....#K...E#", "#.#####.####", "#.#..#.....#", "############"];
    const ok = { triggers: { a: [] } };
    expect(check(map, ok)).toEqual([]);
    const at = (a: ReturnType<typeof bid>) => check(map, { triggers: { a: [] }, events: { start: [a] } }).join();
    expect(at(bid("x", [], { kind: "go", zone: "q" }, 5))).toMatch(/zone "q", which isn't on the map/);
    expect(at(bid("x", [], { kind: "leave", at: { col: 6, row: 2 } }, null))).toMatch(/must be in `keep`/);
    expect(at(bid("x", [], { kind: "leave", at: { col: 4, row: 2 } }, null))).toMatch(/nothing is/);
    expect(at(shutDoors([3, 1]))).toMatch(/no door there/);
    expect(at(shutDoors([5, 1]))).toBe("");
    expect(at(beacon("hummer", 3, 4, 10, 3))).toMatch(/beacon at 3,4 is not on floor you can reach/);
    expect(at(guide([7, 4], [3, 4], 10))).toMatch(/guide at 3,4/);
  });

  it("checks a carried keycard and the houses a key might be in", () => {
    const map = ["############", "#S......K.X#", "#.......E..#", "#.#####.####", "#.#..#.....#", "############"];
    expect(check(map, { carrier: [8, 2] })).toEqual([]);
    expect(check(map, { carrier: [5, 2] }).join()).toMatch(/carrier at 5,2 isn't a creature/);
    expect(
      check(map, {
        keyHouses: [
          [8, 1],
          [3, 4],
        ],
      }).join()
    ).toMatch(/key house at 3,4 is not on floor you can reach/);
  });
});
