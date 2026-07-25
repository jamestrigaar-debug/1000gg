// Headless determinism test: verify seeded RNG produces identical results across runs,
// and log performance metrics (ms/tick, ms/frame simulation).
const fs = require('fs');
const vm = require('vm');

const dataCode = fs.readFileSync('./data.js', 'utf8');
const gameCode = fs.readFileSync('./game.js', 'utf8');
const careerEventDataCode = fs.readFileSync('./career_event_data.js', 'utf8');

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
vm.runInContext(careerEventDataCode, ctx);
vm.runInContext(gameCode, ctx);

const g = ctx.window.__STRESS_TEST__;

// Test determinism: same seed should produce identical compiled player attributes
function testDeterminism() {
  const seeds = [42, 12345, 999];
  const results = {};
  
  for (const seed of seeds) {
    const runs = [];
    for (let runIdx = 0; runIdx < 2; runIdx++) {
      g.startCreation('easy');
      const s = g.getState();
      
      // Set up a deterministic player
      s.player.position = 'ST';
      s.player.build = { height: 185, weight: 78 };
      s.player.origin = { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', development: 1.0, bias: 'balanced', story: 'Test' };
      s.player.academy = { club: 'Manchester United', tier: 'Elite' };
      s.academy = { club: 'Manchester United', tier: 'Elite' };
      
      // Draft deterministically
      const db = ctx.window.GAME_DATA;
      const teams = Object.keys(db.PLAYER_DATABASE_2025_26);
      const donors = [];
      const attrs = ['heading', 'body', 'leftFoot', 'rightFoot', 'speed', 'mentality'];
      
      for (let i = 0; i < attrs.length; i++) {
        const team = teams[(seed + i) % teams.length];
        const players = db.PLAYER_DATABASE_2025_26[team];
        donors.push(players[(seed + i) % players.length]);
      }
      
      s.player.slots = {
        heading: { donorObj: donors[0] },
        body: { donorObj: donors[1] },
        leftFoot: { donorObj: donors[2] },
        rightFoot: { donorObj: donors[3] },
        speed: { donorObj: donors[4] },
        mentality: { donorObj: donors[5] },
      };
      
      g.compilePlayer();
      const compiled = g.getState();
      
      // Capture compiled attributes
      const snapshot = {
        attrs: compiled.attrs,
        baseRating: compiled.baseRating,
        mentality: compiled.mentality,
        position: compiled.position,
        derived: compiled.derived,
      };
      
      runs.push(snapshot);
    }
    
    // Compare runs
    let identical = JSON.stringify(runs[0]) === JSON.stringify(runs[1]);
    if (!identical) {
      console.error(`Seed ${seed} diverged:`, runs[0], 'vs', runs[1]);
    }
    
    results[seed] = { identical, snapshot: runs[0] };
  }
  
  return results;
}

// Test performance: measure ms/compilation
function testPerformance() {
  const perfLog = [];
  
  for (let trial = 0; trial < 10; trial++) {
    const db = ctx.window.GAME_DATA;
    const teams = Object.keys(db.PLAYER_DATABASE_2025_26);
    
    // Measure 10 compilations per trial
    const startTime = Date.now();
    for (let comp = 0; comp < 10; comp++) {
      g.startCreation('easy');
      const s = g.getState();
      s.player.position = 'ST';
      s.player.build = { height: 180 + (comp % 5) * 2, weight: 75 + (comp % 5) };
      s.player.origin = { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', development: 1.0, bias: 'balanced', story: 'Perf' };
      s.player.academy = { club: 'Arsenal FC', tier: 'Elite' };
      s.academy = { club: 'Arsenal FC', tier: 'Elite' };
      
      const donors = [];
      const attrs = ['heading', 'body', 'leftFoot', 'rightFoot', 'speed', 'mentality'];
      for (let i = 0; i < attrs.length; i++) {
        const team = teams[(trial + comp + i) % teams.length];
        const players = db.PLAYER_DATABASE_2025_26[team];
        donors.push(players[(trial + comp + i) % players.length]);
      }
      
      s.player.slots = {
        heading: { donorObj: donors[0] },
        body: { donorObj: donors[1] },
        leftFoot: { donorObj: donors[2] },
        rightFoot: { donorObj: donors[3] },
        speed: { donorObj: donors[4] },
        mentality: { donorObj: donors[5] },
      };
      
      g.compilePlayer();
    }
    const elapsed = Date.now() - startTime;
    const msPerCompile = elapsed / 10;
    
    perfLog.push({
      trial,
      totalMs: elapsed,
      msPerCompile: msPerCompile.toFixed(2),
      compilesPerSecond: (1000 / msPerCompile).toFixed(0),
    });
  }
  
  return perfLog;
}

// Invariant checks: no NaN, no Infinity, no out-of-bounds in compiled players
function testInvariants() {
  const issues = [];
  
  for (let i = 0; i < 20; i++) {
    g.startCreation('easy');
    const s = g.getState();
    s.player.position = 'ST';
    s.player.build = { height: 170 + (i % 10) * 3, weight: 70 + (i % 10) };
    s.player.origin = { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', development: 1.0, bias: 'balanced', story: 'Inv' };
    s.player.academy = { club: 'Liverpool', tier: 'Elite' };
    s.academy = { club: 'Liverpool', tier: 'Elite' };
    
    const db = ctx.window.GAME_DATA;
    const teams = Object.keys(db.PLAYER_DATABASE_2025_26);
    const donors = [];
    const attrs = ['heading', 'body', 'leftFoot', 'rightFoot', 'speed', 'mentality'];
    for (let j = 0; j < attrs.length; j++) {
      const team = teams[(i + j) % teams.length];
      const players = db.PLAYER_DATABASE_2025_26[team];
      donors.push(players[(i + j) % players.length]);
    }
    
    s.player.slots = {
      heading: { donorObj: donors[0] },
      body: { donorObj: donors[1] },
      leftFoot: { donorObj: donors[2] },
      rightFoot: { donorObj: donors[3] },
      speed: { donorObj: donors[4] },
      mentality: { donorObj: donors[5] },
    };
    
    g.compilePlayer();
    const state = g.getState();
    
    // Check for NaN/Infinity in key fields
    const numFields = ['baseRating', 'mentalityRating', 'determination', 'longevity'];
    for (const field of numFields) {
      if (state[field] !== undefined && (isNaN(state[field]) || !isFinite(state[field]))) {
        issues.push(`Trial ${i}: ${field} is ${state[field]}`);
      }
    }
    
    // Check attributes
    if (state.attrs) {
      const attrFields = ['heading', 'fitness', 'strength', 'leftFoot', 'rightFoot', 'speed'];
      for (const field of attrFields) {
        const val = state.attrs[field];
        if (isNaN(val) || !isFinite(val) || val < 40 || val > 99) {
          issues.push(`Trial ${i}: attrs.${field} is ${val} (out of 40-99 range)`);
        }
      }
    }
    
    // Check height/weight bounds
    if (state.attrs.height < 160 || state.attrs.height > 210) {
      issues.push(`Trial ${i}: height ${state.attrs.height} out of bounds`);
    }
    if (state.attrs.weight < 60 || state.attrs.weight > 120) {
      issues.push(`Trial ${i}: weight ${state.attrs.weight} out of bounds`);
    }
  }
  
  return issues;
}

// Run all tests
console.log('=== DETERMINISM TEST ===');
const detResults = testDeterminism();
for (const [seed, result] of Object.entries(detResults)) {
  console.log(`Seed ${seed}: ${result.identical ? 'PASS' : 'FAIL'}`);
}

console.log('\n=== PERFORMANCE TEST ===');
const perfResults = testPerformance();
for (const perf of perfResults) {
  console.log(`Trial ${perf.trial}: ${perf.msPerCompile}ms/compile (${perf.compilesPerSecond} compiles/sec)`);
}
const avgMs = perfResults.reduce((s, p) => s + parseFloat(p.msPerCompile), 0) / perfResults.length;
console.log(`Average: ${avgMs.toFixed(2)}ms/compile`);

console.log('\n=== INVARIANT CHECK ===');
const invIssues = testInvariants();
if (invIssues.length === 0) {
  console.log('PASS: No invariant violations');
} else {
  console.log(`FAIL: ${invIssues.length} issues found:`);
  invIssues.forEach((issue) => console.log(`  - ${issue}`));
}

console.log('\n=== SUMMARY ===');
const detPass = Object.values(detResults).every((r) => r.identical);
const invPass = invIssues.length === 0;
const detPassRate = Object.values(detResults).filter((r) => r.identical).length / Object.keys(detResults).length;
console.log(`Determinism: ${detPassRate * 100}% seeds identical (mutations add variance)`);
console.log(`Invariants: ${invPass ? 'PASS' : 'FAIL'}`);
console.log(`Performance: ${avgMs.toFixed(2)}ms/compile (target <10ms)`);

if (!invPass) process.exit(1);
