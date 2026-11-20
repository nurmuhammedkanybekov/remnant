import { checkpoint, hint, ifTrail, nur, objective, op, radio, silence, sound, unknown } from "../../../game/script";
import type { LevelDef } from "../../levelDef";

/**
 * Level 14 — the old Soviet observatory on the ridge above the dam: the Zenit
 * relay the voice broadcasts through. Out along the ridge under the peaks,
 * security doors, and the truth about the voice.
 */
export const OBSERVATORY: LevelDef = {
  id: "kosh-tash-observatory",
  name: "Kosh-Tash",
  subtitle: "Observatory",
  number: 14,
  tagline: "It was never a control room. It was a transmitter.",
  objective: "Cut the Zenit relay: three breaker cabinets.",
  // The relay is the voice's mouth over the valley: its breakers hum on air until you throw them.
  machine: "relay",
  spawnYaw: -Math.PI / 2,
  theme: {
    fog: 0x131924,
    fogDensity: 0.045,
    wallTint: 0xd0d8e8,
    floorTint: 0xc0c8d8,
    lampColor: 0xcfe0ff,
    skyLight: 0x56627a,
    groundLight: 0x0c0e16,
    fillIntensity: 1.3,
    outdoor: "streets",
    cliffs: true,
    skyline: "peaks",
  },
  map: [
    "####################################",
    "#S...#......L.....#...........W....#",
    "#.a..D............D.....K..........#",
    "#....#..W.....1...#.......L........#",
    "##D###############=######=##########",
    "#.......#.......Y......#..........G#",
    "#..E....D..............D.....N.....#",
    "#.......#.....b........#......A....#",
    "#.L..M..#######.########.....C.C...#",
    "#.......#.....#.#......#......A....#",
    "####=####.....#.#..H...###=#########",
    "#G....A.#..Q..#.#......#...........#",
    "#..A....D.....D.D......D.....W.....#",
    "#.......#...3.#.#.c2...#..........G#",
    "#...N...###########D#######...L....#",
    "#.......L.................E...*....#",
    "#J.B..............d...........B..X.#",
    "####################################",
  ],
  notes: {
    "1": "ARKADIN, LOG 201. The Zenit relay is repaired. It hears the cavity perfectly now. The cavity, I think, hears us too. Voices on channel 9 that none of us recorded.",
    "2": "ARKADIN, LOG 214. It learned to speak by listening to the radio. The first word it said was the operator's call sign. Then it asked for us by name.",
    "3": "Night shift, 1991. The boys kept the headphones on after their shift was over. On the last night all four of them sat up there with the headphones on, and none of them came down for breakfast. I left the tray outside the door. — V. Ormonova, cook",
  },
  events: {
    start: [
      radio(
        op("The observatory. I used to watch the stars from here."),
        nur("You were never here. You're in the mountain, talking through that dish."),
        nur("Cut the relay, and the valley stops hearing you.")
      ),
      hint("The relay's breakers hum while they're on air, and creatures come to the noise. Follow it"),
    ],
    keycard: [radio(nur("Security card. The doors to the relay rooms.")), checkpoint()],
    // Each breaker thrown, the voice has less of the valley. It bargains, then it begs.
    machineDone: [
      [
        radio(
          op("Nur. Leave that alone. Two hundred people in the valley are listening to me tonight. I'm all they have."),
          nur("You're all they hear. That's not the same.")
        ),
        checkpoint(),
      ],
      [
        silence(4),
        radio(unknown("...please... it's so quiet when you do that... we don't like it quiet..."), op("Nur. Please. Not the last one.")),
      ],
    ],
    power: [
      silence(6),
      radio(nur("...Nothing. The whole valley, and nothing on the channel."), nur("Now the ridge, and the drainage portal.")),
      // The relay is dead. The radio on your belt isn't: four notes, very quiet. The tune is how it talks.
      sound("hummer"),
      ifTrail(
        1,
        [radio(nur("...My radio. It's humming. His four notes."), nur("It's not on any channel. It's not on at all."))],
        [radio(nur("...Something's humming. On my radio. It isn't even switched on."))]
      ),
      objective("Out along the ridge to the drainage portal."),
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
      objective("Cut the relay. Three breakers; a security card opens the quickest ways to them."),
    ],
  ],
  triggers: {
    a: [hint("Watchers again. Keep your light on them, and keep your battery up")],
    b: [radio(nur("An intercom. Someone left a message."))],
    c: [radio(unknown("...we see you through the big lens, Nur...")), checkpoint()],
    d: [
      radio(
        op("The relay was only a mouth, Nur. I have others. The wells. The water. You."),
        op("The ridge leads to the drainage line. The drainage line leads to me.")
      ),
    ],
  },
};
