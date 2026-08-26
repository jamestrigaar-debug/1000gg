import type { RNG } from '../rng/SeededRNG';
import { pick } from './Flavor';

/**
 * Deterministic name generation for Thornmarch places and people.
 *
 * Names are built from Anglo-Saxon-flavoured elements so that generated content reads
 * as the same culture as the hand-written lore. All generation is RNG-driven and
 * therefore reproducible for a given seed.
 */

/** Leading elements of settlement names. */
const PLACE_PREFIX: readonly string[] = [
  'Thorn',
  'Cold',
  'Gallow',
  'Hollow',
  'Grim',
  'Ash',
  'Mire',
  'Black',
  'Stone',
  'Raven',
  'Bram',
  'Wither',
  'Dun',
  'Kel',
  'Marrow',
  'Bone',
  'Fen',
  'Ward',
];

/** Trailing elements of settlement names. */
const PLACE_SUFFIX: readonly string[] = [
  'by',
  'mere',
  'fen',
  'beck',
  'wick',
  'ford',
  'holt',
  'combe',
  'stead',
  'thorpe',
  'moor',
  'gate',
  'hollow',
  'barrow',
];

/** Descriptors appended to a minority of settlements, e.g. "Thornby Under Stone". */
const PLACE_EPITHET: readonly string[] = [
  'Under Stone',
  'in the Mire',
  'the Lesser',
  'the Drowned',
  'Beyond',
  'the Quiet',
];

/** Given names used for Thornmarch commoners. */
const GIVEN_NAME: readonly string[] = [
  'Aldry',
  'Beorn',
  'Cwen',
  'Dunstan',
  'Edda',
  'Godric',
  'Hild',
  'Ivo',
  'Leofric',
  'Mildreth',
  'Oswin',
  'Rowena',
  'Sewell',
  'Tosti',
  'Ulf',
  'Wulfric',
];

/** Bynames, in the medieval fashion of trade or defect. */
const BYNAME: readonly string[] = [
  'the Thatcher',
  'One-Hand',
  'the Widow',
  'Ash-Eye',
  'the Younger',
  'Coldhearth',
  'the Reeve',
  'No-Tongue',
  'the Digger',
  'Crowfoot',
];

/**
 * Bynames that do not claim a trade.
 *
 * Somebody whose role the game states out loud must not also be carrying a byname that
 * contradicts it: "Sewell the Reeve, a boy of Bonebarrow" is a bug wearing a name.
 */
const PLAIN_BYNAME: readonly string[] = [
  'One-Hand',
  'Ash-Eye',
  'the Younger',
  'the Elder',
  'Coldhearth',
  'No-Tongue',
  'Crowfoot',
  'Winterborn',
  'Blackthumb',
  'Nine-Fingers',
  'the Quiet',
  'Hollowcheek',
];

/**
 * Probability that a settlement name receives a trailing epithet.
 */
const EPITHET_PROBABILITY = 0.25;

/**
 * Generates a settlement name.
 * @param rng Seeded generator
 * @returns Place name such as "Gallowfen" or "Thornby Under Stone"
 */
export function generateSettlementName(rng: RNG): string {
  const base = `${pick(PLACE_PREFIX, rng)}${pick(PLACE_SUFFIX, rng)}`;
  if (rng.nextFloat() < EPITHET_PROBABILITY) {
    return `${base} ${pick(PLACE_EPITHET, rng)}`;
  }
  return base;
}

/**
 * Generates a person's name.
 * @param rng Seeded generator
 * @returns Personal name such as "Hild the Widow"
 */
export function generatePersonName(rng: RNG): string {
  return `${pick(GIVEN_NAME, rng)} ${pick(BYNAME, rng)}`;
}

/**
 * Generates a name for somebody whose trade is stated separately.
 *
 * @param rng Seeded generator
 * @returns Personal name such as "Hild Crowfoot"
 */
export function generateVillagerName(rng: RNG): string {
  return `${pick(GIVEN_NAME, rng)} ${pick(PLAIN_BYNAME, rng)}`;
}
