/* ============================================================================
 * SAVE / LOAD
 *
 * A save has to come back as the world you left, not a world that merely looks
 * like it. That distinction only started to bite when the season gained five
 * stops instead of one: an autosave now lands in the middle of a campaign,
 * with ten part-played divisions, a cup bracket and a European draw all in
 * flight, and every one of them has to survive a round trip through JSON.
 *
 * The weak question is "does it load". The strong one is "does the rest of the
 * season, and the season after it, come out the same" — and that is what
 * caught both of the bugs this file exists to keep fixed:
 *
 *   - buildSelection drew its rotation jitter from the shared world RNG, and
 *     the selections it built were cached in derived state that a save throws
 *     away. Reloading rebuilt them all at once, spending draws the original
 *     run had spent much earlier, and the campaign quietly forked: same seed,
 *     same squads, same tables, different champion. It now draws from a stream
 *     keyed on the club and its squad, so a cache miss costs nothing.
 *   - unpackWorld copied the season's match record and then called attachApi,
 *     which installs a fresh empty one. A save taken in October came back
 *     claiming twenty-three fewer games had been played than had been.
 *
 * WHY THE COMPARISON RUNS IN CHILD PROCESSES. Two worlds cannot be alive in
 * one process. Player and manager ids come off module-global counters that
 * unpackWorld winds back to the save's high-water mark, and ratings.js both
 * fits its scale from the world at creation and caches hidden traits in a
 * module global keyed by player id. Run the saved and unsaved arms in the same
 * process and the second inherits the first's ids and traits — the comparison
 * fails for reasons that have nothing to do with saving. Each arm therefore
 * gets its own process, and this file is both the coordinator and the arm.
 *
 *   node manager/tests/saves.js [seed]
 * ========================================================================== */
const path = require("path");
const { spawnSync } = require("child_process");

const ARM = process.argv.indexOf("--arm");
const SEED = (ARM > 0 ? process.argv[4] : process.argv[2]) || "save-test";

globalThis.window = globalThis;
require(path.join(__dirname, "..", "..", "src", "data.js"));
for (const f of ["rng", "names", "data_intl", "data_foreign", "data_cards", "players", "ratings", "international", "tactics", "clubs", "network", "scouting", "managers", "match", "narrative", "youth", "competitions", "blocks", "agents", "transfers", "ai", "world", "draft", "decisions", "endings", "saves"]) {
  require(path.join(__dirname, "..", "src", `${f}.js`));
}
const MG = globalThis.MG;

/** A world stopped three blocks into its first season, with a cup and a
 *  European campaign both half-played. */
function toMidSeason() {
  const world = MG.world.createWorld({ seed: SEED, startYear: 2026 });
  // A club with European football, so the save carries a live cup bracket AND
  // a live European draw rather than just ten league tables.
  world.playerClubId = world.clubsInLeague("PL").slice().sort((a, b) => b.reputation - a.reputation)[3].id;
  // beginSeason opens the campaign without playing any of it, so the three
  // playBlock calls are what puts the save three blocks in.
  world.beginSeason();
  world.playBlock();
  world.playBlock();
  world.playBlock();
  return world;
}

const tbl = (s) => s.leagues.PL.table.map((r) => `${r.name}:${r.pts}:${r.gf}:${r.ga}`).join("|");

/* --------------------------------- an arm --------------------------------
 * Plays two full seasons out of the mid-season position and prints what
 * happened. "save" round-trips through the serialiser first; "live" does not.
 * Anything the save loses shows up as a difference between the two. */
if (ARM > 0) {
  const mode = process.argv[ARM + 1];
  let world = toMidSeason();
  if (mode === "save") {
    const packed = JSON.stringify(MG.saves.packWorld(world));
    world = MG.saves.unpackWorld(JSON.parse(packed));
    world.beginSeason();                 // resume, as the UI does
  }
  const one = world.advanceSeason();
  const two = world.advanceSeason();
  process.stdout.write(JSON.stringify({
    matches: world.playerMatches.length,
    season1: tbl(one), cups1: one.cups, europe1: one.europe,
    moves1: one.moves, awards1: one.awards, carousel1: one.carousel,
    transfers1: one.transferCount,
    season2: tbl(two), cups2: two.cups, europe2: two.europe,
    transfers2: two.transferCount,
  }));
  process.exit(0);
}

/* ----------------------------- the coordinator ---------------------------- */
const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log(`\n=== SAVE / LOAD — seed "${SEED}" ===\n`);

const world = toMidSeason();
const club = world.clubById(world.playerClubId);
console.log(`  managing ${club.name}\n`);

/* ---- 1. the state a mid-season save has to carry ---- */
const S = world.seasonState;
check("the season is genuinely in flight", S && S.block === 3, `block ${S && S.block} of 5`);
check("every division is part-played",
  Object.values(S.leagues).every((st) => st.cursor > 0 && st.cursor < st.fixtures.length));
check("the domestic cups are under way", Object.keys(S.cups).length > 0, `${Object.keys(S.cups).length} cups`);
check("Europe is under way", Object.keys(S.euro).length > 0, Object.keys(S.euro).join(", "));

/* ---- 2. the round trip itself ---- */
const packed = JSON.stringify(MG.saves.packWorld(world));
const mb = Buffer.byteLength(packed) / 1048576;
console.log(`\n  payload ${mb.toFixed(2)} MB, schema v${MG.saves.SCHEMA_VERSION}\n`);

const matchesBefore = world.playerMatches.length;
const tableBefore = MG.competitions.leagueStanding(S.leagues.PL).map((r) => [r.name, r.pts, r.gd]);
const restored = MG.saves.unpackWorld(JSON.parse(packed));

check("the match record survives", restored.playerMatches.length === matchesBefore,
  `${restored.playerMatches.length} of ${matchesBefore}`);
check("the league tables survive",
  same(tableBefore, MG.competitions.leagueStanding(restored.seasonState.leagues.PL).map((r) => [r.name, r.pts, r.gd])));
check("the cup brackets survive",
  same(Object.keys(S.cups).map((k) => S.cups[k].alive.length),
    Object.keys(restored.seasonState.cups).map((k) => restored.seasonState.cups[k].alive.length)));
check("the European draw survives",
  same(Object.keys(S.euro).map((k) => S.euro[k].alive.length),
    Object.keys(restored.seasonState.euro).map((k) => restored.seasonState.euro[k].alive.length)));
check("club and manager indexes are rebuilt",
  !!restored.clubById(club.id) && restored.clubById(club.id).name === club.name);
check("the RNG resumes where it stopped", restored.rng.state === world.rng.state,
  `${restored.rng.state} vs ${world.rng.state}`);
/* Competition state must hold IDS, never club objects — a fixture list of
 * object references drags a second copy of every club into the file. */
check("fixtures are stored as ids, not clubs",
  typeof S.leagues.PL.fixtures[0][0] !== "object");

const report = restored.beginSeason();
check("it resumes at the block it was saved in", report && report.block === 3, `block ${report && report.block}`);
check("the report is derived, not restored", report && report.played > 0 && report.standing.length > 0,
  `P${report && report.played}`);

/* ---- 3. and the football has to come out the same ---- */
console.log("\n  replaying two seasons both ways, one process each…\n");
const arm = (mode) => {
  const r = spawnSync(process.execPath, [__filename, "--arm", mode, SEED], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.log(r.stderr); throw new Error(`${mode} arm failed`); }
  return JSON.parse(r.stdout);
};
const live = arm("live");
const back = arm("save");

check("same match record", live.matches === back.matches, `${live.matches} vs ${back.matches}`);
check("same Premier League table", live.season1 === back.season1,
  `${live.season1.split(":")[0]} vs ${back.season1.split(":")[0]}`);
check("same domestic cup winners", same(live.cups1, back.cups1));
check("same European winners", same(live.europe1, back.europe1),
  `UCL ${live.europe1.UCL} vs ${back.europe1.UCL}`);
check("same promotions and relegations", same(live.moves1, back.moves1));
check("same awards", same(live.awards1, back.awards1));
check("same manager carousel", same(live.carousel1, back.carousel1));
check("same transfer window", live.transfers1 === back.transfers1,
  `${live.transfers1} vs ${back.transfers1}`);

/* The season AFTER the restored one is the real proof: the summer in between
 * develops, ages, retires, regenerates and trades across the whole world, so a
 * save that had merely got the tables right comes apart here. */
check("same table the season after", live.season2 === back.season2,
  `${live.season2.split(":")[0]} vs ${back.season2.split(":")[0]}`);
check("same European winners the season after", same(live.europe2, back.europe2));
check("same transfer window the season after", live.transfers2 === back.transfers2,
  `${live.transfers2} vs ${back.transfers2}`);

console.log("");
if (failures.length) {
  console.log(`  ${failures.length} FAILED:`);
  for (const f of failures) console.log(`    - ${f}`);
  process.exit(1);
}
console.log("  all checks passed\n");
