import type { System } from '../../ecs/System';
import type { GameState } from '../../state/GameState';
import { isNearSettlement, recordEvent } from '../../state/GameState';
import type {
  AbilitiesComponent,
  MarkComponent,
  PositionComponent,
  CombatantComponent,
  StatsComponent,
  ThreatComponent,
  NameComponent,
  RenderableComponent,
} from '../../ecs/Component';
import type { GameEvent } from '../../../events/GameEvent';
import { EventBus } from '../../../events/EventBus';
import type { RNG } from '../../rng/SeededRNG';
import { DayPhase, getDayPhase, isDaylight } from '../../world/TimeOfDay';
import { BESTIARY } from '../../lore/Bestiary';
import type { CreatureArchetype } from '../../lore/Bestiary';
import { pick } from '../../lore/Flavor';
import { markBand } from './MarkSystem';
import { settingsFor } from '../../rules/Difficulty';
import {
  DIFFICULTY_ORDER,
  difficultyForBand,
  fitsBudget,
} from '../../rules/Encounters';
import {
  HOURS_PER_DAY,
  INITIAL_HOUR,
  ENCOUNTER_BASE_RATE,
  ENCOUNTER_MARK_BETA,
  ENCOUNTER_NIGHT_MULTIPLIER,
  ENCOUNTER_DUSK_MULTIPLIER,
  ENCOUNTER_SANCTUARY_MULTIPLIER,
  ENCOUNTER_STALKED_MULTIPLIER,
  ENCOUNTER_MAX_HOURLY_PROBABILITY,
  ENCOUNTER_GRACE_TICKS,
  MARK_SANCTUARY_RADIUS,
} from '../../SimulationConstants';

/** Colour used to draw hostile entities on the map. */
const THREAT_COLOR = 0xb03030;

/**
 * Spawns hostile encounters from a non-homogeneous Poisson process.
 *
 * Design document section 2.4 specifies a rate function of the form
 * lambda(t) = lambda_0 * exp(beta_1 * X_1 + ...). Here the dominant covariate is
 * Gallowsmark intensity, modulated by the phase of the day and by whether the player
 * is standing within reach of a settlement. The per-hour probability of at least one
 * arrival is then 1 - exp(-lambda), which is sampled once per elapsed hour.
 *
 * Encounters resolve after the fact: the hours have already been spent by the time the
 * system runs, so the fiction is that something found the player partway through the
 * journey or the watch, and the fight starts from there.
 */
export class EncounterSystem implements System {
  readonly name = 'EncounterSystem';
  private eventBus: EventBus;
  private lastProcessedTick: number = 0;

  /**
   * @param eventBus EventBus used to broadcast encounter events
   */
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Moves the tick cursor without sampling the intervening hours.
   * @param tick Tick to treat as already processed
   */
  seek(tick: number): void {
    this.lastProcessedTick = tick;
  }

  /**
   * Samples the arrival process across every elapsed hour, spawning at most one threat.
   * @param state Current GameState
   */
  update(state: GameState): void {
    // Nothing comes off the road while the character is under a hill. Inside a place the
    // Dungeon Master decides what is in the room, and letting the country's own process
    // fire as well produced a threat the character could not reach: the combat commands
    // route to the instance, which had nothing in it, and a stress run collected eleven
    // hundred refusals of "there is nothing here to hit" while something waited outside.
    if (
      state.gameOver ||
      state.instance !== null ||
      state.encounterId !== null ||
      state.tick <= this.lastProcessedTick
    ) {
      this.lastProcessedTick = Math.max(this.lastProcessedTick, state.tick);
      return;
    }

    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
    if (!pos) {
      this.lastProcessedTick = state.tick;
      return;
    }

    const intensity = mark?.intensity ?? 0;
    const sanctuary = isNearSettlement(state, pos.x, pos.y, MARK_SANCTUARY_RADIUS);

    for (let t = this.lastProcessedTick + 1; t <= state.tick; t++) {
      if (t <= ENCOUNTER_GRACE_TICKS) continue;

      const hour = (t + INITIAL_HOUR) % HOURS_PER_DAY;
      const phase = getDayPhase(hour);
      const probability =
        hourlyEncounterProbability(intensity, phase, sanctuary, t <= state.stalkedUntil) *
        settingsFor(state.difficulty).encounterRate;

      if (state.rng.nextFloat() < probability) {
        const archetype = this.selectArchetype(state, phase, intensity, state.rng);
        if (archetype) {
          this.spawn(state, archetype, pos, t);
          this.lastProcessedTick = state.tick;
          return;
        }
      }
    }

    this.lastProcessedTick = state.tick;
  }

  /**
   * Chooses an archetype by weighted sampling among those eligible at this time and place.
   *
   * @param state GameState
   * @param phase Phase of the day the arrival occurred in
   * @param intensity Current Mark intensity
   * @param rng Seeded generator
   * @returns Selected archetype, or null if nothing is eligible
   */
  private selectArchetype(
    state: GameState,
    phase: DayPhase,
    intensity: number,
    rng: RNG
  ): CreatureArchetype | null {
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    const terrain = pos ? state.map[pos.y]?.[pos.x]?.terrain : undefined;
    const daylight = isDaylight(phase);

    // What the country is throwing is graded by the Mark; what can actually be thrown at
    // that grade is whatever fits this character's own budget. The Mark no longer picks
    // the monster, or a first-level character meets a swordsman of the Iron Chain on a
    // schedule they have no way to affect.
    const abilities = state.entities.getComponent<AbilitiesComponent>(
      state.playerId,
      'abilities'
    );
    const level = abilities?.level ?? 1;
    const aimed = difficultyForBand(markBand(intensity));

    // Two different questions, and both have to be answered. The budget asks whether the
    // character could survive meeting this; the Mark threshold asks whether the thing is
    // out here at all. The Sated are drawn by a burning weal specifically -- a
    // fifth-level character walking cold country should not meet one however well they
    // could handle it -- and when the budget system went in, this half was dropped and
    // eight thresholds in the bestiary quietly stopped meaning anything.
    const suits = (a: CreatureArchetype): boolean => {
      if (a.minMark > intensity) return false;
      if (a.nocturnal && daylight) return false;
      if (a.terrain.length > 0 && terrain !== undefined && !a.terrain.includes(terrain)) {
        return false;
      }
      return true;
    };

    let eligible = BESTIARY.filter((a) => suits(a) && fitsBudget(a.xp, level, aimed));

    // Nothing fits the grade being aimed at -- a stretch of country with the wrong
    // terrain for it, usually. Walk the grade down until something does, so the world
    // still has something to send rather than nothing.
    for (
      let step = DIFFICULTY_ORDER.indexOf(aimed) - 1;
      eligible.length === 0 && step >= 0;
      step--
    ) {
      eligible = BESTIARY.filter(
        (a) => suits(a) && fitsBudget(a.xp, level, DIFFICULTY_ORDER[step])
      );
    }

    if (eligible.length === 0) return null;

    const totalWeight = eligible.reduce((sum, a) => sum + a.weight, 0);
    let roll = rng.nextFloat() * totalWeight;
    for (const archetype of eligible) {
      roll -= archetype.weight;
      if (roll <= 0) return archetype;
    }
    return eligible[eligible.length - 1];
  }

  /**
   * Creates the threat entity and marks the player as engaged.
   */
  private spawn(
    state: GameState,
    archetype: CreatureArchetype,
    pos: PositionComponent,
    tick: number
  ): void {
    const world = state.entities;
    const id = world.createEntity();

    const threatPosition: PositionComponent = { type: 'position', x: pos.x, y: pos.y };
    const threatStats: StatsComponent = {
      type: 'stats',
      hp: archetype.hp,
      maxHp: archetype.hp,
      hunger: 0,
      thirst: 0,
      fatigue: 0,
      exhaustion: 0,
      daysWithoutFood: 0,
      daysWithoutWater: 0,
    };
    const combatant: CombatantComponent = {
      type: 'combatant',
      attackBonus: archetype.attackBonus,
      damageDice: archetype.damageDice,
      armorClass: archetype.armorClass,
    };
    const threat: ThreatComponent = {
      type: 'threat',
      archetypeId: archetype.id,
      tenacity: archetype.tenacity,
    };
    const name: NameComponent = { type: 'name', name: archetype.name };
    const renderable: RenderableComponent = { type: 'renderable', color: THREAT_COLOR };

    world.addComponent(id, threatPosition);
    world.addComponent(id, threatStats);
    world.addComponent(id, combatant);
    world.addComponent(id, threat);
    world.addComponent(id, name);
    world.addComponent(id, renderable);

    state.encounterId = id;
    state.encounterRound = 0;

    const event: GameEvent = {
      tick,
      type: 'danger',
      message: pick(archetype.appearance, state.rng),
      data: { archetype: archetype.id, kind: archetype.kind, entity: id },
    };
    recordEvent(state, event);
    this.eventBus.emit(event);
  }
}

/**
 * Computes the probability of at least one arrival during a single hour.
 *
 * Implements lambda = lambda_0 * exp(beta * mark) scaled by situational multipliers,
 * converted to a probability by the Poisson zero-arrival complement 1 - exp(-lambda).
 *
 * @param intensity Gallowsmark intensity in [0, 100]
 * @param phase Phase of the day
 * @param sanctuary Whether the player is within reach of a settlement
 * @returns Probability in [0, ENCOUNTER_MAX_HOURLY_PROBABILITY]
 */
export function hourlyEncounterProbability(
  intensity: number,
  phase: DayPhase,
  sanctuary: boolean,
  stalked: boolean = false
): number {
  let lambda = ENCOUNTER_BASE_RATE * Math.exp(ENCOUNTER_MARK_BETA * intensity);

  if (phase === DayPhase.NIGHT) lambda *= ENCOUNTER_NIGHT_MULTIPLIER;
  else if (phase === DayPhase.DUSK) lambda *= ENCOUNTER_DUSK_MULTIPLIER;

  if (stalked) lambda *= ENCOUNTER_STALKED_MULTIPLIER;
  if (sanctuary) lambda *= ENCOUNTER_SANCTUARY_MULTIPLIER;

  return Math.min(1 - Math.exp(-lambda), ENCOUNTER_MAX_HOURLY_PROBABILITY);
}
