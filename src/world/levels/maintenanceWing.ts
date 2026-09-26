import { aida, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 2 — stealth against a pack of husks. */
export const MAINTENANCE_WING: LevelDef = {
  id: "maintenance-wing",
  name: "Sublevel 9",
  subtitle: "Maintenance Wing",
  tagline: "Stay off the main corridors.",
  objective: "Find the stairwell.",
  spawnYaw: -Math.PI / 2, // start corridor runs toward +X
  map: [
    "######################",
    "#S.aL....#....L.#....#",
    "#.######.#.###..#.##.#",
    "#.#..B.#.#.#A#..#.#..#",
    "#.#.##.#.#.#.#..#.#.##",
    "#.#.#1.#.#..L...#.#..#",
    "#.#.####.#####.##.##.#",
    "#.#..L...#.....C#....#",
    "#.####.###.#####..#E.#",
    "#....#...#....L...#..#",
    "###.##.#.#######.##.##",
    "#E..L...*......#..L..#",
    "#.#############.##.#.#",
    "#.#O....L....M.....#.#",
    "#.#.##########.#####.#",
    "#...E....2...R.b..X..#",
    "######################",
  ],
  notes: {
    "1": "Ration crates are gone. Whatever came through here ate through the locks first.",
    "2": "If you hear them clicking, don't move. If you hear them breathing, it's already too late.",
  },
  events: {
    start: [radio(op("Nine. The tunnels loop back on themselves. The next stairwell is in the far south-east corner."))],
  },
  triggers: {
    a: [radio(aida("Three of them, at least. I can hear them clicking."), op("Then they can hear you too. Walk. Don't run."))],
    b: [radio(op("You're close. Eight is cold storage. It's where Hendricks went."))],
  },
};
