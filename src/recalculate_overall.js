const fs = require('fs');
const vm = require('vm');

const file = process.argv[2] || './data.js';
const mode = process.argv[3] || 'write';

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escJs(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function loadGameData(code) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.window.GAME_DATA;
}
function pLine(pl) {
  const tier = pl.tier ? `,"${escJs(pl.tier)}"` : '';
  return `    p("${escJs(pl.name)}","${pl.pos}",${pl.heading},${pl.fitness},${pl.strength},${pl.height},${pl.weight},${pl.leftFoot},${pl.rightFoot},${pl.speed},"${escJs(pl.mentality)}",${pl.mentalityRating},${pl.overall}${tier}),`;
}
function recomputeOverall(pl) {
  const foot = Math.max(pl.leftFoot, pl.rightFoot);
  if (pl.pos === 'GK') return Math.round((pl.strength * 0.4 + pl.heading * 0.35 + pl.fitness * 0.25));
  if (pl.pos === 'FW' || pl.pos === 'AM' || pl.pos === 'WG') return Math.round(foot * 0.35 + pl.speed * 0.25 + pl.heading * 0.18 + pl.strength * 0.12 + pl.fitness * 0.10);
  if (pl.pos === 'CB' || pl.pos === 'DM') return Math.round(pl.heading * 0.32 + pl.strength * 0.32 + pl.speed * 0.16 + pl.fitness * 0.16 + foot * 0.04);
  if (pl.pos === 'FB') return Math.round(pl.speed * 0.28 + pl.fitness * 0.22 + pl.strength * 0.18 + pl.heading * 0.14 + foot * 0.18);
  return Math.round(pl.strength * 0.22 + pl.speed * 0.20 + pl.heading * 0.18 + pl.fitness * 0.20 + foot * 0.20);
}
function flatten(db) {
  const rows = [];
  for (const [squad, players] of Object.entries(db.PLAYER_DATABASE)) players.forEach((pl, idx) => rows.push({ squad, idx, ...pl }));
  return rows;
}
function replaceRows(code, changes) {
  let out = code, changed = 0;
  for (const { before, after } of changes) {
    const exact = pLine(before);
    const next = pLine(after);
    if (out.includes(exact)) { out = out.replace(exact, next); changed++; continue; }
    const re = new RegExp(`    p\\("${escRe(before.name)}","${before.pos}",[^\\n]+\\),`);
    if (re.test(out)) { out = out.replace(re, next); changed++; }
  }
  return { code: out, changed };
}

const code = fs.readFileSync(file, 'utf8');
const data = loadGameData(code);
const rows = flatten(data);
const changes = [];
for (const row of rows) {
  const next = recomputeOverall(row);
  if (next !== row.overall) changes.push({ before: row, after: { ...row, overall: next } });
}
console.log(`Rows needing overall recalculation: ${changes.length}/${rows.length}`);
if (mode === 'check') {
  changes.slice(0, Number(process.argv[4]) || 25).forEach(({ before, after }) => {
    console.log(`${before.squad} | ${before.name} | ${before.pos} | ${before.overall} -> ${after.overall}`);
  });
  process.exit(changes.length ? 1 : 0);
}
const result = replaceRows(code, changes);
fs.writeFileSync(file, result.code);
console.log(`Recalculated overall in ${result.changed}/${changes.length} rows`);
