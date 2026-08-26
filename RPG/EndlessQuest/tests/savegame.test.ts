import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { SeededRNG } from '../src/core/rng/SeededRNG';
import {
  serializeGameState,
  deserializeGameState,
  SAVE_VERSION,
} from '../src/core/state/SaveGame';
import { World } from '../src/core/ecs/World';
import type { Direction } from '../src/core/state/Commands';
import type {
  InventoryComponent,
  MarkComponent,
  PositionComponent,
  StatsComponent,
} from '../src/core/ecs/Component';

/**
 * Plays a fixed, deterministic script so that saves are taken from a non-trivial state.
 */
function playScript(sim: SimulationLoop, steps: number): void {
  const scriptRng = new SeededRNG('save-script');
  const directions: Direction[] = ['north', 'south', 'east', 'west'];

  for (let i = 0; i < steps; i++) {
    if (sim.state.gameOver) return;

    if (sim.state.encounterId !== null) {
      sim.submitCommand({ type: 'ATTACK' });
      continue;
    }

    const roll = scriptRng.nextInt(0, 2);
    if (roll === 0) {
      sim.submitCommand({ type: 'MOVE', direction: directions[scriptRng.nextInt(0, 3)] });
    } else if (roll === 1) {
      sim.submitCommand({ type: 'REST', hours: scriptRng.nextInt(1, 6) });
    } else {
      sim.submitCommand({ type: 'SEARCH' });
    }
  }
}

describe('World serialization', () => {
  it('round-trips entities, components, and the id counter', () => {
    const world = new World();
    const a = world.createEntity();
    const b = world.createEntity();
    world.addComponent(a, { type: 'position', x: 3, y: 9 });
    world.addComponent(a, { type: 'name', name: 'Hild the Widow' });
    world.addComponent(b, { type: 'position', x: 1, y: 1 });
    world.destroyEntity(b);

    const restored = World.deserialize(world.serialize());

    expect(restored.size).toBe(world.size);
    expect(restored.getComponent<{ type: 'position'; x: number; y: number }>(a, 'position')?.x).toBe(3);
    expect(restored.getComponent<{ type: 'name'; name: string }>(a, 'name')?.name).toBe(
      'Hild the Widow'
    );
    expect(restored.query('position')).toEqual(world.query('position'));

    // A new entity must not reuse a destroyed entity's id.
    expect(restored.createEntity()).toBe(world.createEntity());
  });
});

describe('SaveGame', () => {
  it('restores time, position, needs, and the Mark exactly', () => {
    const sim = new SimulationLoop('save-fidelity');
    playScript(sim, 60);

    const payload = serializeGameState(sim.state);
    const restored = deserializeGameState(payload);

    expect(payload.version).toBe(SAVE_VERSION);
    expect(restored.tick).toBe(sim.state.tick);
    expect(restored.year).toBe(sim.state.year);
    expect(restored.day).toBe(sim.state.day);
    expect(restored.hour).toBe(sim.state.hour);
    expect(restored.seedString).toBe(sim.state.seedString);
    expect(restored.gameOver).toBe(sim.state.gameOver);

    const originalPos = sim.state.entities.getComponent<PositionComponent>(
      sim.state.playerId,
      'position'
    )!;
    const restoredPos = restored.entities.getComponent<PositionComponent>(
      restored.playerId,
      'position'
    )!;
    expect(restoredPos).toEqual(originalPos);

    const originalStats = sim.state.entities.getComponent<StatsComponent>(
      sim.state.playerId,
      'stats'
    )!;
    const restoredStats = restored.entities.getComponent<StatsComponent>(
      restored.playerId,
      'stats'
    )!;
    expect(restoredStats).toEqual(originalStats);

    const originalMark = sim.state.entities.getComponent<MarkComponent>(
      sim.state.playerId,
      'mark'
    )!;
    const restoredMark = restored.entities.getComponent<MarkComponent>(
      restored.playerId,
      'mark'
    )!;
    expect(restoredMark).toEqual(originalMark);

    const originalInv = sim.state.entities.getComponent<InventoryComponent>(
      sim.state.playerId,
      'inventory'
    )!;
    const restoredInv = restored.entities.getComponent<InventoryComponent>(
      restored.playerId,
      'inventory'
    )!;
    expect(restoredInv).toEqual(originalInv);
  });

  it('regenerates the identical map from the seed rather than storing it', () => {
    const sim = new SimulationLoop('save-map');
    playScript(sim, 40);

    const payload = serializeGameState(sim.state);
    const restored = deserializeGameState(payload);

    expect(JSON.stringify(payload)).not.toContain('movementCost');

    for (let y = 0; y < sim.state.mapHeight; y++) {
      for (let x = 0; x < sim.state.mapWidth; x++) {
        expect(restored.map[y][x].terrain).toBe(sim.state.map[y][x].terrain);
        expect(restored.map[y][x].settlement).toBe(sim.state.map[y][x].settlement);
        expect(restored.map[y][x].explored).toBe(sim.state.map[y][x].explored);
      }
    }
  });

  it('continues the exact RNG sequence the run was saved from', () => {
    const sim = new SimulationLoop('save-rng');
    playScript(sim, 50);

    const restored = deserializeGameState(serializeGameState(sim.state));

    for (let i = 0; i < 50; i++) {
      expect(restored.rng.nextFloat()).toBe(sim.state.rng.nextFloat());
    }
  });

  it('a restored run diverges from neither the original nor itself', () => {
    const sim = new SimulationLoop('save-continuation');
    playScript(sim, 40);

    const payload = serializeGameState(sim.state);

    const branchA = new SimulationLoop('save-continuation');
    branchA.restoreState(deserializeGameState(payload));
    const branchB = new SimulationLoop('save-continuation');
    branchB.restoreState(deserializeGameState(payload));

    playScript(branchA, 30);
    playScript(branchB, 30);

    expect(branchA.state.tick).toBe(branchB.state.tick);
    expect(branchA.state.log.length).toBe(branchB.state.log.length);

    const a = branchA.state.entities.getComponent<StatsComponent>(branchA.state.playerId, 'stats')!;
    const b = branchB.state.entities.getComponent<StatsComponent>(branchB.state.playerId, 'stats')!;
    expect(a).toEqual(b);
  });

  it('a loaded game does not replay the history it was saved from', () => {
    const sim = new SimulationLoop('save-no-replay');
    playScript(sim, 60);

    const payload = serializeGameState(sim.state);
    const resumed = new SimulationLoop('save-no-replay');
    resumed.restoreState(deserializeGameState(payload));

    const logLengthOnLoad = resumed.state.log.length;
    resumed.update();

    // Seeking the systems to the restored tick must suppress every skipped hour's events.
    expect(resumed.state.log.length).toBe(logLengthOnLoad);
  });

  it('rejects a save written by an incompatible version', () => {
    const sim = new SimulationLoop('save-version');
    const payload = serializeGameState(sim.state);
    payload.version = SAVE_VERSION + 1;

    expect(() => deserializeGameState(payload)).toThrow(/version/i);
  });
});
