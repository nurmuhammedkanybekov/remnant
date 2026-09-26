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
| Levels       | 2 hand-authored grid maps, played in sequence                                                                                                                                 |

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build -> dist/
```

Append `?debug` to the URL to expose `window.game` (see §12).

---

## 2. Directory structure

```
src/
├── main.ts                    Bootstraps `new Game(#app)`
├── game.ts                    Orchestrator: state machine, level lifecycle, wiring, main loop
├── core/
│   ├── engine.ts              Renderer, tone mapping, post-processing, world + viewmodel scenes
│   ├── input.ts               Keyboard / mouse / pointer-lock state
│   ├── clock.ts               Clamped delta time
│   └── settings.ts            Sensitivity / FOV / volume / invert-Y, persisted to localStorage
├── world/
│   ├── level.ts               Map parser, geometry, exit door, collision, LOS, bullet raycast
│   ├── lamps.ts               Pooled ceiling lights with flicker behaviours
│   ├── pathfinding.ts         Grid BFS
│   └── levels/                level1.ts, level2.ts, index.ts (play order)
├── player/
│   ├── playerController.ts    Movement, crouch/sprint, stamina, head-bob, recoil, camera shake
│   ├── flashlight.ts          Spotlight, battery, beam sway, low-battery flicker
│   └── health.ts              HP, mercy frames, damage source
├── weapons/
│   ├── weapon.ts              Ammo / cooldown / reload / spread state machine
│   ├── pistol.ts              The pistol's numbers
│   └── viewmodel.ts           First-person gun + hand, recoil / reload / sprint animation, muzzle flash
├── enemies/
│   ├── enemy.ts               AI state machine, perception, movement, procedural animation
│   ├── enemyMesh.ts           Creature rig built from primitives
│   └── enemyManager.ts        Owns enemies, noise events, hit-testing, threat level
├── items/pickup.ts            Ammo, medkit, battery, keycard, note
├── fx/
│   ├── textures.ts            All procedural canvas textures (cached)
│   └── particles.ts           Sparks, blood, bullet-hole decals, flashlight dust motes
├── audio/soundManager.ts      Synth SFX, stereo panning, wall muffling, reverb, ambience, heartbeat
└── ui/
    ├── styles.ts              All UI CSS (injected once)
    ├── hud.ts                 In-game HUD
    └── menu.ts                Main / pause / settings / controls / death / level-complete / victory
```

---

## 3. Game flow

```
menu ──New Game──► playing ──exit reached──► levelComplete ──Continue──► playing (next level)
                     │  ▲                                   (last level) ► victory ──► menu
                  Esc│  │Resume
                     ▼  │
                   paused ──Restart / Quit──► playing / menu
playing ──health 0──► dead ──Retry──► playing (same level, same starting loadout)
```

- The main menu renders a slowly turning view of level 1 behind it.
- **Carry-over**: health, battery and ammo carry into the next level. Health
  is topped up to at least 40 and battery to 30 between levels so a bad run
  isn't unwinnable. "Retry" restores the loadout you _entered_ the level with.
- If pointer lock is refused (browsers block re-locking right after Esc), the
  HUD shows "CLICK TO RESUME" and clicking the view re-locks.

`Game.step(dt)` runs the simulation; the rAF loop calls `step`, then renders.
Order per playing frame: player → enemies → weapon → shooting → pickups →
lamps → particles → viewmodel → post-fx/audio → HUD → exit check.

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

| Char    | Meaning                                   | Char | Meaning                           |
| ------- | ----------------------------------------- | ---- | --------------------------------- |
| `#`     | wall                                      | `.`  | floor                             |
| `S`     | player spawn                              | `X`  | exit                              |
| `E`     | husk                                      | `H`  | brute                             |
| `A`     | ammo                                      | `M`  | medkit                            |
| `B`     | battery                                   | `K`  | keycard (exit locked until taken) |
| `L`     | ceiling lamp                              | `R`  | red emergency lamp                |
| `C`     | crate stack (solid)                       | `O`  | barrels (solid)                   |
| `0`–`9` | note, text from the level's `notes` table |      |                                   |

A level is a `LevelDef` (`id`, `name`, `subtitle`, `objective`, `map`,
`notes`, `spawnYaw`). Spawn facing now lives in the level data rather than
being hard-coded in the player.

| #   | Name                          | Size  | Enemies           | Notes               |
| --- | ----------------------------- | ----- | ----------------- | ------------------- |
| 1   | Sublevel 3 — Maintenance Wing | 22×17 | 3 husks           | Find the exit       |
| 2   | Sublevel 2 — Cold Storage     | 26×19 | 2 husks + 1 brute | Keycard-locked exit |

The exit is a door + EXIT sign mounted on the wall next to the `X` cell. Its
sign and light turn red while locked.

### Collision & raycasts (`world/level.ts`)

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
sprint 12. Walls cut it to 40%. The HUD noise meter shows your current level.

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
- Pause ducks the mix. Master volume is a setting.

---

## 11. UI

- **HUD**: level + objective (top left); awareness eye showing SUSPICIOUS /
  HUNTED (top centre); dynamic crosshair; hit marker; directional damage
  arcs; health (with lag bar) / stamina / battery (bottom left); keycard
  indicator; noise meter (bottom centre); magazine, reserve, round pips and
  reload hint (bottom right); pickup toasts; context prompts; note card;
  level-name intro. DOM updates only when values change.
- **Screens**: main menu, pause (resume / restart / settings / controls /
  quit), settings (sensitivity, FOV, volume, invert Y — saved), controls +
  tips, death with run stats, level complete with stats, victory with totals.

---

## 12. Debug hooks (`?debug`)

With `?debug`, pointer lock isn't required and `window.game` exposes:
`debugStart(levelIndex)`, `debugSimulate(seconds, heldKeys[])`,
`debugFire()`, `debugLook(yaw, pitch)`, `debugTeleport(x, z)`,
`debugEnemies()`, `debugState()`. `debugSimulate` steps the game at a fixed
30 Hz without rendering, which is handy for testing AI headlessly.

---

## 13. Known limitations / next steps

1. **Two levels.** Level format supports more; add a `LevelDef` to
   `world/levels/index.ts`.
2. **One weapon, no melee.** A quiet melee takedown would suit the stealth
   design.
3. **No save/checkpoints** within or between sessions.
4. **Pathfinding** is per-enemy BFS (fine at this scale; switch to a shared
   flow field if enemy counts grow a lot).
5. **Dead enemies never despawn** (fine without respawning).
6. **No shadows** — deliberate for integrated-GPU performance. The
   flashlight could cast shadows as an optional quality setting.
7. **No gamepad / touch input, no key rebinding.**
8. **Performance** hasn't been profiled on low-end GPUs. If needed: lower
   the lamp pool from 6, drop the pixel-ratio cap (1.5), or remove the
   bump maps.
