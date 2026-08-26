import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { SeededRNG } from '../src/core/rng/SeededRNG';
import type { Direction } from '../src/core/state/Commands';
import type { PositionComponent, StatsComponent } from '../src/core/ecs/Component';

describe('End-to-End Simulation Determinism', () => {
  it('100 random commands on identical seed produce 100% identical states and logs', () => {
    const seed = 'end-to-end-determinism-seed-42';

    const sim1 = new SimulationLoop(seed);
    const sim2 = new SimulationLoop(seed);

    // Use a separate deterministic command generator
    const commandRng = new SeededRNG('command-script-seed');
    const directions: Direction[] = ['north', 'south', 'east', 'west'];

    for (let i = 0; i < 100; i++) {
      const actionType = commandRng.nextInt(0, 2);

      if (actionType === 0) {
        const dir = directions[commandRng.nextInt(0, directions.length - 1)];
        sim1.submitCommand({ type: 'MOVE', direction: dir });
        sim2.submitCommand({ type: 'MOVE', direction: dir });
      } else if (actionType === 1) {
        const hours = commandRng.nextInt(1, 8);
        sim1.submitCommand({ type: 'REST', hours });
        sim2.submitCommand({ type: 'REST', hours });
      } else {
        sim1.submitCommand({ type: 'SEARCH' });
        sim2.submitCommand({ type: 'SEARCH' });
      }
    }

    // Assert identical tick, year, day, hour
    expect(sim1.state.tick).toBe(sim2.state.tick);
    expect(sim1.state.year).toBe(sim2.state.year);
    expect(sim1.state.day).toBe(sim2.state.day);
    expect(sim1.state.hour).toBe(sim2.state.hour);

    // Assert identical player positions
    const pos1 = sim1.state.entities.getComponent<PositionComponent>(sim1.state.playerId, 'position')!;
    const pos2 = sim2.state.entities.getComponent<PositionComponent>(sim2.state.playerId, 'position')!;
    expect(pos1.x).toBe(pos2.x);
    expect(pos1.y).toBe(pos2.y);

    // Assert identical stats
    const stats1 = sim1.state.entities.getComponent<StatsComponent>(sim1.state.playerId, 'stats')!;
    const stats2 = sim2.state.entities.getComponent<StatsComponent>(sim2.state.playerId, 'stats')!;
    expect(stats1.fatigue).toBe(stats2.fatigue);
    expect(stats1.hunger).toBe(stats2.hunger);
    expect(stats1.thirst).toBe(stats2.thirst);

    // Assert identical event logs
    expect(sim1.state.log.length).toBe(sim2.state.log.length);
    for (let i = 0; i < sim1.state.log.length; i++) {
      expect(sim1.state.log[i].tick).toBe(sim2.state.log[i].tick);
      expect(sim1.state.log[i].type).toBe(sim2.state.log[i].type);
      expect(sim1.state.log[i].message).toBe(sim2.state.log[i].message);
    }

    // Assert identical RNG sequences continuation
    for (let i = 0; i < 20; i++) {
      expect(sim1.state.rng.nextFloat()).toBe(sim2.state.rng.nextFloat());
    }
  });
});
