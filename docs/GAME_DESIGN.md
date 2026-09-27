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
  next level, with health and battery topped up to the difficulty's floors so
  a bad run isn't unwinnable. Starting from a later chapter hands you the
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
| Pickup amounts                        | ×1.5    | ×1      | ×0.85     | ×1      | ×0.7    |
| Supply pickups on each level          | ×1.4    | ×1      | ×0.85     | ×1      | ×0.65   |
| Flashlight drain                      | ×0.6    | ×1      | ×1.3      | ×1      | ×1.5    |
| Starting reserve ammo                 | 32      | 16      | 12        | 16      | 8       |
| Starting medkits                      | 2       | 1       | 0         | 1       | 0       |
| Health / battery floor between levels | 70 / 50 | 40 / 30 | 25 / 20   | 40 / 30 | 15 / 15 |
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
- **Post-processing** (`engine.ts`): world pass → viewmodel pass (depth
  cleared, so the gun never clips into walls) → output pass → a custom
  shader with film grain, vignette, chromatic aberration that spikes when
  you're hit, and red-tinted desaturation as health drops below 40%.
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
| `a`–`z` | invisible trigger, runs `triggers[letter]` |         |                                     |

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

**Part Two, The Valley** (levels 11–17, `src/world/levels/part2/`). New
Game always offers both parts (Part Two is suggested once Part One is done),
chapter select always has the first level of each part, and finishing Part
One can continue straight into Part Two with the same run. Each level
has more creature health to get past than the one before (checked by a
test), and its own prologue and endings:

| #   | Level                       | Creatures (hand-placed)                                                               | Beat                                                                     |
| --- | --------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 11  | Ak-Suu — Clinic             | 4 husks, listener                                                                     | Three weeks later. The voice is back on the radio                        |
| 12  | Ak-Suu — The Village        | husks, 2 howlers, watcher, mimic, a swarm                                             | The Howler; the garage key opens the exit                                |
| 13  | Kara-Suu — Hydro Dam        | 2 listeners, 2 spitters, howler, husk, crawler, brute                                 | Flooded channels, three generators for the spillway                      |
| 14  | Kosh-Tash — Observatory     | 3 watchers, 2 husks, 2 howlers, brute, mimic                                          | Security doors; the relay tells the truth about the voice                |
| 15  | Drainage Line — Rail Tunnel | 3 crawlers, 3 howlers, 2 listeners, 2 swarms, 2 brutes                                | Four kilometres of dark; alarms                                          |
| 16  | Beneath Ten — The Deep      | everything: watchers, crawlers, spitters, brutes, howlers, listeners, a mimic, swarms | Two generators and a keycard, under Sublevel 10                          |
| 17  | The Cavity — The Source     | the Choir, 2 howlers, watcher, brute                                                  | The last boss; then walk out ("dawn") or set off the charges ("silence") |

Part One's level indices never move (saves and checkpoints store them), so
new levels are only ever appended. Part Two finishes are recorded in
`progress.completedTwo`; saves from before Part Two load unchanged.
