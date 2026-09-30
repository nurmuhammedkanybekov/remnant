import { nur, objective, radio, unknown } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 10 — the top of the lift shaft. One more push past what's left, then walk out, or bring the mountain down. */
export const LIFT_SHAFT: LevelDef = {
  id: "lift-shaft",
  name: "Surface",
  subtitle: "Lift Shaft",
  tagline: "Daylight, or the dark. Nobody else gets to choose.",
  objective: "Reach the blast door.",
  spawnYaw: -Math.PI / 2,
  finale: true,
  theme: {
    fog: 0x0b0d12,
    fogDensity: 0.045,
    wallTint: 0xc8ccd4,
    floorTint: 0xb8bcc4,
    lampColor: 0xe0ecff,
    skyLight: 0x8090a8,
    fillIntensity: 1.5,
  },
  notes: {
    "1": "SURFACE CREW ROSTER, taped inside the hatch. Forty-one names. Forty have been scratched out. The one left is yours.",
    "2": "ARKADIN, LOG 190 (1991). I have built the blast doors to open only for the unchanged, and wired this shaft all the way down. If it ever learns to wear one of us well enough to pass, bring the mountain down.",
  },
  map: [
    "########################",
    "#S....L.....D......L...#",
    "#.C....C....#..........#",
    "#...........#....a.....#",
    "#.C..E.C....#......Z...#",
    "#.....L....2#..........#",
    "######D######....L..X..#",
    "#.T....V.....#.........#",
    "#.M....A.....D.H.......#",
    "#......L.....#.........#",
    "###########+############",
    "###########.1###########",
    "###########B.###########",
    "########################",
  ],
  events: {
    start: [
      radio(
        unknown("The surface, Nur. Snow. Air. The blast door will open for you. Only for you."),
        nur("And you come with me. In me."),
        unknown("We only want to see the sky.")
      ),
    ],
  },
  triggers: {
    a: [
      radio(
        nur("Arkadin's charges. Wired all the way down the shaft, thirty years ago."),
        nur("If I press that, nothing comes out of this mountain. Including me.")
      ),
      objective("Walk out through the blast door — or trigger the charges."),
    ],
  },
};
