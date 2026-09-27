import { alarm, checkpoint, hint, nur, objective, op, radio, unknown } from "../../../game/script";
import type { LevelDef } from "../../levelDef";

/** Level 15 — the drainage line into the mountain: a long tunnel with bays, Crawlers overhead, packs in the dark. */
export const RAIL_TUNNEL: LevelDef = {
  id: "drainage-line",
  name: "Drainage Line",
  subtitle: "Rail Tunnel",
  number: 15,
  tagline: "Four kilometres of dark, one way in.",
  objective: "Follow the rail line into the mountain.",
  spawnYaw: -Math.PI / 2,
  theme: {
    fog: 0x0a0604,
    fogDensity: 0.065,
    wallTint: 0xd8c4a8,
    floorTint: 0xc0ac90,
    lampColor: 0xffa860,
    skyLight: 0x5a4a38,
    groundLight: 0x140c06,
  },
  map: [
    "##################################################",
    "#S.....#.....V.....#......L.....#....%.....#.....#",
    "#..a...D...........D............D..........D..M..#",
    "#......#.....1.....#......N.....#....V.....#.....#",
    "####.#######.#########.#######.######.########.###",
    "#....R.....b.......~~~~~~~R.......c......~~~~~R..#",
    "#..U..............~~~~~~~.....V........~~~~~.....#",
    "#......N....A.....~~~~~~~...H....*.....~~~~~.U...#",
    "####.#######.#########.#######.######.########.###",
    "#......#.....B.....#...H..M.....#....%.....#.....#",
    "#..2...D...........D............D....N.....D..X..#",
    "#......#.....A.....#............#..........#.....#",
    "##################################################",
  ],
  notes: {
    "1": "Drainage line, maintenance bay 3. Rail cart is dead. Walk the line, stay off the water, and never look up. — work order, 1990",
    "2": "Sadykova. Found my son. He was standing with the others. He smiled at me. I think I'm going to stay with him. Don't come looking. — S.",
  },
  events: {
    start: [
      radio(
        op("The old drainage line. The Soviets used it to pump the cavity dry. It goes all the way down."),
        nur("Then that's the way.")
      ),
    ],
  },
  triggers: {
    a: [hint("Crawlers wait on the ceiling. Watch the dark above you, and move when they drop")],
    b: [radio(nur("Water in the middle of the line. Bays on either side. I'll stay dry.")), checkpoint()],
    c: [
      radio(unknown("...the Deep is below ten, Nur. Below the infirmary where you woke up. We were always underneath you...")),
      alarm(18),
      checkpoint(),
    ],
  },
};
