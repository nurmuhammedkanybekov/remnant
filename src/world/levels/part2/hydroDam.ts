import { advise, alarm, apparition, checkpoint, hint, ifTold, nur, objective, op, radio, silence, unknown } from "../../../game/script";
import type { LevelDef } from "../../levelDef";

/**
 * Level 13 — the hydro dam: flooded channels, and three spillway gates. Each
 * one's siren calls the reservoir to it, so the order matters, and the voice
 * offers to tell you which is quietest. Whether it tells the truth depends on
 * how you've treated it (see `advise`).
 */
export const HYDRO_DAM: LevelDef = {
  id: "kara-suu-dam",
  name: "Kara-Suu",
  subtitle: "Hydro Dam",
  number: 13,
  tagline: "Where the meltwater goes, they go.",
  objective: "Open the three spillway gates.",
  machine: "gate",
  spawnYaw: -Math.PI / 2,
  theme: {
    fog: 0x06100e,
    fogDensity: 0.055,
    wallTint: 0xc8d8d0,
    floorTint: 0xb8c8c0,
    lampColor: 0xd8ffe8,
    skyLight: 0x4a6660,
    groundLight: 0x0c1410,
    // The reservoir lies under the open sky, the walkways across it with it.
    outdoor: "water",
    cliffs: true,
    skyline: "peaks",
  },
  map: [
    "####################################",
    "#S...#.......~~~~~~~~~~.......#....#",
    "#.a..D...U...~~~~~~~~~~...P...D..G.#",
    "#....#.......~~~~~~~~~~.......#....#",
    "###.####.#########L#########.####.##",
    "#.....L.....#....b......#.....L....#",
    "#..G........D...........D....N.....#",
    "#.....E.....#.....1.....#..........#",
    "######.###########.###########.#####",
    "#~~~~~.~~~~~~~~~~~.~~~~~~~~~~~.~~~~#",
    "#~~U~~.~~~~~~~~~~~.~~~~~~~~~~~.~~~~#",
    "#~~~~~.~~~~~~~~~~~.~~~~~~~~~~~.~~~~#",
    "######.###.#######*#######.###.#####",
    "#.....c...#...A.......M...#....V...#",
    "#..PJ.....D.......H.......D........#",
    "#A....B.3.#.......G.......#..2..A..#",
    "#####D#####..............A#####D####",
    "#.........#.....L....d....#......X.#",
    "####################################",
  ],
  notes: {
    "1": "Three gates to open the spillway. Every gate sounds the siren when it opens, and the whole reservoir hears it. Open the quiet one first. The radio always knows which is quiet. It doesn't always say. — B. Toktogulov, shift engineer",
    "2": "They stand in the reservoir up to the neck. Hundreds. Not breathing. Waiting for the water to carry them somewhere. — B.T.",
    "3": "GATE LOG. Pumps two and three started by hand, 04:20. By first light the reservoir was full of people. Not one of them came out to stop us. They only turned, all together, to watch the lamps come on. — B.T.",
  },
  events: {
    start: [
      radio(
        op("The dam. The spillway gate leads to the old drainage line, and the drainage line leads home."),
        nur("Home is where you are. That's the mountain."),
        op("That's right, Nur. That's exactly right.")
      ),
      // You told it where you were going. They're waiting.
      ifTold("where", [radio(unknown("...we waited at the water, Nur, like you said. All of us...")), alarm(24)]),
      advise(),
    ],
    // After each gate it offers again. You'll know by now whether to believe it.
    machineDone: [[advise()], [advise()]],
    power: [radio(nur("The spillway's open. Everything in the reservoir heard it.")), objective("Get through the spillway."), checkpoint()],
  },
  triggers: {
    a: [hint("Water is loud. Wading brings Listeners. Find the dry walkways")],
    b: [
      radio(unknown("...cold, it's so cold in the water, come and warm us, Nur...")),
      // Out in the reservoir, up to the neck, three of them, watching you. Light them and they're not there.
      silence(5),
      apparition("husk", 18, 3),
      apparition("husk", 17, 2),
      apparition("husk", 19, 2),
    ],
    c: [radio(nur("Spitters on the gantry. Stay out of their line.")), checkpoint()],
    d: [radio(op("The spillway's right below you. Every gate you open, they'll come to."))],
  },
};
