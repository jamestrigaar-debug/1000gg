/* ============================================================================
 * RENDER TIMING — the jank, measured.
 *
 * "It looks janky" is not a thing you can hold a build to, so this file turns
 * it into a number. It drives the playback clock through the frame timings a
 * real browser actually produces — a worker whose setTimeout wanders between
 * 29 and 61 ms, a display refreshing on its own schedule — and measures how
 * evenly the picture advances.
 *
 * The metric is the spread of per-frame advance: how much match time each
 * drawn frame moves the world on by. A perfectly smooth picture advances by
 * the same amount every frame. A janky one alternates between standing still
 * (the clock has hit the end of the data and is waiting) and lurching (the
 * next snapshot arrived and it caught up in one go).
 *
 * The old renderer is reproduced verbatim at the bottom of this file so the
 * two can be measured against exactly the same timings. That is the evidence
 * for the change, and it is why it lives in the test rather than in a comment.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import { SNAPSHOT_DT, SNAPSHOT_HZ } from "../src/worker/protocol";
import { SnapshotBuffer } from "../src/render/snapshot-buffer";

interface Frame {
  matchSecond: number;
}

/**
 * A worker timer that misses, the way they do.
 *
 * The key property, and the one the old model got wrong: the jitter is NOISE
 * AROUND A FIXED SCHEDULE, not accumulating drift. That is what the worker
 * actually does — it schedules each frame against an absolute due time, so an
 * overslept frame shortens the next wait instead of pushing everything back.
 * Modelling it as drift would mean match time is produced more slowly than it
 * is consumed, which no buffer can survive and which is not the bug we have.
 *
 * Deterministic, so the numbers this file asserts are reproducible.
 */
function jitteryArrivals(count: number, seed = 1): number[] {
  const nominal = 1000 / SNAPSHOT_HZ;
  let state = seed;
  const rand = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const out: number[] = [];
  let previous = 0;
  for (let i = 0; i < count; i++) {
    // Ordinary wander, plus an occasional badly late frame.
    const noise = rand() < 0.15 ? nominal * (0.4 + rand() * 0.9) : nominal * (rand() * 0.4 - 0.2);
    // Monotonic: a frame cannot arrive before the one in front of it.
    const at = Math.max(previous + 4, (i + 1) * nominal + noise);
    out.push(at);
    previous = at;
  }
  return out;
}

/** Run a playback clock over a wall-clock timeline and report how evenly the
 *  drawn match time advanced. */
interface Trace {
  advances: number[];
  stalls: number;
  lurches: number;
  spread: number;
}

/** The first few frames are the buffer filling up, when holding is correct
 *  rather than a fault. Steady state is what the eye actually watches. */
const WARM_UP_FRAMES = 12;

function analyse(all: number[], expectedPerFrame: number): Trace {
  const advances = all.slice(WARM_UP_FRAMES);
  const stalls = advances.filter((a) => a < expectedPerFrame * 0.05).length;
  const lurches = advances.filter((a) => a > expectedPerFrame * 2).length;
  const mean = advances.reduce((t, a) => t + a, 0) / Math.max(advances.length, 1);
  const variance =
    advances.reduce((t, a) => t + (a - mean) * (a - mean), 0) / Math.max(advances.length, 1);
  // Coefficient of variation: spread as a fraction of the mean, so it is
  // comparable regardless of speed.
  const spread = mean > 0 ? Math.sqrt(variance) / mean : 0;
  return { advances, stalls, lurches, spread };
}

/** Drive a clock at a steady 60 fps display refresh against snapshots that
 *  arrive on `arrivals`. Returns how much match time each drawn frame moved. */
function drive(
  push: (matchSecond: number, wallMs: number) => void,
  advanceAndRead: (dtSeconds: number) => number,
  arrivals: number[],
  timeScale = 1,
): number[] {
  const displayDt = 1 / 60;
  const endMs = arrivals[arrivals.length - 1] ?? 0;
  const advances: number[] = [];

  let nextArrival = 0;
  let last = -1;
  for (let wallMs = 0; wallMs <= endMs; wallMs += displayDt * 1000) {
    while (nextArrival < arrivals.length && (arrivals[nextArrival] as number) <= wallMs) {
      push(nextArrival * SNAPSHOT_DT * timeScale, arrivals[nextArrival] as number);
      nextArrival++;
    }
    const drawn = advanceAndRead(displayDt);
    if (last >= 0) advances.push(drawn - last);
    last = drawn;
  }
  return advances;
}

/* --- the old renderer, kept for comparison -------------------------------- */

/**
 * src/render/match-view.ts as it was: two snapshots, a drawn clock that
 * chases the newer one at a rate INFERRED from how far apart they landed, and
 * a hard clamp at the newest sample. Reproduced exactly so the measurement
 * below is a fair one.
 */
class LegacyClock {
  private prev: Frame | null = null;
  private next: Frame | null = null;
  private drawnSecond = 0;
  private scaleEstimate = 1;

  push(matchSecond: number): void {
    const snapshot = { matchSecond };
    if (!this.next) {
      this.prev = snapshot;
      this.next = snapshot;
      this.drawnSecond = matchSecond;
      return;
    }
    if (Math.abs(matchSecond - this.next.matchSecond) > 5) {
      this.prev = snapshot;
      this.drawnSecond = matchSecond;
    } else {
      this.prev = this.next;
    }
    this.next = snapshot;
  }

  advance(dt: number): number {
    const prev = this.prev;
    const next = this.next;
    if (!prev || !next) return this.drawnSecond;
    const span = next.matchSecond - prev.matchSecond;
    if (span > 1e-6) {
      const raw = span * SNAPSHOT_HZ;
      this.scaleEstimate = this.scaleEstimate * 0.8 + raw * 0.2;
      this.drawnSecond += dt * this.scaleEstimate;
      this.drawnSecond = Math.min(Math.max(this.drawnSecond, prev.matchSecond), next.matchSecond);
    } else {
      this.drawnSecond = next.matchSecond;
    }
    return this.drawnSecond;
  }
}

/* --- the measurement ------------------------------------------------------ */

describe("playback smoothness", () => {
  const arrivals = jitteryArrivals(220);
  const perDrawnFrame = SNAPSHOT_DT * SNAPSHOT_HZ / 60; // match seconds per 60fps frame at 1x

  const legacyTrace = (() => {
    const clock = new LegacyClock();
    return analyse(
      drive((s) => clock.push(s), (dt) => clock.advance(dt), arrivals),
      perDrawnFrame,
    );
  })();

  const bufferedTrace = (() => {
    const buffer = new SnapshotBuffer<Frame>(SNAPSHOT_DT);
    return analyse(
      drive(
        (s) => buffer.push({ matchSecond: s }, false, 1),
        (dt) => {
          buffer.advance(dt);
          return buffer.second;
        },
        arrivals,
      ),
      perDrawnFrame,
    );
  })();

  it("the old renderer really did stall and lurch (this is the bug)", () => {
    // Not an aspiration — a record of what was being shipped, so that if
    // someone reverts the buffer this file says what they have given up.
    expect(legacyTrace.stalls).toBeGreaterThan(20);
    expect(legacyTrace.spread).toBeGreaterThan(0.35);
  });

  it("the buffered clock advances evenly through the same timings", () => {
    // No frame may stand still, and none may lurch to more than double.
    expect(bufferedTrace.stalls).toBe(0);
    expect(bufferedTrace.lurches).toBe(0);
    // Spread well under a tenth of the mean: visually indistinguishable from
    // a perfectly even advance.
    expect(bufferedTrace.spread).toBeLessThan(0.1);
  });

  it("is dramatically steadier than what it replaced", () => {
    expect(bufferedTrace.spread).toBeLessThan(legacyTrace.spread / 4);
  });

  it("never draws football that has not been simulated yet", () => {
    const buffer = new SnapshotBuffer<Frame>(SNAPSHOT_DT);
    let newest = -1;
    drive(
      (s) => {
        newest = s;
        buffer.push({ matchSecond: s }, false, 1);
      },
      (dt) => {
        buffer.advance(dt);
        // Before the first snapshot there is nothing to be ahead of.
        if (newest >= 0) expect(buffer.second).toBeLessThanOrEqual(newest + 1e-9);
        return buffer.second;
      },
      arrivals,
    );
  });

  it("holds rather than freezing hard when the feed stops", () => {
    const buffer = new SnapshotBuffer<Frame>(SNAPSHOT_DT);
    for (let i = 0; i < 6; i++) buffer.push({ matchSecond: i * SNAPSHOT_DT }, false, 1);
    for (let i = 0; i < 40; i++) buffer.advance(1 / 60);
    const held = buffer.second;
    // It has caught up to the last sample and stopped there, not run past it.
    expect(held).toBeCloseTo(5 * SNAPSHOT_DT, 6);
    buffer.advance(1 / 60);
    expect(buffer.second).toBeCloseTo(held, 6);
  });

  it("cuts rather than smears when a passage jumps the clock", () => {
    const buffer = new SnapshotBuffer<Frame>(SNAPSHOT_DT);
    for (let i = 0; i < 5; i++) buffer.push({ matchSecond: i * SNAPSHOT_DT }, false, 1);
    buffer.advance(1 / 60);

    // The next passage starts forty minutes later.
    buffer.push({ matchSecond: 2400 }, true, 1);
    expect(buffer.second).toBe(2400);
    expect(buffer.depth).toBe(1);

    const frame = buffer.pair();
    expect(frame?.prev.matchSecond).toBe(2400);
    expect(frame?.next.matchSecond).toBe(2400);
  });

  it("treats an unflagged jump as a cut too", () => {
    const buffer = new SnapshotBuffer<Frame>(SNAPSHOT_DT);
    buffer.push({ matchSecond: 10 }, false, 1);
    buffer.push({ matchSecond: 10 + SNAPSHOT_DT }, false, 1);
    buffer.push({ matchSecond: 900 }, false, 1);
    expect(buffer.second).toBe(900);
    expect(buffer.depth).toBe(1);
  });

  it("keeps up at 4x without stalling", () => {
    const buffer = new SnapshotBuffer<Frame>(SNAPSHOT_DT);
    const trace = analyse(
      drive(
        (s) => buffer.push({ matchSecond: s }, false, 4),
        (dt) => {
          buffer.advance(dt);
          return buffer.second;
        },
        jitteryArrivals(200, 7),
        4,
      ),
      (SNAPSHOT_DT * SNAPSHOT_HZ * 4) / 60,
    );
    expect(trace.stalls).toBe(0);
    expect(trace.spread).toBeLessThan(0.1);
  });
});
