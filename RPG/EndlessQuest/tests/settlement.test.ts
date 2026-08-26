import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/core/rng/SeededRNG';
import { MapGenerator } from '../src/core/world/MapGenerator';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { nearestSettlement, settlementAt } from '../src/core/world/Settlement';
import { generatePersonName, generateSettlementName } from '../src/core/lore/Names';
import { serializeGameState, deserializeGameState } from '../src/core/state/SaveGame';
import type { InventoryComponent, PositionComponent } from '../src/core/ecs/Component';
import {
  MIN_SETTLEMENT_COUNT,
  MAX_SETTLEMENT_COUNT,
} from '../src/core/SimulationConstants';

describe('Settlement generation', () => {
  it('places a named settlement for every settlement tile', () => {
    const gen = new MapGenerator(new SeededRNG('settlement-naming'));
    const { map, settlements } = gen.generate();

    expect(settlements.length).toBeGreaterThanOrEqual(MIN_SETTLEMENT_COUNT);
    expect(settlements.length).toBeLessThanOrEqual(MAX_SETTLEMENT_COUNT);

    let flaggedTiles = 0;
    for (const row of map) {
      for (const tile of row) {
        if (tile.settlement) flaggedTiles++;
      }
    }
    expect(flaggedTiles).toBe(settlements.length);

    for (const s of settlements) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(map[s.y][s.x].settlement).toBe(true);
    }
  });

  it('is fully deterministic, names included', () => {
    const a = new MapGenerator(new SeededRNG('settlement-determinism')).generate();
    const b = new MapGenerator(new SeededRNG('settlement-determinism')).generate();
    expect(a.settlements).toEqual(b.settlements);
  });

  it('naming settlements does not perturb terrain or placement', () => {
    // Terrain and placement are drawn before any name is generated, so a build that
    // adds or changes name generation must still produce the same world.
    const gen = new MapGenerator(new SeededRNG('settlement-isolation'));
    const { map, settlements, startX, startY } = gen.generate();

    const nameless = settlements.map(({ x, y }) => ({ x, y }));
    expect(nameless.length).toBe(new Set(nameless.map((s) => `${s.x},${s.y}`)).size);
    expect(map[startY][startX].movementCost).not.toBe(Infinity);
  });

  it('locates settlements by coordinate and by proximity', () => {
    const gen = new MapGenerator(new SeededRNG('settlement-lookup'));
    const { settlements } = gen.generate();
    const first = settlements[0];

    expect(settlementAt(settlements, first.x, first.y)).toEqual(first);
    expect(settlementAt(settlements, -1, -1)).toBeUndefined();
    expect(nearestSettlement(settlements, first.x + 1, first.y, 2)).toEqual(first);
    expect(nearestSettlement(settlements, first.x + 50, first.y + 50, 2)).toBeUndefined();
  });

  it('settlements survive a save round trip by regeneration', () => {
    const sim = new SimulationLoop('settlement-save');
    const restored = deserializeGameState(serializeGameState(sim.state));
    expect(restored.settlements).toEqual(sim.state.settlements);
  });
});

describe('Name generation', () => {
  it('produces stable names for a given seed', () => {
    const a = new SeededRNG('names');
    const b = new SeededRNG('names');
    for (let i = 0; i < 20; i++) {
      expect(generateSettlementName(a)).toBe(generateSettlementName(b));
      expect(generatePersonName(a)).toBe(generatePersonName(b));
    }
  });

  it('produces varied names within a single run', () => {
    const rng = new SeededRNG('name-variety');
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) names.add(generateSettlementName(rng));
    expect(names.size).toBeGreaterThan(50);
  });
});

describe('Trade', () => {
  it('is refused outside a settlement', () => {
    const sim = new SimulationLoop('trade-refused');
    const logBefore = sim.state.log.length;
    sim.submitCommand({ type: 'TRADE' });

    const last = sim.state.log[logBefore];
    expect(last.type).toBe('error');
    expect(last.message).toContain('nobody out here');
  });

  it('is refused inside a settlement without a coin', () => {
    const sim = new SimulationLoop('trade-broke');
    const settlement = sim.state.settlements[0];
    const pos = sim.state.entities.getComponent<PositionComponent>(
      sim.state.playerId,
      'position'
    )!;
    pos.x = settlement.x;
    pos.y = settlement.y;

    const logBefore = sim.state.log.length;
    sim.submitCommand({ type: 'TRADE' });

    expect(sim.state.log[logBefore].type).toBe('error');
    expect(sim.state.log[logBefore].message).toContain(settlement.name);
  });

  it('exchanges a coin for supplies inside a settlement', () => {
    const sim = new SimulationLoop('trade-success');
    const settlement = sim.state.settlements[0];
    const pos = sim.state.entities.getComponent<PositionComponent>(
      sim.state.playerId,
      'position'
    )!;
    const inventory = sim.state.entities.getComponent<InventoryComponent>(
      sim.state.playerId,
      'inventory'
    )!;

    pos.x = settlement.x;
    pos.y = settlement.y;
    inventory.items.copper_coins = 1;

    sim.submitCommand({ type: 'TRADE' });

    expect(inventory.items.copper_coins).toBeUndefined();
    expect(inventory.items.bread).toBeGreaterThan(0);
    expect(inventory.items.waterskin).toBeGreaterThan(0);
    expect(inventory.items.bandage).toBeGreaterThan(0);
  });
});
