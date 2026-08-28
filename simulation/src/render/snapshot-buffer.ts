/* ============================================================================
 * SNAPSHOT BUFFER — the thing that actually removes the jank.
 *
 * The problem it solves, precisely:
 *
 *   The worker emits a snapshot every 1/30th of a second of WALL time, each
 *   carrying a fixed 1/30th of a second of MATCH time. But a setTimeout in a
 *   worker does not fire on time — 33 ms nominal is 33, then 47, then 29, then
 *   61 — so snapshots arrive unevenly even though they are evenly spaced in
 *   match time. The renderer, meanwhile, draws on the display's refresh, which
 *   is a third clock again.
 *
 *   Drawing straight at the newest snapshot means the picture inherits the
 *   worker's timer jitter directly: it lurches forward on an early frame and
 *   freezes on a late one. That freeze-lurch is what reads as jank, and no
 *   amount of smoothing the SIMULATION can fix it, because the simulation was
 *   never the problem.
 *
 * The fix is the one every video player and netcode stack uses: deliberately
 * run BEHIND. Hold a couple of frames in hand, play them out on a clock of our
 * own, and spend the buffer — not the picture — when a frame arrives late.
 *
 * Two rules keep it honest:
 *   - never draw past the newest sample held (that would be inventing football
 *     that has not been simulated yet), so a starved buffer HOLDS
 *   - correct buffer drift by trimming the clock a few percent, never by
 *     jumping it. A jump is exactly what the old renderer did every time it
 *     hit its clamp, and a jump is visible.
 *
 * Pure, DOM-free and Pixi-free on purpose: this is the part worth testing, and
 * tests/render.test.ts feeds it deliberately horrible frame timings.
 * ========================================================================== */

import { clamp } from "../core/math";

/** Anything with a match time on it. The renderer passes RenderSnapshots. */
export interface Timed {
  matchSecond: number;
}

/** How many samples behind the newest the picture is drawn. Two is 67 ms at
 *  1x — under the threshold anyone perceives as lag, and enough slack to ride
 *  out a worker frame that arrives late. */
export const BUFFER_FRAMES = 2;
/** Never hold more than this; a huge backlog means something went wrong. */
const MAX_QUEUE = 24;
/** How hard the clock may be trimmed to correct buffer drift. */
const MAX_RATE_TRIM = 0.12;
/** Buffer error, in frames, at which the trim is at full stretch. */
const TRIM_FULL_AT_FRAMES = 3;
/** A gap bigger than this is a seek, not a frame: cut rather than smear. */
const CUT_THRESHOLD_SECONDS = 5;
/** Ignore an absurd frame delta — a tab restored from the background — which
 *  would otherwise jump the picture through football nobody watched. */
const MAX_FRAME_DELTA = 0.1;

export class SnapshotBuffer<T extends Timed> {
  private queue: T[] = [];
  private playbackSecond = 0;
  private scale = 1;
  private started = false;
  /** Sample interval in match seconds at 1x — set by the owner from the
   *  protocol's SNAPSHOT_DT so this file needs no worker import. */
  constructor(private readonly frameDt: number) {}

  /**
   * Take a sample.
   *
   * `cut` marks one that does not continue the last — the first frame of a
   * passage, on the far side of a silent fast-forward. The buffer is thrown
   * away rather than interpolated across, so players appear where they belong
   * instead of sliding the length of the pitch to get there.
   */
  push(sample: T, cut = false, timeScale = this.scale): void {
    this.scale = timeScale;

    const newest = this.queue[this.queue.length - 1];
    const jumped =
      newest !== undefined &&
      Math.abs(sample.matchSecond - newest.matchSecond) > CUT_THRESHOLD_SECONDS;

    if (cut || !this.started || jumped) {
      this.queue = [sample];
      this.playbackSecond = sample.matchSecond;
      this.started = true;
      return;
    }

    this.queue.push(sample);
    if (this.queue.length > MAX_QUEUE) {
      // Something has gone badly wrong upstream. Re-seat on the newest frames
      // rather than falling further and further behind.
      this.queue = this.queue.slice(-BUFFER_FRAMES - 1);
      const first = this.queue[0];
      if (first) this.playbackSecond = first.matchSecond;
    }
  }

  /** Advance the playback clock by `dtWall` seconds of wall time. */
  advance(dtWall: number): void {
    if (this.queue.length === 0) return;
    this.playbackSecond += Math.min(dtWall, MAX_FRAME_DELTA) * this.scale * this.rateTrim();

    // Retire samples the clock has passed, always keeping the pair being drawn.
    while (this.queue.length > 2) {
      const second = this.queue[1];
      if (!second || second.matchSecond > this.playbackSecond) break;
      this.queue.shift();
    }

    const newest = this.queue[this.queue.length - 1];
    const oldest = this.queue[0];
    // Hold at the newest sample rather than extrapolating past it, and never
    // fall behind the oldest one we still hold.
    if (newest && this.playbackSecond > newest.matchSecond) {
      this.playbackSecond = newest.matchSecond;
    }
    if (oldest && this.playbackSecond < oldest.matchSecond) {
      this.playbackSecond = oldest.matchSecond;
    }
  }

  /** The two samples the picture is currently between, and how far along. */
  pair(): { prev: T; next: T; alpha: number; span: number } | null {
    const prev = this.queue[0];
    if (!prev) return null;
    const next = this.queue[1] ?? prev;
    const span = next.matchSecond - prev.matchSecond;
    const alpha = span > 1e-6 ? clamp((this.playbackSecond - prev.matchSecond) / span, 0, 1) : 1;
    return { prev, next, alpha, span };
  }

  /** The match second actually on screen. */
  get second(): number {
    return this.playbackSecond;
  }

  /** How far behind the newest sample we are drawing, in match seconds. */
  get lag(): number {
    const newest = this.queue[this.queue.length - 1];
    return newest ? newest.matchSecond - this.playbackSecond : 0;
  }

  get depth(): number {
    return this.queue.length;
  }

  /** Newest sample held, for panels that want the authoritative state. */
  newest(): T | null {
    return this.queue[this.queue.length - 1] ?? null;
  }

  reset(): void {
    this.queue = [];
    this.playbackSecond = 0;
    this.scale = 1;
    this.started = false;
  }

  /**
   * A gentle speed trim that holds the buffer at its target depth.
   *
   * Drawing too close to the newest sample means the next late frame starves
   * us, so run fractionally slow and let the buffer refill; too far behind and
   * we run fractionally fast to give the lag back. A few percent is invisible.
   */
  private rateTrim(): number {
    if (this.queue.length < 2) return 1;
    const frameSeconds = Math.max(this.frameDt * this.scale, 1e-6);
    const target = BUFFER_FRAMES * frameSeconds;
    const errorFrames = (this.lag - target) / frameSeconds;
    return 1 + clamp(errorFrames / TRIM_FULL_AT_FRAMES, -1, 1) * MAX_RATE_TRIM;
  }
}
