/**
 * Cardinal movement directions.
 */
export type Direction = 'north' | 'south' | 'east' | 'west';

/**
 * Directional coordinate offsets.
 *
 * Lives with the direction itself rather than in the command handler, because a journey
 * needs to step the same way a single move does.
 */
export const DIRECTION_DELTAS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

/**
 * Discriminated union of all executable player and system simulation commands.
 */
export type Command =
  | { type: 'MOVE'; direction: Direction }
  /** Go in to whatever is standing here */
  | { type: 'ENTER' }
  /** Walk on to another room of the place you are in */
  | { type: 'DELVE'; room?: number }
  /** Go over this room for what it is hiding */
  | { type: 'RANSACK' }
  /** Come back out into the country */
  | { type: 'LEAVE' }
  | {
      /**
       * Cover ground. The unit of play out of doors: hold a bearing, or make for a place
       * you know of, until something is worth stopping for.
       */
      type: 'TRAVEL';
      direction?: Direction;
      /** A place the character knows of, by name */
      toward?: string;
      /** Hours to spend at most; a day's march by default */
      hours?: number;
      /** Whether to keep walking after dark */
      throughNight?: boolean;
    }
  | { type: 'REST'; hours: number }
  | { type: 'SEARCH' }
  | { type: 'NEW_GAME'; seed?: string | number }
  /** Consume a carried item by its key in lore/Items */
  | { type: 'CONSUME'; item: string }
  /** Strike at the threat currently engaged */
  | {
      type: 'ATTACK';
      /** The words the player used, so a blow can be aimed */
      said?: readonly string[];
    }
  /** Cover up: trade the initiative for armour and recovered wind */
  | { type: 'DEFEND' }
  /** Attempt to break off an engagement */
  | { type: 'FLEE' }
  /** Draw the threat out of position, spending the exchange to do it */
  | { type: 'FEINT' }
  /** Try to drive the threat off without killing it */
  | { type: 'INTIMIDATE' }
  /** Barter a coin for supplies; only valid while standing in a settlement */
  | { type: 'TRADE' }
  /** Buy something off a village's counter */
  | { type: 'BUY'; item: string; count?: number }
  /** Sell something out of the pack */
  | { type: 'SELL'; item: string; count?: number }
  /** Put something down and leave it */
  | { type: 'DROP'; item: string; count?: number }
  /** The one thing your calling can do that the others cannot */
  | { type: 'KNACK' }
  /** Buy something off a village's counter */
  | { type: 'BUY'; item: string; count?: number }
  /** Sell something out of the pack */
  | { type: 'SELL'; item: string; count?: number }
  /** Put something down and leave it */
  | { type: 'DROP'; item: string; count?: number }
  /** The one thing your calling can do that the others cannot */
  | { type: 'KNACK' }
  /** Wear or wield a carried item */
  | { type: 'EQUIP'; item: string }
  /** Empty an equipment slot */
  | { type: 'UNEQUIP'; slot: string }
  /** Keep the rite at a vigil; only valid while standing on one */
  | { type: 'VIGIL' }
  /** Settle the debt at the gallows-tree; only valid while standing under it */
  | { type: 'RECKON' }
  /**
   * Something the player described in their own words, for the world to rule on.
   * Carries what they said and the skill the attempt was read as calling for.
   */
  | { type: 'IMPROVISE'; text: string; skill: string; hard: boolean }
  /**
   * Speak to somebody here and hear what they want.
   * Carries the line as typed, so a named person can be addressed rather than chosen.
   */
  | { type: 'TALK'; who?: string }
  /** Take on the errand that was last put to you */
  | { type: 'ACCEPT' }
  /** Hand over what an errand asked for, or report it done */
  | { type: 'GIVE' }
  /** Put a question to whoever is here; carries what was asked, verbatim */
  | { type: 'ASK'; text: string }
  /** Drink from open water, if there is any within reach */
  | { type: 'DRINK' }
  /** Take the measure of somebody here, and learn what they hold to */
  | { type: 'READ'; who?: string }
  /** Put a request in the terms of what somebody cares about */
  | { type: 'APPEAL'; who?: string }
  /** Use what you know against somebody: faster than an appeal, and it costs */
  | { type: 'PRESS'; who?: string };
