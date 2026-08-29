/* ============================================================================
 * TRAITS — what makes one player different from another with the same numbers.
 *
 * THE PROBLEM. Two wingers with identical Dribbling behave identically in this
 * engine, because every decision is scored in one currency and the currency
 * only reads ability. Ability tells you how WELL a player does something. It
 * says nothing about what he TRIES, and what a footballer tries is most of what
 * makes him recognisable: two players of equal ability, one of whom takes the
 * shot and one of whom squares it, are not interchangeable, and everybody
 * watching can tell them apart within ten minutes.
 *
 * Three attributes were also, on inspection, read by no code whatsoever —
 * Teamwork, Bravery and Agility — sitting on every player in the database
 * doing nothing at all. Any model of temperament has to be built out of those
 * or it is not modelling temperament, it is re-reading ability under a new
 * name. (An earlier note in perception.ts claimed Flair was a fourth. It is
 * not: there is no Flair attribute in this engine's schema, and inventing one
 * would mean inventing a value for it on every player in the database.)
 *
 * THE MODEL. Six dispositions, derived once from the attributes, each of which
 * BIASES an option's value rather than replacing the scorer. That distinction
 * matters: a flair player does not dribble into three men because he is a
 * flair player. He weighs the same options everybody weighs and leans towards
 * the braver one, and when it is plainly wrong the arithmetic still says so.
 *
 * The consequence you can see is that the same staged chance, handed to two
 * different players, becomes two different pieces of football: one of them
 * takes a touch and drives at the full-back, the other lays it off first time
 * and runs for the return.
 *
 * No randomness anywhere. Traits are a pure function of the attributes, so a
 * player is the same player in every match, which is exactly what makes him
 * recognisable across a season.
 * ========================================================================== */

import { attr01 } from "./math";
import type { Attributes } from "./types";

export interface Traits {
  /** Backs himself to beat a man rather than give it. Dribbling, Agility,
   *  Bravery — the last two because you need to be able to move to bother
   *  trying, and because taking a man on invites a kick. */
  adventure: number;
  /** Looks for the difficult ball. Scales how heavily he discounts a pass for
   *  the risk of losing it, which is the difference between the midfielder who
   *  plays the pass that breaks a line and the one who recycles. */
  imagination: number;
  /** How readily he shoots from range rather than working a better position. */
  ambition: number;
  /** Plays for the team. Raises what a pass to a better-placed man is worth
   *  against carrying it himself. */
  selflessness: number;
  /** How hard he works off the ball to get back into shape. */
  industry: number;
  /** How willing he is to put his body in the way — a challenge, or a shot. */
  courage: number;
}

/** A weighted blend of attributes, 0..1. */
const blend = (...parts: Array<[number, number]>): number => {
  let total = 0;
  let weight = 0;
  for (const [value, w] of parts) {
    total += value * w;
    weight += w;
  }
  return weight === 0 ? 0.5 : total / weight;
};

/**
 * A player's own general level: the mean of everything he does outfield.
 *
 * This is the thing every trait has to be measured AGAINST, and leaving it out
 * was the first version's mistake. Attributes in a real database are strongly
 * correlated — good players are good at most things — so a trait built as a
 * plain blend comes out as a restatement of overall quality. The lab said so
 * bluntly: the six traits correlated with each other between 0.67 and 0.96,
 * and the "least" list for every single one of them was goalkeepers.
 *
 * A temperament is not a level. The question is never "is he good at
 * dribbling", it is "is he better at dribbling than he is at everything else",
 * because THAT is what decides whether he tries it. Measured that way,
 * Bergkamp and Henry are different players rather than the same player at two
 * volumes.
 */
function baselineOf(a: Attributes): number {
  /* A goalkeeper's baseline has to include the things he is actually good at.
   * Outfielders carry 0 for the goalkeeping attributes, so a keeper measured
   * on outfield ability alone gets an artificially low baseline and everything
   * ordinary about him — his Teamwork, his Work Rate — reads as a pronounced
   * tendency. The lab caught it immediately: keepers topped the selflessness
   * and industry lists for the entire league. */
  const keeper = a.reflexes > 1 || a.handling > 1;
  const gk: Array<[number, number]> = keeper
    ? [
        [attr01(a.reflexes), 4], [attr01(a.handling), 4],
        [attr01(a.commandOfArea), 4], [attr01(a.kicking), 4],
      ]
    : [];
  return blend(
    ...gk,
    [attr01(a.passing), 1], [attr01(a.technique), 1], [attr01(a.firstTouch), 1],
    [attr01(a.dribbling), 1], [attr01(a.finishing), 1], [attr01(a.crossing), 1],
    [attr01(a.heading), 1], [attr01(a.tackling), 1], [attr01(a.marking), 1],
    [attr01(a.longShots), 1], [attr01(a.vision), 1], [attr01(a.decisions), 1],
    [attr01(a.anticipation), 1], [attr01(a.composure), 1], [attr01(a.offTheBall), 1],
    [attr01(a.positioning), 1], [attr01(a.concentration), 1], [attr01(a.teamwork), 1],
    [attr01(a.aggression), 1], [attr01(a.bravery), 1], [attr01(a.workRate), 1],
    [attr01(a.agility), 1], [attr01(a.strength), 1], [attr01(a.balance), 1],
    [attr01(a.stamina), 1],
  );
}

/** How far a deviation from his own level is stretched across the 0..1 range.
 *  At 2.6 a player two points of attribute above his own mean in the things
 *  that matter reads as a pronounced tendency, which is about right. */
const TRAIT_GAIN = 2.6;

/** Re-centre a blend on the player's own level. 0.5 is "no more inclined to
 *  this than to anything else he does". */
const relative = (value: number, baseline: number): number =>
  Math.max(0, Math.min(1, 0.5 + (value - baseline) * TRAIT_GAIN));

export function deriveTraits(a: Attributes): Traits {
  const bravery = attr01(a.bravery);
  const teamwork = attr01(a.teamwork);
  const base = baselineOf(a);
  const rel = (v: number): number => relative(v, base);
  return {
    adventure: rel(blend(
      [attr01(a.dribbling), 3],
      [attr01(a.agility), 2],
      [bravery, 1.5],
      [attr01(a.balance), 1],
      // A player who gives it away under pressure learns not to try things.
      [attr01(a.composure), 0.5],
    )),
    imagination: rel(blend(
      [attr01(a.vision), 3],
      [attr01(a.passing), 1.5],
      [attr01(a.technique), 1],
      [attr01(a.decisions), 1],
    )),
    ambition: rel(blend(
      [attr01(a.longShots), 3],
      [attr01(a.technique), 1],
      [attr01(a.composure), 1],
    )),
    selflessness: rel(blend([teamwork, 3], [attr01(a.decisions), 1.5], [attr01(a.workRate), 1])),
    industry: rel(blend([attr01(a.workRate), 3], [attr01(a.stamina), 1.5], [teamwork, 1.5])),
    courage: rel(blend([bravery, 3], [attr01(a.aggression), 1.5], [attr01(a.strength), 1])),
  };
}

/**
 * A short label for the pre-match screen and the player panel.
 *
 * Only reports a trait that is genuinely at one end of the range — a list
 * telling you every player is "balanced" is a list nobody reads. Ordered so
 * the most distinctive thing about a player comes first.
 */
export function describeTraits(t: Traits): string[] {
  const out: Array<{ text: string; strength: number }> = [];
  /* Thresholds sized to the real spread. Traits are deviations from a
   * player's own level, so their standard deviation across the league is
   * around a tenth rather than a third; at the first version's 0.68/0.34 not
   * one player in the database read as anything at all. */
  const note = (value: number, high: string, low: string, floor = 0.62, ceil = 0.38): void => {
    if (value >= floor) out.push({ text: high, strength: value - 0.5 });
    else if (value <= ceil) out.push({ text: low, strength: 0.5 - value });
  };
  note(t.adventure, "Takes players on", "Keeps it simple");
  note(t.imagination, "Looks for the killer ball", "Plays the safe pass");
  note(t.ambition, "Shoots from distance", "Works a better position");
  note(t.selflessness, "Plays for the team", "Looks for it himself");
  note(t.industry, "Runs all afternoon", "Saves himself");
  note(t.courage, "Puts his head in", "Stays out of it");
  return out
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)
    .map((x) => x.text);
}
