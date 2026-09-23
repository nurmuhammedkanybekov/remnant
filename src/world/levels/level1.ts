// Legend: # wall  . floor  S player start  X exit/objective
//          A ammo pickup  M medkit pickup  E enemy spawn
//          1,2 note pickups (text keyed by digit in LEVEL_1_NOTES)
export const LEVEL_1_NAME = "Sublevel 3 — Maintenance Wing";

export const LEVEL_1_MAP: string[] = [
  "####################",
  "#S.......#.....#...#",
  "#.######.#.###.#.#.#",
  "#.#....#.#.#A#.#.#.#",
  "#.#.##.#.#.#.#.#.#.#",
  "#.#.#1.#.#...#.#.#.#",
  "#.#.####.#####.#.#.#",
  "#.#......#.....#.#.#",
  "#.####.###.#####.#.#",
  "#....#...#.......#.#",
  "###.##.#.#########.#",
  "#E..............#..#",
  "#.##############.##.#",
  "#.#............M....#",
  "#.#.##########.#####.#",
  "#...E......2......X.#",
  "####################",
];

export const LEVEL_1_NOTES: Record<string, string> = {
  "1": "Field note: Ration crates are gone. Whatever came through here ate through the locks first.",
  "2": "Field note: If you hear them clicking, don't move. If you hear them breathing, it's already too late.",
};
