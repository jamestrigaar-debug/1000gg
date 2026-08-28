/* ============================================================================
 * FORMATION — normalised slot anchors resolved into pitch coordinates.
 *
 * A formation file stores each slot's anchor per phase in normalised space:
 * ax 0..1 runs from own goal line to opponent goal line, ay 0..1 runs across
 * the pitch from the team's left to its right. Resolving applies the team's
 * attacking direction, then the tactical modifiers (width squeezes ay towards
 * the middle, defensive line and mentality slide ax), then clamps to the pitch.
 *
 * Because anchors are normalised, the same file works for either end and
 * survives a half-time swap with no special casing.
 * ========================================================================== */

import { PITCH_LENGTH, PITCH_WIDTH } from "./constants";
import { clamp, lerp, type Vec2 } from "./math";
import type { Direction } from "./pitch";
import type { Formation, Phase, TeamInstructions } from "./types";

/** Normalised anchor -> pitch metres for a team attacking in `dir`. */
export function resolveAnchor(anchor: Vec2, dir: Direction): Vec2 {
  const ax = clamp(anchor.x, 0, 1);
  const ay = clamp(anchor.y, 0, 1);
  return dir === 1
    ? { x: ax * PITCH_LENGTH, y: ay * PITCH_WIDTH }
    : { x: (1 - ax) * PITCH_LENGTH, y: (1 - ay) * PITCH_WIDTH };
}

/**
 * Slot anchor for a phase, after team instructions.
 *
 * width      pulls ay towards 0.5 (narrow) or out to the touchlines (wide)
 * defLine    slides the defensive third's ax up or down
 * mentality  slides everyone up the pitch; 4 is neutral
 */
export function slotAnchor(
  formation: Formation,
  slotIndex: number,
  phase: Phase,
  dir: Direction,
  ins: TeamInstructions,
): Vec2 {
  const slot = formation.slots[slotIndex];
  if (!slot) throw new Error(`formation ${formation.id} has no slot ${slotIndex}`);
  const base = slot.anchors[phase];

  // Keepers ignore tactical sliding; their anchor is the goal, not the shape.
  if (slot.position === "GK") return resolveAnchor(base, dir);

  const widthSpread = lerp(0.62, 1.28, clamp(ins.width, 0, 1));
  const ay = 0.5 + (base.y - 0.5) * widthSpread;

  const mentalityPush = (ins.mentality - 4) * 0.018;
  // Deeper slots respond most to the defensive line, forwards least: pushing
  // the line up should compact the block, not teleport the striker.
  const defensiveWeight = clamp(1 - base.x * 1.2, 0, 1);
  const linePush = (clamp(ins.defensiveLine, 0, 1) - 0.5) * 0.16 * defensiveWeight;

  const ax = base.x + mentalityPush + linePush;
  return resolveAnchor({ x: clamp(ax, 0.02, 0.98), y: clamp(ay, 0.02, 0.98) }, dir);
}

/** Kick-off shape: everyone in their own half, one striker on the ball. */
export function kickOffAnchor(
  formation: Formation,
  slotIndex: number,
  dir: Direction,
  ins: TeamInstructions,
  attacking: boolean,
): Vec2 {
  const a = slotAnchor(formation, slotIndex, "AttackBuildUp", dir, ins);
  const halfway = PITCH_LENGTH / 2;
  const ownHalf = dir === 1 ? Math.min(a.x, halfway - 0.5) : Math.max(a.x, halfway + 0.5);
  const slot = formation.slots[slotIndex];
  if (attacking && slot && slot.position === "ST") {
    // The taker stands over the ball.
    return { x: halfway - dir * 0.6, y: PITCH_WIDTH / 2 + 0.4 };
  }
  return { x: ownHalf, y: a.y };
}
