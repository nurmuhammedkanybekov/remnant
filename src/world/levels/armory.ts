import { aida, checkpoint, hint, objective, op, radio } from "../../game/script";
import type { LevelDef } from "../levelDef";

/** Level 8 — the consortium's security floor. A shotgun, a big open hall, and the Swarm. */
export const ARMORY: LevelDef = {
  id: "armory",
  name: "Sublevel 3",
  subtitle: "Armory",
  objective: "Find the armory keycard.",
  spawnYaw: 0,
  theme: { fog: 0x060606, wallTint: 0xc8c4bc, floorTint: 0xb8b4ac, lampColor: 0xfff0d8 },
  map: [
    "################################",
    "#.T....#.....L.....#...........#",
    "#.A..1.D...........D....L...K..#",
    "#......#..C.....C..#...........#",
    "####D###...........####D########",
    "#.......b...%...E..............#",
    "#..C....C.........C....C...%...#",
    "#...........L..........L.......#",
    "#..E....C....H....C..........A.#",
    "#..C........T..................#",
    "#......*.....C...C.....H....C..#",
    "#.M..........L..........%......#",
    "####D############=#######D######",
    "#......#.................#.....#",
    "#.A..B.#..R....X.....R...#.A.M.#",
    "#..!...#.................#..T..#",
    "#......D.................D.....#",
    "#S.....#.................#.....#",
    "################################",
  ],
  notes: {
    "1": "Don't trust the radio. It knew my name before I told it. It knows yours. I'm going up the long way. — Mara",
  },
  events: {
    start: [
      radio(
        op("Three. Consortium security. There's ammunition on this floor. Take all of it."),
        aida("Why? What's on two?"),
        op("Take all of it.")
      ),
    ],
    keycard: [
      radio(aida("Armory card. The stairwell is right below the main hall.")),
      objective("Open the security door in the main hall."),
    ],
  },
  triggers: {
    b: [
      radio(aida("That's a lot of them. Too many to fight."), aida("And the floor's moving. Rats. Dozens of them.")),
      hint("A Swarm is fast but fragile — the shotgun, or a boot, deals with it"),
      checkpoint(),
    ],
  },
};
