/* ============================================================================
 * COMMENTARY — the text match.
 *
 * Every line is generated from one event plus the state the event stream
 * implies (score, minute, who is having a game). Nothing reads the renderer,
 * so the text version of a match exists whether or not anyone ever watches it
 * in 2D — which is exactly what the Manager needs: it simulates a fixture,
 * prints the report, and only builds the pitch if the user asks to see it.
 *
 * Templates are tiered by importance and picked with the match's own seeded
 * RNG, with an anti-repeat window so the same phrase does not come round twice
 * in a half.
 * ========================================================================== */

import type { MatchEvent } from "./events";
import { Rng } from "./rng";
import type { TeamSide } from "./types";

export interface CommentaryContext {
  /** Short names, for "RIV 2-1 KIN". */
  teamNames: [string, string];
  playerName: (id: number | null) => string;
}

export interface CommentaryLine {
  matchSecond: number;
  minute: number;
  /** 0 filler, 1 notable, 2 big, 3 goal-level. Drives the highlight tiers. */
  importance: number;
  team: TeamSide | null;
  kind: string;
  text: string;
}

const GOAL_TEMPLATES = [
  "GOAL! {player} finishes it off — {score}.",
  "{player} scores! {score}.",
  "It's in! {player} makes no mistake. {score}.",
  "{player} buries it. {score}.",
];

const BIG_CHANCE_TEMPLATES = [
  "Huge chance for {player} — and he can't take it.",
  "{player} should score there.",
  "That's a glorious opening for {player}, wasted.",
];

const SAVE_TEMPLATES = [
  "Terrific save by {player}!",
  "{player} gets down well to keep it out.",
  "Brilliant stop — {player} denies {shooter}.",
];

const SHOT_TEMPLATES = [
  "{player} has a go from distance — over.",
  "{player} drags it wide.",
  "Effort from {player}, comfortable for the keeper.",
  "{player} shoots — blocked.",
];

const POST_TEMPLATES = [
  "Off the woodwork! {player} is inches away.",
  "{player} hits the post — how did that stay out?",
];

const OFFSIDE_TEMPLATES = [
  "The flag goes up against {player}.",
  "{player} strayed offside.",
];

const CORNER_TEMPLATES = ["Corner to {team}.", "{team} win a corner."];

/**
 * Turn one event into a line, or null when the event is not worth a line.
 * The RNG is passed in so that the commentary of a given match is itself
 * deterministic — replaying a match produces the same words.
 */
export function lineFor(
  event: MatchEvent,
  ctx: CommentaryContext,
  score: [number, number],
  rng: Rng,
  recent: string[],
): CommentaryLine | null {
  const minute = Math.floor(event.matchSecond / 60) + 1;
  const scoreLine = `${ctx.teamNames[0]} ${score[0]}-${score[1]} ${ctx.teamNames[1]}`;
  const pick = (templates: string[]): string => {
    const fresh = templates.filter((t) => !recent.includes(t));
    const pool = fresh.length > 0 ? fresh : templates;
    const chosen = rng.pick(pool);
    recent.push(chosen);
    if (recent.length > 6) recent.shift();
    return chosen;
  };
  const fill = (template: string, extra: Record<string, string> = {}): string =>
    template
      .replace("{player}", ctx.playerName(event.actorId))
      .replace("{score}", scoreLine)
      .replace("{team}", event.team === null ? "" : (ctx.teamNames[event.team] ?? ""))
      .replace(/\{(\w+)\}/g, (_m, key: string) => extra[key] ?? "");

  switch (event.type) {
    case "KickOff":
      return {
        matchSecond: event.matchSecond,
        minute,
        importance: 1,
        team: event.team,
        kind: "kickOff",
        text: event.period === 1 ? "We're under way." : "Back under way for the second half.",
      };
    case "Goal":
      return {
        matchSecond: event.matchSecond,
        minute,
        importance: 3,
        team: event.team,
        kind: "goal",
        text: event.ownGoal
          ? `Own goal! ${ctx.playerName(event.scorerId)} turns it into his own net. ${scoreLine}`
          : fill(pick(GOAL_TEMPLATES)),
      };
    case "Shot": {
      if (event.result === "goal") return null; // the Goal event carries it
      if (event.result === "post") {
        return {
          matchSecond: event.matchSecond,
          minute,
          importance: 2,
          team: event.team,
          kind: "post",
          text: fill(pick(POST_TEMPLATES)),
        };
      }
      const big = event.xg >= 0.25;
      if (big) {
        return {
          matchSecond: event.matchSecond,
          minute,
          importance: 2,
          team: event.team,
          kind: "bigChance",
          text: fill(pick(BIG_CHANCE_TEMPLATES)),
        };
      }
      return {
        matchSecond: event.matchSecond,
        minute,
        importance: 0,
        team: event.team,
        kind: "shot",
        text: fill(pick(SHOT_TEMPLATES)),
      };
    }
    case "Save":
      return {
        matchSecond: event.matchSecond,
        minute,
        importance: 1,
        team: event.team,
        kind: "save",
        text: fill(pick(SAVE_TEMPLATES), { shooter: ctx.playerName(event.shooterId) }),
      };
    case "Offside":
      return {
        matchSecond: event.matchSecond,
        minute,
        importance: 0,
        team: event.team,
        kind: "offside",
        text: fill(pick(OFFSIDE_TEMPLATES)),
      };
    case "Restart":
      if (event.kind !== "corner") return null;
      return {
        matchSecond: event.matchSecond,
        minute,
        importance: 0,
        team: event.team,
        kind: "corner",
        text: fill(pick(CORNER_TEMPLATES)),
      };
    case "Foul":
      return {
        matchSecond: event.matchSecond,
        minute,
        importance: event.card === "none" ? 0 : 2,
        team: event.team,
        kind: "foul",
        text:
          event.card === "red"
            ? `${ctx.playerName(event.actorId)} is sent off!`
            : event.card === "yellow"
              ? `${ctx.playerName(event.actorId)} goes into the book.`
              : `Free kick, ${ctx.playerName(event.victimId)} was fouled.`,
      };
    case "Whistle":
      if (event.kind === "halfTime") {
        return {
          matchSecond: event.matchSecond,
          minute,
          importance: 2,
          team: null,
          kind: "halfTime",
          text: `Half time: ${scoreLine}.`,
        };
      }
      if (event.kind === "fullTime") {
        return {
          matchSecond: event.matchSecond,
          minute,
          importance: 3,
          team: null,
          kind: "fullTime",
          text: `Full time: ${scoreLine}.`,
        };
      }
      return null;
    default:
      return null;
  }
}

/**
 * The whole text match, in order. Score is tracked as the stream is walked, so
 * a line printed in the 60th minute knows the score in the 60th minute — which
 * is the thing that makes "a late equaliser" possible to say at all.
 */
export function buildCommentary(
  events: readonly MatchEvent[],
  ctx: CommentaryContext,
  seed: string,
): CommentaryLine[] {
  const rng = new Rng(`${seed}-commentary`);
  const recent: string[] = [];
  const score: [number, number] = [0, 0];
  const out: CommentaryLine[] = [];
  for (const event of events) {
    if (event.type === "Goal" && event.team !== null) score[event.team]++;
    const line = lineFor(event, ctx, score, rng, recent);
    if (line) out.push(line);
  }
  return out;
}
