# REMNANT — Roadmap

The plan for taking REMNANT from a two-level vertical slice to a complete
ten-level campaign. See [`STORY.md`](STORY.md) for the narrative and
[`GAME_DESIGN.md`](GAME_DESIGN.md) for how the systems work today.

**Ground rules**

- **Free to build, free to host, free to play.** GitHub Pages hosting, no paid
  services. Any backend must fit a free tier.
- **Generated in code by default.** Models, music and most audio are
  generated in code. Recordings are used only where synthesis can't sound
  real — weapons, footsteps, creature voices, doors — and photo-scanned
  materials only as the base of the big surfaces, with details painted over
  them. Only public-domain (CC0) ones, credited in `public/sfx/CREDITS.md`
  and `public/textures/CREDITS.md`, each with a generated fallback.
- **Every phase ships.** Each phase ends with a playable build, green CI and
  updated docs.

---

## Phase 1 — Foundations (done)

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
- [x] Difficulty modes: Story, Normal, Nightmare, Ironman, Aizi
- [x] Save system: continue a campaign, chapter select for unlocked levels,
      versioned save format with migration
- [x] Unit tests (Vitest) + CI on every push and pull request
- [x] Prettier formatting, EditorConfig

## Phase 2 — Campaign (done)

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

## Phase 3 — Creatures and combat (done)

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

## Phase 4 — Sound, music, interface (done)

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
- [x] Photo-scanned CC0 surface materials (normal and roughness mapped) with
      the facility details painted over them, and per-face wall variation

## Phase 5 — Cloud saves (done)

- [x] Google sign-in on Firebase's free plan (no server to run, no card);
      the save is one small Firestore document per player, written over the
      REST API so the database SDK never ships
- [x] Merge rules that never lose progress: unlocks, finished modes,
      endings and notes are joined, best times keep the fastest, and the
      most recently changed copy decides the run in progress
- [x] Uploads a few seconds after each change; offline keeps saving locally
- [x] Save files: export and import progress with no account at all
- [x] Database rules in `firebase/firestore.rules`: each player reads and
      writes only their own save

## Phase 6 — Two-player co-op (done)

- [x] Host-authoritative world: the host runs creatures, doors, generators,
      the boss and the level's end and streams them; the guest's creatures
      are puppets. Each player simulates their own movement (no input lag)
      and sends it 20×/s — a deliberate change from "guest sends commands",
      which would make the guest's own movement lag.
- [x] WebRTC peer-to-peer with five-character room codes (free public
      PeerJS signaling, or a self-hosted server via `?signal=`)
- [x] Creatures hunt whichever player is closest; either torch holds a
      Watcher
- [x] Second player figure with a real headlamp, spatial gunshots and
      footsteps, partner health on the HUD
- [x] Down-and-revive (45 s bleed-out, hold Use to revive), team wipe
      restarts both from the checkpoint
- [x] Shared objectives: keycard, generators, intercoms, triggers,
      checkpoints, leaving each sublevel together
- [x] Graceful failure: clear messages for a wrong code, a full room,
      blocked connections, version mismatch; the host plays on alone if
      the guest leaves
- [x] A free relay (TURN) for networks that block direct connections,
      switched on with two repository variables; the lobby says whether
      you're connected directly or through it
- [x] Hardening: level attempts are numbered so stale messages can't leak
      into a retry, background tabs keep the world running, rooms reopen
      when a guest drops out, same-version check

## Phase 7 — Depth and polish (done)

- [x] Aizi: a sixth difficulty after Ironman — harder than Nightmare on every
      axis, the fewest supplies, one life
- [x] More creatures on every difficulty, and small levels fill up too
- [x] Inventory (Tab / I / View): condition, medkits, keycard, weapons and
      ammo, a journal of every note found, and the level's radio log
- [x] Character looks: light-skinned man, dark-skinned man, woman — seen by
      your partner in co-op and in your own hands
- [x] Scarier creatures: teeth and gullet, sunken glowing eyes, bone through
      the skin, growths, claws, breathing, neck spasms, jaw chatter

## Phase 8 — Characters, supplies, backups (done)

- [x] Three named characters (Nur Kanybekov, Raiymbek Asanov, Nuraiza
      Akylbek), chosen at New Game or in the co-op menu; the story,
      notes and subtitles use your name, and your partner's name is on the HUD
- [x] Supplies on each level depend on the difficulty, not just what each
      pickup gives
- [x] Exit on the main menu, back to the silent title screen
- [x] Free daily encrypted backups of the cloud saves through GitHub Actions,
      with a restore script

## Phase 9 — Play it together, play it scared (done)

- [x] Ammunition in small caches spread over each level, found by exploring;
      an ammo floor only when retrying after a death
- [x] Heartbeat and breathing that answer creatures you can't see
- [x] Hold your breath: creatures beside you hear you breathe
- [x] Bottles to throw, to lead creatures away without a shot
- [x] A hidden room behind a loose panel on every level, and fifteen new notes
- [x] An online leaderboard of best times per level, difficulty and mode
- [x] Three-player co-op, with the host passing on what each guest needs
- [x] Voice chat over the game's own connection, placed in the world, and
      heard by the creatures
