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

Top to bottom, built so that almost everything the player does runs through
one panel:

1. **Last season** — a compact glance: finish, points, W/D/L, cup, verdict.
2. **Decisions** — the heart of the game. Team set-up, the pre-season transfer
   window, the cards, PLAY SEASON, the result and the two verdicts, the
   end-of-season cards, and career endings.
3. **The log** — always open, directly beneath the decisions. The board reports
   back here: what it signed, what it *tried and could not*, who renewed, who
   retired, who was sold. Each season closes with a written **season review**.
4. **Tabs** — SQUAD (transfer-list and mentoring toggles), TACTICS, CONTRACTS,
   TABLE, CAREER (the full season-by-season record) and WORLD.

### The log

The feed is the game's memory, so nothing at your club happens silently. A
player leaving used to just be gone — the AI window could lift him out of your
squad and the only evidence was an empty shirt. Now every arrival, departure,
retirement, renewal and release at your club is reported, whatever the fee, and
each season ends with a digest:

```
— 2026/27 SEASON REVIEW — CHAMPIONS of the Premier League, 100 points from
  38 games (29W 13D 4L, 87 scored, 34 conceded).
Top scorer: Maximilian Brandt with 26 in 28 appearances · then Lewis Walcott 17.
Cup: the club reached the semi-final.
The boardroom: "Outstanding" — confidence +11 to 76/100.
The supporters: behind you (70/100, +17) — the football was worth the ticket.
```

## Contracts

Every player by years remaining, shortest first. **EXTEND** asks the board to
tie a player down; **RELEASE** lets his deal run down. The board still decides —
it backs a renewal unless the club is in genuine financial crisis, since keeping
a player you already have is cheap next to signing one — and it reports what it
actually did in the log each summer.

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

### A market, not a queue

The window used to be a single richest-first walk: each club in turn took the
best player it could afford at the asking price and moved on. Nobody ever
competed for anybody, so no fee was driven up, the wealthiest club always got
its first choice, and a window read as a list of unopposed transactions.

Now every club **nominates** its top target, and any player wanted by more than
one club goes to **auction**. The winner is whoever values him most and pays
just past what the runner-up would have gone to — so a contested signing
genuinely costs more than an uncontested one, and being outbid is a thing that
happens to you. Clubs that lose keep their money and come back for someone else
next round. Measured across the world, **13–22% of deals are contested**.

A **clearing pass** then lets anyone with money and an unfilled squad sign the
best player still available, unopposed. This is not decoration: without it the
market punished the poor twice over — a small club was outbid on every target,
ran out of rounds and signed nobody, which left the bottom of the Premier
League on 16 points against a real 26, with one club down to nineteen players.
The auction decides who gets the players everybody wants; the clearing pass
decides who gets everybody else.

### The player has a say

A transfer needs three parties to agree and, until now, the player was not one
of them: any deal two clubs could afford simply happened. A first-choice
forward at a Champions League club would move to a mid-table side without a
murmur, because nobody asked him.

He weighs the **step** — the standing of the club coming for him against the
one he is at — whether he is **actually playing** where he is, and the **money**.
A fringe player will drop a division to play. A first-choice starter will not,
however good the offer. Around 30–55 moves a window die because the player says
no, and when it is your bid, the log tells you so.

### Loans

The answer to a problem the game could not previously solve: a nineteen-year-old
with a real future, stuck behind two better players, who therefore never played,
therefore never developed, and was the same player at twenty-three. Development
runs on **minutes**, so a prospect who cannot get them has to find them
elsewhere.

Blocked under-21s with headroom are sent to clubs whose level they would walk
into. A loanee stays his parent club's property, plays and develops at the club
he is lent to, and comes home in the summer — usually better than he left, and
the log says by how much. While he is away nobody can sell him: he is not the
loan club's to trade, and the squad list marks him `ON LOAN` for the club
borrowing him. Your own loanees get their own **OUT ON LOAN** panel in the squad
tab, because a player you cannot see is a player you forget you own. About 150
loans move each summer.

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

**53 cards** across ten categories — **tactics, transfers, medical, boardroom,
dressing room, media, youth, finance, supporters** — drawn by weight against
hard requirement gates (a card about selling your star only appears if you have
one worth selling) with no repeats inside a set or across recent seasons.

**Every save should play differently**, so three things fight repetition:

- **Jittered weights.** The draw multiplies each weight by 0.65–1.35, so the
  same situation does not always surface the same two cards. Previously the
  heaviest eligible pair won every time and two careers that hit the same
  circumstances played out identically.
- **Text variants.** A card can carry several ways of putting the same
  situation; one is chosen per draw, so a card you have seen before does not
  open with a sentence you can recite.
- **A longer memory.** Fourteen cards, not six, before one can come back.

Measured over six independent careers (`tests/decisions.js`): a median of 28
distinct cards per career, and **two different saves share only 32% of their
cards**.

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

The end-of-season screen leads with **two numbers, not eight**: what the
boardroom thinks and what the stands think. The four metrics that produced the
board's figure are one click away for anyone who wants them.

## The story of the season

The world was never short of detail; it was short of **testimony**. The match
engine computes, for every one of five thousand fixtures, how many chances each
side deserved and whether the result defied them — and then reported a score. A
player looking at "lost 1-0" had no way to know whether his team was outclassed
or hit the woodwork four times. `src/narrative.js` says it out loud.

**Match reports.** The managed club's own matches are kept (46 a season, not
five thousand) and the ones that defined the year are reported with the reason
they went that way, read off the expected goals the engine already computed:

```
Beat Venezia 4-1, away — a rout, and even more emphatic than the play deserved.
Lost 0-5 to Atalanta, away — taken apart.
Lost 0-1 to Genoa, away — harsh; you had the better of it and lost anyway.
A run of 8 unbeaten was the backbone of the season.
```

**Nothing here invents anything.** Every sentence is derived from a number the
simulation already produced — xG against goals, the upset flag, the derby flag,
appearances. If the text says the team was wasteful it is because expected goals
genuinely outran real ones. That rule is what stops it becoming decorative
flavour text, which is the one thing it must not be.

The margin outranks the underlying numbers, because a sentence must never argue
with the scoreline printed beside it: reading xG first called a 6-1 win "a smash
and grab" and a 0-4 defeat "fine margins". A rout is called a rout, and the xG
only colours how emphatic it was.

**Player ratings.** A season mark out of ten on the scale football actually uses
— 6.0 unremarkable, 7.0 good, 8+ wins awards — judged against what a player in
that position is *for*: a striker on goals, a centre-half on what the team
conceded, so a defender is never punished for not scoring. Measured across the
world the marks land at a median of 6.1 with a p75 of 6.7.

The mark sits on the player's card, so "why is my star playing poorly?" is
answered where you look rather than buried in a report. Beside it is his
**development** since last year (▲2 / ▼1) — the clearest signal that a young
signing is working out, or that a 33-year-old is going.

## Shape against shape

A formation used to change only your own rating bias; who you played made no
difference, so 4-4-2 was as effective against a midfield three as against
another 4-4-2. The matchup matrix (`MG.tactics.MATCHUP`) is now the base
modifier the match engine reads, worth up to a fifth of a goal a game — enough
to tilt a match, never enough to beat a better squad on its own.

|  | vs 4-4-2 | vs 4-3-3 | vs 4-2-3-1 | vs 3-5-2 | vs 5-3-2 | vs 4-5-1 |
|---|---|---|---|---|---|---|
| **4-4-2** | 0 | − | − | 0 | − | − |
| **4-3-3** | + | 0 | 0 | + | 0 | 0 |
| **4-2-3-1** | + | 0 | 0 | + | 0 | 0 |
| **3-5-2** | 0 | − | − | 0 | 0 | + |
| **5-3-2** | + | 0 | 0 | 0 | 0 | 0 |
| **4-5-1** | + | 0 | 0 | − | 0 | 0 |

The table is antisymmetric, so both sides of a fixture are looked up
independently and agree. Measured over 3,000 games per pairing with identical
squads, the ordering comes out as intended: 5-3-2 is the best answer to 4-4-2,
3-5-2 beats 4-5-1, and 4-4-2 is the weakest shape overall. The **TACTICS** tab
shows your shape against every formation *and how many clubs in your league
actually play it*.

## Cover

Every shirt has a named understudy. Depth used to be one average of the seven
best players outside the side, rated in their own positions — so a squad with
three spare wingers and no reserve goalkeeper looked exactly as deep as one
covered everywhere. Cover is per-shirt or it is not cover: the depth tail in
the team rating is now the average of the men who would *actually* come in for
each starter, and the tab shows the drop-off for every position.

## The academy

Youth used to happen *to* you: the intake ran, a teenager appeared, and the only
lever was a decision card. Every club now carries a real academy of eight
teenagers who age and train behind the first team, and the **YOUTH** tab gives
the manager three things:

- **See it** — the coaches' scouting *range* rather than a true potential
  number. Better facilities narrow the range, because a good academy reads its
  own players better.
- **Shape it** — a training focus (Balanced / Technical / Physical / Mentality)
  that decides which attributes the whole intake develops, so an academy has a
  character. Same size of gain in every case; this is a choice about shape.
- **Promote or release** — pull one up when he is ready, or leave him another
  year. Past 21 he is released.

AI clubs run the same academy on the same rules and promote their best
automatically, so the world's player population keeps refreshing either way.

## Ageing by position

A goalkeeper at 32 is in his prime; a winger at 32 is finished. The curve used
to be one shape for everybody, which made every squad age at the same rate and
quietly removed one of the real judgements in football: when to sell.

| | still improving to | peak ends | decline |
|---|---|---|---|
| GK | 27 | 34 | slowest |
| CB / DM | 25 | 31–32 | slow |
| CM / FB / FW | 24 | 29–30 | medium |
| AM / WG | 23 | 28 | steepest |

## The supporters

A second constituency with its own opinion, and deliberately a different one
from the boardroom's. The board counts the wage bill and the academy; the
stands count where you finished, whether it was worth watching, and whether you
sold the player they loved.

One score, 0-100, moving from two places: the season itself, and events as they
happen (a sale, a marquee signing, a decision card), so by the time the board
passes judgement the mood already reflects the summer. What they rate:

| Fans care about | Board cares about |
|---|---|
| where you finished, vs the top of the table | position vs the brief it set |
| **goals — whether it was watchable** | the wage bill |
| trophies, promotion, relegation | cup progress vs target |
| selling their favourites | the balance sheet |
| homegrown players in the side | under-21 minutes |

**Fans feed back into the boardroom.** A hostile ground drags confidence down
even after a defensible season; an adoring one buys a struggling manager
another year. How much it counts is the board's own temperament — a Patient
board tunes the noise out (×0.55), a Chaotic one reads the papers and panics
(×1.45). Measured across the world, this adds about 12% more sackings without
moving the confidence equilibrium, which is the effect wanted: more pressure,
same balance.

Two moods can pull apart, and that is the point — raising ticket prices pleases
one and enrages the other.

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
node manager/tests/decisions.js            # every card, every choice, applied
```

`tests/decisions.js` exists because `decisions.js` deliberately wraps each card
in `safe()` so one bad card cannot take a career down. That is right in
production and a menace in testing — a card whose effect throws is silently
downgraded to its label and the game carries on looking fine. The harness
captures those swallowed errors and turns them back into failures, firing all
609 choices across five scripted situations (champion, mid-table, relegated and
broke, promoted, and a second-tier side that just missed out).

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
tests/decisions.js    every decision card and choice applied against a world
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
- **The player's manager is issued his id AFTER the world is built.** He is
  drafted before `createWorld()` exists to be drafted into, so his id came from
  a counter that `createWorld()` then reset and handed out again — giving him
  the same id as the first AI manager generated (Guardiola, as it happened).
  Two clubs pointed at one man: his seasons and tenure counted twice, so a
  career on season 10 reported 20, and the carousel crashed the moment either
  club moved him on. `MG.managers.nextId()` exists for this.
- **The big coloured number is always the player's own rating.** The slot
  chooser used to show his *effective* rating there — adjusted for position,
  fitness, morale and form — while printing his real rating in small text
  beside it, so two different numbers both looked like "his rating". The
  adjusted figure is now labelled `IN ROLE` with the swing that produced it.
- **Every board gives one season of grace**, including in the winter sacking
  window. A career that can end before its first board review is not a career.
- **Career endings are gated behind 18 seasons and ramp in from there**, so a
  career runs the length of a real one — like retiring on 1000goals, not
  ending after five seasons. Measured across scripted careers: median around
  20 seasons, capped hard at 30. See `MIN_ENDING_SEASON` in `src/endings.js`.

## Not built yet

- **A winter transfer window.** The market runs once, in the summer. A January
  window needs the season simulation restructured — every league currently plays
  its full campaign before the next one starts, so there is no shared mid-season
  moment for a global window to happen in. Worth doing, not a small change.
- **Manager rivalries** and a **player/agent voice** (unhappiness at not
  playing, agents opening contract talks).
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
