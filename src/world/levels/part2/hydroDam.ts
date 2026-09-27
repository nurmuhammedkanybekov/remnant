import { checkpoint, hint, nur, objective, op, radio, unknown } from "../../../game/script";
import type { LevelDef } from "../../levelDef";

/** Level 13 — the hydro dam: flooded channels and three generators for the spillway gate. */
export const HYDRO_DAM: LevelDef = {
  id: "kara-suu-dam",
  name: "Kara-Suu",
  subtitle: "Hydro Dam",
  number: 13,
  tagline: "Where the meltwater goes, they go.",
  objective: "Start the three generators to open the spillway gate.",
  spawnYaw: -Math.PI / 2,
  theme: {
    fog: 0x06100e,
    fogDensity: 0.055,
    wallTint: 0xc8d8d0,
    floorTint: 0xb8c8c0,
    lampColor: 0xd8ffe8,
    skyLight: 0x4a6660,
    groundLight: 0x0c1410,
  },
  map: [
    "####################################",
    "#S...#.......~~~~~~~~~~.......#....#",
    "#.a..D...U...~~~~~~~~~~...P...D..G.#",
    "#....#.......~~~~~~~~~~.......#....#",
    "###.####.#########.#########.####.##",
    "#.....L.....#....b......#.....L....#",
    "#..G........D...........D....N.....#",
    "#.....E.....#.....1.....#..........#",
    "######.###########.###########.#####",
    "#~~~~~.~~~~~~~~~~~.~~~~~~~~~~~.~~~~#",
    "#~~U~~.~~~~~~~~~~~.~~~~~~~~~~~.~~~~#",
    "#~~~~~.~~~~~~~~~~~.~~~~~~~~~~~.~~~~#",
    "######.###.#######*#######.###.#####",
    "#.....c...#...A.......M...#....V...#",
    "#..P......D.......H.......D........#",
    "#.....B...#.......G.......#..2..A..#",
    "#####D#####...............#####D####",
    "#.........#.....L....d....#......X.#",
    "####################################",
  ],
  notes: {
    "1": "Spillway gate won't open without all three generators. Whoever starts the first one: the whole valley hears it. Start the second one fast. — B. Toktogulov, shift engineer",
    "2": "They stand in the reservoir up to the neck. Hundreds. Not breathing. Waiting for the water to carry them somewhere. — B.T.",
  },
  events: {
    start: [
      radio(
        op("The dam. The spillway gate leads to the old drainage line, and the drainage line leads home."),
        nur("Home is where you are. That's the mountain."),
        op("That's right, Nur. That's exactly right.")
      ),
    ],
    power: [
      radio(nur("The gate's opening. Loud enough to wake the whole reservoir.")),
      objective("Get through the spillway."),
      checkpoint(),
    ],
  },
  triggers: {
    a: [hint("Water is loud. Wading brings Listeners. Find the dry walkways")],
    b: [radio(unknown("...cold, it's so cold in the water, come and warm us, Nur..."))],
    c: [radio(nur("Spitters on the gantry. Stay out of their line.")), checkpoint()],
    d: [radio(op("One more generator. Then the gate."))],
  },
};
