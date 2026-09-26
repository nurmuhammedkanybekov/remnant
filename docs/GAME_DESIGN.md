# REMNANT — Technical & Design Documentation

A browser based first person survival horror shooter. Doom's structural
simplicity (grid levels, primitive geometry, zero external assets) carrying a
scarcity/stealth layer borrowed from The Last of Us: limited ammo and battery,
no health regen, and enemies that hunt by sound as much as sight.

This document maps what exists today — every system, the tunable numbers, and
the known gaps.

---

## 1. Quick facts

|              |                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine       | Three.js r166 (WebGL) + its `EffectComposer` post-processing                                                                                                                  |
| Language     | TypeScript (strict)                                                                                                                                                           |
| Build        | Vite 5                                                                                                                                                                        |
| Runtime deps | `three` only                                                                                                                                                                  |
| Assets       | **None shipped.** Textures are painted onto `<canvas>` at startup; all audio is synthesized with the Web Audio API. (UI fonts load from Google Fonts, with system fallbacks.) |
| Levels       | 10 hand-authored grid maps with scripted story beats (see `STORY.md`)                                                                                                         |

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build -> dist/
```

Append `?debug` to the URL to expose `window.game` (see §12).

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
│   ├── loadout.ts             What carries between levels
│   └── stats.ts               Run statistics
├── content/                   Game data — balancing is a data change, not a code change
│   ├── enemies.ts             Enemy definitions and map glyphs
│   ├── weapons.ts             Weapon definitions
│   ├── items.ts               Pickup amounts and glow colours
│   └── difficulty.ts          Difficulty modes
├── core/
│   ├── engine.ts              Renderer, tone mapping, post-processing, world + viewmodel scenes
│   ├── input.ts               Raw keyboard / mouse / pointer-lock state
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
├── weapons/                   Weapon state machine and first-person viewmodel
├── enemies/                   AI state machine, creature rig, enemy manager
├── items/pickup.ts            Pickup meshes and animation
├── fx/                        Procedural canvas textures, particles
├── audio/soundManager.ts      Synth SFX, stereo panning, wall muffling, reverb, ambience
└── ui/                        HUD, menus, styles
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
menu ──New Game / Chapters──► difficulty ──► playing ──exit──► levelComplete ──Continue──► playing (next level)
  ▲  └─Continue (saved run)─────────────────────┘ │ ▲                         (last level) ► victory ──► menu
  │                                           Esc │ │ Resume
  │                                               ▼ │
  └──────────────Quit───────────────────────── paused ──Restart──► playing
playing ──health 0──► dead ──Retry──► playing (same level, same starting loadout)
                          └─(Ironman)──► run over, save deleted ──► menu
```

- The main menu renders a slowly turning view of the Maintenance Wing behind it.
- A new game from the first level opens with the **prologue**; the last
  level ends with one of **two endings** (`content/story.ts`).
- **Saving** (`game/save.ts`): the run is saved whenever a level starts,
  when one is completed, and at every **mid-level checkpoint**. A checkpoint
  stores the player's position, loadout, stats and which pickups, kills,
  doors, generators, intercoms and triggers are already done
  (`game/checkpoint.ts`); on death the player can retry from it or restart
  the level. "Continue" resumes at the start of the saved
  level with the loadout you entered it with. Reaching a level unlocks it in
  **Chapters**. Best clear time per level is recorded. The save is one
  versioned JSON document; anything malformed is repaired field by field
  rather than discarded, and older versions are migrated (v1 → v2 shifted
  level indices when the campaign grew from two levels to ten).
- **Carry-over**: health, battery and ammo carry into the next level, topped
  up to the difficulty's floors so a bad run isn't unwinnable.
- If pointer lock is refused (browsers block re-locking right after Esc), the
  HUD shows "CLICK TO RESUME" and clicking the view re-locks.

Per playing frame, `Game` builds a `PlayerCommand` and calls
`LevelSession.step`: player → enemies → weapon → shooting → pickups → lamps
→ particles → viewmodel → post-fx/audio → HUD → exit check.

### Difficulty (`content/difficulty.ts`)

|                                       | Story   | Normal  | Nightmare | Ironman |
| ------------------------------------- | ------- | ------- | --------- | ------- |
| Enemy health                          | ×0.7    | ×1      | ×1.3      | ×1      |
| Enemy damage                          | ×0.5    | ×1      | ×1.5      | ×1      |
| Enemy sight & hearing                 | ×0.75   | ×1      | ×1.25     | ×1      |
| Pickup amounts                        | ×1.5    | ×1      | ×0.75     | ×1      |
| Flashlight drain                      | ×0.6    | ×1      | ×1.3      | ×1      |
| Starting reserve ammo                 | 32      | 16      | 8         | 16      |
| Health / battery floor between levels | 70 / 50 | 40 / 30 | 25 / 20   | 40 / 30 |
| Lives                                 | ∞       | ∞       | ∞         | **1**   |

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
- **Textures** are generated once on a canvas: panelled concrete with hazard
  kick-plate and water streaks, floor tiles, ceiling panels, crates, barrels,
  medkit, paper, EXIT sign, glow/flash sprites, bullet holes. Walls also use
  the texture as a bump map.
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
| `A`     | ammo                                       | `M`     | medkit                              |
| `B`     | battery                                    | `K`     | keycard                             |
| `L`     | ceiling lamp                               | `R`     | red emergency lamp                  |
| `C`     | crate stack (solid)                        | `O`     | barrels (solid)                     |
| `D`     | door                                       | `=`     | security door (needs the keycard)   |
| `G`     | generator (solid)                          | `Y`     | intercom                            |
| `~`     | shallow water                              | `*`     | checkpoint                          |
| `Z`     | detonator console (finale only)            | `0`–`9` | note, text from the level's `notes` |
| `a`–`z` | invisible trigger, runs `triggers[letter]` |         |                                     |

A level is a `LevelDef`: map, notes, spawn facing, and optionally
`triggers`, `intercoms`, `events` (`start`, `keycard`, `power`), a `theme`
and the `finale` flag. Enemy glyphs come from `content/enemies.ts`. The
parser rejects unknown characters, missing or duplicate spawns/exits, notes
or triggers without text, and intercom counts that don't match their
scripts, with an error naming the level and cell.

**Locks.** If a level has security doors, the keycard opens them; otherwise
it unlocks the exit. If a level has generators, the exit has no power until
every one is running.

**Themes** (`world/theme.ts`) set fog colour and density, fill light, wall
and floor tint and lamp colour per level.

| #   | Level                         | Enemies           | What's new                                |
| --- | ----------------------------- | ----------------- | ----------------------------------------- |
| 1   | Sublevel 10 — Infirmary       | 2 husks           | Tutorial, intercom, doors, hints          |
| 2   | Sublevel 9 — Maintenance Wing | 3 husks           | Stealth                                   |
| 3   | Sublevel 8 — Cold Storage     | 2 husks, brute    | Keycard-locked exit, first Brute          |
| 4   | Sublevel 7 — Pumping Station  | 3 husks, brute    | Water, security doors                     |
| 5   | Sublevel 6 — Containment Labs | 4 husks, brute    | Doors everywhere                          |
| 6   | Sublevel 5 — Ventilation      | 5 husks           | Duct maze, the radio lies                 |
| 7   | Sublevel 4 — Power Plant      | 3 husks, brute    | Three generators power the exit           |
| 8   | Sublevel 3 — Armory           | 5 husks, 2 brutes | Big open hall, supplies                   |
| 9   | Sublevel 2 — The Hive         | 3 husks, 3 brutes | The Operator reveals itself               |
| 10  | Surface — Lift Shaft          | 2 husks, brute    | The choice: leave, or trigger the charges |

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
actions: `radio` (subtitled lines from the Operator, Aida or an unknown
voice), `objective`, `hint` (with `{action}` placeholders replaced by the
player's current key binding), `checkpoint` and `alarm`. The radio plays one
line at a time on the simulation clock, so pausing pauses the conversation.

### Collision & raycasts (`world/grid.ts`)

- `resolveCollision` — circle vs. grid, axis-separated so you slide along walls.
  Used by the player (r 0.35) and enemies (r 0.35 / 0.5).
- `hasLineOfSight` — samples the segment every 0.8 units against the grid.
- `raycastWorld` — exact DDA grid walk + floor/ceiling planes. Bullets stop at
  walls and leave sparks + a decal.

---

## 6. Player

|                              |                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| Walk / sprint / crouch speed | 3.3 / 5.8 / 1.7 (smoothed acceleration)                                                       |
| Sprint                       | Shift, forward only, not while crouched. Can't fire while sprinting.                          |
| Stamina                      | 100, drain 20/s, regen 16/s (×1.3 when still or crouched). Emptying it locks sprint until 25. |
| Crouch                       | Hold C (or Ctrl): eye height 1.05, near-silent                                                |
| Health                       | 100, no regen, 0.35 s mercy window between hits                                               |
| Feel                         | head-bob, strafe lean, recoil pitch kick, trauma-based camera shake                           |

**Noise.** Each gait has a hearing radius: still 0, crouch 1.6, walk 5.5,
sprint 12. Walls cut it to 40%. **Water** multiplies it by 1.8 and slows you
to 72%. The HUD noise meter shows your current level.

**Flashlight** (F): spotlight held low-right with beam sway that lags your
aim. Battery 100, drains 1.7/s (~60 s). While off it trickles back to at
most 25; beyond that you need battery pickups (+45). Flickers below 20.
With it on, enemies can see you from 15 units instead of 6.

---

## 7. Weapon

| Stat                                      | Value                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| Damage                                    | 26 (×2.5 headshot)                                                      |
| Fire cooldown                             | 0.24 s, semi-auto                                                       |
| Magazine / reserve max / starting reserve | 8 / 48 / 16                                                             |
| Reload                                    | 1.5 s (auto-reload on dry trigger pull)                                 |
| Range                                     | 40                                                                      |
| Spread                                    | 0.006 rad base, grows with movement and rapid fire (crosshair shows it) |
| Noise                                     | 22 units (60% through walls) — every shot alerts the area               |

Hit-testing: ray vs. per-enemy spheres (head, chest, hips, legs) that follow
the animated rig, clipped to the wall-hit distance. Feedback: hit marker
(red for headshots, larger on kills), blood burst, hit sound, enemy flinch.

The **viewmodel** is a primitive-built pistol + gloved hand with idle sway,
mouse-lag sway, walk bob, recoil with slide blow-back, a full reload
animation (dip, mag out, mag in, rack) timed to the reload sound, and a
lowered pose while sprinting.

---

## 8. Enemies

### States

```
patrol ──hears you / half-sees you──► investigate ──arrives──► search ──timeout──► patrol
   │                                        │                     ▲
   └──────── fully sees you / shot ─────────┴──► chase ──lost 3.5 s─┘
                                                  │  ▲
                                            in reach  recover
                                                  ▼  │
                                                attack (wind-up → strike)
```

- **Sight**: 60° half-angle cone, 6 units (your light off) / 15 (light on),
  needs line of sight. Suspicion builds over time at range (instant up
  close), so you get a moment to duck away. Once hunting, they track you all
  round.
- **Hearing**: your gait's noise radius × their hearing multiplier, 40%
  through walls. Gunshots are separate noise events.
- **Losing them**: break line of sight and stay quiet for 3.5 s and a chaser
  switches to searching your last known position for ~6 s, then goes back
  to patrolling.
- **Attacks** have a visible/audible wind-up (arms rise, hiss). Back off
  during it and the strike misses.
- **Movement**: BFS path, string-pulled with line-of-sight so they don't zig-
  zag cell to cell, circle-vs-wall collision, and separation so packs don't
  overlap.

|                                      | Husk            | Brute           |
| ------------------------------------ | --------------- | --------------- |
| Health                               | 60              | 190             |
| Speed (patrol / investigate / chase) | 1.0 / 1.9 / 3.6 | 0.8 / 1.5 / 2.5 |
| Attack range / damage                | 1.35 / 16       | 1.75 / 34       |
| Wind-up / recover                    | 0.38 / 0.8 s    | 0.65 / 0.9 s    |
| Hearing multiplier                   | 1.0             | 0.8             |

A husk out-runs your walk but not your sprint.

### Model & animation

Gaunt, hunched humanoid from primitives: forward-leaning torso with exposed
ribs and spine ridges, long neck, jutting head with jaw, glowing eyes (with
additive glow sprites so they read in the dark), long clawed arms. Procedural
walk cycle driven by actual speed, arms reach forward while hunting, head
twitches, stagger on hit, red flash on damage, and a backwards collapse on
death with the eyes fading out.

---

## 9. Items

| Item    | Effect                                |
| ------- | ------------------------------------- |
| Ammo    | +8 reserve (not picked up if full)    |
| Medkit  | +45 HP (not picked up at full health) |
| Battery | +45 flashlight charge                 |
| Keycard | Unlocks the level exit                |
| Note    | Shows a typewritten note card for 7 s |

Each has a small modelled mesh and a coloured glow so it's findable with
the light off.

---

## 10. Audio

All synthesized. Chain: voice → (low-pass if a wall is between you) → stereo
panner → dry bus + convolution reverb (generated impulse) → master →
compressor.

- **Weapon**: layered gunshot (crack, body, sub boom, shell tinkle), dry-fire
  click, 5-stage reload matched to the animation, hit-marker thud, wall
  ricochet.
- **Player**: alternating footsteps per gait, flashlight click, hurt grunt,
  heartbeat below 40% health (faster as it drops), death drone.
- **Enemies** (panned + distance-attenuated + muffled through walls):
  clicking or wet breathing idles, a wavering shriek on alert, wind-up hiss,
  hurt screech, death groan. Brutes are pitched down.
- **Ambience**: detuned low drone with a slow filter swell, plus random
  distant drips, metal groans and clanks.
- **World & radio**: a synthesized radio voice (key-up click, static bed and
  band-passed "syllables" for the length of the subtitle), door motors,
  generator start-up and thrum, splashing footsteps, intercom chime,
  checkpoint tone and the detonation.
- Pause ducks the mix. Master volume is a setting.

---

## 11. UI

- **HUD**: level + objective (top left); awareness eye showing SUSPICIOUS /
  HUNTED (top centre); dynamic crosshair; hit marker; directional damage
  arcs; health (with lag bar) / stamina / battery (bottom left); keycard
  indicator; noise meter (bottom centre); magazine, reserve, round pips and
  reload hint (bottom right); pickup toasts; context prompts; interact
  prompt with the bound key; radio subtitles with the speaker's name; note
  card; level-name intro. DOM updates only when values change.
- **Screens**: main menu (Continue / New Game / Chapters / Settings /
  Controls), prologue, ending, difficulty select, chapter select with best times, confirm
  dialog, pause, settings (sensitivity, FOV, volume, invert Y — saved),
  controls with **rebinding** (click a slot, press a key or mouse button;
  Backspace clears; a key moved to a new action is removed from its old one),
  death with run stats, level complete with stats and "new best", victory with
  run totals.

---

## 12. Debug hooks (`?debug`)

With `?debug`, pointer lock isn't required and `window.game` exposes:
`debugStart(levelIndex, difficulty?)`, `debugSimulate(seconds, heldCodes[])`,
`debugFire()`, `debugLook(yaw, pitch)`, `debugTeleport(x, z)`,
`debugEnemies()`, `debugState()`. `debugSimulate` steps the game at a fixed
30 Hz without rendering, holding the given key codes (e.g. `["KeyW",
"ShiftLeft"]`), which is handy for testing AI headlessly.

---

## 13. Testing

`npm test` runs the Vitest suite; `npm run check` adds the typecheck and
formatting check, and CI runs all of it on every push. Deploys are blocked if
any of it fails.

The tests run in Node without a GPU. That's possible because the logic that
matters is separated from rendering: the level parser, grid queries,
pathfinding, weapon, player movement (driven by commands), bindings, settings
and save migration are all pure or near-pure.

**Every shipped level is validated** (`world/levels/levels.test.ts`): it must
parse, have a closed outer wall, a reachable exit, reachable keycards and
pickups, no enemies spawning next to the player, and no orphaned notes.

---

## 14. Known limitations / next steps

See [`ROADMAP.md`](ROADMAP.md) for the full plan.

1. **Two creature types.** Levels 4–9 use Husks and Brutes where
   [`STORY.md`](STORY.md) introduces new creatures; Phase 3 adds them.
2. **One weapon, no melee.** A quiet melee takedown would suit the stealth
   design.
3. **Pathfinding** is per-enemy BFS (fine at this scale; switch to a shared
   flow field if enemy counts grow a lot).
4. **Dead enemies never despawn** (fine without respawning).
5. **No shadows**, deliberately, for integrated-GPU performance. Lamp light
   passes through closed doors for the same reason.
6. **No gamepad or touch input.**
7. **Performance** hasn't been profiled on low-end GPUs. If needed: lower
   the lamp pool from 6, drop the pixel-ratio cap (1.5), or remove the
   bump maps.
