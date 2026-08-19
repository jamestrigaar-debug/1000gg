# Football DNA Simulator — Manager

## v0.9.0 · beta

First build tagged as beta. Everything the game is meant to do in this release
is wired end to end: nothing is drawn on a screen that the simulation does not
actually compute, and nothing the simulation computes is thrown away without
reaching a screen. That was the whole point of this pass — the features were
built, several of them just were not connected at both ends.

Play it by opening `manager/index.html` from any static server. No build step.

---

### How to play, in one paragraph

Draft a manager from the DNA of the greats, take whatever job will have you,
and survive your boardroom. A season is not micromanaged: you set the shape and
answer the decisions, the world simulates every division at once, and the board
tells you what it thought. Five decision windows a season — two before it, one
at the early-season checkpoint, two after — plus the transfer window, where the
board brings you named players and you sign or veto. You are judged on league
finish, cup run, finances and youth minutes, weighted by your board's
temperament. Then you go again, until you are sacked or you retire.

---

### Fixed in this build

**Squad depth read as zero for most of the world.** Cover was assigned shirt by
shirt down the team sheet, each shirt taking the best reserve still unused. The
early shirts ate the good reserves and the rest got whoever was left — measured
on a title-winning squad, that put the second goalkeeper at centre-forward and a
defensive midfielder on the wing, and reported the side as having no depth at
all. By season three, 120 of 221 clubs scored a flat zero. Cover is now assigned
across the whole bench at once, best pairing first, so a reserve keeper lands in
the goalkeeping shirt and is never in contention for the forward line.

This was not only a display fault: the bench average feeds 12% of every club's
unit ratings, so the whole world was being rated off a bad assignment. With it
fixed the league table moved measurably closer to the real thing — champion
points from 83 to 92 against a real 88, bottom-club points from 19 to 23 against
a real 26.

A named deputy who is thirty or more points worse in that position is now shown
as what he is — who would have to play, and that it is not cover — rather than
counting toward the squad's depth score.

**Career-ending choices reported nothing.** When an ending fired and you talked
your way out of it, the outcome text of the choice you made was computed and
then discarded: the game dropped you straight into the next pre-season with no
acknowledgement that anything had happened. The outcome now goes into the
permanent log, next to the season it happened in, and is shown as a banner on
the next screen you see.

**Squad freshness was invisible.** The engine has always computed how hard each
club leant on its first eleven, and applied it — a worn-out side loses up to two
points of form across a campaign. It was applied without ever being shown, so
"squad depth is worth paying for" was a claim you had no way of checking. The
COVER panel now reports last season's freshness with the reading that goes with
it.

**Agents were the wrong ones.** A player's profile named the agent who *would*
represent a player of his standing, ignoring the roster he had actually been
signed to — which made the entire agency system invisible. It now names his real
representation and the cut that agent takes, and marks the ones who have signed
him as a client.

**Rival scouting told you less than it knew.** The AI records the positions each
club's window failed to fill. Nothing read them. A good scouting department now
tells you where a rival came up short, which is the most useful thing you can
know about the side you are about to play in October.

**A dead lever in the decision layer.** Cards could move club form but never the
dressing room itself, even where the text plainly said they had. Player morale
is now a lever the decision layer can pull, and the five cards whose outcomes
promised a dressing-room reaction now deliver one — morale carries into the next
season, so a summer that gutted the mood is still felt in the autumn.

Also fixed: the academy's tier and last intake, and a club's debt, were all
tracked and never displayed. They are now on the screens they belong to.

### Removed

Six functions with no callers, a redundant per-match depth calculation nothing
read, four dead fields on the UI state, and three engine properties written but
never used — including one that a decision card's comment implied was charging
you for wages and never was. Roughly 250 lines net.

### Faster

About 10% off a simulated season (818ms to 732ms for a full 221-club world on
the reference machine), with results bit-for-bit identical:

- The hottest function in the engine looked up which of four readings each
  attribute needed on every one of ~2.25 million calls, for a key fixed when the
  weight table was built. Decided once now.
- Cover assignment uses flat arrays instead of allocating a hundred-odd
  short-lived objects every time a club's ratings are refreshed — thousands of
  times a season.

---

### Verified

Every build is run through four harnesses in `manager/tests/`:

| harness | what it proves | status |
|---|---|---|
| `audit.js` | 3,458 structural invariants over 12 seasons — no player in two squads, no orphaned loan, no money from nowhere, no id collision | no faults |
| `realism.js` | the match engine against real Premier League distributions, 27,504 matches | all metrics within tolerance |
| `decisions.js` | all 68 cards render and apply, across 6 independent careers | 68/68, no swallowed errors |
| `run_world.js` | a full world stands up and keeps standing | passes |

Plus a scripted browser run of four complete seasons on a phone-sized viewport:
no console errors, no page errors.

```
node manager/tests/audit.js
node manager/tests/realism.js
node manager/tests/decisions.js
node manager/tests/run_world.js
```

---

### Known gaps

These are deliberate omissions for the beta, not faults:

- **Saves are per-browser.** IndexedDB, two slots (current plus a
  one-generation recovery). Clearing site data ends a career. No export yet.
- **Save format is stable within the beta channel but not guaranteed across
  it.** A save written by 0.9.x will load in 0.9.x. If the schema has to move,
  the version number moves with it and old saves are refused rather than
  misread.
- **Depth is a season-long effect, not an in-match one.** Nothing here models a
  starter going off and a reserve coming on inside a game. Depth is paid for
  through fatigue across a campaign and through the squad's contribution to the
  club's rating — which is the timescale this engine actually works at.
- **Squads settle around 22 players.** Stable from season two onward, not
  drifting, but smaller than a real first-team squad. Tuning for a later build.
- **The transfer window is the slowest part of a season** — most of it is
  re-deriving club ratings after each deal. Correct, and about 280ms of a
  730ms season. A lazy recompute is the obvious next optimization and was left
  out of this build because getting it wrong means stale ratings, which is
  exactly the class of bug this pass was clearing out.

### Reporting something

The build stamp is at the bottom of the welcome screen. Quote it, the world
seed (also on the welcome screen — same seed, same world), and the season it
happened in.
