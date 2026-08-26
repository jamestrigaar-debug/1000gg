import type { RNG } from '../rng/SeededRNG';

/**
 * Dice, in the standard tabletop notation.
 *
 * Everything the rules layer resolves goes through here, so that a die is a die
 * everywhere in the simulation and every roll is reproducible from the world seed.
 * The item catalog already carries its damage in this notation, which is why it was
 * preserved verbatim when the catalog was imported.
 */

/**
 * A parsed dice expression, such as 2d6+1.
 */
export interface DiceExpression {
  /** Number of dice rolled */
  readonly count: number;
  /** Faces per die */
  readonly sides: number;
  /** Flat modifier added after the dice */
  readonly modifier: number;
}

/**
 * The outcome of rolling an expression.
 */
export interface DiceRoll {
  /** The expression that was rolled */
  readonly expression: DiceExpression;
  /** Each die face, in the order rolled */
  readonly dice: readonly number[];
  /** Sum of the dice plus the modifier */
  readonly total: number;
}

const NOTATION = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i;

/**
 * Parses dice notation.
 *
 * @param notation Expression such as "d20", "2d6", or "1d4+1"
 * @returns The parsed expression
 * @throws Error if the notation cannot be understood, since a silently mis-parsed
 *   weapon would be a balance bug that is very hard to trace back
 */
export function parseDice(notation: string): DiceExpression {
  const match = NOTATION.exec(notation);
  if (!match) throw new Error(`Unrecognised dice notation: "${notation}"`);

  const count = match[1] === '' ? 1 : parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3].replace(/\s+/g, ''), 10) : 0;

  if (count < 1 || sides < 1) {
    throw new Error(`Dice notation out of range: "${notation}"`);
  }
  return { count, sides, modifier };
}

/**
 * Rolls a single die.
 * @param rng Seeded generator
 * @param sides Faces on the die
 * @returns A face in [1, sides]
 */
export function rollDie(rng: RNG, sides: number): number {
  return rng.nextInt(1, sides);
}

/**
 * Rolls a twenty-sided die.
 * @param rng Seeded generator
 * @returns A face in [1, 20]
 */
export function rollD20(rng: RNG): number {
  return rng.nextInt(1, 20);
}

/**
 * Rolls a parsed expression.
 * @param rng Seeded generator
 * @param expression Expression to roll
 * @returns Every die face and the total
 */
export function rollExpression(rng: RNG, expression: DiceExpression): DiceRoll {
  const dice: number[] = [];
  for (let i = 0; i < expression.count; i++) {
    dice.push(rollDie(rng, expression.sides));
  }
  const total = dice.reduce((sum, d) => sum + d, 0) + expression.modifier;
  return { expression, dice, total };
}

/**
 * Parses and rolls notation in one step.
 * @param rng Seeded generator
 * @param notation Expression such as "1d8+1"
 * @returns Every die face and the total
 */
export function roll(rng: RNG, notation: string): DiceRoll {
  return rollExpression(rng, parseDice(notation));
}

/**
 * Rolls an expression with its dice doubled, for a critical hit.
 *
 * The handbook doubles the dice and not the modifier, so a critical with a dagger is
 * 2d4 plus the ability modifier rather than 2 x (1d4 + modifier).
 *
 * @param rng Seeded generator
 * @param expression Expression to roll
 * @returns Every die face and the total
 */
export function rollCritical(rng: RNG, expression: DiceExpression): DiceRoll {
  return rollExpression(rng, { ...expression, count: expression.count * 2 });
}

/**
 * The expected value of an expression, used for balance work and tests.
 * @param expression Expression to evaluate
 * @returns Mean total
 */
export function averageOf(expression: DiceExpression): number {
  return expression.count * ((expression.sides + 1) / 2) + expression.modifier;
}

/**
 * The lowest and highest totals an expression can produce.
 * @param expression Expression to evaluate
 * @returns Minimum and maximum totals
 */
export function rangeOf(expression: DiceExpression): { min: number; max: number } {
  return {
    min: expression.count + expression.modifier,
    max: expression.count * expression.sides + expression.modifier,
  };
}
