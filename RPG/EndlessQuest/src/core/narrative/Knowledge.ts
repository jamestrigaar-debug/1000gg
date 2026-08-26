import type { GameState } from '../state/GameState';
import type { GameEvent } from '../../events/GameEvent';
import type { MarkComponent, PositionComponent } from '../ecs/Component';
import type { Person } from '../world/People';
import { Role, ROLE_TITLE, TRAIT_MODIFIER, peopleAt } from '../world/People';
import { Skill } from '../rules/Skills';
import { CheckOutcome, RollMode, isAnySuccess } from '../rules/Check';
import { skillCheck, narrateCheck } from '../state/Checks';
import { bearingTo, describeDistance } from '../world/Reckoning';
import { advanceTime, revealArea } from '../state/GameState';
import { markBand } from '../simulation/systems/MarkSystem';
import { addressee, attitudeOf, conversationDC } from './Social';
import { errandOf } from './Errands';
import { narrate } from './Narrator';
import {
  WORLD_NAME,
  ERA_NAME,
  MARK_NAME,
  CHURCH_NAME,
  INQUISITION_NAME,
  APOSTLE_NAME,
  CHOIR_NAME,
} from '../lore/Lore';
import {
  ASK_HOURS,
  ASK_BASE_DC,
  ASK_REVEAL_RADIUS,
} from '../SimulationConstants';

/**
 * What people know, and what it takes to get it out of them.
 *
 * Talking was worth doing only when somebody wanted something. Ask a villager about the
 * road south, or about the tree, and the game rolled Persuasion and told you that you
 * had said it the right way round -- and then said nothing, because there was nothing
 * behind the roll. A question that returns no information is worse than a refusal: the
 * player learns that asking is decoration and stops.
 *
 * So people know things. Not everything, and not the same things: a priest knows about
 * the rites and the Church, a reeve knows the roads and what is out on them, a drover
 * knows where the other villages are, and everybody knows something about the mark on
 * your throat because everybody has been looking at it since you walked in.
 *
 * Answers that are about places are not merely narrated -- they are put on the chart,
 * because a direction you cannot find again is not knowledge.
 */

/** Something that can be asked about. */
export enum Topic {
  /** The gallows-tree, and the debt owed at it */
  TREE = 'tree',
  /** The vigils, and where a rite might be kept */
  RITES = 'rites',
  /** Other settlements, and the roads between them */
  ROADS = 'roads',
  /** What is out in the country, and what it has been doing */
  THREATS = 'threats',
  /** The mark on the character's throat */
  MARK = 'mark',
  /** The Church, its Chain, and what they want */
  CHURCH = 'church',
  /** The Sated, the Choir, and the bargain */
  CHOIR = 'choir',
  /** The person being asked, and what ails this place */
  THEM = 'them',
}

/** Words that name each topic. */
const TOPIC_WORDS: Record<Topic, readonly string[]> = {
  [Topic.TREE]: ['tree', 'gallows', 'gallowstree', 'debt', 'rope', 'hanging', 'reckoning'],
  [Topic.RITES]: ['rite', 'rites', 'vigil', 'vigils', 'shrine', 'stones', 'ossuary', 'chapel'],
  [Topic.ROADS]: ['road', 'roads', 'village', 'villages', 'town', 'settlement', 'way',
    'south', 'north', 'east', 'west', 'travel', 'places'],
  [Topic.THREATS]: ['danger', 'dangers', 'threat', 'threats', 'beast', 'beasts', 'dead',
    'wolves', 'night', 'country', 'safe', 'trouble'],
  [Topic.MARK]: ['mark', 'weal', 'throat', 'gallowsmark', 'brand', 'scar'],
  [Topic.CHURCH]: ['church', 'chain', 'priest', 'priests', 'inquisition', 'wound', 'faith'],
  [Topic.CHOIR]: ['choir', 'sated', 'coin', 'bargain', 'widow'],
  [Topic.THEM]: ['you', 'yourself', 'here', 'wrong', 'need', 'family', 'name', 'village',
    'trouble', 'happened'],
};

/**
 * Who is worth asking about what.
 *
 * Everybody will venture something, but somebody whose trade is the answer knows it
 * properly, and that is the difference between a bearing and a shrug.
 */
const AUTHORITY: Record<Topic, readonly Role[]> = {
  [Topic.TREE]: [Role.PRIEST, Role.WIDOW],
  [Topic.RITES]: [Role.PRIEST, Role.WIDOW],
  [Topic.ROADS]: [Role.DROVER, Role.REEVE],
  [Topic.THREATS]: [Role.REEVE, Role.DROVER],
  [Topic.MARK]: [Role.PRIEST, Role.MIDWIFE],
  [Topic.CHURCH]: [Role.PRIEST],
  [Topic.CHOIR]: [Role.PRIEST, Role.BEGGAR],
  [Topic.THEM]: [],
};

/**
 * Reads which topic a line is asking about.
 *
 * @param text What the player typed
 * @returns The topic, or null if the question is not about anything the world holds
 */
export function readTopic(text: string): Topic | null {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // The most specific topics are checked first, so "ask about the tree" is about the
  // tree rather than about the road that leads to it.
  const order: Topic[] = [
    Topic.TREE,
    Topic.RITES,
    Topic.MARK,
    Topic.CHOIR,
    Topic.CHURCH,
    Topic.THREATS,
    Topic.ROADS,
    Topic.THEM,
  ];

  for (const topic of order) {
    if (TOPIC_WORDS[topic].some((word) => words.includes(word))) return topic;
  }
  return null;
}

/**
 * Puts a question to whoever is here.
 *
 * @param state Mutable game state
 * @param text What the player asked
 * @returns The answer, or a refusal
 */
export function ask(state: GameState, text: string): GameEvent[] {
  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  const here = pos ? peopleAt(state.people, pos.x, pos.y) : [];

  if (here.length === 0) {
    return [
      {
        tick: state.tick,
        type: 'error',
        message: 'There is nobody here to ask. You have only your own account of things.',
      },
    ];
  }

  const topic = readTopic(text);
  if (topic === null) {
    return [
      {
        tick: state.tick,
        type: 'error',
        message:
          'They cannot make out what you are asking. Try the tree, the rites, the roads, the country, the mark, the Church, or what ails this place.',
      },
    ];
  }

  advanceTime(state, ASK_HOURS);

  // Whoever the player named; failing that, whoever's trade the answer is.
  const speaker =
    addressee(state, text, (person) => AUTHORITY[topic].includes(person.role)) ?? here[0];
  speaker.met = true;

  // One social system, not two. What an answer costs is what the Guide says any request
  // costs: a difficulty set by how this person takes you, adjusted by their temperament.
  // An earlier version of this file ran its own formula alongside the attitude system
  // and ignored it, which meant a friendly reeve and a suspicious one were equally hard
  // to get a straight answer out of.
  const attitude = attitudeOf(state, speaker);
  const dc = conversationDC(attitude, ASK_BASE_DC) - TRAIT_MODIFIER[speaker.trait];

  // Somebody who owes you their silence does not refuse you.
  const check = skillCheck(
    state,
    Skill.PERSUASION,
    dc,
    speaker.owes ? [RollMode.ADVANTAGE] : []
  );
  const roll = narrateCheck(Skill.PERSUASION, check);
  const events: GameEvent[] = [];

  if (!isAnySuccess(check.outcome)) {
    const told = narrate(state, refusal(speaker, topic));
    events.push({
      tick: state.tick,
      type: 'system',
      message: `${roll} — ${told.text}`,
      data: { topic, person: speaker.id, answered: false },
    });
    return events;
  }

  const answer = answerFor(state, speaker, topic, check.outcome === CheckOutcome.CRITICAL_SUCCESS);

  // People answer in their own manner. Giving everybody a way of speaking and then using
  // it only when they say hello was most of the way to not having given them one.
  const told = narrate(
    state,
    `${speaker.name}, speaking ${speaker.mannerism}: ${answer.text}`
  );

  events.push({
    tick: state.tick,
    type: 'system',
    message: `${roll} — ${told.text}`,
    data: { topic, person: speaker.id, answered: true },
  });
  events.push(...answer.events);

  return events;
}

/**
 * Capitalises a name that carries its own article, for use at the start of a sentence.
 *
 * The world's proper nouns are written as they are spoken -- "the Church of the Sealed
 * Wound" -- which reads wrong the moment one of them opens a line of dialogue.
 *
 * @param name A proper noun from the lore
 * @returns The same name, fit to begin a sentence
 */
function opening(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * What somebody says when they will not answer.
 */
function refusal(speaker: Person, topic: Topic): string {
  const lines: Record<Topic, string> = {
    [Topic.TREE]: 'They look at your throat and then at the door, and do not answer.',
    [Topic.RITES]: 'That is not spoken of to strangers, and you are still a stranger.',
    [Topic.ROADS]: 'They say the roads are the roads, and go back to what they were doing.',
    [Topic.THREATS]: 'A shrug. Everybody knows, and nobody wants to be the one who said it.',
    [Topic.MARK]: 'They will not look at it, and they will not talk about it.',
    [Topic.CHURCH]: 'The Chain has ears in every parish. They have just remembered that.',
    [Topic.CHOIR]: 'They make a sign against it and turn away.',
    [Topic.THEM]: 'Whatever is wrong here, it is not yours to be told.',
  };
  return `${speaker.name}, ${ROLE_TITLE[speaker.role]}: ${lines[topic]}`;
}

/**
 * The answer itself, and whatever it does to the world.
 */
function answerFor(
  state: GameState,
  speaker: Person,
  topic: Topic,
  clean: boolean
): { text: string; events: GameEvent[] } {
  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  const events: GameEvent[] = [];

  switch (topic) {
    case Topic.TREE: {
      const { treeX, treeY } = state.reckoning;
      if (!pos) return { text: 'They say it is a long way, and that is all they say.', events };

      const distance = Math.max(Math.abs(treeX - pos.x), Math.abs(treeY - pos.y));
      const where = `${bearingTo(pos.x, pos.y, treeX, treeY)}, ${describeDistance(distance)}`;

      // A clean answer puts the ground itself on the chart.
      if (clean) {
        revealArea(state, treeX, treeY, ASK_REVEAL_RADIUS);
        events.push({
          tick: state.tick,
          type: 'system',
          message: 'They draw it in the ash on the hearthstone. It is on your chart now.',
          data: { revealed: 'tree' },
        });
      }

      return {
        text: `"There is only the one tree anybody means by that. It stands ${where}. Men have been cut down off it and men have been left on it, and the difference has never been about the men."`,
        events,
      };
    }

    case Topic.RITES: {
      const unknown = state.reckoning.vigils.filter(
        (vigil) => !state.map[vigil.y]?.[vigil.x]?.explored
      );

      if (unknown.length === 0) {
        return {
          text: '"You have already found the places I would have sent you to. Keep the rites or do not; it is your debt."',
          events,
        };
      }

      const vigil = unknown[state.rng.nextInt(0, unknown.length - 1)];
      const where = pos ? bearingTo(pos.x, pos.y, vigil.x, vigil.y) : 'out there';

      // A priest tells you where; anybody else can only tell you that it exists.
      if (speaker.role === Role.PRIEST || speaker.role === Role.WIDOW || clean) {
        state.map[vigil.y][vigil.x].explored = true;
        events.push({
          tick: state.tick,
          type: 'system',
          message: `${opening(vigil.name)} is on your chart now.`,
          data: { revealed: 'vigil', vigil: vigil.id },
        });
        return {
          text: `"There are older places than the Church in this country. ${opening(vigil.name)} stands ${where} of here. A debt can be argued down at a place like that, if you have the stomach to stand in it."`,
          events,
        };
      }

      return {
        text: `"There are places out that way -- ${where} -- where the old rites were kept. I could not tell you how to find them. The priest might, if he is having a good day."`,
        events,
      };
    }

    case Topic.ROADS: {
      const unknown = state.settlements.filter(
        (settlement) => !state.map[settlement.y]?.[settlement.x]?.explored
      );

      if (unknown.length === 0) {
        return {
          text: '"You have been to all of them, then. There is nothing else out there but the country."',
          events,
        };
      }

      const place = unknown[state.rng.nextInt(0, unknown.length - 1)];
      const where = pos ? bearingTo(pos.x, pos.y, place.x, place.y) : 'out there';

      revealArea(state, place.x, place.y, clean ? ASK_REVEAL_RADIUS : 1);
      events.push({
        tick: state.tick,
        type: 'system',
        message: `${opening(place.name)} is on your chart now.`,
        data: { revealed: 'settlement', settlement: place.name },
      });

      return {
        text: `"${place.name} lies ${where} of here. They will not thank you for coming, but they have a well, and the mark cools where there are hearths."`,
        events,
      };
    }

    case Topic.THREATS: {
      const band = markBand(
        state.entities.getComponent<MarkComponent>(state.playerId, 'mark')?.intensity ?? 0
      );
      const lines = [
        '"Quiet enough, if you keep to the day and do not sleep in the open. That is not advice, it is arithmetic."',
        '"Something has been working the high ground. Not wolves. Wolves leave more of it."',
        '"The dead do not stay put out there. They go where they are pulled, and lately they have been pulled this way."',
        '"There are men on the roads who used to be soldiers and are now something else. They will take the boots as well."',
      ];
      const line = lines[Math.min(band, lines.length - 1)];
      return {
        text: `${line} "And whatever is burning at your throat, it is what they follow. You know that."`,
        events,
      };
    }

    case Topic.MARK:
      return {
        text: `"${opening(MARK_NAME)}. I have seen two before you and neither of them was any older afterwards. It burns when the dark comes and it goes out where there are people, and past that nobody knows anything, whatever ${CHURCH_NAME} says."`,
        events,
      };

    case Topic.CHURCH:
      return {
        text: `"${opening(CHURCH_NAME)} keeps the wound sealed, so they say. What they keep is order. ${opening(INQUISITION_NAME)} does the keeping, and they have been through here twice this year, and they were not looking for the dead."`,
        events,
      };

    case Topic.CHOIR:
      return {
        text: `"${opening(APOSTLE_NAME)} were people once. They opened a coin at the floor of their despair and ${CHOIR_NAME} answered, and something was traded that they did not know the price of. If you find one of those coins, put it in the deepest water you can reach."`,
        events,
      };

    case Topic.THEM:
    default: {
      const errand = errandOf(state, speaker);
      if (errand) {
        return { text: `"${errand.ask}"`, events };
      }
      return {
        text: `"${opening(WORLD_NAME)} in ${ERA_NAME}. We bury more than we christen and we have done for years. That is the whole of it, and you did not need me to tell you."`,
        events,
      };
    }
  }
}
