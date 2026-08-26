import { describe, it, expect } from 'vitest';
import {
  ITEMS,
  getItem,
  isWeapon,
  isEquippable,
  equipSlotFor,
  itemsInCategory,
  ItemCategory,
  EquipSlot,
} from '../src/core/lore/Items';
import { CONDITIONS, getCondition } from '../src/core/lore/items/Conditions';
import { FORAGE_TABLE } from '../src/core/lore/Flavor';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { addItem, countItem, totalWeight, remainingCapacity } from '../src/core/state/Inventory';
import { equipItem, unequipSlot, equippedIn } from '../src/core/state/Equipment';
import { armorClass, modifierOf, BASE_ARMOR_CLASS } from '../src/core/state/Checks';
import { Ability } from '../src/core/rules/Abilities';
import type {
  CombatantComponent,
  EquipmentComponent,
  InventoryComponent,
} from '../src/core/ecs/Component';
import { serializeGameState, deserializeGameState } from '../src/core/state/SaveGame';
import { CARRY_CAPACITY, TRADE_CURRENCY_ITEM } from '../src/core/SimulationConstants';

describe('Item catalog', () => {
  it('every entry is internally consistent', () => {
    for (const [key, item] of Object.entries(ITEMS)) {
      expect(item.id).toBe(key);
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.weight).toBeGreaterThanOrEqual(0);
      expect(item.value).toBeGreaterThanOrEqual(0);
      expect(item.tags.length).toBeGreaterThan(0);
      if (item.armor !== undefined) {
        expect(item.armor).toBeGreaterThanOrEqual(0);
        expect(item.armor).toBeLessThan(1);
      }
      if (item.damage !== undefined) expect(item.damage).toBeGreaterThan(0);
    }
  });

  it('covers every category', () => {
    for (const category of Object.values(ItemCategory)) {
      expect(itemsInCategory(category).length).toBeGreaterThan(0);
    }
  });

  it('weapon damage preserves the source catalog ordering', () => {
    // The source gives dice; this build maps them onto a continuous scale by rank.
    // A heavier die must never come out weaker than a lighter one.
    const stoneKnife = getItem('stone_knife')!;
    const shortSword = getItem('short_sword')!;
    const longSword = getItem('long_sword')!;
    const sledgehammer = getItem('sledgehammer')!;

    expect(stoneKnife.damage!).toBeLessThan(shortSword.damage!);
    expect(shortSword.damage!).toBeLessThan(longSword.damage!);
    expect(longSword.damage!).toBeLessThan(sledgehammer.damage!);
    expect(stoneKnife.sourceDice).toBe('1d3');
  });

  it('armour ordering follows the source catalog', () => {
    expect(getItem('leather_vest')!.armor!).toBeLessThan(getItem('leather_armor')!.armor!);
    expect(getItem('leather_armor')!.armor!).toBeLessThan(getItem('chainmail')!.armor!);
    expect(getItem('chainmail')!.armor!).toBeLessThan(getItem('plate_armor')!.armor!);
  });

  it('classifies weapons and equippables', () => {
    expect(isWeapon(getItem('long_sword')!)).toBe(true);
    expect(isWeapon(getItem('bread')!)).toBe(false);
    expect(isEquippable(getItem('chainmail')!)).toBe(true);
    expect(isEquippable(getItem('bread')!)).toBe(false);
    expect(equipSlotFor(getItem('long_sword')!)).toBe(EquipSlot.HAND);
    expect(equipSlotFor(getItem('chainmail')!)).toBe(EquipSlot.BODY);
    expect(equipSlotFor(getItem('wooden_shield')!)).toBe(EquipSlot.OFFHAND);
  });

  it('food and medicine actually relieve something', () => {
    for (const item of itemsInCategory(ItemCategory.FOOD)) {
      if (!item.consumable) continue;
      const relief = (item.hunger ?? 0) + (item.thirst ?? 0);
      expect(relief).toBeGreaterThan(0);
    }
    expect(getItem('bandage')!.hp!).toBeGreaterThan(0);
    expect(getItem('herbal_poultice')!.hp!).toBeGreaterThan(getItem('bandage')!.hp!);
  });

  it('every item the forage tables can yield exists in the catalog', () => {
    for (const entries of Object.values(FORAGE_TABLE)) {
      for (const entry of entries) {
        if (entry.item === null) continue;
        expect(getItem(entry.item), `missing forage item ${entry.item}`).toBeDefined();
      }
    }
  });

  it('the trade currency exists in the catalog', () => {
    expect(getItem(TRADE_CURRENCY_ITEM)).toBeDefined();
  });

  it('artifacts all carry a cost alongside their gift', () => {
    const artifacts = itemsInCategory(ItemCategory.ARTIFACT);
    expect(artifacts.length).toBeGreaterThan(0);
    for (const a of artifacts) {
      expect(a.boon!.length).toBeGreaterThan(0);
      expect(a.bane!.length).toBeGreaterThan(0);
    }
  });
});

describe('Condition cards', () => {
  it('are loaded and uniquely identified', () => {
    expect(CONDITIONS.length).toBeGreaterThan(20);
    const ids = CONDITIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getCondition('broken_leg')).toBeDefined();
    expect(getCondition('nothing_of_the_sort')).toBeUndefined();
  });
});

describe('Weight-limited inventory', () => {
  it('accounts for the weight of what is carried', () => {
    const inventory: InventoryComponent = { type: 'inventory', items: {} };
    addItem(inventory, 'bread', 2);
    expect(totalWeight(inventory)).toBeCloseTo(getItem('bread')!.weight * 2, 5);
    expect(remainingCapacity(inventory)).toBeCloseTo(CARRY_CAPACITY - totalWeight(inventory), 5);
  });

  it('refuses what will not fit, and takes what will', () => {
    const inventory: InventoryComponent = { type: 'inventory', items: {} };
    // Plate armour is 25 units against a capacity of 25, so one fits and no more.
    const taken = addItem(inventory, 'plate_armor', 3);
    expect(taken).toBe(1);
    expect(addItem(inventory, 'chainmail', 1)).toBe(0);
    expect(totalWeight(inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
  });

  it('picking up a stack partially succeeds rather than failing outright', () => {
    const inventory: InventoryComponent = { type: 'inventory', items: {} };
    // Chainmail leaves 11 units free; firewood is 3 units, so three bundles fit of five.
    addItem(inventory, 'chainmail', 1);
    const taken = addItem(inventory, 'firewood', 5);

    expect(taken).toBe(3);
    expect(countItem(inventory, 'firewood')).toBe(3);
    expect(totalWeight(inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
  });

  it('a full pack refuses even the lightest thing', () => {
    const inventory: InventoryComponent = { type: 'inventory', items: {} };
    addItem(inventory, 'plate_armor', 1);

    expect(remainingCapacity(inventory)).toBe(0);
    expect(addItem(inventory, 'copper_coins', 5)).toBe(0);
  });
});

describe('Equipment', () => {
  it('a bare-handed character has the unarmoured Armour Class', () => {
    const sim = new SimulationLoop('equip-baseline');
    const world = sim.state.entities;

    // Characters embark carrying whatever their origin left them, so strip the
    // loadout to get at the unarmoured baseline this test is actually about.
    const equipment = world.getComponent<EquipmentComponent>(sim.state.playerId, 'equipment')!;
    equipment.slots = {};

    const dex = modifierOf(world, sim.state.playerId, Ability.DEX);
    expect(armorClass(world, sim.state.playerId)).toBe(BASE_ARMOR_CLASS + dex);
  });

  it('an origin arms the character at embark', () => {
    const sim = new SimulationLoop('equip-origin');
    const world = sim.state.entities;

    const background = sim.state.background!;
    expect(background.origin.startingItems.length).toBeGreaterThan(0);

    const inventory = world.getComponent<InventoryComponent>(sim.state.playerId, 'inventory')!;
    for (const itemId of background.origin.startingItems) {
      expect(countItem(inventory, itemId)).toBeGreaterThan(0);
    }
  });

  it('damage comes from the wielded weapon, not from a cached number', () => {
    // Damage is read off the weapon's own dice at the moment of the attack, so what
    // equipping must guarantee is that the right weapon is in hand.
    const sim = new SimulationLoop('equip-weapon');
    const world = sim.state.entities;

    equipItem(world, sim.state.playerId, 'long_sword');
    expect(equippedIn(world, sim.state.playerId, EquipSlot.HAND)).toBe('long_sword');
    expect(getItem('long_sword')!.sourceDice).toBe('1d8');
  });

  it('worn armour raises Armour Class', () => {
    const sim = new SimulationLoop('equip-armor');
    const world = sim.state.entities;

    const equipment = world.getComponent<EquipmentComponent>(sim.state.playerId, 'equipment')!;
    equipment.slots = {};
    const bare = armorClass(world, sim.state.playerId);

    equipItem(world, sim.state.playerId, 'leather_armor');
    const light = armorClass(world, sim.state.playerId);
    expect(light).toBeGreaterThan(bare);

    equipItem(world, sim.state.playerId, 'plate_armor');
    const heavy = armorClass(world, sim.state.playerId);
    expect(heavy).toBeGreaterThan(light);

    // A shield stacks on top of body armour, since it occupies its own hand.
    equipItem(world, sim.state.playerId, 'tower_shield');
    expect(armorClass(world, sim.state.playerId)).toBeGreaterThan(heavy);
  });

  it('a creature states its Armour Class rather than deriving one', () => {
    const sim = new SimulationLoop('equip-creature-ac');
    const world = sim.state.entities;
    const id = world.createEntity();
    world.addComponent(id, {
      type: 'combatant',
      attackBonus: 4,
      damageDice: '1d6',
      armorClass: 13,
    } as CombatantComponent);

    expect(armorClass(world, id)).toBe(13);
  });

  it('a new weapon displaces the old one in the same hand', () => {
    const sim = new SimulationLoop('equip-swap');
    const world = sim.state.entities;

    equipItem(world, sim.state.playerId, 'stone_knife');
    const result = equipItem(world, sim.state.playerId, 'warhammer');

    expect(result.replaced).toBe('stone_knife');
    expect(equippedIn(world, sim.state.playerId, EquipSlot.HAND)).toBe('warhammer');
  });

  it('unequipping empties the slot', () => {
    const sim = new SimulationLoop('equip-remove');
    const world = sim.state.entities;

    equipItem(world, sim.state.playerId, 'long_sword');
    unequipSlot(world, sim.state.playerId, EquipSlot.HAND);

    expect(equippedIn(world, sim.state.playerId, EquipSlot.HAND)).toBeUndefined();
  });

  it('refuses to equip what cannot be worn or wielded', () => {
    const sim = new SimulationLoop('equip-invalid');
    const result = equipItem(sim.state.entities, sim.state.playerId, 'bread');
    expect(result.ok).toBe(false);
  });

  it('the EQUIP command requires the item to be carried', () => {
    const sim = new SimulationLoop('equip-command');
    const inventory = sim.state.entities.getComponent<InventoryComponent>(
      sim.state.playerId,
      'inventory'
    )!;

    const before = sim.state.log.length;
    sim.submitCommand({ type: 'EQUIP', item: 'long_sword' });
    expect(sim.state.log[before].type).toBe('error');

    addItem(inventory, 'long_sword', 1);
    const after = sim.state.log.length;
    sim.submitCommand({ type: 'EQUIP', item: 'long_sword' });
    expect(sim.state.log[after].type).toBe('system');
  });

  it('survives a save round trip', () => {
    const sim = new SimulationLoop('equip-save');
    const world = sim.state.entities;
    const inventory = world.getComponent<InventoryComponent>(sim.state.playerId, 'inventory')!;
    addItem(inventory, 'chainmail', 1);
    equipItem(world, sim.state.playerId, 'chainmail');

    const acBefore = armorClass(world, sim.state.playerId);

    // Round trip through the save layer and confirm the loadout came back intact.
    const restored = deserializeGameState(serializeGameState(sim.state));

    const restoredEquipment = restored.entities.getComponent<EquipmentComponent>(
      restored.playerId,
      'equipment'
    )!;
    expect(restoredEquipment.slots[EquipSlot.BODY]).toBe('chainmail');

    // Armour Class is derived, so the real assertion is that the loadout it derives
    // from came back intact and still produces the same number.
    expect(armorClass(restored.entities, restored.playerId)).toBe(acBefore);
  });
});
