import { nur, checkpoint, hint, objective, op, radio, unknown } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 1 — the tutorial. Wake up, meet the Operator, learn to be quiet. */
export const INFIRMARY: LevelDef = {
  id: "infirmary",
  name: "Sublevel 10",
  subtitle: "Infirmary",
  tagline: "You wake up on the lowest floor of a mountain. The radio is already talking.",
  objective: "Answer the intercom.",
  spawnYaw: -Math.PI / 2,
  theme: { wallTint: 0xd4e2de, floorTint: 0xc8d4d2, lampColor: 0xdff0ff, fog: 0x050808 },
  map: [
    "########################",
    "#S..Y#.....L..#....M...#",
    "#.a..D.b......D........#",
    "#.L..#........#..####..#",
    "##.###..####..#..#..#..#",
    "#1..##..#..#..#..#E.#.A#",
    "#...#...#........#..#..#",
    "#.###...#.2#..c..##.#..#",
    "#.#B#...####.........*.#",
    "#.#.#......L....####...#",
    "#...###.#####.###..#.###",
    "#.....#.#...#.#.E..#...#",
    "#.###.#.#.A.#.#.####.#.#",
    "#..L..#.....#...d....#X#",
    "#########+##############",
    "#########.3#############",
    "#########M.#############",
    "########################",
  ],
  notes: {
    "1": "PATIENT 14 — KESSLER, T. Drilling crew, admitted day 3 with 'mineral dermatitis'. Hums the same four notes all night. By day 5 the whole drill crew hums them. None of them can say where they heard it.",
    "2": "Nur — you hit your head in the collapse. I've kept you sedated, in the dark, with the radio unplugged. Don't ask why yet. If you wake before I'm back: keep your light off, and never tell the radio anything about yourself. — Mara",
    "3": "Supplies I hid from the others. They stopped eating on day six and sat by the radio instead, listening. You slept through all of it. That's why you're still you. — M.",
  },
  events: {
    start: [radio(unknown("...is anyone on ten? Anyone at all? Pick up the intercom."), nur("My head. How long was I out?"))],
  },
  intercoms: [
    [
      radio(
        op("You're alive. Good. I'm in the control room on the surface. Call me the Operator."),
        op("The shafts collapsed eleven days ago. The stairwells are the only way up, and you're at the very bottom."),
        op("There are people down there who aren't people any more. They can't see. They hear everything."),
        op("The stairwell is past the east ward. Go slowly.")
      ),
      objective("Reach the stairwell."),
      hint("Press {interact} to open doors"),
    ],
  ],
  triggers: {
    a: [hint("Press {flashlight} for your flashlight — it drains fast")],
    b: [hint("Hold {crouch} to crouch. Crouching is nearly silent")],
    c: [radio(op("Something is moving in the east ward. Stay low. Don't run."), nur("Is that... Kessler? From drilling?")), checkpoint()],
    d: [radio(op("The stairwell. Nine is the old maintenance wing. Stay off the main corridors."))],
  },
};
