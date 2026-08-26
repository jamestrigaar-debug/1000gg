import { createNoise2D } from 'simplex-noise';
import { SeededRNG } from '../rng/SeededRNG';
import { TerrainType, TERRAIN_MOVEMENT_COST } from './TerrainType';
import type { Tile } from './Tile';
import type { Settlement } from './Settlement';
import { generateSettlementName } from '../lore/Names';
import { MAP_WIDTH, MAP_HEIGHT } from './Tile';
import {
  ELEVATION_OCTAVE_1_FREQ,
  ELEVATION_OCTAVE_1_WEIGHT,
  ELEVATION_OCTAVE_2_FREQ,
  ELEVATION_OCTAVE_2_WEIGHT,
  ELEVATION_OCTAVE_3_FREQ,
  ELEVATION_OCTAVE_3_WEIGHT,
  ELEVATION_EXPONENT,
  MOISTURE_OCTAVE_1_FREQ,
  MOISTURE_OCTAVE_1_WEIGHT,
  MOISTURE_OCTAVE_2_FREQ,
  MOISTURE_OCTAVE_2_WEIGHT,
  WATER_ELEVATION_THRESHOLD,
  SWAMP_MOISTURE_THRESHOLD_LOW,
  SWAMP_MOISTURE_THRESHOLD_MID,
  PLAINS_ELEVATION_THRESHOLD,
  FOREST_HILLS_ELEVATION_THRESHOLD,
  FOREST_MOISTURE_THRESHOLD,
  MIN_SETTLEMENT_COUNT,
  MAX_SETTLEMENT_COUNT,
  SETTLEMENT_MARGIN,
  MAX_SETTLEMENT_ATTEMPTS,
} from '../SimulationConstants';

/**
 * Result structure returned from procedural map generation.
 */
export interface MapGenerationResult {
  /** 2D grid of world tiles indexed as map[y][x] */
  map: Tile[][];
  /** Starting X coordinate for player spawn */
  startX: number;
  /** Starting Y coordinate for player spawn */
  startY: number;
  /** Named settlements placed on the map */
  settlements: Settlement[];
}

/**
 * Procedural world map generator using multi-octave 2D simplex noise for elevation and moisture.
 * Fully deterministic based on SeededRNG.
 */
export class MapGenerator {
  private rng: SeededRNG;

  /**
   * @param rng Seeded PRNG instance
   */
  constructor(rng: SeededRNG) {
    this.rng = rng;
  }

  /**
   * Generates a 2D tile grid of specified dimensions and determines a valid starting location.
   * @param width Map width in tiles (defaults to MAP_WIDTH = 100)
   * @param height Map height in tiles (defaults to MAP_HEIGHT = 100)
   * @returns MapGenerationResult with tile grid and player start coordinates
   */
  generate(width: number = MAP_WIDTH, height: number = MAP_HEIGHT): MapGenerationResult {
    // Create deterministic noise functions using forked RNG streams
    const elevationRng = this.rng.fork();
    const moistureRng = this.rng.fork();
    const detailRng = elevationRng.fork();

    const elevationNoise = createNoise2D(() => elevationRng.nextFloat());
    const moistureNoise = createNoise2D(() => moistureRng.nextFloat());
    const detailNoise = createNoise2D(() => detailRng.nextFloat());

    const map: Tile[][] = [];

    for (let y = 0; y < height; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const ny = y / height;

        // Multi-octave elevation calculation
        let elev = 0;
        elev += elevationNoise(nx * ELEVATION_OCTAVE_1_FREQ, ny * ELEVATION_OCTAVE_1_FREQ) * ELEVATION_OCTAVE_1_WEIGHT;
        elev += elevationNoise(nx * ELEVATION_OCTAVE_2_FREQ, ny * ELEVATION_OCTAVE_2_FREQ) * ELEVATION_OCTAVE_2_WEIGHT;
        elev += detailNoise(nx * ELEVATION_OCTAVE_3_FREQ, ny * ELEVATION_OCTAVE_3_FREQ) * ELEVATION_OCTAVE_3_WEIGHT;
        // Normalize from [-1, 1] to [0, 1]
        elev = (elev + 1) / 2;
        elev = Math.pow(elev, ELEVATION_EXPONENT);

        // Multi-octave moisture calculation
        let moist = 0;
        moist += moistureNoise(nx * MOISTURE_OCTAVE_1_FREQ, ny * MOISTURE_OCTAVE_1_FREQ) * MOISTURE_OCTAVE_1_WEIGHT;
        moist += moistureNoise(nx * MOISTURE_OCTAVE_2_FREQ, ny * MOISTURE_OCTAVE_2_FREQ) * MOISTURE_OCTAVE_2_WEIGHT;
        moist = (moist + 1) / 2;

        const terrain = this.determineTerrain(elev, moist);

        const tile: Tile = {
          x,
          y,
          terrain,
          elevation: elev,
          moisture: moist,
          explored: false,
          movementCost: TERRAIN_MOVEMENT_COST[terrain],
          settlement: false,
        };
        row.push(tile);
      }
      map.push(row);
    }

    // Place 2-4 settlements on passable plains/hills
    const settlements: Settlement[] = [];
    const settlementCount = this.rng.nextInt(MIN_SETTLEMENT_COUNT, MAX_SETTLEMENT_COUNT);
    let placed = 0;
    let attempts = 0;
    while (placed < settlementCount && attempts < MAX_SETTLEMENT_ATTEMPTS) {
      const sx = this.rng.nextInt(SETTLEMENT_MARGIN, width - SETTLEMENT_MARGIN);
      const sy = this.rng.nextInt(SETTLEMENT_MARGIN, height - SETTLEMENT_MARGIN);
      const tile = map[sy][sx];
      if (tile.terrain === TerrainType.PLAINS || tile.terrain === TerrainType.HILLS) {
        if (!tile.settlement) {
          tile.settlement = true;
          settlements.push({ x: sx, y: sy, name: '' });
          placed++;
        }
      }
      attempts++;
    }

    // Name the settlements only after placement, so that adding names cannot perturb
    // the RNG draws that decide the terrain and the placements themselves.
    for (const settlement of settlements) {
      settlement.name = generateSettlementName(this.rng);
    }

    // Determine initial player start position on passable terrain near center
    const startPos = this.findStartPosition(map, width, height);

    // Guarantee player starting vicinity has passable terrain
    this.ensurePlayableArea(map, startPos.x, startPos.y);

    return { map, startX: startPos.x, startY: startPos.y, settlements };
  }

  /**
   * Biome classifier based on elevation and moisture values.
   * @param elevation Normalized elevation [0, 1]
   * @param moisture Normalized moisture [0, 1]
   * @returns Derived TerrainType
   */
  private determineTerrain(elevation: number, moisture: number): TerrainType {
    if (elevation < WATER_ELEVATION_THRESHOLD) {
      if (moisture > SWAMP_MOISTURE_THRESHOLD_LOW) return TerrainType.SWAMP;
      return TerrainType.WATER;
    }
    if (elevation < PLAINS_ELEVATION_THRESHOLD) {
      if (moisture > SWAMP_MOISTURE_THRESHOLD_MID && elevation > WATER_ELEVATION_THRESHOLD + 0.05) {
        return TerrainType.SWAMP;
      }
      return TerrainType.PLAINS;
    }
    if (elevation < FOREST_HILLS_ELEVATION_THRESHOLD) {
      if (moisture > FOREST_MOISTURE_THRESHOLD) return TerrainType.FOREST;
      return TerrainType.HILLS;
    }
    return TerrainType.MOUNTAIN;
  }

  /**
   * Searches for a valid, passable starting position with passable neighbors.
   * @param map Generated tile map
   * @param width Map width
   * @param height Map height
   * @returns Coordinate { x, y }
   */
  private findStartPosition(map: Tile[][], width: number, height: number): { x: number; y: number } {
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const maxRadius = Math.max(width, height);

    for (let r = 0; r < maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = centerX + dx;
          const y = centerY + dy;
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          const tile = map[y][x];
          if (tile.movementCost !== Infinity) {
            const passableNeighbors = this.countPassableNeighbors(map, x, y, width, height);
            if (passableNeighbors >= 3) {
              return { x, y };
            }
          }
        }
      }
    }

    // Fallback: search any passable tile
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (map[y][x].movementCost !== Infinity) return { x, y };
      }
    }

    // Last resort: force center to plains
    map[centerY][centerX].terrain = TerrainType.PLAINS;
    map[centerY][centerX].movementCost = TERRAIN_MOVEMENT_COST[TerrainType.PLAINS];
    return { x: centerX, y: centerY };
  }

  /**
   * Counts the number of passable 8-way adjacent neighbors for a given tile coordinate.
   */
  private countPassableNeighbors(map: Tile[][], x: number, y: number, w: number, h: number): number {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (map[ny][nx].movementCost !== Infinity) count++;
      }
    }
    return count;
  }

  /**
   * Ensures the immediate 3x3 surrounding starting tile is not blocked by impassable water.
   */
  private ensurePlayableArea(map: Tile[][], cx: number, cy: number): void {
    const w = map[0].length;
    const h = map.length;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        if (map[y][x].terrain === TerrainType.WATER) {
          map[y][x].terrain = TerrainType.PLAINS;
          map[y][x].movementCost = TERRAIN_MOVEMENT_COST[TerrainType.PLAINS];
        }
      }
    }
  }
}
