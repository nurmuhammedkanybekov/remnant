import * as THREE from "three";
import type { MatKey, Parts } from "./dressing";
import { CELL_SIZE, WALL_HEIGHT, cellCenter } from "./grid";
import type { ParsedLevel } from "./levelParser";

/**
 * Story scenes: what happened here, built where it happened. Every note on
 * every level has a scene around it that shows what the note says (the bed
 * Nur slept through it all in, with the radio's plug pulled out of the wall;
 * R-7's cell, broken from the inside; Hendricks with the detonator still in
 * his hand), and a few rooms have one the notes never mention (the crew
 * sitting in a circle round a radio that is still on).
 *
 * A scene is built in its own frame: the origin is the middle of its cell,
 * local +Z points at the wall it stands against (the wall's face is at
 * z = CELL_SIZE / 2) and +X runs along that wall. Everything stays near the
 * wall and out of the middle of the cell, where the note lies.
 */

export type SceneKind =
  // Infirmary
  | "kessler"
  | "sedation"
  | "stash"
  | "listening"
  // Maintenance
  | "radioTable"
  | "clicking"
  | "rota"
  | "sealedVent"
  | "sentHome"
  // Cold storage
  | "keyDesk"
  | "boots"
  | "yourName"
  | "sampleCrates"
  // Pumping station
  | "pumpsChained"
  | "hendricks"
  | "quietRoom"
  // Labs
  | "r7cell"
  | "daughter"
  | "glassCase"
  | "kesslerChair"
  | "bloodFridge"
  // Ventilation
  | "turns"
  | "rivetBench"
  | "camp1991"
  | "supervisor"
  // Power plant
  | "liftBoard"
  | "maraMap"
  | "engineerStash"
  | "feeding"
  // Armory
  | "smashedRadio"
  | "securityLocker"
  | "lastStand"
  // Hive
  | "cocoons"
  | "maraCalls"
  | "maraPack"
  // Lift shaft
  | "roster"
  | "charges";

export interface ScenePlacement {
  kind: SceneKind;
  x: number;
  z: number;
  rot: number;
}

/** Where a scene goes: by the note it belongs to, or in one of the level's rooms (biggest first). */
type Anchor = { note: string; kind: SceneKind } | { room: number; kind: SceneKind };

export const STORY_SCENES: Record<string, Anchor[]> = {
  infirmary: [
    { note: "1", kind: "kessler" },
    { note: "2", kind: "sedation" },
    { note: "3", kind: "stash" },
    { room: 0, kind: "listening" },
  ],
  "maintenance-wing": [
    { note: "1", kind: "radioTable" },
    { note: "2", kind: "clicking" },
    { note: "3", kind: "rota" },
    { note: "4", kind: "sealedVent" },
    { room: 1, kind: "sentHome" },
  ],
  "cold-storage": [
    { note: "1", kind: "keyDesk" },
    { note: "2", kind: "boots" },
    { note: "3", kind: "yourName" },
    { note: "4", kind: "sampleCrates" },
  ],
  "pumping-station": [
    { note: "1", kind: "pumpsChained" },
    { note: "2", kind: "hendricks" },
    { note: "3", kind: "quietRoom" },
  ],
  "containment-labs": [
    { note: "1", kind: "r7cell" },
    { note: "2", kind: "daughter" },
    { note: "3", kind: "glassCase" },
    { note: "4", kind: "kesslerChair" },
    { note: "5", kind: "bloodFridge" },
  ],
  ventilation: [
    { note: "1", kind: "turns" },
    { note: "2", kind: "rivetBench" },
    { note: "3", kind: "camp1991" },
    { note: "4", kind: "supervisor" },
  ],
  "power-plant": [
    { note: "1", kind: "liftBoard" },
    { note: "2", kind: "maraMap" },
    { note: "3", kind: "engineerStash" },
    { note: "4", kind: "feeding" },
  ],
  armory: [
    { note: "1", kind: "smashedRadio" },
    { note: "2", kind: "securityLocker" },
    { note: "3", kind: "lastStand" },
  ],
  hive: [
    { note: "1", kind: "cocoons" },
    { note: "2", kind: "maraCalls" },
    { note: "3", kind: "maraPack" },
  ],
  "lift-shaft": [
    { note: "1", kind: "roster" },
    { note: "2", kind: "charges" },
  ],
};

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export interface SceneGrid {
  ch: (col: number, row: number) => string;
  /** Open floor a scene may stand in (no door, machine or start). */
  plain: (col: number, row: number) => boolean;
  /** The level's rooms, biggest first, as cell keys (row * cols + col). */
  rooms: number[][];
}

/**
 * Places a level's story scenes. A note's scene goes in the note's own cell
 * against one of its walls (or, if it has none, the nearest cell beside it
 * that does); a room's scene goes in a corner of that room. Returns the
 * scenes and the cells they take, which the rest of the dressing leaves alone.
 */
export function planScenes(level: ParsedLevel, grid: SceneGrid): { scenes: ScenePlacement[]; cells: Set<number> } {
  const scenes: ScenePlacement[] = [];
  const cells = new Set<number>();
  const key = (c: number, r: number) => r * level.cols + c;
  const wallSide = (c: number, r: number) => SIDES.find(([dc, dr]) => grid.ch(c + dc, r + dr) === "#");
  const place = (kind: SceneKind, c: number, r: number, side: readonly [number, number]) => {
    const centre = cellCenter(c, r);
    scenes.push({ kind, x: centre.x, z: centre.y, rot: Math.atan2(side[0], side[1]) });
    cells.add(key(c, r));
  };

  for (const anchor of STORY_SCENES[level.def.id] ?? []) {
    if ("note" in anchor) {
      const note = level.spawns.notes.find((n) => n.key === `${level.def.id}:${anchor.note}`);
      if (!note) continue;
      const col = Math.floor(note.pos.x / CELL_SIZE);
      const row = Math.floor(note.pos.y / CELL_SIZE);
      // The note's own cell if it has a wall; otherwise the nearest open cell that does.
      const seen = new Set([key(col, row)]);
      let ring: [number, number][] = [[col, row]];
      search: for (let step = 0; step <= 3 && ring.length; step++) {
        for (const [c, r] of ring) {
          if (cells.has(key(c, r)) || !(step === 0 || grid.plain(c, r))) continue;
          const side = wallSide(c, r);
          if (!side) continue;
          place(anchor.kind, c, r, side);
          break search;
        }
        const next: [number, number][] = [];
        for (const [c, r] of ring)
          for (const [dc, dr] of SIDES) {
            const n = key(c + dc, r + dr);
            if (seen.has(n) || grid.ch(c + dc, r + dr) === "#") continue;
            seen.add(n);
            next.push([c + dc, r + dr]);
          }
        ring = next;
      }
    } else {
      const room = grid.rooms[anchor.room];
      if (!room) continue;
      // A corner: two walls at right angles. Failing that, any cell against a wall.
      const pick =
        room.find((k) => {
          const c = k % level.cols;
          const r = Math.floor(k / level.cols);
          const walls = SIDES.filter(([dc, dr]) => grid.ch(c + dc, r + dr) === "#");
          return grid.plain(c, r) && !cells.has(k) && walls.length >= 2 && walls.some(([a]) => a !== 0) && walls.some(([, b]) => b !== 0);
        }) ??
        room.find(
          (k) =>
            grid.plain(k % level.cols, Math.floor(k / level.cols)) && !cells.has(k) && wallSide(k % level.cols, Math.floor(k / level.cols))
        );
      if (pick === undefined) continue;
      const c = pick % level.cols;
      const r = Math.floor(pick / level.cols);
      place(anchor.kind, c, r, wallSide(c, r)!);
    }
  }
  return { scenes, cells };
}

// ---------------------------------------------------------------- building

/** The wall's face, in a scene's frame. */
const WALL = CELL_SIZE / 2 - 0.03;

/** A plain chair; `facing` turns it about Y (0 faces local -Z, away from the wall). */
function chair(p: Parts, x: number, z: number, facing: number, m: MatKey = "darkMetal", tipped = false): void {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  // Local offsets rotated by `facing`: forward is -Z.
  const at = (dx: number, dz: number): [number, number] => [x + dx * c + dz * s, z - dx * s + dz * c];
  if (tipped) {
    // On its back.
    const [bx, bz] = at(0, 0.45);
    p.box(m, 0.42, 0.42, 0.04, x, 0.22, z, 0, 0, facing).box(m, 0.42, 0.04, 0.45, bx, 0.02, bz, 0, 0, facing);
    return;
  }
  p.box(m, 0.42, 0.04, 0.42, x, 0.45, z, 0, 0, facing);
  const back = at(0, 0.2);
  p.box(m, 0.42, 0.45, 0.04, back[0], 0.7, back[1], 0, 0, facing);
  for (const [dx, dz] of [
    [-0.18, -0.18],
    [0.18, -0.18],
    [-0.18, 0.18],
    [0.18, 0.18],
  ]) {
    const [lx, lz] = at(dx, dz);
    p.cyl(m, 0.015, 0.45, lx, 0.22, lz);
  }
}

/** An old valve radio on whatever surface is at height y. Lit = still on. */
function radio(p: Parts, x: number, y: number, z: number, lit: boolean): void {
  p.box("wood", 0.42, 0.24, 0.2, x, y + 0.12, z).box(lit ? "dial" : "darkMetal", 0.16, 0.06, 0.01, x + 0.08, y + 0.15, z - 0.105);
  p.box("cloth", 0.14, 0.14, 0.01, x - 0.1, y + 0.12, z - 0.105).cyl("metal", 0.006, 0.4, x + 0.15, y + 0.4, z + 0.05, 0.3, -0.2);
  p.cyl("darkMetal", 0.018, 0.02, x + 0.03, y + 0.07, z - 0.11, Math.PI / 2).cyl(
    "darkMetal",
    0.018,
    0.02,
    x + 0.13,
    y + 0.07,
    z - 0.11,
    Math.PI / 2
  );
}

function table(p: Parts, x: number, z: number, w: number, d: number, h = 0.72, m: MatKey = "wood"): void {
  p.box(m, w, 0.04, d, x, h, z);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    p.cyl("metal", 0.02, h, x + sx * (w / 2 - 0.05), h / 2, z + sz * (d / 2 - 0.05));
}

function bed(p: Parts, x: number, z: number, rumpled: boolean): void {
  // Head against the wall (+Z), foot towards the room.
  p.box("metal", 0.9, 0.06, 1.9, x, 0.55, z)
    .box("cloth", 0.84, 0.12, 1.8, x, 0.64, z)
    .box("cloth", 0.5, 0.08, 0.3, x, 0.74, z + 0.7);
  for (const [dx, dz] of [
    [-0.42, -0.92],
    [0.42, -0.92],
    [-0.42, 0.92],
    [0.42, 0.92],
  ])
    p.cyl("metal", 0.025, 0.55, x + dx, 0.27, z + dz);
  p.box("metal", 0.9, 0.45, 0.04, x, 0.82, z + 0.95).box("metal", 0.9, 0.3, 0.04, x, 0.72, z - 0.95);
  if (rumpled)
    p.box("tarp", 0.86, 0.05, 0.9, x + 0.05, 0.73, z - 0.45, 0.15, 0.08).box("tarp", 0.3, 0.5, 0.05, x + 0.48, 0.45, z - 0.3, 0, 0.2);
}

function hardHat(p: Parts, x: number, y: number, z: number, m: MatKey = "paintYellow"): void {
  p.dome(m, 0.14, x, y, z).cyl(m, 0.18, 0.015, x, y, z, 0, 0, 12);
}

function crate(p: Parts, x: number, y: number, z: number, w: number, h: number, d: number, m: MatKey = "wood", ry = 0): void {
  p.box(m, w, h, d, x, y + h / 2, z, 0, 0, ry);
}

/** A cable lying from (x1, z1) to (x2, z2) at height y. */
function cable(p: Parts, x1: number, z1: number, x2: number, z2: number, y = 0.012, m: MatKey = "rubber", r = 0.01): void {
  const len = Math.hypot(x2 - x1, z2 - z1);
  p.cyl(m, r, len, (x1 + x2) / 2, y, (z1 + z2) / 2, Math.PI / 2, 0, 5, Math.atan2(x2 - x1, z2 - z1));
}

/** A body, slumped against the wall: what's left of someone in work clothes. */
function slumped(p: Parts, x: number, z: number, shirt: MatKey): void {
  p.box("darkMetal", 0.16, 0.14, 0.75, x - 0.12, 0.08, z - 0.3).box("darkMetal", 0.16, 0.14, 0.75, x + 0.12, 0.08, z - 0.2, 0, 0, 0.15);
  p.box(shirt, 0.44, 0.6, 0.24, x, 0.42, z + 0.12, -0.25).blob("flesh", 0.11, x + 0.05, 0.78, z + 0.18);
  p.box(shirt, 0.1, 0.45, 0.1, x - 0.28, 0.32, z, 0.6).box(shirt, 0.1, 0.45, 0.1, x + 0.26, 0.25, z - 0.08, 0.9);
}

function wallText(p: Parts, key: string, w: number, h: number, x: number, y: number, rz = 0, z = WALL): void {
  p.plane(`story:${key}`, w, h, x, y, z, rz);
}

/** Builds one scene into `p`, which must already be positioned at the scene (see `Parts.at`). */
export function buildScene(p: Parts, kind: SceneKind, rand: () => number): void {
  switch (kind) {
    // ------------------------------------------------ infirmary
    case "sedation":
      // Where Nur slept through it: the bed, the drip, and the radio with its plug pulled.
      bed(p, -1.3, 0.95, true);
      p.cyl("metal", 0.015, 1.8, -0.55, 0.9, 1.75)
        .cyl("darkMetal", 0.2, 0.03, -0.55, 0.02, 1.75)
        .box("glass", 0.12, 0.2, 0.05, -0.47, 1.65, 1.75);
      cable(p, -0.47, 1.73, -0.95, 1.2, 1.3, "glass", 0.004);
      table(p, 0.35, 1.65, 0.5, 0.45, 0.6);
      radio(p, 0.35, 0.62, 1.68, false);
      p.cyl("glass", 0.02, 0.06, 0.15, 0.65, 1.5).cyl("glass", 0.02, 0.06, 0.2, 0.65, 1.45).box("metal", 0.12, 0.01, 0.02, 0.5, 0.63, 1.48);
      // The radio's cord hangs off the table, and its plug lies on the floor, a hand's width from the socket.
      p.cyl("rubber", 0.008, 0.6, 0.6, 0.3, 1.75);
      cable(p, 0.6, 1.75, 1.15, 1.55);
      p.box("rubber", 0.05, 0.03, 0.07, 1.17, 0.02, 1.52).box("enamel", 0.08, 0.12, 0.03, 1.4, 0.3, WALL - 0.01);
      // Mara's bag, packed for the next floor.
      p.box("paintRed", 0.45, 0.25, 0.25, 1.35, 0.13, 1.1, 0, 0, 0.4).box("enamel", 0.12, 0.04, 0.01, 1.3, 0.2, 0.97, 0, 0, 0.4);
      wallText(p, "chartNur", 0.35, 0.45, -1.3, 1.55);
      break;
    case "kessler":
      // Patient 14: strapped down, his chart at the foot of the bed, the four notes on the wall.
      bed(p, 1.3, 0.95, false);
      for (const dz of [0.4, 0.95, 1.5]) p.box("rust", 0.95, 0.03, 0.08, 1.3, 0.72, dz);
      p.box("wood", 0.25, 0.32, 0.02, 1.3, 0.72, -0.02).plane("story:chart14", 0.22, 0.28, 1.3, 0.72, -0.035);
      wallText(p, "fourNotes", 1.6, 0.8, -0.2, 1.7, 0.03);
      wallText(p, "fourNotes", 0.9, 0.45, 1.3, 2.45, -0.06);
      break;
    case "stash":
      // What Mara hid from the others: tins, water, a blanket.
      crate(p, -1.0, 0, 1.6, 0.8, 0.6, 0.6);
      crate(p, -0.95, 0.6, 1.62, 0.6, 0.45, 0.5, "wood", 0.15);
      for (let i = 0; i < 9; i++) p.cyl("metal", 0.045, 0.11, -1.25 + (i % 5) * 0.12, 1.11, 1.5 + Math.floor(i / 5) * 0.12, 0, 0, 8);
      for (let i = 0; i < 4; i++) p.cyl("glass", 0.05, 0.3, 0.2 + i * 0.13, 0.15, 1.75);
      p.box("cloth", 0.9, 0.12, 0.6, 1.1, 0.06, 1.55, 0, 0, 0.2).box("cloth", 0.7, 0.1, 0.5, 1.12, 0.17, 1.6, 0, 0, -0.1);
      break;
    case "listening": {
      // Day six: the crew sat round the radio and stopped eating. It's still on.
      table(p, 0, 1.55, 0.6, 0.5, 0.75);
      radio(p, 0, 0.77, 1.6, true);
      for (let i = 0; i < 6; i++) {
        const a = -1.05 + (i / 5) * 2.1;
        const cx = Math.sin(a) * 1.35;
        const cz = 1.55 - Math.cos(a) * 1.35;
        // Each chair faces the radio.
        chair(p, cx, cz, -a + Math.PI, "darkMetal", i === 4);
        if (i % 2 === 0)
          p.box("metal", 0.35, 0.02, 0.25, cx * 1.25, 0.01, cz - 0.2, 0, 0, a).cyl("enamel", 0.07, 0.05, cx * 1.25, 0.04, cz - 0.2);
      }
      break;
    }
    // ------------------------------------------------ maintenance wing
    case "radioTable":
      // The break-room radio, still on; Petrov's chair pulled right up to it.
      table(p, 1.0, 1.55, 1.0, 0.6);
      radio(p, 1.1, 0.74, 1.65, true);
      p.cyl("enamel", 0.04, 0.09, 0.7, 0.79, 1.5)
        .cyl("enamel", 0.04, 0.09, 0.82, 0.79, 1.4)
        .box("paper", 0.21, 0.01, 0.3, 1.35, 0.75, 1.45, 0, 0, 0.3);
      chair(p, 1.0, 0.85, Math.PI);
      chair(p, -0.6, 1.2, 0.6, "darkMetal", true);
      break;
    case "clicking":
      // Gouges in the wall at head height, and a dropped hard hat and torch.
      wallText(p, "claws", 1.8, 1.0, 0.3, 1.5, 0.05);
      hardHat(p, -1.2, 0.04, 1.0);
      p.cyl("darkMetal", 0.035, 0.22, -0.9, 0.035, 1.4, Math.PI / 2, 0, 8);
      break;
    case "rota":
      // The shift rota: 'Heard singing. Sent home.'
      p.box("wood", 0.75, 1.0, 0.03, 0, 1.5, WALL - 0.01);
      wallText(p, "rota", 0.66, 0.9, 0, 1.5, 0, WALL - 0.035);
      for (let i = 0; i < 3; i++) {
        p.cyl("darkMetal", 0.01, 0.12, 0.8 + i * 0.35, 1.7, WALL - 0.06, Math.PI / 2);
        hardHat(p, 0.8 + i * 0.35, 1.55, WALL - 0.18, i === 1 ? "enamel" : "paintYellow");
      }
      break;
    case "sealedVent":
      // 1988: the crawlspace the fitters listened at, boarded and stencilled shut.
      p.box("darkMetal", 1.3, 0.85, 0.06, 0, 0.55, WALL - 0.02);
      for (let i = 0; i < 7; i++) p.box("rubber", 1.2, 0.04, 0.02, 0, 0.2 + i * 0.11, WALL - 0.06);
      p.box("wood", 1.5, 0.14, 0.04, 0, 0.45, WALL - 0.1, 0, 0.25).box("wood", 1.5, 0.14, 0.04, 0, 0.7, WALL - 0.12, 0, -0.2);
      wallText(p, "noOpen", 1.3, 0.45, 0, 1.4);
      // The three of them sat here all night.
      for (const [x, a] of [
        [-1.1, 0.4],
        [0.0, 0],
        [1.1, -0.4],
      ] as const)
        p.cyl("wood", 0.16, 0.04, x, 0.42, 0.9 + Math.abs(x) * 0.2).cyl("metal", 0.015, 0.4, x, 0.2, 0.9 + Math.abs(x) * 0.2, 0, a * 0.2);
      break;
    case "sentHome":
      // The ones 'sent home': packed bags by the lockers that nobody came back for.
      for (let i = 0; i < 6; i++) {
        const x = -1.5 + i * 0.6;
        p.box(i % 2 ? "olive" : "tarp", 0.5, 0.3, 0.3, x, 0.15, 1.7, 0, 0, (rand() - 0.5) * 0.3).box(
          "paper",
          0.06,
          0.08,
          0.005,
          x + 0.2,
          0.25,
          1.54
        );
        if (i % 3 === 0) hardHat(p, x, 0.3, 1.7);
      }
      wallText(p, "sentHome", 1.2, 0.5, 0, 1.6, -0.02);
      break;
    // ------------------------------------------------ cold storage
    case "keyDesk":
      // Security: the lift key cabinet, every hook empty but Hendricks'.
      p.box("wood", 1.5, 0.05, 0.7, 0, 0.76, 1.5)
        .box("darkMetal", 1.5, 0.72, 0.04, 0, 0.38, 1.17)
        .box("darkMetal", 0.04, 0.72, 0.7, -0.73, 0.38, 1.5)
        .box("darkMetal", 0.04, 0.72, 0.7, 0.73, 0.38, 1.5);
      p.box("metal", 0.7, 0.7, 0.08, 0.9, 1.6, WALL - 0.04);
      for (let i = 0; i < 8; i++)
        p.cyl("brass", 0.008, 0.06, 0.65 + (i % 4) * 0.16, 1.75 - Math.floor(i / 4) * 0.25, WALL - 0.11, Math.PI / 2);
      wallText(p, "liftAccess", 0.9, 0.4, -0.5, 1.75);
      chair(p, 0.2, 0.75, 2.6, "darkMetal", true);
      p.box("paper", 0.21, 0.01, 0.3, -0.4, 0.79, 1.45, 0, 0, 0.2);
      break;
    case "boots":
      // Three pairs of boots in a row. 'I know by the boots.'
      for (let i = 0; i < 3; i++) {
        const x = -0.9 + i * 0.9;
        p.box("rubber", 0.12, 0.16, 0.28, x - 0.09, 0.08, 1.7, 0, 0, 0.05).box(
          "rubber",
          0.12,
          0.16,
          0.28,
          x + 0.09,
          0.08,
          1.72,
          0,
          0,
          -0.05
        );
        p.box("frost", 0.32, 0.02, 0.3, x, 0.165, 1.71);
      }
      p.cyl("stain", 0.6, 0.004, 0.2, 0.004, 1.2, 0, 0, 10);
      wallText(p, "orlov", 0.6, 0.3, -1.3, 1.3, 0.08);
      break;
    case "yourName":
      // 'Never tell it your name.' A radio on a crate, and the wall.
      crate(p, 1.0, 0, 1.6, 0.6, 0.55, 0.5);
      radio(p, 1.0, 0.55, 1.6, true);
      wallText(p, "yourName", 1.9, 0.9, -0.5, 1.55, 0.04);
      break;
    case "sampleCrates":
      // Hendricks' consignment: cold crates packed for the surface, and the wire he meant to use.
      for (const [x, y, w] of [
        [-0.9, 0, 0.9],
        [0.1, 0, 0.9],
        [-0.4, 0.6, 0.8],
      ] as const) {
        crate(p, x, y, 1.6, w, 0.6, 0.6, "orange");
        p.plane("story:glassCrate", w * 0.8, 0.4, x, y + 0.3, 1.29);
      }
      p.cyl("rust", 0.18, 0.2, 1.3, 0.1, 1.5, 0, 0, 12).cyl("paintYellow", 0.2, 0.12, 1.3, 0.1, 1.5, 0, 0, 12);
      cable(p, 1.3, 1.5, 1.6, WALL - 0.02, 0.05, "paintYellow", 0.008);
      p.cyl("paintYellow", 0.008, WALL_HEIGHT - 0.1, 1.6, WALL_HEIGHT / 2, WALL - 0.02);
      break;
    // ------------------------------------------------ pumping station
    case "pumpsChained":
      // Arkadin stopped the pumps: the master valve chained shut, and the order on the wall.
      p.cyl("rust", 0.12, WALL_HEIGHT, -0.6, WALL_HEIGHT / 2, WALL - 0.15, 0, 0, 10).box(
        "darkMetal",
        0.3,
        0.3,
        0.3,
        -0.6,
        1.2,
        WALL - 0.15
      );
      p.ring("paintRed", 0.32, 0.03, -0.6, 1.2, WALL - 0.42).cyl("darkMetal", 0.03, 0.25, -0.6, 1.2, WALL - 0.3, Math.PI / 2);
      for (let i = 0; i < 8; i++)
        p.ring("rust", 0.04, 0.012, -0.6 + Math.cos(i * 0.8) * 0.3, 1.2 + Math.sin(i * 0.8) * 0.3, WALL - 0.44, 0, i % 2 ? Math.PI / 2 : 0);
      p.box("brass", 0.1, 0.12, 0.05, -0.32, 0.95, WALL - 0.44);
      wallText(p, "pumpsOff", 1.1, 0.55, 0.8, 1.6, -0.02);
      break;
    case "hendricks":
      // Hendricks, against the wall, the detonator still in his hand; its wire runs up into the shaft.
      slumped(p, 0.6, 1.55, "olive");
      p.box("paintRed", 0.12, 0.05, 0.02, 0.4, 0.62, 1.63, -0.25);
      p.box("olive", 0.22, 0.12, 0.14, 0.95, 0.07, 1.25)
        .cyl("darkMetal", 0.015, 0.2, 0.95, 0.2, 1.25)
        .box("darkMetal", 0.16, 0.02, 0.02, 0.95, 0.3, 1.25);
      cable(p, 0.95, 1.25, 1.3, WALL - 0.02, 0.02, "rubber", 0.008);
      p.cyl("rubber", 0.008, WALL_HEIGHT, 1.3, WALL_HEIGHT / 2, WALL - 0.02);
      p.cyl("stain", 0.5, 0.004, 0.5, 0.004, 1.2, 0, 0, 10);
      break;
    case "quietRoom":
      // The room Arkadin built to talk in: foam on the walls, two chairs, the recorder.
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < 4; j++) p.box("rubber", 0.5, 0.5, 0.08, -1.25 + i * 0.5, 0.6 + j * 0.5, WALL - 0.04 - ((i + j) % 2) * 0.03);
      chair(p, -0.8, 1.0, -Math.PI / 2 + 0.3);
      chair(p, 0.8, 1.0, Math.PI / 2 - 0.3);
      table(p, 0, 1.35, 0.6, 0.4, 0.6);
      p.box("darkMetal", 0.4, 0.12, 0.3, 0, 0.68, 1.35)
        .ring("darkMetal", 0.08, 0.015, -0.1, 0.78, 1.35, 0, 0)
        .ring("darkMetal", 0.08, 0.015, 0.1, 0.78, 1.35, 0, 0);
      break;
    // ------------------------------------------------ labs
    case "r7cell": {
      // R-7's cell: dark glass, kept at 4°C. Broken from the inside.
      const w = 2.6;
      for (const x of [-w / 2, 0, w / 2]) p.box("darkMetal", 0.08, 2.4, 0.08, x, 1.2, 0.95);
      p.box("darkMetal", w, 0.1, 1.0, 0, 2.45, 1.45).box("darkMetal", w, 0.1, 1.0, 0, 0.05, 1.45);
      p.box("glass", w / 2 - 0.1, 2.2, 0.03, -w / 4, 1.2, 0.95);
      // The right-hand pane is gone: jagged edges, and the glass all over the floor outside.
      p.box("glass", 0.25, 0.9, 0.03, w / 4 - 0.45, 0.55, 0.95, 0, 0.3).box("glass", 0.3, 0.5, 0.03, w / 4 + 0.4, 2.1, 0.95, 0, -0.4);
      for (let i = 0; i < 14; i++)
        p.box("glass", 0.05 + rand() * 0.15, 0.01, 0.04 + rand() * 0.1, 0.2 + rand() * 1.1, 0.008, 0.85 - rand() * 0.9, 0, 0, rand() * 3);
      p.box("blood", 0.04, 0.6, 0.02, 0.95, 1.2, 0.94, 0, 0.2).box("blood", 0.04, 0.5, 0.02, 1.05, 1.15, 0.94, 0, 0.1);
      wallText(p, "r7", 1.0, 0.45, -0.7, 2.0);
      break;
    }
    case "daughter":
      // Arkadin's desk: the recorder he kept running, and the drawing his daughter sent.
      table(p, -0.6, 1.55, 1.3, 0.65, 0.76);
      p.box("darkMetal", 0.45, 0.14, 0.32, -0.8, 0.85, 1.55)
        .ring("darkMetal", 0.09, 0.016, -0.92, 0.97, 1.55)
        .ring("darkMetal", 0.09, 0.016, -0.68, 0.97, 1.55);
      p.ring("rubber", 0.1, 0.015, -0.25, 0.8, 1.5, Math.PI / 2).box("paper", 0.21, 0.01, 0.3, -0.3, 0.785, 1.65, 0, 0, -0.2);
      wallText(p, "girlDrawing", 0.5, 0.36, -0.6, 1.45, 0.06);
      chair(p, -0.6, 0.95, Math.PI);
      break;
    case "glassCase":
      // Project GLASS: the transport case, open and empty, cut to fit one sample.
      p.box("orange", 1.0, 0.24, 0.6, 0.9, 0.12, 1.5).box("rubber", 0.9, 0.04, 0.5, 0.9, 0.25, 1.5);
      p.cyl("darkMetal", 0.13, 0.6, 0.9, 0.26, 1.5, 0, Math.PI / 2, 12);
      p.box("orange", 1.0, 0.04, 0.6, 0.9, 0.55, 1.83, -1.2).box("rubber", 0.9, 0.02, 0.5, 0.9, 0.53, 1.79, -1.2);
      p.plane("story:glassCrate", 0.6, 0.18, 0.9, 0.14, 1.19);
      table(p, -0.8, 1.6, 1.0, 0.6, 0.76, "darkMetal");
      p.box("darkMetal", 0.36, 0.02, 0.25, -0.8, 0.79, 1.6).box("panelLight", 0.34, 0.22, 0.01, -0.8, 0.92, 1.75, -0.3);
      wallText(p, "glassLogo", 0.9, 0.45, -0.8, 1.7);
      break;
    case "kesslerChair":
      // One chair facing the observation window, and a lot of cigarette ends.
      p.box("darkMetal", 1.7, 1.0, 0.08, 0.9, 1.45, WALL - 0.04).box("glass", 1.5, 0.8, 0.03, 0.9, 1.45, WALL - 0.09);
      chair(p, 0.9, 1.0, Math.PI);
      for (let i = 0; i < 12; i++)
        p.cyl("paper", 0.006, 0.03, 0.9 + (rand() - 0.5) * 0.9, 0.006, 1.0 + (rand() - 0.5) * 0.7, Math.PI / 2, 0, 5, rand() * 3);
      break;
    case "bloodFridge":
      // The cabinet with the last clean sample of Arkadin's blood. One vial isn't red.
      p.box("enamel", 0.65, 0.9, 0.55, -0.9, 0.45, 1.65).box("glass", 0.55, 0.7, 0.02, -0.9, 0.48, 1.36);
      p.box("metal", 0.55, 0.02, 0.45, -0.9, 0.5, 1.65);
      for (let i = 0; i < 6; i++) p.cyl(i === 4 ? "rubber" : "blood", 0.015, 0.1, -1.1 + i * 0.08, 0.57, 1.6);
      p.box("panelLight", 0.06, 0.03, 0.01, -0.7, 0.85, 1.37);
      wallText(p, "burnIt", 0.8, 0.35, -0.9, 1.4, 0.05);
      break;
    // ------------------------------------------------ ventilation
    case "turns":
      wallText(p, "turns", 1.8, 0.9, 0, 1.3, -0.03);
      break;
    case "rivetBench":
      p.box("wood", 1.6, 0.06, 0.6, 0.6, 0.9, 1.6).box("darkMetal", 1.5, 0.84, 0.04, 0.6, 0.44, 1.85);
      p.box("orange", 0.5, 0.15, 0.3, 0.4, 1.0, 1.6)
        .box("darkMetal", 0.35, 0.1, 0.08, 0.95, 0.98, 1.55)
        .box("brass", 0.05, 0.03, 0.05, 1.15, 0.94, 1.45);
      wallText(p, "interlock", 0.7, 0.9, -0.9, 1.5);
      break;
    case "camp1991":
      // Someone lived here for 212 days in 1991: a bedroll, tins, candles, a drawing of the sun.
      p.cyl("cloth", 0.16, 0.8, -1.1, 0.16, 1.65, 0, Math.PI / 2, 10).box("tarp", 0.8, 0.03, 1.8, 0.2, 0.015, 1.0, 0, 0, Math.PI / 2 - 0.1);
      for (let i = 0; i < 14; i++)
        p.cyl("rust", 0.04, 0.1, 0.9 + (i % 4) * 0.1, 0.05 + Math.floor(i / 4) * 0.105, 1.75 - (i % 2) * 0.05, 0, 0, 8);
      for (let i = 0; i < 3; i++) p.cyl("enamel", 0.02, 0.05 + i * 0.02, -0.3 + i * 0.1, 0.03, 1.85);
      wallText(p, "sunDrawing", 0.42, 0.3, -0.3, 0.9, -0.08);
      wallText(p, "days", 1.4, 0.7, 0.6, 1.6);
      break;
    case "supervisor":
      wallText(p, "supervisor", 2.0, 1.0, 0, 1.45, 0.02);
      break;
    // ------------------------------------------------ power plant
    case "liftBoard":
      // The lift's status board: three generators, three lamps, all dark.
      p.box("darkMetal", 1.3, 0.8, 0.1, 0.4, 1.55, WALL - 0.05);
      for (let i = 0; i < 3; i++)
        p.cyl("darkMetal", 0.08, 0.05, 0.0 + i * 0.4, 1.6, WALL - 0.12, Math.PI / 2).cyl(
          "glass",
          0.07,
          0.06,
          0.0 + i * 0.4,
          1.6,
          WALL - 0.13,
          Math.PI / 2
        );
      wallText(p, "genBoard", 1.2, 0.3, 0.4, 2.15);
      break;
    case "maraMap":
      // Mara's plan, drawn on the back of a schematic and taped up: start one, run.
      wallText(p, "maraMap", 1.2, 0.85, 0.2, 1.5, 0.03);
      p.cyl("darkMetal", 0.035, 0.22, -1.0, 0.035, 1.3, Math.PI / 2, 0, 8, 0.5);
      break;
    case "engineerStash":
      crate(p, 0.8, 0, 1.6, 0.7, 0.45, 0.5);
      for (let i = 0; i < 6; i++) p.cyl("paintYellow", 0.03, 0.1, 0.55 + i * 0.09, 0.5, 1.55, 0, 0, 8);
      p.ring("paper", 0.05, 0.02, 1.0, 0.5, 1.7, Math.PI / 2).cyl("metal", 0.05, 0.18, 1.05, 0.54, 1.45, 0, 0, 10);
      wallText(p, "crossList", 0.5, 0.7, 0.8, 1.35, 0.04);
      break;
    case "feeding":
      // Power draws it: a switch cabinet torn open, and something grown into the cables.
      p.box("darkMetal", 1.0, 1.8, 0.4, 0.6, 0.9, WALL - 0.2).box("darkMetal", 0.95, 1.7, 0.04, 0.0, 0.9, WALL - 0.6, 0, 0, 1.2);
      for (let i = 0; i < 9; i++) p.blob("flesh", 0.12 + rand() * 0.18, 0.4 + rand() * 0.4, 0.4 + rand() * 1.4, WALL - 0.4 + rand() * 0.15);
      for (let i = 0; i < 3; i++)
        p.cyl("flesh", 0.03, WALL_HEIGHT - 1.8, 0.45 + i * 0.15, (WALL_HEIGHT + 1.8) / 2, WALL - 0.25, 0, (i - 1) * 0.15);
      break;
    // ------------------------------------------------ armory
    case "smashedRadio":
      // Mara stopped listening the only way she could.
      for (let i = 0; i < 7; i++)
        p.box(
          i % 3 ? "wood" : "darkMetal",
          0.06 + rand() * 0.14,
          0.03 + rand() * 0.05,
          0.05 + rand() * 0.1,
          0.6 + (rand() - 0.5) * 0.8,
          0.02,
          1.4 + (rand() - 0.5) * 0.6,
          0,
          0,
          rand() * 3
        );
      p.box("dial", 0.14, 0.05, 0.01, 0.8, 0.012, 1.2, Math.PI / 2, 0, 0.4);
      p.box("wood", 0.03, 0.03, 0.32, 0.2, 0.02, 1.25, 0, 0, 0.7).box("darkMetal", 0.12, 0.05, 0.05, 0.31, 0.03, 1.13, 0, 0, 0.7);
      p.box("paintRed", 0.45, 0.25, 0.25, -1.0, 0.13, 1.6, 0, 0, -0.3).box("enamel", 0.12, 0.04, 0.01, -1.05, 0.2, 1.47, 0, 0, -0.3);
      break;
    case "securityLocker":
      // His locker, open: ear defenders on the hook, empty magazines, and his last line on the wall.
      p.box("metal", 0.5, 1.9, 0.5, -0.9, 0.95, 1.7).box("metal", 0.46, 1.8, 0.02, -1.25, 0.95, 1.3, 0, 0, 0.9);
      p.ring("rubber", 0.1, 0.012, -0.9, 1.5, 1.55, 0, 0)
        .cyl("rubber", 0.06, 0.05, -1.0, 1.42, 1.55, 0, Math.PI / 2)
        .cyl("rubber", 0.06, 0.05, -0.8, 1.42, 1.55, 0, Math.PI / 2);
      for (let i = 0; i < 5; i++) p.box("darkMetal", 0.04, 0.02, 0.12, -0.4 + rand() * 0.6, 0.012, 1.2 + rand() * 0.5, 0, 0, rand() * 3);
      wallText(p, "stopListening", 1.6, 0.8, 0.6, 1.5, -0.03);
      break;
    case "lastStand":
      // The sign-out desk turned over as a barricade, the floor brass with spent cases.
      p.box("wood", 1.4, 0.7, 0.05, 0.2, 0.36, 0.95, 0, 0, 0.1).box("wood", 1.4, 0.05, 0.7, 0.25, 0.7, 1.28, 0, 0, 0.1);
      for (let i = 0; i < 30; i++)
        p.cyl("brass", 0.006, 0.03, 0.2 + (rand() - 0.5) * 1.6, 0.006, 1.6 + (rand() - 0.5) * 0.5, Math.PI / 2, 0, 5, rand() * 3);
      p.box("paper", 0.3, 0.02, 0.4, -1.2, 0.012, 1.4, 0, 0, 0.5);
      wallText(p, "ledger", 0.45, 0.6, -1.2, 1.5);
      wallText(p, "alreadyInside", 1.6, 0.5, 0.4, 2.35, 0.02);
      break;
    // ------------------------------------------------ hive
    case "cocoons":
      // It keeps them: three of the crew, grown into the wall, boots still on.
      for (const x of [-1.1, 0, 1.1]) {
        // Lumpy, overlapping, grown rather than stacked.
        for (let k = 0; k < 8; k++)
          p.blob(
            "flesh",
            0.26 - k * 0.012 + rand() * 0.08,
            x + (rand() - 0.5) * 0.16,
            0.42 + k * 0.21 + rand() * 0.05,
            WALL - 0.28 + (rand() - 0.5) * 0.1
          );
        for (let k = 0; k < 3; k++) p.cyl("flesh", 0.025, 1.2, x + (rand() - 0.5) * 0.5, 1.2, WALL - 0.12, 0, (rand() - 0.5) * 0.8, 5);
        p.box("rubber", 0.12, 0.14, 0.26, x - 0.08, 0.12, WALL - 0.45).box("rubber", 0.12, 0.14, 0.26, x + 0.08, 0.1, WALL - 0.42);
        p.cyl("flesh", 0.03, WALL_HEIGHT - 1.8, x, (WALL_HEIGHT + 1.8) / 2, WALL - 0.25);
      }
      break;
    case "maraCalls":
      // Mara's medic jacket, half taken in, and a radio grown into the wall: her voice comes from it.
      for (let i = 0; i < 6; i++) p.blob("flesh", 0.2 + rand() * 0.2, -0.6 + rand() * 1.2, 0.5 + rand() * 1.6, WALL - 0.25);
      p.box("paintRed", 0.5, 0.65, 0.12, 0.7, 1.2, WALL - 0.2, 0, 0.15)
        .box("enamel", 0.14, 0.04, 0.01, 0.7, 1.35, WALL - 0.27)
        .box("enamel", 0.04, 0.14, 0.01, 0.7, 1.35, WALL - 0.27);
      radio(p, -0.4, 1.2, WALL - 0.35, true);
      break;
    case "maraPack":
      // Her pack, and the photograph of the valley she meant you to take.
      p.box("olive", 0.45, 0.55, 0.28, 0.9, 0.27, 1.65, -0.15, 0, 0.3).box("olive", 0.35, 0.2, 0.12, 0.9, 0.2, 1.48, -0.15, 0, 0.3);
      p.box("rubber", 0.04, 0.5, 0.03, 0.8, 0.3, 1.82, 0, 0, 0.3).box("rubber", 0.04, 0.5, 0.03, 1.0, 0.3, 1.86, 0, 0, 0.3);
      wallText(p, "village", 0.4, 0.28, 0.3, 1.1, -0.06);
      break;
    // ------------------------------------------------ lift shaft
    case "roster":
      p.box("darkMetal", 1.0, 1.6, 0.06, 0, 1.2, WALL - 0.03).box("metal", 0.06, 0.06, 0.12, 0.42, 1.2, WALL - 0.1);
      wallText(p, "roster", 0.7, 1.0, 0, 1.4, 0, WALL - 0.065);
      break;
    case "charges":
      // Arkadin's charges, all the way up the shaft wall, linked by det cord.
      for (let i = 0; i < 5; i++) {
        const y = 0.4 + i * 0.6;
        const x = -1.2 + (i % 2) * 0.5;
        p.box("paintRed", 0.32, 0.22, 0.14, x, y, WALL - 0.08).box("darkMetal", 0.06, 0.06, 0.04, x, y + 0.08, WALL - 0.16);
      }
      p.cyl("paintYellow", 0.008, WALL_HEIGHT, -1.0, WALL_HEIGHT / 2, WALL - 0.02);
      p.box("darkMetal", 0.3, 0.4, 0.12, 0.6, 1.3, WALL - 0.06).box("paintRed", 0.08, 0.08, 0.04, 0.6, 1.35, WALL - 0.14);
      wallText(p, "charges", 1.0, 0.45, 0.6, 2.0);
      break;
  }
}

// ---------------------------------------------------------------- textures

interface TexDef {
  w: number;
  h: number;
  /** Drawn straight onto the wall (writing, scratches), rather than on paper. */
  onWall?: boolean;
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void;
}

function paper(g: CanvasRenderingContext2D, w: number, h: number, tint = "#c8c0a8"): void {
  g.fillStyle = tint;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(60,40,20,${Math.random() * 0.12})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 12, 2 + Math.random() * 6);
  }
}

function lines(
  g: CanvasRenderingContext2D,
  text: string[],
  x: number,
  y: number,
  size: number,
  step: number,
  font = "'Courier New', monospace",
  align: CanvasTextAlign = "left"
): void {
  g.font = `bold ${size}px ${font}`;
  g.textAlign = align;
  text.forEach((t, i) => g.fillText(t, x, y + i * step));
}

/** Hand-written: each line a little crooked. */
function scrawl(g: CanvasRenderingContext2D, text: string[], color: string, size: number, w: number, h: number): void {
  g.fillStyle = color;
  g.font = `bold ${size}px 'Courier New', monospace`;
  g.textAlign = "center";
  const step = size * 1.15;
  const top = h / 2 - ((text.length - 1) * step) / 2 + size * 0.35;
  text.forEach((t, i) => {
    g.save();
    g.translate(w / 2, top + i * step);
    g.rotate((Math.random() - 0.5) * 0.06);
    g.fillText(t, 0, 0, w * 0.94);
    g.restore();
  });
}

/** Scratched in: pale lines with a dark edge. */
function scratched(g: CanvasRenderingContext2D, text: string[], size: number, w: number, h: number): void {
  g.save();
  g.translate(2, 2);
  scrawl(g, text, "rgba(0,0,0,0.6)", size, w, h);
  g.restore();
  scrawl(g, text, "rgba(205,200,185,0.9)", size, w, h);
}

const STORY_TEX: Record<string, TexDef> = {
  chartNur: {
    w: 128,
    h: 160,
    draw: (g, w, h) => {
      paper(g, w, h);
      g.fillStyle = "#1a1a28";
      lines(g, ["ПАЦ. 22", "КАНЫБЕКОВ", "", "седация", "  д.1 ✓", "  д.4 ✓", "  д.8 ✓", "  д.11"], 10, 22, 13, 17);
    },
  },
  chart14: {
    w: 128,
    h: 160,
    draw: (g, w, h) => {
      paper(g, w, h);
      g.fillStyle = "#1a1a28";
      lines(g, ["ПАЦ. 14", "КЕССЛЕР Т.", "", "дерматит?", "поёт", "по ночам"], 10, 22, 14, 20);
      g.strokeStyle = "#8a1a1a";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(10, 130);
      g.lineTo(118, 112);
      g.stroke();
    },
  },
  fourNotes: {
    w: 512,
    h: 256,
    onWall: true,
    draw: (g, w, h) => {
      // A stave scratched over and over, and the same four notes on it every time.
      g.strokeStyle = "rgba(30,24,20,0.85)";
      g.fillStyle = "rgba(30,24,20,0.85)";
      for (let rep = 0; rep < 3; rep++) {
        const oy = 40 + rep * 70 + (Math.random() - 0.5) * 10;
        g.lineWidth = 2;
        for (let l = 0; l < 5; l++) {
          g.beginPath();
          g.moveTo(20, oy + l * 9);
          g.lineTo(w - 20, oy + l * 9 + (Math.random() - 0.5) * 6);
          g.stroke();
        }
        [0, 3, 1, 4].forEach((n, i) => {
          const x = 90 + i * 100 + rep * 12;
          const y = oy + 36 - n * 9;
          g.beginPath();
          g.ellipse(x, y, 9, 7, -0.4, 0, Math.PI * 2);
          g.fill();
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(x + 8, y);
          g.lineTo(x + 8, y - 40);
          g.stroke();
        });
      }
      void h;
    },
  },
  claws: {
    w: 512,
    h: 256,
    onWall: true,
    draw: (g, w, h) => {
      for (let set = 0; set < 3; set++) {
        const x0 = 60 + set * 150 + Math.random() * 30;
        const y0 = 30 + Math.random() * 40;
        for (let k = 0; k < 4; k++) {
          g.strokeStyle = "rgba(10,8,6,0.85)";
          g.lineWidth = 6;
          g.beginPath();
          g.moveTo(x0 + k * 14, y0);
          g.quadraticCurveTo(x0 + k * 14 + 20, y0 + 80, x0 + k * 12 + 30, y0 + 160 + Math.random() * 40);
          g.stroke();
          g.strokeStyle = "rgba(200,190,170,0.4)";
          g.lineWidth = 2;
          g.stroke();
        }
      }
      void w;
      void h;
    },
  },
  rota: {
    w: 256,
    h: 352,
    draw: (g, w, h) => {
      paper(g, w, h, "#d0caa8");
      g.fillStyle = "#1a1a28";
      lines(g, ["ГРАФИК СМЕН · SHIFT ROTA"], 12, 26, 13, 16);
      const names = [
        "Asanov",
        "Petrov",
        "Kim",
        "Ilyasova",
        "Orlov",
        "Bekov",
        "Seitov",
        "Kessler",
        "Novak",
        "Duisen",
        "Hale",
        "Sato",
        "Abenov",
        "Voss",
        "Tursun",
        "Rakhim",
        "Lee",
        "Omarov",
        "Grant",
        "Sydykov",
      ];
      names.forEach((n, i) => {
        g.fillStyle = "#1a1a28";
        g.font = "12px 'Courier New', monospace";
        g.fillText(`${String(i + 1).padStart(2, "0")} ${n}`, 12, 52 + i * 15);
        if (i >= 14) {
          g.fillStyle = "#6a1a1a";
          g.font = "italic 11px 'Courier New', monospace";
          g.fillText("Heard singing. Sent home.", 112, 52 + i * 15);
        }
      });
    },
  },
  noOpen: {
    w: 512,
    h: 176,
    draw: (g, w, h) => {
      g.fillStyle = "#b8962a";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#121008";
      for (let i = -2; i < 12; i++) g.fillRect(i * 50, 0, 22, 18);
      for (let i = -2; i < 12; i++) g.fillRect(i * 50 + 20, h - 18, 22, 18);
      lines(g, ["НЕ ОТКРЫВАТЬ · НЕ СЛУШАТЬ", "DO NOT OPEN · DO NOT LISTEN — 1988"], w / 2, 80, 30, 46, "Arial, sans-serif", "center");
    },
  },
  sentHome: {
    w: 384,
    h: 160,
    onWall: true,
    draw: (g, w, h) => scrawl(g, ["ОТПРАВЛЕНЫ ДОМОЙ?", "КУДА?"], "rgba(205,198,180,0.85)", 40, w, h),
  },
  liftAccess: {
    w: 384,
    h: 170,
    draw: (g, w, h) => {
      g.fillStyle = "#1c2430";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#e8e0c8";
      lines(g, ["LIFT ACCESS", "AUTHORISED: HENDRICKS ONLY", "— SITE SECURITY —"], w / 2, 52, 26, 44, "Arial, sans-serif", "center");
    },
  },
  orlov: {
    w: 256,
    h: 128,
    onWall: true,
    draw: (g, w, h) => scrawl(g, ["ПЕТРОВ · КИМ · СЕИТОВ"], "rgba(205,198,180,0.85)", 26, w, h),
  },
  yourName: {
    w: 512,
    h: 256,
    onWall: true,
    draw: (g, w, h) => scrawl(g, ["НЕ ГОВОРИ ЕМУ", "СВОЁ ИМЯ", "never tell it your name"], "rgba(150,40,30,0.9)", 52, w, h),
  },
  glassCrate: {
    w: 256,
    h: 128,
    draw: (g, w, h) => {
      g.fillStyle = "#c86a1a";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#101010";
      lines(g, ["GLASS · R-SERIES", "KEEP AT 4°C · THIS WAY UP"], w / 2, 52, 22, 38, "Arial, sans-serif", "center");
    },
  },
  pumpsOff: {
    w: 384,
    h: 192,
    draw: (g, w, h) => {
      paper(g, w, h);
      g.fillStyle = "#1a1a28";
      lines(g, ["НАСОСЫ НЕ ВКЛЮЧАТЬ.", "НЕ РАЗГОВАРИВАТЬ.", "", "— Аркадин, 1988"], 20, 50, 26, 34);
    },
  },
  r7: {
    w: 384,
    h: 176,
    draw: (g, w, h) => {
      g.fillStyle = "#1a1a1a";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#d8c84a";
      lines(g, ["ОБРАЗЕЦ R-7", "4°C · ТЕМНОТА · НЕ ГОВОРИТЬ"], w / 2, 70, 30, 50, "Arial, sans-serif", "center");
    },
  },
  girlDrawing: {
    w: 256,
    h: 184,
    draw: (g, w, h) => {
      paper(g, w, h, "#e8e0cc");
      g.strokeStyle = "#2a5ab8";
      g.lineWidth = 4;
      g.beginPath();
      g.arc(80, 70, 18, 0, Math.PI * 2);
      g.moveTo(80, 88);
      g.lineTo(80, 140);
      g.moveTo(80, 100);
      g.lineTo(55, 120);
      g.moveTo(80, 100);
      g.lineTo(105, 120);
      g.stroke();
      g.strokeStyle = "#b83a2a";
      g.beginPath();
      g.arc(170, 80, 34, 0, Math.PI * 2);
      g.moveTo(152, 116);
      g.lineTo(150, 150);
      g.moveTo(188, 116);
      g.lineTo(190, 150);
      g.stroke();
      g.fillStyle = "#2a2a2a";
      lines(g, ["ПАПЕ"], 120, 170, 22, 0, "'Comic Sans MS', cursive", "center");
    },
  },
  glassLogo: {
    w: 384,
    h: 192,
    draw: (g, w, h) => {
      g.fillStyle = "#e0e0dc";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#1a3a5a";
      g.lineWidth = 6;
      g.strokeRect(20, 20, 70, 70);
      g.fillStyle = "#1a3a5a";
      lines(g, ["PROJECT GLASS", "Recover · Contain · Deliver", "INTERNAL — CREW NOT TO BE TOLD"], 110, 55, 24, 38, "Arial, sans-serif");
    },
  },
  burnIt: {
    w: 384,
    h: 160,
    onWall: true,
    draw: (g, w, h) => scrawl(g, ["КРАСНАЯ — СЖЕЧЬ", "НЕТ — БЕГИ"], "rgba(205,198,180,0.85)", 36, w, h),
  },
  turns: {
    w: 512,
    h: 256,
    onWall: true,
    draw: (g, w, h) => scratched(g, ["←  ←  →", "ЛЕВО ЛЕВО ПРАВО", "COUNT AGAIN"], 50, w, h),
  },
  interlock: {
    w: 256,
    h: 336,
    draw: (g, w, h) => {
      g.fillStyle = "#d8d8d0";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#b81a1a";
      g.fillRect(0, 0, w, 60);
      g.fillStyle = "#fff";
      lines(g, ["WARNING"], w / 2, 42, 30, 0, "Arial, sans-serif", "center");
      g.fillStyle = "#1a1a1a";
      lines(
        g,
        ["RIVET GUN", "INTERLOCK", "MUST BE", "FITTED", "", "Fires across a", "room without it."],
        w / 2,
        100,
        22,
        30,
        "Arial, sans-serif",
        "center"
      );
    },
  },
  sunDrawing: {
    w: 256,
    h: 184,
    draw: (g, w, h) => {
      paper(g, w, h, "#e8e0cc");
      g.strokeStyle = "#e8a01a";
      g.fillStyle = "#f0c030";
      g.lineWidth = 5;
      g.beginPath();
      g.arc(128, 80, 34, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.beginPath();
        g.moveTo(128 + Math.cos(a) * 44, 80 + Math.sin(a) * 44);
        g.lineTo(128 + Math.cos(a) * 70, 80 + Math.sin(a) * 70);
        g.stroke();
      }
      g.fillStyle = "#3a8a3a";
      g.fillRect(0, 160, w, 24);
    },
  },
  days: {
    w: 512,
    h: 256,
    onWall: true,
    draw: (g, w, h) => {
      g.strokeStyle = "rgba(200,192,175,0.8)";
      g.lineWidth = 3;
      for (let i = 0; i < 212; i++) {
        const group = Math.floor(i / 5);
        const k = i % 5;
        const gx = 14 + (group % 14) * 35;
        const gy = 14 + Math.floor(group / 14) * 52;
        g.beginPath();
        if (k < 4) {
          g.moveTo(gx + k * 6, gy);
          g.lineTo(gx + k * 6 + 1, gy + 40);
        } else {
          g.moveTo(gx - 3, gy + 32);
          g.lineTo(gx + 26, gy + 8);
        }
        g.stroke();
      }
      g.fillStyle = "rgba(200,192,175,0.9)";
      lines(g, ["212. ЕЩЁ Я."], w - 20, h - 20, 30, 0, "'Courier New', monospace", "right");
    },
  },
  supervisor: {
    w: 512,
    h: 256,
    onWall: true,
    draw: (g, w, h) => scratched(g, ["THE VOICE IS NOT", "THE SUPERVISOR", "HE DIED ON DAY TWO"], 40, w, h),
  },
  genBoard: {
    w: 384,
    h: 96,
    draw: (g, w, h) => {
      g.fillStyle = "#1a1c1a";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#c8c0a0";
      lines(g, ["ЛИФТ · ГЕН 1 · ГЕН 2 · ГЕН 3"], w / 2, 58, 24, 0, "Arial, sans-serif", "center");
    },
  },
  maraMap: {
    w: 384,
    h: 272,
    draw: (g, w, h) => {
      paper(g, w, h, "#b8c8d8");
      g.strokeStyle = "rgba(30,50,90,0.5)";
      g.lineWidth = 1;
      for (let i = 0; i < w; i += 24) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, h);
        g.stroke();
      }
      g.strokeStyle = "#1a1a1a";
      g.lineWidth = 4;
      g.strokeRect(40, 40, 300, 180);
      g.fillStyle = "#b81a1a";
      for (const [x, y, n] of [
        [80, 80, "1"],
        [300, 90, "2"],
        [190, 200, "3"],
      ] as const) {
        g.font = "bold 30px Arial";
        g.fillText("X", x - 10, y + 10);
        g.font = "bold 16px Arial";
        g.fillText(n, x + 14, y - 8);
      }
      g.strokeStyle = "#b81a1a";
      g.setLineDash([10, 8]);
      g.beginPath();
      g.moveTo(80, 80);
      g.lineTo(300, 90);
      g.lineTo(190, 200);
      g.lineTo(340, 240);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#1a1a1a";
      lines(g, ["START ONE. RUN. — M."], 20, h - 12, 20, 0, "'Comic Sans MS', cursive");
    },
  },
  crossList: {
    w: 192,
    h: 272,
    draw: (g, w, h) => {
      paper(g, w, h);
      const names = ["Петров", "Ильясова", "Ким", "Аркадин", "Я"];
      names.forEach((n, i) => {
        g.fillStyle = "#1a1a28";
        g.font = "bold 24px 'Courier New', monospace";
        g.fillText(n, 20, 50 + i * 48);
        g.strokeStyle = "#1a1a28";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(14, 42 + i * 48);
        g.lineTo(20 + n.length * 15, 40 + i * 48 + (i === 4 ? -4 : 2));
        g.stroke();
      });
    },
  },
  stopListening: {
    w: 512,
    h: 256,
    onWall: true,
    draw: (g, w, h) => scrawl(g, ["BULLETS RUN OUT.", "ITS VOICE DOESN'T.", "STOP LISTENING"], "rgba(140,30,24,0.9)", 42, w, h),
  },
  ledger: {
    w: 192,
    h: 256,
    draw: (g, w, h) => {
      paper(g, w, h, "#d8d0b0");
      g.fillStyle = "#1a1a28";
      lines(g, ["SIGNED OUT", "Rifles 40/40", "Shotguns 12/12", "Rounds 900", "", "RETURNED", "—"], 14, 34, 15, 24);
    },
  },
  alreadyInside: {
    w: 512,
    h: 160,
    onWall: true,
    draw: (g, w, h) => scrawl(g, ["THEY WERE ALREADY INSIDE"], "rgba(205,198,180,0.85)", 42, w, h),
  },
  village: {
    w: 256,
    h: 176,
    draw: (g, w, h) => {
      g.fillStyle = "#e8e4d8";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#6a7a8a";
      g.fillRect(10, 10, w - 20, 120);
      g.fillStyle = "#c8d0d8";
      g.beginPath();
      g.moveTo(10, 100);
      g.lineTo(70, 30);
      g.lineTo(120, 80);
      g.lineTo(180, 20);
      g.lineTo(246, 90);
      g.lineTo(246, 130);
      g.lineTo(10, 130);
      g.fill();
      g.fillStyle = "#4a3a2a";
      for (let i = 0; i < 6; i++) g.fillRect(40 + i * 30, 110 - (i % 2) * 6, 18, 14);
      g.fillStyle = "#2a2a2a";
      lines(g, ["Ак-Суу, 2024"], w / 2, 160, 18, 0, "'Comic Sans MS', cursive", "center");
    },
  },
  roster: {
    w: 256,
    h: 368,
    draw: (g, w, h) => {
      paper(g, w, h);
      g.fillStyle = "#1a1a28";
      lines(g, ["SURFACE CREW · 41"], 12, 24, 15, 0);
      for (let i = 0; i < 41; i++) {
        const y = 40 + i * 8;
        g.fillStyle = "#3a3a48";
        g.fillRect(16, y, 100 + ((i * 37) % 80), 3);
        if (i !== 40) {
          g.fillStyle = "#1a1a28";
          g.fillRect(12, y, 120 + ((i * 53) % 90), 2);
        }
      }
      g.strokeStyle = "#8a1a1a";
      g.lineWidth = 2;
      g.strokeRect(10, 40 + 40 * 8 - 3, 210, 9);
    },
  },
  charges: {
    w: 384,
    h: 176,
    draw: (g, w, h) => {
      g.fillStyle = "#b81a1a";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#f0e8d0";
      lines(g, ["ВВ · ВЗРЫВООПАСНО", "EXPLOSIVES", "Аркадин · 1991"], w / 2, 52, 26, 44, "Arial, sans-serif", "center");
    },
  },
};

/** Whether a story texture is writing on the wall (transparent) rather than a sheet of something. */
export function storyTextureOnWall(key: string): boolean {
  return STORY_TEX[key]?.onWall ?? false;
}

export function storyTexture(key: string): THREE.CanvasTexture {
  const def = STORY_TEX[key];
  const c = document.createElement("canvas");
  c.width = def?.w ?? 64;
  c.height = def?.h ?? 64;
  const g = c.getContext("2d")!;
  def?.draw(g, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Every texture a scene can ask for, for the tests. */
export const STORY_TEXTURES: readonly string[] = Object.keys(STORY_TEX);
