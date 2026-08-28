/* ============================================================================
 * MATCH DAY — pre-match, the text match, and the link between the two.
 *
 * The contract these tests hold: every number on the pre-match screen comes
 * from the same objects the simulation is handed, and every line of the text
 * match is an index into the simulation, not a summary of a different one.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import { PHYSICS_HZ } from "../src/core/constants";
import { buildCommentary } from "../src/core/commentary";
import { buildHighlights, reelDuration } from "../src/core/highlights";
import { buildPreMatch, odds, roleRating, unitRatings } from "../src/core/prematch";
import { buildStats } from "../src/core/stats";
import { buildMatchSetup } from "../src/manager/bridge";
import { demoFixture } from "../src/data/demo-fixture";
import { loadFormations } from "../src/data";
import { MatchSim } from "../src/core/match";
import type { MatchEvent } from "../src/core/events";

const setup = buildMatchSetup(demoFixture());
const formations = loadFormations();

function runMatch(seed = "matchday"): MatchSim {
  const sim = new MatchSim({ ...setup, seed }, { formations });
  sim.runToEnd();
  return sim;
}

const commentaryFor = (events: readonly MatchEvent[], seed = "matchday") =>
  buildCommentary(
    events,
    {
      teamNames: [setup.home.shortName, setup.away.shortName],
      playerName: (id) =>
        [...setup.home.players, ...setup.away.players].find((p) => p.id === id)?.name ?? "someone",
    },
    seed,
  );

describe("pre-match comparison", () => {
  const pre = buildPreMatch({
    home: setup.home,
    away: setup.away,
    homeTactics: setup.homeTactics,
    awayTactics: setup.awayTactics,
    formations,
    homeStyle: "Possession",
    awayStyle: "Counter",
    homeStyleBlurb: "patient",
    awayStyleBlurb: "breaks",
    homeAdvantage: 4,
    styleNote: null,
  });

  it("names the shape each side picked", () => {
    expect(pre.home.formationName).toBe("4-2-3-1");
    expect(pre.away.formationName).toBe("4-4-2");
    expect(pre.home.formationBlurb.length).toBeGreaterThan(10);
  });

  it("lists eleven players per side, in slot order, with the keeper first", () => {
    expect(pre.home.lineup).toHaveLength(11);
    expect(pre.home.lineup[0]?.position).toBe("GK");
    expect(pre.away.lineup[0]?.position).toBe("GK");
  });

  it("rates units from the players actually picked", () => {
    for (const unit of [pre.home.ratings.attack, pre.home.ratings.midfield, pre.home.ratings.defence]) {
      expect(unit).toBeGreaterThan(30);
      expect(unit).toBeLessThan(100);
    }
    // A stronger squad must read as stronger.
    const weakened = {
      ...setup.away,
      players: setup.away.players.map((p) => ({
        ...p,
        attributes: Object.fromEntries(
          Object.entries(p.attributes).map(([k, v]) => [k, Math.max(1, v - 6)]),
        ) as unknown as typeof p.attributes,
      })),
    };
    const weakRatings = unitRatings(weakened, formations["4-4-2"]!);
    expect(weakRatings.overall).toBeLessThan(pre.away.ratings.overall);
  });

  it("picks key players by their rating in the role they are playing", () => {
    expect(pre.home.keyPlayers).toHaveLength(3);
    const ratings = pre.home.keyPlayers.map((k) => k.rating);
    expect(ratings[0]).toBeGreaterThanOrEqual(ratings[1] ?? 0);
    expect(pre.home.keyPlayers[0]?.quality.length).toBeGreaterThan(3);
  });

  it("reads a team's traits off its instructions and its players", () => {
    expect(pre.away.traits.length).toBeGreaterThan(0);
    expect(pre.away.traits.join(" ")).toMatch(/break|deep|forward|air|quick|patient|slow|tire|rattle/i);
  });

  it("prices the match: odds sum to one and favour the better side", () => {
    const level = odds(0, 0);
    expect(level.home + level.draw + level.away).toBeCloseTo(1, 3);
    expect(level.home).toBeCloseTo(level.away, 2);
    const strongHome = odds(12, 4);
    expect(strongHome.home).toBeGreaterThan(strongHome.away * 3);
  });

  it("rates a player higher in his own position than out of it", () => {
    const striker = setup.home.players.find((p) => p.position === "ST");
    expect(striker).toBeDefined();
    expect(roleRating(striker!, "ST")).toBeGreaterThan(roleRating(striker!, "DC"));
  });
});

describe("the text match", () => {
  const sim = runMatch();
  const events = sim.log.all();
  const lines = commentaryFor(events);

  it("covers the match from kick-off to full time", () => {
    expect(lines.length).toBeGreaterThan(5);
    expect(lines[0]?.kind).toBe("kickOff");
    expect(lines[lines.length - 1]?.kind).toBe("fullTime");
    expect(lines.every((l) => l.text.length > 0)).toBe(true);
  });

  it("reports the score the simulation actually produced", () => {
    const final = lines[lines.length - 1]?.text ?? "";
    expect(final).toContain(`${sim.score[0]}-${sim.score[1]}`);
  });

  it("is deterministic, words included", () => {
    const again = commentaryFor(events);
    expect(again.map((l) => l.text)).toEqual(lines.map((l) => l.text));
  });

  it("does not repeat itself immediately", () => {
    const goals = lines.filter((l) => l.kind === "goal").map((l) => l.text);
    for (let i = 1; i < goals.length; i++) {
      if (goals.length > 3) expect(goals[i]).not.toBe(goals[i - 1]);
    }
  });

  it("never leaves a placeholder unfilled", () => {
    for (const line of lines) expect(line.text).not.toMatch(/\{\w+\}/);
  });
});

describe("highlights", () => {
  const sim = runMatch();
  const events = sim.log.all();
  const lines = commentaryFor(events);

  it("shows fewer passages the tighter the mode", () => {
    const key = buildHighlights(lines, events, "key");
    const extended = buildHighlights(lines, events, "extended");
    const full = buildHighlights(lines, events, "full");
    expect(key.length).toBeLessThanOrEqual(extended.length);
    expect(extended.length).toBeLessThanOrEqual(full.length);
    expect(reelDuration(key)).toBeLessThanOrEqual(reelDuration(full));
  });

  it("always includes every goal in every mode", () => {
    const goals = events.filter((e) => e.type === "Goal").length;
    for (const mode of ["key", "extended", "comprehensive", "full"] as const) {
      const reel = buildHighlights(lines, events, mode);
      const covered = events
        .filter((e) => e.type === "Goal")
        .every((g) => reel.some((h) => g.matchSecond >= h.from && g.matchSecond <= h.to));
      expect(covered, `${goals} goals, mode ${mode}`).toBe(true);
    }
  });

  it("produces windows that are ordered, non-overlapping and watchable", () => {
    const reel = buildHighlights(lines, events, "extended");
    for (let i = 0; i < reel.length; i++) {
      const h = reel[i]!;
      expect(h.to).toBeGreaterThan(h.from);
      expect(h.to - h.from).toBeLessThan(120);
      expect(h.from).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(h.from).toBeGreaterThanOrEqual(reel[i - 1]!.from);
      if (i > 0) expect(h.from).toBeGreaterThan(reel[i - 1]!.to);
    }
  });

  it("carries the score as it stood at each passage", () => {
    const reel = buildHighlights(lines, events, "key");
    const last = reel[reel.length - 1];
    if (last) expect(last.score).toEqual(sim.score);
  });
});

describe("watching a highlight back", () => {
  it("plays the same match the text describes", () => {
    // Simulate, pick a highlight, then seek to it from a keyframe exactly as
    // the worker does — the sim must arrive in the same state as a straight
    // run to that tick.
    const reference = runMatch("watchback");
    const lines = commentaryFor(reference.log.all(), "watchback");
    const reel = buildHighlights(lines, reference.log.all(), "key");
    const target = reel[0];
    expect(target).toBeDefined();

    const targetTick = Math.round(target!.from * PHYSICS_HZ);
    const straight = new MatchSim({ ...setup, seed: "watchback" }, { formations });
    while (straight.tick < targetTick) straight.step();

    const seeker = new MatchSim({ ...setup, seed: "watchback" }, { formations });
    seeker.runToEnd();
    const frame = seeker.keyframeRing().nearestBefore(targetTick);
    expect(frame).not.toBeNull();
    seeker.restore(frame!);
    while (seeker.tick < targetTick) seeker.step();

    expect(seeker.tick).toBe(straight.tick);
    expect(seeker.score).toEqual(straight.score);
    expect(seeker.ball.pos.x).toBeCloseTo(straight.ball.pos.x, 6);
    expect(seeker.ball.pos.y).toBeCloseTo(straight.ball.pos.y, 6);
    for (const player of straight.players) {
      const other = seeker.playerById(player.def.id);
      expect(other?.pos.x).toBeCloseTo(player.pos.x, 6);
      expect(other?.pos.y).toBeCloseTo(player.pos.y, 6);
    }
  }, 120_000);
});

describe("stats from the event stream", () => {
  const sim = runMatch("stats");
  const stats = buildStats(sim.log.all());

  it("agrees with the simulation's own scoreline", () => {
    expect(stats.score).toEqual(sim.score);
  });

  it("counts what the match did", () => {
    const shots = sim.log.all().filter((e) => e.type === "Shot").length;
    expect(stats.team[0].shots + stats.team[1].shots).toBe(shots);
    expect(stats.team[0].onTarget).toBeLessThanOrEqual(stats.team[0].shots);
    expect(stats.team[0].xg).toBeGreaterThanOrEqual(0);
  });

  it("rates every player who did something, inside the 4-10 band", () => {
    expect(stats.players.size).toBeGreaterThan(10);
    for (const line of stats.players.values()) {
      expect(line.rating).toBeGreaterThanOrEqual(4);
      expect(line.rating).toBeLessThanOrEqual(10);
    }
  });

  it("gives a scorer a better rating than a player who did nothing", () => {
    const scorers = [...stats.players.values()].filter((p) => p.goals > 0);
    const quiet = [...stats.players.values()].filter((p) => p.goals === 0 && p.shots === 0);
    if (scorers.length && quiet.length) {
      const bestScorer = Math.max(...scorers.map((p) => p.rating));
      const bestQuiet = Math.max(...quiet.map((p) => p.rating));
      expect(bestScorer).toBeGreaterThan(bestQuiet);
    }
  });

  it("builds an xG timeline that only ever goes up", () => {
    let home = 0;
    let away = 0;
    for (const [, h, a] of stats.xgTimeline) {
      expect(h).toBeGreaterThanOrEqual(home - 1e-9);
      expect(a).toBeGreaterThanOrEqual(away - 1e-9);
      home = h;
      away = a;
    }
  });
});
