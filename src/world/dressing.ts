import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CELL_SIZE, WALL_HEIGHT, cellCenter } from "./grid";
import type { ParsedLevel } from "./levelParser";
import { hash, mulberry32, shuffle } from "./reinforcements";
import { buildScene, planScenes, storyTexture, storyTextureOnWall, type ScenePlacement } from "./storyScenes";

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
  | "body"
  // A tall locker you can climb into and hide in (see `HIDE_SPOTS`).
  | "hideLocker"
  // Rooms, by what they were for.
  | "curtain"
  | "medCabinet"
  | "wheelchair"
  | "trolley"
  | "opTable"
  | "morgueDrawers"
  | "labBench"
  | "fumeHood"
  | "restraintChair"
  | "centrifuge"
  | "cage"
  | "gasBottles"
  | "drums"
  | "pump"
  | "vessel"
  | "switchboard"
  | "transformer"
  | "ammoBoxes"
  | "sandbags"
  | "pod"
  | "winch"
  // On the walls.
  | "extinguisher"
  | "junction"
  | "poster"
  | "clock"
  | "chalkboard"
  | "gauges"
  | "icicles"
  | "scrawl"
  // On the floor, and across the way.
  | "papers"
  | "stain"
  | "frost"
  | "strips"
  | "sinew";

export interface PropPlacement {
  kind: PropKind;
  /** World position of the prop's base centre. */
  x: number;
  z: number;
  /** Rotation about Y: the prop's front faces away from the wall it stands against. */
  rot: number;
  /** Which poster or scrawl, for the ones that come in several. */
  variant?: number;
}

export interface SignPlacement {
  lines: [string, string];
  x: number;
  z: number;
  rot: number;
}

/** Directions, as bits: +X, -X, +Z, -Z. */
export const EAST = 1;
export const WEST = 2;
export const SOUTH = 4;
export const NORTH = 8;
const DIRS = [
  [1, 0, EAST],
  [-1, 0, WEST],
  [0, 1, SOUTH],
  [0, -1, NORTH],
] as const;

/**
 * One corridor cell of the service runs (pipes, ducts and cable trays under
 * the ceiling). `links` are the sides it continues through to the next
 * corridor cell; `rises` are the sides where it meets a room, and the
 * pipes turn up into the ceiling there.
 */
export interface CorridorRun {
  x: number;
  z: number;
  links: number;
  rises: number;
}

export interface DressingPlan {
  props: PropPlacement[];
  signs: SignPlacement[];
  runs: CorridorRun[];
  /** The story told where it happened (see `storyScenes.ts`). */
  scenes: ScenePlacement[];
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
  ward: ["bed", "bed", "curtain", "ivStand", "medCabinet", "bed", "wheelchair", "cabinet"],
  surgery: ["opTable", "trolley", "ivStand", "medCabinet", "shelf", "cabinet"],
  morgue: ["morgueDrawers", "trolley", "morgueDrawers", "bed"],
  stores: ["shelf", "crates", "shelf", "crates", "drums"],
  workshop: ["bench", "toolRack", "gasBottles", "drums", "shelf", "bench"],
  lockers: ["locker", "locker", "bench"],
  dorm: ["bunk", "bunk", "locker", "desk"],
  freezer: ["freezer", "hooks", "crates", "hooks", "shelf"],
  butchery: ["hooks", "bench", "hooks", "trolley"],
  office: ["desk", "cabinet", "shelf", "desk"],
  pumps: ["pump", "valve", "vessel", "pipesUp", "pump"],
  lab: ["labBench", "fumeHood", "tank", "labBench", "centrifuge", "cage", "tank", "restraintChair"],
  control: ["panel", "switchboard", "panel", "desk", "cabinet"],
  armory: ["gunRack", "locker", "gunRack", "ammoBoxes", "sandbags"],
  overgrown: ["growth", "growth", "body", "pod", "growth"],
};

/** Lockers to hide in, per level. */
const HIDE_SPOTS = 5;

/** Only one of these to a level: there was one chair, and one table. */
const UNIQUE: ReadonlySet<PropKind> = new Set(["restraintChair", "opTable"]);

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
  hideLocker: 0.62,
  curtain: 2.0,
  medCabinet: 0.32,
  wheelchair: 0.75,
  trolley: 0.55,
  opTable: 1.9,
  morgueDrawers: 0.75,
  labBench: 0.8,
  fumeHood: 0.85,
  restraintChair: 0.9,
  centrifuge: 0.6,
  cage: 1.05,
  gasBottles: 0.3,
  drums: 0.65,
  pump: 1.0,
  vessel: 1.1,
  switchboard: 0.42,
  transformer: 1.1,
  ammoBoxes: 0.62,
  sandbags: 0.7,
  pod: 1.0,
  winch: 1.0,
  extinguisher: 0.22,
  junction: 0.16,
  poster: 0.03,
  clock: 0.08,
  chalkboard: 0.08,
  gauges: 0.2,
  icicles: 0.2,
  scrawl: 0.02,
  papers: 0,
  stain: 0,
  frost: 0,
  strips: 0,
  sinew: 0,
};

/** One pipe in a level's bundle: its radius and what it's made of (or painted). */
interface PipeSpec {
  r: number;
  mat: MatKey;
}

/**
 * A level's services and small things: which pipes run along its corridors
 * (painted to the Soviet code: green water, red steam, blue air, yellow
 * gas; lagged where they carry heat or cold), whether cable trays run the
 * other side, and what hangs on its walls and lies on its floors.
 */
interface LevelStyle {
  pipes: PipeSpec[];
  tray: boolean;
  /** Square ventilation ducts instead of pipes. */
  ducts?: boolean;
  /** Frosted pipes, icicles. */
  frost?: boolean;
  /** Growths along the pipes. */
  growth?: boolean;
  /** Hung on walls with nothing against them. */
  wall: PropKind[];
  /** Lying about on floors. */
  floor: PropKind[];
  /** Which posters (see `POSTERS`) and scrawls (see `SCRAWLS`) this level has. */
  posters: number[];
  /** Also found in its rooms, whatever they are. */
  extra: PropKind[];
}

const STYLES: Record<string, LevelStyle> = {
  infirmary: {
    pipes: [
      { r: 0.1, mat: "lagging" },
      { r: 0.06, mat: "paintGreen" },
    ],
    tray: true,
    wall: ["poster", "extinguisher", "clock", "junction", "poster"],
    floor: ["papers", "stain"],
    posters: [0, 1, 4],
    extra: [],
  },
  "maintenance-wing": {
    pipes: [
      { r: 0.11, mat: "rust" },
      { r: 0.07, mat: "paintGreen" },
      { r: 0.06, mat: "paintRed" },
    ],
    tray: true,
    wall: ["extinguisher", "junction", "poster", "gauges"],
    floor: ["stain", "papers"],
    posters: [0, 1, 2],
    extra: ["drums", "gasBottles"],
  },
  "cold-storage": {
    pipes: [
      { r: 0.13, mat: "lagging" },
      { r: 0.09, mat: "lagging" },
      { r: 0.05, mat: "metal" },
    ],
    tray: false,
    frost: true,
    wall: ["icicles", "junction", "extinguisher", "gauges", "icicles"],
    floor: ["frost", "frost", "stain"],
    posters: [0, 1],
    extra: [],
  },
  "pumping-station": {
    pipes: [
      { r: 0.22, mat: "rust" },
      { r: 0.14, mat: "paintGreen" },
      { r: 0.07, mat: "paintBlue" },
    ],
    tray: false,
    wall: ["gauges", "junction", "extinguisher", "poster"],
    floor: ["stain"],
    posters: [0, 1, 2],
    extra: ["pump"],
  },
  "containment-labs": {
    pipes: [
      { r: 0.06, mat: "chrome" },
      { r: 0.05, mat: "chrome" },
      { r: 0.08, mat: "paintBlue" },
    ],
    tray: true,
    wall: ["poster", "chalkboard", "clock", "extinguisher", "junction"],
    floor: ["papers", "papers", "stain"],
    posters: [2, 3],
    extra: [],
  },
  ventilation: {
    pipes: [],
    ducts: true,
    tray: false,
    wall: ["junction", "scrawl"],
    floor: ["stain"],
    posters: [0],
    extra: [],
  },
  "power-plant": {
    pipes: [
      { r: 0.1, mat: "paintRed" },
      { r: 0.08, mat: "lagging" },
    ],
    tray: true,
    wall: ["junction", "gauges", "poster", "extinguisher", "scrawl"],
    floor: ["stain", "papers"],
    posters: [0, 1, 2],
    extra: ["transformer"],
  },
  armory: {
    pipes: [
      { r: 0.08, mat: "paintGreen" },
      { r: 0.06, mat: "rust" },
    ],
    tray: true,
    wall: ["poster", "extinguisher", "scrawl", "junction"],
    floor: ["papers", "stain"],
    posters: [2, 3],
    extra: ["sandbags", "ammoBoxes"],
  },
  hive: {
    pipes: [
      { r: 0.1, mat: "rust" },
      { r: 0.07, mat: "rust" },
    ],
    tray: false,
    growth: true,
    wall: ["scrawl"],
    floor: ["stain", "stain"],
    posters: [1, 2],
    extra: ["pod"],
  },
  "lift-shaft": {
    pipes: [
      { r: 0.09, mat: "rust" },
      { r: 0.06, mat: "paintYellow" },
    ],
    tray: true,
    wall: ["junction", "poster", "scrawl", "extinguisher"],
    floor: ["stain"],
    posters: [1, 2],
    extra: ["winch", "drums"],
  },
};

const DEFAULT_STYLE: LevelStyle = STYLES["maintenance-wing"];

export function styleFor(levelId: string): LevelStyle {
  return STYLES[levelId] ?? DEFAULT_STYLE;
}

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
  const style = styleFor(level.def.id);
  const map = level.def.map;
  const ch = (col: number, row: number) => map[row]?.[col] ?? "#";
  const open = (col: number, row: number) => !level.solid[row]?.[col] && ch(col, row) !== "#";
  const plain = (col: number, row: number) => PLAIN.has(ch(col, row)) || /[a-z]/.test(ch(col, row));
  const key = (c: number, r: number) => r * level.cols + c;
  /** Services run through open floor and doorways, never through a hidden panel or a machine. */
  const serviced = (c: number, r: number) => open(c, r) || ch(c, r) === "D" || ch(c, r) === "=";

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
  const roomCells = new Set(rooms.flat());

  // The story scenes first: their cells are left to them.
  const story = planScenes(level, { ch, plain: (c, r) => open(c, r) && plain(c, r), rooms });
  const sceneCells = story.cells;
  const plan: DressingPlan = { props: [], signs: [], runs: [], scenes: story.scenes };
  const dressing = LEVEL_DRESSING[level.def.id] ?? { rooms: ["stores"], names: [["", ""]] };
  const itemsNear = [...level.spawns.items.map((i) => i.pos), ...level.spawns.notes.map((n) => n.pos)];
  const clearOfItems = (x: number, z: number, d: number) => !itemsNear.some((p) => Math.hypot(p.x - x, p.y - z) < d);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  /** Something hung on the wall of cell (c, r) on side (dc, dr), slid a little along it. */
  const onWall = (kind: PropKind, c: number, r: number, dc: number, dr: number) => {
    const centre = cellCenter(c, r);
    const inset = CELL_SIZE / 2 - DEPTH[kind] / 2 - 0.04;
    const slide = (rand() - 0.5) * (CELL_SIZE - 1.6);
    const variant =
      kind === "poster"
        ? pick(style.posters.length ? style.posters : [0])
        : kind === "scrawl"
          ? Math.floor(rand() * SCRAWLS.length)
          : undefined;
    plan.props.push({
      kind,
      x: centre.x + dc * inset + (dr !== 0 ? slide : 0),
      z: centre.y + dr * inset + (dc !== 0 ? slide : 0),
      rot: Math.atan2(dc, dr),
      ...(variant === undefined ? {} : { variant }),
    });
  };

  // Wall slots (cell:side) that already have something against them.
  const taken = new Set<string>();
  rooms.forEach((cells, i) => {
    const kind = dressing.rooms[i % dressing.rooms.length];
    const pool = ROOM_PROPS[kind];
    const name = dressing.names[i % dressing.names.length];
    let signed = false;
    for (const k of cells) {
      const c = k % level.cols;
      const r = Math.floor(k / level.cols);
      if (!plain(c, r) || sceneCells.has(k)) continue;
      const centre = cellCenter(c, r);
      for (const [dc, dr] of SIDES) {
        // A freezer's doorways are hung with plastic strips against the cold.
        if (kind === "freezer" && open(c + dc, r + dr) && !inRoom.has(key(c + dc, r + dr)))
          plan.props.push({
            kind: "strips",
            x: centre.x + dc * (CELL_SIZE / 2 - 0.08),
            z: centre.y + dr * (CELL_SIZE / 2 - 0.08),
            rot: Math.atan2(dc, dr),
          });
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
        if (rand() > 0.62) {
          // Bare wall: something hung on it, sometimes.
          if (rand() < 0.45) onWall(kind === "freezer" && rand() < 0.6 ? "icicles" : pick(style.wall), c, r, dc, dr);
          continue;
        }
        // Now and then something this level has everywhere (a pump, sandbags), whatever the room.
        let prop = style.extra.length && rand() < 0.15 ? pick(style.extra) : pick(pool);
        if (UNIQUE.has(prop) && plan.props.some((q) => q.kind === prop)) prop = pick(pool.filter((k) => !UNIQUE.has(k)));
        const inset = CELL_SIZE / 2 - DEPTH[prop] / 2 - 0.04;
        // Slide along the wall a little so rows of props don't line up like a grid.
        const slide = (rand() - 0.5) * (CELL_SIZE - 2.2);
        const x = centre.x + dc * inset + (dr !== 0 ? slide : 0);
        const z = centre.y + dr * inset + (dc !== 0 ? slide : 0);
        // Keep clear of pickups, so nothing hides inside a bed.
        // (and of the table under every note), however far the prop reaches into the room.
        const reach = Math.max(1.1, DEPTH[prop] / 2 + 0.7);
        if (itemsNear.some((p) => Math.hypot(p.x - x, p.y - z) < reach || Math.hypot(p.x + 0.6 - x, p.y - 0.4 - z) < reach)) continue;
        plan.props.push({ kind: prop, x, z, rot });
        taken.add(`${k}:${dc},${dr}`);
      }
      // Whatever was left lying on the floor.
      if (rand() < 0.3) {
        const floor = kind === "freezer" && style.frost ? "frost" : pick(style.floor);
        const x = centre.x + (rand() - 0.5) * 2;
        const z = centre.y + (rand() - 0.5) * 2;
        if (clearOfItems(x, z, 0.9)) plan.props.push({ kind: floor, x, z, rot: rand() * Math.PI * 2 });
      }
    }
  });

  // Corridors: the station's services under the ceiling (see `CorridorRun`),
  // the odd thing on the walls, and the mess on the floor.
  for (let r = 0; r < level.rows; r++)
    for (let c = 0; c < level.cols; c++) {
      if (!serviced(c, r) || roomCells.has(key(c, r))) continue;
      let links = 0;
      let rises = 0;
      for (const [dc, dr, bit] of DIRS) {
        if (!serviced(c + dc, r + dr)) continue;
        if (roomCells.has(key(c + dc, r + dr))) rises |= bit;
        else links |= bit;
      }
      const centre = cellCenter(c, r);
      if (links || rises) plan.runs.push({ x: centre.x, z: centre.y, links, rises });
      if (!open(c, r) || !plain(c, r) || sceneCells.has(key(c, r))) continue;
      for (const [dc, dr] of SIDES) {
        if (ch(c + dc, r + dr) !== "#") continue;
        if (rand() < 0.14) onWall(pick(style.wall), c, r, dc, dr);
      }
      // A dead end is where things get pushed out of the way.
      const walls = SIDES.filter(([dc, dr]) => ch(c + dc, r + dr) === "#");
      if (walls.length === 3 && rand() < 0.6 && clearOfItems(centre.x, centre.y, 1.6)) {
        const back = SIDES.find(([dc, dr]) => ch(c + dc, r + dr) === "#" && ch(c - dc, r - dr) !== "#")!;
        const prop = pick(["crates", "drums", "shelf", ...style.extra] as PropKind[]);
        const inset = CELL_SIZE / 2 - DEPTH[prop] / 2 - 0.04;
        plan.props.push({ kind: prop, x: centre.x + back[0] * inset, z: centre.y + back[1] * inset, rot: Math.atan2(back[0], back[1]) });
      }
      if (rand() < (style.frost ? 0.4 : 0.14)) {
        const x = centre.x + (rand() - 0.5) * 2.4;
        const z = centre.y + (rand() - 0.5) * 2.4;
        if (clearOfItems(x, z, 0.8)) plan.props.push({ kind: pick(style.floor), x, z, rot: rand() * Math.PI * 2 });
      }
      // In the hive, strands of something stretch from wall to wall.
      if (style.growth && rand() < 0.2) {
        const alongX = open(c - 1, r) || open(c + 1, r);
        plan.props.push({ kind: "sinew", x: centre.x, z: centre.y, rot: alongX ? 0 : Math.PI / 2 });
      }
    }

  // Lockers to hide in: a few to every level, spread out, against bare walls
  // in rooms (or corridors, if the rooms run out), never by a pickup.
  const slots: { c: number; r: number; dc: number; dr: number; room: boolean }[] = [];
  for (const [list, inRooms] of [
    [rooms.flat(), true],
    [[...Array(level.rows * level.cols).keys()].filter((k) => !roomCells.has(k)), false],
  ] as const)
    for (const k of list) {
      const c = k % level.cols;
      const r = Math.floor(k / level.cols);
      if (!open(c, r) || !plain(c, r) || sceneCells.has(k)) continue;
      for (const [dc, dr] of SIDES) {
        if (ch(c + dc, r + dr) !== "#" || taken.has(`${k}:${dc},${dr}`)) continue;
        // In a corridor, only where it's wide enough not to block it: against the end of a dead end, or a side wall with the way open opposite.
        if (!inRooms && ch(c - dc, r - dr) === "#") continue;
        slots.push({ c, r, dc, dr, room: inRooms });
      }
    }
  shuffle(slots, rand);
  const hides: THREE.Vector2[] = [];
  for (const pass of [0, 1])
    for (const s of slots) {
      if (hides.length >= HIDE_SPOTS) break;
      const centre = cellCenter(s.c, s.r);
      const inset = CELL_SIZE / 2 - DEPTH.hideLocker / 2 - 0.04;
      const at = new THREE.Vector2(centre.x + s.dc * inset, centre.y + s.dr * inset);
      if (hides.some((h) => h.distanceTo(at) < (pass === 0 ? 14 : 7))) continue;
      if (!clearOfItems(at.x, at.y, 1.4) || at.distanceTo(level.spawns.playerStart) < 4) continue;
      // Rooms first, well spread; then anywhere, closer together, to make up the number.
      if (pass === 0 && !s.room) continue;
      hides.push(at);
      plan.props.push({ kind: "hideLocker", x: at.x, z: at.y, rot: Math.atan2(s.dc, s.dr) });
    }

  // Every note lies on something: a small table where somebody left it.
  for (const n of level.spawns.notes) plan.props.push({ kind: "noteTable", x: n.pos.x + 0.6, z: n.pos.y - 0.4, rot: rand() * Math.PI });

  // The dead, under tarps: a couple per level, in quiet corners away from the start.
  const quiet: THREE.Vector2[] = [];
  for (let r = 0; r < level.rows; r++)
    for (let c = 0; c < level.cols; c++) {
      if (!open(c, r) || !plain(c, r) || sceneCells.has(key(c, r))) continue;
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

export type MatKey =
  | "metal"
  | "darkMetal"
  | "rust"
  | "wood"
  | "cloth"
  | "tarp"
  | "enamel"
  | "glass"
  | "panelLight"
  | "flesh"
  | "paper"
  | "chrome"
  | "paintGreen"
  | "paintRed"
  | "paintBlue"
  | "paintYellow"
  | "olive"
  | "lagging"
  | "frost"
  | "ice"
  | "liquid"
  | "strip"
  | "curtain"
  | "rubber"
  | "brass"
  | "sandbag"
  | "stain"
  | "dial"
  | "orange"
  | "blood";

function materials(): Record<MatKey, THREE.MeshStandardMaterial> {
  const std = (color: number, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return {
    metal: std(0x6a6f70, 0.55, 0.6),
    darkMetal: std(0x2c3032, 0.6, 0.5),
    rust: std(0x5a3a26, 0.85, 0.3),
    wood: std(0x4a3626, 0.9),
    cloth: std(0x8a8676, 0.95),
    tarp: std(0x28382f, 0.8),
    enamel: std(0xb8bcb4, 0.45, 0.1),
    glass: std(0x2a3a30, 0.15, 0.1, { emissive: 0x06120a, transparent: true, opacity: 0.8 }),
    panelLight: std(0x1a2a1a, 0.5, 0, { emissive: 0x2a8a3a, emissiveIntensity: 0.6 }),
    flesh: std(0x2e2220, 0.5),
    paper: std(0x9a9480, 0.95),
    chrome: std(0x9aa2a6, 0.3, 0.85),
    // Pipe paint, faded and grimy: green water, red steam, blue air, yellow gas.
    paintGreen: std(0x3a5238, 0.7, 0.2),
    paintRed: std(0x6a2820, 0.7, 0.2),
    paintBlue: std(0x2e4456, 0.7, 0.2),
    paintYellow: std(0x8a7026, 0.7, 0.2),
    olive: std(0x3a4028, 0.8, 0.1),
    // Insulation wrapped round hot and cold pipes.
    lagging: std(0x9c978a, 0.95),
    frost: std(0xc4d2da, 0.9, 0, { emissive: 0x0a1014 }),
    ice: std(0xaccad8, 0.1, 0.1, { transparent: true, opacity: 0.75, emissive: 0x08141c }),
    liquid: std(0x2a4a2a, 0.2, 0, { emissive: 0x0a2410, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 }),
    strip: std(0x8aa29a, 0.3, 0, { transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    curtain: std(0x5e7a6a, 0.95, 0, { side: THREE.DoubleSide }),
    rubber: std(0x151515, 0.85),
    brass: std(0x7a6a3a, 0.4, 0.7),
    sandbag: std(0x6a6048, 1),
    stain: std(0x120c0a, 0.35, 0, { polygonOffset: true, polygonOffsetFactor: -2 }),
    // A radio's dial, still lit: dim, so it's found by looking, not seen across the room.
    dial: std(0x3a2a10, 0.4, 0, { emissive: 0xc88a2a, emissiveIntensity: 0.45 }),
    // Consortium kit: the one bright thing down here.
    orange: std(0xb8601a, 0.6, 0.1),
    blood: std(0x2a0806, 0.3),
  };
}

/** Collects boxes and cylinders by material, to merge into one mesh each. */
export class Parts {
  readonly byMat = new Map<MatKey, THREE.BufferGeometry[]>();
  /** Textured planes (posters, scrawls, chalkboards), by texture. */
  readonly byTex = new Map<string, THREE.BufferGeometry[]>();
  private readonly base = new THREE.Matrix4();

  at(x: number, z: number, rot: number): this {
    this.base.makeRotationY(rot).setPosition(x, 0, z);
    return this;
  }

  /** A box of size w×h×d whose centre is at local (x, y, z). Local -Z is the prop's front. */
  box(m: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, rz = 0, ry = 0): this {
    this.add(m, new THREE.BoxGeometry(w, h, d), x, y, z, rx, rz, ry);
    return this;
  }

  blob(m: MatKey, r: number, x: number, y: number, z: number): this {
    this.add(m, new THREE.SphereGeometry(r, 8, 6), x, y, z, 0, 0);
    return this;
  }

  cyl(m: MatKey, r: number, h: number, x: number, y: number, z: number, rx = 0, rz = 0, seg = 8, ry = 0): this {
    this.add(m, new THREE.CylinderGeometry(r, r, h, seg), x, y, z, rx, rz, ry);
    return this;
  }

  /** The top half of a sphere, sitting on y (a hard hat). */
  dome(m: MatKey, r: number, x: number, y: number, z: number): this {
    this.add(m, new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), x, y, z, 0, 0);
    return this;
  }

  /** A cone hanging point down (an icicle), its base at y. */
  icicle(m: MatKey, r: number, h: number, x: number, y: number, z: number): this {
    this.add(m, new THREE.ConeGeometry(r, h, 5), x, y - h / 2, z, Math.PI, 0);
    return this;
  }

  /** A ring standing upright, facing local Z (a handwheel, a wheel turned by `ry`). */
  ring(m: MatKey, r: number, tube: number, x: number, y: number, z: number, rx = 0, ry = 0): this {
    this.add(m, new THREE.TorusGeometry(r, tube, 5, 14), x, y, z, rx, 0, ry);
    return this;
  }

  /** A textured plane on the wall, facing out (local -Z). */
  plane(tex: string, w: number, h: number, x: number, y: number, z: number, rz = 0): this {
    const g = new THREE.PlaneGeometry(w, h);
    g.applyMatrix4(
      new THREE.Matrix4().multiplyMatrices(
        this.base,
        new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, Math.PI, rz)).setPosition(x, y, z)
      )
    );
    let list = this.byTex.get(tex);
    if (!list) this.byTex.set(tex, (list = []));
    list.push(g);
    return this;
  }

  private add(m: MatKey, g: THREE.BufferGeometry, x: number, y: number, z: number, rx: number, rz: number, ry = 0): void {
    const local = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")).setPosition(x, y, z);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(this.base, local));
    // Merging needs matching attributes: drop what the others may not have.
    g.deleteAttribute("uv");
    let list = this.byMat.get(m);
    if (!list) this.byMat.set(m, (list = []));
    list.push(g);
  }
}

/** Front is local -Z, the back against the wall at local +Z. */
function buildProp(p: Parts, kind: PropKind, rand: () => number, variant = 0): void {
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
    case "hideLocker":
      // A tall steel locker with a slatted door: big enough to climb into.
      p.box("metal", 0.72, 2.05, 0.58, 0, 1.025, 0).box("darkMetal", 0.66, 1.95, 0.02, 0, 1.02, -0.3);
      for (let i = 0; i < 6; i++) p.box("rubber", 0.42, 0.025, 0.012, 0, 1.45 + i * 0.07, -0.312);
      for (let i = 0; i < 3; i++) p.box("rubber", 0.42, 0.025, 0.012, 0, 0.25 + i * 0.07, -0.312);
      p.box("metal", 0.03, 0.18, 0.04, 0.26, 1.05, -0.33).box("paper", 0.14, 0.06, 0.005, 0, 1.85, -0.313);
      // A scrape on the floor in front where the door has swung a hundred times.
      p.cyl("stain", 0.35, 0.004, 0, 0.004, -0.55, 0, 0, 8);
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
    case "curtain": {
      // A cubicle curtain on a ceiling rail, running out from the wall, half drawn.
      p.box("metal", 0.04, 0.04, 2.0, 0, 2.45, 0);
      for (let i = 0; i < 3; i++) p.cyl("metal", 0.01, WALL_HEIGHT - 2.45, 0, (WALL_HEIGHT + 2.45) / 2, -0.9 + i * 0.9);
      const n = 5 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++)
        p.box("curtain", 0.02, 2.05, 0.24, (i % 2) * 0.12 - 0.06, 1.4, 0.88 - i * 0.17, 0, 0, i % 2 ? 0.75 : -0.75);
      break;
    }
    case "medCabinet":
      // A glass-fronted wall cabinet, bottles on its shelves.
      p.box("enamel", 0.8, 0.9, 0.3, 0, 1.55, 0).box("glass", 0.72, 0.8, 0.02, 0, 1.55, -0.16);
      for (const y of [1.3, 1.6]) {
        p.box("enamel", 0.74, 0.02, 0.26, 0, y - 0.1, 0);
        for (let i = 0; i < 5; i++)
          if (rand() < 0.6) p.cyl(rand() < 0.5 ? "glass" : "paper", 0.03, 0.12 + rand() * 0.08, -0.28 + i * 0.14, y - 0.02, 0);
      }
      break;
    case "wheelchair":
      p.box("rubber", 0.5, 0.06, 0.45, 0, 0.5, 0).box("rubber", 0.5, 0.5, 0.05, 0, 0.8, 0.22, -0.15);
      for (const x of [-0.29, 0.29]) {
        p.ring("metal", 0.3, 0.02, x, 0.32, 0.1, 0, Math.PI / 2).ring("metal", 0.06, 0.015, x * 0.8, 0.07, -0.25, 0, Math.PI / 2);
        p.box("metal", 0.03, 0.03, 0.5, x * 0.9, 0.68, 0, 0);
      }
      break;
    case "trolley":
      for (const y of [0.3, 0.85]) p.box("chrome", 0.9, 0.03, 0.5, 0, y, 0);
      for (const [x, z] of [
        [-0.42, -0.22],
        [0.42, -0.22],
        [-0.42, 0.22],
        [0.42, 0.22],
      ])
        p.cyl("chrome", 0.015, 0.85, x, 0.45, z);
      p.box("chrome", 0.4, 0.03, 0.3, -0.15, 0.88, 0).box("darkMetal", 0.05, 0.01, 0.2, 0.2, 0.87, 0.05);
      if (rand() < 0.5) p.cyl("glass", 0.05, 0.2, 0.3, 0.97, -0.1);
      break;
    case "opTable":
      // An operating table out from the wall, the big lamp over it.
      p.cyl("darkMetal", 0.12, 0.8, 0, 0.4, 0).box("darkMetal", 0.5, 0.06, 0.6, 0, 0.03, 0);
      p.box("enamel", 0.6, 0.08, 1.9, 0, 0.84, 0).box("rubber", 0.56, 0.05, 1.8, 0, 0.9, 0);
      p.cyl("metal", 0.03, 0.8, 0, WALL_HEIGHT - 0.4, 0).cyl("enamel", 0.38, 0.14, 0, WALL_HEIGHT - 0.85, 0, 0, 0, 14);
      p.cyl("glass", 0.3, 0.02, 0, WALL_HEIGHT - 0.93, 0, 0, 0, 14);
      if (rand() < 0.6) p.box("tarp", 0.62, 0.03, 1.1, 0.03, 0.94, 0.3, 0, 0.06);
      break;
    case "morgueDrawers":
      // A wall of body drawers, one pulled out.
      p.box("chrome", 2.1, 1.9, 0.7, 0, 0.95, 0);
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
          const x = (col - 1) * 0.68;
          const y = 0.35 + row * 0.6;
          p.box("metal", 0.6, 0.52, 0.02, x, y, -0.36).box("darkMetal", 0.2, 0.03, 0.04, x, y + 0.12, -0.39);
        }
      if (rand() < 0.7)
        p.box("chrome", 0.58, 0.08, 1.3, 0.68 * (Math.floor(rand() * 3) - 1), 0.3, -0.95).box("tarp", 0.5, 0.18, 1.2, 0, 0.42, -0.95);
      break;
    case "labBench": {
      // A lab bench: cupboards, a worktop, a reagent shelf, glassware.
      p.box("enamel", 2.0, 0.84, 0.72, 0, 0.42, 0).box("darkMetal", 2.04, 0.05, 0.78, 0, 0.87, 0);
      p.box("darkMetal", 2.0, 0.03, 0.25, 0, 1.4, 0.24)
        .cyl("metal", 0.015, 0.55, -0.95, 1.15, 0.3)
        .cyl("metal", 0.015, 0.55, 0.95, 1.15, 0.3);
      for (let i = 0; i < 8; i++)
        if (rand() < 0.7) p.cyl(rand() < 0.4 ? "paper" : "glass", 0.035, 0.14 + rand() * 0.06, -0.85 + i * 0.24, 1.49, 0.24);
      for (let i = 0; i < 5; i++) {
        const x = -0.8 + rand() * 1.6;
        const z = -0.2 + rand() * 0.3;
        const r = 0.04 + rand() * 0.04;
        const h = 0.1 + rand() * 0.12;
        p.cyl("glass", r, h, x, 0.9 + h / 2, z);
        if (rand() < 0.5) p.cyl("liquid", r * 0.85, h * 0.5, x, 0.9 + h * 0.25, z);
      }
      // A microscope.
      p.box("darkMetal", 0.16, 0.04, 0.2, 0.55, 0.92, -0.05)
        .box("darkMetal", 0.05, 0.3, 0.05, 0.55, 1.06, 0.03)
        .cyl("darkMetal", 0.03, 0.18, 0.55, 1.12, -0.04, 0.5);
      break;
    }
    case "fumeHood":
      p.box("enamel", 1.4, 0.9, 0.85, 0, 0.45, 0).box("enamel", 1.4, 1.3, 0.12, 0, 1.55, 0.36);
      p.box("enamel", 0.1, 1.3, 0.85, -0.65, 1.55, 0)
        .box("enamel", 0.1, 1.3, 0.85, 0.65, 1.55, 0)
        .box("enamel", 1.4, 0.25, 0.85, 0, 2.3, 0);
      p.box("glass", 1.2, 0.6, 0.02, 0, 1.75, -0.4).box("darkMetal", 1.2, 0.04, 0.04, 0, 1.43, -0.4);
      p.cyl("metal", 0.14, WALL_HEIGHT - 2.42, 0, (WALL_HEIGHT + 2.42) / 2, 0.1);
      for (let i = 0; i < 3; i++) if (rand() < 0.7) p.cyl("glass", 0.05, 0.2, -0.4 + i * 0.4, 1.0, 0);
      break;
    case "restraintChair":
      // Where they sat R-7. Straps at the wrists and ankles, a drain in the floor.
      p.box("metal", 0.6, 0.08, 0.6, 0, 0.5, 0).box("rubber", 0.56, 0.06, 0.56, 0, 0.56, 0);
      p.box("metal", 0.6, 1.0, 0.08, 0, 1.05, 0.28, -0.12).box("rubber", 0.5, 0.9, 0.04, 0, 1.05, 0.23, -0.12);
      p.box("metal", 0.3, 0.3, 0.06, 0, 1.68, 0.36, -0.12);
      for (const x of [-0.34, 0.34]) {
        p.box("metal", 0.08, 0.05, 0.55, x, 0.8, 0).cyl("metal", 0.025, 0.3, x, 0.65, -0.2);
        p.box("rust", 0.1, 0.06, 0.1, x, 0.84, -0.1).box("rust", 0.1, 0.1, 0.08, x * 0.5, 0.2, -0.28);
      }
      for (const [x, z] of [
        [-0.25, -0.25],
        [0.25, -0.25],
        [-0.25, 0.25],
        [0.25, 0.25],
      ])
        p.cyl("metal", 0.03, 0.5, x, 0.25, z);
      p.cyl("rubber", 0.18, 0.01, 0, 0.005, -0.7, 0, 0, 12);
      break;
    case "centrifuge":
      p.box("enamel", 0.6, 0.85, 0.55, 0, 0.42, 0)
        .cyl("metal", 0.24, 0.05, 0, 0.87, 0, 0, 0, 14)
        .box("panelLight", 0.1, 0.04, 0.01, 0.15, 0.7, -0.28);
      break;
    case "cage": {
      // A cage for test animals, or something bigger.
      const w = 1.2;
      const h = 1.3;
      for (const [x, z] of [
        [-w / 2, -0.5],
        [w / 2, -0.5],
        [-w / 2, 0.5],
        [w / 2, 0.5],
      ])
        p.box("darkMetal", 0.04, h, 0.04, x, h / 2, z);
      p.box("darkMetal", w, 0.04, 1.0, 0, h, 0).box("darkMetal", w, 0.04, 1.0, 0, 0.02, 0);
      for (let i = 1; i < 10; i++) p.cyl("metal", 0.008, h, -w / 2 + (i * w) / 10, h / 2, -0.5);
      for (let i = 1; i < 8; i++) {
        p.cyl("metal", 0.008, h, -w / 2, h / 2, -0.5 + i / 8);
        p.cyl("metal", 0.008, h, w / 2, h / 2, -0.5 + i / 8);
      }
      if (rand() < 0.4) p.cyl("metal", 0.008, h, -0.2, h / 2 + 0.1, -0.6, 0.5, 0.3); // a bent bar
      if (rand() < 0.5) p.blob("flesh", 0.25, 0.1, 0.2, 0.1);
      break;
    }
    case "gasBottles": {
      // Welding gas: blue oxygen, white acetylene, red propane, chained to the wall.
      const paints: MatKey[] = ["paintBlue", "enamel", "paintRed", "paintBlue"];
      const n = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 0.26;
        p.cyl(paints[i % paints.length], 0.11, 1.35, x, 0.68, 0, 0, 0, 10).blob(paints[i % paints.length], 0.11, x, 1.35, 0);
        p.cyl("brass", 0.03, 0.12, x, 1.5, 0);
      }
      p.box("darkMetal", n * 0.26 + 0.1, 0.03, 0.03, 0, 1.05, -0.12);
      break;
    }
    case "drums": {
      const paints: MatKey[] = ["paintBlue", "rust", "paintRed", "olive"];
      const n = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 0.62;
        const m = paints[Math.floor(rand() * paints.length)];
        p.cyl(m, 0.29, 0.88, x, 0.44, 0, 0, 0, 12);
        for (const y of [0.3, 0.6]) p.cyl(m, 0.3, 0.03, x, y, 0, 0, 0, 12);
        p.cyl("darkMetal", 0.28, 0.01, x, 0.885, 0, 0, 0, 12);
      }
      if (rand() < 0.4) p.cyl("rust", 0.29, 0.88, 0, 0.29, -0.7, 0, Math.PI / 2, 12); // one knocked over
      break;
    }
    case "pump":
      // A centrifugal pump and its motor on a skid, the riser going up into the ceiling.
      p.box("darkMetal", 1.8, 0.2, 0.8, 0, 0.1, 0);
      p.cyl("paintBlue", 0.36, 0.5, -0.45, 0.6, 0, 0, Math.PI / 2, 14).cyl("paintBlue", 0.42, 0.06, -0.45, 0.6, 0, 0, Math.PI / 2, 14);
      p.cyl("paintGreen", 0.3, 0.8, 0.4, 0.55, 0, 0, Math.PI / 2, 12).box("paintGreen", 0.7, 0.05, 0.5, 0.4, 0.26, 0);
      for (let i = 0; i < 6; i++) p.box("paintGreen", 0.7, 0.02, 0.02, 0.4, 0.55 + Math.sin(i) * 0.3, Math.cos(i) * 0.3);
      p.cyl("darkMetal", 0.08, 0.3, -0.07, 0.6, 0, 0, Math.PI / 2);
      p.cyl("rust", 0.14, WALL_HEIGHT - 0.95, -0.45, (WALL_HEIGHT + 0.95) / 2, 0, 0, 0, 10).cyl("rust", 0.2, 0.06, -0.45, 1.0, 0, 0, 0, 10);
      p.cyl("brass", 0.08, 0.03, -0.45, 1.35, -0.16, Math.PI / 2).cyl("enamel", 0.065, 0.032, -0.45, 1.35, -0.163, Math.PI / 2);
      p.ring("paintRed", 0.18, 0.02, -0.45, 1.7, -0.2);
      break;
    case "vessel":
      // A pressure vessel on legs, lagged, with its gauge and relief valve.
      p.cyl("lagging", 0.5, 1.8, 0, 1.3, 0, 0, 0, 14).blob("lagging", 0.5, 0, 2.2, 0).blob("lagging", 0.5, 0, 0.4, 0);
      for (const y of [0.7, 1.3, 1.9]) p.cyl("metal", 0.51, 0.04, 0, y, 0, 0, 0, 14);
      for (let i = 0; i < 3; i++) p.cyl("darkMetal", 0.04, 0.5, Math.sin(i * 2.1) * 0.4, 0.25, Math.cos(i * 2.1) * 0.4);
      p.cyl("brass", 0.09, 0.03, 0, 1.6, -0.52, Math.PI / 2).cyl("enamel", 0.075, 0.032, 0, 1.6, -0.523, Math.PI / 2);
      p.cyl("rust", 0.06, WALL_HEIGHT - 2.6, 0, (WALL_HEIGHT + 2.6) / 2, 0);
      break;
    case "switchboard":
      // A row of switch cabinets: gauges, knife switches, a few lamps still lit.
      p.box("darkMetal", 1.8, 2.0, 0.4, 0, 1.0, 0);
      for (let i = 0; i < 3; i++) {
        const x = -0.6 + i * 0.6;
        p.box("darkMetal", 0.02, 1.9, 0.02, x + 0.3, 1.0, -0.21);
        p.cyl("brass", 0.08, 0.03, x, 1.6, -0.21, Math.PI / 2).cyl("enamel", 0.065, 0.032, x, 1.6, -0.215, Math.PI / 2);
        p.box("rubber", 0.14, 0.2, 0.06, x, 1.2, -0.22).box(
          "metal",
          0.03,
          0.18,
          0.04,
          x,
          1.25 + (rand() < 0.5 ? 0.05 : -0.05),
          -0.26,
          rand() < 0.5 ? 0.6 : -0.6
        );
        if (rand() < 0.5) p.box("panelLight", 0.05, 0.05, 0.01, x - 0.15, 1.85, -0.21);
      }
      p.box("paintYellow", 1.8, 0.1, 0.01, 0, 0.3, -0.205);
      break;
    case "transformer":
      p.box("darkMetal", 1.2, 1.5, 0.9, 0, 0.75, 0);
      for (let i = 0; i < 7; i++) {
        p.box("darkMetal", 0.02, 1.2, 0.16, -0.66, 0.75, -0.36 + i * 0.12);
        p.box("darkMetal", 0.02, 1.2, 0.16, 0.66, 0.75, -0.36 + i * 0.12);
      }
      for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) p.cyl("enamel", 0.07 - k * 0.01, 0.1, -0.35 + i * 0.35, 1.56 + k * 0.1, 0);
      p.box("paintYellow", 0.4, 0.3, 0.01, 0, 1.0, -0.455);
      break;
    case "ammoBoxes": {
      const stacks = 2 + Math.floor(rand() * 2);
      for (let s2 = 0; s2 < stacks; s2++) {
        const x = (s2 - (stacks - 1) / 2) * 0.55;
        const h = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < h; i++)
          p.box("olive", 0.48, 0.26, 0.3, x + (rand() - 0.5) * 0.05, 0.13 + i * 0.27, 0, 0, 0, (rand() - 0.5) * 0.15);
        if (rand() < 0.4) p.box("olive", 0.48, 0.02, 0.3, x, 0.28 + h * 0.27, -0.12, -0.9); // lid open
      }
      break;
    }
    case "sandbags":
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < 3; i++)
          p.box("sandbag", 0.6, 0.18, 0.34, (i - 1) * 0.58 + (row % 2) * 0.29 - 0.15, 0.09 + row * 0.17, 0, 0, 0, (rand() - 0.5) * 0.2);
      break;
    case "pod":
      // A pod grown up the wall, sinew holding it.
      p.blob("flesh", 0.45, 0, 0.5, 0.1).blob("flesh", 0.32, 0.15, 0.95, 0.2).blob("flesh", 0.2, -0.25, 0.2, 0.2);
      p.cyl("flesh", 0.04, 1.8, 0.1, 1.8, 0.4, 0.3).cyl("flesh", 0.03, 1.5, -0.2, 1.6, 0.4, -0.3);
      break;
    case "winch":
      // The cable winch that used to drive the lift.
      p.box("darkMetal", 1.6, 0.25, 0.9, 0, 0.12, 0).cyl("rust", 0.38, 1.0, -0.15, 0.7, 0, 0, Math.PI / 2, 14);
      for (let i = 0; i < 9; i++) p.cyl("darkMetal", 0.4, 0.04, -0.6 + i * 0.11, 0.7, 0, 0, Math.PI / 2, 14);
      p.box("paintGreen", 0.45, 0.5, 0.5, 0.58, 0.5, 0).cyl("rust", 0.02, WALL_HEIGHT, -0.15, WALL_HEIGHT / 2 + 0.5, -0.3, 0.2);
      break;
    // ---------------------------------------- on the walls
    case "extinguisher":
      p.cyl("paintRed", 0.08, 0.5, 0, 0.6, 0, 0, 0, 10).blob("paintRed", 0.08, 0, 0.85, 0).box("darkMetal", 0.04, 0.12, 0.04, 0, 0.95, 0);
      p.cyl("rubber", 0.012, 0.35, 0.07, 0.75, -0.04, 0, 0.3).box("darkMetal", 0.2, 0.04, 0.05, 0, 0.8, 0.08);
      break;
    case "junction":
      p.box("darkMetal", 0.35, 0.45, 0.12, 0, 1.55, 0).cyl("darkMetal", 0.025, WALL_HEIGHT - 1.77, 0.08, (WALL_HEIGHT + 1.77) / 2, 0.02);
      p.box("paintYellow", 0.12, 0.1, 0.01, 0, 1.62, -0.065);
      if (rand() < 0.4) p.box("darkMetal", 0.33, 0.43, 0.02, -0.2, 1.55, -0.2, 0, 0, 1.0); // door hanging open
      break;
    case "poster":
      p.plane(`poster${variant}`, 0.62, 0.86, 0, 1.55, 0, (rand() - 0.5) * 0.06);
      break;
    case "scrawl":
      p.plane(`scrawl${variant}`, 1.8, 0.9, 0, 1.4 + rand() * 0.3, 0, (rand() - 0.5) * 0.1);
      break;
    case "chalkboard":
      p.box("wood", 1.9, 1.1, 0.04, 0, 1.55, 0.01).plane("chalk", 1.8, 1.0, 0, 1.55, -0.015).box("wood", 1.8, 0.04, 0.08, 0, 1.0, -0.04);
      break;
    case "clock":
      // Stopped, like every clock down here.
      p.cyl("enamel", 0.16, 0.05, 0, 2.45, 0, Math.PI / 2, 0, 16).cyl("darkMetal", 0.17, 0.04, 0, 2.45, 0.01, Math.PI / 2, 0, 16);
      p.box("darkMetal", 0.015, 0.1, 0.01, 0, 2.49, -0.03).box("darkMetal", 0.012, 0.13, 0.01, 0.04, 2.43, -0.03, 0, 2.2);
      break;
    case "gauges":
      // A section of pipe coming down the wall to a pair of gauges and a valve.
      p.cyl("rust", 0.05, WALL_HEIGHT - 1.1, 0, (WALL_HEIGHT + 1.1) / 2, 0).cyl("darkMetal", 0.08, 0.05, 0, 1.1, 0);
      for (const y of [1.45, 1.85])
        p.cyl("brass", 0.08, 0.03, 0.14, y, -0.02, Math.PI / 2).cyl("enamel", 0.066, 0.032, 0.14, y, -0.025, Math.PI / 2);
      p.ring("paintRed", 0.1, 0.015, 0, 1.25, -0.08);
      break;
    case "icicles":
      // Ice grown down from where the wall meets the ceiling.
      p.box("frost", 2.6, 0.12, 0.2, 0, WALL_HEIGHT - 0.06, 0);
      for (let i = 0; i < 9; i++)
        p.icicle(
          "ice",
          0.025 + rand() * 0.03,
          0.12 + rand() * 0.45,
          -1.2 + i * 0.3 + (rand() - 0.5) * 0.1,
          WALL_HEIGHT - 0.1,
          (rand() - 0.5) * 0.1
        );
      break;
    // ---------------------------------------- on the floor, and across the way
    case "papers":
      for (let i = 0; i < 3 + Math.floor(rand() * 4); i++)
        p.box("paper", 0.21, 0.004, 0.3, (rand() - 0.5) * 1.2, 0.006 + i * 0.001, (rand() - 0.5) * 1.2, 0, 0, rand() * Math.PI);
      break;
    case "stain":
      p.cyl("stain", 0.3 + rand() * 0.5, 0.004, 0, 0.004, 0, 0, 0, 10).cyl(
        "stain",
        0.15 + rand() * 0.2,
        0.004,
        0.4 + rand() * 0.3,
        0.004,
        rand() * 0.4,
        0,
        0,
        8
      );
      break;
    case "frost":
      p.cyl("frost", 0.5 + rand() * 0.6, 0.006, 0, 0.004, 0, 0, 0, 10).cyl("frost", 0.3 + rand() * 0.3, 0.006, 0.6, 0.004, 0.3, 0, 0, 8);
      break;
    case "strips":
      // PVC strip curtain across a freezer's doorway: local X runs along the opening.
      p.box("darkMetal", CELL_SIZE - 0.1, 0.06, 0.06, 0, 2.75, 0);
      for (let i = 0; i < 13; i++) p.box("strip", 0.3, 2.7, 0.005, -1.8 + i * 0.3, 1.38, (i % 2) * 0.01, (rand() - 0.5) * 0.04);
      break;
    case "sinew":
      // Strands across the corridor, wall to wall (local X), at head height and above.
      for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) {
        const y = 1.5 + rand() * 1.5;
        p.cyl("flesh", 0.02 + rand() * 0.03, CELL_SIZE, 0, y, (rand() - 0.5) * 2, 0, Math.PI / 2 + (rand() - 0.5) * 0.4, 5);
      }
      break;
  }
}

/** Posters the station put up, and the consortium after it. */
const POSTERS: { bg: string; ink: string; lines: string[]; mark?: "triangle" | "bio" | "plan" | "hands" }[] = [
  { bg: "#b89a48", ink: "#1a1612", lines: ["ТЕХНИКА", "БЕЗОПАСНОСТИ", "", "РАБОТАЙ В КАСКЕ", "SAFETY FIRST"], mark: "triangle" },
  { bg: "#7a2a22", ink: "#e8d8b0", lines: ["ОБЪЕКТ 9", "«ЗЕНИТ»", "", "ГЛУБЖЕ ВСЕХ —", "ВЫШЕ ВСЕХ!"] },
  { bg: "#d8d8d0", ink: "#1a2a3a", lines: ["GLASS", "CONSORTIUM", "", "AUTHORISED", "PERSONNEL ONLY"], mark: "plan" },
  { bg: "#d8c84a", ink: "#101010", lines: ["BIOHAZARD", "", "SAMPLE R-7", "DO NOT SPEAK", "IN ITS PRESENCE"], mark: "bio" },
  { bg: "#c8d8d0", ink: "#1a3a2a", lines: ["МОЙТЕ", "РУКИ", "", "ЧИСТОТА —", "ЗАЛОГ ЗДОРОВЬЯ"], mark: "hands" },
];

/** What the crew wrote on the walls, eleven days in. */
const SCRAWLS: { text: string[]; color: string }[] = [
  { text: ["НЕ ОТВЕЧАЙ", "ГОЛОСУ"], color: "#b8b0a0" },
  { text: ["IT KNOWS", "YOUR NAME"], color: "#8a2a1e" },
  { text: ["||||  ||||  |", "ДЕНЬ 11"], color: "#c8c0b0" },
  { text: ["LIGHTS OFF", "MOUTH SHUT"], color: "#b8b0a0" },
];

function posterTexture(i: number): THREE.CanvasTexture {
  const def = POSTERS[i % POSTERS.length];
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 356;
  const g = c.getContext("2d")!;
  g.fillStyle = def.bg;
  g.fillRect(0, 0, 256, 356);
  g.strokeStyle = def.ink;
  g.lineWidth = 6;
  g.strokeRect(12, 12, 232, 332);
  g.fillStyle = def.ink;
  g.textAlign = "center";
  def.lines.forEach((line, n) => {
    g.font = n < 2 ? "bold 30px Arial, sans-serif" : "bold 20px Arial, sans-serif";
    g.fillText(line, 128, 60 + n * 34 + (n >= 2 ? 90 : 0), 220);
  });
  g.lineWidth = 5;
  if (def.mark === "triangle") {
    g.beginPath();
    g.moveTo(128, 138);
    g.lineTo(168, 208);
    g.lineTo(88, 208);
    g.closePath();
    g.stroke();
    g.fillRect(125, 158, 6, 28);
    g.fillRect(125, 192, 6, 6);
  } else if (def.mark === "bio") {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
      g.beginPath();
      g.arc(128 + Math.cos(a) * 22, 110 + Math.sin(a) * 22, 22, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (def.mark === "plan") {
    g.strokeRect(70, 130, 116, 80);
    g.beginPath();
    g.moveTo(70, 170);
    g.lineTo(186, 170);
    g.moveTo(128, 130);
    g.lineTo(128, 210);
    g.stroke();
  } else if (def.mark === "hands") {
    g.beginPath();
    g.arc(128, 175, 30, 0, Math.PI * 2);
    g.stroke();
  }
  grime(g, 256, 356, 900);
  // Torn corner.
  g.fillStyle = "rgba(20,20,20,0.9)";
  g.beginPath();
  g.moveTo(256, 356);
  g.lineTo(200, 356);
  g.lineTo(256, 300);
  g.fill();
  return canvasTexture(c);
}

function scrawlTexture(i: number): THREE.CanvasTexture {
  const def = SCRAWLS[i % SCRAWLS.length];
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 512, 256);
  g.fillStyle = def.color;
  g.strokeStyle = def.color;
  g.textAlign = "center";
  g.font = "bold 72px 'Courier New', monospace";
  def.text.forEach((line, n) => {
    g.save();
    g.translate(256, 100 + n * 90);
    g.rotate((n - 0.5) * 0.05);
    g.fillText(line, 0, 0, 480);
    g.restore();
  });
  // Drips.
  for (let k = 0; k < 8; k++) g.fillRect(40 + Math.random() * 430, 100 + Math.random() * 90, 3, 20 + Math.random() * 50);
  const t = canvasTexture(c);
  return t;
}

/** Dr Arkadin's board: sums, a diagram of the throat, and a question he never answered. */
function chalkTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 288;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1e2a24";
  g.fillRect(0, 0, 512, 288);
  g.fillStyle = "rgba(220,220,210,0.85)";
  g.strokeStyle = "rgba(220,220,210,0.8)";
  g.lineWidth = 3;
  g.font = "26px 'Comic Sans MS', cursive";
  g.textAlign = "left";
  g.fillText("R-7:  f₀ ≈ 84 Гц", 24, 44);
  g.fillText("речь → ?", 24, 84);
  g.fillText("t (инкуб.) = 11 сут.", 24, 124);
  g.fillText("ГОЛОС = ПЕРЕНОСЧИК", 24, 250);
  g.beginPath();
  g.ellipse(390, 110, 70, 50, 0, 0, Math.PI * 2);
  g.moveTo(330, 110);
  g.quadraticCurveTo(300, 160, 330, 200);
  g.moveTo(450, 110);
  g.quadraticCurveTo(480, 170, 440, 210);
  g.stroke();
  g.beginPath();
  g.moveTo(260, 245);
  g.lineTo(490, 245);
  g.stroke();
  grime(g, 512, 288, 300);
  return canvasTexture(c);
}

function grime(g: CanvasRenderingContext2D, w: number, h: number, n: number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.22})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 2 + Math.random() * 6);
  }
}

function canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function texturedMaterial(key: string): THREE.MeshStandardMaterial {
  if (key.startsWith("story:")) {
    const name = key.slice(6);
    return storyTextureOnWall(name)
      ? new THREE.MeshStandardMaterial({
          map: storyTexture(name),
          roughness: 0.9,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        })
      : new THREE.MeshStandardMaterial({ map: storyTexture(name), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 });
  }
  if (key === "chalk") return new THREE.MeshStandardMaterial({ map: chalkTexture(), roughness: 0.95 });
  const n = Number(key.replace(/\D/g, ""));
  if (key.startsWith("scrawl"))
    return new THREE.MeshStandardMaterial({
      map: scrawlTexture(n),
      roughness: 0.9,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  return new THREE.MeshStandardMaterial({ map: posterTexture(n), roughness: 0.85 });
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
  grime(g, 512, 192, 400);
  return canvasTexture(c);
}

/**
 * The services along one corridor cell. Each pipe of the bundle keeps its
 * own distance from the walls (the first nearest), so where the corridor
 * turns, the bundle turns with it: every pipe runs from the cell's edges to
 * its own corner point, and an elbow joins them there. Flanges at the
 * joints, hangers from the ceiling, a band of paint, the odd valve and
 * gauge; where the corridor opens into a room the pipes turn up into the
 * ceiling. The cable tray does the same along the opposite walls.
 */
function buildRun(p: Parts, run: CorridorRun, style: LevelStyle, rand: () => number): void {
  const half = CELL_SIZE / 2;
  p.at(run.x, run.z, 0);
  const ends = (bits: number, bit: number) => (bits & bit) !== 0;
  const all = run.links | run.rises;
  const alongX = (all & (EAST | WEST)) !== 0;
  const alongZ = (all & (SOUTH | NORTH)) !== 0;

  if (style.ducts) {
    const o = half - 0.65;
    const y = WALL_HEIGHT - 0.32;
    for (const [dx, dz, bit] of DIRS) {
      if (!ends(all, bit)) continue;
      const len = half - o * (dx + dz);
      const mid = (half + o * (dx + dz)) / 2;
      if (dx !== 0) p.box("metal", len, 0.5, 0.9, dx * mid, y, o);
      else p.box("metal", 0.9, 0.5, len, o, y, dz * mid);
      if (ends(run.rises, bit)) {
        if (dx !== 0) p.box("metal", 0.9, WALL_HEIGHT - y, 0.9, dx * (half - 0.45), (WALL_HEIGHT + y) / 2, o);
        else p.box("metal", 0.9, WALL_HEIGHT - y, 0.9, o, (WALL_HEIGHT + y) / 2, dz * (half - 0.45));
      }
    }
    if (alongX && alongZ) p.box("metal", 0.96, 0.54, 0.96, o, y, o);
    // Joint frames every cell, and a grille now and then.
    if (ends(all, EAST)) p.box("darkMetal", 0.06, 0.56, 0.96, half - 0.03, y, o);
    if (ends(all, SOUTH)) p.box("darkMetal", 0.96, 0.56, 0.06, o, y, half - 0.03);
    if (rand() < 0.2)
      p.box("darkMetal", alongX ? 0.6 : 0.02, 0.02, alongX ? 0.02 : 0.6, alongX ? -0.5 : o - 0.46, y - 0.26, alongX ? o - 0.46 : -0.5);
    return;
  }

  // The pipe bundle, along the +X/+Z walls.
  let o = half - 0.12;
  const specs = style.pipes.map((spec, i) => {
    o -= spec.r + (i === 0 ? 0 : style.pipes[i - 1].r + 0.08);
    const lag = spec.mat === "lagging";
    const mat: MatKey = style.frost && !lag ? "frost" : spec.mat;
    return { ...spec, o, y: WALL_HEIGHT - 0.14 - spec.r, mat, lag };
  });
  for (const s of specs) {
    for (const [dx, dz, bit] of DIRS) {
      if (!ends(all, bit)) continue;
      // From this pipe's corner point out to the cell edge.
      const len = half - s.o * (dx + dz);
      const mid = (half + s.o * (dx + dz)) / 2;
      const px = dx !== 0 ? dx * mid : s.o;
      const pz = dz !== 0 ? dz * mid : s.o;
      if (dx !== 0) p.cyl(s.mat, s.r, len, px, s.y, pz, 0, Math.PI / 2, 10);
      else p.cyl(s.mat, s.r, len, px, s.y, pz, Math.PI / 2, 0, 10);
      const ex = dx !== 0 ? dx * (half - 0.03) : s.o;
      const ez = dz !== 0 ? dz * (half - 0.03) : s.o;
      if (ends(run.rises, bit)) {
        // Into a room: up through the ceiling.
        p.blob(s.mat, s.r * 1.05, ex, s.y, ez).cyl(s.mat, s.r, WALL_HEIGHT - s.y, ex, (WALL_HEIGHT + s.y) / 2, ez, 0, 0, 10);
        p.cyl("darkMetal", s.r * 1.8, 0.03, ex, WALL_HEIGHT - 0.015, ez, 0, 0, 10);
      } else if (bit === EAST || bit === SOUTH) {
        // A flange where this length meets the next (each joint drawn once, from its west/north side).
        const fl = s.lag ? "metal" : "darkMetal";
        if (dx !== 0) p.cyl(fl, s.r * 1.5, 0.06, ex, s.y, ez, 0, Math.PI / 2, 10);
        else p.cyl(fl, s.r * 1.5, 0.06, ex, s.y, ez, Math.PI / 2, 0, 10);
      }
      // Lagging is held on with metal straps.
      if (s.lag)
        for (let k = 0.6; k < len - 0.2; k += 1.3) {
          const t = s.o + (dx + dz) * k;
          if (dx !== 0) p.cyl("metal", s.r * 1.04, 0.04, t, s.y, s.o, 0, Math.PI / 2, 10);
          else p.cyl("metal", s.r * 1.04, 0.04, s.o, s.y, t, Math.PI / 2, 0, 10);
        }
      // Icicles off the cold pipes; growths along the pipes in the hive.
      if (style.frost && rand() < 0.3)
        for (let k = 0; k < 3; k++)
          if (rand() < 0.6) {
            const t = s.o + (dx + dz) * rand() * len;
            p.icicle("ice", 0.015 + rand() * 0.02, 0.08 + rand() * 0.28, dx !== 0 ? t : s.o, s.y - s.r, dz !== 0 ? t : s.o);
          }
      if (style.growth && rand() < 0.35) {
        const t = s.o + (dx + dz) * rand() * len;
        p.blob("flesh", s.r * (1.4 + rand()), dx !== 0 ? t : s.o, s.y, dz !== 0 ? t : s.o);
      }
    }
    // Where the bundle turns (or a branch leaves it): an elbow.
    if (alongX && alongZ) p.blob(s.mat, s.r * 1.12, s.o, s.y, s.o);
    // A dead end: the pipe stops at its corner point, blanked off.
    else if (alongX && !(ends(all, EAST) && ends(all, WEST))) p.cyl("darkMetal", s.r * 1.3, 0.05, s.o, s.y, s.o, 0, Math.PI / 2, 10);
    else if (alongZ && !(ends(all, SOUTH) && ends(all, NORTH))) p.cyl("darkMetal", s.r * 1.3, 0.05, s.o, s.y, s.o, Math.PI / 2, 0, 10);
  }
  if (specs.length) {
    // Hangers: a strut under the bundle, on two rods from the ceiling.
    const inner = specs[specs.length - 1];
    const lo = Math.min(...specs.map((s) => s.y - s.r)) - 0.03;
    const span = specs[0].o + specs[0].r - (inner.o - inner.r) + 0.1;
    const midO = (specs[0].o + specs[0].r + inner.o - inner.r) / 2;
    const place = (along: "x" | "z", t: number) => {
      const ax = along === "x" ? t : midO;
      const az = along === "z" ? t : midO;
      if (along === "x") p.box("darkMetal", 0.05, 0.05, span, ax, lo, az);
      else p.box("darkMetal", span, 0.05, 0.05, ax, lo, az);
      for (const side of [-1, 1]) {
        const off = (side * span) / 2;
        p.cyl("darkMetal", 0.012, WALL_HEIGHT - lo, along === "x" ? ax : ax + off, (WALL_HEIGHT + lo) / 2, along === "z" ? az : az + off);
      }
    };
    if (alongX && !alongZ) place("x", (rand() - 0.5) * 1.6);
    else if (alongZ && !alongX) place("z", (rand() - 0.5) * 1.6);
    // A band of paint, and now and then a valve with its handwheel, or a gauge.
    const s = specs[Math.floor(rand() * specs.length)];
    const along: "x" | "z" | null = alongX && !alongZ ? "x" : alongZ && !alongX ? "z" : null;
    if (along && !s.lag && !style.frost && rand() < 0.35) {
      const t = (rand() - 0.5) * 2;
      const band: MatKey = rand() < 0.5 ? "paintYellow" : "paintRed";
      if (along === "x") p.cyl(band, s.r * 1.06, 0.14, t, s.y, s.o, 0, Math.PI / 2, 10);
      else p.cyl(band, s.r * 1.06, 0.14, s.o, s.y, t, Math.PI / 2, 0, 10);
    }
    if (along && rand() < 0.12) {
      const t = (rand() - 0.5) * 2;
      const vx = along === "x" ? t : s.o;
      const vz = along === "z" ? t : s.o;
      p.box("darkMetal", s.r * 2.6, s.r * 2.6, s.r * 2.6, vx, s.y, vz).cyl("darkMetal", 0.02, 0.3, vx, s.y - s.r - 0.15, vz);
      p.ring("paintRed", 0.14, 0.018, vx, s.y - s.r - 0.3, vz, Math.PI / 2);
    } else if (along && rand() < 0.1) {
      const t = (rand() - 0.5) * 2;
      const gx = along === "x" ? t : s.o - s.r - 0.1;
      const gz = along === "z" ? t : s.o - s.r - 0.1;
      p.cyl("darkMetal", 0.015, 0.2, gx, s.y - 0.08, gz)
        .cyl("brass", 0.07, 0.03, gx, s.y - 0.22, gz, Math.PI / 2, 0)
        .cyl("enamel", 0.058, 0.032, gx, s.y - 0.22, gz - 0.002, Math.PI / 2, 0);
    }
  }

  // The cable tray, along the -X/-Z walls.
  if (style.tray) {
    const t = -(half - 0.35);
    const y = WALL_HEIGHT - 0.3;
    for (const [dx, dz, bit] of DIRS) {
      if (!ends(run.links, bit)) continue;
      const len = half - t * (dx + dz);
      const mid = (half + t * (dx + dz)) / 2;
      const px = dx !== 0 ? dx * mid : t;
      const pz = dz !== 0 ? dz * mid : t;
      if (dx !== 0) {
        p.box("darkMetal", len, 0.03, 0.42, px, y, pz)
          .box("darkMetal", len, 0.08, 0.02, px, y + 0.04, pz - 0.2)
          .box("darkMetal", len, 0.08, 0.02, px, y + 0.04, pz + 0.2);
        for (const c of [-0.12, 0, 0.1]) p.cyl("rubber", 0.028, len, px, y + 0.045, pz + c, 0, Math.PI / 2, 6);
      } else {
        p.box("darkMetal", 0.42, 0.03, len, px, y, pz)
          .box("darkMetal", 0.02, 0.08, len, px - 0.2, y + 0.04, pz)
          .box("darkMetal", 0.02, 0.08, len, px + 0.2, y + 0.04, pz);
        for (const c of [-0.12, 0, 0.1]) p.cyl("rubber", 0.028, len, px + c, y + 0.045, pz, Math.PI / 2, 0, 6);
      }
    }
    if (run.links & (EAST | WEST) && run.links & (SOUTH | NORTH)) p.box("darkMetal", 0.46, 0.03, 0.46, t, y, t);
    if (style.frost) p.box("frost", 0.4, 0.03, 0.4, t, y + 0.06, t);
  }
}

/** Builds a plan into the scene: merged props per material, the signs, the service runs. */
export function buildDressing(scene: THREE.Scene, level: ParsedLevel, plan: DressingPlan = planDressing(level)): void {
  const rand = mulberry32(hash(`${level.def.id}:props`));
  const style = styleFor(level.def.id);
  const mats = materials();
  const parts = new Parts();
  for (const pr of plan.props) buildProp(parts.at(pr.x, pr.z, pr.rot), pr.kind, rand, pr.variant);
  for (const run of plan.runs) buildRun(parts, run, style, rand);
  for (const sc of plan.scenes) buildScene(parts.at(sc.x, sc.z, sc.rot), sc.kind, rand);
  for (const [m, geos] of parts.byMat) {
    const merged = geos.length ? mergeGeometries(geos, false) : null;
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mats[m]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
  }
  for (const [key, geos] of parts.byTex) {
    const merged = geos.length ? mergeGeometries(geos, false) : null;
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, texturedMaterial(key));
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
