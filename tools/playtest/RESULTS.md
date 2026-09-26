# Automated playtest results

The bot in this folder played the whole campaign in the production build
after Phase 4. "Average" reacts in 0.7 s, aims ±0.06 rad, fires at most
every 0.5 s and doesn't know the Remnant's weak spot; "good" reacts in 0.4 s,
aims ±0.025 rad and only shoots the core when it's open. Both only react to
creatures they can see in front of them, hear close by, or that just hit
them.

| Run                | Result                              | Deaths | Notes                                                 |
| ------------------ | ----------------------------------- | ------ | ----------------------------------------------------- |
| Normal, good       | Campaign finished                   | 0      | Remnant down in ~2 min                                |
| Normal, average    | Campaign finished                   | 1      | Remnant took ~7 min of shooting the hide              |
| Story, average     | Campaign finished                   | 0      |                                                       |
| Nightmare, good    | Campaign finished                   | 1      | Died once at the Remnant; arrived with almost no ammo |
| Nightmare, average | Still fighting the Remnant at 8 min | 1      | Boss at 38%, no medkits left                          |

## Findings

- **Fixed:** a player who keeps shooting the Remnant's armoured hide could
  run out of ammo in the arena with no way to win. Ammo near the boss now
  restocks while it's awake, soaked hits get their own dull hit marker, and
  a prompt explains the core.
- No level ever blocked progress: every door, keycard, generator and exit
  worked in every run.
- Levels 1–7 cost a route-knowing player almost no health. Not tuned from
  this alone: a first-time player explores, makes noise and gets surprised.
- Players finish levels with 2–3 medkits unused; worth tightening only if
  real players also end up with spares.

## What a bot can't tell you

Whether it's scary, whether the music and sound mix work, whether stealth
is fun (the bot fights rather than sneaks), whether the hints are clear to a
first-time player, and how the gamepad feels on a real controller.
