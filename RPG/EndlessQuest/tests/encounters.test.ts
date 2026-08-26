import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import {
  Difficulty,
  DIFFICULTY_ORDER,
  budgetFor,
  difficultyForBand,
  fitsBudget,
} from '../src/core/rules/Encounters';
import { BESTIARY, getArchetype } from '../src/core/lore/Bestiary';
import { levelFor } from '../src/core/rules/Progression';
import { waterWithinReach } from '../src/core/world/Water';
import { TerrainType } from '../src/core/world/TerrainType';
import type {
  AbilitiesComponent,
  MarkComponent,
  PositionComponent,
  StatsComponent,
  ThreatComponent,
} from '../src/core/ecs/Component';
import { XP_THRESHOLDS } from '../src/core/SimulationConstants';

describe('Encounter budgets', () => {
  it('climbs with the character on every grade', () => {
    for (const difficulty of DIFFICULTY_ORDER) {
      for (let level = 1; level < 5; level++) {
        expect(
          budgetFor(level + 1, difficulty),
          `${difficulty} at level ${level + 1}`
        ).toBeGreaterThan(budgetFor(level, difficulty));
      }
    }
  });

  it('grades harder as the Mark burns', () => {
    expect(difficultyForBand(0)).toBe(Difficulty.EASY);
    expect(difficultyForBand(1)).toBe(Difficulty.MEDIUM);
    expect(difficultyForBand(2)).toBe(Difficulty.HARD);
    expect(difficultyForBand(3)).toBe(Difficulty.DEADLY);
    // Once the mark is open the country has nothing worse left to send.
    expect(difficultyForBand(4)).toBe(Difficulty.DEADLY);
  });

  it('keeps the worst things in the bestiary away from a first-level character', () => {
    const inquisitor = getArchetype('chain-inquisitor')!;
    const sated = getArchetype('sated')!;

    // Not even a deadly first-level encounter has room for these.
    expect(fitsBudget(inquisitor.xp, 1, Difficulty.DEADLY)).toBe(false);
    expect(fitsBudget(sated.xp, 1, Difficulty.DEADLY)).toBe(false);

    // They become possible as the character grows into them.
    expect(fitsBudget(inquisitor.xp, 5, Difficulty.DEADLY)).toBe(true);
  });

  it('does not send a fifth-level character to swat grave-wicks', () => {
    const wick = getArchetype('grave-wick')!;
    expect(fitsBudget(wick.xp, 1, Difficulty.EASY)).toBe(true);
    expect(fitsBudget(wick.xp, 5, Difficulty.EASY)).toBe(false);
  });

  it('every creature in the bestiary is reachable at some level and grade', () => {
    for (const archetype of BESTIARY) {
      const reachable = [1, 2, 3, 4, 5].some((level) =>
        DIFFICULTY_ORDER.some((difficulty) => fitsBudget(archetype.xp, level, difficulty))
      );
      expect(reachable, `${archetype.id} can never be met`).toBe(true);
    }
  });

  it('never sends a first-level character something beyond its budget in play', () => {
    for (let seed = 0; seed < 25; seed++) {
      const sim = new SimulationLoop(`budget-${seed}`);
      const stats = sim.state.entities.getComponent<StatsComponent>(
        sim.state.playerId,
        'stats'
      )!;
      const abilities = sim.state.entities.getComponent<AbilitiesComponent>(
        sim.state.playerId,
        'abilities'
      )!;
      const mark = sim.state.entities.getComponent<MarkComponent>(
        sim.state.playerId,
        'mark'
      )!;

      for (let i = 0; i < 120 && !sim.state.gameOver; i++) {
        // Hold the character at first level and the country at its worst.
        abilities.xp = 0;
        abilities.level = 1;
        mark.intensity = 100;
        stats.hunger = 0;
        stats.thirst = 0;
        stats.fatigue = 0;
        stats.hp = stats.maxHp;

        if (sim.state.encounterId !== null) {
          const threat = sim.state.entities.getComponent<ThreatComponent>(
            sim.state.encounterId,
            'threat'
          )!;
          const archetype = getArchetype(threat.archetypeId)!;
          expect(
            fitsBudget(archetype.xp, 1, Difficulty.DEADLY),
            `${archetype.id} met at first level`
          ).toBe(true);
          sim.state.encounterId = null;
        }
        sim.submitCommand({ type: 'REST', hours: 4 });
      }
    }
  });

  it('respects what the Mark itself gates, not only the budget', () => {
    // Two different questions: the budget asks whether the character could survive
    // meeting this, the threshold asks whether the thing is out here at all. A
    // fifth-level character in cold country must not meet the Sated however well they
    // could handle one.
    for (let seed = 0; seed < 20; seed++) {
      const sim = new SimulationLoop(`minmark-${seed}`);
      const stats = sim.state.entities.getComponent<StatsComponent>(
        sim.state.playerId,
        'stats'
      )!;
      const abilities = sim.state.entities.getComponent<AbilitiesComponent>(
        sim.state.playerId,
        'abilities'
      )!;
      const mark = sim.state.entities.getComponent<MarkComponent>(
        sim.state.playerId,
        'mark'
      )!;

      for (let i = 0; i < 60 && !sim.state.gameOver; i++) {
        abilities.level = 5;
        mark.intensity = 0;
        stats.hunger = 0;
        stats.thirst = 0;
        stats.hp = stats.maxHp;

        if (sim.state.encounterId !== null) {
          const threat = sim.state.entities.getComponent<ThreatComponent>(
            sim.state.encounterId,
            'threat'
          )!;
          const archetype = getArchetype(threat.archetypeId)!;
          expect(archetype.minMark, `${archetype.id} met with a cold mark`).toBe(0);
          sim.state.encounterId = null;
        }
        sim.submitCommand({ type: 'REST', hours: 4 });
      }
    }
  });

  it('advances the character on the source ladder', () => {
    expect(XP_THRESHOLDS[1]).toBe(300);
    expect(levelFor(299)).toBe(1);
    expect(levelFor(300)).toBe(2);
    expect(levelFor(900)).toBe(3);
  });
});

describe('Morale', () => {
  it('lets a creature break off once it is cut down, and pays for the survival', () => {
    let broke = 0;
    let killed = 0;

    for (let seed = 0; seed < 60; seed++) {
      const sim = new SimulationLoop(`morale-${seed}`);
      const stats = sim.state.entities.getComponent<StatsComponent>(
        sim.state.playerId,
        'stats'
      )!;

      for (let i = 0; i < 400 && sim.state.encounterId === null && !sim.state.gameOver; i++) {
        stats.hunger = 0;
        stats.thirst = 0;
        stats.hp = stats.maxHp;
        sim.submitCommand({ type: 'REST', hours: 3 });
      }
      if (sim.state.encounterId === null) continue;

      for (let round = 0; round < 30 && sim.state.encounterId !== null; round++) {
        stats.hp = stats.maxHp;
        sim.submitCommand({ type: 'ATTACK' });
      }

      if (sim.state.log.some((e) => (e.data as { broke?: boolean })?.broke)) broke++;
      else killed++;
    }

    // Both endings should happen; a fight that always ends one way is not a choice.
    expect(broke).toBeGreaterThan(0);
    expect(killed).toBeGreaterThan(0);
  });

  it('asks a creature only once in a fight', () => {
    const sim = new SimulationLoop('morale-once');
    const stats = sim.state.entities.getComponent<StatsComponent>(
      sim.state.playerId,
      'stats'
    )!;

    for (let i = 0; i < 400 && sim.state.encounterId === null && !sim.state.gameOver; i++) {
      stats.hunger = 0;
      stats.thirst = 0;
      stats.hp = stats.maxHp;
      sim.submitCommand({ type: 'REST', hours: 3 });
    }
    if (sim.state.encounterId === null) return;

    for (let round = 0; round < 30 && sim.state.encounterId !== null; round++) {
      stats.hp = stats.maxHp;
      sim.submitCommand({ type: 'ATTACK' });
    }

    const morales = sim.state.log.filter((e) => (e.data as { morale?: number })?.morale);
    expect(morales.length).toBeLessThanOrEqual(1);
  });
});

describe('Water', () => {
  it('finds nothing to drink on dry open ground', () => {
    const sim = new SimulationLoop('water-dry');
    // A tile with no water beside it and no moisture in it.
    for (let y = 0; y < sim.state.mapHeight; y++) {
      for (let x = 0; x < sim.state.mapWidth; x++) {
        const tile = sim.state.map[y][x];
        if (tile.terrain !== TerrainType.PLAINS || tile.moisture > 0.4) continue;
        let beside = false;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (sim.state.map[y + dy]?.[x + dx]?.terrain === TerrainType.WATER) beside = true;
        if (beside) continue;
        expect(waterWithinReach(sim.state, x, y)).toBeNull();
        return;
      }
    }
  });

  it('calls standing water in a mire foul, and running water clean', () => {
    const sim = new SimulationLoop('water-kinds');
    let sawFoul = false;
    let sawClean = false;

    for (let y = 1; y < sim.state.mapHeight - 1 && !(sawFoul && sawClean); y++) {
      for (let x = 1; x < sim.state.mapWidth - 1; x++) {
        const source = waterWithinReach(sim.state, x, y);
        if (source === 'foul') sawFoul = true;
        if (source === 'clean') sawClean = true;
      }
    }

    expect(sawFoul).toBe(true);
    expect(sawClean).toBe(true);
  });

  it('drinking from clean water slakes thirst and fills the skin', () => {
    const sim = new SimulationLoop('water-drink');
    const pos = sim.state.entities.getComponent<PositionComponent>(
      sim.state.playerId,
      'position'
    )!;
    const stats = sim.state.entities.getComponent<StatsComponent>(
      sim.state.playerId,
      'stats'
    )!;

    // Stand somewhere with clean water at hand.
    outer: for (let y = 1; y < sim.state.mapHeight - 1; y++) {
      for (let x = 1; x < sim.state.mapWidth - 1; x++) {
        if (waterWithinReach(sim.state, x, y) === 'clean') {
          pos.x = x;
          pos.y = y;
          break outer;
        }
      }
    }

    stats.thirst = 90;
    sim.submitCommand({ type: 'DRINK' });

    expect(stats.thirst).toBe(0);
    const inventory = sim.state.entities.getComponent(sim.state.playerId, 'inventory')!;
    expect(inventory.items.waterskin).toBeGreaterThan(0);
  });

  it('refuses where there is nothing to drink, rather than pretending', () => {
    const sim = new SimulationLoop('water-none');
    const pos = sim.state.entities.getComponent<PositionComponent>(
      sim.state.playerId,
      'position'
    )!;

    outer: for (let y = 1; y < sim.state.mapHeight - 1; y++) {
      for (let x = 1; x < sim.state.mapWidth - 1; x++) {
        if (waterWithinReach(sim.state, x, y) === null) {
          pos.x = x;
          pos.y = y;
          break outer;
        }
      }
    }

    sim.submitCommand({ type: 'DRINK' });
    expect(sim.state.log.some((e) => e.type === 'error' && e.message.includes('no water'))).toBe(
      true
    );
  });
});
