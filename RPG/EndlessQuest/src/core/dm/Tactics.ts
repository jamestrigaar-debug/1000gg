import type { RNG } from '../rng/SeededRNG';
import { Ability } from '../rules/Abilities';
import { Skill } from '../rules/Skills';

/**
 * How a character fights, rather than whether they hit.
 *
 * A stress run of forty worlds issued two thousand four hundred attacks and four hundred
 * of everything else: the whole of a fight was one button pressed until something fell
 * over. That is not a fight, it is a progress bar with dice in it.
 *
 * A blow is now a decision with three parts -- where you aim, how hard you commit, and
 * what you are willing to leave open -- and each of them trades something for something
 * else. None of it is a new resource to manage. It is the same swing, aimed.
 */

/** Where the blow is going. */
export enum Aim {
  /** At the middle of them, which is the easiest thing to hit */
  BODY = 'body',
  /** At the head: harder, and it ends things */
  HEAD = 'head',
  /** At the arms: harder, and it takes the fight out of them */
  ARMS = 'arms',
  /** At the legs: harder, and they stop being able to leave or close */
  LEGS = 'legs',
}

/** How much of yourself you are putting into it. */
export enum Commit {
  /** Measured: less behind it, and you keep your guard */
  GUARDED = 'guarded',
  /** Ordinary */
  EVEN = 'even',
  /** Everything: more behind it, and you are wide open after */
  RECKLESS = 'reckless',
}

/** What aiming somewhere costs and buys. */
export interface AimProfile {
  readonly id: Aim;
  readonly name: string;
  /** Added to the attack roll */
  readonly toHit: number;
  /** Multiplier on damage */
  readonly damage: number;
  /** What a solid hit here does to them, beyond the damage */
  readonly effect: string;
  /** How it reads when it lands */
  readonly landed: string;
}

/** The four places worth aiming at. */
export const AIMS: Readonly<Record<Aim, AimProfile>> = {
  [Aim.BODY]: {
    id: Aim.BODY,
    name: 'the body',
    toHit: 0,
    damage: 1,
    effect: '',
    landed: 'You put it into the middle of them.',
  },
  [Aim.HEAD]: {
    id: Aim.HEAD,
    name: 'the head',
    toHit: -4,
    damage: 1.75,
    effect: 'dazed',
    landed: 'You go high, and it connects with something that matters.',
  },
  [Aim.ARMS]: {
    id: Aim.ARMS,
    name: 'the arms',
    toHit: -2,
    damage: 0.7,
    effect: 'disarmed',
    landed: 'You take the arm rather than the man, and the arm stops working properly.',
  },
  [Aim.LEGS]: {
    id: Aim.LEGS,
    name: 'the legs',
    toHit: -2,
    damage: 0.7,
    effect: 'hobbled',
    landed: 'You go low. Whatever it does next, it does slower.',
  },
};

/** What committing costs and buys. */
export const COMMITS: Readonly<Record<Commit, { readonly toHit: number; readonly damage: number; readonly exposes: number; readonly name: string }>> = {
  [Commit.GUARDED]: { toHit: -1, damage: 0.7, exposes: -2, name: 'guarded' },
  [Commit.EVEN]: { toHit: 0, damage: 1, exposes: 0, name: 'even' },
  [Commit.RECKLESS]: { toHit: 2, damage: 1.4, exposes: 3, name: 'reckless' },
};

/**
 * What each calling can do that the others cannot.
 *
 * One apiece, on purpose. A list of twelve abilities nobody remembers is worse than one
 * thing that is yours, and each of these is the calling's whole argument for existing
 * said as a verb.
 */
export interface Knack {
  readonly id: string;
  readonly originId: string;
  readonly name: string;
  /** What the player types */
  readonly verbs: readonly string[];
  /** What it is for, in one line */
  readonly summary: string;
  /** What it is rolled as */
  readonly skill: Skill;
  /** What it leans on */
  readonly ability: Ability;
  /** How many hours before it can be used again */
  readonly cooldown: number;
}

/** The three knacks, one for each way through the game. */
export const KNACKS: readonly Knack[] = [
  {
    id: 'break_them',
    originId: 'free_company',
    name: 'Break them',
    verbs: ['break', 'batter', 'bull'],
    summary: 'put everything into one blow and take what it costs',
    skill: Skill.ATHLETICS,
    ability: Ability.STR,
    cooldown: 6,
  },
  {
    id: 'slip_away',
    originId: 'poacher',
    name: 'Slip away',
    verbs: ['slip', 'vanish', 'melt'],
    summary: 'break contact and be somewhere else entirely',
    skill: Skill.STEALTH,
    ability: Ability.DEX,
    cooldown: 8,
  },
  {
    id: 'talk_them_down',
    originId: 'penitent',
    name: 'Talk them down',
    verbs: ['reason', 'plead', 'parley'],
    summary: 'give something that is not sure of this a reason to stop',
    skill: Skill.PERSUASION,
    ability: Ability.CHA,
    cooldown: 10,
  },
];

/**
 * The knack belonging to an origin, if it has one.
 * @param originId Which origin
 * @returns Their knack
 */
export function knackFor(originId: string | undefined): Knack | undefined {
  return KNACKS.find((knack) => knack.originId === originId);
}

/**
 * Reads a line for where the character is aiming and how hard.
 *
 * The plain "strike" is body and even, so nobody has to learn any of this to play. What
 * it buys the player who does say it is the difference between a fight and a button.
 *
 * @param words The tokenised line
 * @returns What they meant by it
 */
export function readIntent(words: readonly string[]): { aim: Aim; commit: Commit } {
  let aim = Aim.BODY;
  let commit = Commit.EVEN;

  for (const word of words) {
    if (['head', 'skull', 'face', 'throat', 'neck'].includes(word)) aim = Aim.HEAD;
    else if (['arm', 'arms', 'hand', 'hands', 'wrist'].includes(word)) aim = Aim.ARMS;
    else if (['leg', 'legs', 'knee', 'knees', 'foot', 'feet'].includes(word)) aim = Aim.LEGS;

    if (['careful', 'carefully', 'guarded', 'cautious', 'measured'].includes(word)) {
      commit = Commit.GUARDED;
    } else if (
      ['everything', 'hard', 'reckless', 'wild', 'all', 'wildly'].includes(word)
    ) {
      commit = Commit.RECKLESS;
    }
  }

  return { aim, commit };
}

/**
 * Picks a way of putting a blow, for narration that does not repeat.
 * @param profile Where it went
 * @param rng Seeded generator
 * @returns The line
 */
export function describeAim(profile: AimProfile, rng: RNG): string {
  return rng.nextFloat() < 0.5 ? profile.landed : `You aim for ${profile.name}, and find it.`;
}
