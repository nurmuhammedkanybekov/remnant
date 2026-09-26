import { aida, checkpoint, objective, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 7 — restart three generators. Each one is loud, and keeps being loud. */
export const POWER_PLANT: LevelDef = {
  id: "power-plant",
  name: "Sublevel 4",
  subtitle: "Power Plant",
  objective: "Start the generators",
  spawnYaw: -Math.PI / 2,
  theme: { fog: 0x080604, wallTint: 0xe6d6bc, floorTint: 0xd0c0a8, lampColor: 0xffb870, skyLight: 0x6a5a48, groundLight: 0x201408 },
  map: [
    "##############################",
    "#S....L.....#.........L....X.#",
    "#.C......C..#..O.........O...#",
    "#......a....#......E.........#",
    "#.C..G...C..D....G.....C.....#",
    "#...........#................#",
    "######.######.......L........#",
    "#...........##########D#######",
    "#.1....E....#................#",
    "#......L....D......H.........#",
    "#..O.....O..#....O.......O...#",
    "#.....G.....#.......*........#",
    "#...........#......L.....E...#",
    "#####D#######.............2..#",
    "#...........#................#",
    "#.A...M..B..D......A.........#",
    "#...........#................#",
    "##############################",
  ],
  notes: {
    "1": "SHIFT LOG: Lift runs off the backup generators. All three. If one trips, the lift stops wherever it is. Do not be in it when that happens.",
    "2": "The generators are loud. The things come to the noise. Start one, then run. Start the next, then run. That's the whole plan. — M.",
  },
  events: {
    start: [
      radio(
        op("Four. The power plant. The lift to the surface needs all three generators running."),
        aida("And the noise?"),
        op("The noise will bring them. Start a generator, then get out of the way.")
      ),
    ],
    power: [
      radio(op("Power. Good. The lift is waking up."), op("Now come up to me, Aida. Come up."), aida("...Why does that sound different?")),
      objective("Take the stairwell up."),
      checkpoint(),
    ],
  },
  triggers: {
    a: [radio(aida("The exit's right there. Dead. No power."))],
  },
};
