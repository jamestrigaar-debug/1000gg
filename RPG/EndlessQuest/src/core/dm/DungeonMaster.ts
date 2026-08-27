import type { GameState } from '../state/GameState';
import type { GameEvent } from '../../events/GameEvent';
import type { EquipmentComponent, StatsComponent } from '../ecs/Component';
import { EquipSlot } from '../lore/items/ItemTypes';
import { getArchetype } from '../lore/Bestiary';
import { RoomKind, Temper } from './Instance';
import { Blackboard, Intent, stillInIt } from './Blackboard';
import { Move, decide } from './Utility';
import { choosePlan } from './Plan';
import { Voice } from './Voice';
import type { DMState, Instance, Occupant, Room } from './Instance';
import { roll, rollD20 } from '../rules/Dice';
import { armorClass } from '../state/Checks';
import { hurt } from '../state/Harm';
import { CheckOutcome, isAnySuccess } from '../rules/Check';
import { DM_MORALE_FLOOR } from '../SimulationConstants';

/**
 * The one running the place.
 *
 * A simulation with nobody in charge produces exactly what an early build of this game
 * produced: things happening, none of them to anybody. The Dungeon Master is the thing
 * that was missing. It knows the whole instance while the player knows one room of it,
 * it takes a turn after every turn the player takes, and it is playing to give them a
 * story rather than to win.
 *
 * It is not clever in the machine-learning sense and does not need to be. It has a
 * handful of readings of how the fight is going, a set of behaviours keyed to what each
 * thing is like, and one dramatic card it can spend. That is enough to feel like
 * somebody is sitting across the table.
 */
export class DungeonMaster {
  private dm: DMState = { recent: [], pressure: 1, reinforced: false, plan: null };
  /** What everyone at the table knows, and what the DM has noticed */
  private board = new Blackboard();
  /** The DM's telling, which does not repeat itself */
  private voice = new Voice();
  /** Plans already spent in this place */
  private spent = new Set<string>();
  /** Turns since anything of consequence happened, for pacing */
  private quiet = 0;
  /**
   * What the room did to the character beyond the blow itself: a wound taken, going
   * down, the run ending. Collected as it happens and drained into the turn's account.
   */
  private aftermath: GameEvent[] = [];

  /**
   * What the DM says when the door opens.
   *
   * @param instance The place, already formed
   * @param state Game state
   * @returns The scene, set
   */
  open(instance: Instance, state: GameState): GameEvent[] {
    const entrance = instance.rooms[0];
    entrance.entered = true;

    // A new place is a new scene: the plans it has spent and what it has noticed about
    // the room are its own, though what the DM has learned about how this player plays
    // is not and carries over.
    this.spent.clear();
    this.board.wipe();
    this.quiet = 0;

    return [
      {
        tick: state.tick,
        type: 'system',
        message: `${instance.name}. ${instance.hook}`,
        data: { instance: instance.id, room: entrance.id },
      },
      this.appraise(instance, state),
      this.describeRoom(instance, entrance, state),
    ];
  }

  /**
   * What the DM thinks of the character's chances, said at the door.
   *
   * A good game master tells you what you are walking into. Not the numbers -- the
   * impression a person would form standing at the mouth of it, weighed against what
   * they are carrying and what they can take.
   *
   * @param instance The place, formed
   * @param state Game state
   * @returns The appraisal
   */
  private appraise(instance: Instance, state: GameState): GameEvent {
    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
    const equipment = state.entities.getComponent<EquipmentComponent>(
      state.playerId,
      'equipment'
    );

    const standing = instance.occupants.filter((occupant) => !occupant.fled).length;
    const armed = equipment?.slots[EquipSlot.HAND] !== undefined;
    const whole = stats ? stats.hp / stats.maxHp : 1;

    // Three things a person would actually weigh: how many are in there, whether they
    // are carrying anything to fight with, and what state they are in.
    const odds = standing * 2 - (armed ? 2 : 0) + (whole < 0.6 ? 3 : 0);

    const line =
      odds >= 8
        ? 'There are more in here than you have any business walking in on. Whatever you came for, it is not worth what this is going to cost.'
        : odds >= 5
          ? 'This is more than one person should take on, and you are one person.'
          : armed && whole > 0.8
            ? 'You have walked into worse than this with less than you are carrying.'
            : 'Quiet so far. That is not the same as empty.';

    return {
      tick: state.tick,
      type: odds >= 5 ? 'danger' : 'system',
      message: line,
      data: { appraisal: odds, standing, armed },
    };
  }

  /**
   * Describes standing somewhere, the first time and afterwards.
   *
   * @param instance The place
   * @param room Where the character is
   * @param state Game state
   * @returns The description
   */
  describeRoom(instance: Instance, room: Room, state: GameState): GameEvent {
    const standing = this.living(instance, room.id);
    const here = standing.length > 0
      ? ` ${standing.map((occupant) => this.name(occupant)).join(', and ')} ${standing.length === 1 ? 'is' : 'are'} here.`
      : '';

    // Environmental storytelling: every room says what happened here before you came,
    // and that is most of what makes a corridor feel like somewhere rather than a shape.
    const telling = room.entered ? '' : ` ${room.telling}`;
    const ways = ` Ways on: ${room.exits.length}.`;

    return {
      tick: state.tick,
      type: standing.length > 0 ? 'danger' : 'system',
      message: `You are in ${room.name}.${telling}${here}${ways}`,
      data: { room: room.id, occupants: standing.length },
    };
  }

  /**
   * The DM's turn.
   *
   * Runs after every turn the player takes: the things in the room act, the place itself
   * does whatever it does, and the DM decides whether the moment wants something more.
   *
   * @param instance The place
   * @param state Game state
   * @returns What happened
   */
  take(instance: Instance, state: GameState): GameEvent[] {
    const events: GameEvent[] = [];
    instance.turn++;

    // What everyone at the table can see, written down once so that every part of the
    // DM reads the same room.
    const tide = this.board.survey(state, instance);
    const intent = this.board.intent();
    const expects = this.board.predict();

    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
    if (stats) this.dm.pressure = Math.max(0, Math.min(1, stats.hp / stats.maxHp));

    // --- The things in the room act, each by its own lights ------------------------
    const standing = this.living(instance, instance.current);
    let anythingHappened = false;

    for (const occupant of standing) {
      const friends = standing.filter(
        (other) => other.id !== occupant.id && stillInIt(other)
      ).length;
      const { move } = decide(occupant, tide, intent, friends, state.rng);
      const acted = this.perform(move, occupant, instance, state);
      if (acted) {
        events.push(acted);
        anythingHappened = true;
      }
    }

    // --- The place acts ---------------------------------------------------------------
    const environment = this.environmentTurn(instance, state);
    if (environment) {
      events.push(environment);
      anythingHappened = true;
    }

    this.quiet = anythingHappened ? 0 : this.quiet + 1;

    // --- And the DM decides whether the moment wants anything of its own ---------------
    const plan = choosePlan({
      instance,
      board: this.board,
      tide,
      intent,
      expects,
      quiet: this.quiet,
      spent: this.spent,
    });

    if (plan) {
      this.spent.add(plan.id);
      this.dm.plan = plan.id;
      events.push(...this.run(plan.id, plan.line({
        instance,
        board: this.board,
        tide,
        intent,
        expects,
        quiet: this.quiet,
        spent: this.spent,
      }), instance, state));
    }

    return events;
  }

  /**
   * Carries out the move a thing decided on.
   *
   * @param move What it chose
   * @param occupant The thing
   * @param instance The place
   * @param state Game state
   * @returns What happened, if anything worth saying
   */
  private perform(
    move: Move,
    occupant: Occupant,
    instance: Instance,
    state: GameState
  ): GameEvent | null {
    switch (move) {
      case Move.FLEE: {
        // A hobbled thing does not get to leave, which is the whole reason to go low.
        if (occupant.hurts.includes('hobbled')) {
          return {
            tick: state.tick,
            type: 'combat',
            message: `${this.name(occupant)} tries to get away from you and cannot put weight on it.`,
            data: { pinned: occupant.id },
          };
        }
        occupant.fled = true;
        return {
          tick: state.tick,
          type: 'combat',
          message: `${this.name(occupant)} has had enough of it, and goes.`,
          data: { fled: occupant.id },
        };
      }

      case Move.CALL: {
        occupant.alerted = true;
        const called = this.rouse(instance, instance.current);
        if (called === 0) return null;
        return {
          tick: state.tick,
          type: 'danger',
          message: `${this.name(occupant)} puts two fingers in its mouth and whistles. Something answers, further in.`,
          data: { roused: called },
        };
      }

      case Move.BRACE: {
        // Setting your feet is something you do once. A thing that is already set does
        // the next best thing rather than saying the same sentence three turns running.
        if (occupant.hurts.includes('set')) return this.act(occupant, instance, state);
        occupant.hurts.push('set');
        occupant.alerted = true;
        return {
          tick: state.tick,
          type: 'combat',
          message: `${this.name(occupant)} sets its feet and waits for you to come to it.`,
          data: { braced: occupant.id },
        };
      }

      case Move.BIDE:
        return null;

      case Move.ATTACK:
      default:
        return this.act(occupant, instance, state);
    }
  }

  /**
   * Runs one of the DM's own plans.
   *
   * @param id Which plan
   * @param line What the DM says
   * @param instance The place
   * @param state Game state
   * @returns What happened
   */
  private run(id: string, line: string, instance: Instance, state: GameState): GameEvent[] {
    const events: GameEvent[] = [];

    // Most plans are a line and a beat. Two of them move the world as well.
    if (id === 'reinforce' || id === 'ambush') {
      const boss = instance.occupants.find((occupant) => occupant.boss && stillInIt(occupant));
      const roused = this.rouse(instance, id === 'ambush' ? instance.current : boss?.room ?? instance.current);
      if (roused === 0 && id === 'reinforce') return events;
    }

    events.push({
      tick: state.tick,
      type: id === 'opening' || id === 'settle' ? 'system' : 'danger',
      message: line,
      data: { plan: id },
    });

    return events;
  }

  /**
   * One thing's turn, decided by what it is like rather than by what is optimal.
   */
  private act(occupant: Occupant, instance: Instance, state: GameState): GameEvent | null {
    const archetype = getArchetype(occupant.archetypeId);
    if (!archetype) return null;

    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
    if (!stats) return null;

    // Nerve. Whether a thing stays is decided by what it is like and how much of it is
    // left, and the utility scoring above has usually settled this already -- this is
    // the involuntary version, for a thing that has taken more than it can hold.
    const worn = 1 - occupant.hp / occupant.maxHp;
    if (
      occupant.temper !== Temper.PROUD &&
      worn > 0.7 &&
      rollD20(state.rng) + Math.round(occupant.morale / 10) < DM_MORALE_FLOOR
    ) {
      occupant.fled = true;
      return {
        tick: state.tick,
        type: 'combat',
        message: `${this.name(occupant)} has had enough of it, and goes.`,
        data: { fled: occupant.id },
      };
    }

    // Against what the character is actually wearing. A flat number here made the
    // exchange one-sided -- the character had to beat a creature's real armour while
    // their own gambeson counted for nothing, which is both unfair and a reason not to
    // buy armour.
    // What the character left open when they committed to their own blow, and what has
    // been done to this thing's arms.
    const opening = state.tick <= state.exposedUntil ? state.exposure : 0;
    const maimed = occupant.hurts.includes('disarmed') ? -3 : 0;
    const dazed = occupant.hurts.includes('dazed') ? -2 : 0;

    const guard = armorClass(state.entities, state.playerId);
    const attack = rollD20(state.rng) + archetype.attackBonus + opening + maimed + dazed;
    if (attack < guard) {
      return {
        tick: state.tick,
        type: 'combat',
        message: this.voice.attack(this.name(occupant), occupant.temper, false, 0, state.rng),
        data: { miss: occupant.id, roll: attack, guard },
      };
    }

    const damage = roll(state.rng, archetype.damageDice).total;
    // Everything that hurts the character goes through the one place that knows what
    // nought hit points means, so a thing in a room can put somebody down properly.
    const done = hurt(state, damage, {
      cause: `${this.name(occupant)} finished what the rope started.`,
    });

    this.aftermath.push(...done.events);

    return {
      tick: state.tick,
      type: 'combat',
      message: this.voice.attack(this.name(occupant), occupant.temper, true, damage, state.rng),
      data: { hit: occupant.id, damage },
    };
  }

  /**
   * The place's own turn.
   */
  private environmentTurn(instance: Instance, state: GameState): GameEvent | null {
    const room = instance.rooms[instance.current];
    if (room.kind !== RoomKind.HAZARD || room.cleared) return null;

    room.cleared = true;
    const damage = roll(state.rng, '1d6').total;
    const done = hurt(state, damage, { cause: 'The floor of a place you should not have been in.' });
    this.aftermath.push(...done.events);

    return {
      tick: state.tick,
      type: 'danger',
      message: `The floor here was not floor. It gives, and takes something out of you on the way. (−${damage})`,
      data: { hazard: room.id, damage },
    };
  }

  /**
   * Brings whatever is further in toward the noise.
   *
   * @returns How many things moved
   */
  private rouse(instance: Instance, room: number): number {
    let moved = 0;
    for (const occupant of instance.occupants) {
      if (occupant.fled || occupant.hp <= 0 || occupant.room === room) continue;
      if (occupant.boss) continue;
      const adjacent = instance.rooms[room]?.exits.includes(occupant.room);
      if (!adjacent) continue;
      occupant.room = room;
      occupant.alerted = true;
      moved++;
      if (moved >= 2) break;
    }
    return moved;
  }

  /**
   * What is still standing in a room.
   */
  private living(instance: Instance, room: number): Occupant[] {
    return instance.occupants.filter(
      (occupant) => occupant.room === room && occupant.hp > 0 && !occupant.fled
    );
  }

  /** What a thing is called, capitalised for the head of a sentence. */
  private name(occupant: Occupant): string {
    const archetype = getArchetype(occupant.archetypeId);
    const name = archetype?.name ?? 'it';
    const dressed = occupant.boss ? name.replace(/^an? /, 'the ') : name;
    return dressed.charAt(0).toUpperCase() + dressed.slice(1);
  }

  /**
   * Remembers what the player did, for reading how they play.
   * @param action What they did
   */
  observe(action: string): void {
    this.dm.recent.push(action);
    if (this.dm.recent.length > 12) this.dm.recent.shift();
    this.board.observe(action);
  }

  /**
   * The DM's telling, so the character's own blows are narrated by the same voice that
   * narrates everything else's, and do not repeat either.
   */
  telling(): Voice {
    return this.voice;
  }

  /** What the DM has made of the player, for the interface and for tests. */
  player(): { intent: Intent; expects: { action: string; confidence: number } } {
    return { intent: this.board.intent(), expects: this.board.predict() };
  }

  /** What the DM currently thinks, for tests and for the interface. */
  reading(): Readonly<DMState> {
    return this.dm;
  }
}

/** Re-exported so callers can score a check without reaching past the DM. */
export { CheckOutcome, isAnySuccess };
