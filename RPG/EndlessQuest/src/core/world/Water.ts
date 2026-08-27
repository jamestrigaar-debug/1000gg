import type { GameState } from '../state/GameState';
import { TerrainType } from './TerrainType';
import { SiteKind, siteNear } from './Sites';
import { DRINKABLE_MOISTURE, WATER_FROM_SPRING_RANGE } from '../SimulationConstants';

/** What sort of water is at hand, if any. */
export type WaterSource = 'clean' | 'foul' | null;

/**
 * Reports what there is to drink within reach of a tile.
 *
 * Open water on an adjoining tile is clean enough for a man with a cloth to strain it
 * through. A mire is standing water and is not, but it is water. High ground holds
 * snowmelt in its hollows, which is the cleanest thing in the Thornmarch.
 *
 * @param state Current game state
 * @param x Map X coordinate
 * @param y Map Y coordinate
 * @returns The kind of water at hand, or null
 */
export function waterWithinReach(state: GameState, x: number, y: number): WaterSource {
  const here = state.map[y]?.[x];
  if (!here) return null;

  // A spring is a spring. The country was scattered with them and not one of them gave
  // anybody a drink, because nothing ever asked the sites what they were -- which is
  // most of why a stress run of forty worlds died thirty-eight times of the same thing.
  if (siteNear(state.sites, x, y, WATER_FROM_SPRING_RANGE, SiteKind.SPRING)) return 'clean';

  // Anything running, on any of the eight tiles around.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (state.map[y + dy]?.[x + dx]?.terrain === TerrainType.WATER) {
        // Water bordering a mire has the mire in it.
        return here.terrain === TerrainType.SWAMP ? 'foul' : 'clean';
      }
    }
  }

  if (here.terrain === TerrainType.SWAMP) return 'foul';
  if (here.terrain === TerrainType.MOUNTAIN && here.moisture > DRINKABLE_MOISTURE) {
    return 'clean';
  }
  if (here.moisture > DRINKABLE_MOISTURE) return 'clean';

  return null;
}
