/* ============================================================================
 * PITCH LAYER — the vector pitch, drawn once and cached.
 *
 * Every line here is a real IFAB measurement scaled by pixelsPerMetre, so the
 * view cannot quietly disagree with the simulation about where the six-yard
 * box is. Mowing stripes are drawn into the same container and the whole thing
 * is cached as a bitmap: it never changes, so it should never re-render.
 * ========================================================================== */

import { Container, Graphics } from "pixi.js";
import {
  CENTRE_CIRCLE_RADIUS,
  CORNER_ARC_RADIUS,
  GOAL_DEPTH,
  GOAL_WIDTH,
  PENALTY_SPOT_DIST,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from "../core/constants";
import { penaltyArea, sixYardBox, type Direction } from "../core/pitch";

export interface PitchTheme {
  grassDark: number;
  grassLight: number;
  line: number;
  lineAlpha: number;
  surround: number;
}

export const DEFAULT_THEME: PitchTheme = {
  grassDark: 0x2f6b34,
  grassLight: 0x35773a,
  line: 0xffffff,
  lineAlpha: 0.85,
  surround: 0x1d3f22,
};

/** Draw an arc as its own sub-path. Without the moveTo, the arc is appended to
 *  whatever path was drawn last and Pixi joins the two with a straight line —
 *  which is exactly the stray diagonal across the pitch it looks like. */
function arc(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
): void {
  const ppm = arcScale;
  g.moveTo((cx + Math.cos(from) * r) * ppm, (cy + Math.sin(from) * r) * ppm);
  g.arc(cx * ppm, cy * ppm, r * ppm, from, to);
}
/** Set once per build; the pitch is only ever built at one scale at a time. */
let arcScale = 1;

/** Number of mowing stripes across the length of the pitch. */
const STRIPES = 14;

export function buildPitch(ppm: number, theme: PitchTheme = DEFAULT_THEME): Container {
  const root = new Container();
  arcScale = ppm;
  const m = (v: number): number => v * ppm;
  const lineWidth = Math.max(1, ppm * 0.085);

  const surround = new Graphics();
  surround
    .rect(m(-10), m(-10), m(PITCH_LENGTH + 20), m(PITCH_WIDTH + 20))
    .fill(theme.surround);
  root.addChild(surround);

  // The strip of grass outside the touchlines, a shade darker than the pitch:
  // FM's apron reads as the same surface, mown differently.
  const apron = new Graphics();
  apron
    .rect(m(-4), m(-4), m(PITCH_LENGTH + 8), m(PITCH_WIDTH + 8))
    .fill(0x4e8c3c);
  root.addChild(apron);

  const grass = new Graphics();
  const stripeW = PITCH_LENGTH / STRIPES;
  for (let i = 0; i < STRIPES; i++) {
    grass
      .rect(m(i * stripeW), 0, m(stripeW), m(PITCH_WIDTH))
      .fill(i % 2 === 0 ? theme.grassDark : theme.grassLight);
  }
  root.addChild(grass);

  const lines = new Graphics();
  const stroke = { width: lineWidth, color: theme.line, alpha: theme.lineAlpha };

  lines.rect(0, 0, m(PITCH_LENGTH), m(PITCH_WIDTH)).stroke(stroke);
  lines.moveTo(m(PITCH_LENGTH / 2), 0).lineTo(m(PITCH_LENGTH / 2), m(PITCH_WIDTH)).stroke(stroke);
  lines
    .circle(m(PITCH_LENGTH / 2), m(PITCH_WIDTH / 2), m(CENTRE_CIRCLE_RADIUS))
    .stroke(stroke);
  lines.circle(m(PITCH_LENGTH / 2), m(PITCH_WIDTH / 2), lineWidth * 1.6).fill(theme.line);

  for (const dir of [1, -1] as Direction[]) {
    const pen = penaltyArea(dir);
    const six = sixYardBox(dir);
    lines
      .rect(m(pen.minX), m(pen.minY), m(pen.maxX - pen.minX), m(pen.maxY - pen.minY))
      .stroke(stroke);
    lines
      .rect(m(six.minX), m(six.minY), m(six.maxX - six.minX), m(six.maxY - six.minY))
      .stroke(stroke);

    const spotX = dir === 1 ? PITCH_LENGTH - PENALTY_SPOT_DIST : PENALTY_SPOT_DIST;
    lines.circle(m(spotX), m(PITCH_WIDTH / 2), lineWidth * 1.4).fill(theme.line);

    // The D: the arc of the centre circle's radius outside the box.
    const arcCentreX = spotX;
    const boxEdgeX = dir === 1 ? pen.minX : pen.maxX;
    const dx = Math.abs(arcCentreX - boxEdgeX);
    if (dx < CENTRE_CIRCLE_RADIUS) {
      const half = Math.acos(dx / CENTRE_CIRCLE_RADIUS);
      const base = dir === 1 ? Math.PI : 0;
      arc(lines, arcCentreX, PITCH_WIDTH / 2, CENTRE_CIRCLE_RADIUS, base - half, base + half);
      lines.stroke(stroke);
    }

    // Goal frame behind the line, with a hint of net inside it.
    const gx = dir === 1 ? PITCH_LENGTH : 0;
    const gy0 = PITCH_WIDTH / 2 - GOAL_WIDTH / 2;
    const netX = dir === 1 ? gx : gx - GOAL_DEPTH;
    lines
      .rect(m(netX), m(gy0), m(GOAL_DEPTH), m(GOAL_WIDTH))
      .fill({ color: 0xffffff, alpha: 0.1 })
      .stroke({ width: lineWidth * 1.2, color: theme.line, alpha: 0.8 });
  }

  for (const [cx, cy, start] of [
    [0, 0, 0],
    [PITCH_LENGTH, 0, Math.PI / 2],
    [PITCH_LENGTH, PITCH_WIDTH, Math.PI],
    [0, PITCH_WIDTH, -Math.PI / 2],
  ] as const) {
    arc(lines, cx, cy, CORNER_ARC_RADIUS, start, start + Math.PI / 2);
    lines.stroke(stroke);
  }

  root.addChild(lines);
  root.cacheAsTexture(true);
  return root;
}
