/**
 * Cardinal movement directions.
 */
export type Direction = 'north' | 'south' | 'east' | 'west';

/**
 * Discriminated union of all executable player and system simulation commands.
 */
export type Command =
  | { type: 'MOVE'; direction: Direction }
  | { type: 'REST'; hours: number }
  | { type: 'SEARCH' }
  | { type: 'NEW_GAME'; seed?: string | number }
  /** Consume a carried item by its key in lore/Items */
  | { type: 'CONSUME'; item: string }
  /** Strike at the threat currently engaged */
  | { type: 'ATTACK' }
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
