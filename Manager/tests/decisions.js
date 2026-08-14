/* ============================================================================
 * DECISION LAYER EXERCISER
 *
 * Every card, every choice, actually applied against a live world.
 *
 * This exists because decisions.js deliberately wraps each card in safe() so a
 * single bad card cannot take a career down with it. That is the right call in
 * production and a menace in testing: a card whose text() or fx() throws is
 * silently downgraded to its fallback label and the game carries on looking
 * fine. This harness turns those swallowed errors back into failures.
 *
 * It also reports how much of the pool a normal career actually sees, which is
 * the number that matters for "does every playthrough feel different".
 *
 *   node manager/tests/decisions.js
 * ========================================================================== */
const path = require("path");
globalThis.window = globalThis;
require(path.join(__dirname, "..", "..", "src", "data.js"));
for (const f of ["rng", "names", "players", "ratings", "international", "tactics", "clubs", "network",
  "managers", "match", "narrative", "youth", "competitions", "transfers", "world", "draft", "decisions", "endings"]) {
  require(path.join(__dirname, "..", "src", `${f}.js`));
}
const MG = globalThis.MG;

/* safe() reports through console.warn. Capture it so a swallowed card error
 * becomes a test failure instead of a line nobody reads. */
const swallowed = [];
const realWarn = console.warn;
console.warn = (...args) => {
  if (String(args[0]).includes("decision error")) swallowed.push(args.map(String).join(" "));
  else realWarn(...args);
};

const failures = [];
function check(cond, msg) { if (!cond) failures.push(msg); }
function safeReq(card, ctx) { try { return !!card.req(ctx); } catch (e) { failures.push(`${card.id} req() threw: ${e.message}`); return false; } }

function freshWorld(seed) {
  const w = MG.world.createWorld({ seed, startYear: 2026 });
  const d = MG.draft.createDraft(seed, { rerolls: 0 });
  d.spin(); d.accept(); d.spin(); d.accept(); d.spin();
  const mgr = d.build("Exerciser");
  mgr.id = MG.managers.nextId();
  w.managers.push(mgr); w.managerIndex[mgr.id] = mgr;
  return { w, mgr };
}

/** Put the club into a state where as many requirements as possible are met.
 *
 *  Every gate a card can have needs to be reachable by at least one rig or the
 *  card is never exercised. So the rig deliberately manufactures the awkward
 *  conditions too: an injury list, a bloated squad, a 35-year-old, a genuine
 *  wonderkid, wage room, and a manager with a reputation. */
function primeClub(w, club, mode, mgr) {
  MG.clubs.setSeasonTargets(club, w.clubsInLeague(club.leagueId), w.rng);
  club.board.report = MG.clubs.evaluateSeason(club, {
    season: w.season, position: mode.position, fieldSize: 20, champion: mode.position === 1,
    cupRound: mode.cupRound, youthMinutesPct: 8, promoted: mode.promoted, relegated: mode.relegated,
    played: 38, won: 14, drawn: 10, lost: 14, gf: mode.gf, ga: 50, pts: 52,
  }, w.rng);
  club.board.confidence = mode.confidence;
  club.fans = mode.fans;
  club.finances.transferBudget = mode.budget;
  club.finances.balance = mode.balance;
  if (mode.expiring) for (const p of club.squad.slice(0, 3)) p.contract.years = 1;

  // Not season one, so cards gated on a few years in the job can fire.
  w.season = Math.max(w.season, 5);
  if (mgr) mgr.reputation = Math.max(mgr.reputation, 60);

  // An injury list, for the medical cards.
  club.squad.slice(0, 5).forEach((p) => { p.season.injured = 0.4; });

  // A veteran on his last legs, and a genuine prospect with headroom.
  const vet = club.squad.slice().sort((a, b) => b.age - a.age)[0];
  if (vet) vet.age = 35;
  const kid = club.squad.slice().sort((a, b) => a.age - b.age)[0];
  if (kid) { kid.age = 19; kid.potential = Math.min(96, kid.overall + 14); kid.homegrown = true; }

  // Wage room, so the free-agent card is reachable.
  club.finances.wageBudget = MG.clubs.wageBill(club) + 12;

  // A squad big enough to be a problem in its own right.
  let guard = 0;
  while (club.squad.length < 28 && guard++ < 20) {
    const p = MG.players.generate(w.rng, {
      league: club.leagueId, pos: w.rng.pick(MG.players.POSITION_KEYS),
      target: (club.level || 70) - 6, spread: 3, age: w.rng.int(22, 30),
    });
    p.clubId = club.id;
    p.career.clubs.push(club.name);
    club.squad.push(p);
  }
  MG.clubs.refreshRatings(club);
}

/* Every card, every choice.
 *
 * Building a fresh 221-club world per choice was correct and unusably slow (six
 * hundred worlds). Instead one world is built per scripted situation and the
 * managed club is snapshotted and restored around each choice, so no card's
 * effects colour the next one. Other clubs in the market do drift as cards buy
 * and sell from them, which is realistic and does not affect what is asserted. */
const MODES = [
  { name: "champion-rich", position: 1, cupRound: "W", promoted: false, relegated: false, confidence: 80, fans: 85, budget: 90, balance: 120, gf: 88, expiring: true },
  { name: "midtable", position: 10, cupRound: "R4", promoted: false, relegated: false, confidence: 55, fans: 56, budget: 14, balance: 8, gf: 48, expiring: true },
  { name: "crisis-broke", position: 19, cupRound: "R1", promoted: false, relegated: true, confidence: 20, fans: 22, budget: 0.6, balance: -40, gf: 28, expiring: true },
  { name: "promoted-poor", position: 2, cupRound: "R3", promoted: true, relegated: false, confidence: 66, fans: 74, budget: 6, balance: 2, gf: 61, expiring: false },
  // A second-tier club that just missed out, for the cards gated on the climb.
  { name: "nearly-promoted", league: "Championship", position: 5, cupRound: "R3", promoted: false, relegated: false, confidence: 58, fans: 62, budget: 9, balance: 4, gf: 58, expiring: true },
];

let choicesRun = 0;
const seenCards = new Set();
const emptyOutcomes = [];

// One world per situation, reused across every card.
const RIGS = MODES.map((mode) => {
  const { w, mgr } = freshWorld(`rig-${mode.name}`);
  const club = w.clubs.find((c) => c.leagueId === (mode.league || "PL"));
  MG.world.removeManager(w, club, "replaced");
  MG.world.appointManager(w, club, mgr, { quiet: true });
  w.playerClubId = club.id;
  primeClub(w, club, mode, mgr);
  return { w, mgr, club, mode };
});

const snap = (club) => JSON.stringify({
  squad: club.squad, finances: club.finances, board: club.board, fans: club.fans,
  modifiers: club.modifiers, facilities: club.facilities, flags: club.flags,
  tacticalStyle: club.tacticalStyle, xi: club.xi, ratings: club.ratings,
});
function restore(club, saved) {
  const s = JSON.parse(saved);
  Object.assign(club, s);
  MG.clubs.refreshRatings(club);
}

for (const pool of [{ label: "PRESEASON", cards: MG.decisions.PRESEASON }, { label: "ENDSEASON", cards: MG.decisions.ENDSEASON }]) {
  for (const card of pool.cards) {
    let everEligible = false;
    for (const rig of RIGS) {
      const { w, mgr, club, mode } = rig;
      const lastSeason = { position: mode.position, promoted: mode.promoted, relegated: mode.relegated,
        champion: mode.position === 1, cupRound: mode.cupRound };
      const ctx = MG.decisions.buildContext(w, club, mgr, lastSeason);
      if (card.req && !safeReq(card, ctx)) continue;
      everEligible = true;
      seenCards.add(card.id);

      const view = MG.decisions.present(card, ctx, w.rng);
      check(view.text && view.text !== "A decision awaits.", `${card.id} [${mode.name}] produced no text`);
      check(view.choices.length >= 2, `${card.id} [${mode.name}] produced ${view.choices.length} choices`);

      if (card.variants) {
        for (let vi = 0; vi < card.variants.length; vi++) {
          const v = card.variants[vi];
          let out = null;
          try { out = typeof v === "function" ? v(ctx) : v; } catch (e) { out = null; }
          check(out && String(out).length > 10, `${card.id} variant ${vi} did not render`);
        }
      }

      for (let i = 0; i < view.choices.length; i++) {
        const saved = snap(club);
        const ctx2 = MG.decisions.buildContext(w, club, mgr, lastSeason);
        const view2 = MG.decisions.present(card, ctx2, w.rng);
        const choice = view2.choices[i];
        if (!choice) { restore(club, saved); continue; }
        const before = swallowed.length;
        const outcome = MG.decisions.apply(w, club, mgr, ctx2, choice);
        choicesRun++;
        check(swallowed.length === before, `${card.id} choice ${i} [${mode.name}] threw: ${swallowed[swallowed.length - 1]}`);
        /* The engine's contract: the sentence shown to the player is the one the
         * effect returned. Falling back to the choice label means fx() returned
         * nothing, which is a card that silently did not report itself. */
        if (outcome === choice.label) emptyOutcomes.push(`${card.id} choice ${i} [${mode.name}]`);
        check(typeof outcome === "string" && outcome.length > 0, `${card.id} choice ${i} returned no outcome`);
        check(club.squad.length >= 11, `${card.id} choice ${i} [${mode.name}] left ${club.squad.length} players`);
        for (const p of club.squad) {
          check(p.overall >= 20 && p.overall <= 99, `${card.id} choice ${i} put ${p.name} at ${p.overall}`);
        }
        check(Number.isFinite(club.finances.balance), `${card.id} choice ${i} produced a non-finite balance`);
        check(club.board.confidence >= 0 && club.board.confidence <= 100, `${card.id} choice ${i} put confidence at ${club.board.confidence}`);
        check(club.fans >= 0 && club.fans <= 100, `${card.id} choice ${i} put fans at ${club.fans}`);
        restore(club, saved);
      }
    }
    if (!everEligible) failures.push(`${card.id} was not eligible in ANY of the ${MODES.length} scripted situations — its req may be unsatisfiable`);
  }
}

/* How much of the pool does one career actually see? This is the variety
 * number: if a 20-season career sees the same handful of cards, the pool being
 * large on paper does not help. */
function sampleCareer(seed) {
  const { w, mgr } = freshWorld(seed);
  const club = w.clubs.find((c) => c.leagueId === "Championship");
  MG.world.removeManager(w, club, "replaced");
  MG.world.appointManager(w, club, mgr, { quiet: true });
  w.playerClubId = club.id;
  const seen = [];
  const recent = [];
  for (let s = 0; s < 20; s++) {
    MG.clubs.setSeasonTargets(club, w.clubsInLeague(club.leagueId), w.rng);
    for (const pool of [MG.decisions.PRESEASON, MG.decisions.ENDSEASON]) {
      const ctx = MG.decisions.buildContext(w, club, mgr, club._outcome || null);
      const picked = MG.decisions.pick(pool, ctx, w.rng, 2, recent);
      for (const p of picked) {
        seen.push(p.id);
        recent.push(p.id);
        const view = MG.decisions.present(p, ctx, w.rng);
        const choice = view.choices[w.rng.int(0, view.choices.length - 1)];
        if (choice) MG.decisions.apply(w, club, mgr, ctx, choice);
      }
      while (recent.length > 14) recent.shift();
    }
    w.advanceSeason();
    if (mgr.clubId == null) break;
  }
  return seen;
}

/* Sample several careers rather than two. A career that ends early sees very
 * few cards, so a fair variety figure needs a spread — what matters is how much
 * two DIFFERENT saves have in common, averaged over many pairs. */
const RUNS = ["career-A", "career-B", "career-C", "career-D", "career-E", "career-F"].map((s) => new Set(sampleCareer(s)));
const sizes = RUNS.map((r) => r.size);
let jaccardSum = 0, pairs = 0;
for (let i = 0; i < RUNS.length; i++) {
  for (let j = i + 1; j < RUNS.length; j++) {
    const inter = [...RUNS[i]].filter((x) => RUNS[j].has(x)).length;
    const uni = new Set([...RUNS[i], ...RUNS[j]]).size;
    jaccardSum += uni ? inter / uni : 0;
    pairs++;
  }
}
const avgOverlap = pairs ? jaccardSum / pairs : 0;
const everSeen = new Set(RUNS.flatMap((r) => [...r]));

console.warn = realWarn;

const total = MG.decisions.PRESEASON.length + MG.decisions.ENDSEASON.length;
console.log(`=== DECISION EXERCISER ===\n`);
console.log(`  pool                ${total} cards (${MG.decisions.PRESEASON.length} pre-season, ${MG.decisions.ENDSEASON.length} end-of-season)`);
console.log(`  cards exercised     ${seenCards.size}/${total}`);
console.log(`  choices applied     ${choicesRun}`);
console.log(`  swallowed errors    ${swallowed.length}`);
console.log(`  silent outcomes     ${emptyOutcomes.length}${emptyOutcomes.length ? ` (${emptyOutcomes.slice(0, 4).join(", ")})` : ""}`);
console.log(`\n  VARIETY across ${RUNS.length} independent careers`);
console.log(`    distinct cards per career   min ${Math.min(...sizes)}, median ${sizes.slice().sort((a, b) => a - b)[Math.floor(sizes.length / 2)]}, max ${Math.max(...sizes)}`);
console.log(`    average pair overlap        ${Math.round(avgOverlap * 100)}%  (lower = more distinct saves)`);
console.log(`    pool reach                  ${everSeen.size}/${total} cards seen across all careers`);

if (failures.length) {
  console.log(`\n=== ${failures.length} FAILURE(S) ===`);
  for (const f of failures.slice(0, 30)) console.log("  ✗ " + f);
  process.exit(1);
}
console.log(`\n  all cards render and apply cleanly`);
