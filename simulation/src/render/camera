/* ============================================================================
 * CAMERA — whole-pitch fit and a damped ball-follow.
 *
 * The follow camera leads the ball by 0.6 s of its own velocity and then
 * damps towards that point, so it anticipates a pass instead of chasing it.
 * Critically damped-ish smoothing (exponential per frame) means no overshoot
 * and no visible spring, which is what makes FM's view feel calm at 8x.
 * ========================================================================== */

import type { Container } from "pixi.js";
import { PITCH_LENGTH, PITCH_WIDTH } from "../core/constants";
import { clamp, lerp } from "../core/math";

export type CameraMode = "fit" | "follow";
export type Orientation = "horizontal" | "vertical";

const LOOK_AHEAD_SECONDS = 0.6;
/** Fraction of the remaining distance closed per 60fps frame. */
const DAMPING = 0.12;

export class Camera {
  mode: CameraMode = "fit";
  orientation: Orientation = "horizontal";
  /** Zoom used in follow mode, as a multiple of the fit scale. */
  followZoom = 2.2;

  private x = PITCH_LENGTH / 2;
  private y = PITCH_WIDTH / 2;

  constructor(private ppm: number) {}

  setPixelsPerMetre(ppm: number): void {
    this.ppm = ppm;
  }

  /** Move the world container so the camera target sits in the viewport. */
  apply(
    world: Container,
    viewW: number,
    viewH: number,
    ball: { x: number; y: number; vx: number; vy: number },
  ): void {
    // A vertical pitch is the same world rotated a quarter turn: the sim never
    // learns about it, and the camera maths below works in pitch space either
    // way once the viewport's own axes are swapped to match.
    const vertical = this.orientation === "vertical";
    world.rotation = vertical ? -Math.PI / 2 : 0;
    if (vertical) [viewW, viewH] = [viewH, viewW];

    // A little apron either side, no more: FM fills the frame with the pitch.
    const fitScale = Math.min(
      viewW / ((PITCH_LENGTH + 5) * this.ppm),
      viewH / ((PITCH_WIDTH + 5) * this.ppm),
    );

    if (this.mode === "fit") {
      world.scale.set(fitScale);
      const ox = (viewW - PITCH_LENGTH * this.ppm * fitScale) / 2;
      const oy = (viewH - PITCH_WIDTH * this.ppm * fitScale) / 2;
      // Under rotation the container's own origin moves, so the offsets swap.
      world.x = vertical ? oy : ox;
      world.y = vertical ? viewW - ox : oy;
      this.x = PITCH_LENGTH / 2;
      this.y = PITCH_WIDTH / 2;
      return;
    }

    const targetX = ball.x + ball.vx * LOOK_AHEAD_SECONDS;
    const targetY = ball.y + ball.vy * LOOK_AHEAD_SECONDS;
    this.x = lerp(this.x, targetX, DAMPING);
    this.y = lerp(this.y, targetY, DAMPING);

    const scale = fitScale * this.followZoom;
    // Keep the camera inside the pitch so the view never shows empty space.
    const halfW = viewW / (2 * scale * this.ppm);
    const halfH = viewH / (2 * scale * this.ppm);
    const cx = clamp(this.x, Math.min(halfW, PITCH_LENGTH / 2), Math.max(PITCH_LENGTH - halfW, PITCH_LENGTH / 2));
    const cy = clamp(this.y, Math.min(halfH, PITCH_WIDTH / 2), Math.max(PITCH_WIDTH - halfH, PITCH_WIDTH / 2));

    world.scale.set(scale);
    const px = viewW / 2 - cx * this.ppm * scale;
    const py = viewH / 2 - cy * this.ppm * scale;
    world.x = vertical ? py : px;
    world.y = vertical ? viewW - px : py;
  }
}
