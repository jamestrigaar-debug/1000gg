import type { GameState } from '../state/GameState';
import { advanceTime, getCurrentTile } from '../state/GameState';
import type { GameEvent } from '../../events/GameEvent';
import type { MarkComponent, StatsComponent } from '../ecs/Component';
import { Skill } from '../rules/Skills';
import { CheckOutcome, DC, isAnySuccess } from '../rules/Check';
import { skillCheck, narrateCheck } from '../state/Checks';
import { markBand } from '../simulation/systems/MarkSystem';
import { revealArea } from '../state/GameState';
import { narrate } from './Narrator';
import { applyTwist } from './Twists';
import { OracleEngine } from './Oracle';
import { TERRAIN_NAME } from '../lore/Flavor';
import { clamp } from '../../utils/math';
import {
  IMPROVISE_HOURS,
  IMPROVISE_BASE_DC,
  IMPROVISE_TWIST_CHANCE,
  IMPROVISE_HARD_STEP,
  IMPROVISE_MARK_STEP,
  IMPROVISE_REVEAL_BONUS,
  IMPROVISE_MARK_RELIEF,
  MARK_MIN,
  MARK_MAX,
} from '../SimulationConstants';

/**
 * Ruling on something nobody planned for.
 *
 * This is the part of a table that software usually refuses to do. A player says "I cut
 * the rope and let the cart run at them", and the game either has a button for that or
 * tells them they cannot. A game master does neither: they decide what the attempt is
 * really asking of the character, set a number against it, roll, and then -- the part
 * that matters -- make the world different afterwards.
 *
 * So: the attempt is tested against whichever skill the interpreter read it as, at a
 * difficulty set by the circumstances the character is actually in, and the result is
 * spent on real state. Success buys ground, quiet, or footing; failure costs time and
 * calls the Oracle down on them. Nothing here is scripted to a particular phrasing,
 * which is what lets it answer anything.
 */

/**
 * How well the attempt went, in terms the rest of the game already speaks.
 */
export interface Improvisation {
  readonly events: GameEvent[];
}

/**
 * Adjudicates an attempt described in the player's own words.
 *
 * @param state Mutable game state
 * @param text What the player said they were doing
 * @param skill The skill the attempt was read as calling for
 * @param hard Whether the attempt is the sort that tends to be hard
 * @param oracle The Oracle, consulted when an attempt goes wrong
 * @returns Events describing what came of it
 */
export function improvise(
  state: GameState,
  text: string,
  skill: Skill,
  hard: boolean,
  oracle: OracleEngine,
  engaged: boolean = false
): Improvisation {
  const events: GameEvent[] = [];

  // The difficulty is the character's situation, not the sentence they typed. Trying
  // anything while the Mark is burning is harder than trying it in daylight in a village,
  // which is the whole argument of the game restated as a number.
  const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
  const band = mark ? markBand(mark.intensity) : 0;
  const dc = clamp(
    IMPROVISE_BASE_DC + (hard ? IMPROVISE_HARD_STEP : 0) + band * IMPROVISE_MARK_STEP,
    DC.EASY,
    DC.VERY_HARD
  );

  // In a fight the round is the cost; out of one, the hour is.
  if (!engaged) advanceTime(state, IMPROVISE_HOURS);

  const check = skillCheck(state, skill, dc);
  const roll = narrateCheck(skill, check);

  const setback = check.outcome === CheckOutcome.SETBACK;
  const account = isAnySuccess(check.outcome)
    ? setback
      ? `${describeSuccess(state, skill, check.outcome)} It costs you something to get it.`
      : describeSuccess(state, skill, check.outcome)
    : describeFailure(state, skill, check.outcome);

  // A success is spent on the world, not just narrated at the player.
  if (isAnySuccess(check.outcome)) {
    events.push(...spendSuccess(state, skill, check.outcome));
  }

  // A bad failure calls the Oracle down. An ordinary one usually just costs the hour:
  // a game master who punishes every miss teaches the player to stop trying things,
  // which is the exact opposite of what this is for.
  let cost: string | null = null;
  // A setback is the game's own idea of getting what you wanted at a price, so the
  // price is charged here rather than only mentioned.
  const punished =
    check.outcome === CheckOutcome.CRITICAL_FAILURE ||
    setback ||
    (!isAnySuccess(check.outcome) && state.rng.nextFloat() < IMPROVISE_TWIST_CHANCE);

  if (punished) {
    const twist = oracle.ask('twist', state.rng);
    if (twist) {
      cost = applyTwist(state, twist.entry);
      events.push({
        tick: state.tick,
        type: 'danger',
        message: `${twist.narration}${cost ? ` ${cost}` : ''}`,
        data: { twist: twist.entry.result, cost },
      });
    }
  }

  const told = narrate(state, account);

  events.unshift({
    tick: state.tick,
    type: isAnySuccess(check.outcome) ? 'system' : 'danger',
    message: `${roll} — ${told.text}`,
    data: {
      improvised: text,
      skill,
      dc,
      outcome: check.outcome,
      total: check.total,
      unreliable: told.unreliable,
    },
  });

  return { events };
}

/**
 * What a successful attempt buys, in the world rather than in the prose.
 *
 * Each skill pays out in the currency it ought to: looking about reveals ground,
 * going quietly cools the Mark, working on yourself binds a wound. These are small.
 * The point is not that improvising is strong; it is that improvising is real.
 */
function spendSuccess(state: GameState, skill: Skill, outcome: CheckOutcome): GameEvent[] {
  const events: GameEvent[] = [];
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
  const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
  const pos = state.entities.getComponent(state.playerId, 'position') as
    | { x: number; y: number }
    | undefined;

  const clean = outcome === CheckOutcome.CRITICAL_SUCCESS;

  switch (skill) {
    case Skill.PERCEPTION:
    case Skill.INVESTIGATION:
    case Skill.NATURE:
      // You learn the country.
      if (pos) {
        revealArea(state, pos.x, pos.y, IMPROVISE_REVEAL_BONUS + (clean ? 2 : 0));
      }
      break;

    case Skill.STEALTH:
    case Skill.RELIGION:
      // You are, for a while, less easy to find.
      if (mark) {
        const before = mark.intensity;
        mark.intensity = clamp(
          mark.intensity - IMPROVISE_MARK_RELIEF * (clean ? 2 : 1),
          MARK_MIN,
          MARK_MAX
        );
        if (Math.round(before) !== Math.round(mark.intensity)) {
          events.push({
            tick: state.tick,
            type: 'system',
            message: `The weal cools a little. (mark ${Math.round(before)} → ${Math.round(mark.intensity)})`,
            data: { mark: mark.intensity },
          });
        }
      }
      break;

    case Skill.MEDICINE:
      // You put yourself back together, a little.
      if (stats && stats.hp < stats.maxHp) {
        const healed = Math.min(stats.maxHp - stats.hp, clean ? 6 : 3);
        stats.hp += healed;
        events.push({
          tick: state.tick,
          type: 'system',
          message: `You see to yourself as best you can. (+${healed} hp)`,
          data: { healed },
        });
      }
      break;

    case Skill.DECEPTION:
    case Skill.INTIMIDATION:
    case Skill.PERSUASION:
      // Talking your way through something leaves you better placed for the next thing.
      state.advantageNextAttack = true;
      break;

    default:
      break;
  }

  return events;
}

/**
 * Narration for an attempt that came off, in terms of what was actually gained.
 */
function describeSuccess(state: GameState, skill: Skill, outcome: CheckOutcome): string {
  const tile = getCurrentTile(state);
  const where = tile ? TERRAIN_NAME[tile.terrain] : 'the open';
  const clean = outcome === CheckOutcome.CRITICAL_SUCCESS;

  const lines: Partial<Record<Skill, string>> = {
    [Skill.ATHLETICS]: `You get it done with your back and your hands, in ${where}.`,
    [Skill.ACROBATICS]: 'You are quicker than you had any right to be.',
    [Skill.STEALTH]: 'You go quiet, and stay quiet, and the country lets you.',
    [Skill.SLEIGHT_OF_HAND]: 'Nobody sees your hands do it.',
    [Skill.INVESTIGATION]: `You work over ${where} properly, and it gives something up.`,
    [Skill.NATURE]: 'You know this ground. That knowledge is worth something today.',
    [Skill.RELIGION]: 'The old words still fit in your mouth. Something slackens.',
    [Skill.MEDICINE]: 'You do what can be done with what you have.',
    [Skill.PERCEPTION]: `You stop, and look, and ${where} resolves into detail.`,
    [Skill.SURVIVAL]: 'You make the country give you what you need.',
    [Skill.INSIGHT]: 'You read it right. You are fairly sure you read it right.',
    [Skill.ANIMAL_HANDLING]: 'It settles. Whatever it is, it settles.',
    [Skill.DECEPTION]: 'It goes down whole, and nobody asks the second question.',
    [Skill.INTIMIDATION]: 'You are, for a moment, the worst thing in the field.',
    [Skill.PERSUASION]: 'You say it the right way round, and it lands.',
  };

  const line = lines[skill] ?? 'It works.';
  return clean ? `${line} Better than you meant, even.` : line;
}

/**
 * Narration for an attempt that did not come off.
 *
 * Failure is written as the particular way this particular attempt fell down, because
 * "you fail" repeated forty times is what makes a game feel like a spreadsheet.
 */
function describeFailure(state: GameState, skill: Skill, outcome: CheckOutcome): string {
  const badly = outcome === CheckOutcome.CRITICAL_FAILURE;

  const lines: Partial<Record<Skill, readonly string[]>> = {
    [Skill.ATHLETICS]: [
      'Your arms give out halfway and you come down harder than you went up.',
      'It does not shift. You put your whole back into it and it does not shift.',
    ],
    [Skill.ACROBATICS]: [
      'You are slower than you were a month ago. You notice exactly how much slower.',
      'Your foot goes where you did not put it.',
    ],
    [Skill.STEALTH]: [
      'You are a big man in a quiet country and both facts announce themselves.',
      'Something under your boot gives with a crack.',
    ],
    [Skill.SLEIGHT_OF_HAND]: ['Your hands are not what they were before the rope.'],
    [Skill.INVESTIGATION]: [
      'You go over it twice and learn nothing you did not bring with you.',
      'Whatever is here, it is not showing itself to you.',
    ],
    [Skill.NATURE]: ['You do not know this country as well as you told yourself you did.'],
    [Skill.RELIGION]: [
      'The words come out and go nowhere. They have been going nowhere for some time.',
      'You kneel. Nothing kneels back.',
    ],
    [Skill.MEDICINE]: [
      'You make it worse before you make it better, and then you only make it worse.',
      'The dressing will not hold. Your hands are shaking too much to make it hold.',
    ],
    [Skill.PERCEPTION]: [
      'You look until your eyes water and the country keeps its own counsel.',
      'There is too much noise in your own head to hear past it.',
    ],
    [Skill.SURVIVAL]: ['The country does not owe you anything, and pays accordingly.'],
    [Skill.INSIGHT]: ['You cannot tell. You have not been able to tell for a long time.'],
    [Skill.ANIMAL_HANDLING]: ['It wants nothing to do with you. They can smell the mark.'],
    [Skill.DECEPTION]: ['It comes out wrong, and you hear it coming out wrong.'],
    [Skill.INTIMIDATION]: ['You are not as frightening as what they have already seen.'],
    [Skill.PERSUASION]: ['You say it badly. There was probably no good way to say it.'],
  };

  const pool = lines[skill] ?? ['It does not come off.'];
  const line = pool[state.rng.nextInt(0, pool.length - 1)];

  return badly ? `${line} And it costs you.` : line;
}
