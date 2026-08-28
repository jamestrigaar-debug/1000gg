/* ============================================================================
 * PRE-MATCH — the two team sheets, read against each other.
 *
 * This is what the user sees before kick-off, and it is built from exactly the
 * same objects the simulation is about to be handed: the same eleven, the same
 * attributes, the same formation anchors, the same instructions. If the screen
 * says a side is strong in the air, the aerial duels in the match will agree,
 * because both are reading `heading` and `jumpReach` off the same players.
 *
 * Pure, deterministic, no rendering: it returns numbers and short strings and
 * lets the UI decide what a bar looks like.
 * ========================================================================== */

import { attr01, clamp } from "./math";
import type { Attributes, Formation, PlayerDef, Position, Tactics, TeamDef } from "./types";

export interface UnitRating {
  attack: number;
  midfield: number;
  defence: number;
  keeper: number;
  overall: number;
}

export interface KeyPlayer {
  id: number;
  name: string;
  squadNumber: number;
  position: Position;
  rating: number;
  /** The one thing about him worth putting on a screen. */
  quality: string;
}

export interface TeamPreview {
  id: string;
  name: string;
  shortName: string;
  formationId: string;
  formationName: string;
  formationBlurb: string;
  style: string;
  styleBlurb: string;
  ratings: UnitRating;
  lineup: { squadNumber: number; name: string; position: Position; rating: number }[];
  keyPlayers: KeyPlayer[];
  /** Team-level reads, for the "how they will play" column. */
  traits: string[];
}

export interface PreMatch {
  home: TeamPreview;
  away: TeamPreview;
  /** Positive favours the home side, in rating points. */
  edge: { attack: number; midfield: number; defence: number; overall: number };
  /** Short lines a match preview would actually print. */
  talkingPoints: string[];
  /** Rough win/draw/win, from the overall gap plus home advantage. */
  odds: { home: number; draw: number; away: number };
}

/** How much each attribute counts towards a player's rating in a role. The
 *  same weights the engine's mechanics lean on, so a "good" player here is
 *  good on the pitch too. */
const ROLE_WEIGHTS: Record<Position, Partial<Record<keyof Attributes, number>>> = {
  GK: { reflexes: 3, handling: 2.5, commandOfArea: 2, positioning: 2, kicking: 1, concentration: 1.5 },
  DC: { marking: 3, tackling: 3, heading: 2.5, positioning: 2.5, strength: 2, jumpReach: 1.5, concentration: 1.5, passing: 1 },
  DL: { tackling: 2.5, marking: 2.5, pace: 2.5, stamina: 2, crossing: 2, workRate: 1.5, positioning: 1.5 },
  DR: { tackling: 2.5, marking: 2.5, pace: 2.5, stamina: 2, crossing: 2, workRate: 1.5, positioning: 1.5 },
  DM: { tackling: 3, positioning: 2.5, passing: 2, anticipation: 2, teamwork: 2, stamina: 1.5, strength: 1.5 },
  MC: { passing: 3, vision: 2.5, technique: 2, decisions: 2, stamina: 2, workRate: 1.5, firstTouch: 1.5 },
  ML: { dribbling: 2.5, crossing: 2.5, pace: 2.5, technique: 2, acceleration: 2, agility: 1.5 },
  MR: { dribbling: 2.5, crossing: 2.5, pace: 2.5, technique: 2, acceleration: 2, agility: 1.5 },
  AM: { vision: 3, passing: 2.5, technique: 2.5, firstTouch: 2, dribbling: 2, composure: 1.5, longShots: 1.5 },
  ST: { finishing: 3.5, offTheBall: 2.5, composure: 2, anticipation: 1.5, firstTouch: 1.5, heading: 1.5, acceleration: 1.5 },
};

/** A player's rating in his position, on the Manager's own 0-99 scale so the
 *  two games' screens can sit side by side. */
export function roleRating(player: PlayerDef, position: Position = player.position): number {
  const weights = ROLE_WEIGHTS[position] ?? ROLE_WEIGHTS.MC;
  let total = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(weights)) {
    total += attr01(player.attributes[key as keyof Attributes]) * (w ?? 0);
    weight += w ?? 0;
  }
  const share = weight > 0 ? total / weight : 0.5;
  return Math.round(30 + share * 66);
}

const UNIT_OF: Record<Position, keyof Omit<UnitRating, "overall">> = {
  GK: "keeper",
  DC: "defence",
  DL: "defence",
  DR: "defence",
  DM: "midfield",
  MC: "midfield",
  ML: "midfield",
  MR: "midfield",
  AM: "attack",
  ST: "attack",
};

export function unitRatings(team: TeamDef, formation: Formation): UnitRating {
  const buckets: Record<string, number[]> = { attack: [], midfield: [], defence: [], keeper: [] };
  for (let i = 0; i < 11; i++) {
    const player = team.players[i];
    if (!player) continue;
    const slot = formation.slots[i];
    const position = slot ? slot.position : player.position;
    const unit = UNIT_OF[position] ?? "midfield";
    buckets[unit]?.push(roleRating(player, position));
  }
  const mean = (xs: number[] | undefined): number =>
    xs && xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 50;
  const ratings = {
    attack: mean(buckets.attack),
    midfield: mean(buckets.midfield),
    defence: mean(buckets.defence),
    keeper: mean(buckets.keeper),
    overall: 0,
  };
  // The same weighting the Manager's own match engine uses: the keeper is
  // worth about a fifth of the defensive read.
  ratings.overall = Math.round(
    ratings.attack * 0.35 + ratings.midfield * 0.3 + (ratings.defence * 0.8 + ratings.keeper * 0.2) * 0.35,
  );
  return ratings;
}

/** The one line worth printing about a player. */
function qualityOf(p: PlayerDef): string {
  const a = p.attributes;
  const candidates: [number, string][] = [
    [a.pace + a.acceleration, "frightening over the ground"],
    [a.finishing * 2, "a finisher"],
    [a.vision + a.passing, "sees the pass before it exists"],
    [a.dribbling + a.technique, "carries it past people"],
    [a.heading + a.jumpReach, "wins everything in the air"],
    [a.tackling + a.marking, "hard to get past"],
    [a.reflexes + a.handling, "a shot-stopper"],
    [a.workRate + a.stamina, "runs all afternoon"],
  ];
  candidates.sort((x, y) => y[0] - x[0]);
  return candidates[0]?.[1] ?? "a footballer";
}

function keyPlayers(team: TeamDef, formation: Formation): KeyPlayer[] {
  const rated = team.players.slice(0, 11).map((p, i) => {
    const slot = formation.slots[i];
    const position = slot ? slot.position : p.position;
    return {
      id: p.id,
      name: p.name,
      squadNumber: p.squadNumber,
      position,
      rating: roleRating(p, position),
      quality: qualityOf(p),
    };
  });
  return rated.sort((a, b) => b.rating - a.rating).slice(0, 3);
}

/** Team-level reads: the things a scout would say in a sentence. */
function traitsFor(team: TeamDef, tactics: Tactics): string[] {
  const xi = team.players.slice(0, 11);
  const mean = (key: keyof Attributes): number =>
    xi.reduce((t, p) => t + p.attributes[key], 0) / Math.max(xi.length, 1);
  const traits: string[] = [];
  const ins = tactics.instructions;

  if (ins.pressing > 0.7) traits.push("Presses high and hunts the ball");
  if (ins.defensiveLine < 0.3) traits.push("Sits deep and defends the box");
  if (ins.passingDirectness > 0.7) traits.push("Goes forward early");
  if (ins.passingDirectness < 0.3) traits.push("Works it patiently through midfield");
  if (ins.counter) traits.push("Set up to break at pace");
  if (ins.timeWasting > 0.5) traits.push("Will slow the game down");

  if (mean("pace") > 13.5) traits.push("Quick right through the side");
  if (mean("heading") > 13.5) traits.push("Strong in the air");
  if (mean("stamina") < 11) traits.push("May tire in the last twenty");
  if (mean("composure") > 14) traits.push("Hard to rattle");
  return traits.slice(0, 4);
}

export interface PreMatchInput {
  home: TeamDef;
  away: TeamDef;
  homeTactics: Tactics;
  awayTactics: Tactics;
  formations: Record<string, Formation>;
  homeStyle: string;
  awayStyle: string;
  homeStyleBlurb: string;
  awayStyleBlurb: string;
  /** Home advantage in rating points; 0 at a neutral venue. */
  homeAdvantage?: number;
  styleNote?: string | null;
}

function previewOf(
  team: TeamDef,
  tactics: Tactics,
  formation: Formation,
  style: string,
  styleBlurb: string,
): TeamPreview {
  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    formationId: formation.id,
    formationName: formation.name,
    formationBlurb: formation.blurb,
    style,
    styleBlurb,
    ratings: unitRatings(team, formation),
    lineup: team.players.slice(0, 11).map((p, i) => {
      const slot = formation.slots[i];
      const position = slot ? slot.position : p.position;
      return { squadNumber: p.squadNumber, name: p.name, position, rating: roleRating(p, position) };
    }),
    keyPlayers: keyPlayers(team, formation),
    traits: traitsFor(team, tactics),
  };
}

export function buildPreMatch(input: PreMatchInput): PreMatch {
  const homeFormation =
    input.formations[input.homeTactics.formationId] ?? (Object.values(input.formations)[0] as Formation);
  const awayFormation =
    input.formations[input.awayTactics.formationId] ?? (Object.values(input.formations)[0] as Formation);

  const home = previewOf(input.home, input.homeTactics, homeFormation, input.homeStyle, input.homeStyleBlurb);
  const away = previewOf(input.away, input.awayTactics, awayFormation, input.awayStyle, input.awayStyleBlurb);

  const edge = {
    attack: home.ratings.attack - away.ratings.defence,
    midfield: home.ratings.midfield - away.ratings.midfield,
    defence: home.ratings.defence - away.ratings.attack,
    overall: home.ratings.overall - away.ratings.overall,
  };

  const talkingPoints: string[] = [];
  if (input.styleNote) talkingPoints.push(input.styleNote);
  if (Math.abs(edge.midfield) >= 4) {
    const side = edge.midfield > 0 ? home : away;
    talkingPoints.push(`${side.shortName} should control midfield — ${Math.abs(edge.midfield)} points of it.`);
  }
  const homeShape = homeFormation.bias;
  const awayShape = awayFormation.bias;
  if (homeShape.midfield - awayShape.midfield >= 3) {
    talkingPoints.push(`${home.formationName} against ${away.formationName}: an extra body in the middle.`);
  } else if (awayShape.midfield - homeShape.midfield >= 3) {
    talkingPoints.push(`${away.formationName} against ${home.formationName}: an extra body in the middle.`);
  }
  const star = [...home.keyPlayers, ...away.keyPlayers].sort((a, b) => b.rating - a.rating)[0];
  if (star) talkingPoints.push(`${star.name} is the best player on the pitch — ${star.quality}.`);

  return { home, away, edge, talkingPoints: talkingPoints.slice(0, 4), odds: odds(edge.overall, input.homeAdvantage ?? 4) };
}

/**
 * Win/draw/win from the rating gap. Fitted so that level sides at a neutral
 * venue read 38/26/36 and a ten-point gap at home reads about 70/20/10 —
 * the same shape the Manager's own season simulation produces.
 */
export function odds(overallEdge: number, homeAdvantage: number): { home: number; draw: number; away: number } {
  const gap = overallEdge + homeAdvantage;
  const draw = clamp(0.28 - Math.abs(gap) * 0.006, 0.12, 0.3);
  const rest = 1 - draw;
  const share = 1 / (1 + Math.exp(-gap / 6.5));
  return {
    home: Math.round(rest * share * 1000) / 1000,
    draw: Math.round(draw * 1000) / 1000,
    away: Math.round(rest * (1 - share) * 1000) / 1000,
  };
}
