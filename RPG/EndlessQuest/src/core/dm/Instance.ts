import type { RNG } from '../rng/SeededRNG';
import type { CreatureArchetype } from '../lore/Bestiary';

/**
 * An adventure, formed before the player sets foot in it.
 *
 * This is the second layer of the game. Out in the country the play is survival: hours,
 * hunger, exposure, and the long walk between places. Inside one of these the play is
 * the opposite -- hit points, nerve, what is round the corner, and what you carry out.
 *
 * The important part is that the whole thing exists before the door opens. The Dungeon
 * Master lays out the rooms, decides what is standing in them, hides the loot, sets the
 * boss at the end and writes down why anybody would come here, and only then is the
 * player let in. What they see is what they have walked through; the rest is the DM's,
 * and it is already true.
 */

/**
 * What sort of place this is.
 *
 * Each carries its own signature: what it is made of, what lives in it, and the trick
 * it plays on whoever comes in.
 */
export enum InstanceKind {
  /** Stone corridors and dim light */
  DUNGEON = 'dungeon',
  /** Tents, fires, and men who chose this */
  BANDIT_CAMP = 'bandit_camp',
  /** Crumbled walls and older writing */
  RUIN = 'ruin',
  /** Dark, narrow, and going down */
  CAVE = 'cave',
  /** Close timber, and paths that are not paths */
  DEEP_WOOD = 'deep_wood',
  /** Fortified, held, and expecting company */
  HOLDFAST = 'holdfast',
}

/**
 * What a room is for.
 */
export enum RoomKind {
  /** Where you came in, and the way out */
  ENTRANCE = 'entrance',
  /** Ordinary ground between the things that matter */
  PASSAGE = 'passage',
  /** Something is standing here */
  GUARDED = 'guarded',
  /** Something is hidden here */
  CACHE = 'cache',
  /** Something here will happen to you */
  HAZARD = 'hazard',
  /** The end of it */
  LAIR = 'lair',
  /** Not on the way to anywhere; worth finding anyway */
  SECRET = 'secret',
}

/**
 * One room of an instance.
 */
export interface Room {
  readonly id: number;
  readonly kind: RoomKind;
  /** What it is called on the map the player builds as they go */
  readonly name: string;
  /** What the DM says on entering it the first time */
  readonly description: string;
  /** A detail that tells you what happened here before you came */
  readonly telling: string;
  /** Rooms reachable from this one */
  readonly exits: number[];
  /** Whether the character has been in here */
  entered: boolean;
  /** Whether whatever was here has been dealt with */
  cleared: boolean;
}

/**
 * Something the DM is running inside an instance.
 */
export interface Occupant {
  readonly id: string;
  readonly archetypeId: string;
  /** Which room it is in, which changes when the DM moves it */
  room: number;
  hp: number;
  readonly maxHp: number;
  /** Nerve. A thing whose nerve breaks runs rather than dying where it stands. */
  morale: number;
  /** Whether it has noticed the character */
  alerted: boolean;
  /** Whether it has left the fight */
  fled: boolean;
  /**
   * What has been done to it beyond damage.
   *
   * A thing with a broken arm swings worse; a thing that has been hobbled cannot leave.
   * This is the other side of the character's own wounds, and it is what makes aiming
   * at something worth the harder roll.
   */
  hurts: string[];
  /** Whether this is the thing the place is about */
  readonly boss: boolean;
  /** How it fights, which is the difference between a bandit and a knight */
  readonly temper: Temper;
}

/**
 * How a thing behaves when it is losing.
 *
 * Personality is cheaper than intelligence and reads better: a proud thing that will not
 * run is a different fight from a hungry thing that will, without either of them needing
 * to be clever.
 */
export enum Temper {
  /** Comes straight on and keeps coming */
  SAVAGE = 'savage',
  /** Fights while it is winning and leaves when it is not */
  CAUTIOUS = 'cautious',
  /** Holds ground, calls for the others */
  DISCIPLINED = 'disciplined',
  /** Will not run, whatever it costs */
  PROUD = 'proud',
}

/**
 * Something worth carrying out.
 */
export interface Prize {
  readonly itemId: string;
  readonly count: number;
  /** Which room it is in */
  readonly room: number;
  /** Whether it takes finding rather than just walking in */
  readonly hidden: boolean;
  /** Whether it has been taken */
  taken: boolean;
}

/**
 * A formed adventure.
 */
export interface Instance {
  readonly id: string;
  readonly kind: InstanceKind;
  /** What it is called out in the country */
  readonly name: string;
  /** Why anybody would go in: the DM's hook, said once at the door */
  readonly hook: string;
  /** Where on the overworld its mouth is */
  readonly x: number;
  readonly y: number;
  /** How hard the DM built it, in the character's terms */
  readonly level: number;
  readonly rooms: Room[];
  readonly occupants: Occupant[];
  readonly prizes: Prize[];
  /** Which room the character is standing in */
  current: number;
  /** Rounds elapsed since entering; the DM paces itself against this */
  turn: number;
  /** Whether the thing the place is about has been put down */
  resolved: boolean;
}

/**
 * What the DM is holding while it runs a place.
 *
 * Kept apart from the instance itself so that what the player can know and what the DM
 * knows are different objects, which is the whole point of having a DM.
 */
export interface DMState {
  /** The character's last several actions, for reading what they are doing */
  readonly recent: string[];
  /** How the fight has been going for the character, in [0, 1]; low means struggling */
  pressure: number;
  /** Whether the DM has already spent its reinforcement */
  reinforced: boolean;
  /** What the DM has decided to do next, if anything */
  plan: string | null;
}

/** A creature the DM may place, with the weight it is drawn at. */
export interface Stocked {
  readonly archetype: CreatureArchetype;
  readonly temper: Temper;
}

/**
 * Draws one of a weighted list.
 *
 * @param items Candidates
 * @param weight How likely each is
 * @param rng Seeded generator
 * @returns One of them
 */
export function weightedPick<T>(items: readonly T[], weight: (item: T) => number, rng: RNG): T {
  const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
  if (total <= 0) return items[rng.nextInt(0, items.length - 1)];

  let roll = rng.nextFloat() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
