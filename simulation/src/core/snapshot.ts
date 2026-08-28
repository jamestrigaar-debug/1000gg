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
  }[];
}

/** Fixed-capacity ring of keyframes; the oldest is dropped silently. */
export class KeyframeRing {
  private readonly frames: FullSnapshot[] = [];

  constructor(private readonly capacity: number) {}

  push(frame: FullSnapshot): void {
    this.frames.push(frame);
    if (this.frames.length > this.capacity) this.frames.shift();
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
