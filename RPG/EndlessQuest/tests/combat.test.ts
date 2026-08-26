import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/core/rng/SeededRNG';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import {
  sampleDamageMultiplier,
  decayStamina,
  staminaEffectiveness,
  hitProbability,
  resolveDamage,
} from '../src/core/simulation/CombatMath';
import { BESTIARY } from '../src/core/lore/Bestiary';
import { parseDice } from '../src/core/rules/Dice';
import type { StatsComponent } from '../src/core/ecs/Component';
import {
  COMBAT_DAMAGE_MULTIPLIER_CAP,
  COMBAT_MAX_STAMINA,
} from '../src/core/SimulationConstants';

describe('CombatMath', () => {
  it('damage multipliers respect the power law bounds', () => {
    const rng = new SeededRNG('crit-bounds');
    for (let i = 0; i < 5000; i++) {
      const m = sampleDamageMultiplier(rng);
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(COMBAT_DAMAGE_MULTIPLIER_CAP);
    }
  });

  it('most blows glance and heavy hits are genuinely rare', () => {
    const rng = new SeededRNG('crit-distribution');
    const samples = 20000;
    let heavy = 0;

    for (let i = 0; i < samples; i++) {
      if (sampleDamageMultiplier(rng) >= 2) heavy++;
    }

    // For a Pareto tail with alpha = 2.2, P(X >= 2) = 2^-2.2, near 22%.
    const rate = heavy / samples;
    expect(rate).toBeGreaterThan(0.15);
    expect(rate).toBeLessThan(0.30);
  });

  it('stamina decays monotonically and effectiveness follows it', () => {
    let stamina = COMBAT_MAX_STAMINA;
    let previousEffectiveness = staminaEffectiveness(stamina);

    for (let round = 0; round < 25; round++) {
      const next = decayStamina(stamina);
      expect(next).toBeLessThan(stamina);
      expect(next).toBeGreaterThanOrEqual(0);

      const effectiveness = staminaEffectiveness(next);
      expect(effectiveness).toBeLessThan(previousEffectiveness);
      expect(effectiveness).toBeGreaterThanOrEqual(0);

      stamina = next;
      previousEffectiveness = effectiveness;
    }
  });

  it('hit probability stays bounded and rewards the fresher combatant', () => {
    expect(hitProbability(100, 100)).toBeGreaterThan(0.05);
    expect(hitProbability(100, 100)).toBeLessThan(0.98);
    expect(hitProbability(100, 1)).toBeGreaterThan(hitProbability(1, 100));
  });

  it('armor reduces damage but a landed blow always hurts', () => {
    const rng = new SeededRNG('armor');
    for (let i = 0; i < 500; i++) {
      const { damage } = resolveDamage(6, COMBAT_MAX_STAMINA, 0.9, rng);
      expect(damage).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Bestiary', () => {
  it('every archetype is internally consistent', () => {
    for (const a of BESTIARY) {
      expect(a.hp).toBeGreaterThan(0);
      expect(() => parseDice(a.damageDice)).not.toThrow();
      expect(a.attackBonus).toBeGreaterThan(0);
      expect(a.armorClass).toBeGreaterThan(0);
      expect(a.tenacity).toBeGreaterThanOrEqual(0);
      expect(a.tenacity).toBeLessThanOrEqual(1);
      expect(a.weight).toBeGreaterThan(0);
      expect(a.appearance.length).toBeGreaterThan(0);
      expect(a.defeat.length).toBeGreaterThan(0);
    }
  });

  it('archetype identifiers are unique', () => {
    const ids = BESTIARY.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Combat resolution', () => {
  /**
   * Waits out in the open until something engages the player.
   *
   * Needs are topped up each turn so the character cannot die of thirst while waiting:
   * these tests are about combat, and the survival loop is covered elsewhere.
   */
  function provokeEncounter(seed: string, maxCommands = 500): SimulationLoop | null {
    const sim = new SimulationLoop(seed);
    for (let i = 0; i < maxCommands && sim.state.encounterId === null; i++) {
      const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;
      stats.hunger = 0;
      stats.thirst = 0;
      stats.fatigue = 0;
      sim.submitCommand({ type: 'REST', hours: 4 });
    }
    return sim.state.encounterId !== null ? sim : null;
  }

  it('the Mark eventually draws something out of the dark', () => {
    const sim = provokeEncounter('combat-provoke');
    expect(sim).not.toBeNull();
    expect(sim!.state.encounterId).not.toBeNull();
  });

  it('travel and rest are refused while engaged', () => {
    const sim = provokeEncounter('combat-gating');
    expect(sim).not.toBeNull();

    const tickBefore = sim!.state.tick;
    sim!.submitCommand({ type: 'REST', hours: 8 });
    sim!.submitCommand({ type: 'MOVE', direction: 'north' });

    expect(sim!.state.tick).toBe(tickBefore);
    expect(sim!.state.encounterId).not.toBeNull();
  });

  it('a fight resolves to a conclusion within a bounded number of rounds', () => {
    const sim = provokeEncounter('combat-resolution');
    expect(sim).not.toBeNull();

    for (let round = 0; round < 100 && sim!.state.encounterId !== null; round++) {
      sim!.submitCommand({ type: 'ATTACK' });
    }

    expect(sim!.state.encounterId).toBeNull();
  });

  it('combat is deterministic for a given seed', () => {
    const a = provokeEncounter('combat-determinism');
    const b = provokeEncounter('combat-determinism');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    for (let round = 0; round < 20; round++) {
      a!.submitCommand({ type: 'ATTACK' });
      b!.submitCommand({ type: 'ATTACK' });
    }

    const statsA = a!.state.entities.getComponent<StatsComponent>(a!.state.playerId, 'stats')!;
    const statsB = b!.state.entities.getComponent<StatsComponent>(b!.state.playerId, 'stats')!;

    expect(statsA.hp).toBe(statsB.hp);
    expect(a!.state.tick).toBe(b!.state.tick);
    expect(a!.state.log.length).toBe(b!.state.log.length);
  });
});
