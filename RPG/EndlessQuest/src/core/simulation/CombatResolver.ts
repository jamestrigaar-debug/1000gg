import type { GameState } from '../state/GameState';
import { advanceTime } from '../state/GameState';
import type {
  AbilitiesComponent,
  CombatantComponent,
  DyingComponent,
  EquipmentComponent,
  NameComponent,
  StatsComponent,
  ThreatComponent,
} from '../ecs/Component';
import type { GameEvent } from '../../events/GameEvent';
import { getArchetype, ThreatKind } from '../lore/Bestiary';
import { capitalize } from '../lore/Flavor';
import { getItem } from '../lore/Items';
import { EquipSlot } from '../lore/items/ItemTypes';
import { Ability, proficiencyBonus } from '../rules/Abilities';
import { Skill } from '../rules/Skills';
import {
  CheckOutcome,
  RollMode,
  check as rollAgainstDC,
  describeAttack,
} from '../rules/Check';
import { parseDice, rollExpression, rollCritical, rollD20 } from '../rules/Dice';
import { damageAtZero, isDead, rollDeathSave } from '../rules/DeathSaves';
import { hitPointsGained, levelFor } from '../rules/Progression';
import { armorClass, attackMode, modifierOf, narrateCheck, skillCheck } from '../state/Checks';
import {
  COMBAT_RESOLUTION_HOURS,
  UNARMED_DAMAGE,
  DEFEND_AC_BONUS,
  FINESSE_WEAPON_MAX_WEIGHT,
  XP_SURVIVED_FRACTION,
  FLEE_BASE_DC,
  FLEE_TENACITY_SCALE,
  FLEE_ROUND_RELIEF,
  FLEE_MIN_DC,
  MORALE_DC,
  MORALE_RESOLVE_SCALE,
} from '../SimulationConstants';

/**
 * The stance a combatant adopts for a single exchange.
 */
export type CombatStance = 'attack' | 'defend' | 'flee' | 'feint' | 'intimidate';

/**
 * Resolves duels between the player and a single threat.
 *
 * Combat is the same d20 test as everything else: roll, add the ability modifier and the
 * proficiency bonus, compare to the target's Armour Class. A natural 20 always hits and
 * doubles the damage dice; a natural 1 always misses. Damage comes from the weapon's own
 * dice, exactly as the item catalog records them.
 *
 * Dropping to zero hit points does not end a run. It puts the character on the floor
 * rolling death saving throws, which is where this game's endings belong: not at a
 * number reaching zero, but at three failed rolls with something standing over you.
 */
export class CombatResolver {
  /**
   * Executes one exchange: the player's chosen action, then the threat's reply.
   *
   * @param state Current GameState, which must have an active encounter
   * @param stance Action chosen by the player
   * @returns Events describing the exchange, in narrative order
   */
  resolveRound(state: GameState, stance: CombatStance): GameEvent[] {
    const events: GameEvent[] = [];
    const threatId = state.encounterId;

    if (threatId === null) {
      return [
        { tick: state.tick, type: 'error', message: 'Nothing is on you. Save your strength.' },
      ];
    }

    const world = state.entities;
    const playerStats = world.getComponent<StatsComponent>(state.playerId, 'stats');
    const threatStats = world.getComponent<StatsComponent>(threatId, 'stats');
    const threatCombat = world.getComponent<CombatantComponent>(threatId, 'combatant');
    const threatData = world.getComponent<ThreatComponent>(threatId, 'threat');
    const threatName = world.getComponent<NameComponent>(threatId, 'name')?.name ?? 'it';

    if (!playerStats || !threatStats || !threatCombat || !threatData) {
      this.endEncounter(state);
      return [{ tick: state.tick, type: 'error', message: 'The encounter has come apart.' }];
    }

    // A character already on the floor acts only through their death saves.
    if (playerStats.hp <= 0) {
      this.resolveDeathSave(state, events, threatName);
      if (!state.gameOver) {
        this.threatAttacks(state, playerStats, threatCombat, threatName, stance, events);
      }
      return events;
    }

    state.encounterRound += 1;

    switch (stance) {
      case 'flee':
        if (this.attemptFlight(state, threatData, threatName, events)) {
          this.awardExperience(state, threatData, false, events);
          this.endEncounter(state);
          advanceTime(state, COMBAT_RESOLUTION_HOURS);
          return events;
        }
        break;

      case 'intimidate':
        if (this.intimidate(state, threatData, threatStats, threatName, events)) {
          this.awardExperience(state, threatData, false, events);
          this.endEncounter(state);
          advanceTime(state, COMBAT_RESOLUTION_HOURS);
          return events;
        }
        break;

      case 'feint':
        this.feint(state, threatData, threatName, events);
        break;

      case 'defend':
        events.push({
          tick: state.tick,
          type: 'combat',
          message: 'You give ground and cover up, trading the exchange for a guard you can hold.',
          data: { stance },
        });
        break;

      case 'attack':
      default:
        this.playerAttacks(state, threatId, threatStats, threatName, events);

        if (threatStats.hp <= 0) {
          const archetype = getArchetype(threatData.archetypeId);
          events.push({
            tick: state.tick,
            type: 'combat',
            message: archetype?.defeat ?? 'It stops moving.',
            data: { archetype: threatData.archetypeId, rounds: state.encounterRound },
          });
          this.awardExperience(state, threatData, true, events);
          this.endEncounter(state);
          advanceTime(state, COMBAT_RESOLUTION_HOURS);
          return events;
        }
        break;
    }

    // The source's morale rule, asked at the top of the creature's own turn rather than
    // only after the player swings: a thing cut below half for the first time may decide
    // it wants no more of this, whatever the character did that round. Without it every
    // encounter is a duel to somebody's death, and fighting is never worth choosing over
    // running.
    if (
      threatStats.hp > 0 &&
      this.checksMorale(state, threatData, threatStats, threatName, events)
    ) {
      this.awardExperience(state, threatData, false, events);
      this.endEncounter(state);
      advanceTime(state, COMBAT_RESOLUTION_HOURS);
      return events;
    }

    this.threatAttacks(state, playerStats, threatCombat, threatName, stance, events);
    return events;
  }

  /**
   * The player's attack roll, damage, and narration.
   */
  private playerAttacks(
    state: GameState,
    threatId: number,
    threatStats: StatsComponent,
    threatName: string,
    events: GameEvent[]
  ): void {
    const world = state.entities;
    const abilities = world.getComponent<AbilitiesComponent>(state.playerId, 'abilities');
    const equipment = world.getComponent<EquipmentComponent>(state.playerId, 'equipment');
    const held = equipment?.slots[EquipSlot.HAND];
    const weapon = held ? getItem(held) : undefined;

    // Melee uses Strength, but a light blade rewards a quick hand, so finesse weapons
    // take the better of Strength and Dexterity.
    const finesse = weapon !== undefined && weapon.weight <= FINESSE_WEAPON_MAX_WEIGHT;
    const str = modifierOf(world, state.playerId, Ability.STR);
    const dex = modifierOf(world, state.playerId, Ability.DEX);
    const abilityMod = finesse ? Math.max(str, dex) : str;

    const proficiency = proficiencyBonus(abilities?.level ?? 1);
    const targetAC = armorClass(world, threatId);

    // A successful feint leaves the opponent out of position for exactly one attack.
    const extra = state.advantageNextAttack ? [RollMode.ADVANTAGE] : [];
    state.advantageNextAttack = false;

    const attack = rollAgainstDC(
      state.rng,
      abilityMod + proficiency,
      targetAC,
      attackMode(state, extra)
    );

    // A natural 20 always hits; a natural 1 always misses, whatever the modifiers.
    const hit = attack.natural === 20 || (attack.natural !== 1 && attack.success);
    const critical = attack.natural === 20;

    if (!hit) {
      events.push({
        tick: state.tick,
        type: 'combat',
        message:
          attack.natural === 1
            ? `You over-commit, and it is not where you swung. (${describeAttack(attack)})`
            : `You swing and it is not there. (${describeAttack(attack)})`,
        data: { hit: false, roll: attack.total, ac: targetAC },
      });
      return;
    }

    const notation = weapon?.sourceDice ?? UNARMED_DAMAGE;
    const expression = parseDice(notation);
    const damageRoll = critical
      ? rollCritical(state.rng, expression)
      : rollExpression(state.rng, expression);

    const damage = Math.max(1, damageRoll.total + abilityMod);
    threatStats.hp = Math.max(0, threatStats.hp - damage);

    const weaponName = weapon ? weapon.name.toLowerCase() : 'bare hands';
    events.push({
      tick: state.tick,
      type: 'combat',
      message: critical
        ? `You put everything into it and it goes exactly where you meant. ${capitalize(threatName)} takes ${damage}. (natural 20, ${notation} doubled)`
        : `You land it with the ${weaponName}. ${capitalize(threatName)} takes ${damage}. (${describeAttack(attack)}, ${notation})`,
      data: { hit: true, critical, damage, targetHp: threatStats.hp },
    });
  }

  /**
   * Lets the threat answer something the player did that was not one of the stances.
   *
   * Improvised actions in a fight -- throwing a handful of grit, cutting a strap, saying
   * the one thing that might work -- are resolved by the improvisation rules, and then
   * the thing in front of the character still gets its turn, because it always does.
   *
   * @param state Current state, with an encounter active
   * @returns Events describing the reply, empty if nothing is engaged
   */
  answerImprovisation(state: GameState): GameEvent[] {
    const threatId = state.encounterId;
    if (threatId === null || state.gameOver) return [];

    const world = state.entities;
    const playerStats = world.getComponent<StatsComponent>(state.playerId, 'stats');
    const threatCombat = world.getComponent<CombatantComponent>(threatId, 'combatant');
    const threatName = world.getComponent<NameComponent>(threatId, 'name')?.name ?? 'it';
    if (!playerStats || !threatCombat) return [];

    state.encounterRound += 1;

    const events: GameEvent[] = [];
    if (playerStats.hp <= 0) {
      this.resolveDeathSave(state, events, threatName);
      if (state.gameOver) return events;
    }

    this.threatAttacks(state, playerStats, threatCombat, threatName, 'attack', events);
    return events;
  }

  /**
   * The threat's reply, and the player's death saves if it drops them.
   */
  private threatAttacks(
    state: GameState,
    playerStats: StatsComponent,
    threatCombat: CombatantComponent,
    threatName: string,
    stance: CombatStance,
    events: GameEvent[]
  ): void {
    const world = state.entities;
    const guard = stance === 'defend' ? DEFEND_AC_BONUS : 0;
    const playerAC = armorClass(world, state.playerId) + guard;

    const natural = rollD20(state.rng);
    const total = natural + threatCombat.attackBonus;
    const hit = natural === 20 || (natural !== 1 && total >= playerAC);
    const critical = natural === 20;

    if (!hit) {
      events.push({
        tick: state.tick,
        type: 'combat',
        message: `${capitalize(threatName)} comes at you and you turn it aside. (d20 ${natural}+${threatCombat.attackBonus} = ${total} vs AC ${playerAC})`,
        data: { hit: false, ac: playerAC },
      });
      return;
    }

    const expression = parseDice(threatCombat.damageDice);
    const damageRoll = critical
      ? rollCritical(state.rng, expression)
      : rollExpression(state.rng, expression);
    const damage = Math.max(1, damageRoll.total);

    // A blow landing on a character already at zero is a failed death save outright.
    if (playerStats.hp <= 0) {
      const dying = this.dyingState(state);
      const died = damageAtZero(dying, critical);
      events.push({
        tick: state.tick,
        type: 'danger',
        message: `${capitalize(threatName)} hits you where you lie. [${dying.successes}s / ${dying.failures}f]`,
        data: { damage, critical, atZero: true },
      });
      if (died) {
        this.die(state, events, `${capitalize(threatName)} finished what the rope started.`);
      }
      return;
    }

    playerStats.hp = Math.max(0, playerStats.hp - damage);

    events.push({
      tick: state.tick,
      type: 'danger',
      message: critical
        ? `${capitalize(threatName)} gets inside your guard and something gives. You take ${damage}. (natural 20)`
        : `${capitalize(threatName)} hits you for ${damage}. (d20 ${natural}+${threatCombat.attackBonus} = ${total} vs AC ${playerAC})`,
      data: { damage, critical, playerHp: playerStats.hp },
    });

    if (playerStats.hp <= 0) {
      // Damage at or above the hit point maximum kills outright; otherwise the
      // character goes down, and fate takes over.
      if (damage >= playerStats.maxHp) {
        this.die(state, events, `${capitalize(threatName)} killed you outright.`);
        return;
      }
      this.dyingState(state);
      events.push({
        tick: state.tick,
        type: 'danger',
        message: 'You go down. You are in the hands of fate now.',
        data: { dying: true },
      });
    }
  }

  /**
   * Rolls one death saving throw for a character on the floor.
   */
  private resolveDeathSave(state: GameState, events: GameEvent[], threatName: string): void {
    const dying = this.dyingState(state);

    if (dying.stable) {
      events.push({
        tick: state.tick,
        type: 'danger',
        message: `You are stable, and ${threatName} is still standing over you.`,
        data: { stable: true },
      });
      return;
    }

    const result = rollDeathSave(state.rng, dying);
    events.push({
      tick: state.tick,
      type: result.outcome === 'died' ? 'death' : 'danger',
      message: `Death save (d20 ${result.natural}): ${result.message} [${dying.successes}s / ${dying.failures}f]`,
      data: { outcome: result.outcome, successes: dying.successes, failures: dying.failures },
    });

    if (result.outcome === 'revived') {
      const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
      if (stats) stats.hp = 1;
      state.entities.removeComponent(state.playerId, 'dying');
      return;
    }

    if (result.outcome === 'died' || isDead(dying)) {
      this.die(state, events, 'You died on the road, face down, in the dark.');
    }
  }

  /**
   * Reads or creates the running death save tally.
   */
  private dyingState(state: GameState): DyingComponent {
    let dying = state.entities.getComponent<DyingComponent>(state.playerId, 'dying');
    if (!dying) {
      dying = { type: 'dying', successes: 0, failures: 0, stable: false };
      state.entities.addComponent(state.playerId, dying);
    }
    return dying;
  }

  /**
   * Ends the run.
   */
  private die(state: GameState, events: GameEvent[], cause: string): void {
    state.gameOver = true;
    state.causeOfDeath = cause;
    events.push({
      tick: state.tick,
      type: 'death',
      message: `${cause} The debt is collected.`,
      data: { cause },
    });
    this.endEncounter(state);
  }

  /**
   * Attempts to break off, as a Dexterity (Acrobatics) check against the threat's grip.
   * @returns true if the player got away
   */
  private attemptFlight(
    state: GameState,
    threatData: ThreatComponent,
    threatName: string,
    events: GameEvent[]
  ): boolean {
    // A chase is a race the quarry can eventually win. Every round already spent running
    // makes the next attempt easier, so flight is not a coin flip repeated until the
    // character dies of it -- it is a bounded cost, paid in the blows taken while
    // breaking contact. At first level this is the difference between a game about
    // choosing your fights and a game with no choices in it at all.
    const pressed = Math.max(0, state.encounterRound - 1) * FLEE_ROUND_RELIEF;
    const dc = Math.max(
      FLEE_MIN_DC,
      FLEE_BASE_DC + Math.round(FLEE_TENACITY_SCALE * threatData.tenacity) - pressed
    );
    const result = skillCheck(state, Skill.ACROBATICS, dc);
    events.push({
      tick: state.tick,
      type: 'combat',
      message: narrateCheck(Skill.ACROBATICS, result),
      data: { check: 'flee', outcome: result.outcome },
    });

    if (result.outcome === CheckOutcome.CRITICAL_SUCCESS || result.success) {
      events.push({
        tick: state.tick,
        type: 'combat',
        message: 'You break off and run, and this time the dark does not follow.',
        data: { fled: true },
      });
      return true;
    }

    events.push({
      tick: state.tick,
      type: 'danger',
      message: `You turn to run. ${capitalize(threatName)} was waiting for exactly that.`,
      data: { fled: false },
    });
    return false;
  }

  /**
   * Spends the exchange trying to pull the threat out of position.
   */
  private feint(
    state: GameState,
    threatData: ThreatComponent,
    threatName: string,
    events: GameEvent[]
  ): void {
    const dc = 10 + Math.round(8 * threatData.tenacity);
    const result = skillCheck(state, Skill.DECEPTION, dc);
    events.push({
      tick: state.tick,
      type: 'combat',
      message: narrateCheck(Skill.DECEPTION, result),
      data: { check: 'feint', outcome: result.outcome },
    });

    if (result.success) {
      // A read opponent is out of position for exactly one attack.
      state.advantageNextAttack = true;
      events.push({
        tick: state.tick,
        type: 'combat',
        message: `You show it an opening that is not there. ${capitalize(threatName)} commits to it.`,
        data: { stance: 'feint', advantage: true },
      });
      return;
    }

    events.push({
      tick: state.tick,
      type: 'combat',
      message: 'It does not take the bait, and you have spent the moment.',
      data: { stance: 'feint' },
    });
  }

  /**
   * Attempts to drive the threat off without killing it.
   *
   * The dead and the Sated cannot be frightened: one has nothing left to lose and the
   * other gave its fear away in the bargain. That is the lore drawing a mechanical line.
   *
   * @returns true if the threat broke off
   */
  private intimidate(
    state: GameState,
    threatData: ThreatComponent,
    threatStats: StatsComponent,
    threatName: string,
    events: GameEvent[]
  ): boolean {
    const archetype = getArchetype(threatData.archetypeId);
    if (archetype?.kind === ThreatKind.DEAD || archetype?.kind === ThreatKind.SATED) {
      events.push({
        tick: state.tick,
        type: 'combat',
        message: `You round on it and roar. ${capitalize(threatName)} has nothing left in it that fear can reach.`,
        data: { stance: 'intimidate', immune: true },
      });
      return false;
    }

    // A hurt enemy is easier to send running.
    const hurt = 1 - threatStats.hp / Math.max(1, threatStats.maxHp);
    const dc = 10 + Math.round(10 * threatData.tenacity) - Math.round(6 * hurt);
    const result = skillCheck(state, Skill.INTIMIDATION, dc);

    events.push({
      tick: state.tick,
      type: 'combat',
      message: narrateCheck(Skill.INTIMIDATION, result),
      data: { check: 'intimidate', outcome: result.outcome },
    });

    if (result.success) {
      events.push({
        tick: state.tick,
        type: 'combat',
        message: `${capitalize(threatName)} decides you are not worth what you would cost, and goes.`,
        data: { stance: 'intimidate', drivenOff: true },
      });
      return true;
    }

    events.push({
      tick: state.tick,
      type: 'danger',
      message: `${capitalize(threatName)} has seen men bluff before.`,
      data: { stance: 'intimidate' },
    });
    return false;
  }

  /**
   * Asks whether a creature has had enough.
   *
   * Checked once per fight, the first time it is cut below half. The saving throw is the
   * source's DC 10; tenacity stands in for the creature's own resolve, so the Sated do
   * not run and a grave-wick very much does.
   *
   * @param state Mutable game state
   * @param threatData The threat's record, which remembers whether it has been asked
   * @param threatStats Its condition
   * @param threatName What to call it
   * @param events Event list to narrate into
   * @returns true if it broke off
   */
  private checksMorale(
    state: GameState,
    threatData: ThreatComponent,
    threatStats: StatsComponent,
    threatName: string,
    events: GameEvent[]
  ): boolean {
    if (threatData.testedMorale) return false;
    if (threatStats.hp > threatStats.maxHp / 2) return false;

    threatData.testedMorale = true;

    const save = rollD20(state.rng) + Math.round(threatData.tenacity * MORALE_RESOLVE_SCALE);
    if (save >= MORALE_DC) return false;

    events.push({
      tick: state.tick,
      type: 'combat',
      message: `${capitalize(threatName)} has had enough of you and goes, fast, without looking back. (morale ${save} vs DC ${MORALE_DC})`,
      data: { morale: save, broke: true },
    });
    return true;
  }

  /**
   * Records what surviving a threat was worth, and levels the character if it was enough.
   *
   * Killing a thing is worth all of its experience and getting away from it is worth
   * half, because the game should not insist that the only way past something is
   * through it. A character who runs the whole way still grows, just more slowly.
   *
   * @param state Mutable game state
   * @param threatData The threat that was survived
   * @param killed True if it was put down rather than escaped
   * @param events Event list to narrate into
   */
  private awardExperience(
    state: GameState,
    threatData: ThreatComponent,
    killed: boolean,
    events: GameEvent[]
  ): void {
    const abilities = state.entities.getComponent<AbilitiesComponent>(
      state.playerId,
      'abilities'
    );
    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
    const archetype = getArchetype(threatData.archetypeId);
    if (!abilities || !stats || !archetype) return;

    const earned = killed
      ? archetype.xp
      : Math.max(1, Math.round(archetype.xp * XP_SURVIVED_FRACTION));
    abilities.xp += earned;

    const level = levelFor(abilities.xp);
    if (level <= abilities.level) {
      events.push({
        tick: state.tick,
        type: 'system',
        message: `You are still here. (+${earned} xp)`,
        data: { xp: abilities.xp, earned },
      });
      return;
    }

    // Every level crossed is paid out, in case a single kill spans two of them.
    let gained = 0;
    while (abilities.level < level) {
      abilities.level += 1;
      gained += hitPointsGained(state.rng, abilities.scores[Ability.CON]);
    }
    stats.maxHp += gained;
    stats.hp += gained;

    events.push({
      tick: state.tick,
      type: 'system',
      message:
        `Something in you has hardened around what you have seen. Level ${abilities.level}. ` +
        `(+${earned} xp, +${gained} hp, proficiency +${proficiencyBonus(abilities.level)})`,
      data: { level: abilities.level, xp: abilities.xp, hp: gained },
    });
  }

  /**
   * Clears the active encounter and destroys the threat entity.
   */
  private endEncounter(state: GameState): void {
    if (state.encounterId !== null) {
      state.entities.destroyEntity(state.encounterId);
    }
    state.encounterId = null;
    state.encounterRound = 0;
    state.advantageNextAttack = false;
  }
}
