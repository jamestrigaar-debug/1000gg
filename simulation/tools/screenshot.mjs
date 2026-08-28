/* Verification helper: boot the built app in headless Chromium, let a few
 * seconds of match run, and save a screenshot plus whatever the score strip
 * and the commentary feed say. Run `npm run build && npm run preview` first.
 *
 *   node tools/screenshot.mjs [url] [outfile]
 */
import { chromium } from "playwright";
const b = await chromium.launch({
  // Software GL: CI and containers have no GPU, and Pixi will otherwise sit
  // waiting on a WebGL context that never arrives.
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
p.on("console", (m) => errs.push(`${m.type()}: ${m.text()}`));
p.on("pageerror", (e) => errs.push(`PAGEERROR ${String(e)}`));
p.on("requestfailed", (r) => errs.push(`REQFAIL ${r.url()}`));
p.on("response", (r) => { if (r.status() >= 400) errs.push(`HTTP${r.status()} ${r.url()}`); });
const url = process.argv[2] ?? "http://localhost:4173/";
const out = process.argv[3] ?? "match.png";
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForTimeout(6000);
await p.screenshot({ path: out });
console.log("home:", await p.textContent("#home-name"), "canvas:", await p.locator("#stage canvas").count());
console.log("score:", await p.textContent("#score"), "clock:", await p.textContent("#clock"));
console.log("feed:", (await p.textContent("#feed")).slice(0, 160));
console.log("errors:", errs.slice(0, 8));
await b.close();
