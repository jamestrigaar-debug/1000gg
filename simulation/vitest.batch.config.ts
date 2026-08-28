import { defineConfig } from "vitest/config";

/** The balance batch runs whole matches, so it is kept out of the default
 *  test run and given its own (very generous) timeout. */
export default defineConfig({
  test: {
    include: ["tests/balance.batch.ts"],
    environment: "node",
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
});
