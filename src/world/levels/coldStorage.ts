import { ask, nur, objective, op, openDoors, ping, radio, shutDoors } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 3 — the keycard, and the first Brute. */
export const COLD_STORAGE: LevelDef = {
  id: "cold-storage",
  name: "Sublevel 8",
  subtitle: "Cold Storage",
  tagline: "Hendricks took the keycard into the freezers. He didn't come back.",
  objective: "Find the security keycard, then reach the exit.",
  spawnYaw: -Math.PI / 2,
  theme: { fog: 0x05070a, wallTint: 0xc4d4e4, floorTint: 0xc8d4e0, lampColor: 0xcfe6ff, skyLight: 0x5a6a80, cold: true },
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
    "#.#######.###+###.#.#.####",
    "#.3.M...#.#.....#...#....#",
    "#.#####.#.#.#####.#####.##",
    "#.#..E#...#.K..E#.#...#..#",
    "#.#.#.#####D###D#.#.#.##.#",
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
      ask(
        "fear",
        [op("Tell me what you're afraid of, Nur. Down here. It helps to say it out loud.")],
        [
          nur("The dark. Being in the dark when something's close."),
          op("Thank you. Then let me help: listen. The keycard is calling you."),
        ],
        [ping()],
        [op("Keep it to yourself, then. I'll find out.")]
      ),
    ],
    // Both freezer doors slam behind you. It can open them. All you have to do is ask: it'll remember that you did.
    // Say nothing, and there's a loose panel in the freezer's back wall.
    keycard: [
      shutDoors([11, 16], [15, 16]),
      radio(nur("It's still warm. Where is he?"), op("Don't look for him.")),
      ask(
        "open",
        [op("The doors have shut behind you, Nur. Both of them."), op("I can open them. You only have to ask me.")],
        [nur("...Open them."), op("There. You see? You only had to ask.")],
        [openDoors([11, 16], [15, 16])],
        [op("Then find your own way out of the cold. There's always a way. Hendricks found one.")]
      ),
      objective("Reach the exit."),
    ],
  },
};
