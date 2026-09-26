import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "./grid";
import type { LevelDef } from "./levelDef";
import { LevelParseError, parseLevel } from "./levelParser";

function def(map: string[], notes: Record<string, string> = {}): LevelDef {
  return { id: "test", name: "Test", subtitle: "", tagline: "", objective: "", map, notes, spawnYaw: 0 };
}

describe("parseLevel", () => {
  it("reads spawns, props and the solid grid", () => {
    const level = parseLevel(def(["#######", "#S.A.E#", "#C.K.X#", "#1L.H.#", "#######"], { "1": "hello" }));
    expect(level.cols).toBe(7);
    expect(level.rows).toBe(5);
    expect(level.startCell).toEqual({ col: 1, row: 1 });
    expect(level.exitCell).toEqual({ col: 5, row: 2 });
    expect(level.spawns.playerStart.x).toBe(1.5 * CELL_SIZE);
    expect(level.spawns.items.map((i) => i.type)).toEqual(["ammo", "keycard"]);
    expect(level.spawns.lamps).toHaveLength(1);
    expect(level.spawns.notes[0].text).toBe("hello");
    expect(level.spawns.enemies.map((e) => e.kind)).toEqual(["husk", "brute"]);
    expect(level.solid[2][1]).toBe(true); // crate blocks
    expect(level.solid[1][3]).toBe(false); // pickup cell is walkable
    expect(level.props.crates).toHaveLength(1);
  });

  it("pads short rows with walls so maps can't leak", () => {
    const level = parseLevel(def(["#####", "#SX#", "#####"]));
    expect(level.cols).toBe(5);
    expect(level.solid[1][4]).toBe(true);
  });

  it.each([
    ["no spawn", ["####", "#.X#", "####"], /no player spawn/],
    ["no exit", ["####", "#S.#", "####"], /no exit/],
    ["two spawns", ["#####", "#SSX#", "#####"], /more than one player spawn/],
    ["unknown glyph", ["#####", "#S?X#", "#####"], /unknown map character "\?"/],
    ["note without text", ["#####", "#S7X#", "#####"], /note "7"/],
  ])("rejects a map with %s", (_, map, message) => {
    expect(() => parseLevel(def(map))).toThrow(LevelParseError);
    expect(() => parseLevel(def(map))).toThrow(message);
  });

  it("reads interactables, water and triggers", () => {
    const level = parseLevel({
      ...def(["#########", "#S~aD.G.#", "#Y*=..KX#", "#########"]),
      triggers: { a: [] },
      intercoms: [[]],
    });
    const s = level.spawns;
    expect(s.water).toHaveLength(1);
    expect(s.triggers.map((t) => t.key)).toEqual(["a"]);
    expect(s.doors.map((d) => d.security)).toEqual([false, true]);
    expect(s.generators).toHaveLength(1);
    expect(s.intercoms).toHaveLength(1);
    expect(s.checkpoints).toHaveLength(1);
    expect(level.solid[1][4]).toBe(true); // closed door blocks
    expect(level.solid[1][6]).toBe(true); // generator blocks
    expect(level.solid[1][2]).toBe(false); // water is walkable
  });

  it("reads the new creatures, weapons and ammo types", () => {
    const level = parseLevel(def(["##########", "#S..UWVPQX#", "#.!^TJ...#", "##########"]));
    expect(level.spawns.enemies.map((e) => e.kind)).toEqual(["listener", "watcher", "crawler", "spitter", "mimic"]);
    expect(level.spawns.items.map((i) => i.type)).toEqual(["shotgun", "rivetGun", "shells", "rivets"]);
  });

  it("spreads a swarm glyph into a pack inside its cell", () => {
    const level = parseLevel(def(["#######", "#S..%X#", "#######"]));
    const pack = level.spawns.enemies;
    expect(pack.length).toBeGreaterThan(1);
    expect(new Set(pack.map((e) => e.kind))).toEqual(new Set(["swarm"]));
    for (const e of pack) expect(Math.floor(e.pos.x / CELL_SIZE)).toBe(4);
  });

  it("allows at most one boss", () => {
    expect(() => parseLevel(def(["########", "#S..@@X#", "########"]))).toThrow(/more than one boss/);
  });

  it("requires every trigger letter and intercom to have a script", () => {
    expect(() => parseLevel(def(["######", "#SbX.#", "######"]))).toThrow(/trigger "b"/);
    expect(() => parseLevel(def(["######", "#SYX.#", "######"]))).toThrow(/1 intercoms/);
    expect(() => parseLevel(def(["######", "#SZX.#", "######"]))).toThrow(/outside the finale/);
  });
});
