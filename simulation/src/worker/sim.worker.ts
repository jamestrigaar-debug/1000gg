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
import { buildPreMatch } from "../core/prematch";
import { buildStats } from "../core/stats";
import { loadFormations, loadPlaybook } from "../data";
import { styleProfile, styleMatchup } from "../manager/styles";
import type { MatchSetup } from "../core/types";
import { SNAPSHOT_HZ, type FromWorker, type MatchReport, type ToWorker } from "./protocol";

let sim: MatchSim | null = null;
let setup: MatchSetup | null = null;
let highlights: Highlight[] = [];
let playing = false;
let scale: number | "max" = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWall = 0;
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
      if (!sim || !setup) return;
      post({ type: "report", report: buildReport(msg.mode) });
      break;
    }
    case "watch": {
      watch(msg.index);
      break;
    }
    case "play":
      playing = true;
      lastWall = now();
      schedule();
      break;
    case "pause":
      stopTimer();
      playing = false;
      break;
    case "speed":
      scale = msg.scale;
      lastWall = now();
      break;
    case "seek":
      seekTo(msg.matchSecond);
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
  post({ type: "progress", fraction: 1 });
  post({ type: "report", report: buildReport(mode) });
}

function buildReport(mode: HighlightMode): MatchReport {
  if (!sim || !setup) throw new Error("no match to report on");
  const events = sim.log.all();
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
    possession: sim.possessionShare(),
    team: stats.team,
    highlights,
    ratings: [...stats.players.values()]
      .map((p) => ({ id: p.id, team: p.team, rating: p.rating, goals: p.goals, assists: p.assists }))
      .sort((a, b) => b.rating - a.rating),
    xgTimeline: stats.xgTimeline,
  };
}

/** Seek to a highlight and start playing its window. */
function watch(index: number): void {
  const highlight = highlights[index];
  if (!highlight || !sim) return;
  window = { index, from: highlight.from, to: highlight.to };
  seekTo(highlight.from);
  playing = true;
  scale = 1;
  lastWall = now();
  schedule();
}

/**
 * Load the nearest keyframe at or before the target and fast-forward in
 * silence. The keyframe carries the RNG cursor, so the fast-forward replays
 * the same match rather than inventing a new one from that position.
 */
function seekTo(matchSecond: number): void {
  if (!sim) return;
  const targetTick = Math.round(matchSecond * PHYSICS_HZ);
  const frame = sim.keyframeRing().nearestBefore(targetTick);
  if (frame) sim.restore(frame);
  else sim.restore(sim.keyframeRing().all()[0] ?? sim.fullSnapshot());
  while (sim.tick < targetTick && !sim.finished) sim.step();
  /* Two calls on purpose. renderSnapshot() drains the events accumulated since
   * the last one, and the fast-forward just replayed a chunk of the match: the
   * first call throws those away (they were reported when the match was
   * simulated), the second is the clean snapshot the view starts from. */
  sim.renderSnapshot();
  post({ type: "snapshot", snapshot: sim.renderSnapshot() });
}

function stopTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function schedule(): void {
  if (!playing || !sim) return;
  timer = setTimeout(tickLoop, 1000 / SNAPSHOT_HZ);
}

function tickLoop(): void {
  if (!sim || !playing) return;
  const wall = now();
  const elapsed = Math.min((wall - lastWall) / 1000, 0.25);
  lastWall = wall;

  const seconds = scale === "max" ? 4 : elapsed * scale;
  sim.stepSeconds(seconds);
  post({ type: "snapshot", snapshot: sim.renderSnapshot() });

  if (window && sim.matchSecond >= window.to) {
    playing = false;
    stopTimer();
    post({ type: "highlightEnded", index: window.index });
    window = null;
    return;
  }
  if (sim.finished) {
    playing = false;
    stopTimer();
    return;
  }
  schedule();
}
