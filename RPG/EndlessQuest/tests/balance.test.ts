import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { TerrainType } from '../src/core/world/TerrainType';
import type { AbilitiesComponent, InventoryComponent, PositionComponent, StatsComponent } from '../src/core/ecs/Component';

/**
 * Balance, held as a test rather than as a note in a commit message.
 *
 * The argument this game makes is that preparation is worth more than speed: keep the
 * rites you find on the road and the debt can be argued down; walk straight at the tree
 * and it collects you. That is a claim about numbers, and it was measured by hand every
 * time the rules moved, which means it was one careless change away from quietly
 * stopping being true.
 *
 * So it is measured here. A deliberately mechanical player -- one who flees everything,
 * eats when hungry, drinks where there is water, and never uses a single clever thing
 * the game offers -- plays thirty worlds twice over, once rushing and once preparing.
 */

const DIRECTIONS: Record<string, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

/**
 * Steps one tile toward a target, going round open water.
 */
function stepToward(sim: SimulationLoop, tx: number, ty: number): void {
  const pos = sim.state.entities.getComponent<PositionComponent>(
    sim.state.playerId,
    'position'
  )!;
  const dx = tx - pos.x;
  const dy = ty - pos.y;

  const preferred =
    Math.abs(dx) >= Math.abs(dy)
      ? [dx > 0 ? 'east' : 'west', dy > 0 ? 'south' : 'north']
      : [dy > 0 ? 'south' : 'north', dx > 0 ? 'east' : 'west'];

  const options = [...preferred, 'north', 'south', 'east', 'west'];
  const direction =
    options.find((name) => {
      const [ox, oy] = DIRECTIONS[name];
      const tile = sim.state.map[pos.y + oy]?.[pos.x + ox];
      return tile && tile.terrain !== TerrainType.WATER;
    }) ?? 'north';

  sim.submitCommand({ type: 'MOVE', direction: direction as 'north' });
}

/**
 * Plays one world to its end and reports how it went.
 *
 * @param seed The world
 * @param prepare Whether to keep the rites found along the way
 * @returns Whether the character walked out, and how far they got
 */
function play(seed: string, prepare: boolean) {
  const sim = new SimulationLoop(seed);
  const state = sim.state;
  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position')!;
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats')!;

  let commands = 0;
  let reachedTree = false;

  const known = () =>
    state.reckoning.vigils.filter((vigil) => state.map[vigil.y][vigil.x].explored);

  while (!state.gameOver && commands++ < 4000) {
    if (state.encounterId !== null) {
      sim.submitCommand({ type: 'FLEE' });
      continue;
    }

    const inventory = state.entities.getComponent<InventoryComponent>(
      state.playerId,
      'inventory'
    )!;
    const carried = Object.keys(inventory.items);
    const drink = carried.find((item) => /water|ale|tea/.test(item));
    const eat = carried.find((item) =>
      /bread|meat|berr|mushroom|apple|cake|fish|honey|cheese/.test(item)
    );

    if (stats.thirst > 60 && drink) {
      sim.submitCommand({ type: 'CONSUME', item: drink });
      continue;
    }
    if (stats.hunger > 60 && eat) {
      sim.submitCommand({ type: 'CONSUME', item: eat });
      continue;
    }
    if (stats.fatigue > 70 || stats.hp < stats.maxHp * 0.7) {
      sim.submitCommand({ type: 'REST', hours: 8 });
      continue;
    }
    if (stats.thirst > 55) {
      sim.submitCommand({ type: 'DRINK' });
      sim.submitCommand({ type: 'SEARCH' });
      continue;
    }
    if (stats.hunger > 70 && !eat) {
      sim.submitCommand({ type: 'SEARCH' });
      continue;
    }

    if (prepare) {
      const rite = known().find((vigil) => !vigil.kept);
      if (rite) {
        if (pos.x !== rite.x || pos.y !== rite.y) {
          stepToward(sim, rite.x, rite.y);
        } else {
          sim.submitCommand({ type: 'VIGIL' });
        }
        continue;
      }
    }

    if (pos.x !== state.reckoning.treeX || pos.y !== state.reckoning.treeY) {
      stepToward(sim, state.reckoning.treeX, state.reckoning.treeY);
      continue;
    }

    reachedTree = true;
    sim.submitCommand({ type: 'RECKON' });
  }

  const abilities = state.entities.getComponent<AbilitiesComponent>(
    state.playerId,
    'abilities'
  )!;

  return {
    won: state.victory,
    reachedTree,
    day: state.day,
    level: abilities.level,
    rites: state.reckoning.vigils.filter((vigil) => vigil.kept).length,
  };
}

/**
 * Plays a set of worlds and totals the outcomes.
 */
function measure(prepare: boolean) {
  const seeds = 'abcdefghijklmnopqrstuvwxyz'.split('').concat(['aa', 'bb', 'cc', 'dd']);
  const runs = seeds.map((seed) => play(seed, prepare));

  return {
    runs: runs.length,
    wins: runs.filter((run) => run.won).length,
    reached: runs.filter((run) => run.reachedTree).length,
    levelled: runs.filter((run) => run.level > 1).length,
    days: runs.reduce((sum, run) => sum + run.day, 0) / runs.length,
  };
}

describe('The shape of a run', () => {
  const rushing = measure(false);
  const preparing = measure(true);

  it('rewards preparation several times over', () => {
    // The whole argument of the game, as a number. Measured at roughly ten to one when
    // this was written; the floor is set well under that so ordinary drift does not
    // fail the suite, but a collapse will.
    expect(preparing.wins).toBeGreaterThan(rushing.wins * 2);
  });

  it('can be won by a player who prepares, often enough to be worth trying', () => {
    expect(preparing.wins / preparing.runs).toBeGreaterThan(0.15);
  });

  it('is not won by simply walking at the tree', () => {
    // Arriving owing everything should almost always end with the debt being collected.
    expect(rushing.wins / rushing.runs).toBeLessThan(0.15);
  });

  it('lets most runs get far enough to see the tree', () => {
    expect(preparing.reached / preparing.runs).toBeGreaterThan(0.2);
  });

  it('is a journey of days rather than of hours or of months', () => {
    expect(preparing.days).toBeGreaterThan(4);
    expect(preparing.days).toBeLessThan(40);
  });

  it('grows the character on the way', () => {
    expect(preparing.levelled).toBeGreaterThan(0);
  });
});
