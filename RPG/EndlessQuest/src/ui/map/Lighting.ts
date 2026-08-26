import { DayPhase, getDayPhase } from '../../core/world/TimeOfDay';
import {
  MARK_MAX,
  DAYLIGHT_SIGHT_RADIUS,
  TWILIGHT_SIGHT_RADIUS,
  NIGHT_SIGHT_RADIUS,
} from '../../core/SimulationConstants';
import { INK, VOID, mix, shade } from './Glyphs';

/**
 * The light model.
 *
 * Deep-simulation roguelikes get most of their atmosphere from what the player cannot
 * see: tiles in view are lit, tiles merely remembered are drab, and everything else is
 * dark. That distinction is doing narrative work, so it is worth drawing properly.
 *
 * Two things are specific to the Thornmarch. Sight collapses after dark, so night is
 * legibly worse to travel in rather than only statistically worse. And the Gallowsmark
 * bleeds into the edges of vision as it heats, which makes the render itself report
 * the game's central pressure gauge -- the art is the instrument.
 */

/**
 * Sight radii, re-exported from the core.
 *
 * How far a character sees decides what the map remembers, so the numbers belong to the
 * simulation and the renderer only reads them.
 */
export const DAYLIGHT_RADIUS = DAYLIGHT_SIGHT_RADIUS;
export const TWILIGHT_RADIUS = TWILIGHT_SIGHT_RADIUS;
export const NIGHT_RADIUS = NIGHT_SIGHT_RADIUS;

/** Brightness floor for a tile that is remembered but not currently seen. */
export const REMEMBERED_BRIGHTNESS = 0.42;
/** How far past the sight radius a tile still catches any light at all. */
const FALLOFF_MARGIN = 2.5;

/**
 * The sight radius for a phase of the day.
 * @param phase Phase of the day
 * @returns Radius in tiles
 */
export function sightRadius(phase: DayPhase): number {
  switch (phase) {
    case DayPhase.DAY:
      return DAYLIGHT_RADIUS;
    case DayPhase.DAWN:
    case DayPhase.DUSK:
      return TWILIGHT_RADIUS;
    case DayPhase.NIGHT:
    default:
      return NIGHT_RADIUS;
  }
}

/**
 * How brightly a tile is lit, given how far it is from the character.
 *
 * Full brightness within the radius, a soft falloff just beyond it, and nothing past
 * that. The falloff margin is what stops the lit area reading as a hard disc.
 *
 * @param distance Chebyshev distance from the character in tiles
 * @param radius Current sight radius
 * @returns Brightness in [0, 1]
 */
export function lightAt(distance: number, radius: number): number {
  if (distance <= radius) return 1;
  const beyond = distance - radius;
  if (beyond >= FALLOFF_MARGIN) return 0;
  return 1 - beyond / FALLOFF_MARGIN;
}

/**
 * The result of lighting a single tile.
 */
export interface LitTile {
  /** Whether the tile is currently in sight, as opposed to merely remembered */
  readonly visible: boolean;
  /** Final ink for the glyph */
  readonly color: number;
  /** Final wash behind the glyph, or undefined for none */
  readonly background?: number;
}

/**
 * Applies light, memory, and the Mark to a tile's colours.
 *
 * A visible tile keeps its ink, dimmed by the falloff. A remembered tile is pulled
 * toward iron and darkened, so the player can read the shape of what they have walked
 * without mistaking it for what they can presently see. The Mark's bleed is applied
 * last and scales with distance, so it creeps in from the edges of vision.
 *
 * @param baseColor The tile's unlit ink
 * @param baseBackground The tile's unlit wash, if any
 * @param distance Chebyshev distance from the character
 * @param radius Current sight radius
 * @param markIntensity Gallowsmark intensity in [0, MARK_MAX]
 * @returns Lit colours, or null if the tile is too dark to draw at all
 */
export function lightTile(
  baseColor: number,
  baseBackground: number | undefined,
  distance: number,
  radius: number,
  markIntensity: number
): LitTile | null {
  const light = lightAt(distance, radius);
  const visible = light > 0;

  // Out of sight entirely: draw it as memory, or not at all.
  const brightness = visible
    ? REMEMBERED_BRIGHTNESS + (1 - REMEMBERED_BRIGHTNESS) * light
    : REMEMBERED_BRIGHTNESS;

  let color = shade(baseColor, brightness);
  if (!visible) {
    // Memory is colourless: pull it toward iron before darkening.
    color = shade(mix(baseColor, INK.iron, 0.7), REMEMBERED_BRIGHTNESS);
  }

  // The Mark bleeds in from the periphery as it heats.
  const heat = Math.max(0, Math.min(1, markIntensity / MARK_MAX));
  if (heat > 0.2) {
    const edge = Math.min(1, distance / Math.max(1, radius));
    const bleed = (heat - 0.2) / 0.8;
    color = mix(color, INK.blood, bleed * edge * 0.5);
  }

  // On a board the difference between country in sight and country merely remembered
  // has to be readable at a glance, so the two are separated harder than the glyph
  // treatment needed: what is seen is lifted, what is remembered is flattened toward
  // slate and left there.
  const background =
    baseBackground === undefined
      ? undefined
      : visible
        ? shade(baseBackground, 0.75 + 0.45 * light)
        : shade(mix(baseBackground, INK.deep, 0.45), REMEMBERED_BRIGHTNESS);

  return { visible, color, background };
}

/**
 * The colour the whole viewport is cleared to.
 *
 * Warms toward blood as the Mark burns, so the frame itself carries the pressure.
 *
 * @param markIntensity Gallowsmark intensity
 * @returns Background colour
 */
export function voidColor(markIntensity: number): number {
  const heat = Math.max(0, Math.min(1, markIntensity / MARK_MAX));
  return mix(VOID, 0x1a0708, heat * 0.85);
}

/**
 * Convenience wrapper resolving the sight radius from the hour of day.
 * @param hour Hour of day in [0, 23]
 * @returns Radius in tiles
 */
export function sightRadiusAtHour(hour: number): number {
  return sightRadius(getDayPhase(hour));
}
