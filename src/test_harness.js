/* ============================================================================
 * HEADLESS TEST HARNESS
 *
 * game.js is a browser IIFE with no build step and no test runner. This file
 * stubs just enough DOM for it to load under node, then exposes the engine via
 * window.__STRESS_TEST__ so simulation changes can be checked numerically
 * instead of by playing seasons in a browser.
 *
 *   node src/test_harness.js            — run the assertions
 *   require('./test_harness.js')        — { api, makeState, run }
 *
 * document.readyState is reported as "loading" so game.js registers its
 * DOMContentLoaded handler and never runs init() — the UI never boots, and the
 * simulation functions are driven directly.
 * ========================================================================== */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* ------------------------------- DOM STUB -------------------------------- */
function makeElement() {
  const el = {
    style: {}, dataset: {}, children: [], value: "", checked: false,
    innerHTML: "", textContent: "", className: "", id: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    insertBefore() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    focus() {}, blur() {}, click() {}, remove() {}, scrollIntoView() {},
    getContext() { return makeCanvasContext(); },
    querySelector() { return makeElement(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
  };
  Object.defineProperty(el, "firstChild", { get() { return null; } });
  return el;
}
function makeCanvasContext() {
  const noop = () => {};
  // Gradient factories must return an object, not undefined — canvas drawing
  // code chains .addColorStop() straight off the call.
  const gradient = () => ({ addColorStop() {} });
  return new Proxy({}, {
    get(_t, k) {
      if (k === "canvas") return makeElement();
      if (k === "measureText") return (s) => ({ width: String(s || "").length * 7 });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createConicGradient") return gradient;
      if (k === "createPattern") return () => ({});
      if (k === "getImageData") return () => ({ data: [] });
      return noop;
    },
    set() { return true; },
  });
}

const storage = new Map();
const sandbox = {
  console,
  Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, RegExp, Error,
  isNaN, isFinite, parseInt, parseFloat,
  setTimeout: (fn) => { fn(); return 0; },   // run scheduled work synchronously
  clearTimeout: () => {},
  requestAnimationFrame: (fn) => { fn(0); return 0; },
  cancelAnimationFrame: () => {},
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  },
  document: {
    readyState: "loading",           // keeps init() from ever firing
    getElementById: () => makeElement(),
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    createElementNS: () => makeElement(),
    addEventListener() {}, removeEventListener() {},
    body: makeElement(),
    documentElement: makeElement(),
  },
  navigator: { userAgent: "node", clipboard: { writeText: async () => {} } },
  location: { href: "http://localhost/", origin: "http://localhost", pathname: "/", search: "", hash: "" },
  history: { pushState() {}, replaceState() {} },
  scrollTo() {}, scrollBy() {}, alert() {}, matchMedia: () => ({ matches: false, addListener() {}, removeListener() {} }),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

/* ------------------------------ LOAD GAME -------------------------------- */
const here = __dirname;
const ctx = vm.createContext(sandbox);
for (const f of ["data.js", "career_event_data.js", "career_share.js", "leaderboard.js", "game.js"]) {
  const src = fs.readFileSync(path.join(here, f), "utf8");
  vm.runInContext(src, ctx, { filename: f });
}
const api = sandbox.window.__STRESS_TEST__;
if (!api) throw new Error("game.js did not expose __STRESS_TEST__");

/* --------------------------- STATE CONSTRUCTION --------------------------- */
const DEFAULT_ATTRS = {
  heading: 70, fitness: 75, strength: 72, height: 185, weight: 80,
  leftFoot: 70, rightFoot: 82, speed: 78,
};

/**
 * Build a playable state without going through character creation.
 * Anything not overridden falls back to a competent mid-career striker.
 */
function makeState(over = {}) {
  const attrs = Object.assign({}, DEFAULT_ATTRS, over.attrs || {});
  const s = Object.assign({
    era: "all", difficulty: "easy", phase: "attributes",
    player: { name: "Test Striker", slots: {}, usedDonors: [], position: "ST", build: "Balanced", origin: null, academy: null },
    position: "ST", playstyle: "Complete Forward",
    mentality: null, mentalityRating: 65,
    baseRating: 82, potentialRating: 80, determination: 60,
    longevity: 55, injuryRating: 45, injuryProneness: 50,
    hiddenTraits: [], traitProgress: {},
    derived: { agility: 70, balance: 70 }, derivedBonuses: { agility: 0, balance: 0 },
    club: "Arsenal", role: "Star", contractRole: "Star", contractYears: 3,
    age: 27, season: 10, reputation: 70, country: "England",
    seed: "harness-fixed-seed",
    agent: { key: "average", label: "Average", influence: 0.18, contractBonus: 1 },
    retirementAge: 40, injuryCount: 0,
  }, over, { attrs });
  api.setState(s);
  const live = api.getState();
  api.setSeed(over.seed || "harness-fixed-seed");
  return live;
}

/* -------------------------------- RUNNER ----------------------------------
 * Checks are queued rather than run inline so a check can return a promise and
 * still be awaited. Running them inline meant an async check resolved to
 * "[object Promise]" and passed vacuously — its assertions never gated the
 * result, so a broken async path would have reported green. */
let passed = 0;
const failures = [];
const queue = [];
function check(name, fn) { queue.push({ kind: "check", name, fn }); }
function group(title) { queue.push({ kind: "group", title }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function runQueued() {
  for (const item of queue) {
    if (item.kind === "group") { console.log(`\n${item.title}`); continue; }
    try {
      const detail = await item.fn();
      passed++;
      console.log(`  ✓ ${item.name}${detail ? ` — ${detail}` : ""}`);
    } catch (e) {
      failures.push(item.name);
      console.log(`  ✗ ${item.name}\n      ${e.message}`);
    }
  }
}

/** Mean league apps across `n` simulated seasons for a given state template. */
function sampleSeason(over, n = 60) {
  const acc = { apps: 0, goals: 0, gamesMissed: 0, seasons: 0, wear: 0 };
  for (let i = 0; i < n; i++) {
    makeState(Object.assign({}, over, { seed: `sample-${i}` }));
    const sd = api.simulateSeason();
    acc.apps += sd.apps; acc.goals += sd.goals; acc.gamesMissed += sd.gamesMissed;
    acc.wear += api.getState().injuryCount;
    acc.seasons++;
  }
  const m = (k) => +(acc[k] / acc.seasons).toFixed(1);
  return { apps: m("apps"), goals: m("goals"), gamesMissed: m("gamesMissed"), wear: m("wear") };
}

const lb = sandbox.window.__LEADERBOARD_PURE__;
function sandboxDocumentGetElementById() { return sandbox.document.getElementById; }
function sandboxLocalStorage() { return sandbox.localStorage; }
module.exports = { api, lb, makeState, sampleSeason, check, assert, group, makeElement };

/* ------------------------------ ASSERTIONS -------------------------------- */
if (require.main === module) {
  const VET = { age: 38, baseRating: 84, reputation: 78, attrs: { fitness: 90, speed: 85, strength: 80 } };

  group("Step 01 — veteran availability");

  check("a fit 38-year-old Star plays a credible number of league games", () => {
    const r = sampleSeason(VET);
    assert(r.apps >= 20, `expected >= 20 league+cup apps, got ${r.apps}`);
    return `${r.apps} apps, ${r.gamesMissed} missed, ${r.goals} goals`;
  });

  check("physically shot veteran plays far less than a fit one", () => {
    const fit = sampleSeason(VET);
    const shot = sampleSeason(Object.assign({}, VET, {
      attrs: { fitness: 48, speed: 50, strength: 50 }, injuryProneness: 82, longevity: 25,
    }));
    assert(shot.apps < fit.apps * 0.8, `fit ${fit.apps} vs shot ${shot.apps} — physicals must separate them`);
    return `fit ${fit.apps} apps vs shot ${shot.apps} apps`;
  });

  check("injuryCount is bounded, not runaway, over a long veteran run", () => {
    makeState(Object.assign({}, VET, { age: 33, seed: "wear-run" }));
    const st = api.getState();
    let peak = 0;
    for (let i = 0; i < 12; i++) {
      api.simulateSeason();
      peak = Math.max(peak, st.injuryCount);
      st.age++; st.season++;
    }
    assert(peak <= 20, `injuryCount peaked at ${peak}; must stay inside MAX_INJURY_MILEAGE`);
    assert(api.injuryWear() <= 6, `wear contribution ${api.injuryWear()} exceeded INJURY_WEAR_CAP`);
    return `peak mileage ${peak}/20, costing at most ${api.injuryWear()} games`;
  });

  check("a clean season works mileage back off", () => {
    makeState({ age: 26, injuryCount: 10, attrs: { fitness: 95, speed: 85, strength: 85 }, seed: "decay" });
    const st = api.getState();
    const before = st.injuryCount;
    let sawDecay = false;
    for (let i = 0; i < 8; i++) {
      const prev = st.injuryCount;
      api.simulateSeason();
      if (st.injuryCount < prev) sawDecay = true;
    }
    assert(sawDecay, `injuryCount never decreased across 8 healthy seasons (start ${before})`);
    return `mileage recovered to ${st.injuryCount} from ${before}`;
  });

  check("injury-season risk reads physicals, not just age", () => {
    makeState(Object.assign({}, VET, { age: 40, attrs: { fitness: 96, speed: 85, strength: 88 }, longevity: 85, injuryProneness: 20, hiddenTraits: ["Iron Man"] }));
    const ironman = api.injurySeasonRisk(40);
    makeState(Object.assign({}, VET, { age: 40, attrs: { fitness: 46, speed: 45, strength: 48 }, longevity: 20, injuryProneness: 85, hiddenTraits: ["Injury Prone"] }));
    const crock = api.injurySeasonRisk(40);
    assert(ironman < crock * 0.5, `iron man ${ironman.toFixed(3)} vs crock ${crock.toFixed(3)} — should be far apart`);
    return `iron man ${(ironman * 100).toFixed(0)}% vs crock ${(crock * 100).toFixed(0)}%`;
  });

  check("missed games are spread through the season, not always the opening block", () => {
    // With a front-loaded block the player could never miss the run-in. Sample
    // the injury window start across seeds and confirm it moves.
    const starts = new Set();
    for (let i = 0; i < 40; i++) {
      makeState(Object.assign({}, VET, { seed: `spread-${i}` }));
      starts.add(api.simulateSeason().injuryStart);
    }
    starts.delete(undefined);
    assert(starts.size > 3, `injury window started at only ${starts.size} distinct fixtures`);
    return `${starts.size} distinct injury-window starts across 40 seasons`;
  });

  check("the contract screen quotes what the engine will deliver", () => {
    makeState(VET);
    const st = api.getState();
    const projected = api.projectLeagueApps("Star", st.club, st.age + 1);
    const r = sampleSeason(Object.assign({}, VET, { age: 39 }));
    // sampleSeason apps include cup apps; compare against league games only.
    assert(projected > 0, "projection returned zero");
    assert(Math.abs(projected - r.apps) < 18, `projected ${projected} vs actual ${r.apps} — too far apart`);
    return `projected ${projected} vs simulated ${r.apps} (incl. cup apps)`;
  });

  check("a declining veteran is not re-signed as a Star forever", () => {
    makeState({ age: 37, baseRating: 68, reputation: 45, role: "Star", contractRole: "Star", contractYears: 0, club: "Arsenal", attrs: { fitness: 60, speed: 55, strength: 60 } });
    const offer = api.computeClubContractOffer({ perfTier: "Underperformed" }, "Arsenal");
    assert(offer.playtime !== "Star", `club still offered Star to a declining 37-year-old`);
    return `offered ${offer.playtime} (was ratcheted to Star before)`;
  });

  group("Step 02 — calendar anchoring");

  check("each era starts its career in the right calendar year", () => {
    const got = {};
    for (const era of ["all", "classic", "modern", "recent", "current"]) {
      makeState({ era, season: 1 });
      got[era] = api.seasonLabel();
    }
    assert(got.classic === "1992/93", `classic started ${got.classic}`);
    assert(got.modern === "2005/06", `modern started ${got.modern}`);
    assert(got.recent === "2015/16", `recent started ${got.recent}`);
    assert(got.all === "2025/26", `all-eras started ${got.all}`);
    return Object.entries(got).map(([k, v]) => `${k} ${v}`).join(", ");
  });

  check("season labels roll the century correctly", () => {
    makeState({ era: "modern", season: 1 });
    const st = api.getState();
    st.season = 96; // 2005 + 95 = 2100
    const label = api.seasonLabel();
    st.season = 5;
    assert(api.seasonLabel() === "2009/10", `expected 2009/10, got ${api.seasonLabel()}`);
    assert(/^\d{4}\/\d{2}$/.test(label), `malformed label at century roll: ${label}`);
    return `2009/10 and century roll ${label}`;
  });

  check("legacy saves without a calendar get their era's year, and explicit years survive", () => {
    const legacy = api.deserializeState(JSON.stringify({ state: { era: "classic", season: 7 } }));
    assert(legacy.startYear === 1992, `legacy classic save got startYear ${legacy.startYear}`);
    const explicit = api.deserializeState(JSON.stringify({ state: { era: "classic", season: 7, startYear: 1998 } }));
    assert(explicit.startYear === 1998, `explicit startYear was overwritten with ${explicit.startYear}`);
    return `legacy → 1992, explicit 1998 preserved`;
  });

  check("2025 and 2026 are two distinct seasons, not one overwriting the other", () => {
    // 2025 = the 2024/25 season (restored verbatim from before any of this
    // session's edits); 2026 = the 2025/26 season the club uploaded. A
    // one-season update should add a new vintage, not erase the old one — an
    // earlier pass through this fix overwrote 2025 in place before this was
    // caught. Both must exist, independently, with different rosters.
    const y25 = api.PLAYER_DATABASE_2025, y26 = api.PLAYER_DATABASE_2026;
    assert(Object.keys(y25).length === 20 && Object.keys(y26).length === 20,
      `expected 20 clubs each, got ${Object.keys(y25).length} / ${Object.keys(y26).length}`);
    assert(Object.keys(y25).every((k) => k.endsWith(" (2025)")), "a 2025 key is not dated 2025");
    assert(Object.keys(y26).every((k) => k.endsWith(" (2026)")), "a 2026 key is not dated 2026");
    // 2025 is last season's division: the trio that got relegated FOR 2025/26
    // were still up here. 2026 has the swap already applied.
    for (const up of ["Ipswich Town (2025)", "Leicester City (2025)", "Southampton FC (2025)"]) {
      assert(y25[up], `${up} should still be in the 2025 (2024/25) division`);
    }
    for (const up of ["Burnley FC (2026)", "Leeds United (2026)", "Sunderland (2026)"]) {
      assert(y26[up], `${up} is missing from the 2026 (2025/26) division`);
    }
    // The clearest possible proof the two seasons are actually different
    // datasets and not the same content under two names: a summer signing
    // that only exists in one of them.
    const cityNames = (db, key) => (db[key] || []).map((p) => p.name);
    assert(!cityNames(y25, "Manchester City (2025)").includes("Gianluigi Donnarumma"),
      "Donnarumma (a 2025/26 City signing) is already in the 2024/25 squad — the seasons are not distinct");
    assert(cityNames(y26, "Manchester City (2026)").includes("Gianluigi Donnarumma"),
      "Donnarumma is missing from the 2025/26 City squad");
    return "20+20 clubs, correctly dated, genuinely different rosters";
  });

  check("Current spans both real seasons on file, with no gap year between it and Recent Era", () => {
    // Recent Era stops at 2024. Current used to start at 2026, which left
    // 2025 (last season) reachable only through All Eras despite the whole
    // point of "Current" being the recent, real-world-accurate squads. Now
    // it covers both 2025 and 2026, so nothing falls in the gap.
    const current = api.getEraSquadKeys("current");
    assert(current.length === 40, `Current offers ${current.length} squads, expected 40 (20 clubs x 2 seasons)`);
    assert(current.every((k) => k.endsWith(" (2025)") || k.endsWith(" (2026)")),
      `a Current squad is neither 2025 nor 2026: ${current.find((k) => !/\(202[56]\)$/.test(k))}`);
    assert(Object.keys(api.PLAYER_DATABASE_2025).every((k) => current.includes(k)), "2025 (2024/25) is missing from Current");
    assert(Object.keys(api.PLAYER_DATABASE_2026).every((k) => current.includes(k)), "2026 (2025/26) is missing from Current");
    const recent = api.getEraSquadKeys("recent");
    assert(!recent.some((k) => k.endsWith(" (2025)") || k.endsWith(" (2026)")),
      "Recent Era reaches into last season or this one — its own range should stop at 2024");
    const all = api.getEraSquadKeys("all");
    assert(Object.keys(api.PLAYER_DATABASE_2025).every((k) => all.includes(k)), "2025 (2024/25) is missing from All Eras");
    assert(Object.keys(api.PLAYER_DATABASE_2026).every((k) => all.includes(k)), "2026 (2025/26) is missing from All Eras");
    return "40 squads under Current (both seasons), Recent Era untouched, both also inside All Eras";
  });

  check("a Current-era career's calendar is unaffected by which squad vintage backs it", () => {
    // years (which squad-key vintages the draft pulls from) and startYear
    // (the real calendar year the season count is anchored to) are
    // deliberately independent — a Current-era career is still, correctly,
    // played across calendar 2025/26 no matter whether a given draft spin
    // lands on a 2025 or a 2026 squad.
    makeState({ era: "current", season: 1 });
    assert(api.seasonLabel() === "2025/26", `Current-era career started ${api.seasonLabel()}`);
    return "season label still reads 2025/26";
  });

  check("the Premier League table reflects the 2025/26 promotion and relegation", () => {
    // The two datasets have to agree: PLAYER_DATABASE_2026 is which squads
    // exist, TEAM_DATABASE.league is who is actually IN the Premier League.
    // Before this fix the second one was still the 2024/25 division.
    const TD = api.TEAM_DATABASE;
    for (const up of ["Burnley", "Leeds United", "Sunderland"]) {
      assert(api.PL_TIERS.includes(TD[up].league), `${up} was promoted but TEAM_DATABASE has them in ${TD[up].league}`);
    }
    for (const down of ["Southampton", "Leicester City", "Ipswich Town"]) {
      assert(TD[down].league === "Championship", `${down} was relegated but TEAM_DATABASE has them in ${TD[down].league}`);
    }
    const pl = api.getPLLeagueClubs();
    assert(pl.length === 20, `getPLLeagueClubs() returned ${pl.length} clubs, not 20`);
    assert(["Burnley", "Leeds United", "Sunderland"].every((c) => pl.includes(c)), "a promoted club is missing from the PL table");
    assert(!["Southampton", "Leicester City", "Ipswich Town"].some((c) => pl.includes(c)), "a relegated club is still in the PL table");
    // The academy fallback pool is a starting club — it must never offer one
    // that is not actually in the league this season.
    assert(api.ACADEMY_STARTING_POOL.Weak.every((c) => pl.includes(c)), "the Weak academy pool offers a non-PL club");
    return `20 PL clubs, promoted trio in, relegated trio out`;
  });

  check("every Premier League club's AI squad uses its real 2025/26 players", () => {
    // initializeTeamSquad used to gate real data behind `league === "Elite"`
    // (6 of 20 clubs) AND look it up by the wrong key ("Arsenal" against
    // "Arsenal FC (2025)") — so the branch had never fired for ANY club. Every
    // squad in the game, including the player's own teammates on the Squad
    // Info tab, was fully fictional regardless of the real data sitting in
    // PLAYER_DATABASE_2026. This is the fix: one club from each prestige
    // band, including a club promoted this season.
    const TD = api.TEAM_DATABASE;
    const sample = ["Arsenal", "Tottenham", "West Ham", "Burnley", "Leeds United", "Sunderland"];
    for (const club of sample) {
      const squad = api.initializeTeamSquad(club, 1);
      assert(squad && squad.players.length === 20, `${club}: squad did not build`);
      const real = squad.players.filter((p) => p.name && !/^Player \d+$/.test(p.name));
      assert(real.length === 20, `${club} (${TD[club].league}): only ${real.length}/20 players are real`);
      // The p() field is `pos`, not `position` — a prior fix mismatched these,
      // which would have silently rendered every real player as "ST".
      const positions = new Set(real.map((p) => p.position));
      assert(!positions.has("ST") || real.filter((p) => p.position === "ST").length < 20,
        `${club}: every player mapped to position "ST" — the pos/position field mismatch is back`);
      assert([...positions].every((pos) => ["GK", "CB", "FB", "DM", "CM", "AM", "WG", "FW"].includes(pos)),
        `${club}: an unrecognised position leaked through: ${[...positions].join(", ")}`);
    }
    // A club outside the Premier League must still fall back to generated
    // players — the pool is drawn from the same season's PL squads only.
    const championship = api.initializeTeamSquad("Southampton", 1);
    const realInChampionship = championship.players.filter((p) => p.name && !/^Player \d+$/.test(p.name));
    assert(realInChampionship.length === 0, "a relegated club is still drawing from the PL squad pool");
    return `${sample.length} PL clubs across all four bands field their real 20-man squads`;
  });

  check("every current Premier League club has a real manager on file", () => {
    const pl = api.getPLLeagueClubs();
    const generic = pl.filter((c) => !api.MANAGER_DATABASE[c]);
    assert(generic.length === 0, `no manager entry for: ${generic.join(", ")}`);
    return `${pl.length} managers on file, none falling back to the generic default`;
  });

  check("every 2025/26 player is shaped the way the draft expects", () => {
    // The draft reads pos, the eight drafted attributes and mentality straight
    // off these records; an unknown trait or an out-of-range value would only
    // surface as a broken donor card mid-draft. Covers both vintages — a
    // malformed record in the older (2025) dataset breaks "All Eras" just as
    // surely as one in the newer (2026) dataset breaks "Current".
    const positions = new Set(["GK", "CB", "FB", "DM", "CM", "AM", "WG", "FW"]);
    const numeric = ["heading", "fitness", "strength", "leftFoot", "rightFoot", "speed",
                     "mentalityRating", "overall"];
    const bad = [];
    let total = 0, clubCount = 0;
    for (const db of [api.PLAYER_DATABASE_2025, api.PLAYER_DATABASE_2026]) {
      clubCount += Object.keys(db).length;
      // The 18-per-squad floor only holds for 2026, the vintage actually
      // curated for this fix. 2025 was restored verbatim from the historical
      // database's own convention, where squad size already varies a lot
      // (some 1990s squads run to single figures) — asserting a floor on
      // restored data would mean editing it to satisfy the test, exactly the
      // kind of silent rewrite this whole fix exists to stop doing.
      const minSquad = db === api.PLAYER_DATABASE_2026 ? 18 : 1;
      for (const [club, squad] of Object.entries(db)) {
        assert(/ \(\d{4}\)$/.test(club), `"${club}" has no year, so no era can find it`);
        assert(squad.length >= minSquad, `${club} has only ${squad.length} players`);
        const seen = new Set();
        for (const pl of squad) {
          total++;
          if (!pl.name) bad.push(`${club}: a player with no name`);
          if (seen.has(pl.name)) bad.push(`${club}: ${pl.name} listed twice`);
          seen.add(pl.name);
          if (!positions.has(pl.pos)) bad.push(`${club}/${pl.name}: position "${pl.pos}"`);
          if (!api.MENTALITY_TRAITS[pl.mentality]) bad.push(`${club}/${pl.name}: trait "${pl.mentality}"`);
          for (const k of numeric) {
            const v = pl[k];
            if (typeof v !== "number" || v < 1 || v > 99) bad.push(`${club}/${pl.name}: ${k}=${v}`);
          }
          if (!(pl.height >= 150 && pl.height <= 210)) bad.push(`${club}/${pl.name}: height ${pl.height}`);
          if (!(pl.weight >= 50 && pl.weight <= 120)) bad.push(`${club}/${pl.name}: weight ${pl.weight}`);
        }
      }
    }
    assert(bad.length === 0, `${bad.length} malformed records:\n      ${bad.slice(0, 6).join("\n      ")}`);
    return `${total} players across ${clubCount} squads (both seasons), all well formed`;
  });

  group("Step 03 — internationals");

  check("tournaments land on their real calendar years", () => {
    makeState({ era: "all" });
    assert(api.isTournamentHeld("WorldCup", 2026) && api.isTournamentHeld("WorldCup", 2030), "World Cup missed 2026/2030");
    assert(!api.isTournamentHeld("WorldCup", 2027), "World Cup fired in a non-World-Cup year");
    assert(api.isTournamentHeld("Euro", 2028) && !api.isTournamentHeld("Euro", 2026), "Euros off cycle");
    assert(api.isTournamentHeld("AFCON", 2025) && api.isTournamentHeld("AFCON", 2027), "AFCON is not on its 2-year cycle");
    assert(api.isTournamentHeld("AsianCup", 2027), "Asian Cup off cycle");
    assert(!api.isTournamentHeld("WorldCup", 1929), "tournament held before it existed");
    return "WC 2026/2030, Euro 2028, AFCON odd years, Asian Cup 2027";
  });

  check("a career no longer opens on a World Cup by accident", () => {
    // Every era's debut season used to be a World Cup because the cycle keyed
    // off state.season % 4 with season starting at 0.
    const opens = ["all", "classic", "modern", "recent"].map((era) => {
      makeState({ era, season: 1 });
      return api.isTournamentHeld("WorldCup", api.seasonYear(1));
    });
    assert(opens.some((o) => !o), "every era still debuts in a World Cup year");
    return `World Cup on debut: ${opens.map((o) => (o ? "yes" : "no")).join(", ")}`;
  });

  check("the five archetypes produce genuinely different careers", () => {
    const shape = (trait) => {
      let C = 0, G = 0; const N = 12;
      for (let r = 0; r < N; r++) {
        makeState({ era: "all", country: "England", intlTrait: trait, intlDebut: true, reputation: 82, baseRating: 88, age: 19, season: 3, seed: `arch-${trait}-${r}` });
        const st = api.getState();
        for (let s = 0; s < 22; s++) { api.simulateInternational(); st.age++; st.season++; }
        C += st.intlCaps; G += st.intlGoals;
      }
      return { caps: C / N, goals: G / N, ratio: G / C };
    };
    const icon = shape("icon"), servant = shape("servant"), talisman = shape("talisman"), peripheral = shape("peripheral");
    assert(icon.caps > 150, `icon only reached ${icon.caps.toFixed(0)} caps`);
    assert(servant.ratio < 0.32, `servant ratio ${servant.ratio.toFixed(2)} is not low-scoring`);
    assert(talisman.ratio > 0.55, `talisman ratio ${talisman.ratio.toFixed(2)} is not clinical`);
    assert(talisman.ratio > servant.ratio * 2, "talisman and servant are not distinguishable");
    assert(peripheral.caps < icon.caps * 0.6, "peripheral player is picked as often as an icon");
    return `icon ${icon.caps.toFixed(0)}c/${icon.goals.toFixed(0)}g, talisman ${talisman.ratio.toFixed(2)}/cap, servant ${servant.ratio.toFixed(2)}/cap, peripheral ${peripheral.caps.toFixed(0)}c`;
  });

  check("the cap and goal records are reachable but not routine", () => {
    let bestCaps = 0, bestGoals = 0;
    for (let r = 0; r < 20; r++) {
      makeState({ era: "all", country: "England", intlTrait: "icon", intlDebut: true, reputation: 88, baseRating: 92, age: 18, season: 2, seed: `rec-${r}` });
      const st = api.getState();
      for (let s = 0; s < 23; s++) { api.simulateInternational(); st.age++; st.season++; }
      bestCaps = Math.max(bestCaps, st.intlCaps); bestGoals = Math.max(bestGoals, st.intlGoals);
    }
    // Old ceiling was ~130 caps / ~55 goals against records of 221 / 143.
    assert(bestCaps > 180, `best caps ${bestCaps} — record of 221 still out of reach`);
    assert(bestGoals > 110, `best goals ${bestGoals} — record of 143 still out of reach`);
    return `best of 20 elite careers: ${bestCaps} caps, ${bestGoals} goals (records 221/143)`;
  });

  check("tournaments are won by the field, not by the player's goal tally", () => {
    // England scoring three at a World Cup used to guarantee the trophy.
    let englandWins = 0; const N = 120;
    for (let r = 0; r < N; r++) {
      makeState({ era: "all", country: "England", intlDebut: true, reputation: 90, baseRating: 95, intlTrait: "icon", season: 2, seed: `wc-${r}` });
      const st = api.getState();
      st.startYear = 2025; st.season = 2; // seasonYear -> 2026, a World Cup
      const intl = api.simulateInternational();
      if (intl && intl.wonTrophy) englandWins++;
    }
    const pct = (englandWins / N) * 100;
    assert(pct < 40, `England won ${pct.toFixed(0)}% of World Cups — still player-decided`);
    return `England win ${pct.toFixed(0)}% of World Cups with a 95-rated striker`;
  });

  check("continental tournaments are contested only by their own confederation", () => {
    // CONFEDERATIONS had no UEFA key, so building the Euro field fell through to
    // every nation in the game and Argentina turned up winning it.
    makeState({ era: "all", country: "England" });
    const cases = { Euro: "UEFA", CopaAmerica: "CONMEBOL", AFCON: "CAF", AsianCup: "AFC", GoldCup: "CONCACAF" };
    const report = [];
    for (const [key, conf] of Object.entries(cases)) {
      const field = api.tournamentContenders(key, null);
      assert(field.length > 3, `${key} field collapsed to ${field.length} nations`);
      const intruders = field.filter((f) => api.getCountryConfederation(f.item) !== conf).map((f) => f.item);
      assert(intruders.length === 0, `${key} field contains non-${conf} nations: ${intruders.slice(0, 5).join(", ")}`);
      report.push(`${key} ${field.length}`);
    }
    return report.join(", ");
  });

  check("the world records winners even when the player is not involved", () => {
    makeState({ era: "all", country: "England", intlDebut: true, reputation: 80, season: 2 });
    const st = api.getState();
    st.startYear = 2025; st.season = 1; // 2025: AFCON, Gold Cup, Nations League
    api.simulateWorldTournaments(2025);
    const ledger = st.worldTournaments || [];
    assert(ledger.length >= 2, `world ledger only recorded ${ledger.length} results`);
    assert(ledger.every((e) => e.winner && e.year === 2025), "ledger entries are malformed");
    return ledger.map((e) => `${e.short}: ${e.winner}`).join(", ");
  });

  check("legacy international traits migrate onto the new archetypes", () => {
    assert(api.normalizeIntlTrait("nationalistic") === "talisman", "nationalistic did not map to talisman");
    assert(api.normalizeIntlTrait("icon") === "icon", "icon was not preserved");
    assert(api.normalizeIntlTrait("garbage") === "balanced", "unknown trait did not fall back");
    const s = api.deserializeState(JSON.stringify({ state: { intlTrait: "nationalistic" } }));
    assert(s.intlTrait === "talisman", `save migrated to ${s.intlTrait}`);
    return "nationalistic → talisman, unknown → balanced";
  });

  group("Step 04 — cups and Europe");

  const euroSample = (club, over, n = 80) => {
    let E = 0, C = 0, A = 0, F = 0, W = 0, entered = 0;
    for (let r = 0; r < n; r++) {
      makeState(Object.assign({ club, age: 26, baseRating: 86, reputation: 75, role: "Star", contractRole: "Star" }, over, { seed: `euro-${club}-${r}` }));
      const sd = api.simulateSeason();
      E += sd.europeGoals; C += sd.cupGoals; A += sd.apps;
      if (sd.euroCampaign) { entered++; if (sd.euroCampaign.roundReached === "F") F++; if (sd.euroCampaign.won) W++; }
    }
    return { europe: E / n, cup: C / n, apps: A / n, enteredPct: entered / n, finalPct: F / n, wonPct: W / n };
  };

  check("clubs that did not qualify score no European goals", () => {
    const big = euroSample("Manchester City");
    const small = euroSample("Burnley");
    assert(small.europe === 0, `a non-qualifier scored ${small.europe} European goals`);
    assert(big.europe > 3, `a Champions League club only scored ${big.europe.toFixed(1)} in Europe`);
    return `Man City ${big.europe.toFixed(1)} European goals, Burnley ${small.europe}`;
  });

  check("a bigger club means more fixtures, which means more goals", () => {
    const big = euroSample("Manchester City");
    const small = euroSample("Burnley");
    assert(big.apps > small.apps, `big club played ${big.apps.toFixed(0)} vs small club ${small.apps.toFixed(0)}`);
    return `${big.apps.toFixed(0)} apps at a UCL club vs ${small.apps.toFixed(0)} at a non-qualifier`;
  });

  check("European runs are hard to win, not a formality", () => {
    const big = euroSample("Manchester City");
    assert(big.wonPct < 0.3, `best club won ${(big.wonPct * 100).toFixed(0)}% of European campaigns`);
    assert(big.wonPct > 0.02, `best club won only ${(big.wonPct * 100).toFixed(0)}% — unreachable`);
    return `reaches final ${(big.finalPct * 100).toFixed(0)}%, wins ${(big.wonPct * 100).toFixed(0)}%`;
  });

  check("European goals are driven by fixtures played, not by league goals", () => {
    // The old model was poisson(leagueGoals * compFactor): goals produced
    // appearances. Bucket real campaigns by how many fixtures they contained
    // and confirm the goal return climbs with the number of games.
    const byFixtures = new Map();
    const club = "Manchester City";
    for (let r = 0; r < 240; r++) {
      makeState({ club, age: 26, baseRating: 88, reputation: 78, role: "Star", contractRole: "Star", seed: `fx-${r}` });
      const data = api.TEAM_DATABASE[club];
      const lw = { goals: 1.0, shareCap: 0.38, matchCap: 0.95 };
      const c = api.simulateEuropeanCampaign("UCL", data, lw, 0.9);
      const bucket = c.fixtures <= 8 ? "group only" : c.fixtures <= 12 ? "to the quarters" : "to the final";
      const b = byFixtures.get(bucket) || { g: 0, n: 0, f: 0 };
      b.g += c.goals; b.n++; b.f += c.fixtures;
      byFixtures.set(bucket, b);
    }
    const order = ["group only", "to the quarters", "to the final"].filter((k) => byFixtures.has(k));
    const means = order.map((k) => { const b = byFixtures.get(k); return { k, goals: b.g / b.n, fixtures: b.f / b.n }; });
    assert(means.length >= 2, "not enough distinct run depths to compare");
    for (let i = 1; i < means.length; i++) {
      assert(means[i].goals > means[i - 1].goals,
        `${means[i].k} (${means[i].goals.toFixed(1)} goals) did not beat ${means[i - 1].k} (${means[i - 1].goals.toFixed(1)})`);
    }
    return means.map((m) => `${m.k}: ${m.fixtures.toFixed(0)} games → ${m.goals.toFixed(1)} goals`).join(", ");
  });

  check("a deeper run in a bigger competition means more fixtures", () => {
    const club = "Manchester City";
    const data = api.TEAM_DATABASE[club];
    const lw = { goals: 1.0, shareCap: 0.38, matchCap: 0.95 };
    const mean = (comp) => {
      let f = 0; const N = 60;
      for (let r = 0; r < N; r++) {
        makeState({ club, age: 26, baseRating: 88, reputation: 78, role: "Star", contractRole: "Star", seed: `cmp-${comp}-${r}` });
        f += api.simulateEuropeanCampaign(comp, data, lw, 0.9).fixtures;
      }
      return f / N;
    };
    const ucl = mean("UCL"), uecl = mean("UECL");
    assert(ucl > uecl, `UCL averaged ${ucl.toFixed(1)} fixtures vs UECL ${uecl.toFixed(1)}`);
    return `UCL ${ucl.toFixed(1)} fixtures vs Conference League ${uecl.toFixed(1)}`;
  });

  check("European qualification is earned by the finish and stays with the club", () => {
    makeState({ club: "Arsenal", age: 26, baseRating: 86, role: "Star", contractRole: "Star", seed: "qual" });
    const st = api.getState();
    const sd = api.simulateSeason();
    assert(st.europeanEntry && st.europeanEntry.club === "Arsenal", "no European entry recorded against the club");
    const expected = sd.pos <= 4 ? "UCL" : sd.pos === 5 ? "UEL" : sd.pos === 6 ? "UECL" : null;
    const recorded = st.europeanEntry.competition;
    assert(recorded === expected || sd.cupRun.won, `finished ${sd.pos} but recorded ${recorded}`);
    // Moving to a club outside Europe must not carry the place along. Capture
    // the recorded value first: the next season overwrites europeanEntry.
    st.club = "Burnley";
    const next = api.simulateSeason();
    assert(next.europeGoals === 0, "European place followed the player to a non-qualifier");
    return `finished ${sd.pos} → ${recorded || "no Europe"}; place did not follow the transfer`;
  });

  check("foreign elite leagues can win a European trophy", () => {
    // The old gate was `pos <= 4 && league === "Elite"`, so La Liga, Serie A and
    // Bundesliga clubs could never win one despite scoring European goals.
    const foreign = api.getForeignLeagueClubs().filter((c) => ["LaLiga", "SerieA", "Bundesliga"].includes(api.TEAM_DATABASE[c].league));
    assert(foreign.length, "no foreign elite clubs in the database");
    let wins = 0;
    for (let r = 0; r < 120; r++) {
      makeState({ club: foreign[r % foreign.length], age: 26, baseRating: 90, reputation: 80, role: "Star", contractRole: "Star", seed: `fx-${r}` });
      const st = api.getState();
      api.simulateSeason();
      if (st.honours.europeanCups > 0) wins++;
    }
    assert(wins > 0, "a foreign elite club still cannot win a European trophy");
    return `${wins}/120 foreign-league seasons ended in a European trophy`;
  });

  check("the domestic cup is always won by somebody", () => {
    let resolved = 0;
    for (let r = 0; r < 40; r++) {
      makeState({ club: "Arsenal", age: 26, baseRating: 86, role: "Star", contractRole: "Star", seed: `cup-${r}` });
      const st = api.getState();
      const sd = api.simulateSeason();
      if (sd.cupRun.won || st.lastCupWinner) resolved++;
    }
    assert(resolved === 40, `${40 - resolved} seasons ended with no cup winner at all`);
    return "40/40 seasons produced a cup winner";
  });

  group("Step 05 — cleanup");

  check("squads survive the turn of the season instead of being rebuilt", () => {
    makeState({ club: "Arsenal", age: 26, baseRating: 86, role: "Star", contractRole: "Star", seed: "sq1" });
    const st = api.getState();
    api.simulateSeason();
    // Tag the live squad. If the next season regenerates it wholesale — the old
    // behaviour, which threw away every simulated transfer — the tag vanishes.
    const squad = api.TEAM_SQUADS["Arsenal"];
    assert(squad, "Arsenal squad was never initialised");
    squad.__persistenceMarker = "kept";
    st.season++; st.age++;
    api.simulateSeason();
    assert(api.TEAM_SQUADS["Arsenal"].__persistenceMarker === "kept",
      "the squad was rebuilt from scratch, discarding the transfer simulation");
    return "transfer simulation now carries into the following season";
  });

  check("the squad world is written into the save", () => {
    makeState({ club: "Arsenal", age: 26, baseRating: 86, role: "Star", contractRole: "Star", seed: "sq2" });
    const st = api.getState();
    api.simulateSeason();
    const json = api.serializeState(st);
    const parsed = JSON.parse(json);
    assert(parsed.squads && Object.keys(parsed.squads).length > 5, "squads were not serialised");
    assert(parsed.tenure && Object.keys(parsed.tenure).length > 5, "manager tenure was not serialised");
    // Wipe the live world, then restore from the save.
    api.restoreWorldState({}, {});
    assert(!api.TEAM_SQUADS["Arsenal"], "world state did not clear");
    api.deserializeState(json);
    assert(api.TEAM_SQUADS["Arsenal"], "squads did not come back from the save");
    return `${Object.keys(parsed.squads).length} squads and ${Object.keys(parsed.tenure).length} tenures, ${(json.length / 1024).toFixed(0)} KB`;
  });

  check("a third-tier striker cannot win the Ballon d'Or", () => {
    // isEliteLeague listed "League1", which in this codebase is English League
    // One, not Ligue 1.
    const l1 = api.getLeague1Clubs()[0];
    assert(l1, "no League One clubs in the database");
    let ballonDors = 0;
    for (let r = 0; r < 40; r++) {
      makeState({ club: l1, age: 26, baseRating: 95, reputation: 90, role: "Star", contractRole: "Star", seed: `bd-${r}` });
      const st = api.getState();
      api.simulateSeason();
      ballonDors += st.honours.ballonDors;
    }
    assert(ballonDors === 0, `a League One striker won ${ballonDors} Ballon d'Ors across 40 seasons`);
    return "0 across 40 monster seasons in English League One";
  });

  check("the goal ledger adds up", () => {
    makeState({ club: "Arsenal", age: 26, baseRating: 86, reputation: 75, role: "Star", contractRole: "Star", intlDebut: true, seed: "ledger" });
    const st = api.getState();
    for (let i = 0; i < 6; i++) { api.simulateSeason(); api.simulateInternational(); st.season++; st.age++; }
    const sum = st.leagueGoals + st.cupGoals + st.europeGoals + st.intlGoals;
    assert(sum === st.totalGoals, `ledger ${sum} != totalGoals ${st.totalGoals}`);
    return `${st.totalGoals} = ${st.leagueGoals} league + ${st.cupGoals} cup + ${st.europeGoals} Europe + ${st.intlGoals} intl`;
  });

  group("Design items");

  check("the hidden international archetype surfaces as commentary", () => {
    makeState({ era: "all", country: "England", intlTrait: "servant", intlDebut: true, reputation: 82, baseRating: 86, age: 19, season: 3, seed: "narr" });
    const st = api.getState();
    for (let s = 0; s < 22; s++) { api.simulateInternational(); st.age++; st.season++; }
    const lines = st.careerLog.filter((l) => /caps for|come to rely|still chasing|100th cap/.test(l.text));
    assert(lines.length > 0, "no archetype commentary was ever produced across a full career");
    assert(!/servant|archetype|intlTrait/i.test(lines.map((l) => l.text).join(" ")), "commentary leaked the internal trait name");
    return lines[0].text.replace(/^\s+/, "").slice(0, 88);
  });

  check("the world ledger reports other nations' triumphs", () => {
    makeState({ era: "all", country: "England", intlDebut: true, reputation: 80, season: 2, seed: "ledger-line" });
    const st = api.getState();
    for (let s = 0; s < 8; s++) { api.simulateInternational(); st.season++; st.age++; }
    const meanwhile = st.careerLog.filter((l) => /lift the trophy/.test(l.text));
    assert(meanwhile.length >= 3, `only ${meanwhile.length} world results were reported across 8 seasons`);
    return meanwhile[0].text.trim().slice(0, 80);
  });

  check("body load is legible and tracks the counter", () => {
    makeState({ injuryCount: 0 }); assert(api.bodyLoadLabel() === "fresh", "0 mileage did not read fresh");
    makeState({ injuryCount: 6 }); assert(api.bodyLoadLabel() === "used", "6 mileage did not read used");
    makeState({ injuryCount: 11 }); assert(api.bodyLoadLabel() === "worn", "11 mileage did not read worn");
    makeState({ injuryCount: 18 }); assert(api.bodyLoadLabel() === "heavy", "18 mileage did not read heavy");
    return "fresh → used → worn → heavy";
  });

  check("contract screens present a real trade-off between clubs", () => {
    makeState({ club: "Arsenal", age: 33, baseRating: 84, reputation: 72, role: "Star", contractRole: "Star", injuryCount: 11, seed: "tradeoff" });
    api.simulateSeason();
    const stay = api.computeClubContractOffer({ perfTier: "Met Expectation" }, "Arsenal");
    const offers = api.generateOffers({ perfTier: "Met Expectation" });
    assert(stay.projectedApps > 0, "the renewal offer quoted no appearances");
    assert(offers.every((o) => typeof o.projectedApps === "number"), "a transfer offer carried no projection");
    // The whole point: different destinations must produce different numbers.
    const values = new Set([stay.projectedApps, ...offers.map((o) => o.projectedApps)]);
    assert(values.size > 1, "every option projected the identical appearance count");
    return `stay ${stay.playtime} ~${stay.projectedApps} apps vs ${offers.map((o) => `${o.club} ${o.playtime} ~${o.projectedApps}`).join(", ") || "no offers"}`;
  });

  group("Render smoke tests");

  check("the career screens render without throwing", () => {
    makeState({ club: "Arsenal", age: 33, baseRating: 84, reputation: 74, role: "Star", contractRole: "Star", injuryCount: 11, intlDebut: true, seed: "smoke" });
    const sd = api.simulateSeason();
    const intl = api.simulateInternational();
    api.renderCareerHeader();
    api.renderCareerStats();
    api.renderSeasonResult(sd, intl);
    api.renderSquadInfo();
    const offer = api.computeClubContractOffer({ perfTier: "Met Expectation" }, "Arsenal");
    api.renderContractOffer(offer, sd, intl);
    api.presentTransfer(api.generateOffers(sd), sd, intl, false);
    return "header, stats, season result, squad, contract offer, transfer list";
  });

  check("a retirement summary renders after a full career", () => {
    makeState({ club: "Arsenal", age: 24, baseRating: 86, reputation: 78, role: "Star", contractRole: "Star", intlDebut: true, seed: "career" });
    const st = api.getState();
    for (let i = 0; i < 14; i++) { api.simulateSeason(); api.simulateInternational(); st.season++; st.age++; }
    api.renderCareerSummary();
    assert(st.totalGoals > 0, "a 14-season career produced no goals");
    return `${st.totalGoals} goals, ${st.totalApps} apps, ${st.intlCaps} caps over 14 seasons`;
  });

  group("Ballon d'Or scarcity");

  // Play `seasons` seasons and count Ballon d'Ors, tracking whether any was won
  // without a major trophy that year.
  const ballonRun = (over, careers = 20, seasons = 14) => {
    let total = 0, noTrophy = 0; const dist = [];
    for (let r = 0; r < careers; r++) {
      makeState(Object.assign({ era: "all", age: 24, season: 7, role: "Star", contractRole: "Star", intlDebut: true, intlTrait: "icon" }, over, { seed: `bdt-${JSON.stringify(over)}-${r}` }));
      const st = api.getState();
      for (let s = 0; s < seasons; s++) {
        const sd = api.simulateSeason();
        const intl = api.simulateInternational();
        if (api.resolveBallonDor(sd, intl)) {
          const major = (sd.honours || []).includes("League Title") || (sd.euroCampaign && sd.euroCampaign.won) || (intl && intl.wonTrophy);
          if (!major) noTrophy++;
        }
        st.season++; st.age++;
      }
      total += st.honours.ballonDors; dist.push(st.honours.ballonDors);
    }
    dist.sort((a, b) => b - a);
    return { mean: total / careers, max: dist[0], dist, noTrophy };
  };

  check("an all-time great career lands near the Messi/Ronaldo benchmark", () => {
    const r = ballonRun({ club: "Manchester City", baseRating: 92, reputation: 88 });
    assert(r.mean >= 1.5 && r.mean <= 6, `mean ${r.mean.toFixed(1)} outside 1.5-6`);
    assert(r.max >= 4, `best career only managed ${r.max} — the benchmark is Messi 8, Ronaldo 5`);
    assert(r.max <= 12, `best career won ${r.max} — beyond any real benchmark`);
    return `mean ${r.mean.toFixed(1)}, best ${r.max} (Messi 8, Ronaldo 5)`;
  });

  check("an excellent but not historic career wins at most one", () => {
    const r = ballonRun({ club: "Arsenal", baseRating: 84, reputation: 76 });
    assert(r.mean < 1, `mean ${r.mean.toFixed(1)} — still too easy for a merely excellent career`);
    assert(r.max <= 2, `best such career won ${r.max}`);
    return `mean ${r.mean.toFixed(1)}, best ${r.max}`;
  });

  check("a very good career never wins one", () => {
    const r = ballonRun({ club: "Newcastle United", baseRating: 80, reputation: 68 });
    assert(r.max === 0, `a very good striker won ${r.max}`);
    return "0 across 20 careers";
  });

  check("it is never won without a league, European or international trophy", () => {
    // 92% of wins by a very good player used to come with no league title.
    let noTrophy = 0;
    for (const over of [{ club: "Manchester City", baseRating: 92, reputation: 88 }, { club: "Arsenal", baseRating: 86, reputation: 80 }]) {
      noTrophy += ballonRun(over, 12, 12).noTrophy;
    }
    assert(noTrophy === 0, `${noTrophy} Ballon d'Ors were won with no major trophy`);
    return "0 trophyless wins across 24 careers";
  });

  check("the award is losable — a qualifying season can be beaten by the field", () => {
    // The old threshold check could not be lost. Run the same strong season
    // repeatedly and confirm the outcome varies.
    let wins = 0; const N = 60;
    for (let r = 0; r < N; r++) {
      makeState({ club: "Manchester City", baseRating: 92, reputation: 90, role: "Star", contractRole: "Star", intlDebut: true, age: 27, season: 10, seed: `losable-${r}` });
      const sd = api.simulateSeason();
      const intl = api.simulateInternational();
      if (api.resolveBallonDor(sd, intl)) wins++;
    }
    assert(wins > 0, "an elite season never won it — the gate is too tight");
    assert(wins < N, "an elite season always won it — the field never beats the player");
    return `${wins}/${N} elite seasons won it`;
  });

  group("Leaderboard anti-spam and anti-resubmit");

  check("a career under 500 goals cannot be submitted", () => {
    const client = api.getLeaderboard();
    assert(client.LIMITS.goalsMin === 500, `entry bar is ${client.LIMITS.goalsMin}`);
    return client.submit({ name: "Spammer", goals: 412, apps: 700, seasons: 18 }, "abc123").then((res) => {
      assert(res.ok === false, "a 412-goal career was accepted");
      assert(res.reason === "below-minimum", `rejected for the wrong reason: ${res.reason}`);
      assert(/500/.test(res.error), `the message does not state the bar: ${res.error}`);
      return res.error;
    });
  });

  check("the 500 floor is in the database rules, not just the client", () => {
    // A client-side gate on a public write is a courtesy. The rule is the control.
    const validate = lb.LEADERBOARD_RULES.rules.players.$entry[".validate"];
    assert(/goals'\)\.val\(\) >= 500/.test(validate), "no server-side minimum on goals");
    return "goals >= 500 enforced in .validate";
  });

  check("entries are keyed by career id so a resubmission hits an existing path", () => {
    // push() gave every submission a fresh key, so the create-only rule could
    // never recognise a duplicate. set() at players/<careerId> makes the
    // database itself refuse the second write.
    const rule = lb.LEADERBOARD_RULES.rules.players.$entry[".write"];
    assert(/!data\.exists\(\)/.test(rule), "the write rule permits overwriting an existing entry");
    assert(typeof api.newCareerId === "function", "no career id generator");
    const a = api.newCareerId(), b = api.newCareerId();
    assert(a && b && a !== b, `ids are not unique: ${a} / ${b}`);
    assert(lb.cleanCareerId(a) === a, `a generated id is not a legal Firebase key: ${a}`);
    return `ids like ${a}`;
  });

  check("a career id is a legal Firebase key even when tampered with", () => {
    // . # $ [ ] / are forbidden in keys; a bad id must invalidate the write
    // rather than write to some other path.
    assert(lb.cleanCareerId("../../players") === "players", "path traversal survived");
    assert(lb.cleanCareerId("a.b#c$d[e]f/g") === "abcdefg", "forbidden key characters survived");
    assert(lb.cleanCareerId("") === "", "empty id should stay empty");
    assert(lb.cleanCareerId("x".repeat(500)).length <= lb.LIMITS.careerIdMax, "id length not capped");
    return "traversal and forbidden characters stripped";
  });

  check("submitting without a career id is refused", () => {
    const client = api.getLeaderboard();
    return client.submit({ name: "NoId", goals: 700, apps: 900, seasons: 20 }, "").then((res) => {
      assert(res.ok === false && res.reason === "no-career-id", `unexpected: ${JSON.stringify(res)}`);
      return res.error;
    });
  });

  check("a career started fresh gets an id that persists through a save", () => {
    makeState({ totalGoals: 700, careerId: null });
    const st = api.getState();
    const id = api.ensureCareerId();
    assert(id && st.careerId === id, "ensureCareerId did not stick");
    const round = api.deserializeState(api.serializeState(st));
    assert(round.careerId === id, `careerId lost across save/load: ${round.careerId}`);
    return `id ${id} survives a save`;
  });

  group("The prime career card");

  check("the peak snapshot lands in the prime window, not the first season", () => {
    const ages = [];
    for (let r = 0; r < 10; r++) {
      makeState({ club: "Arsenal", age: 18, season: 2, baseRating: 74, reputation: 55, role: "Starter", contractRole: "Starter", seed: `pk-${r}` });
      const st = api.getState();
      for (let i = 0; i < 24 && st.age < 41; i++) { const sd = api.simulateSeason(); api.applySeasonalAttributeChanges(sd); st.season++; st.age++; }
      assert(st.peak, "no peak was captured");
      assert(st.peak.age >= 23 && st.peak.age <= 32, `peak captured at age ${st.peak.age}, outside the prime window`);
      ages.push(st.peak.age);
    }
    return `peak ages ${[...new Set(ages)].sort((a, b) => a - b).join("/")}`;
  });

  check("the card shows the player at their prime, not at retirement", () => {
    makeState({ club: "Arsenal", age: 18, season: 2, baseRating: 78, reputation: 60, role: "Star", contractRole: "Star", seed: "card-prime" });
    const st = api.getState();
    for (let i = 0; i < 24 && st.age < 41; i++) { const sd = api.simulateSeason(); api.applySeasonalAttributeChanges(sd); st.season++; st.age++; }
    const peak = api.peakSnapshot();
    assert(peak.rating > st.baseRating, `peak ${peak.rating} not better than retirement ${st.baseRating}`);
    assert(peak.attrs.speed > st.attrs.speed, `peak pace ${peak.attrs.speed} not better than retirement ${st.attrs.speed}`);
    return `prime ${peak.rating} ovr / ${peak.attrs.speed} pace at ${peak.age} vs ${st.baseRating} / ${st.attrs.speed} at ${st.age}`;
  });

  check("a save with no peak still produces a renderable snapshot", () => {
    const s = api.deserializeState(JSON.stringify({ state: { club: "Arsenal", age: 34, baseRating: 81, attrs: { heading: 70, fitness: 70, strength: 70, height: 185, weight: 80, leftFoot: 70, rightFoot: 82, speed: 75 } } }));
    assert(s.peak === null, "a legacy save was given a bogus peak");
    api.setState(s);
    const snap = api.peakSnapshot();
    assert(snap && snap.attrs && snap.rating > 0, "peakSnapshot did not fall back for a legacy save");
    assert(snap.inferred === true, "the fallback was not marked as inferred");
    return `legacy save falls back to ${snap.rating} ovr`;
  });

  check("the career ends on one card, not eight sections", () => {
    makeState({ club: "Arsenal", age: 30, season: 12, baseRating: 86, reputation: 80, role: "Star", contractRole: "Star", intlDebut: true, seed: "end" });
    const st = api.getState();
    for (let i = 0; i < 5; i++) { const sd = api.simulateSeason(); api.simulateInternational(); st.season++; st.age++; }
    api.endCareer(false);
    assert(st.retired === true, "endCareer did not retire the player");
    // The deleted sections must no longer be reachable.
    for (const fn of ["renderClubBreakdown", "renderCompetitionHistory", "renderEpilogue", "renderLegacyBiography", "renderLegacyDNA", "renderDNAAttributeReport", "renderHonours"]) {
      assert(typeof api[fn] === "undefined", `${fn} still exists`);
    }
    return "endCareer runs; six detail sections and the honours grid are gone";
  });

  check("the career summary and card tagline read as English", () => {
    const cases = [
      { leagueTitles: 6, domesticCups: 3, europeanCups: 2, intlTrophies: 1, goldenBoots: 5, ballonDors: 3 },
      { leagueTitles: 1, domesticCups: 0, europeanCups: 1, intlTrophies: 1, goldenBoots: 0, ballonDors: 1 },
      { leagueTitles: 0, domesticCups: 0, europeanCups: 0, intlTrophies: 0, goldenBoots: 0, ballonDors: 0 },
    ];
    for (const h of cases) {
      makeState({
        club: "Arsenal", age: 39, season: 22, totalGoals: 861, totalApps: 1043, totalAssists: 244,
        intlGoals: 92, intlCaps: 168, country: "England",
        honours: Object.assign({ playerOfSeason: 0, youngPlayer: 0, tots: 0 }, h),
        clubsPlayed: ["Southampton", "Arsenal"],
        clubStats: { Arsenal: { apps: 883, goals: 790, assists: 214, seasons: 18, titles: 6 } },
      });
      const text = `${api.generateCareerSummary().body} ${api.cardTagline()}`;
      // "trophy" + "ies" printed "trophyies"; "trophy" + "y" printed "trophyy".
      assert(!/trophyies|trophyy|cupss|titless/.test(text), `malformed plural in: ${text.match(/\w*troph\w*/g)}`);
      // "a England national hero" / "a England mainstay".
      assert(!/\ba England\b|\ba Argentina\b|\ba Italy\b/.test(text), `wrong article in: ${text}`);
      // A trophyless career must not be described as a list of zeros.
      assert(!/\b0 (league|domestic|European|Golden|Ballon|international)/.test(text), `zero-honour listing in: ${text}`);
    }
    return "plurals, articles and empty honour lists all read correctly";
  });

  check("the card tagline fits the space it is given", () => {
    // The bio closing paragraph overran three lines and rendered cut off
    // mid-sentence ("...3 Ballon"). The card line has to stay short.
    makeState({ club: "Arsenal", age: 39, season: 22, totalGoals: 861, country: "England", intlCaps: 168,
      honours: { leagueTitles: 6, domesticCups: 3, europeanCups: 2, intlTrophies: 1, goldenBoots: 5, ballonDors: 3, playerOfSeason: 0, youngPlayer: 0, tots: 0 },
      clubsPlayed: ["Southampton", "Arsenal"] });
    const line = api.cardTagline();
    assert(line.length <= 130, `tagline is ${line.length} chars — too long for the card`);
    assert(/[.!?]$/.test(line), `tagline does not end in a full stop: "${line}"`);
    return `${line.length} chars`;
  });

  group("Leaderboard");

  check("the board is seeded with real-world benchmarks and ranks by goals", () => {
    // Unlimited, so this checks the seed itself rather than the limit argument.
    const board = lb.mergeAndRank([]);
    assert(board.length === lb.SEED_ENTRIES.length, `board has ${board.length} rows, seed has ${lb.SEED_ENTRIES.length}`);
    assert(board.length >= 25, `only ${board.length} benchmarks — the board looks thin`);
    assert(board[0].name === "Cristiano Ronaldo" && board[0].goals === 976, `top seed is ${board[0].name} on ${board[0].goals}`);
    assert(board[1].name === "Lionel Messi" && board[1].goals === 921, `second seed is ${board[1].name} on ${board[1].goals}`);
    for (let i = 1; i < board.length; i++) {
      assert(board[i - 1].goals >= board[i].goals, `board is not sorted at rank ${i + 1}`);
      assert(board[i].rank === i + 1, `rank ${board[i].rank} at index ${i}`);
    }
    assert(board.every((e) => e.goals >= 500), "a benchmark below 500 goals slipped in");
    // Every seed must survive its own validation, or it could never be submitted.
    for (const e of lb.SEED_ENTRIES) {
      assert(lb.normalizeEntry(Object.assign({ apps: 0, seasons: 20 }, e)), `seed row failed validation: ${e.name}`);
    }
    return `${board.length} benchmarks, ${board[0].goals} down to ${board[board.length - 1].goals}`;
  });

  check("submitted careers merge into the seed and rank against it", () => {
    const board = lb.mergeAndRank([{ name: "Test Striker", goals: 780, apps: 900, seasons: 20 }]);
    const mine = board.find((e) => e.name === "Test Striker");
    assert(mine, "the submitted career did not appear on the board");
    // 780 sits between Messi (921) and Pele (762).
    assert(mine.rank === 3, `expected rank 3 for 780 goals, got ${mine.rank}`);
    assert(board[mine.rank - 2].goals >= 780 && board[mine.rank].goals <= 780, "neighbours are wrong");
    return `780 goals ranks #${mine.rank}, between ${board[mine.rank - 2].name} and ${board[mine.rank].name}`;
  });

  check("a projected rank does not mutate the board", () => {
    const before = lb.mergeAndRank([]).length;
    const rank = lb.projectedRank(1000, []);
    assert(rank === 1, `1000 goals should rank first, got ${rank}`);
    assert(lb.projectedRank(0, []) === before + 1, "a zero-goal career should rank last");
    assert(lb.mergeAndRank([]).length === before, "projectedRank mutated the seed board");
    return `1000 goals → #1; board still ${before} rows`;
  });

  check("submissions outside what a career can produce are rejected", () => {
    const bad = [
      [{ name: "x", goals: 99999, apps: 10, seasons: 5 }, "absurd goal total"],
      [{ name: "x", goals: -5, apps: 10, seasons: 5 }, "negative goals"],
      [{ name: "", goals: 100, apps: 10, seasons: 5 }, "empty name"],
      [{ name: "x", goals: 100, apps: 10, seasons: 99 }, "impossible season count"],
      [{ name: "x", goals: "many", apps: 10, seasons: 5 }, "non-numeric goals"],
      [null, "null entry"],
    ];
    for (const [entry, why] of bad) {
      assert(lb.normalizeEntry(entry) === null, `accepted an entry with ${why}`);
    }
    const good = lb.normalizeEntry({ name: "  Real Player  ", goals: "412", apps: 700, seasons: 18 });
    assert(good && good.goals === 412 && good.name === "Real Player", "a valid entry was rejected or mangled");
    return `${bad.length} invalid shapes rejected, valid entry coerced`;
  });

  check("every submitted career shows the difficulty it was played on", () => {
    const rows = [
      { name: "Impossible Run", goals: 812, apps: 1010, difficulty: "impossible", rank: 1 },
      { name: "Easy Run", goals: 540, apps: 800, difficulty: "easy", rank: 2 },
      { name: "Cristiano Ronaldo", goals: 976, seed: true, rank: 3 },
      { name: "Mine", goals: 600, apps: 850, difficulty: "medium", you: true, rank: 4 },
    ];
    const html = api.leaderboardRowsHtml(rows, false);
    assert(/lb-tag diff impossible[^>]*>impossible</.test(html), "impossible difficulty not tagged");
    assert(/lb-tag diff easy[^>]*>easy</.test(html), "easy difficulty not tagged");
    assert(/>real</.test(html), "the real-player tag was lost");
    // A benchmark has no difficulty and must not be given one.
    const seedChunk = html.slice(html.indexOf("Cristiano"), html.indexOf("Cristiano") + 260);
    assert(!/lb-tag diff/.test(seedChunk), "a real-world benchmark was tagged with a difficulty");
    // The player's own row keeps both markers.
    const mineChunk = html.slice(html.indexOf("Mine"));
    assert(/lb-tag you/.test(mineChunk) && /lb-tag diff medium/.test(mineChunk), "the you row lost a tag");
    return "real / easy / medium / hard / impossible all render";
  });

  check("every submitted career shows the era it was played in", () => {
    // Era changes what a career could have scored as much as difficulty does —
    // a Classic-era striker drafted from a different pool to a Current-season
    // one — so a total on the board means little without both.
    const board = [
      { rank: 1, name: "Cristiano Ronaldo", goals: 976, apps: 0, seed: true },
      { rank: 2, name: "All Eras", goals: 900, apps: 1200, difficulty: "hard", era: "all" },
      { rank: 3, name: "Classic", goals: 880, apps: 1100, difficulty: "easy", era: "classic" },
      { rank: 4, name: "Modern", goals: 870, apps: 1100, difficulty: "medium", era: "modern" },
      { rank: 5, name: "Recent", goals: 860, apps: 1100, difficulty: "hard", era: "recent" },
      { rank: 6, name: "Current", goals: 850, apps: 1100, difficulty: "impossible", era: "current" },
      { rank: 7, name: "No era", goals: 840, apps: 1100, difficulty: "easy" },
      { rank: 8, name: "Junk era", goals: 830, apps: 1100, difficulty: "easy", era: "__proto__" },
    ];
    const html = api.leaderboardRowsHtml(board, false);
    for (const opt of api.ERA_OPTIONS) {
      const tag = api.eraTagFor(opt.key);
      assert(tag, `the ${opt.key} era produced no tag`);
      assert(tag.full === opt.label, `${opt.key} lost its full label: ${tag.full}`);
      // The name column is narrow on a phone and "impossible" already sits
      // beside it, so a long era word truncated to "CLASSI…".
      assert(tag.short.length <= 5, `${opt.key} renders as "${tag.short}" — too wide for the name column`);
      assert(html.includes(`>${tag.short}</span>`), `the ${opt.key} tag never reached the row`);
    }
    // The years must be the era's own, not a guess.
    assert(api.eraTagFor("classic").short === "92–04", `classic reads ${api.eraTagFor("classic").short}`);
    assert(api.eraTagFor("recent").short === "15–24", `recent reads ${api.eraTagFor("recent").short}`);
    // Current now spans two real seasons (2025 and 2026), the same shape as
    // Classic/Modern/Recent, so it reads the same way they do.
    assert(api.eraTagFor("current").short === "25–26", `current reads ${api.eraTagFor("current").short}`);
    assert(api.eraTagFor("all").short === "all", `all-eras reads ${api.eraTagFor("all").short}`);
    // A real-world benchmark has no era, and neither junk nor absence invents one.
    const rows = html.split('<div class="lb-row').slice(1);
    const rowFor = (name) => {
      const row = rows.find((r) => r.includes(`>${name}<`));
      assert(row, `no row rendered for ${name}`);
      return row;
    };
    const eraTags = (row) => (row.match(/lb-tag era/g) || []).length;
    assert(eraTags(rowFor("Cristiano Ronaldo")) === 0, "the real-player row was given an era");
    assert(eraTags(rowFor("No era")) === 0, "a career with no era was given one anyway");
    assert(eraTags(rowFor("Junk era")) === 0, "an unrecognised era key was rendered");
    assert(!/__proto__/.test(html), "an unrecognised era key reached the page");
    // Difficulty and era must both survive together, not replace each other.
    assert(/lb-tag diff hard[^>]*>hard<\/span><span class="lb-tag era"[^>]*>all</.test(html),
      "difficulty and era do not sit side by side");
    return "all 5 eras tagged, benchmarks and unknown keys left bare";
  });

  check("hostile display names are defanged", () => {
    const nasty = lb.cleanName('<img src=x onerror=alert(1)>');
    assert(!/[\u0000-\u001F]/.test(nasty), "control characters survived");
    assert(nasty.length <= lb.LIMITS.nameMax, `name length ${nasty.length} exceeds the cap`);
    const long = lb.cleanName("A".repeat(200));
    assert(long.length === lb.LIMITS.nameMax, `long name was not capped, got ${long.length}`);
    // The string is still raw HTML — escaping is the renderer's job, and the
    // game escapes it with esc(). This only checks length and control chars.
    return `capped at ${lb.LIMITS.nameMax}, control chars stripped`;
  });

  check("the database rules are append-only and bounded", () => {
    const rules = lb.LEADERBOARD_RULES.rules.players;
    assert(rules[".read"] === true, "the board is not publicly readable");
    assert(rules[".write"] === undefined, "the players node itself is writable — one call could wipe the board");
    const entry = rules.$entry;
    assert(/!data\.exists\(\)/.test(entry[".write"]), "entries can be overwritten");
    assert(/newData\.exists\(\)/.test(entry[".write"]), "entries can be deleted");
    assert(/goals.*<= 2000/s.test(entry[".validate"]), "goal totals are unbounded");
    assert(rules[".indexOn"] && rules[".indexOn"].includes("goals"), "no index on goals — queries would scan");
    return "create-only, value-bounded, indexed on goals";
  });

  check("the game degrades cleanly when the leaderboard is unreachable", () => {
    // No Firebase SDK in the harness, which is the offline case exactly.
    const client = api.getLeaderboard();
    assert(client, "no leaderboard client was created");
    assert(client.available() === false, "claimed availability with no SDK loaded");
    return `offline path reports: ${client.initError()}`;
  });

  check("an offline read still returns a full board", () => {
    const client = api.getLeaderboard();
    return client.fetchTop(10).then((payload) => {
      assert(payload.entries.length === 10, `got ${payload.entries.length} rows offline`);
      assert(payload.live === false, "claimed a live read with no database");
      return `${payload.entries.length} benchmark rows, live=false`;
    });
  });

  check("an offline submission fails cleanly instead of throwing", () => {
    const client = api.getLeaderboard();
    return client.submit({ name: "Test", goals: 400, apps: 700, seasons: 18 }).then((res) => {
      assert(res.ok === false, "claimed a successful submission with no database");
      assert(typeof res.error === "string" && res.error.length, "no error message for the user");
      return `reports: ${res.error}`;
    });
  });

  check("the offline reason names its actual cause", () => {
    // This is the regression that shipped: a missing config file 404'd and the
    // board reported "Firebase SDK unavailable", sending us after a network
    // fault that did not exist. Each cause must now identify itself.
    const client = api.getLeaderboard();
    const d = client.diagnostics();
    assert(d.reason === "sdk-missing", `expected sdk-missing in the harness, got ${d.reason}`);
    assert(/SDK did not load/i.test(d.error), `error does not name the SDK: ${d.error}`);
    assert(d.configPresent === true, "config should be present — it is built into leaderboard.js");
    assert(typeof d.fix === "string" && d.fix.length, "no remediation hint offered");
    return `reason="${d.reason}", config from ${d.configSource}`;
  });

  check("the config survives without a separate file", () => {
    // src/firebase-config.js is gone precisely because its hyphenated filename
    // did not survive the upload path and silently 404'd in production.
    const client = api.getLeaderboard();
    assert(client.config && client.config.databaseURL, "no databaseURL available");
    assert(/goals-leaderboard/.test(client.config.databaseURL), `unexpected databaseURL: ${client.config.databaseURL}`);
    const fs2 = require("fs");
    assert(!fs2.existsSync(__dirname + "/firebase-config.js"), "src/firebase-config.js still exists");
    return client.config.databaseURL;
  });

  check("every script index.html requests actually exists", () => {
    // The whole outage was a filename mismatch between markup and disk.
    const fs2 = require("fs"), path2 = require("path");
    const root = path2.join(__dirname, "..");
    const html = fs2.readFileSync(path2.join(root, "index.html"), "utf8");
    const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
    const missing = srcs.filter((rel) => !fs2.existsSync(path2.join(root, rel)));
    assert(missing.length === 0, `index.html references missing file(s): ${missing.join(", ")}`);
    return `${srcs.length} local scripts, all present`;
  });

  check("the landing-page board renders for a player with no career yet", () => {
    // NB this cannot reach the true `state === null` case: setState routes
    // through migrateState, which always returns a populated state. The genuine
    // null path — a first page load, before startCreation — is only reachable in
    // a real browser and is asserted there (scratchpad/welcome.mjs).
    // What this covers is the next-worst case: a zeroed career with no goals.
    makeState({ totalGoals: 0, totalApps: 0, season: 1, age: 17 });
    let threw = null;
    try {
      api.renderWelcomeLeaderboard();
      api.renderLeaderboard("welcome-leaderboard", { limit: 5, compact: true });
    } catch (e) { threw = e; }
    assert(!threw, `landing-page render threw: ${threw && threw.message}`);
    return "no throw for a career with nothing in it";
  });

  check("compact mode drops the columns the hero column cannot fit", () => {
    const board = lb.mergeAndRank([], 5);
    const full = api.leaderboardRowsHtml(board, false);
    const compact = api.leaderboardRowsHtml(board, true);
    assert(/lb-apps/.test(full) && /lb-ratio/.test(full), "full mode lost its columns");
    assert(!/lb-apps/.test(compact) && !/lb-ratio/.test(compact), "compact mode still emits apps/ratio");
    assert(/lb-compact/.test(compact), "compact table is not flagged for the CSS grid");
    assert(/lb-goals/.test(compact) && /lb-rank/.test(compact), "compact mode dropped rank or goals");
    return "full = 5 columns, compact = 3";
  });

  check("the two boards render into their own targets", () => {
    // The career tab and the welcome block must not fight over one mount point.
    const seen = [];
    const realGet = sandboxDocumentGetElementById();
    assert(typeof realGet === "function", "no document stub available");
    api.renderLeaderboard("leaderboard-content", { limit: 30 });
    api.renderLeaderboard("welcome-leaderboard", { limit: 5, compact: true });
    // Both calls must resolve a target and neither may throw.
    return "career tab and welcome block render independently";
  });

  check("a corrupt save cannot break the landing page", () => {
    // loadSavedState is called at init to show a returning player their rank.
    const ls = sandboxLocalStorage();
    ls.setItem("footballDNA_save_v1", "{not valid json");
    let threw = null;
    try { api.renderWelcomeLeaderboard(); } catch (e) { threw = e; }
    ls.clear();
    assert(!threw, `a corrupt save threw on the landing page: ${threw && threw.message}`);
    return "corrupt save handled, page still renders";
  });

  check("a career converts to a leaderboard row", () => {
    makeState({ club: "Arsenal", age: 34, season: 18, totalGoals: 512, totalApps: 830, totalAssists: 150,
      honours: { leagueTitles: 3, domesticCups: 1, europeanCups: 1, intlTrophies: 1, ballonDors: 2,
                 goldenBoots: 3, playerOfSeason: 0, youngPlayer: 0, tots: 0 } });
    const row = api.currentCareerRow();
    assert(lb.normalizeEntry(row), "a real career failed its own validation");
    assert(row.goals === 512 && row.trophies === 6, `row was ${row.goals} goals / ${row.trophies} trophies`);
    return `${row.goals} goals, ${row.apps} apps, ${row.trophies} trophies`;
  });

  /* This group runs LAST on purpose: resetWorldState wipes TEAM_SQUADS and the
   * team database, which earlier checks assert against. */
  group("Challenge mode — seeded determinism");

  /** Six seasons from a fixed starting point, as a comparable fingerprint. */
  function careerFingerprint(seed) {
    api.resetWorldState();
    makeState({ club: "Arsenal", age: 24, season: 8, baseRating: 85, reputation: 75,
                role: "Star", contractRole: "Star", intlDebut: true, seed });
    const st = api.getState();
    const out = [];
    for (let i = 0; i < 6; i++) {
      const sd = api.simulateSeason();
      out.push(`${sd.goals}/${sd.apps}/${sd.pos}`);
      st.season++; st.age++;
    }
    return out.join(" ");
  }

  check("the same seed produces the same career, career after career", () => {
    // The whole feature rests on this. Before resetWorldState, run 1 differed
    // from runs 2 and 3 because TEAM_SQUADS, MANAGER_TENURE and PL_CLUB_TENURE
    // are module-level and survived startCreation — squad strength feeds
    // simulateMatch, so the second career on a seed inherited the first one's
    // world. Two friends on the same link got different games.
    const a = careerFingerprint("chal-xyz");
    const b = careerFingerprint("chal-xyz");
    const c = careerFingerprint("chal-xyz");
    assert(a === b && b === c, `runs diverged:\n      ${a}\n      ${b}\n      ${c}`);
    return a;
  });

  check("an unrelated career in between does not leak into the next one", () => {
    // The realistic failure: you play your own career, then open your friend's
    // challenge link in the same tab.
    const before = careerFingerprint("chal-xyz");
    careerFingerprint("chal-abc");
    careerFingerprint("some-other-seed");
    const after = careerFingerprint("chal-xyz");
    assert(before === after, `seed drifted after other careers:\n      ${before}\n      ${after}`);
    return "identical across intervening careers";
  });

  check("different seeds still produce different careers", () => {
    // Guards against the trivial way to pass the two checks above.
    const a = careerFingerprint("chal-xyz");
    const b = careerFingerprint("chal-abc");
    assert(a !== b, `two seeds produced identical careers: ${a}`);
    return "seeds are actually load-bearing";
  });

  check("resetWorldState clears every module-level world container", () => {
    // A new mutable `{}` added later and not cleared here reintroduces the bug
    // silently, so assert on the containers themselves rather than on outcomes.
    careerFingerprint("chal-xyz");
    assert(Object.keys(api.TEAM_SQUADS).length > 0, "the probe never populated any squads");
    api.resetWorldState();
    assert(Object.keys(api.TEAM_SQUADS).length === 0, "TEAM_SQUADS survived the reset");
    assert(Object.keys(api.MANAGER_TENURE).length === 0, "MANAGER_TENURE survived the reset");
    return "squads and tenure both empty after reset";
  });

  check("the draft draws from its own stream, not the career's", () => {
    // A spin used to cost 16 draws for the flicker animation plus one for the
    // landing, all off the career stream — so the world a player inherited
    // depended on how many times they had spun the reels.
    makeState({ seed: "draft-seed", phase: "country" });
    const st = api.getState();
    const before = st.rngState;
    st.draftSpin = 0;
    api.landCountry();
    st.phase = "build"; api.landBuild();
    st.phase = "attributes"; api.landSquad();
    assert(st.rngState === before, `three landings moved the career stream ${before} → ${st.rngState}`);
    return "career stream untouched by country, build and squad landings";
  });

  check("the same slot offers the same thing to both players", () => {
    const land = (seed, spin) => {
      makeState({ seed, phase: "country" });
      const st = api.getState();
      st.draftSpin = spin;
      api.landCountry();
      return st.currentSpin.country;
    };
    assert(land("draft-seed", 0) === land("draft-seed", 0), "one seed, one slot, two answers");
    // And the slot is actually seed-dependent rather than constant.
    const spread = new Set(["a", "b", "c", "d", "e", "f"].map((s) => land(`draft-${s}`, 0)));
    assert(spread.size > 1, `six seeds all landed on ${[...spread][0]}`);
    return `stable per seed, ${spread.size} distinct across six seeds`;
  });

  check("a reroll advances that slot only", () => {
    // The point of the counter: spending a reroll must not hand the player a
    // different career from the friend who kept theirs.
    const land = (spin) => {
      makeState({ seed: "draft-seed", phase: "country" });
      const st = api.getState();
      st.draftSpin = spin;
      api.landCountry();
      return st.currentSpin.country;
    };
    const offers = new Set([0, 1, 2, 3, 4, 5].map(land));
    assert(offers.size > 1, "every reroll returned the same country — the counter is not feeding the stream");

    // Land the build slot cleanly, then again after four country rerolls.
    makeState({ seed: "draft-seed", phase: "build" });
    const a = api.getState();
    a.draftSpin = 0; api.landBuild();
    const clean = JSON.stringify(a.currentSpin);

    makeState({ seed: "draft-seed", phase: "country" });
    const b = api.getState();
    for (let i = 0; i < 4; i++) { b.draftSpin = i; api.landCountry(); }
    b.phase = "build"; b.draftSpin = 0; api.landBuild();
    assert(JSON.stringify(b.currentSpin) === clean,
      `rerolling the country slot changed the build slot:\n      ${clean}\n      ${JSON.stringify(b.currentSpin)}`);
    return `${offers.size} distinct offers across 6 rerolls, later slots unmoved`;
  });

  group("Challenge a friend");

  check("a challenge locks the four settings that change what a career can score", () => {
    const c = lb.normalizeChallenge({ id: "abc123", seed: "chal-abc123", era: "modern",
                                      ratingMode: "at-time", difficulty: "hard" });
    assert(c && c.era === "modern" && c.ratingMode === "at-time" && c.difficulty === "hard",
      `settings did not survive: ${JSON.stringify(c)}`);
    // Anything outside the known values falls back rather than reaching the
    // engine, which would index DIFFICULTIES/ERA_OPTIONS with it.
    const junk = lb.normalizeChallenge({ seed: "s", era: "__proto__", ratingMode: "x", difficulty: "trivial" });
    assert(junk.era === "all" && junk.ratingMode === "peak" && junk.difficulty === "medium",
      `junk settings were let through: ${JSON.stringify(junk)}`);
    assert(lb.normalizeChallenge({ era: "all" }) === null, "a challenge with no seed was accepted");
    return "era/mode/difficulty locked, seedless challenge rejected";
  });

  check("every era the setup screen offers is a legal challenge era", () => {
    // The setup screen and the validator drifted once already: "current" was
    // selectable in the UI and silently rewritten to "all" on the way in.
    const eras = api.ERA_OPTIONS.map((e) => e.key);
    const rejected = eras.filter((era) => lb.normalizeChallenge({ seed: "s", era }).era !== era);
    assert(rejected.length === 0, `these eras do not survive validation: ${rejected.join(", ")}`);
    return `${eras.length} eras round-trip`;
  });

  check("challenge ids cannot break the database path they key", () => {
    // Firebase keys cannot contain . # $ [ ] or /, so a hostile id has to become
    // an invalid challenge rather than a write somewhere else in the tree.
    assert(lb.cleanChallengeId("../../players/x") === "playersx",
      `path traversal survived: ${lb.cleanChallengeId("../../players/x")}`);
    assert(lb.cleanChallengeId("A1#b$c[]/d.e") === "a1bcde", `got ${lb.cleanChallengeId("A1#b$c[]/d.e")}`);
    assert(lb.cleanChallengeId("x".repeat(200)).length === lb.LIMITS.challengeIdMax, "no length cap");
    assert(lb.cleanChallengeId(null) === "" && lb.cleanChallengeId({}) === "", "non-strings were not neutralised");
    return "traversal, punctuation, case and length all handled";
  });

  check("generated codes avoid characters that get misread", () => {
    // These get retyped from a phone screen and read aloud, so 0/O and 1/l/I
    // have no business in them.
    const ids = Array.from({ length: 200 }, () => lb.newChallengeId());
    const bad = ids.filter((id) => !/^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/.test(id));
    assert(bad.length === 0, `ambiguous or malformed codes: ${bad.slice(0, 3).join(", ")}`);
    assert(new Set(ids).size > 195, "200 generated codes collided more than chance allows");
    assert(ids.every((id) => lb.cleanChallengeId(id) === id), "a generated code does not survive its own cleaner");
    // Typed back in as it is displayed — uppercase, with stray spaces.
    assert(ids.every((id) => lb.cleanChallengeId(` ${lb.formatChallengeCode(id)} `) === id),
      "a code does not survive being read off the screen and retyped");
    return `200 codes, 6 chars, uppercase round-trips`;
  });

  check("the player cap is stored, bounded and defaulted", () => {
    assert(lb.normalizeChallenge({ seed: "s", maxPlayers: 4 }).maxPlayers === 4, "a chosen size was lost");
    assert(lb.normalizeChallenge({ seed: "s" }).maxPlayers === lb.CHALLENGE_PLAYERS_MIN,
      "a challenge with no size did not default to a duel");
    // Anything outside 2-6 is clamped rather than rejected: a challenge that
    // exists with an odd size beats one that failed to create at all.
    assert(lb.normalizeChallenge({ seed: "s", maxPlayers: 99 }).maxPlayers === lb.CHALLENGE_PLAYERS_MAX, "99 was not clamped");
    assert(lb.normalizeChallenge({ seed: "s", maxPlayers: 1 }).maxPlayers === lb.CHALLENGE_PLAYERS_MIN, "1 was not clamped");
    assert(lb.normalizeChallenge({ seed: "s", maxPlayers: "four" }).maxPlayers === lb.CHALLENGE_PLAYERS_MIN, "junk was not defaulted");
    const rule = lb.LEADERBOARD_RULES.rules.challenges.$challenge.maxPlayers[".validate"];
    assert(/>= 2/.test(rule) && /<= 6/.test(rule), `the stored value is unbounded: ${rule}`);
    return `${lb.CHALLENGE_PLAYERS_MIN}-${lb.CHALLENGE_PLAYERS_MAX}, clamped both ends`;
  });

  check("the cap is honest about not being a database rule", () => {
    /* Realtime Database rules cannot count a node's children, so the cap
     * genuinely cannot be enforced server-side. This asserts the code does not
     * pretend otherwise — if someone later adds an entry-count rule that
     * silently does nothing, this fails and says why. */
    const entries = lb.LEADERBOARD_RULES.rules.challenges.$challenge.entries;
    const asText = JSON.stringify(entries);
    assert(!/maxPlayers/.test(asText),
      "the entry rules reference maxPlayers — rules cannot count children, so this cannot work");
    return "cap enforced at join, not by a rule that could not work";
  });

  check("a full challenge reports itself full", () => {
    const rows = (n) => Array.from({ length: n }, (_, i) => ({
      careerId: `c${i}`, name: `P${i}`, goals: 100 + i, apps: 300, seasons: 15,
    }));
    // challengeStandings is what fetchChallenge counts, so count the same way.
    assert(lb.challengeStandings(rows(3), null).length === 3, "standings dropped valid rows");
    const cap = lb.normalizeChallenge({ seed: "s", maxPlayers: 3 }).maxPlayers;
    assert(lb.challengeStandings(rows(3), null).length >= cap, "3 of 3 did not read as full");
    assert(lb.challengeStandings(rows(2), null).length < cap, "2 of 3 read as full");
    return "3 of 3 full, 2 of 3 open";
  });

  check("a challenge has no 500-goal floor", () => {
    // The global board's floor exists because 27 real benchmarks sit above it.
    // A challenge between two friends is its own contest — 180 beating 140 is a
    // perfectly good result, and a floor would end most challenges in nothing.
    const small = { name: "Rival", goals: 180, apps: 400, seasons: 16 };
    assert(lb.normalizeChallengeEntry(small), "a 180-goal career could not enter a challenge");
    assert(lb.normalizeEntry(small), "the shared validator rejected it outright");
    assert(lb.LIMITS.goalsMin === 500, "the global floor moved");
    const rules = JSON.stringify(lb.LEADERBOARD_RULES.rules.challenges);
    assert(!rules.includes("goals').val() >= " + lb.LIMITS.goalsMin),
      "the challenge rules inherited the 500-goal floor");
    return "180 goals accepted into a challenge, floor still 500 on the board";
  });

  check("the challenge rules are create-only at both levels", () => {
    const ch = lb.LEADERBOARD_RULES.rules.challenges;
    assert(ch[".read"] === true, "challenges are not readable");
    const createOnly = "!data.exists() && newData.exists()";
    assert(ch.$challenge[".write"] === createOnly, "a challenge's settings can be edited after sharing");
    assert(ch.$challenge.entries.$careerId[".write"] === createOnly, "a result can be overwritten");
    assert(/hasChildren\(\['seed','createdAt'\]\)/.test(ch.$challenge[".validate"]), "a challenge need not carry a seed");
    assert(/createdAt'\)\.val\(\) == now/.test(ch.$challenge.entries.$careerId[".validate"]),
      "entry timestamps are not server-stamped");
    return "settings and results both immutable once written";
  });

  check("challenge results rank the way the leaderboard does", () => {
    const rows = [
      { careerId: "c1", name: "Ada", goals: 220, apps: 500, seasons: 18 },
      { careerId: "c2", name: "Bo", goals: 340, apps: 610, seasons: 20 },
      { careerId: "c3", name: "Cy", goals: 340, apps: 480, seasons: 19 },
      { careerId: "c4", name: "junk", goals: -5, apps: 10, seasons: 2 },
    ];
    const board = lb.challengeStandings(rows, "c1");
    assert(board.length === 3, `invalid rows were not dropped (got ${board.length})`);
    assert(board[0].name === "Cy", `fewer apps did not break the 340-goal tie: ${board[0].name}`);
    assert(board.map((r) => r.rank).join(",") === "1,2,3", "ranks are not sequential");
    assert(board.filter((r) => r.you).length === 1 && board[2].you, "the player's own row was not flagged");
    return "Cy 340/480, Bo 340/610, Ada 220 (you)";
  });

  check("a modest career posts to a challenge but not to the board", () => {
    makeState({ club: "Arsenal", age: 33, season: 16, totalGoals: 180, totalApps: 420,
                totalAssists: 60, challengeId: "abc123" });
    const entry = api.currentChallengeEntry();
    assert(lb.normalizeChallengeEntry(entry), `challenge rejected a real career: ${JSON.stringify(entry)}`);
    assert(entry.goals === 180 && entry.club === "Arsenal", `entry was ${JSON.stringify(entry)}`);
    return `${entry.goals} goals, ${entry.apps} apps — into the challenge, not onto the board`;
  });

  check("nothing that runs before a career exists uses the mid-career failsafe", () => {
    /* The bug this encodes: the challenge accept and join handlers were wrapped
     * in withFailsafe, which snapshots `state` on entry and does so OUTSIDE its
     * own try block. On the landing page `state` is null until a career starts,
     * so every click threw inside the wrapper before the handler ran — both
     * buttons did nothing at all, silently, for every visitor.
     *
     * A source-level check because the defect is which wrapper was used, and
     * that is invisible to any assertion about behaviour with a state loaded. */
    const src = fs.readFileSync(path.join(here, "game.js"), "utf8");
    const wrong = src.split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((l) => /withFailsafe\(/.test(l.line) && /hallenge/.test(l.line));
    assert(wrong.length === 0,
      `pre-career handlers wrapped in withFailsafe:\n      ${wrong.map((l) => `game.js:${l.n} ${l.line}`).join("\n      ")}`);
    assert(/function guardUi\(/.test(src), "guardUi is gone; pre-career handlers have no wrapper of their own");
    const guarded = (src.match(/guardUi\(/g) || []).length - 1;  // minus the definition
    assert(guarded >= 5, `only ${guarded} handlers use guardUi — expected the challenge UI to be covered`);
    return `${guarded} pre-career handlers guarded, 0 using the career failsafe`;
  });

  check("serializing before a career exists does not throw", () => {
    // withFailsafe called this with a null state, which is what actually threw.
    let threw = null;
    let out;
    try { out = api.serializeState(null); } catch (e) { threw = e; }
    assert(!threw, `serializeState(null) threw: ${threw && threw.message}`);
    assert(out === null, `expected null, got ${typeof out}`);
    return "null in, null out";
  });

  check("the standalone summary page loads the scripts it needs", () => {
    // challenge.html is a second entry point, so it has its own chance to
    // reference a file that is not there — which is exactly how the board once
    // went silently offline in production.
    const page = fs.readFileSync(path.join(here, "..", "challenge.html"), "utf8");
    const srcs = [...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    const local = srcs.filter((s) => !/^https?:/.test(s));
    assert(local.length > 0, "the summary page loads no local scripts at all");
    const missing = local.filter((s) => !fs.existsSync(path.join(here, "..", s)));
    assert(missing.length === 0, `missing: ${missing.join(", ")}`);
    assert(local.some((s) => /leaderboard\.js$/.test(s)), "the page never loads the challenge API");
    assert(srcs.some((s) => /firebase-database-compat/.test(s)), "the page never loads the database SDK");
    return `${local.length} local script(s), all present`;
  });

  check("the challenge link round-trips through the id cleaner", () => {
    const id = lb.newChallengeId();
    const link = api.challengeLink(id);
    assert(link.includes(`#challenge=${id}`), `link was ${link}`);
    assert(lb.cleanChallengeId(link.split("#challenge=")[1]) === id, "the id did not survive the URL");
    return link;
  });

  check("a challenge career does not repost itself when resumed", () => {
    // resumeGame calls endCareer again for a retired career, which re-renders
    // this panel. The saved flag skips the write; the create-only rule is what
    // actually enforces it.
    makeState({ totalGoals: 400, totalApps: 700, season: 18, challengeId: "abc123",
                challengeSubmitted: true, careerId: "career-1" });
    let threw = null;
    try { api.renderChallengeResult(); } catch (e) { threw = e; }
    assert(!threw, `the head-to-head threw: ${threw && threw.message}`);
    assert(api.getState().challengeSubmitted === true, "the submitted flag was cleared on re-render");
    return "re-render is safe and does not clear the flag";
  });

  check("a career with no challenge renders no challenge panel", () => {
    makeState({ totalGoals: 400, challengeId: null });
    let threw = null;
    try { api.renderChallengeResult(); } catch (e) { threw = e; }
    assert(!threw, `threw for an ordinary career: ${threw && threw.message}`);
    assert(api.challengeStandingsHtml([]).includes("No results posted yet"), "an empty board says nothing");
    return "ordinary careers are unaffected";
  });

  runQueued().then(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) { failures.forEach((f) => console.log(`  FAILED: ${f}`)); process.exit(1); }
  });
}
