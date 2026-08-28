/* ============================================================================
 * EVENT STREAM — the single source of truth for everything downstream.
 *
 * Commentary, statistics, ratings, highlights and the score strip are derived
 * from this list and nothing else. The renderer never feeds them. That rule is
 * what makes a replay reproduce not just the movement but the whole match
 * narrative from {seed, squads, tactics, commands}.
 *
 * Every event carries when it happened (tick + matchSecond + period), who did
 * it, and where the ball went, so a derived system never has to ask the sim.
 * ========================================================================== */

import type { Vec3 } from "./math";
import type { TeamSide } from "./types";

export interface EventBase {
  tick: number;
  matchSecond: number;
  period: number; // 1 = first half, 2 = second half
  actorId: number | null;
  team: TeamSide | null;
  from: Vec3 | null;
  to: Vec3 | null;
}

export type ShotResult = "goal" | "saved" | "blocked" | "off" | "post" | "cleared";
export type RestartKind = "throw" | "corner" | "goalKick" | "freeKick" | "penalty";
export type WhistleKind =
  | "kickOffWhistle"
  | "halfTime"
  | "fullTime"
  | "goalGiven"
  | "foul"
  | "offside"
  | "outOfPlay";

export type MatchEvent =
  | (EventBase & { type: "KickOff"; period: number })
  | (EventBase & { type: "Pass"; targetId: number | null; completed: boolean; length: number })
  | (EventBase & { type: "Interception" })
  | (EventBase & { type: "Dribble"; beat: boolean })
  | (EventBase & { type: "Duel"; opponentId: number; won: boolean; aerial: boolean })
  | (EventBase & {
      type: "Shot";
      xg: number;
      psxg: number;
      onTarget: boolean;
      header: boolean;
      result: ShotResult;
    })
  | (EventBase & { type: "Save"; shooterId: number; held: boolean; parried: boolean })
  | (EventBase & {
      type: "Foul";
      victimId: number;
      card: "none" | "yellow" | "red";
      advantage: boolean;
    })
  | (EventBase & { type: "Offside"; passerId: number })
  | (EventBase & { type: "Restart"; kind: RestartKind })
  | (EventBase & { type: "Goal"; scorerId: number; assistId: number | null; ownGoal: boolean })
  | (EventBase & { type: "Substitution"; off: number; on: number })
  | (EventBase & { type: "Injury"; severity: number })
  | (EventBase & { type: "Whistle"; kind: WhistleKind })
  | (EventBase & { type: "TacticChange" });

export type MatchEventType = MatchEvent["type"];

/** An event as the simulation writes it: the clock fields are stamped by the
 *  sim, so callers supply everything else. Distributive so each variant keeps
 *  its own payload — a plain Omit over a union loses the discriminated shape. */
export type MatchEventDraft<T = MatchEvent> = T extends MatchEvent
  ? Omit<T, "tick" | "matchSecond" | "period"> & { period?: number }
  : never;

/** Append-only log. The sim owns one; nothing else may mutate it. */
export class EventLog {
  private readonly events: MatchEvent[] = [];

  push(e: MatchEvent): void {
    this.events.push(e);
  }

  all(): readonly MatchEvent[] {
    return this.events;
  }

  /** Events added after index `from` — how the worker ships deltas. */
  since(from: number): MatchEvent[] {
    return this.events.slice(from);
  }

  get length(): number {
    return this.events.length;
  }

  /** Stable, whitespace-free digest input for the determinism test. Only
   *  fields that must be identical across runs are included, and floats are
   *  fixed to 4dp so a legal x87/SSE difference in the last bit cannot fail
   *  a run that is otherwise identical. */
  digestSource(): string {
    const f = (n: number | null): string => (n === null ? "_" : n.toFixed(4));
    const v = (p: Vec3 | null): string => (p ? `${f(p.x)},${f(p.y)},${f(p.z)}` : "_");
    return this.events
      .map((e) => {
        const extra = Object.keys(e)
          .filter((k) => !BASE_KEYS.has(k))
          .sort()
          .map((k) => {
            const val = (e as unknown as Record<string, unknown>)[k];
            return `${k}=${typeof val === "number" ? f(val) : String(val)}`;
          })
          .join(",");
        return `${e.tick}|${e.type}|${e.actorId ?? "_"}|${e.team ?? "_"}|${v(e.from)}|${v(e.to)}|${extra}`;
      })
      .join("\n");
  }
}

const BASE_KEYS = new Set([
  "tick",
  "matchSecond",
  "period",
  "actorId",
  "team",
  "from",
  "to",
  "type",
]);
