import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { EventBus } from '../src/events/EventBus';
import type { PositionComponent, StatsComponent } from '../src/core/ecs/Component';
import { TerrainType, TERRAIN_MOVEMENT_COST } from '../src/core/world/TerrainType';
import { SEARCH_REVEAL_RADIUS } from '../src/core/SimulationConstants';

describe('SimulationLoop & Event System', () => {
  it('MOVE command updates position and reveals fog of war', () => {
    const bus = new EventBus();
    const sim = new SimulationLoop('sim-test', bus);
    const initialPos = { ...sim.state.entities.getComponent<PositionComponent>(sim.state.playerId, 'position')! };

    const directions: Array<'north' | 'south' | 'east' | 'west'> = ['north', 'south', 'east', 'west'];
    let moved = false;
    for (const dir of directions) {
      const posBefore = sim.state.entities.getComponent<PositionComponent>(sim.state.playerId, 'position')!;
      const dx = dir === 'east' ? 1 : dir === 'west' ? -1 : 0;
      const dy = dir === 'south' ? 1 : dir === 'north' ? -1 : 0;
      const nx = posBefore.x + dx;
      const ny = posBefore.y + dy;
      if (nx < 0 || nx >= sim.state.mapWidth || ny < 0 || ny >= sim.state.mapHeight) continue;
      if (sim.state.map[ny][nx].movementCost === Infinity) continue;

      sim.submitCommand({ type: 'MOVE', direction: dir });
      const posAfter = sim.state.entities.getComponent<PositionComponent>(sim.state.playerId, 'position')!;
      if (posAfter.x !== initialPos.x || posAfter.y !== initialPos.y) {
        moved = true;
        expect(sim.state.map[posAfter.y][posAfter.x].explored).toBe(true);
        break;
      }
    }
    expect(moved).toBe(true);
  });

  it('MOVE into impassable terrain is rejected', () => {
    const bus = new EventBus();
    const sim = new SimulationLoop('impassable-test', bus);

    const pos = sim.state.entities.getComponent<PositionComponent>(sim.state.playerId, 'position')!;
    const northY = pos.y - 1;
    if (northY >= 0) {
      sim.state.map[northY][pos.x].terrain = TerrainType.WATER;
      sim.state.map[northY][pos.x].movementCost = TERRAIN_MOVEMENT_COST[TerrainType.WATER];
      const before = { ...pos };
      sim.submitCommand({ type: 'MOVE', direction: 'north' });
      const after = sim.state.entities.getComponent<PositionComponent>(sim.state.playerId, 'position')!;
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      const hasError = sim.state.log.slice(-3).some((e) => e.type === 'error');
      expect(hasError).toBe(true);
    }
  });

  it('MOVE out of map bounds is rejected', () => {
    const bus = new EventBus();
    const sim = new SimulationLoop('bounds-move-test', bus);
    const pos = sim.state.entities.getComponent<PositionComponent>(sim.state.playerId, 'position')!;
    pos.x = 0;
    pos.y = 0;

    sim.submitCommand({ type: 'MOVE', direction: 'west' });
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
    const hasError = sim.state.log.slice(-2).some((e) => e.type === 'error' && e.message.includes('world ends'));
    expect(hasError).toBe(true);
  });

  it('REST advances time and alters fatigue, hunger, and thirst', () => {
    const bus = new EventBus();
    const sim = new SimulationLoop('rest-stats-test', bus);
    const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;
    stats.fatigue = 50;
    stats.hunger = 10;
    stats.thirst = 10;

    const tickBefore = sim.state.tick;
    sim.submitCommand({ type: 'REST', hours: 5 });

    expect(sim.state.tick).toBe(tickBefore + 5);
    expect(stats.fatigue).toBeLessThan(50);
    expect(stats.hunger).toBeGreaterThan(10);
    expect(stats.thirst).toBeGreaterThan(10);
  });

  it('SEARCH expands fog of war and logs search event', () => {
    const bus = new EventBus();
    const sim = new SimulationLoop('search-test', bus);
    const pos = sim.state.entities.getComponent<PositionComponent>(sim.state.playerId, 'position')!;

    // A tile at the edge of the search radius but outside the spawn reveal radius.
    const probeX = pos.x + SEARCH_REVEAL_RADIUS;
    const probeY = pos.y;
    const probeInBounds = probeX < sim.state.mapWidth;
    if (probeInBounds) {
      sim.state.map[probeY][probeX].explored = false;
    }

    const logLenBefore = sim.state.log.length;
    sim.submitCommand({ type: 'SEARCH' });

    expect(sim.state.log.length).toBeGreaterThan(logLenBefore);

    const searchEvent = sim.state.log.slice(logLenBefore).find((e) => e.type === 'search');
    expect(searchEvent).toBeDefined();
    expect(searchEvent!.message.length).toBeGreaterThan(0);

    if (probeInBounds) {
      expect(sim.state.map[probeY][probeX].explored).toBe(true);
    }
  });

  it('TimeSystem triggers midnight and dawn events during multi-hour REST', () => {
    const bus = new EventBus();
    const sim = new SimulationLoop('time-jump-test', bus);

    // Start at initial hour 6. Advance 18 hours to reach midnight (hour 0 of Day 2)
    sim.submitCommand({ type: 'REST', hours: 18 });

    const hasNightfall = sim.state.log.some((e) => e.message.includes('Night falls. Day 2'));
    expect(hasNightfall).toBe(true);

    // Advance 6 hours to reach dawn (hour 6 of Day 2)
    sim.submitCommand({ type: 'REST', hours: 6 });
    const hasDawn = sim.state.log.some((e) => e.message.includes('Dawn breaks on day 2'));
    expect(hasDawn).toBe(true);
  });

  it('NEW_GAME resets game state without breaking existing EventBus listeners', () => {
    const bus = new EventBus();
    const sim = new SimulationLoop('original-seed', bus);

    let eventCount = 0;
    sim.onEvent(() => {
      eventCount++;
    });

    const initialEvents = eventCount;

    // Submit NEW_GAME command
    sim.submitCommand({ type: 'NEW_GAME', seed: 'brand-new-seed' });

    expect(sim.state.seedString).toBe('brand-new-seed');
    expect(sim.state.tick).toBe(0);
    expect(eventCount).toBeGreaterThan(initialEvents);

    // Moving in the new game should still trigger listeners
    const countAfterNewGame = eventCount;
    sim.submitCommand({ type: 'REST', hours: 1 });
    expect(eventCount).toBeGreaterThan(countAfterNewGame);
  });

  it('EventBus wildcard subscriptions and error isolation work correctly', () => {
    const bus = new EventBus();
    let wildcardCalls = 0;
    const wildcardCb = () => {
      wildcardCalls++;
    };

    bus.subscribe('*', wildcardCb);

    // Subscriber that throws an error
    bus.subscribe('test', () => {
      throw new Error('Subscriber error');
    });

    let normalSubscriberCalled = false;
    bus.subscribe('test', () => {
      normalSubscriberCalled = true;
    });

    // Emitting should not crash despite the throwing subscriber
    expect(() => {
      bus.emit({ tick: 1, type: 'test', message: 'Hello' });
    }).not.toThrow();

    expect(wildcardCalls).toBe(1);
    expect(normalSubscriberCalled).toBe(true);

    bus.unsubscribe('*', wildcardCb);
    bus.emit({ tick: 2, type: 'test', message: 'Second' });
    expect(wildcardCalls).toBe(1);
  });
});
