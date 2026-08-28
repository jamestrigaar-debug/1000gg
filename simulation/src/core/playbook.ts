/* ============================================================================
 * THE PLAYBOOK — a pool of recorded moves the match can replay.
 *
 * A utility scorer picks a good option every 125 ms, and that is enough to
 * make a football match happen; it is not enough to make one look like
 * football. Real attacks are not a chain of locally-optimal passes, they are
 * REHEARSED SHAPES: the full-back overlaps and the winger holds the ball for
 * him, the striker drops and the ten runs past him, the ball is switched and
 * the far-side winger attacks the space. Nobody re-derives those from first
 * principles on the pitch — they have done them a thousand times on a training
 * ground.
 *
 * So the engine carries a pool of them. A move is a short script: the roles it
 * needs, the zones those roles run to, and the actions between them. When a
 * possession matches a move's trigger, the side runs it; every player with a
 * role in it follows the script, and everyone else keeps playing normally. The
 * moment it stops being on — the ball is lost, a step times out, the pass is
 * cut out — the move is abandoned and the utility brain has the ball back.
 *
 * Two sources fill the pool, and they use the same format:
 *
 *   playbook.json            hand-written moves: the patterns every side has
 *   playbook.recorded.json   moves MINED FROM SIMULATED MATCHES by
 *                            tools/record-moves.mjs — possessions that
 *                            actually produced a chance, recorded as zones and
 *                            roles so they can be run again
 *
 * Zones are normalised: x 0 (own goal line) to 1 (opponent's), y 0 to 1 across
 * the pitch from the team's left. So a move works at either end, for either
 * side, mirrored or not, without a second copy of the data.
 * ========================================================================== */

import { PITCH_LENGTH, PITCH_WIDTH } from "./constants";
import { clamp, type Vec2 } from "./math";
import type { Direction } from "./pitch";

/** Where a move can start. */
export interface MoveTrigger {
  /** Ball position up the pitch, 0..1, for the side in possession. */
  minProgress: number;
  maxProgress: number;
  /** Which side of the pitch the ball has to be on. */
  flank: "left" | "right" | "central" | "any";
  /** The carrier must be at most this pressed (0 free, 1 swamped). */
  maxPressure: number;
}

/** How a role is filled when the move starts. */
export type CastSource =
  | "carrier"
  | "nearestAhead"
  | "wideSameSide"
  | "wideFarSide"
  | "supportBehind"
  | "centreForward";

export interface MoveRole {
  role: string;
  from: CastSource;
}

export type MoveStep =
  /** Carry the ball towards a zone. */
  | { kind: "carry"; actor: string; zone: [number, number]; seconds: number }
  /** Play the ball to another role. */
  | { kind: "pass"; actor: string; to: string; loft: number }
  /** Move without the ball. Runs in parallel with whatever else is happening. */
  | { kind: "run"; actor: string; zone: [number, number]; seconds: number }
  /** Deliver into the box, aimed at a role who should be arriving. */
  | { kind: "cross"; actor: string; to: string; target: "near" | "far" | "cutback" }
  /** Have a go. */
  | { kind: "shoot"; actor: string };

export interface PlaybookMove {
  id: string;
  name: string;
  trigger: MoveTrigger;
  cast: MoveRole[];
  steps: MoveStep[];
  /** Relative likelihood of being chosen among the moves that match. */
  weight: number;
  /** Where this move came from: authored, or mined from a real simulation. */
  source: "authored" | "recorded";
  /** For recorded moves: the xG the possession it came from produced. */
  producedXG?: number;
}

export interface Playbook {
  moves: PlaybookMove[];
}

/** Normalised zone -> pitch metres, for a team attacking in `dir`. */
export function zoneToPitch(zone: [number, number], dir: Direction): Vec2 {
  const ax = clamp(zone[0], 0, 1);
  const ay = clamp(zone[1], 0, 1);
  return dir === 1
    ? { x: ax * PITCH_LENGTH, y: ay * PITCH_WIDTH }
    : { x: (1 - ax) * PITCH_LENGTH, y: (1 - ay) * PITCH_WIDTH };
}

/** Pitch metres -> normalised zone, the inverse; used by the recorder. */
export function pitchToZone(at: Vec2, dir: Direction): [number, number] {
  return dir === 1
    ? [clamp(at.x / PITCH_LENGTH, 0, 1), clamp(at.y / PITCH_WIDTH, 0, 1)]
    : [clamp(1 - at.x / PITCH_LENGTH, 0, 1), clamp(1 - at.y / PITCH_WIDTH, 0, 1)];
}

/** Which third of the pitch's width a normalised y sits in. */
export function flankOf(y: number): "left" | "right" | "central" {
  if (y < 0.33) return "right";
  if (y > 0.67) return "left";
  return "central";
}

export interface MoveContext {
  /** Ball position as a normalised zone for the side in possession. */
  zone: [number, number];
  pressure: number;
}

/** Does this move fit the situation? */
export function triggerMatches(move: PlaybookMove, ctx: MoveContext): boolean {
  const [x, y] = ctx.zone;
  if (x < move.trigger.minProgress || x > move.trigger.maxProgress) return false;
  if (ctx.pressure > move.trigger.maxPressure) return false;
  if (move.trigger.flank === "any") return true;
  return flankOf(y) === move.trigger.flank;
}

/** Every move that fits, with its weight. */
export function candidates(playbook: Playbook, ctx: MoveContext): PlaybookMove[] {
  return playbook.moves.filter((m) => triggerMatches(m, ctx));
}

/** A move in progress. */
export interface ActiveMove {
  move: PlaybookMove;
  /** Role -> player id. */
  cast: Map<string, number>;
  /** Index of the step being executed. */
  step: number;
  /** Tick the current step started, for its timeout. */
  stepStartTick: number;
  /** Tick the move started, for the overall abort. */
  startTick: number;
}

/** How long any single move may run before the brain takes over again. */
export const MOVE_MAX_SECONDS = 12;

/** Role a player has in the active move, or null. */
export function roleOf(active: ActiveMove | null, playerId: number): string | null {
  if (!active) return null;
  for (const [role, id] of active.cast) if (id === playerId) return role;
  return null;
}

/** The step a role should currently be executing, if any. Runs are allowed to
 *  overlap the step in front of them, because an off-the-ball run happens
 *  WHILE the ball is being carried, not after it. */
export function stepsFor(active: ActiveMove, role: string): MoveStep[] {
  const out: MoveStep[] = [];
  const current = active.move.steps[active.step];
  if (current && current.actor === role) out.push(current);
  for (let i = active.step + 1; i < active.move.steps.length; i++) {
    const step = active.move.steps[i] as MoveStep;
    if (step.kind !== "run") break;
    if (step.actor === role) out.push(step);
  }
  return out;
}
