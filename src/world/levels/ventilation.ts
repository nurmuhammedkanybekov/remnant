import { nur, hint, objective, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 6 — a maze of ducts, Crawlers overhead, a rivet gun, and the first time the radio lies. */
export const VENTILATION: LevelDef = {
  id: "ventilation",
  name: "Sublevel 5",
  subtitle: "Ventilation",
  tagline: "Count the turns. If the radio tells you a different way, count again.",
  objective: "Find a way through the ducts.",
  spawnYaw: -Math.PI / 2,
  theme: { fog: 0x040404, fogDensity: 0.075, wallTint: 0xb8b2a8, floorTint: 0xa8a298, fillIntensity: 0.8 },
  map: [
    "#############################",
    "#S.a.#.....#..V....#.....####",
    "###.##.###.#.#####.#.###.####",
    "#^2.#..#1#.#.#...#...#B#.####",
    "#.###.##.#.#.#.#.#####.#.####",
    "#.#...#..#.c.#.#.E...#...####",
    "#.#.###.######.#####.###.####",
    "#.#.#.J...L....#...#..4#.####",
    "#.#.#.#######.##.#.###.#.####",
    "#...#.#..Q..#.#..#...#.#.####",
    "#####.#.###.#.#.####.#.#.+.3#",
    "#.....#.#Y#.#.#....#.#...#A.#",
    "#.#####.#.#.#.####.#.###.####",
    "#.#.....#...#.b..J.#.#.A.####",
    "#.#.#########.######.#.######",
    "#...V....*.......E.#...X.####",
    "#############################",
  ],
  notes: {
    "1": "Count the turns: left, left, right. If the radio tells you a different way, count again. It walks you past them on purpose.",
    "2": "MAINTENANCE: rivet guns are NOT to be used with the interlock removed. They will fire across a room. — Site Safety",
    "3": "Someone lived in here long before us: a bedroll, tins stamped 1991, a child's drawing of the sun. Under it: 'Day 212. Still me. The doors upstairs won't open for me any more.'",
    "4": "Scratched into the duct: THE VOICE IS NOT THE SUPERVISOR. THE SUPERVISOR DIED ON DAY TWO. I WAS THERE.",
  },
  events: {
    start: [radio(op("Five is ventilation. It's a maze. Keep your light off and listen before every corner."))],
  },
  intercoms: [
    [
      radio(
        op("Nur. I can see you on the cameras. Go back to the west duct. Hurry — there's something coming up behind you."),
        nur("...Cameras? Nothing down here has had power for eleven days.")
      ),
    ],
  ],
  triggers: {
    a: [
      radio(nur("Tight in here. If one of them finds me in a duct, there's nowhere to go.")),
      hint("Get behind a creature that hasn't noticed you and press {melee} for a silent takedown"),
    ],
    c: [
      radio(
        op("Listen for clicking above you. The crews who stayed in the vents... they don't walk on the floor any more."),
        nur("Great. Look up. Noted.")
      ),
      hint("Crawlers cling to the ceiling and drop when you pass beneath — sneak by, or shoot them down first"),
    ],
    b: [
      radio(
        op("Nur? Are you still there? I haven't said anything for ten minutes."),
        nur("You told me to go back. On the intercom."),
        op("That wasn't me. Whatever you heard, it wasn't me. Keep going. Please.")
      ),
      objective("Reach the stairwell."),
    ],
  },
};
