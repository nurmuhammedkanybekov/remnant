import { aida, checkpoint, hint, objective, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 4 — flooded halls: wading is loud. Security doors and the pump control card. */
export const PUMPING_STATION: LevelDef = {
  id: "pumping-station",
  name: "Sublevel 7",
  subtitle: "Pumping Station",
  objective: "Find the pump control keycard.",
  spawnYaw: -Math.PI / 2,
  theme: { fog: 0x040809, fogDensity: 0.065, wallTint: 0xb4c6bf, floorTint: 0xa8b8b0, skyLight: 0x4a6660, lampColor: 0xd8ffe8 },
  map: [
    "############################",
    "#S...L...#~~~~~~~~#...L....#",
    "#.#####..#~~~~~~~~#.#####..#",
    "#.#A..#..D~~~E~~~~D.#...#..#",
    "#.#...#..#~~~~~~~~#.#.2.#..#",
    "#.##.##..####~#####.##.##..#",
    "#....a....L..~.......L.....#",
    "####.####.###~#####.######=#",
    "#1...#...L..#~#....L...#.R.#",
    "#.####~~~~~~#~#.~~~~~~.#.X.#",
    "#.....~~E~~~D~D~~H~~~..#...#",
    "#.####~~~~~~#~#.~~~~~~.#####",
    "#.#M.#......#~#...R....#...#",
    "#.#..#####.##~####.#####.K.#",
    "#.#.......*..~.........D...#",
    "#.######.####~#####.####...#",
    "#...B....L..~~~..A.....#.E.#",
    "############################",
  ],
  notes: {
    "1": "ARKADIN, LOG 112. It hears the water. Every drop that falls in this station, it hears. We have stopped the pumps. We have stopped talking.",
    "2": "Took the pump control card off what was left of Hendricks. Left it in the east intake for whoever comes next. Wade slowly. — M.",
  },
  events: {
    start: [
      radio(
        op("Seven. The pumping station. When the power went, the lower halls flooded."),
        aida("Everything's under water. Great."),
        op("The east stairwell is behind a security door. You'll need the pump control card.")
      ),
    ],
    keycard: [
      radio(aida("Mara left it here. She's alive. She's ahead of me.")),
      objective("Open the security door to the east stairwell."),
    ],
  },
  triggers: {
    a: [hint("Wading through water is slow and loud — crouch to stay quiet"), checkpoint()],
  },
};
