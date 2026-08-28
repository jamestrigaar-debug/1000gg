/* ============================================================================
 * HIGHLIGHTS — which passages of the match are worth watching, and when.
 *
 * A highlight is a WINDOW of match time, not an instant: a goal is worth ten
 * seconds of build-up and four of celebration. The window is what the 2D view
 * seeks to and plays, which is how the text match and the watched match end up
 * being the same match — the text says "43' Mensah hits the post", and
 * clicking it plays 00:42:52 to 00:43:06.
 *
 * Selection is a threshold on importance, which is what the four FM modes are:
 *   Key            goals, red cards, penalties
 *   Extended       + big chances, saves from big chances, woodwork
 *   Comprehensive  + every shot on target, every card
 *   Full           + everything the commentary tiers at all
 * ========================================================================== */

import type { MatchEvent } from "./events";
import type { CommentaryLine } from "./commentary";
import type { TeamSide } from "./types";

export type HighlightMode = "key" | "extended" | "comprehensive" | "full";

export interface Highlight {
  /** Match second the passage starts and ends at. */
  from: number;
  to: number;
  /** The moment itself, for the seek target and the minute label. */
  at: number;
  minute: number;
  importance: number;
  kind: string;
  team: TeamSide | null;
  text: string;
  /** Score after this passage, for the strip while watching it back. */
  score: [number, number];
}

const MODE_THRESHOLD: Record<HighlightMode, number> = {
  key: 3,
  extended: 2,
  comprehensive: 1,
  full: 0,
};

/** Seconds of build-up and aftermath each kind of moment deserves. */
const WINDOW: Record<string, { before: number; after: number }> = {
  goal: { before: 12, after: 6 },
  bigChance: { before: 10, after: 4 },
  post: { before: 10, after: 4 },
  save: { before: 8, after: 4 },
  penalty: { before: 4, after: 14 },
  shot: { before: 6, after: 3 },
  foul: { before: 5, after: 4 },
  corner: { before: 4, after: 8 },
  offside: { before: 6, after: 3 },
  kickOff: { before: 0, after: 6 },
  halfTime: { before: 6, after: 0 },
  fullTime: { before: 8, after: 0 },
};

const DEFAULT_WINDOW = { before: 6, after: 3 };

/**
 * Build the reel. Overlapping windows are merged so that a shot, the save and
 * the rebound goal that follows it play as one passage rather than three
 * jump-cuts of the same twelve seconds.
 */
export function buildHighlights(
  lines: readonly CommentaryLine[],
  events: readonly MatchEvent[],
  mode: HighlightMode = "extended",
): Highlight[] {
  const threshold = MODE_THRESHOLD[mode];
  const score: [number, number] = [0, 0];
  const goalsBySecond = new Map<number, [number, number]>();
  for (const e of events) {
    if (e.type === "Goal" && e.team !== null) {
      score[e.team]++;
      goalsBySecond.set(Math.floor(e.matchSecond), [score[0], score[1]]);
    }
  }

  const running: [number, number] = [0, 0];
  const picked: Highlight[] = [];
  for (const line of lines) {
    if (line.importance < threshold) continue;
    const at = line.matchSecond;
    const goalScore = goalsBySecond.get(Math.floor(at));
    if (goalScore) {
      running[0] = goalScore[0];
      running[1] = goalScore[1];
    }
    const w = WINDOW[line.kind] ?? DEFAULT_WINDOW;
    picked.push({
      from: Math.max(0, at - w.before),
      to: at + w.after,
      at,
      minute: line.minute,
      importance: line.importance,
      kind: line.kind,
      team: line.team,
      text: line.text,
      score: [running[0], running[1]],
    });
  }
  return mergeOverlaps(picked);
}

/** Merge windows that overlap, keeping the most important line as the label. */
function mergeOverlaps(highlights: Highlight[]): Highlight[] {
  if (highlights.length === 0) return [];
  const sorted = [...highlights].sort((a, b) => a.from - b.from);
  const out: Highlight[] = [];
  let current = { ...(sorted[0] as Highlight) };
  const extras: string[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i] as Highlight;
    if (next.from <= current.to) {
      const latestSoFar = current.at;
      current.to = Math.max(current.to, next.to);
      if (next.importance > current.importance) {
        // The bigger moment names the passage; the smaller one becomes the
        // build-up line under it.
        extras.push(current.text);
        current = { ...next, from: current.from, to: current.to, text: next.text };
      } else {
        extras.push(next.text);
      }
      /* The passage shows the score as it stood at its LAST moment, which is
       * not the same as the last line merged into it: windows are merged in
       * order of when they START, and a goal's window starts earlier than the
       * chance a second before it. Taking the later line's score by position
       * showed a goal in the text with the pre-goal score beside it. */
      if (next.at >= latestSoFar) {
        current.score = next.score;
        current.at = Math.max(current.at, next.at);
      }
    } else {
      out.push(withLeadIn(current, extras));
      extras.length = 0;
      current = { ...next };
    }
  }
  out.push(withLeadIn(current, extras));
  return out;
}

function withLeadIn(highlight: Highlight, extras: string[]): Highlight {
  if (extras.length === 0) return highlight;
  return { ...highlight, text: `${extras.join(" ")} ${highlight.text}`.trim() };
}

/** The reel's total watch time, for "Highlights (4m 12s)". */
export const reelDuration = (highlights: readonly Highlight[]): number =>
  highlights.reduce((total, h) => total + (h.to - h.from), 0);
