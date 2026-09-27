import { checkpoint, hint, nur, objective, op, radio, unknown } from "../../../game/script";
import type { LevelDef } from "../../levelDef";

/** Level 14 — the old Soviet observatory above the dam: the relay. Security doors, and the truth about the voice. */
export const OBSERVATORY: LevelDef = {
  id: "kosh-tash-observatory",
  name: "Kosh-Tash",
  subtitle: "Observatory",
  number: 14,
  tagline: "It was never a control room. It was a transmitter.",
  objective: "Find the security keycard.",
  spawnYaw: -Math.PI / 2,
  theme: {
    fog: 0x070a12,
    fogDensity: 0.055,
    wallTint: 0xd0d8e8,
    floorTint: 0xc0c8d8,
    lampColor: 0xcfe0ff,
    skyLight: 0x56627a,
    groundLight: 0x0c0e16,
  },
  map: [
    "####################################",
    "#S...#......L.....#...........W....#",
    "#.a..D............D.....K..........#",
    "#....#..W.....1...#.......L........#",
    "##D###############=######=##########",
    "#.......#.......Y......#...........#",
    "#..E....D..............D.....N.....#",
    "#.......#.....b........#......A....#",
    "#.L..M..#######.########.....C.C...#",
    "#.......#.....#.#......#...........#",
    "####=####.....#.#..H...###=#########",
    "#.......#..Q..#.#......#...........#",
    "#..A....D.....D.D......D.....W.....#",
    "#.......#.....#.#..2...#...........#",
    "#...N...###########c#######...L....#",
    "#.......L.................E...*....#",
    "#..B..............d...........B..X.#",
    "####################################",
  ],
  notes: {
    "1": "ARKADIN, LOG 201. The Zenit relay is repaired. It hears the cavity perfectly now. The cavity, I think, hears us too. Voices on channel 9 that none of us recorded.",
    "2": "ARKADIN, LOG 214. It learned to speak by listening to the radio. The first word it said was the operator's call sign. Then it asked for us by name.",
  },
  events: {
    start: [radio(op("The observatory. I used to watch the stars from here."), nur("You were never here. You're in the mountain."))],
    keycard: [
      radio(nur("Security card. Now the transmitter room.")),
      objective("Reach the transmitter room, then the exit."),
      checkpoint(),
    ],
  },
  intercoms: [
    [
      radio(
        unknown("...this is Zenit relay, recorded message, 1991..."),
        unknown("...if you can hear the operator, it is not the operator. Do not answer it. It uses the voice we gave it..."),
        nur("So that's what you are. A recording that learned to talk."),
        op("I'm everyone who ever spoke on this channel, Nur. Now come down and join them.")
      ),
      objective("Find the security keycard."),
    ],
  ],
  triggers: {
    a: [hint("Watchers again. Keep your light on them, and keep your battery up")],
    b: [radio(nur("An intercom. Someone left a message."))],
    c: [radio(unknown("...we see you through the big lens, Nur...")), checkpoint()],
    d: [radio(op("The exit leads to the drainage line. The drainage line leads to me."))],
  },
};
