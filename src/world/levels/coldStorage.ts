import { nur, objective, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 3 — the keycard, and the first Brute. */
export const COLD_STORAGE: LevelDef = {
  id: "cold-storage",
  name: "Sublevel 8",
  subtitle: "Cold Storage",
  tagline: "Hendricks took the keycard into the freezers. He didn't come back.",
  objective: "Find the security keycard, then reach the exit.",
  spawnYaw: -Math.PI / 2,
  theme: { fog: 0x05070a, wallTint: 0xc4d4e4, floorTint: 0xc8d4e0, lampColor: 0xcfe6ff, skyLight: 0x5a6a80 },
  map: [
    "##########################",
    "#S...L....#.....C...L....#",
    "#.###.###.#.###.#.#####..#",
    "#.#A....#...#...#.#..2#..#",
    "#.#.###.#####.###.#.###..#",
    "#...#.L.#...L...#.#......#",
    "###.#.###.#####.#.####.###",
    "#...#...#.#.B.#.#......#.#",
    "#.#####.#.#.#.#.######.#.#",
    "#.#.....#...#...#..H...#.#",
    "#.#.#########.###.###.##.#",
    "#.#..*....L.......#1#..L.#",
    "#.#######.#######.#.#.####",
    "#.3.M...#.#.....#...#....#",
    "#.#####.#.#.#####.#####.##",
    "#.#..E#...#.K..E#.#...#..#",
    "#.#.#.#####.###.#.#.#.##.#",
    "#R..#.....L...#.....#..X.#",
    "#############+############",
    "#############.4###########",
    "#############A.###########",
    "##########################",
  ],
  notes: {
    "1": "SECURITY: the lift keycard stays with Hendricks. Nobody goes up until the samples are packed and cold. — Site Management",
    "2": "The big one in the freezers used to be three of us. I know by the boots. Kept close, they grow together. It doesn't run. It doesn't need to. — Orlov, kitchens",
    "3": "Nur — the radio asked me my name, and I told it. Now when it says it, something in my head answers before I do. It has to learn you before it can have you. Give it nothing. — Mara",
    "4": "HENDRICKS — personal. Head office wants one live sample topside before anyone asks questions. If the freezers go bad, I blow the shafts and nobody leaves. Nobody was meant to leave anyway.",
  },
  events: {
    start: [
      radio(
        op("Eight. The exit up is locked. Consortium security took the keycard into the freezers."),
        nur("Hendricks. Head of security. He was the one who said it was safe.")
      ),
    ],
    keycard: [radio(nur("It's still warm. Where is he?"), op("Don't look for him. Just go.")), objective("Reach the exit.")],
  },
};
