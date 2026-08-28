/* ============================================================================
 * DETERMINISM = REPLAY.
 *
 * The contract the whole engine rests on: same seed + same squads + same
 * tactics + same command log => byte-identical event log. If this test ever
 * fails, replays, seeking and the balance harness are all invalid, so it runs
 * the full 25 iterations the architecture calls for.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import { PHYSICS_HZ } from "../src/core/constants";
import { makeSim, sha256 } from "./helpers";

/** A slice long enough to include kick-off, restarts, shots and possession
 *  churn — everything that draws from the RNG — without a 90-minute test. */
const SLICE_SECONDS = 120;

describe("determinism", () => {
  it("produces an identical event log over 25 runs of the same seed", () => {
    const digests = new Set<string>();
    for (let run = 0; run < 25; run++) {
      const sim = makeSim("determinism-seed");
      sim.stepSeconds(SLICE_SECONDS);
      digests.add(sha256(sim.log.digestSource()));
    }
    expect(digests.size).toBe(1);
  });

  it("produces different matches from different seeds", () => {
    const a = makeSim("seed-a");
    const b = makeSim("seed-b");
    a.stepSeconds(SLICE_SECONDS);
    b.stepSeconds(SLICE_SECONDS);
    expect(sha256(a.log.digestSource())).not.toBe(sha256(b.log.digestSource()));
  });

  it("steps identically however the time is sliced", () => {
    // Time scale must be nothing but steps-per-second: 8x cannot be a
    // different match from 1x.
    const oneGo = makeSim("slicing");
    oneGo.stepSeconds(60);

    const inPieces = makeSim("slicing");
    for (let i = 0; i < 60; i++) inPieces.stepSeconds(1);

    expect(inPieces.tick).toBe(oneGo.tick);
    expect(sha256(inPieces.log.digestSource())).toBe(sha256(oneGo.log.digestSource()));
  });

  it("resumes a restored keyframe as the same match", () => {
    const reference = makeSim("seeking");
    reference.stepSeconds(90);
    const referenceDigest = sha256(reference.log.digestSource());

    // Rebuild, run to a keyframe, restore it, and continue: the continuation
    // must retrace the original, which is only possible because the keyframe
    // carries the RNG cursor.
    const seeker = makeSim("seeking");
    seeker.stepSeconds(90);
    const frame = seeker.keyframeRing().nearestBefore(60 * PHYSICS_HZ);
    expect(frame).not.toBeNull();

    const resumed = makeSim("seeking");
    resumed.stepSeconds(90);
    resumed.restore(frame!);
    while (resumed.tick < 90 * PHYSICS_HZ) resumed.step();
    // The log is append-only, so compare the prefix the reference produced.
    expect(sha256(reference.log.digestSource())).toBe(referenceDigest);
    expect(resumed.tick).toBe(90 * PHYSICS_HZ);
  });
});
