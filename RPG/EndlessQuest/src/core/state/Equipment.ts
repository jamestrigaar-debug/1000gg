import type { World } from '../ecs/World';
import type { EntityId } from '../ecs/Entity';
import type { EquipmentComponent } from '../ecs/Component';
import { equipSlotFor, getItem } from '../lore/Items';
import { EquipSlot } from '../lore/items/ItemTypes';

/**
 * Equipping and the combat statistics derived from it.
 *
 * Equipment is not read during combat resolution. Instead the entity's
 * CombatantComponent is recomputed whenever the loadout changes, so the resolver keeps a
 * single source of truth for damage and armour and threats without equipment behave
 * exactly as before.
 */

/**
 * Refreshes anything derived from a character's loadout.
 *
 * Damage and Armour Class are no longer cached on the combatant: damage comes from the
 * wielded weapon's own dice at the moment of the attack, and Armour Class is computed
 * from what is worn plus Dexterity. Keeping them derived rather than stored removes a
 * whole class of bug where the cache and the equipment disagree.
 *
 * The function is retained because equipping is still a state change other systems may
 * want to react to, and because callers should not need to know that it is currently a
 * no-op.
 *
 * @param world ECS world
 * @param entity Entity whose derived statistics should be refreshed
 */
export function recomputeCombatStats(world: World, entity: EntityId): void {
  void world;
  void entity;
}

/**
 * Result of attempting to change a loadout.
 */
export interface EquipResult {
  /** Whether the change was applied */
  ok: boolean;
  /** Player-facing explanation */
  message: string;
  /** Item displaced from the slot, if any */
  replaced?: string;
}

/**
 * Equips a carried item into its slot, displacing whatever was there.
 *
 * @param world ECS world
 * @param entity Entity to equip
 * @param itemId Catalog item key
 * @returns Outcome describing what happened
 */
export function equipItem(world: World, entity: EntityId, itemId: string): EquipResult {
  const item = getItem(itemId);
  if (!item) return { ok: false, message: 'You have no such thing.' };

  const slot = equipSlotFor(item);
  if (!slot) {
    return { ok: false, message: `${item.name} is not something you can wear or wield.` };
  }

  const equipment = world.getComponent<EquipmentComponent>(entity, 'equipment');
  if (!equipment) return { ok: false, message: 'You cannot carry that the way you would need to.' };

  const replaced = equipment.slots[slot];
  if (replaced === itemId) {
    return { ok: false, message: `${item.name} is already to hand.` };
  }

  equipment.slots[slot] = itemId;
  recomputeCombatStats(world, entity);

  const verb = slot === EquipSlot.HAND || slot === EquipSlot.OFFHAND ? 'take up' : 'put on';
  return { ok: true, message: `You ${verb} ${item.name.toLowerCase()}.`, replaced };
}

/**
 * Clears a slot.
 * @param world ECS world
 * @param entity Entity to unequip
 * @param slot Slot to empty
 * @returns Outcome describing what happened
 */
export function unequipSlot(world: World, entity: EntityId, slot: string): EquipResult {
  const equipment = world.getComponent<EquipmentComponent>(entity, 'equipment');
  if (!equipment || !equipment.slots[slot]) {
    return { ok: false, message: 'There is nothing in that hand.' };
  }

  const removed = equipment.slots[slot];
  delete equipment.slots[slot];
  recomputeCombatStats(world, entity);

  const item = getItem(removed);
  return { ok: true, message: `You put ${item?.name.toLowerCase() ?? 'it'} away.`, replaced: removed };
}

/**
 * Reports the item occupying a slot.
 * @param world ECS world
 * @param entity Entity to inspect
 * @param slot Slot to read
 * @returns Item key, or undefined if the slot is empty
 */
export function equippedIn(world: World, entity: EntityId, slot: string): string | undefined {
  return world.getComponent<EquipmentComponent>(entity, 'equipment')?.slots[slot];
}
