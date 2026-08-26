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

    for (let i = 0; i < count; i++) {
      // A village has one reeve and one priest, but can have any number of widows.
      let role = ROLE_POOL[rng.nextInt(0, ROLE_POOL.length - 1)];
      let attempts = 0;
      while (taken.has(role) && role !== Role.WIDOW && role !== Role.BOY && attempts < 8) {
        role = ROLE_POOL[rng.nextInt(0, ROLE_POOL.length - 1)];
        attempts++;
      }
      taken.add(role);

      people.push({
        id: `${settlement.name}:${i}`,
        name: generateVillagerName(rng),
        role,
        place: settlement.name,
        x: settlement.x,
        y: settlement.y,
        disposition: 0,
        met: false,
      });
    }
  }

  return people;
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
