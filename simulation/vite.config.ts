import { defineConfig } from "vite";

/* The built app is served as a static folder at 1000goals.co.uk/simulation/,
 * alongside the rest of the site, which has no build step of its own. So:
 *
 *   root      app/          the source HTML entry lives here, out of the way
 *   outDir    dist/         the build lands here
 *   base      ./            every asset path is relative, so the same output
 *                           works at /simulation/, at /, or opened from disk
 *
 * `npm run deploy` then copies dist/ up into simulation/ itself (index.html
 * and assets/), which is what gets committed and served. See tools/deploy.mjs.
 */
export default defineConfig({
  root: "app",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
  worker: { format: "es" },
  server: { fs: { allow: [".."] } },
});
