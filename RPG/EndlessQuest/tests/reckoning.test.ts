import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { SeededRNG } from '../src/core/rng/SeededRNG';
import { MapGenerator } from '../src/core/world/MapGenerator';
import {
  placeReckoning,
  vigilAt,
  atTree,
  vigilsKept,
  bearingTo,
} from '../src/core/world/Reckoning';
import { serializeGameState, deserializeGameState } from '../src/core/state/SaveGame';
import { levelFor, xpToNext, hitPointsGained } from '../src/core/rules/Progression';
import { TerrainType } from '../src/core/world/TerrainType';
import type { AbilitiesComponent, MarkComponent, StatsComponent } from '../src/core/ecs/Component';
import {
  RECKONING_TREE_MIN_DISTANCE,
  VIGIL_COUNT,
  MAX_CHARACTER_LEVEL,
  XP_THRESHOLDS,
} from '../src/core/SimulationConstants';

/**
 * Generates a world and its reckoning for a seed.
 */
function world(seed: string) {
  const { map, startX, startY } = new MapGenerator(new SeededRNG(seed)).generate();
  return { map, startX, startY, reckoning: placeReckoning(seed, map, startX, startY) };
}

describe('The Reckoning', () => {
  it('places the tree far from where the character wakes, on ground they can walk to', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { map, startX, startY, reckoning } = world(seed);
      const distance = Math.max(
        Math.abs(reckoning.treeX - startX),
        Math.abs(reckoning.treeY - startY)
      );

      expect(distance, `seed ${seed}`).toBeGreaterThanOrEqual(RECKONING_TREE_MIN_DISTANCE);
      expect(map[reckoning.treeY][reckoning.treeX].terrain).not.toBe(TerrainType.WATER);
    }
  });

  it('strings the vigils along the road rather than scattering them', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { startX, startY, reckoning } = world(seed);
      expect(reckoning.vigils, `seed ${seed}`).toHaveLength(VIGIL_COUNT);

      const direct = Math.max(
        Math.abs(reckoning.treeX - startX),
        Math.abs(reckoning.treeY - startY)
      );

      for (const vigil of reckoning.vigils) {
        // Going by way of any one vigil should not cost more than half the journey again.
        const detour =
          Math.max(Math.abs(vigil.x - startX), Math.abs(vigil.y - startY)) +
          Math.max(Math.abs(reckoning.treeX - vigil.x), Math.abs(reckoning.treeY - vigil.y));
        expect(detour, `${seed}/${vigil.id}`).toBeLessThan(direct * 1.75);
      }
    }
  });

  it('is a pure function of the seed, like the settlements', () => {
    const first = world('repeatable').reckoning;
    const second = world('repeatable').reckoning;
    expect(second).toEqual(first);
  });

  it('keeping a rite argues the debt down and cools the Mark', () => {
    const sim = new SimulationLoop('rite');
    const vigil = sim.state.reckoning.vigils[0];
    const pos = sim.state.entities.getComponent(sim.state.playerId, 'position')!;
    const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;
    pos.x = vigil.x;
    pos.y = vigil.y;
    mark.intensity = 60;

    // The rite is a check, so it is attempted until it takes, as a player would.
    for (let attempt = 0; attempt < 30 && !vigil.kept; attempt++) {
      sim.submitCommand({ type: 'VIGIL' });
    }

    expect(vigil.kept).toBe(true);
    expect(vigilsKept(sim.state.reckoning)).toBe(1);
    expect(mark.intensity).toBeLessThan(60);
  });

  it('refuses the rite and the reckoning anywhere but their own ground', () => {
    const sim = new SimulationLoop('elsewhere');
    const pos = sim.state.entities.getComponent(sim.state.playerId, 'position')!;
    pos.x = 0;
    pos.y = 0;

    sim.submitCommand({ type: 'VIGIL' });
    sim.submitCommand({ type: 'RECKON' });

    const errors = sim.state.log.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(2);
    expect(sim.state.gameOver).toBe(false);
  });

  it('an unprepared reckoning is survivable but unlikely; a prepared one is likely', () => {
    const outcome = (rites: number): number => {
      let won = 0;
      for (let i = 0; i < 60; i++) {
        const sim = new SimulationLoop(`reckon-${rites}-${i}`);
        const pos = sim.state.entities.getComponent(sim.state.playerId, 'position')!;
        const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;
        mark.intensity = 30;
        pos.x = sim.state.reckoning.treeX;
        pos.y = sim.state.reckoning.treeY;
        for (let v = 0; v < rites; v++) sim.state.reckoning.vigils[v].kept = true;

        sim.submitCommand({ type: 'RECKON' });
        if (sim.state.victory) won++;
      }
      return won / 60;
    };

    const unprepared = outcome(0);
    const prepared = outcome(3);

    expect(unprepared).toBeLessThan(0.4);
    expect(prepared).toBeGreaterThan(unprepared);
    expect(prepared).toBeGreaterThan(0.5);
  });

  it('the reckoning ends the run either way, and says which', () => {
    const sim = new SimulationLoop('ending');
    const pos = sim.state.entities.getComponent(sim.state.playerId, 'position')!;
    pos.x = sim.state.reckoning.treeX;
    pos.y = sim.state.reckoning.treeY;

    sim.submitCommand({ type: 'RECKON' });

    expect(sim.state.gameOver).toBe(true);
    expect(sim.state.victory === (sim.state.causeOfDeath === null)).toBe(true);
  });

  it('carries the rites kept, and the win, across a save', () => {
    const sim = new SimulationLoop('reckon-save');
    sim.state.reckoning.vigils[1].kept = true;

    const restored = deserializeGameState(JSON.parse(JSON.stringify(serializeGameState(sim.state))));

    expect(restored.reckoning.treeX).toBe(sim.state.reckoning.treeX);
    expect(restored.reckoning.vigils[1].kept).toBe(true);
    expect(vigilsKept(restored.reckoning)).toBe(1);
    expect(restored.victory).toBe(false);
  });

  it('locates the tree and the vigils by coordinate', () => {
    const { reckoning } = world('lookup');
    expect(atTree(reckoning, reckoning.treeX, reckoning.treeY)).toBe(true);
    expect(atTree(reckoning, reckoning.treeX + 1, reckoning.treeY)).toBe(false);

    const vigil = reckoning.vigils[0];
    expect(vigilAt(reckoning, vigil.x, vigil.y)?.id).toBe(vigil.id);
    expect(vigilAt(reckoning, -1, -1)).toBeUndefined();
  });

  it('names a bearing the way a traveller would', () => {
    expect(bearingTo(10, 10, 10, 0)).toBe('north');
    expect(bearingTo(10, 10, 20, 10)).toBe('east');
    expect(bearingTo(10, 10, 20, 20)).toBe('south-east');
    expect(bearingTo(10, 10, 10, 10)).toBe('here');
  });
});

describe('Progression', () => {
  it('climbs the ladder and stops at the top of it', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(XP_THRESHOLDS[1])).toBe(2);
    expect(levelFor(XP_THRESHOLDS[1] - 1)).toBe(1);
    expect(levelFor(999999)).toBe(MAX_CHARACTER_LEVEL);
    expect(xpToNext(999999)).toBeNull();
    expect(xpToNext(0)).toBe(XP_THRESHOLDS[1]);
  });

  it('a level is always worth at least one hit point, however frail the character', () => {
    const rng = new SeededRNG('hp');
    for (let i = 0; i < 100; i++) {
      expect(hitPointsGained(rng, 3)).toBeGreaterThanOrEqual(1);
    }
  });

  it('surviving a threat is worth experience even when it is not killed', () => {
    const sim = new SimulationLoop('xp-flee');
    const abilities = sim.state.entities.getComponent<AbilitiesComponent>(
      sim.state.playerId,
      'abilities'
    )!;
    const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;
    expect(abilities.xp).toBe(0);

    // Drive the world until something comes, then break off from it.
    for (let i = 0; i < 400 && sim.state.encounterId === null && !sim.state.gameOver; i++) {
      stats.hunger = 0;
      stats.thirst = 0;
      stats.hp = stats.maxHp;
      sim.submitCommand({ type: 'REST', hours: 4 });
    }
    expect(sim.state.encounterId).not.toBeNull();

    for (let i = 0; i < 30 && sim.state.encounterId !== null && !sim.state.gameOver; i++) {
      stats.hp = stats.maxHp;
      sim.submitCommand({ type: 'FLEE' });
    }

    expect(abilities.xp).toBeGreaterThan(0);
  });
});
