import type { LevelDef } from "../levelDef";

export const LEVEL_2: LevelDef = {
  id: "sublevel-2",
  name: "Sublevel 2",
  subtitle: "Cold Storage",
  objective: "Find the security keycard, then reach the exit.",
  spawnYaw: -Math.PI / 2,
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
    "#.#.......L.......#1#..L.#",
    "#.#######.#######.#.#.####",
    "#...M...#.#.....#...#....#",
    "#.#####.#.#.#####.#####.##",
    "#.#..E#...#.K..E#.#...#..#",
    "#.#.#.#####.###.#.#.#.##.#",
    "#R..#.....L...#.....#..X.#",
    "##########################",
  ],
  notes: {
    "1": "Security locked the lift behind a keycard. Hendricks had it on his belt. Hendricks went into the south freezers.",
    "2": "The big one doesn't run. It doesn't need to. Keep moving and keep your light off.",
  },
};
