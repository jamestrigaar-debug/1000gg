/* ============================================================================
 * WORKER PROTOCOL — the only conversation the sim and the view ever have.
 *
 * The flow the Manager asks for:
 *
 *   simulate   run the whole match headlessly and build the report: the score,
 *              the stats, and the reel. Nothing is drawn and nothing is shown
 *              yet — the match is finished but the user has not seen it.
 *   playReel   play the reel, passage after passage, as one continuous piece
 *              of football. The worker seeks between passages itself, so the
 *              screen never has to ask for the next one. This is the match:
 *              the result is not announced, it arrives.
 *   skip       abandon the passage being played and cut to the next.
 *   skipAll    abandon the reel and go straight to the result.
 *   watch      play ONE passage, for clicking a line back after full time.
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
  /** Play the reel end to end, starting at `from` (default 0). */
  | { type: "playReel"; from?: number }
  /** Play one passage and stop. */
  | { type: "watch"; index: number }
  /** Cut to the next passage. */
  | { type: "skip" }
  /** Abandon the reel; the screen reveals the result. */
  | { type: "skipAll" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "speed"; scale: number }
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
  /**
   * One frame of football.
   *
   * `cut` marks a snapshot that does not continue the previous one — the
   * first frame of a passage, on the far side of the silent fast-forward
   * between them. The renderer throws its interpolation buffer away when it
   * sees one, rather than smearing the players across the pitch.
   *
   * `timeScale` is how many seconds of match time one second of wall time is
   * currently worth. The renderer used to infer this from how far apart
   * snapshots arrived, which made every timer hiccup look like a change of
   * speed; being told outright is what lets the picture run smoothly.
   */
  | { type: "snapshot"; snapshot: RenderSnapshot; cut: boolean; timeScale: number }
  /** A passage of the reel has started playing. */
  | { type: "reelEnter"; index: number }
  /** A highlight's window has finished playing. */
  | { type: "highlightEnded"; index: number }
  /** The reel is over — either it ran out or it was skipped to the end. */
  | { type: "reelEnded"; skipped: boolean }
  | { type: "error"; message: string };

/**
 * Snapshots posted per second of wall time, and the fixed slice of match time
 * each one advances at 1x.
 *
 * These are a pair, and that is the point. The playback loop advances the
 * simulation by exactly SNAPSHOT_DT * speed every frame — never by however
 * much wall time happened to elapse — so consecutive snapshots are always the
 * same distance apart in match time. Wall-clock jitter is then absorbed by the
 * renderer's buffer instead of being baked into the simulation as a variable
 * timestep, which is what made the picture surge and stall.
 */
export const SNAPSHOT_HZ = 30;
export const SNAPSHOT_DT = 1 / SNAPSHOT_HZ;
