/* ============================================================================
 * PLAYSTYLES — the Manager's six systems as team instructions.
 *
 * The Manager expresses a system as a name and a rock-paper-scissors table:
 * Possession beats Direct, High Press beats Possession, Counter beats High
 * Press, and so on. That table is a shortcut for something this engine can
 * actually play out, so instead of importing the multipliers, each style is
 * translated into the instructions that PRODUCE the same relationships:
 *
 *   High Press really does push its line up and hunt the ball high, which is
 *   really what hurts a side trying to play out — and really what a Counter
 *   side exploits, because there is space in behind. The matchup emerges from
 *   the sliders rather than being asserted by a table.
 *
 * The Manager's own edge table is still the right thing for ITS season
 * simulation; this is what the same choice means when the match is played.
 * ========================================================================== */

import type { TeamInstructions } from "../core/types";
import type { ManagerStyle } from "./contract";

export interface StyleProfile {
  instructions: TeamInstructions;
  /** One line, for the pre-match screen. */
  blurb: string;
}

const STYLES: Record<ManagerStyle, StyleProfile> = {
  Possession: {
    blurb: "Short passes, patient build-up, squeeze the game when it is lost.",
    instructions: {
      mentality: 4,
      tempo: 0.38,
      width: 0.55,
      defensiveLine: 0.62,
      lineOfEngagement: 0.55,
      pressing: 0.55,
      passingDirectness: 0.18,
      counterPress: true,
      counter: false,
      timeWasting: 0,
    },
  },
  "High Press": {
    blurb: "Hunt the ball high, defend on the halfway line, live with the risk.",
    instructions: {
      mentality: 5,
      tempo: 0.72,
      width: 0.62,
      defensiveLine: 0.82,
      lineOfEngagement: 0.88,
      pressing: 0.92,
      passingDirectness: 0.45,
      counterPress: true,
      counter: false,
      timeWasting: 0,
    },
  },
  Counter: {
    blurb: "Sit off, keep the shape, break at pace the moment the ball turns over.",
    instructions: {
      mentality: 3,
      tempo: 0.6,
      width: 0.42,
      defensiveLine: 0.32,
      lineOfEngagement: 0.28,
      pressing: 0.32,
      passingDirectness: 0.78,
      counterPress: false,
      counter: true,
      timeWasting: 0.2,
    },
  },
  Direct: {
    blurb: "Forward at the first opportunity, get it wide, get it in the box.",
    instructions: {
      mentality: 5,
      tempo: 0.76,
      width: 0.72,
      defensiveLine: 0.55,
      lineOfEngagement: 0.5,
      pressing: 0.5,
      passingDirectness: 0.82,
      counterPress: false,
      counter: false,
      timeWasting: 0,
    },
  },
  "Park the Bus": {
    blurb: "Two banks behind the ball, concede the ball, dare them to break you down.",
    instructions: {
      mentality: 1,
      tempo: 0.3,
      width: 0.34,
      defensiveLine: 0.16,
      lineOfEngagement: 0.18,
      pressing: 0.24,
      passingDirectness: 0.62,
      counterPress: false,
      counter: true,
      timeWasting: 0.75,
    },
  },
  "Route One": {
    blurb: "Straight to the front man, feed off the knock-downs, chaos as a plan.",
    instructions: {
      mentality: 4,
      tempo: 0.82,
      width: 0.5,
      defensiveLine: 0.44,
      lineOfEngagement: 0.42,
      pressing: 0.45,
      passingDirectness: 1,
      counterPress: false,
      counter: false,
      timeWasting: 0.1,
    },
  },
};

export const STYLE_NAMES = Object.keys(STYLES) as ManagerStyle[];

export function styleProfile(style: string | undefined): StyleProfile {
  const found = style ? STYLES[style as ManagerStyle] : undefined;
  return found ?? (STYLES.Possession as StyleProfile);
}

export function instructionsFor(style: string | undefined): TeamInstructions {
  return { ...styleProfile(style).instructions };
}

/**
 * How one system reads against another, for the pre-match screen. This is the
 * Manager's own rock-paper-scissors relationships stated in words: the match
 * itself does not consult it, it plays the sliders out.
 */
export function styleMatchup(mine: string, theirs: string): string | null {
  const beats: Record<string, string[]> = {
    Possession: ["Direct", "Route One"],
    "High Press": ["Possession"],
    Counter: ["High Press"],
    Direct: ["Park the Bus"],
    "Park the Bus": ["Counter"],
    "Route One": [],
  };
  if ((beats[mine] ?? []).includes(theirs)) return `${mine} tends to have the better of ${theirs}`;
  if ((beats[theirs] ?? []).includes(mine)) return `${theirs} tends to have the better of ${mine}`;
  return null;
}
