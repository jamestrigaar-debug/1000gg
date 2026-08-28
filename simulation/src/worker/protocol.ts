/* ============================================================================
 * WORKER PROTOCOL — the only conversation the sim and the view ever have.
 *
 * The flow the Manager asks for, in three messages:
 *
 *   simulate   run the whole match headlessly and send back the report: the
 *              score, the stats, and the TEXT MATCH as a list of highlights.
 *              Nothing has been drawn at this point; the match is finished.
 *   watch      seek to a highlight's window and stream snapshots for it. This
 *              is the conversion of the text into the simulation — the same
 *              match, the same seed, the same events, now with a pitch.
 *   pause/speed control of that playback.
 *
 * The sim never sends its whole state and the renderer never sends simulation
 * state back: the boundary is what keeps "the simulation is the product" true.
 * ========================================================================== */

import type { MatchSetup, UserCommand } from "../core/types";
import type { RenderSnapshot } from "../core/snapshot";
import type { Highlight, HighlightMode } from "../core/highlights";
import type { PreMatch } from "../core/prematch";
import type { TeamStats } from "../core/stats";

export type ToWorker =
  | { type: "init"; setup: MatchSetup }
  /** Run the match to the final whistle and report. */
  | { type: "simulate"; mode: HighlightMode }
  /** Re-cut the reel at a different mode; no re-simulation needed. */
  | { type: "recut"; mode: HighlightMode }
  /** Play one highlight's window back in 2D. */
  | { type: "watch"; index: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "speed"; scale: number | "max" }
  | { type: "seek"; matchSecond: number }
  | { type: "command"; command: UserCommand };

export interface MatchReport {
  score: [number, number];
  possession: [number, number];
  team: [TeamStats, TeamStats];
  highlights: Highlight[];
  /** Per-player ratings, for the post-match panel. */
  ratings: { id: number; team: 0 | 1; rating: number; goals: number; assists: number }[];
  xgTimeline: [number, number, number][];
}

export type FromWorker =
  | { type: "ready"; preMatch: PreMatch }
  | { type: "progress"; fraction: number }
  | { type: "report"; report: MatchReport }
  | { type: "snapshot"; snapshot: RenderSnapshot }
  /** A highlight's window has finished playing. */
  | { type: "highlightEnded"; index: number }
  | { type: "error"; message: string };

/** Snapshots posted per second of wall time. 30 is plenty: the renderer
 *  interpolates, so a higher rate buys nothing but postMessage traffic. */
export const SNAPSHOT_HZ = 30;
