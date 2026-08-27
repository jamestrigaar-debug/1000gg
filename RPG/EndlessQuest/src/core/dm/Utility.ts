import type { RNG } from '../rng/SeededRNG';
import { Temper } from './Instance';
import type { Occupant } from './Instance';
import { Intent, Tide } from './Blackboard';

/**
 * What a thing does on its turn, and why.
 *
 * Every option is scored, and the score is the thing's own opinion rather than the
 * correct answer: a proud knight scores standing and fighting highly whatever the
 * arithmetic says, and a cautious bandit scores leaving highly the moment it starts
 * losing. That is what makes two creatures with identical numbers feel like different
 * opponents, and it is a great deal cheaper than making either of them clever.
 *
 * The scores are then nudged by what the character has been doing, which is the whole
 * of the DM's "intent recognition": somebody who charges everything gets met with a
 * held line, and somebody who backs off and heals gets pressed.
 */

/** What a thing can do with its turn. */
export enum Move {
  /** Hit whoever is in front of it */
  ATTACK = 'attack',
  /** Hold ground and be harder to hit */
  BRACE = 'brace',
  /** Bring the others */
  CALL = 'call',
  /** Get out */
  FLEE = 'flee',
  /** Wait for the character to commit */
  BIDE = 'bide',
}

/**
 * How the thing's own nature scores each move, before the situation is weighed.
 *
 * A zero is not a low score: it means the thing does not do that at all. A proud thing
 * has no entry for running, and no amount of being nearly dead gives it one.
 */
const TEMPERAMENT: Record<Temper, Record<Move, number>> = {
  [Temper.SAVAGE]: {
    [Move.ATTACK]: 10,
    [Move.BRACE]: 1,
    [Move.CALL]: 0,
    [Move.FLEE]: 1,
    [Move.BIDE]: 0,
  },
  [Temper.CAUTIOUS]: {
    [Move.ATTACK]: 5,
    [Move.BRACE]: 3,
    [Move.CALL]: 2,
    [Move.FLEE]: 4,
    [Move.BIDE]: 5,
  },
  [Temper.DISCIPLINED]: {
    [Move.ATTACK]: 6,
    [Move.BRACE]: 5,
    [Move.CALL]: 6,
    [Move.FLEE]: 1,
    [Move.BIDE]: 3,
  },
  [Temper.PROUD]: {
    [Move.ATTACK]: 9,
    [Move.BRACE]: 4,
    [Move.CALL]: 1,
    [Move.FLEE]: 0,
    [Move.BIDE]: 2,
  },
};

/**
 * What the situation is worth adding to each move.
 *
 * @param occupant The thing deciding
 * @param tide How the fight is going for the character
 * @param intent How the character has been playing
 * @param friends How many others are still in it
 * @returns The situational part of the score
 */
export function situational(
  occupant: Occupant,
  tide: Tide,
  intent: Intent,
  friends: number
): Record<Move, number> {
  const hurt = 1 - occupant.hp / occupant.maxHp;
  const scores: Record<Move, number> = {
    [Move.ATTACK]: 0,
    [Move.BRACE]: 0,
    [Move.CALL]: 0,
    [Move.FLEE]: 0,
    [Move.BIDE]: 0,
  };

  // Being hurt argues for leaving, and against standing in the open.
  scores[Move.FLEE] += hurt * 8;
  scores[Move.ATTACK] -= hurt * 3;
  scores[Move.BRACE] += hurt * 2;

  // A thing that is winning presses; a thing that is losing does not.
  if (tide === Tide.DESPERATE || tide === Tide.LOSING) scores[Move.ATTACK] += 3;
  if (tide === Tide.WINNING) {
    scores[Move.CALL] += 3;
    scores[Move.BRACE] += 2;
  }

  // Alone is a worse place to be than in company.
  if (friends === 0) {
    scores[Move.CALL] += 3;
    scores[Move.FLEE] += 2;
  }
  if (occupant.alerted) scores[Move.CALL] -= 5;

  // And what the character keeps doing. Somebody who charges everything walks onto a
  // braced line; somebody who breaks off and patches themselves up gets followed.
  switch (intent) {
    case Intent.AGGRESSIVE:
      scores[Move.BRACE] += 4;
      scores[Move.BIDE] += 3;
      break;
    case Intent.CAREFUL:
      scores[Move.ATTACK] += 3;
      scores[Move.CALL] += 1;
      break;
    case Intent.ACQUISITIVE:
      // Let them get their hands full.
      scores[Move.BIDE] += 4;
      break;
    case Intent.HURRIED:
      scores[Move.ATTACK] += 2;
      break;
    case Intent.UNREAD:
    default:
      break;
  }

  return scores;
}

/**
 * Chooses what a thing does this turn.
 *
 * @param occupant The thing deciding
 * @param tide How the fight is going
 * @param intent How the character plays
 * @param friends How many others are still in it
 * @param rng Seeded generator, for breaking ties without a fixed order
 * @returns The move, and what it scored
 */
export function decide(
  occupant: Occupant,
  tide: Tide,
  intent: Intent,
  friends: number,
  rng: RNG
): { move: Move; score: number } {
  const nature = TEMPERAMENT[occupant.temper];
  const situation = situational(occupant, tide, intent, friends);

  let best = Move.ATTACK;
  let bestScore = -Infinity;

  for (const move of Object.values(Move)) {
    // A zero in the temperament table means the thing does not do this, ever -- not that
    // it is unlikely to. A proud thing that runs when the arithmetic says it should is
    // not a proud thing, and the whole reason for having tempers is that they hold when
    // the situation argues against them.
    if (nature[move] === 0) continue;

    // A little noise so that identical situations do not produce identical fights, and
    // so two things in a room do not act in lockstep.
    const score = nature[move] + situation[move] + rng.nextFloat();
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }

  return { move: best, score: bestScore };
}
