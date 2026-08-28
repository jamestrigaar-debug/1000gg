/* ============================================================================
 * MATCH VIEW — PixiJS application, snapshot buffer, interpolated draw loop.
 *
 * The renderer holds exactly two snapshots: the last one it drew from and the
 * newest one that arrived. Every frame it computes alpha from how far wall
 * time has advanced between their match times and draws the world in between.
 * If snapshots stop arriving (paused, or a hitch), alpha saturates at 1 and
 * the picture simply holds — it never extrapolates into a lie.
 * ========================================================================== */

import { Application, Container } from "pixi.js";
import { PITCH_LENGTH } from "../core/constants";
import { clamp } from "../core/math";
import type { RenderSnapshot } from "../core/snapshot";
import type { TeamKit } from "../core/types";
import { Camera, type CameraMode, type Orientation } from "./camera";
import { EntityLayer } from "./entity-layer";
import { buildPitch } from "./pitch-layer";

/** Pixels per metre at scale 1. The camera scales the whole world from here,
 *  so this only sets the resolution the vector pitch is baked at. */
const PPM = 10;

export class MatchView {
  readonly app = new Application();
  readonly camera = new Camera(PPM);
  private readonly world = new Container();
  private entities!: EntityLayer;

  private prev: RenderSnapshot | null = null;
  private next: RenderSnapshot | null = null;
  /** Match seconds drawn so far; chases next.matchSecond. */
  private drawnSecond = 0;

  async init(
    canvasParent: HTMLElement,
    kits: [TeamKit, TeamKit],
    playerNames: Map<number, string> = new Map(),
  ): Promise<void> {
    await this.app.init({
      background: 0x14261a,
      resizeTo: canvasParent,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(globalThis.devicePixelRatio ?? 1, 2),
    });
    canvasParent.appendChild(this.app.canvas);

    this.world.addChild(buildPitch(PPM));
    this.entities = new EntityLayer(PPM, kits, playerNames);
    this.world.addChild(this.entities.root);
    this.app.stage.addChild(this.world);

    this.app.ticker.add(() => this.draw(this.app.ticker.deltaMS / 1000));
  }

  setMode(mode: CameraMode): void {
    this.camera.mode = mode;
  }

  setOrientation(o: Orientation): void {
    this.camera.orientation = o;
  }

  /** Names under the dots, FM-style. */
  setNames(show: boolean): void {
    this.entities.showNames = show;
  }

  /** Feed a snapshot from the worker. */
  push(snapshot: RenderSnapshot): void {
    if (!this.next) {
      this.prev = snapshot;
      this.next = snapshot;
      this.drawnSecond = snapshot.matchSecond;
      return;
    }
    // A seek jumps the clock; drop the interpolation rather than smear across.
    if (Math.abs(snapshot.matchSecond - this.next.matchSecond) > 5) {
      this.prev = snapshot;
      this.drawnSecond = snapshot.matchSecond;
    } else {
      this.prev = this.next;
    }
    this.next = snapshot;
  }

  private draw(dtSeconds: number): void {
    const prev = this.prev;
    const next = this.next;
    if (!prev || !next) return;

    const span = next.matchSecond - prev.matchSecond;
    if (span > 1e-6) {
      // Advance the drawn clock at the rate the snapshots themselves imply,
      // so the picture runs at whatever time scale the sim is running at.
      this.drawnSecond += dtSeconds * this.impliedScale(span);
      this.drawnSecond = clamp(this.drawnSecond, prev.matchSecond, next.matchSecond);
    } else {
      this.drawnSecond = next.matchSecond;
    }

    const alpha = span > 1e-6 ? clamp((this.drawnSecond - prev.matchSecond) / span, 0, 1) : 1;
    this.entities.render(prev, next, alpha);

    const b = next.ball;
    this.camera.apply(this.world, this.app.screen.width, this.app.screen.height, {
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
    });
  }

  /** Snapshots arrive at a fixed wall rate, so the match seconds between two
   *  of them is the current time scale. Smoothed so a jittery frame does not
   *  make the picture surge. */
  private impliedScale(span: number): number {
    const raw = span * 30; // SNAPSHOT_HZ
    this.scaleEstimate = this.scaleEstimate * 0.8 + raw * 0.2;
    return this.scaleEstimate;
  }
  private scaleEstimate = 1;

  /** Latest snapshot, for the UI panels (which read the event stream from it). */
  latest(): RenderSnapshot | null {
    return this.next;
  }

  static get pitchLengthMetres(): number {
    return PITCH_LENGTH;
  }
}
