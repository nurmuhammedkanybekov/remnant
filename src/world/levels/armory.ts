import { alarm, bid, blackout, checkpoint, habitLine, hint, nur, objective, op, radio, sound } from "../../game/script";
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
    "#.T...g#.....L.....#...........####",
    "#.A..1gD...........D....L...K..####",
    "#..gggg#..C.....C..#...........####",
    "####D###...........####D###########",
    "#.......b.c.%...E..............####",
    "#..C....C.c.......C....C...%...####",
    "#.........c.L..........L.......####",
    "#..E....C.c..H....C..........A.####",
    "#..C......c.T..................####",
    "#......*..c..C...C.....H....C..####",
    "#.M.......c..L..........%......####",
    "####D############=#######D#########",
    "#......#.................#.....####",
    "#.A..B.#..R....X.....R...#.A.M.+.2#",
    "#..!...#.................#..T..#M.#",
    "#......D.................D.....####",
    "#S.....#.................#....3####",
    "###################################",
  ],
  notes: {
    "1": "Nur — it's the radio. Every time it talks to you it leaves a little of itself behind; that's how it changes people. I've heard too much. You haven't yet. Don't let it talk you all the way to the top. — Mara",
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
      habitLine(),
    ],
    // The card was on the security desk for a reason: lift it and the armory's alarm goes. The hall you crept through
    // on the way in is awake for the way back, and the lights go to red.
    keycard: [
      sound("siren"),
      alarm(50),
      blackout(25),
      radio(
        nur("Armory card. And an alarm. Of course there's an alarm."),
        op("Everything on this floor heard that, Nur. The security door's in the main hall. Run.")
      ),
      objective("Get back across the hall to the security door."),
    ],
  },
  triggers: {
    b: [
      radio(nur("That's a lot of them. Too many to fight."), nur("And the floor's moving. Rats. Dozens of them.")),
      hint("A Swarm is fast but fragile — the shotgun, or a boot, deals with it"),
      checkpoint(),
    ],
    // The first lie. It has your trust by now, or it hasn't; this is how it finds out. Mara's note is in that room.
    c: [
      bid(
        "store",
        [
          op("Nur, listen to me. The swarm's waking. The store, top left, through the door. Get in and keep still."),
          op("Go. Now. I'll tell you when it's passed."),
        ],
        { kind: "go", zone: "g" },
        40,
        [alarm(48), radio(op("I'm sorry, Nur."), op("I wanted to know if you'd still go where I sent you."))],
        [radio(op("You didn't go."), op("...Good. You're learning. So am I."))]
      ),
    ],
    g: [],
  },
};
