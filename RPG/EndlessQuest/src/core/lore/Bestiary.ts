import { TerrainType } from '../world/TerrainType';

/**
 * Broad classification of a threat. Future social and faction systems branch on this:
 * the dead cannot be reasoned with, men can, and the Sated only pretend to be either.
 */
export enum ThreatKind {
  /** The hungry dead, drawn by the Mark */
  DEAD = 'dead',
  /** Living animals and things wearing them */
  BEAST = 'beast',
  /** Ordinary, dangerous people */
  MAN = 'man',
  /** Those who accepted the Choir's bargain */
  SATED = 'sated',
}

/**
 * Static definition of an encounterable threat.
 * Instances are created by the encounter system; this record holds only immutable design data.
 */
export interface CreatureArchetype {
  /** Stable identifier */
  readonly id: string;
  /** Display name, singular */
  readonly name: string;
  /** Classification used by narration and future faction logic */
  readonly kind: ThreatKind;
  /** Starting and maximum hit points */
  readonly hp: number;
  /** Damage on a hit, in dice notation */
  readonly damageDice: string;
  /** Bonus added to the creature's d20 attack rolls */
  readonly attackBonus: number;
  /** Armour Class: the number an attacker must meet or beat to hit it */
  readonly armorClass: number;
  /** Relative difficulty of disengaging, in [0, 1]; higher is harder to escape */
  readonly tenacity: number;
  /**
   * What this thing is worth, in the source's experience points.
   *
   * Used for two different jobs, as the source uses it: sizing an encounter against the
   * character who will be in it, and paying them for having survived it.
   */
  readonly xp: number;
  /** Relative sampling weight when this archetype is eligible */
  readonly weight: number;
  /**
   * The mark this thing is drawn as on the grid.
   *
   * Appearance is identity in a glyph-rendered world, so it lives with the creature
   * rather than in a lookup table beside the renderer. Lesser things take lower case,
   * greater things upper, after the roguelike convention.
   */
  readonly glyph: string;
  /** Terrain types this threat is found in; empty means anywhere passable */
  readonly terrain: readonly TerrainType[];
  /** If true, only appears between dusk and dawn */
  readonly nocturnal: boolean;
  /** Minimum Gallowsmark intensity, in [0, 100], required before this may appear */
  readonly minMark: number;
  /** Narration when the encounter begins */
  readonly appearance: readonly string[];
  /** Narration when the threat is put down */
  readonly defeat: string;
}

/**
 * The threat table for the Thornmarch.
 *
 * Ordering is by escalating Mark intensity: gaunts find anyone carrying warm, while
 * the Sated only take an interest once the Mark is genuinely burning.
 */
export const BESTIARY: readonly CreatureArchetype[] = [
  {
    id: 'gaunt',
    glyph: 'g',
    name: 'a gaunt',
    kind: ThreatKind.DEAD,
    hp: 14,
    damageDice: '1d4',
    attackBonus: 3,
    armorClass: 11,
    xp: 50,
    tenacity: 0.2,
    weight: 10,
    terrain: [],
    nocturnal: true,
    minMark: 15,
    appearance: [
      'Something comes out of the dark on all fours and then stands up to do it properly.',
      'It was a man once, and recently. It has not eaten since it stopped being one.',
      'A gaunt. Skin like wet paper over a frame that should not still be walking.',
    ],
    defeat: 'It comes apart and stops. There was not much holding it together.',
  },
  {
    id: 'hollow-hound',
    glyph: 'd',
    name: 'a hollow hound',
    kind: ThreatKind.BEAST,
    hp: 20,
    damageDice: '1d6',
    attackBonus: 4,
    armorClass: 13,
    xp: 100,
    tenacity: 0.6,
    weight: 7,
    terrain: [TerrainType.FOREST, TerrainType.HILLS, TerrainType.PLAINS],
    nocturnal: true,
    minMark: 25,
    appearance: [
      'Something is wearing a dog. It moves wrong at the shoulders.',
      'A hound comes out of the treeline at a dead run, and its eyes do not catch the light.',
    ],
    defeat: 'It drops. Whatever was inside it goes out first, and the body follows.',
  },
  {
    id: 'brigand',
    glyph: 'b',
    name: 'a brigand',
    kind: ThreatKind.MAN,
    hp: 22,
    damageDice: '1d6+1',
    attackBonus: 3,
    armorClass: 13,
    xp: 100,
    tenacity: 0.35,
    weight: 8,
    terrain: [TerrainType.PLAINS, TerrainType.HILLS, TerrainType.FOREST],
    nocturnal: false,
    minMark: 0,
    appearance: [
      'A man steps into the road with a billhook and the flat, tired look of someone who has done this before.',
      'Free company, or was. He has kept the sword and lost the contract.',
      'He asks for everything you have. He is not really asking.',
    ],
    defeat: 'He goes down and stays down. He was somebody, before the Dusk.',
  },
  {
    id: 'mire-thing',
    glyph: 'M',
    name: 'a mire-thing',
    kind: ThreatKind.DEAD,
    hp: 34,
    damageDice: '1d8+1',
    attackBonus: 5,
    armorClass: 14,
    xp: 450,
    tenacity: 0.75,
    weight: 6,
    terrain: [TerrainType.SWAMP],
    nocturnal: false,
    minMark: 20,
    appearance: [
      'The mire stands up. It has been down there a long time and it has collected things.',
      'Something the swamp kept. It comes on slowly, which is somehow worse.',
    ],
    defeat: 'It settles back into the water and the water closes without a sound.',
  },
  {
    id: 'grave-wick',
    glyph: '*',
    name: 'a grave-wick',
    kind: ThreatKind.DEAD,
    hp: 10,
    damageDice: '1d4',
    attackBonus: 2,
    armorClass: 12,
    xp: 25,
    tenacity: 0.05,
    weight: 5,
    terrain: [TerrainType.SWAMP, TerrainType.FOREST, TerrainType.MOUNTAIN],
    nocturnal: true,
    minMark: 10,
    appearance: [
      'A pale light, out at the edge of seeing. It waits until you look at it, and then it moves off — expecting you to follow.',
      'A corpse-candle. It does not want to hurt you. It wants to take you somewhere.',
    ],
    defeat: 'The light goes out. The cold where it was standing takes longer to leave.',
  },
  {
    id: 'chain-inquisitor',
    glyph: 'I',
    name: 'a sword of the Iron Chain',
    kind: ThreatKind.MAN,
    hp: 30,
    damageDice: '1d8+2',
    attackBonus: 5,
    armorClass: 16,
    xp: 450,
    tenacity: 0.85,
    weight: 3,
    terrain: [TerrainType.PLAINS, TerrainType.HILLS],
    nocturnal: false,
    minMark: 40,
    appearance: [
      'Three figures on the road, and one of them is writing in a ledger. They have been told to expect you.',
      'The Iron Chain. He looks at the weal on your throat and writes something down before he draws.',
    ],
    defeat: 'He dies certain he was right. They generally do.',
  },
  {
    id: 'sated',
    glyph: 'S',
    name: 'one of the Sated',
    kind: ThreatKind.SATED,
    hp: 55,
    damageDice: '2d6+2',
    attackBonus: 7,
    armorClass: 17,
    xp: 1100,
    tenacity: 0.95,
    weight: 1,
    terrain: [],
    nocturnal: true,
    minMark: 70,
    appearance: [
      'A man is standing in the road with his back to you. When he turns, he keeps turning, and does not stop at a shape you have a word for.',
      'It speaks first. It tells you, unprompted, the name of the person it gave away. It says the name fondly.',
      'One of the Sated has come to see what is making so much noise in the dark.',
    ],
    defeat: 'It comes apart, and for a moment at the end there is a man in there, and he looks relieved.',
  },
];

/**
 * Looks up an archetype by identifier.
 * @param id Archetype identifier
 * @returns Matching archetype, or undefined if unknown
 */
export function getArchetype(id: string): CreatureArchetype | undefined {
  return BESTIARY.find((a) => a.id === id);
}
