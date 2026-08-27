import type { AbilityScores } from '../rules/Abilities';

/**
 * Base Component interface. All ECS components must have a distinct readonly type identifier.
 */
export interface Component {
  readonly type: string;
}

/**
 * Spatial position component representing world grid coordinates.
 */
export interface PositionComponent extends Component {
  type: 'position';
  x: number;
  y: number;
}

/**
 * Marker component indicating the entity is the primary player character.
 */
export interface PlayerComponent extends Component {
  type: 'player';
}

/**
 * Visual rendering component defining entity color and optional sprite name.
 */
export interface RenderableComponent extends Component {
  type: 'renderable';
  color: number;
  sprite?: string;
}

/**
 * Core vital attributes and survival needs for an entity.
 *
 * Hit points and the three need meters are the moment-to-moment readout. Exhaustion is
 * the six-level ladder those meters feed into: a need that tops out does not simply sit
 * at a hundred, it costs a level, and levels are what actually cripple a character.
 */
export interface StatsComponent extends Component {
  type: 'stats';
  hp: number;
  maxHp: number;
  hunger: number;
  thirst: number;
  /** Hours-awake pressure; topping out costs a level of exhaustion and resets */
  fatigue: number;
  /** Exhaustion level in [0, 6]; the sixth is death */
  exhaustion: number;
  /** Consecutive days the character has gone without a proper meal */
  daysWithoutFood: number;
  /** Consecutive days the character has gone short of water */
  daysWithoutWater: number;
}

/**
 * A condition the character is holding: a wound, a state of the body, a state of mind.
 */
export interface HeldCondition {
  /** Which card, by the catalog's identifier */
  readonly id: string;
  /** The hour it was taken */
  readonly since: number;
  /**
   * The hour it lifts on its own, or null when it holds until it is seen to.
   *
   * A broken leg does not heal because time passed; a fright does.
   */
  readonly until: number | null;
}

/**
 * Everything currently wrong with -- or right about -- the character.
 *
 * Wounds accumulate, states of the body come and go with the meters, and states of mind
 * follow what has happened. They are held in one place because everything that asks a
 * question of the character has to ask this too.
 */
export interface ConditionsComponent extends Component {
  type: 'conditions';
  held: HeldCondition[];
}

/**
 * The six ability scores, the character's level, and what they are trained in.
 *
 * Everything uncertain resolves as a d20 plus the relevant ability modifier, plus the
 * proficiency bonus when the character is trained in the skill being called for.
 */
export interface AbilitiesComponent extends Component {
  type: 'abilities';
  scores: AbilityScores;
  /** Experience earned by surviving what the Thornmarch sends */
  xp: number;
  level: number;
  /** Skill identifiers the character is proficient in */
  proficientSkills: string[];
  /** Ability identifiers whose saving throws the character is proficient in */
  proficientSaves: string[];
}

/**
 * A running tally of death saving throws, present only while at zero hit points.
 */
export interface DyingComponent extends Component {
  type: 'dying';
  successes: number;
  failures: number;
  /** True once stabilised: still down, but no longer rolling */
  stable: boolean;
}

/**
 * The Gallowsmark carried by the player character.
 *
 * Intensity is the simulation's central pressure gauge: it rises in darkness and
 * unhallowed terrain, falls in daylight and near settlements, and drives the rate
 * function of the encounter process. See LORE.md section II.
 */
export interface MarkComponent extends Component {
  type: 'mark';
  /** Current intensity in [MARK_MIN, MARK_MAX] */
  intensity: number;
  /** Index into MARK_BAND_THRESHOLDS last narrated, used to report crossings once */
  band: number;
  /** Cumulative hours spent in the hottest band, retained for future escalation logic */
  hoursBurning: number;
}

/**
 * Carried goods, stored as a count per item key defined in lore/Items.
 */
export interface InventoryComponent extends Component {
  type: 'inventory';
  /** Item key to quantity held */
  items: Record<string, number>;
  /**
   * Coin, in copper.
   *
   * Kept as a number rather than as an item because a purse is not a thing you carry,
   * it is a quantity you have, and every price in the catalog is already in copper.
   */
  copper: number;
}

/**
 * Combat capability for any entity that can fight, including the player.
 */
export interface CombatantComponent extends Component {
  type: 'combatant';
  /** Bonus added to this entity's d20 attack rolls */
  attackBonus: number;
  /** Damage dealt on a hit, in dice notation such as "1d6+1" */
  damageDice: string;
  /**
   * Armour Class, for entities that do not derive one from worn equipment.
   *
   * The player's AC is computed from what they are wearing and their Dexterity; a
   * creature simply has one, as its stat block would state.
   */
  armorClass?: number;
}

/**
 * Marks an entity as a hostile drawn from the bestiary.
 */
export interface ThreatComponent extends Component {
  type: 'threat';
  /** Bestiary archetype identifier */
  archetypeId: string;
  /** Difficulty of disengaging, in [0, 1] */
  tenacity: number;
  /** True once this creature has been asked whether it wants to go on fighting */
  testedMorale?: boolean;
}

/**
 * Items an entity is currently wearing or wielding, keyed by equip slot.
 *
 * Equipped items remain in the inventory and continue to count against carried weight;
 * this component records only what is in use, to avoid tracking the same object in two
 * places.
 */
export interface EquipmentComponent extends Component {
  type: 'equipment';
  /** Equip slot to item key */
  slots: Record<string, string>;
}

/**
 * Human-readable name for an entity or place.
 */
export interface NameComponent extends Component {
  type: 'name';
  name: string;
}

/**
 * Type map facilitating type-safe component retrieval.
 */
export interface ComponentMap {
  position: PositionComponent;
  player: PlayerComponent;
  renderable: RenderableComponent;
  stats: StatsComponent;
  mark: MarkComponent;
  inventory: InventoryComponent;
  conditions: ConditionsComponent;
  combatant: CombatantComponent;
  threat: ThreatComponent;
  abilities: AbilitiesComponent;
  dying: DyingComponent;
  equipment: EquipmentComponent;
  name: NameComponent;
  [key: string]: Component;
}
