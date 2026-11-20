import { checkpoint, hint, nur, objective, op, radio, silence, sound, unknown } from "../../../game/script";
import type { LevelDef } from "../../levelDef";

/** Level 17 — the Source: the Choir's cavern. The last boss, then leave or bring it all down. */
export const THE_SOURCE: LevelDef = {
  id: "the-cavity",
  name: "The Cavity",
  subtitle: "The Source",
  number: 17,
  tagline: "Forty-one voices, and a village, and more.",
  objective: "Find the Source.",
  spawnYaw: -Math.PI / 2,
  finale: true,
  endings: { exit: "dawn", console: "silence" },
  theme: {
    fog: 0x150a1c,
    fogDensity: 0.042,
    wallTint: 0xc8b0d8,
    floorTint: 0xb098c0,
    lampColor: 0xd08aff,
    skyLight: 0xa888c8,
    groundLight: 0x2a1232,
    walls: "rock",
    fillIntensity: 2.1,
  },
  map: [
    "########################################",
    "#S....#.....R........#.......R.........#",
    "#..a..D.....L.A..N...D...............B.#",
    "#.....#...W..........#....H......M.....#",
    "###.#######.######.######.##############",
    "#.....R......#....b....#......R........#",
    "#..A......L..D.........D......L..N.....#",
    "#......1.....#.........#...............#",
    "########.###############.###########.###",
    "#.......R.......................R......#",
    "#..O........L.............L......O.....#",
    "#........~~~.............~~~...........#",
    "#........~~~.......&.....~~~...........#",
    "#.....c..........................d.....#",
    "#..O........L.............L......O.....#",
    "#.......R.J.......*.............R......#",
    "#################.Z.###########...X#####",
    "########################################",
  ],
  notes: {
    "1": "The Soviet charges are still wired to the cavity walls. The console by the lift triggers all of them. Whoever presses it will not have time to leave. — B. Toktogulov",
  },
  events: {
    start: [radio(op("You came. You really came."), nur("I came to finish it."))],
    bossPhase2: [radio(unknown("...Nur, it's Mara, it doesn't hurt, it doesn't hurt at all..."), nur("You're not her."))],
    bossPhase3: [radio(unknown("...stop, stop, we only wanted to be heard..."))],
    bossDefeated: [
      radio(nur("It's quiet. For the first time since the mountain, it's quiet."), op("...Nur...")),
      objective("Walk out — or trigger the charges and bury the Source for good."),
      checkpoint(),
    ],
  },
  triggers: {
    a: [hint("The Choir only opens its core when it attacks. Shoot the core, and never stand still")],
    // Everything stops. Then every voice it ever took sings Kessler's four notes, and Nur knows where they started.
    b: [
      silence(8),
      sound("choir", 19, 12),
      radio(
        unknown("...listen to us, Nur. Just listen..."),
        nur("Kessler's four notes. That's where it started. A man humming in a hospital bed.")
      ),
    ],
    c: [radio(nur("There. That's the Source.")), objective("Kill the Choir.")],
    d: [radio(nur("The charges' console is by the lift."))],
  },
};
