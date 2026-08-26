/**
 * Condition cards: wounds, survival states, and states of mind.
 *
 * Carried as data ahead of the systems that will apply them. Wounds and survival
 * states overlap with what NeedsSystem already models directly; those are kept here
 * so the two can be reconciled when conditions become entities in their own right.
 */
export interface ConditionCard {
  readonly id: string;
  readonly name: string;
  /** Which table the condition came from */
  readonly group: string;
  /** What the condition does, as written in the source catalog */
  readonly effect: string;
  /** What brings the condition on, where the source specifies one */
  readonly trigger: string;
  /** What clears it */
  readonly treatment: string;
  /** How long it lasts untreated, where the source specifies */
  readonly duration: string;
}

export const CONDITIONS: readonly ConditionCard[] = [
  {
    id: 'deep_cut_arm',
    name: 'Deep Cut (Arm)',
    group: 'Condition Cards',
    effect: '-2 attack, bleeding 1 HP/6 ticks',
    trigger: '',
    treatment: 'Bandage',
    duration: '24 hours',
  },
  {
    id: 'deep_cut_leg',
    name: 'Deep Cut (Leg)',
    group: 'Condition Cards',
    effect: '-1 Dexterity, movement halved',
    trigger: '',
    treatment: 'Bandage',
    duration: '24 hours',
  },
  {
    id: 'broken_arm',
    name: 'Broken Arm',
    group: 'Condition Cards',
    effect: 'Cannot use two-handed, -3 attack',
    trigger: '',
    treatment: 'Splint + rest',
    duration: '7 days',
  },
  {
    id: 'broken_leg',
    name: 'Broken Leg',
    group: 'Condition Cards',
    effect: 'Cannot move without crutch',
    trigger: '',
    treatment: 'Splint + rest',
    duration: '14 days',
  },
  {
    id: 'concussion',
    name: 'Concussion',
    group: 'Condition Cards',
    effect: '-2 Intelligence, -2 Wisdom',
    trigger: '',
    treatment: 'Rest',
    duration: '48 hours',
  },
  {
    id: 'cracked_ribs',
    name: 'Cracked Ribs',
    group: 'Condition Cards',
    effect: '-1 Constitution, cannot run',
    trigger: '',
    treatment: 'Rest',
    duration: '7 days',
  },
  {
    id: 'gashed_leg',
    name: 'Gashed Leg',
    group: 'Condition Cards',
    effect: 'Bleeding 2 HP/6 ticks, movement halved',
    trigger: '',
    treatment: 'Bandage + rest',
    duration: '24 hours',
  },
  {
    id: 'scalp_laceration',
    name: 'Scalp Laceration',
    group: 'Condition Cards',
    effect: 'Bleeding 1 HP/12 ticks',
    trigger: '',
    treatment: 'Bandage',
    duration: '12 hours',
  },
  {
    id: 'burn',
    name: 'Burn',
    group: 'Condition Cards',
    effect: '-1 Dexterity, pain',
    trigger: '',
    treatment: 'Burn ointment',
    duration: '48 hours',
  },
  {
    id: 'infected_wound',
    name: 'Infected Wound',
    group: 'Condition Cards',
    effect: '-2 Constitution, fever',
    trigger: '',
    treatment: 'Feverfew + rest',
    duration: '72 hours',
  },
  {
    id: 'frostbite',
    name: 'Frostbite',
    group: 'Condition Cards',
    effect: '-2 Dexterity, -2 attack',
    trigger: '',
    treatment: 'Warmth',
    duration: '7 days',
  },
  {
    id: 'sprained_ankle',
    name: 'Sprained Ankle',
    group: 'Condition Cards',
    effect: '-2 movement, -1 Dexterity',
    trigger: '',
    treatment: 'Rest + bandage',
    duration: '3 days',
  },
  {
    id: 'hungry',
    name: 'Hungry',
    group: 'Survival States',
    effect: '-1 physical checks',
    trigger: 'Hunger < 30',
    treatment: 'Eat food',
    duration: '',
  },
  {
    id: 'starving',
    name: 'Starving',
    group: 'Survival States',
    effect: '-2 all checks, 1 HP/24 ticks',
    trigger: 'Hunger < 10',
    treatment: 'Eat substantial food',
    duration: '',
  },
  {
    id: 'thirsty',
    name: 'Thirsty',
    group: 'Survival States',
    effect: '-1 physical checks',
    trigger: 'Thirst < 30',
    treatment: 'Drink water',
    duration: '',
  },
  {
    id: 'dehydrated',
    name: 'Dehydrated',
    group: 'Survival States',
    effect: '-2 all checks, 2 HP/24 ticks',
    trigger: 'Thirst < 10',
    treatment: 'Drink water',
    duration: '',
  },
  {
    id: 'exhausted',
    name: 'Exhausted',
    group: 'Survival States',
    effect: '-2 all checks, cannot run',
    trigger: 'Fatigue < 20',
    treatment: 'Rest',
    duration: '',
  },
  {
    id: 'sleep_deprived',
    name: 'Sleep Deprived',
    group: 'Survival States',
    effect: 'Hallucinations',
    trigger: 'Fatigue < 5',
    treatment: 'Long rest',
    duration: '',
  },
  {
    id: 'cold',
    name: 'Cold',
    group: 'Survival States',
    effect: '-1 Dexterity, shivering',
    trigger: 'Temperature < 5°C',
    treatment: 'Warmth',
    duration: '',
  },
  {
    id: 'frostbitten',
    name: 'Frostbitten',
    group: 'Survival States',
    effect: '-2 Dexterity, tissue damage',
    trigger: 'Prolonged cold',
    treatment: 'Warmth, care',
    duration: '',
  },
  {
    id: 'heat_stroke',
    name: 'Heat Stroke',
    group: 'Survival States',
    effect: '-2 Constitution, confusion',
    trigger: 'Prolonged heat',
    treatment: 'Shade, water',
    duration: '',
  },
  {
    id: 'frightened',
    name: 'Frightened',
    group: 'Mental & Emotional States',
    effect: '-1 attack, -1 defense',
    trigger: 'Witness violence',
    treatment: 'Safe rest',
    duration: '',
  },
  {
    id: 'panicked',
    name: 'Panicked',
    group: 'Mental & Emotional States',
    effect: 'Random actions',
    trigger: 'Severe fear',
    treatment: 'Escape danger',
    duration: '',
  },
  {
    id: 'grief_stricken',
    name: 'Grief-Stricken',
    group: 'Mental & Emotional States',
    effect: '-3 all checks, cannot work',
    trigger: 'Family died',
    treatment: 'Time, support',
    duration: '',
  },
  {
    id: 'enraged',
    name: 'Enraged',
    group: 'Mental & Emotional States',
    effect: '+2 Strength, -2 Wisdom, cannot flee',
    trigger: 'Betrayed/attacked',
    treatment: 'Calm or fight',
    duration: '',
  },
  {
    id: 'hopeful',
    name: 'Hopeful',
    group: 'Mental & Emotional States',
    effect: '+1 all checks',
    trigger: 'Good event',
    treatment: 'N/A (positive)',
    duration: '',
  },
  {
    id: 'content',
    name: 'Content',
    group: 'Mental & Emotional States',
    effect: '+1 Charisma, +1 morale',
    trigger: 'Needs met',
    treatment: 'N/A (positive)',
    duration: '',
  },
  {
    id: 'depressed',
    name: 'Depressed',
    group: 'Mental & Emotional States',
    effect: '-2 all checks, sleep more',
    trigger: 'Prolonged isolation',
    treatment: 'Social support',
    duration: '',
  },
  {
    id: 'paranoid',
    name: 'Paranoid',
    group: 'Mental & Emotional States',
    effect: '-1 Charisma, -1 Wisdom',
    trigger: 'Betrayed multiple times',
    treatment: 'Trust-building',
    duration: '',
  },
];

/**
 * Looks up a condition card by identifier.
 * @param id Condition identifier
 * @returns The matching card, or undefined
 */
export function getCondition(id: string): ConditionCard | undefined {
  return CONDITIONS.find((c) => c.id === id);
}
