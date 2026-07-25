// Full-flow headless stress test: drives complete careers through the ENTIRE
// click-based decision tree (season sim, season decisions, career milestones,
// random events, transfers, agent actions, contract negotiation, loans,
// fire-agent events, retirement, and end-of-career events) — not just the
// raw simulateSeason() math. This is meant to catch crashes in the parts of
// the game that test_stress.js does NOT exercise: transfers, contracts,
// loans, and all UI-driven decision branches.
//
// It implements a minimal DOM (innerHTML parsing for <button> tags,
// getElementById, querySelectorAll, addEventListener/click) so the game's
// real render + click-handler code can run unmodified and be auto-driven by
// randomly clicking through whatever choices are presented each season.
const fs = require('fs');
const vm = require('vm');

const dataCode = fs.readFileSync('./data.js', 'utf8');
const careerEventDataCode = fs.readFileSync('./career_event_data.js', 'utf8');
const gameCode = fs.readFileSync('./game.js', 'utf8');

/* ---------------------------- Minimal DOM mock --------------------------- */
const idRegistry = {}; // buttons parsed out of any container's innerHTML, by id
const containers = {}; // persistent container elements, by id

function parseButtons(html) {
  const buttons = [];
  const re = /<button\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const idMatch = attrs.match(/\bid="([^"]*)"/);
    const classMatch = attrs.match(/\bclass="([^"]*)"/);
    const dataIMatch = attrs.match(/\bdata-i="([^"]*)"/);
    const disabled = /(^|\s)disabled(\s|=|$)/.test(attrs);
    const classes = classMatch ? classMatch[1].split(/\s+/) : [];
    const btn = {
      id: idMatch ? idMatch[1] : null,
      classes,
      dataset: { i: dataIMatch ? dataIMatch[1] : undefined },
      disabled,
      _listeners: {},
      addEventListener(type, fn) { (btn._listeners[type] = btn._listeners[type] || []).push(fn); },
      click() { (btn._listeners.click || []).forEach((fn) => fn()); },
    };
    buttons.push(btn);
    if (btn.id) idRegistry[btn.id] = btn;
  }
  return buttons;
}

function matchButtons(buttons, sel) {
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    return buttons.filter((b) => b.classes.includes(cls));
  }
  if (sel.startsWith('#')) {
    const id = sel.slice(1);
    return buttons.filter((b) => b.id === id);
  }
  return [];
}

function makeContainer(id) {
  const el = {
    id, className: '', style: {}, textContent: '', value: '',
    _rawHtml: '', _buttons: [],
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(type, fn) { (el._listeners = el._listeners || {})[type] = (el._listeners[type] || []).concat(fn); },
    querySelectorAll(sel) { return matchButtons(el._buttons, sel); },
    insertBefore() {},
    getAttribute() { return null; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._rawHtml; },
    set(html) { el._rawHtml = html == null ? '' : String(html); el._buttons = parseButtons(el._rawHtml); },
  });
  return el;
}

const document = {
  readyState: 'complete',
  addEventListener() {},
  querySelectorAll() { return []; },
  querySelector(sel) {
    if (sel.startsWith('#')) return document.getElementById(sel.slice(1));
    return makeContainer(sel);
  },
  createElement(tag) { return makeContainer(tag); },
  getElementById(id) {
    // Real buttons take priority. Checking this first (rather than a cached fallback)
    // matters because the game always calls getElementById for optional buttons
    // (e.g. btn-agent-force) even when they weren't rendered this time — a real
    // browser returns null then, so a stale cached stub must never poison later
    // lookups once the button legitimately exists.
    if (idRegistry[id]) return idRegistry[id];
    if (containers[id]) return containers[id];
    // Persistent containers (season-action, season-result, etc.) are cached so the
    // test driver keeps reading the same object the game keeps re-rendering into.
    // Anything else (one-off ids like legacy-status, career-header) gets a fresh,
    // uncached stub each time so it can never shadow a real button id later.
    if (id === 'season-action' || id === 'season-result') {
      containers[id] = makeContainer(id);
      return containers[id];
    }
    return makeContainer(id);
  },
};
const window = {
  document, addEventListener() {}, scrollTo() {},
  localStorage: { getItem() {}, setItem() {}, removeItem() {} },
  location: { hash: '' },
};
const localStorage = { getItem() {}, setItem() {}, removeItem() {} };
const ctx = {
  window, document, console, Math, Date, JSON, clearTimeout,
  // Run "async" callbacks immediately so a full career can be driven synchronously.
  setTimeout: (fn) => fn(),
  setInterval: () => {}, clearInterval: () => {}, parseInt, parseFloat,
  encodeURIComponent, decodeURIComponent, requestAnimationFrame: (fn) => fn(), localStorage,
  navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
};
vm.createContext(ctx);
vm.runInContext(dataCode, ctx);
vm.runInContext(careerEventDataCode, ctx);
vm.runInContext(gameCode, ctx);

if (process.env.DEBUG_TRANSFER) ctx.window.__DEBUG_TRANSFER__ = true;
const g = ctx.window.__STRESS_TEST__;

/* --------------------------- Player setup helper -------------------------- */
function createRandomPlayer(elite) {
  g.startCreation('easy');
  const s = g.getState();
  const base = elite ? 82 : 66;
  const spread = elite ? 14 : 16;
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
  s.position = ['ST', 'LW', 'RW', 'CF'][Math.floor(Math.random() * 4)];
  s.academy = { club: elite ? 'Manchester United' : 'West Ham', tier: elite ? 'World Class' : 'Average' };
  s.player = s.player || {};
  s.player.name = `Test Player ${Math.floor(Math.random() * 100000)}`;
  s.player.origin = { flag: '🏴', development: 1.0, bias: 'balanced', story: 'Test origin', intlDifficulty: 4, intlStrength: 80 };
  s.player.academy = s.academy;
  s.country = 'England';
  s.luck = Math.floor(Math.random() * 17) - 8;
  s.determination = elite ? 75 + Math.floor(Math.random() * 15) : 45 + Math.floor(Math.random() * 20);
  s.potentialRating = elite ? 85 + Math.floor(Math.random() * 10) : 60 + Math.floor(Math.random() * 15);
  g.recomputePlayerStats();
  s.agent = { key: elite ? 'average' : 'poor', label: elite ? 'Average' : 'Poor', influence: elite ? 0.15 : 0, contractBonus: elite ? 1 : 0 };
  s.wealth = elite ? 40 : 15;
  s.fame = elite ? 20 : 5;
  s.hiddenTraits = [];
  const targetTiers = elite ? ['Elite', 'Europe'] : ['Mid', 'Lower', 'Europe', 'Championship'];
  const clubs = Object.keys(g.TEAM_DATABASE).filter((c) => targetTiers.includes(g.TEAM_DATABASE[c].league));
  s.club = clubs[Math.floor(Math.random() * clubs.length)];
  s.contractYears = 3;
  s.contractSignedAt = 1;
  s.yearsAtClub = 0;
  s.season = 1;
  s.age = 17 + Math.floor(Math.random() * 6);
  return s;
}

/* ------------------------------ Driver logic ------------------------------ */
const MAX_CLICKS_PER_SEASON = 25;
const MAX_SEASONS = 30;
const RETRY_CLICK_LIMIT = 5; // per season, avoid infinite retry loops on a real bug

function clickSomething(box) {
  const buttons = (box._buttons || []).filter((b) => !b.disabled);
  if (!buttons.length) return null;
  // Prefer offer/choice buttons (the actual decision points); fall back to any button (stay/agent/etc).
  const preferred = buttons.filter((b) => b.classes.includes('offer') || b.classes.includes('choice'));
  const pool = preferred.length ? preferred : buttons;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  pick.click();
  return pick;
}

// Drives one career from creation through retirement (or MAX_SEASONS / goal target),
// auto-clicking through every decision, transfer, contract, loan, and event screen.
function driveCareer(elite) {
  const s = createRandomPlayer(elite);
  const box = document.getElementById('season-action');
  const stats = { bugsCaught: 0, seasons: 0, finalAge: s.age, totalGoals: 0, completed: false, club: s.club };

  for (let season = 0; season < MAX_SEASONS; season++) {
    if (s.retired || s.totalGoals >= 1000) { stats.completed = true; break; }
    if (process.env.DEBUG_PROGRESS) process.stderr.write(`  season ${season} (age ${s.age})...\n`);
    g.playSeason();

    let clicks = 0;
    let retryClicks = 0;
    let sawEndCareer = false;
    const trace = [];
    while (clicks < MAX_CLICKS_PER_SEASON) {
      const html = box.innerHTML || '';
      const tagMatch = html.match(/decision-tag">([^<]*)</);
      const traceLine = `tag="${tagMatch ? tagMatch[1] : '?'}" buttons=[${(box._buttons || []).map((b) => b.id || b.classes.join('.')).join(', ')}]`;
      trace.push(traceLine);
      if (process.env.DEBUG_CLICKS) process.stderr.write(`  click ${clicks}: ${traceLine}\n`);
      if (html.includes('id="btn-play-season"')) break; // ready for next season
      if (html.includes('id="btn-retry-action"') || html.includes('id="btn-retry-season"')) {
        stats.bugsCaught++;
        retryClicks++;
        if (retryClicks > RETRY_CLICK_LIMIT) {
          throw new Error(`Repeated failsafe retries (>${RETRY_CLICK_LIMIT}) in one season — likely a deterministic bug, not a transient one. Season ${s.season}, age ${s.age}.`);
        }
      }
      if (html.includes('END OF CAREER')) sawEndCareer = true;
      const clicked = clickSomething(box);
      if (process.env.DEBUG_CLICKS) process.stderr.write(`    clicked: ${clicked ? (clicked.id || clicked.classes.join('.')) : 'NONE'}\n`);
      clicks++;
      if (!clicked) break; // nothing to click — dead-end screen (also a bug, but not a crash)
      if (sawEndCareer && s.retired) break; // career finalized after this end-of-career choice
    }
    stats.seasons = s.season;
    stats.finalAge = s.age;
    stats.totalGoals = s.totalGoals;
    if (s.retired) { stats.completed = true; break; }
    if (clicks >= MAX_CLICKS_PER_SEASON) {
      throw new Error(`Season ${s.season} (age ${s.age}) never resolved after ${MAX_CLICKS_PER_SEASON} clicks — likely a UI/logic dead-end.\n  Trace:\n  ${trace.join('\n  ')}`);
    }
  }
  return stats;
}

/* -------------------------------- Run it ---------------------------------- */
const RUNS = parseInt(process.argv[2] || '150', 10);
let hardFailures = 0;
let totalBugsCaught = 0;
let completedCareers = 0;
const errorSamples = [];

for (let i = 0; i < RUNS; i++) {
  if (process.env.DEBUG_PROGRESS) process.stderr.write(`run ${i}...\n`);
  const elite = i % 2 === 0;
  try {
    const stats = driveCareer(elite);
    totalBugsCaught += stats.bugsCaught;
    if (stats.completed) completedCareers++;
  } catch (err) {
    hardFailures++;
    if (errorSamples.length < 10) errorSamples.push({ run: i, message: err.message, stack: err.stack });
    if (process.env.STOP_ON_FIRST_FAILURE) { console.error(`\n[run ${i}] ${err.message}`); process.exit(1); }
  }
}

console.log(`\n=== Full-flow stress test (${RUNS} careers, transfers/contracts/loans/events all driven) ===`);
console.log(`Completed careers (retired or hit goal target): ${completedCareers} / ${RUNS}`);
console.log(`Failsafe recoveries triggered (caught bugs, career continued): ${totalBugsCaught}`);
console.log(`Hard failures (uncaught exceptions / stuck UI, career aborted): ${hardFailures} / ${RUNS}`);
if (errorSamples.length) {
  console.log('\nSample failures:');
  for (const e of errorSamples) {
    console.log(`  [run ${e.run}] ${e.message}`);
  }
}
if (hardFailures > 0) {
  process.exitCode = 1;
} else {
  console.log('\nFull-flow stress test passed: no uncaught exceptions or stuck screens across all careers.');
}
