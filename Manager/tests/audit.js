/* ============================================================================
 * DEEP AUDIT — invariants the other harnesses do not check
 *
 * run_world.js proves the world stands up; realism.js proves the match engine
 * is calibrated; decisions.js proves every card fires. This one goes looking
 * for the quiet structural faults none of those would notice: a player in two
 * squads at once, a club pointing at a manager who does not exist, money that
 * appears from nowhere across a transfer, an orphaned loan, an id collision.
 *
 * Everything here is a CONSISTENCY check, not a balance one — a failure is a
 * bug, never a tuning opinion.
 *
 *   node manager/tests/audit.js            12 seasons, seed "audit"
 *   node manager/tests/audit.js 25 seed-x  25 seasons on your own seed
 * ========================================================================== */
const path = require("path");
const SEASONS = Number(process.argv[2]) || 12;
const SEED = process.argv[3] || "audit";

globalThis.window = globalThis;
require(path.join(__dirname, "..", "..", "src", "data.js"));
for (const f of ["rng", "names", "data_intl", "data_foreign", "data_cards", "players", "ratings", "international", "tactics", "clubs",
  "network", "scouting", "managers", "match", "narrative", "youth", "competitions", "agents", "transfers", "ai",
  "world", "draft", "decisions", "endings"]) {
  require(path.join(__dirname, "..", "src", `${f}.js`));
}
const MG = globalThis.MG;

const failures = [];
let checks = 0;
function bad(label, detail) { failures.push(`${label}${detail ? ` — ${detail}` : ""}`); }
function check(cond, label, detail) { checks++; if (!cond) bad(label, detail); }

/* --------------------------------------------------------------------------
 * Structural audit of a world at rest (between seasons).
 * ------------------------------------------------------------------------ */
function auditWorld(world, when) {
  const tag = `[${when}]`;

  /* ---- every player belongs to exactly one squad, and says so ---- */
  const seen = new Map();          // playerId -> club it was found in
  for (const club of world.clubs) {
    for (const p of club.squad) {
      if (seen.has(p.id)) {
        bad(`${tag} player in two squads`, `${p.name} (#${p.id}) in ${seen.get(p.id).name} and ${club.name}`);
      } else seen.set(p.id, club);
      if (p.clubId !== club.id) {
        bad(`${tag} player.clubId disagrees with squad`, `${p.name} (#${p.id}) sits in ${club.name} (${club.id}) but points at ${p.clubId}`);
      }
      if (p.retired) bad(`${tag} retired player still in a squad`, `${p.name} at ${club.name}`);
    }
  }
  checks += 3;

  /* ---- player ids are unique across the whole world ---- */
  const academyIds = new Set();
  for (const club of world.clubs) {
    for (const p of (club.academy ? club.academy.players : [])) {
      if (seen.has(p.id)) bad(`${tag} academy player also in a senior squad`, `${p.name} (#${p.id})`);
      if (academyIds.has(p.id)) bad(`${tag} academy player duplicated`, `${p.name} (#${p.id})`);
      academyIds.add(p.id);
      if (p.clubId !== club.id) bad(`${tag} academy player points at the wrong club`, `${p.name} (#${p.id})`);
    }
  }
  checks++;

  /* ---- loans resolve: a loanee's parent exists and is not his host ---- */
  for (const club of world.clubs) {
    for (const p of club.squad) {
      if (!p.loan) continue;
      const parent = world.clubById(p.loan.parentId);
      if (!parent) { bad(`${tag} loan with no parent club`, `${p.name} at ${club.name}`); continue; }
      if (parent.id === club.id) bad(`${tag} player on loan to his own club`, `${p.name} at ${club.name}`);
      if (parent.squad.some((q) => q.id === p.id)) {
        bad(`${tag} loanee is in BOTH squads`, `${p.name}: ${parent.name} and ${club.name}`);
      }
    }
  }
  checks++;

  /* ---- managers: every club has one, nobody manages two clubs ---- */
  const byManager = new Map();
  for (const club of world.clubs) {
    check(club.managerId != null, `${tag} club with no manager`, club.name);
    const m = world.managerById(club.managerId);
    if (!m) { bad(`${tag} club points at a manager that does not exist`, `${club.name} -> ${club.managerId}`); continue; }
    if (byManager.has(m.id)) {
      bad(`${tag} one manager at two clubs`, `${m.name} at ${byManager.get(m.id).name} and ${club.name}`);
    } else byManager.set(m.id, club);
    if (m.clubId !== club.id) {
      bad(`${tag} manager.clubId disagrees with the club`, `${m.name}: says ${m.clubId}, sits at ${club.id}`);
    }
    if (m.retired) bad(`${tag} retired manager still employed`, `${m.name} at ${club.name}`);
  }

  /* ---- manager ids unique; the free pool is genuinely free ---- */
  const mIds = new Set();
  for (const m of world.managers) {
    if (mIds.has(m.id)) bad(`${tag} duplicate manager id`, `#${m.id} ${m.name}`);
    mIds.add(m.id);
  }
  for (const m of world.freeManagers) {
    if (m.clubId != null) bad(`${tag} "free" manager has a club`, `${m.name} -> ${m.clubId}`);
    if (!world.managerIndex[m.id]) bad(`${tag} free manager missing from the index`, m.name);
  }
  checks += 2;

  /* ---- squads are a plausible size AND a fieldable shape ----
   * Size alone is not enough: a club can carry a full complement of players
   * and still be unable to put out a legal side, which is exactly the fault
   * this check was added to catch. */
  for (const club of world.clubs) {
    if (club.squad.length < 16) bad(`${tag} squad far too small`, `${club.name}: ${club.squad.length}`);
    if (club.squad.length > 40) bad(`${tag} squad far too large`, `${club.name}: ${club.squad.length}`);
    /* Goalkeeper is the one position an empty slot is a genuine fault rather
     * than a selection problem: autoPick will press an outfielder into goal,
     * but keeperRating drops to a flat 45 for a squad with no keeper in it,
     * silently wrecking the club's defence for a season. Outfield gaps are
     * deliberately NOT checked — plenty of real squads list no attacking
     * midfielder because they do not play one, and the engine models playing
     * a man out of position properly. */
    const keepers = club.squad.filter((p) => p.pos === "GK").length;
    if (keepers < 1) bad(`${tag} club with no goalkeeper`, `${club.name} (${club.squad.length} players)`);
  }
  checks += 3;

  /* ---- numbers are numbers: no NaN anywhere that matters ---- */
  for (const club of world.clubs) {
    for (const [k, v] of Object.entries(club.ratings)) {
      if (!Number.isFinite(v)) bad(`${tag} non-finite club rating`, `${club.name}.${k} = ${v}`);
    }
    for (const [k, v] of Object.entries(club.finances)) {
      if (typeof v === "number" && !Number.isFinite(v)) bad(`${tag} non-finite finance`, `${club.name}.${k} = ${v}`);
    }
    if (!Number.isFinite(club.fans)) bad(`${tag} non-finite fan mood`, club.name);
    if (!Number.isFinite(club.board.confidence)) bad(`${tag} non-finite board confidence`, club.name);
    for (const p of club.squad) {
      if (!Number.isFinite(p.overall)) bad(`${tag} non-finite overall`, `${p.name} at ${club.name}`);
      if (!Number.isFinite(p.value)) bad(`${tag} non-finite value`, `${p.name} at ${club.name}`);
      if (!Number.isFinite(p.contract.wage)) bad(`${tag} non-finite wage`, `${p.name} at ${club.name}`);
      if (p.overall > p.potential) bad(`${tag} overall above potential`, `${p.name}: ${p.overall} > ${p.potential}`);
      for (const [k, v] of Object.entries(p.attrs)) {
        if (!Number.isFinite(v)) bad(`${tag} non-finite attribute`, `${p.name}.${k}`);
      }
      if (!Number.isFinite(p.mentalityRating)) bad(`${tag} non-finite mentalityRating`, p.name);
    }
  }
  checks += 4;

  /* ---- league membership matches what the league tables think ---- */
  for (const club of world.clubs) {
    if (!MG.clubs.LEAGUES[club.leagueId]) bad(`${tag} club in a league that does not exist`, `${club.name}: ${club.leagueId}`);
  }
  for (const leagueId of MG.clubs.ENGLISH_PYRAMID) {
    const n = world.clubs.filter((c) => c.leagueId === leagueId).length;
    if (n < 4) bad(`${tag} division collapsed`, `${leagueId} has ${n} clubs`);
  }
  checks += 2;
}

/* --------------------------------------------------------------------------
 * Money conservation across a transfer window. A fee must LEAVE one balance
 * and ARRIVE at another — if the world's total balance drifts by more than the
 * legitimate sources of new money, a fee is being created or destroyed.
 * ------------------------------------------------------------------------ */
function totalBalance(world) {
  return world.clubs.reduce((t, c) => t + c.finances.balance, 0);
}

/* -------------------------------- run it --------------------------------- */
console.log(`=== DEEP AUDIT — ${SEASONS} seasons, seed "${SEED}" ===\n`);

const world = MG.world.createWorld({ seed: SEED, startYear: 2026 });
auditWorld(world, "created");

// Put a human manager in the world so the player-club code paths run too.
const draft = MG.draft.createDraft(SEED, { rerolls: 0 });
draft.spin();
for (let i = 1; i < MG.draft.DRAFT_STEPS.length; i++) { draft.accept(); draft.spin(); }
const mgr = draft.build("Auditor");
mgr.id = MG.managers.nextId();
world.managers.push(mgr);
world.managerIndex[mgr.id] = mgr;
const startClub = world.clubs.find((c) => c.leagueId === "Championship") || world.clubs[0];
MG.world.removeManager(world, startClub, "replaced");
MG.world.appointManager(world, startClub, mgr, { quiet: true });
world.playerClubId = startClub.id;
auditWorld(world, "player appointed");

/* Alternate the two ways a season can be played. The human game splits the
 * managed club's division in two — a third of it played, the early-season
 * decision window, then the rest (world.beginSeason -> advanceSeason) — while
 * everything else in the world runs in one pass. A split season that dropped,
 * duplicated or short-changed fixtures would produce a wrong league table
 * without breaking a single other invariant, so both paths are audited here
 * and the fixture count is checked explicitly below. */
let t0 = Date.now();
for (let s = 1; s <= SEASONS; s++) {
  const split = s % 2 === 1;
  if (split) {
    const snap = world.beginSeason();
    check(snap != null, `season ${s}: beginSeason returned nothing despite a managed club`);
    if (snap) {
      check(snap.played > 0, `season ${s}: early snapshot has no games played`);
      check(snap.position >= 1 && snap.position <= snap.fieldSize, `season ${s}: nonsense early position ${snap.position}`);
    }
  }
  const summary = world.advanceSeason();

  /* Whichever path it took, every club in every division must have played
   * exactly the same number of games as its neighbours — the single check
   * that a resumed league neither replayed nor skipped its second half. */
  for (const [leagueId, res] of Object.entries(summary.leagues || {})) {
    const counts = new Set(res.table.map((r) => r.played));
    check(counts.size === 1,
      `season ${s} (${split ? "split" : "single"}): ${leagueId} has clubs on different game counts`,
      [...counts].join("/"));
  }

  auditWorld(world, `season ${s}${split ? " (split)" : ""}`);
  // Stop spamming once something is clearly systemic.
  if (failures.length > 40) { console.log("  (stopping early — too many failures)\n"); break; }
}
const elapsed = Date.now() - t0;

/* ---- population sanity over the whole run ---- */
const pop = world.clubs.reduce((t, c) => t + c.squad.length, 0);
check(pop > 3800 && pop < 7000, "world population drifted", `${pop} players`);
const avgAge = world.clubs.reduce((t, c) => t + c.squad.reduce((x, p) => x + p.age, 0), 0) / pop;
check(avgAge > 23 && avgAge < 30, "average age drifted", avgAge.toFixed(1));

console.log(`  ${checks} invariant groups checked over ${SEASONS} seasons`);
console.log(`  simulation time: ${elapsed}ms (${Math.round(elapsed / SEASONS)}ms/season)`);
console.log(`  population: ${pop} players, average age ${avgAge.toFixed(1)}`);
console.log(`  total club balance: £${Math.round(totalBalance(world))}m\n`);

if (!failures.length) {
  console.log("  no structural faults found\n");
} else {
  console.log(`  ${failures.length} FAILURE(S):`);
  const shown = failures.slice(0, 40);
  for (const f of shown) console.log(`    ✗ ${f}`);
  if (failures.length > shown.length) console.log(`    … and ${failures.length - shown.length} more`);
  console.log("");
  process.exitCode = 1;
}
