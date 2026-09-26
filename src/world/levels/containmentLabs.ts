import { aida, hint, objective, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 5 — the original Zenit laboratories, and the Watchers: light is now a weapon and a risk. */
export const CONTAINMENT_LABS: LevelDef = {
  id: "containment-labs",
  name: "Sublevel 6",
  subtitle: "Containment Labs",
  tagline: "Sample R-7 is to be kept in darkness.",
  objective: "Find a keycard for the security door.",
  spawnYaw: Math.PI,
  theme: { fog: 0x06070a, wallTint: 0xdde2ea, floorTint: 0xd0d6de, lampColor: 0xe8f4ff, skyLight: 0x606a78 },
  map: [
    "##############################",
    "#S.......#.......L.#.........#",
    "#.....L..#.C.....C.#...E.....#",
    "#..1.....#....W....#.2....A..#",
    "#..A.....#.C..3..C.#.........#",
    "#####D#########D########D#####",
    "#...a.........L.c........*...#",
    "#####D#########D#####=########",
    "#.........#....b.H..#........#",
    "#..W...L..#..C...C..#...L....#",
    "#....M....#....K....#......X.#",
    "#.4.......#..C...C..#..R.....#",
    "#.........#.E.....B.#........#",
    "##############################",
  ],
  notes: {
    "1": "ZENIT — LAB 3 PROTOCOL. Sample R-7 is to be kept in darkness at 4°C. It is not to be spoken to. (Someone has underlined 'spoken' three times.)",
    "2": "ARKADIN, LOG 140. R-7 has begun repeating the words we say near it. Tonight it said my daughter's name. I have never said her name down here.",
    "3": "CONSORTIUM MEMO: all Zenit-era material is scrap. Anything 'soft' goes to the incinerator. Do NOT open containment. — Site Management",
    "4": "Kessler talked his way into the labs. He wanted to see it. He came out smiling. None of us had ever seen him smile.",
  },
  events: {
    start: [
      radio(
        op("Six. The old Zenit laboratories. Whatever they were studying is still in there."),
        aida("You sound like you know what they were studying."),
        op("I've read the files. The stairwell is behind a security door. Find a keycard.")
      ),
    ],
    keycard: [radio(aida("Lab clearance. Arkadin, L. This thing is older than I am.")), objective("Open the security door.")],
  },
  triggers: {
    a: [radio(op("Every door you open makes noise. Open them, then move."))],
    b: [radio(aida("Something big in here. Breathing slow."))],
    c: [
      radio(
        op("Some of them in the labs can't stand light. Keep your torch on one and it locks up."),
        aida("And when the battery dies?"),
        op("Then don't let it die.")
      ),
      hint("Watchers freeze while your flashlight is on them — and they're fast when it isn't"),
    ],
  },
};
