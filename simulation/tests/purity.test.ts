/* The layering rule is only real if something enforces it. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE = join(process.cwd(), "src/core");
const files = readdirSync(CORE).filter((f) => f.endsWith(".ts"));

/** Comments are allowed to *name* the banned things — the files explain why
 *  they are banned — so only real code is scanned. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("core purity", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("never reaches for wall-clock time, the DOM, or unseeded randomness", () => {
    const banned = [
      /Math\.random/,
      /Date\.now/,
      /new Date\(/,
      /performance\.now/,
      /\bdocument\b/,
      /\bwindow\b/,
      /from "pixi\.js"/,
    ];
    for (const file of files) {
      const src = stripComments(readFileSync(join(CORE, file), "utf8"));
      for (const pattern of banned) {
        expect(pattern.test(src), `${file} must not contain ${pattern}`).toBe(false);
      }
    }
  });
});
