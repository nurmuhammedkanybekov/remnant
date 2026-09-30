import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CELL_SIZE, WALL_HEIGHT, cellCenter } from "./grid";
import type { ParsedLevel } from "./levelParser";
import { hash, mulberry32, shuffle } from "./reinforcements";

/**
 * Set dressing: what makes a corridor a hospital ward, a morgue or a
 * freezer. The map says where the walls are; this gives each room a purpose
 * (from the level's list, biggest rooms first), furnishes it against its
 * walls, puts a stencilled sign by its door (Russian, as the station was
 * built, with the consortium's English under it), runs pipes and cable
 * trays along the corridors, lays the dead under tarps, and gives every
 * note something to lie on.
 *
 * Planning is pure and seeded (the same level always looks the same, for
 * every co-op player); building merges all props into a few meshes per
 * material. Props stand against walls and are shallow, so they never block
 * a corridor: collision stays with the map.
 */

export type RoomKind =
  | "ward"
  | "surgery"
  | "morgue"
  | "stores"
  | "workshop"
  | "lockers"
  | "dorm"
  | "freezer"
  | "butchery"
  | "office"
  | "pumps"
  | "lab"
  | "control"
  | "armory"
  | "overgrown";

export type PropKind =
  | "bed"
  | "ivStand"
  | "cabinet"
  | "locker"
  | "desk"
  | "shelf"
  | "crates"
  | "freezer"
  | "hooks"
  | "bench"
  | "toolRack"
  | "bunk"
  | "pipesUp"
  | "valve"
  | "tank"
  | "panel"
  | "gunRack"
  | "growth"
  | "noteTable"
  | "body";

export interface PropPlacement {
  kind: PropKind;
  /** World position of the prop's base centre. */
  x: number;
  z: number;
  /** Rotation about Y: the prop's front faces away from the wall it stands against. */
  rot: number;
}

export interface SignPlacement {
  lines: [string, string];
  x: number;
  z: number;
  rot: number;
}

export interface CorridorRun {
  kind: "pipes" | "tray";
  x: number;
  z: number;
  /** Runs along X (true) or Z. */
  alongX: boolean;
}

export interface DressingPlan {
  props: PropPlacement[];
  signs: SignPlacement[];
  runs: CorridorRun[];
}

interface LevelDressing {
  rooms: RoomKind[];
  /** A sign for each room, in the same order: [Russian, English]. */
  names: [string, string][];
}

/** Each level's rooms, biggest first. Rooms beyond the list reuse it from the start. */
export const LEVEL_DRESSING: Record<string, LevelDressing> = {
  infirmary: {
    rooms: ["ward", "ward", "surgery", "morgue", "stores"],
    names: [
      ["ПАЛАТА 1", "WARD 1"],
      ["ПАЛАТА 2", "WARD 2"],
      ["ОПЕРАЦИОННАЯ", "SURGERY"],
      ["МОРГ", "MORGUE"],
      ["СКЛАД", "STORES"],
    ],
  },
  "maintenance-wing": {
    rooms: ["workshop", "lockers", "dorm", "stores"],
    names: [
      ["МАСТЕРСКАЯ", "WORKSHOP"],
      ["РАЗДЕВАЛКА", "LOCKER ROOM"],
      ["ОБЩЕЖИТИЕ", "BUNKS"],
      ["СКЛАД", "STORES"],
    ],
  },
  "cold-storage": {
    rooms: ["freezer", "butchery", "stores", "office", "freezer"],
    names: [
      ["ХОЛОДИЛЬНИК 1", "FREEZER 1"],
      ["РАЗДЕЛОЧНАЯ", "BUTCHERY"],
      ["КЛАДОВАЯ", "PANTRY"],
      ["ОХРАНА", "SECURITY"],
      ["ХОЛОДИЛЬНИК 2", "FREEZER 2"],
    ],
  },
  "pumping-station": {
    rooms: ["pumps", "pumps", "office", "stores"],
    names: [
      ["НАСОСНАЯ 1", "PUMP HALL 1"],
      ["НАСОСНАЯ 2", "PUMP HALL 2"],
      ["ДИСПЕТЧЕРСКАЯ", "PUMP CONTROL"],
      ["СКЛАД", "STORES"],
    ],
  },
  "containment-labs": {
    rooms: ["lab", "lab", "office", "lab", "stores"],
    names: [
      ["ЛАБОРАТОРИЯ 3", "LAB 3 — R-7"],
      ["ЛАБОРАТОРИЯ 2", "LAB 2"],
      ["АРКАДИН Л.", "DR ARKADIN"],
      ["ЛАБОРАТОРИЯ 1", "LAB 1"],
      ["ОБРАЗЦЫ", "SAMPLES"],
    ],
  },
  ventilation: {
    rooms: ["stores", "workshop", "dorm"],
    names: [
      ["ВЕНТКАМЕРА", "FAN ROOM"],
      ["МАСТЕРСКАЯ", "WORKSHOP"],
      ["УКРЫТИЕ", "SHELTER"],
    ],
  },
  "power-plant": {
    rooms: ["control", "workshop", "stores", "control"],
    names: [
      ["ГЕНЕРАТОРНАЯ", "GENERATOR HALL"],
      ["МАСТЕРСКАЯ", "WORKSHOP"],
      ["СКЛАД ГСМ", "FUEL STORES"],
      ["ЩИТОВАЯ", "SWITCH ROOM"],
    ],
  },
  armory: {
    rooms: ["armory", "lockers", "dorm", "office"],
    names: [
      ["ОРУЖЕЙНАЯ", "ARMORY"],
      ["РАЗДЕВАЛКА", "SECURITY LOCKERS"],
      ["КАЗАРМА", "BARRACKS"],
      ["КОМАНДИР", "SECURITY CHIEF"],
    ],
  },
  hive: {
    rooms: ["overgrown", "overgrown", "lab", "overgrown"],
    names: [
      ["", ""],
      ["", ""],
      ["ЛАБОРАТОРИЯ 0", "LAB 0"],
      ["", ""],
    ],
  },
  "lift-shaft": {
    rooms: ["control", "stores"],
    names: [
      ["ПОДЪЁМНИК", "LIFT CONTROL"],
      ["СКЛАД", "STORES"],
    ],
  },
};

/** What each kind of room is furnished with, against its walls. */
const ROOM_PROPS: Record<RoomKind, PropKind[]> = {
  ward: ["bed", "bed", "ivStand", "cabinet"],
  surgery: ["bed", "ivStand", "shelf", "cabinet"],
  morgue: ["freezer", "bed", "freezer"],
  stores: ["shelf", "crates", "shelf", "crates"],
  workshop: ["bench", "toolRack", "shelf", "crates"],
  lockers: ["locker", "locker", "bench"],
  dorm: ["bunk", "bunk", "locker"],
  freezer: ["freezer", "hooks", "crates"],
  butchery: ["hooks", "bench", "hooks"],
  office: ["desk", "cabinet", "shelf"],
  pumps: ["pipesUp", "valve", "tank", "pipesUp"],
  lab: ["desk", "tank", "shelf", "desk"],
  control: ["panel", "panel", "desk", "cabinet"],
  armory: ["gunRack", "locker", "gunRack", "crates"],
  overgrown: ["growth", "growth", "body"],
};

/** How deep each prop is (from the wall out into the room), so it sits flush. */
const DEPTH: Record<PropKind, number> = {
  bed: 0.95,
  ivStand: 0.4,
  cabinet: 0.55,
  locker: 0.55,
  desk: 0.7,
  shelf: 0.45,
  crates: 0.9,
  freezer: 0.85,
  hooks: 1.4,
  bench: 0.7,
  toolRack: 0.2,
  bunk: 0.95,
  pipesUp: 0.3,
  valve: 0.5,
  tank: 1.0,
  panel: 0.45,
  gunRack: 0.3,
  growth: 1.2,
  noteTable: 0,
  body: 0,
};

/** Map characters that are open floor a prop may stand on. */
const PLAIN = new Set([".", "L", "R", "S", "a", "b", "c", "d", "e", "f", "g", "h"]);

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Decides every prop, sign and pipe run for a level. Pure and seeded. */
export function planDressing(level: ParsedLevel): DressingPlan {
  const rand = mulberry32(hash(`${level.def.id}:dressing`));
  const map = level.def.map;
  const ch = (col: number, row: number) => map[row]?.[col] ?? "#";
  const open = (col: number, row: number) => !level.solid[row]?.[col] && ch(col, row) !== "#";
  const plain = (col: number, row: number) => PLAIN.has(ch(col, row)) || /[a-z]/.test(ch(col, row));
  const key = (c: number, r: number) => r * level.cols + c;

  // Rooms: open cells that belong to a 2×2 block of open cells, grouped.
  const inRoom = new Set<number>();
  for (let r = 0; r < level.rows - 1; r++)
    for (let c = 0; c < level.cols - 1; c++)
      if (open(c, r) && open(c + 1, r) && open(c, r + 1) && open(c + 1, r + 1))
        for (const [dc, dr] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ])
          inRoom.add(key(c + dc, r + dr));
  const rooms: number[][] = [];
  const seen = new Set<number>();
  for (const start of inRoom) {
    if (seen.has(start)) continue;
    const cells: number[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const k = queue.pop()!;
      cells.push(k);
      const c = k % level.cols;
      const r = Math.floor(k / level.cols);
      for (const [dc, dr] of SIDES) {
        const n = key(c + dc, r + dr);
        if (inRoom.has(n) && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    if (cells.length >= 4) rooms.push(cells.sort((a, b) => a - b));
  }
  rooms.sort((a, b) => b.length - a.length || a[0] - b[0]);

  const plan: DressingPlan = { props: [], signs: [], runs: [] };
  const dressing = LEVEL_DRESSING[level.def.id] ?? { rooms: ["stores"], names: [["", ""]] };
  const itemsNear = [...level.spawns.items.map((i) => i.pos), ...level.spawns.notes.map((n) => n.pos)];

  rooms.forEach((cells, i) => {
    const kind = dressing.rooms[i % dressing.rooms.length];
    const pool = ROOM_PROPS[kind];
    const name = dressing.names[i % dressing.names.length];
    let signed = false;
    for (const k of cells) {
      const c = k % level.cols;
      const r = Math.floor(k / level.cols);
      if (!plain(c, r)) continue;
      const centre = cellCenter(c, r);
      for (const [dc, dr] of SIDES) {
        // Only against real walls, never across a doorway.
        if (ch(c + dc, r + dr) !== "#") continue;
        // The sign goes on the wall of a room cell that opens onto the rest of the level.
        const entrance = SIDES.some(([ec, er]) => open(c + ec, r + er) && !inRoom.has(key(c + ec, r + er)));
        if (!signed && entrance && name[0]) {
          signed = true;
          // The sign faces out of the wall, into the room.
          const facing = Math.atan2(-dc, -dr);
          plan.signs.push({
            lines: name,
            x: centre.x + dc * (CELL_SIZE / 2 - 0.02),
            z: centre.y + dr * (CELL_SIZE / 2 - 0.02),
            rot: facing,
          });
          continue;
        }
        // Props have their back (local +Z) to the wall.
        const rot = Math.atan2(dc, dr);
        if (rand() > 0.55) continue;
        const prop = pool[Math.floor(rand() * pool.length)];
        const inset = CELL_SIZE / 2 - DEPTH[prop] / 2 - 0.04;
        // Slide along the wall a little so rows of props don't line up like a grid.
        const slide = (rand() - 0.5) * (CELL_SIZE - 2.2);
        const x = centre.x + dc * inset + (dr !== 0 ? slide : 0);
        const z = centre.y + dr * inset + (dc !== 0 ? slide : 0);
        // Keep clear of pickups, so nothing hides inside a bed.
        if (itemsNear.some((p) => Math.hypot(p.x + 0.6 - x, p.y - 0.4 - z) < 1.1)) continue;
        plan.props.push({ kind: prop, x, z, rot });
      }
    }
  });

  // Corridors: pipes and cable trays under the ceiling, along the way the corridor runs.
  for (let r = 0; r < level.rows; r++)
    for (let c = 0; c < level.cols; c++) {
      if (!open(c, r) || inRoom.has(key(c, r))) continue;
      const alongX = open(c - 1, r) || open(c + 1, r);
      const alongZ = open(c, r - 1) || open(c, r + 1);
      if (alongX === alongZ) continue; // corners and dead ends stay bare
      const roll = rand();
      const centre = cellCenter(c, r);
      if (roll < 0.4) plan.runs.push({ kind: "pipes", x: centre.x, z: centre.y, alongX });
      else if (roll < 0.6) plan.runs.push({ kind: "tray", x: centre.x, z: centre.y, alongX });
    }

  // Every note lies on something: a small table where somebody left it.
  for (const n of level.spawns.notes) plan.props.push({ kind: "noteTable", x: n.pos.x + 0.6, z: n.pos.y - 0.4, rot: rand() * Math.PI });

  // The dead, under tarps: a couple per level, in quiet corners away from the start.
  const quiet: THREE.Vector2[] = [];
  for (let r = 0; r < level.rows; r++)
    for (let c = 0; c < level.cols; c++) {
      if (!open(c, r) || !plain(c, r)) continue;
      const p = cellCenter(c, r);
      if (p.distanceTo(level.spawns.playerStart) < CELL_SIZE * 3) continue;
      if (itemsNear.some((q) => q.distanceTo(p) < 2)) continue;
      const walls = SIDES.filter(([dc, dr]) => ch(c + dc, r + dr) === "#").length;
      if (walls >= 2) quiet.push(p);
    }
  shuffle(quiet, rand);
  for (const p of quiet.slice(0, 2 + Math.floor(rand() * 2)))
    plan.props.push({ kind: "body", x: p.x + (rand() - 0.5), z: p.y + (rand() - 0.5), rot: rand() * Math.PI * 2 });

  return plan;
}

// ---------------------------------------------------------------- building

type MatKey = "metal" | "darkMetal" | "rust" | "wood" | "cloth" | "tarp" | "enamel" | "glass" | "panelLight" | "flesh" | "paper";

function materials(): Record<MatKey, THREE.MeshStandardMaterial> {
  return {
    metal: new THREE.MeshStandardMaterial({ color: 0x6a6f70, roughness: 0.55, metalness: 0.6 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2c3032, roughness: 0.6, metalness: 0.5 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.85, metalness: 0.3 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x8a8676, roughness: 0.95 }),
    tarp: new THREE.MeshStandardMaterial({ color: 0x28382f, roughness: 0.8 }),
    enamel: new THREE.MeshStandardMaterial({ color: 0xb8bcb4, roughness: 0.45, metalness: 0.1 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x2a3a30,
      roughness: 0.15,
      metalness: 0.1,
      emissive: 0x06120a,
      transparent: true,
      opacity: 0.8,
    }),
    panelLight: new THREE.MeshStandardMaterial({ color: 0x1a2a1a, emissive: 0x2a8a3a, emissiveIntensity: 0.6 }),
    flesh: new THREE.MeshStandardMaterial({ color: 0x2e2220, roughness: 0.5 }),
    paper: new THREE.MeshStandardMaterial({ color: 0x9a9480, roughness: 0.95 }),
  };
}

/** Collects boxes and cylinders by material, to merge into one mesh each. */
class Parts {
  readonly byMat = new Map<MatKey, THREE.BufferGeometry[]>();
  private readonly base = new THREE.Matrix4();

  at(x: number, z: number, rot: number): this {
    this.base.makeRotationY(rot).setPosition(x, 0, z);
    return this;
  }

  /** A box of size w×h×d whose centre is at local (x, y, z). Local -Z is the prop's front. */
  box(m: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, rz = 0): this {
    const g = new THREE.BoxGeometry(w, h, d);
    this.add(m, g, x, y, z, rx, rz);
    return this;
  }

  blob(m: MatKey, r: number, x: number, y: number, z: number): this {
    this.add(m, new THREE.SphereGeometry(r, 8, 6), x, y, z, 0, 0);
    return this;
  }

  cyl(m: MatKey, r: number, h: number, x: number, y: number, z: number, rx = 0, rz = 0, seg = 8): this {
    this.add(m, new THREE.CylinderGeometry(r, r, h, seg), x, y, z, rx, rz);
    return this;
  }

  private add(m: MatKey, g: THREE.BufferGeometry, x: number, y: number, z: number, rx: number, rz: number): void {
    const local = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)).setPosition(x, y, z);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(this.base, local));
    // Merging needs matching attributes: drop what the others may not have.
    g.deleteAttribute("uv");
    let list = this.byMat.get(m);
    if (!list) this.byMat.set(m, (list = []));
    list.push(g);
  }
}

/** Front is local -Z, the back against the wall at local +Z. */
function buildProp(p: Parts, kind: PropKind, rand: () => number): void {
  switch (kind) {
    case "bed":
      p.box("metal", 0.9, 0.06, 1.95, 0, 0.55, 0).box("cloth", 0.84, 0.12, 1.85, 0, 0.64, 0).box("cloth", 0.5, 0.08, 0.3, 0, 0.74, 0.7);
      for (const [x, z] of [
        [-0.42, -0.92],
        [0.42, -0.92],
        [-0.42, 0.92],
        [0.42, 0.92],
      ])
        p.cyl("metal", 0.025, 0.55, x, 0.27, z);
      p.box("metal", 0.9, 0.35, 0.04, 0, 0.78, 0.96);
      if (rand() < 0.5) p.box("tarp", 0.8, 0.05, 1.2, 0.02, 0.73, -0.25, 0, 0.05); // a rumpled sheet
      break;
    case "ivStand":
      p.cyl("metal", 0.015, 1.8, 0, 0.9, 0).cyl("darkMetal", 0.22, 0.03, 0, 0.02, 0).box("glass", 0.12, 0.2, 0.05, 0.08, 1.65, 0);
      break;
    case "cabinet":
      p.box("enamel", 0.8, 1.2, 0.5, 0, 0.6, 0)
        .box("darkMetal", 0.78, 0.02, 0.02, 0, 0.8, -0.26)
        .box("darkMetal", 0.78, 0.02, 0.02, 0, 0.4, -0.26);
      break;
    case "locker":
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 0.42;
        p.box("metal", 0.4, 1.9, 0.5, x, 0.95, 0);
        for (let v = 0; v < 3; v++) p.box("darkMetal", 0.22, 0.015, 0.01, x, 1.6 + v * 0.05, -0.255);
        if (rand() < 0.3) p.box("metal", 0.36, 1.7, 0.02, x - 0.15, 0.95, -0.35, 0, 0).box("rust", 0.02, 0.02, 0.02, x, 1.0, -0.26); // door hanging open
      }
      break;
    case "desk":
      p.box("wood", 1.3, 0.05, 0.65, 0, 0.76, 0).box("darkMetal", 0.4, 0.72, 0.6, 0.42, 0.37, 0);
      p.cyl("metal", 0.025, 0.74, -0.6, 0.37, -0.28).cyl("metal", 0.025, 0.74, -0.6, 0.37, 0.28);
      p.box("paper", 0.3, 0.01, 0.22, -0.2, 0.79, -0.05, 0, 0).box("darkMetal", 0.35, 0.28, 0.3, -0.3, 0.93, 0.12); // papers, an old terminal
      p.box("darkMetal", 0.42, 0.04, 0.42, -0.1, 0.45, -0.55).box("darkMetal", 0.42, 0.4, 0.04, -0.1, 0.65, -0.75); // chair
      break;
    case "shelf":
      p.box("metal", 0.04, 2, 0.4, -0.58, 1, 0).box("metal", 0.04, 2, 0.4, 0.58, 1, 0);
      for (let s = 0; s < 4; s++) {
        const y = 0.2 + s * 0.5;
        p.box("metal", 1.2, 0.03, 0.4, 0, y, 0);
        for (let j = 0; j < 3; j++)
          if (rand() < 0.7)
            p.box(rand() < 0.5 ? "wood" : "paper", 0.2 + rand() * 0.15, 0.15 + rand() * 0.15, 0.25, -0.4 + j * 0.4, y + 0.12, 0);
      }
      break;
    case "crates":
      p.box("wood", 0.8, 0.7, 0.8, 0, 0.35, 0);
      if (rand() < 0.6) p.box("wood", 0.6, 0.5, 0.6, 0.05, 0.95, 0.05, 0, 0);
      if (rand() < 0.5) p.box("wood", 0.5, 0.45, 0.5, 0.75, 0.225, 0.1);
      break;
    case "freezer":
      p.box("enamel", 1.0, 1.9, 0.8, 0, 0.95, 0)
        .box("darkMetal", 0.04, 0.5, 0.06, 0.38, 1.1, -0.42)
        .box("darkMetal", 0.98, 0.02, 0.02, 0, 1.3, -0.41);
      break;
    case "hooks":
      // A rail under the ceiling with hooks, and what hangs from some of them.
      p.box("darkMetal", 0.06, 0.06, 1.3, 0, WALL_HEIGHT - 0.35, 0);
      for (let i = 0; i < 3; i++) {
        const z = -0.5 + i * 0.5;
        p.cyl("metal", 0.01, 0.5, 0, WALL_HEIGHT - 0.6, z);
        if (rand() < 0.5) p.box("flesh", 0.3, 0.9, 0.22, 0, WALL_HEIGHT - 1.3, z, 0, (rand() - 0.5) * 0.1);
      }
      break;
    case "bench":
      p.box("wood", 1.6, 0.06, 0.6, 0, 0.9, 0).box("darkMetal", 1.5, 0.84, 0.04, 0, 0.44, 0.25);
      p.box("darkMetal", 0.15, 0.12, 0.2, -0.4, 0.99, -0.05).box("metal", 0.4, 0.04, 0.05, 0.3, 0.95, 0.05);
      break;
    case "toolRack":
      p.box("wood", 1.4, 1.0, 0.04, 0, 1.5, 0.08);
      for (let i = 0; i < 5; i++) p.box("darkMetal", 0.04, 0.3 + rand() * 0.2, 0.03, -0.55 + i * 0.27, 1.45, 0.03);
      break;
    case "bunk":
      for (const y of [0.4, 1.4]) p.box("metal", 0.9, 0.05, 1.95, 0, y, 0).box("cloth", 0.84, 0.1, 1.85, 0, y + 0.07, 0);
      for (const [x, z] of [
        [-0.43, -0.95],
        [0.43, -0.95],
        [-0.43, 0.95],
        [0.43, 0.95],
      ])
        p.cyl("metal", 0.025, 1.75, x, 0.87, z);
      break;
    case "pipesUp":
      p.cyl("rust", 0.12, WALL_HEIGHT, -0.2, WALL_HEIGHT / 2, 0).cyl("metal", 0.07, WALL_HEIGHT, 0.2, WALL_HEIGHT / 2, 0.02);
      p.cyl("darkMetal", 0.15, 0.08, -0.2, 1.2, 0).cyl("darkMetal", 0.15, 0.08, -0.2, 2.4, 0);
      break;
    case "valve":
      p.cyl("rust", 0.15, 1.2, 0, 0.6, 0.05)
        .cyl("darkMetal", 0.28, 0.04, 0, 1.25, -0.1, Math.PI / 2)
        .box("rust", 0.5, 0.06, 0.06, 0, 1.25, -0.12);
      break;
    case "tank":
      p.cyl("glass", 0.42, 1.6, 0, 0.9, 0, 0, 0, 14)
        .cyl("darkMetal", 0.46, 0.12, 0, 0.06, 0, 0, 0, 14)
        .cyl("darkMetal", 0.46, 0.1, 0, 1.72, 0, 0, 0, 14);
      if (rand() < 0.6) p.box("flesh", 0.35, 0.5, 0.3, 0, 0.75, 0, rand(), rand()); // something kept in it
      break;
    case "panel":
      p.box("darkMetal", 1.3, 1.6, 0.4, 0, 0.8, 0).box("darkMetal", 1.3, 0.4, 0.6, 0, 1.1, -0.2, -0.5, 0);
      for (let i = 0; i < 6; i++) if (rand() < 0.6) p.box("panelLight", 0.05, 0.03, 0.01, -0.5 + i * 0.2, 1.35, -0.42);
      break;
    case "gunRack":
      p.box("wood", 1.4, 1.2, 0.08, 0, 1.2, 0.1);
      for (let i = 0; i < 4; i++) if (rand() < 0.35) p.box("darkMetal", 0.07, 0.9, 0.05, -0.5 + i * 0.33, 1.2, 0.02); // most slots empty: "signed out: everything"
      break;
    case "growth":
      for (let i = 0; i < 4; i++) p.blob("flesh", 0.25 + rand() * 0.35, (rand() - 0.5) * 0.9, rand() * 1.4, (rand() - 0.5) * 0.4);
      break;
    case "noteTable":
      p.box("wood", 0.55, 0.04, 0.45, 0, 0.48, 0).cyl("metal", 0.02, 0.48, -0.22, 0.24, -0.18).cyl("metal", 0.02, 0.48, 0.22, 0.24, -0.18);
      p.cyl("metal", 0.02, 0.48, -0.22, 0.24, 0.18).cyl("metal", 0.02, 0.48, 0.22, 0.24, 0.18);
      break;
    case "body":
      // A body under a tarp: the shape of someone lying there, and their boots.
      p.box("tarp", 0.62, 0.22, 1.75, 0, 0.11, 0).box("tarp", 0.36, 0.2, 0.34, 0, 0.14, -0.78);
      p.box("darkMetal", 0.12, 0.12, 0.2, -0.12, 0.08, 0.95).box("darkMetal", 0.12, 0.12, 0.2, 0.12, 0.08, 0.95);
      break;
  }
}

/** A stencilled sign: the Russian name, and the consortium's English label under it. */
function signTexture(lines: [string, string]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 192;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1c1f1d";
  g.fillRect(0, 0, 512, 192);
  g.strokeStyle = "#6a6a5a";
  g.lineWidth = 6;
  g.strokeRect(10, 10, 492, 172);
  g.textAlign = "center";
  g.fillStyle = "#c8c0a0";
  g.font = "bold 56px 'Courier New', monospace";
  g.fillText(lines[0], 256, 84, 470);
  g.fillStyle = "#d8a23a";
  g.font = "600 34px Arial, sans-serif";
  g.fillText(lines[1], 256, 146, 470);
  // Grime.
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
    g.fillRect(Math.random() * 512, Math.random() * 192, 2 + Math.random() * 10, 2 + Math.random() * 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Builds a plan into the scene: merged props per material, the signs, the pipe runs. */
export function buildDressing(scene: THREE.Scene, level: ParsedLevel, plan: DressingPlan = planDressing(level)): void {
  const rand = mulberry32(hash(`${level.def.id}:props`));
  const mats = materials();
  const parts = new Parts();
  for (const pr of plan.props) buildProp(parts.at(pr.x, pr.z, pr.rot), pr.kind, rand);
  for (const run of plan.runs) {
    parts.at(run.x, run.z, run.alongX ? Math.PI / 2 : 0);
    // Local Z is along the run.
    if (run.kind === "pipes") {
      parts
        .cyl("rust", 0.09, CELL_SIZE, 1.4, WALL_HEIGHT - 0.25, 0, Math.PI / 2)
        .cyl("metal", 0.06, CELL_SIZE, 1.15, WALL_HEIGHT - 0.2, 0, Math.PI / 2);
      if (rand() < 0.4) parts.box("darkMetal", 0.35, 0.05, 0.05, 1.3, WALL_HEIGHT - 0.1, 0); // bracket
    } else {
      parts
        .box("darkMetal", 0.45, 0.04, CELL_SIZE, -1.4, WALL_HEIGHT - 0.3, 0)
        .box("rust", 0.35, 0.06, CELL_SIZE, -1.4, WALL_HEIGHT - 0.26, 0);
    }
  }
  for (const [m, geos] of parts.byMat) {
    if (geos.length === 0) continue;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mats[m as MatKey]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
  }
  for (const s of plan.signs) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.52),
      new THREE.MeshStandardMaterial({ map: signTexture(s.lines), roughness: 0.8 })
    );
    sign.position.set(s.x, 2.15, s.z);
    sign.rotation.y = s.rot;
    scene.add(sign);
  }
}
