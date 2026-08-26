import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import type { StatsComponent } from '../src/core/ecs/Component';
import {
  HUNGER_PER_HOUR,
  THIRST_PER_HOUR,
  FATIGUE_PER_HOUR_AWAKE,
  FATIGUE_REST_RECOVERY_PER_HOUR,
  MAX_STAT_VALUE,
  WATER_SAVE_DC,
} from '../src/core/SimulationConstants';
import { MAX_EXHAUSTION } from '../src/core/rules/Exhaustion';

/**
 * Retrieves the player's stats component, which every scenario here depends on.
 */
function playerStats(sim: SimulationLoop): StatsComponent {
  return sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;
}

/**
 * Drives whole days of deprivation until the character dies of it.
 *
 * The meters are pinned at their ceiling each day, and anything that wandered up is
 * waved off, so the scenario isolates the deprivation path rather than turning into a
 * fight. Returns the number of days it took.
 */
function starveToDeath(sim: SimulationLoop, stats: StatsComponent, maxDays = 40): number {
  let day = 0;
  for (; day < maxDays && !sim.state.gameOver; day++) {
    stats.hunger = MAX_STAT_VALUE;
    stats.thirst = MAX_STAT_VALUE;
    sim.state.encounterId = null;
    sim.submitCommand({ type: 'REST', hours: 24 });
  }
  return day;
}

describe('NeedsSystem', () => {
  it('accrues hunger and thirst once per elapsed hour, not once per command', () => {
    const sim = new SimulationLoop('needs-accrual');
    const stats = playerStats(sim);
    stats.hunger = 0;
    stats.thirst = 0;

    const hours = 10;
    sim.submitCommand({ type: 'REST', hours });

    expect(stats.hunger).toBeCloseTo(HUNGER_PER_HOUR * hours, 5);
    expect(stats.thirst).toBeCloseTo(THIRST_PER_HOUR * hours, 5);
  });

  it('rest recovers fatigue faster than being awake accrues it', () => {
    const sim = new SimulationLoop('needs-fatigue');
    const stats = playerStats(sim);
    stats.fatigue = 60;

    const hours = 5;
    sim.submitCommand({ type: 'REST', hours });

    const expected = 60 - hours * (FATIGUE_REST_RECOVERY_PER_HOUR - FATIGUE_PER_HOUR_AWAKE);
    expect(stats.fatigue).toBeCloseTo(expected, 5);
    expect(stats.fatigue).toBeLessThan(60);
  });

  it('going without food and water costs levels of exhaustion', () => {
    const sim = new SimulationLoop('needs-deprivation');
    const stats = playerStats(sim);

    // Deprivation is settled at the turn of each day, so drive whole days with the
    // meters pinned at their ceiling.
    for (let day = 0; day < 12 && stats.exhaustion === 0; day++) {
      stats.hunger = MAX_STAT_VALUE;
      stats.thirst = MAX_STAT_VALUE;
      sim.state.encounterId = null;
      sim.submitCommand({ type: 'REST', hours: 24 });
    }

    expect(stats.exhaustion).toBeGreaterThan(0);
    expect(sim.state.log.some((e) => e.message.includes('Exhausted'))).toBe(true);
  });

  it('exhaustion reaches the sixth level and ends the run', () => {
    const sim = new SimulationLoop('needs-exhaustion-death');
    const stats = playerStats(sim);

    starveToDeath(sim, stats);

    expect(sim.state.gameOver).toBe(true);
    expect(stats.exhaustion).toBe(MAX_EXHAUSTION);
    expect(sim.state.causeOfDeath).toBeTruthy();
    expect(sim.state.log.some((e) => e.type === 'death')).toBe(true);
  });

  it('a failed water save is a Constitution saving throw, and it is shown', () => {
    const sim = new SimulationLoop('needs-water-save');
    const stats = playerStats(sim);

    stats.thirst = MAX_STAT_VALUE;
    sim.submitCommand({ type: 'REST', hours: 24 });

    // The save is rolled and narrated whether it passes or fails.
    expect(
      sim.state.log.some((e) => e.message.includes(`Constitution save DC ${WATER_SAVE_DC}`))
    ).toBe(true);
  });

  it('death stops time: further commands are refused', () => {
    const sim = new SimulationLoop('needs-refusal');
    const stats = playerStats(sim);

    starveToDeath(sim, stats);
    expect(sim.state.gameOver).toBe(true);

    const tickAtDeath = sim.state.tick;
    sim.submitCommand({ type: 'REST', hours: 8 });
    sim.submitCommand({ type: 'MOVE', direction: 'north' });

    expect(sim.state.tick).toBe(tickAtDeath);
  });

  it('consuming a carried item relieves the need it targets', () => {
    const sim = new SimulationLoop('needs-consume');
    const stats = playerStats(sim);
    const inventory = sim.state.entities.getComponent(sim.state.playerId, 'inventory')!;
    inventory.items.waterskin = 1;

    stats.thirst = 80;
    sim.submitCommand({ type: 'CONSUME', item: 'waterskin' });

    expect(stats.thirst).toBeLessThan(80);
    expect(inventory.items.waterskin).toBeUndefined();
  });
});
