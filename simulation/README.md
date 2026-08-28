# Match Engine — 2D football simulation

A deterministic, browser-based 2D football match engine in the style of Football
Manager's classic match view: a top-down pitch, numbered dots in kit colours, a
ball with a real height illusion, and — the actual product — a simulation whose
event stream everything else is derived from.

This directory is a self-contained Vite + TypeScript project. It is developed
here, and lands in `/Manager` once approved; nothing in `src/core` depends on
anything outside this folder, which is what makes that move a copy rather than
a rewrite.

**Status: playable match day, served as a static folder.** Pick two real teams
→ pre-match comparison → a text match of highlights → click any line to watch
that passage in 2D. Fouls, cards, penalties, aerial duels, headers, crossing
and set-piece routines are in; so is the move playbook and the tactical intent
layer. See [Milestones](#milestones) for what is real and
[docs/AUDIT.md](docs/AUDIT.md) for what is known to be wrong.

---

## Quick start

```bash
cd simulation
npm install
npm run dev        # http://localhost:5173 — live match day
npm test           # the suite: determinism, physics, laws, the bridge
npm run batch      # headless balance run against the target table
npm run record     # mine new moves for the playbook from simulated matches
npm run deploy     # build, and copy the output up into simulation/
```

### It is served as a static folder

`1000goals.co.uk` has no build step: what is in the repository is what the
browser gets. `npm run deploy` builds the app and copies `index.html` and
`assets/` into `simulation/` itself, so **https://1000goals.co.uk/simulation/**
loads the match engine directly — no server, no redirect, no bundler at
runtime. Those built files are committed on purpose; the sources live in
`src/`, `app/` and `tests/`.

### Picking teams

The team list is generated from the site's own database (`src/data.js` at the
repository root) by `tools/extract-teams.mjs`: the twenty Premier League squads
of 2024 plus sixteen sides worth watching — the Invincibles, the Treble side,
Leicester 5000-1, the Entertainers. Every squad carries the club's tactical
style and the Manager's own attribute derivations, so picking *Arsenal 2003*
gives you Wenger's side playing Possession football, not a generic team with
their badge on.

Pick the two teams, the shapes and the styles from the strip at the top of the
screen; the URL carries the fixture, so a match is a link.

---

## The four rules

Everything else in the codebase is negotiable. These are not.

**1. Strict layering.** `src/core/` is a pure, deterministic simulation. No DOM,
no PixiJS, no `Date.now()`, no `Math.random()`. All randomness flows through one
seeded mulberry32 stream whose state is a single serialisable integer.
`tests/purity.test.ts` enforces this by scanning the source.

**2. Fixed timestep.** Physics at 120 Hz. Player decisions ("brain beats") at
8 Hz, staggered across players so the cost spreads evenly across ticks. The
renderer interpolates between the last two snapshots. Time scale (1×…8×, max)
is *only* how many ticks per second are requested — a match at 8× is the same
match as at 1×, and there is a test that proves it.

**3. Snapshot/delta protocol.** The sim runs in a Web Worker and posts compact
render snapshots (positions, velocities, ball, clock, new events). Full-state
snapshots — including the RNG cursor — go into a ring buffer every 30 match
seconds, so seeking is "load keyframe, fast-forward silently".

**4. The event stream is truth.** Commentary, stats, ratings, highlights and the
score strip are derived from the typed event union and nothing else. The
renderer never feeds them. This is what makes a replay reproduce the *narrative*
and not merely the movement.

Determinism = replay: `{seed, squads, tactics, userCommands}` is the whole
match. `tests/determinism.test.ts` asserts an identical SHA-256 of the event log
across 25 runs of the same seed.

---

## Layout

```
src/
  core/          pure simulation — no DOM, no renderer, no clock
    constants.ts   every tunable number, with a comment saying which way to push it
    rng.ts         seeded mulberry32; the only randomness in the engine
    math.ts        vectors, attribute scaling, logistic
    pitch.ts       IFAB geometry, zones, line-crossing
    ball.ts        2.5D ball: drag, gravity, bounce, roll
    kick.ts        THE kick solver — analytic ballistics + Newton correction
    player.ts      entity + steering behaviours (arrive/pursue/separation)
    grid.ts        uniform 5 m spatial hash for neighbour and lane queries
    formation.ts   normalised slot anchors resolved through tactics
    events.ts      the typed event union and the append-only log
    snapshot.ts    render snapshots, full keyframes, the seek ring buffer
    match.ts       the fixed-timestep loop, and the brains
    shot.ts        xG, PSxG and the save model — the outcome oracle
    threat.ts      the xT-style zone value grid the decisions run on
    prematch.ts    the two team sheets read against each other
    commentary.ts  the text match, from the event stream
    highlights.ts  which passages are worth watching, and when
    stats.ts       everything the panels show, from the event stream
    types.ts       squads, attributes, tactics, match setup
  manager/       the /Manager bridge: contract, attributes, styles, setup
  worker/        protocol + the worker that simulates and plays back
  render/        PixiJS v8: pitch layer, entity layer, camera, match view
  ui/            score strip, speed controls, event feed
  data/          formations.json (the Manager's six shapes), squads.json,
                 the demo fixture, and their loaders
tests/           Vitest
tools/           screenshot.mjs — headless visual check
docs/            ATTRIBUTES.md, MANAGER_INTEGRATION.md
```

---

## Match day, end to end

The flow the Manager asked for, and the order it happens in:

**1. Pre-match.** The two team sheets read against each other — formation,
playstyle, unit ratings, the eleven with a rating each, key men, and the
talking points. Every number on this screen is computed from the same objects
the simulation is about to be handed (`src/core/prematch.ts`), so if the screen
says a side is strong in the air, the aerial duels will agree.

**2. The text match.** The match is simulated headlessly, start to finish, in
the worker. What comes back is the *text version*: a list of highlights, each
one a minute, a line of commentary and the score at that moment
(`src/core/commentary.ts`, `src/core/highlights.ts`). Nothing has been drawn.
The Manager can stop here — this is the match report.

**3. The 2D match.** Click any line and that passage plays on the pitch. The
worker restores the nearest keyframe before the window, fast-forwards in
silence, and streams snapshots for the length of the passage. Because the
keyframe carries the RNG cursor, what you watch **is** the match the text
describes, not a re-roll that happens to share a scoreline. There is a test
that holds this to the line: seek to a highlight, and every player and the ball
are within 1e-6 of a straight run to the same tick.

Highlight modes are thresholds on event importance, exactly as in FM:

| mode | what it keeps |
|---|---|
| Key | goals, red cards, penalties |
| Extended | + big chances, saves, woodwork, half/full time |
| Comprehensive | + every shot on target, every card |
| Full | + everything the commentary tiers at all |

Re-cutting the reel does not re-simulate: the events are already there.

## The Manager bridge

`src/manager/` is the whole integration surface with `/Manager`, and
[docs/MANAGER_INTEGRATION.md](docs/MANAGER_INTEGRATION.md) describes where the
engine lands in that codebase. In short:

- **Formations** — `src/data/formations.json` carries the Manager's own six
  shapes under the Manager's own keys (`4-4-2`, `4-3-3`, `4-2-3-1`, `3-5-2`,
  `5-3-2`, `4-5-1`), with the anchors converted from `Manager/src/tactics.js`'s
  `coords`. Whatever the user picked pre-match is what takes the field.
- **Playstyles** — the six systems (`Possession`, `High Press`, `Counter`,
  `Direct`, `Park the Bus`, `Route One`) become team instructions that *produce*
  the Manager's rock-paper-scissors relationships rather than asserting them:
  High Press really does push its line to the halfway line, which is really what
  a Counter side plays against.
- **Players** — `overall` (25–96) stays the anchor, because the Manager's whole
  world is calibrated on it; the eight Manager attributes supply the individual
  variation on top. Two 78-rated wingers are no longer the same winger.
- **Determinism** — a fixture seed is the whole match, so a season can be
  re-watched rather than re-rolled.

## Milestones

| | Milestone | State |
|---|---|---|
| M0 | Pitch + dots | **done** — vector pitch, kit-coloured numbered dots, distinct GK, fit/follow cameras, H/V flip |
| M1 | Ball | **done** — 2.5D ball with drag, gravity, bounce, roll, post capsules; one kick solver; shadow-and-scale height illusion |
| M2 | Movement / shape | **done for the block** — per-phase anchors, a compact defensive band with a line of engagement, marking with hand-overs, onside support runs. Role deltas and set-piece shapes still to come |
| M3 | Possession loop | **done, first cut** — utility scoring over shoot / pass / carry / clear in one currency (goal probability), vision gating options, decisions gating noise, xT-style zone value |
| M4 | GK + shots + xG | **done** — logistic xG, PSxG from placement and pace, save model with held/parried/beaten, keeper claims, rush-outs and rebounds |
| M5 | Laws / set pieces | **done** — offside at kick-commit; fouls from the challenge with an advantage rule; cards with a persistence model and sendings-off; penalties from box fouls; corner routines (near/far/edge/short) with runners; free kicks over a real wall; throws and goal kicks |
| M6 | Director + UI editing | **partial** — speed, cameras, highlight modes, team/shape/style pickers. The intent layer that makes live tactics possible is in (`core/intent.ts`); the in-match editing panel is not |
| M7 | Stats / commentary | **done, first cut** — stats and 6–10 player ratings derived from the event stream, templated commentary with anti-repeat |
| M8 | Highlights / replay | **done** — keyframe ring, exact seek, highlight windows with merge |
| M9 | Balance CI + polish | **partial** — the batch runner now measures fouls, cards, penalties, corners, offsides, aerial duels, headed goals and set-piece xG alongside the shooting numbers |

### Aerial duels, headers and crossing

A ball genuinely put in the air is contested, once, on the way down, by whoever
can reach it: heading, jumpReach, strength, bravery and positioning decide who
wins, and a keeper coming for it has an edge. The winner clears it in his own
third, attacks the goal in the final third, and brings it down or nods it on
everywhere else. Crossing decides whether a wide player puts one in at all and
how far the delivery scatters.

### The playbook: a pool of recorded moves

A utility scorer picks a good option every 125 ms. That makes football happen;
it does not make it look like football, because real attacks are *rehearsed
shapes* — the overlap, the cutback, the third-man run, the switch. So the
engine carries a pool of them (`core/playbook.ts`), and a side that finds
itself in a matching position runs one: every player with a part in it follows
the script until the ball is lost or a step times out, and the utility brain
has it back.

Two sources fill the pool, in one format:

- `data/playbook.json` — the patterns every side has.
- `data/playbook.recorded.json` — **moves mined from simulated matches**.
  `npm run record` runs matches, watches the event stream for possessions that
  produced a real chance, and writes each one out as zones and roles. The
  engine's own good possessions become a vocabulary it can draw on again.

Recorded moves are validated at load: one that names a role nobody plays, or
has a player passing to himself, is dropped rather than run.

### Tactics as data, not branches

`core/intent.ts` turns "press higher" from a code change into a number. Every
choice a player makes is weighted by the product of three things: what his
**role** is for, what his **side has been told**, and what the **game state**
demands. At the middle of every slider all three are exactly 1, so a side that
has chosen nothing plays as the engine's own judgement suggests — a property
the tests pin, because a refactor that quietly rebalances the match is not a
refactor.

Roles are a table: Poacher, Pressing Forward, Ball-Playing Defender, Anchor
Man, Wing-Back, Inverted Full-Back, Trequartista and the rest. Adding one is a
data edit.

The renderer is matched to Football Manager's 2D view: wide mowing bands on a
bright surface, thin near-white markings, small kit-coloured dots with the
squad number inside and the player's surname beneath, and a ball whose shadow
stays on the grass while the ball itself lifts and grows.

## Verifying it

**The simulation is deterministic and the layers stay apart.**

```bash
npm test
```

144 tests. The ones that matter most:

- `determinism.test.ts` — 25 runs of one seed produce one SHA-256 of the event
  log; 60 × 1 s is byte-identical to 1 × 60 s; a restored keyframe resumes the
  same match.
- `matchday.test.ts` — seeking to a highlight reproduces a straight run to the
  same tick to within 1e-6 for every player and the ball. This is the test that
  makes "the text and the 2D are the same match" a fact rather than a claim.
- `purity.test.ts` — no `Math.random`, `Date.now`, `document`, `window` or
  PixiJS import anywhere in `src/core`.
- `shot.test.ts` — the xG curve hits a real shot map's shape (0.35+ from six
  yards, under 0.05 beyond 18 m, 0.76 for a penalty), conversion tracks the
  model that produced it, and a better keeper saves more.
- `manager.test.ts` / `teams.test.ts` — the bridge and the team list: overall
  stays the anchor, the eight attributes move the individual, every one of the
  32 engine attributes is covered, every squad has a goalkeeper, and two sides
  never take the field in the same colour.
- `discipline.test.ts` — fouls, bookings, sendings-off (a sent-off player
  really does leave the pitch), the advantage rule, and a penalty priced at the
  historical rate.
- `aerial.test.ts` — the contest happens, is contested rather than constant,
  produces headed goals as a minority of goals, and set pieces do not become
  the main source of them.
- `intent.test.ts` — every collective weight is exactly 1 at the middle of
  every slider, and a pressing side really does defend higher up the pitch than
  a deep one.
- `playbook.test.ts` — every move in the pool is runnable: its steps name roles
  it casts, nobody passes to himself, and a match with the pool loaded is still
  deterministic.
- `ball.test.ts` / `kick.test.ts` — a 10 m/s roll stops at 10 m under 5 m/s²
  friction, bounces strictly decay, the solver lands within 1 m from 8 m to
  45 m at every loft, and an unreachable target is under-hit at the pace
  ceiling rather than fudged.

**The match plays.**

```bash
npm run dev          # then click "Simulate match", then click a highlight
```

Query parameters drive the fixture, which is how the Manager will call it:
`?seed=cup-final&home=3-5-2&away=5-3-2&homeStyle=High%20Press&awayStyle=Counter`.

Headless equivalent, which writes three screenshots and prints the text match:

```bash
npm run build && npm run preview &
node tools/screenshot.mjs http://localhost:4173/ match.png
```

**The balance is measured, not asserted.**

```bash
npm run batch              # 20 matches
MATCHES=200 ROWS=1 npm run batch
```

Prints the distribution against the targets — goals per match, home/draw/away,
shots and shots on target per team, xG per team and per shot, possession. This
is the instrument the tuning is done with; see the note below for where it
currently stands.

## Known gaps

Run `npm run batch` for the current numbers; the ones below are from a
16-match run and are what the engine is calibrated to at the time of writing.

**In range**: goals per match, shots per team, xG per team, xG per shot, fouls,
penalties, aerial duels, possession.

**Still out**:

- **Shots on target ~43%** against a real 30–38%. The engine's shots are still
  taken from slightly better positions than a real side manages.
- **Corners ~9 per team** against a real 4–7. Too many balls end up behind the
  goal line: keeper parries and blocked shots both go there more often than
  they should.
- **Offsides under 1 a match** against a real 3–6. Attackers time their runs
  too well — the flag only goes up when a passer genuinely fails to see the
  line, and the brains rarely do.
- **Home advantage is modelled but weak.** The home/draw/away split still reads
  closer to even than the real 46/26/28.
- **Red cards ~0.4 a match** against ~0.15. The engine produces more clear
  goal-scoring opportunities than a real match, so more of them get stopped
  illegally.
- **Substitutions, injuries and weather effects** are not implemented.

- **Performance**: a full ninety minutes simulates in ~11 s single-threaded.
  Fine for watching one match; the 1,000-match CI gate in M9 needs roughly
  another order of magnitude, and the remaining cost is allocation-bound rather
  than algorithmic.

See [docs/AUDIT.md](docs/AUDIT.md) for the full sweep, including the sixteen
bugs found and fixed on the way to these numbers — among them a stamina drain
fifty times too strong, a defensive line that stood in front of the ball inside
its own box, and four squads that shipped without a goalkeeper.
