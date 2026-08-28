/* ============================================================================
 * DEMO FIXTURE — two clubs in the Manager's own shape.
 *
 * The demo app deliberately does NOT build a MatchSetup directly: it builds
 * the Manager's data structures and pushes them through src/manager/bridge.ts,
 * which is the path the real integration takes. If the bridge breaks, the demo
 * breaks, which is the point of it.
 *
 * The eight Manager attributes are derived from each player's quality with a
 * seeded roll, so the squads are reproducible and a "quick winger" really is
 * quicker than the centre-half next to him.
 * ========================================================================== */

import { Rng } from "../core/rng";
import type { ManagerClub, ManagerFixture, ManagerPlayer, ManagerPosition } from "../manager/contract";
import squads from "./squads.json";

interface RawPlayer {
  name: string;
  number: number;
  position: string;
  quality: number;
}
interface RawTeam {
  id: string;
  name: string;
  shortName: string;
  kit: Record<string, string>;
  players: RawPlayer[];
}

/** This engine's position codes back onto the Manager's coarser set. */
const TO_MANAGER: Record<string, ManagerPosition> = {
  GK: "GK",
  DC: "CB",
  DL: "FB",
  DR: "FB",
  DM: "DM",
  MC: "CM",
  ML: "WG",
  MR: "WG",
  AM: "AM",
  ST: "FW",
};

/** Manager overall runs 25-96; the demo squads carry a 1-20 "quality". */
const toOverall = (quality: number): number => Math.round(38 + quality * 2.9);

/** Attribute emphasis per position, in points either side of the overall. */
const EMPHASIS: Partial<Record<ManagerPosition, Partial<Record<string, number>>>> = {
  GK: { speed: -18, heading: -6, creativity: -8, balance: 4 },
  CB: { heading: 10, strength: 9, speed: -7, creativity: -8 },
  FB: { speed: 8, fitness: 8, strength: -3, heading: -5 },
  DM: { strength: 5, fitness: 6, creativity: -3 },
  CM: { creativity: 7, fitness: 5 },
  AM: { creativity: 12, balance: 6, strength: -6, heading: -8 },
  WG: { speed: 12, balance: 9, strength: -6, heading: -9 },
  FW: { speed: 6, heading: 6, strength: 4, creativity: 2 },
};

function attrsFor(pos: ManagerPosition, overall: number, rng: Rng): ManagerPlayer["attrs"] {
  const e = EMPHASIS[pos] ?? {};
  const roll = (key: string, spread = 7): number => {
    const base = overall + (e[key] ?? 0) + rng.clampedNormal(0, spread * 0.5);
    return Math.max(20, Math.min(99, Math.round(base)));
  };
  const rightFooted = rng.chance(0.76);
  const strong = roll("foot");
  const weak = Math.max(20, Math.round(strong - rng.range(10, 30)));
  return {
    heading: roll("heading"),
    fitness: roll("fitness"),
    strength: roll("strength"),
    speed: roll("speed"),
    creativity: roll("creativity"),
    balance: roll("balance"),
    leftFoot: rightFooted ? weak : strong,
    rightFoot: rightFooted ? strong : weak,
    height: Math.round(rng.range(172, 195)),
    weight: Math.round(rng.range(68, 88)),
  };
}

function clubFrom(raw: RawTeam, formation: string, style: string, rng: Rng): ManagerClub {
  const squad: ManagerPlayer[] = raw.players.map((p, i) => {
    const pos = TO_MANAGER[p.position] ?? "CM";
    const overall = toOverall(p.quality);
    return {
      id: `${raw.id}-${i}`,
      name: p.name,
      pos,
      overall,
      squadNumber: p.number,
      attrs: attrsFor(pos, overall, rng),
      mentalityRating: Math.round(overall + rng.clampedNormal(0, 6)),
      morale: 60 + Math.round(rng.clampedNormal(0, 8)),
      age: Math.round(rng.range(19, 33)),
    };
  });
  return {
    id: raw.id,
    name: raw.name,
    shortName: raw.shortName,
    formation,
    style,
    squad,
    kit: raw.kit,
    homeAdvantage: 5,
    form: 0,
  };
}

export interface DemoOptions {
  seed?: string | undefined;
  homeFormation?: string | undefined;
  awayFormation?: string | undefined;
  homeStyle?: string | undefined;
  awayStyle?: string | undefined;
}

export function demoFixture(options: DemoOptions = {}): ManagerFixture {
  const teams = (squads as { teams: RawTeam[] }).teams;
  const rng = new Rng("demo-squads-v1");
  const home = teams[0];
  const away = teams[1];
  if (!home || !away) throw new Error("squads.json must define two teams");
  return {
    seed: options.seed ?? "demo-match-1",
    home: clubFrom(home, options.homeFormation ?? "4-2-3-1", options.homeStyle ?? "Possession", rng),
    away: clubFrom(away, options.awayFormation ?? "4-4-2", options.awayStyle ?? "Counter", rng),
    competition: "League",
    weather: { pitchCondition: 0.35, rain: 0 },
  };
}
