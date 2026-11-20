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
| The voice asks: answer or stay silent (idea 1)                      | Implemented, play-tested |
| The voice listens: habits remembered and used (idea 2)              | Implemented, play-tested |
| Kessler's tune leads somewhere (idea 4)                             | Implemented, play-tested |
| Part Two: notes and moments brought up to Part One's (finding 4, 5) | Implemented, play-tested |

## 6. How the voice works now

**It asks three times** (`ask` in the level scripts): in the maintenance wing
("Are you alone?"), in cold storage ("What are you afraid of?") and in the
Ak-Suu clinic ("Where are you going?"). After the question you have ten
seconds, with the question and a countdown on screen; push to talk (or Use)
answers, anything else is silence. An answer helps, with something true: a
radio chirp from the stairwell, the keycard, the way out. Silence gets you
nothing, and a line about it.

**What you told it comes back** (`ifTold`). Told it you were alone: the
voice in the vents reminds you nobody is coming, and in the valley it says
you still are. Told it you fear the dark: the containment labs' blackout
takes your torch for twice as long, and it says why. Told it where you were
going: at the dam they are waiting, and the creatures come for you from
the start. Every ending's last line depends on how much you gave it.

**It learns how you play** (`VoiceMemory`, saved with the run, kept across
both parts). Once it has listened for four minutes it knows your strongest
habit, if one stands out: hiding in lockers, keeping your light on, keeping
to the dark, shooting, or killing quietly from behind. At four points in
the campaign it tells you so, and from then on the creatures behave
accordingly: a hunter close by when you climb into a locker knows which
one; your light is seen from a quarter further, or they see into the dark
a third further; your shots carry a quarter further; they look over their
shoulders, so taking one from behind needs a narrower angle. A player who
has learned the game's rules finds the game has learned theirs.

---

# Second pass: from a mechanic to a relationship

The first pass gave the voice a memory. The second asks whether that memory
is felt by the player, or only counted by the code.

## 7. Self-audit of the first pass

Read as a player, not as a test suite (401 tests passing says the systems
run; it says nothing about whether they matter).

**Genuinely original, kept**

- Mara's rule made into a choice: the voice asks, and answering is breaking
  the rule.
- The relay: winning by silencing, the voice changing as each breaker goes.
- Kessler's tune turning from a clue into the twist (the 1987 photograph).

**Functional but shallow**

| What                                                                                                  | Why it's shallow                                                                              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Habits change numbers (light seen 25% further, shots carry 25% further).                              | Nobody can perceive a 25% radius. It reacts to statistics; the player never sees it happen.   |
| All three questions work the same way: a line, a timer, a button.                                     | Three times the same quick-time prompt. Seven seconds was barely enough to read the question. |
| Every answer is rewarded the same way (a radio ping).                                                 | The voice's help had one shape. Its "motive" for helping was never shown.                     |
| The ending's last line counted answers (none / some / all).                                           | A score, read back. Nothing you _did_ was remembered, only what you said.                     |
| Consequences landed at most a level or two later, and only as gameplay (a longer blackout, an alarm). | No moment of "I caused this". No consequence that lands on a person.                          |
| The voice had lines, not a character: helpful, then menacing at level 9, as the original design said. | No contradiction, no uncertainty, no reason to be unsure whether it's helping.                |

**Repetitive**: still five level shapes for seventeen levels (the relay is
one level). Part Two leans on combat.

**A real bug found by the audit**: anything you told the voice on a level
before reaching a checkpoint was lost if you died and retried from that
checkpoint (the memory reset to the start of the level, but the trigger
that asked stayed spent). Fixed: checkpoints now carry the memory.

## 8. Five improvements, ranked

Scored 1–5 on originality, emotional impact, gameplay value and cost (5 =
cheapest).

| Rank | Improvement                                                                                                                                                                                         | Orig. | Emotion | Play | Cost |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------- | ---- | ---- |
| 1    | **It tells you to do things, and you answer by what you do.** Put your light out; leave that medkit; don't go towards the humming; go into that room; don't move. No prompt: you obey or you don't. | 5     | 5       | 4    | 3    |
| 2    | **It remembers moments, not numbers.** At the end of each part it tells you what it kept of you, in order, and what it made of it.                                                                  | 5     | 5       | 2    | 4    |
| 3    | **Choices with no right answer, that land on a person.** Ruslan's medkit: leave it and he lives long enough to be taken; take it and he dies waiting for it.                                        | 4     | 5       | 3    | 5    |
| 4    | **Habits change the world, visibly and fairly.** The hider finds a locker already taken (you hear breathing first).                                                                                 | 4     | 4       | 4    | 4    |
| 5    | **Levels with a reason to exist beyond the objective**: one where the voice lies about the way, one where you navigate by sound, one where fighting is possible and makes things worse.             | 4     | 3       | 5    | 1    |

Chosen: 1–4, built and tested. 5 is the most expensive; one part of it is
built (the armory, where the voice lies about the way), and the rest is
designed level by level in `CAMPAIGN.md`, marked as proposed.

## 9. What the voice is now

**Its character** (written into `STORY.md` → The voice, as a character):
it needs Nur alive and unchanged, so its help is real; it learns by
listening, so it keeps everything; it has never seen the sky, so it is
curious and sometimes wrong. It helps, then tests, then lies, and it tells
you so afterwards. You are never sure which one you're getting.

**Five instructions** (`bid` in the level scripts), each answered by action:

| Where            | It says                                               | You answer by         | Truth or lie                                                                   |
| ---------------- | ----------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| Maintenance Wing | "Put your light out. Something's coming."             | light off for 2.5 s   | True. Something walks past behind the wall. Keep the light on and it sees you. |
| Pumping Station  | "Leave the medkit. Ruslan needs it more than you do." | not picking it up     | True, and there is no right answer (see the power plant, and the end).         |
| Ventilation      | "Don't go towards the humming."                       | staying out of a duct | Self-serving: Kessler's note is down there.                                    |
| Armory           | "The store, top left. Get in and keep still."         | going there           | A lie, to find out if you still obey. Mara's warning is on the table in there. |
| The Village      | "Don't move. It's right behind you."                  | not moving for 6 s    | It tells you at the end, and the answer depends on what you did.               |

**What it does with them**: Ruslan calls on the radio at the power plant,
alive or dying, depending on the medkit. The Hive remembers the duct. Under
the stars at the end of Part One, and when the Choir is dead at the end of
Part Two, it tells you what it kept of you: up to four moments, the ones
that matter most to it, in the order they happened (a medkit weighs more
than an answer), then where that leaves you. If you left the kit, Ruslan
thanks you, from inside it. The ending's last line now depends on where you
stood with it over the whole run (trusted, resisted, torn), not on a count
of answers.

**Habits, made visible**: once it knows you hide, one locker on each level
is already taken. You hear breathing from it as you come near; open it and
what's inside comes out. The other habits still change distances only;
making each of them visible is proposed below.

**Smaller changes**: the answer window is ten seconds, not seven. Deaths are
counted ("You died seven times on the way to me. I was there every time.").
After you cut the last relay, the radio on your belt hums Kessler's tune,
switched off.

## 10. Status

| Item                                                                   | State                               |
| ---------------------------------------------------------------------- | ----------------------------------- |
| Bids: five instructions answered by action, remembered                 | Implemented, play-tested (headless) |
| Ruslan: the medkit's consequence at the power plant and in the recount | Implemented, play-tested (headless) |
| The recount at both finales; endings by stance                         | Implemented, play-tested (headless) |
| The taken locker (hider habit)                                         | Implemented, play-tested (headless) |
| Checkpoints keep the voice's memory (bug fix); deaths counted          | Implemented, tested                 |
| The relay hums on your radio                                           | Implemented, play-tested (headless) |
| The other four habits made visible (see below)                         | Proposed                            |
| Level-by-level redesign beyond the armory (see `CAMPAIGN.md`)          | Proposed                            |

**How it was tested.** Unit tests for the memory, the stance, the recount
and the coda, including four whole-campaign play styles (a truster who
answers, obeys and hides; a resister who follows Mara's rule; an explorer
who follows the tune and dies a lot; an aggressive player who shoots):
each gets a different habit, recount and ending line. In the real build
(headless Chromium): every bid obeyed and defied, each consequence
firing, both recounts, the taken locker, the death count, and all 17
levels loaded with no errors. Fairness: obeying the armory lie draws three
to five creatures to the room within twenty seconds on Story, Normal and
Nightmare; none found an idle player in that time.

**Not verified**: how any of it sounds (the voice, the breathing, the hum),
real GPUs, and full playthroughs with a person's hands on the controls. The
recount is long radio: whether it holds attention under the stars needs a
person to listen to it.

**Proposed: the other habits, made visible** (not built)

| Habit | Now                              | Proposed                                                                                 |
| ----- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| torch | light seen 25% further           | Once per level, the lamp ahead dies as you reach it and comes back on behind you.        |
| dark  | they see 35% further in the dark | A Watcher stands in the darkest corner of your usual route, where your light never goes. |
| gun   | shots carry 25% further          | A Mimic answers your gunshots with gunshots from elsewhere, to draw you off.             |
| knife | they look over their shoulders   | One of them turns round as you reach it, every time, for the first takedown on a level.  |
