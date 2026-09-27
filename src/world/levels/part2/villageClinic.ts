import { checkpoint, hint, nur, objective, op, radio, unknown } from "../../../game/script";
import type { LevelDef } from "../../levelDef";

/** Level 11 — Part Two begins. The clinic at Ak-Suu, three weeks later. The valley is infected. */
export const VILLAGE_CLINIC: LevelDef = {
  id: "ak-suu-clinic",
  name: "Ak-Suu",
  subtitle: "Clinic",
  number: 11,
  tagline: "You got out. The mountain followed you down.",
  objective: "Find out where everyone went.",
  spawnYaw: -Math.PI / 2,
  theme: {
    fog: 0x0a0d12,
    fogDensity: 0.055,
    wallTint: 0xe8e4dc,
    floorTint: 0xd6d0c4,
    lampColor: 0xfff0d8,
    skyLight: 0x6a7684,
    groundLight: 0x16140f,
  },
  map: [
    "############################",
    "#S..#.......L.....#....B...#",
    "#...D.............D........#",
    "#.L.#..C..1...C...#...E....#",
    "##.###########D#######D#####",
    "#.a..................b.....#",
    "#..~~~.....L.....~~~...L...#",
    "#..~~~.....E.....~~~.......#",
    "###D########.#######D#######",
    "#......#.....E.....#.......#",
    "#..A...D.....U.....#...M...#",
    "#......#...........D.......#",
    "#..2...#.c...L.....#..A..X.#",
    "############################",
  ],
  notes: {
    "1": "Patient in bed 3 (the engineer from the mountain) woke twice in the night and asked us to turn the radio off. There is no radio in bed 3's room. — Dr. Sadykova",
    "2": "Nur — the well water came up grey this morning. Everyone who drank it went quiet and walked toward the dam. Don't drink anything. I'm going after my son. — Sadykova",
  },
  events: {
    start: [
      radio(
        unknown("...Ak-Suu clinic. Ak-Suu clinic. Is anyone at the radio?"),
        nur("No. Not again. Not that voice."),
        op("You made it down the mountain. I'm glad. I kept a channel open for you, Nur.")
      ),
    ],
  },
  triggers: {
    a: [hint("Part Two is harder than Part One. Keep to the dark and let them pass")],
    b: [
      radio(
        op("The village is empty because they're all at the dam. They were thirsty. Come and see."),
        nur("I'm not going anywhere you want me to go.")
      ),
      objective("Get out of the clinic and into the village."),
    ],
    c: [radio(nur("They're from the village. I knew her. She sold bread by the bus stop.")), checkpoint()],
  },
};
