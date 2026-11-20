# REMNANT — Creative direction

_Some things refuse to disappear._

This is the direction the game is being built towards: what is wrong with
it today (measured, not guessed), the few ideas that would make it
recognisable, which of them were chosen and why, and what is done, tested
and still only proposed.

## 1. What REMNANT is (and isn't)

A first-person survival horror game in the browser: Three.js, seventeen
hand-built levels, a story in two parts told over a radio and in notes,
optional co-op for three. It is not a 2D side-scroller, so parallax,
jumping and platforming advice doesn't apply; its equivalents are light,
sound, space and pacing.

## 2. Audit: what is actually there

Measured from the level data and by playing every level in a headless
browser (17/17 load and run with no errors; every level is finished by a
walking bot; see `AUDIT.md` for the earlier pass).

**Strong, kept on purpose**

- Light and sound are real systems: creatures hunt by noise and by your
  torch, Watchers freeze in it, breath can be held, lockers hide you.
- The writing: short notes by people in a hurry, each answering the last
  one's question; the voice on the radio that learned to speak from the
  radio is a genuinely good idea.
- Reactive world: lamps stutter near creatures, blood pools, prints in the
  snow, shots leave marks, rooms echo by size.

**Weak, and why it matters**

| #   | Finding                                                                                                                                                                                                                            | Evidence                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | **Five level shapes for seventeen levels.** Every level is "walk to the exit", "find the keycard", "start the generators", "kill the boss" or the finale. A new level is a new place, not a new experience.                        | walk 5, keycard 6, generators 3, boss 2, finale 2 (`parseLevel` over `LEVELS`).                             |
| 2   | **The best idea in the story isn't something you play.** The voice learns by listening; Mara's first note says "never tell the radio anything about yourself". The player can never tell it anything, so the rule is never tested. | No player input reaches the radio; the radio is one-way.                                                    |
| 3   | **Nothing you do is remembered.** How you play (hiding, shooting, keeping your light on) changes nothing later. The game can't surprise someone who has learned its rules.                                                         | Each level session starts from the level definition and the loadout; no record of behaviour is kept.        |
| 4   | **Part Two is thin where Part One is rich.** Two notes per level against four, and longer levels with more creatures: it leans on combat where Part One leaned on dread.                                                           | Notes: 3–5 per level in Part One, 1–2 in Part Two. Laboratory Zero: 24 creatures.                           |
| 5   | **Nine levels have no authored moment at all**, only systemic scares.                                                                                                                                                              | Levels 2, 3, 4, 6, 7, 8, 11, 13, 15 have no `blackout`/`silence`/`sound`/`apparition` actions (14 has now). |

## 3. Five ideas that could make it recognisable

Ranked on originality, play, feeling and cost (1–5, cost: 5 = cheapest).
Ideas that are only genre conventions were rejected first: more creature
types, upgrade trees, collectible counts, procedural levels, a radio that
crackles near monsters (a known horror convention, not ours).

| Rank | Idea                                                                                                                                                                                                                                                   | Orig. | Play | Feeling | Cost |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---- | ------- | ---- |
| 1    | **Answer the radio, or don't.** At a few moments the voice asks you something: your name, whether you're alone, where you are. Answer and it helps you, with something true. Stay silent and you're on your own. What you tell it, it keeps, and uses. | 5     | 4    | 5       | 3    |
| 2    | **It learns you.** The voice listens to how you play: where you hide, whether you keep your light on, how often you shoot. It says so, and the creatures it speaks through start doing the same: one that knows you hide goes to the lockers first.    | 5     | 4    | 4       | 3    |
| 3    | **Winning makes the world quieter.** The goal is to take its mouths away: cut the relay, and the level's hum dies with each breaker; the voice bargains, then begs, then the channel is empty. Silence is the reward, not the threat.                  | 4     | 3    | 4       | 4    |
| 4    | **Kessler's four notes.** The tune the drill crew hummed, heard before you know what it is. It leads somewhere: follow it and you find what the people who heard it left behind.                                                                       | 4     | 2    | 4       | 3    |
| 5    | **Places that changed while you were gone.** Part Two passes under Part One; the places you fled show what happened after you left.                                                                                                                    | 3     | 2    | 4       | 2    |

## 4. The choice: light, sound and the voice

REMNANT already has two systems the player feels: **light** (you need it,
and it gives you away) and **sound** (everything you do is heard). The
third, the one that makes it REMNANT and not any other dark-corridor game,
is **the voice**: the thing on the radio that learned to speak by listening.

Ideas 1, 2 and 3 are the same idea seen from three sides, and they fit the
two systems already there:

- **The voice listens** (light and sound, measured): it learns your habits
  from the same things the creatures notice.
- **The voice asks** (a choice): Mara's rule becomes something you can break,
  for a reason, at a price.
- **The voice can be silenced** (the goal): taking its mouths away is how
  you win ground, and the quiet that follows is the reward.

Idea 4 is a motif already half-built (the hummed tune exists) and is kept
for later; idea 5 is the most expensive for the least play and is set
aside.

## 5. Status

| Item                                                                | State                    |
| ------------------------------------------------------------------- | ------------------------ |
| The voice can be silenced: Kosh-Tash's relay (idea 3)               | Implemented, play-tested |
| The voice asks: answer or stay silent (idea 1)                      | In progress              |
| The voice listens: habits remembered and used (idea 2)              | In progress              |
| Kessler's tune leads somewhere (idea 4)                             | Proposed                 |
| Part Two: notes and moments brought up to Part One's (finding 4, 5) | Proposed                 |
