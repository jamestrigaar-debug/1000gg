import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { serializeGameState, deserializeGameState } from '../src/core/state/SaveGame';
import type { AbilitiesComponent, StatsComponent } from '../src/core/ecs/Component';
import { MAX_STAT_VALUE, MIN_STAT_VALUE, MAX_CHARACTER_LEVEL } from '../src/core/SimulationConstants';
import { MAX_EXHAUSTION } from '../src/core/rules/Exhaustion';

/**
 * Plays a run to its end with a simple strategy, asserting the world stays coherent.
 *
 * Long runs are where invariants go wrong: a meter drifts past its ceiling, a number
 * becomes NaN, entities pile up because something forgot to clean them, a list grows
 * without bound. None of that shows up in a test that submits three commands.
 */
function soak(seed: string, commands: number): SimulationLoop {
  const sim = new SimulationLoop(seed);
  const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;
  const abilities = sim.state.entities.getComponent<AbilitiesComponent>(
    sim.state.playerId,
    'abilities'
  )!;
  const directions = ['north', 'east', 'south', 'west'] as const;

  for (let i = 0; i < commands && !sim.state.gameOver; i++) {
    if (sim.state.encounterId !== null) {
      sim.submitCommand({ type: i % 3 === 0 ? 'FLEE' : 'ATTACK' });
    } else if (stats.fatigue > 70 || stats.hp < stats.maxHp * 0.5) {
      sim.submitCommand({ type: 'REST', hours: 8 });
    } else if (stats.hunger > 60 || stats.thirst > 60) {
      sim.submitCommand({ type: 'SEARCH' });
    } else {
      sim.submitCommand({ type: 'MOVE', direction: directions[i % 4] });
    }

    // Invariants, checked every single turn.
    expect(Number.isFinite(stats.hp), `hp finite at ${i}`).toBe(true);
    expect(stats.hp).toBeGreaterThanOrEqual(MIN_STAT_VALUE);
    expect(stats.hp).toBeLessThanOrEqual(stats.maxHp);
    for (const need of ['hunger', 'thirst', 'fatigue'] as const) {
      expect(Number.isFinite(stats[need]), `${need} finite at ${i}`).toBe(true);
      expect(stats[need]).toBeGreaterThanOrEqual(MIN_STAT_VALUE);
      expect(stats[need]).toBeLessThanOrEqual(MAX_STAT_VALUE);
    }
    expect(stats.exhaustion).toBeGreaterThanOrEqual(0);
    expect(stats.exhaustion).toBeLessThanOrEqual(MAX_EXHAUSTION);
    expect(abilities.level).toBeLessThanOrEqual(MAX_CHARACTER_LEVEL);
    expect(sim.state.tick).toBeGreaterThanOrEqual(0);
  }

  return sim;
}

describe('Long runs stay coherent', () => {
  it('holds every invariant across many runs to the death', () => {
    for (const seed of ['soak-a', 'soak-b', 'soak-c', 'soak-d', 'soak-e']) {
      const sim = soak(seed, 1500);

      // A finished run is finished for a reason.
      if (sim.state.gameOver) {
        expect(sim.state.victory || sim.state.causeOfDeath !== null).toBe(true);
      }
    }
  });

  it('does not leak threat entities as encounters come and go', () => {
    const sim = soak('soak-entities', 1200);

    // Only the player and, at most, whatever is on them right now should remain.
    const threats = sim.state.entities.query('threat');
    expect(threats.length).toBeLessThanOrEqual(1);
    if (sim.state.encounterId === null) expect(threats).toHaveLength(0);
  });

  it('keeps its bookkeeping bounded rather than growing all run', () => {
    const sim = soak('soak-bounded', 1500);

    // The narration memory holds one entry per table, not one per draw.
    expect(Object.keys(sim.state.lastDraw).length).toBeLessThan(60);
    // Threads are questions still open, not a history of every question ever asked.
    expect(sim.state.threads.length).toBeLessThan(20);
    // The live log is capped; the save keeps its own window.
    expect(sim.state.log.length).toBeLessThanOrEqual(2000);
  });

  it('keeps the chronicle in the order things happened', () => {
    // A command reports itself at the hour it finishes; the systems then report the
    // hours in between, which are earlier. Before this was fixed, a quarter of the
    // entries in a resting run came out ahead of entries that preceded them.
    const sim = soak('soak-order', 900);

    for (let i = 1; i < sim.state.log.length; i++) {
      expect(
        sim.state.log[i].tick,
        `"${sim.state.log[i].message.slice(0, 40)}" precedes "${sim.state.log[i - 1].message.slice(0, 40)}"`
      ).toBeGreaterThanOrEqual(sim.state.log[i - 1].tick);
    }
  });

  it('round-trips a long run through a save without changing it', () => {
    const sim = soak('soak-save', 900);
    const before = sim.state;

    const restored = deserializeGameState(
      JSON.parse(JSON.stringify(serializeGameState(before)))
    );

    expect(restored.tick).toBe(before.tick);
    expect(restored.day).toBe(before.day);
    expect(restored.threads.length).toBe(before.threads.length);
    expect(restored.reckoning.treeX).toBe(before.reckoning.treeX);
    expect(restored.victory).toBe(before.victory);

    const a = restored.entities.getComponent<StatsComponent>(restored.playerId, 'stats')!;
    const b = before.entities.getComponent<StatsComponent>(before.playerId, 'stats')!;
    expect(a.hp).toBe(b.hp);
    expect(a.exhaustion).toBe(b.exhaustion);

    // The restored run must not share mutable state with the one it came from.
    a.hp = 1;
    expect(b.hp).not.toBe(1);
  });

  it('is deterministic: the same seed and the same commands give the same run', () => {
    const a = soak('soak-determinism', 600);
    const b = soak('soak-determinism', 600);

    expect(b.state.tick).toBe(a.state.tick);
    expect(b.state.day).toBe(a.state.day);
    expect(b.state.causeOfDeath).toBe(a.state.causeOfDeath);
    expect(b.state.log.length).toBe(a.state.log.length);
    expect(b.state.log.map((e) => e.message)).toEqual(a.state.log.map((e) => e.message));
  });
});
