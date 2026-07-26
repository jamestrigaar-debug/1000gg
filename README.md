# Football DNA Simulator ⚽

A free, browser-based football career simulator. Draft DNA from 30+ years of
Premier League legends, compile a striker, and simulate a career chasing
**1000 career goals** — with transfers, injuries, international duty, awards,
and a full league pyramid along the way.

Live at **[1000goals.co.uk](https://1000goals.co.uk/)**.

## Quick Start

This is a static, dependency-free site — no build step required.

```bash
# Serve locally (any static server works)
npx serve .
# or
python3 -m http.server 8080
```

Open `index.html` in the browser.

## Project Structure

```
index.html              Single-page app shell: UI, styles, screen markup
src/
  game.js               Core game engine — state, simulation, career logic
  career_event_data.js  End-of-season decisions, milestones, random events,
                        career endings (factory: window.createCareerEventData)
  data.js               Generated player/team database (PLAYER_DATABASE,
                        TEAM_DATABASE, FOREIGN_LEAGUES, COUNTRY_ORIGINS, ...)
  build_data.js         Regenerates data.js from historical PL roster JSON
  data_manager.js       CLI tool to audit/patch/export data.js in bulk
  recalculate_overall.js Recalculates player "overall" from raw attributes
tests/
  test_core_regressions.js  Save/load, RNG determinism, migration, contract clamping
  test_stress.js            Compile + career simulation across many seeded careers
  test_full_flow_stress.js  150 full careers end-to-end, checks for exceptions
  test_1000_goal_run.js     Analyzes probability/path to 1000-goal achievement
  test_determinism.js       Seeded-RNG reproducibility + performance benchmarking
  stress_balance.js         Attribute-cap audits + cohort balance snapshot
data/                   Raw EA FC CSV exports used for cross-referencing
docs/                   Historical implementation notes, audits, guides
```

### Running Tests

All tests are plain Node scripts (no test runner dependency) that load
`src/data.js`, `src/career_event_data.js`, and `src/game.js` into a VM context
and drive the engine headlessly via `window.__STRESS_TEST__`.

```bash
node tests/test_core_regressions.js
node tests/test_stress.js
node tests/test_full_flow_stress.js
node tests/test_determinism.js
node tests/stress_balance.js
```

## Architecture Notes

- **State**: a single `state` object inside the `game.js` IIFE. `freshState()`
  defines defaults; `migrateState()` normalizes/repairs saved or legacy state
  (important when adding new state fields — always add a migration line).
- **Career Pillars**: intentionally disabled (`state.pillars = null`,
  `getPillar()` is a neutral stub returning `50`). This is locked in by
  `testCareerPillars` in `test_stress.js` — do not re-enable without updating
  that test and auditing the ~80 `pillars: {...}` effect blocks in
  `career_event_data.js` that currently no-op.
- **Match simulation**: `simulateMatch()` resolves xG per side via
  `resolveDuel()`, modulated by tactical matchups (`TACTICAL`), manager
  rating, home advantage, and form — then samples goals with a Poisson draw.
- **Goal attribution**: within `playSeason()`, the player's per-match "share"
  of the team's scored goals is derived from `agedRating()` vs. team attack,
  then adjusted by role, playstyle, traits, tactical fit, and league weights.
- **DNA compile**: `compilePlayer()` blends explicit attribute picks with a
  hidden-influence blend from the other donors, applies mutation rules
  (height/build mismatches), then derives agility/balance/dribbling/finishing.
- **International football**: `getTournamentForSeason()` fires the World Cup
  every 4 seasons and a confederation championship every 2 (offset), and
  `TOURNAMENT_WINNERS` constrains trophy outcomes to historically plausible
  nations (~1% exception rate for upsets).

## Data Pipeline

`src/data.js` (1.8MB) is generated, not hand-authored. To regenerate it from raw
season JSON:

```bash
node src/build_data.js /path/to/DATA_JSON ./src/data.js
```

To audit or bulk-patch the generated file, see `docs/testing_guide.md` for
the full `src/data_manager.js` command reference (attribute caps, tier audits,
CSV export/patch, backups, etc).

## Contributing / Session Notes

This is a solo hobby project. Historical implementation write-ups (bug fix
sessions, audits, feature guides) live in `docs/` for reference — they are
not required reading to contribute, but are useful context if you're
investigating why a system behaves a certain way.
