import { SeededRNG } from '../rng/SeededRNG';
import type { RNG } from '../rng/SeededRNG';
import type { GameState } from '../state/GameState';
import type { InventoryComponent } from '../ecs/Component';
import type { Settlement } from './Settlement';
import { ITEMS } from '../lore/items/Catalog';
import type { ItemDefinition } from '../lore/items/ItemTypes';
import { ItemCategory, Rarity } from '../lore/items/ItemTypes';
import { markBand } from '../simulation/systems/MarkSystem';
import type { MarkComponent } from '../ecs/Component';
import {
  MARKET_BUY_MARKUP,
  MARKET_SELL_RATE,
  MARKET_MARK_SURCHARGE,
  MARKET_STOCK_MIN,
  MARKET_STOCK_MAX,
  MARKET_RESTOCK_DAYS,
} from '../SimulationConstants';

/**
 * Somewhere to spend it.
 *
 * Every item in the catalog has carried a value in copper since the day it was written,
 * and there has never been anything to spend it on: the whole trade command was a fixed
 * barter of one coin for bread, water and linen. So loot had no destination, coin had no
 * use, and the wound system had no bandages behind it -- a character could be cut open
 * with no way to buy the thing that closes it.
 *
 * A market closes that loop. What a village has depends on what a village is, prices
 * depend on how badly they want you gone, and both are a function of the seed and the
 * day rather than of anything stored, so a market is the same market when you come back
 * to it and a different one a week later.
 */

/** One line of a village's stock. */
export interface Offer {
  readonly itemId: string;
  readonly item: ItemDefinition;
  /** How many they have */
  readonly count: number;
  /** What they want for one, in copper */
  readonly price: number;
}

/** What the character has in their purse, in copper. */
export function purseOf(inventory: InventoryComponent): number {
  return inventory.copper ?? 0;
}

/**
 * What a village will not stock, whatever else it has.
 *
 * A parish of forty souls does not keep artifacts behind the counter, and nobody sells
 * you the thing you are carrying a debt about.
 */
const NEVER_STOCKED: readonly ItemCategory[] = [ItemCategory.VALUABLE];

/**
 * What every village keeps, because a village that cannot sell you bread is not a
 * village. These are the things the game's own systems consume.
 */
const STAPLES: readonly string[] = [
  'bread',
  'stale_bread',
  'cheese',
  'salted_fish',
  'waterskin',
  'bandage',
  'rope',
  'tinderbox',
];

/**
 * What one village has, on one day.
 *
 * Derived rather than stored: the seed, the village's name, and which restocking period
 * the day falls in. Come back the same week and it is the same shop.
 *
 * @param state Game state
 * @param settlement Which village
 * @returns What is for sale
 */
export function stockOf(state: GameState, settlement: Settlement): Offer[] {
  const period = Math.floor(state.day / MARKET_RESTOCK_DAYS);
  const rng = new SeededRNG(`${state.seedString}:market:${settlement.name}:${period}`);

  const catalog = Object.values(ITEMS);
  const offers: Offer[] = [];
  const taken = new Set<string>();

  // The staples first, because the systems downstream depend on them being buyable.
  for (const id of STAPLES) {
    const item = ITEMS[id];
    if (!item) continue;
    taken.add(id);
    offers.push({
      itemId: id,
      item,
      count: rng.nextInt(1, 4),
      price: priceFor(state, item, 'buy'),
    });
  }

  // Then whatever else this particular place happens to have in.
  const sellable = catalog.filter(
    (item) =>
      !taken.has(item.id) &&
      item.value > 0 &&
      item.rarity !== Rarity.ARTIFACT &&
      !NEVER_STOCKED.includes(item.category)
  );

  const extra = rng.nextInt(MARKET_STOCK_MIN, MARKET_STOCK_MAX);
  for (let i = 0; i < extra && sellable.length > 0; i++) {
    const item = sellable[rng.nextInt(0, sellable.length - 1)];
    if (taken.has(item.id)) continue;
    taken.add(item.id);
    offers.push({
      itemId: item.id,
      item,
      count: rng.nextInt(1, item.consumable ? 3 : 1),
      price: priceFor(state, item, 'buy'),
    });
  }

  return offers;
}

/**
 * What a thing costs, or fetches.
 *
 * Buying carries a markup and selling a discount, which is what a middleman is. On top
 * of that sits the mark: the higher it burns the less anybody wants to be seen dealing
 * with you, and the more it costs to make them.
 *
 * @param state Game state
 * @param item What is changing hands
 * @param side Whether the character is buying or selling
 * @returns The price in copper, never less than one
 */
export function priceFor(
  state: GameState,
  item: ItemDefinition,
  side: 'buy' | 'sell'
): number {
  const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
  const band = mark ? markBand(mark.intensity) : 0;

  if (side === 'buy') {
    const surcharge = 1 + band * MARKET_MARK_SURCHARGE;
    return Math.max(1, Math.round(item.value * MARKET_BUY_MARKUP * surcharge));
  }

  // Selling is worse the more they want you gone, for the same reason.
  const discount = Math.max(0.25, MARKET_SELL_RATE - band * MARKET_MARK_SURCHARGE);
  return Math.max(1, Math.round(item.value * discount));
}

/**
 * Draws a weighted pick from what is for sale, for anybody who needs one.
 * @param offers What is on the counter
 * @param rng Seeded generator
 * @returns One offer
 */
export function anyOf(offers: readonly Offer[], rng: RNG): Offer | undefined {
  if (offers.length === 0) return undefined;
  return offers[rng.nextInt(0, offers.length - 1)];
}
