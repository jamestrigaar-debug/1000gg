import type { Command, Direction } from '../state/Commands';
import type { GameState } from '../state/GameState';
import type { PositionComponent } from '../ecs/Component';
import { Skill } from '../rules/Skills';
import { settlementAt } from '../world/Settlement';
import { atTree, vigilAt } from '../world/Reckoning';
import { getCurrentTile } from '../state/GameState';
import { waterWithinReach } from '../world/Water';
import { knackFor } from '../dm/Tactics';

/**
 * Everything the world knows how to be told.
 *
 * The first version of the input line hid its vocabulary: the player typed into the
 * dark and found out afterwards whether the game had understood. That is the wrong way
 * round. A game master's repertoire is not secret -- players know roughly what a
 * character can attempt, and the interesting part is deciding which of those things to
 * do, and in what order, and at what cost.
 *
 * So the vocabulary is declared here, in one place, as data. Everything downstream reads
 * from it: the interpreter matches against it, the palette lists whichever of them apply
 * where the character is standing, and when a line cannot be read the suggestions come
 * from it too. Adding an action to the game means adding an entry here and nothing else.
 */

/** What an action needs said alongside its verb. */
export enum Target {
  /** Nothing: "rest", "listen" */
  NONE = 'none',
  /** A compass direction: "go north" */
  DIRECTION = 'direction',
  /** Something carried: "eat the bread" */
  ITEM = 'item',
  /** Whatever is currently on you */
  THREAT = 'threat',
  /** A person: "ask the smith about the road" */
  PERSON = 'person',
  /** A length of time: "sleep until morning" */
  HOURS = 'hours',
  /** Something to ask about: "ask about the tree" */
  TOPIC = 'topic',
}

/** Where an action belongs in the palette. */
export enum ActionGroup {
  TRAVEL = 'Travel',
  SURVIVE = 'Survive',
  LOOK = 'Look',
  BODY = 'Body',
  CRAFT = 'Craft',
  TALK = 'Talk',
  FIGHT = 'Fight',
  SPIRIT = 'Spirit',
  DEBT = 'The debt',
}

/**
 * One thing the character can attempt.
 *
 * An action either maps onto a verb the simulation already has, in which case it carries
 * a command, or it is adjudicated as a skill attempt, in which case it carries the skill
 * it is tested against. Nothing else in the game distinguishes the two: both are things
 * the player can simply say.
 */
export interface ActionDef {
  readonly id: string;
  /** Words that mean this action; the first is the one the palette shows */
  readonly verbs: readonly string[];
  /**
   * Whole phrasings that mean this action, matched before any single verb.
   *
   * These are the pathways: the turns of phrase a player actually reaches for, which
   * would otherwise collide with a more common verb. "Go quiet" is not travelling, and
   * "put it out" is not putting something on.
   */
  readonly phrases?: readonly string[];
  /** What the palette shows beside the verb */
  readonly summary: string;
  readonly group: ActionGroup;
  readonly target: Target;
  /** Built when the action maps onto an existing verb */
  readonly command?: (target: string) => Command;
  /** Tested against this when the action has to be adjudicated */
  readonly skill?: Skill;
  /** True for attempts of the sort that tend to be hard */
  readonly hard?: boolean;
  /** Whether the action is worth offering where the character is standing */
  readonly available?: (state: GameState) => boolean;
  /** An example the palette can put in the input for the player to edit */
  readonly example?: string;
  /**
   * Answered by the interface rather than by the simulation.
   *
   * Looking at the chart is not something the character does in the world; it is the
   * player consulting their own notes, and it costs no time.
   */
  readonly uiEvent?: string;
}

/**
 * Reports whether the character is standing in a settlement.
 */
function inSettlement(state: GameState): boolean {
  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  return pos ? settlementAt(state.settlements, pos.x, pos.y) !== undefined : false;
}

/**
 * Reports whether something is currently on the character.
 */
function engaged(state: GameState): boolean {
  return state.encounterId !== null;
}

/**
 * Reports whether the character is at liberty.
 */
function free(state: GameState): boolean {
  return state.encounterId === null;
}

/**
 * Reports whether the character is standing on a vigil that has not been kept.
 */
function atVigil(state: GameState): boolean {
  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  if (!pos) return false;
  const vigil = vigilAt(state.reckoning, pos.x, pos.y);
  return vigil !== undefined && !vigil.kept;
}

/**
 * Reports whether the character is standing under the gallows-tree.
 */
function atGallows(state: GameState): boolean {
  const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
  return pos ? atTree(state.reckoning, pos.x, pos.y) : false;
}

/**
 * Reports whether there is standing water within reach.
 */
function nearWater(state: GameState): boolean {
  const tile = getCurrentTile(state);
  return tile?.moisture !== undefined && tile.moisture > 0.55;
}

/**
 * The whole repertoire.
 *
 * Written as verbs a person would actually type rather than as a taxonomy. Where two
 * entries could both catch a line, the earlier one wins, so the specific ones are put
 * before the general.
 */
export const ACTIONS: readonly ActionDef[] = [
  // --- Travel ------------------------------------------------------------------
  {
    id: 'go',
    verbs: ['go', 'move', 'walk', 'head', 'travel', 'march', 'continue',
      'trek', 'wander', 'ride'],
    phrases: ['set off', 'push on', 'press on', 'carry on', 'make for', 'strike out',
      'head for'],
    summary: 'set off in a direction',
    group: ActionGroup.TRAVEL,
    target: Target.DIRECTION,
    command: (direction) => ({ type: 'MOVE', direction: direction as Direction }),
    available: free,
    example: 'go north',
  },
  // --- Inside a place ----------------------------------------------------------
  {
    id: 'enter',
    verbs: ['enter', 'delve', 'descend'],
    phrases: ['go in', 'go inside', 'head in'],
    summary: 'go into whatever stands here',
    group: ActionGroup.TRAVEL,
    target: Target.NONE,
    command: () => ({ type: 'ENTER' }),
    available: (state) => {
      if (state.instance) return false;
      const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
      if (!pos) return false;
      const site = state.sites.find((candidate) => candidate.x === pos.x && candidate.y === pos.y);
      return site?.instance !== undefined;
    },
    example: 'go in',
  },
  {
    id: 'onward',
    verbs: ['onward', 'deeper', 'further'],
    phrases: ['go on', 'press on', 'carry on', 'go deeper'],
    summary: 'walk on into the next room',
    group: ActionGroup.TRAVEL,
    target: Target.NONE,
    command: () => ({ type: 'DELVE' }),
    available: (state) => state.instance !== null,
    example: 'go on',
  },
  {
    id: 'ransack',
    verbs: ['ransack', 'loot', 'rifle', 'plunder'],
    phrases: ['turn it over', 'go over the room'],
    summary: 'go over this room for what it is hiding',
    group: ActionGroup.SURVIVE,
    target: Target.NONE,
    command: () => ({ type: 'RANSACK' }),
    available: (state) => state.instance !== null,
    example: 'ransack',
  },
  {
    id: 'leave',
    verbs: ['leave', 'withdraw'],
    phrases: ['go out', 'get out', 'back out'],
    summary: 'come back out into the country',
    group: ActionGroup.TRAVEL,
    target: Target.NONE,
    command: () => ({ type: 'LEAVE' }),
    available: (state) => state.instance !== null,
    example: 'get out',
  },
  {
    id: 'knack',
    verbs: ['break', 'slip', 'vanish', 'melt', 'reason', 'plead', 'parley', 'batter', 'bull'],
    phrases: ['break them', 'slip away', 'talk them down'],
    summary: 'the one thing your calling can do that the others cannot',
    group: ActionGroup.FIGHT,
    target: Target.NONE,
    command: () => ({ type: 'KNACK' }),
    // Only a calling that actually has one. Offering a trick the character does not have
    // is how a bot spent eight thousand commands being told it had no such trick.
    available: (state) => knackFor(state.background?.origin.id) !== undefined,
    example: 'break them',
  },
  {
    id: 'drop',
    verbs: ['drop', 'discard', 'ditch', 'abandon'],
    phrases: ['put down', 'leave it', 'set down'],
    summary: 'put something down and leave it',
    group: ActionGroup.SURVIVE,
    target: Target.ITEM,
    command: (item) => ({ type: 'DROP', item: item as string }),
    available: free,
    example: 'drop the knife',
  },
  {
    id: 'chart',
    verbs: ['chart', 'map', 'bearings'],
    summary: 'look over the ground you have covered',
    group: ActionGroup.TRAVEL,
    target: Target.NONE,
    uiEvent: 'chart-toggle',
    example: 'chart',
  },
  {
    id: 'navigate',
    verbs: ['navigate', 'orient', 'route', 'plan'],
    summary: 'work out where you are and what lies ahead',
    group: ActionGroup.TRAVEL,
    target: Target.NONE,
    skill: Skill.SURVIVAL,
    available: free,
    example: 'work out the route ahead',
  },
  {
    id: 'climb',
    verbs: ['climb', 'scale', 'clamber', 'vault', 'ascend', 'mount'],
    phrases: ['get up there', 'climb up', 'get a better view'],
    summary: 'get up something for the view or the way past',
    group: ActionGroup.TRAVEL,
    target: Target.NONE,
    skill: Skill.ATHLETICS,
    available: free,
    example: 'climb the ridge',
  },
  {
    id: 'swim',
    verbs: ['swim', 'wade', 'ford', 'cross'],
    summary: 'get through water',
    group: ActionGroup.TRAVEL,
    target: Target.NONE,
    skill: Skill.ATHLETICS,
    hard: true,
    available: (state) => free(state) && nearWater(state),
    example: 'wade the ford',
  },
  {
    id: 'jump',
    verbs: ['jump', 'leap', 'tumble', 'balance', 'squeeze'],
    summary: 'trust your feet',
    group: ActionGroup.TRAVEL,
    target: Target.NONE,
    skill: Skill.ACROBATICS,
    example: 'jump the gap',
  },

  // --- Survive -----------------------------------------------------------------
  {
    id: 'rest',
    verbs: ['rest', 'sleep', 'camp', 'wait', 'stop', 'bed', 'doze', 'nap', 'halt', 'sit'],
    phrases: ['make camp', 'lie down', 'get my head down', 'take a breath',
      'wait it out', 'sit tight', 'bed down'],
    summary: 'stop where you are; say how long',
    group: ActionGroup.SURVIVE,
    target: Target.HOURS,
    command: (hours) => ({ type: 'REST', hours: Number(hours) }),
    available: free,
    example: 'sleep until morning',
  },
  {
    id: 'forage',
    verbs: ['forage', 'scavenge', 'gather', 'scrounge', 'hunt', 'glean', 'pick'],
    phrases: ['look for food', 'find something to eat', 'find water', 'look for water'],
    summary: 'work the ground over for food and water',
    group: ActionGroup.SURVIVE,
    target: Target.NONE,
    command: () => ({ type: 'SEARCH' }),
    available: free,
    example: 'forage',
  },
  {
    id: 'eat',
    verbs: ['eat', 'consume', 'swallow', 'chew'],
    phrases: ['drink the', 'drink my', 'eat the', 'eat my'],
    summary: 'use something you are carrying',
    group: ActionGroup.SURVIVE,
    target: Target.ITEM,
    command: (item) => ({ type: 'CONSUME', item }),
    example: 'eat the bread',
  },
  {
    id: 'drink',
    verbs: ['drink'],
    phrases: ['drink from', 'fill the waterskin', 'fill my skin', 'drink the water',
      'get water', 'water myself'],
    summary: 'drink from open water, if there is any within reach',
    group: ActionGroup.SURVIVE,
    target: Target.NONE,
    command: () => ({ type: 'DRINK' }),
    available: (state) => free(state) && waterWithinReach(
      state,
      state.entities.getComponent<PositionComponent>(state.playerId, 'position')?.x ?? -1,
      state.entities.getComponent<PositionComponent>(state.playerId, 'position')?.y ?? -1
    ) !== null,
    example: 'drink from the stream',
  },
  {
    id: 'snare',
    verbs: ['snare', 'trap', 'fish', 'net'],
    summary: 'set something and let the country work for you',
    group: ActionGroup.SURVIVE,
    target: Target.NONE,
    skill: Skill.SURVIVAL,
    available: free,
    example: 'set a snare',
  },
  {
    id: 'shelter',
    verbs: ['shelter', 'bank', 'hollow'],
    phrases: ['make a shelter', 'make shelter', 'build a shelter', 'get out of the weather',
      'dig in'],
    summary: 'make somewhere out of the weather',
    group: ActionGroup.SURVIVE,
    target: Target.NONE,
    skill: Skill.SURVIVAL,
    available: free,
    example: 'make a shelter',
  },
  {
    id: 'fire',
    verbs: ['light', 'kindle', 'burn', 'cook', 'boil', 'roast'],
    phrases: ['light a fire', 'build a fire', 'get a fire going', 'boil the water'],
    summary: 'get a fire going, for warmth or for what it cooks',
    group: ActionGroup.CRAFT,
    target: Target.NONE,
    skill: Skill.SURVIVAL,
    available: free,
    example: 'light a fire',
  },
  {
    id: 'trade',
    verbs: ['trade', 'barter', 'haggle'],
    summary: 'put a coin down for supplies',
    group: ActionGroup.TALK,
    target: Target.NONE,
    command: () => ({ type: 'TRADE' }),
    available: inSettlement,
    example: 'barter for supplies',
  },

  // --- Look --------------------------------------------------------------------
  {
    id: 'look',
    verbs: ['look', 'watch', 'scan', 'peer', 'observe', 'spot', 'gaze', 'stare', 'survey',
      'eye', 'glance', 'view', 'sight'],
    phrases: ['keep watch', 'take it in', 'get the lie of the land', 'look about',
      'look around', 'scout ahead'],
    summary: 'stop and take the country in properly',
    group: ActionGroup.LOOK,
    target: Target.NONE,
    skill: Skill.PERCEPTION,
    example: 'watch the treeline',
  },
  {
    id: 'listen',
    verbs: ['listen', 'hear', 'smell', 'sniff'],
    phrases: ['keep an ear out', 'listen out'],
    summary: 'use something other than your eyes',
    group: ActionGroup.LOOK,
    target: Target.NONE,
    skill: Skill.PERCEPTION,
    example: 'listen for anything moving',
  },
  {
    id: 'examine',
    verbs: ['examine', 'inspect', 'study', 'sift', 'search', 'check', 'investigate',
      'probe', 'rummage', 'rifle', 'dig'],
    phrases: ['go over it', 'have a look at', 'look closer', 'take a closer look'],
    summary: 'go over something in detail',
    group: ActionGroup.LOOK,
    target: Target.NONE,
    skill: Skill.INVESTIGATION,
    example: 'examine the cairn',
  },
  {
    id: 'track',
    verbs: ['track', 'trail', 'spoor'],
    phrases: ['follow the tracks', 'read the ground', 'see which way it went'],
    summary: 'read what came through here',
    group: ActionGroup.LOOK,
    target: Target.NONE,
    skill: Skill.SURVIVAL,
    available: free,
    example: 'track whatever came through',
  },
  {
    id: 'identify',
    verbs: ['identify', 'name', 'recognise', 'recognize'],
    summary: 'work out what a plant, beast or sign is',
    group: ActionGroup.LOOK,
    target: Target.NONE,
    skill: Skill.NATURE,
    example: 'identify the herb',
  },
  {
    id: 'read',
    verbs: ['read', 'decipher', 'translate'],
    summary: 'make sense of writing or a mark',
    group: ActionGroup.LOOK,
    target: Target.NONE,
    skill: Skill.INVESTIGATION,
    example: 'read the inscription',
  },

  // --- Body --------------------------------------------------------------------
  {
    id: 'sneak',
    verbs: ['sneak', 'hide', 'creep', 'skulk', 'crawl', 'conceal', 'slink', 'shadow',
      'quiet', 'silent', 'lurk', 'duck'],
    phrases: ['go quiet', 'go to ground', 'keep low', 'keep out of sight', 'stay hidden',
      'keep to the shadows', 'keep to the hedges', 'lie low', 'take cover'],
    summary: 'be harder to find for a while',
    group: ActionGroup.BODY,
    target: Target.NONE,
    skill: Skill.STEALTH,
    example: 'go quiet and keep low',
  },
  {
    id: 'tend',
    verbs: ['tend', 'bind', 'bandage', 'treat', 'stitch', 'dress', 'splint', 'patch',
      'staunch', 'clean', 'poultice', 'heal'],
    phrases: ['see to the wound', 'see to myself', 'patch myself up', 'bind it up'],
    summary: 'see to a wound with what you have',
    group: ActionGroup.BODY,
    target: Target.NONE,
    skill: Skill.MEDICINE,
    example: 'bind the wound',
  },
  {
    id: 'force',
    verbs: ['force', 'smash', 'shove', 'heave', 'haul', 'lift', 'drag', 'pry', 'wrench',
      'push', 'barge'],
    phrases: ['put my back into it', 'force it open', 'break it down'],
    summary: 'put your back into something',
    group: ActionGroup.BODY,
    target: Target.NONE,
    skill: Skill.ATHLETICS,
    example: 'force the door',
  },
  {
    id: 'steal',
    verbs: ['steal', 'palm', 'pickpocket', 'filch', 'pilfer', 'snatch'],
    summary: 'take something without being seen taking it',
    group: ActionGroup.BODY,
    target: Target.NONE,
    skill: Skill.SLEIGHT_OF_HAND,
    hard: true,
    example: 'palm it while they are talking',
  },
  {
    id: 'equip',
    verbs: ['equip', 'wear', 'wield', 'draw', 'don'],
    summary: 'put something to use',
    group: ActionGroup.CRAFT,
    target: Target.ITEM,
    command: (item) => ({ type: 'EQUIP', item }),
    example: 'draw the knife',
  },
  {
    id: 'stow',
    verbs: ['stow', 'remove', 'unequip', 'sheathe', 'pack'],
    summary: 'put something away',
    group: ActionGroup.CRAFT,
    target: Target.ITEM,
    command: (item) => ({ type: 'UNEQUIP', slot: item }),
    example: 'sheathe the knife',
  },

  // --- Spirit ------------------------------------------------------------------
  {
    id: 'pray',
    verbs: ['pray', 'kneel', 'bless', 'ward', 'confess', 'sanctify', 'invoke', 'plead'],
    phrases: ['say the words', 'make the sign', 'say a prayer'],
    summary: 'say the old words and see if anything gives',
    group: ActionGroup.SPIRIT,
    target: Target.NONE,
    skill: Skill.RELIGION,
    example: 'pray at the stones',
  },
  {
    id: 'bury',
    verbs: ['bury', 'cairn', 'mourn', 'rites'],
    summary: 'do right by the dead',
    group: ActionGroup.SPIRIT,
    target: Target.NONE,
    skill: Skill.RELIGION,
    available: free,
    example: 'bury what is left of them',
  },
  {
    id: 'vigil',
    verbs: ['vigil', 'keep'],
    summary: 'keep the rite at this place, and argue the debt down',
    group: ActionGroup.DEBT,
    target: Target.NONE,
    command: () => ({ type: 'VIGIL' }),
    available: atVigil,
    example: 'keep the vigil',
  },
  {
    id: 'reckon',
    verbs: ['reckon', 'settle'],
    summary: 'settle what is owed, here, at the tree',
    group: ActionGroup.DEBT,
    target: Target.NONE,
    command: () => ({ type: 'RECKON' }),
    available: atGallows,
    example: 'settle the debt',
  },

  // --- Talk --------------------------------------------------------------------
  {
    id: 'talk',
    verbs: ['talk', 'speak', 'greet', 'hail', 'parley', 'address'],
    phrases: ['say hello', 'strike up a conversation', 'ask what they need',
      'ask what is wrong'],
    summary: 'speak to whoever is here, and hear what they want',
    group: ActionGroup.TALK,
    target: Target.PERSON,
    command: (who) => ({ type: 'TALK', who }),
    available: inSettlement,
    example: 'talk to them',
  },
  {
    id: 'accept',
    verbs: ['accept', 'agree', 'yes'],
    phrases: ['i will do it', 'take it on', 'say yes'],
    summary: 'take on what was asked of you',
    group: ActionGroup.TALK,
    target: Target.PERSON,
    command: () => ({ type: 'ACCEPT' }),
    available: inSettlement,
    example: 'accept',
  },
  {
    id: 'give',
    verbs: ['give', 'hand', 'deliver', 'report', 'return'],
    phrases: ['hand it over', 'give it to them', 'tell them it is done'],
    summary: 'hand over what was asked for, or say it is done',
    group: ActionGroup.TALK,
    target: Target.PERSON,
    command: () => ({ type: 'GIVE' }),
    available: inSettlement,
    example: 'hand it over',
  },
  {
    id: 'enquire',
    verbs: ['ask', 'enquire', 'inquire', 'question'],
    phrases: ['ask about', 'ask after', 'what do you know about'],
    summary: 'ask about the tree, the rites, the roads, the country, or this place',
    group: ActionGroup.TALK,
    target: Target.TOPIC,
    command: (text) => ({ type: 'ASK', text }),
    available: inSettlement,
    example: 'ask about the rites',
  },
  {
    id: 'persuade',
    verbs: ['persuade', 'beg', 'plead', 'bargain', 'reason', 'offer'],
    summary: 'talk somebody into something',
    group: ActionGroup.TALK,
    target: Target.NONE,
    skill: Skill.PERSUASION,
    example: 'beg them for bread',
  },
  {
    id: 'lie',
    verbs: ['lie', 'bluff', 'pretend', 'feign', 'mislead', 'fake'],
    summary: 'say the untrue thing well',
    group: ActionGroup.TALK,
    target: Target.NONE,
    skill: Skill.DECEPTION,
    example: 'lie about where I came from',
  },
  {
    id: 'read_them',
    verbs: ['gauge', 'judge', 'weigh', 'measure', 'study'],
    phrases: ['take their measure', 'read them', 'size them up', 'watch them a while'],
    summary: 'take somebody\u2019s measure, and learn what they hold to',
    group: ActionGroup.TALK,
    target: Target.PERSON,
    command: (who) => ({ type: 'READ', who }),
    available: inSettlement,
    example: 'take their measure',
  },
  {
    id: 'press',
    verbs: ['press', 'lean', 'blackmail'],
    phrases: ['use what you know', 'press them', 'lean on them', 'hold it over them'],
    summary: 'use what they are hiding; quicker than an appeal, and they will not forget',
    group: ActionGroup.TALK,
    target: Target.PERSON,
    command: (who) => ({ type: 'PRESS', who }),
    available: inSettlement,
    example: 'press them with what you know',
  },
  {
    id: 'appeal',
    verbs: ['appeal', 'invoke'],
    phrases: ['appeal to', 'put it to them', 'say it their way'],
    summary: 'put it in the terms of what they care about',
    group: ActionGroup.TALK,
    target: Target.PERSON,
    command: (who) => ({ type: 'APPEAL', who }),
    available: inSettlement,
    example: 'appeal to what they care about',
  },
  {
    id: 'calm',
    verbs: ['calm', 'soothe', 'gentle', 'whistle'],
    summary: 'settle an animal',
    group: ActionGroup.TALK,
    target: Target.NONE,
    skill: Skill.ANIMAL_HANDLING,
    example: 'calm the dog',
  },

  // --- Fight -------------------------------------------------------------------
  {
    id: 'attack',
    verbs: ['attack', 'hit', 'stab', 'swing', 'fight', 'charge', 'kill', 'cut', 'slash',
      'thrust', 'hack', 'batter'],
    phrases: ['go at it', 'strike at it', 'cut it down', 'put it down', 'kill it'],
    summary: 'go at it',
    group: ActionGroup.FIGHT,
    target: Target.THREAT,
    command: () => ({ type: 'ATTACK' }),
    available: engaged,
    example: 'strike at it',
  },
  {
    id: 'guard',
    verbs: ['guard', 'defend', 'block', 'cover', 'brace', 'parry'],
    summary: 'trade the exchange for a guard you can hold',
    group: ActionGroup.FIGHT,
    target: Target.THREAT,
    command: () => ({ type: 'DEFEND' }),
    available: engaged,
    example: 'cover up',
  },
  {
    id: 'flee',
    verbs: ['flee', 'run', 'escape', 'retreat', 'withdraw', 'break', 'bolt', 'leg'],
    phrases: ['break off', 'get away', 'run for it', 'get out of here', 'back off'],
    summary: 'get away, and pay for it in the getting',
    group: ActionGroup.FIGHT,
    target: Target.THREAT,
    command: () => ({ type: 'FLEE' }),
    available: engaged,
    example: 'run for it',
  },
  {
    id: 'feint',
    verbs: ['feint', 'trick', 'dummy'],
    summary: 'sell it a lie and take the opening',
    group: ActionGroup.FIGHT,
    target: Target.THREAT,
    command: () => ({ type: 'FEINT' }),
    available: engaged,
    example: 'feint left',
  },
  {
    id: 'threaten',
    verbs: ['threaten', 'intimidate', 'menace', 'scare', 'frighten', 'roar', 'shout',
      'snarl', 'bark'],
    phrases: ['warn them off', 'face it down', 'stand my ground'],
    summary: 'be the worse option',
    group: ActionGroup.FIGHT,
    target: Target.NONE,
    command: (target) => (target === 'engaged' ? { type: 'INTIMIDATE' } : { type: 'INTIMIDATE' }),
    skill: Skill.INTIMIDATION,
    hard: true,
    example: 'threaten them off',
  },
];

/** Every action, by id. */
export const ACTIONS_BY_ID: ReadonlyMap<string, ActionDef> = new Map(
  ACTIONS.map((action) => [action.id, action])
);

/**
 * The actions worth offering where the character is standing.
 *
 * @param state Current game state
 * @returns Actions whose moment this is
 */
export function availableActions(state: GameState): ActionDef[] {
  return ACTIONS.filter((action) => !action.available || action.available(state));
}

/**
 * Every verb the world knows, for suggesting near misses.
 * @returns Each verb paired with the action it belongs to
 */
export function allVerbs(): { verb: string; action: ActionDef }[] {
  return ACTIONS.flatMap((action) => action.verbs.map((verb) => ({ verb, action })));
}
