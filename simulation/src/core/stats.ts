/* ============================================================================
 * STATS — everything the panels show, derived from the event stream.
 *
 * Nothing in here looks at the simulation. It takes the event log and returns
 * numbers, which is the rule the whole architecture rests on: a replay of the
 * event log produces identical statistics without running the match again,
 * and the Manager can store a match as its events and rebuild the report.
 * ========================================================================== */

import type { MatchEvent } from "./events";
import { clamp } from "./math";
import type { TeamSide } from "./types";

export interface TeamStats {
  goals: number;
  shots: number;
  onTarget: number;
  blocked: number;
  xg: number;
  psxg: number;
  passes: number;
  passesCompleted: number;
  corners: number;
  offsides: number;
  fouls: number;
  yellows: number;
  reds: number;
  saves: number;
  interceptions: number;
  /** Contested balls in the air won — the aerial game, which is a different
   *  competition from the one on the floor. */
  aerialsWon: number;
  /** Chances that came from a corner, free kick or throw. */
  setPieceShots: number;
  setPieceXG: number;
  penalties: number;
  penaltiesScored: number;
  headers: number;
  headerGoals: number;
}

export interface PlayerStatLine {
  id: number;
  team: TeamSide;
  goals: number;
  assists: number;
  shots: number;
  xg: number;
  passes: number;
  passesCompleted: number;
  interceptions: number;
  duelsWon: number;
  aerialsWon: number;
  saves: number;
  /** 6.0 - 10.0, the FM-style match rating. */
  rating: number;
}

export interface MatchStats {
  score: [number, number];
  team: [TeamStats, TeamStats];
  players: Map<number, PlayerStatLine>;
  /** xG accumulated over time, for the race graph: [matchSecond, home, away]. */
  xgTimeline: [number, number, number][];
}

const emptyTeam = (): TeamStats => ({
  goals: 0,
  shots: 0,
  onTarget: 0,
  blocked: 0,
  xg: 0,
  psxg: 0,
  passes: 0,
  passesCompleted: 0,
  corners: 0,
  offsides: 0,
  fouls: 0,
  yellows: 0,
  reds: 0,
  saves: 0,
  interceptions: 0,
  aerialsWon: 0,
  setPieceShots: 0,
  setPieceXG: 0,
  penalties: 0,
  penaltiesScored: 0,
  headers: 0,
  headerGoals: 0,
});

const emptyPlayer = (id: number, team: TeamSide): PlayerStatLine => ({
  id,
  team,
  goals: 0,
  assists: 0,
  shots: 0,
  xg: 0,
  passes: 0,
  passesCompleted: 0,
  interceptions: 0,
  duelsWon: 0,
  aerialsWon: 0,
  saves: 0,
  rating: 6.5,
});

export function buildStats(events: readonly MatchEvent[]): MatchStats {
  const team: [TeamStats, TeamStats] = [emptyTeam(), emptyTeam()];
  const players = new Map<number, PlayerStatLine>();
  const xgTimeline: [number, number, number][] = [[0, 0, 0]];

  const playerLine = (id: number | null, side: TeamSide | null): PlayerStatLine | null => {
    if (id === null || side === null) return null;
    let line = players.get(id);
    if (!line) {
      line = emptyPlayer(id, side);
      players.set(id, line);
    }
    return line;
  };

  for (const e of events) {
    const side = e.team;
    const t = side === null ? null : team[side];
    const line = playerLine(e.actorId, side);

    switch (e.type) {
      case "Shot": {
        if (t) {
          t.shots++;
          t.xg += e.xg;
          t.psxg += e.psxg;
          if (e.onTarget) t.onTarget++;
          if (e.result === "blocked") t.blocked++;
          if (e.header) {
            t.headers++;
            if (e.result === "goal") t.headerGoals++;
          }
          if (e.penalty) {
            t.penalties++;
            if (e.result === "goal") t.penaltiesScored++;
          } else if (e.setPiece) {
            t.setPieceShots++;
            t.setPieceXG += e.xg;
          }
        }
        if (line) {
          line.shots++;
          line.xg += e.xg;
        }
        if (side !== null) {
          const last = xgTimeline[xgTimeline.length - 1] ?? [0, 0, 0];
          const next: [number, number, number] = [e.matchSecond, last[1], last[2]];
          next[side + 1] = (next[side + 1] ?? 0) + e.xg;
          xgTimeline.push(next);
        }
        break;
      }
      case "Goal": {
        if (t) t.goals++;
        const scorer = playerLine(e.scorerId, side);
        if (scorer && !e.ownGoal) scorer.goals++;
        const assist = playerLine(e.assistId, side);
        if (assist) assist.assists++;
        break;
      }
      case "Pass": {
        if (t) {
          t.passes++;
          if (e.completed) t.passesCompleted++;
        }
        if (line) {
          line.passes++;
          if (e.completed) line.passesCompleted++;
        }
        break;
      }
      case "Interception":
        if (t) t.interceptions++;
        if (line) line.interceptions++;
        break;
      case "Duel":
        if (line && e.won) {
          line.duelsWon++;
          if (e.aerial) line.aerialsWon++;
        }
        if (t && e.won && e.aerial) t.aerialsWon++;
        break;
      case "Save":
        if (t) t.saves++;
        if (line) line.saves++;
        break;
      case "Offside":
        if (t) t.offsides++;
        break;
      case "Foul":
        if (t) {
          t.fouls++;
          if (e.card === "yellow") t.yellows++;
          if (e.card === "red") t.reds++;
        }
        break;
      case "Restart":
        if (t && e.kind === "corner") t.corners++;
        break;
      default:
        break;
    }
  }

  for (const line of players.values()) line.rating = ratingFor(line);
  return { score: [team[0].goals, team[1].goals], team, players, xgTimeline };
}

/**
 * FM-style match rating. Starts at a par 6.5 and moves on what the event
 * stream actually recorded — goals and assists dominate, involvement counts
 * for something, and a keeper is rated on saves rather than on passing.
 */
export function ratingFor(line: PlayerStatLine): number {
  let rating = 6.5;
  rating += line.goals * 1.0;
  rating += line.assists * 0.6;
  rating += clamp(line.xg - line.goals * 0.35, -0.4, 0.5) * 0.5;
  rating += clamp(line.passesCompleted / 40, 0, 0.6);
  rating -= clamp((line.passes - line.passesCompleted) / 30, 0, 0.5);
  rating += clamp(line.interceptions * 0.06, 0, 0.5);
  rating += clamp(line.duelsWon * 0.05, 0, 0.4);
  rating += clamp(line.aerialsWon * 0.04, 0, 0.3);
  rating += clamp(line.saves * 0.12, 0, 1.2);
  return Math.round(clamp(rating, 4, 10) * 10) / 10;
}
