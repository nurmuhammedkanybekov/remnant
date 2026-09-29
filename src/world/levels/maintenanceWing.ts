import { nur, op, radio } from "../../game/script";
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
    "#########################",
    "#S.aL....#....L.#....####",
    "#.######.#.###..#.##.####",
    "#.#..B.#.#.#A#..#.#..####",
    "#.#.##.#.#.#.#..#.#.#####",
    "#.#.#1.#.#..L...#.#..####",
    "#.#.####.#####.##.##.####",
    "#.#..L...#.....C#....####",
    "#.####.###.#####..#E.####",
    "#....#...#....L...#..+.4#",
    "###.##.#.#######.##.##B.#",
    "#E..L...*......#..L..####",
    "#.#############3##.#.####",
    "#.#O....L....M.....#.####",
    "#.#.##########.#####.####",
    "#...E....2...R.b..X..####",
    "#########################",
  ],
  notes: {
    "1": "Ration crates are gone. Whatever came through here ate through the locks first.",
    "2": "If you hear them clicking, don't move. If you hear them breathing, it's already too late.",
    "3": "SHIFT ROTA. Every name after the fourteenth has the same note beside it: 'Heard singing. Sent home.' Nobody was sent home.",
    "4": "ZENIT MAINTENANCE, 1988. Crawlspace sealed after the noise incident. Do not reopen. The noise is not in the pipes.",
  },
  events: {
    start: [radio(op("Nine. The tunnels loop back on themselves. The next stairwell is in the far south-east corner."))],
  },
  triggers: {
    a: [radio(nur("Three of them, at least. I can hear them clicking."), op("Then they can hear you too. Walk. Don't run."))],
    b: [radio(op("You're close. Eight is cold storage. It's where Hendricks went."))],
  },
};
