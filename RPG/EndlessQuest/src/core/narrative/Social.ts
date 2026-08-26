import type { GameState } from '../state/GameState';
import type { GameEvent } from '../../events/GameEvent';
import type { MarkComponent, PositionComponent } from '../ecs/Component';
import type { Person } from '../world/People';
import { ROLE_TITLE, TRAIT_MODIFIER, matchPerson, peopleAt } from '../world/People';
import { Skill } from '../rules/Skills';
import { CheckOutcome, isAnySuccess } from '../rules/Check';
import { skillCheck, narrateCheck } from '../state/Checks';
import { markBand } from '../simulation/systems/MarkSystem';
import { advanceTime } from '../state/GameState';
import { narrate } from './Narrator';
import {
  SOCIAL_HOSTILE_AT,
  SOCIAL_FRIENDLY_AT,
  READ_DC,
  READ_HOURS,
  APPEAL_DC,
  APPEAL_HOURS,
  APPEAL_DISPOSITION,
  PRESS_DISPOSITION,
} from '../SimulationConstants';

/**
 * Social interaction, structured the way the Guide structures it.
 *
 * The Guide does not resolve a conversation on a bare Charisma roll. It starts from an
 * attitude -- friendly, indifferent, hostile -- which sets what a check has to beat, and
 * then gives the players a lever: work out what somebody holds to, appeal to it, and
 * their attitude shifts a step in your favour. That is a whole game inside talking, and
 * this had none of it: every villager was a number that went up when you ran an errand.
 *
 * So a person is now somebody with a way of dealing with people, a thing they believe, a
 * thing that holds them, and a thing they would rather you did not know. Reading them
 * costs an hour and a Wisdom check. Using what you read costs another hour and can turn
 * a door that was shut.
 */

/** Where somebody stands with the character, in the Guide's three steps. */
export enum Attitude {
  HOSTILE = 'hostile',
  INDIFFERENT = 'indifferent',
  FRIENDLY = 'friendly',
}

/** The attitudes in order, for shifting a step either way. */
export const ATTITUDE_ORDER: readonly Attitude[] = [
  Attitude.HOSTILE,
  Attitude.INDIFFERENT,
  Attitude.FRIENDLY,
];

/**
 * How somebody takes the character at present.
 *
 * Their standing opinion, moved by anything you have done for them, and by whether the
 * mark at your throat is cold or burning -- because attitude in this game is never
 * only about manners.
 *
 * @param state Current game state
 * @param person The person
 * @returns Their attitude
 */
export function attitudeOf(state: GameState, person: Person): Attitude {
  const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
  const heat = markBand(mark?.intensity ?? 0);

  // A burning mark costs you a step of goodwill in any room.
  const standing = person.disposition + TRAIT_MODIFIER[person.trait] * 4 - heat * 8;

  if (standing <= SOCIAL_HOSTILE_AT) return Attitude.HOSTILE;
  if (standing >= SOCIAL_FRIENDLY_AT) return Attitude.FRIENDLY;
  return Attitude.INDIFFERENT;
}

/**
 * Moves an attitude a step, without falling off either end.
 *
 * @param attitude Where they stood
 * @param steps How far to move them, positive for warmer
 * @returns Where they stand now
 */
export function shiftAttitude(attitude: Attitude, steps: number): Attitude {
  const index = ATTITUDE_ORDER.indexOf(attitude) + steps;
  return ATTITUDE_ORDER[Math.max(0, Math.min(ATTITUDE_ORDER.length - 1, index))];
}

/**
 * What a request has to beat, given how the person takes you.
 *
 * The Guide's Conversation Reaction table: the same favour asked of a friendly man and
 * a hostile one is not the same ask.
 *
 * @param attitude How they take you
 * @param base The difficulty of the thing being asked for
 * @returns The Difficulty Class of the check
 */
export function conversationDC(attitude: Attitude, base: number): number {
  switch (attitude) {
    case Attitude.FRIENDLY:
      return base - 5;
    case Attitude.HOSTILE:
      return base + 5;
    case Attitude.INDIFFERENT:
    default:
      return base;
  }
}

/**
 * Describes what somebody is like, for the interface and for narration.
 *
 * @param person The person
 * @param attitude How they take the character
 * @returns A short phrase
 */
export function describeAttitude(person: Person, attitude: Attitude): string {
  switch (attitude) {
    case Attitude.FRIENDLY:
      return `${person.trait}, and glad enough you came`;
    case Attitude.HOSTILE:
      return `${person.trait}, and wants you gone`;
    case Attitude.INDIFFERENT:
    default:
      return `${person.trait}, and has not decided about you`;
  }
}

/**
 * Capitalises a phrase that carries its own article, for the start of a sentence.
 */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Works out who a social action was aimed at.
 *
 * If the player named somebody, that is who they meant. If they did not, the caller's
 * own preference decides -- whoever has not been read yet, whoever has something to say
 * -- and failing that, whoever is nearest. What is no longer acceptable is choosing for
 * a player who was perfectly clear.
 *
 * @param state Current game state
 * @param who The line as typed, if the action carried one
 * @param prefer Which of the people present the caller would choose by default
 * @returns Who is being spoken to, or undefined if there is nobody here
 */
export function addressee(
  state: GameState,
  who: string | undefined,
  prefer?: (person: Person) => boolean
): Person | undefined {
  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  const here = pos ? peopleAt(state.people, pos.x, pos.y) : [];
  if (here.length === 0) return undefined;

  if (who) {
    // Apostrophes are split on rather than kept, so that "the widow's measure" is a
    // line about the widow. Keeping them made every possessive invisible to matching.
    const named = matchPerson(
      who.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean),
      here
    );
    if (named) return named;
  }

  return (prefer ? here.find(prefer) : undefined) ?? here[0];
}

/**
 * Takes the measure of whoever is here.
 *
 * A Wisdom (Insight) check against what they are hiding. Success is not a number going
 * up: it is learning what this particular person holds to, which is the thing that can
 * afterwards be appealed to.
 *
 * @param state Mutable game state
 * @returns What was read, or a failure to read it
 */
export function readPerson(state: GameState, who?: string): GameEvent[] {
  const person = addressee(state, who, (candidate) => !candidate.read);

  if (!person) {
    return [{ tick: state.tick, type: 'error', message: 'There is nobody here to read.' }];
  }

  advanceTime(state, READ_HOURS);

  if (person.read) {
    return [
      {
        tick: state.tick,
        type: 'system',
        message: `You have already taken ${person.name}'s measure: ${person.ideal}. Whether you use it is another matter.`,
        data: { person: person.id, alreadyRead: true },
      },
    ];
  }

  const attitude = attitudeOf(state, person);
  const check = skillCheck(state, Skill.INSIGHT, conversationDC(attitude, READ_DC));
  const roll = narrateCheck(Skill.INSIGHT, check);

  if (!isAnySuccess(check.outcome)) {
    const told = narrate(
      state,
      `You cannot get the measure of ${person.name}. Whatever is going on behind it, it is not coming out for you.`
    );
    return [
      {
        tick: state.tick,
        type: 'system',
        message: `${roll} — ${told.text}`,
        data: { person: person.id, read: false },
      },
    ];
  }

  person.read = true;

  const events: GameEvent[] = [
    {
      tick: state.tick,
      type: 'system',
      message:
        `${roll} — You watch ${person.name} a while, and it comes clear. They hold to ${person.ideal}. ` +
        `What holds them is ${person.bond}.`,
      data: { person: person.id, read: true },
    },
  ];

  // A clean read turns up the thing they are keeping back, which is worth more.
  if (check.outcome === CheckOutcome.CRITICAL_SUCCESS) {
    events.push({
      tick: state.tick,
      type: 'danger',
      message: `And something else, which they have taken trouble to keep: ${person.secret}.`,
      data: { person: person.id, secret: true },
    });
  }

  return events;
}

/**
 * Appeals to what somebody holds to.
 *
 * The Guide's rule, and the reason reading anybody is worth the hour: a character who
 * knows what a person cares about can put a request in those terms, and their attitude
 * shifts a step. Trying it without knowing is worse than not trying, because guessing at
 * what a frightened man believes is its own kind of insult.
 *
 * @param state Mutable game state
 * @returns What came of it
 */
export function appealTo(state: GameState, who?: string): GameEvent[] {
  const person = addressee(state, who, (candidate) => candidate.read);

  if (!person) {
    return [{ tick: state.tick, type: 'error', message: 'There is nobody here to appeal to.' }];
  }

  advanceTime(state, APPEAL_HOURS);

  if (!person.read) {
    return [
      {
        tick: state.tick,
        type: 'danger',
        message: `You try to find the thing ${person.name} cares about and guess wrong. They take it the way people take being handled. (-5)`,
        data: { person: person.id, blind: true },
      },
    ];
  }

  const attitude = attitudeOf(state, person);
  const check = skillCheck(state, Skill.PERSUASION, conversationDC(attitude, APPEAL_DC));
  const roll = narrateCheck(Skill.PERSUASION, check);

  if (!isAnySuccess(check.outcome)) {
    return [
      {
        tick: state.tick,
        type: 'system',
        message: `${roll} — You put it in the terms they care about, and it does not move them. Not today.`,
        data: { person: person.id, appealed: false },
      },
    ];
  }

  // A near miss lands, but only halfway: they heard it and are not yet moved by it.
  const grudging = check.outcome === CheckOutcome.SETBACK;
  const gained = grudging ? Math.round(APPEAL_DISPOSITION / 2) : APPEAL_DISPOSITION;
  person.disposition = Math.min(100, person.disposition + gained);
  const now = attitudeOf(state, person);

  return [
    {
      tick: state.tick,
      type: 'system',
      message:
        `${roll} — You put it in the terms of ${person.ideal}, and ${person.name} hears it` +
        `${grudging ? ', though not gladly' : ''}. ` +
        `${capitalise(ROLE_TITLE[person.role])} of ${person.place}, ${describeAttitude(person, now)}.`,
      data: { person: person.id, appealed: true, grudging, attitude: now },
    },
  ];
}

/**
 * Uses what somebody is keeping back.
 *
 * A secret was generated for every person in the world, turned up on a clean read, and
 * then did nothing whatever -- narration with no mechanism behind it, which is the thing
 * this game has spent its whole development refusing to do.
 *
 * So it is a lever, and a different one from an appeal. An appeal is slow and warms
 * somebody to you. Pressing them is fast, works on people who would otherwise never
 * help, and costs: they do as they are told and they hate you for it, and a village
 * talks. It is the option for a character who has run out of days.
 *
 * @param state Mutable game state
 * @param who Whoever was named, if anybody
 * @returns What came of it
 */
export function pressPerson(state: GameState, who?: string): GameEvent[] {
  const person = addressee(state, who, (candidate) => candidate.pressed !== true && candidate.read);

  if (!person) {
    return [{ tick: state.tick, type: 'error', message: 'There is nobody here to lean on.' }];
  }

  advanceTime(state, APPEAL_HOURS);

  if (!person.read) {
    return [
      {
        tick: state.tick,
        type: 'danger',
        message: `You imply you know something about ${person.name}, and they wait to hear what. You have nothing. It is worse than saying nothing.`,
        data: { person: person.id, bluffed: true },
      },
    ];
  }

  if (person.pressed) {
    return [
      {
        tick: state.tick,
        type: 'danger',
        message: `${person.name} has already given you what fear could buy. There is nothing left to hold over them.`,
        data: { person: person.id, spent: true },
      },
    ];
  }

  person.pressed = true;
  const before = person.disposition;

  // It works. That is the point of it, and so is what it costs.
  person.disposition = Math.max(-100, person.disposition + PRESS_DISPOSITION);
  person.owes = true;

  const told = narrate(
    state,
    `You let ${person.name} know that you know: ${person.secret}. They go very still, and then they are helpful, in the way a man is helpful to somebody standing on his neck.`
  );

  return [
    {
      tick: state.tick,
      type: 'danger',
      message: told.text,
      data: { person: person.id, pressed: true, from: before, to: person.disposition },
    },
  ];
}
