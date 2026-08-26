import { ITEMS } from './items/Catalog';
import { ItemCategory, EquipSlot, Rarity } from './items/ItemTypes';
import type { ItemDefinition } from './items/ItemTypes';

/**
 * Public accessor for the Thornmarch item catalog.
 *
 * The catalog data lives in items/Catalog.ts; this module is the stable surface the
 * rest of the simulation imports from.
 */

export { ITEMS, ItemCategory, EquipSlot, Rarity };
export type { ItemDefinition };

/** Categories whose members can be wielded as a weapon. */
const WEAPON_CATEGORIES: readonly ItemCategory[] = [
  ItemCategory.WEAPON_EDGED,
  ItemCategory.WEAPON_BLUNT,
  ItemCategory.WEAPON_RANGED,
];

/**
 * Looks up an item definition.
 * @param id Item identifier
 * @returns Definition, or undefined if the key is unknown
 */
export function getItem(id: string): ItemDefinition | undefined {
  return ITEMS[id];
}

/**
 * Returns every item in a category.
 * @param category Category to filter by
 * @returns Matching definitions
 */
export function itemsInCategory(category: ItemCategory): ItemDefinition[] {
  return Object.values(ITEMS).filter((i) => i.category === category);
}

/**
 * Reports whether an item can be wielded as a weapon.
 * @param item Definition to test
 * @returns true for edged, blunt, and ranged weapons
 */
export function isWeapon(item: ItemDefinition): boolean {
  return WEAPON_CATEGORIES.includes(item.category);
}

/**
 * Reports whether an item can be worn or held in a slot.
 * @param item Definition to test
 * @returns true if the item declares an equip slot or is a weapon
 */
export function isEquippable(item: ItemDefinition): boolean {
  return item.slot !== undefined || isWeapon(item);
}

/**
 * Returns the slot an item occupies when equipped.
 * @param item Definition to inspect
 * @returns The declared slot, or the hand for weapons that declare none
 */
export function equipSlotFor(item: ItemDefinition): EquipSlot | undefined {
  if (item.slot) return item.slot;
  return isWeapon(item) ? EquipSlot.HAND : undefined;
}
