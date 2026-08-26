import { TerrainType } from './TerrainType';
import {
  DEFAULT_MAP_WIDTH,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_TILE_SIZE,
  DEFAULT_VIEWPORT_WIDTH,
  DEFAULT_VIEWPORT_HEIGHT,
} from '../SimulationConstants';

/**
 * Individual world grid cell holding geographic and discovery attributes.
 */
export interface Tile {
  /** Map X coordinate (0 to width - 1) */
  x: number;
  /** Map Y coordinate (0 to height - 1) */
  y: number;
  /** Terrain classification */
  terrain: TerrainType;
  /** Normalized elevation value in [0, 1] */
  elevation: number;
  /** Normalized moisture value in [0, 1] */
  moisture: number;
  /** Exploration / visibility state */
  explored: boolean;
  /** Time cost in hours to enter this tile */
  movementCost: number;
  /** Flag indicating presence of a human settlement */
  settlement?: boolean;
}

export const MAP_WIDTH = DEFAULT_MAP_WIDTH;
export const MAP_HEIGHT = DEFAULT_MAP_HEIGHT;
export const TILE_SIZE = DEFAULT_TILE_SIZE;
export const VIEWPORT_WIDTH = DEFAULT_VIEWPORT_WIDTH;
export const VIEWPORT_HEIGHT = DEFAULT_VIEWPORT_HEIGHT;
