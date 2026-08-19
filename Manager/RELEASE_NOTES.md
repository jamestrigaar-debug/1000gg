# Football DNA Simulator — Manager

## v0.9.1 · beta — the difficulty pass

The game was too easy, and profiling the build showed it was not because any one
number was too generous. It was because **almost every advantage compounded and
almost nothing pushed back.** Ten changes, in the order they were made. None of
them adds a screen or changes how a season is played.

### What the profiling found

Measured over twelve simulated seasons across all 221 clubs:

| finding | before |
|---|---|
| Premier League manager reputation, median | **74 → 50** over 12 seasons |
| best manager in the world | **96 → 85** |
| median PL club balance | **£60m → £192m** |
| decision choices granting permanent facility upgrades | **18 give, 0 cost** |
| choices granting multi-season rating boosts | **34 give, 1 cost** |
| choices granting manager reputation | **25 give, 4 cost** |
| base chance a player accepts a transfer | **0.88**, capped 0.97 |
| manager sack rate | **11.7% a season**, PL **13.8%** |

Two of those were the whole problem. The world's coaching got *worse* every year
while yours got better — and manager reputation is 40% of the quality term the
match engine reads, so a human climbing to 99 against a league median of 53 was
carrying an edge into every fixture that grew as he succeeded. Meanwhile the
levers that reset each season were balanced, and the levers that *compounded*
were one-way gifts.

### 1. The world's coaching no longer erodes

Manager reputation was dragged toward the club's own standing at 0.12 of the gap,
so an elite coach at anything but a giant shed nearly two points a season however
well he did — and nothing anywhere ever created a new elite name, because every
rookie appointment is seeded *below* its club. Halved, floored on achievement
(a title, a promotion, a European trophy now pay permanently), and big clubs
hire the best available instead of missing on their target as often as a
mid-table one.

**The best managers in the world at season 12: was 85, 83, 80, 77, 72. Now 99,
98, 94, 92, 86.**

### 2. Reputation is compressed before it reaches the pitch

Above 70 the slope halves. It is *fame*, and past the top of the profession more
of it stops translating into results — the gap between the best coach alive and a
very good one is not the same as the gap between a very good one and a
journeyman. This is the cap on the player's own runaway, and it is invisible.

Climbing is also damped above 82, so ordinary competence no longer carries you to
99 inside a decade. Trophies still do.

### 3. The compounding decision levers now cost something

Sixteen card outcomes re-priced. Not "made worse" — the greedy path now has a
bill, and the bill lands on a different axis so the choice stays a choice:

- Free permanent facility upgrades now cost money, form, morale, wages or board
  confidence. Promoting an academy director from within costs the first-team
  staff a man (`{ youth: 3, training: -2 }`).
- "Keep the system, drill it deeper" was a free three-point boost for two
  seasons. Now one season — and see change 8 for why standing still is no longer
  free at all.
- Manager reputation gained from any card is now damped on the same curve as
  reputation earned from results, in the API rather than card by card, so every
  card written from now on inherits it. Losses are deliberately **not** damped.

### 4. The board's brief ratchets on your reputation

`setSeasonTargets` read the squad and the club's momentum and had no idea who was
in the dugout. A career of overachievement was met with the same soft target
every year. A decorated manager is now handed a harder brief at the same club —
and a rookie at a big club is genuinely given slack, which is the same rule
running the other way. **This is the term that makes success self-punishing.**

### 5. The transfer market can say no

Base acceptance 0.88 → 0.62, so the modifiers actually carry the decision. Being
first choice where he is, is now a reason to stay. At the same time a big club's
*name* pulls much harder (`/180` → `/105`): the point is not that the market is
uniformly stingy, it is that **who is asking** decides it. A giant still gets its
man; a club your own size frequently does not — and you are usually the smaller
club. Both callers already handled refusal, so a tighter market shows up as NO
DEAL lines in the log rather than an empty window.

### 6. Tactical familiarity decay — the mechanic that was not there

This was scoped previously and never built; there was no code anywhere that
remembered your tactic. Now there is.

A system is (playstyle, formation). Every club in the world carries a count of
consecutive seasons on the same one, and it ramps over five seasons into how
thoroughly the division has worked it out. Changing either resets the clock — at
the cost of the settling-in penalty the tactical cards already charge. That
trade is the decision the whole mechanic exists to create.

Three details that matter:

- **Zero-sum.** Charged absolutely at first, it deflated the whole league — AI
  clubs rarely change shape, so within six seasons every side carried the full
  penalty and both-teams-scored fell to 43.7% against a real 50%. What decides a
  match is whether *yours* is the more readable of the two, not whether yours is
  readable at all.
- **Aged at kick-off**, not in pre-season prep, so a summer switch buys back the
  surprise for the campaign you changed for — and in a shared helper, because
  `beginSeason` returns early when no human is managing, which would have frozen
  the clock for every headless world and applied the mechanic to the player and
  nobody else.
- **Rivals refresh too.** AI clubs that have been stale and struggling for years
  now change shape, so a human who rotates does not collect a free edge over a
  league that never responds.
- An adaptable coach disguises a system for longer, using the attribute the
  match engine already reads.

Visible as one line in the pre-season brief, one on the TACTICS panel, and one on
any rival's club page — a side that has played the same way for years is a side
*you* can prepare for too.

### 7. Money stays a constraint

Operating costs are now progressive with revenue (a bigger club really does run a
bigger non-playing operation), and clubs bank just over half a season's turnover
instead of 1.2 seasons. What the surplus *buys* is also capped per season —
unbounded, it spread Premier League training grounds from 46 to 86 in six
seasons, and facilities drive how fast every player develops.

**Median PL balance at season 12: was £192m. Now £96m.** Total club balance
across the world fell from £13.5bn to £8.8bn.

### 8. The job is more precarious

Sack floors raised across all four board styles. Two bad seasons back to back is
now a sacking in its own right whatever the confidence number reads — confidence
is a slow average, and a manager who missed twice could sit safe on goodwill
banked in year one. Confidence gravity is asymmetric: goodwill decays fast,
trouble does not evaporate. And board patience scales with club size — a giant
gives you one season and then judges you on it, a small club can wait three.

**PL turnover 13.8% → 16.7% a season.** Still deliberately below real-world
churn, because you only manage one club at a time and a season is the unit of
play.

### 9. Success is expensive to keep together

Renewals cost expected wage plus a flat 0–15%, so a squad could win a title and
re-sign itself at the same price. A regular in a side that just overachieved now
renews at up to about 1.7× the going rate, gated on minutes so it squeezes the
men who actually won you something. The board's wage budget does not rise to
meet it. Measured, 9–13 of 20 PL clubs sit over budget in the seasons after a
good one — which means selling somebody.

### 10. The league reacts to you

Every AI club planned its summer in a vacuum; nothing in the world knew a human
was competing with it. Clubs that finished within three places of you now spend
harder, sign one more player, and point recruitment at the positions where
*your* side is better than theirs. Visible on the scouting screen: "They have you
in their sights."

### 11. Your best players get poached because you did well

The existing "a bigger club is sniffing around" card only fired when you were
broke — a forced sale. The new one fires because you **succeeded**, and there is
no free way out: sell and reinvest, refuse publicly (board confidence and the
dressing room both pay), or match the offer and blow up your wage structure. The
refusal is the expensive option, which is the right way round.

This needed a new context field. `star` is the highest-rated player at the club,
which for an ageing squad is a 36-year-old nobody is bidding for — Brighton's
best player is Danny Welbeck at 36. Cards about the **dressing room** want
`star`; cards about the **market** want `prize`, the best player young enough to
have one.

---

### Two bugs found on the way

**The retirement age ceiling could be cancelled.** `age >= 41 ? 1` sat at the top
of the chain and the "ageing legend" multiplier below then took that certainty
down to 0.55 — so a player still above his club's level had a 45% chance of
surviving *every season, forever*. Pepe Reina reached 44 at Como on one seed. The
ceiling is now applied last, where nothing can discount it.

**Free agents could be signed past playing age.** The retirement pass runs
earlier in the season than free-agent signing does, so a player who became
available at the top of the age curve had already had his roll and would age into
the next season before another could reach him. Clubs now won't sign a free agent
over 37 — a clear margin below the certain-retirement age, so the gap cannot
reopen.

Both were pre-existing and only surfaced because the balance changes shifted
which players ended up where.

### One test harness improvement

`tests/decisions.js` always picked the *first* club in a division, which in the
Premier League is one of the giants — so any card written for smaller clubs read
as having an unsatisfiable trigger when it fired perfectly well in a real world.
A scripted situation can now say what size of club it is about.

---

### Where the simulation sits now

Every difficulty change was measured against `tests/realism.js` after it landed,
and two of them had to be re-tuned when they pushed a metric out of tolerance —
the notes above say which.

| metric | before this pass | now | real |
|---|---|---|---|
| champion points | 83.2 | **84.2** | 88 |
| bottom points | 18.7 | **25.2** | 26 |
| title-race spread | 65 | **59** | 62 |
| both teams scored | 45.0% | **45.0%** | 50% |
| goals per game | 2.7 | **2.7** | 2.75 |

All nine metrics within tolerance. `audit.js` clean over 12 seasons,
`decisions.js` 69/69 cards, `run_world.js` clean across six seeds, plus a
scripted seven-season browser run at 390×844 with no console or page errors.

A season costs 780ms for a full 221-club world — 6.5% more than v0.9.0 for ten
new mechanics, and still faster than the 818ms this build started from.

### What to watch during playtesting

Two numbers tell you whether the compounding is really fixed: **your manager
reputation by season**, and **how often a card asks you to give something up
permanently.** If reputation is still climbing six a year past 85, or you can
still get through a career without a card ever costing you, something above is
not biting.

One thing I did not touch and you should look at: **the lower divisions issue
102 points deductions over six seasons** (780 points) for financial breaches,
all outside the Premier League. That is pre-existing calibration, not something
this pass introduced, and it may be distorting promotion and relegation below the
top flight.

---

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
