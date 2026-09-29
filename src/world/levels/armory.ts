import { nur, checkpoint, hint, objective, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 8 — the consortium's security floor. A shotgun, a big open hall, and the Swarm. */
export const ARMORY: LevelDef = {
  id: "armory",
  name: "Sublevel 3",
  subtitle: "Armory",
  tagline: "Don't trust the radio.",
  objective: "Find the armory keycard.",
  spawnYaw: 0,
  theme: { fog: 0x060606, wallTint: 0xc8c4bc, floorTint: 0xb8b4ac, lampColor: 0xfff0d8 },
  map: [
    "###################################",
    "#.T....#.....L.....#...........####",
    "#.A..1.D...........D....L...K..####",
    "#......#..C.....C..#...........####",
    "####D###...........####D###########",
    "#.......b...%...E..............####",
    "#..C....C.........C....C...%...####",
    "#...........L..........L.......####",
    "#..E....C....H....C..........A.####",
    "#..C........T..................####",
    "#......*.....C...C.....H....C..####",
    "#.M..........L..........%......####",
    "####D############=#######D#########",
    "#......#.................#.....####",
    "#.A..B.#..R....X.....R...#.A.M.+.2#",
    "#..!...#.................#..T..#M.#",
    "#......D.................D.....####",
    "#S.....#.................#....3####",
    "###################################",
  ],
  notes: {
    "1": "Don't trust the radio. It knew my name before I told it. It knows yours. I'm going up the long way. — Mara",
    "2": "Security's private locker. The last line in the log: 'Bullets run out. Its voice doesn't. Stop listening to it.'",
    "3": "INVENTORY. Rifles: 40. Shotguns: 12. Rounds: 900. Signed out: everything. Returned: nothing. Remarks: 'They were already inside.'",
  },
  events: {
    start: [
      radio(
        op("Three. Consortium security. There's ammunition on this floor. Take all of it."),
        nur("Why? What's on two?"),
        op("Take all of it.")
      ),
    ],
    keycard: [
      radio(nur("Armory card. The stairwell is right below the main hall.")),
      objective("Open the security door in the main hall."),
    ],
  },
  triggers: {
    b: [
      radio(nur("That's a lot of them. Too many to fight."), nur("And the floor's moving. Rats. Dozens of them.")),
      hint("A Swarm is fast but fragile — the shotgun, or a boot, deals with it"),
      checkpoint(),
    ],
  },
};
