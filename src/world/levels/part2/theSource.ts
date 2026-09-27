import { checkpoint, hint, nur, objective, op, radio, unknown } from "../../../game/script";
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
    fog: 0x0a040e,
    fogDensity: 0.05,
    wallTint: 0xc8b0d8,
    floorTint: 0xb098c0,
    lampColor: 0xd08aff,
    skyLight: 0x4a3458,
    groundLight: 0x120616,
  },
  map: [
    "########################################",
    "#S....#.....R........#.......R.........#",
    "#..a..D.......A..N...D...............B.#",
    "#.....#...W..........#....H......M.....#",
    "###.#######.######.######.##############",
    "#.....R......#....b....#......R........#",
    "#..A.........D.........D.........N.....#",
    "#......1.....#.........#...............#",
    "########.###############.###########.###",
    "#.......R.......................R......#",
    "#..O.............................O.....#",
    "#........~~~.............~~~...........#",
    "#........~~~.......&.....~~~...........#",
    "#.....c..........................d.....#",
    "#..O.............................O.....#",
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
    b: [radio(unknown("...listen to us, Nur. Just listen..."))],
    c: [radio(nur("There. That's the Source.")), objective("Kill the Choir.")],
    d: [radio(nur("The charges' console is by the lift."))],
  },
};
