/**
 * Discrete terrain classifications for EndlessQuest world map.
 */
export enum TerrainType {
  PLAINS = 'plains',
  FOREST = 'forest',
  HILLS = 'hills',
  MOUNTAIN = 'mountain',
  WATER = 'water',
  SWAMP = 'swamp',
}

/**
 * Movement cost in simulation hours per terrain type.
 * Infinity indicates impassable terrain.
 */
export const TERRAIN_MOVEMENT_COST: Record<TerrainType, number> = {
  [TerrainType.PLAINS]: 1,
  [TerrainType.FOREST]: 2,
  [TerrainType.HILLS]: 3,
  [TerrainType.MOUNTAIN]: 4,
  [TerrainType.SWAMP]: 3,
  [TerrainType.WATER]: Infinity,
};

/**
 * 24-bit RGB hex colors used for terrain map visualization.
 */
export const TERRAIN_COLOR: Record<TerrainType, number> = {
  [TerrainType.PLAINS]: 0x90B77D,
  [TerrainType.FOREST]: 0x2D5016,
  [TerrainType.HILLS]: 0x8B7D6B,
  [TerrainType.MOUNTAIN]: 0x808080,
  [TerrainType.WATER]: 0x4A90E2,
  [TerrainType.SWAMP]: 0x5D4E37,
};

/**
 * Terrain passability flag.
 */
export const TERRAIN_PASSABLE: Record<TerrainType, boolean> = {
  [TerrainType.PLAINS]: true,
  [TerrainType.FOREST]: true,
  [TerrainType.HILLS]: true,
  [TerrainType.MOUNTAIN]: true,
  [TerrainType.SWAMP]: true,
  [TerrainType.WATER]: false,
};

/**
 * Multiplier applied to the Gallowsmark's hourly rise per terrain type.
 *
 * Old places and thin places draw more attention: the mire and the deep wood are
 * worse than open ground, where at least you can see what is coming.
 */
export const TERRAIN_MARK_AFFINITY: Record<TerrainType, number> = {
  [TerrainType.PLAINS]: 0.9,
  [TerrainType.FOREST]: 1.25,
  [TerrainType.HILLS]: 1.1,
  [TerrainType.MOUNTAIN]: 1.3,
  [TerrainType.SWAMP]: 1.5,
  [TerrainType.WATER]: 1.0,
};

/**
 * Array of all terrain enum members.
 */
export const ALL_TERRAIN_TYPES: TerrainType[] = Object.values(TerrainType) as TerrainType[];
