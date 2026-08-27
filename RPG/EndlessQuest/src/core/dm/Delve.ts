import type { GameState } from '../state/GameState';
import type { GameEvent } from '../../events/GameEvent';
import type { InventoryComponent, PositionComponent } from '../ecs/Component';
import { addItem } from '../state/Inventory';
import { getItem } from '../lore/Items';
import { siteAt } from '../world/Sites';
import { advanceTime } from '../state/GameState';
import { conditionPenalties } from '../state/Conditions';
import { getArchetype } from '../lore/Bestiary';
import { RoomKind } from './Instance';
import type { Instance, Occupant } from './Instance';
import { formInstance } from './Forge';
import { DungeonMaster } from './DungeonMaster';
import { settleConsequences } from './Consequence';
import { answerCharges } from '../narrative/Charges';
import { Skill } from '../rules/Skills';
import { AIMS, Aim, COMMITS, describeAim, knackFor, readIntent } from './Tactics';
import { Temper } from './Instance';

/** What each kind of hurt reads as when it takes. */
const HURT_LINES: Readonly<Record<string, string>> = {
  dazed: 'It stops knowing quite where it is.',
  disarmed: 'Something drops, and it does not pick it up.',
  hobbled: 'It will not be going anywhere quickly now.',
};
import { DC, RollMode, check as rollAgainstDC, isAnySuccess } from '../rules/Check';
import { skillCheck, narrateCheck } from '../state/Checks';
import type { AbilitiesComponent, EquipmentComponent } from '../ecs/Component';
import { Ability, abilityModifier, proficiencyBonus } from '../rules/Abilities';
import { EquipSlot } from '../lore/items/ItemTypes';
import { roll } from '../rules/Dice';
import {
  DELVE_HOURS_PER_ROOM,
  DM_GUARD_CLASS,
  FINESSE_WEAPON_MAX_WEIGHT,
  UNARMED_DAMAGE,
} from '../SimulationConstants';

/**
 * The character's modifier in an ability, read off the sheet.
 *
 * @param state Game state
 * @param ability Which one
 * @returns The modifier, or zero if they have no sheet
 */
function abilityModifierOf(state: GameState, ability: Ability): number {
  const abilities = state.entities.getComponent<AbilitiesComponent>(
    state.playerId,
    'abilities'
  );
  return abilities ? abilityModifier(abilities.scores[ability]) : 0;
}

/**
 * Playing an instance.
 *
 * Every one of these takes the player's turn, hands it to the Dungeon Master for its
 * turn, and returns what both of them did. That cycle -- player, then DM, then the place
 * itself -- is the whole structure of the second layer, and it is what makes the thing
 * across the table feel like somebody rather than a table of outcomes.
 */

/**
 * One Dungeon Master per run.
 *
 * It has to remember: how this player fights, which plans it has spent, what it said
 * last so as not to say it again. But that memory belongs to the run and not to the
 * process -- kept in a module-level singleton it leaked between simulations, and two
 * plays of the same seed in one process diverged, which broke the load-bearing property
 * of the whole design. Keyed weakly by the state, it lives exactly as long as the run
 * does and needs no serialising.
 */
const MASTERS = new WeakMap<GameState, DungeonMaster>();

/**
 * The Dungeon Master running this particular game.
 *
 * @param state The run
 * @returns Its DM
 */
function masterFor(state: GameState): DungeonMaster {
  let master = MASTERS.get(state);
  if (!master) {
    master = new DungeonMaster();
    MASTERS.set(state, master);
  }
  return master;
}

/**
 * Goes in.
 *
 * The place is formed in full at this moment and not before: what is in it is decided
 * against the character standing at the door, so a place found at first level is a
 * place a first-level character can be in.
 *
 * @param state Game state
 * @returns What happened
 */
export function enter(state: GameState): GameEvent[] {
  if (state.instance) {
    return [{ tick: state.tick, type: 'error', message: 'You are already inside.' }];
  }

  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  if (!pos) return [];

  const site = siteAt(state.sites, pos.x, pos.y);
  if (!site || !site.instance) {
    return [
      {
        tick: state.tick,
        type: 'error',
        message: 'There is nothing here to go into.',
      },
    ];
  }

  const abilities = state.entities.getComponent<AbilitiesComponent>(state.playerId, 'abilities');
  const level = abilities?.level ?? 1;

  const instance = formInstance(site.instance, site.name, pos.x, pos.y, level, state.seedString);
  state.instance = instance;
  site.visited = true;

  return masterFor(state).open(instance, state);
}

/**
 * Walks on into another room.
 *
 * @param state Game state
 * @param room Which way on; the first unexplored way by default
 * @returns What happened
 */
export function delve(state: GameState, room?: number): GameEvent[] {
  const instance = state.instance;
  if (!instance) {
    return [{ tick: state.tick, type: 'error', message: 'You are not inside anything.' }];
  }

  const here = instance.rooms[instance.current];
  const standing = instance.occupants.filter(
    (occupant) => occupant.room === here.id && occupant.hp > 0 && !occupant.fled
  );

  // You do not walk past something that is looking at you.
  if (standing.length > 0) {
    return [
      {
        tick: state.tick,
        type: 'error',
        message: `${describe(standing[0])} is between you and the way on.`,
      },
    ];
  }

  const target = room !== undefined && here.exits.includes(room)
    ? room
    : here.exits.find((exit) => !instance.rooms[exit].entered) ?? here.exits[0];

  if (target === undefined) {
    return [{ tick: state.tick, type: 'error', message: 'There is nowhere else to go.' }];
  }

  instance.current = target;
  const next = instance.rooms[target];
  advanceTime(state, DELVE_HOURS_PER_ROOM);

  const events: GameEvent[] = [masterFor(state).describeRoom(instance, next, state)];
  next.entered = true;

  masterFor(state).observe('delve');
  events.push(...masterFor(state).take(instance, state));
  return events;
}

/**
 * Goes over the room for what it is hiding.
 *
 * @param state Game state
 * @returns What happened
 */
export function ransack(state: GameState): GameEvent[] {
  const instance = state.instance;
  if (!instance) {
    return [{ tick: state.tick, type: 'error', message: 'You are not inside anything.' }];
  }

  const room = instance.rooms[instance.current];
  const inventory = state.entities.getComponent<InventoryComponent>(state.playerId, 'inventory');
  const here = instance.prizes.filter((prize) => prize.room === room.id && !prize.taken);

  advanceTime(state, DELVE_HOURS_PER_ROOM);
  masterFor(state).observe('ransack');

  const events: GameEvent[] = [];

  if (here.length === 0) {
    events.push({
      tick: state.tick,
      type: 'search',
      message: 'You go over it and it has nothing in it for you.',
    });
  }

  for (const prize of here) {
    // Something put out of sight takes a roll to find; something lying there does not.
    if (prize.hidden) {
      const check = skillCheck(state, Skill.INVESTIGATION, DC.MEDIUM);
      if (!isAnySuccess(check.outcome)) {
        events.push({
          tick: state.tick,
          type: 'search',
          message: `${narrateCheck(Skill.INVESTIGATION, check)} — whatever is here, it is not showing itself.`,
        });
        continue;
      }
    }

    const item = getItem(prize.itemId);
    if (inventory && item) {
      const taken = addItem(inventory, prize.itemId, prize.count);
      if (taken > 0) {
        prize.taken = true;
        events.push({
          tick: state.tick,
          type: 'search',
          message: `${prize.hidden ? 'Set back where it would not be found: ' : 'Here, and yours: '}${item.name}${prize.count > 1 ? ` ×${prize.count}` : ''}.`,
          data: { prize: prize.itemId },
        });
        continue;
      }
      // Telling somebody their pack is full is not help. Telling them what they would
      // have to put down to take this is.
      const ballast = Object.keys(inventory.items)
        .map((id) => getItem(id))
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
        .filter((candidate) => !candidate.consumable && candidate.weight >= item.weight)
        .sort((a, b) => a.value - b.value)[0];

      events.push({
        tick: state.tick,
        type: 'error',
        message:
          `${item.name} is here, and you have no room for it.` +
          (ballast ? ` You would have to put down ${ballast.name}.` : ''),
        data: { tooHeavy: prize.itemId, shed: ballast?.id },
      });
    }
  }

  events.push(...masterFor(state).take(instance, state));
  return events;
}

/**
 * Strikes at whatever is in the room.
 *
 * @param state Game state
 * @returns What happened
 */
export function strike(state: GameState, said: readonly string[] = []): GameEvent[] {
  const instance = state.instance;
  if (!instance) return [];

  const room = instance.rooms[instance.current];
  const target = instance.occupants.find(
    (occupant) => occupant.room === room.id && occupant.hp > 0 && !occupant.fled
  );

  if (!target) {
    // A refusal that teaches. Saying "nothing here" five times running tells the player
    // nothing they did not know by the second time.
    const room = instance.rooms[instance.current];
    const ways = room.exits.length;
    const loot = prizesHere(instance);

    return [
      {
        tick: state.tick,
        type: 'error',
        message:
          'Nothing in this room is standing.' +
          (loot ? ' There is something here worth turning over.' : '') +
          (ways > 0 ? ` ${ways === 1 ? 'One way on' : `${ways} ways on`} from here.` : ''),
        data: { empty: room.id, ways, loot },
      },
    ];
  }

  const events: GameEvent[] = [];
  masterFor(state).observe('strike');

  // Where the blow is going and how much is behind it. Saying nothing means the middle
  // of them, evenly, so nobody has to learn any of this to play.
  const { aim, commit } = readIntent(said);
  const aimed = AIMS[aim];
  const effort = COMMITS[commit];

  // The character fights with what they are carrying and what they are, exactly as they
  // do out in the country. An earlier version rolled a bare Athletics check against a
  // fixed difficulty, which meant the sword you bought made no difference to anything.
  const world = state.entities;
  const equipment = world.getComponent<EquipmentComponent>(state.playerId, 'equipment');
  const abilities = world.getComponent<AbilitiesComponent>(state.playerId, 'abilities');
  const held = equipment?.slots[EquipSlot.HAND];
  const weapon = held ? getItem(held) : undefined;

  const finesse = weapon !== undefined && weapon.weight <= FINESSE_WEAPON_MAX_WEIGHT;
  const carriedPenalty = conditionPenalties(state);
  const str = abilityModifierOf(state, Ability.STR);
  const dex = abilityModifierOf(state, Ability.DEX);
  const abilityMod = finesse ? Math.max(str, dex) : str;
  const proficiency = proficiencyBonus(abilities?.level ?? 1);

  const archetype = getArchetype(target.archetypeId);
  const attack = rollAgainstDC(
    state.rng,
    abilityMod + proficiency + carriedPenalty.attack + aimed.toHit + effort.toHit,
    archetype?.armorClass ?? DM_GUARD_CLASS,
    RollMode.NORMAL
  );

  // Committing to a blow leaves something open, and what it leaves open is real: the DM
  // reads it on its own turn.
  state.exposedUntil = effort.exposes > 0 ? state.tick + 1 : 0;
  state.exposure = effort.exposes;

  const hit = attack.natural === 20 || (attack.natural !== 1 && attack.success);

  if (hit) {
    const dice = weapon?.sourceDice ?? UNARMED_DAMAGE;
    const rolled = roll(state.rng, dice).total + abilityMod;
    const scaled = Math.round(rolled * aimed.damage * effort.damage);
    const damage = Math.max(1, attack.natural === 20 ? scaled * 2 : scaled);
    target.hp = Math.max(0, target.hp - damage);
    target.alerted = true;

    if (target.hp <= 0) {
      events.push({
        tick: state.tick,
        type: 'combat',
        message: `${archetype?.defeat ?? 'It goes down and stays down.'}`,
        data: { killed: target.id },
      });

      // The place is about the thing at the end of it. Putting that down is the story
      // resolving, not just one more body.
      if (target.boss) {
        instance.resolved = true;
        room.cleared = true;
        events.push({
          tick: state.tick,
          type: 'system',
          message: `${instance.name} is quiet. Whatever it was doing here, it has stopped doing it.`,
          data: { resolved: instance.id },
        });
      }
    } else {
      // Aiming somewhere in particular does something in particular, if it lands well.
      const told: string[] = [];
      if (aimed.effect && !target.hurts.includes(aimed.effect) && attack.total >= 15) {
        target.hurts.push(aimed.effect);
        told.push(HURT_LINES[aimed.effect] ?? '');
      }

      events.push({
        tick: state.tick,
        type: 'combat',
        message:
          (attack.natural === 20
            ? `Everything lines up at once, and you put it through. (−${damage})`
            : `${aim === Aim.BODY ? masterFor(state).telling().own(true, state.rng) : describeAim(aimed, state.rng)} (−${damage})`) +
          (told.length > 0 ? ` ${told.join(' ')}` : ''),
        data: { damage, target: target.id, roll: attack.total, aim, commit },
      });
    }
  } else {
    events.push({
      tick: state.tick,
      type: 'combat',
      message:
        attack.natural === 1
          ? 'You over-commit, and it is not where you swung.'
          : masterFor(state).telling().own(false, state.rng),
      data: { hit: false, roll: attack.total },
    });
  }

  events.push(...masterFor(state).take(instance, state));
  return events;
}

/**
 * Comes back out into the country.
 *
 * @param state Game state
 * @returns What happened
 */
export function leave(state: GameState): GameEvent[] {
  const instance = state.instance;
  if (!instance) {
    return [{ tick: state.tick, type: 'error', message: 'You are already outside.' }];
  }

  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  const site = pos ? siteAt(state.sites, pos.x, pos.y) : undefined;
  if (site && instance.resolved) site.spent = true;

  state.instance = null;

  const account = instance.resolved
    ? `You come out of ${instance.name} with it finished behind you.`
    : `You come out of ${instance.name}. It is still in there.`;

  // What the country makes of it. A place cleared is not a number: it is a road people
  // start using again, a parish that thinks better of whoever did it, and whoever got
  // out of it before the end taking it personally.
  const aftermath = instance.resolved ? settleConsequences(state, instance) : [];

  // And whatever the parish asked about this place is answered by having been in it.
  const answered = answerCharges(state, instance.x, instance.y, instance.resolved);

  return [
    {
      tick: state.tick,
      type: 'system',
      message: account,
      data: { left: instance.id, resolved: instance.resolved },
    },
    ...aftermath,
    ...answered,
  ];
}

/** What a thing is called, at the head of a sentence. */
function describe(occupant: Occupant): string {
  const name = getArchetype(occupant.archetypeId)?.name ?? 'something';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Whether the character is standing somewhere they could go into. */
export function canEnter(state: GameState): Instance | null {
  return state.instance;
}

/** What is standing in the room, for the interface. */
export function occupantsHere(instance: Instance): Occupant[] {
  return instance.occupants.filter(
    (occupant) => occupant.room === instance.current && occupant.hp > 0 && !occupant.fled
  );
}

/** Whether this room still holds anything worth turning over. */
export function prizesHere(instance: Instance): boolean {
  return instance.prizes.some(
    (prize) => prize.room === instance.current && !prize.taken
  );
}

/** The kind of room the character is standing in, for the interface. */
export function roomKindHere(instance: Instance): RoomKind {
  return instance.rooms[instance.current].kind;
}


/**
 * The one thing a calling can do that the others cannot.
 *
 * One apiece, on purpose: a list of twelve abilities nobody remembers is worse than one
 * thing that is yours. The Sword breaks something. The Quiet is not there any more. The
 * Tongue gives a thing that was never sure about this a reason to stop.
 *
 * @param state Game state
 * @returns What came of it
 */
export function useKnack(state: GameState): GameEvent[] {
  const knack = knackFor(state.background?.origin.id);
  if (!knack) {
    return [{ tick: state.tick, type: 'error', message: 'You have no such trick in you.' }];
  }

  const ready = state.knackReadyAt ?? 0;
  if (state.tick < ready) {
    return [
      {
        tick: state.tick,
        type: 'error',
        message: `Not again yet. ${ready - state.tick} hours before you have it in you.`,
      },
    ];
  }

  const instance = state.instance;
  const target = instance
    ? instance.occupants.find(
        (occupant) => occupant.room === instance.current && occupant.hp > 0 && !occupant.fled
      )
    : undefined;

  if (!target && knack.id !== 'slip_away') {
    return [
      {
        tick: state.tick,
        type: 'error',
        message: `${knack.name} is for something that is standing in front of you. Nothing is.`,
        data: { knack: knack.id, nothingToUseItOn: true },
      },
    ];
  }

  const check = skillCheck(state, knack.skill, DC.MEDIUM);
  const worked = isAnySuccess(check.outcome);
  state.knackReadyAt = state.tick + knack.cooldown;
  masterFor(state).observe(knack.id);

  const events: GameEvent[] = [];

  switch (knack.id) {
    case 'break_them': {
      if (worked && target) {
        const damage = roll(state.rng, '2d8').total;
        target.hp = Math.max(0, target.hp - damage);
        if (!target.hurts.includes('dazed')) target.hurts.push('dazed');
        // Everything behind it means nothing left in front of it.
        state.exposure = 4;
        state.exposedUntil = state.tick + 1;
        events.push({
          tick: state.tick,
          type: 'combat',
          message: `You put your whole weight behind it and something in it gives. (−${damage}) You are wide open after it.`,
          data: { knack: knack.id, damage },
        });
      } else {
        events.push({
          tick: state.tick,
          type: 'combat',
          message: 'You commit everything to it and it is not there. You feel that in your shoulder.',
          data: { knack: knack.id, failed: true },
        });
      }
      break;
    }

    case 'slip_away': {
      if (worked) {
        for (const occupant of instance?.occupants ?? []) occupant.alerted = false;
        if (instance) {
          const back = instance.rooms[instance.current].exits.find(
            (exit) => instance.rooms[exit].entered
          );
          if (back !== undefined) instance.current = back;
        }
        events.push({
          tick: state.tick,
          type: 'system',
          message: 'You are not where you were, and nothing in the room is sure where you went.',
          data: { knack: knack.id },
        });
      } else {
        events.push({
          tick: state.tick,
          type: 'danger',
          message: 'You go to move and something under your boot gives you away.',
          data: { knack: knack.id, failed: true },
        });
      }
      break;
    }

    case 'talk_them_down':
    default: {
      // Nothing that has already made up its mind can be talked out of it, which is
      // what makes temper matter outside the fight as well as in it.
      if (worked && target && target.temper !== Temper.SAVAGE && !target.boss) {
        target.fled = true;
        events.push({
          tick: state.tick,
          type: 'system',
          message: `You say the thing it was waiting to be given, and ${
            getArchetype(target.archetypeId)?.name ?? 'it'
          } decides this is not worth what it costs.`,
          data: { knack: knack.id, talked: target.id },
        });
      } else {
        events.push({
          tick: state.tick,
          type: 'combat',
          message: target?.temper === Temper.SAVAGE
            ? 'You start to speak. It was never going to listen.'
            : 'You say it and it lands on nothing.',
          data: { knack: knack.id, failed: true },
        });
      }
      break;
    }
  }

  if (instance) events.push(...masterFor(state).take(instance, state));
  return events;
}
