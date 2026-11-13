import { alarm, checkpoint, hint, nur, objective, op, radio, unknown } from "../../../game/script";
import type { LevelDef } from "../../levelDef";

/** Level 12 — the village. Houses, a square, two ways round. The Howler: if it sees you, everything hears. */
export const VILLAGE: LevelDef = {
  id: "ak-suu-village",
  name: "Ak-Suu",
  subtitle: "The Village",
  number: 12,
  tagline: "Every door is open. Every house is warm.",
  objective: "Find the key to the bus garage.",
  spawnYaw: -Math.PI / 2,
  // Timber houses and a muddy square under a snow-grey sky: warmer and browner than anything in the mountain.
  theme: {
    fog: 0x10141a,
    fogDensity: 0.045,
    wallTint: 0xb08a68,
    floorTint: 0x8f8270,
    lampColor: 0xffc27a,
    skyLight: 0x7c8898,
    groundLight: 0x1a140c,
  },
  map: [
    "##################################",
    "#S...#.......#.......#.....#.....#",
    "#..a.D...E...D...L...D..N..D..A..#",
    "#....#.......#.......#.....#.....#",
    "##D#####A#########D#####D#####D###",
    "#.....................b..........#",
    "#..L......~~~~~.......N.J...L....#",
    "#.........~~~~~..................#",
    "#####D#####.....######D#####..####",
    "#.....#...#..c..#.........#.....%#",
    "#..1..#.E.D.....D....K....D..Q...#",
    "#.....#...#.....#.........#......#",
    "#######.###.....#####.#####......#",
    "#...........W.....L..........d...#",
    "#..M..B...........E........###D###",
    "#.....A......2.........e...#..X..#",
    "##################################",
  ],
  notes: {
    "1": "Garage key is on the hook in the teacher's house, like always. If you're reading this, take the bus and don't stop until Karakol. — Asel",
    "2": "One of them stood in the square and screamed and the rest came from every house at once. Don't let the tall one see you. — (no name)",
  },
  events: {
    start: [
      radio(op("The bus in the garage still runs. The dam road goes up the valley. That's where everyone is."), nur("Everyone. Right.")),
    ],
    keycard: [radio(nur("The garage key. Now let's hope the bus starts quietly.")), objective("Get to the bus garage."), checkpoint()],
  },
  triggers: {
    a: [
      hint("Howlers scream when they see you, and everything nearby comes running. Take them first, and quietly"),
      objective("Find the key to the bus garage."),
    ],
    b: [radio(unknown("...we're in the houses, Nur. It's warm here. Leave the door open.")), checkpoint()],
    c: [radio(nur("The school. The desks are still in rows."))],
    d: [radio(op("The garage is just ahead. Such a long way you've come."))],
    e: [radio(nur("Something big is moving in the square.")), alarm(14)],
  },
};
