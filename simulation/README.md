# Match Engine — 2D football simulation

A deterministic, browser-based 2D football match engine in the style of Football
Manager's classic match view: a top-down pitch, numbered dots in kit colours, a
ball with a real height illusion, and — the actual product — a simulation whose
event stream everything else is derived from.

This directory is a self-contained Vite + TypeScript project. It is developed
here, and lands in `/Manager` once approved; nothing in `src/core` depends on
anything outside this folder, which is what makes that move a copy rather than
a rewrite.

**Status: playable match day.** Pre-match comparison → a text match of
highlights → click any line to watch that passage in 2D. The Manager bridge
(formations, playstyles, squads) is in. See [Milestones](#milestones) for what
is real and what is still a deliberate placeholder.

---

## Quick start

```bash
cd simulation
npm install
npm run dev        # http://localhost:5173 — live 2D match view
npm test           # 34 tests: determinism, physics, geometry, layering
npm run typecheck  # tsc --strict, no emit
npm run build      # production bundle
```

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
| M5 | Laws / set pieces | **partial** — offside judged at kick-commit, throws, corners, goal kicks, free kicks for offside. Fouls, cards, walls, penalties and scripted corner routines still to come |
| M6 | Director + UI editing | **partial** — speed, cameras, highlight modes. Live tactics editing still to come |
| M7 | Stats / commentary | **done, first cut** — stats and 6–10 player ratings derived from the event stream, templated commentary with anti-repeat |
| M8 | Highlights / replay | **done** — keyframe ring, exact seek, highlight windows with merge |
| M9 | Balance CI + polish | **partial** — headless batch runner with the target table; goals per match still runs high (see Known gaps) |

The renderer is matched to Football Manager's 2D view: wide mowing bands on a
bright surface, thin near-white markings, small kit-coloured dots with the
squad number inside and the player's surname beneath, and a ball whose shadow
stays on the grass while the ball itself lifts and grows.

## Verifying it

**The simulation is deterministic and the layers stay apart.**

```bash
npm test
```

81 tests. The ones that matter most:

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
- `manager.test.ts` — the bridge: overall stays the anchor, the eight
  attributes move the individual, every one of the 32 engine attributes is
  covered, the six Manager formations load under the Manager's own keys.
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

- **Goals per match runs high.** The last 16-match batch: **6.1 goals/match**
  against a 2.5–3.0 target, 16.3 shots per team against 9–14, 0.13–0.15 xG per
  shot against 0.08–0.13, possession 55/45, home/draw/away 63/25/13.
  The diagnosis is not conversion — goals track xG closely, and the shot model
  itself is calibrated against a real shot map (`tests/shot.test.ts`) — it is
  **chance volume**: the sim creates about 2.5 xG per team where a real match
  creates 1.3. Attacks reach the final third too easily. The next lever is
  fouls: a real defence stops perhaps twenty attacks a game by committing one,
  and this engine has no fouls yet, which is also why it has no cards. Until
  that lands, treat scorelines as high.
- **Set pieces are restarts, not routines.** Corners are a delivery into the
  box rather than a scripted contested play; free kicks have no wall.
- **No substitutions or injuries yet**, so fatigue only ever costs a side
  speed, never a change of personnel.
- **Performance**: a full 90 minutes simulates in ~10 s single-threaded. Fine
  for watching one match; the 1,000-match CI gate in M9 needs roughly another
  order of magnitude, and the hot paths (steering, the grid) are allocation
  bound rather than algorithmically wrong.
