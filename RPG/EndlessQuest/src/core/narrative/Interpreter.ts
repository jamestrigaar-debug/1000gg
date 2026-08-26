import type { Command, Direction } from '../state/Commands';
import type { GameState } from '../state/GameState';
import type { InventoryComponent } from '../ecs/Component';
import { Skill } from '../rules/Skills';
import { getItem } from '../lore/Items';
import { ACTIONS, Target, allVerbs, type ActionDef } from './Actions';
import { MAX_REST_HOURS, MIN_REST_HOURS } from '../SimulationConstants';

/**
 * Reading what the player meant.
 *
 * The vocabulary lives in Actions.ts; this is only the ear. It takes a line of English,
 * finds the action it names, works out what that action was aimed at, and hands back
 * either one of the simulation's own verbs or an attempt to be adjudicated.
 *
 * When it cannot read a line it does not simply refuse. It offers the nearest things the
 * world does know how to be told, which is how a player learns the grammar without being
 * made to read a manual first.
 */

/** What the player's line turned out to be. */
export type Interpretation =
  /** It named an action that maps onto a verb the simulation has */
  | { kind: 'command'; command: Command; action: ActionDef }
  /** It named an action the world will have to rule on */
  | { kind: 'improvise'; text: string; skill: Skill; hard: boolean; action: ActionDef }
  /** It named something the interface answers, such as consulting the chart */
  | { kind: 'ui'; event: string; action: ActionDef }
  /** It could not be read; the nearest known actions are offered instead */
  | { kind: 'unclear'; message: string; suggestions: ActionDef[] };

/** Directions, with the words people actually use for them. */
const DIRECTIONS: Record<Direction, readonly string[]> = {
  north: ['north', 'n', 'northward', 'up'],
  south: ['south', 's', 'southward', 'down'],
  east: ['east', 'e', 'eastward', 'right'],
  west: ['west', 'w', 'westward', 'left'],
};

/**
 * Words that carry no instruction, skipped when looking for the leading verb.
 */
const FILLER = [
  'i', 'ill', 'im', 'lets', 'let', 'we', 'you', 'to', 'the', 'a', 'an', 'then', 'and',
  'try', 'will', 'want', 'would', 'like', 'my', 'me', 'at', 'on', 'of', 'for', 'it',
];

/**
 * Reads a line of the player's English.
 *
 * @param input What the player typed
 * @param state Current game state, for resolving items and context
 * @returns What it was taken to mean
 */
export function interpret(input: string, state: GameState): Interpretation {
  const raw = input.trim();
  if (raw.length === 0) {
    return { kind: 'unclear', message: 'You do nothing, and it costs you nothing.', suggestions: [] };
  }

  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const direction = readDirection(words);

  // A bare direction is a move, because that is what a player typing "north" means.
  if (direction && words.every((word) => FILLER.includes(word) || isDirectionWord(word))) {
    return {
      kind: 'command',
      command: { type: 'MOVE', direction },
      action: ACTIONS.find((a) => a.id === 'go')!,
    };
  }

  let match = findAction(words, state);

  // "Drink from the waterskin" and "drink from the stream" are the same verb aimed at
  // different things, and it is the object that decides which. Anything the character
  // is actually carrying wins, because a man with a full skin who says he is drinking
  // means the skin.
  if (match?.id === 'drink' && matchCarried(words, state)) {
    match = ACTIONS.find((action) => action.id === 'eat') ?? match;
  }
  if (!match) {
    return {
      kind: 'unclear',
      message: 'That is not a thing you know how to try. Some things that are:',
      suggestions: suggest(words, state),
    };
  }

  return resolveAction(match, words, direction, raw, state);
}

/**
 * Turns a matched action into something the simulation can be given.
 */
function resolveAction(
  action: ActionDef,
  words: readonly string[],
  direction: Direction | null,
  raw: string,
  state: GameState
): Interpretation {
  if (action.uiEvent) {
    return { kind: 'ui', event: action.uiEvent, action };
  }

  switch (action.target) {
    case Target.DIRECTION: {
      if (!direction) {
        return {
          kind: 'unclear',
          message: 'Which way? North, south, east or west.',
          suggestions: [action],
        };
      }
      return { kind: 'command', command: action.command!(direction), action };
    }

    case Target.HOURS: {
      const hours = Math.max(MIN_REST_HOURS, Math.min(MAX_REST_HOURS, readHours(words)));
      return { kind: 'command', command: action.command!(String(hours)), action };
    }

    case Target.PERSON: {
      // The line travels intact so the handler can work out who was addressed. A player
      // in a village of four means one of them, and usually says which.
      return { kind: 'command', command: action.command!(raw), action };
    }

    case Target.TOPIC: {
      // The whole line is handed on, because what was asked about is the answer's
      // business rather than the ear's.
      return { kind: 'command', command: action.command!(raw), action };
    }

    case Target.ITEM: {
      const item = matchCarried(words, state);
      if (!item) {
        return {
          kind: 'unclear',
          message: 'You have nothing like that on you.',
          suggestions: [],
        };
      }
      return { kind: 'command', command: action.command!(item), action };
    }

    default:
      break;
  }

  // Some actions mean one thing in a fight and another out of it: threatening a person
  // across a fire is a check, threatening the thing already on you is a stance.
  if (action.command && (action.available?.(state) ?? true)) {
    return { kind: 'command', command: action.command(''), action };
  }

  if (action.skill) {
    return { kind: 'improvise', text: raw, skill: action.skill, hard: action.hard ?? false, action };
  }

  // An action with a command that is not available here: let the world refuse it in its
  // own words rather than second-guessing it.
  if (action.command) {
    return { kind: 'command', command: action.command(''), action };
  }

  return {
    kind: 'unclear',
    message: 'Not here, and not like that.',
    suggestions: suggest(words, state),
  };
}

/**
 * Finds the action a line names.
 *
 * The leading verb is tried first, because that is what an instruction leads with and it
 * keeps ordinary words in the middle of a sentence -- "pray for it to stop" -- from being
 * read as the verb. Only then is the rest of the line searched.
 */
function findAction(words: readonly string[], state: GameState): ActionDef | null {
  const line = words.join(' ');

  // Whole phrasings first. "Go quiet" is not travelling and "put it down" is not
  // putting something on, and no amount of single-verb matching will ever get those
  // right, because in both cases the first word belongs to a different action.
  const byPhrase = ACTIONS.find((action) =>
    action.phrases?.some((phrase) => line.includes(phrase))
  );
  if (byPhrase) return byPhrase;

  const lead = words.find((word) => !FILLER.includes(word));

  if (lead) {
    const byLead = ACTIONS.find((action) => action.verbs.includes(lead));
    if (byLead) return byLead;

    // A mistyped leading verb still leads. Without this, "exmaine the cairn" is read as
    // an action about cairns rather than as a misspelling of examining one.
    const byTypo = ACTIONS.find((action) =>
      action.verbs.some((verb) => nearlyTheSame(verb, lead))
    );
    if (byTypo) return byTypo;
  }

  // Actions whose moment this is get first refusal on a word anywhere in the line, so
  // that "cut it down" reads as fighting while something is on you.
  const applicable = ACTIONS.filter((action) => !action.available || action.available(state));
  const anywhere = applicable.find((action) =>
    action.verbs.some((verb) => words.includes(verb))
  );
  if (anywhere) return anywhere;

  return ACTIONS.find((action) => action.verbs.some((verb) => words.includes(verb))) ?? null;
}

/**
 * Offers the nearest things the world does understand.
 *
 * Near is measured generously -- a shared prefix, or a single letter's difference -- so
 * that a typo or a near-synonym still lands somewhere useful. Failing that, the player
 * is shown what applies where they are standing, which is never nothing.
 *
 * @param words The line that could not be read
 * @param state Current game state
 * @returns At most three actions worth trying instead
 */
export function suggest(words: readonly string[], state: GameState): ActionDef[] {
  const scored = new Map<ActionDef, number>();

  const line = words.join(' ');

  // A phrasing that nearly landed is the best clue there is about what was meant.
  for (const action of ACTIONS) {
    for (const phrase of action.phrases ?? []) {
      // Filler words are shared by half the phrasings in the game and would otherwise
      // decide the ranking on their own.
      const shared = phrase
        .split(' ')
        .filter((word) => !FILLER.includes(word) && words.includes(word)).length;
      if (shared > 0) scored.set(action, Math.max(scored.get(action) ?? 0, 3 + shared));
    }
    if (action.phrases?.some((phrase) => line.includes(phrase.split(' ')[0]))) {
      scored.set(action, Math.max(scored.get(action) ?? 0, 2));
    }
  }

  for (const { verb, action } of allVerbs()) {
    for (const word of words) {
      if (FILLER.includes(word)) continue;

      let score = 0;
      if (verb === word) score = 6;
      else if (verb.startsWith(word) || word.startsWith(verb)) score = 4;
      else if (nearlyTheSame(verb, word)) score = 3;

      if (score > (scored.get(action) ?? 0)) scored.set(action, score);
    }
  }

  const near = [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([action]) => action);

  if (near.length > 0) return near;

  return ACTIONS.filter((action) => !action.available || action.available(state)).slice(0, 3);
}

/**
 * Reports whether two words are one typo apart.
 *
 * One substitution, one insertion, one deletion, or -- the one that matters most for
 * people typing quickly -- two adjacent letters swapped. "Clmib" should find "climb".
 *
 * @param a A known verb
 * @param b A word the player typed
 * @returns true if they are near enough to be worth offering
 */
export function nearlyTheSame(a: string, b: string): boolean {
  if (a === b) return true;
  // Short words are too close together for this to mean anything: "make" is one letter
  // from "fake", and a player typing "make a shelter" does not mean to lie about one.
  if (a.length < 5 || b.length < 5) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    const differing: number[] = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) differing.push(i);
      if (differing.length > 2) return false;
    }
    if (differing.length === 1) return true;
    if (differing.length === 2) {
      // A transposition: the two differing positions are adjacent and swapped.
      const [first, second] = differing;
      return second === first + 1 && a[first] === b[second] && a[second] === b[first];
    }
    return false;
  }

  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = 0;
  while (i < longer.length && j < shorter.length) {
    if (longer[i] === shorter[j]) {
      i++;
      j++;
    } else if (++skipped > 1) {
      return false;
    } else {
      i++;
    }
  }
  return true;
}

/**
 * Reports whether a word names a direction.
 */
function isDirectionWord(word: string): boolean {
  return Object.values(DIRECTIONS).some((synonyms) => synonyms.includes(word));
}

/**
 * Finds the direction a line points in, if any.
 */
function readDirection(words: readonly string[]): Direction | null {
  for (const [direction, synonyms] of Object.entries(DIRECTIONS) as [Direction, string[]][]) {
    if (synonyms.some((word) => words.includes(word))) return direction;
  }
  return null;
}

/**
 * Reads how long the player meant, in hours.
 */
function readHours(words: readonly string[]): number {
  const written: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, twelve: 12, twenty: 20,
  };

  for (const word of words) {
    const digits = Number.parseInt(word, 10);
    if (Number.isFinite(digits) && digits > 0) return digits;
    if (written[word]) return written[word];
  }

  // "sleep", "camp", "until morning" all mean a night rather than an hour.
  const night = ['sleep', 'night', 'morning', 'dawn', 'camp', 'bed'];
  return words.some((word) => night.includes(word)) ? 8 : 1;
}

/**
 * Matches whatever the player called it against what they are actually carrying.
 *
 * Players say "eat the bread", not "consume stale_bread", so both the catalog id and the
 * item's proper name are matched a word at a time.
 */
function matchCarried(words: readonly string[], state: GameState): string | null {
  const inventory = state.entities.getComponent<InventoryComponent>(
    state.playerId,
    'inventory'
  );
  if (!inventory) return null;

  let best: { id: string; score: number } | null = null;

  for (const id of Object.keys(inventory.items)) {
    const name = (getItem(id)?.name ?? id).toLowerCase();
    const tokens = new Set([...id.split('_'), ...name.split(/[^a-z0-9]+/)].filter(Boolean));

    let score = 0;
    for (const word of words) {
      if (FILLER.includes(word)) continue;
      if (tokens.has(word)) score += 2;
      else if ([...tokens].some((token) => token.startsWith(word) && word.length >= 4)) score += 1;
    }

    if (score > 0 && (!best || score > best.score)) best = { id, score };
  }

  return best?.id ?? null;
}
