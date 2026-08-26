import type { System } from '../../ecs/System';
import type { GameState } from '../../state/GameState';
import { recordEvent } from '../../state/GameState';
import type { PositionComponent } from '../../ecs/Component';
import { EventBus } from '../../../events/EventBus';
import { ErrandKind, ErrandState, failErrand } from '../../narrative/Errands';
import { personById } from '../../world/People';
import { ERRAND_SITE_RADIUS } from '../../SimulationConstants';

/**
 * Runs the villages' clock.
 *
 * Two things happen here that make an errand more than a note in a journal. The first is
 * that deadlines are real: when one passes, the errand does not lapse quietly, it fails,
 * and something in the world is worse for it and the person who asked remembers.
 *
 * The second is that errands which are about a place notice when the character reaches
 * it. Nobody has to be told they have arrived at the spot where the widow's husband is
 * lying; walking there is the whole of the doing, and the errand marks itself.
 */
export class ErrandSystem implements System {
  readonly name = 'ErrandSystem';
  private eventBus: EventBus;
  private lastProcessedTick: number = -1;

  /**
   * @param eventBus EventBus used to broadcast what became of an errand
   */
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Moves the cursor without running the intervening hours.
   * @param tick Tick to treat as already processed
   */
  seek(tick: number): void {
    this.lastProcessedTick = tick;
  }

  /**
   * Expires what has run out of time and notices what has been reached.
   * @param state Current GameState
   */
  update(state: GameState): void {
    if (state.gameOver || state.tick === this.lastProcessedTick) return;
    this.lastProcessedTick = state.tick;

    this.noticeArrivals(state);

    for (const errand of state.errands) {
      const open =
        errand.state === ErrandState.OFFERED || errand.state === ErrandState.ACCEPTED;
      if (!open || state.tick < errand.dueAt) continue;

      // An errand nobody agreed to still runs out, but only somebody who was actually
      // asked and said yes can be said to have let them down.
      const accepted = errand.state === ErrandState.ACCEPTED;
      for (const event of failErrand(state, errand)) {
        if (!accepted) {
          const person = personById(state.people, errand.personId);
          if (person) person.disposition = Math.min(100, person.disposition + 25);
        }
        recordEvent(state, event);
        this.eventBus.emit(event);
      }
    }
  }

  /**
   * Marks the errands whose doing is simply being there.
   */
  private noticeArrivals(state: GameState): void {
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    if (!pos) return;

    for (const errand of state.errands) {
      if (errand.state !== ErrandState.ACCEPTED) continue;
      if (errand.kind !== ErrandKind.FIND && errand.kind !== ErrandKind.CLEAR) continue;
      if (errand.x === undefined || errand.y === undefined) continue;

      const distance = Math.max(Math.abs(pos.x - errand.x), Math.abs(pos.y - errand.y));
      if (distance > ERRAND_SITE_RADIUS) continue;

      errand.state = ErrandState.DONE;

      const event = {
        tick: state.tick,
        type: 'system',
        message:
          errand.kind === ErrandKind.FIND
            ? 'This is the place. You do what there is to do, and it does not take long, and it is not nothing. Somebody should be told.'
            : 'You have walked the ground they meant. Whatever was working it has moved on, or is under you. Somebody should be told.',
        data: { errand: errand.id, arrived: true },
      };
      recordEvent(state, event);
      this.eventBus.emit(event);
    }
  }
}
