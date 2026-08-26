import type { GameState } from '../state/GameState';
import type { MarkComponent, StatsComponent } from '../ecs/Component';
import { markBand } from '../simulation/systems/MarkSystem';
import { drawWithoutRepeat } from '../lore/Sampler';
import type { CharacterBackground } from './Background';
import {
  NARRATOR_INTRUSION_CHANCE,
  NARRATOR_LIE_BAND,
  NARRATOR_LIE_CHANCE,
  NARRATOR_LIE_COOLDOWN_HOURS,
  NARRATOR_PERSONAL_CHANCE,
} from '../SimulationConstants';

/**
 * The narrator.
 *
 * Something was owed at the tree and it was not collected, and it has not stopped
 * looking. That is the premise of the setting, and it is also, from this file onward,
 * the premise of the prose: the account of the run is not written by a neutral observer.
 * It is written by the thing watching, and the hotter the Gallowsmark burns the less it
 * bothers to pretend otherwise.
 *
 * The voice moves through five registers, keyed to the Mark's own bands, so the player
 * learns to read the narration itself as an instrument:
 *
 *   Cold     - it says nothing. The account is plain and can be trusted.
 *   Warm     - it interjects, briefly, and stays broadly factual.
 *   Hot      - it editorialises. It knows things about the character it should not.
 *   Burning  - it contradicts itself inside a single sentence.
 *   Open     - it lies.
 *
 * ONE RULE holds the whole device together, and every caller depends on it: the
 * narrator may lie in prose, but never in mechanics. Dice readouts, damage figures,
 * costs, meter changes and the status bar are always true. A lie is always available to
 * be caught by a player who is reading the numbers, and lies are flagged in event data
 * so the interface can, if it ever wants to, show the player afterwards which lines were
 * spoken by something that wanted them dead.
 */

/**
 * Where the tick of the last fabrication is kept.
 *
 * It rides along in the narration memory the state already carries and saves, so the
 * cooldown survives a reload like everything else the narrator remembers.
 */
const LIE_TICK_KEY = 'narrator:lastLie';

/** The register the narrator is currently speaking in. */
export enum Register {
  COLD = 0,
  WARM = 1,
  HOT = 2,
  BURNING = 3,
  OPEN = 4,
}

/**
 * What the narrator did to a line.
 */
export interface Narration {
  /** The text to show the player */
  readonly text: string;
  /** The register it was spoken in */
  readonly register: Register;
  /** True when the narrator's account is not what happened */
  readonly unreliable: boolean;
}

/**
 * Asides, by register. The narrator's own words, appended to the account.
 *
 * These climb from something that could be the character's own unease to something that
 * is plainly not, which is the whole arc of the device.
 */
const INTRUSIONS: Record<Register, readonly string[]> = {
  [Register.COLD]: [],
  [Register.WARM]: [
    'The weal itches.',
    'Something keeps the distance it has been keeping.',
    'You do not look behind you. Good.',
    'The count is still running.',
    'It is a long way yet.',
    'You have been counting the days. It has been counting them too.',
    'Nothing out here is looking for you yet. Yet is doing a lot of work in that sentence.',
    'You keep touching the weal. You have not noticed that you do it.',
    'Somewhere behind you a dog has started barking and has not stopped.',
  ],
  [Register.HOT]: [
    'You did this on the third day too. It did not help then.',
    'It is patient in a way you have not earned.',
    'They will not take you in. You know why.',
    'The rope was not the sentence. The rope was the paperwork.',
    'You are being spent, a day at a time, and you can feel the rate.',
    'Somebody is keeping an account of this. Not you.',
    'You are thinner than you were at the tree. It has been measuring.',
    'Every road out of here goes back to it. You have not tested that. It has.',
    'You sleep badly and wake owing more than you did.',
    'It could have taken you on the first night. Ask yourself why it did not.',
    'You are good at this. That is the part it likes.',
  ],
  [Register.BURNING]: [
    'You are alone out here. (You are not alone out here.)',
    'Nothing happened. Nothing is happening. Nothing will have happened.',
    'That was not the sound you heard. You heard your own name.',
    'It is behind you. It is ahead of you. It is the same thing and it is waiting.',
    'You should sit down. You have been walking since they cut you loose and you should sit down.',
    'The debt does not compound. It simply never stops.',
    'Your hands are steady. Your hands are not steady. Both of these are true.',
    'Turn around. Do not turn around.',
    'The country ahead of you is the country behind you. You have walked this stretch four times.',
    'You have been talking out loud for the last hour. Some of it was not you.',
    'There is a word for what you are now and you will not like learning it.',
  ],
  [Register.OPEN]: [
    'Come back to the tree. It is the only honest thing left in the Thornmarch.',
    'There is no south. There is only the walk, and the walk goes one way.',
    'Say the name you were hanged under. Say it. It is the only word that still works.',
    'Everyone you have met on this road has been the same person.',
    'You were not cut down. You are still up there. This is what it looks like from up there.',
    'There is no debt. There never was. Keep walking and see what happens.',
    'The tree has been moving. It is closer than the weal is telling you.',
    'Your daughter is not south. There is no south. We have discussed this.',
    'Lie down. It will be over in an hour and nothing after that will hurt.',
    'Everything you have eaten since the tree, it gave you.',
    'They are all still hanging. You are the only one who came down and that was the mistake.',
  ],
};

/**
 * Asides built from this particular character.
 *
 * Generic dread is atmosphere; dread that knows your name is a narrator. Each of these
 * takes a line the player wrote into their character at embark -- what they were hanged
 * for, what they mean to do, who they left behind -- and hands it back to them. The
 * thing watching has been watching since the tree, and it has been listening.
 */
const PERSONAL: readonly ((background: CharacterBackground) => string)[] = [
  (b) => `"${b.origin.line}" It has heard you say it. It did not believe you either.`,
  (b) => `"${b.goal.line}" Say it again. It sounds thinner every time.`,
  (b) => `"${b.bond.line}" That is the part it will use, when it comes to it.`,
  () => 'It knows what you were hanged for. It was there. It is the only one who was.',
  (b) => `${b.flaw.name}. It has been counting on that.`,
];

/**
 * Substitutions the narrator makes when it has stopped reporting and started lying.
 *
 * Each is a plausible account of a moment that did not occur. They are deliberately
 * mundane -- a lie that announces itself is not a lie -- and they never contradict a
 * number, only the prose around it.
 */
const FABRICATIONS: readonly string[] = [
  'Nothing comes of it. The hour passes and the country is exactly as it was.',
  'You find the road again, and for a while it is easy going.',
  'It is quiet. It has been quiet for days now, and you are starting to trust it.',
  'Whatever it was has gone off in the other direction. You are sure of that.',
  'You are making better time than you thought. Another day, perhaps two.',
  'You have not been followed once since the tree. Not once.',
  'The water here is clean. Drink it.',
  'That was days ago now. You are past it.',
  'Nobody saw you. Nobody is looking.',
  'There is nothing behind you. You have checked, and there is nothing behind you.',
];

/**
 * The register the narrator is speaking in, for a state.
 *
 * Wounds count as well as the Mark: a character bleeding out hears the thing at their
 * shoulder more clearly, which is the oldest trick in the genre and still works.
 *
 * @param state Current game state
 * @returns The current register
 */
export function registerFor(state: GameState): Register {
  const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');

  let level = mark ? markBand(mark.intensity) : 0;

  // Being badly hurt lends it one more register than the Mark alone would allow.
  if (stats && stats.maxHp > 0 && stats.hp / stats.maxHp <= 0.25) level += 1;

  return Math.max(Register.COLD, Math.min(Register.OPEN, level)) as Register;
}

/**
 * Puts an account of something through the narrator.
 *
 * Callers hand in what actually happened. What comes back is what the player is told,
 * which at low registers is the same thing and at high registers is not.
 *
 * @param state Current game state
 * @param account What happened, plainly stated
 * @param options.mechanical A readout that must survive intact -- dice, costs, figures
 * @param options.allowLies Whether this line may be fabricated outright; false for
 *   anything the player could not otherwise verify, so lies stay catchable
 * @returns The narration to show
 */
export function narrate(
  state: GameState,
  account: string,
  options: { mechanical?: string; allowLies?: boolean } = {}
): Narration {
  const register = registerFor(state);
  const mechanical = options.mechanical ?? '';

  if (register === Register.COLD) {
    return { text: join(account, mechanical), register, unreliable: false };
  }

  // At the top of the ladder the account itself may be replaced. The mechanical readout
  // is appended afterwards regardless, so the lie is always contradicted by the numbers
  // sitting next to it.
  // Lies need room around them. Three in a row is not an unreliable narrator, it is a
  // broken one: the player stops reading the prose at all, and the device dies.
  const lastLie = Number(state.lastDraw[LIE_TICK_KEY] ?? Number.NEGATIVE_INFINITY);
  const rested = state.tick - lastLie >= NARRATOR_LIE_COOLDOWN_HOURS;

  const lying =
    options.allowLies !== false &&
    register >= NARRATOR_LIE_BAND &&
    rested &&
    state.rng.nextFloat() < NARRATOR_LIE_CHANCE;

  if (lying) {
    const lie = drawWithoutRepeat(
      FABRICATIONS,
      state.rng,
      state.lastDraw,
      'narrator:lie',
      (line) => line
    );
    state.lastDraw[LIE_TICK_KEY] = String(state.tick);
    return { text: join(lie, mechanical), register, unreliable: true };
  }

  const intrusions = INTRUSIONS[register];
  const speaks =
    intrusions.length > 0 && state.rng.nextFloat() < NARRATOR_INTRUSION_CHANCE[register];

  if (!speaks) {
    return { text: join(account, mechanical), register, unreliable: false };
  }

  // Once it is talkative it starts using what it knows about this particular character.
  const personal =
    register >= Register.HOT &&
    state.background !== null &&
    state.rng.nextFloat() < NARRATOR_PERSONAL_CHANCE;

  const aside = personal
    ? drawWithoutRepeat(
        PERSONAL,
        state.rng,
        state.lastDraw,
        'narrator:personal',
        (make) => make(state.background as CharacterBackground)
      )(state.background as CharacterBackground)
    : drawWithoutRepeat(
        intrusions,
        state.rng,
        state.lastDraw,
        `narrator:${register}`,
        (line) => line
      );

  return { text: `${join(account, mechanical)} ${aside}`, register, unreliable: false };
}

/**
 * Joins an account to its mechanical readout, tolerating either being absent.
 */
function join(account: string, mechanical: string): string {
  if (!mechanical) return account.trim();
  if (!account) return mechanical.trim();
  return `${account.trim()} ${mechanical.trim()}`;
}

/**
 * Names the register, for the interface and for tests.
 * @param register The register
 * @returns A short label
 */
export function registerLabel(register: Register): string {
  return ['Silent', 'Watchful', 'Talkative', 'Contradictory', 'Lying'][register];
}
