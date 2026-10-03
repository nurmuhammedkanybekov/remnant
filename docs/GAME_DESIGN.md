# REMNANT — Technical & Design Documentation

A browser based first person survival horror shooter. Doom's structural
simplicity (grid levels, primitive geometry, almost no external assets) carrying a
scarcity/stealth layer borrowed from The Last of Us: limited ammo and battery,
no health regen, and enemies that hunt by sound as much as sight.

This document maps what exists today — every system, the tunable numbers, and
the known gaps.

---

## 1. Quick facts

|              |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine       | Three.js r166 (WebGL) + its `EffectComposer` post-processing                                                                                                                                                                                                                                                                                                                                                                                |
| Language     | TypeScript (strict)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Build        | Vite 5                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Runtime deps | `three`; `@metered-ca/realtime` (co-op matchmaking) and `firebase` (cloud-save sign-in), both loaded only when used                                                                                                                                                                                                                                                                                                                         |
| Assets       | Textures are painted onto `<canvas>` at startup, the large surfaces over CC0 photo scans in `public/textures/` (~1.6 MB, credited in `CREDITS.md`); music and most audio are synthesized with the Web Audio API. Weapon, footstep, creature, door and a few other sounds are CC0 recordings in `public/sfx/` (~1 MB, credited in `CREDITS.md`), each with a synthesized fallback. (UI fonts load from Google Fonts, with system fallbacks.) |
| Levels       | 10 hand-authored grid maps with scripted story beats (see `STORY.md`)                                                                                                                                                                                                                                                                                                                                                                       |

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build -> dist/
```

Append `?debug` to the URL to expose `window.game` (see §13).

---

## 2. Architecture

```
src/
├── main.ts                    Bootstraps `new Game(#app)`
├── game/                      Orchestration
│   ├── game.ts                App shell: main loop, state machine, menus, campaign flow
│   ├── levelSession.ts        One level of gameplay: player, enemies, weapon, pickups, rules
│   ├── menuBackdrop.ts        The live 3D scene behind the main menu
│   ├── save.ts                Versioned save data: campaign checkpoint, unlocks, best times
│   ├── remotePlayer.ts        Co-op: the other player's figure, headlamp and footsteps
│   ├── characterModel.ts      The partner's body, built for each character look
│   ├── loadout.ts             What carries between levels
│   └── stats.ts               Run statistics
├── content/                   Game data — balancing is a data change, not a code change
│   ├── enemies.ts             Enemy definitions and map glyphs
│   ├── weapons.ts             Weapon definitions
│   ├── items.ts               Pickup amounts and glow colours
│   ├── difficulty.ts          Difficulty modes
│   └── characters.ts          The three player characters: names, looks, voice
├── core/
│   ├── engine.ts              Renderer, tone mapping, post-processing, world + viewmodel scenes
│   ├── input.ts               Raw keyboard / mouse / wheel / gamepad / pointer-lock state
│   ├── gamepad.ts             The gamepad layout and stick response
│   ├── quality.ts             Graphics quality presets
│   ├── actions.ts             Named actions, default bindings, rebinding rules
│   ├── settings.ts            Settings (incl. bindings) with validation
│   ├── storage.ts             localStorage JSON that never throws
│   └── clock.ts               Clamped delta time
├── world/
│   ├── levelDef.ts            The authored level format
│   ├── levelParser.ts         Text map → grid + spawns (pure, no WebGL)
│   ├── levelValidator.ts      "Is this level completable?" checks
│   ├── levelBuilder.ts        Parsed level → Three.js geometry, props, exit
│   ├── grid.ts                Collision, line of sight, bullet raycasts
│   ├── pathfinding.ts         Grid BFS
│   ├── lamps.ts               Pooled ceiling lights with flicker behaviours
│   └── levels/                The campaign levels, in play order
├── player/
│   ├── command.ts             PlayerCommand: per-frame intent, built from input
│   ├── playerController.ts    Movement, crouch/sprint, stamina, head-bob, recoil, camera shake
│   ├── flashlight.ts          Spotlight, battery, beam sway, low-battery flicker
│   └── health.ts              HP, mercy frames, damage source
├── weapons/                   Weapon state machine and first-person viewmodels
├── enemies/
│   ├── enemy.ts               The shared AI state machine and creature traits
│   ├── boss.ts                The Remnant
│   ├── bodies.ts              Per-type rigs: humanoid variants, rat, the Remnant's mass
│   ├── projectiles.ts         Lobbed acid
│   └── enemyManager.ts        Spawning (incl. mid-level), noise, hit tests, threat
├── net/                       Co-op networking
│   ├── cloud.ts               Cloud saves: sign-in state, pull-merge-push, upload debounce
│   ├── firebaseBackend.ts     Firebase sign-in + Firestore REST for cloud saves
│   ├── meteredSignaling.ts    Matchmaking over Metered Realtime (the default)
│   ├── signaling.ts           Matchmaking over a PeerJS-protocol server (tests, self-hosting)
│   ├── ice.ts                 STUN/TURN servers and the relay's state
│   ├── timer.ts               A keep-alive timer background tabs don't throttle
│   ├── link.ts                WebRTC connection: reliable + fast data channels, timeouts
│   └── protocol.ts            Room codes and every message the two games exchange
├── items/pickup.ts            Pickup meshes and animation
├── fx/                        Procedural canvas textures, particles
├── audio/soundManager.ts      Synth SFX, stereo panning, wall muffling, reverb, ambience
├── audio/music.ts             Adaptive in-level music: layers and intensity
└── ui/                        HUD, menus, inventory, styles
```

Unit tests live next to the code they cover (`*.test.ts`).

### Layers

```
      Input ──buildCommand──► PlayerCommand
                                   │
Game (shell) ──creates──► LevelSession.step(dt, command)
   │  menus, saves,               │  player · enemies · weapon · pickups · exit
   │  campaign flow               ▼
   │                     world/grid (collision, LOS, raycasts)
   └──────── Engine / SoundManager / Hud (shared services)
```

- **`Game`** owns long-lived services and moves between states. It never
  touches gameplay objects directly.
- **`LevelSession`** is created fresh for every level attempt and discarded
  afterwards, so no state can leak between levels or retries.
- **`PlayerCommand`** is the only way intent enters the simulation. Keyboard,
  the debug harness and (in Phase 6) a remote player all produce commands.
- **Content** is data. The level parser learns enemy glyphs from
  `content/enemies.ts`, so a new creature is placeable as soon as it's defined.

---

## 3. Game flow

```
title ──any key──► menu ──New Game / Chapters──► difficulty ──► card ──► playing ──exit──► levelComplete ──Continue──► card (next level)
  ▲  └─Continue (saved run)─────────────────────┘ │ ▲                         (last level) ► victory ──► menu
  │                                           Esc │ │ Resume
  │                                               ▼ │
  └──────────────Quit───────────────────────── paused ──Restart──► playing
playing ──health 0──► dead ──Retry──► playing (same level, same starting loadout)
                          └─(Ironman, Aizi)──► run over, save deleted ──► menu
```

- A **loading screen** is plain HTML, so it shows before any script runs;
  if WebGL can't start it says so instead of leaving a black page. Then a
  **title screen** waits for a key or button (browsers only allow audio
  after one) and the ambient drone starts.
- The **main menu** renders a slowly turning view of the Maintenance Wing
  behind it, with a depth gauge of the shaft (every sublevel, lit up as far
  as you've climbed) and an intercepted radio fragment along the bottom.
- Entering a level from a menu or the results screen shows its **title
  card**: the sublevel number, name, a one-line tagline, the objective and
  where it sits in the shaft. Any key, click or A starts it. Retrying after
  a death skips the card.
- A new game from the first level opens with the **prologue**; the last
  level ends with one of **two endings** (`content/story.ts`).
- **Saving** (`game/save.ts`): the run is saved whenever a level starts,
  when one is completed, and at every **mid-level checkpoint**. A checkpoint
  stores the player's position, loadout, stats and which pickups, kills,
  doors, generators, intercoms and triggers are already done
  (`game/checkpoint.ts`); on death the player can retry from it or restart
  the level. "Continue" resumes at the start of the saved
  level with the loadout you entered it with (from a checkpoint, the
  loadout you had when you reached it). Reaching a level unlocks it in
  **Chapters**. Best clear time per level is recorded. The save is one
  versioned JSON document; anything malformed is repaired field by field
  rather than discarded, and older versions are migrated (v1 → v2 shifted
  level indices when the campaign grew from two levels to ten; v2 → v3 moved
  the single pistol into a multi-weapon loadout and dropped mid-level
  checkpoints, whose indices no longer matched the redesigned levels).
- **Carry-over**: health, battery, weapons, ammo and medkits carry into the
  next level, with health and battery topped up to the difficulty's floors
  so a bad run isn't unwinnable. Ammunition is not topped up: it's found by
  searching. Retrying after a death (from a checkpoint or the level's start)
  tops the pistol up to the difficulty's ammo floor, so an empty gun can't
  trap you in a loop of deaths. Starting from a later chapter hands you the
  weapons you would have found on the way.
- If pointer lock is refused (browsers block re-locking right after Esc), the
  HUD shows "CLICK TO RESUME" and clicking the view re-locks.

Per playing frame, `Game` builds a `PlayerCommand` and calls
`LevelSession.step`: player → enemies → weapon → shooting → pickups → lamps
→ particles → viewmodel → post-fx/audio → HUD → exit check.

### Difficulty (`content/difficulty.ts`)

|                                       | Story   | Normal  | Nightmare | Ironman | Aizi    |
| ------------------------------------- | ------- | ------- | --------- | ------- | ------- |
| Extra creatures per level             | —       | +80%    | +130%     | +80%    | +180%   |
| Enemy health                          | ×0.7    | ×1      | ×1.35     | ×1      | ×1.6    |
| Enemy damage                          | ×0.5    | ×1.25   | ×1.75     | ×1.25   | ×2.2    |
| Enemy sight & hearing                 | ×0.75   | ×1.1    | ×1.3      | ×1.1    | ×1.5    |
| Enemy chase speed                     | ×0.9    | ×1.1    | ×1.2      | ×1.1    | ×1.3    |
| Pickup amounts                        | ×1.5    | ×1      | ×1        | ×1      | ×0.7    |
| Supply pickups on each level          | ×1.4    | ×1      | ×1        | ×1      | ×0.65   |
| Flashlight drain                      | ×0.6    | ×1      | ×1.3      | ×1      | ×1.5    |
| Starting reserve ammo                 | 32      | 16      | 12        | 16      | 8       |
| Starting medkits                      | 2       | 1       | 0         | 1       | 0       |
| Health / battery floor between levels | 70 / 50 | 40 / 30 | 25 / 20   | 40 / 30 | 15 / 15 |
| Pistol ammo floor on a retry          | 32      | 24      | 16        | 24      | 8       |
| Lives                                 | ∞       | ∞       | ∞         | **1**   | **1**   |

**Extra creatures** (`world/reinforcements.ts`) come on top of each level's
hand-placed ones: that fraction of its own count, a small level counting as four (at most 14 more), plus
another +40% in co-op, where creatures also have ×1.3 health. Placement is
seeded by the level and amount, so it's the same every time (and for both
co-op players, and checkpoint indices stay valid): only kinds already on the
level (the story's introductions hold), at least 6 cells' walk from the
start, 6 m apart, 16 m from the boss, never on doors, machines, checkpoints
or the exit.

---

## 4. Rendering

- **Physically based lights.** Three.js r155+ uses physical light units, so
  intensities are in candela. (The original build used `3.2` for the
  flashlight, which is near-invisible in these units — the main reason it
  rendered almost black.)
- ACES filmic tone mapping, exposure 1.15, sRGB output.
- **Light in the air**: every ceiling lamp throws a faint cone of light
  down through the dust, and a co-op partner's torch shows as a beam, so you
  see where they're looking (`fx/beams.ts`: an open cone drawn additively,
  brightest on its axis and near its source; one transparent draw each, no
  real volumetrics). A lamp's cone flickers with it and goes when it's shot.
- **Brightness**: a gamma lift in the final pass (raises the shadows, keeps
  black black), set on first launch on a screen of three marks on black
  (the left one should be only just visible; its preview runs through the
  same curve as an SVG filter), and in Settings later.
- **Automatic quality** (`core/qualityGuard.ts`): while you play it watches
  the frame rate in four-second windows after a warm-up; two slow windows
  (under 28 fps) in a row and the graphics step down a level, with a line on
  screen saying so. Can be switched off in Settings.
- **Shadows**: the flashlight casts them (soft PCF; 1024 on Medium, 2048 on
  High, none on Low), and everything solid casts and catches them
  (`core/shadows.ts`; glass, water, decals and glows are left out). Shadows
  are drawn from the faces turned towards the light, so walking into a prop
  (they don't block you) doesn't snuff your light out.
- **Post-processing** (`engine.ts`): world pass → ambient occlusion (GTAO,
  High only: corners and contact darken) → viewmodel pass (depth cleared, so
  the gun never clips into walls) → output pass → a custom shader: a grade
  (colour drained, blacks crushed, shadows cold and green, highlights a dirty
  warm), film grain, vignette, chromatic aberration that spikes when you're
  hit, red-tinted desaturation as health drops below 40%, and cinema bars
  behind the menu.
- **Light budget is fixed** so shaders never recompile mid-level: 1 hemisphere
  fill, 6 pooled lamp lights, 1 exit light, the flashlight, and a muzzle-flash
  light that is always present (intensity 0 when idle).
- **Textures** are built once on a canvas (`fx/textures.ts`). The surfaces
  — walls, floor, ceiling, crates, barrels, door plate and hazard paint —
  start from CC0 photo-scanned materials in `public/textures/` (colour,
  normal and roughness maps, loaded behind the boot screen by `loadPhotos`),
  and the game paints its own details over them: panel seams and rivets
  (also carved into the normal map), a steel kick-plate and hazard stripe,
  water streaks, blood, floor tile joints, the ceiling's T-bar grid, crate
  frames. Creatures get a wrinkled-hide normal map. If a photo fails to
  load, that surface is painted from scratch as before and uses its colour
  as a bump map. Normal maps are off on the Low preset. Wall faces pick
  one of four mirrored/shifted variants in the vertex shader (hash of cell
  and face) so the same stain never lines up along a corridor. Also painted:
  medkit, paper, EXIT sign, glow/flash sprites, bullet holes, vein glow.
- Walls, crates and barrels are `InstancedMesh`es (one draw call each).
- Fog: `FogExp2(0x050607, 0.06)`.

### Lamps (`world/lamps.ts`)

`L` (warm) and `R` (red emergency) tiles place a ceiling fixture + halo.
Behaviours cycle by index: steady, flicker, dying (mostly dark with bursts),
and pulse for emergency lights. The 6 real lights are reassigned each frame
to the nearest lamps within 26 units, fading near the cutoff. Distant lamps
still glow; they just don't cast light.

---

## 5. Levels

One character = one 4×4 world-unit cell. Wall height 3.2.

| Char    | Meaning                                    | Char    | Meaning                             |
| ------- | ------------------------------------------ | ------- | ----------------------------------- |
| `#`     | wall                                       | `.`     | floor                               |
| `S`     | player spawn                               | `X`     | exit                                |
| `E`     | husk                                       | `H`     | brute                               |
| `U`     | listener                                   | `W`     | watcher                             |
| `V`     | crawler                                    | `P`     | spitter                             |
| `%`     | swarm (a pack of rats)                     | `Q`     | mimic                               |
| `@`     | the Remnant (boss, one per level)          |         |                                     |
| `A`     | pistol ammo                                | `M`     | medkit                              |
| `T`     | shotgun shells                             | `J`     | rivets                              |
| `!`     | shotgun                                    | `^`     | rivet gun                           |
| `B`     | battery                                    | `K`     | keycard                             |
| `L`     | ceiling lamp                               | `R`     | red emergency lamp                  |
| `C`     | crate stack (solid)                        | `O`     | barrels (solid)                     |
| `D`     | door                                       | `=`     | security door (needs the keycard)   |
| `G`     | generator (solid)                          | `Y`     | intercom                            |
| `~`     | shallow water                              | `*`     | checkpoint                          |
| `Z`     | detonator console (finale only)            | `0`–`9` | note, text from the level's `notes` |
| `a`–`z` | invisible trigger, runs `triggers[letter]` | `+`     | loose panel (hidden room)           |

A level is a `LevelDef`: map, notes, spawn facing, and optionally
`triggers`, `intercoms`, `events` (`start`, `keycard`, `power`,
`bossPhase2`, `bossPhase3`, `bossDefeated`), a `theme`
and the `finale` flag. Enemy glyphs come from `content/enemies.ts`. The
parser rejects unknown characters, missing or duplicate spawns/exits, notes
or triggers without text, and intercom counts that don't match their
scripts, with an error naming the level and cell.

**Locks.** If a level has security doors, the keycard opens them; otherwise
it unlocks the exit. If a level has generators, the exit has no power until
every one is running. If a level has a boss, the exit stays sealed until
it's dead.

**Water** is two thin, dark, glossy layers over each flooded cell, each with
a seamless ripple normal map (whole-number wave frequencies, so it tiles
from cell to cell) drifting its own way (`animateWater`). The floor tiles
barely show through; your light and the lamps glint on the moving ripples.

**Set dressing** (`world/dressing.ts`). Every open area of 2×2 cells or
more is a room with a purpose from the level's list (`LEVEL_DRESSING`,
biggest rooms first): wards, surgery and a morgue in the infirmary; a
workshop, lockers and bunks in maintenance; freezers and a butchery in cold
storage; pump halls; Arkadin's labs; generator and switch rooms; the armory
with its racks nearly all empty. Each is furnished against its walls
(beds, IV stands, lockers, desks with terminals, shelves, freezers, meat
hooks, benches, tool racks, bunks, pipes and valves, specimen tanks,
control panels, growths in the hive), and gets a stencilled sign by its
entrance in Russian with the consortium's English under it (ПАЛАТА 1 /
WARD 1). Every note lies on a small table where it was left; two or three
of the dead lie under tarps in quiet corners.

Each level also has a style (`STYLES`) for its services and small things.
The corridors carry one connected network (`CorridorRun`: which sides each
corridor cell continues through, and where it meets a room): a bundle of
pipes along one pair of walls, each pipe at its own distance from them so
the bundle turns corners together, joined by elbows, with flanges at the
joints, hangers on rods from the ceiling, paint bands, the odd valve
handwheel and gauge, and blanked-off ends; where a corridor opens into a
room the pipes turn up into the ceiling. The pipes are painted to the
Soviet code (green water, red steam, blue air, yellow gas) or lagged with
strapped insulation. A cable tray runs along the other walls; ventilation
has square ducts instead. By level: cold storage frosts its pipes, hangs
icicles off them and the tops of freezer walls, lays frost on the floor and
hangs PVC strip curtains in the freezer doorways; the labs have benches of
glassware and reagents, fume hoods, specimen tanks, a centrifuge, cages,
Arkadin's chalkboard (R-7's frequency, "ГОЛОС = ПЕРЕНОСЧИК", the voice is
the carrier) and one restraint chair; the infirmary has cubicle curtains,
glass-fronted medicine cabinets, wheelchairs, trolleys, an operating table
under its lamp and a wall of morgue drawers; the pumping station has pumps
with their motors and pressure vessels; the power plant switchboards and a
transformer; the armory ammunition boxes and sandbags; the hive pods and
strands of sinew across its corridors. Walls carry extinguishers, junction
boxes with conduit, stopped clocks, gauges, posters (the station's own and
the consortium's) and, from ventilation on, what the crew scrawled
("НЕ ОТВЕЧАЙ ГОЛОСУ", "IT KNOWS YOUR NAME"); floors have papers, stains
and frost.

**Story scenes** (`world/storyScenes.ts`, listed in docs/STORY.md). Every
note has a hand-built scene around it showing what it says, and some rooms
have one the notes don't mention. A note's scene stands against a wall of
its cell (or the nearest cell that has one), in its own frame with the
wall at +Z, and stays out of the middle of the cell where the note lies;
the random dressing leaves scene cells alone. Documents and wall writing
are canvas textures; writing on the wall is transparent and offset so it
sits on the plates.

Planned purely and seeded (the same for every co-op player), built as one
merged mesh per material (posters and scrawls per texture): about 15–25
draw calls and 15–200k triangles a level. Props stand against walls and
stay clear of pickups, so collision stays with the map.

**Hiding.** Every level has lockers to climb into (`hideLocker`, about five,
spread out against bare walls in rooms, or in corridors if the rooms run
out; never by a pickup or the start). Facing one from the front within 1.6
units, the use key gets in: the light goes off, you look out through the
slats (±0.6 rad, ±0.35 up and down), and you can't move, fire or heal.
Creatures can't see you (`Perception.hidden`), and your breathing carries
only 55% as far, so holding it still matters. A creature that could see you
at the moment you got in knows which locker: it comes, and its strike drags
you out (any damage while hidden ejects you, with a jolt). Anything else
walks past. In co-op the state rides on the player stream (`hid`): your
body disappears for the others, and the host's creatures can't see you
either. Getting in or out makes a little noise.

**The menu.** Behind the main menu the camera drifts through the places the
story happened, one slow 16 s push each (the listening circle, R-7's cell,
the 1991 camp, the cocoons, Arkadin's charges, Hendricks), framed right of
centre clear of the menu and faded through black between them. In some of
them the light stutters, and when it steadies someone is standing at the
edge of it; the next stutter, they're gone (`game/menuBackdrop.ts`).

**Hidden rooms.** A `+` is a loose panel: a door (`DoorSpawn.panel`) that
wears the walls' own material over the whole cell, with only a faint seam
and pry marks to give it away. Use pries it loose (quietly, noise 4, where a
door's motor is 9) and it drops away; the results screen counts **secrets
found**. Every level has one, off its right or bottom edge (three columns or
rows added there, so nothing already on the map moves), holding a note and a
medkit, battery or ammunition. Creatures never open panels.

**Themes** (`world/theme.ts`) set fog colour and density, fill light, wall
and floor tint and lamp colour per level.

| #   | Level                         | Creatures                                              | What's new                                      |
| --- | ----------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| 1   | Sublevel 10 — Infirmary       | 2 husks                                                | Tutorial, intercom, doors, hints                |
| 2   | Sublevel 9 — Maintenance Wing | 3 husks                                                | Stealth                                         |
| 3   | Sublevel 8 — Cold Storage     | 2 husks, brute                                         | Keycard-locked exit, first Brute                |
| 4   | Sublevel 7 — Pumping Station  | 2 listeners, husk, brute                               | Water, security doors, first Listener           |
| 5   | Sublevel 6 — Containment Labs | 2 watchers, 2 husks, brute                             | Doors everywhere, first Watcher                 |
| 6   | Sublevel 5 — Ventilation      | 2 crawlers, mimic, 2 husks                             | Duct maze, takedowns, rivet gun, the radio lies |
| 7   | Sublevel 4 — Power Plant      | 2 spitters, husk, brute                                | Three generators power the exit                 |
| 8   | Sublevel 3 — Armory           | 3 swarms (18 rats), 2 husks, 2 brutes                  | Shotgun, big open hall                          |
| 9   | Sublevel 2 — The Hive         | listener, watcher, crawler, spitter, 2 brutes, Remnant | Everything so far, then the boss arena          |
| 10  | Surface — Lift Shaft          | husk, crawler, brute                                   | The choice: leave, or trigger the charges       |

The exit is a door + EXIT sign mounted on the wall next to the `X` cell. Its
sign and light turn red while locked.

### Interaction (`world/interactables.ts`)

Doors, generators, intercoms and the detonator console implement
`Interactable`: a position, a reach, a prompt and `interact()`. Each frame
the session picks the closest one within reach and within 55° of where the
player is looking, and shows `[E] OPEN DOOR`.

- **Doors** block movement, sight and pathfinding until opened, then
  retract into the ceiling. Opening one makes noise (radius 9).
- **Generators** are loud to start (radius 26) and keep thrumming every
  4.5 s (radius 11), so running generators keep drawing creatures.
- **Intercoms** play their script once.

### Scripting (`game/script.ts`)

Story beats are data. Triggers, intercoms and level events hold lists of
actions: `radio` (subtitled lines from the Operator, Nur or an unknown
voice), `objective`, `hint` (with `{action}` placeholders replaced by the
player's current key binding), `checkpoint` and `alarm`. The radio plays one
line at a time on the simulation clock, so pausing pauses the conversation.

### Collision & raycasts (`world/grid.ts`)

- `resolveCollision` — circle vs. grid, axis-separated so you slide along walls.
  Used by the player (r 0.35) and enemies (r 0.35 / 0.5).
- `hasLineOfSight` — samples the segment every 0.8 units against the grid.
- `raycastWorld` — exact DDA grid walk + floor/ceiling planes. Bullets stop at
  walls, floor and ceiling and mark them (`fx/particles.ts`): a chipped hole
  (160 kept per level, oldest recycled; shotgun pellets leave smaller ones),
  sparks, a puff of dust that hangs for a second or two (grit falls from the
  ceiling instead), and chips of concrete that fly off with gravity, bounce
  off the floor and walls with friction, and lie where they land for 45 s.
  Shots into flooded floor splash instead. A creature hit throws blood on
  the wall or floor up to 3 units behind it, and a kill leaves a pool under
  it. Lamp fixtures are targets too: a lamp shot out bursts, goes dark for
  the rest of the level, and the crash carries 12 units (`LampSystem.raycast`
  / `breakLamp`; partners' shots break the same lamp for everyone).

---

## 6. Player

|                              |                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| Walk / sprint / crouch speed | 3.3 / 5.8 / 1.7 (smoothed acceleration)                                                       |
| Sprint                       | Shift, forward only, not while crouched. Can't fire while sprinting.                          |
| Stamina                      | 100, drain 20/s, regen 16/s (×1.3 when still or crouched). Emptying it locks sprint until 25. |
| Crouch                       | Hold C (or Ctrl): eye height 1.05, near-silent                                                |
| Health                       | 100, no regen, 0.35 s mercy window between hits                                               |
| Medkits                      | Carried, up to 3. Use (H) takes 1.3 s — weapon lowered — and heals 45                         |
| Melee (V / right click)      | 0.55 s cooldown. Takedown from behind, or 20 damage + shove                                   |
| Feel                         | head-bob, strafe lean, recoil pitch kick, trauma-based camera shake                           |

**Noise.** Each gait has a hearing radius: still 0, crouch 1.6, walk 5.5,
sprint 12. Walls cut it to 40%. **Water** multiplies it by 1.8 and slows you
to 72%. The HUD noise meter shows your current level.

**Breathing** (`player/breath.ts`). Your breathing carries 1.8 units (it's
your noise whenever you're quieter than that), so a creature right beside
you can hear you standing still. **Hold your breath** (hold B, pad L3) to
silence it for up to 7 s; not while sprinting. Let go early and you breathe
out quietly (noise 1.2); run out and you **gasp** (noise 6), and your lungs
take 4 s to refill after a short pause. While you hold it, and while your
lungs refill, a bar the width of the others shows under stamina, with the
seconds of air left beside it. Co-op partners send `held` with their
state, so the host's creatures hear them the same way.

**The hunt** (`updateDirector` in `game/levelSession.ts`). A creature the
hunt sends doesn't know you're there, so it doesn't count as suspicious on
the HUD (`Enemy.drawn`, shipped to guests in the snapshot's flag bits) until
it hears or sees something. About 40% of the
creatures that walk are **roamers**: instead of keeping to their corner they
pick a spot up to 7 cells from wherever they are, again and again, and drift
through the whole level. And every so often (about 150 / 80 / 55 / 40 s on
Story / Normal / Nightmare / Aizi, ±25%) one creature that isn't after anyone,
roamers first, is drawn silently to a spot within 3 cells of the nearest
player, so the quiet never lasts. Only the host decides. **Lamps** within 7
units of a living creature stutter and drop out whatever their mode, so a
light going wrong means something is close. The ambience now and then plays
a creature breathing behind a wall or screaming far off, with nothing there.

**Light gives you away at once.** A creature that sees you with your light
on, or has your beam on it (as far as the beam reaches), fills its suspicion
in about a sixth of a second: it comes for you, it doesn't wonder.

**Dread.** A creature within 13 units that you can't see (behind you, round
a corner, or in the dark beyond your light) sets your heart beating and your
breathing quick and shaky, more strongly when it's hunting you; one you're
looking at in your light counts for about a third. It swells quickly and
fades slowly. The first time it's strong, a hint says how to hold your
breath.

**Throwing** (G, pad R3; `items/throwables.ts`). A bottle flies from the
camera at 13 units/s with a slight lift, under gravity, stepped in short
slices so it can't pass through a wall, and breaks on the first wall, floor
or ceiling. The smash carries 16 units: creatures that hear it go to look.
You start a run with one and carry up to three; in co-op each throw is
flown on every copy (`toss`) but only the thrower's makes the noise.

**Flashlight** (F): spotlight held low-right with beam sway that lags your
aim. Battery 100, drains 0.55/s (about three minutes; it was a minute,
which turned the game into battery-watching). While off it trickles back to at
most 30; beyond that you need battery pickups (+45). Flickers below 20.
With it on, enemies can see you from 15 units instead of 6.

---

## 7. Weapons

|                        | Sidearm         | Rivet gun       | Shotgun                         |
| ---------------------- | --------------- | --------------- | ------------------------------- |
| Slot                   | 1               | 2               | 3                               |
| Damage                 | 26 (×2.5 head)  | 17 (×3 head)    | 8 pellets × 13 (×1.5 head)      |
| Fire cooldown          | 0.24 s          | 0.17 s          | 0.85 s (pump)                   |
| Magazine / reserve max | 8 / 48          | 12 / 60         | 5 / 24                          |
| Reload                 | 1.5 s, magazine | 1.9 s, magazine | 0.55 s per shell, interruptible |
| Range                  | 40              | 22              | 22                              |
| Base spread            | 0.006 rad       | 0.012 rad       | 0.075 rad                       |
| Noise radius           | 22              | **4.5**         | **32**                          |
| Found                  | Start           | Ventilation (6) | Armory (8)                      |

Spread grows with movement and rapid fire (the crosshair shows it). Every
pellet is its own ray; a shot counts as one hit for accuracy if any pellet
lands. Ammo pickups are per weapon (`A` rounds, `T` shells, `J` rivets); you
can't pick up ammo for a weapon you don't have yet, and a test checks no
level asks you to.

**Switching** (1–3, Q to cycle, mouse wheel) takes 0.45 s: the weapon drops
out of view and the next comes up. Switching cancels a reload.

**Melee.** The nearest creature within reach (1.9 + its radius) and within
50° of your aim is struck. If it's unaware and you're behind it (more than
105° off its facing), or it's a Watcher frozen in your light, it's a
**takedown**: an instant, nearly silent kill (noise 1.5). Otherwise it takes
20 damage, is knocked back and staggered, and a wind-up in progress is
interrupted. Brutes, the Remnant and anything on the ceiling can't be taken
down.

Hit-testing: ray vs. per-enemy spheres (head, chest, hips, legs) that follow
the animated rig, clipped to the wall-hit distance. Feedback: hit marker
(red for headshots, larger on kills), blood burst, hit sound, enemy flinch.

The **viewmodels** are built from rounded parts (no razor edges) with a
real gloved hand (palm, four curled fingers, thumb): pistol, a
yellow rivet gun with a side strip and gas canister, and a pump shotgun
whose forend racks after every shot. All share idle and mouse-lag sway, walk
bob, recoil, a lowered pose while sprinting, a melee swing, and an
auto-injector animation while healing. The pistol and rivet gun have a full
magazine reload (dip, mag out, mag in, rack); the shotgun rocks as each
shell goes in.

---

## 8. Enemies

### States

```
lurk ──(ceiling) you pass beneath / hear or see you──► drop ──► chase
  └──(mimic) you come close / hear or see you─────────────────► chase

patrol ──hears you / half-sees you──► investigate ──arrives──► search ──timeout──► patrol
   │                                        │                     ▲
   └──────── fully sees you / shot ─────────┴──► chase ──lost 3.5 s─┘
                                                  │  ▲
                                            in reach  recover
                                                  ▼  │
                                                attack (wind-up → strike or spit)
```

- **Sight**: 60° half-angle cone, 6 units (your light off) / 15 (light on),
  scaled by the creature's `sight` (0 = blind), needs line of sight.
  Suspicion builds over time at range (instant up close). Once hunting, they
  track you all round. Anything notices you bumping into it (1.1 units).
- **Hearing**: your gait's noise radius × their hearing multiplier, 40%
  through walls. Gunshots, doors, generators and melee are separate noise
  events.
- **Losing them**: break line of sight and stay quiet for 3.5 s and a chaser
  switches to searching your last known position for ~6 s, then goes back
  to patrolling.
- **Attacks** have a visible/audible wind-up. Back off during it and the
  strike misses; a melee shove interrupts it.
- **Movement**: BFS path, string-pulled with line-of-sight, circle-vs-wall
  collision, and separation so packs don't overlap.

### Traits

Creatures share the state machine; what makes them different is data in
`content/enemies.ts`:

| Trait                | Values                           | Effect                                                                                             |
| -------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `sight`              | 0..                              | Multiplies sight range. 0 = blind (Listener).                                                      |
| `light`              | `sees` / `ignores` / `freezes`   | Whether the beam gives you away, and whether it locks the creature in place (Watcher).             |
| `behaviour: ceiling` |                                  | Starts upside down on the ceiling; drops when you pass beneath (1.7), hear or see it, or shoot it. |
| `behaviour: ranged`  | `ranged: { range, minRange, … }` | Spits from range, holds position, backs off if you're too close.                                   |
| `behaviour: lurker`  |                                  | Stays hidden; every 9–17 s makes a lure sound; ambushes within 3.2.                                |
| `behaviour: boss`    | `armor`                          | See the Remnant below.                                                                             |
| `pack`               | n                                | One glyph places n (the Swarm).                                                                    |
| `takedown`           | bool                             | Whether a quiet melee kill is possible.                                                            |

|                 | Husk   | Brute   | Listener | Watcher | Crawler   | Spitter      | Swarm (rat) | Mimic     |
| --------------- | ------ | ------- | -------- | ------- | --------- | ------------ | ----------- | --------- |
| Health          | 60     | 190     | 80       | 110     | 45        | 70           | 9           | 90        |
| Chase speed     | 3.6    | 2.5     | 3.9      | 5.2     | 4.2       | 2.8          | 5.0         | 4.0       |
| Damage          | 16     | 34      | 22       | 28      | 14        | 12 / 18 acid | 5           | 24        |
| Wind-up         | 0.38 s | 0.65 s  | 0.45 s   | 0.3 s   | 0.3 s     | 0.7 s spit   | 0.18 s      | 0.35 s    |
| Hearing / sight | 1 / 1  | 0.8 / 1 | 2.1 / 0  | 0.9 / 1 | 1.3 / 0.6 | 1 / 1        | 1.3 / 0.5   | 1.2 / 0.8 |
| Takedown        | yes    | no      | yes      | yes     | yes       | yes          | yes         | yes       |

A husk out-runs your walk but not your sprint. A Watcher out-runs almost
anything — keep the light on it.

The walk animation follows each creature's speed eased (`ANIM_EASE`, 8 per
second), not its speed that frame, so legs settle when it stops and pick up
when it sets off instead of snapping; on a co-op guest this also smooths
over the host's snapshots.

- **Watcher**: frozen while the lit beam (within ~0.42 rad of your aim and 20
  units) is on it and it's in line of sight, and for 0.35 s after the beam
  moves on (so a sweep past it doesn't make it stop and start). Frozen, it
  can't move or finish a wind-up, and can be taken down from any side. It
  recoils rather than stopping dead: arms up against the light, head
  turned away, a slow shudder, blended in and out. Released, it gathers
  speed over 0.6 s instead of lunging off at once.
- **Crawler**: moves on all fours. On the ceiling it spider-walks upside
  down, with limbs in the concrete, and clicks. It flips and falls when it
  drops, then hunts like a husk.
- **Spitter**: globs fly on a ballistic arc (gravity 9, ~11 units/s) aimed at
  where you were, so strafing dodges them. They burst on walls, the floor or
  you.
- **Mimic**: its lures are your own footsteps, a pickup sound, or one of the
  Operator's lines spoken from its hiding place — subtitled as "OPERATOR —
  NOT ON THE RADIO".

### The Remnant (boss)

A stationary mass at the end of the Hive with an arena around it. It wakes
when you come within 16 units with line of sight (or hurt it). It has 1100
health, and its hide takes only 35% damage; the **core** takes full damage
(×headshot) while it's open — during every attack wind-up and for 2.2 s
after — and 35% while shut.

| Phase (health) | Tendril slam (within 6)   | Acid volley         | Summons                      |
| -------------- | ------------------------- | ------------------- | ---------------------------- |
| 1 (above ⅔)    | 30 damage, 0.95 s wind-up | 1 glob, every 3.2 s | —                            |
| 2 (above ⅓)    | 0.85 s wind-up            | 3-glob fan, 3.4 s   | 3 rats every 14 s            |
| 3              | 0.7 s wind-up             | 5-glob fan, 2.6 s   | 4 rats and a husk every 10 s |

Entering a new phase it screams (every creature on the level hears it),
opens its core for 3.5 s and summons at once. It holds back while 12 or
more of its brood are still alive, so a long fight never piles up an
endless horde. The exit is sealed until it dies; when it does, everything
it birthed dies with it. The player can't
walk into it.

Hits the hide soaks get a small grey hit marker and a dull impact sound
instead of the usual feedback, and after a few of them a prompt says to
shoot the core when it opens. While it's awake, ammo picked up near it
comes back after 25 s, so the fight can be slow but never unwinnable.

### Bodies & animation (`enemies/bodies.ts`)

Each creature type has its own rig. Humanoids are built from flesh, not
primitives: every part is a lathe of a profile (`fleshTube`) or a welded
icosphere (`fleshBlob`), its surface pushed in and out by 3D value noise so
nothing is a clean sphere or tube and no two limbs match. Limbs are knotted
at the joints and wasted between them, long enough to run into the next
joint so no gap opens as they bend. The torso is starved: ribs and a
knuckled spine pushed out through the skin, the belly sunken under the ribs,
shoulder blades. The skull is long and narrow, higher at the back, with
sockets sunk into it, a brow ridge and cheekbones; eyes are pinpricks deep
in the sockets. The skin (`fleshMaterial`) is a dead grey-green that each
kind's tint only leans, painted with bruising, veins, pores and grime, its
creases pushed hard, with a soft sheen and a thin wet film.

- **Humanoid**, pushed per type: the Husk's gaunt hunch; the Brute's width,
  fused shoulder masses and half-absorbed second face; the Listener's skull
  opened into a ring of bone plates round a glowing chamber, and no eyes;
  the Watcher's height, long arms and six pale eyes; the Crawler's long
  limbs and all-fours gait; the Spitter's swelling throat sac and split jaw;
  the Mimic's eyeless split jaw.
- **Rat** (Swarm): body, snout, spines, scurrying legs and a swinging tail.
- **Mass** (the Remnant): heaving lumps, crystal growths, seven tendrils
  that wave and slam, and a core with lids that part.

Skin is a procedural flesh texture tinted per creature, with the Remnant's
**veins** as an emissive map that pulses faster when the creature is
agitated. Nothing on a creature lights itself except those: the mouth
and the split skulls are dark wet flesh your light has to find, and vein
colours are dull (rust, ochre, bile) rather than bright. Eyes, veins, growths and the Spitter's sac stay dark beyond about
9 units and brighten as a creature closes in (further when it is hunting), so a shape in the dark gives nothing
away until it is near (the Remnant's glow is left as it is). A hit flashes
the whole body, at any distance. Procedural walk cycles are driven by
actual speed, with wind-up and strike poses, hit flinches, and a collapse on
death (a Crawler killed on the ceiling falls first).

Every humanoid also carries the details that make it unpleasant up close: a
long skull under a heavy brow, sunken sockets whose glow flares when it's
hunting, rows of teeth in front of a dark gullet with one cheek torn open,
ribs through split flanks, a knotted spine and shoulder blades, glowing
growths (placed by a seed per kind), and long fingers with hooked claws. It
breathes, its jaw chatters while it hunts, and every few seconds the neck
spasms, snapping the head sideways — each creature on its own rhythm.

---

## 9. Items

| Item      | Effect                                                         |
| --------- | -------------------------------------------------------------- |
| Ammo      | +4 rounds (not picked up if full)                              |
| Bottle    | Carried (max 3). Throw it (G) to make a noise somewhere else   |
| Shells    | +2 shotgun shells                                              |
| Rivets    | +6 rivets                                                      |
| Medkit    | Carried (max 3). Use it to heal 45                             |
| Battery   | +45 flashlight charge                                          |
| Keycard   | Opens security doors, or the exit                              |
| Note      | Shows a typewritten note card for 7 s                          |
| Shotgun   | The weapon, loaded, plus 8 shells (or 8 shells if you have it) |
| Rivet gun | The weapon, loaded, plus 24 rivets                             |

Amounts are scaled by the difficulty's pickup multiplier. Each item has a
small modelled mesh and a coloured glow so it's findable with the light off.

---

## 10. Audio

All synthesized. Chain: voice → (low-pass if a wall is between you) → stereo
panner → dry bus + convolution reverb (generated impulse) → master →
compressor.

- **Weapon**: real recordings (CC0, `public/sfx/`, loaded by
  `audio/samples.ts` from the list in `content/sounds.ts`): a 9 mm fired in
  a small room, a Colt .45 and a close 9 mm for the pistol; a Mossberg 500
  and a Beretta for the shotgun; a nail gun for the rivet gun; Taurus and
  Glock magazine, slide and trigger handling; a Remington 870 pump; brass
  and shells bouncing on concrete; stone impacts and ricochets; flesh hits.
  Each has two to five takes picked at random with slight pitch variation.
  The engine layers a synthesized chest-punch and a rolling rumble under
  the shots, and a bullet crack and falling grit over the stone impacts.
  Anything without a recording (or that fails to load) falls back to the
  synthesized version: an overdriven crack and body, early reflections, a
  rumble and ear ring, the action cycling and casings bouncing.
- **Player**: recorded boot footsteps on concrete (walking, heavier when
  sprinting, soft when crouched) and wading splashes, a real flashlight
  switch, a recorded pain sound under a synthesized thump when hurt,
  a heartbeat below 40% health or when something unseen is close (55 to
  about 140 beats a minute; each beat a low thud with a muffled knock around
  120-180 Hz on top, because laptop speakers can't play a real heartbeat's
  40-70 Hz), your own breathing, quick and shaky, when something is close,
  death drone.
- **Enemies** (panned + distance-attenuated + muffled through walls): one
  recorded voice for everything the Remnant has rewritten — growls when
  idle, an angry roar on alert, attack grunts, pain and death — pitched
  per creature (Brutes and the Remnant low, Listeners high); rats have
  their own recorded squeaks. Synthesized: the takedown gurgle (a muffled
  death), a thud and skitter when a Crawler drops, a Spitter's rising
  gurgle, acid sizzle, and the Remnant's slam and many-voiced roar.
- **World**: a recorded heavy sliding metal door (with synthesized security
  beeps and the clunk at the top), a recorded ammo pickup; synthesized
  generators, intercoms, radio voice, checkpoint tone and detonation.
- **Ambience**: detuned low drone with a slow filter swell, plus random
  distant drips, metal groans and clanks.
- **Radio**: a synthesized radio voice (key-up click, static bed and
  band-passed "syllables" for the length of the subtitle).
- Pause ducks the mix. Master and music volume are settings.

### Adaptive music (`audio/music.ts`)

Horror sound design on a slow clock (72 bpm, four-bar loop) over low
dissonant clusters built from semitones and tritones (D–E♭–A, C♯–D–G♯,
D–F–G♯, C–C♯–F♯), so nothing ever resolves. Every sound is scheduled ahead
on the audio clock so all layers stay in time however they are mixed:

| Layer   | What it is                                                                   | Heard when                     |
| ------- | ---------------------------------------------------------------------------- | ------------------------------ |
| Pad     | The cluster as a low drone whose voices drift in and out of tune             | Always, thinning under a chase |
| Texture | Bowed and struck metal (inharmonic partials, bending flat) and distant booms | Calm exploration               |
| Tension | A lub-dub heartbeat on every beat, a high trembling semitone cluster         | Something is suspicious        |
| Chase   | Deep drum hits, a grinding semitone bass, metal scrapes, strings that climb  | Something is hunting you       |

Outside levels (title, menus, results, endings) there's no music, only the
ambient drone with its distant drips, groans and clanks.

The session's **threat** (the HUD eye: ~0.6 when a creature is suspicious or
searching, 1 when hunted or the Remnant is awake) drives an intensity that
rises fast (1.6/s), falls slowly (0.12/s), and holds at full for 5 s after a
chase ends so the music doesn't flap. Tension fades in over 0.2–0.55,
the chase over 0.8–0.97. Death cuts the music; a new level starts calm.

---

## 11. UI

- **HUD**: level + objective (top left); awareness eye showing SUSPICIOUS /
  HUNTED (top centre), counting only creatures you could know about, in line
  of sight within 24 units or within 5 (`canPerceive`), so it never gives
  away one in the next room; dynamic crosshair; hit marker; directional damage
  arcs; health (with lag bar) / stamina / battery (bottom left); keycard
  indicator; carried medkits with the heal key; noise meter (bottom centre);
  weapon strip, weapon name, magazine, reserve, round pips and
  reload / loading / healing status (bottom right); the boss's health bar
  (top centre) while it's awake; pickup toasts; context prompts; interact
  prompt with the bound key; radio subtitles with the speaker's name; note
  card; level-name intro. DOM updates only when values change.
- **Screens**: loading, title, main menu (Continue / New Game / Chapters /
  Settings / Controls, depth gauge, intercepted radio), level title cards, prologue, ending, difficulty select, chapter select with best times, confirm
  dialog, pause, settings (sensitivity, FOV, volume, invert Y — saved),
  controls with **rebinding** (click a slot, press a key or mouse button;
  Backspace clears; a key moved to a new action is removed from its old one),
  death with run stats, level complete with stats and "new best", victory with
  run totals.
- **Inventory** (`ui/inventory.ts`; Tab or I, the gamepad's View): three
  tabs. _Equipment_ — health, battery, medkits (one can be used from here),
  the keycard, every weapon with its magazine and reserve, and the
  objective. _Journal_ — every note ever found, newest level first, read on
  a sheet of paper; the journal lives in the save (`progress.notes`), so it
  survives runs. _Radio log_ — every line heard on this level. It pauses
  the game offline; online the world keeps going. Esc, the inventory key or
  Back closes it.

---

### Settings

Mouse sensitivity, gamepad look speed, invert look Y, volume, music volume,
**graphics quality**, field of view, **HUD size** (80–140%), **subtitle
size** (small / medium / large), **reduced camera shake** (camera shake and
head bob at 20%) and a **colour-blind friendly HUD** (red/green signals
become orange/blue). All validated field by field on load.

| Quality | Pixel ratio cap | Lamp lights | Bump maps | Dust motes | Grain & aberration |
| ------- | --------------- | ----------- | --------- | ---------- | ------------------ |
| Low     | 0.75            | 3           | no        | 80         | no                 |
| Medium  | 1               | 4           | yes       | 160        | yes                |
| High    | 1.5             | 6           | yes       | 260        | yes                |

Resolution and film effects apply at once; lights, bump maps and dust from
the next level loaded.

**Character** (`content/characters.ts`; chosen at New Game, in the co-op
menu, or Settings → Playing as): Nur Kanybekov, Raiymbek Asanov or Nuraiza
Akylbek. It changes nothing about how the game plays. `personalise()`
rewrites every radio line, note, the prologue and the menu's intercepted
transmissions for the chosen character (whole words only: "Nur Kanybekov",
"structural engineer", "Nur"), your own subtitles carry your first name,
and recorded pain sounds are pitched to the character's voice. It sets the
skin tone of your first-person hands, and in co-op it travels with your
position updates, so your partner sees your character
(`game/characterModel.ts` builds the figure: face, hair, beard, build,
coverall colour) with your name on their HUD.

### Gamepad

Standard-mapping pads (Xbox, PlayStation, most others) through the Gamepad
API, polled every frame. Left stick moves, right stick looks (dead zone
0.18, squared response for precision, vertical at 65% speed), plus RT fire,
LT/L3 sprint, B crouch, RB/R3 melee, A interact, X reload, LB flashlight,
Y or D-pad →/← switch weapon, D-pad ↓ sidearm, D-pad ↑ medkit, Menu pause.
In menus the D-pad or stick moves focus (with key repeat), left/right
adjusts sliders and options, A selects, B goes back. Whichever device was
touched last decides the prompts: `[E] OPEN DOOR` becomes `[A] OPEN DOOR`.
With a pad in use the game doesn't need pointer lock.

## 12. Co-op (`net/`, `game/remotePlayer.ts`)

Two or three players, online, through the whole campaign. Main menu →
**Co-op** → **Host a Game** (pick a sublevel you've reached and a
difficulty) shows a five-character room code; up to two partners pick
**Join a Game** and type it. The host starts once at least one is in.

**Three players.** Each guest has its own connection to the host (a star:
the guests never connect to each other). The host's first room closes its
signaling once a guest is in (as before); the host then opens the room again
under the same code for a second guest, until two are in or the game starts
(no joining mid-game). Players have slots: 0 the host, 1 and 2 the guests; a
guest learns its slot from `start`. The host passes on what one guest says
that the other needs (`RELAYED` in `net/protocol.ts`: `ps`, `shot`, `toss`,
`pickup`, `trigger`, `revive`, `wipe`), stamped `from` with the sender's
slot, and messages meant for one guest (`hurt`, `killed`) go to that guest
only (`CoopLink.sendTo`). The host also sends the player count with every
`start` and `restart`, so all copies build the same world for that many
(`COOP_EXTRA_ENEMIES`, `COOP_ENEMY_HEALTH`, `COOP_LOOT` in
`game/levelSession.ts`, by player count: +40% / ×1.3 / ×1.8 for two, +70% /
×1.45 / ×2.4 for three). A guest who leaves mid-game is announced (`gone`)
and the others carry on.

**Voice** (`net/voice.ts`, `PeerLink.setVoice`, `VoicePlayer` in
`audio/soundManager.ts`). Every connection is made with two audio
transceivers next to the data channels, so voice never needs renegotiating:
"direct" carries the other end's microphone, "relay" the third player's
voice, which the host forwards from the other guest's connection
(`replaceTrack` with the received track). A muted track sends silence, which
is how push to talk (hold T) works; open mic and off are the other settings.
The microphone is asked for once, in the lobby. Each voice plays through Web
Audio from the speaker's position (pan, distance, a low-pass behind walls,
never quieter than a murmur), through a muted `<audio>` element as well,
which Chrome needs before remote audio reaches Web Audio. While you're
actually speaking (mic level above a threshold), your noise radius is at
least 4, and guests send `talk` in their `ps` so the host's creatures hear
them too.

**Connecting.** Browsers talk directly over WebRTC data channels. To find
each other they use a signaling service, only as a mailbox for the
connection offer, answer and ICE candidates; nothing about the game goes
through it, and it's closed once the players are linked
(`net/meteredSignaling.ts`). It's **Metered Realtime** (free: 100,000
messages a month; a connection takes a few dozen): each room is a pub/sub
channel named `remnant-v<protocol>-<code>` (so different versions never
meet), messages carry `src`/`dst` ids, and the channel's presence list tells
a guest within seconds when nobody hosts that code. The game ships with a
publishable key (`pk_live_…`, made for browser code); `VITE_METERED_REALTIME_KEY`
replaces it. Its welcome also carries TURN credentials, which join the relay
list — so the relay works without any further setup. The game used the free
public PeerJS server at first, but that server stopped forwarding offers
(it disconnects whoever sends one); `net/signaling.ts` still speaks the
PeerJS protocol for tests and self-hosting: `?signal=wss://your-server/peerjs`. Room codes use 31 characters with no look-alikes
(no 0/O, 1/I/L); if a code is somehow taken, the host silently opens the
room under another.

**Getting through strict networks** (`net/ice.ts`). STUN (Google's and
Metered's public servers) finds a direct path on almost every network. For
the rest — networks that block direct browser-to-browser traffic — the game
supports a **TURN relay**, configured at build time: Metered's free Open
Relay (`VITE_METERED_APP` + `VITE_METERED_API_KEY`, credentials fetched per
game) or any TURN server (`VITE_TURN_URLS`, `VITE_TURN_USERNAME`,
`VITE_TURN_CREDENTIAL`). The deploy workflow passes these from repository
variables. WebRTC always prefers the direct path; the lobby says which one
was used ("Connected directly" / "through the relay", from the selected
candidate pair). For testing, `?turn=…&turnUser=…&turnPass=…` sets a relay
from the URL and `?relayOnly` forbids direct paths. With no relay, a
connection that can't be made fails after 30 s with a message that says so.

Two channels: **reliable** (ordered; every event) and **fast** (unordered,
no retransmits; the state streams, where a late packet is worthless). A
ping every second and 8 s of silence detect a partner who vanished.

**Robustness.** Each level attempt (start, next level, retry) is numbered
(`ep`); in-level messages carry it and ones from an earlier attempt are
dropped, so nothing from before a retry — a summoned creature, a pickup —
leaks into the next. The `hello` exchange compares both the protocol and the
game's version, so a stale cached copy refuses to play rather than drift.
While a co-op tab is in the background (where browsers stop animation
frames), a worker timer keeps the game ticking at 20 Hz without drawing, so
the host's world doesn't freeze for the guest. A guest whose connection
never completes doesn't hold the host's room (it frees after 30 s); a guest
leaving the lobby keeps the room open for the next; a third guest is turned
away; Start can't be triggered twice. Browsers without WebRTC get a
clear message.

**Who decides what.** The host's game is the authority on the world:

| Thing                          | How it's shared                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Each player's own movement     | Simulated locally, sent 20×/s (`ps`: position, look, gait, torch, weapon, health, down). Never waits on the network.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Creatures                      | The host's AI runs with one perception per player (`Enemy.pickTarget`: closest standing player, sticky within 3 m). Snapshots 15×/s (`es`, 12 numbers per creature, +4 for the boss). The guest's creatures are **puppets** that glide to the snapshot and animate. Snapshots and player states are numbered (`n`); an older one arriving late on the unordered channel is dropped, and between snapshots a puppet carries on at the host copy's last speed for up to 0.25 s, so a late packet doesn't stop it dead. Partners' figures, headlamps included, exist from the level's start, so no light is ever added mid-level (that would recompile every shader). |
| Creature voices, spit, summons | Events from the host. Acid globs are spawned on both sides; each copy can only hurt the local player.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Guest's shots and melee        | The guest raycasts its puppets and sends `hit` / `takedown` / `shove`; the host applies them and reports `killed` (the kill counts for the guest). The creature flinches on the guest immediately.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Noise                          | Noise the world makes (doors, generators, alarms) is made on the host. Noise the guest makes (gunfire, melee) is sent to the host's creatures; the guest's footsteps reach them through its `ps` gait.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Doors, generators, intercoms   | The guest sends `use`; the host does it and broadcasts `used`. A locked door is answered locally.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Pickups                        | Whoever walks over one gets it; it vanishes for both. The **keycard is shared**. Boss-arena restocks are timed by the host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Triggers, checkpoints          | Whoever reaches one fires it for both; each player keeps their own checkpoint snapshot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| The exit                       | Every player must be within 4.5 m of it; the host ends the level for all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Down, not dead.** In co-op, reaching 0 health puts you **down**: camera on
the floor, look only, 45 s bleed-out. The partner holds Use within 2 m for
3 s to revive you at 35 health. Creatures ignore downed players. Both down,
a bleed-out, or being down when the partner leaves is a **wipe**: the level
is lost for both, and the host chooses Retry (from the checkpoint) for
both.

**Flow.** The host drives it: start, next level, retry. The guest's result
and death screens wait for the host. Co-op runs never touch the solo save.
The pause menu doesn't pause the world. If the guest leaves, the host
carries on alone; if the host leaves, the guest returns to the menu (the
world was the host's). Level cards are skipped in co-op.

**The partner** is a figure in a coverall, hi-vis vest and hard hat, built
from primitives like the creatures: legs swing with speed, crouch, lie down
when downed. Their headlamp is a real `SpotLight` (so co-op sessions have
two more lights than solo — added when the level starts, so shaders never
recompile mid-level), plus a muzzle-flash light. A faint marker above them
shows through walls, red and pulsing while they're down. Their gunshots and
footsteps are spatial (`playGunshotAt`, `playFootstepAt`).

**Testing.** Unit tests cover target choice, the Watcher and either torch,
puppets copying a creature to its death, the boss's shared phase, and room
codes, relay settings, and the Metered matchmaking client against an
in-memory stand-in (addressing, empty rooms, handed-out relays). An
end-to-end check runs two real browsers — against the real Metered service,
or a local PeerJS server (`?signal=ws://127.0.0.1:9000/peerjs`) — clicking through the actual
menus, and verifies: intercom and door use by the guest, pickups, the
guest's shots killing the host's creature, down and revive, wipe and
retry, leaving together, moving to the next level, and a partner leaving
(`tools/coop/run.mjs`; usage in its header).

---

## 12b. Saves and cloud sync (`game/save.ts`, `net/cloud.ts`)

The local save (localStorage, versioned, validated field by field) is always
the one the game plays from. `SaveData.savedAt` records when it last
changed. **`mergeSaves(a, b)`** combines two copies without losing
progress: the highest unlocked level, the union of finished difficulties,
endings and journal notes, the fastest time per level, and the run in
progress from whichever copy has the newer `savedAt` (so a run finished or
lost on the newer copy doesn't come back).

**Cloud sync** (optional; on when the build has `VITE_FIREBASE_API_KEY` and
`VITE_FIREBASE_PROJECT_ID`) signs in with Google through the Firebase SDK,
loaded only when used. On sign-in, and on every start while signed in, it
downloads `saves/{uid}` from Firestore's REST API with the player's ID
token, merges it in, and uploads the result; after that, every change is
uploaded 2.5 s later (bursts become one write). Nothing is uploaded before
the cloud copy has been read, so a fresh browser can't overwrite a real
save. Offline, the status says so and the save stays local until the next
sync. Rules in `firebase/firestore.rules` limit each player to their own
document and to a save-sized string.

**Save files** (Saves → Export / Import): the save as JSON tagged
`"game": "REMNANT"`; importing merges it in with the file's run taking over.

**Ammunition caches** (`world/loot.ts`): ammunition comes in small caches
(half of what a pickup used to hold) spread over the whole level, so it is
found by exploring rather than in one box by the door. Each ammunition
pickup on a map becomes two caches (times the difficulty's `lootSupply`, at
least three of each kind a level has), spread evenly by walking distance
from a fifth of the way in to the far end: each new cache goes in the
emptiest stretch. Map-placed pickups past that point keep their spot; ones
by the start move out into the level. The total is about what it was.
Checkpoints carry a layout number (`CHECKPOINT_LAYOUT`), so one taken before
this change restarts its level instead of restoring the wrong pickups.

**Supplies by difficulty** (`world/loot.ts`): the medkit and battery
pickups on a map are thinned out (Nightmare, Aizi) or added to
(Story) by the difficulty's `lootSupply`. Removal keeps at least one of each
kind a level has; additions use the level's own mix, on reachable floor away
from the start, doors, water and other items. Seeded by level and amount,
so both co-op players and every checkpoint see the same list. Keycards,
weapons and notes are never touched.

**Co-op supplies:** pickups are shared (whoever takes one, it's gone for
both) while co-op has more and tougher creatures, so a co-op level multiplies
the difficulty's supply by `COOP_LOOT` = 1.8 (`game/levelSession.ts`).
Balanced with a simple model: the damage all the ammunition on a level can
deal at a 60% hit rate, against the total health of its creatures. Across
the campaign that share is about 1.1–1.3 on Normal, 0.5–0.7 on Nightmare
and 0.2–0.25 on Aizi (solo–co-op), with Cold Storage and Containment the
tightest; the rest is meant to be avoided or taken down silently.

**Leaderboard** (`net/leaderboard.ts`). Every level cleared records its time
in this browser under a key for the level, difficulty and mode
(`cold_storage__nightmare`, `…__coop`), keeping only your best. Signed in,
bests go up to `leaderboard/{uid}` in the same Firestore database: `name`
(the first word of the account name, never an email address), `times` (a
map of those keys) and `updatedAt`, written with a field mask so only the
changed times are touched, and never replacing a faster time already there
(from another device). Times set while signed out are uploaded at the next
sign-in. Main menu → **Leaderboard** reads every entry (cached for a
minute) and shows each level's top three and your own rank, for any
difficulty and solo or co-op. The rules let any signed-in player read the
board and each write only their own entry; times under 5 s are ignored.

**Backups** (`tools/backup/firestore.mjs`, `.github/workflows/backup.yml`):
once a day a GitHub Action signs in as a Firebase service account, reads
every document in `saves`, encrypts the file (AES-256-GCM, key from the
`BACKUP_PASSPHRASE` via scrypt) and keeps it as a 90-day artifact. The same
script decrypts a backup and restores it.

## 13. Debug hooks (`?debug`)

With `?debug`, pointer lock isn't required and `window.game` exposes:
`debugStart(levelIndex, difficulty?)`, `debugSimulate(seconds, heldCodes[])`,
`debugFire()`, `debugLook(yaw, pitch)`, `debugTeleport(x, z)`,
`debugEnemies()`, `debugState()`, `debugMusicLevel()`, `debugLeave()`. `debugSimulate` also
takes gamepad buttons to hold. `debugSimulate` steps the game at a fixed
30 Hz without rendering, holding the given key codes (e.g. `["KeyW",
"ShiftLeft"]`), which is handy for testing AI headlessly.

---

## 14. Testing

`npm test` runs the Vitest suite; `npm run check` adds the typecheck and
formatting check, and CI runs all of it on every push. Deploys are blocked if
any of it fails.

The tests run in Node without a GPU. That's possible because the logic that
matters is separated from rendering: the level parser, grid queries,
pathfinding, weapons, player movement (driven by commands), bindings,
settings, loadouts, save migration, gamepad commands and the music's
intensity and layer mix are all pure or near-pure. Creature AI
is tested by giving `Enemy` a stand-in body (the real rigs need a canvas for
their textures): blindness, hearing, light-freezing, ceiling drops, spitting,
lures, takedown rules and the boss's armour, phases and summons.

**Every shipped level is validated** (`world/levels/levels.test.ts`): it must
parse, have a closed outer wall, a reachable exit, reachable keycards and
pickups, no enemies spawning next to the player, and no orphaned notes. The
campaign is checked too: each creature first appears on the level the story
introduces it, each weapon is found where it should be, and no level places
ammo for a weapon the player can't have yet.

---

## 15. Known limitations / next steps

See [`ROADMAP.md`](ROADMAP.md) for the full plan.

1. **Pathfinding** is per-enemy BFS (fine at this scale — the Armory's 18
   rats included; switch to a shared flow field if enemy counts grow a lot).
2. **Dead enemies never despawn** (fine without respawning).
3. **Only the flashlight casts shadows.** Lamps don't (each would need a
   cube shadow map), so lamp light passes through closed doors.
4. **Creatures are generated, not sculpted.** Noise-deformed flesh reads as
   flesh in the dark, but sculpted, rigged models would be the next step up
   The boss's mound and tendrils and the rats are built the same way.
5. **No touch input.** Touch-only devices are told so on the title screen.
6. **Co-op** depends on free third-party services: Metered Realtime for
   matchmaking (with the relay it hands out) and, optionally, Metered's
   TURN relay; if they're down, players can't find each other (a
   self-hosted PeerJS server via `?signal=` is the fallback). Joining needs a keyboard
   to type the code. There's no host migration: if the host leaves, the
   guests' games end. Three players at most, and nobody joins mid-game.
   Everything a guest does reaches the other guest through the host, so
   the host's connection carries twice the traffic (voice included).
7. **The leaderboard trusts the players.** The rules stop anyone writing
   someone else's entry, but not a made-up time in their own. Fine among
   friends; a public board would need times checked on a server.
8. **Performance** hasn't been profiled on real low-end GPUs; the Low
   preset is the lever if it's needed.
9. **The gamepad layout isn't rebindable** (the keyboard is).
