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

import { PITCH_LENGTH, PITCH_WIDTH } from "./constants";
import type { MatchEvent } from "./events";
import { Rng } from "./rng";
import type { TeamSide } from "./types";

export interface CommentaryContext {
  /** Short names, for "RIV 2-1 KIN". */
  teamNames: [string, string];
  playerName: (id: number | null) => string;
  /** Set by the Shot line immediately before a goal, so the goal line can say
   *  how it was scored. Mutable state, but it is scoped to one pass over one
   *  event stream and it is what stops "he heads it in" being a guess. */
  lastGoalWas?: { header: boolean; penalty: boolean };
}

/** Which set of words fits the goal that just went in. */
function templatesForGoal(_scorerId: number, ctx: CommentaryContext): string[] {
  if (ctx.lastGoalWas?.penalty) return PENALTY_TEMPLATES;
  if (ctx.lastGoalWas?.header) return HEADER_GOAL_TEMPLATES;
  return GOAL_TEMPLATES;
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

const HEADER_GOAL_TEMPLATES = [
  "{player} heads it in! {score}.",
  "A header from {player} — and it's in. {score}.",
  "{player} rises above everyone and buries the header. {score}.",
];

const PENALTY_TEMPLATES = [
  "{player} sends the keeper the wrong way from the spot. {score}.",
  "{player} makes no mistake from twelve yards. {score}.",
];

const CARD_TEMPLATES = [
  "{player} goes into the book.",
  "That's a booking for {player}.",
  "The referee has a word, and {player} is cautioned.",
];

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
  "{player} timed that badly — offside.",
  "Offside. {player} was a yard early.",
];
/**
 * Distance to goal below which an offside counts as having denied something,
 * and so earns a place in the Extended reel rather than only Comprehensive.
 *
 * Set at the MEDIAN, measured rather than guessed: over six matches the
 * offsides in this engine run from 21 to 59 metres out with a median of 38,
 * because most of them happen against a high line near halfway where nothing
 * was being denied. An earlier guess of 26 m caught a tenth of them and the
 * default reel showed no offsides at all — the law was working, and invisible.
 */
const OFFSIDE_TIGHT_METRES = 38;

/** For one that cut out a real opening; worth a line of its own. */
const OFFSIDE_TIGHT_TEMPLATES = [
  "{player} is through — but the flag is up. Tight one.",
  "Offside, and {player} will feel that was close.",
  "The flag denies {player} a clear sight of goal.",
];

const CORNER_TEMPLATES = ["Corner to {team}.", "{team} win a corner."];

/**
 * How far a point is from the goal it is nearest to.
 *
 * Sides swap ends at half time, so the attacking direction cannot be read off
 * the team alone, and the nearer goal is the right answer for anything that
 * happens in an attacking position — which is all of the events that ask.
 * (The same trick, and the same reasoning, as the batch harness's shot
 * distance, which measured 61 metres until it stopped keying off the team.)
 */
function distanceToNearerGoal(at: { x: number; y: number }): number {
  const dy = (at.y - PITCH_WIDTH / 2) ** 2;
  return Math.min(
    Math.sqrt((at.x - PITCH_LENGTH) ** 2 + dy),
    Math.sqrt(at.x ** 2 + dy),
  );
}

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
          : fill(pick(templatesForGoal(event.scorerId, ctx))),
      };
    case "Shot": {
      // The goal itself is carried by the Goal event; what is recorded here is
      // how it was scored, so the line that follows can say "heads it in".
      if (event.result === "goal") {
        ctx.lastGoalWas = { header: event.header, penalty: event.penalty };
        return null;
      }
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
    case "Offside": {
      /* How interesting an offside is depends entirely on what it cut out.
       * A flag on the halfway line is bookkeeping; one that denies a man a
       * run at goal is a moment, and the difference is where it happened.
       *
       * This used to be a flat 0, which meant it only ever appeared in Full.
       * The engine can now produce a realistic six or seven a match and a
       * viewer on the default Extended setting would not have seen one of
       * them — the law was implemented, working, and invisible. */
      const tight = event.from !== null && distanceToNearerGoal(event.from) < OFFSIDE_TIGHT_METRES;
      return {
        matchSecond: event.matchSecond,
        minute,
        importance: tight ? 2 : 1,
        team: event.team,
        kind: "offside",
        text: fill(pick(tight ? OFFSIDE_TIGHT_TEMPLATES : OFFSIDE_TEMPLATES), {
          player: ctx.playerName(event.actorId),
        }),
      };
    }
    case "Restart":
      if (event.kind === "penalty") {
        return {
          matchSecond: event.matchSecond,
          minute,
          importance: 2,
          team: event.team,
          kind: "penalty",
          text: `Penalty to ${event.team === null ? "" : (ctx.teamNames[event.team] ?? "")}!`,
        };
      }
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
        /* A card is always worth showing. So is a foul that hands over a free
         * kick in a shooting position — that is a chance being created, not a
         * stoppage. A tug in midfield is neither. */
        importance:
          event.card !== "none"
            ? 2
            : event.from !== null && distanceToNearerGoal(event.from) < 30
              ? 1
              : 0,
        team: event.team,
        kind: "foul",
        text:
          event.card === "red"
            ? `${ctx.playerName(event.actorId)} is sent off!`
            : event.card === "yellow"
              ? fill(pick(CARD_TEMPLATES))
              : event.advantage
                ? `${ctx.playerName(event.actorId)} catches ${ctx.playerName(event.victimId)}, but the referee waves play on.`
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
