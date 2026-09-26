import { aida, objective, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 3 — the keycard, and the first Brute. */
export const COLD_STORAGE: LevelDef = {
  id: "cold-storage",
  name: "Sublevel 8",
  subtitle: "Cold Storage",
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
    "##########################",
  ],
  notes: {
    "1": "Security locked the lift behind a keycard. Hendricks had it on his belt. Hendricks went into the south freezers.",
    "2": "The big one doesn't run. It doesn't need to. Keep moving and keep your light off.",
    "3": "Aida — the radio voice asked me my name. I told it. Then it used it, like it had known it all along. Probably nothing. — Mara",
  },
  events: {
    start: [
      radio(
        op("Eight. The exit up is locked. Consortium security took the keycard into the freezers."),
        aida("Hendricks. Head of security. He was the one who said it was safe.")
      ),
    ],
    keycard: [radio(aida("It's still warm. Where is he?"), op("Don't look for him. Just go.")), objective("Reach the exit.")],
  },
};
