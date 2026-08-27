import type { GameState } from '../state/GameState';
import type { InventoryComponent } from '../ecs/Component';
import type { GameEvent } from '../../events/GameEvent';
import type { Person } from '../world/People';
import { BONDS, Role, ROLE_TITLE, personById } from '../world/People';
import { TerrainType } from '../world/TerrainType';
import { TERRAIN_NAME } from '../lore/Flavor';
import { getItem } from '../lore/Items';
import { addItem, countItem, removeItem } from '../state/Inventory';
import { narrate } from './Narrator';
import { clamp } from '../../utils/math';
import {
  ERRAND_DEADLINE_HOURS,
  ERRAND_DISPOSITION_DONE,
  ERRAND_DISPOSITION_FAILED,
  HOURS_PER_DAY,
  BOND_ERRAND_CHANCE,
} from '../SimulationConstants';

/**
 * Errands: what people want, turned into something to do.
 *
 * Quests here are not written in advance and handed out by a dispenser. They are grown
 * from what somebody is and what is happening to them: a midwife with a fevered child in
 * the house needs feverfew, and feverfew grows in the mire, and the mire is two days off,
 * and the child has about three days in her. Nothing about that was authored as a quest.
 * It falls out of a role, a catalog, a map and a clock.
 *
 * The clock is what makes it a story rather than a shopping list. Every errand has a day
 * it stops mattering, and what happens then is not that the errand quietly disappears.
 * The child dies. The body stays out there. The thing taking the stock keeps taking it,
 * and the people who asked you remember which it was.
 */

/** What kind of thing is being asked for. */
export enum ErrandKind {
  /** Bring back something that grows or lies out in the country */
  FETCH = 'fetch',
  /** Give somebody food, now, out of your own pack */
  FEED = 'feed',
  /** Go to a place and do right by what is there */
  FIND = 'find',
  /** Go to a place and deal with what is on it */
  CLEAR = 'clear',
}

/** Where an errand has got to. */
export enum ErrandState {
  OFFERED = 'offered',
  ACCEPTED = 'accepted',
  DONE = 'done',
  FAILED = 'failed',
}

/**
 * One thing somebody wants doing.
 */
export interface Errand {
  readonly id: string;
  readonly personId: string;
  readonly kind: ErrandKind;
  /** How they asked for it, in their own words */
  readonly ask: string;
  /** What it will take, in a line the player can act on */
  readonly task: string;
  /** Catalog id of what must be brought back, for a fetch or a feed */
  readonly item?: string;
  readonly quantity: number;
  /** Where it is, for errands that are somewhere */
  readonly x?: number;
  readonly y?: number;
  /** The tick after which it stops mattering */
  readonly dueAt: number;
  /** What is owed for doing it */
  readonly reward: ErrandReward;
  /** What happens to them if it is not done */
  readonly cost: string;
  state: ErrandState;
}

/**
 * What doing somebody a service is worth.
 */
export interface ErrandReward {
  readonly items?: Readonly<Record<string, number>>;
  /** Told where one of the vigils stands, which is worth more than anything carried */
  readonly knowledge?: boolean;
  /**
   * Coin, in copper.
   *
   * A village asking a stranger to go into a hole in the ground has to be able to pay
   * for it, and now that there is somewhere to spend money there is something to pay in.
   */
  readonly copper?: number;
}

/**
 * A want, before it is an errand.
 *
 * Each role wants the things that role would want. The terrain names where the answer
 * grows, so the errand is only offered in a world that actually has that country in it.
 */
interface Want {
  readonly kind: ErrandKind;
  readonly item?: string;
  readonly quantity?: number;
  readonly terrain?: TerrainType;
  readonly ask: (person: Person) => string;
  readonly task: (where: string) => string;
  readonly cost: string;
  readonly days: number;
  readonly reward: ErrandReward;
}

/**
 * What each role is liable to need.
 */
const WANTS: Record<Role, readonly Want[]> = {
  [Role.MIDWIFE]: [
    {
      kind: ErrandKind.FETCH,
      item: 'herbs',
      terrain: TerrainType.FOREST,
      days: 4,
      ask: () =>
        'I am out of everything that stops a bleed. There are herbs under the timber, if the wood will let you have them. I have two women near their time and no help coming.',
      task: (where) => `Bring what grows under the timber in ${where}`,
      cost: 'One of the two did not come through it. She is behind the church with the others now.',
      reward: { items: { bandage: 2, feverfew: 1 } },
    },
    {
      kind: ErrandKind.FEED,
      item: 'raw_meat',
      quantity: 1,
      days: 3,
      ask: () =>
        'There is a woman in that house who has not eaten meat since the autumn and is feeding a child on nothing. I have asked everybody. You are what is left to ask.',
      task: () => 'Bring meat to the house behind her',
      cost: 'The child stopped feeding on the third day and did not start again.',
      reward: { items: { herbal_poultice: 1, copper_coins: 2 } },
    },
    {
      kind: ErrandKind.FETCH,
      item: 'feverfew',
      terrain: TerrainType.SWAMP,
      days: 3,
      ask: () =>
        'There is a child in that house burning up, and I have nothing left to break it with. Feverfew. It grows in the sour ground, out in the mire, and I cannot leave her to go and get it.',
      task: (where) => `Bring feverfew from ${where}`,
      cost: 'The child died on the second night. They have not said so out loud, and they do not have to.',
      reward: { items: { bandage: 2, herbal_poultice: 1 } },
    },
  ],
  [Role.SMITH]: [
    {
      kind: ErrandKind.FETCH,
      item: 'ancient_coin',
      terrain: TerrainType.HILLS,
      days: 5,
      ask: () =>
        'There is old iron in the barrows up on the stone country. Not grave-goods, before you look at me like that -- iron. Bring me anything worked and I will make you something that holds an edge.',
      task: (where) => `Bring worked metal out of the barrows in ${where}`,
      cost: 'He melted down the chapel hinges instead. The parish has not forgiven him and neither has he.',
      reward: { items: { hunting_knife: 1, copper_coins: 3 } },
    },
    {
      kind: ErrandKind.FETCH,
      item: 'firewood',
      terrain: TerrainType.FOREST,
      days: 4,
      ask: () =>
        'My fire has been cold nine days and nobody will go into the wood for me. Bring me what will burn and I will put an edge on anything you carry.',
      task: (where) => `Bring cut wood from ${where}`,
      cost: 'The forge stayed cold. He has started talking about going south with the rest of them.',
      reward: { items: { iron_knife: 1, copper_coins: 2 } },
    },
  ],
  [Role.PRIEST]: [
    {
      kind: ErrandKind.FETCH,
      item: 'feverfew',
      terrain: TerrainType.SWAMP,
      days: 4,
      ask: () =>
        'Half this parish is sweating through a fever I have no name for and the Church has sent nothing but a letter. Feverfew, out of the sour ground. As much as you can carry.',
      task: (where) => `Bring feverfew out of ${where}`,
      cost: 'It went through the houses on the north side and took the old first, as it does.',
      reward: { items: { herbal_poultice: 2 }, knowledge: true },
    },
    {
      kind: ErrandKind.FIND,
      days: 5,
      ask: () =>
        'A man of this parish went out to the stones and did not come back. Somebody should say the words over him. It will not be me; I have not been past the gate since the winter.',
      task: (where) => `Find what is left of him out in ${where}, and do it properly`,
      cost: 'Nobody went. Whatever is out there is still out there, and the parish knows it.',
      reward: { knowledge: true },
    },
  ],
  [Role.REEVE]: [
    {
      kind: ErrandKind.FIND,
      days: 5,
      ask: () =>
        'Two of mine went out to bring the flock down nine days ago. I have sent nobody after them because I have nobody to send. Go and find out, and come back and tell me either way.',
      task: (where) => `Find out what became of them out in ${where}`,
      cost: 'Whatever happened out there happened without anybody watching, and the reeve has stopped going as far as the gate.',
      reward: { items: { copper_coins: 3, dried_meat: 1 }, knowledge: true },
    },
    {
      kind: ErrandKind.CLEAR,
      days: 4,
      ask: () =>
        'Something has been taking stock off the high ground three nights running. Not a wolf. Wolves leave more. Go up and put a stop to it, and there is coin in it.',
      task: (where) => `Deal with whatever is working ${where}`,
      cost: 'It took a child this time instead of a beast, and the reeve has stopped asking anybody for anything.',
      reward: { items: { copper_coins: 4, dried_meat: 2 } },
    },
  ],
  [Role.WIDOW]: [
    {
      kind: ErrandKind.FETCH,
      item: 'wool_cloak',
      terrain: TerrainType.HILLS,
      days: 6,
      ask: () =>
        'He went out in his good cloak and they brought back neither. If it is still out there on him, bring it to me. I know what that sounds like. Bring it anyway.',
      task: (where) => `Find what he was wearing, out in ${where}`,
      cost: 'She has stopped asking after him, which is not the same as having stopped waiting.',
      reward: { items: { copper_coins: 2 }, knowledge: true },
    },
    {
      kind: ErrandKind.FIND,
      days: 6,
      ask: () =>
        'They cut my husband down off the same tree they cut you from, and left him where he fell. I am too old to go out that far. Bury him. That is all.',
      task: (where) => `Find him out in ${where} and put him under`,
      cost: 'She stopped asking. She sits where she can see the road and does not look at it.',
      reward: { knowledge: true },
    },
  ],
  [Role.DROVER]: [
    {
      kind: ErrandKind.CLEAR,
      days: 4,
      ask: () =>
        'Something is working the drove road and I cannot take beasts past it. I am not asking you to be brave, I am asking you to walk up there and come back and tell me it is done.',
      task: (where) => `Walk the drove road through ${where} and see it clear`,
      cost: 'He took them the long way round and lost four to the mire, which is four more than he had to spare.',
      reward: { items: { dried_meat: 3, copper_coins: 2 } },
    },
    {
      kind: ErrandKind.FETCH,
      item: 'rope',
      terrain: TerrainType.FOREST,
      days: 5,
      ask: () =>
        'I have beasts to move and nothing to move them with. Rope. Any rope. The last of mine went round somebody who deserved it.',
      task: (where) => `Find rope out in ${where}`,
      cost: 'He drove them out without it and lost half the herd in the first mire he came to.',
      reward: { items: { dried_meat: 2, copper_coins: 2 } },
    },
  ],
  [Role.BOY]: [
    {
      kind: ErrandKind.FEED,
      item: 'stale_bread',
      quantity: 1,
      days: 2,
      ask: () =>
        'He does not ask. He stands near enough that you can see the bones in his wrists and waits for you to work it out yourself.',
      task: () => 'Give him something to eat',
      cost: 'He is not by the gate any more. Nobody says where he went.',
      reward: { items: { copper_coins: 1 } },
    },
  ],
  [Role.BEGGAR]: [
    {
      kind: ErrandKind.FEED,
      item: 'wild_berries',
      quantity: 1,
      days: 2,
      ask: () =>
        'Anything. I am not proud, and I stopped being proud a long way before this.',
      task: () => 'Give her something to eat',
      cost: 'They found her behind the wall on the third morning. It had been cold.',
      reward: { knowledge: true },
    },
  ],
};

/**
 * What a person wants on their own account, rather than on their trade's.
 *
 * A wider table of wants per role is still a table: every midwife is drawing from the
 * midwife list, so the twentieth village's midwife is recognisably the first one's. What
 * makes an errand belong to a *person* is that it comes out of what holds them, and
 * every person is holding something different.
 *
 * So a bond can be the errand. The bond was already generated, already read out when
 * somebody was measured, and already doing nothing. Now the child in the back room who
 * is not getting better is a reason to go to the mire, and the daughter who has not
 * written is a reason to go south, and neither of those is anybody's trade.
 *
 * @param person Whose bond it is
 * @returns A want built from it, or undefined if that bond asks nothing of anybody
 */
function bondWant(person: Person): Want | undefined {
  const index = BONDS.indexOf(person.bond);

  const wants: readonly (Want | undefined)[] = [
    // A daughter sent south, who has not written.
    {
      kind: ErrandKind.FIND,
      days: 7,
      ask: () =>
        'I sent my daughter south before the burnings and she has not written, and I have stopped telling myself what that means. You are going that way. Ask at the crossing. Ask anybody.',
      task: (where) => `Ask after her, out toward ${where}`,
      cost: 'They have stopped asking travellers. That is the part that tells you what they have decided.',
      reward: { knowledge: true },
    },
    // A brother hanged at the same tree, on the same morning.
    {
      kind: ErrandKind.FIND,
      days: 6,
      ask: () =>
        'They hanged my brother the same morning they hanged you. Same tree. He is still on it, or he is under it, and either way somebody who has been up there ought to be the one who goes.',
      task: (where) => `Find what is left of him, out in ${where}`,
      cost: 'Nobody went. They have not said so, but they have stopped looking at your throat, which is worse.',
      reward: { knowledge: true },
    },
    // The last marked man who came through.
    {
      kind: ErrandKind.FIND,
      days: 5,
      ask: () =>
        'There was a man through here last winter with the same weal on him as you. He went out that way. I would like to know what became of him, and I think you would too.',
      task: (where) => `Find where he got to, out in ${where}`,
      cost: 'Whatever became of him became of him unwitnessed, which is what they are all afraid of.',
      reward: { knowledge: true },
    },
    // Four generations of ground.
    {
      kind: ErrandKind.CLEAR,
      days: 5,
      ask: () =>
        'My family has worked that ground for four generations and something has been on it since the thaw. I am too old to go up and I will not sell it. Go and stand on it and see.',
      task: (where) => `Walk their ground in ${where} and see what is on it`,
      cost: 'They have let it go. Four generations, and it goes back to thorn in one season.',
      reward: { items: { copper_coins: 3, dried_meat: 2 } },
    },
    // The child in the back room.
    {
      kind: ErrandKind.FETCH,
      item: 'feverfew',
      terrain: TerrainType.SWAMP,
      days: 3,
      ask: () =>
        'There is a child in the back room who is not getting better and I have run out of things to try. Feverfew. It grows in the sour ground and I cannot leave the house.',
      task: (where) => `Bring feverfew from ${where}`,
      cost: 'The back room is quiet now. Nobody in the house has said anything about it to anybody.',
      reward: { items: { herbal_poultice: 1, bandage: 2 } },
    },
    // A debt in the next village.
    {
      kind: ErrandKind.FETCH,
      item: 'copper_coins',
      quantity: 2,
      days: 6,
      ask: () =>
        'I owe money in the next village and I cannot go there and I cannot pay it. If you can put two coins in my hand I can send them and stop being a man who owes.',
      task: () => 'Bring them two coins',
      cost: 'Word came from the next village about what is owed. They did not put it politely.',
      reward: { knowledge: true },
    },
    // The chapel bell.
    {
      kind: ErrandKind.FIND,
      days: 6,
      ask: () =>
        'They took the bell out of our chapel and carted it off and nobody will say where. A parish without a bell cannot call anybody in off the road after dark. Find out where it went.',
      task: (where) => `Find where the bell went, out toward ${where}`,
      cost: 'No bell, and the nights are longer than they were. People stopped going out after dusk at all.',
      reward: { items: { copper_coins: 2 }, knowledge: true },
    },
  ];

  return index >= 0 ? wants[index] : undefined;
}

/**
 * Whether somebody has anything they want doing right now.
 *
 * @param state Current game state
 * @param person The person
 * @returns Their open errand, if they have one
 */
export function errandOf(state: GameState, person: Person): Errand | undefined {
  return state.errands.find(
    (errand) =>
      errand.personId === person.id &&
      (errand.state === ErrandState.OFFERED || errand.state === ErrandState.ACCEPTED)
  );
}

/**
 * Raises a want, if this person has one they have not raised lately.
 *
 * The want is checked against the world before it becomes an errand: nobody asks for
 * feverfew in a world with no mire in it, because there would be no way to bring any.
 *
 * @param state Mutable game state
 * @param person Whose want it is
 * @returns The errand raised, or undefined
 */
export function raiseErrand(state: GameState, person: Person): Errand | undefined {
  if (errandOf(state, person)) return undefined;

  // What holds a person comes before what they do for a living, when they have been
  // measured -- somebody who has let you see what they care about asks you for that,
  // not for firewood.
  const personal = person.read ? bondWant(person) : undefined;
  const wants = WANTS[person.role];
  if (!personal && (!wants || wants.length === 0)) return undefined;

  const want =
    personal && state.rng.nextFloat() < BOND_ERRAND_CHANCE
      ? personal
      : wants[state.rng.nextInt(0, wants.length - 1)];

  // Somewhere the answer actually is. For a fetch, that is the country the thing grows
  // in; for anything else, it is somewhere out from the village.
  const place = want.terrain ? findTerrain(state, person, want.terrain) : findOpenGround(state, person);
  if (!place) return undefined;

  const where = want.terrain
    ? `${TERRAIN_NAME[want.terrain]} ${bearing(person, place)}`
    : `${TERRAIN_NAME[state.map[place.y][place.x].terrain]} ${bearing(person, place)}`;

  const errand: Errand = {
    id: `${person.id}:${state.tick}`,
    personId: person.id,
    kind: want.kind,
    ask: want.ask(person),
    task: want.task(where),
    item: want.item,
    quantity: want.quantity ?? 1,
    x: place.x,
    y: place.y,
    dueAt: state.tick + want.days * HOURS_PER_DAY + ERRAND_DEADLINE_HOURS,
    reward: want.reward,
    cost: want.cost,
    state: ErrandState.OFFERED,
  };

  state.errands.push(errand);
  return errand;
}

/**
 * Reports whether an errand can be discharged where the character is standing.
 *
 * @param state Current game state
 * @param errand The errand
 * @returns true if doing it now would complete it
 */
export function canDischarge(state: GameState, errand: Errand): boolean {
  const inventory = state.entities.getComponent<InventoryComponent>(
    state.playerId,
    'inventory'
  );

  switch (errand.kind) {
    case ErrandKind.FETCH:
    case ErrandKind.FEED:
      return (
        inventory !== undefined &&
        errand.item !== undefined &&
        countItem(inventory, errand.item) >= errand.quantity
      );

    case ErrandKind.FIND:
    case ErrandKind.CLEAR:
      // These are done out in the country, and are marked as done when the character
      // gets there; discharging them at the village is only reporting back.
      return errand.state === ErrandState.DONE;

    default:
      return false;
  }
}

/**
 * Completes an errand and pays for it.
 *
 * @param state Mutable game state
 * @param errand The errand being discharged
 * @returns Events describing what it was worth
 */
export function dischargeErrand(state: GameState, errand: Errand): GameEvent[] {
  const events: GameEvent[] = [];
  const person = personById(state.people, errand.personId);
  if (!person) return events;

  const inventory = state.entities.getComponent<InventoryComponent>(
    state.playerId,
    'inventory'
  );

  if (errand.item && inventory) {
    removeItem(inventory, errand.item, errand.quantity);
  }

  errand.state = ErrandState.DONE;
  person.disposition = clamp(person.disposition + ERRAND_DISPOSITION_DONE, -100, 100);

  const told = narrate(
    state,
    `${person.name} takes it without much ceremony. Whatever was going to happen here now does not have to.`
  );
  events.push({
    tick: state.tick,
    type: 'system',
    message: told.text,
    data: { errand: errand.id, person: person.id, state: ErrandState.DONE },
  });

  // What is owed.
  if (errand.reward.items && inventory) {
    const given: string[] = [];
    for (const [item, quantity] of Object.entries(errand.reward.items)) {
      if (addItem(inventory, item, quantity) > 0) {
        given.push(`${getItem(item)?.name ?? item} ×${quantity}`);
      }
    }
    if (given.length > 0) {
      events.push({
        tick: state.tick,
        type: 'system',
        message: `They press what they can spare on you: ${given.join(', ')}.`,
        data: { reward: errand.reward.items },
      });
    }
  }

  if (errand.reward.copper && inventory) {
    inventory.copper += errand.reward.copper;
    events.push({
      tick: state.tick,
      type: 'system',
      message: `They count it out where you can see them counting it. (+${errand.reward.copper} copper)`,
      data: { paid: errand.reward.copper },
    });
  }

  if (errand.reward.knowledge) {
    events.push(...tellAboutAVigil(state, person));
  }

  return events;
}

/**
 * Somebody who owes you tells you something worth more than goods.
 *
 * The vigils are the only thing in the game a player genuinely cannot find by walking
 * in a straight line, so knowing where one is is the strongest currency the villages
 * have -- and it comes from being owed a favour, which is the point.
 */
function tellAboutAVigil(state: GameState, person: Person): GameEvent[] {
  const unknown = state.reckoning.vigils.filter(
    (vigil) => !state.map[vigil.y]?.[vigil.x]?.explored
  );
  if (unknown.length === 0) return [];

  const vigil = unknown[state.rng.nextInt(0, unknown.length - 1)];
  // Told, not shown: the ground itself is marked as known so the chart carries it.
  const tile = state.map[vigil.y]?.[vigil.x];
  if (tile) tile.explored = true;

  return [
    {
      tick: state.tick,
      type: 'system',
      message: `${person.name} tells you what nobody in the village will say twice: where ${vigil.name} stands, and how to know it. It is on your chart now.`,
      data: { vigil: vigil.id, from: person.id },
    },
  ];
}

/**
 * Lets an errand lapse, and makes the world worse for it.
 *
 * @param state Mutable game state
 * @param errand The errand that ran out of time
 * @returns Events describing what came of it
 */
export function failErrand(state: GameState, errand: Errand): GameEvent[] {
  errand.state = ErrandState.FAILED;

  const person = personById(state.people, errand.personId);
  if (!person) return [];

  // Only somebody who was actually asked can be let down.
  const penalty = errand.state === ErrandState.FAILED ? ERRAND_DISPOSITION_FAILED : 0;
  person.disposition = clamp(person.disposition + penalty, -100, 100);

  const told = narrate(state, errand.cost);
  return [
    {
      tick: state.tick,
      type: 'danger',
      message: `${person.name}, ${ROLE_TITLE[person.role]} of ${person.place}: ${told.text}`,
      data: { errand: errand.id, person: person.id, state: ErrandState.FAILED },
    },
  ];
}

/**
 * Finds the nearest country of a kind, so a want points somewhere real.
 */
function findTerrain(
  state: GameState,
  from: Person,
  terrain: TerrainType
): { x: number; y: number } | null {
  let best: { x: number; y: number; distance: number } | null = null;

  // A coarse sweep: the errand only needs somewhere plausible, not the nearest tile.
  for (let y = 0; y < state.mapHeight; y += 3) {
    for (let x = 0; x < state.mapWidth; x += 3) {
      if (state.map[y][x].terrain !== terrain) continue;
      const distance = Math.max(Math.abs(x - from.x), Math.abs(y - from.y));
      if (!best || distance < best.distance) best = { x, y, distance };
    }
  }

  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Finds somewhere out from the village for an errand that is simply somewhere.
 */
function findOpenGround(state: GameState, from: Person): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 60; attempt++) {
    const distance = state.rng.nextInt(6, 14);
    const angle = state.rng.nextFloat() * Math.PI * 2;
    const x = Math.round(from.x + Math.cos(angle) * distance);
    const y = Math.round(from.y + Math.sin(angle) * distance);

    if (x < 0 || y < 0 || x >= state.mapWidth || y >= state.mapHeight) continue;
    if (state.map[y][x].terrain === TerrainType.WATER) continue;
    return { x, y };
  }
  return null;
}

/**
 * Names roughly which way something lies, for somebody giving directions.
 */
function bearing(from: Person, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const vertical = Math.abs(dy) * 2 >= Math.abs(dx) ? (dy < 0 ? 'north' : 'south') : '';
  const horizontal = Math.abs(dx) * 2 >= Math.abs(dy) ? (dx < 0 ? 'west' : 'east') : '';
  const compass = [vertical, horizontal].filter(Boolean).join('-');
  return compass ? `to the ${compass}` : 'nearby';
}
