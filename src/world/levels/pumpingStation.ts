import { nur, checkpoint, hint, objective, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 4 — flooded halls: wading is loud, and the first Listener hears every step. */
export const PUMPING_STATION: LevelDef = {
  id: "pumping-station",
  name: "Sublevel 7",
  subtitle: "Pumping Station",
  tagline: "It hears the water. It hears everything.",
  objective: "Find the pump control keycard.",
  spawnYaw: -Math.PI / 2,
  theme: { fog: 0x040809, fogDensity: 0.065, wallTint: 0xb4c6bf, floorTint: 0xa8b8b0, skyLight: 0x4a6660, lampColor: 0xd8ffe8 },
  map: [
    "############################",
    "#S...L...#~~~~~~~~#...L....#",
    "#.#####..#~~~~~~~~#.#####..#",
    "#.#A..#..D~~~U~~~~D.#...#..#",
    "#.#...#..#~~~~~~~~#.#.2.#..#",
    "#.##.##..####~#####.##.##..#",
    "#....a....L.b~.......L.....#",
    "####.####.###~#####.######=#",
    "#1...#...L..#~#....L...#.R.#",
    "#.####~~~~~~#~#.~~~~~~.#.X.#",
    "#.....~~U~~~D~D~~H~~~..#...#",
    "#.####~~~~~~#~#.~~~~~~.#####",
    "#.#M.#......#~#...R....#...#",
    "#.#..#####.##~####.#####.K.#",
    "#.#.......*..~.........D...#",
    "#.######.####~#####.####...#",
    "#...B....L..~~~..A.....#.E.#",
    "#######+####################",
    "#######.3###################",
    "#######M.###################",
    "############################",
  ],
  notes: {
    "1": "ARKADIN, LOG 112 (1988). It hears the water. Every drop in this station, it hears. It learns from voices, so we give it none: we have stopped the pumps, and we have stopped talking.",
    "2": "Took the pump control card off what was left of Hendricks. The collapse was him: the detonator was still in his hand. Card's in the east intake for whoever comes next. Wade slowly. — M.",
    "3": "ARKADIN, LOG 98 (1988). We built this room so we could talk without being heard. Tonight the walls answered in Sergei's voice. Sergei has been dead for a month.",
  },
  events: {
    start: [
      radio(
        op("Seven. The pumping station. When the power went, the lower halls flooded."),
        nur("Everything's under water. Great."),
        op("The east stairwell is behind a security door. You'll need the pump control card.")
      ),
    ],
    keycard: [radio(nur("Mara left it here. She's alive. She's ahead of me.")), objective("Open the security door to the east stairwell.")],
  },
  triggers: {
    a: [hint("Wading through water is slow and loud — crouch to stay quiet"), checkpoint()],
    b: [
      radio(
        op("Nur. There's one in the flooded hall that doesn't see at all. It hears. Everything."),
        nur("No eyes. Its head is split open like a... like an ear.")
      ),
      hint("Listeners are blind — your flashlight won't give you away, but every sound will"),
    ],
  },
};
