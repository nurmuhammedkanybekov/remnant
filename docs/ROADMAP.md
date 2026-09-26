# REMNANT — Roadmap

The plan for taking REMNANT from a two-level vertical slice to a complete
ten-level campaign. See [`STORY.md`](STORY.md) for the narrative and
[`GAME_DESIGN.md`](GAME_DESIGN.md) for how the systems work today.

**Ground rules**

- **Free to build, free to host, free to play.** GitHub Pages hosting, no paid
  services. Any backend must fit a free tier.
- **Generated in code by default.** Textures, models, music and most audio
  are generated in code. Recordings are used only where synthesis can't
  sound real — weapons, footsteps, creature voices, doors — and only public-domain
  (CC0) ones, credited in `public/sfx/CREDITS.md`, each with a synthesized
  fallback.
- **Every phase ships.** Each phase ends with a playable build, green CI and
  updated docs.

---

## Phase 1 — Foundations ✅

Make the codebase ready to grow to 10 levels, many enemy types and co-op.

- [x] Story bible and roadmap
- [x] Data-driven content: enemies, weapons, items and difficulty live in
      `src/content/` as plain definitions
- [x] Level parsing separated from geometry building (testable without WebGL)
- [x] Input actions + key rebinding (two keys per action, persisted)
- [x] Simulation driven by a per-frame `PlayerCommand`, not raw input
      (prerequisite for co-op and replays)
- [x] `LevelSession` extracted from `Game`: the game shell handles flow and
      menus; the session handles one level of gameplay
- [x] Difficulty modes: Story, Normal, Nightmare, Ironman
- [x] Save system: continue a campaign, chapter select for unlocked levels,
      versioned save format with migration
- [x] Unit tests (Vitest) + CI on every push and pull request
- [x] Prettier formatting, EditorConfig

## Phase 2 — Campaign ✅

- [x] Level format v2: doors, security doors, generators, intercoms, water,
      checkpoints and invisible script triggers
- [x] Interact key and interactable objects
- [x] Radio dialogue system with subtitles and a synthesized radio voice
- [x] Levels 1–10 as described in `STORY.md` (the original two levels are now 2 and 3)
- [x] Lock-aware level lint: every level is solvable (spawn → keycard → security door → exit)
- [x] Mid-level checkpoints
- [x] Prologue and both endings
- [x] Per-level visual themes
- [x] Save format v2, with migration of v1 saves

## Phase 3 — Creatures and combat ✅

- [x] Listener, Watcher, Crawler, Spitter, Swarm, Mimic — each introduced on
      the level `STORY.md` gives it
- [x] Boss: the Remnant (three phases, armoured hide, a core that opens when
      it attacks, summoned swarms) in a new arena on Sublevel 2
- [x] Quiet melee takedowns from behind (and a shove from the front)
- [x] Shotgun (shell-by-shell loading), and the rivet gun: a nearly silent
      stealth weapon found in the ducts
- [x] Weapon switching (number keys, cycle key, mouse wheel) and a small
      inventory: carried medkits, used on demand
- [x] Improved creature visuals: glowing veins, per-type silhouettes and
      rigs (humanoid variants, rats, the Remnant's mass)
- [x] Save format v3 (multi-weapon loadouts), with migration of v2 saves

## Phase 4 — Sound, music, interface ✅

- [x] Adaptive music: calm / tension / chase layers driven by threat level,
      one synthesized piece on a shared clock
- [x] Menu music (a melodic theme was tried, then dropped: the menus keep
      the darker ambient drone)
- [x] Redesigned main menu (depth gauge, intercepted radio), level
      transition cards, loading screen and title screen
- [x] HUD pass (weapon-aware key hints, crosshair fades when you can't
      fire), subtitle size, HUD size, colour-blind friendly HUD, reduced
      camera shake
- [x] Gamepad support: play, pause and every menu, with prompts that switch
      to pad buttons
- [x] Graphics quality presets (Low / Medium / High)

## Phase 5 — Accounts and cloud saves (optional)

- [ ] Sign in with Google/GitHub through a free-tier backend (Supabase or
      Firebase)
- [ ] Cloud save sync; local saves keep working offline
- [ ] Per-level best times

## Phase 6 — Two-player co-op (optional)

- [ ] Host-authoritative simulation: host runs the world, guest sends
      `PlayerCommand`s and receives snapshots
- [ ] WebRTC peer-to-peer with room codes (free public signaling)
- [ ] Second player avatar, revive mechanic, shared objectives
- [ ] Graceful fallback when a peer-to-peer connection can't be made
