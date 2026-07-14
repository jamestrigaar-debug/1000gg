// Headless stress test: simulate many careers and report goal totals.
const fs = require('fs');
const vm = require('vm');

const dataCode = fs.readFileSync('./data.js', 'utf8');
const gameCode = fs.readFileSync('./game.js', 'utf8');

const html = fs.readFileSync('./index.html', 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const elements = {};
function makeEl(id) {
  return {
    id, className: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    style: {}, textContent: '', innerHTML: '', _listeners: {}, _children: [],
    addEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).concat(fn); },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    insertBefore(child, ref) { this._children.unshift(child); },
  };
}
const document = {
  readyState: 'complete',
  addEventListener() {},
  querySelectorAll() { return []; },
  querySelector(sel) {
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (!elements[id]) elements[id] = makeEl(id);
      return elements[id];
    }
    return makeEl(sel);
  },
  createElement(tag) { return makeEl(tag); },
  getElementById(id) {
    if (!elements[id]) elements[id] = makeEl(id);
    return elements[id];
  },
};
const window = { document, addEventListener() {}, scrollTo() {}, localStorage: { getItem() {}, setItem() {}, removeItem() {} } };
const localStorage = { getItem() {}, setItem() {}, removeItem() {} };
const ctx = {
  window, document, console, Math, Date, JSON, setTimeout, clearTimeout,
  setInterval: () => {}, clearInterval: () => {}, parseInt, parseFloat,
  encodeURIComponent, decodeURIComponent, requestAnimationFrame: (fn) => setTimeout(fn, 0), localStorage
};
vm.createContext(ctx);
const careerEventDataCode = fs.readFileSync('./career_event_data.js', 'utf8');
vm.runInContext(dataCode, ctx);
vm.runInContext(careerEventDataCode, ctx);
vm.runInContext(gameCode, ctx);

const g = ctx.window.__STRESS_TEST__;

// Regression test: exercise the full player creation compile path
// with both short and long academy names. This catches missing utility
// functions (e.g. randBetween) that are only invoked during compilePlayer.
(function testCompilePlayer() {
  const db = ctx.window.GAME_DATA;
  const keys = Object.keys(db.PLAYER_DATABASE);
  const rand = () => Math.random();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const samplePlayer = (key) => pick(db.PLAYER_DATABASE[key]);

  const academies = [
    "Manchester United", "Arsenal FC", "Chelsea FC", "AFC Bournemouth",
    "Brighton and Hove Albion", "Wolverhampton Wanderers", "Leeds United",
    "Luton Town", "Wimbledon FC (- 2004)"
  ];
  const attrKeys = ["heading", "body", "leftFoot", "rightFoot", "speed", "mentality"];

  for (const academy of academies) {
    if (!db.CLUB_ACADEMY[academy]) continue;
    g.startCreation('easy');
    const s = g.getState();
    s.player.position = 'ST';
    s.player.build = { height: 180, weight: 75 };
    s.player.origin = { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', development: 1.0, bias: 'balanced', story: 'Test origin' };
    s.player.academy = { club: academy, tier: db.CLUB_ACADEMY[academy] };
    s.academy = { club: academy, tier: db.CLUB_ACADEMY[academy] };
    s.country = 'England';

    s.player.slots = {};
    s.player.usedDonors = [];
    attrKeys.forEach((key) => {
      const squadKey = pick(keys);
      const { team, year } = (() => {
        const m = squadKey.match(/^(.*) \((\d{4})\)$/);
        return m ? { team: m[1], year: parseInt(m[2], 10) } : { team: squadKey, year: 0 };
      })();
      const pl = samplePlayer(squadKey);
      const slot = { donor: pl.name, donorObj: pl, team, year };
      if (key === 'body') { slot.value = pl.fitness; slot.value2 = pl.strength; }
      else if (key === 'mentality') { slot.value = pl.mentality; slot.rating = pl.mentalityRating; }
      else slot.value = pl[key];
      s.player.slots[key] = slot;
      s.player.usedDonors.push(pl.name);
    });

    try {
      g.compilePlayer();
      console.log(`compilePlayer OK: ${academy} -> ${s.baseRating} ${s.playstyle}`);
    } catch (err) {
      console.error(`compilePlayer FAILED for ${academy}: ${err.message}`);
      throw err;
    }
  }
  console.log('Regression test passed: compilePlayer works for all academy name formats');
})();

(function testInternationalByCountry() {
  const origins = {
    England: { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', development: 1.0, bias: 'balanced', story: 'Test', intlDifficulty: 3, intlStrength: 84 },
    Brazil: { flag: '🇧🇷', development: 1.08, bias: 'flair', story: 'Test', intlDifficulty: 8, intlStrength: 89 },
    Argentina: { flag: '🇦🇷', development: 1.05, bias: 'clutch', story: 'Test', intlDifficulty: 8, intlStrength: 88 },
    'New Zealand': { flag: '🇳🇿', development: 1.03, bias: 'physical', story: 'Test', intlDifficulty: 1, intlStrength: 72 },
    'San Marino': { flag: '🇸🇲', development: 0.94, bias: 'workrate', story: 'Test', intlDifficulty: 10, intlStrength: 48 },
  };
  const results = [];
  for (const [country, origin] of Object.entries(origins)) {
    g.startCreation('easy');
    const s = g.getState();
    s.country = country;
    s.player.name = 'Test';
    s.player.origin = origin;
    s.reputation = 55;
    s.intlDebut = true;
    s.age = 25;
    s.season = 1;
    s.attrs = { heading: 80, leftFoot: 80, rightFoot: 75, speed: 80, strength: 75, fitness: 80, height: 180, weight: 75 };
    s.mentality = 'Determined'; s.mentalityRating = 60;
    s.position = 'ST';
    g.recomputePlayerStats();
    s.club = 'Manchester United';
    let totalGoals = 0, totalCaps = 0;
    for (let i = 0; i < 20; i++) {
      const intl = g.simulateInternational();
      if (intl) { totalGoals += intl.goals; totalCaps += intl.caps; }
    }
    results.push({ country, intlDifficulty: origin.intlDifficulty, totalGoals, totalCaps });
    console.log(`International 20 seasons ${country}: ${totalCaps} caps, ${totalGoals} goals (difficulty ${origin.intlDifficulty})`);
  }
  const nz = results.find((r) => r.country === 'New Zealand');
  const sm = results.find((r) => r.country === 'San Marino');
  if (nz.totalGoals <= sm.totalGoals) {
    throw new Error('New Zealand should score more international goals than San Marino');
  }
  console.log('Regression test passed: international caps/goals vary by national difficulty');
})();

(function testContractPlaytime() {
  const englandOrigin = { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', development: 1.0, bias: 'balanced', story: 'Test', intlDifficulty: 3, intlStrength: 84 };
  g.startCreation('easy');
  const s = g.getState();
  s.country = 'England';
  s.player.origin = englandOrigin;
  s.age = 35;
  s.reputation = 60;
  s.club = 'Manchester United';
  s.injuryProneSeasons = 0;
  s.contractRole = 'Starter';
  const sd = { perfTier: 'Average' };
  const offer = g.computeClubContractOffer(sd, 'Manchester United');
  console.log(`Contract offer at age 35: ${offer.years} years, ${offer.playtime}, risk ${offer.injuryRisk}, refused ${offer.refused}`);
  if (offer.years > 1) throw new Error('Age 35+ should only get 1-year contracts');
  if (!offer.playtime) throw new Error('Contract offer should include playtime');
  if (offer.injuryRisk == null) throw new Error('Contract offer should include injury risk');
  console.log('Regression test passed: contract offers include playtime and injury risk');
})();

(function testGoalTracking() {
  const englandOrigin = { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', development: 1.0, bias: 'balanced', story: 'Test', intlDifficulty: 3, intlStrength: 84 };
  g.startCreation('easy');
  const s = g.getState();
  s.country = 'England';
  s.player.origin = englandOrigin;
  s.age = 20;
  s.reputation = 50;
  s.club = 'Manchester United';
  s.contractRole = 'Starter';
  s.attrs = { heading: 85, leftFoot: 85, rightFoot: 80, speed: 85, strength: 80, fitness: 85, height: 180, weight: 75 };
  s.mentality = 'Winner'; s.mentalityRating = 80; s.position = 'ST';
  g.recomputePlayerStats();
  const before = { totalGoals: s.totalGoals, leagueGoals: s.leagueGoals, cupGoals: s.cupGoals, europeGoals: s.europeGoals };
  for (let i = 0; i < 5; i++) {
    g.simulateSeason();
  }
  const after = { totalGoals: s.totalGoals, leagueGoals: s.leagueGoals, cupGoals: s.cupGoals, europeGoals: s.europeGoals };
  console.log(`Goal tracking: total ${after.totalGoals} (league ${after.leagueGoals}, cup ${after.cupGoals}, euro ${after.europeGoals})`);
  if (after.totalGoals !== after.leagueGoals + after.cupGoals + after.europeGoals) {
    throw new Error('Total goals should equal league + cup + europe goals');
  }
  if (after.leagueGoals <= before.leagueGoals) throw new Error('League goals should increase');
  console.log('Regression test passed: goals tracked by league, cup, and europe');
})();

const GOAL_TARGET = 1000;
const MAX_AGE = 40;
const RUNS = 100;

function createRandomPlayer(elite) {
  g.startCreation('easy');
  const s = g.getState();
  const base = elite ? 82 : 66;
  const spread = elite ? 14 : 16;
  // directly set a striker attribute profile for stress testing
  s.attrs = {
    heading: base + Math.floor(Math.random() * spread),
    leftFoot: base + Math.floor(Math.random() * spread),
    rightFoot: base - 8 + Math.floor(Math.random() * spread),
    speed: base + Math.floor(Math.random() * spread),
    strength: base - 2 + Math.floor(Math.random() * spread),
    fitness: base + Math.floor(Math.random() * spread),
    height: 178 + Math.floor(Math.random() * 14),
    weight: 72 + Math.floor(Math.random() * 14),
  };
  s.mentality = elite ? 'Winner' : 'Determined';
  s.mentalityRating = elite ? 85 + Math.floor(Math.random() * 10) : 60 + Math.floor(Math.random() * 15);
  s.position = 'ST';
  s.academy = { club: elite ? 'Manchester United' : 'West Ham', tier: elite ? 'World Class' : 'Average' };
  s.player = s.player || {};
  s.player.origin = { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', development: 1.0, bias: 'balanced', story: 'Test origin' };
  s.player.academy = s.academy;
  s.luck = Math.floor(Math.random() * 17) - 8;
  s.determination = elite ? 75 + Math.floor(Math.random() * 15) : 45 + Math.floor(Math.random() * 20);
  s.potentialRating = elite ? 85 + Math.floor(Math.random() * 10) : 60 + Math.floor(Math.random() * 15);
  g.recomputePlayerStats();
  s.agent = { key: elite ? 'average' : 'poor', label: elite ? 'Average' : 'Poor', influence: elite ? 0.15 : 0, contractBonus: elite ? 1 : 0 };
  s.wealth = elite ? 40 : 15;
  s.fame = elite ? 20 : 5;
  s.hiddenTraits = [];
  return g.getState();
}

function simulateCareer(elite) {
  createRandomPlayer(elite);
  const s = g.getState();
  // assign to a club tier matching the player's level
  const targetTiers = elite ? ['Elite', 'Europe'] : ['Mid', 'Lower', 'Europe'];
  const clubs = g.LEAGUE_CLUBS.filter((c) => targetTiers.includes(g.TEAM_DATABASE[c].league));
  s.club = clubs[Math.floor(Math.random() * clubs.length)];
  s.contractYears = 5;
  s.contractSignedAt = 1;
  s.yearsAtClub = 0;

  const retirementAge = s.retirementAge || MAX_AGE;
  let seasons = 0;
  let extensions = 0;
  while (s.age < retirementAge && s.totalGoals < GOAL_TARGET) {
    const sd = g.simulateSeason();
    g.applySeasonalAttributeChanges(sd);
    s.age++;
    s.season++;
    seasons++;
    if (s.age >= retirementAge) break;
  }
  // Resolve end-of-career events (rare surges / extensions)
  while (s.totalGoals < GOAL_TARGET && extensions < 3) {
    const result = g.resolveEndOfCareerEvent();
    if (result.extended) {
      extensions++;
      // play the forced extra season(s)
      while (s.age < retirementAge && s.totalGoals < GOAL_TARGET) {
        const sd = g.simulateSeason();
        g.applySeasonalAttributeChanges(sd);
        s.age++;
        s.season++;
        seasons++;
        if (s.age >= retirementAge) break;
      }
    } else {
      break;
    }
  }
  return {
    totalGoals: s.totalGoals,
    seasons,
    finalAge: s.age,
    reachedGoal: s.totalGoals >= GOAL_TARGET,
    club: s.club,
    bestRating: s.bestRating,
    injuryProneness: s.injuryProneness,
    retirementAge: s.retirementAge,
  };
}

function runCohort(label, elite) {
  const results = [];
  for (let i = 0; i < RUNS; i++) {
    results.push(simulateCareer(elite));
  }
  const reached = results.filter((r) => r.reachedGoal).length;
  const totals = results.map((r) => r.totalGoals).sort((a, b) => a - b);
  const avg = totals.reduce((a, b) => a + b, 0) / RUNS;
  const max = totals[totals.length - 1];
  const min = totals[0];
  const median = totals[Math.floor(RUNS / 2)];
  const avgSeasons = results.reduce((a, r) => a + r.seasons, 0) / RUNS;
  console.log(`\n=== ${label} (${RUNS} careers) ===`);
  console.log(`Reached 1000 goals: ${reached} / ${RUNS} (${(reached / RUNS * 100).toFixed(1)}%)`);
  console.log(`Average goals: ${avg.toFixed(1)}`);
  console.log(`Median goals: ${median}`);
  console.log(`Min goals: ${min}`);
  console.log(`Max goals: ${max}`);
  console.log(`Average seasons: ${avgSeasons.toFixed(1)}`);
  console.log(`Top 5: ${totals.slice(-5).reverse().join(', ')}`);
  console.log(`Bottom 5: ${totals.slice(0, 5).join(', ')}`);
}

// Career Pillars removed; getPillar remains a neutral stub.
(function testCareerPillars() {
  createRandomPlayer(true);
  const s = g.getState();
  if (s.pillars != null) throw new Error('pillars should be removed from state');
  if (g.getPillar('Ambition') !== 50) throw new Error('getPillar should return 50 after removal');
  g.applyEffects({ pillars: { Durability: 12 } }, 1);
  if (g.getPillar('Durability') !== 50) throw new Error('pillar effects should be ignored after removal');
  console.log('Regression passed: pillars removed and getPillar is neutral');

  // Career milestones should be available in age ranges
  createRandomPlayer(true);
  const s3 = g.getState();
  s3.age = 20;
  const milestone = g.checkCareerMilestone();
  if (!milestone || !['young_path', 'prime_offer', 'reinvent', 'international_retirement', 'final_contract'].includes(milestone.id)) {
    throw new Error('career milestone not returned for age 20');
  }
  console.log('Regression test passed: career milestones fire at relevant ages');

  // Season decisions should be pickable
  createRandomPlayer(true);
  const s4 = g.getState();
  s4.age = 25;
  s4.reputation = 60;
  s4.intlCaps = 5;
  s4.yearsAtClub = 3;
  s4.role = 'Starter';
  s4.club = g.LEAGUE_CLUBS.filter((c) => g.TEAM_DATABASE[c].league === 'Elite')[0];
  s4.contractYears = 5;
  const sd = g.simulateSeason();
  // pickSeasonDecision requires the full context, so just verify the function exists and returns an object
  // We can build a minimal context through the simulateSeason result.
  const decision = g.pickSeasonDecision({ age: 25, role: 'Starter', yearsAtClub: 3, rep: 60, intlCaps: 5, perf: sd.perfTier, traj: 'Mid-table' });
  if (!decision) throw new Error('no season decision available for valid context');
  console.log('Regression test passed: end-of-season strategic decisions exist');

  // Forced destination offers (MLS/Saudi/Championship) should be available for aging players (33+)
  createRandomPlayer(true);
  const s5 = g.getState();
  s5.age = 34;
  s5.reputation = 45;
  s5.club = g.LEAGUE_CLUBS.filter((c) => g.TEAM_DATABASE[c].league === 'Elite')[0];
  s5.contractYears = 1;
  const sd5 = g.simulateSeason();
  const forced = g.generateForcedDestinationOffers(sd5);
  if (!forced.length) throw new Error('forced destination offers should be generated for an aging player');
  const leagues = forced.map((o) => g.TEAM_DATABASE[o.club].league);
  if (!leagues.some((l) => ['MLS', 'Saudi', 'Championship'].includes(l))) throw new Error('forced destination offers must include MLS, Saudi, or Championship');
  if (!forced.every((o) => o.wage > 0)) throw new Error('forced destination offers must include a wage');
  console.log('Regression test passed: forced MLS/Saudi/Championship offers generated for aging players');
})();

runCohort('Elite build, elite club', true);
runCohort('Average build, mid/lower club', false);
