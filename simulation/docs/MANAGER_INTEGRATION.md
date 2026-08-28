# Dropping the match engine into `/Manager`

This engine is developed in `/simulation` and is designed to land in
`/Manager` as a **built asset plus one adapter file** — no changes to the
Manager's own architecture, no build step added to a game that deliberately
does not have one.

## Where it goes

The Manager is a static, dependency-free site: `Manager/index.html` loads
`src/*.js` as classic scripts that hang everything off a global `MG`
namespace. Nothing there is a module, and nothing is bundled.

So the engine ships as a self-contained bundle:

```
Manager/
  index.html            <- one extra <script type="module"> at the end
  match/
    engine.js           <- built here: `npm run build`, renamed from dist/assets/*.js
    engine.css          <- only if the match-day UI is used as-is
  src/
    match_view.js       <- NEW, ~150 lines: the adapter described below
    match.js            <- unchanged; still runs the season
```

`Manager/src/match.js` is **not replaced**. The Manager simulates a whole
season in one pass, and a Poisson xG duel is the right tool for that: nobody
wants to watch 380 fixtures at 120 Hz. This engine is for the matches a user
chooses to look at — their own club's fixtures, a cup final, a title decider.

That split is the reason the bridge exists in both directions:

| | Manager's `match.js` | this engine |
|---|---|---|
| Cost | microseconds | ~10 s per match, in a worker |
| Used for | every fixture in the world | the ones a human watches |
| Produces | a scoreline and scorers | an event stream, and everything derived from it |

## The handshake

```js
// Manager/src/match_view.js
(function (root) {
  const MG = (root.MG = root.MG || {});

  MG.matchView = {
    /** Open the match-day screen for one fixture. */
    async open(homeClub, awayClub, seed, opts) {
      const engine = await import("../match/engine.js");

      const fixture = {
        seed,                                   // stable per fixture
        home: MG.matchView.toEngineClub(homeClub),
        away: MG.matchView.toEngineClub(awayClub),
        competition: opts && opts.competition,
      };

      // 1. pre-match: team sheets read against each other
      const preMatch = engine.preMatchFor(fixture);
      renderPreMatch(preMatch);

      // 2. the text match, simulated headlessly in a worker
      const report = await engine.simulate(fixture, { highlights: "extended" });
      renderHighlightFeed(report.highlights);       // the text version

      // 3. the 2D match, on demand, one highlight at a time
      onHighlightClick = (index) => engine.watch(index, document.getElementById("pitch"));

      return report;
    },

    /** MG club -> the engine's ManagerClub. */
    toEngineClub(club) {
      const xi = MG.tactics.effectiveXI(club);       // already in slot order
      return {
        id: club.id,
        name: club.name,
        shortName: club.shortName || club.name.slice(0, 3).toUpperCase(),
        formation: club.formation || "4-4-2",
        style: (club.manager && club.manager.tactic) || club.tacticalStyle,
        squad: xi.concat(club.squad.filter((p) => xi.indexOf(p) === -1)),
        ratings: MG.clubs.ratingsFor ? MG.clubs.ratingsFor(club) : club.ratings,
        homeAdvantage: club.homeAdvantage,
        form: club.form,
      };
    },
  };
})(this);
```

The engine's side of that handshake is `src/manager/contract.ts` — it is
written against what the Manager *already has*, so `toEngineClub` above is a
field copy, not a transformation:

| Manager | engine | notes |
|---|---|---|
| `club.formation` | `formations.json` | **same keys, same shapes**: the anchors in `formations.json` are the Manager's own `coords` from `tactics.js`, converted once |
| `club.tacticalStyle` / `manager.tactic` | `TeamInstructions` | the six styles become sliders — see below |
| `MG.tactics.effectiveXI(club)` | the starting eleven | taken in the order given; slot index decides left/right |
| `player.overall` (25–96) | the anchor for all 32 attributes | a 78-rated player reads as a 78-rated player |
| `player.attrs` (8 numbers) | the individual variation | a quick winger really is quicker |
| `player.mentalityRating` | the mental attributes | vision, decisions, composure, positioning |
| `player.morale` | ±1 composure and concentration | a season-long number, worth a point on the day |
| fixture seed | the whole match | same seed, same match, forever |

## Styles are played, not asserted

`Manager/src/match.js` encodes the systems as a rock-paper-scissors table
(Possession beats Direct, High Press beats Possession, Counter beats High
Press). That table is a shortcut for something this engine can actually play
out, so `src/manager/styles.ts` translates each style into the instructions
that *produce* those relationships rather than importing the multipliers:

- **High Press** pushes the defensive line to 0.82 and pressing to 0.92, so it
  really does hunt the ball in the opponent's half — which really is what hurts
  a side trying to play out, and really is what a Counter side exploits,
  because there is space in behind.
- **Park the Bus** sits at 0.16, concedes the ball, and wastes time.
- **Route One** goes directly to the front man at maximum directness.

The matchup emerges from the sliders. The Manager's own table stays exactly as
it is for the season simulation.

## What comes back

`ManagerMatchReport` (see `src/manager/contract.ts`) — score, xG, possession,
shots, scorers, and the highlight reel. Every field is derived from the event
stream, so the Manager can store a match as `{seed, squads, tactics}` and
rebuild the report later without re-simulating.

The natural place to hang it in the existing UI is `matchRow()` in
`Manager/src/ui.js`: the `<details>` element that already opens to show the
scorers gets a "Watch highlights" button.

## What this does not touch

- No file in `Manager/src/` is modified except the new `match_view.js`.
- `Manager/src/match.js`, `world.js` and the season loop are untouched: the
  world still simulates itself in one pass.
- `Manager/tests/realism.js` still measures the Manager's own engine. This
  engine has its own gate (`npm run batch` in `/simulation`).
