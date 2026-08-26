import type { GameState } from '../state/GameState';

/**
 * System interface for processing simulation stages over entities and game state.
 */
export interface System {
  /** Descriptive name of the system */
  readonly name: string;

  /**
   * Updates state during the simulation turn.
   * @param state Current game state
   */
  update(state: GameState): void;

  /**
   * Moves the system's internal tick cursor to a given tick without emitting any of the
   * events that would normally fire across the skipped interval.
   *
   * Systems that process elapsed hours keep a private cursor so that multi-hour jumps
   * are simulated hour by hour. After loading a saved game that cursor would otherwise
   * sit at zero and replay the entire history, so the simulation loop seeks every
   * system to the restored tick.
   *
   * @param tick Tick to treat as already processed
   */
  seek?(tick: number): void;
}
