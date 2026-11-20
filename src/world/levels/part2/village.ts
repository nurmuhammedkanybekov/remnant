import {
  alarm,
  apparition,
  bid,
  checkpoint,
  habitLine,
  hint,
  nur,
  objective,
  op,
  radio,
  silence,
  sound,
  torchFails,
  unknown,
} from "../../../game/script";
import type { LevelDef } from "../../levelDef";

/** Level 12 — the village. Houses, a square, two ways round. The Howler: if it sees you, everything hears. */
export const VILLAGE: LevelDef = {
  id: "ak-suu-village",
  name: "Ak-Suu",
  subtitle: "The Village",
  number: 12,
  tagline: "Every door is open. Every house is warm.",
  objective: "Find the key to the bus garage.",
  spawnYaw: -Math.PI / 2,
  // Timber houses and a muddy square under a snow-grey sky: warmer and browner than anything in the mountain.
  theme: {
    fog: 0x161b22,
    fogDensity: 0.04,
    wallTint: 0xc8b49c,
    floorTint: 0x8f8270,
    lampColor: 0xffc27a,
    skyLight: 0x8c98aa,
    groundLight: 0x1a140c,
    fillIntensity: 1.35,
    outdoor: "streets",
    walls: "timber",
    cliffs: true,
    skyline: "peaks",
  },
  map: [
    "##################################",
    "#S...#.......#.......#.....#.....#",
    "#..a.D...E...D...L...D..N..D..A..#",
    "#....#.......#.B...3.#.....#.....#",
    "##D#####A#########D#####D#####D###",
    "#.....................b..........#",
    "#..L......~~~~~.......N.J...L....#",
    "#.........~~~~~..................#",
    "#####D#####.....######D#####..####",
    "#.....#...#..c..#.........#.....%#",
    "#..1..#.E.D.....D....K....D..Q...#",
    "#.....#...#.....#.........#......#",
    "#######f###.....#####.#####......#",
    "#...........W.....L..........d...#",
    "#..M..B...........E........###D###",
    "#.....A......2.........e...#..X..#",
    "##################################",
  ],
  hum: "3",
  notes: {
    "1": "Garage key is on the hook in the teacher's house, like always. If you're reading this, take the bus and don't stop until Karakol. — Asel",
    "2": "One of them stood in the square and screamed and the rest came from every house at once. Don't let the tall one see you. — (no name)",
    // Kessler's trail: someone hums his four notes from here until you find it.
    "3": "Granny has hummed it over the washing ever since the well water came up grey. She says it isn't a song, it's the way home, and soon everyone who knows it will go home together. I don't want to go home. — Aibek, 9",
  },
  events: {
    start: [
      radio(op("The bus in the garage still runs. The dam road goes up the valley. That's where everyone is."), nur("Everyone. Right.")),
      habitLine(),
    ],
    keycard: [radio(nur("The garage key. Now let's hope the bus starts quietly.")), objective("Get to the bus garage."), checkpoint()],
  },
  triggers: {
    a: [
      hint("Howlers scream when they see you, and everything nearby comes running. Take them first, and quietly"),
      objective("Find the key to the bus garage."),
    ],
    // The people of Ak-Suu, standing in the snow with their backs to you. Put your light on them and they're gone.
    b: [
      silence(6),
      apparition("husk", 16, 7, "away"),
      apparition("husk", 19, 5, "away"),
      apparition("husk", 28, 7, "away"),
      radio(unknown("...we're in the houses, Nur. It's warm here. Leave the door open.")),
      checkpoint(),
    ],
    c: [radio(nur("The school. The desks are still in rows."))],
    d: [radio(op("The garage is just ahead. Such a long way you've come."))],
    e: [radio(nur("Something big is moving in the square.")), alarm(14)],
    // Was there anything behind you? It tells you at the end, and it doesn't say the same thing both ways.
    f: [
      bid(
        "still",
        [op("Stop. Don't move, Nur. Not one step."), op("It's right behind you. If you don't move, it can't see you.")],
        { kind: "still" },
        6,
        [sound("breath"), radio(op("...It's gone. You can breathe."))],
        [sound("scream"), torchFails(2), radio(op("I told you not to move."))]
      ),
    ],
  },
};
