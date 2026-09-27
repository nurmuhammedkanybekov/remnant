import { checkpoint, hint, nur, objective, op, radio, unknown } from "../../../game/script";
import type { LevelDef } from "../../levelDef";

/** Level 16 — beneath Sublevel 10, the original drill site. Everything the mountain has, and two generators. */
export const THE_DEEP: LevelDef = {
  id: "beneath-ten",
  name: "Beneath Ten",
  subtitle: "The Deep",
  number: 16,
  tagline: "Under the floor you woke up on.",
  objective: "Restore power to the cavity lift.",
  spawnYaw: -Math.PI / 2,
  theme: {
    fog: 0x0c0404,
    fogDensity: 0.06,
    wallTint: 0xd8b8b0,
    floorTint: 0xc4a8a0,
    lampColor: 0xff8a70,
    skyLight: 0x5a3a36,
    groundLight: 0x160606,
  },
  map: [
    "############################################",
    "#S....#..........R.......#.........%.......#",
    "#..a..D....W.............D....V........B...#",
    "#.....#......~~~~~~......#.........P.......#",
    "###.######...~~~~~~...######.#########.#####",
    "#.......#....~~~~~~...#....#.#.......#.....#",
    "#..G....#......N......#..1.#.#...U...D..H..#",
    "#.......D.............D....#.#.......#.....#",
    "####.####....b........######.####=####.....#",
    "#.......#.............#......#.......#..A..#",
    "#..P....#######.#######..H...D...K...#.....#",
    "#.......#.....#.#.....#......#.......###.###",
    "#...M...D..Q..#.D..2..#####.##########.....#",
    "#.......#.....#.#.....#.....c.......W......#",
    "####D#########.#########.....R......#..N...#",
    "#.......R....................~~~~...#......#",
    "#..%........U.........*......~~~~...D...G..#",
    "#.......L.......A...........d.......#..X...#",
    "############################################",
  ],
  notes: {
    "1": "ARKADIN, LOG 1. Drill head at 2,610 metres broke into a void. Warm air. A sound like many people breathing in at once. We have named it the Remnant, for what it has left of the rock.",
    "2": "ARKADIN, LAST LOG. It isn't one thing. It's a choir. Every mind it takes adds a voice. I have asked to be added. I would like to hear the whole song.",
  },
  events: {
    start: [radio(op("Beneath ten. You're nearly home."), nur("I was never home. I was just on top of you."))],
    keycard: [radio(nur("The drill-site card. The lower gate is open now.")), checkpoint()],
    power: [
      radio(op("Yes. Come down to us. All of us."), nur("I'm coming. Not for the reason you think.")),
      objective("Take the cavity lift down."),
      checkpoint(),
    ],
  },
  triggers: {
    a: [hint("Every creature the mountain has is down here. Pick your fights, and count your bullets")],
    b: [radio(unknown("...we remember you, Nur. You walked past us in the infirmary. You were so quiet...")), checkpoint()],
    c: [radio(nur("The drill site. The shaft goes straight down into the dark.")), objective("Start both generators for the cavity lift.")],
    d: [radio(op("Lower. Lower. We're singing for you."))],
  },
};
