import type * as THREE from "three";
import { ENEMY_GLYPHS, type EnemyKind } from "../content/enemies";
import { cellCenter, type Cell, type LevelGrid } from "./grid";
import type { LevelDef } from "./levelDef";

export interface NoteSpawn {
  pos: THREE.Vector2;
  text: string;
}

export interface LampSpawn {
  pos: THREE.Vector2;
  color: number;
  emergency: boolean;
}

export interface EnemySpawn {
  pos: THREE.Vector2;
  kind: EnemyKind;
}

export interface Spawns {
  playerStart: THREE.Vector2;
  enemies: EnemySpawn[];
  ammo: THREE.Vector2[];
  medkits: THREE.Vector2[];
  batteries: THREE.Vector2[];
  keycards: THREE.Vector2[];
  notes: NoteSpawn[];
  lamps: LampSpawn[];
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

const WARM_LAMP = 0xffd9a0;
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

  const solid: boolean[][] = [];
  const props: ParsedLevel["props"] = { walls: [], crates: [], barrels: [] };
  const spawns: Omit<Spawns, "playerStart" | "exit"> = {
    enemies: [],
    ammo: [],
    medkits: [],
    batteries: [],
    keycards: [],
    notes: [],
    lamps: [],
  };
  let startCell: Cell | null = null;
  let exitCell: Cell | null = null;

  for (let row = 0; row < rows; row++) {
    const solidRow: boolean[] = [];
    for (let col = 0; col < cols; col++) {
      const ch = map[row][col];
      const c = cellCenter(col, row);
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
          if (startCell) throw new LevelParseError(def.id, `more than one player spawn (second at ${col},${row})`);
          startCell = { col, row };
          break;
        case "X":
          if (exitCell) throw new LevelParseError(def.id, `more than one exit (second at ${col},${row})`);
          exitCell = { col, row };
          break;
        case "A":
          spawns.ammo.push(c);
          break;
        case "M":
          spawns.medkits.push(c);
          break;
        case "B":
          spawns.batteries.push(c);
          break;
        case "K":
          spawns.keycards.push(c);
          break;
        case "L":
          spawns.lamps.push({ pos: c, color: WARM_LAMP, emergency: false });
          break;
        case "R":
          spawns.lamps.push({ pos: c, color: EMERGENCY_LAMP, emergency: true });
          break;
        default: {
          const enemy = ENEMY_GLYPHS.get(ch);
          if (enemy) {
            spawns.enemies.push({ pos: c, kind: enemy });
          } else if (ch >= "0" && ch <= "9") {
            const text = def.notes[ch];
            if (!text) throw new LevelParseError(def.id, `note "${ch}" at ${col},${row} has no text in the notes table`);
            spawns.notes.push({ pos: c, text });
          } else {
            throw new LevelParseError(def.id, `unknown map character "${ch}" at ${col},${row}`);
          }
        }
      }
      solidRow.push(blocked);
    }
    solid.push(solidRow);
  }

  if (!startCell) throw new LevelParseError(def.id, "no player spawn (S)");
  if (!exitCell) throw new LevelParseError(def.id, "no exit (X)");

  return {
    def,
    cols,
    rows,
    solid,
    props,
    startCell,
    exitCell,
    spawns: {
      ...spawns,
      playerStart: cellCenter(startCell.col, startCell.row),
      exit: cellCenter(exitCell.col, exitCell.row),
    },
  };
}
