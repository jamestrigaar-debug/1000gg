/* ============================================================================
 * HEADLESS WORLD SIMULATION
 *
 * The proof that the background engine stands up on its own, with no player
 * character and no UI anywhere near it. Builds the world from a seed, runs N
 * seasons, prints what happened and asserts that nothing drifted somewhere it
 * should not have.
 *
 *   node manager/tests/run_world.js               20 seasons, seed "alpha"
 *   node manager/tests/run_world.js 30 my-seed    30 seasons, seed "my-seed"
 *   node manager/tests/run_world.js 5 alpha -v    also print the news feed
 * ========================================================================== */
const path = require("path");

const SEASONS = Number(process.argv[2]) || 20;
const SEED = process.argv[3] || "alpha";
const VERBOSE = process.argv.includes("-v");

/* The engine is browser-first (plain <script> tags, no build step, same as
 * 1000goals). Under node, globalThis stands in for window. */
globalThis.window = globalThis;
require(path.join(__dirname, "..", "..", "src", "data.js"));
for (const f of ["rng", "names", "data_intl", "data_foreign", "players", "ratings", "international", "tactics", "clubs", "network", "scouting", "managers", "match", "narrative", "youth", "competitions", "agents", "transfers", "ai", "world", "draft", "decisions", "endings"]) {
  require(path.join(__dirname, "..", "src", `${f}.js`));
}
const MG = globalThis.MG;

/* --------------------------------- utils --------------------------------- */
const failures = [];
function check(label, condition, detail) {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }
function money(m) { return `£${Math.round(m)}m`; }

function printTable(world, leagueId, limit) {
  const res = world.history[world.history.length - 1].leagues[leagueId];
  if (!res) return;
  console.log(`\n  ${MG.clubs.LEAGUES[leagueId].name}`);
  console.log(`  ${pad("#", 3)}${pad("Club", 24)}${padL("P", 4)}${padL("W", 4)}${padL("D", 4)}${padL("L", 4)}${padL("GF", 5)}${padL("GA", 5)}${padL("GD", 5)}${padL("Pts", 5)}  Manager`);
  res.table.slice(0, limit || res.table.length).forEach((r) => {
    const club = world.clubById(r.clubId);
    const mgr = world.managerById(club.managerId);
    console.log(`  ${pad(r.position, 3)}${pad(r.name, 24)}${padL(r.played, 4)}${padL(r.won, 4)}${padL(r.drawn, 4)}${padL(r.lost, 4)}${padL(r.gf, 5)}${padL(r.ga, 5)}${padL(r.gd, 5)}${padL(r.pts, 5)}  ${mgr ? mgr.name : "—"}`);
  });
}

/* --------------------------------- build --------------------------------- */
console.log(`\n=== BUILDING WORLD (seed "${SEED}") ===`);
let t0 = Date.now();
const world = MG.world.createWorld({ seed: SEED, startYear: 2026 });
const buildMs = Date.now() - t0;

const totalPlayers = world.clubs.reduce((t, c) => t + c.squad.length, 0);
console.log(`  ${world.clubs.length} clubs, ${totalPlayers} players, ${world.managers.length} managers in ${buildMs}ms`);
console.log(`  division player levels: ${Object.entries(MG.clubs.LEAGUE_PLAYER_LEVEL).map(([k, v]) => `${k} ${v}`).join(", ")}`);

const boardCounts = {};
for (const c of world.clubs) boardCounts[c.board.style] = (boardCounts[c.board.style] || 0) + 1;
console.log(`  boardrooms: ${Object.entries(boardCounts).map(([k, v]) => `${k} ${v}`).join(", ")}`);

console.log("\n  Season 1 Premier League, as the world sees it:");
const plStart = world.clubsInLeague("PL").slice().sort((a, b) => MG.clubs.clubStrength(b) - MG.clubs.clubStrength(a));
for (const c of plStart.slice(0, 6)) {
  const m = world.managerById(c.managerId);
  console.log(`    ${pad(c.name, 20)} att ${padL(Math.round(c.ratings.attack), 3)} mid ${padL(Math.round(c.ratings.midfield), 3)} def ${padL(Math.round(c.ratings.defence), 3)} gk ${padL(Math.round(c.ratings.keeper), 3)}  rep ${padL(c.reputation, 3)}  ${pad(m.name, 16)} ${pad(m.tactic, 13)} ${pad(c.board.style, 11)} target ${c.board.targets.summary}`);
}

/* ------------------------------- simulate -------------------------------- */
console.log(`\n=== SIMULATING ${SEASONS} SEASONS ===`);
t0 = Date.now();
const champions = [];
let sackings = 0, hires = 0, transfers = 0;
for (let i = 0; i < SEASONS; i++) {
  const s = world.advanceSeason();
  champions.push({ year: s.year, pl: s.leagues.PL.table[0].name, ucl: s.europe.UCL || "—", boot: s.awards.goldenBoots.PL });
  sackings += s.carousel.filter((c) => c.out).length;
  hires += s.carousel.filter((c) => c.in).length;
  transfers += s.transferCount;

  // Invariants, checked every season rather than only at the end.
  for (const c of world.clubs) {
    check("squad size", c.squad.length >= 15 && c.squad.length <= 34, `${c.name} has ${c.squad.length}`);
    check("ratings finite", Number.isFinite(c.ratings.attack) && Number.isFinite(c.ratings.defence), c.name);
    check("ratings in range", c.ratings.attack >= 15 && c.ratings.attack <= 99, `${c.name} attack ${c.ratings.attack}`);
    check("has manager", !!c.managerId, `${c.name} has no manager in season ${s.season}`);
    check("balance finite", Number.isFinite(c.finances.balance), c.name);
    for (const p of c.squad) {
      check("player age", p.age >= 15 && p.age <= 42, `${p.name} is ${p.age}`);
      check("player overall", p.overall >= 20 && p.overall <= 99, `${p.name} ${p.overall}`);
      check("player club link", p.clubId === c.id, `${p.name} at ${c.name}`);
    }
  }
  check("league sizes", world.clubsInLeague("PL").length === 20, `PL has ${world.clubsInLeague("PL").length}`);
  check("championship size", world.clubsInLeague("Championship").length === 24, `Championship has ${world.clubsInLeague("Championship").length}`);
}
const simMs = Date.now() - t0;
console.log(`  ${SEASONS} seasons in ${simMs}ms (${Math.round(simMs / SEASONS)}ms per season)`);

/* -------------------------------- output --------------------------------- */
console.log("\n=== CHAMPIONS ===");
console.log(`  ${pad("Year", 6)}${pad("Premier League", 24)}${pad("Champions League", 24)}Golden Boot (PL)`);
for (const c of champions) {
  console.log(`  ${pad(c.year, 6)}${pad(c.pl, 24)}${pad(c.ucl, 24)}${c.boot ? `${c.boot.name} (${c.boot.club}) ${c.boot.goals}` : "—"}`);
}

printTable(world, "PL");
printTable(world, "Championship", 8);
printTable(world, "NationalLeague", 5);

console.log("\n=== THE CAROUSEL ===");
console.log(`  ${sackings} managers lost their job, ${hires} appointments made over ${SEASONS} seasons (${(sackings / SEASONS).toFixed(1)} sackings a season across 221 clubs)`);
const longest = world.managers.filter((m) => m.clubId).sort((a, b) => b.tenure - a.tenure).slice(0, 5);
console.log("  Longest-serving:");
for (const m of longest) {
  const c = world.clubById(m.clubId);
  console.log(`    ${pad(m.name, 16)} ${pad(c.name, 22)} ${padL(m.tenure, 2)} seasons  rep ${padL(m.reputation, 3)}  ${pad(m.archetypeName, 18)} ${pad(m.tactic, 13)} titles ${m.honours.titles}`);
}
const mostTitles = world.managers.slice().sort((a, b) => (b.honours.titles + b.honours.european * 2) - (a.honours.titles + a.honours.european * 2)).slice(0, 5);
console.log("  Most decorated:");
for (const m of mostTitles) {
  const c = m.clubId ? world.clubById(m.clubId) : null;
  console.log(`    ${pad(m.name, 16)} ${pad(c ? c.name : "(out of work)", 22)} titles ${m.honours.titles}  cups ${m.honours.cups}  promotions ${m.honours.promotions}  jobs ${m.history.length}`);
}

console.log("\n=== BOARDROOMS ===");
for (const style of MG.clubs.BOARD_STYLE_KEYS) {
  const clubs = world.clubs.filter((c) => c.board.style === style);
  const avgConf = clubs.reduce((t, c) => t + c.board.confidence, 0) / (clubs.length || 1);
  const avgTenure = clubs.reduce((t, c) => { const m = world.managerById(c.managerId); return t + (m ? m.tenure : 0); }, 0) / (clubs.length || 1);
  console.log(`  ${pad(style, 12)} ${padL(clubs.length, 3)} clubs   avg confidence ${padL(Math.round(avgConf), 3)}   avg manager tenure ${avgTenure.toFixed(1)} seasons`);
}
const sample = world.clubByName("Everton") || world.clubs[0];
if (sample.board.report) {
  console.log(`\n  Last board report — ${sample.name} (${sample.board.style} board, confidence ${sample.board.confidence}):`);
  console.log(`    brief: ${sample.board.targets.summary}`);
  for (const [key, m] of Object.entries(sample.board.report.metrics)) {
    const bar = m.score >= 0 ? "+".repeat(Math.round(m.score * 5)) : "-".repeat(Math.round(-m.score * 5));
    console.log(`    ${pad(m.label, 22)} target ${pad(m.target, 16)} actual ${pad(m.actual, 14)} ${pad(bar, 6)} (${m.score >= 0 ? "+" : ""}${m.score})`);
  }
  console.log(`    verdict: ${sample.board.report.verdict} (confidence ${sample.board.report.swing >= 0 ? "+" : ""}${sample.board.report.swing})`);
}

console.log("\n=== FINANCES ===");
const richest = world.clubs.slice().sort((a, b) => b.finances.balance - a.finances.balance).slice(0, 5);
const poorest = world.clubs.slice().sort((a, b) => a.finances.balance - b.finances.balance).slice(0, 5);
console.log("  Healthiest:");
for (const c of richest) console.log(`    ${pad(c.name, 22)} balance ${padL(money(c.finances.balance), 8)}  revenue ${padL(money(c.finances.revenue), 7)}  wages ${padL(money(c.finances.wageBill), 7)}  ${MG.clubs.LEAGUES[c.leagueId].name}`);
console.log("  In trouble:");
for (const c of poorest) console.log(`    ${pad(c.name, 22)} balance ${padL(money(c.finances.balance), 8)}  revenue ${padL(money(c.finances.revenue), 7)}  wages ${padL(money(c.finances.wageBill), 7)}  ${MG.clubs.LEAGUES[c.leagueId].name}`);

console.log("\n=== THE PLAYER POPULATION ===");
const all = world.clubs.flatMap((c) => c.squad);
const best = all.slice().sort((a, b) => b.overall - a.overall).slice(0, 8);
console.log("  Best players in the world:");
for (const p of best) {
  const c = world.clubById(p.clubId);
  console.log(`    ${pad(p.name, 22)} ${pad(p.pos, 3)} ${padL(p.age, 2)}  ${padL(Math.round(p.overall), 3)} ovr (pot ${padL(Math.round(p.potential), 2)})  ${pad(c.name, 20)} ${padL(money(p.value), 7)}  ${p.career.goals} career goals`);
}
const scorers = all.slice().sort((a, b) => b.career.goals - a.career.goals).slice(0, 5);
console.log("  Leading career scorers:");
for (const p of scorers) {
  const c = world.clubById(p.clubId);
  console.log(`    ${pad(p.name, 22)} ${padL(p.career.goals, 4)} goals in ${padL(p.career.apps, 4)} apps over ${p.career.seasons} seasons  (${c.name})`);
}
const ages = all.map((p) => p.age);
console.log(`  Population: ${all.length} players, average age ${(ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)}, average overall ${(all.reduce((t, p) => t + p.overall, 0) / all.length).toFixed(1)}`);
console.log("  Average squad quality by division (should stay separated over a long save):");
for (const id of MG.clubs.LEAGUE_KEYS) {
  const clubs = world.clubsInLeague(id);
  if (!clubs.length) continue;
  // First-team quality, not squad average — every squad carries academy
  // teenagers who drag a raw mean down without ever playing.
  const firsts = clubs.map((c) => {
    const top = c.squad.slice().sort((a, b) => b.overall - a.overall).slice(0, 14);
    return top.reduce((t, p) => t + p.overall, 0) / (top.length || 1);
  });
  console.log(`    ${pad(MG.clubs.LEAGUES[id].name, 20)} first team ${(firsts.reduce((a, b) => a + b, 0) / firsts.length).toFixed(1)} (division level ${MG.clubs.LEAGUE_PLAYER_LEVEL[id]})`);
}
const inDebt = world.clubs.filter((c) => c.finances.balance < 0);
console.log(`  Clubs in the red: ${inDebt.length}/${world.clubs.length}, worst ${money(Math.min(...world.clubs.map((c) => c.finances.balance)))}`);
console.log(`  Transfers completed: ${transfers}`);

if (VERBOSE) {
  console.log("\n=== NEWS FEED (last 40) ===");
  for (const n of world.recentNews(40).reverse()) console.log(`  [${n.year}] ${pad(n.type, 10)} ${n.text}`);
}

/* ------------------------------ the draft -------------------------------- */
console.log("\n=== MANAGER DRAFT (placeholder DNA roll) ===");
const draftRng = MG.createRng(SEED, "draft-demo");
for (let i = 0; i < 3; i++) {
  const roll = MG.draft.rollManager(draftRng, {});
  console.log(`  ${pad(roll.name, 16)} ${pad(roll.archetypeName, 18)} ${pad(roll.tactic, 13)} rep ${padL(roll.reputation, 3)} (${pad(roll.reputationTier, 12)}) ${pad(roll.nationality, 14)} ${roll.traits.join(", ")}`);
}

/* -------------------------------- verdict -------------------------------- */
console.log("\n=== INVARIANTS ===");
if (!failures.length) {
  console.log("  all checks passed");
} else {
  const unique = [...new Set(failures)];
  console.log(`  ${failures.length} failures (${unique.length} distinct):`);
  for (const f of unique.slice(0, 25)) console.log(`    ${f}`);
  process.exitCode = 1;
}
console.log("");
