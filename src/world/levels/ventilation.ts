import { aida, objective, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 6 — a maze of ducts, and the first time the radio lies. */
export const VENTILATION: LevelDef = {
  id: "ventilation",
  name: "Sublevel 5",
  subtitle: "Ventilation",
  objective: "Find a way through the ducts.",
  spawnYaw: -Math.PI / 2,
  theme: { fog: 0x040404, fogDensity: 0.075, wallTint: 0xb8b2a8, floorTint: 0xa8a298, fillIntensity: 0.8 },
  map: [
    "##########################",
    "#S.a.#.....#..E....#.....#",
    "###.##.###.#.#####.#.###.#",
    "#...#..#1#.#.#...#...#B#.#",
    "#.###.##.#.#.#.#.#####.#.#",
    "#.#...#..#...#.#.E...#...#",
    "#.#.###.######.#####.###.#",
    "#.#.#.....L....#...#...#.#",
    "#.#.#.#######.##.#.###.#.#",
    "#...#.#..E..#.#..#...#.#.#",
    "#####.#.###.#.#.####.#.#.#",
    "#.....#.#Y#.#.#....#.#...#",
    "#.#####.#.#.#.####.#.###.#",
    "#.#.....#...#.b....#.#.A.#",
    "#.#.#########.######.#.###",
    "#...E....*.......E.#...X.#",
    "##########################",
  ],
  notes: {
    "1": "Note to self: count the turns. Left, left, right. If the radio tells you a different way, count again.",
  },
  events: {
    start: [radio(op("Five is ventilation. It's a maze. Keep your light off and listen before every corner."))],
  },
  intercoms: [
    [
      radio(
        op("Aida. I can see you on the cameras. Go back to the west duct. Hurry — there's something coming up behind you."),
        aida("...Cameras? Nothing down here has had power for eleven days.")
      ),
    ],
  ],
  triggers: {
    a: [radio(aida("Tight in here. If one of them finds me in a duct, there's nowhere to go."))],
    b: [
      radio(
        op("Aida? Are you still there? I haven't said anything for ten minutes."),
        aida("You told me to go back. On the intercom."),
        op("That wasn't me. Whatever you heard, it wasn't me. Keep going. Please.")
      ),
      objective("Reach the stairwell."),
    ],
  },
};
