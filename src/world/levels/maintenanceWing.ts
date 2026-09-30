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
    "1": "DAY 4. The break-room radio keeps switching itself on. A calm voice, says it's the surface. The surface line has been dead since the collapse. Petrov talks to it for hours.",
    "2": "They click to find the walls, like bats. If you hear clicking, stop moving. If you hear somebody humming, it used to be one of us.",
    "3": "SHIFT ROTA. Every name after the fourteenth has the same note beside it: 'Heard singing. Sent home.' Nobody was sent home.",
    "4": "ZENIT MAINTENANCE, 1988. Crawlspace sealed after the 'noise incident': three fitters spent a night listening at this vent, and in the morning they could not stop smiling. Do not reopen. Do not listen.",
  },
  events: {
    start: [radio(op("Nine. The tunnels loop back on themselves. The next stairwell is in the far south-east corner."))],
  },
  triggers: {
    a: [radio(nur("Three of them, at least. I can hear them clicking."), op("Then they can hear you too. Walk. Don't run."))],
    b: [radio(op("You're close. Eight is cold storage. It's where Hendricks went."))],
  },
};
