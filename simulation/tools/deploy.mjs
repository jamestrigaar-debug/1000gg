/* ============================================================================
 * DEPLOY — copy the build up into simulation/ itself.
 *
 * The site at 1000goals.co.uk has no build step: it serves this folder as
 * static files. So what is actually deployed is simulation/index.html plus
 * simulation/assets/, both COMMITTED to the repository. `npm run build` puts
 * them in simulation/dist/; this moves them into place and clears out the
 * previous build's hashed chunks, which would otherwise pile up forever.
 *
 * package.json has referenced this file for some time but it was missing from
 * the repository, so `npm run deploy` failed and the committed bundle could
 * only be refreshed by hand. Rewritten to match what the committed layout
 * actually looks like.
 *
 *   node tools/deploy.mjs [--dry]
 * ========================================================================== */

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const assets = join(root, "assets");
const dry = process.argv.includes("--dry");

if (!existsSync(dist)) {
  console.error("no dist/ — run `npm run build` first");
  process.exit(1);
}
if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/ has no index.html; the build did not finish");
  process.exit(1);
}

const built = await readdir(join(dist, "assets"));
console.log(`build: index.html + ${built.length} asset${built.length === 1 ? "" : "s"}`);

if (dry) {
  console.log("--dry: nothing written");
  process.exit(0);
}

/* The asset filenames carry a content hash, so a new build writes new names
 * and the old ones would linger in git forever. Clear the folder rather than
 * merging into it — anything in here that the build did not produce is by
 * definition stale. */
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await cp(join(dist, "assets"), assets, { recursive: true });
await cp(join(dist, "index.html"), join(root, "index.html"));

const size = async (p) => (await stat(p)).size;
console.log(`deployed -> simulation/index.html (${await size(join(root, "index.html"))} bytes)`);
for (const name of (await readdir(assets)).sort()) {
  console.log(`           simulation/assets/${name}`);
}
console.log("\nCommit simulation/index.html and simulation/assets/ to publish.");
