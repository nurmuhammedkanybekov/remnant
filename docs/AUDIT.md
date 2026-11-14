# REMNANT — Quality audit

An audit of the game as it is built and as it plays, not as the design
documents describe it, followed by what was changed because of it. Findings
are ranked by impact: **Critical** (breaks progression, play or immersion),
**High** (clearly lowers quality), **Medium** (a real improvement), **Low**
(polish).

## How it was audited

- Read the systems that make the experience: the level format and script
  (`game/script.ts`, `levelSession.ts`), lamps, flashlight, doors and
  interactables, creature states and the director, the sound engine and its
  ambience, the HUD, menus and endings, and every level's script.
- Played every level with a bot that walks with real movement and
  collisions (keycards, doors, generators, exits), and stress-tested levels
  with random input on Nightmare, in headless Chromium.
- Looked at rendered frames of the places and moments in question.

**Baseline before changes:** 359 unit tests passing, production build
clean, all 17 levels finished by the walking bot, no console errors.

## What already works well

These were left alone on purpose.

- **The writing.** Notes are short, specific and written by people in a
  hurry; each answers the last one's question. The Operator's arc, Mara's
  notes one floor ahead, Arkadin's logs and the Part One → Part Two link
  hold together.
- **Stealth and senses.** Creatures hunt by sound and light; there's a noise
  model, crouching, holding your breath, thrown bottles, lockers. Watchers
  freeze in your light. A director draws idle creatures towards you so the
  quiet never lasts.
- **Lamps that react.** Lamps flicker, die, pulse in emergency red, stutter
  when a creature is near, and can be shot out.
- **Doors and machines with weight.** Doors judder and slide up into the
  ceiling, generators spin up and hum, the detonator console has a
  two-stage press.
- **Heartbeat and breathing** driven by creatures you can't see.
- **Engineering.** Data-driven levels with a lock-aware checker, a fixed
  pool of real lights (no shader recompiles), host-authoritative co-op,
  versioned saves, tests.

## Findings

| #   | Impact   | Finding                                                                                                                                                                                                                                                                                                                                | Status                          |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | Critical | **Every place sounded the same.** The underground drone, drips, steel creaks and pipe knocks played under the open sky in the village and on the mountain; footsteps on snow were footsteps on concrete. It broke every outdoor scene.                                                                                                 | Fixed                           |
| 2   | High     | **No tools for authored horror.** A level script could only talk (radio), set objectives, show hints, save and raise an alarm. Every scare was systemic; nothing was ever placed for a story beat, so no moment was memorable.                                                                                                         | Fixed                           |
| 3   | High     | **No through-line of dread.** Kessler's humming is the best idea in the notes, and it was only ever read, never heard.                                                                                                                                                                                                                 | Fixed                           |
| 4   | High     | **Laboratory Zero and the Source too dark to read.** One lamp row in the lab; nothing in the cavern but a few red emergency lamps against dark granite and a dim purple fill.                                                                                                                                                          | Fixed (in software rendering)   |
| 5   | Medium   | **Silence never used.** The ambience and music never stopped, so there was no contrast for quiet to be frightening.                                                                                                                                                                                                                    | Fixed                           |
| 6   | Medium   | **Laboratory and cavern had no sound of their own.**                                                                                                                                                                                                                                                                                   | Fixed                           |
| 7   | Medium   | **Darkness-based scares had no floor.** A full blackout would have been a black screen.                                                                                                                                                                                                                                                | Fixed: emergency lamps stay on  |
| 8   | Medium   | **Part Two's objectives repeat Part One's shapes** (keycard, generators, exit) more than its new places deserve.                                                                                                                                                                                                                       | Open                            |
| 9   | Low      | The walking bot reports that it couldn't start some generators or open the Armory's security door on its route. Checked by hand in the running game: every generator in the Power Plant, the dam and Laboratory Zero starts with a real Use press, and the Armory door opens once the keycard is picked up. Bot reach, not a game bug. | Verified, no game change needed |
| 10  | Low      | Notes, death screen and endings are clean and themed; the note reader could show the note as a page rather than text.                                                                                                                                                                                                                  | Open                            |

## What was changed

1. **Soundscapes** (finding 1, 6). Each level has one (`soundscapeOf`):
   mountain concrete, the valley (gusting wind, dull through walls, full
   under the sky; timber straining; something far off, rarely), the
   laboratory (fluorescent hum, ballasts ticking), the cavern (a slow breath
   through the rock). Standing under the sky brings the wind up and drops
   the building's sound away. Snow underfoot crunches.
2. **Horror toolkit** (finding 2, 5, 7). Script actions `blackout`,
   `torchFails`, `silence`, `sound` and `apparition`, checked by the level
   checker. See `GAME_DESIGN.md` → Scripting.
3. **Seven moments and a motif** (finding 2, 3). See `STORY.md` → The
   moments. Kessler's four notes are heard in the infirmary, the Hive and
   Laboratory Zero, and named only in the Source.
4. **Readable dark** (finding 4). Laboratory Zero has its lab lamps; the
   Source has violet work lamps in pools (they can be shot out, which is a
   choice in the boss fight) and a brighter fill. Figures that appear in the
   dark carry a faint pallor so they read as a shape.

## Verification after the changes

- `npm run check`: typecheck, formatting and **363 unit tests** pass (new:
  the horror actions, the level checker's rules for them, soundscapes).
- Production build: clean.
- Walking bot (Story difficulty): all 17 levels finished with real movement,
  same as the baseline, no console errors. It walks out of both finales, so
  the two walk-out endings are reached that way.
- The two detonator endings, pressed in the running game: **SEALED** at the
  top of Part One and **SILENCE** at the Source (the console there stays
  locked, "THE CHOIR GUARDS THE CHARGES", until the Choir is dead).
- Death and retry (Normal): dying shows "Retry Level"; the retry starts a
  fresh attempt at full health with no figure or silence carried over.
- Random-input stress test on Nightmare (levels 1, 5, 9, 10, 12, 16, 17,
  the ones with new moments): no errors.
- Each moment was triggered in the running game and captured as frames:
  the containment blackout and the torch coming back, the villagers in the
  street, the drill-site figure under the red lamp, the lab corridor and the
  Source arena.

## What could not be verified

- **Sound by ear.** The new audio was checked for errors and wiring, not
  listened to: there is no audio output where this was tested. Levels and
  mixes (wind, hum, the hummed tune, the choir) need a pass on headphones.
- **Lighting on a real GPU.** Every frame was rendered in software
  (SwiftShader). Brightness and contrast on real displays will differ; the
  darkest scenes need checking on a laptop panel and a phone.
- **Firefox and Safari.** Only Chromium was available here.
- **Performance on low-end hardware.** No new real-time lights were added
  (lamps share the existing pool), and the sound layers are a handful of
  oscillators and noise sources, but nothing was measured on a slow device.
