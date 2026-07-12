const fs = require('fs');
const vm = require('vm');

const dataCode = fs.readFileSync('./data.js', 'utf8');
const careerEventDataCode = fs.readFileSync('./career_event_data.js', 'utf8');
const gameCode = fs.readFileSync('./game.js', 'utf8');
const html = fs.readFileSync('./index.html', 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const elements = {};
function makeEl(id) {
  return {
    id, className: '', style: {}, textContent: '', innerHTML: '', value: '', disabled: false,
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return makeEl('q'); },
    insertBefore() {}, appendChild() {}, select() {},
  };
}
ids.forEach((id) => { elements[id] = makeEl(id); });
const document = {
  readyState: 'complete', addEventListener() {}, execCommand() {},
  querySelectorAll() { return []; },
  querySelector(sel) { if (sel.startsWith('#')) return elements[sel.slice(1)] || makeEl(sel); return makeEl(sel); },
  getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
  createElement(tag) { return makeEl(tag); },
};
const window = { document, addEventListener() {}, scrollTo() {}, localStorage: { getItem() {}, setItem() {}, removeItem() {} } };
const ctx = { window, document, console, Math, Date, JSON, setTimeout, clearTimeout, setInterval: () => {}, clearInterval: () => {}, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, requestAnimationFrame: (fn) => fn(), localStorage: window.localStorage };
vm.createContext(ctx);
vm.runInContext(dataCode, ctx);
vm.runInContext(careerEventDataCode, ctx);
vm.runInContext(gameCode, ctx);
const g = ctx.window.__STRESS_TEST__;
const db = ctx.window.GAME_DATA;

function assert(ok, msg) { if (!ok) throw new Error(msg); }
function avg(nums) { return nums.reduce((a, b) => a + b, 0) / Math.max(nums.length, 1); }

(function defenderFootAudit() {
  const caps = { GK: 62, CB: 72, FB: 76, DM: 76 };
  let high = 0, rows = 0;
  for (const squad of Object.values(db.PLAYER_DATABASE)) {
    for (const p of squad) {
      if (!caps[p.pos] || p.tier) continue;
      rows++;
      if (Math.max(p.leftFoot, p.rightFoot) > caps[p.pos]) high++;
    }
  }
  console.log(`Defender/deep foot audit: ${high}/${rows} above future cap in current data.js`);
})();

function seedPlayer(profile = 'star') {
  g.startCreation('easy');
  const s = g.getState();
  s.country = 'England';
  s.player.name = 'Stress Tester';
  s.player.origin = { flag: '🏴', development: 1, bias: 'balanced', story: 'Test', intlDifficulty: 3, intlStrength: 84 };
  const base = profile === 'star' ? 84 : 68;
  s.attrs = { heading: base, leftFoot: base, rightFoot: base - 4, speed: base, strength: base - 2, fitness: base, height: 182, weight: 76 };
  s.mentality = profile === 'star' ? 'Winner' : 'Balanced';
  s.mentalityRating = profile === 'star' ? 82 : 55;
  s.position = 'ST';
  s.academy = { club: 'Manchester United', tier: 'World Class' };
  s.player.academy = s.academy;
  s.luck = 0; s.determination = base; s.potentialRating = base;
  s.agent = { key: 'average', label: 'Average', influence: 0.18, contractBonus: 1 };
  s.wealth = 40; s.fame = 20; s.hiddenTraits = []; s.traitProgress = {};
  g.recomputePlayerStats();
  s.club = profile === 'star' ? 'Manchester United' : 'West Ham';
  s.contractYears = 2; s.contractRole = profile === 'star' ? 'Star' : 'Starter';
  return s;
}

(function contractStarProtection() {
  const s = seedPlayer('star');
  s.age = 35; s.reputation = 82; s.role = 'Star'; s.injuryProneSeasons = 0;
  const offer = g.computeClubContractOffer({ perfTier: 'Sensational' }, s.club);
  console.log(`Star contract protection: refused=${offer.refused}, years=${offer.years}, role=${offer.playtime}`);
  assert(!offer.refused, 'Star/sensational player should receive a club offer');
})();

(function forcedSaleGeneration() {
  const s = seedPlayer('star');
  s.age = 22; s.reputation = 72; s.role = 'Star'; s.club = 'Luton Town';
  const offers = g.generateOffers({ perfTier: 'Overperformed' });
  console.log(`Forced sale offer pool smoke: ${offers.length} offers`);
  assert(Array.isArray(offers), 'generateOffers should return an array');
})();

(function careerCohort() {
  const runs = Number(process.argv[2]) || 30;
  const totals = [];
  for (let i = 0; i < runs; i++) {
    const s = seedPlayer(i % 3 === 0 ? 'star' : 'average');
    s.contractYears = 5;
    let guard = 0;
    while (!s.retired && s.age < 38 && guard++ < 22) {
      const sd = g.simulateSeason();
      g.applySeasonalAttributeChanges(sd);
      s.age++; s.season++;
    }
    totals.push(s.totalGoals);
  }
  totals.sort((a, b) => a - b);
  console.log(`Career cohort ${runs}: avg=${avg(totals).toFixed(1)} med=${totals[Math.floor(runs / 2)]} max=${totals[totals.length - 1]} 1000s=${totals.filter((x) => x >= 1000).length}`);
})();

console.log('stress_balance complete');
