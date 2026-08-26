import type { Command, Direction } from './Commands';
import type { GameState } from './GameState';
import { advanceTime, getCurrentTile, revealArea } from './GameState';
import { addItem, countItem, removeItem } from './Inventory';
import { settlementAt } from '../world/Settlement';
import { atTree, vigilAt, vigilsKept } from '../world/Reckoning';
import { peopleAt, regard, ROLE_TITLE } from '../world/People';
import {
  ErrandState,
  canDischarge,
  dischargeErrand,
  errandOf,
  raiseErrand,
} from '../narrative/Errands';
import { markBand } from '../simulation/systems/MarkSystem';
import { hpMaxMultiplier } from '../rules/Exhaustion';
import { Ability } from '../rules/Abilities';
import { savingThrow } from './Checks';
import {
  RECKONING_LINES,
  RECKONING_VICTORY,
  RECKONING_FAILURE,
} from '../lore/Lore';
import { equipItem, unequipSlot } from './Equipment';
import { CheckOutcome, isAnySuccess } from '../rules/Check';
import { Skill } from '../rules/Skills';
import { skillCheck, narrateCheck, snapshotNeeds, describeChange } from './Checks';
import { FORAGE_DC } from '../SimulationConstants';
import { OracleEngine } from '../narrative/Oracle';
import { applyTwist } from '../narrative/Twists';
import { narrate } from '../narrative/Narrator';
import { improvise } from '../narrative/Improvise';
import { ORACLE_TABLES } from '../narrative/OracleTables';
import { getDayPhase, sightRadiusAtHour } from '../world/TimeOfDay';
import { EventBus } from '../../events/EventBus';
import type { GameEvent } from '../../events/GameEvent';
import type {
  InventoryComponent,
  MarkComponent,
  PositionComponent,
  StatsComponent,
} from '../ecs/Component';
import { CombatResolver } from '../simulation/CombatResolver';
import type { CombatStance } from '../simulation/CombatResolver';
import { getItem } from '../lore/Items';
import { drawWithoutRepeat } from '../lore/Sampler';
import {
  FORAGE_FAILURE_LINES,
  FORAGE_TABLE,
  PHASE_AMBIENCE,
  TERRAIN_NAME,
  describeArrival,
  describeBlocked,
  pick,
} from '../lore/Flavor';
import {
  FATIGUE_PER_MOVE_COST,
  FATIGUE_REST_RECOVERY_PER_HOUR,
  MIN_REST_HOURS,
  MAX_REST_HOURS,
  SEARCH_TIME_COST_HOURS,
  AMBIENCE_PROBABILITY,
  SEARCH_REVEAL_RADIUS,
  TRADE_COIN_COST,
  TRADE_CURRENCY_ITEM,
  TRADE_FORAGE_YIELD,
  TRADE_WATER_YIELD,
  TRADE_LINEN_YIELD,
  MIN_STAT_VALUE,
  MAX_STAT_VALUE,
  FORAGE_CONSUME_THRESHOLD,
  VIGIL_RITE_HOURS,
  VIGIL_DC,
  VIGIL_MARK_RELIEF,
  RECKONING_BASE_DC,
  RECKONING_VIGIL_RELIEF,
  RECKONING_BAND_PENALTY,
  RECKONING_SAVES,
  RECKONING_SUCCESSES,
  MIN_RECKONING_DC,
  MARK_MIN,
  LONG_REST_HOURS,
  LONG_REST_HEAL_FRACTION,
  NEED_WARNING_THRESHOLD,
  TALK_HOURS,
  TALK_MARK_PENALTY,
  TALK_DISPOSITION_SCALE,
} from '../SimulationConstants';

/**
 * Directional coordinate offsets.
 */
const DIRECTION_DELTAS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

/**
 * Command handler interface.
 */
export interface ICommandHandler {
  handle(command: Command, state: GameState): GameEvent[];
}

/**
 * Handles validation, state transition, and event emission for player commands.
 *
 * Two global gates apply before any command is dispatched: a dead character accepts no
 * further orders, and a character with something already on them may only fight or run.
 */
export class CommandHandler implements ICommandHandler {
  private combat: CombatResolver = new CombatResolver();
  private oracle: OracleEngine = new OracleEngine(ORACLE_TABLES);

  constructor(private eventBus: EventBus) {}

  /**
   * Executes a command against the game state and returns resulting game events.
   * @param command Command to execute
   * @param state Mutable GameState
   * @returns Array of generated GameEvents
   */
  handle(command: Command, state: GameState): GameEvent[] {
    const events: GameEvent[] = [];

    const refusal = this.checkGates(command, state);
    if (refusal) {
      events.push(refusal);
      this.publish(events, state);
      return events;
    }

    switch (command.type) {
      case 'MOVE': {
        const ev = this.handleMove(command.direction, state);
        if (ev) events.push(ev);
        break;
      }
      case 'REST': {
        const ev = this.handleRest(command.hours, state);
        events.push(ev);
        break;
      }
      case 'SEARCH': {
        const ev = this.handleSearch(state);
        events.push(ev);
        break;
      }
      case 'CONSUME': {
        const ev = this.handleConsume(command.item, state);
        events.push(ev);
        break;
      }
      case 'TRADE': {
        const ev = this.handleTrade(state);
        events.push(ev);
        break;
      }
      case 'EQUIP': {
        const ev = this.handleEquip(command.item, state);
        events.push(ev);
        break;
      }
      case 'VIGIL': {
        events.push(this.handleVigil(state));
        break;
      }
      case 'RECKON': {
        events.push(...this.handleReckon(state));
        break;
      }
      case 'TALK': {
        events.push(...this.handleTalk(state));
        break;
      }
      case 'ACCEPT': {
        events.push(this.handleAccept(state));
        break;
      }
      case 'GIVE': {
        events.push(...this.handleGive(state));
        break;
      }
      case 'IMPROVISE': {
        const engaged = state.encounterId !== null;
        events.push(
          ...improvise(
            state,
            command.text,
            command.skill as Skill,
            command.hard,
            this.oracle,
            engaged
          ).events
        );
        if (engaged) events.push(...this.combat.answerImprovisation(state));
        break;
      }
      case 'UNEQUIP': {
        const ev = this.handleUnequip(command.slot, state);
        events.push(ev);
        break;
      }
      case 'ATTACK':
        events.push(...this.combat.resolveRound(state, 'attack' as CombatStance));
        break;
      case 'DEFEND':
        events.push(...this.combat.resolveRound(state, 'defend' as CombatStance));
        break;
      case 'FLEE':
        events.push(...this.combat.resolveRound(state, 'flee' as CombatStance));
        break;
      case 'FEINT':
        events.push(...this.combat.resolveRound(state, 'feint' as CombatStance));
        break;
      case 'INTIMIDATE':
        events.push(...this.combat.resolveRound(state, 'intimidate' as CombatStance));
        break;
      case 'NEW_GAME': {
        events.push({
          tick: state.tick,
          type: 'system',
          message: `Starting new game${command.seed ? ` with seed ${command.seed}` : ''}...`,
          data: { seed: command.seed },
        });
        break;
      }
    }

    this.publish(events, state);
    return events;
  }

  /**
   * Applies the death and engagement gates.
   * @returns A refusal event, or null if the command may proceed
   */
  private checkGates(command: Command, state: GameState): GameEvent | null {
    if (command.type === 'NEW_GAME') return null;

    if (state.gameOver) {
      return {
        tick: state.tick,
        type: 'error',
        message: 'You are dead. Begin again, if you have the stomach for it.',
      };
    }

    const isCombatCommand =
      command.type === 'ATTACK' ||
      command.type === 'DEFEND' ||
      command.type === 'FLEE' ||
      command.type === 'FEINT' ||
      command.type === 'INTIMIDATE';

    // Anything the player describes in their own words is allowed in a fight: that is
    // where improvising matters most, and the thing in front of them answers it.
    const allowedWhileEngaged =
      isCombatCommand ||
      command.type === 'CONSUME' ||
      command.type === 'EQUIP' ||
      command.type === 'IMPROVISE';

    if (state.encounterId !== null && !allowedWhileEngaged) {
      return {
        tick: state.tick,
        type: 'error',
        message: 'Not now. It is already on you.',
      };
    }

    if (state.encounterId === null && isCombatCommand) {
      return {
        tick: state.tick,
        type: 'error',
        message: 'There is nothing here to fight.',
      };
    }

    return null;
  }

  /**
   * Records events in the log and broadcasts them.
   */
  private publish(events: GameEvent[], state: GameState): void {
    for (const e of events) {
      state.log.push(e);
      this.eventBus.emit(e);
    }
  }

  /**
   * Handles player directional movement with bounds validation, passability checks,
   * fog of war reveal, and fatigue consumption.
   */
  private handleMove(direction: Direction, state: GameState): GameEvent | null {
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    if (!pos) {
      return {
        tick: state.tick,
        type: 'error',
        message: 'Player has no position!',
      };
    }

    const delta = DIRECTION_DELTAS[direction];
    const newX = pos.x + delta.dx;
    const newY = pos.y + delta.dy;

    // Bounds check
    if (newX < 0 || newX >= state.mapWidth || newY < 0 || newY >= state.mapHeight) {
      return {
        tick: state.tick,
        type: 'error',
        message: `You cannot move ${direction}, the world ends there.`,
      };
    }

    const targetTile = state.map[newY][newX];
    if (targetTile.movementCost === Infinity) {
      return {
        tick: state.tick,
        type: 'error',
        message: `You cannot move ${direction}. ${describeBlocked(targetTile.terrain)}`,
      };
    }

    // Update position
    pos.x = newX;
    pos.y = newY;

    // Reveal terrain around new position
    // What the character remembers of the country is what they could see of it, which
    // is why a march made after dark leaves almost nothing on the map.
    revealArea(state, newX, newY, sightRadiusAtHour(state.hour));

    // Advance simulation time by terrain movement cost
    advanceTime(state, targetTile.movementCost);

    // Increase fatigue based on terrain difficulty
    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
    if (stats) {
      stats.fatigue = Math.min(
        MAX_STAT_VALUE,
        stats.fatigue + targetTile.movementCost * FATIGUE_PER_MOVE_COST
      );
    }

    const arrival = describeArrival(targetTile.terrain, state.rng);
    const settlement = settlementAt(state.settlements, newX, newY);
    const settlementMsg = settlement
      ? ` This is ${settlement.name}. Woodsmoke, and the sound of people who have not yet noticed you.`
      : targetTile.settlement
        ? ' There is woodsmoke ahead.'
        : '';

    // Arriving somewhere that matters is said plainly, ahead of any ambience: these are
    // the only two tiles on the map the whole run is about.
    const site = atTree(state.reckoning, newX, newY)
      ? ' The gallows-tree stands here. The rope is still on it.'
      : (() => {
          const vigil = vigilAt(state.reckoning, newX, newY);
          if (!vigil) return '';
          return vigil.kept
            ? ` You are standing in ${vigil.name} again. It has nothing more for you.`
            : ` This is ${vigil.name}.`;
        })();

    // Occasional ambience so the hour of day is felt during travel, not just read
    // off the status bar.
    const ambience =
      state.rng.nextFloat() < AMBIENCE_PROBABILITY
        ? ` ${drawWithoutRepeat(
            PHASE_AMBIENCE[getDayPhase(state.hour)],
            state.rng,
            state.lastDraw,
            `ambience:${getDayPhase(state.hour)}`,
            (line) => line
          )}`
        : '';

    const told = narrate(state, `${arrival}${settlementMsg}${site}${ambience}`);

    return {
      tick: state.tick,
      type: 'movement',
      message: told.text,
      data: {
        direction,
        x: newX,
        y: newY,
        terrain: targetTile.terrain,
        register: told.register,
        unreliable: told.unreliable,
      },
    };
  }

  /**
   * Handles resting for a duration, recovering fatigue.
   *
   * Hunger and thirst are not touched here: NeedsSystem is the sole source of need
   * accrual and applies it uniformly across every elapsed hour, resting or not.
   */
  private handleRest(hours: number, state: GameState): GameEvent {
    const clamped = Math.max(MIN_REST_HOURS, Math.min(MAX_REST_HOURS, Math.floor(hours)));
    advanceTime(state, clamped);

    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
    let change = '';
    if (stats) {
      // The meters are read before the clock is wound forward by the systems, so what is
      // reported is what the rest itself was worth.
      const before = snapshotNeeds(stats);
      stats.fatigue = Math.max(
        MIN_STAT_VALUE,
        stats.fatigue - clamped * FATIGUE_REST_RECOVERY_PER_HOUR
      );
      // A night's sleep is worth something, which is the handbook's position and also
      // the only way a character wounded on day two is still walking on day nine. It has
      // to be bought: eight unbroken hours, fed and watered, out where things hunt.
      if (
        clamped >= LONG_REST_HOURS &&
        stats.hunger < NEED_WARNING_THRESHOLD &&
        stats.thirst < NEED_WARNING_THRESHOLD
      ) {
        const ceiling = Math.floor(stats.maxHp * hpMaxMultiplier(stats.exhaustion));
        const recovered = Math.ceil(stats.maxHp * LONG_REST_HEAL_FRACTION);
        stats.hp = Math.min(ceiling, stats.hp + recovered);
      }

      change = describeChange(before, stats);
    }

    return {
      tick: state.tick,
      type: 'rest',
      message: `You stop for ${clamped} hour${clamped > 1 ? 's' : ''}. Sleep out here is a thing you take in pieces. ${change}`.trimEnd(),
      data: { hours: clamped },
    };
  }

  /**
   * Handles foraging the current area for supplies, expanding exploration radius.
   *
   * Resolved as a graded check rather than a coin flip, so the common outcome is a
   * complication rather than a blank: you find something and it costs you, or you find
   * nothing and learn something instead. The character's origin and flaw both weigh on
   * the roll.
   */
  private handleSearch(state: GameState): GameEvent {
    advanceTime(state, SEARCH_TIME_COST_HOURS);
    const tile = getCurrentTile(state);

    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    if (pos) {
      revealArea(state, pos.x, pos.y, sightRadiusAtHour(state.hour) + SEARCH_REVEAL_RADIUS);
    }

    if (!tile) {
      return {
        tick: state.tick,
        type: 'search',
        message: pick(FORAGE_FAILURE_LINES, state.rng),
        data: { found: false },
      };
    }

    // Foraging is a Wisdom (Survival) check: the character's Wisdom, their training if
    // they have any, and whatever their flaw and their exhaustion are costing them.
    const check = skillCheck(state, Skill.SURVIVAL, FORAGE_DC);
    const terrain = TERRAIN_NAME[tile.terrain];
    const roll = narrateCheck(Skill.SURVIVAL, check);

    // A bad roll asks the Oracle what went wrong instead of simply returning nothing.
    if (!isAnySuccess(check.outcome)) {
      const twist = this.oracle.ask('twist', state.rng);
      const opening =
        check.outcome === CheckOutcome.CRITICAL_FAILURE
          ? `You work the ${terrain} over and it goes badly.`
          : `You work the ${terrain} over. ${pick(FORAGE_FAILURE_LINES, state.rng)}`;

      const cost = twist ? applyTwist(state, twist.entry) : null;
      const account = twist ? `${opening} ${twist.narration}` : opening;
      const told = narrate(state, account, { mechanical: cost ?? '' });

      return {
        tick: state.tick,
        type: 'search',
        message: `${roll} — ${told.text}`,
        data: {
          terrain: tile.terrain,
          found: false,
          outcome: check.outcome,
          total: check.total,
          twist: twist?.entry.result,
          cost,
          unreliable: told.unreliable,
        },
      };
    }

    const entry = drawWithoutRepeat(
      FORAGE_TABLE[tile.terrain],
      state.rng,
      state.lastDraw,
      `forage:${tile.terrain}`,
      (found) => found.message
    );
    let message = entry.message;
    let gained = 0;

    if (entry.item) {
      const inventory = state.entities.getComponent<InventoryComponent>(
        state.playerId,
        'inventory'
      );
      if (inventory) {
        // A clean roll turns up a second of whatever it was.
        const quantity = check.outcome === CheckOutcome.CRITICAL_SUCCESS ? 2 : 1;
        gained = addItem(inventory, entry.item, quantity);
        if (gained === 0) {
          message += ' You are carrying all you can, and leave it.';
        } else if (gained > 1) {
          message += ' There is more of it than you expected.';
        }
      }
    }

    // What is found where the character is starving is used where it is found. A player
    // who is dying of thirst and turns up a spring should not have to go through their
    // pack to drink from it.
    if (entry.item && gained > 0) {
      const used = this.useWhereFound(entry.item, state);
      if (used) message += ` ${used}`;
    }

    // A near miss is a find with a string attached, and the string is paid for.
    if (check.outcome === CheckOutcome.SETBACK) {
      const twist = this.oracle.ask('twist', state.rng);
      if (twist) {
        const cost = applyTwist(state, twist.entry);
        message += ` ${twist.narration}${cost ? ` ${cost}` : ''}`;
      }
    }

    const account = narrate(state, message);

    return {
      tick: state.tick,
      type: 'search',
      message: `${roll} — ${account.text}`,
      data: {
        terrain: tile.terrain,
        found: true,
        item: entry.item,
        gained,
        outcome: check.outcome,
        total: check.total,
        register: account.register,
        unreliable: account.unreliable,
      },
    };
  }

  /**
   * Consumes a carried item, applying its relief to the player's needs.
   */
  /**
   * Uses a fresh find on the spot when the need it answers is already pressing.
   *
   * @param itemId Catalog id of what was just found
   * @param state Mutable game state
   * @returns Narration of the relief, or null if it was pocketed instead
   */
  private useWhereFound(itemId: string, state: GameState): string | null {
    const definition = getItem(itemId);
    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
    const inventory = state.entities.getComponent<InventoryComponent>(
      state.playerId,
      'inventory'
    );
    if (!definition?.consumable || !stats || !inventory) return null;

    const pressing =
      ((definition.thirst ?? 0) > 0 && stats.thirst >= FORAGE_CONSUME_THRESHOLD) ||
      ((definition.hunger ?? 0) > 0 && stats.hunger >= FORAGE_CONSUME_THRESHOLD);
    if (!pressing) return null;

    if (!removeItem(inventory, itemId)) return null;

    const before = snapshotNeeds(stats);
    stats.hunger = Math.max(MIN_STAT_VALUE, stats.hunger - (definition.hunger ?? 0));
    stats.thirst = Math.max(MIN_STAT_VALUE, stats.thirst - (definition.thirst ?? 0));

    const verb = (definition.thirst ?? 0) > (definition.hunger ?? 0) ? 'drink' : 'eat';
    return `You ${verb} where you found it. ${describeChange(before, stats)}`.trimEnd();
  }

  /**
   * Keeps the rite at a vigil.
   *
   * The rite is a Wisdom (Religion) check against a fixed DC, and it costs hours the
   * character can ill afford out in open country. Keeping it takes a permanent bite out
   * of the Gallowsmark and takes three off the difficulty of the reckoning, which is
   * what makes the detour worth the road.
   *
   * @param state Mutable game state
   * @returns The outcome of the rite
   */
  /**
   * Speaks to whoever is here.
   *
   * The first thing anybody does is size you up, and the Gallowsmark makes that worse:
   * the reaction is drawn from the Oracle with a penalty scaled to how brightly the
   * character is burning, so a man carrying hot is harder to talk to than a man who is
   * not. Somebody who takes to you says what they want, and that want is the errand.
   *
   * @param state Mutable game state
   * @returns What was said
   */
  private handleTalk(state: GameState): GameEvent[] {
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    const here = pos ? peopleAt(state.people, pos.x, pos.y) : [];

    if (here.length === 0) {
      return [
        { tick: state.tick, type: 'error', message: 'There is nobody here to talk to.' },
      ];
    }

    advanceTime(state, TALK_HOURS);

    // Somebody new speaks before somebody already met, and somebody with nothing open
    // between you before somebody who has already asked -- otherwise the first person
    // with an errand would be the only villager the character ever meets.
    const speaker =
      here.find((person) => !person.met) ??
      here.find((person) => !errandOf(state, person)) ??
      here.find((person) => errandOf(state, person)?.state === ErrandState.OFFERED) ??
      here[0];

    const events: GameEvent[] = [];
    const first = !speaker.met;
    speaker.met = true;

    const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
    const penalty = -markBand(mark?.intensity ?? 0) * TALK_MARK_PENALTY;
    const disposition = Math.round(speaker.disposition / TALK_DISPOSITION_SCALE);
    const reaction = this.oracle.ask('npc_reaction', state.rng, penalty + disposition);

    if (first) {
      events.push({
        tick: state.tick,
        type: 'system',
        message: `${speaker.name}, ${ROLE_TITLE[speaker.role]} of ${speaker.place}. ${reaction?.narration ?? ''}`.trim(),
        data: { person: speaker.id, reaction: reaction?.entry.result },
      });
    } else {
      events.push({
        tick: state.tick,
        type: 'system',
        message: `${speaker.name} again, who ${regard(speaker.disposition)}. ${reaction?.narration ?? ''}`.trim(),
        data: { person: speaker.id, reaction: reaction?.entry.result },
      });
    }

    // Somebody who has decided you are a problem does not ask you for favours.
    const hostile = reaction?.entry.result === 'hostile' || speaker.disposition <= -60;
    if (hostile) {
      events.push({
        tick: state.tick,
        type: 'system',
        message: 'Whatever they need, they would rather need it than owe you for it.',
        data: { person: speaker.id, refused: true },
      });
      return events;
    }

    const open = errandOf(state, speaker);
    if (open) {
      events.push({
        tick: state.tick,
        type: 'system',
        message:
          open.state === ErrandState.ACCEPTED
            ? `"${open.task}." They do not ask twice.`
            : open.ask,
        data: { person: speaker.id, errand: open.id, state: open.state },
      });
      if (open.state === ErrandState.OFFERED) {
        events.push({
          tick: state.tick,
          type: 'system',
          message: `${open.task}. Say so if you will do it.`,
          data: { errand: open.id, task: open.task },
        });
      }
      return events;
    }

    const raised = raiseErrand(state, speaker);
    if (raised) {
      events.push({
        tick: state.tick,
        type: 'system',
        message: raised.ask,
        data: { person: speaker.id, errand: raised.id },
      });
      events.push({
        tick: state.tick,
        type: 'system',
        message: `${raised.task}. Say so if you will do it.`,
        data: { errand: raised.id, task: raised.task },
      });
    } else {
      events.push({
        tick: state.tick,
        type: 'system',
        message: 'They have nothing to ask you for, which in this country counts as good news.',
        data: { person: speaker.id },
      });
    }

    return events;
  }

  /**
   * Takes on whatever was last put to the character here.
   *
   * @param state Mutable game state
   * @returns The agreement, or a refusal to agree to nothing
   */
  private handleAccept(state: GameState): GameEvent {
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    const here = pos ? peopleAt(state.people, pos.x, pos.y) : [];

    for (const person of here) {
      const errand = errandOf(state, person);
      if (errand && errand.state === ErrandState.OFFERED) {
        errand.state = ErrandState.ACCEPTED;
        return {
          tick: state.tick,
          type: 'system',
          message: `You say you will. ${person.name} does not thank you; they have been let down before. ${errand.task}.`,
          data: { errand: errand.id, person: person.id, state: ErrandState.ACCEPTED },
        };
      }
    }

    return {
      tick: state.tick,
      type: 'error',
      message: 'Nobody here has asked you for anything.',
    };
  }

  /**
   * Hands over what was asked for, or reports something done.
   *
   * @param state Mutable game state
   * @returns What it was worth
   */
  private handleGive(state: GameState): GameEvent[] {
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    const here = pos ? peopleAt(state.people, pos.x, pos.y) : [];

    for (const person of here) {
      const errand = state.errands.find(
        (candidate) =>
          candidate.personId === person.id &&
          (candidate.state === ErrandState.ACCEPTED || candidate.state === ErrandState.DONE)
      );
      if (!errand) continue;

      if (errand.state === ErrandState.DONE) {
        // Already discharged out in the country; this is the reporting back.
        const events = dischargeErrand(state, errand);
        return events;
      }

      if (canDischarge(state, errand)) {
        const events = dischargeErrand(state, errand);
        return events;
      }

      return [
        {
          tick: state.tick,
          type: 'error',
          message: `Not yet. ${errand.task}.`,
        },
      ];
    }

    return [
      { tick: state.tick, type: 'error', message: 'Nobody here is waiting on you.' },
    ];
  }

  private handleVigil(state: GameState): GameEvent {
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    const vigil = pos ? vigilAt(state.reckoning, pos.x, pos.y) : undefined;

    if (!vigil) {
      return {
        tick: state.tick,
        type: 'error',
        message: 'There is nothing here to keep a vigil over.',
      };
    }

    if (vigil.kept) {
      return {
        tick: state.tick,
        type: 'error',
        message: `You have already done what there is to do at ${vigil.name}.`,
      };
    }

    advanceTime(state, VIGIL_RITE_HOURS);
    const check = skillCheck(state, Skill.RELIGION, VIGIL_DC);
    const roll = narrateCheck(Skill.RELIGION, check);

    if (!isAnySuccess(check.outcome)) {
      return {
        tick: state.tick,
        type: 'danger',
        message: `${roll} — ${vigil.rite} Nothing answers, and the hours are gone. (-${VIGIL_RITE_HOURS}h)`,
        data: { vigil: vigil.id, kept: false, outcome: check.outcome },
      };
    }

    vigil.kept = true;

    const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
    let relief = '';
    if (mark) {
      const before = mark.intensity;
      mark.intensity = Math.max(MARK_MIN, mark.intensity - VIGIL_MARK_RELIEF);
      relief = ` (mark ${Math.round(before)} → ${Math.round(mark.intensity)})`;
    }

    const kept = vigilsKept(state.reckoning);
    return {
      tick: state.tick,
      type: 'system',
      message:
        `${roll} — ${vigil.rite} Something gives. The debt is smaller than it was. ` +
        `${kept} of ${state.reckoning.vigils.length} rites kept.${relief}`,
      data: { vigil: vigil.id, kept: true, rites: kept },
    };
  }

  /**
   * Settles the debt at the gallows-tree, one way or the other.
   *
   * Three Constitution saving throws against a Difficulty Class set by everything the
   * run has been about: three off for every rite kept, two on for every band the
   * Gallowsmark is burning at. Two successes and the character walks out of the
   * Thornmarch. Otherwise the tree collects.
   *
   * This is the only ending in the game that is not a death, and it is deliberately
   * reachable only by a character who prepared for it.
   *
   * @param state Mutable game state
   * @returns The narration of the reckoning
   */
  private handleReckon(state: GameState): GameEvent[] {
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    if (!pos || !atTree(state.reckoning, pos.x, pos.y)) {
      return [
        {
          tick: state.tick,
          type: 'error',
          message: 'The tree is not here, and you would know if it were.',
        },
      ];
    }

    const events: GameEvent[] = [];
    for (const line of RECKONING_LINES) {
      events.push({ tick: state.tick, type: 'system', message: line });
    }

    const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
    const band = mark ? markBand(mark.intensity) : 0;
    const kept = vigilsKept(state.reckoning);
    const dc = Math.max(
      MIN_RECKONING_DC,
      RECKONING_BASE_DC - kept * RECKONING_VIGIL_RELIEF + band * RECKONING_BAND_PENALTY
    );

    let successes = 0;
    for (let attempt = 0; attempt < RECKONING_SAVES; attempt++) {
      const save = savingThrow(state, Ability.CON, dc);
      if (save.success) successes++;
      events.push({
        tick: state.tick,
        type: save.success ? 'combat' : 'danger',
        message: `Constitution save DC ${dc}: ${save.total}. ${save.success ? 'You hold.' : 'Something in you gives.'}`,
        data: { dc, total: save.total, success: save.success },
      });
    }

    state.gameOver = true;

    if (successes >= RECKONING_SUCCESSES) {
      state.victory = true;
      for (const line of RECKONING_VICTORY) {
        events.push({ tick: state.tick, type: 'system', message: line });
      }
      events.push({
        tick: state.tick,
        type: 'system',
        message: `You survived ${state.day} days in the Thornmarch and left it owing nothing.`,
        data: { victory: true, days: state.day, rites: kept },
      });
      return events;
    }

    state.causeOfDeath = 'The debt at the tree was collected.';
    for (const line of RECKONING_FAILURE) {
      events.push({ tick: state.tick, type: 'danger', message: line });
    }
    events.push({
      tick: state.tick,
      type: 'death',
      message: `${state.causeOfDeath} You lasted ${state.day} days.`,
      data: { victory: false, days: state.day, rites: kept },
    });
    return events;
  }

  private handleConsume(itemId: string, state: GameState): GameEvent {
    const definition = getItem(itemId);
    const inventory = state.entities.getComponent<InventoryComponent>(
      state.playerId,
      'inventory'
    );
    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');

    if (!definition || !inventory || !stats) {
      return { tick: state.tick, type: 'error', message: 'You have no such thing.' };
    }

    if (!definition.consumable) {
      return {
        tick: state.tick,
        type: 'error',
        message: `${definition.description}`,
      };
    }

    if (countItem(inventory, itemId) <= 0) {
      return { tick: state.tick, type: 'error', message: 'You have none left.' };
    }

    removeItem(inventory, itemId);
    const before = snapshotNeeds(stats);

    stats.hunger = Math.max(MIN_STAT_VALUE, stats.hunger - (definition.hunger ?? 0));
    stats.thirst = Math.max(MIN_STAT_VALUE, stats.thirst - (definition.thirst ?? 0));
    stats.fatigue = Math.max(MIN_STAT_VALUE, stats.fatigue - (definition.fatigue ?? 0));

    const healing = definition.hp ?? 0;
    if (healing > 0) {
      stats.hp = Math.min(stats.maxHp, stats.hp + healing);
    }

    const verb = healing > 0 ? 'You bind what you can reach' : `You take the ${definition.name}`;
    const change = describeChange(before, stats);

    return {
      tick: state.tick,
      type: 'rest',
      message: `${verb}. It is not much, and it is what there is. ${change}`.trimEnd(),
      data: { item: itemId },
    };
  }

  /**
   * Barters a coin for supplies inside a settlement.
   *
   * The rate is poor on purpose. Being visibly Marked is not a good bargaining
   * position, and the village would rather buy your departure than your custom.
   */
  private handleTrade(state: GameState): GameEvent {
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    const inventory = state.entities.getComponent<InventoryComponent>(
      state.playerId,
      'inventory'
    );

    if (!pos || !inventory) {
      return { tick: state.tick, type: 'error', message: 'You have nothing to trade with.' };
    }

    const settlement = settlementAt(state.settlements, pos.x, pos.y);
    if (!settlement) {
      return {
        tick: state.tick,
        type: 'error',
        message: 'There is nobody out here to trade with.',
      };
    }

    if (countItem(inventory, TRADE_CURRENCY_ITEM) < TRADE_COIN_COST) {
      return {
        tick: state.tick,
        type: 'error',
        message: `${settlement.name} has no charity in it. Not for someone marked like you.`,
      };
    }

    removeItem(inventory, TRADE_CURRENCY_ITEM, TRADE_COIN_COST);
    const forage = addItem(inventory, 'bread', TRADE_FORAGE_YIELD);
    const water = addItem(inventory, 'waterskin', TRADE_WATER_YIELD);
    const linen = addItem(inventory, 'bandage', TRADE_LINEN_YIELD);

    return {
      tick: state.tick,
      type: 'system',
      message:
        `A woman in ${settlement.name} takes the coin without touching your hand, and puts ` +
        'the goods on the step rather than passing them to you.',
      data: { settlement: settlement.name, forage, water, linen },
    };
  }

  /**
   * Wears or wields a carried item.
   *
   * Permitted mid-fight: reaching for a better weapon while something is on you is a
   * decision worth having, and it costs the round it takes.
   */
  private handleEquip(itemId: string, state: GameState): GameEvent {
    const inventory = state.entities.getComponent<InventoryComponent>(
      state.playerId,
      'inventory'
    );

    if (!inventory || countItem(inventory, itemId) <= 0) {
      return { tick: state.tick, type: 'error', message: 'You are not carrying that.' };
    }

    const result = equipItem(state.entities, state.playerId, itemId);
    return {
      tick: state.tick,
      type: result.ok ? 'system' : 'error',
      message: result.message,
      data: { item: itemId, replaced: result.replaced },
    };
  }

  /**
   * Empties an equipment slot.
   */
  private handleUnequip(slot: string, state: GameState): GameEvent {
    const result = unequipSlot(state.entities, state.playerId, slot);
    return {
      tick: state.tick,
      type: result.ok ? 'system' : 'error',
      message: result.message,
      data: { slot },
    };
  }
}
