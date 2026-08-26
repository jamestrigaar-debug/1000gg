import type { System } from '../../ecs/System';
import type { GameState } from '../../state/GameState';
import type { AbilitiesComponent, StatsComponent } from '../../ecs/Component';
import type { GameEvent } from '../../../events/GameEvent';
import { EventBus } from '../../../events/EventBus';
import { clamp } from '../../../utils/math';
import { savingThrow } from '../../state/Checks';
import { Ability, abilityModifier } from '../../rules/Abilities';
import { DC } from '../../rules/Check';
import {
  EXHAUSTION_LINES,
  MAX_EXHAUSTION,
  clampExhaustion,
  exhaustionLabel,
  hpMaxMultiplier,
  isFatal,
} from '../../rules/Exhaustion';
import {
  HUNGER_PER_HOUR,
  THIRST_PER_HOUR,
  FATIGUE_PER_HOUR_AWAKE,
  NEED_WARNING_THRESHOLD,
  HP_REGEN_PER_HOUR,
  HP_REGEN_NEED_CEILING,
  DAYS_WITHOUT_FOOD_BASE,
  WATER_SAVE_DC,
  MIN_STAT_VALUE,
  MAX_STAT_VALUE,
  HOURS_PER_DAY,
} from '../../SimulationConstants';

/**
 * Narration for each need as it crosses into distress.
 */
const NEED_WARNINGS: Record<'hunger' | 'thirst' | 'fatigue', string> = {
  hunger: 'Your stomach has stopped complaining, which is worse than when it did.',
  thirst: 'Your tongue is thick. You catch yourself thinking about standing water.',
  fatigue: 'You have been awake too long. The edges of things have started to move.',
};

/**
 * Advances survival needs and converts neglect into exhaustion.
 *
 * The three meters are the hour-to-hour readout; the six-level exhaustion ladder is what
 * actually cripples a character. A meter that tops out does not sit at a hundred, it
 * costs a level and resets, so neglect compounds rather than plateauing.
 *
 * Deprivation follows the source rules. A character can go without food for three days
 * plus their Constitution modifier before it begins costing levels. Going short of water
 * calls for a Constitution saving throw each day, and failing it costs a level -- two if
 * the character is already exhausted.
 *
 * Because the simulation only advances when a command is submitted, elapsed time is
 * processed one hour at a time, so a long rest cannot skip past a death.
 */
export class NeedsSystem implements System {
  readonly name = 'NeedsSystem';
  private eventBus: EventBus;
  private lastProcessedTick: number = 0;
  private warned: Set<string> = new Set();

  /**
   * @param eventBus EventBus used to broadcast need and mortality events
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
    this.warned.clear();
  }

  /**
   * Applies need accrual, deprivation, exhaustion, and healing for every elapsed hour.
   * @param state Current GameState
   */
  update(state: GameState): void {
    if (state.gameOver || state.tick <= this.lastProcessedTick) {
      this.lastProcessedTick = Math.max(this.lastProcessedTick, state.tick);
      return;
    }

    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
    if (!stats) {
      this.lastProcessedTick = state.tick;
      return;
    }

    for (let t = this.lastProcessedTick + 1; t <= state.tick; t++) {
      stats.hunger = clamp(stats.hunger + HUNGER_PER_HOUR, MIN_STAT_VALUE, MAX_STAT_VALUE);
      stats.thirst = clamp(stats.thirst + THIRST_PER_HOUR, MIN_STAT_VALUE, MAX_STAT_VALUE);
      stats.fatigue = clamp(
        stats.fatigue + FATIGUE_PER_HOUR_AWAKE,
        MIN_STAT_VALUE,
        MAX_STAT_VALUE
      );

      this.reportThresholds(state, stats, t);

      // Deprivation is settled once a day, at the turn of the day.
      if (t % HOURS_PER_DAY === 0) {
        this.settleDeprivation(state, stats, t);
        if (state.gameOver) {
          this.lastProcessedTick = t;
          return;
        }
      }

      // A meter at its ceiling costs a level and resets, so neglect compounds.
      if (stats.fatigue >= MAX_STAT_VALUE) {
        stats.fatigue = MAX_STAT_VALUE * 0.6;
        this.addExhaustion(state, stats, 1, t, 'You have been awake past what a body allows.');
        if (state.gameOver) {
          this.lastProcessedTick = t;
          return;
        }
      }

      this.applyHealing(stats);

      if (stats.hp <= 0) {
        // Falling to zero hands the outcome to the death saves, not to this system.
        stats.hp = 0;
      }
    }

    this.lastProcessedTick = state.tick;
  }

  /**
   * Settles a day's food and water at the turn of the day.
   */
  private settleDeprivation(state: GameState, stats: StatsComponent, tick: number): void {
    const abilities = state.entities.getComponent<AbilitiesComponent>(
      state.playerId,
      'abilities'
    );
    const conModifier = abilities ? abilityModifier(abilities.scores[Ability.CON]) : 0;

    // Food. A day counts as gone hungry if the meter is high at the turn of the day.
    if (stats.hunger >= NEED_WARNING_THRESHOLD) {
      stats.daysWithoutFood += 1;
      const endurance = Math.max(1, DAYS_WITHOUT_FOOD_BASE + conModifier);

      if (stats.daysWithoutFood > endurance) {
        this.addExhaustion(
          state,
          stats,
          1,
          tick,
          `${stats.daysWithoutFood} days without a proper meal. Your body has started spending itself.`
        );
      }
    } else {
      stats.daysWithoutFood = 0;
    }

    if (state.gameOver) return;

    // Water. Going short calls for a Constitution save; failing costs a level, and two
    // if the character is already exhausted.
    if (stats.thirst >= NEED_WARNING_THRESHOLD) {
      stats.daysWithoutWater += 1;
      const save = savingThrow(state, Ability.CON, WATER_SAVE_DC);

      if (!save.success) {
        const levels = stats.exhaustion > 0 ? 2 : 1;
        this.addExhaustion(
          state,
          stats,
          levels,
          tick,
          `Constitution save DC ${WATER_SAVE_DC}: ${save.total}. Failed. There has been no clean water for ${stats.daysWithoutWater} days.`
        );
      } else {
        this.emit(state, {
          tick,
          type: 'system',
          message: `Constitution save DC ${WATER_SAVE_DC}: ${save.total}. You hold out another day on what little there is.`,
          data: { save: save.total, dc: WATER_SAVE_DC },
        });
      }
    } else {
      stats.daysWithoutWater = 0;
    }
  }

  /**
   * Adds levels of exhaustion, narrating the new level and killing at the sixth.
   */
  private addExhaustion(
    state: GameState,
    stats: StatsComponent,
    levels: number,
    tick: number,
    reason: string
  ): void {
    const before = stats.exhaustion;
    stats.exhaustion = clampExhaustion(stats.exhaustion + levels);
    if (stats.exhaustion === before) return;

    this.emit(state, {
      tick,
      type: 'danger',
      message: `${reason} ${EXHAUSTION_LINES[stats.exhaustion]} (${exhaustionLabel(stats.exhaustion)})`,
      data: { exhaustion: stats.exhaustion, reason },
    });

    // The fourth level halves the hit point maximum, which can drop a character.
    const ceiling = Math.floor(stats.maxHp * hpMaxMultiplier(stats.exhaustion));
    if (stats.hp > ceiling) stats.hp = ceiling;

    if (isFatal(stats.exhaustion)) {
      state.gameOver = true;
      state.causeOfDeath = 'You went as far as a body goes, and then a little further.';
      this.emit(state, {
        tick,
        type: 'death',
        message: `${state.causeOfDeath} The debt at the tree goes uncollected a while longer.`,
        data: { cause: 'exhaustion', exhaustion: MAX_EXHAUSTION },
      });
    }
  }

  /**
   * Heals slowly while every need is comfortably met.
   */
  private applyHealing(stats: StatsComponent): void {
    if (
      stats.hp > 0 &&
      stats.hunger < HP_REGEN_NEED_CEILING &&
      stats.thirst < HP_REGEN_NEED_CEILING &&
      stats.fatigue < HP_REGEN_NEED_CEILING
    ) {
      const ceiling = Math.floor(stats.maxHp * hpMaxMultiplier(stats.exhaustion));
      stats.hp = Math.min(ceiling, stats.hp + HP_REGEN_PER_HOUR);
    }
  }

  /**
   * Emits a warning the first time a need crosses into distress. Warnings rearm once
   * the need is relieved.
   */
  private reportThresholds(state: GameState, stats: StatsComponent, tick: number): void {
    const needs: Array<'hunger' | 'thirst' | 'fatigue'> = ['hunger', 'thirst', 'fatigue'];

    for (const need of needs) {
      const key = `${need}:warn`;
      if (stats[need] >= NEED_WARNING_THRESHOLD) {
        if (!this.warned.has(key)) {
          this.warned.add(key);
          this.emit(state, {
            tick,
            type: 'danger',
            message: NEED_WARNINGS[need],
            data: { need, value: stats[need] },
          });
        }
      } else {
        this.warned.delete(key);
      }
    }
  }

  /**
   * Records an event in the log and broadcasts it.
   */
  private emit(state: GameState, event: GameEvent): void {
    state.log.push(event);
    this.eventBus.emit(event);
  }
}

/**
 * Re-exported so callers configuring difficulty can reach the water save DC.
 */
export { DC };
