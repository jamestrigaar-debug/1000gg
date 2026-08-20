# Football DNA Simulator — Manager

## v0.9.14 · beta — the state of the club, and three men with a problem

Both halves of the decisions panel, built for the two thirds of players
on a phone.

### The state of the club

The pre-season hub already showed what the club *is* — its ratings, its
best five, its brief. It never showed what **changed**, or where the
squad is **exposed**, which is exactly what a manager wants before a
window and exactly what took four screens and a good memory to assemble.

Everything in the new panel is comparative or actionable: attack,
midfield, defence and squad size each carry their year-on-year movement,
the money shows what you can spend against the wage room you actually
have, and underneath it names where you are short of bodies and what is
about to go wrong — who is in the last year of a deal, how many are past
32, whether the wage bill is over.

A rating on its own is a number. A rating four points down on the side
that finished fifth is a problem.

### Three men with a problem

Three storylines now arrive as decision cards instead of waiting to be
found:

- **A good player who barely played.** He has asked where he stands.
  Promise him a start, tell him to earn it, or let him go.
- **A player in the last year of his deal.** Do nothing and he leaves for
  nothing next summer. Tie him down, cash in, or let it run.
- **A reserve who has outgrown the reserves**, paired with the man in his
  way. Promote him, move the incumbent on, or leave him where he is.

Every one of these was discoverable already — by opening the squad,
reading contract years, cross-referencing minutes and knowing what the
reserves hold. That is four screens and a good memory, and on a handset a
thing you have to go looking for is a thing that does not happen.

Each is deliberately a *person*, not a statistic. "Your wage bill is
high" is a number; "Marcus played nine games and wants to know why" is a
season.

Measured across 30 real pre-seasons: the minutes card is live in 87% of
them, the contract card in 83%, and the blocked-reserve card in 33% —
the last only firing when the deputy is genuinely close to the man ahead
of him, so it stays a real selection call rather than a nudge.

### Fixed

- **Negative money read `£-10m`.** The sign was interpolated after the
  pound sign in every branch of the formatter, so a club in the red — or
  a wage room over budget — was written in a way nobody writes money.
  Now `-£10m`, everywhere it appears.
- The decision harness was building its test clubs with **no reserves at
  all**, which made the whole tier invisible to it and read a perfectly
  workable card as an unsatisfiable one. Its rigs are clubs five seasons
  into a save, and a club five seasons in has reserves. It now stocks
  them, and snapshots them between cards for the same reason it already
  snapshotted the academy — otherwise one promotion empties the list
  permanently for every later card in the same rig.

## v0.9.12 · beta — the reserves, and an end to the summer clearout

### A reserve team, run by the club

The academy fed the first team *directly*: a boy was either ready for the
senior squad at twenty or released at twenty-one, with nowhere in between
for the ordinary case — the twenty-year-old who is genuinely promising
and genuinely not ready. Meanwhile a fringe senior whose contract ran out
simply walked, because the only alternative on offer was a first-team
place he had not earned.

Between them, those two facts were most of the turnover: every club spent
every summer refilling a squad it had just emptied, out of the market
rather than out of its own building.

There is now a reserve tier, and it is how a real club is actually
shaped. Graduates arrive **into it** rather than into the first team.
Fringe players whose deals expire can drop **into it** rather than out of
the club. Everyone in it trains, develops and is available — so when the
first team is short, the staff look downstairs before they look at the
market, at every club in the world.

It is **invisible and board-run** on purpose. There is no reserves screen
and no reserves decision. You see the group summarised on the YOUTH tab —
size, average age and rating, the best of them — and you hear about
promotions in your log. Adding a second squad list to manage would undo
the thing handing the academy to the board was meant to achieve.

### Being at the club is now worth something

Development used to read *linearly* in minutes off a low floor, which
said a young player who trained all year with the first team and did not
get on the pitch progressed at under 40% of the rate of one who played
every week. That is not how a footballer develops, and it would have made
the reserves pointless before they existed — anyone out of the eleven was
frozen.

The floor comes up and the curve bends. A player simply **in** the setup
banks a real share of the available progress. On top of that, minutes now
**compound** rather than add — the gap between a bit-part season and a
full one is far larger than the gap between no football and a little.
Every week in the side is worth more than the week before it.

| minutes share | before | after |
|---|---|---|
| none | 0.45 | **0.70** |
| a quarter | 0.64 | **0.78** |
| half | 0.82 | **0.96** |
| every week | 1.20 | **1.55** |

### The summer clearout

Contracts ran 1–5 years on creation and 2–4 on renewal — a mean of about
three, so roughly **a third of every squad in the world** reached the end
of its deal every single summer, and a good share of those walked. Real
contracts are longer than that, and clubs re-sign early. Terms are up by
about a year across the board.

Measured across the whole club (first team plus reserves — an internal
promotion is not turnover), seasonal churn has gone from **24% to 21%**,
inside the 12–25% band a settled real club lives in. Squads also stop
grinding down below their target size, because the bodies that fill them
increasingly come from inside.

### Known, and not from this release

The world's average rating drifts down about three points over twelve
seasons. It predates this work — measured at 56.2 on the previous build
against 56.6 now, so these changes slightly *slow* it — but it is real
and it is on the list.

## v0.9.11 · beta — the Ballon d'Or stops being a raffle, and strikers stop heading everything

Both from tester feedback, and both had numbers behind them once measured.

### 1. The Ballon d'Or was close to random

Across 32 simulated awards only **31% of winners came from the merit top
three**. A quarter won with fewer than twelve goals — one with **two**.
Winners were arriving from 21st, 23rd, even 25th on the shortlist. And a
treble-winning club filled half the shortlist on its own, because the
doubling for a league title and for Europe was handed to every name on
the teamsheet.

Three things were wrong, and all three are things the real vote gets
right.

**The vote is not position-blind.** Voters have given it to a forward in
the overwhelming majority of years. Position prestige now multiplies the
whole case — separately from what a single goal is worth as evidence,
which still favours the defender who scores eight.

**A striker at a big club is seen more.** Thirty goals for the champions
of Spain is a different campaign from thirty for a mid-table side. Club
reputation now lifts the attacking positions specifically, because that
is where the effect is real — nobody wins this by defending well for
Real Madrid.

**Silverware is earned by the men who played.** The 2× for the league and
2× for Europe stay exactly as specified, and still stack — but they are
gated on minutes. A regular collects the full double; a squad player
collects a fraction. That is what stops one teamsheet swamping the
shortlist.

The vote itself is now weighted on each candidate's case *as a share of
the best case* rather than on the raw score, so how random the award
feels no longer depends on how big the numbers happened to be that
season.

| | before | after |
|---|---|---|
| winner from merit top 3 | 31% | **80%** |
| winners under 12 goals | 25% | **0%** |
| median winner's goals | 22 | **26** |
| lowest winner's goals | 2 | **13** |

Position split now runs forwards 68%, wingers 18%, attacking mids 13% —
and central midfield 3%, which is the point. A first cut crushed the deep
roles so hard that across forty awards not one midfielder or defender
ever won, and that trades one wrong answer for another: a save long
enough to hold a career should hold a Rodri year. What lets them back in
is recognising that **a holding midfielder's season is not in the goal
column at all** — Rodri won his on eight goals — so for the deeper roles
the case is carried by how good he actually was rather than by what he
produced.

### 2. Aerial was eating the strikers

The average forward read **71.4 in the air against 64.9 for his
attacking**, and aerial was the single best axis for **54% of the world's
strikers**. A striker whose standout quality is his head, more often than
not, is not a striker anyone recognises.

Balance is now the counterweight the axis was missing, and it is the
right one because it is the same fact stated backwards: balance is built
from being small, light and quick to turn, which is exactly what a man
does not want when the ball is in the air.

That fixed the *shape* — but not the level, because the calibration
moment-matches each axis onto the ratings scale and quietly scaled the
whole change straight back out. So the level is now set per position too,
mirroring how the Defending axis has always worked. A centre half's game
really is played in the air and he keeps every point of it; a winger's is
not. The points a forward loses do not vanish — the per-position
calibration is refitted afterwards, so his six axes still average to his
badge and the difference lands on his attacking, his pace and his
football brain instead.

| | ATT | AER |
|---|---|---|
| Haaland (195cm) | 96 | **91** |
| Kane (188cm) | 95 | **82** |
| Mbappé (182cm) | 95 | **67** |
| Vinícius (176cm) | 95 | **56** |
| Yamal (180cm, light) | 96 | **43** |
| van Dijk (CB) | 76 | **95** |

Forwards now average ATT 66.5 against AER 65.6, aerial is the best axis
for 22% of them rather than 54% — those are the genuine target men — and
centre halves dominate the air at 74.0 as they should. Players 175cm and
under reading 70+ in the air have gone from 4% of the world to none.

## v0.9.10 · beta — real attributes for the foreign leagues

### Non-Premier-League squads stop being interpolations

The five foreign leagues are sourced from a squad report that carries
only four EA-FC-style composites per player — PAC, PHY, ATT, DEF. The
game has to fan those four numbers out into eight attributes plus a
build, and however carefully that mapping is written, four numbers
cannot describe eight: two players with similar composites came out as
near-copies, and nothing in the source could tell a two-footed
playmaker from a one-footed finisher.

**274 players now carry real per-attribute cards**, in the same schema
the Premier League database already uses. Where a card exists the
derived attributes are discarded outright rather than blended — blending
real data with an interpolation just puts the interpolation back.

Miles Robinson now reads HDR 79 / STR 79 / CRE 47: a centre-half, which
four composites could never have produced. Messi's creativity stands at
94 with pace at 73, which is recognisably him rather than a smooth curve
through four averages.

**Scope, deliberately narrow.** Only players *already in a squad* are
touched. The source also describes players who have since moved on, or
who play for clubs the game does not carry — those are skipped rather
than signed. Nobody is moved, nobody is added, no transfer history is
rewritten. 274 of the document's 404 cards matched a squad in play.

**Ratings are not imported.** The cards rate their subjects about two
points above the game's own ratings for the same men, and `overall`
feeds club strength and therefore results. So the ratings stay exactly
as they are and the card is *levelled* onto them — the shape is the
card's, the level is the game's. Height and weight are never shifted;
they are measurements, not ratings. Carded players come out marginally
better calibrated than the population average, so nothing needed
recalibrating.

Two other fields are deliberately left out: the cards' mentality traits
(GOAT, Maestro, Artist) use their own vocabulary, and the game's traits
are a fixed set that morale and the match engine look up by name —
importing free text would break those lookups. DEF-ATR is derived here
rather than stored.

### The profile shows less

Two things came off the player profile:

**The raw attribute grid.** HDR/FIT/STR/LF/RF/SPD/CRE/BAL/HGT/WGT/MEN
printed in a block directly beneath the six bars and the radar that are
*built from those same numbers* — the same player described twice, once
in the game's language and once in the engine's. It read as a debug
panel bolted to a player card, and a profile that shows its own workings
underneath undercuts them.

**The agent chip.** Agency, tier and his cut. The agent still works
exactly as before behind the scenes — rostering clients, driving the
bidding wars, taking his cut — the manager simply does not get to read
his terms off a player's profile.

Durability, the season line and the full career history all stay.

## v0.9.9 · beta — the elite band stops faking it

Beta feedback, and it was the right complaint: for players rated 89 and
above the game inflated **Aerial** and **Defending** — the two axes an
elite attacker has no business scoring on — when creativity and balance
are what should carry elite quality, and were not being used for it at
all. Mohamed Salah read 81 at defending. Raphinha read 91.

### 1. Quality goes where quality belongs

Three separate mechanisms were all pushing the same way, and all three
are fixed.

**The elite lift was sprayed, not aimed.** Every axis got the same flat
bonus for being good, so a 94-rated forward collected +6.2 on his
Defending purely for being Erling Haaland. It is now shared out by how
much a position actually plays through each axis, and normalised — the
*total* lift a player receives is unchanged, only its destination moves.
A winger's spends itself on speed, attacking and mental; a centre half's
on defending, aerial and physical.

**The Defending axis was mostly just the badge.** It counted between 39%
and 60% of a player's overall as defensive ability before reading a
single defensive attribute, on a scale that ran only from 1.0 down to
0.65 — so a great forward was automatically three-quarters as good a
defender as a great centre half. The spread now runs down to 0.22.
Out-of-position defending has to be earned from strength, heading and
fitness; it can no longer be inherited.

**Creativity and balance now carry the elite band.** Creativity's quality
slope was deliberately light to avoid double-counting with the flat lift,
and balance had no quality term at all. With the lift no longer spraying,
that headroom moves where it belongs. Both are position-neutral, which is
what makes them a truthful place to say "he is simply better than you" —
a great centre half really is a better passer than an average one.

What it looks like now:

| | Defending before | after |
|---|---|---|
| Haaland (FW) | 83 | **61** |
| Salah (WG) | 81 | **61** |
| Bellingham (AM) | 88 | **68** |
| Pedri (CM) | 89 | **77** |
| Raphinha (CM) | 91 | **80** |
| van Dijk (CB) | 96 | **96** |
| Rodri (DM) | 94 | **93** |

The defenders held. The attackers stopped pretending. And creativity now
discriminates the way it was always supposed to: Salah 85 and Haaland 82
against Courtois 58.

### 2. Haaland is the best player in the world, at 96

The source database tops out at 94, with everything from 88 upward
bunched into six points — which is why the very top of the game read
flat. The elite band is now stretched above a knee at 88, reaching the
fifteen genuinely elite players in a world of 5,745 and leaving everyone
else exactly where they were.

The knee is high on purpose. Club strength reads `overall` directly, so
this is not a cosmetic scale — an earlier cut with the knee at 82 caught
most of a big club's first eleven rather than its stars, inflated the top
sides wholesale and blew the league apart: champions on 93 points, bottom
club on 17, outside tolerance. The realism benchmark caught it. At 88,
champion points land on 88.3 against a real-world target of 88 — closer
than before any of this work.

### 3. Footedness, corrected for 185 players

The database records two feet but does not always get the dominant one
right — Cole Palmer, Alejandro Balde and Federico Dimarco all read
right-footed. That is not cosmetic: creativity and the Attacking axis
both read the strong foot. 129 of the 185 are in the current squads; the
rest have moved on and are simply skipped. Nobody is added to a squad he
is not in, and a player already recorded correctly is untouched.

Generated players who happen to share a real player's name keep their own
feet — the world contains an 18-year-old and a 23-year-old both called
Salem Al-Dawsari alongside the real one, and they are different people.

### 4. The academy is the board's job now

The youth system is run entirely by the club, for every team including
yours. The staff promote anyone ready for the senior squad and release
anyone who reaches 21 without getting there — and they tell you, by name,
in the log. A boy appearing in your squad unannounced is exactly the
"the game moved on without you" failure the log exists to prevent.

The YOUTH tab reports instead of commanding: the academy's standing, the
three prospects your coaches rate most highly, and the shape of the group
— size, average age and rating, best ceiling, how many are near the first
team, how many are ageing out, and the spread of grades. The per-player
PROMOTE and RELEASE buttons are gone. Promoting the obvious candidate
every summer was a decision only in the sense that it needed a tap.

Academy coaching style is club-chosen too, derived from its facilities: a
well-funded setup coaches the ball, a poor one produces athletes. Your
academy has an identity you inherit rather than a blank slate.

### 5. SQUAD is on the top bar

Reachable from anywhere now, not only from inside the pre-season hub —
it is the one reference surface you want mid-season. Tactics stays where
it was, inside the decisions at the point of the season that asks for it.

### Fixed

- **Tapping an academy prospect did nothing.** `openPlayer` searched
  senior squads only, so every youth-team profile has been a dead tap for
  as long as the tab has existed. It went unnoticed because the old row
  carried its own buttons, so nobody had reason to tap the rating.
- **Elite goalkeepers were flagged as broken players.** The TOP RATED
  "does he add up" column flat-averaged six axes, five of which barely
  describe a keeper, so Donnarumma, Alisson and Courtois all read ten to
  thirteen points under their badge. It is now weighted by position.
  Notably this is done *without* touching the radar: refitting the
  calibration against the weighted mean also works, and costs 2–5 points
  off every radar in the game — deflating what you see to make an
  internal instrument read zero is the wrong way round.
- **The realism benchmark could never fail.** It counted metrics outside
  tolerance, printed the number, and then hardcoded a success exit. It
  now fails properly, which is how the elite-stretch problem above was
  caught.
- **NaN-hardening** in the development pipeline. `clamp()` does not
  rescue NaN, so a bad value reaching `applyDevelopment` would have
  permanently corrupted every attribute on that player for the rest of
  the save. No live path could trigger it; it is guarded now regardless.
- **The Ballon d'Or hall of fame could drop a winner.** If the latest
  season produced no award while an earlier one did, that winner vanished
  from PAST WINNERS — excluded by list position rather than by identity.

### Under the hood

`npm test` runs all four harnesses with one exit code, and `npm run lint`
checks the manager for the class of defect that actually bites here —
duplicate keys, fallthrough, unreachable code, botched NaN comparisons.
Style rules are off on purpose: reformatting this codebase would bury its
commentary under a diff nobody could read. It comes back clean.

## v0.9.8 · beta — balance & agility, a six-axis radar, and the Ballon d'Or

Reported directly: the top of the game still read as "high everything" —
reaching an elite badge meant being big, strong, fast and skilled all at
once, with no room for a genuinely different kind of player to get there a
different way.

### 1. Balance & Agility — an eighth attribute, and the missing half of "physical"

Nothing in the source data measures how nimble a player is, so it is built
the way the real thing works. A light, compact frame turns and recovers
faster than a tall, heavy one, measured against the population's own median
build (181cm/76kg across the 6,050 outfield players in the shared database) —
and it cuts both ways: shorter or lighter than that median is a genuine gift,
not just the absence of a penalty.

Real athleticism buys a lot of that back, but only through a square-root
curve: going from an average athlete to a good one recovers most of what
size cost him; going from good to elite recovers comparatively little more.
A player elite in strength, fitness *and* speed still pays some of the size
tax if he is genuinely big — an immense defender or forward reads as very
good at this, not the best in the world, however good everything else is.

Stored on the player (`BAL` in the raw grid, alongside HDR/FIT/STR/LF/RF/SPD/
CRE), and *recomputed* rather than independently developed: height and
weight never change after creation, so balance is entirely a function of the
three attributes that do (strength, fitness, speed), refreshed every
development tick so it never falls out of sync with the body it describes.

Verified against the real population: the highest reads in the game are
Ian Maatsen (167cm/57kg, BAL 83) and Xavi Simons (168cm/58kg, BAL 82); the
lowest are unathletic 196cm centre-halves in the low 30s. Erling Haaland
(195cm, elite physicals) lands a contained 56 — good, not freakish, exactly
the "big man who is still surprisingly mobile, but not a small man's equal"
outcome real football produces.

### 2. The radar goes back to six axes — creativity and balance feed in, they don't get a dial

Creativity was given its own seventh axis last release. Reverted: a radar's
whole job is to make an elite-everywhere player look like a hexagon and an
elite-at-one-thing player look like a spike, and a seventh or eighth corner
just rounds every shape back off. Both new attributes are folded into the
axes they actually describe instead:

- **Balance feeds Physical** (a quarter of it) — agility is a physical
  quality, not a separate one, and folding it in is what lets a small, light,
  athletic player read well there without also needing to be strong.
- **Creativity feeds Attacking** (a quarter) and **Mental** (just over a
  quarter) — alongside the strong foot and the underlying mentality rating
  that still do most of the work on each.

Between the two of them, this is the actual fix for "high everything": a
big, powerful, heavy-footed forward and a small, clever, two-footed one can
now land on the same overall by two genuinely different routes through the
same six axes, rather than the same one. All six axes were refitted against
the 6,700-player database with the new formulas — every position still
averages within a couple of points of the badge it carries.

### 3. The Ballon d'Or, and an award tracker that finally shows something

`computeAwards` has quietly worked out a Golden Boot, a top scorer and a
Manager of the Season every single season since it was written — and nothing
in the game ever displayed any of it. Fixed alongside adding the award it was
missing.

**The criteria, fixed every season:**

1. A **pool** of the season's top performers from the four leagues that
   actually produce Ballon d'Or contenders (Premier League, La Liga, Serie A,
   Bundesliga) — goals and assists, weighted so a defender's tally counts for
   more than a forward's (the same logic the real voting panel applies),
   plus the player's own quality, so a hot striker at a mid-table club
   doesn't outscore a genuinely world-class player having a quieter season.
2. **Two wins, each worth double.** Winning your league doubles your score;
   winning the Champions League doubles it again — stackable, so a real
   treble-winning season's best player dominates the vote the way it should.
   Nothing else in the pool multiplies; everything else only adds.
3. A **pseudo vote**, not a straight top-of-the-list pick. The real award is
   decided by a panel, not a stat sheet, which is why the best-numbers
   candidate does not always win it. Drawn weighted by score, the same shape
   as the giant-killing roll in the match engine — the front-runner usually
   takes it, and occasionally does not.

**The tracker**: a new AWARDS tab alongside TABLE/CAREER/WORLD/YOUTH — this
season's winner and his shortlist, Manager of the Season, the Golden Boot
per league, and a Hall of Fame of every past winner, reading straight off
`world.history` with nothing extra to maintain.

Verified across a real save: Julián Álvarez topped one season's shortlist on
raw output (36 goals, score 336.6) and Alexander Isak won the vote anyway
(298.9) — the pseudo-vote doing exactly the job it exists for.

Existing saves are backfilled with balance & agility on load, the same
treatment creativity got. All four harnesses pass: `realism.js` all nine
metrics within tolerance, `audit.js` no structural faults, `decisions.js`
69/69 cards, `run_world.js` clean on five seeds.

---

## v0.9.7 · beta — a bug sweep of the whole codebase, and one that mattered

A full read-through of every simulation module, hunting specifically for
anything game-breaking. Most of the codebase held up — the transfer market,
competitions, sacking/hiring, saves and the AI's squad-building all checked
out clean. One bug did not.

### Season-long form was being silently discarded before every match

`world.profile()` caches a club's attack/defence/midfield/etc. per competition
so a full rebuild — which includes picking the starting XI — only happens when
something actually changes. `club.form` (match-to-match momentum) is the one
part of that profile that moves every game without the cache being
invalidated, so the code refreshed it on every read with one line:

```js
p.form = world.clubIndex[clubId].form || 0;
```

That line does not ADD momentum to the rest of the form calculation — it
REPLACES the whole thing. `teamProfile` computes form as three terms —
momentum, `modifiers.form` (a decision card's season-long swing), and a morale
term — and this line threw the other two away the instant they were computed,
on every single access, for every match, for the entire time this caching
system has existed.

Concretely: **ninety-one separate decision-card effects** promise a form swing
this season — pep talks, board backing, a training-ground upgrade, a director
of football's intervention. Every one of them called `form(n)`, which correctly
added the points to `club.modifiers.form`. None of them ever reached a match.
The fatigue penalty for running a threadbare squad into the ground — "worth
about two points of form across a campaign," per its own comment — never
reached one either. Neither did the morale term match.js documents as
"colouring a season."

Verified directly: a club with `modifiers.form = 8` and `club.form = 1.5`
should show the match engine `9.5`. It showed `1.5`.

**Fixed** by splitting the cached profile's form into two parts at build time —
the static portion (modifiers + morale, which only change when something
explicitly invalidates the cache) and the momentum, refreshed fresh on every
read exactly as before. Same cost, same cache-invalidation behaviour, but the
whole sum now reaches the pitch instead of one third of it.

This is a real difficulty and realism shift, not just a fix — a mechanic that
had been silently inert this whole time is now live. Bottom-of-the-table
points dropped from 26.5 to 20.2 in one measurement (real-world is 26, and the
metric's tolerance is ±8, so still comfortably within it) — squads that run
threadbare or have a poor season now actually pay the price the fatigue and
morale systems were always meant to charge them. Every harness still passes:
`realism.js` all nine metrics within tolerance, `audit.js` no structural
faults over 12 seasons, `decisions.js` 69/69 cards, `run_world.js` clean on
five seeds at 20 seasons each.

### What else was checked and came back clean

Full pass across `world.js` (season loop, promotion/relegation, the manager
carousel, hiring/sacking, save/load round-tripping), `transfers.js` (the
auction, listings, reversal), `competitions.js` (knockout byes, playoffs,
Dixon-Coles), `match.js` (goal/assist attribution), `agents.js` (roster
placement and bump-cascade), `youth.js` (academy development and promotion),
`clubs.js` (financial crisis and points deductions) and `managers.js`
(candidate scoring, sacking thresholds) — no divide-by-zero, off-by-one,
stale-reference or double-application bugs found. A profiler run across 40
simulated seasons confirms the hot paths are exactly where they should be —
squad selection and the transfer market's marginal-value scoring — and every
one of them is already the result of a prior optimisation pass with the
before/after numbers left in the comments.

---

## v0.9.6 · beta — creativity, and profiles that justify their badge

Reported from play: elite players whose profiles did not look elite, with
Lautaro Martínez as the case in point — right foot 91, left foot 65, and an
Attacking bar reading 78.

### 1. Being one-footed made him a worse player instead of a different one

The Attacking axis was **the average of both feet**. For an elite one-footed
finisher that is a straight penalty for something that is not a weakness: a
striker finishes with his good foot. Martínez came out at 78, below players he
is plainly better than, and his 88 badge looked unearned as a result.

Attacking is now his **strong** foot with the weak one behind it (78/22). He
reads 91 — an elite finisher, which is what he is.

### 2. What the weak foot actually tells you: CREATIVITY

A new seventh attribute, and the one the source data was crying out for. The
database has no vision, passing or flair field — but it has **both feet**, and
two good feet is the most reliable public signal that a footballer has options:
he can go either way, receive on either side, pick a pass he is not square to.
The population's median weak foot is 55 and its 99th percentile is 75, so a
genuinely two-footed player is rare enough to mean something.

Creativity is derived from the weak foot, football intelligence, position (an
attacking midfielder is picked for this; a centre half is not) and a light
touch of the player's own level. It is a **real attribute**, not a display
trick — it is stored on the player, it develops with him (gaining readily,
decaying barely at all, because it is the last thing to leave a footballer),
it shows in the raw grid as CRE, and it has its own axis on the radar.

The effect is that players of the same rating now read as different
footballers: van Dijk 81 creativity, Martínez 85, Haaland 91, De Bruyne 92,
Salah 94.

### 3. Football intelligence at the top

The database's mentalityRating rises with quality as it should — 62 through the
bulk of the population, 82.8 across players rated 85+ — but individual records
are noisy, and the noise showed worst where it mattered. Valverde at 89 carried
a 69 and Martínez at 88 a 68, so two world-class players displayed a Mental
score in the middle of the range while a journeyman beside them displayed a
better one.

A floor, not a rewrite: untouched below 78 and untouched for anyone already
reading above the line, so the real spread survives and only the implausible
bottom of the elite band moves.

### 4. The axes now add up to the badge

This is what "they have 90 rating but are clearly not 90 rated players" was
really about. The raw attributes describe a winger's game almost completely and
a goalkeeper's barely at all, so a 90-rated keeper's profile read in the
mid-seventies and a 90-rated winger's read at 88 — the same badge, two
completely different-looking players.

Three stages, all fitted across the 6,700 players in the shared database:

- **Per-axis scaling**, matching each axis's distribution to the distribution
  of `overall` — so an axis reading 90 means "as far above average at this as a
  90-rated player is at football". Deliberately global, not per position,
  because the positional differences are real information: a forward genuinely
  cannot defend, and flattening that out would leave every radar the same
  shape. Moment matching rather than regression, which would have flattened
  mentality to a slope of 0.6 and squashed everyone toward the middle.
- **A quality term**, zero below 70 and rising. The attributes genuinely
  under-describe great players — what separates very good from great is mostly
  the first touch under pressure and the run made without the ball, none of
  which is in a column. **Creativity is exempt**, and has to be: it is the axis
  that exists to tell players of the same quality apart, so a term rising with
  quality would defeat it by construction.
- **A soft ceiling** above 86, because the slopes exceed one and a hard clamp
  would spend them pinning the top of the game to 99. An early cut had Haaland
  on 99 Physical, 99 Attacking, 99 Mental and 98 Aerial — a perfectly
  calibrated average and a radar shaped like a heptagon.

Every position now averages within 0.1 of the badge across the population, and
the elite band within 2-3. None of it touches a rating the match engine reads —
it is a presentation correction, and it is what makes a profile justify its
number.

| | before | after |
|---|---|---|
| Lautaro Martínez, Attacking | 78 | 91 |
| Lautaro Martínez, axis mean vs his 88 badge | −10 | −2 |
| Axis values pinned at 98+ | — | 0.00% |
| Per-position axis mean vs badge | −4.7 to +4.7 | ±0.1 |

The QA panel's gap column is now the plain question it should always have been:
does his profile add up to his rating? Zero is well-formed, double figures is a
player whose stat pool and badge describe different footballers.

Careers saved before this update are backfilled on load, so an existing save
reads identically to a new one rather than falling back to a placeholder for
the rest of the career.

All four harnesses pass — `realism.js` all nine metrics within tolerance
(bottom points 26.5 against a real 26, the closest yet), `audit.js` no
structural faults, `decisions.js` 69/69 cards, `run_world.js` clean on five
seeds.

---

## v0.9.5 · beta — the wage economy, the layout, and an AI that builds teams

### 1. Every club in the world showed a negative wage room

Reported from testing, and the diagnosis offered was that the wages must be
monthly amounts being multiplied as if they were weekly. They are not — the
numbers are weekly and weekly-scaled: Haaland lands on £524k a week against a
publicly reported £525k, Salah on £403k against £350k. As monthly figures they
would put Haaland on £7.5m a year against his real £27m.

The real cause was that **the board's sanctioned wage budget was set below the
cost of the squad the club already owned**. A first-tier squad priced at the
going rate for every player came to about 76% of its club's revenue, while the
board sanctioned around 58% of it — so no club could ever show a positive wage
room, by construction. 69% of the world was over budget, median 1.35× and 90th
percentile 2.85×.

Both halves were wrong, and both are fixed:

- **The wage curve** for the five first-tier divisions is cut about 17%, which
  brings a full squad to 61% of revenue.
- **The board's share** rises from a 0.54 base to 0.68, so a board funds a team
  it can field.
- **Every division below the top flight was earning far too little.** A
  Championship club took £16m against a real £30-40m; League One £3m against a
  real £8-12m. MLS and the Saudi league were worse. All raised to something
  like their real income — which is why the problem read worst exactly where a
  new manager starts, because that is the part of the pyramid that was
  furthest out.

Clubs over their wage budget: **69% → 9-18%**. A minority, which is correct —
an over-committed club is a real thing and it is what makes selling pressure
mean anything. Every English club now starts a career in the black.

If you would still rather see monthly figures on screen for taste, that is a
one-line change to the label and the ×52 — say the word.

### 2. The reference tabs moved above the decisions

SQUAD and TACTICS are gone from the bottom strip: the pre-season hub carries
them, along with CONTRACTS, as its own sub-tabs, so having them twice on one
page was only ever a second place to look. What is left — **TABLE, CAREER,
WORLD** and the academy — now sits top-left, above the Decisions panel,
collapsed until asked for.

The strip also no longer opens itself on the season-ahead screen. That was
harmless at the bottom of the page and is not harmless at the top: a full
league table between the header and the decision would push the decision off
the first screen, which is the one thing this layout exists to prevent.
Collapsed, the whole strip is 111px and the decision starts immediately below
it.

### 3. The AI now builds a team rather than collecting players

Four changes, all of which cost simulation time and are worth it.

**It knows what shape it plays.** A 4-3-3 manager starts three central
midfielders and a 4-4-2 manager starts two. Squad need was measured against one
fixed table of how many of each position a squad "should" carry, so every club
in the world wanted the same squad regardless of how it set up — and the trim
that keeps squads to size cut by rating alone, so a club's third central
midfielder was as likely to go as its fifth centre half. The formation now
decides: the floor at every position is the starting eleven the manager picked
plus a cover, and the top-up fills the shape's holes before anything else.

**It knows what a signing actually adds.** The market scored a target on his
rating against the current starters' average, which cannot tell a first-choice
signing from a fourth-choice one — a club with three excellent centre halves
rated a fourth almost as highly as the club that had none. `marginalValue`
rebuilds the position's starting line with the player in it, takes the
improvement, and weights it by how much that position feeds the ratings the
match engine reads. A fourth centre half now scores zero.

**It plans succession.** A position whose starters average 29+ with nobody
under 23 behind them is next year's hole, and a club that only reacts once the
hole opens is one whose squad falls off a cliff every few seasons. Ageing lines
now earn a place on the summer's priority list before they collapse.

**It remembers what it failed to fix.** Cycle 3 always worked out what the
summer missed; nothing carried it into the next one, so a club could spend a
decade shopping for the same centre half in exactly the same way. Three
summers of memory now feed back as escalation — more money and a lower bar for
a position that has beaten the club twice.

That last one needed its own fix to be worth anything: "unmet" was measured
against the generic 26-man quota, which adds up to more players than any squad
carries, so 60% of priorities read as unmet and 91% of clubs looked permanently
stuck. Measured against the eleven the manager actually picks it means
something: **15% of priorities unmet, 15% of clubs carrying a genuinely
unsolved position.**

| squad quality, 663 club-seasons | before | after |
|---|---|---|
| Shape slots the squad cannot fill | 0.10 | 0.03 |
| Surplus bodies beyond starters + cover | 4.16 | 3.35 |
| Players out of position in the XI | 1.51 | 1.44 |
| Gap between the XI and the rest of the squad | 7.69 | 7.98 |

Simulation time is unchanged — the shape-aware fill converges faster than the
old one, which paid for the extra evaluation.

All four harnesses pass: `realism.js` all nine metrics within tolerance,
`audit.js` no structural faults over 12 seasons, `decisions.js` 69/69 cards,
`run_world.js` clean on five seeds.

---

## v0.9.4 · beta — the transfer market, and why it kept putting Haaland at Brentford

Reported from a save: world-class players turning up at clubs that had no
business having them. Tracing it turned up six separate faults feeding each
other, and one of them had made the paid transfer market for elite players
effectively non-existent.

### 1. The biggest clubs in the world were renewing nobody

`retirementsAndExpiries` gated every contract renewal behind `affordableNow()`
— the club's wage bill against its wage budget. An elite squad structurally
sits over its budget: Manchester City £360m of wages against £294m, Liverpool
£382m against £248m. So the gate read false at the top of every division, every
season, and the biggest clubs in the game let **every expiring contract walk
for nothing**.

Measured across eight seasons: **152 moves by players rated 84+ on free
transfers against three completed paid deals**. The entire elite market was a
free-agent lottery — which is exactly how world-class players ended up scattered
into clubs that could never have bought them.

A club now keeps anyone within two points of its own playing level unless it is
in genuine financial trouble. He can still price himself out through his agent,
and he can still decide to go — both of which are checked separately. The
squeeze stays where it belongs, on the fringe of the squad.

### 2. Stars were refusing to re-sign at clubs they had no reason to leave

`willRenew`'s dominant term compared the player's rating to his club's *squad
average*. Every star in the world sits several points above his own club's
average — that is what being a star means — so the model read it as a man
badly let down by his surroundings. Lamine Yamal at 93 against Barcelona's 84
refused to re-sign, and so did Kimmich at Bayern, Guirassy and Schlotterbeck at
Dortmund, Donnarumma at City.

It now measures against what a club of that size would **expect** its best
player to be. Above that — a world-class player at a mid-sized club — and the
pull to leave is real and does the job it was always meant to do.

Elite players reaching free agency fell from **114 to 33** over eight seasons.

### 3. Nothing asked whether the buying club was big enough

The only quality ceiling in the market was "fourteen points better than this
position's current starters" — measured against a club's *weakest* area, so any
side with one thin position and a good summer's budget was cleared to bid for
anybody. And `willJoin` compared the two clubs to each other without ever
comparing either of them to the player.

Both now exist. A club looks no more than five points above its own playing
level (eight on a free, where there is no fee to price him out), and the gap
between what a player is and what the buying club plays at is now the strongest
single term in his decision: five points clear is a marquee signing, ten is a
puzzling one, fifteen does not happen.

### 4. Personality now decides transfers, not just contracts

v0.9.3 wired the mentality traits into contract renewals and nowhere else. The
same three temperaments now carry real weight in whether a player moves:

- **Ambitious** (Leader, Winner, Big Game Player, Talisman, Fearless, …) chase
  the step up and refuse the step down twice as hard.
- **Settled** (Professional, Steady, Dependable, Team Player, …) take some
  shifting once they are somewhere, and more so under a long contract.
- **Volatile** (Maverick, Mercurial, Temperamental) are simply less predictable
  than anybody's model of them, which is the whole point of them.

All 32 traits in the database map to one of the three; none falls through.

### 5. Selling to buy

A club's transfer budget was fixed the moment the window opened, so a £70m sale
in round one bought it nothing in round two. That is not how the top of the
market funds itself, and it is a second reason no club could ever reach a
world-class player: a big club's budget runs to £60–90m and an elite asking
price runs past £120m. A selling club now gets 70% of the fee back to spend
inside the same window, and the wage it just shed back as room. The board keeps
the rest — that is the difference between trading and churning.

The fee is also weighed **as a share of what the club has** rather than in raw
millions. At the old flat `fee × 0.35` against a score denominated in rating
points, anything over about £40m scored negative and no AI club anywhere ever
nominated an expensive player.

### 6. Regens were being born finished

`players.generate` applied its quality target regardless of age, so an
eighteen-year-old filling a depth slot at Real Madrid was created already rated
85 with a potential of 91 — and then developed on top of that for eight
seasons. Twelve seasons in, **37 of the world's top 50 were generated players
rated 93–96**, against a real database whose very best is 94.

A target is now a **peak**, discounted per position off the same age curve the
development model uses — a winger matures at 23 and is generated close to his
peak, a goalkeeper at 27 and is generated well short of it — with the potential
to grow into it. Top 50 is now 30 real players to 20 generated, and the ceiling
sits back at 94.

### 7. Promoted clubs were budgeted as if they had finished second

`setBudgets` fed `club.lastPosition` into the revenue projection without
checking that last season was in the *same division*. Bristol City: £19m of
actual revenue, a £98m wage budget, and the largest wage room in the Premier
League — which is precisely the sort of club that then turned up in the market
for players it had no business near.

### 8. The wage curve at the top, and the money that followed

Once clubs actually kept their best players, the elite ran straight into
insolvency instead: City carrying £521m of wages against £535m of revenue, a
ratio of 97% against a real one nearer 58%. The wage curve had drifted a long
way from its own documented calibration — a 90-rated player was asking £674k a
week against the £350k the code says it is tuned to, and a 96-rated one £1.4m,
roughly three times the largest wage in the real game.

The curve now bends above 78 and lands back on its stated calibration (90 →
£350k, 96 → £528k). Everything below 78 — the great majority of the population,
and all of the lower divisions the board's finance metric was tuned against —
is untouched. Elite commercial revenue is lifted 10% (it scales with reputation,
so it lands on the giants and nowhere else) and the progressive operating cost
raised from +8% to +14% at the top, so the money a club no longer spends on
wages does not simply pile up on the balance sheet.

Manchester City now runs at 57–62% of revenue on wages, near break-even, which
is both realistic and keeps the constraint the difficulty pass put there.

### 9. The QA panel now measures against the right baseline

The TOP RATED list's gap number compared every player's attribute mean to his
rating. But the six attributes the game carries do not describe every position
equally — nothing in them covers shot-stopping or positional reading. Fitted
across the database, at a rating of 94 a keeper's six attributes average 16
below him, a centre half 12, and a winger 5. Read against one line, every
keeper and centre half in the world looked broken and every attacker looked
clean, so the readout could not do the one job it exists for.

It is now a **residual** against the player's own position: zero is exactly
typical, double figures means his stat pool genuinely does not match his badge.
Across the whole world the median is −1 and the 95th percentile is 5.

### Measured

| | before | after |
|---|---|---|
| Elite (84+) moves on free transfers, 8 seasons | 152 | 33 |
| Elite players reaching free agency, 8 seasons | 114 | 33 |
| Elite moving down 15+ reputation | 4 | 0 |
| Elite players with 3+ moves in 8 seasons | 12 | 4 |
| Mean club reputation of the 85+ players | 82.2 | 86.6–88.5 |
| Elite at clubs below reputation 70 | 25 | 4–7 |
| Top 50 that are generated players (S12) | 37 | 20 |
| Manchester City wages as a share of revenue | 97% | 57–62% |
| Attribute-vs-rating residual (median / p95) | — | −1 / 5 |

All four harnesses pass: `realism.js` all nine metrics within tolerance
(champion 90.8 pts vs a real 88, bottom 24.2 vs 26), `audit.js` no structural
faults over 12 seasons, `decisions.js` 69/69 cards with no swallowed errors,
`run_world.js` clean on five seeds.

---

## v0.9.3 · beta — progression, contracts and the transfer window

### 1. Progression was the real cause of the rating mismatch

v0.9.2 fixed the 2026 squads, but two regens in a live save still showed
overall 89 and 93 against attribute means in the mid-50s and 60s — gaps of +34
and +28, far worse than anything the imported squads ever had. That is because
the import was only half the problem. The other half was **development**.

`developSquads` added the full delta to `overall` and then nudged three
attributes by hand: speed by 30% of it, fitness by 48%, strength by a **flat
0.6 that ignored the delta entirely** — and never touched heading, left foot or
right foot at all. The academy was worse: `overall` grew up to three points a
season while the attributes got only a small focus-shaped nudge.

Over one season that is invisible. Over a career it is the whole problem: an
academy graduate who grows twenty points between 18 and 25 gained about six
points of attributes and arrived in his prime rated 89 with a stat pool that
read like a 55. **The longer a save ran, the worse it got.**

Development is now expressed once, in `players.applyDevelopment`, and every
attribute moves with the overall. Two terms:

- **The delta term.** Each attribute has its own historical slope, so a point of
  overall is worth 1.09 points of heading and 0.39 of left foot — the real
  relationship, not a flat share. An age profile on top sends improvement into
  technique (what coaching actually adds) and takes the legs first in decline.
  The weights sum to the attribute count in both directions, so the mean moves
  by exactly what the delta says and only the mix changes.
- **The convergence term.** A 30%-per-season pull toward where the population
  says the attribute should sit. Without it, rounding to integers lets error
  accumulate over a twenty-season career. With it, drift cannot build up — and
  **an already-broken player from an older save heals over three or four
  seasons** instead of staying wrong forever.

Relative shape is preserved: a slow centre-half stays slow, because both terms
move him from where he is rather than snapping him onto an average.

Measured over twelve seasons, drift now **converges instead of compounding**:

| | season 0 | season 12 |
|---|---|---|
| median gap | 3.0 | **1.7** |
| worst gap | 23.7 | **9.0** |
| elite (85+) mean gap | 8.7 | **5.6** |

### 2. Transfer window: a signing cannot be flipped the same window

Free agents were being signed and moved straight back out at a profit inside
one window. A guard for this already existed — but it lived in exactly one
place, the board's automated "who do we cash in on" pick, so every other exit
ignored it: the board's own listing, the manager's SELL card, the AI market and
the fire-sale. **A rule enforced on one of five doors is not a rule.**

It is now one shared rule applied at every door, including the market index the
whole AI shops from, and it is deliberately universal rather than
free-transfer-only — a signing that can be flipped the same summer is a trading
loophole whatever it cost. Loans are unaffected; they have their own return
path.

Verified by instrumenting every arrival: **zero double-moves across 9,359
arrivals over six seasons.**

### 3. Nobody rejoins the club they just left, in the same window

Chelsea sacked a manager and hired him straight back. `hireFor` scored every
free manager on merit, and the best free manager available was — inevitably —
the one they had just let go. A club can no longer re-appoint the man it parted
with in the season it parted with him. Any later season is fair game: a manager
returning to an old club years on is a real and welcome story.

**Zero same-window rehires across 1,129 manager changes on four seeds.**

The player equivalent needed only one extra guard, on the free-agent list — a
club declining to renew a contract and re-signing the same man an hour later.
Every other same-window return was already impossible once the settling-in rule
above was in place.

### 4. Contracts: the player now has a say, and so does his agent

A contract used to be a countdown and nothing else. It ran out, the board could
or could not afford a renewal, and the player himself had no opinion at any
point — which is why the best players drifted away from the best clubs. Nothing
in the model preferred a good club to a bad one, so a title-winning side lost
its stars on the same coin-flip as anyone else.

Three things now decide a renewal:

- **Temperament.** The mentality trait every player already carries, sorted into
  three postures. A *Professional* re-signs and gets on with it. A *Talisman*
  wants to know the club matches his ambition and will run his deal down if it
  does not. A *Mercurial* one is a coin-flip with a bigger wage attached.
- **His season.** Minutes, morale, and whether the club sits above or below his
  own level — the dominant term.
- **His agent.** A super-agency asks for more than a local fixer, using the cut
  the agent system already computes. This is what prices a small club out of
  keeping a player whose career has outgrown it.

The board also no longer waits for expiry: once a player it rates is inside two
years it opens talks, up to three a summer.

The emergent result is the point. Over twelve seasons the **mean club
reputation of the world's fifty best players rises from 81.7 to 87.0** — the
elite concentrate at the biggest clubs, because an elite club can meet an
ambitious player's demand and a Championship club cannot, so he moves up rather
than sideways.

### 5. TOP RATED PLAYERS — a testing instrument

New panel on the WORLD tab, filterable by position. It shows each player's
rating alongside the **mean of his six attributes** and the gap between them,
colour-coded — single figures fine, double figures worth a look. That is the
fastest way to check whether a change to development or the attribute model did
what it was supposed to.

Building it exposed a small pre-existing fault: the whole World tab returned
"the world has not played a season yet" for the entirety of season one, hiding
the player search and the league browser too. Only the news *feed* needs a
completed season, so only the feed waits now.

### Verified

| metric | v0.9.2 | now | real |
|---|---|---|---|
| champion points | 84.0 | 91.5 | 88 |
| bottom points | 26.3 | 21.0 | 26 |
| both teams scored | 44.9% | 44.9% | 50% |

All nine metrics within tolerance. Champion points rose because the contract
system concentrates stars at the top — the intended effect, and it is now +3.5
against a real 88. `audit.js` clean over 12 seasons, `decisions.js` 69/69,
`run_world.js` clean across seeds, browser checks with no console errors.

### Known limit

Goalkeepers carry a weaker attribute basis than outfielders — the source has no
reflexes or handling stat, so a keeper's six attributes describe him less
completely. The median gap is fine (2.5, against 3.8 for outfielders) but
individual keepers can read high. Modelling limit, not a regression.

---

## v0.9.2 · beta — attributes now match the overall

Reported from playtesting: an 89-rated forward with no attribute above 81, a
93-rated winger whose bars averaged in the sixties, and a Speed bar reading
about +3 above the SPD figure printed lower down the same profile.

Both were real. Measured across the whole world, `overall` floated above the
attributes and the gap **grew with the rating**:

| overall band | median gap, before |
|---|---|
| 30–55 | +1.7 |
| 55–65 | +2.8 |
| 65–72 | +4.2 |
| 72–80 | +8.3 |
| 80–88 | +11.7 |
| 88–99 | **+15.2** |

### The cause

Only the 2026 squads were affected. They come from a four-stat source
(PAC/PHY/ATT/DEF) that carries no passing, vision, first touch or composure —
so the conversion into this game's six attributes had nothing to work with for
players whose quality lives in exactly those things, and it never checked its
own output against the `overall` it had been handed.

Fitted against this game's own primary data — the 6,050 outfield players in
`src/data.js` — the two populations were on different lines entirely:

```
historical convention   attrMean = 0.808 * ovr +  9.9
2026 conversion         attrMean = 0.465 * ovr + 31.0
```

Barely half the slope. The two agree at overall 50 and diverge by nearly ten
points by overall 90, which is why elite players looked ordinary and ordinary
players looked fine.

### The fix

Each derived attribute is now moved onto **its own** historical line, not one
shared correction. A single shared shift was tried first and was not good
enough: it fixed the average and left the shape wrong, because PHY drives both
fitness and strength in the conversion, so those came out far too high
(strength median 82 against a historical 64) while heading came out too low and
seventeen players' right foot pinned against the 99 ceiling.

After the per-attribute fit, every attribute lands within **0.4 of the
historical line** at both overall 60 and overall 90, and the ceiling pinning is
gone (right foot now tops out at 92, matching the source population).

**Speed is deliberately exempt.** It is the one attribute copied verbatim from
the source, precisely so the profile's speed bar reads that exact number.

Harry Kane, before and after:

```
before   DEF 62  PHY 80  SPD 81  ATT 81  AER 60  MEN 69     (overall 89)
after    DEF 66  PHY 89  SPD 78  ATT 85  AER 82  MEN 69     (overall 89)
```

Lamine Yamal stays the quick, technical, physically slight winger he should be
— speed 91, aerial well below his own average — but at a level that reads like
an 89 rather than a 65.

### The Speed +3

That was a contrast stretch applied to the radar. Every other axis is a blend
of two or more attributes, so the number it shows corresponds to nothing you
can look up elsewhere and the stretch costs nothing. Speed is the exception: a
straight copy of one raw attribute that is *also* printed, unstretched, in the
grid further down the same profile. Stretched, the bar said 80 while the grid
two inches below said SPD 77.

Speed is no longer stretched. **All 5,745 players now show the same number in
both places.**

### Checked and found correct

`roleRating` varies only ±2–5 points across positions, which looked alarming —
a goalkeeper rating 88 as a forward. It is not a bug. The match engine uses
`effectiveOverall`, which applies positional familiarity on top and spreads
32–45 points: Donnarumma goes from 78 in goal to 42 at centre-forward.
`roleRating`'s few points are the attribute-fit nuance layered over that, which
is what it is meant to be. Left alone.

### Verified

All nine realism metrics within tolerance, and bottom-club points landed
essentially exact:

| metric | v0.9.1 | now | real |
|---|---|---|---|
| champion points | 84.2 | 84.0 | 88 |
| bottom points | 25.2 | **26.3** | 26 |
| title-race spread | 59 | 58 | 62 |

`audit.js` clean over 12 seasons, `decisions.js` 69/69 cards, `run_world.js`
clean, plus a browser profile check with no console errors.

---

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
