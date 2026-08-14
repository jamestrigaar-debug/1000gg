/* ============================================================================
 * REALISM BENCHMARK
 *
 * Measures the match engine's output against the real-world distributions it
 * is trying to imitate. Run this before and after any change to the simulation
 * — a formula that sounds sophisticated is only worth having if it moves these
 * numbers toward the "real" column.
 *
 * Real-world targets (Premier League, ~10 season average):
 *   goals per game     2.75      draws            24%
 *   home wins          44%       away wins        32%
 *   0-0                7.5%      1-1              11%
 *   champion points    ~88       bottom points    ~26
 *   both teams scored  ~50%
 *
 *   node manager/tests/realism.js [seasons] [seed]
 * ========================================================================== */
const path = require("path");
const SEASONS = Number(process.argv[2]) || 6;
const SEED = process.argv[3] || "bench";

globalThis.window = globalThis;
require(path.join(__dirname, "..", "..", "src", "data.js"));
for (const f of ["rng", "names", "players", "ratings", "international", "tactics", "clubs", "network", "managers", "match", "narrative",
  "competitions", "transfers", "world", "draft", "decisions", "endings"]) {
  require(path.join(__dirname, "..", "src", `${f}.js`));
}
const MG = globalThis.MG;

const TARGETS = {
  goalsPerGame: 2.75, draws: 24, homeWins: 44, awayWins: 32,
  nilNil: 7.5, oneOne: 11, bothScored: 50, championPts: 88, bottomPts: 26,
};

/* Every league match played anywhere in the world is counted by wrapping the
 * match engine itself — that way the sample is the real output, not a
 * re-simulation of it. */
const tally = { games: 0, goals: 0, home: 0, away: 0, draw: 0, nil: 0, oneone: 0, bts: 0, scores: {} };
const realSimulate = MG.match.simulateMatch;
MG.match.simulateMatch = function (rng, h, a, opts) {
  const res = realSimulate(rng, h, a, opts);
  tally.games++;
  tally.goals += res.homeGoals + res.awayGoals;
  if (res.homeGoals > res.awayGoals) tally.home++;
  else if (res.homeGoals < res.awayGoals) tally.away++;
  else tally.draw++;
  if (res.homeGoals === 0 && res.awayGoals === 0) tally.nil++;
  if (res.homeGoals === 1 && res.awayGoals === 1) tally.oneone++;
  if (res.homeGoals > 0 && res.awayGoals > 0) tally.bts++;
  const key = `${Math.min(res.homeGoals, 6)}-${Math.min(res.awayGoals, 6)}`;
  tally.scores[key] = (tally.scores[key] || 0) + 1;
  return res;
};

const world = MG.world.createWorld({ seed: SEED, startYear: 2026 });
const ptsTop = [], ptsBottom = [], spreads = [];
for (let i = 0; i < SEASONS; i++) {
  const s = world.advanceSeason();
  const pl = s.leagues.PL.table;
  ptsTop.push(pl[0].pts);
  ptsBottom.push(pl[pl.length - 1].pts);
  spreads.push(pl[0].pts - pl[pl.length - 1].pts);
}

const pct = (n) => (n / tally.games) * 100;
const rows = [
  ["goals per game", tally.goals / tally.games, TARGETS.goalsPerGame, 0.25],
  ["home wins %", pct(tally.home), TARGETS.homeWins, 5],
  ["draws %", pct(tally.draw), TARGETS.draws, 4],
  ["away wins %", pct(tally.away), TARGETS.awayWins, 5],
  ["0-0 %", pct(tally.nil), TARGETS.nilNil, 3],
  ["1-1 %", pct(tally.oneone), TARGETS.oneOne, 3.5],
  ["both teams scored %", pct(tally.bts), TARGETS.bothScored, 6],
  ["champion points", avg(ptsTop), TARGETS.championPts, 7],
  ["bottom points", avg(ptsBottom), TARGETS.bottomPts, 8],
];

function avg(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }

console.log(`\n=== REALISM BENCHMARK — ${SEASONS} seasons, seed "${SEED}", ${tally.games} matches ===\n`);
console.log(`  ${pad("metric", 22)}${padL("engine", 9)}${padL("real", 8)}${padL("delta", 9)}  verdict`);
let fails = 0;
for (const [label, got, want, tol] of rows) {
  const delta = got - want;
  const ok = Math.abs(delta) <= tol;
  if (!ok) fails++;
  console.log(`  ${pad(label, 22)}${padL(got.toFixed(1), 9)}${padL(want.toFixed(1), 8)}${padL((delta >= 0 ? "+" : "") + delta.toFixed(1), 9)}  ${ok ? "ok" : "OFF"}`);
}

console.log(`\n  Most common scorelines:`);
const top = Object.entries(tally.scores).sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [score, n] of top) {
  const p = (n / tally.games) * 100;
  console.log(`    ${pad(score, 6)}${padL(p.toFixed(1) + "%", 7)}  ${"#".repeat(Math.round(p * 1.6))}`);
}
console.log(`\n  Title-race spread (champion minus bottom): ${avg(spreads).toFixed(0)} points`);
console.log(`\n  ${fails === 0 ? "all metrics within tolerance" : `${fails} metric(s) outside tolerance`}\n`);
process.exitCode = 0;
