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
  /** Speak to whoever is here, and hear what they want */
  | { type: 'TALK' }
  /** Take on the errand that was last put to you */
  | { type: 'ACCEPT' }
  /** Hand over what an errand asked for, or report it done */
  | { type: 'GIVE' };
