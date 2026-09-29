import { nur, checkpoint, hint, objective, radio, unknown } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 9 — the Remnant has grown into the whole sublevel. The Operator stops pretending, and the mass itself blocks the lift. */
export const HIVE: LevelDef = {
  id: "hive",
  name: "Sublevel 2",
  subtitle: "The Hive",
  tagline: "The walls are warm here.",
  objective: "Get through the hive.",
  spawnYaw: -Math.PI / 2,
  theme: {
    fog: 0x0a0304,
    fogDensity: 0.07,
    wallTint: 0xa87468,
    floorTint: 0x8e5c52,
    lampColor: 0xff6a4a,
    skyLight: 0x6a2a24,
    groundLight: 0x1a0606,
    fillIntensity: 0.9,
  },
  map: [
    "############################################",
    "#S..L....#.....O...#....R....###############",
    "#.#####..#.###...#.#.######..###############",
    "#.#1..#....#U..#.#...#..A#...###############",
    "#.#..A#.####.###.#####.###.#.###############",
    "#.##.##.#..R...#.......#...#.###############",
    "#....a..#.####.#.#####.#.###.###.R..X..R.###",
    "######.##.#..#.#.#...#.#.#...###.........###",
    "#......#..#H.#...#.W.#...#.#.###.C.....C.###",
    "#.####.#.##..#####.###.###.#.###....@....###",
    "#.#..*.#....L......#...#...#.###.........###",
    "#.#.##.###.#######.#.#.#.###.###L.O...O.L###",
    "#.#.#MJ..#...O.#...#.#...#.P.###.........###",
    "#...#.##.#.###.#.###.#####.#.###..C...C..###",
    "###.#..#...#2#.#.#.....H...#.###....R....###",
    "#...##.#####.#.#.#.###.###.#.###.O.....O.###",
    "#.V....R.......#...#b..*.....###.........###",
    "#.####.#######.#####.#.####..*cD.........###",
    "#.T....B.....#.......#.......###T.A.M.A.T###",
    "########################+###################",
    "########################.3##################",
    "########################M.##################",
    "############################################",
  ],
  notes: {
    "1": "It isn't eating them. It's keeping them. You can hear them in there, talking. All of them at once.",
    "2": "Nur. It's me. It's Mara. It doesn't hurt. Come and see. It's warm here and nobody is ever alone.",
    "3": "Mara's pack, empty but for a photograph of a village in the valley. On the back: 'If I don't come out, go there. Tell them to leave.'",
  },
  events: {
    start: [radio(nur("The walls are... soft. Warm. It's grown through everything."), unknown("Keep going, Nur. You're nearly home."))],
    bossPhase2: [radio(unknown("You can't kill forty-one people twice, Nur."))],
    bossPhase3: [radio(unknown("Stop. Stop. We only wanted to see the sky."))],
    bossDefeated: [
      radio(
        nur("It's down. It's not moving."),
        unknown("That was only a part of us, Nur. We are in every wall. We are waiting at the top."),
        nur("...Then I'll see you there.")
      ),
      objective("Reach the lift shaft."),
      checkpoint(),
    ],
  },
  triggers: {
    a: [radio(nur("You're not in a control room. Are you."), unknown("We are in every room.")), checkpoint()],
    b: [
      radio(
        unknown("You were always going to come up. We need you to. We need someone whole."),
        unknown("The blast doors only open for an unchanged crew member. Only for you."),
        nur("So that's it. You need me to carry you out.")
      ),
      objective("Find a way through to the lift."),
    ],
    c: [
      radio(unknown("Come in, Nur. Come and see us. All of us."), nur("That's it. That's the core. And the lift is right behind it.")),
      objective("Kill the Remnant. Shoot the core when it opens."),
      hint("The hide soaks up bullets — hit the core while it's open, just after it attacks"),
    ],
  },
};
