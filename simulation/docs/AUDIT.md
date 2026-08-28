# Audit sweep and bug report

A full read-through of the engine, instrument by instrument, with every finding
either fixed or written down. The instruments used were the ones the project
already ships — `npm test`, `npm run batch`, `node --cpu-prof` — plus targeted
probes written for the sweep and deleted afterwards.

Everything below was **found and fixed in this pass** unless marked
**OPEN**. Each entry says how it was found, because the how is what stops the
same class of bug coming back.

---

## Critical: the match was wrong

### 1. Every player finished every match on zero stamina
**Severity: critical — an entire attribute did nothing.**

`drainStamina` multiplied a per-tick rate by `dt * 120`, i.e. by 1 at 120 Hz,
so the "per tick" constant was really per tick — about fifty times too large.
A player standing still lost 14% of his stamina a minute. Measured at full
time: **min 0.000, median 0.000, max 0.000**.

Consequences: `stamina` and `workRate` were decorative, the late-game speed
penalty applied to all twenty-two from the half-hour, and no side could ever
"tire in the last twenty".

Fixed by expressing the drain per second (`STAMINA_DRAIN_PER_SECOND`) and
calibrating it against the workload the engine actually produces, plus a second
finding underneath it: **every player ran flat out at every moment**, because
`maxSpeedFor` returned the full ceiling regardless of what the player was
doing. A jogging urgency for players holding shape now separates a defender
keeping his line from a striker chasing a through ball.

Full time now reads: outfielders 0.39–0.67, keepers 0.92. Pinned by a test.

### 2. The defensive line stood in front of the ball inside the box
**Severity: critical — this was the engine's headline balance problem.**

The block's line was `ball position − line of engagement`, floored at 8 m from
goal. With the ball five metres out that floor put the entire defence *eight
metres further from goal than the ball*: nobody was in the six-yard box, and
every chance created there was uncontested.

This is why goals per match sat near seven with a mean shot distance under ten
metres. The line is now also capped at a fraction of the ball's own distance,
so the defence is always goal-side. Goals per match fell by nearly two thirds
on the same seeds with no other change.

### 3. Shots recorded as off target were scoring
Roughly half the engine's goals came from shots the model had already ruled
wide: the ball was flown at the (missed) target and the flight's own
centimetres of error brought it back inside the post. The outcome is now
authoritative — the ball is placed where the model says it went.

### 4. A resolved shot was re-faced as a stray ball and "saved"
The keeper's stray-ball check ran on shots the model had already ruled goals,
so most goal-bound shots were saved on the line. A `resolvedShotUntil` window
now keeps every other mechanic off a ball whose outcome is decided.

### 5. Own goals at more than one a match
Backpasses and clearances rolled into an unattended net: the keeper's brain
positioned him on an arc and never looked at a ball travelling towards his own
goal. He now covers the line against anything heading for it
(`ballCrossingPoint`), and a ball played by his own side is one he is set for
(`OWN_GOAL_SAVE_BONUS`). Own goals fell from ~1.3 a match to ~0.2.

### 6. Aerial contests fired 870 times a match
The first cut of the aerial duel contested any ball passing through head
height. Every header put the ball back into that band, so two sides headed the
same ball back and forth for ninety minutes. Three fixes: only genuinely
**lofted** balls are contested (`ball.lofted`, set by the delivery), only
**contested** ones are recorded as duels, and a header in midfield is cushioned
or nodded on rather than hoofed. Now 30–40 a match, against a real 40–60.

---

## Serious: the match looked wrong

### 7. Players teleported up to 52 metres in one tick
Restart takers were placed on the ball rather than walking to it. Measured
worst in-play jump: **52.85 m in one tick**, drawn faithfully by the renderer
as a body vanishing and reappearing. Takers now walk; the restart waits for
them. Worst in-play jump is now 2.4 m — a keeper's dive, which is also now
capped at what a keeper can actually cover.

### 8. Both sides played in the same colour
Arsenal against Manchester United put twenty-two near-identical red dots on the
pitch. `resolveKitClash` now changes the away strip — its own second colour
first, then a change kit — using a perceptual distance that also keeps a side
out of the colour of the grass.

### 9. A highlight showed the score from before its own goal
Highlight windows are merged in order of when they *start*, and a goal's window
starts earlier than the chance a second before it, so the passage took its
score from the earlier line. It now takes the score at the latest moment in the
window. Found by eye in the UI, then pinned by a test.

---

## Data and tooling

### 10. Four squads shipped without a goalkeeper
`tools/extract-teams.mjs` filled position quotas and *then* trimmed to twenty by
rating, which deleted both keepers from Liverpool 2013 and 2019, Chelsea 2024
and Nottingham Forest 2024. The team-sheet picker then had to put an outfielder
in goal. Quotas are now filled in need order and never trimmed below them.
A test asserts every squad has a keeper.

### 11. The move recorder wrote moves telling a player to pass to himself
Two consecutive touches by the same player were recorded as a pass. They are
now recorded as a carry — and, because the recorder writes data that the match
then executes, `loadPlaybook` validates every move and drops any that names a
role nobody plays or passes to its own actor. A data problem must never become
a match problem.

### 12. Seeking drifted from a straight run
`restore()` recomputed the cached physical ceilings (`vMax`, `aMax`,
`turnRate`) from stamina, but the live sim only recomputes them on a brain
beat — so they are state, not derived values. The keyframe now carries them,
and a seek reproduces a straight run to within 1e-6 for every player and the
ball. Same class of bug, same pass: the keyframe was also missing the
possession bookkeeping, the advantage, and the active playbook move.

---

## Cleanups

### 13. Dead code
Eleven exported functions had no callers: `apexHeight`, `approxRange`,
`attrMul`, `carrySpeedFactor`, `cloneBall`, `invLerp`, `len`, `lenSq`,
`rollStopPoint`, `stepPlayer`, `withPossession`, plus a dead `kind === "shot"`
branch in `strike` left behind when shots moved to their own path. All removed.

`seekWithSeparation` was kept, because `steerPlayer`'s comment claims the two
agree — and that claim is now a test rather than a comment.

### 14. The shot spray was measured in metres, not degrees
Shooting error was `constant + distance × k`, which made a tap-in from six
yards as wild as a thirty-yarder. It is angular now, which is how a footballer
misses.

### 15. Duplicated constants
The renderer had its own `30` for the snapshot rate; it imports `SNAPSHOT_HZ`.

---

## Performance

A full ninety minutes simulates in **~11 s** single-threaded (was ~25 s at the
start of the sweep). Profiled with `node --cpu-prof`; the work now splits
roughly:

| | share |
|---|---|
| `integratePlayer` (22 bodies × 120 Hz) | ~22% |
| `grid.query` | ~11% |
| `step` (loop overhead, ball, laws) | ~10% |
| `grid.rebuild` | ~5% |
| brains, kicks, everything else | the rest |

What was done: steering split from integration (40 Hz vs 120 Hz), the spatial
grid clears only the cells it used, attribute-derived constants cached off the
hot path, an early-out for a player standing still, and the two per-player loops
fused into one.

**OPEN**: the 1,000-match CI gate in M9 needs roughly another order of
magnitude. The remaining cost is allocation-bound rather than algorithmic —
`Vec2` objects in the steering and query paths — so the next step is a
structure-of-arrays pass over player state, not a cleverer algorithm.

---

### 16. The balance harness was measuring its own fixture
The home/draw/away row read 67 / 33 / 0 — not because the engine had a home
bias, but because the harness played the *same stronger squad at home* twelve
times. It now swaps ends every other match and pairs the shapes, so the row
measures the engine rather than the team sheet. That change immediately
exposed OPEN 4 below, which the old harness could not have shown.

---

## Where the balance stands

A 24-match run (`MATCHES=24 npm run batch`) after the sweep:

| metric | measured | target | |
|---|---|---|---|
| goals / match | 3.13 | 2.5 – 3.0 | just over |
| shots / team | 11.8 | 9 – 14 | ✓ |
| xG / team | 1.19 | 1.1 – 1.6 | ✓ |
| xG / shot | 0.101 | 0.08 – 0.13 | ✓ |
| shots on target | 47% | 30 – 38% | over |
| possession | 49 / 51 | — | ✓ |
| fouls / match | 20.1 | 18 – 26 | ✓ |
| yellows / match | 2.71 | 3.0 – 4.5 | under |
| reds / match | 0.50 | 0.05 – 0.25 | over |
| penalties / match | 0.17 | 0.15 – 0.35 | ✓ |
| corners / team | 9.4 | 4 – 7 | over |
| offsides / match | 0.4 | 3 – 6 | well under |
| aerial duels | 28.7 | 30 – 60 | just under |
| headed goals | 10.7% | 8 – 14% | ✓ |
| set-piece xG / team | 0.09 | 0.2 – 0.5 | under |
| home / draw / away | 25 / 33 / 42 | 46 / 26 / 28 | wrong way round |

For context, the same harness at the start of this sweep read 6.1 goals a
match, 16.3 shots a team, and 0.15 xG a shot.

---

## Open findings

Known, measured, not fixed.

| | finding | measured | target |
|---|---|---|---|
| **OPEN 1** | Shots on target too high: the engine's shots come from better positions than a real side manages | 47% | 30–38% |
| **OPEN 2** | Corners about double the real rate — too much ends up behind the goal line off parries and blocks | 9.4/team | 4–7 |
| **OPEN 3** | Offsides far below the real rate: attackers time their runs too well, and the flag only goes up when a passer genuinely misreads the line | 0.4/match | 3–6 |
| **OPEN 4** | **An away bias.** Home advantage is now modelled (passing, shooting and the marginal foul) but the split still favours the away side. Something in the engine is not symmetric between the two attacking directions, and the fixed harness is what made it visible. This is the highest-value open bug: it is a correctness question, not a tuning one | 25/33/42 | 46/26/28 |
| **OPEN 5** | Red cards over the real rate, downstream of OPEN 1 — the engine creates more clear openings, so more of them are stopped illegally | 0.50 | 0.05–0.25 |
| **OPEN 6** | Set-piece xG under target: corners produce contests but few clear chances | 0.09 | 0.2–0.5 |
| **OPEN 7** | Substitutions and injuries are not implemented, so fatigue only ever costs a side speed | — | — |
| **OPEN 8** | Throw-ins are a pass, not a throw (no hands, no foul throw) | — | — |
| **OPEN 9** | Weather is carried but only reaches pitch friction | — | — |
| **OPEN 10** | `concentration` and `teamwork` are carried on every player and read by nothing | — | — |

OPEN 4 is the one to take next, and it is a hunt rather than a tune: with the
harness now swapping ends, any asymmetry between attacking left-to-right and
right-to-left shows up directly, so the way in is to run the same seed with the
teams swapped and diff the two event logs.
