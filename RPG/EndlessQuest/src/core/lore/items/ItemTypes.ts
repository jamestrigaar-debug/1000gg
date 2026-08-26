/**
 * Type definitions for the Thornmarch item catalog.
 *
 * The catalog is adapted from the EndlessQuest Complete Item & Card Catalog. Where the
 * source document assumes a dice-and-attributes model, these types express the same
 * design intent in the continuous terms the rest of the simulation uses. See the header
 * of Catalog.ts for the specific conversions.
 */

/**
 * Fraction of incoming damage one point of armour protection absorbs.
 *
 * The source catalog rates armour in points; this build stores the resulting fraction.
 * The constant is exported so Armour Class can recover the original points from it,
 * keeping the two representations in agreement.
 */
export const ARMOR_POINT_FRACTION = 0.08;

/**
 * Broad classification of an item, used for filtering, shop stock, and loot tables.
 */
export enum ItemCategory {
  WEAPON_EDGED = 'weapon_edged',
  WEAPON_BLUNT = 'weapon_blunt',
  WEAPON_RANGED = 'weapon_ranged',
  ARMOR = 'armor',
  SHIELD = 'shield',
  FOOD = 'food',
  MEDICAL = 'medical',
  TOOL = 'tool',
  LIGHT = 'light',
  SURVIVAL = 'survival',
  MATERIAL = 'material',
  VALUABLE = 'valuable',
  ARTIFACT = 'artifact',
}

/**
 * Where an item is worn or held. Items with no slot cannot be equipped.
 */
export enum EquipSlot {
  HAND = 'hand',
  OFFHAND = 'offhand',
  BODY = 'body',
  HEAD = 'head',
  FEET = 'feet',
}

/**
 * Scarcity band, derived from trade value. Drives loot and shop stock frequency.
 */
export enum Rarity {
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
  ARTIFACT = 'artifact',
}

/**
 * A single catalog entry.
 *
 * Most fields are optional because the catalog spans everything from a sack of flour to
 * a cursed ring; only the identity, physical, and trade fields are universal.
 */
export interface ItemDefinition {
  /** Stable identifier, also the inventory key */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** Broad classification */
  readonly category: ItemCategory;
  /** Scarcity band */
  readonly rarity: Rarity;
  /** Flavour text shown in the inventory */
  readonly description: string;
  /** Carried weight; inventory capacity is measured in these units */
  readonly weight: number;
  /** Base trade value in copper */
  readonly value: number;
  /** Whether the item is consumed on use */
  readonly consumable: boolean;

  /**
   * Damage scale for weapons, feeding the Pareto scale parameter in CombatMath.
   * This is a scale, not an expected value.
   */
  readonly damage?: number;
  /** The original dice expression this damage was derived from, kept for traceability */
  readonly sourceDice?: string;
  /** Fraction of incoming damage absorbed, in [0, 1) */
  readonly armor?: number;
  /** Where the item is worn or held */
  readonly slot?: EquipSlot;
  /** Insulation value; carried as data ahead of a weather system */
  readonly warmth?: number;
  /** Maximum condition; absent means the item does not wear out */
  readonly durability?: number;

  /** Hunger relieved on consumption */
  readonly hunger?: number;
  /** Thirst relieved on consumption */
  readonly thirst?: number;
  /** Fatigue relieved on consumption */
  readonly fatigue?: number;
  /** Morale change; carried as data ahead of a morale system */
  readonly morale?: number;
  /** Hit points restored on use */
  readonly hp?: number;
  /** Number of applications before the item is spent */
  readonly uses?: number;

  /** Illumination radius in tiles; carried as data ahead of a light system */
  readonly lightRadius?: number;
  /** Hours the light source burns for */
  readonly burnHours?: number;

  /** An artifact's visible gift */
  readonly boon?: string;
  /** An artifact's hidden cost, which is always the real price */
  readonly bane?: string;

  /** Searchable tags, derived from the source catalog's sections */
  readonly tags: readonly string[];
}
