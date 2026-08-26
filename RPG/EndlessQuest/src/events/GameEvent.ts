/**
 * Discrete game event payload broadcast through the EventBus and recorded in the game log.
 */
export interface GameEvent {
  /** Simulation tick (in elapsed hours) at which the event occurred */
  tick: number;
  /** Categorical event type identifier ('movement', 'system', 'rest', 'search', 'error', etc.) */
  type: string;
  /** Human-readable event description */
  message: string;
  /** Optional structured event metadata */
  data?: Record<string, unknown>;
}
