const fs = require('fs');
const vm = require('vm');

const dataCode = fs.readFileSync('./data.js', 'utf8');
const careerEventDataCode = fs.readFileSync('./career_event_data.js', 'utf8');
const gameCode = fs.readFileSync('./game.js', 'utf8');
const html = fs.readFileSync('./index.html', 'utf8');
const elements = {};
function makeEl(id) {
  return {
    id, className: '', style: {}, textContent: '', innerHTML: '', value: '', disabled: false,
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return makeEl('q'); },
    insertBefore() {}, appendChild() {}, select() {},
  };
}
const document = {
  readyState: 'complete', addEventListener() {},
  querySelectorAll() { return []; },
  querySelector(sel) { return sel.startsWith('#') ? this.getElementById(sel.slice(1)) : makeEl(sel); },
  createElement(tag) { return makeEl(tag); },
  getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
};
[...html.matchAll(/id="([^"]+)"/g)].forEach((m) => { elements[m[1]] = makeEl(m[1]); });
const localStore = {};
const localStorage = { getItem(k) { return localStore[k] || null; }, setItem(k, v) { localStore[k] = String(v); }, removeItem(k) { delete localStore[k]; } };
const window = { document, addEventListener() {}, scrollTo() {}, localStorage };
const ctx = { window, document, console, Math, Date, JSON, setTimeout, clearTimeout, setInterval: () => {}, clearInterval: () => {}, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, requestAnimationFrame: (fn) => fn(), localStorage };
vm.createContext(ctx);
vm.runInContext(dataCode, ctx);
vm.runInContext(careerEventDataCode, ctx);
vm.runInContext(gameCode, ctx);
const g = ctx.window.__STRESS_TEST__;
function assert(ok, msg) { if (!ok) throw new Error(msg); }
const setTag = '[object Set]';
function isSetLike(v) { return v && typeof v === 'object' && Object.prototype.toString.call(v) === setTag && typeof v.has === 'function'; }

(function testSeededRngReplay() {
  g.startCreation('easy');
  g.setSeed('regression-seed');
  const s1 = g.getState();
  const firstState = s1.rngState;
  const serialized = g.serializeState(s1);
  const loaded = g.deserializeState(serialized);
  assert(loaded.seed === 'regression-seed', 'seed should persist through save/load');
  assert(loaded.rngState === firstState, 'rngState should persist through save/load');
  console.log('Regression passed: seeded RNG persists');
})();

(function testLegacySaveMigration() {
  const legacy = { state: { difficulty: 'hard', clubsPlayed: ['Arsenal FC'], contractYears: -3, player: { name: 'Legacy', slots: {} }, pillars: { Ambition: 70 } } };
  const migrated = g.deserializeState(JSON.stringify(legacy));
  assert(migrated.difficulty === 'hard', 'migration should preserve scalar state');
  assert(isSetLike(migrated.clubsPlayed), 'migration should restore clubsPlayed Set');
  assert(migrated.clubsPlayed.has('Arsenal FC'), 'migration should preserve clubsPlayed values');
  assert(migrated.contractYears === 0, 'migration should clamp negative contracts');
  assert(migrated.pillars.Ambition === 70, 'migration should preserve nested pillars');
  assert(migrated.pillars.Loyalty === 50, 'migration should fill missing nested pillars');
  assert(migrated.seed && migrated.rngState != null, 'migration should add seed fields');
  console.log('Regression passed: legacy saves migrate safely');
})();

(function testSetStateNormalizesContract() {
  g.startCreation('easy');
  g.setSeed('regression-contract');
  g.setState({ contractYears: 'bad', player: { slots: {}, usedDonors: [] }, clubsPlayed: [] });
  const s = g.getState();
  assert(s.contractYears === 0, 'setState should normalize invalid contractYears');
  g.normalizeContractState({ contractYears: -99, role: 'Starter' });
  console.log('Regression passed: contract state normalization available');
})();

(function testSeededRngDeterministic() {
  g.startCreation('easy');
  g.setSeed('deterministic-check');
  const snap = g.getState().rngState;
  const r1 = [];
  for (let i = 0; i < 5; i++) {
    g.setState({ ...g.getState(), rngState: g.getState().rngState });
  }
  r1.push(g.getState().rngState);
  const saved = g.serializeState(g.getState());
  const loaded = g.deserializeState(saved);
  g.setState(loaded);
  assert(g.getState().rngState === r1[0], 'seeded RNG state should persist through save/load');
  console.log('Regression passed: seeded RNG is deterministic across save/load');
})();

(function testEffectsNoDoubleWealthFame() {
  g.startCreation('easy');
  g.setSeed('effects-check');
  g.setState({ contractYears: 2, wealth: 0, fame: 0, player: { slots: {}, usedDonors: [] }, clubsPlayed: [] });
  g.applyEffectsRaw({ wealth: 10, fame: 15, contract: -5 });
  const s = g.getState();
  assert(s.wealth === 10, 'wealth should be applied once, not doubled');
  assert(s.fame === 15, 'fame should be applied once, not doubled');
  assert(s.contractYears === 0, 'contract years should clamp at 0');
  console.log('Regression passed: effect de-duplication and contract clamping');
})();

(function testInvalidSaveFallsBack() {
  const fallback = g.deserializeState('null');
  assert(fallback && typeof fallback === 'object', 'deserializeState should return a valid state for non-object JSON');
  assert(fallback.contractYears === 0, 'fallback state should have normalized contract');
  console.log('Regression passed: invalid save JSON falls back safely');
})();

(function testForcedDestinationsAgedLocked() {
  g.startCreation('easy');
  g.setSeed('forced-dest-check');
  // Star player at an elite club aged 28 should receive NO forced MLS/Saudi/Championship offers.
  g.setState({ age: 28, reputation: 80, role: 'Star', club: 'Manchester United', contractYears: 3, yearsAtClub: 3, clubsPlayed: [] });
  const sd = { perfTier: 'Met Expectation', trajectory: 'Mid-table' };
  const offers = g.generateForcedDestinationOffers(sd);
  assert(offers.length === 0, 'elite star under 33 should not get forced destination offers');
  // Same player at 34 should be eligible for an offer (if reputation allows).
  g.setState({ age: 34, reputation: 80, role: 'Star', club: 'Manchester United', contractYears: 1, yearsAtClub: 3, clubsPlayed: [] });
  const offers2 = g.generateForcedDestinationOffers(sd);
  assert(offers2.length > 0, 'aging star 33+ should receive forced destination offers');
  console.log('Regression passed: forced destinations are age-locked to 33+');
})();

(function testInternationalRetirementStopsCaps() {
  g.startCreation('easy');
  g.setSeed('intl-retire-check');
  g.setState({ age: 33, reputation: 80, intlDebut: true, intlCaps: 50, intlGoals: 20, intlRetired: true, country: 'England', player: { origin: g.TEAM_DATABASE ? undefined : undefined }, clubsPlayed: [] });
  const capsBefore = g.getState().intlCaps;
  const result = g.simulateInternational();
  assert(result === null, 'simulateInternational should return null after retirement');
  assert(g.getState().intlCaps === capsBefore, 'no caps should be awarded after international retirement');
  console.log('Regression passed: international retirement stops caps');
})();
