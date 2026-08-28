/* ============================================================================
 * ATTRIBUTE BRIDGE — a Manager player becomes a match-engine player.
 *
 * The Manager describes a footballer with one calibrated number (overall,
 * 25-96) and eight attributes (0-99). This engine needs thirty-two, on a
 * 1-20 scale, and every one of them drives a mechanic.
 *
 * Two rules make the conversion honest rather than invented:
 *
 *  1. OVERALL STAYS THE ANCHOR. The Manager's entire world — transfer values,
 *     league tables, the board's expectations — is calibrated on `overall`, so
 *     a 78-rated player must read as a 78-rated player here. Position profile
 *     against overall supplies the baseline for every attribute.
 *
 *  2. THE EIGHT ATTRIBUTES SUPPLY THE INDIVIDUAL. Two 78-rated wingers are not
 *     the same winger: one is quick, the other sees a pass. The Manager's own
 *     attributes are mapped onto the relevant engine attributes and blended
 *     against the baseline, so the difference between those two survives into
 *     the match.
 *
 * The blend is deliberately weighted towards the profile (0.6/0.4): a player
 * whose only listed strength is "speed 90" should still be a good footballer
 * everywhere if he is rated 85, because that is what the 85 means.
 * ========================================================================== */

import { clamp } from "../core/math";
import type { Attributes, Position } from "../core/types";
import type { ManagerAttrs, ManagerPlayer, ManagerPosition } from "./contract";

/** Manager's 0-99 scale onto the engine's 1-20. */
export const to20 = (v: number | undefined, fallback = 50): number =>
  clamp(((v ?? fallback) / 99) * 19 + 1, 1, 20);

/** Manager's 25-96 overall onto 1-20. 96 is a 20, 63 is about a 10. */
export const overallTo20 = (overall: number): number =>
  clamp(((overall - 30) / 66) * 19 + 1, 1, 20);

/** Manager positions do not carry a side; the formation slot supplies it. */
export function enginePosition(pos: ManagerPosition, slotSide: "L" | "R" | "C"): Position {
  switch (pos) {
    case "GK":
      return "GK";
    case "CB":
      return "DC";
    case "FB":
      return slotSide === "L" ? "DL" : "DR";
    case "DM":
      return "DM";
    case "CM":
      return "MC";
    case "AM":
      return "AM";
    case "WG":
      return slotSide === "L" ? "ML" : "MR";
    case "FW":
      return "ST";
    default:
      return "MC";
  }
}

/** Weight of each Manager attribute in each engine attribute. Anything not
 *  listed is carried entirely by the overall-and-profile baseline. */
type Source = Partial<Record<keyof ManagerAttrs | "strongFoot" | "weakFoot" | "mental", number>>;

const SOURCES: Partial<Record<keyof Attributes, Source>> = {
  // Technical — the feet and the head.
  passing: { creativity: 0.6, strongFoot: 0.4 },
  technique: { strongFoot: 0.7, creativity: 0.3 },
  firstTouch: { strongFoot: 0.5, creativity: 0.3, balance: 0.2 },
  dribbling: { strongFoot: 0.4, balance: 0.3, creativity: 0.3 },
  finishing: { strongFoot: 0.75, creativity: 0.25 },
  crossing: { strongFoot: 0.6, creativity: 0.4 },
  heading: { heading: 1 },
  longShots: { strongFoot: 0.6, strength: 0.4 },
  tackling: { strength: 0.5, mental: 0.5 },
  marking: { mental: 0.7, strength: 0.3 },
  // Mental — football intelligence, plus what the body allows.
  vision: { creativity: 0.7, mental: 0.3 },
  decisions: { mental: 0.8, creativity: 0.2 },
  anticipation: { mental: 0.8, speed: 0.2 },
  composure: { mental: 0.7, creativity: 0.3 },
  offTheBall: { mental: 0.5, speed: 0.3, creativity: 0.2 },
  positioning: { mental: 1 },
  concentration: { mental: 1 },
  teamwork: { mental: 0.7, fitness: 0.3 },
  aggression: { strength: 0.6, mental: 0.4 },
  bravery: { strength: 0.5, heading: 0.3, mental: 0.2 },
  workRate: { fitness: 0.8, mental: 0.2 },
  // Physical — read straight off the body.
  pace: { speed: 1 },
  acceleration: { speed: 0.8, balance: 0.2 },
  agility: { balance: 0.8, speed: 0.2 },
  stamina: { fitness: 1 },
  strength: { strength: 1 },
  jumpReach: { heading: 0.6, strength: 0.4 },
  balance: { balance: 1 },
  // Goalkeeping — the Manager has no keeper attributes, so these lean on the
  // baseline, with the body deciding the rest.
  reflexes: { balance: 0.5, speed: 0.3, mental: 0.2 },
  handling: { mental: 0.5, strength: 0.3, balance: 0.2 },
  commandOfArea: { heading: 0.4, strength: 0.3, mental: 0.3 },
  kicking: { strongFoot: 0.7, strength: 0.3 },
};

/** How much of each attribute a position needs, relative to the player's own
 *  rating. Mirrors the profiles in src/data, kept here so the bridge does not
 *  depend on the demo squad loader. */
const PROFILE: Record<Position, Partial<Record<keyof Attributes, number>>> = {
  GK: { reflexes: 1.1, handling: 1.05, commandOfArea: 1, kicking: 0.95, positioning: 1, concentration: 1,
        finishing: 0.3, dribbling: 0.35, tackling: 0.4, marking: 0.4, crossing: 0.3, longShots: 0.3,
        offTheBall: 0.4, pace: 0.7, acceleration: 0.7 },
  DC: { marking: 1.1, tackling: 1.1, heading: 1.1, jumpReach: 1.05, strength: 1.05, positioning: 1.05,
        bravery: 1.05, dribbling: 0.6, finishing: 0.4, crossing: 0.45, longShots: 0.5, offTheBall: 0.6 },
  DL: { crossing: 1, tackling: 1, marking: 0.95, pace: 1.05, stamina: 1.1, workRate: 1.05,
        finishing: 0.5, longShots: 0.6, heading: 0.8 },
  DR: { crossing: 1, tackling: 1, marking: 0.95, pace: 1.05, stamina: 1.1, workRate: 1.05,
        finishing: 0.5, longShots: 0.6, heading: 0.8 },
  DM: { tackling: 1.1, marking: 1, positioning: 1.05, teamwork: 1.05, anticipation: 1.05,
        finishing: 0.55, dribbling: 0.8, crossing: 0.7 },
  MC: { passing: 1.1, vision: 1.05, technique: 1.05, decisions: 1.05, stamina: 1.05,
        heading: 0.7, marking: 0.85 },
  ML: { crossing: 1.1, dribbling: 1.1, pace: 1.05, agility: 1.05, marking: 0.7, tackling: 0.75, heading: 0.7 },
  MR: { crossing: 1.1, dribbling: 1.1, pace: 1.05, agility: 1.05, marking: 0.7, tackling: 0.75, heading: 0.7 },
  AM: { vision: 1.15, passing: 1.1, technique: 1.1, firstTouch: 1.1, longShots: 1.05, composure: 1.05,
        marking: 0.55, tackling: 0.55, heading: 0.75 },
  ST: { finishing: 1.15, offTheBall: 1.15, composure: 1.1, anticipation: 1.05, heading: 1.05,
        marking: 0.5, tackling: 0.5, passing: 0.85, crossing: 0.7, vision: 0.9 },
};

/** SOURCES covers all thirty-two attributes; the test in tests/manager.test.ts
 *  fails if one is ever added to the engine and forgotten here. */
const ALL_KEYS = Object.keys(SOURCES) as (keyof Attributes)[];

/** How much the eight attributes are allowed to move a player away from what
 *  his overall says he is. */
const INDIVIDUAL_WEIGHT = 0.4;

export function convertAttributes(player: ManagerPlayer, position: Position): Attributes {
  const a = player.attrs ?? ({} as ManagerAttrs);
  const baseline = overallTo20(player.overall ?? 60);
  const profile = PROFILE[position] ?? {};

  const strongFoot = to20(Math.max(a.leftFoot ?? 0, a.rightFoot ?? 0));
  const weakFoot = to20(Math.min(a.leftFoot ?? 0, a.rightFoot ?? 0));
  const mental = to20(player.mentalityRating, 55);
  const source: Record<string, number> = {
    heading: to20(a.heading),
    fitness: to20(a.fitness),
    strength: to20(a.strength),
    leftFoot: to20(a.leftFoot),
    rightFoot: to20(a.rightFoot),
    speed: to20(a.speed),
    creativity: to20(a.creativity),
    balance: to20(a.balance),
    strongFoot,
    weakFoot,
    mental,
  };

  const out = {} as Attributes;
  for (const key of ALL_KEYS) {
    const weights = SOURCES[key] ?? {};
    let individual = 0;
    let total = 0;
    for (const [name, weight] of Object.entries(weights)) {
      individual += (source[name] ?? baseline) * (weight ?? 0);
      total += weight ?? 0;
    }
    const fromAttrs = total > 0 ? individual / total : baseline;
    const fromProfile = baseline * (profile[key] ?? 0.95);
    const blended = fromProfile * (1 - INDIVIDUAL_WEIGHT) + fromAttrs * INDIVIDUAL_WEIGHT;
    out[key] = clamp(Math.round(blended), 1, 20);
  }

  // Morale is a season-long number in the Manager; here it is worth a point
  // of composure and concentration either way, and no more.
  const moraleSwing = Math.round(((player.morale ?? 60) - 60) / 25);
  out.composure = clamp(out.composure + moraleSwing, 1, 20);
  out.concentration = clamp(out.concentration + moraleSwing, 1, 20);

  // An outfielder has no goalkeeping attributes and a keeper has no business
  // being read as an outfield player.
  if (position !== "GK") {
    out.reflexes = 1;
    out.handling = 1;
    out.commandOfArea = 1;
    out.kicking = clamp(Math.round(baseline * 0.6), 1, 20);
  }
  return out;
}

/** Preferred foot, from the two foot ratings. */
export function footFor(a: ManagerAttrs | undefined): "left" | "right" | "both" {
  const left = a?.leftFoot ?? 0;
  const right = a?.rightFoot ?? 0;
  if (Math.abs(left - right) <= 6) return "both";
  return left > right ? "left" : "right";
}
