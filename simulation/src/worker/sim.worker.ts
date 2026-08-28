/* ============================================================================
 * SIM WORKER — owns the match, and the two things you can do with it.
 *
 * 1. SIMULATE. Run the whole 90 minutes as fast as the CPU allows, then derive
 *    the report — stats, ratings, commentary, highlights — from the event log.
 *    The result is the text match: a complete account of what happened, with
 *    no pitch drawn and no frames rendered.
 *
 * 2. WATCH. Take a highlight's window, restore the nearest keyframe before it,
 *    silently fast-forward to the start of the window, and then stream
 *    snapshots for the length of the passage. Because the keyframe carries the
 *    RNG cursor, what gets drawn is the same match the report describes — not
 *    a re-roll that happens to have the same scoreline.
 *
 * The core is a pure function of ticks; this file is the only place in the
 * simulation that knows what a second of wall-clock time is.
 * ========================================================================== */

import { PHYSICS_HZ } from "../core/constants";
import { buildCommentary } from "../core/commentary";
import { buildHighlights, type Highlight, type HighlightMode } from "../core/highlights";
import { MatchSim } from "../core/match";
import type { MatchEvent } from "../core/events";
import { buildPreMatch } from "../core/prematch";
import { buildStats } from "../core/stats";
import { loadFormations, loadPlaybook } from "../data";
import { styleProfile, styleMatchup } from "../manager/styles";
import type { MatchSetup } from "../core/types";
import {
  SNAPSHOT_DT,
  SNAPSHOT_HZ,
  type FromWorker,
  type MatchReport,
  type ToWorker,
} from "./protocol";

let sim: MatchSim | null = null;
let setup: MatchSetup | null = null;
let highlights: Highlight[] = [];
/**
 * THE MATCH RECORD — the event stream as it stood at the final whistle.
 *
 * Everything the user is shown (the score, the stats, the ratings, the
 * commentary, the reel) is derived from this and never from the live
 * simulation's log. That distinction is the whole fix for "the highlights
 * don't match what was selected": watching a passage back rewinds the sim and
 * replays it, which necessarily re-emits that passage's events, and watching
 * passages out of order leaves the live log a patchwork of whichever ones you
 * happened to click. Re-cutting Key to Full read that patchwork and produced a
 * reel for a match nobody had watched.
 *
 * Frozen once, at full time. Re-cutting is then a pure function of it.
 */
let record: readonly MatchEvent[] = [];
/** Possession share at the final whistle. Frozen for the same reason as the
 *  record: the live sim's possession counters rewind with every seek. */
let finalPossession: [number, number] = [0.5, 0.5];
let playing = false;
let scale = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
/** The window currently being played back, if any. */
let window: { index: number; from: number; to: number } | null = null;

const post = (msg: FromWorker): void => {
  (self as unknown as Worker).postMessage(msg);
};

const now = (): number => (typeof performance !== "undefined" ? performance.now() : 0);

self.onmessage = (ev: MessageEvent<ToWorker>): void => {
  try {
    handle(ev.data);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

function handle(msg: ToWorker): void {
  switch (msg.type) {
    case "init": {
      setup = msg.setup;
      sim = new MatchSim(msg.setup, { formations: loadFormations(), playbook: loadPlaybook() });
      post({ type: "ready", preMatch: preMatchFor(msg.setup) });
      break;
    }
    case "simulate": {
      if (!sim) return;
      simulate(msg.mode);
      break;
    }
    case "recut": {
      // Re-cutting never re-simulates and never touches the live sim: it is a
      // fresh pass over the frozen match record at a different threshold.
      if (record.length === 0 || !setup) return;
      post({ type: "report", report: buildReport(msg.mode) });
      break;
    }
    case "playReel":
      playReel(msg.from ?? 0);
      break;
    case "watch":
      watch(msg.index);
      break;
    case "skip":
      skip();
      break;
    case "skipAll":
      skipAll();
      break;
    case "resume":
      if (!window || playing) return;
      playing = true;
      nextFrameDue = now();
      schedule();
      break;
    case "pause":
      stopTimer();
      playing = false;
      break;
    case "speed":
      scale = msg.scale;
      // Re-anchor the schedule so a speed change takes effect on the next
      // frame rather than being applied to a backlog built at the old one.
      nextFrameDue = now();
      break;
    case "seek":
      seekTo(msg.matchSecond, true);
      break;
    case "command":
      sim?.applyCommand(msg.command);
      break;
  }
}

function preMatchFor(s: MatchSetup) {
  const homeStyle = s.homeTactics.instructions;
  const awayStyle = s.awayTactics.instructions;
  // The style name is not carried on the tactics object — the bridge sets the
  // instructions from it — so it is recovered by matching the profile, and
  // falls back to describing the sliders themselves.
  const describe = (ins: typeof homeStyle): string =>
    ins.pressing > 0.8
      ? "High Press"
      : ins.passingDirectness > 0.9
        ? "Route One"
        : ins.defensiveLine < 0.25
          ? "Park the Bus"
          : ins.counter
            ? "Counter"
            : ins.passingDirectness > 0.7
              ? "Direct"
              : "Possession";
  const homeName = describe(homeStyle);
  const awayName = describe(awayStyle);
  return buildPreMatch({
    home: s.home,
    away: s.away,
    homeTactics: s.homeTactics,
    awayTactics: s.awayTactics,
    formations: loadFormations(),
    homeStyle: homeName,
    awayStyle: awayName,
    homeStyleBlurb: styleProfile(homeName).blurb,
    awayStyleBlurb: styleProfile(awayName).blurb,
    homeAdvantage: 4,
    styleNote: styleMatchup(homeName, awayName),
  });
}

/** Run the match, reporting progress so the UI can show something honest. */
function simulate(mode: HighlightMode): void {
  if (!sim) return;
  const totalTicks = PHYSICS_HZ * 60 * 100;
  let lastReport = 0;
  while (!sim.finished && sim.tick < totalTicks) {
    sim.stepSeconds(60);
    const fraction = Math.min(sim.matchSecond / (95 * 60), 0.99);
    if (fraction - lastReport > 0.05) {
      lastReport = fraction;
      post({ type: "progress", fraction });
    }
  }
  // Freeze the match before anything is allowed to seek into it.
  record = sim.log.all().slice();
  finalPossession = sim.possessionShare();
  post({ type: "progress", fraction: 1 });
  post({ type: "report", report: buildReport(mode) });
}

function buildReport(mode: HighlightMode): MatchReport {
  if (!setup) throw new Error("no match to report on");
  const events = record;
  const stats = buildStats(events);
  const names = new Map<number, string>();
  for (const team of [setup.home, setup.away]) {
    for (const p of team.players) names.set(p.id, p.name);
  }
  const commentary = buildCommentary(
    events,
    {
      teamNames: [setup.home.shortName, setup.away.shortName],
      playerName: (id) => (id === null ? "" : (names.get(id) ?? `#${id}`)),
    },
    setup.seed,
  );
  highlights = buildHighlights(commentary, events, mode);

  return {
    score: stats.score,
    possession: finalPossession,
    team: stats.team,
    highlights,
    ratings: [...stats.players.values()]
      .map((p) => ({ id: p.id, team: p.team, rating: p.rating, goals: p.goals, assists: p.assists }))
      .sort((a, b) => b.rating - a.rating),
    xgTimeline: stats.xgTimeline,
  };
}


/* ==========================================================================
 * PLAYBACK — the reel, played as football.
 *
 * The old loop advanced the simulation by however much wall time had elapsed
 * since the last frame. That sounds right and is the root of the jank: a
 * setTimeout in a worker fires anywhere between 33 and 60 ms, so every frame
 * carried a different slice of match time, and the renderer — which had to
 * guess the time scale from how far apart snapshots landed — spent the whole
 * match alternately racing ahead and stalling against its own clamp.
 *
 * This loop advances the simulation by exactly SNAPSHOT_DT * speed every
 * frame, full stop. Consecutive snapshots are always the same distance apart
 * in match time. If the timer oversleeps it catches up by emitting at most a
 * couple of extra fixed frames rather than by taking one enormous step, and if
 * it has fallen hopelessly behind (a backgrounded tab) it gives up the debt
 * instead of sprinting to clear it. Wall-clock jitter is absorbed by the
 * renderer\'s buffer, where it belongs.
 * ========================================================================== */

/** How far behind schedule we are willing to chase, in frames. */
const MAX_CATCH_UP_FRAMES = 3;
/** Past this, the tab was asleep: drop the debt rather than fast-forward. */
const ABANDON_DEBT_SECONDS = 1.0;

/** Wall-clock time the next frame is due. */
let nextFrameDue = 0;
/** True while the reel is running the whole list rather than one passage. */
let reelRunning = false;

/** Play one passage and stop — clicking a line back after full time. */
function watch(index: number): void {
  const highlight = highlights[index];
  if (!highlight || !sim) return;
  reelRunning = false;
  enter(index, highlight.from, highlight.to);
}

/** Play the reel from `from` to the end, as one continuous piece of football. */
function playReel(from: number): void {
  if (!sim) return;
  const start = Math.max(0, from);
  const highlight = highlights[start];
  if (!highlight) {
    post({ type: "reelEnded", skipped: false });
    return;
  }
  reelRunning = true;
  enter(start, highlight.from, highlight.to);
}

/** Seek to a passage and start it. */
function enter(index: number, from: number, to: number): void {
  window = { index, from, to };
  seekTo(from, true);
  post({ type: "reelEnter", index });
  playing = true;
  nextFrameDue = now();
  schedule();
}

/** The passage being played is over. Move on, or stop. */
function leaveWindow(): void {
  const finished = window;
  if (!finished) return;
  window = null;
  post({ type: "highlightEnded", index: finished.index });

  if (!reelRunning) {
    playing = false;
    stopTimer();
    return;
  }
  const nextIndex = finished.index + 1;
  const next = highlights[nextIndex];
  if (!next) {
    playing = false;
    stopTimer();
    reelRunning = false;
    post({ type: "reelEnded", skipped: false });
    return;
  }
  enter(nextIndex, next.from, next.to);
}

/** Cut to the next passage without waiting for this one to finish. */
function skip(): void {
  if (!window) return;
  stopTimer();
  playing = false;
  leaveWindow();
}

/** Abandon the reel entirely; the screen reveals the result. */
function skipAll(): void {
  stopTimer();
  playing = false;
  reelRunning = false;
  window = null;
  post({ type: "reelEnded", skipped: true });
}

/**
 * Load the nearest keyframe at or before the target and fast-forward in
 * silence. The keyframe carries the RNG cursor, so the fast-forward replays
 * the same match rather than inventing a new one from that position.
 */
function seekTo(matchSecond: number, cut = false): void {
  if (!sim) return;
  const targetTick = Math.round(matchSecond * PHYSICS_HZ);
  const frame = sim.keyframeRing().nearestBefore(targetTick);
  /* The ring pins its first frame, so this can only miss if the match has not
   * been simulated at all. Falling back to a LATER frame — which is what this
   * used to do — lands past the passage and ends it before it starts. */
  if (frame) sim.restore(frame);
  while (sim.tick < targetTick && !sim.finished) sim.step();
  /* Two calls on purpose. renderSnapshot() drains the events accumulated since
   * the last one, and the fast-forward just replayed a chunk of the match: the
   * first call throws those away (they were reported when the match was
   * simulated), the second is the clean snapshot the view starts from. */
  sim.renderSnapshot();
  post({ type: "snapshot", snapshot: sim.renderSnapshot(), cut, timeScale: scale });
}

function stopTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function schedule(): void {
  if (!playing || !sim) return;
  // Aim at the wall-clock time this frame is actually due, so a late timer
  // shortens the next wait instead of compounding.
  timer = setTimeout(tickLoop, Math.max(0, nextFrameDue - now()));
}

function tickLoop(): void {
  if (!sim || !playing) return;
  const frameMs = 1000 / SNAPSHOT_HZ;

  if (now() - nextFrameDue > ABANDON_DEBT_SECONDS * 1000) {
    // The tab was asleep. Resume from now rather than replaying the gap.
    nextFrameDue = now();
  }

  let framesThisTurn = 0;
  do {
    sim.stepSeconds(SNAPSHOT_DT * scale);
    post({ type: "snapshot", snapshot: sim.renderSnapshot(), cut: false, timeScale: scale });
    nextFrameDue += frameMs;
    framesThisTurn++;

    if (window && sim.matchSecond >= window.to) {
      stopTimer();
      playing = false;
      leaveWindow();
      return;
    }
    if (sim.finished) {
      stopTimer();
      playing = false;
      if (reelRunning) {
        reelRunning = false;
        post({ type: "reelEnded", skipped: false });
      }
      return;
    }
  } while (nextFrameDue < now() && framesThisTurn < MAX_CATCH_UP_FRAMES);

  schedule();
}
