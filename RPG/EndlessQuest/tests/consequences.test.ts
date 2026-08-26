import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/core/rng/SeededRNG';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { applyTwist } from '../src/core/narrative/Twists';
import { drawWithoutRepeat } from '../src/core/lore/Sampler';
import { ORIGINS } from '../src/core/narrative/Background';
import { getItem } from '../src/core/lore/Items';
import type { OracleEntry } from '../src/core/narrative/Oracle';
import type {
  InventoryComponent,
  MarkComponent,
  StatsComponent,
} from '../src/core/ecs/Component';
import { STALKED_DURATION_HOURS } from '../src/core/SimulationConstants';

/**
 * Builds a minimal oracle entry carrying one consequence.
 */
function twist(consequence: string): OracleEntry {
  return { roll: [1, 20], result: 'test', description: 'Something happens.', consequence };
}

describe('Twist consequences are spent against real state', () => {
  it('a wound costs hit points and says how many', () => {
    const sim = new SimulationLoop('twist-wound');
    const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;
    const before = stats.hp;

    const cost = applyTwist(sim.state, twist('wound'));

    expect(stats.hp).toBeLessThan(before);
    expect(cost).toMatch(/^\(-\d+ hp\)$/);
  });

  it('a lost item is actually gone from the pack', () => {
    const sim = new SimulationLoop('twist-loss');
    const inventory = sim.state.entities.getComponent<InventoryComponent>(
      sim.state.playerId,
      'inventory'
    )!;
    const carriedBefore = Object.values(inventory.items).reduce((sum, n) => sum + n, 0);

    const cost = applyTwist(sim.state, twist('item_lost'));

    const carriedAfter = Object.values(inventory.items).reduce((sum, n) => sum + n, 0);
    expect(carriedAfter).toBe(carriedBefore - 1);
    expect(cost).toMatch(/^\(lost: .+\)$/);
  });

  it('an empty pack cannot be robbed, and says nothing rather than lying', () => {
    const sim = new SimulationLoop('twist-empty');
    const inventory = sim.state.entities.getComponent<InventoryComponent>(
      sim.state.playerId,
      'inventory'
    )!;
    inventory.items = {};

    expect(applyTwist(sim.state, twist('item_lost'))).toBeNull();
  });

  it('lost time moves the clock', () => {
    const sim = new SimulationLoop('twist-time');
    const before = sim.state.tick;

    const cost = applyTwist(sim.state, twist('time_lost'));

    expect(sim.state.tick).toBeGreaterThan(before);
    expect(cost).toMatch(/^\(-\d+h\)$/);
  });

  it('drawing notice fans the Mark', () => {
    const sim = new SimulationLoop('twist-mark');
    const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;
    mark.intensity = 20;

    applyTwist(sim.state, twist('mark_rises'));

    expect(mark.intensity).toBeGreaterThan(20);
  });

  it('being followed raises the encounter rate for a while, and is persisted', () => {
    const sim = new SimulationLoop('twist-followed');

    expect(applyTwist(sim.state, twist('observed'))).toBe('(followed)');
    expect(sim.state.stalkedUntil).toBe(sim.state.tick + STALKED_DURATION_HOURS);
  });

  it('an answer with nothing behind it costs nothing', () => {
    const sim = new SimulationLoop('twist-none');
    expect(applyTwist(sim.state, { roll: [1, 20], result: 'x', description: 'y' })).toBeNull();
  });
});

describe('Table sampling', () => {
  it('does not give the same answer twice running', () => {
    const pool = ['a', 'b', 'c'];
    const memory: Record<string, string> = {};
    const rng = new SeededRNG('sampler');

    let repeats = 0;
    let previous = '';
    for (let i = 0; i < 200; i++) {
      const drawn = drawWithoutRepeat(pool, rng, memory, 'test', (entry) => entry);
      if (drawn === previous) repeats++;
      previous = drawn;
    }

    // A single re-draw cannot make repetition impossible, but it should be rare.
    expect(repeats).toBeLessThan(30);
  });

  it('a one-entry table still answers', () => {
    const memory: Record<string, string> = {};
    expect(drawWithoutRepeat(['only'], new SeededRNG('one'), memory, 'k', (e) => e)).toBe('only');
  });

  it('refuses to draw from an empty table rather than returning undefined', () => {
    expect(() =>
      drawWithoutRepeat([], new SeededRNG('none'), {}, 'empty', (e) => String(e))
    ).toThrow();
  });
});

describe('Embarkation', () => {
  it('every origin leaves the gallows with something to fight with', () => {
    for (const origin of ORIGINS) {
      const armed = origin.startingItems.some((id) => getItem(id)?.sourceDice);
      expect(armed, `${origin.id} has no weapon`).toBe(true);
    }
  });
});
