import type { RNG } from '../rng/SeededRNG';
import { Temper } from './Instance';
import { Tide } from './Blackboard';

/**
 * The Dungeon Master's voice.
 *
 * A grammar rather than a list. The DM has a great many blows to narrate and a list of
 * fixed lines runs out within one fight -- the earlier build said "waits for you to be
 * committed, and then takes the opening" four times in the same room, which stops being
 * characterisation and starts being a stuck record.
 *
 * So the line is built: a way of moving, a way of striking, and what it costs, each
 * drawn from what the thing is like and how the fight is going, with nothing repeating
 * back to back. Same handful of words, a great many sentences.
 */

/** One production of the grammar. */
type Rule = readonly string[];

/** How each temper moves, before it does anything. */
const APPROACH: Record<Temper, Rule> = {
  [Temper.SAVAGE]: [
    'It is on you before the thought finishes',
    'It comes straight in, without any of the preliminaries',
    'It does not circle. It never circles',
  ],
  [Temper.CAUTIOUS]: [
    'It gives ground, and then it does not',
    'It waits for you to be committed',
    'It lets you come, and moves at the last',
  ],
  [Temper.DISCIPLINED]: [
    'It steps in on the line, the way it was taught',
    'It keeps its feet under it and works forward',
    'It closes without hurry, watching your hands',
  ],
  [Temper.PROUD]: [
    'It comes on as though this were a formality',
    'It takes its time, which is its own kind of insult',
    'It does not trouble to feint',
  ],
};

/** What the blow is like. */
const BLOW: Rule = [
  'and the blow lands somewhere you were not guarding',
  'and it gets under your arm',
  'and it takes you across the ribs',
  'and something in the shoulder gives',
  'and it catches you turning',
  'and you feel it through the padding',
];

/** What a miss is like. */
const MISS: Rule = [
  'and finds nothing but the air you left',
  'and you are already elsewhere',
  'and it goes wide enough that it knows it',
  'and the swing carries it past you',
];

/** What the fight looks like from outside, keyed to how it is going. */
const WEATHER: Record<Tide, Rule> = {
  [Tide.WINNING]: [
    'It is beginning to think about the door.',
    'You have the measure of this now.',
  ],
  [Tide.EVEN]: ['Neither of you has anything to spare.', 'This is going to take a while.'],
  [Tide.LOSING]: [
    'You are giving ground you do not have.',
    'Something is going to have to change.',
  ],
  [Tide.DESPERATE]: [
    'You are not going to take many more of these.',
    'Everything has gone very simple and very loud.',
  ],
};

/**
 * Draws from a rule without repeating the last thing it said.
 *
 * @param rule The productions
 * @param rng Seeded generator
 * @param last What was said last time, if anything
 * @returns One production
 */
function draw(rule: Rule, rng: RNG, last?: string): string {
  if (rule.length === 1) return rule[0];

  for (let attempt = 0; attempt < 6; attempt++) {
    const pick = rule[rng.nextInt(0, rule.length - 1)];
    if (pick !== last) return pick;
  }
  return rule[rng.nextInt(0, rule.length - 1)];
}

/** How the character's own blow goes wrong. */
const OWN_MISS: Rule = [
  'You swing and it is not there.',
  'It reads the blow before you have finished it.',
  'You commit and find only the space it was standing in.',
  'The swing goes where it was, which is not where it is.',
  'You are half a beat behind it, and half a beat is all of it.',
];

/** How the character's own blow lands, when they were not aiming anywhere in particular. */
const OWN_HIT: Rule = [
  'You put it in, and it tells.',
  'It gets through, and something in it changes its mind about coming forward.',
  'You find the gap and put everything you have through it.',
  'The blow goes home and stays there a moment.',
];

/**
 * The voice, kept between calls so that it does not repeat itself.
 */
export class Voice {
  private lastApproach: string | undefined;
  private lastBlow: string | undefined;
  private lastWeather: string | undefined;
  private lastOwn: string | undefined;

  /**
   * Narrates one thing's attack.
   *
   * @param name What it is called
   * @param temper What it is like
   * @param hit Whether the blow landed
   * @param damage What it cost, when it landed
   * @param rng Seeded generator
   * @returns The line
   */
  attack(name: string, temper: Temper, hit: boolean, damage: number, rng: RNG): string {
    const approach = draw(APPROACH[temper], rng, this.lastApproach);
    this.lastApproach = approach;

    const outcome = hit
      ? draw(BLOW, rng, this.lastBlow)
      : draw(MISS, rng, this.lastBlow);
    this.lastBlow = outcome;

    const cost = hit ? ` (−${damage})` : '';
    return `${approach.replace(/^It\b/, name)}, ${outcome}.${cost}`;
  }

  /**
   * The character's own blow.
   *
   * The enemy's swings have been varied since the grammar went in and the character's
   * had not, so a fight read as one side improvising and the other saying "you swing and
   * it is not there" five times running.
   *
   * @param hit Whether it landed
   * @param rng Seeded generator
   * @returns The line
   */
  own(hit: boolean, rng: RNG): string {
    const line = draw(hit ? OWN_HIT : OWN_MISS, rng, this.lastOwn);
    this.lastOwn = line;
    return line;
  }

  /**
   * A line about how the fight is going, used sparingly.
   *
   * @param tide Which way it is running
   * @param rng Seeded generator
   * @returns The line
   */
  weather(tide: Tide, rng: RNG): string {
    const line = draw(WEATHER[tide], rng, this.lastWeather);
    this.lastWeather = line;
    return line;
  }
}
