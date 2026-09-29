import * as THREE from "three";
import { ENEMY_GLYPHS, enemyDef, type EnemyKind } from "../content/enemies";
import { ITEM_GLYPHS, type PickupType } from "../content/items";
import { cellCenter, type Cell, type LevelGrid } from "./grid";
import type { LevelDef } from "./levelDef";
import { resolveTheme } from "./theme";

export interface NoteSpawn {
  pos: THREE.Vector2;
  text: string;
  /** "infirmary:1" — identifies the note in the journal. */
  key: string;
}

export interface LampSpawn {
  pos: THREE.Vector2;
  color: number;
  emergency: boolean;
}

export interface ItemSpawn {
  type: PickupType;
  pos: THREE.Vector2;
}

export interface EnemySpawn {
  pos: THREE.Vector2;
  kind: EnemyKind;
}

/** A thing in a cell: its cell coordinates and world-space centre. */
export interface CellSpawn {
  cell: Cell;
  pos: THREE.Vector2;
}

export interface DoorSpawn extends CellSpawn {
  security: boolean;
  /** A loose wall panel (`+`) hiding a secret room: looks like the wall, pried open with Use. */
  panel?: boolean;
}

export interface TriggerSpawn extends CellSpawn {
  key: string;
}

export interface Spawns {
  playerStart: THREE.Vector2;
  enemies: EnemySpawn[];
  /** Every pickup except notes (ammo, medkits, batteries, keycards, weapons). */
  items: ItemSpawn[];
  notes: NoteSpawn[];
  lamps: LampSpawn[];
  doors: DoorSpawn[];
  generators: CellSpawn[];
  intercoms: CellSpawn[];
  consoles: CellSpawn[];
  checkpoints: CellSpawn[];
  triggers: TriggerSpawn[];
  water: CellSpawn[];
  exit: THREE.Vector2;
}

/** Everything a level map describes, with no rendering attached. */
export interface ParsedLevel extends LevelGrid {
  def: LevelDef;
  spawns: Spawns;
  /** Cell positions of the level's static props, for the builder. */
  props: { walls: THREE.Vector2[]; crates: THREE.Vector2[]; barrels: THREE.Vector2[] };
  startCell: Cell;
  exitCell: Cell;
}

export class LevelParseError extends Error {
  constructor(levelId: string, message: string) {
    super(`Level "${levelId}": ${message}`);
    this.name = "LevelParseError";
  }
}

const EMERGENCY_LAMP = 0xff2a1a;

/**
 * Turns a text map into a grid plus spawn lists. Pure — no scene, no WebGL —
 * so it can run in unit tests and level validation.
 */
export function parseLevel(def: LevelDef): ParsedLevel {
  const cols = Math.max(...def.map.map((r) => r.length));
  const rows = def.map.length;
  // Pad short rows with walls so a hand-authored map can never leak.
  const map = def.map.map((r) => r.padEnd(cols, "#"));
  const lampColor = resolveTheme(def.theme).lampColor;

  const solid: boolean[][] = [];
  const props: ParsedLevel["props"] = { walls: [], crates: [], barrels: [] };
  const spawns: Omit<Spawns, "playerStart" | "exit"> = {
    enemies: [],
    items: [],
    notes: [],
    lamps: [],
    doors: [],
    generators: [],
    intercoms: [],
    consoles: [],
    checkpoints: [],
    triggers: [],
    water: [],
  };
  let startCell: Cell | null = null;
  let exitCell: Cell | null = null;
  const fail = (msg: string): never => {
    throw new LevelParseError(def.id, msg);
  };

  for (let row = 0; row < rows; row++) {
    const solidRow: boolean[] = [];
    for (let col = 0; col < cols; col++) {
      const ch = map[row][col];
      const c = cellCenter(col, row);
      const at: CellSpawn = { cell: { col, row }, pos: c };
      let blocked = false;
      switch (ch) {
        case "#":
          blocked = true;
          props.walls.push(c);
          break;
        case "C":
          blocked = true;
          props.crates.push(c);
          break;
        case "O":
          blocked = true;
          props.barrels.push(c);
          break;
        case ".":
          break;
        case "S":
          if (startCell) fail(`more than one player spawn (second at ${col},${row})`);
          startCell = { col, row };
          break;
        case "X":
          if (exitCell) fail(`more than one exit (second at ${col},${row})`);
          exitCell = { col, row };
          break;
        case "L":
          spawns.lamps.push({ pos: c, color: lampColor, emergency: false });
          break;
        case "R":
          spawns.lamps.push({ pos: c, color: EMERGENCY_LAMP, emergency: true });
          break;
        case "D":
        case "=":
          blocked = true;
          spawns.doors.push({ ...at, security: ch === "=" });
          break;
        case "+":
          blocked = true;
          spawns.doors.push({ ...at, security: false, panel: true });
          break;
        case "G":
          blocked = true;
          spawns.generators.push(at);
          break;
        case "Y":
          spawns.intercoms.push(at);
          break;
        case "Z":
          spawns.consoles.push(at);
          break;
        case "*":
          spawns.checkpoints.push(at);
          break;
        case "~":
          spawns.water.push(at);
          break;
        default: {
          const enemy = ENEMY_GLYPHS.get(ch);
          const item = ITEM_GLYPHS.get(ch);
          if (enemy) {
            // A pack (swarm) spreads round the cell in a fixed pattern, so spawn order stays deterministic.
            const n = enemyDef(enemy).pack ?? 1;
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2;
              const r = n > 1 ? 0.9 : 0;
              spawns.enemies.push({ pos: new THREE.Vector2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r), kind: enemy });
            }
          } else if (item) {
            spawns.items.push({ type: item, pos: c });
          } else if (ch >= "0" && ch <= "9") {
            const text = def.notes[ch];
            if (!text) fail(`note "${ch}" at ${col},${row} has no text in the notes table`);
            spawns.notes.push({ pos: c, text, key: `${def.id}:${ch}` });
          } else if (ch >= "a" && ch <= "z") {
            if (!def.triggers?.[ch]) fail(`trigger "${ch}" at ${col},${row} has no actions in the triggers table`);
            spawns.triggers.push({ ...at, key: ch });
          } else {
            fail(`unknown map character "${ch}" at ${col},${row}`);
          }
        }
      }
      solidRow.push(blocked);
    }
    solid.push(solidRow);
  }

  if (!startCell) fail("no player spawn (S)");
  if (!exitCell) fail("no exit (X)");
  const intercomScripts = def.intercoms?.length ?? 0;
  if (spawns.intercoms.length !== intercomScripts) {
    fail(`${spawns.intercoms.length} intercoms (Y) on the map but ${intercomScripts} intercom scripts`);
  }
  if (spawns.consoles.length > 0 && !def.finale) fail("detonator console (Z) outside the finale");
  if (spawns.enemies.filter((e) => enemyDef(e.kind).behaviour === "boss").length > 1) fail("more than one boss");

  const start = startCell!;
  const exit = exitCell!;
  return {
    def,
    cols,
    rows,
    solid,
    props,
    startCell: start,
    exitCell: exit,
    spawns: {
      ...spawns,
      playerStart: cellCenter(start.col, start.row),
      exit: cellCenter(exit.col, exit.row),
    },
  };
}
