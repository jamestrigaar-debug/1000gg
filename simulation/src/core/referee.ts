/* ============================================================================
 * THE REFEREE — an official with a personality, drawn once per match.
 *
 * Every match in this engine was officiated identically. The same foul
 * threshold, the same card threshold, the same patience with an advantage,
 * every time. That is not how football feels, and it is not how the research
 * report describes the problem either: a foul is resolved against "contact
 * severity, location, referee tendencies, game state and law", and only one of
 * those was missing here.
 *
 * A referee is worth having as an object for two reasons beyond flavour.
 *
 * FIRST, IT IS FREE VARIANCE OF THE RIGHT KIND. Match-to-match variation in
 * this engine came almost entirely from the ball bouncing differently. A
 * fussy official is a different match to play in — more restarts, more set
 * pieces, a booking early that changes how a midfielder tackles for the next
 * eighty minutes — without any player behaving differently. That is the sort
 * of variance that makes a season feel like a season.
 *
 * SECOND, IT IS A REAL LEVER. When the foul rate needs moving, it now has one
 * honest place to move rather than being smeared across the tackle model,
 * where it would distort who wins the ball as a side effect.
 *
 * Drawn from the match seed at construction, so it is deterministic, and so
 * two runs of the same fixture get the same official. He is constant for the
 * ninety minutes — a referee who became stricter halfway through would be a
 * different mechanic, and probably an annoying one.
 * ========================================================================== */

import { ADVANTAGE_SECONDS } from "./constants";
import type { Rng } from "./rng";

export interface Referee {
  /** Multiplies the chance a mistimed challenge is given. Below 1 he lets it
   *  flow; above 1 he is fussy and the game is full of free kicks. */
  strictness: number;
  /** Multiplies the chance a foul becomes a card. Independent of strictness:
   *  the official who gives everything and books nobody is a real type, and so
   *  is the one who lets it go until he suddenly doesn't. */
  cardHappy: number;
  /** How long he lets an advantage run before pulling it back. */
  advantageSeconds: number;
  /** A label for the pre-match screen and the commentary. */
  name: string;
}

/** The spread of officials. Deliberately narrow: a referee should colour a
 *  match, not decide it. At the extremes this moves the foul count by about a
 *  third either way, which is roughly the real spread between the strictest
 *  and most permissive officials in a league. */
const STRICT_MIN = 0.78;
const STRICT_MAX = 1.3;
const CARD_MIN = 0.7;
const CARD_MAX = 1.45;

/**
 * How he reads. Purely a label derived from the two numbers, so it can never
 * disagree with the behaviour it describes.
 */
function describe(strictness: number, cardHappy: number): string {
  const whistle =
    strictness < 0.9 ? "Lets it flow" : strictness > 1.15 ? "Whistle-happy" : "Even-handed";
  const cards = cardHappy < 0.85 ? "slow to book" : cardHappy > 1.2 ? "quick to book" : "fair";
  return `${whistle}, ${cards}`;
}

export function drawReferee(rng: Rng): Referee {
  const strictness = rng.range(STRICT_MIN, STRICT_MAX);
  const cardHappy = rng.range(CARD_MIN, CARD_MAX);
  return {
    strictness,
    cardHappy,
    /* A referee who lets a lot go also tends to let an advantage run, which is
     * the same instinct expressed twice. Tying them keeps him coherent instead
     * of being two unrelated dice. */
    advantageSeconds: ADVANTAGE_SECONDS * (1.3 - strictness * 0.3),
    name: describe(strictness, cardHappy),
  };
}
