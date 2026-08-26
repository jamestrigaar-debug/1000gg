import type { GameState } from '../state/GameState';
import type { InventoryComponent, MarkComponent, StatsComponent } from '../ecs/Component';
import type { GameEvent } from '../../events/GameEvent';
import { getItem } from '../lore/Items';
import { savingThrow } from '../state/Checks';
import { Ability } from '../rules/Abilities';
import { roll } from '../rules/Dice';
import { clamp } from '../../utils/math';
import { narrate } from './Narrator';
import {
  MARK_MAX,
  MARK_MIN,
  THREAD_FESTER_DC,
  THREAD_FOLLOW_HOURS,
  THREAD_LOST_HOURS,
  THREAD_MARK_SPIKE,
  THREAD_WOUND_DICE,
  THREAD_WOUND_HOURS,
  MIN_STAT_VALUE,
} from '../SimulationConstants';

/**
 * Narrative threads: the difference between things happening and a story.
 *
 * A table that answers each question in isolation produces a run that reads as a list.
 * Nothing that happened on the second day has any bearing on the sixth, so nothing
 * accumulates and nothing is dreaded. Solo tabletop play solves this with threads --
 * open questions the game keeps and returns to -- and that is what this is.
 *
 * When something takes an interest in the character, or a wound is left untreated, or
 * something is lost on the road, a thread is opened with a time on it. The world comes
 * back to it later, and the payoff is a real event rather than a line of prose: the
 * follower arrives, the wound festers, the lost thing turns up somewhere it should not
 * be. Threads are saved with the run, so this survives a reload.
 */

/** What kind of open question a thread represents. */
export enum ThreadKind {
  /** Something has taken an interest and has not been shaken */
  FOLLOWED = 'followed',
  /** A wound that was not seen to */
  WOUND = 'wound',
  /** Something dropped or taken on the road */
  LOST = 'lost',
  /** The debt itself, stirring */
  DEBT = 'debt',
}

/**
 * One open question the world intends to return to.
 */
export interface Thread {
  /** Unique within a run */
  readonly id: string;
  readonly kind: ThreadKind;
  /** Tick the thread was opened at */
  readonly opened: number;
  /** Tick the world means to pay it off */
  dueAt: number;
  /** What the thread is about: an item id, a place, a name */
  readonly subject?: string;
}

/**
 * How long each kind of thread waits before it pays off.
 */
const THREAD_DELAY: Record<ThreadKind, number> = {
  [ThreadKind.FOLLOWED]: THREAD_FOLLOW_HOURS,
  [ThreadKind.WOUND]: THREAD_WOUND_HOURS,
  [ThreadKind.LOST]: THREAD_LOST_HOURS,
  [ThreadKind.DEBT]: THREAD_FOLLOW_HOURS * 2,
};

/**
 * Opens a thread, unless one of that kind about that subject is already open.
 *
 * Threads do not stack. A character being followed by two things at once is not more
 * frightening than being followed by one; it is just noisier.
 *
 * @param state Mutable game state
 * @param kind What kind of question is open
 * @param subject What it is about, if anything
 * @returns The thread, whether newly opened or already running
 */
export function openThread(state: GameState, kind: ThreadKind, subject?: string): Thread {
  const existing = state.threads.find((t) => t.kind === kind && t.subject === subject);
  if (existing) {
    // Something happening again pushes the reckoning of it back, rather than doubling it.
    existing.dueAt = state.tick + THREAD_DELAY[kind];
    return existing;
  }

  const thread: Thread = {
    id: `${kind}:${state.tick}:${state.threads.length}`,
    kind,
    opened: state.tick,
    dueAt: state.tick + THREAD_DELAY[kind],
    subject,
  };
  state.threads.push(thread);
  return thread;
}

/**
 * Closes a thread by id.
 * @param state Mutable game state
 * @param id Thread id
 */
export function closeThread(state: GameState, id: string): void {
  const index = state.threads.findIndex((t) => t.id === id);
  if (index >= 0) state.threads.splice(index, 1);
}

/**
 * Reports whether a kind of thread is open.
 * @param state Game state
 * @param kind Kind to look for
 * @returns true if one is open
 */
export function hasThread(state: GameState, kind: ThreadKind): boolean {
  return state.threads.some((t) => t.kind === kind);
}

/**
 * Pays off every thread that has come due.
 *
 * Called once per turn by the narrative system. Each payoff both narrates and changes
 * the world, because a thread that resolves into a sentence is only a slower table.
 *
 * @param state Mutable game state
 * @returns Events describing what came due
 */
export function settleThreads(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.gameOver) return events;

  // Copied, because paying a thread off can open another.
  for (const thread of [...state.threads]) {
    if (state.tick < thread.dueAt) continue;
    if (state.gameOver) break;

    switch (thread.kind) {
      case ThreadKind.FOLLOWED:
        events.push(...settleFollowed(state, thread));
        break;
      case ThreadKind.WOUND:
        events.push(...settleWound(state, thread));
        break;
      case ThreadKind.LOST:
        events.push(...settleLost(state, thread));
        break;
      case ThreadKind.DEBT:
        events.push(...settleDebt(state, thread));
        break;
    }
  }

  return events;
}

/**
 * Whatever has been following either closes, or is lost -- and the difference is
 * decided by how brightly the character is burning.
 */
function settleFollowed(state: GameState, thread: Thread): GameEvent[] {
  closeThread(state, thread.id);

  const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
  const heat = (mark?.intensity ?? 0) / MARK_MAX;

  // A cold character loses it. A burning one does not.
  if (state.rng.nextFloat() > heat) {
    const told = narrate(
      state,
      'Whatever was keeping pace with you is not keeping pace with you any more. You do not know when it stopped.'
    );
    return [
      {
        tick: state.tick,
        type: 'system',
        message: told.text,
        data: { thread: thread.kind, resolved: 'lost_it', unreliable: told.unreliable },
      },
    ];
  }

  // It closes: the encounter system is told to stop being patient.
  state.stalkedUntil = state.tick + THREAD_FOLLOW_HOURS;
  if (mark) {
    mark.intensity = clamp(mark.intensity + THREAD_MARK_SPIKE, MARK_MIN, MARK_MAX);
  }

  const told = narrate(
    state,
    'It has finished making up its mind about you. Whatever has been walking behind you since is not behind you any more.'
  );
  return [
    {
      tick: state.tick,
      type: 'danger',
      message: told.text,
      data: { thread: thread.kind, resolved: 'closing', unreliable: told.unreliable },
    },
  ];
}

/**
 * An untreated wound either festers or knits, on a Constitution save.
 */
function settleWound(state: GameState, thread: Thread): GameEvent[] {
  const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
  if (!stats || stats.hp <= 0) {
    closeThread(state, thread.id);
    return [];
  }

  const save = savingThrow(state, Ability.CON, THREAD_FESTER_DC);

  if (save.success) {
    closeThread(state, thread.id);
    const told = narrate(state, 'The wound has closed over. Badly, but closed.', {
      mechanical: `(Constitution save DC ${THREAD_FESTER_DC}: ${save.total})`,
    });
    return [
      {
        tick: state.tick,
        type: 'system',
        message: told.text,
        data: { thread: thread.kind, resolved: 'knit', unreliable: told.unreliable },
      },
    ];
  }

  // It gets worse, and it will ask again.
  const damage = roll(state.rng, THREAD_WOUND_DICE).total;
  stats.hp = Math.max(MIN_STAT_VALUE, stats.hp - damage);
  thread.dueAt = state.tick + THREAD_WOUND_HOURS;

  const told = narrate(state, 'The wound has gone bad. You can smell it before you see it.', {
    mechanical: `(Constitution save DC ${THREAD_FESTER_DC}: ${save.total}. -${damage} hp)`,
  });
  return [
    {
      tick: state.tick,
      type: 'danger',
      message: told.text,
      data: { thread: thread.kind, resolved: 'festers', damage, unreliable: told.unreliable },
    },
  ];
}

/**
 * Something lost on the road turns up again, in the worst way available.
 */
function settleLost(state: GameState, thread: Thread): GameEvent[] {
  closeThread(state, thread.id);

  const name = thread.subject ? (getItem(thread.subject)?.name ?? thread.subject) : 'it';
  const inventory = state.entities.getComponent<InventoryComponent>(
    state.playerId,
    'inventory'
  );

  // Half the time the road gives it back. The rest of the time it is being carried.
  if (inventory && state.rng.nextFloat() < 0.5) {
    inventory.items[thread.subject ?? ''] = (inventory.items[thread.subject ?? ''] ?? 0) + 1;
    const told = narrate(
      state,
      `You come across your own ${name.toLowerCase()} in the mud, a day's walk from where you lost it.`
    );
    return [
      {
        tick: state.tick,
        type: 'system',
        message: told.text,
        data: { thread: thread.kind, resolved: 'recovered', item: thread.subject },
      },
    ];
  }

  const told = narrate(
    state,
    `Something on the treeline is carrying your ${name.toLowerCase()}. It wants you to see that it is.`
  );
  openThread(state, ThreadKind.FOLLOWED);
  return [
    {
      tick: state.tick,
      type: 'danger',
      message: told.text,
      data: { thread: thread.kind, resolved: 'taken', item: thread.subject },
    },
  ];
}

/**
 * The debt stirs: the Mark spikes wherever the character happens to be standing.
 */
function settleDebt(state: GameState, thread: Thread): GameEvent[] {
  closeThread(state, thread.id);

  const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
  if (!mark) return [];

  const before = mark.intensity;
  mark.intensity = clamp(mark.intensity + THREAD_MARK_SPIKE, MARK_MIN, MARK_MAX);

  const told = narrate(state, 'The weal opens without being touched, and closes again.', {
    mechanical: `(mark ${Math.round(before)} → ${Math.round(mark.intensity)})`,
  });
  return [
    {
      tick: state.tick,
      type: 'danger',
      message: told.text,
      data: { thread: thread.kind, resolved: 'stirred', unreliable: told.unreliable },
    },
  ];
}
