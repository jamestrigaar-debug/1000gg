import type { GameState } from '../state/GameState';
import type { GameEvent } from '../../events/GameEvent';
import type { Person } from '../world/People';
import { Role } from '../world/People';
import type { Site } from '../world/Sites';
import { InstanceKind } from '../dm/Instance';
import { ErrandKind, ErrandState } from './Errands';
import type { Errand } from './Errands';
import { recordEvent } from '../state/GameState';
import { HOURS_PER_DAY } from '../SimulationConstants';
import { CHARGE_RANGE, CHARGE_DAYS } from '../SimulationConstants';

/**
 * The reason to go into the hill.
 *
 * The country has villages in it and places under it, and until now nothing connected
 * the two: a player could walk past a ruin for forty days without ever being told why
 * anybody would go in. A charge is that telling. Somebody in a village has a problem,
 * the problem has an address, and the address is a door.
 *
 * These are errands -- the same structure, the same deadline, the same reporting back --
 * but where an ordinary errand asks for feverfew from the mire, a charge asks for
 * something out of a place that will fight to keep it.
 */

/** What sort of thing a village wants doing about the place down the road. */
export interface ChargeTemplate {
  /** Which kinds of place this makes sense about */
  readonly places: readonly InstanceKind[];
  /** Which people ask for it */
  readonly askers: readonly Role[];
  /** How they put it, with the place's name folded in */
  readonly ask: (place: string) => string;
  /** What it will take, in a line the player can act on */
  readonly task: (place: string) => string;
  /** Whether it is finished by clearing the place or by reaching it */
  readonly kind: ErrandKind;
  /** What is owed, in copper, before the place's own difficulty is weighed */
  readonly pay: number;
  /** What happens to them if nobody does it */
  readonly cost: string;
}

/**
 * The charges a village can lay on somebody.
 *
 * Written as the parish would put it rather than as a quest log would: nobody says
 * "clear the dungeon", they say the thing that has been happening to them.
 */
export const CHARGES: readonly ChargeTemplate[] = [
  {
    places: [InstanceKind.BANDIT_CAMP],
    askers: [Role.REEVE, Role.DROVER, Role.SMITH],
    ask: (place) =>
      `"They have the road out of here, and they have had it since the spring. ${place}, if you want the name of it. Nobody is coming."`,
    task: (place) => `Put the men at ${place} off the road`,
    kind: ErrandKind.CLEAR,
    pay: 90,
    cost: 'The road stays shut, and this place starves quietly.',
  },
  {
    places: [InstanceKind.CAVE, InstanceKind.DUNGEON],
    askers: [Role.WIDOW, Role.PRIEST, Role.MIDWIFE],
    ask: (place) =>
      `"Something is coming up out of ${place} and it is taking what it likes. We have stopped keeping animals on that side."`,
    task: (place) => `Deal with whatever is under ${place}`,
    kind: ErrandKind.CLEAR,
    pay: 110,
    cost: 'It comes further in, and the far fields go out of use.',
  },
  {
    places: [InstanceKind.RUIN],
    askers: [Role.PRIEST, Role.REEVE],
    ask: (place) =>
      `"There is writing on the stones at ${place} and somebody has been answering it. I would know what is being said before it is finished being said."`,
    task: (place) => `Find out what is at ${place}`,
    kind: ErrandKind.FIND,
    pay: 70,
    cost: 'Whatever is being written there gets finished.',
  },
  {
    places: [InstanceKind.BANDIT_CAMP, InstanceKind.CAVE],
    askers: [Role.WIDOW, Role.BOY, Role.MIDWIFE],
    ask: (place) =>
      `"They took my brother down toward ${place} eleven days ago. I am not asking you to bring him back. I am asking you to find out."`,
    task: (place) => `Find out what became of the one taken to ${place}`,
    kind: ErrandKind.FIND,
    pay: 60,
    cost: 'Nobody ever learns, which is its own kind of wound.',
  },
  {
    places: [InstanceKind.HOLDFAST],
    askers: [Role.REEVE, Role.BEGGAR],
    ask: (place) =>
      `"The Chain keeps a house at ${place}. They took two from here last month and the month before that. Nobody in this parish will say this out loud but me."`,
    task: (place) => `See what is being done at ${place}`,
    kind: ErrandKind.FIND,
    pay: 130,
    cost: 'They come again next month, and the month after.',
  },
  {
    places: [InstanceKind.DEEP_WOOD],
    askers: [Role.DROVER, Role.BOY, Role.SMITH],
    ask: (place) =>
      `"You can walk into ${place} on a straight path and come out somewhere you did not aim for. We have lost sheep and we have lost a man."`,
    task: (place) => `Walk into ${place} and come out the other side`,
    kind: ErrandKind.FIND,
    pay: 80,
    cost: 'The wood keeps what it takes and takes a little more each season.',
  },
];

/**
 * Finds a charge somebody here might lay on the character.
 *
 * Only about a place near enough to be worth walking to, only from somebody who would
 * plausibly ask, and only about somewhere that has not already been dealt with.
 *
 * @param state Game state
 * @param person Who is doing the asking
 * @returns The charge, or undefined if this person has nothing of the sort to ask
 */
export function raiseCharge(state: GameState, person: Person): Errand | undefined {
  const already = state.errands.find(
    (errand) =>
      errand.personId === person.id &&
      (errand.state === ErrandState.OFFERED || errand.state === ErrandState.ACCEPTED)
  );
  if (already) return undefined;

  // Somewhere near this village with something still in it.
  const near = state.sites
    .filter((site) => site.instance !== undefined && !site.spent)
    .filter((site) => {
      const away = Math.max(Math.abs(site.x - person.x), Math.abs(site.y - person.y));
      return away <= CHARGE_RANGE;
    })
    .sort(
      (a, b) =>
        Math.max(Math.abs(a.x - person.x), Math.abs(a.y - person.y)) -
        Math.max(Math.abs(b.x - person.x), Math.abs(b.y - person.y))
    );

  if (near.length === 0) return undefined;

  for (const site of near) {
    const template = CHARGES.find(
      (candidate) =>
        candidate.places.includes(site.instance!) && candidate.askers.includes(person.role)
    );
    if (!template) continue;
    if (state.errands.some((errand) => errand.id === chargeId(person, site))) continue;

    // Being told where somewhere is, is knowing where it is. The ask names the place, so
    // the character can set out for it -- without this a village would name a ruin in
    // the same breath as refusing to let you walk to it.
    site.seen = true;

    return {
      id: chargeId(person, site),
      personId: person.id,
      kind: template.kind,
      ask: template.ask(site.name),
      task: template.task(site.name),
      quantity: 1,
      x: site.x,
      y: site.y,
      dueAt: state.tick + CHARGE_DAYS * HOURS_PER_DAY,
      // A place that fights back pays better than a place that does not, and the coin
      // is the reason a village can ask a stranger for something like this at all.
      reward: { copper: template.pay },
      cost: template.cost,
      state: ErrandState.OFFERED,
    };
  }

  return undefined;
}

/** A charge is one person asking about one place, which is what makes it unique. */
function chargeId(person: Person, site: Site): string {
  return `charge:${person.id}:${site.id}`;
}

/**
 * Marks a charge done when the character finishes the place it was about.
 *
 * A charge to clear somewhere is discharged by clearing it; a charge to find out what is
 * there is discharged by getting there and looking. Both are then reported back, which
 * is where the coin changes hands.
 *
 * @param state Game state
 * @param x Where the place is
 * @param y Where the place is
 * @param cleared Whether the thing the place was about has been put down
 * @returns Anything worth saying about it
 */
export function answerCharges(
  state: GameState,
  x: number,
  y: number,
  cleared: boolean
): GameEvent[] {
  const events: GameEvent[] = [];

  for (const errand of state.errands) {
    if (errand.state !== ErrandState.ACCEPTED) continue;
    if (errand.x !== x || errand.y !== y) continue;
    if (errand.kind === ErrandKind.CLEAR && !cleared) continue;

    errand.state = ErrandState.DONE;
    const who = state.people.find((person) => person.id === errand.personId);

    const event: GameEvent = {
      tick: state.tick,
      type: 'system',
      message: `That is what ${who?.name ?? 'somebody'} asked about. ${
        who ? `They are in ${who.place}.` : ''
      }`.trim(),
      data: { chargeAnswered: errand.id },
    };
    recordEvent(state, event);
    events.push(event);
  }

  return events;
}

/** Whether an errand is a charge rather than an ordinary want. */
export function isCharge(errand: Errand): boolean {
  return errand.id.startsWith('charge:');
}
