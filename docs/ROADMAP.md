# REMNANT — Roadmap

The plan for taking REMNANT from a two-level vertical slice to a complete
ten-level campaign. See [`STORY.md`](STORY.md) for the narrative and
[`GAME_DESIGN.md`](GAME_DESIGN.md) for how the systems work today.

**Ground rules**

- **Free to build, free to host, free to play.** GitHub Pages hosting, no paid
  services. Any backend must fit a free tier.
- **No asset files** for now. Textures, models and audio are generated in
  code. Revisit after Phase 3 if creature models are the weak point; the
  content system is designed so a model loader can be swapped in.
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

## Phase 2 — Campaign

- [ ] Level format v2: named regions, doors, switches, scripted triggers
- [ ] Interact key and interactable objects (doors, generators, radios)
- [ ] Radio dialogue system with subtitles (the Operator)
- [ ] Levels 1–10 as described in `STORY.md` (existing two levels become 2 and 3)
- [ ] Automated level lint: every level is solvable (spawn → keycard → exit)
- [ ] Mid-level checkpoints
- [ ] Both endings

## Phase 3 — Creatures and combat

- [ ] Listener, Watcher, Crawler, Spitter, Swarm, Mimic
- [ ] Boss: the Remnant (multi-phase)
- [ ] Quiet melee takedowns from behind
- [ ] Shotgun, and one more weapon to be designed
- [ ] Weapon switching and a small inventory
- [ ] Improved creature visuals: emissive veins, silhouettes, per-type rigs

## Phase 4 — Sound, music, interface

- [ ] Adaptive music: calm / tension / chase layers driven by threat level
- [ ] Main theme for the menu
- [ ] Redesigned main menu, level transition cards, loading screen
- [ ] HUD pass, subtitles, accessibility options (colour-blind safe HUD,
      reduced camera shake, subtitle size)
- [ ] Gamepad support
- [ ] Graphics quality presets

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
