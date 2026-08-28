/* ============================================================================
 * ENTITY LAYER — dots, numbers, and the ball.
 *
 * The FM look in three parts:
 *   - a dot is a kit-coloured circle with a secondary rim and a centred squad
 *     number; the keeper gets his own colours so he reads instantly
 *   - the ball is a white dot plus a *shadow*: the shadow stays on the ground
 *     while the dot lifts and grows with z. That offset is the entire height
 *     illusion, and it is why the ball never looks like it is sliding
 *   - everything is interpolated between the last two snapshots, so 8x looks
 *     smooth rather than strobed
 * ========================================================================== */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { GOAL_HEIGHT } from "../core/constants";
import { lerp } from "../core/math";
import type { PlayerSnapshot, RenderSnapshot } from "../core/snapshot";
import type { TeamKit } from "../core/types";

/** "C. Mensah" -> "Mensah". FM labels dots with the surname alone. */
function surnameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[parts.length - 1] as string) : name;
}

interface Dot {
  root: Container;
  body: Graphics;
  label: Text;
  name: Text;
}

export class EntityLayer {
  readonly root = new Container();
  private readonly dots = new Map<number, Dot>();
  private readonly ball = new Container();
  private readonly ballShadow = new Graphics();
  private readonly ballBody = new Graphics();

  /** FM shows a name under each dot; the toggle is in the match-day strip. */
  showNames = true;

  constructor(
    private readonly ppm: number,
    private readonly kits: [TeamKit, TeamKit],
    private readonly playerNames: Map<number, string> = new Map(),
  ) {
    const r = ppm * 0.34;
    this.ballShadow.circle(0, 0, r).fill({ color: 0x000000, alpha: 0.32 });
    this.ballBody.circle(0, 0, r).fill(0xffffff);
    this.ballBody.circle(0, 0, r).stroke({ width: 1.2, color: 0x1a1a1a, alpha: 0.75 });
    this.ball.addChild(this.ballBody);
    this.root.addChild(this.ballShadow, this.ball);
  }

  private dotFor(p: PlayerSnapshot): Dot {
    const existing = this.dots.get(p.id);
    if (existing) return existing;

    const kit = this.kits[p.side];
    const primary = p.isKeeper ? kit.gkPrimary : kit.primary;
    const secondary = p.isKeeper ? kit.gkSecondary : kit.secondary;
    const numberColour = p.isKeeper ? kit.gkNumber : kit.number;

    /* FM's dot: a small filled circle, a thin darker rim, the squad number
     * centred inside it, and the player's surname underneath in white. Small
     * relative to the pitch — twenty-two of them have to read as a shape, not
     * as a crowd of buttons. */
    const radius = this.ppm * 0.72;
    const body = new Graphics();
    body.circle(0, 0, radius).fill(primary);
    body.circle(0, 0, radius).stroke({ width: Math.max(1, radius * 0.16), color: secondary });

    const label = new Text({
      text: String(p.number),
      style: new TextStyle({
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: Math.max(7, radius * 1.05),
        fontWeight: "700",
        fill: numberColour,
      }),
    });
    label.anchor.set(0.5);

    const name = new Text({
      text: surnameOf(this.playerNames.get(p.id) ?? ""),
      style: new TextStyle({
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: Math.max(7, radius * 0.95),
        fontWeight: "600",
        fill: 0xffffff,
        stroke: { color: 0x0b1a0b, width: Math.max(2, radius * 0.5) },
      }),
    });
    name.anchor.set(0.5, 0);
    name.y = radius * 1.35;

    const root = new Container();
    root.addChild(body, label, name);
    this.root.addChild(root);

    const dot: Dot = { root, body, label, name };
    this.dots.set(p.id, dot);
    return dot;
  }

  /**
   * Draw the world at `alpha` between two snapshots. Velocity is used as a
   * fallback when a player is new to the second snapshot, so a substitute
   * appearing mid-frame does not streak in from the origin.
   */
  render(prev: RenderSnapshot, next: RenderSnapshot, alpha: number): void {
    const byId = new Map(prev.players.map((p) => [p.id, p]));
    for (const p of next.players) {
      const dot = this.dotFor(p);
      dot.root.visible = p.onPitch;
      if (!p.onPitch) continue;
      const a = byId.get(p.id) ?? p;
      dot.root.x = lerp(a.pos.x, p.pos.x, alpha) * this.ppm;
      dot.root.y = lerp(a.pos.y, p.pos.y, alpha) * this.ppm;
      dot.name.visible = this.showNames;
      // A tiring player's dot dims a little: fatigue you can see at a glance.
      dot.root.alpha = 0.65 + 0.35 * Math.max(p.stamina, 0);
    }

    const b0 = prev.ball;
    const b1 = next.ball;
    const bx = lerp(b0.x, b1.x, alpha) * this.ppm;
    const by = lerp(b0.y, b1.y, alpha) * this.ppm;
    const bz = Math.max(0, lerp(b0.z, b1.z, alpha));

    // The shadow is the ball's ground truth; the sprite lifts away from it.
    this.ballShadow.x = bx;
    this.ballShadow.y = by;
    this.ballShadow.alpha = 0.35 / (1 + bz * 0.35);
    this.ballShadow.scale.set(1 + bz * 0.06);

    const lift = bz * this.ppm * 0.55;
    this.ball.x = bx;
    this.ball.y = by - lift;
    this.ball.scale.set(1 + Math.min(bz / GOAL_HEIGHT, 4) * 0.22);
  }
}
