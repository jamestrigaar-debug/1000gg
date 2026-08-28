/* ============================================================================
 * MATCH VIEW — PixiJS application, snapshot buffer, interpolated draw loop.
 *
 * WHY THIS IS A QUEUE AND NOT TWO SNAPSHOTS
 *
 * The renderer used to hold the last snapshot and the newest one, and work out
 * how fast to advance the picture by measuring how far apart in match time
 * they were. That measurement was the jank. A worker's setTimeout fires
 * anywhere between 33 and 60 ms, so the gap between snapshots was never the
 * same twice; the drawn clock was therefore always slightly too fast or too
 * slow, and since it was clamped to the newest snapshot it spent the whole
 * match alternately catching up and freezing against that clamp. Every hitch
 * you could see was the picture hitting the end of the data and waiting.
 *
 * So: the worker now advances the simulation by a FIXED slice of match time
 * per snapshot and says outright what the time scale is. The renderer keeps a
 * short queue of snapshots and plays it back on its own clock, deliberately
 * running a couple of frames BEHIND the newest one it holds. That lag is the
 * whole trick — it is the slack that absorbs a late frame, so a hiccup in the
 * worker is spent out of the buffer instead of being shown on the pitch.
 *
 * When the buffer drifts away from its target depth the clock is nudged by a
 * few percent rather than jumped, which is invisible to the eye. When the
 * buffer runs dry the picture holds rather than extrapolating into a lie.
 * ========================================================================== */

import { Application, Container } from "pixi.js";
import { SNAPSHOT_DT } from "../worker/protocol";
import { PITCH_LENGTH } from "../core/constants";
import type { RenderSnapshot } from "../core/snapshot";
import type { TeamKit } from "../core/types";
import { Camera, type CameraMode, type Orientation } from "./camera";
import { EntityLayer } from "./entity-layer";
import { buildPitch } from "./pitch-layer";
import { SnapshotBuffer } from "./snapshot-buffer";

/** Pixels per metre at scale 1. The camera scales the whole world from here,
 *  so this only sets the resolution the vector pitch is baked at. */
const PPM = 10;

export class MatchView {
  readonly app = new Application();
  readonly camera = new Camera(PPM);
  private readonly world = new Container();
  private entities!: EntityLayer;
  /** The playback clock and the frames waiting on it. All the timing lives
   *  in here, and it is tested on its own in tests/render.test.ts. */
  private readonly buffer = new SnapshotBuffer<RenderSnapshot>(SNAPSHOT_DT);

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
  push(snapshot: RenderSnapshot, cut = false, timeScale?: number): void {
    this.buffer.push(snapshot, cut, timeScale);
  }

  private draw(dtSeconds: number): void {
    this.buffer.advance(dtSeconds);
    const frame = this.buffer.pair();
    if (!frame) return;

    this.entities.render(frame.prev, frame.next, frame.alpha, frame.span);

    const b = frame.next.ball;
    this.camera.apply(this.world, this.app.screen.width, this.app.screen.height, {
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
    });
  }

  /** Forget the match being drawn. Called when the fixture changes: the next
   *  snapshot to arrive belongs to a different match and must not be
   *  interpolated against the last one from the old one. */
  reset(): void {
    this.buffer.reset();
  }

  /** The match second actually on screen — what the clock should read. */
  drawnSecond(): number {
    return this.buffer.second;
  }

  /** Latest snapshot, for the UI panels (which read the event stream from it). */
  latest(): RenderSnapshot | null {
    return this.buffer.newest();
  }

  static get pitchLengthMetres(): number {
    return PITCH_LENGTH;
  }
}
