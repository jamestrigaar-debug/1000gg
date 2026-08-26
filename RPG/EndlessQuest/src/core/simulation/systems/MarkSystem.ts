import type { System } from '../../ecs/System';
import type { GameState } from '../../state/GameState';
import { isNearSettlement } from '../../state/GameState';
import type { MarkComponent, PositionComponent, StatsComponent } from '../../ecs/Component';
import type { GameEvent } from '../../../events/GameEvent';
import { EventBus } from '../../../events/EventBus';
import { clamp } from '../../../utils/math';
import { DayPhase, getDayPhase } from '../../world/TimeOfDay';
import { TERRAIN_MARK_AFFINITY } from '../../world/TerrainType';
import { MARK_BAND_LABELS, MARK_ESCALATION_LINES } from '../../lore/Flavor';
import { MARK_NAME } from '../../lore/Lore';
import {
  HOURS_PER_DAY,
  INITIAL_HOUR,
  MARK_MIN,
  MARK_MAX,
  MARK_NIGHT_RISE_PER_HOUR,
  MARK_DUSK_RISE_PER_HOUR,
  MARK_DAWN_FALL_PER_HOUR,
  MARK_DAY_FALL_PER_HOUR,
  MARK_WOUND_COEFFICIENT,
  MARK_SANCTUARY_FALL_PER_HOUR,
  MARK_SANCTUARY_RADIUS,
  MARK_BAND_THRESHOLDS,
} from '../../SimulationConstants';

/**
 * Drives the Gallowsmark, the simulation's central pressure gauge.
 *
 * The Mark rises through dusk and night, faster in old and thin places, faster still
 * when the player is bleeding; it falls in daylight and falls sharply within reach of
 * a settlement's hearthfires. Its intensity is the exponent in the encounter process's
 * rate function, so everything the player does to save time costs them exposure.
 *
 * See LORE.md section II for the fiction this implements.
 */
export class MarkSystem implements System {
  readonly name = 'MarkSystem';
  private eventBus: EventBus;
  private lastProcessedTick: number = 0;

  /**
   * @param eventBus EventBus used to broadcast Mark escalation events
   */
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Moves the tick cursor without applying the intervening hours.
   * @param tick Tick to treat as already processed
   */
  seek(tick: number): void {
    this.lastProcessedTick = tick;
  }

  /**
   * Integrates Mark intensity across every elapsed hour and reports band crossings.
   * @param state Current GameState
   */
  update(state: GameState): void {
    if (state.gameOver || state.tick <= this.lastProcessedTick) {
      this.lastProcessedTick = Math.max(this.lastProcessedTick, state.tick);
      return;
    }

    const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');

    if (!mark || !pos) {
      this.lastProcessedTick = state.tick;
      return;
    }

    const woundFraction = stats ? 1 - clamp(stats.hp / stats.maxHp, 0, 1) : 0;

    for (let t = this.lastProcessedTick + 1; t <= state.tick; t++) {
      const hour = (t + INITIAL_HOUR) % HOURS_PER_DAY;
      const delta = this.hourlyDelta(state, pos, getDayPhase(hour), woundFraction);
      mark.intensity = clamp(mark.intensity + delta, MARK_MIN, MARK_MAX);

      if (mark.intensity >= MARK_BAND_THRESHOLDS[MARK_BAND_THRESHOLDS.length - 1]) {
        mark.hoursBurning += 1;
      }
    }

    this.lastProcessedTick = state.tick;
    this.reportBandChange(state, mark);
  }

  /**
   * Computes the Mark's change for a single hour at the player's current location.
   *
   * @param state GameState
   * @param pos Player position
   * @param phase Phase of the day for this hour
   * @param woundFraction Missing health as a fraction of maximum, in [0, 1]
   * @returns Signed intensity change for the hour
   */
  private hourlyDelta(
    state: GameState,
    pos: PositionComponent,
    phase: DayPhase,
    woundFraction: number
  ): number {
    // Sanctuary overrides everything else: inside a village the Mark simply cools.
    if (isNearSettlement(state, pos.x, pos.y, MARK_SANCTUARY_RADIUS)) {
      return -MARK_SANCTUARY_FALL_PER_HOUR;
    }

    const tile = state.map[pos.y]?.[pos.x];
    const affinity = tile ? TERRAIN_MARK_AFFINITY[tile.terrain] : 1;

    switch (phase) {
      case DayPhase.NIGHT:
        return MARK_NIGHT_RISE_PER_HOUR * affinity * (1 + MARK_WOUND_COEFFICIENT * woundFraction);
      case DayPhase.DUSK:
        return MARK_DUSK_RISE_PER_HOUR * affinity * (1 + MARK_WOUND_COEFFICIENT * woundFraction);
      case DayPhase.DAWN:
        return -MARK_DAWN_FALL_PER_HOUR;
      case DayPhase.DAY:
      default:
        return -MARK_DAY_FALL_PER_HOUR;
    }
  }

  /**
   * Emits narration when the Mark moves into a different intensity band.
   */
  private reportBandChange(state: GameState, mark: MarkComponent): void {
    const band = markBand(mark.intensity);
    if (band === mark.band) return;

    const rising = band > mark.band;
    mark.band = band;

    const event: GameEvent = {
      tick: state.tick,
      type: rising ? 'danger' : 'system',
      message: MARK_ESCALATION_LINES[band],
      data: { mark: mark.intensity, band, label: MARK_BAND_LABELS[band], name: MARK_NAME },
    };
    state.log.push(event);
    this.eventBus.emit(event);
  }
}

/**
 * Maps a Mark intensity onto its band index.
 * @param intensity Mark intensity in [MARK_MIN, MARK_MAX]
 * @returns Band index into MARK_BAND_THRESHOLDS and MARK_BAND_LABELS
 */
export function markBand(intensity: number): number {
  let band = 0;
  for (let i = 0; i < MARK_BAND_THRESHOLDS.length; i++) {
    if (intensity >= MARK_BAND_THRESHOLDS[i]) band = i;
  }
  return band;
}
