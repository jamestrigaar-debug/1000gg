# Football Manager DNA — Alpha

A lightweight, single-player, browser-based football management game. It is a
**separate game from 1000goals**, living in its own directory with its own
entry point. It shares 1000goals' club and player database (read-only) and the
*shape* of its simulation engine, and nothing else — no file in `../src` is
modified, imported or written to by anything in here.

Play it by opening `manager/index.html` (any static server; no build step).

## The idea

The same rhythm as 1000goals, one level up. You do not pick a team and then
micromanage it week by week: you make decisions, the simulation runs a whole
season in one pass, and you are shown what that season did to you. The
**pre-season brief** and the **end-of-season board report** are the motif; the
simulation is the thing that happens in between.

```
draft a manager  ->  take a job  ->  [ brief -> PLAY SEASON -> board report ] ...  ->  sacked
```

## The simulation, and how it is calibrated

`manager/tests/realism.js` measures the match engine against real Premier
League distributions. Any change to the simulation should be run through it —
a formula that sounds sophisticated is only worth having if it moves these
numbers toward the real column.

| metric | engine | real |
|---|---|---|
| goals per game | 2.7 | 2.75 |
| home wins | 41% | 44% |
| draws | 25% | 24% |
| away wins | 33% | 32% |
| 0-0 | 8.9% | 7.5% |
| 1-1 | 11.5% | 11% |
| champion points | 86 | 88 |
| bottom points | 23 | 26 |

What the engine does, and why:

- **Poisson xG duel**, inherited from 1000goals: attack versus defence sets a
  lambda per side, drawn as a Poisson. The base constant is 0.90 rather than
  1.3 because attack ratings here sit structurally ~8 points above defence
  ratings; unadjusted, the league ran at 3.5 goals a game.
- **Dixon-Coles correction** on the four lowest scorelines. Independent Poisson
  under-produces low-scoring draws — 0-0 measured at 3.8% against a real 7.5%.
  The correction pushes mass into 0-0 and 1-1 and out of 1-0 and 0-1, leaving
  everything from 2-0 upward untouched.
- **Position-specific attribute weighting.** A player's ability is computed for
  the ROLE he is being asked to play: a winger is read on pace, a centre-half on
  heading and strength. Zero-centred against his own average, so `overall`
  stays the anchor the world is calibrated on. Two 74-rated wingers are no
  longer interchangeable — the quick one is worth a point more on the flank and
  less in the middle.
- **Hidden attributes** — consistency, injury proneness, work rate — rolled
  deterministically per player, never shown, acting across a season rather than
  per action. Consistency drives a per-season form roll: a metronome lands near
  1.00 every year, a maverick swings 0.75 to 1.25.
- **Fatigue.** A side that leans on eleven men in a high-pressing system arrives
  at the run-in tired, and carries that load into next season's injury rolls.
  This is what makes squad depth worth paying for.
- **A tactical parameter matrix.** Each of the six systems is expressed as
  (mentality, tempo, width, defensive line, pressing) and its rating shifts are
  derived from that vector rather than hand-typed — which is also how pressing
  comes to cost something real through the fatigue model.
- **Giant-killing.** An explicit upset roll on top of the chaos already in the
  duel: about one match in ten between equals, one in twenty-five when the gap
  is wide.

### Deliberately not adopted

An **agent-based, four-slices-per-second match engine** is the architecture the
reference material recommends and the wrong one for this game. This engine
plays roughly 5,000 matches per season across ten divisions in about 300ms,
because the whole design is that the world keeps living while you make a
handful of decisions a year. Per-slice agent modelling is on the order of ten
million operations per match: right for a game where you watch one match, wrong
for a game where you watch none.

**Per-shot sigmoid resolution** is skipped for the same reason — we do not model
shots, so it would cost time and produce nothing the player ever sees. The
sigmoid is used where it earns its place: the upset curve.

One correction worth recording: the reference material suggests Dixon-Coles
should make 0-0 and 1-1 *rarer* (multiply by ~0.85). That is the wrong way
round — the published correction uses a negative rho precisely because
independent Poisson gives too few of them, and our own measurements agreed.
Implemented in the published direction.

## The page

Three tiers, top to bottom:

1. **My Career** — career totals (seasons, titles, cups, promotions, win rate,
   reputation) alongside last season's results: position, W/D/L, goals for and
   against, cup run and the board's verdict.
2. **Decisions** — the window everything happens in: team set-up, pre-season
   cards, PLAY SEASON, the result and board report, end-of-season cards, and
   career endings.
3. **The club & the world** — squad (with per-player transfer-list and
   mentoring toggles), tactics and recruitment, the table, the club log
   (your own actions) and the world tab (the global feed and a browser for
   every league, club and manager).

## Tactics and the Starting XI

Setting up the team is **mandatory on joining a club** and persists until you
change it. Three things to set:

- **Formation** — six shapes (4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 5-3-2, 4-5-1), each
  with a rating bias that stacks with your manager's system rather than
  replacing it.
- **Starting XI** — click a shirt to change who plays there. Picking a player
  already in the side swaps the two shirts rather than leaving a hole. Out of
  position costs you: a winger at left-back carries 75% of his rating, and
  anything unlisted carries 55%.
- **Season focus** — League, Cup or Europe. The chosen competition gets a real
  rating bonus, the others pay for it, and the board's own metric weights shift
  to match what you told them you were chasing.

**Club ratings now come from the eleven on the pitch**, not the whole squad,
with a small tail for bench depth. Every club in the world uses the same
system — the AI auto-picks its best XI for its shape — so the tables stay
honest.

**Morale** is per-player, 0-100. It moves with playing time, results, and being
transfer-listed, and it is worth about ±6% of a player's rating. Deliberately
the smallest of the three form terms: it colours a season, it does not decide
one.

## The transfer market

You do not execute transfers — you instruct the boardroom, which is how a
modern club works and how the AI clubs already behave.

- **Transfer list**: tag your own players as available.
- **Transfer pool**: browse everyone in the world within reach of your club's
  level, with the real asking price, listed players first.
- The board resolves both in the summer, before the AI window opens, and
  reports back on the end-of-season screen. **It can refuse** — a fee above
  what it will fund, wages that break the budget, or a rival club that simply
  will not sell to you.

AI managers tag their own players the same way (`player.transferListed`), so
the pool you browse is the same shop window the computer is shopping in.

### The agent network — who you can reach

A club can only sign out of the leagues its agents and channels actually
reach (`src/network.js`), and reach is a function of standing rather than a
flat global pool:

| Reach | Who has it | What it opens |
|---|---|---|
| **Home** | reputation under 38 | your own country only |
| **Regional** | 38+ | home pyramid + the big leagues of your confederation |
| **Continental** | 58+ | home pyramid + every major league on earth |
| **Global** | 78+ | the whole world |

**Saudi clubs are the deliberate outlier** — their reach is global whatever
their reputation, the one place money overrides standing, modelling the
real-world spending power that lets them buy from anywhere. Every AI club is
gated the same way, so a National League side's rivals for a target are the
clubs in *its* reach, not Real Madrid — and growing the club's reputation
beyond the league table becomes a reason in itself, because a bigger name
opens a bigger market. The recruitment panel shows your current reach.

## Mentoring

Two buttons sit on every player in your squad: **list** (red — offer him to
the board for sale) and **mentor** (green — take him under your wing). You can
mentor **1 to 3 players** depending on your manager's development skill, and a
mentored player gets a real, visible leg up in his end-of-season growth on top
of normal coaching — biggest for the young players who still have headroom.
The two are mutually exclusive: you do not develop a player you are selling.

## Player profiles

Click any player, anywhere — your squad, the transfer pool — for a mini-profile:
a six-axis radar (pace, physical, aerial, stamina, technique, mentality), the
attribute bars behind it, mentality trait, morale, value, wage, contract and
career record, plus a one-click transfer-list toggle.

## How a career ends

Capped at **30 seasons**. Before that, endings can fire — deliberately rarer
than 1000goals', because a manager's career usually ends when a boardroom
decides it does, and the boardroom already handles that:

- **the cap** — thirty seasons and the game calls it
- **age** — from 60, rising every year
- **upstairs** — director of football, or building a department abroad
- **the national job** — the one offer worth leaving club football for
- **walking away** — burnout, a health warning, or stopping at the very top
- **fading out** — sacked with a low reputation and the phone stops ringing

Most give you a way to refuse and carry on, and refusing has a cost. The career
finishes on a legacy screen: seasons, honours, win rate, every club managed and
the full season-by-season record.

## The decision layer — the game itself

Every season is bookended by decisions. Two cards before it, two after.

```
[ PRE-SEASON x2 ] -> PLAY SEASON -> [ RESULT + BOARD REPORT ] -> [ END-OF-SEASON x2 ] -> repeat
```

25 cards across nine categories — **tactics, transfers, medical, boardroom,
dressing room, media, youth, finance** — drawn by weight against hard
requirement gates (a card about selling your star only appears if you have one
worth selling) with no repeats inside a set or across recent seasons.

**Every effect is real.** Nothing is flavour text with a number bolted on:

| Card says | Engine does |
|---|---|
| "Break the bank on a marquee signing" | searches the live market, pays a real fee out of the balance, puts the player in your squad |
| "Drill the back four" | shifts the defensive rating the match engine reads, for as many seasons as the card bought |
| "Brutal running camp" | +2 fitness squad-wide, +form, and a 1.35x multiplier on every injury roll |
| "Promise the board you will beat the brief" | +confidence and more budget now; amplifies the season's verdict 1.25x if you deliver and 1.6x against you if you do not |
| "Switch to Counter-Attack" | changes your system, the tactical matchup, and the squad-fit penalty until they learn it |
| "Sell him for a fortune" | finds a club that would plausibly buy him, moves the fee between two real balance sheets |

Each choice returns the sentence describing what actually happened, and that
returned string is what the player is shown — so the outcome on screen is
always the outcome applied.

## Injuries

Rolled once per season per player, before a ball is kicked, as the share of the
campaign they miss. Risk rises with age, falls with fitness, and is multiplied
by whatever the medical and pre-season cards did. An injured player is
discounted in the unit ratings rather than removed, so the man behind him gets
his season — which is what makes squad depth worth paying for. A season-at-a-
time game cannot model a hamstring in October, but it can model "your
first-choice centre half was fit for nine games".

## International football, in the background

Behind the club game runs the international one (`src/international.js`),
lifted in shape from 1000goals' caps-and-competitions system. Nations are
grouped by confederation with a strength rating; tournaments — the World Cup
on a four-year cycle, plus the Euros, Copa América, Africa Cup and Asian Cup
— come round on their own cadence and crown a champion weighted by squad
strength. Every season the best players win call-ups and accumulate **caps
and international goals**.

It is not flavour: caps and goals **feed development** — a young player who
has been playing tournament football sharpens faster than one who has not,
biggest for the under-21s who still have headroom — and they carry a **value
premium**, so an international is worth more in the market than an identical
player who never got the call. You never manage a nation; it happens around
you, and it shows up in your players' profiles and their growth.

## What is built

**The world** (`src/world.js` and friends) — 221 clubs across ten divisions,
about 5,700 players, 221 boardrooms and 221 managers, all built from one seed
and all simulated every season whether or not a human is anywhere near them:

- every division played out in full (~5,000 matches a season, ~140ms)
- domestic cups per country, plus the Champions/Europa/Conference Leagues
- the English pyramid, five tiers deep, with play-offs
- club finances: TV money, matchday, commercial, prize money, wages, running
  costs, transfer fees, debt, and surplus reinvested into the training ground
- a transfer window per summer driven by each manager's own traits and budget
- ageing, development, decline, retirement and academy intake for every player
- the manager carousel: sackings (winter and summer), poaching cascades down
  the pyramid, retirements, and new coaches coming through

**The boardroom** (`src/clubs.js`) — every club has one, in four styles:

| Style | Expectation vs. squad standing | Reaction | Cares about |
|---|---|---|---|
| **Balanced** | what the squad deserves | proportional | league, then everything |
| **Patient** | slightly below — backs a project | slow, forgiving | youth and the books |
| **Chaotic** | wanders season to season | erratic, unpredictable | whatever it woke up caring about |
| **Aggressive** | above what the squad deserves | fast and harsh | results and trophies, now |

Each board sets targets from where its squad ranks in its own division, then
reports back on four metrics — **league position, cup run, financial
discipline, youth development** — weighted by its style. The weighted total
moves board confidence, and confidence is what sacks you. The same evaluation
runs for all 221 clubs, which is what makes the AI carousel mean something.

**The look** — the palette, type and components are lifted from 1000goals'
stylesheet (`../index.html`) so the two games read as one family. If the parent
site retunes its palette, retune `manager/index.html` to match.

**The draft** (`src/draft.js`) — three rolls with three rerolls: an archetype
(one of eight templates modelled on real managers already in the repository's
data), a reputation tier (which decides who will even talk to you), and a
nationality. Each roll draws from its own seeded sub-stream, so a reroll
changes that roll and nothing else — the same trick 1000goals' genesis screen
uses.

## Running it

```bash
python3 -m http.server 8080     # then open /manager/index.html
node manager/tests/run_world.js            # 20 seasons, seed "alpha"
node manager/tests/run_world.js 30 my-seed # 30 seasons on your own seed
node manager/tests/run_world.js 5 alpha -v # also dump the news feed
node manager/tests/realism.js              # match engine vs real football
```

The test harness builds the world, simulates N seasons with no player and no
UI, prints tables, champions, the carousel, boardroom behaviour, finances and
the player population, and asserts invariants (squad sizes, rating bounds,
every club has a manager, division sizes, no orphaned players) every season.

## Files

```
index.html            the shell: draft, offers, season loop, board report
src/rng.js            seeded xorshift + named sub-streams
src/names.js          nationalities and name pools for generated people
src/players.js        player model, development curve, value, wages, unit ratings
src/clubs.js          leagues, finances, and the boardroom
src/network.js        the agent network: how far a club's reach extends
src/international.js   nations, tournaments, caps and goals, development feed
src/managers.js       archetypes, traits, personalities, tactics, hiring logic
src/match.js          the match engine and goal attribution
src/competitions.js   fixtures, tables, cups, Europe, promotion/relegation
src/transfers.js      the summer window, youth intake, retirements
src/world.js          orchestration: createWorld() and advanceSeason()
src/draft.js          the manager draft and the first-job market
src/ratings.js        role-specific attribute weighting, hidden attributes, fatigue
src/tactics.js        formations, the starting XI, familiarity and morale
src/decisions.js      the pre-season and end-of-season cards, and their effects
src/endings.js        career endings, the 30-season cap and the legacy screen
src/ui.js             browser shell logic
tests/run_world.js    headless multi-season simulation and invariant checks
tests/realism.js      match-engine output measured against real football
```

Load order matters (each file registers onto a global `MG` namespace); see the
script tags at the bottom of `index.html`.

## Notable design decisions

- **Club ratings are derived from the squad, not drifting on their own.**
  1000goals models a club as four numbers on a random walk. Here those numbers
  come from the players, plus a fixed per-club `identity` offset (stadium,
  coaching, infrastructure) locked in at creation so season one reproduces the
  tuned data. Sign a striker and the attack rating moves.
- **Tactical effects are additive rating shifts, not multipliers.** 1000goals
  defines multipliers (`Park the Bus: attack ×0.80`) but nothing reads them.
  Applied literally they were catastrophic on a scale where a division spans
  65–95 — a defensive side became mathematically unable to score.
- **Player ages are inferred**, because the database has none. A player's first
  appearance in the 666 historical Premier League rosters dates his arrival;
  most arrive around 20. Accurate to a few years for ~75% of current players,
  with an overall-weighted guess for the rest. Delete `inferAge` if real ages
  are ever added to `../src/data.js`.
- **Division quality is an explicit table** (`LEAGUE_PLAYER_LEVEL`), not a
  regression. Fitting a line through the twenty clubs that have both scales and
  extrapolating it downward collapsed the pyramid into a plateau.
- **The board's metrics are calibrated to sit near zero for a median club**, so
  that a verdict actually reflects the season rather than a standing bias. Worth
  re-checking whenever the finance or youth systems change.
- **Headline results override the weighted average.** Winning the division or
  going down sets a floor/ceiling on the verdict, because a boardroom that
  reacts to a title with "met expectations" because the wage bill was high
  reads as broken, whatever the arithmetic says.
- **Every board gives one season of grace**, including in the winter sacking
  window. A career that can end before its first board review is not a career.
- **Career endings are gated behind 18 seasons and ramp in from there**, so a
  career runs the length of a real one — like retiring on 1000goals, not
  ending after five seasons. Measured across scripted careers: median around
  20 seasons, capped hard at 30. See `MIN_ENDING_SEASON` in `src/endings.js`.

## Not built yet

- More decision cards. 25 is enough to play; it is not enough to stop repeating
  across a thirty-season career.
- **Saves.** Nothing persists between page loads.
- In-season substitutions or match-by-match management — this is deliberately a
  season-at-a-time game, and the XI is picked for a campaign, not a fixture.
- Scouting: the transfer pool shows true ratings rather than a scout's estimate.
- A **fuller manager draft** — drafting individual traits from several
  archetypes at once, with hidden influence from the templates you passed over,
  the way 1000goals blends attributes from donor squads.
- Foreign leagues are single-tier islands (the database has no second divisions
  for them), so only English clubs move between divisions.
- A relegated club keeps top-flight wages and can dig a deep hole before its
  squad turns over; recovery works, but the trough is steep.
