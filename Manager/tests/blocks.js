/* ============================================================================
 * THE BLOCK LOOP
 *
 * The season is played in five two-month blocks with a brief before each and
 * a review after it, and almost none of that machinery is exercised by the
 * other harnesses: they drive advanceSeason, which plays the blocks
 * internally, so the human path — beginSeason, blockPreview, playBlock,
 * blockPreview, playBlock … — was going untested.
 *
 * That path is where the bugs were. Four found by writing this file:
 *
 *   - closeBlock re-rated every club and THEN re-measured the world's
 *     fatigue, so every rating in the game carried the previous block's
 *     tiredness. Two months out of date, all season, every season.
 *   - "change shape" was a standing approach rather than an event, so a side
 *     kept paying a rebuild's running cost for ever and the brief went on
 *     showing a SWITCH card that changed nothing.
 *   - the training focus an approach implies overwrote the manager's own
 *     choice permanently: going back to AS DRILLED restored nothing, because
 *     that approach names no focus, so the pre-season control stopped meaning
 *     anything after one block.
 *   - a player with no block mark — a mid-season signing — had his ENTIRE
 *     season counted as the two months just played.
 *
 *   node manager/tests/blocks.js [seed] [seasons]
 * ========================================================================== */
globalThis.window = globalThis;
const path = require("path");
require("/home/user/1000gg/src/data.js");
const DIR = "/home/user/1000gg/manager/src";
for (const m of ["rng","names","data_intl","data_foreign","data_cards","players","ratings","international","tactics","clubs","network","scouting","managers","match","narrative","youth","competitions","blocks","agents","transfers","ai","world","draft","decisions","endings"]) require(path.join(DIR, m + ".js"));

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const SEED = process.argv[2] || "audit-blocks";
const SEASONS = Number(process.argv[3] || 12);

const w = MG.world.createWorld({ seed: SEED, startYear: 2026 });
w.playerClubId = w.clubsInLeague("PL").slice().sort((a,b)=>b.reputation-a.reputation)[6].id;
const me = () => w.clubById(w.playerClubId);
console.log(`managing ${me().name}, ${SEASONS} seasons\n`);

for (let s = 1; s <= SEASONS; s++) {
  w.beginSeason();
  check(w.seasonState && w.seasonState.block === 0, `s${s}: beginSeason played football`);
  let lastBlock = 0;
  for (let b = 1; b <= 5; b++) {
    const pre = w.blockPreview();
    check(pre && pre.block === b, `s${s}b${b}: preview block ${pre && pre.block}`);
    if (pre) {
      check(pre.fixtures.length > 0, `s${s}b${b}: no fixtures in the block ahead`);
      check(pre.squad.available <= pre.squad.size, `s${s}b${b}: more fit than exist`);
      check(pre.squad.fatigue >= 0 && pre.squad.fatigue <= 100, `s${s}b${b}: fatigue ${pre.squad.fatigue}`);
      for (const f of pre.fixtures) check(f.opponent !== me().name, `s${s}b${b}: fixture against itself`);
    }
    if (b < 5) {
      const rep = w.playBlock();
      check(rep && rep.block === b, `s${s}b${b}: report block ${rep && rep.block}`);
      if (rep) {
        check(rep.position >= 1 && rep.position <= rep.fieldSize, `s${s}b${b}: position ${rep.position}`);
        check(rep.played >= lastBlock, `s${s}b${b}: games played went backwards`);
        lastBlock = rep.played;
        check(rep.pts <= rep.played * 3, `s${s}b${b}: ${rep.pts} pts from ${rep.played} games`);
        check(rep.won + rep.drawn + rep.lost === rep.played, `s${s}b${b}: W/D/L ${rep.won}/${rep.drawn}/${rep.lost} vs P${rep.played}`);
        for (const p of rep.performers || []) check(p.rating >= 3 && p.rating <= 10, `s${s}b${b}: block rating ${p.rating}`);
      }
    }
  }
  const sum = w.advanceSeason();
  check(w.seasonState == null, `s${s}: season state survived the summer`);
  // Every division played a complete, equal season.
  for (const [lid, res] of Object.entries(sum.leagues)) {
    const counts = new Set(res.table.map(r=>r.played));
    check(counts.size === 1, `s${s}: ${lid} uneven games ${[...counts].join("/")}`);
    const n = res.table.length;
    const expect = n > 24 ? (n-1) : (n-1)*2;
    check([...counts][0] === expect, `s${s}: ${lid} played ${[...counts][0]}, expected ${expect}`);
  }
  // Nobody should be carrying an impossible fatigue or a stuck injury.
  for (const c of w.clubs) for (const p of c.squad) {
    const f = p.season.fatigue || 0;
    check(f >= 0 && f <= 1, `s${s}: ${p.name} fatigue ${f}`);
    check((p.season.outBlocks||0) >= 0 && (p.season.outBlocks||0) <= 3, `s${s}: ${p.name} outBlocks ${p.season.outBlocks}`);
    check(Number.isFinite(p.overall) && p.overall > 0, `s${s}: ${p.name} overall ${p.overall}`);
    check(Number.isFinite(p.morale), `s${s}: ${p.name} morale ${p.morale}`);
  }
  for (const c of w.clubs) {
    for (const k of ["attack","midfield","defence","keeper"]) {
      check(Number.isFinite(c.ratings[k]) && c.ratings[k] >= 20 && c.ratings[k] <= 99, `s${s}: ${c.name} ${k}=${c.ratings[k]}`);
    }
    // A named sheet must never outlive the shape it was named for.
    const slots = MG.tactics.FORMATIONS[c.formation||"4-4-2"].slots.length;
    if (c.xi) check(c.xi.length === slots, `s${s}: ${c.name} stale xi (${c.xi.length} vs ${slots})`);
    if (c.xiPlans) for (const [k,v] of Object.entries(c.xiPlans)) {
      check(!v || v.length === slots, `s${s}: ${c.name} stale ${k} sheet`);
    }
  }
}
console.log(fails.length ? `${fails.length} FAILURE(S):\n  ` + [...new Set(fails)].slice(0,25).join("\n  ") : "all block invariants held");
process.exit(fails.length ? 1 : 0);
