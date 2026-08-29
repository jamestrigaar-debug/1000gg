/* ============================================================================
 * PERCEPTION — what a player believes, as distinct from what is true.
 *
 * THE PROBLEM THIS EXISTS TO SOLVE
 *
 * Every brain in this engine read the world exactly: `this.ball`, this tick,
 * to the millimetre, including the position of all twenty-one other players.
 * Twenty-two omniscient dots. The consequences are not subtle once you look
 * for them:
 *
 *   - Nobody is ever caught out of position, because nobody is ever WRONG
 *     about where anyone is. Every mistake the engine made was an execution
 *     mistake — a pass struck badly, a duel lost. Real footballers mostly make
 *     perception mistakes, and those are the ones that read as intelligence
 *     when they DON'T happen.
 *   - Offside became impossible. keepOnside() clamped every attacker to
 *     exactly half a metre the right side of a line he could read perfectly,
 *     every tick, forever. The engine produced 0.3 offsides a match against a
 *     real 3 to 6, and the flag only ever went up on a dice roll at the moment
 *     of the pass rather than because anybody had actually strayed.
 *   - Concentration was read by NOTHING, and Anticipation and Positioning by
 *     almost nothing. They had nowhere to live, because the stage of
 *     competence they belong to did not exist. (An earlier version of this
 *     note also listed Teamwork and Flair. Teamwork is real and now lives in
 *     traits.ts; Flair is not an attribute in this engine at all.)
 *
 * THE MODEL
 *
 * A player does not hold a copy of the world. He holds a few facts, each with
 * an age, and he re-reads them when he next looks up. Between glances he
 * extrapolates from what he last saw. Three attributes govern it, and each
 * one does a job you can describe in a sentence:
 *
 *   CONCENTRATION  how often he looks. A switched-on defender re-reads the
 *                  line five times a second; a distracted one goes most of a
 *                  second on a stale picture, which at a sprint is four metres.
 *   ANTICIPATION   how much of the movement he carries forward. Reading that
 *                  the line WAS on the halfway line is worth little; reading
 *                  that it was moving up at two metres a second is worth a
 *                  great deal, and only good players do the second.
 *   POSITIONING    how accurately he reads it at all — the size of the error
 *                  he makes even when looking straight at it.
 *
 * The error is drawn ONCE per glance rather than per read, which matters: a
 * player who is wrong should be consistently wrong until he looks again, not
 * jittering around the truth. A fresh sample every tick would average out to
 * the truth and the whole thing would do nothing.
 *
 * Deliberately narrow. This tracks the offside line and nothing else, because
 * that is the one belief with a law attached to it and therefore the one whose
 * effects can be measured rather than admired. The structure generalises — the
 * same three fields would carry a belief about a marked man, or the ball — but
 * it is not worth paying for beliefs whose consequences we cannot yet check.
 * ========================================================================== */

import { PHYSICS_HZ } from "./constants";
import { attr01, clamp } from "./math";
import type { Attributes } from "./types";

/** How often a fully switched-on player re-reads the line, in seconds. */
const GLANCE_FASTEST = 0.2;
/** ...and a fully distracted one. At a sprint this is nearly four metres of
 *  staleness, which is exactly how a striker ends up a yard off. */
const GLANCE_SLOWEST = 0.75;

/** Metres of error on the read, at Positioning 20 and at Positioning 1.
 *  Tuned on the batch harness: at 1.9 m the engine produced 6.8 offsides a
 *  match, above the real 3-6 band. */
const READ_ERROR_BEST = 0.25;
const READ_ERROR_WORST = 1.5;

/** Fraction of the line's motion a player carries forward between glances, at
 *  Anticipation 20 and at 1. Nobody extrapolates perfectly and nobody is
 *  completely oblivious. */
const LEAD_BEST = 1.0;
const LEAD_WORST = 0.15;

/** However stale the picture, a player does not run on a belief older than
 *  this — past a point he simply looks again. Bounds the worst case. */
const MAX_STALE_SECONDS = 1.4;

export interface Perception {
  /** The offside line as he last read it, in pitch x. */
  lineX: number;
  /** How fast it was moving then, in metres per second of pitch x. */
  lineVel: number;
  /** The tick he read it on. */
  lineTick: number;
  /** The error he made on that read, in metres. Held until he looks again. */
  lineError: number;
  /** Ticks between glances, from Concentration. */
  glanceTicks: number;
  /** How much of the line's motion he carries forward, from Anticipation. */
  lead: number;
  /** The size of error he is prone to, from Positioning. */
  errorScale: number;
}

export function createPerception(a: Attributes): Perception {
  return {
    lineX: 0,
    lineVel: 0,
    // Negative so the first read always refreshes, whatever the tick.
    lineTick: -1e9,
    lineError: 0,
    glanceTicks: Math.max(
      1,
      Math.round(
        PHYSICS_HZ *
          (GLANCE_SLOWEST - (GLANCE_SLOWEST - GLANCE_FASTEST) * attr01(a.concentration)),
      ),
    ),
    lead: LEAD_WORST + (LEAD_BEST - LEAD_WORST) * attr01(a.anticipation),
    errorScale: READ_ERROR_WORST - (READ_ERROR_WORST - READ_ERROR_BEST) * attr01(a.positioning),
  };
}

/** Is this player due another look at the line? */
export const dueAGlance = (p: Perception, tick: number): boolean =>
  tick - p.lineTick >= p.glanceTicks;

/**
 * Take a fresh reading. `noise` is a value in [-1, 1] drawn by the caller from
 * the simulation's RNG, so perception stays inside the deterministic stream
 * and a replayed match perceives exactly what the original one did.
 */
export function glance(p: Perception, tick: number, trueLineX: number, lineVel: number, noise: number): void {
  p.lineVel = lineVel;
  p.lineTick = tick;
  p.lineError = noise * p.errorScale;
  p.lineX = trueLineX;
}

/**
 * Where he currently believes the line is.
 *
 * The last reading, carried forward by however much of its motion he is able
 * to account for, plus the error he made reading it. A player who last looked
 * a while ago at a line that was stepping up is exactly the player who gets
 * caught — which is the whole point, and is what an offside trap is.
 */
export function believedLine(p: Perception, tick: number): number {
  const age = clamp((tick - p.lineTick) / PHYSICS_HZ, 0, MAX_STALE_SECONDS);
  return p.lineX + p.lineVel * age * p.lead + p.lineError;
}

/** Restore a perception from a keyframe. Beliefs are state like any other:
 *  a resumed match whose players believe different things is a different
 *  match, and the seek test would catch it within seconds. */
export function restorePerception(p: Perception, from: Perception): void {
  p.lineX = from.lineX;
  p.lineVel = from.lineVel;
  p.lineTick = from.lineTick;
  p.lineError = from.lineError;
  p.glanceTicks = from.glanceTicks;
  p.lead = from.lead;
  p.errorScale = from.errorScale;
}
