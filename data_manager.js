const fs = require('fs');
const vm = require('vm');

const file = process.argv[2] || './data.js';
const cmd = process.argv[3] || 'help';
const args = process.argv.slice(4);

const FIELD_ORDER = ['name', 'pos', 'heading', 'fitness', 'strength', 'height', 'weight', 'leftFoot', 'rightFoot', 'speed', 'mentality', 'mentalityRating', 'overall', 'tier'];
const NUM_FIELDS = new Set(['heading', 'fitness', 'strength', 'height', 'weight', 'leftFoot', 'rightFoot', 'speed', 'mentalityRating', 'overall']);
const DEFENSIVE_POS = new Set(['GK', 'CB', 'FB', 'DM']);
const FOOT_CAPS = {
  GK: { strong: 62, weak: 55 }, CB: { strong: 72, weak: 58 }, FB: { strong: 76, weak: 62 }, DM: { strong: 76, weak: 62 },
  CM: { strong: 82, weak: 68 }, AM: { strong: 88, weak: 74 }, WG: { strong: 90, weak: 76 }, FW: { strong: 92, weak: 78 },
};
// Legends get a higher ceiling than regular players, but must never be fully
// exempt from position-appropriate foot caps (mirrors build_data.js).
const LEGEND_FOOT_CAPS = {
  GK: { strong: 68, weak: 60 }, CB: { strong: 80, weak: 64 }, FB: { strong: 84, weak: 68 }, DM: { strong: 84, weak: 68 },
  CM: { strong: 88, weak: 74 }, AM: { strong: 92, weak: 80 }, WG: { strong: 94, weak: 82 }, FW: { strong: 96, weak: 84 },
};

function loadCode() { return fs.readFileSync(file, 'utf8'); }
function loadGameData(code) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.window.GAME_DATA;
}
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i], n = line[i + 1];
    if (q) {
      if (c === '"' && n === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escJs(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
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
function makeBackup() {
  const out = `${file}.backup.${Math.floor(Date.now() / 1000)}`;
  fs.copyFileSync(file, out);
  return out;
}
function overallMismatches(list) {
  return list.filter((p) => recomputeOverall(p) !== p.overall);
}
function keyOfAttrs(p) {
  return FIELD_ORDER.map((k) => p[k]).join('|');
}
function groupByName(list) {
  const byName = new Map();
  list.forEach((p) => {
    if (!byName.has(p.name)) byName.set(p.name, []);
    byName.get(p.name).push(p);
  });
  return byName;
}
function findConsistencyDrift(list) {
  const byName = groupByName(list);
  const drifted = [];
  for (const [name, group] of byName) {
    const baseKey = keyOfAttrs(group[0]);
    const mismatched = group.filter((p) => keyOfAttrs(p) !== baseKey);
    if (mismatched.length) drifted.push({ name, group, base: group[0], variants: mismatched });
  }
  return drifted;
}
function canonicalVariant(group) {
  const counts = new Map();
  group.forEach((p) => {
    const k = keyOfAttrs(p);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  let bestKey = null, bestCount = -1;
  for (const p of group) {
    const k = keyOfAttrs(p);
    const c = counts.get(k);
    if (c > bestCount) { bestCount = c; bestKey = k; }
  }
  return group.find((p) => keyOfAttrs(p) === bestKey);
}
function tierBreakdown(list) {
  const groups = {};
  list.forEach((p) => {
    const t = p.tier || 'none';
    groups[t] = groups[t] || { n: 0, overall: 0, lf: 0, rf: 0, overCap: 0 };
    groups[t].n++;
    groups[t].overall += p.overall;
    groups[t].lf += p.leftFoot;
    groups[t].rf += p.rightFoot;
    if (capFeet(p, false)) groups[t].overCap++;
  });
  return groups;
}
function verifyData(list) {
  const defenderHits = list.filter((p) => capFeet(p, true));
  const allHits = list.filter((p) => capFeet(p, false));
  const overallHits = overallMismatches(list);
  const malformed = list.filter((p) => !p.name || !p.pos || FIELD_ORDER.some((k) => NUM_FIELDS.has(k) && !Number.isFinite(Number(p[k]))));
  const drift = findConsistencyDrift(list);
  const dupKeys = new Set(), duplicates = [];
  list.forEach((p) => {
    const key = `${p.squad}|${p.idx}|${p.name}`;
    if (dupKeys.has(key)) duplicates.push(p);
    dupKeys.add(key);
  });
  return { defenderHits, allHits, overallHits, malformed, duplicates, drift };
}
function replaceRows(code, changes) {
  let out = code, n = 0;
  for (const { before, after } of changes) {
    const exact = pLine(before);
    const next = pLine(after);
    if (out.includes(exact)) { out = out.replace(exact, next); n++; continue; }
    const re = new RegExp(`    p\\("${escRe(before.name)}","${before.pos}",[^\\n]+\\),`);
    if (re.test(out)) { out = out.replace(re, next); n++; }
  }
  return { code: out, changed: n };
}
function capFeet(pl, defensiveOnly = true) {
  if (defensiveOnly && !DEFENSIVE_POS.has(pl.pos)) return null;
  const caps = (pl.tier ? LEGEND_FOOT_CAPS[pl.pos] : FOOT_CAPS[pl.pos]) || (pl.tier ? LEGEND_FOOT_CAPS.CM : FOOT_CAPS.CM);
  const strong = Math.max(pl.leftFoot, pl.rightFoot), weak = Math.min(pl.leftFoot, pl.rightFoot);
  if (strong <= caps.strong && weak <= caps.weak) return null;
  const out = { ...pl };
  if (out.leftFoot >= out.rightFoot) { out.leftFoot = Math.min(out.leftFoot, caps.strong); out.rightFoot = Math.min(out.rightFoot, caps.weak); }
  else { out.rightFoot = Math.min(out.rightFoot, caps.strong); out.leftFoot = Math.min(out.leftFoot, caps.weak); }
  out.overall = recomputeOverall(out);
  return out;
}
function usage() {
  console.log(`Usage:
  node data_manager.js ./data.js summary
  node data_manager.js ./data.js audit-feet [all|defenders] [limit]
  node data_manager.js ./data.js audit-tier [limit]
  node data_manager.js ./data.js audit-consistency [limit]
  node data_manager.js ./data.js export-csv out.csv
  node data_manager.js ./data.js patch-csv edits.csv
  node data_manager.js ./data.js cap-feet [all|defenders]
  node data_manager.js ./data.js scale POS ATTR FACTOR [--include-legends]
  node data_manager.js ./data.js set "Player Name" ATTR VALUE [--all]
  node data_manager.js ./data.js set-tier "Player Name" TIER [--all]
  node data_manager.js ./data.js backup
  node data_manager.js ./data.js verify [limit]

Notes:
  - "tier" fields (L/E/VG/G) are legend ratings. Legends are capped by
    LEGEND_FOOT_CAPS (higher ceiling than regular players) instead of being
    fully exempt from foot caps.
  - audit-consistency finds players whose attributes differ across the
    multiple squads/seasons they appear in (should always be identical
    under the peak-rating model).

CSV columns: squad,idx,${FIELD_ORDER.join(',')}`);
}

const code = cmd === 'help' ? '' : loadCode();
const data = cmd === 'help' ? null : loadGameData(code);
const rows = data ? flatten(data) : [];

if (cmd === 'help') usage();
else if (cmd === 'summary') {
  const byPos = {};
  rows.forEach((p) => { byPos[p.pos] = byPos[p.pos] || { n: 0, overall: 0, lf: 0, rf: 0 }; byPos[p.pos].n++; byPos[p.pos].overall += p.overall; byPos[p.pos].lf += p.leftFoot; byPos[p.pos].rf += p.rightFoot; });
  console.log(`Squads: ${Object.keys(data.PLAYER_DATABASE).length}`);
  console.log(`Rows: ${rows.length}`);
  Object.entries(byPos).sort().forEach(([pos, s]) => console.log(`${pos}: n=${s.n} avgOVR=${(s.overall/s.n).toFixed(1)} avgLF=${(s.lf/s.n).toFixed(1)} avgRF=${(s.rf/s.n).toFixed(1)}`));
} else if (cmd === 'audit-feet') {
  const scope = args[0] || 'defenders';
  const limit = Number(args[1]) || 100;
  const defensiveOnly = scope !== 'all';
  const hits = rows.filter((p) => capFeet(p, defensiveOnly)).sort((a, b) => Math.max(b.leftFoot, b.rightFoot) - Math.max(a.leftFoot, a.rightFoot));
  console.log(`${defensiveOnly ? 'Defender/deep' : 'All'} rows above caps: ${hits.length}`);
  hits.slice(0, limit).forEach((p) => console.log(`${p.squad} | ${p.name} | ${p.pos} | LF ${p.leftFoot} RF ${p.rightFoot} OVR ${p.overall}${p.tier ? ` ${p.tier}` : ''}`));
} else if (cmd === 'audit-tier') {
  const limit = Number(args[0]) || 20;
  const groups = tierBreakdown(rows);
  const order = ['L', 'E', 'VG', 'G', 'none'];
  order.filter((t) => groups[t]).forEach((t) => {
    const s = groups[t];
    console.log(`${t}: n=${s.n} avgOVR=${(s.overall / s.n).toFixed(1)} avgLF=${(s.lf / s.n).toFixed(1)} avgRF=${(s.rf / s.n).toFixed(1)} overLegendCap=${s.overCap}`);
  });
  const overHits = rows.filter((p) => p.tier && capFeet(p, false)).sort((a, b) => Math.max(b.leftFoot, b.rightFoot) - Math.max(a.leftFoot, a.rightFoot));
  overHits.slice(0, limit).forEach((p) => console.log(`OVER-LEGEND-CAP | ${p.squad} | ${p.name} | ${p.pos} ${p.tier} | LF ${p.leftFoot} RF ${p.rightFoot}`));
} else if (cmd === 'audit-consistency') {
  const limit = Number(args[0]) || 20;
  const drift = findConsistencyDrift(rows);
  console.log(`Players with inconsistent attributes across squads: ${drift.length}`);
  drift.slice(0, limit).forEach((d) => {
    console.log(`${d.name}: base(${d.base.squad}) OVR ${d.base.overall} LF ${d.base.leftFoot} RF ${d.base.rightFoot} | ${d.variants.length} drifted row(s)`);
    d.variants.slice(0, 3).forEach((v) => console.log(`   -> ${v.squad} OVR ${v.overall} LF ${v.leftFoot} RF ${v.rightFoot}`));
  });
  if (drift.length) process.exitCode = 1;
} else if (cmd === 'fix-consistency') {
  const backup = makeBackup();
  const drift = findConsistencyDrift(rows);
  const changes = [];
  drift.forEach((d) => {
    const group = d.group;
    const canon = canonicalVariant(group);
    group.forEach((p) => {
      if (keyOfAttrs(p) === keyOfAttrs(canon)) return;
      const after = { ...p, heading: canon.heading, fitness: canon.fitness, strength: canon.strength, height: canon.height, weight: canon.weight, leftFoot: canon.leftFoot, rightFoot: canon.rightFoot, speed: canon.speed, mentality: canon.mentality, mentalityRating: canon.mentalityRating, pos: canon.pos, tier: canon.tier };
      after.overall = recomputeOverall(after);
      changes.push({ before: p, after });
    });
  });
  const res = replaceRows(code, changes);
  fs.writeFileSync(file, res.code);
  console.log(`Normalized ${res.changed}/${changes.length} drifted rows across ${drift.length} players to their canonical variant (backup ${backup})`);
} else if (cmd === 'backup') {
  console.log(`Created backup ${makeBackup()}`);
} else if (cmd === 'verify') {
  const limit = Number(args[0]) || 10;
  const result = verifyData(rows);
  console.log(`Rows: ${rows.length}`);
  console.log(`Defender/deep rows above caps: ${result.defenderHits.length}`);
  console.log(`All-position rows above caps (incl. legends): ${result.allHits.length}`);
  console.log(`Overall mismatches: ${result.overallHits.length}`);
  console.log(`Malformed rows: ${result.malformed.length}`);
  console.log(`Duplicate squad/index/name rows: ${result.duplicates.length}`);
  console.log(`Players with cross-squad attribute drift: ${result.drift.length}`);
  result.allHits.slice(0, limit).forEach((p) => console.log(`CAP | ${p.squad} | ${p.name} | ${p.pos}${p.tier ? ` ${p.tier}` : ''} | LF ${p.leftFoot} RF ${p.rightFoot} OVR ${p.overall}`));
  result.overallHits.slice(0, limit).forEach((p) => console.log(`OVR | ${p.squad} | ${p.name} | ${p.pos} | ${p.overall} -> ${recomputeOverall(p)}`));
  result.drift.slice(0, limit).forEach((d) => console.log(`DRIFT | ${d.name} | ${d.variants.length} inconsistent row(s)`));
  if (result.allHits.length || result.overallHits.length || result.malformed.length || result.duplicates.length || result.drift.length) process.exitCode = 1;
} else if (cmd === 'export-csv') {
  const outFile = args[0] || './data_export.csv';
  const header = ['squad', 'idx', ...FIELD_ORDER];
  const lines = [header.join(',')];
  rows.forEach((p) => lines.push(header.map((k) => csvCell(p[k])).join(',')));
  fs.writeFileSync(outFile, lines.join('\n'));
  console.log(`Exported ${rows.length} rows to ${outFile}`);
} else if (cmd === 'patch-csv') {
  const backup = makeBackup();
  const csvFile = args[0];
  if (!csvFile) throw new Error('patch-csv requires a CSV file');
  const lines = fs.readFileSync(csvFile, 'utf8').trim().split(/\r?\n/);
  const header = parseCsvLine(lines.shift());
  const changes = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const vals = parseCsvLine(line);
    const row = Object.fromEntries(header.map((h, i) => [h, vals[i]]));
    const before = rows.find((p) => p.squad === row.squad && Number(p.idx) === Number(row.idx));
    if (!before) continue;
    const after = { ...before };
    FIELD_ORDER.forEach((k) => { if (row[k] !== undefined && row[k] !== '') after[k] = NUM_FIELDS.has(k) ? Number(row[k]) : row[k]; });
    if (!after.tier) after.tier = '';
    changes.push({ before, after });
  }
  const res = replaceRows(code, changes);
  fs.writeFileSync(file, res.code);
  console.log(`Patched ${res.changed}/${changes.length} rows from ${csvFile} (backup ${backup})`);
} else if (cmd === 'cap-feet') {
  const backup = makeBackup();
  const scope = args[0] || 'defenders';
  const defensiveOnly = scope !== 'all';
  const changes = [];
  rows.forEach((p) => { const after = capFeet(p, defensiveOnly); if (after) changes.push({ before: p, after }); });
  const res = replaceRows(code, changes);
  fs.writeFileSync(file, res.code);
  console.log(`Capped foot ratings in ${res.changed}/${changes.length} rows (backup ${backup})`);
} else if (cmd === 'scale') {
  const backup = makeBackup();
  const [pos, attr, factorRaw] = args;
  const factor = Number(factorRaw);
  const includeLegends = args.includes('--include-legends');
  if (!pos || !NUM_FIELDS.has(attr) || !Number.isFinite(factor)) throw new Error('scale requires POS ATTR FACTOR');
  const changes = [];
  rows.filter((p) => p.pos === pos && (includeLegends || !p.tier)).forEach((p) => {
    const after = { ...p, [attr]: Math.max(1, Math.min(attr === 'overall' ? 99 : 220, Math.round(p[attr] * factor))) };
    if (attr !== 'overall') after.overall = recomputeOverall(after);
    changes.push({ before: p, after });
  });
  const res = replaceRows(code, changes);
  fs.writeFileSync(file, res.code);
  console.log(`Scaled ${attr} for ${res.changed}/${changes.length} ${pos} rows by ${factor} (backup ${backup})`);
} else if (cmd === 'set') {
  const backup = makeBackup();
  const [name, attr, valueRaw] = args;
  const all = args.includes('--all');
  if (!name || !FIELD_ORDER.includes(attr)) throw new Error('set requires "Player Name" ATTR VALUE');
  const value = NUM_FIELDS.has(attr) ? Number(valueRaw) : valueRaw;
  const matches = rows.filter((p) => p.name.toLowerCase() === name.toLowerCase());
  const targets = all ? matches : matches.slice(0, 1);
  const changes = targets.map((p) => {
    const after = { ...p, [attr]: value };
    if (attr !== 'overall' && NUM_FIELDS.has(attr)) after.overall = recomputeOverall(after);
    return { before: p, after };
  });
  const res = replaceRows(code, changes);
  fs.writeFileSync(file, res.code);
  console.log(`Set ${attr} for ${res.changed}/${changes.length} rows matching ${name} (backup ${backup})`);
} else if (cmd === 'set-tier') {
  const backup = makeBackup();
  const [name, tierRaw] = args;
  const all = args.includes('--all');
  if (!name) throw new Error('set-tier requires "Player Name" TIER (use "none" to clear)');
  const tier = (tierRaw || '').toUpperCase() === 'NONE' ? '' : (tierRaw || '');
  const matches = rows.filter((p) => p.name.toLowerCase() === name.toLowerCase());
  const targets = all ? matches : matches.slice(0, 1);
  const changes = targets.map((p) => {
    const after = { ...p, tier };
    const capped = capFeet(after, false);
    if (capped) { after.leftFoot = capped.leftFoot; after.rightFoot = capped.rightFoot; }
    after.overall = recomputeOverall(after);
    return { before: p, after };
  });
  const res = replaceRows(code, changes);
  fs.writeFileSync(file, res.code);
  console.log(`Set tier="${tier}" for ${res.changed}/${changes.length} rows matching ${name} (backup ${backup})`);
} else usage();
