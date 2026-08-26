import type { System } from '../../ecs/System';
import type { GameState } from '../../state/GameState';
import { recordEvent } from '../../state/GameState';
import { EventBus } from '../../../events/EventBus';
import { settleThreads } from '../../narrative/Threads';

/**
 * Runs the story's own clock.
 *
 * Every other system models the world; this one models the telling of it. Once a turn it
 * asks whether any open thread has come due -- whether the thing that has been following
 * has made up its mind, whether the wound has gone bad, whether what was lost has turned
 * up being carried by something else -- and pays it off.
 *
 * It runs last, after time, needs, the Mark and encounters, so a thread pays off against
 * the world as the turn actually left it.
 */
export class NarrativeSystem implements System {
  readonly name = 'NarrativeSystem';
  private eventBus: EventBus;
  private lastProcessedTick: number = -1;

  /**
   * @param eventBus EventBus used to broadcast what came due
   */
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Moves the cursor without settling the intervening hours.
   * @param tick Tick to treat as already processed
   */
  seek(tick: number): void {
    this.lastProcessedTick = tick;
  }

  /**
   * Settles anything that has come due.
   * @param state Current GameState
   */
  update(state: GameState): void {
    if (state.gameOver || state.tick === this.lastProcessedTick) return;
    this.lastProcessedTick = state.tick;

    for (const event of settleThreads(state)) {
      recordEvent(state, event);
      this.eventBus.emit(event);
    }
  }
}
