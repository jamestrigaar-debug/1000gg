import {
  DAWN_HOUR,
  DAY_HOUR,
  DUSK_HOUR,
  NIGHT_HOUR,
  HOURS_PER_DAY,
  DAYS_PER_SEASON,
  SEASONS_PER_YEAR,
  DAYLIGHT_SIGHT_RADIUS,
  TWILIGHT_SIGHT_RADIUS,
  NIGHT_SIGHT_RADIUS,
} from '../SimulationConstants';
import { SEASON_NAMES } from '../lore/Lore';
import type { SeasonName } from '../lore/Lore';

/**
 * Coarse phase of the day/night cycle.
 * Used by the Mark, encounter, and flavour systems to modulate behaviour by light level.
 */
export enum DayPhase {
  DAWN = 'dawn',
  DAY = 'day',
  DUSK = 'dusk',
  NIGHT = 'night',
}

/**
 * Classifies an hour of the day into a DayPhase.
 * @param hour Hour of day in [0, 23]
 * @returns Corresponding DayPhase
 */
export function getDayPhase(hour: number): DayPhase {
  const h = ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  if (h >= DAWN_HOUR && h < DAY_HOUR) return DayPhase.DAWN;
  if (h >= DAY_HOUR && h < DUSK_HOUR) return DayPhase.DAY;
  if (h >= DUSK_HOUR && h < NIGHT_HOUR) return DayPhase.DUSK;
  return DayPhase.NIGHT;
}

/**
 * Indicates whether a DayPhase provides meaningful daylight.
 * @param phase DayPhase to test
 * @returns true for dawn and day, false for dusk and night
 */
export function isDaylight(phase: DayPhase): boolean {
  return phase === DayPhase.DAWN || phase === DayPhase.DAY;
}

/**
 * Determines the season for a given day of the year.
 * @param day Day of year (1-based, 1 to DAYS_PER_YEAR)
 * @returns Season name from the Thornmarch calendar
 */
export function getSeason(day: number): SeasonName {
  const index = Math.floor((day - 1) / DAYS_PER_SEASON) % SEASONS_PER_YEAR;
  return SEASON_NAMES[index];
}

/**
 * How far the character can see at an hour of the day.
 *
 * Sight collapses after dark, which is why night travel is legibly worse and not merely
 * statistically worse: a character who walks through the night arrives knowing almost
 * nothing about the country they crossed.
 *
 * @param hour Hour of day in [0, 23]
 * @returns Sight radius in tiles
 */
export function sightRadiusAtHour(hour: number): number {
  switch (getDayPhase(hour)) {
    case DayPhase.DAY:
      return DAYLIGHT_SIGHT_RADIUS;
    case DayPhase.DAWN:
    case DayPhase.DUSK:
      return TWILIGHT_SIGHT_RADIUS;
    case DayPhase.NIGHT:
    default:
      return NIGHT_SIGHT_RADIUS;
  }
}
