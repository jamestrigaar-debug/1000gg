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
vm.runInContext(dataCode, ctx);
vm.runInContext(gameCode, ctx);

const g = ctx.window.__STRESS_TEST__;
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
  s.luck = Math.floor(Math.random() * 17) - 8;
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

runCohort('Elite build, elite club', true);
runCohort('Average build, mid/lower club', false);
