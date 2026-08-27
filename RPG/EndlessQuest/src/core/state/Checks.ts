import type { GameState } from './GameState';
import { flawModifier } from './GameState';
import type { World } from '../ecs/World';
import type { EntityId } from '../ecs/Entity';
import type {
  AbilitiesComponent,
  CombatantComponent,
  EquipmentComponent,
  StatsComponent,
} from '../ecs/Component';
import { Ability, abilityModifier, proficiencyBonus } from '../rules/Abilities';
import { Skill, SKILL_ABILITY, describeCheck } from '../rules/Skills';
import { conditionPenalties } from './Conditions';
import {
  CheckOutcome,
  CheckResult,
  RollMode,
  check as rollAgainstDC,
  resolveModes,
  describeRoll,
} from '../rules/Check';
import { attackModeFor, checkModeFor } from '../rules/Exhaustion';
import { ARMOR_POINT_FRACTION } from '../lore/items/ItemTypes';
import { getItem } from '../lore/Items';

/**
 * The bridge between the rules layer and the running game.
 *
 * The rules modules know nothing about the Thornmarch; these functions assemble a
 * character's modifier from everything that bears on it -- the governing ability,
 * training, exhaustion, and whatever their flaw is costing them right now -- and put
 * the d20 test to the rules layer.
 *
 * Gathering every source in one place is what stops a modifier being silently forgotten
 * at one call site and applied at another.
 */

/** Unarmoured Armour Class before the Dexterity modifier. */
export const BASE_ARMOR_CLASS = 10;

/**
 * Reads a character's ability modifier.
 * @param world ECS world
 * @param entity Entity to read
 * @param ability Ability to read
 * @returns The modifier, or zero for an entity with no ability scores
 */
export function modifierOf(world: World, entity: EntityId, ability: Ability): number {
  const abilities = world.getComponent<AbilitiesComponent>(entity, 'abilities');
  if (!abilities) return 0;
  return abilityModifier(abilities.scores[ability]);
}

/**
 * Reports whether a character is trained in a skill.
 * @param world ECS world
 * @param entity Entity to read
 * @param skill Skill to test
 * @returns true if proficient
 */
export function isProficient(world: World, entity: EntityId, skill: Skill): boolean {
  const abilities = world.getComponent<AbilitiesComponent>(entity, 'abilities');
  return abilities?.proficientSkills.includes(skill) ?? false;
}

/**
 * The total modifier a character brings to a skill check.
 *
 * Ability modifier, plus the proficiency bonus if trained, plus whatever the character's
 * flaw is costing them under present circumstances.
 *
 * @param state Current GameState
 * @param skill Skill being called for
 * @returns The summed modifier
 */
export function skillModifier(state: GameState, skill: Skill): number {
  const world = state.entities;
  const entity = state.playerId;
  const abilities = world.getComponent<AbilitiesComponent>(entity, 'abilities');

  const ability = modifierOf(world, entity, SKILL_ABILITY[skill]);
  const trained = isProficient(world, entity, skill)
    ? proficiencyBonus(abilities?.level ?? 1)
    : 0;

  return ability + trained + flawModifier(state);
}

/**
 * Every source of advantage or disadvantage bearing on an ability check.
 *
 * Exhaustion imposes disadvantage on ability checks from its first level, which is the
 * main reason the ladder has teeth.
 *
 * @param state Current GameState
 * @param extra Additional situational modes
 * @returns The mode the roll is made at
 */
export function checkMode(state: GameState, extra: readonly RollMode[] = []): RollMode {
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
  return resolveModes([checkModeFor(stats?.exhaustion ?? 0), ...extra]);
}

/**
 * Every source bearing on an attack roll or saving throw.
 *
 * Exhaustion imposes disadvantage on these only from its third level.
 *
 * @param state Current GameState
 * @param extra Additional situational modes
 * @returns The mode the roll is made at
 */
export function attackMode(state: GameState, extra: readonly RollMode[] = []): RollMode {
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
  return resolveModes([attackModeFor(stats?.exhaustion ?? 0), ...extra]);
}

/**
 * A skill check, with every modifier and mode assembled.
 *
 * @param state Current GameState
 * @param skill Skill being called for
 * @param dc Target number
 * @param extra Situational advantage or disadvantage
 * @returns The rolled result
 */
export function skillCheck(
  state: GameState,
  skill: Skill,
  dc: number,
  extra: readonly RollMode[] = []
): CheckResult {
  // Everything the character is carrying in the way of wounds, hunger and state of mind
  // is felt here, which is the only place it needs to be felt for every check in the
  // game to know about it.
  const carried = conditionPenalties(state);
  const ability = SKILL_ABILITY[skill];
  const fromConditions = carried.checks + Math.floor((carried.abilities[ability] ?? 0) / 2);

  return rollAgainstDC(
    state.rng,
    skillModifier(state, skill) + fromConditions,
    dc,
    checkMode(state, extra)
  );
}

/**
 * A saving throw against an ability.
 *
 * @param state Current GameState
 * @param ability Ability being tested
 * @param dc Target number
 * @param extra Situational advantage or disadvantage
 * @returns The rolled result
 */
export function savingThrow(
  state: GameState,
  ability: Ability,
  dc: number,
  extra: readonly RollMode[] = []
): CheckResult {
  const world = state.entities;
  const abilities = world.getComponent<AbilitiesComponent>(state.playerId, 'abilities');
  const trained = abilities?.proficientSaves.includes(ability)
    ? proficiencyBonus(abilities.level)
    : 0;

  const carried = conditionPenalties(state);
  const modifier =
    modifierOf(world, state.playerId, ability) +
    trained +
    carried.checks +
    Math.floor((carried.abilities[ability] ?? 0) / 2);

  return rollAgainstDC(state.rng, modifier, dc, attackMode(state, extra));
}

/**
 * A character's Armour Class.
 *
 * Ten, plus the protection of everything worn, plus the Dexterity modifier. Armour is
 * stored in the catalog as a damage-absorbed fraction, so the protection value is
 * recovered from it using the same constant the catalog was built with.
 *
 * @param world ECS world
 * @param entity Entity to evaluate
 * @returns Armour Class
 */
export function armorClass(world: World, entity: EntityId): number {
  // A creature states its Armour Class outright; only characters derive one from gear.
  const combatant = world.getComponent<CombatantComponent>(entity, 'combatant');
  if (combatant?.armorClass !== undefined) return combatant.armorClass;

  const equipment = world.getComponent<EquipmentComponent>(entity, 'equipment');
  const dex = modifierOf(world, entity, Ability.DEX);

  let worn = 0;
  if (equipment) {
    for (const slot of Object.keys(equipment.slots)) {
      const item = getItem(equipment.slots[slot]);
      if (item?.armor !== undefined) {
        worn += Math.round(item.armor / ARMOR_POINT_FRACTION);
      }
    }
  }

  return BASE_ARMOR_CLASS + worn + dex;
}

/**
 * Formats a check the way a table would narrate it, for the log.
 *
 * Showing the roll is not clutter: seeing "Wisdom (Survival) d20 14+3 = 17 vs DC 15"
 * is what makes the outcome feel adjudicated rather than arbitrary.
 *
 * @param skill Skill that was called for
 * @param result The rolled result
 * @returns A phrase for the log
 */
export function narrateCheck(skill: Skill, result: CheckResult): string {
  return `${describeCheck(skill)}: ${describeRoll(result)}`;
}

/**
 * Convenience re-export so call sites need only import from here.
 */
export { CheckOutcome, RollMode, Skill, Ability };

/**
 * Reports what an action did to the character's condition.
 *
 * A survival game that never shows the meters moving is asking the player to take its
 * word for it. Anything that spends or restores a need says so in the same breath, in
 * the shape the status bar uses, so the log and the bar never disagree.
 *
 * @param before Snapshot of the meters taken before the action
 * @param stats The meters after it
 * @returns A parenthetical such as "(thirst 82 → 22)", or an empty string
 */
export function describeChange(before: NeedSnapshot, stats: StatsComponent): string {
  const parts: string[] = [];

  if (Math.round(before.hp) !== Math.round(stats.hp)) {
    parts.push(`hp ${Math.round(before.hp)} → ${Math.round(stats.hp)}`);
  }
  for (const need of ['hunger', 'thirst', 'fatigue'] as const) {
    if (Math.round(before[need]) !== Math.round(stats[need])) {
      parts.push(`${need} ${Math.round(before[need])} → ${Math.round(stats[need])}`);
    }
  }

  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}

/**
 * The meters at a moment in time, for comparison after an action.
 */
export interface NeedSnapshot {
  hp: number;
  hunger: number;
  thirst: number;
  fatigue: number;
}

/**
 * Takes a snapshot of the meters.
 *
 * @param stats The character's stats
 * @returns A copy of the four values that actions move
 */
export function snapshotNeeds(stats: StatsComponent): NeedSnapshot {
  return {
    hp: stats.hp,
    hunger: stats.hunger,
    thirst: stats.thirst,
    fatigue: stats.fatigue,
  };
}
