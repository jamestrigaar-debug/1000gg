/* ============================================================================
 * SNAPSHOTS — what crosses the worker boundary, and what enables seeking.
 *
 * Two different things share the word "snapshot":
 *
 *  RenderSnapshot   a compact, per-frame view of the world posted to the
 *                   render thread. Positions, velocities, ball, clock, score.
 *                   The renderer interpolates between the last two of these,
 *                   so they carry velocity: at 8x time scale the gap between
 *                   snapshots is large and position-only lerp would look wrong.
 *
 *  FullSnapshot     the entire simulation state including the RNG cursor,
 *                   written to a ring buffer every KEYFRAME_INTERVAL_SECONDS.
 *                   Seeking = load the nearest keyframe before the target and
 *                   fast-forward silently. Because the RNG cursor is in here,
 *                   a resumed sim continues the *same* match, not a new one.
 * ========================================================================== */

import type { BallState } from "./ball";
import type { Vec2 } from "./math";
import type { PlayerState } from "./player";
import type { MatchEvent } from "./events";
import type { TeamSide } from "./types";

export interface PlayerSnapshot {
  id: number;
  side: TeamSide;
  number: number;
  pos: Vec2;
  vel: Vec2;
  heading: number;
  state: PlayerState;
  stamina: number;
  isKeeper: boolean;
  onPitch: boolean;
}

export interface BallSnapshot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  owner: number | null;
}

export type PlayPhase = "preKickOff" | "live" | "deadBall" | "halfTime" | "fullTime";

export interface RenderSnapshot {
  tick: number;
  matchSecond: number;
  period: number;
  /** Added time so far this period, in seconds, derived from the event log. */
  stoppageSeconds: number;
  play: PlayPhase;
  score: [number, number];
  /** Which way each side is currently attacking; flips at half time. */
  attackingDir: [1 | -1, 1 | -1];
  players: PlayerSnapshot[];
  ball: BallSnapshot;
  /** Events since the previous snapshot — the render thread's delta feed. */
  events: MatchEvent[];
}

/**
 * Full simulation state for the seek ring buffer.
 *
 * EVERYTHING that can vary between two ticks has to be in here, not just the
 * obvious things. A keyframe that carries positions and the RNG cursor but
 * forgets, say, which tick the current carrier took possession will resume
 * into a subtly different match — and "subtly different" compounds within
 * seconds. tests/matchday.test.ts holds this to the line by seeking to a
 * highlight and comparing against a straight run to the same tick.
 *
 * Deliberately structural (no class instances) so it structured-clones across
 * the worker boundary and JSON-serialises into a replay as-is.
 */
export interface FullSnapshot {
  tick: number;
  matchSecond: number;
  period: number;
  play: PlayPhase;
  score: [number, number];
  rngState: number;
  eventCount: number;
  /** Which way the home side is attacking; flips at half time. */
  homeDir: 1 | -1;
  ball: BallState;
  /** Ball position at the end of the previous tick, for line-crossing tests. */
  prevBallPos: { x: number; y: number; z: number } | null;
  clock: {
    stoppageSeconds: number;
    possessionTicks: [number, number];
  };
  /** The possession bookkeeping the brains read. */
  possession: {
    ownedSinceTick: number;
    controlLockTick: number;
    selfLockTick: number;
    lastKickerId: number | null;
    strayFacedUntil: number;
    stalledTicks: number;
    wonBallTick: [number, number];
    wonBallDeep: [boolean, boolean];
  };
  /** A shot in flight whose outcome is already decided, and a restart that is
   *  waiting to be taken. Both are plain data. */
  pendingShot: unknown;
  pendingRestart: unknown;
  /**
   * The three cooldowns and the referee's held whistle.
   *
   * These are the ones that were missing, and they are why a watched highlight
   * did not show the match the text described: each of them GATES a mechanic
   * for a window of ticks, so a resumed sim that thinks the gate is open runs
   * an aerial duel, or re-faces a resolved shot, that the original match never
   * had. Half a second of difference compounds; by the end of a ten-second
   * passage the ball was fifteen metres from where the commentary said it was.
   */
  aerialLockTick: number;
  resolvedShotUntil: number;
  lastRestartTick: number;
  /** A foul the referee is playing advantage on. */
  advantage: { side: TeamSide; at: Vec2; until: number } | null;
  /** The rehearsed move each side is running, if any. A move changes what
   *  every player in its cast does, so a keyframe that forgot it would resume
   *  into a different match. */
  activeMoves: [unknown, unknown];
  players: {
    id: number;
    slot: number;
    pos: Vec2;
    vel: Vec2;
    heading: number;
    state: PlayerState;
    stamina: number;
    nextBrainTick: number;
    yellowCards: number;
    sentOff: boolean;
    onPitch: boolean;
    /** Steering state: where he is going and the velocity he wants. */
    target: Vec2;
    steerX: number;
    steerY: number;
    /** The cached physical ceilings. They are derived from stamina, but only
     *  recomputed on a brain beat, so they are state in their own right:
     *  recomputing them at restore time instead of carrying them made a
     *  resumed match drift from the original within a few seconds. */
    vMax: number;
    aMax: number;
    turnRate: number;
  }[];
}

/**
 * Fixed-capacity ring of keyframes.
 *
 * With one exception, the oldest frame is dropped when the ring is full: the
 * VERY FIRST frame is pinned and never evicted. That is not tidiness, it is
 * the fix for a real and very visible bug.
 *
 * Seeking asks for the newest frame at or before the target tick. If the ring
 * has already dropped everything that early it answers "none", and the caller
 * had no honest move left — it fell back to the oldest frame it still had,
 * which is LATER than the passage being sought. The simulation then sat past
 * the end of the window it was supposed to play, the playback loop saw it was
 * already finished, and the highlight ended the instant it was clicked. From
 * the outside: you click a line near the start of the match and nothing at all
 * happens.
 *
 * Pinning frame zero means nearestBefore() can always answer for any tick in
 * the match. The worst case degrades to a longer silent fast-forward, which is
 * a wait; the old behaviour was a lie.
 */
export class KeyframeRing {
  private readonly frames: FullSnapshot[] = [];

  constructor(private readonly capacity: number) {}

  push(frame: FullSnapshot): void {
    this.frames.push(frame);
    // Evict the second-oldest, so index 0 — the start of the match — stays.
    if (this.frames.length > this.capacity) this.frames.splice(1, 1);
  }

  /** Newest keyframe at or before `tick`, or null if we have none that early. */
  nearestBefore(tick: number): FullSnapshot | null {
    let best: FullSnapshot | null = null;
    for (const f of this.frames) if (f.tick <= tick && (!best || f.tick > best.tick)) best = f;
    return best;
  }

  all(): readonly FullSnapshot[] {
    return this.frames;
  }
}
