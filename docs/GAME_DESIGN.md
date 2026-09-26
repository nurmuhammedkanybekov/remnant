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
├── items/pickup.ts            Pickup meshes and animation
├── fx/                        Procedural canvas textures, particles
├── audio/soundManager.ts      Synth SFX, stereo panning, wall muffling, reverb, ambience
├── audio/music.ts             Adaptive music: layers, intensity, the theme
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
title ──any key──► menu ──New Game / Chapters──► difficulty ──► card ──► playing ──exit──► levelComplete ──Continue──► card (next level)
  ▲  └─Continue (saved run)─────────────────────┘ │ ▲                         (last level) ► victory ──► menu
  │                                           Esc │ │ Resume
  │                                               ▼ │
  └──────────────Quit───────────────────────── paused ──Restart──► playing
playing ──health 0──► dead ──Retry──► playing (same level, same starting loadout)
                          └─(Ironman)──► run over, save deleted ──► menu
```

- A **loading screen** is plain HTML, so it shows before any script runs;
  if WebGL can't start it says so instead of leaving a black page. Then a
  **title screen** waits for a key or button (browsers only allow audio
  after one) and the theme starts.
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

|                                       | Story   | Normal  | Nightmare | Ironman |
| ------------------------------------- | ------- | ------- | --------- | ------- |
| Enemy health                          | ×0.7    | ×1      | ×1.3      | ×1      |
| Enemy damage                          | ×0.5    | ×1      | ×1.5      | ×1      |
| Enemy sight & hearing                 | ×0.75   | ×1      | ×1.25     | ×1      |
| Pickup amounts                        | ×1.5    | ×1      | ×0.75     | ×1      |
| Flashlight drain                      | ×0.6    | ×1      | ×1.3      | ×1      |
| Starting reserve ammo                 | 32      | 16      | 8         | 16      |
| Starting medkits                      | 2       | 1       | 0         | 1       |
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
| Medkits                      | Carried, up to 3. Use (H) takes 1.3 s — weapon lowered — and heals 45                         |
| Melee (V / right click)      | 0.55 s cooldown. Takedown from behind, or 20 damage + shove                                   |
| Feel                         | head-bob, strafe lean, recoil pitch kick, trauma-based camera shake                           |

**Noise.** Each gait has a hearing radius: still 0, crouch 1.6, walk 5.5,
sprint 12. Walls cut it to 40%. **Water** multiplies it by 1.8 and slows you
to 72%. The HUD noise meter shows your current level.

**Flashlight** (F): spotlight held low-right with beam sway that lags your
aim. Battery 100, drains 1.7/s (~60 s). While off it trickles back to at
most 25; beyond that you need battery pickups (+45). Flickers below 20.
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

The **viewmodels** are built from primitives: pistol and gloved hand, a
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

- **Watcher**: frozen while the lit beam (within ~0.42 rad of your aim and 20
  units) is on it and it's in line of sight. Frozen, it can't move or finish
  a wind-up, and can be taken down from any side.
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
opens its core for 3.5 s and summons at once. The exit is sealed until it
dies; when it does, everything it birthed dies with it. The player can't
walk into it.

### Bodies & animation (`enemies/bodies.ts`)

Each creature type has its own rig, all from primitives:

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
agitated. A hit flashes the whole body. Procedural walk cycles are driven by
actual speed, with wind-up and strike poses, hit flinches, and a collapse on
death (a Crawler killed on the ceiling falls first).

---

## 9. Items

| Item      | Effect                                                         |
| --------- | -------------------------------------------------------------- |
| Ammo      | +8 rounds (not picked up if full)                              |
| Shells    | +4 shotgun shells                                              |
| Rivets    | +12 rivets                                                     |
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

- **Weapon**: layered gunshot (crack, body, sub boom, shell tinkle), dry-fire
  click, 5-stage reload matched to the animation, hit-marker thud, wall
  ricochet.
- **Player**: alternating footsteps per gait, flashlight click, hurt grunt,
  heartbeat below 40% health (faster as it drops), death drone.
- **Enemies** (panned + distance-attenuated + muffled through walls):
  clicking or wet breathing idles, a wavering shriek on alert, wind-up hiss,
  hurt screech, death groan, a choked gurgle for takedowns, a thud and
  skitter when a Crawler drops, a Spitter's rising gurgle, acid sizzle, and
  the Remnant's slam and many-voiced roar. Voices are pitched per creature
  (Brutes low, rats high). Mimic lures are positioned in the world, including
  the Operator's radio voice coming from somewhere it shouldn't.
- **Weapons**: the pistol as before; the shotgun's boom and pump; the rivet
  gun's pneumatic hiss and chunk; shell loading; weapon switching; melee
  swings; the medkit injector.
- **Ambience**: detuned low drone with a slow filter swell, plus random
  distant drips, metal groans and clanks.
- **World & radio**: a synthesized radio voice (key-up click, static bed and
  band-passed "syllables" for the length of the subtitle), door motors,
  generator start-up and thrum, splashing footsteps, intercom chime,
  checkpoint tone and the detonation.
- Pause ducks the mix. Master and music volume are settings.

### Adaptive music (`audio/music.ts`)

One piece in D minor (i – VI – iv – V, 72 bpm, four-bar loop), every note
scheduled ahead on the audio clock so all layers stay in time however they
are mixed:

| Layer   | What it is                                             | Heard when                     |
| ------- | ------------------------------------------------------ | ------------------------------ |
| Pad     | Slow detuned chords with a sub                         | Always, thinning under a chase |
| Bells   | Sparse music-box notes from the chord                  | Calm exploration               |
| Tension | Low pulse on the eighths, a trembling semitone cluster | Something is suspicious        |
| Chase   | Kick, snare, hats, a filtered 16th bass, chord stabs   | Something is hunting you       |
| Melody  | The main theme, with a soft echo                       | Menu, results and endings      |

The session's **threat** (the HUD eye: ~0.6 when a creature is suspicious or
searching, 1 when hunted or the Remnant is awake) drives an intensity that
rises fast (1.6/s), falls slowly (0.12/s), and holds at full for 5 s after a
chase ends so the music doesn't flap. Tension fades in over 0.2–0.55,
the chase over 0.8–0.97. Death cuts the music; a new level starts calm.

---

## 11. UI

- **HUD**: level + objective (top left); awareness eye showing SUSPICIOUS /
  HUNTED (top centre); dynamic crosshair; hit marker; directional damage
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

## 12. Debug hooks (`?debug`)

With `?debug`, pointer lock isn't required and `window.game` exposes:
`debugStart(levelIndex, difficulty?)`, `debugSimulate(seconds, heldCodes[])`,
`debugFire()`, `debugLook(yaw, pitch)`, `debugTeleport(x, z)`,
`debugEnemies()`, `debugState()`, `debugMusicLevel()`. `debugSimulate` also
takes gamepad buttons to hold. `debugSimulate` steps the game at a fixed
30 Hz without rendering, holding the given key codes (e.g. `["KeyW",
"ShiftLeft"]`), which is handy for testing AI headlessly.

---

## 13. Testing

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

## 14. Known limitations / next steps

See [`ROADMAP.md`](ROADMAP.md) for the full plan.

1. **Pathfinding** is per-enemy BFS (fine at this scale — the Armory's 18
   rats included; switch to a shared flow field if enemy counts grow a lot).
2. **Dead enemies never despawn** (fine without respawning).
3. **No shadows**, deliberately, for integrated-GPU performance. Lamp light
   passes through closed doors for the same reason.
4. **Creatures are primitives.** Per-type rigs and glowing veins make them
   readable in the dark, but a proper model pipeline (see the roadmap's
   asset rule) would be the next step up.
5. **No touch input.**
6. **Performance** hasn't been profiled on real low-end GPUs; the Low
   preset is the lever if it's needed.
7. **The gamepad layout isn't rebindable** (the keyboard is).
