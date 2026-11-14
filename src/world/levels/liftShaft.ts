import { checkpoint, nur, objective, radio, silence, sound, unknown } from "../../game/script";
import type { LevelDef } from "../levelDef";

/**
 * Level 10 — the top of the shaft, and out. The lift opens into the portal
 * hall where Arkadin wired the charges; past the blast door is the mountain
 * itself: the old portal yard under the open sky, the peaks all round, and
 * the road down to the valley. Walk down it, or go back in and bring the
 * mountain down.
 */
export const LIFT_SHAFT: LevelDef = {
  id: "lift-shaft",
  name: "Surface",
  subtitle: "The Portal",
  tagline: "Two and a half kilometres of dark. Then stars.",
  objective: "Open the blast door.",
  spawnYaw: Math.PI,
  finale: true,
  theme: {
    fog: 0x161b24,
    fogDensity: 0.032,
    wallTint: 0xc8ccd4,
    floorTint: 0xb8bcc4,
    lampColor: 0xe0ecff,
    skyLight: 0x8c98ae,
    groundLight: 0x14161c,
    fillIntensity: 1.45,
    outdoor: "streets",
    cliffs: true,
    skyline: "peaks",
  },
  notes: {
    "1": "SURFACE CREW ROSTER, taped inside the lift hatch. Forty-one names. Forty have been scratched out. The one left is yours.",
    "2": "ARKADIN, LOG 190 (1991). I have built the blast door to open only for the unchanged, and wired this shaft all the way down. If it ever learns to wear one of us well enough to pass, bring the mountain down. The console is by the door. It does not need a second press.",
  },
  map: [
    "################################",
    "#S..L....#...............#...T.#",
    "#.C....C.#........L......D.A...#",
    "#..1.....#...........#...#..B..#",
    "#.....Z.aD.b.............#######",
    "#....2...#...L....E............#",
    "#.O....L.#.....................#",
    "#........#.....##.......E..W...#",
    "####+#####.....#...............#",
    "####.M####.M...........L.......#",
    "##########..........##......L..#",
    "##########..#......H......c..X.#",
    "##########.......A.............#",
    "################################",
  ],
  events: {
    start: [
      radio(
        unknown("The lift stopped, Nur. Can you feel it? Cold air. Real air."),
        unknown("One door left. It opens for you. Only for you."),
        nur("Because I'm the only one it hasn't finished with.")
      ),
    ],
  },
  triggers: {
    a: [
      radio(
        nur("Arkadin's console. Charges all the way down the shaft, thirty years old and still live."),
        nur("If I press it, nothing comes out of this mountain. Me included.")
      ),
      objective("Open the blast door."),
    ],
    // Out under the sky, everything drops away: no drone, no machines, no wind. Just the stars.
    b: [
      silence(9),
      radio(
        nur("Stars. I'd forgotten there were stars."),
        unknown("Look at them, Nur. We never saw them. Not once, in all those years in the rock."),
        unknown("The road goes all the way down to the valley. Walk us down.")
      ),
      objective("Take the road down the mountain — or go back in and trigger the charges."),
      checkpoint(),
    ],
    // Behind you, three knocks on the blast door. From the inside. Leave, or go back to the console past it.
    c: [
      sound("knock", 9, 4),
      radio(
        nur("...Three knocks. On the inside of the door."),
        unknown("Don't look back, Nur. A few more steps. Then the valley. Then everyone."),
        nur("Everyone. That's the part I keep hearing.")
      ),
    ],
  },
};
