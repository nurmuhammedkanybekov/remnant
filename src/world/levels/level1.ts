import type { LevelDef } from "../level";

export const LEVEL_1: LevelDef = {
  id: "sublevel-3",
  name: "Sublevel 3",
  subtitle: "Maintenance Wing",
  objective: "Find the exit.",
  spawnYaw: -Math.PI / 2, // start corridor runs toward +X
  map: [
    "######################",
    "#S..L....#....L.#....#",
    "#.######.#.###..#.##.#",
    "#.#..B.#.#.#A#..#.#..#",
    "#.#.##.#.#.#.#..#.#.##",
    "#.#.#1.#.#..L...#.#..#",
    "#.#.####.#####.##.##.#",
    "#.#..L...#.....C#....#",
    "#.####.###.#####..#E.#",
    "#....#...#....L...#..#",
    "###.##.#.#######.##.##",
    "#E..L..........#..L..#",
    "#.#############.##.#.#",
    "#.#O....L....M.....#.#",
    "#.#.##########.#####.#",
    "#...E....2...R....X..#",
    "######################",
  ],
  notes: {
    "1": "Ration crates are gone. Whatever came through here ate through the locks first.",
    "2": "If you hear them clicking, don't move. If you hear them breathing, it's already too late.",
  },
};
