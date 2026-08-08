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
  return new Proxy({}, {
    get(_t, k) {
      if (k === "canvas") return makeElement();
      if (k === "measureText") return () => ({ width: 0 });
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
  location: { href: "http://localhost/", search: "", hash: "" },
  history: { pushState() {}, replaceState() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

/* ------------------------------ LOAD GAME -------------------------------- */
const here = __dirname;
const ctx = vm.createContext(sandbox);
for (const f of ["data.js", "career_event_data.js", "career_share.js", "game.js"]) {
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

/* -------------------------------- RUNNER ---------------------------------- */
let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    const detail = fn();
    passed++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function group(title) { console.log(`\n${title}`); }

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

module.exports = { api, makeState, sampleSeason, check, assert, group, makeElement };

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

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach((f) => console.log(`  FAILED: ${f}`)); process.exit(1); }
}
