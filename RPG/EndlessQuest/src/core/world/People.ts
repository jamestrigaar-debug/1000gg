import { SeededRNG } from '../rng/SeededRNG';
import type { Settlement } from './Settlement';
import { generateVillagerName } from '../lore/Names';
import { PEOPLE_PER_SETTLEMENT } from '../SimulationConstants';

/**
 * The people of the Thornmarch.
 *
 * A settlement that is only a tile where the Mark cools is a supply depot, not a place.
 * What makes somewhere worth walking back to is that there is somebody in it who wanted
 * something last time you passed, and remembers whether you did anything about it.
 *
 * People are generated from the world seed like settlements are, so a given world always
 * has the same midwife in the same village. What is not generated is what happens
 * between them and the character: their needs, and what they come to think of you.
 */

/** What somebody is, which decides what they are likely to want. */
export enum Role {
  MIDWIFE = 'midwife',
  SMITH = 'smith',
  PRIEST = 'priest',
  REEVE = 'reeve',
  WIDOW = 'widow',
  DROVER = 'drover',
  BOY = 'boy',
  BEGGAR = 'beggar',
}

/** How each role introduces itself, and how it is listed. */
export const ROLE_TITLE: Record<Role, string> = {
  [Role.MIDWIFE]: 'the midwife',
  [Role.SMITH]: 'the smith',
  [Role.PRIEST]: 'the priest',
  [Role.REEVE]: 'the reeve',
  [Role.WIDOW]: 'the widow',
  [Role.DROVER]: 'the drover',
  [Role.BOY]: 'a boy',
  [Role.BEGGAR]: 'a beggar',
};

/**
 * How somebody deals with whoever is in front of them.
 *
 * The Guide's own list. It is the single cheapest thing that makes two villagers of the
 * same trade feel like different people, and it is doing mechanical work as well as
 * decorative: a suspicious man is harder to get anything out of than a friendly one.
 */
export enum Trait {
  ARGUMENTATIVE = 'argumentative',
  ARROGANT = 'arrogant',
  BLUSTERING = 'blustering',
  RUDE = 'rude',
  CURIOUS = 'curious',
  FRIENDLY = 'friendly',
  HONEST = 'honest',
  HOT_TEMPERED = 'hot-tempered',
  IRRITABLE = 'irritable',
  PONDEROUS = 'ponderous',
  QUIET = 'quiet',
  SUSPICIOUS = 'suspicious',
}

/**
 * What each trait is worth on a social check, for or against.
 *
 * A friendly man meets you halfway; a suspicious one has already decided something about
 * the mark on your throat.
 */
export const TRAIT_MODIFIER: Record<Trait, number> = {
  [Trait.ARGUMENTATIVE]: -2,
  [Trait.ARROGANT]: -2,
  [Trait.BLUSTERING]: -1,
  [Trait.RUDE]: -2,
  [Trait.CURIOUS]: 2,
  [Trait.FRIENDLY]: 3,
  [Trait.HONEST]: 1,
  [Trait.HOT_TEMPERED]: -2,
  [Trait.IRRITABLE]: -2,
  [Trait.PONDEROUS]: 0,
  [Trait.QUIET]: -1,
  [Trait.SUSPICIOUS]: -3,
};

/**
 * How somebody carries themselves, said in one clause.
 *
 * Adapted from the Guide's table of mannerisms to a country where nobody has had a good
 * year. Appended to what they say, so the same sentence out of two mouths is not the
 * same sentence.
 */
export const MANNERISMS: readonly string[] = [
  // Each of these has to finish both "They speak ___" and "speaking ___", so they are
  // written as adverbial phrases and never as clauses with a finite verb in them.
  'without ever quite finishing a sentence',
  'in a voice pitched low enough that you lean in',
  'too loudly, as though you were further off than you are',
  'while working at something in their hands',
  'without once looking at your throat, which takes effort',
  'in the flat way of somebody reciting',
  'with a laugh in the wrong places',
  'while watching the road behind you',
  'slowly, choosing every word like it costs',
  'in a rush, as if the saying of it were the dangerous part',
  'with the local oath in it twice',
  'and repeating the last few words, quieter',
  'while chewing something they do not offer to share',
  'with their arms folded and their weight on the back foot',
  'in the accent of somewhere a long way from here',
  'with their eyes on the sky the whole time',
];

/**
 * What somebody holds to, what holds them, and what they would rather you did not know.
 *
 * The Guide's ideals, bonds and flaws, written for this country. They are not decoration:
 * a character who works out what somebody cares about can use it, which is the Guide's
 * rule and the most interesting thing in its social chapter.
 */
export const IDEALS: readonly string[] = [
  'that the dead are owed the words, whoever they were',
  'that a debt is a debt and the Church has no part in it',
  'that people who stay are worth more than people who leave',
  'that mercy is the only thing the Long Dusk has not taken yet',
  'that the parish comes before the man, always',
  'that nobody should die out of doors',
  'that what is promised is done, or the word means nothing',
];

export const BONDS: readonly string[] = [
  'a daughter sent south before the burnings, who has not written',
  'a brother hanged at the same tree, on the same morning',
  'the last man who came through here marked, and what became of him',
  'a stretch of ground their family has worked for four generations',
  'the child in the back room who is not getting better',
  'a debt to somebody in the next village that they cannot pay',
  'the bell that was taken out of the chapel, and where it went',
];

export const SECRETS: readonly string[] = [
  'they told the Chain where to look, and a man died of it',
  'they have a Widow\u2019s Coin buried under the threshold and have not opened it',
  'the grave they dug last winter has nobody in it',
  'they have been taking more than their share since the stores got low',
  'they know exactly what happened at the tree and have said nothing',
  'they have already decided to leave, and have told no one',
];

/**
 * Somebody who lives somewhere.
 */
export interface Person {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  /** The settlement they belong to */
  readonly place: string;
  readonly x: number;
  readonly y: number;
  /**
   * What they have come to think of the character, from -100 to 100.
   *
   * Progress rather than generation: it is what this run did, so it is saved.
   */
  disposition: number;
  /** True once the character has actually spoken to them */
  met: boolean;
  /** How they deal with people, which is worth something on every social check */
  readonly trait: Trait;
  /** How they carry themselves, appended to what they say */
  readonly mannerism: string;
  /** What they hold to; appealing to it shifts how they take you */
  readonly ideal: string;
  /** What holds them */
  readonly bond: string;
  /** What they would rather you did not know */
  readonly secret: string;
  /**
   * True once the character has worked out what this person cares about.
   *
   * Progress rather than generation, so it is saved: it is something this run learned.
   */
  read: boolean;
  /** True once the character has held their secret over them; it only works once */
  pressed?: boolean;
  /** True once they will do as they are told, whatever they think of you */
  owes?: boolean;
}

/**
 * Roles that turn up in a village, weighted by how common they are.
 */
const ROLE_POOL: readonly Role[] = [
  Role.REEVE,
  Role.SMITH,
  Role.PRIEST,
  Role.MIDWIFE,
  Role.WIDOW,
  Role.WIDOW,
  Role.DROVER,
  Role.BOY,
  Role.BOY,
  Role.BEGGAR,
];

/**
 * Populates the settlements of a world.
 *
 * Drawn from a generator forked off the seed, so adding people to the game moved nothing
 * about the worlds that already existed, and so a reload rebuilds exactly the same
 * village with exactly the same people in it.
 *
 * @param seedString The world seed
 * @param settlements The settlements to populate
 * @returns Everybody in the world
 */
export function populate(seedString: string, settlements: readonly Settlement[]): Person[] {
  const rng = new SeededRNG(`${seedString}:people`);
  const people: Person[] = [];

  for (const settlement of settlements) {
    const count = rng.nextInt(PEOPLE_PER_SETTLEMENT.min, PEOPLE_PER_SETTLEMENT.max);
    const taken = new Set<Role>();
    const named = new Set<string>();

    for (let i = 0; i < count; i++) {
      // A village has one reeve and one priest, but can have any number of widows.
      let role = ROLE_POOL[rng.nextInt(0, ROLE_POOL.length - 1)];
      let attempts = 0;
      while (taken.has(role) && role !== Role.WIDOW && role !== Role.BOY && attempts < 8) {
        role = ROLE_POOL[rng.nextInt(0, ROLE_POOL.length - 1)];
        attempts++;
      }
      taken.add(role);

      const traits = Object.values(Trait);

      // Two people of the same name in one village reads as a bug rather than as a
      // coincidence, so a repeat is redrawn.
      let name = generateVillagerName(rng);
      for (let attempt = 0; named.has(name) && attempt < 12; attempt++) {
        name = generateVillagerName(rng);
      }
      named.add(name);

      people.push({
        id: `${settlement.name}:${i}`,
        name,
        role,
        place: settlement.name,
        x: settlement.x,
        y: settlement.y,
        disposition: 0,
        met: false,
        trait: traits[rng.nextInt(0, traits.length - 1)],
        mannerism: MANNERISMS[rng.nextInt(0, MANNERISMS.length - 1)],
        ideal: IDEALS[rng.nextInt(0, IDEALS.length - 1)],
        bond: BONDS[rng.nextInt(0, BONDS.length - 1)],
        secret: SECRETS[rng.nextInt(0, SECRETS.length - 1)],
        read: false,
      });
    }
  }

  return people;
}

/**
 * Finds the person a line of English is addressed to.
 *
 * A village holds three or four people, and until now the game chose which of them you
 * were speaking to. That is a strange thing to take out of a player's hands, and it made
 * nonsense of giving everybody a name, a trade and a temperament: you could see that the
 * priest was the one who would know about the rites, and had no way to say so.
 *
 * Matching is deliberately loose -- a first name, a byname, a trade, or "the priest" --
 * because a player types what they would say, not an identifier.
 *
 * @param words The line, already lowercased and split
 * @param here The people present
 * @returns Who was meant, or undefined if nobody was named
 */
export function matchPerson(words: readonly string[], here: readonly Person[]): Person | undefined {
  let best: { person: Person; score: number } | undefined;

  for (const person of here) {
    const names = person.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const trade = ROLE_TITLE[person.role].toLowerCase().split(/[^a-z]+/).filter(Boolean);

    let score = 0;
    for (const word of words) {
      if (word.length < 3) continue;
      if (names.includes(word)) score += 3;
      else if (trade.includes(word)) score += 2;
      else if (names.some((part) => part.startsWith(word) && word.length >= 4)) score += 1;
    }

    if (score > 0 && (!best || score > best.score)) best = { person, score };
  }

  return best?.person;
}

/**
 * Everybody standing on a tile.
 * @param people Everybody in the world
 * @param x Map X coordinate
 * @param y Map Y coordinate
 * @returns The people there
 */
export function peopleAt(people: readonly Person[], x: number, y: number): Person[] {
  return people.filter((person) => person.x === x && person.y === y);
}

/**
 * Finds somebody by id.
 * @param people Everybody in the world
 * @param id Person id
 * @returns The person, or undefined
 */
export function personById(people: readonly Person[], id: string): Person | undefined {
  return people.find((person) => person.id === id);
}

/**
 * Describes how somebody regards the character, in words rather than numbers.
 * @param disposition Their disposition, from -100 to 100
 * @returns A short label
 */
export function regard(disposition: number): string {
  if (disposition <= -60) return 'hates you';
  if (disposition <= -20) return 'wants you gone';
  if (disposition < 20) return 'has no opinion of you';
  if (disposition < 60) return 'is glad you came';
  return 'owes you, and knows it';
}
