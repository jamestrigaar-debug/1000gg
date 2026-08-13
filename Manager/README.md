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
src/managers.js       archetypes, traits, personalities, tactics, hiring logic
src/match.js          the match engine and goal attribution
src/competitions.js   fixtures, tables, cups, Europe, promotion/relegation
src/transfers.js      the summer window, youth intake, retirements
src/world.js          orchestration: createWorld() and advanceSeason()
src/draft.js          the manager draft and the first-job market
src/decisions.js      the pre-season and end-of-season cards, and their effects
src/ui.js             browser shell logic
tests/run_world.js    headless multi-season simulation and invariant checks
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
  Measured over twelve scripted careers: median 10 seasons, range 2 to 25+.

## Not built yet

- **End-of-career events** (the 1000goals `CAREER_ENDINGS` equivalent):
  retirement, the international job, moving upstairs, the legacy card. Being
  sacked currently ends the run and drops you back into the job market.
- More decision cards. 25 is enough to play; it is not enough to stop repeating
  across a twenty-season career.
- A **fuller manager draft** — drafting individual traits from several
  archetypes at once, with hidden influence from the templates you passed over,
  the way 1000goals blends attributes from donor squads.
- **Saves.** Nothing persists yet.
- Foreign leagues are single-tier islands (the database has no second divisions
  for them), so only English clubs move between divisions.
- A relegated club keeps top-flight wages and can dig a deep hole before its
  squad turns over; recovery works, but the trough is steep.
