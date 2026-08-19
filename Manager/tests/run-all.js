/* ============================================================================
 * THE WHOLE SUITE, one command, one exit code.
 *
 * The four harnesses were only ever run by hand, one at a time, which is how
 * realism.js managed to sit for months hardcoding `process.exitCode = 0` — it
 * printed "N metric(s) outside tolerance" and still told its caller everything
 * was fine, and nothing ever checked. `npm test` runs the lot and fails if any
 * of them fails.
 *
 * Each harness is spawned in its own process on purpose. They all load the
 * same modules onto the same global MG namespace and several of them mutate
 * shared state (players.resetIds, ratings.resetHidden), so running them in one
 * process would make the later ones depend on what the earlier ones left
 * behind — and a suite whose results depend on its own running order is worse
 * than no suite.
 * ========================================================================== */
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");

const HERE = __dirname;
const SUITE = [
  { name: "audit", file: "audit.js", blurb: "structural invariants over 12 seasons" },
  { name: "realism", file: "realism.js", blurb: "match engine against real-world rates" },
  { name: "decisions", file: "decisions.js", blurb: "every decision card renders and applies" },
  { name: "world", file: "run_world.js", blurb: "long-run world drift" },
];

const only = process.argv.slice(2);
const run = only.length ? SUITE.filter((s) => only.includes(s.name)) : SUITE;
if (!run.length) {
  console.error(`No such test. Known: ${SUITE.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

const results = [];
for (const t of run) {
  process.stdout.write(`\n\x1b[1m── ${t.name}\x1b[0m — ${t.blurb}\n`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, t.file)], { stdio: "inherit" });
  const ms = Date.now() - started;
  // A harness killed by a signal has no exit code; treat that as failure too
  // rather than letting `null` fall through as falsy-and-therefore-fine.
  const code = r.status == null ? 1 : r.status;
  results.push({ name: t.name, code, ms });
}

console.log("\n\x1b[1m── summary\x1b[0m");
let failed = 0;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) failed++;
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${r.name.padEnd(10)} ${(r.ms / 1000).toFixed(1)}s`);
}
console.log(failed === 0
  ? `\n  all ${results.length} suites passed\n`
  : `\n  ${failed} of ${results.length} suites FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
