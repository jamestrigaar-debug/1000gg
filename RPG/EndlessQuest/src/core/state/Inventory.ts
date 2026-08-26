import type { InventoryComponent } from '../ecs/Component';
import { getItem } from '../lore/Items';
import { CARRY_CAPACITY } from '../SimulationConstants';

/**
 * Helpers for manipulating an InventoryComponent.
 *
 * Inventory is a flat count per item key rather than a slot grid, and is limited by
 * carried weight rather than by a number of slots. That follows the item catalog, where
 * the decision that matters is whether a hauberk is worth the fourteen units of weight
 * it costs you in food and water.
 */

/**
 * Counts every item held, ignoring weight.
 * @param inventory Inventory component
 * @returns Total number of items carried
 */
export function totalItems(inventory: InventoryComponent): number {
  let total = 0;
  for (const key of Object.keys(inventory.items)) {
    total += inventory.items[key];
  }
  return total;
}

/**
 * Sums the weight of everything carried.
 *
 * Items missing from the catalog are treated as weightless rather than throwing, so a
 * save written by a build with extra items still loads.
 *
 * @param inventory Inventory component
 * @returns Total carried weight
 */
export function totalWeight(inventory: InventoryComponent): number {
  let weight = 0;
  for (const key of Object.keys(inventory.items)) {
    weight += (getItem(key)?.weight ?? 0) * inventory.items[key];
  }
  return weight;
}

/**
 * Reports the remaining carrying capacity.
 * @param inventory Inventory component
 * @returns Weight that can still be picked up, never negative
 */
export function remainingCapacity(inventory: InventoryComponent): number {
  return Math.max(0, CARRY_CAPACITY - totalWeight(inventory));
}

/**
 * Adds items, taking as many as will fit within the carrying limit.
 *
 * A weightless item is always accepted; otherwise the count is capped by the space
 * remaining, so picking up a stack partially succeeds rather than failing outright.
 *
 * @param inventory Inventory component
 * @param itemId Item key
 * @param quantity Number to add, defaults to 1
 * @returns Number actually added, which may be fewer than requested
 */
export function addItem(
  inventory: InventoryComponent,
  itemId: string,
  quantity: number = 1
): number {
  if (quantity <= 0) return 0;

  const unitWeight = getItem(itemId)?.weight ?? 0;
  let added = quantity;

  if (unitWeight > 0) {
    const affordable = Math.floor(remainingCapacity(inventory) / unitWeight);
    added = Math.max(0, Math.min(quantity, affordable));
  }

  if (added > 0) {
    inventory.items[itemId] = (inventory.items[itemId] ?? 0) + added;
  }
  return added;
}

/**
 * Removes items if enough are held.
 * @param inventory Inventory component
 * @param itemId Item key
 * @param quantity Number to remove, defaults to 1
 * @returns true if the full quantity was removed
 */
export function removeItem(
  inventory: InventoryComponent,
  itemId: string,
  quantity: number = 1
): boolean {
  const held = inventory.items[itemId] ?? 0;
  if (held < quantity) return false;

  const remaining = held - quantity;
  if (remaining === 0) {
    delete inventory.items[itemId];
  } else {
    inventory.items[itemId] = remaining;
  }
  return true;
}

/**
 * Reports how many of an item are held.
 * @param inventory Inventory component
 * @param itemId Item key
 * @returns Quantity held, zero if absent
 */
export function countItem(inventory: InventoryComponent, itemId: string): number {
  return inventory.items[itemId] ?? 0;
}
