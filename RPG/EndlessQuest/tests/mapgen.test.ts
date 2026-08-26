import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/core/rng/SeededRNG';
import { MapGenerator } from '../src/core/world/MapGenerator';
import { ALL_TERRAIN_TYPES, TerrainType } from '../src/core/world/TerrainType';
import { MAP_WIDTH, MAP_HEIGHT } from '../src/core/world/Tile';

describe('MapGenerator', () => {
  it('determinism: same seed -> identical map', () => {
    const rng1 = new SeededRNG('map-seed');
    const rng2 = new SeededRNG('map-seed');
    const gen1 = new MapGenerator(rng1);
    const gen2 = new MapGenerator(rng2);
    const res1 = gen1.generate();
    const res2 = gen2.generate();

    expect(res1.map.length).toBe(res2.map.length);
    for (let y = 0; y < res1.map.length; y++) {
      for (let x = 0; x < res1.map[0].length; x++) {
        expect(res1.map[y][x].terrain).toBe(res2.map[y][x].terrain);
        expect(res1.map[y][x].elevation).toBe(res2.map[y][x].elevation);
        expect(res1.map[y][x].moisture).toBe(res2.map[y][x].moisture);
        expect(res1.map[y][x].settlement).toBe(res2.map[y][x].settlement);
      }
    }
    expect(res1.startX).toBe(res2.startX);
    expect(res1.startY).toBe(res2.startY);
  });

  it('different seeds -> different maps', () => {
    const rng1 = new SeededRNG('seed1');
    const rng2 = new SeededRNG('seed2');
    const gen1 = new MapGenerator(rng1);
    const gen2 = new MapGenerator(rng2);
    const res1 = gen1.generate();
    const res2 = gen2.generate();

    let diffCount = 0;
    for (let y = 0; y < res1.map.length; y++) {
      for (let x = 0; x < res1.map[0].length; x++) {
        if (res1.map[y][x].terrain !== res2.map[y][x].terrain) diffCount++;
      }
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it('map is 100x100', () => {
    const rng = new SeededRNG('size-test');
    const gen = new MapGenerator(rng);
    const res = gen.generate();
    expect(res.map.length).toBe(MAP_HEIGHT);
    expect(res.map[0].length).toBe(MAP_WIDTH);
  });

  it('all tiles have valid terrain and are initially unexplored', () => {
    const rng = new SeededRNG('valid-terrain');
    const gen = new MapGenerator(rng);
    const res = gen.generate();
    for (let y = 0; y < res.map.length; y++) {
      for (let x = 0; x < res.map[0].length; x++) {
        expect(ALL_TERRAIN_TYPES).toContain(res.map[y][x].terrain);
        expect(res.map[y][x].explored).toBe(false);
      }
    }
  });

  it('places 2 to 4 settlements exclusively on plains or hills', () => {
    const rng = new SeededRNG('settlements-seed');
    const gen = new MapGenerator(rng);
    const res = gen.generate();

    let settlementCount = 0;
    for (let y = 0; y < res.map.length; y++) {
      for (let x = 0; x < res.map[0].length; x++) {
        if (res.map[y][x].settlement) {
          settlementCount++;
          expect([TerrainType.PLAINS, TerrainType.HILLS]).toContain(res.map[y][x].terrain);
        }
      }
    }
    expect(settlementCount).toBeGreaterThanOrEqual(2);
    expect(settlementCount).toBeLessThanOrEqual(4);
  });

  it('starting position valid and passable', () => {
    const rng = new SeededRNG('start-pos');
    const gen = new MapGenerator(rng);
    const res = gen.generate();
    const tile = res.map[res.startY][res.startX];
    expect(tile.movementCost).not.toBe(Infinity);
    expect(tile.movementCost).toBeGreaterThan(0);
  });

  it('at least 50% passable tiles', () => {
    const rng = new SeededRNG('passable-test');
    const gen = new MapGenerator(rng);
    const res = gen.generate();
    let passable = 0;
    let total = 0;
    for (let y = 0; y < res.map.length; y++) {
      for (let x = 0; x < res.map[0].length; x++) {
        total++;
        if (res.map[y][x].movementCost !== Infinity) passable++;
      }
    }
    const ratio = passable / total;
    expect(ratio).toBeGreaterThan(0.5);
  });

  it('custom dimensions work', () => {
    const rng = new SeededRNG('custom-size');
    const gen = new MapGenerator(rng);
    const res = gen.generate(50, 50);
    expect(res.map.length).toBe(50);
    expect(res.map[0].length).toBe(50);
  });
});
