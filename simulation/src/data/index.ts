/* ============================================================================
 * DATA LOADING — JSON files into the core's structural types.
 *
 * The JSON on disk is deliberately terser than the runtime types:
 *
 *  formations.json  one base anchor per slot; the per-phase anchors are
 *                   derived here by applying position-specific phase deltas,
 *                   so a new formation is 11 numbers rather than 66.
 *  squads.json      one "quality" per player; attributes are expanded from it
 *                   by position profile plus a *seeded* jitter, so squads stay
 *                   reproducible without a 30-field blob per player.
 *
 * Nothing here runs during a match. It is pure setup, and it is deterministic:
 * the same seed produces the same squad on every machine.
 * ========================================================================== */

import { clamp } from "../core/math";
import { Rng } from "../core/rng";
import type { Playbook, PlaybookMove } from "../core/playbook";
import type {
  Attributes,
  Formation,
  FormationSlot,
  PlayerDef,
  Phase,
  Position,
  Tactics,
  TeamDef,
  TeamInstructions,
} from "../core/types";
import formationsJson from "./formations.json";
import playbookJson from "./playbook.json";
import recordedJson from "./playbook.recorded.json";
import squadsJson from "./squads.json";

const PHASES: Phase[] = [
  "AttackBuildUp",
  "AttackFinal",
  "Transition",
  "DefendBlock",
  "DefendPress",
  "SetPiece",
];

/**
 * Phase deltas in normalised space, applied to a slot's base anchor.
 * ax is "up the pitch", ay is "towards the near touchline" (signed outward).
 *
 * The shape of a team is mostly these six numbers per line: everyone pushes on
 * in AttackFinal, everyone drops and narrows in DefendBlock, the press shoves
 * the whole block 12-15 m higher up.
 */
const PHASE_DELTA: Record<Phase, { ax: number; widen: number }> = {
  AttackBuildUp: { ax: 0, widen: 0.02 },
  AttackFinal: { ax: 0.12, widen: 0.06 },
  Transition: { ax: 0.04, widen: 0 },
  DefendBlock: { ax: -0.1, widen: -0.07 },
  DefendPress: { ax: 0.04, widen: -0.03 },
  SetPiece: { ax: 0, widen: 0 },
};

/** How much of the phase shift each line takes. Forwards drop least when the
 *  block sits, defenders push least when the team commits. */
const LINE_WEIGHT: Record<Position, { attack: number; defend: number }> = {
  GK: { attack: 0.1, defend: 0.1 },
  DC: { attack: 0.5, defend: 1.0 },
  DL: { attack: 0.9, defend: 1.0 },
  DR: { attack: 0.9, defend: 1.0 },
  DM: { attack: 0.7, defend: 0.9 },
  MC: { attack: 0.9, defend: 0.8 },
  ML: { attack: 1.0, defend: 0.8 },
  MR: { attack: 1.0, defend: 0.8 },
  AM: { attack: 1.0, defend: 0.6 },
  ST: { attack: 1.0, defend: 0.35 },
};

interface RawSlot {
  position: string;
  ax: number;
  ay: number;
}
interface RawFormation {
  id: string;
  name: string;
  blurb: string;
  bias: { attack: number; midfield: number; defence: number };
  slots: RawSlot[];
}

export function loadFormations(): Record<string, Formation> {
  const out: Record<string, Formation> = {};
  for (const raw of Object.values(formationsJson as Record<string, RawFormation>)) {
    out[raw.id] = {
      id: raw.id,
      name: raw.name,
      blurb: raw.blurb,
      bias: raw.bias,
      slots: raw.slots.map((s) => expandSlot(s)),
    };
  }
  return out;
}

function expandSlot(raw: RawSlot): FormationSlot {
  const position = raw.position as Position;
  const weight = LINE_WEIGHT[position];
  const anchors = {} as Record<Phase, { x: number; y: number }>;
  for (const phase of PHASES) {
    const d = PHASE_DELTA[phase];
    const w = d.ax >= 0 ? weight.attack : weight.defend;
    const outward = raw.ay - 0.5;
    anchors[phase] = {
      // Capped at 0.88 rather than the goal line: a striker's anchor is where
      // he waits for the ball, not where he stands when it arrives, and an
      // anchor on the six-yard line puts the whole front line permanently
      // offside and permanently marked.
      x: clamp(raw.ax + d.ax * w, 0.02, 0.88),
      y: clamp(0.5 + outward * (1 + d.widen * 6), 0.03, 0.97),
    };
  }
  return { position, anchors };
}

/* --- Squads -------------------------------------------------------------- */

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

/** Per-position attribute profile: a multiplier on the player's quality for
 *  each attribute. 1 = "as good as the player is", 0.6 = a clear weakness. */
type Profile = Partial<Record<keyof Attributes, number>>;

const BASE_PROFILE: Profile = {};

const POSITION_PROFILE: Record<Position, Profile> = {
  GK: {
    reflexes: 1.05, handling: 1.0, commandOfArea: 0.95, kicking: 0.9,
    positioning: 1.0, concentration: 1.0, decisions: 0.9,
    passing: 0.7, technique: 0.7, finishing: 0.3, dribbling: 0.35,
    tackling: 0.4, marking: 0.4, heading: 0.5, crossing: 0.3, longShots: 0.3,
    pace: 0.7, acceleration: 0.7, offTheBall: 0.4, jumpReach: 1.0,
  },
  DC: {
    marking: 1.1, tackling: 1.1, heading: 1.1, jumpReach: 1.05, strength: 1.05,
    positioning: 1.05, bravery: 1.05, concentration: 1.0,
    passing: 0.85, technique: 0.8, dribbling: 0.6, finishing: 0.4,
    crossing: 0.45, longShots: 0.5, agility: 0.85, offTheBall: 0.6, vision: 0.8,
  },
  DL: {
    crossing: 1.0, marking: 0.95, tackling: 1.0, pace: 1.05, stamina: 1.1,
    workRate: 1.05, heading: 0.8, finishing: 0.5, longShots: 0.6, strength: 0.85,
  },
  DR: {
    crossing: 1.0, marking: 0.95, tackling: 1.0, pace: 1.05, stamina: 1.1,
    workRate: 1.05, heading: 0.8, finishing: 0.5, longShots: 0.6, strength: 0.85,
  },
  DM: {
    tackling: 1.1, marking: 1.0, positioning: 1.05, teamwork: 1.05, workRate: 1.05,
    passing: 1.0, anticipation: 1.05, stamina: 1.05,
    finishing: 0.55, dribbling: 0.8, crossing: 0.7,
  },
  MC: {
    passing: 1.1, vision: 1.05, technique: 1.05, decisions: 1.05, stamina: 1.05,
    workRate: 1.0, firstTouch: 1.05, heading: 0.7, marking: 0.85,
  },
  ML: {
    crossing: 1.1, dribbling: 1.1, pace: 1.05, acceleration: 1.05, agility: 1.05,
    technique: 1.05, marking: 0.7, tackling: 0.75, heading: 0.7, strength: 0.85,
  },
  MR: {
    crossing: 1.1, dribbling: 1.1, pace: 1.05, acceleration: 1.05, agility: 1.05,
    technique: 1.05, marking: 0.7, tackling: 0.75, heading: 0.7, strength: 0.85,
  },
  AM: {
    vision: 1.15, passing: 1.1, technique: 1.1, firstTouch: 1.1, dribbling: 1.05,
    longShots: 1.05, composure: 1.05, agility: 1.05,
    marking: 0.55, tackling: 0.55, strength: 0.85, heading: 0.75,
  },
  ST: {
    finishing: 1.15, offTheBall: 1.15, composure: 1.1, anticipation: 1.05,
    firstTouch: 1.05, heading: 1.05, jumpReach: 1.0, acceleration: 1.05,
    marking: 0.5, tackling: 0.5, passing: 0.85, crossing: 0.7, vision: 0.9,
  },
};

const ATTRIBUTE_KEYS: (keyof Attributes)[] = [
  "passing", "technique", "firstTouch", "dribbling", "finishing", "crossing",
  "heading", "tackling", "marking", "longShots",
  "vision", "decisions", "anticipation", "composure", "offTheBall", "positioning",
  "concentration", "teamwork", "aggression", "bravery", "workRate",
  "pace", "acceleration", "agility", "stamina", "strength", "jumpReach", "balance",
  "reflexes", "handling", "commandOfArea", "kicking",
];

const GK_ONLY: (keyof Attributes)[] = ["reflexes", "handling", "commandOfArea", "kicking"];

/** Expand a quality score (1..20) into a full attribute set. The jitter is
 *  ±2 so two 14-quality strikers are not clones, and it is drawn from a seeded
 *  stream keyed by the player, so the same squad always rolls the same. */
export function expandAttributes(
  quality: number,
  position: Position,
  rng: Rng,
): Attributes {
  const profile = { ...BASE_PROFILE, ...POSITION_PROFILE[position] };
  const attrs = {} as Attributes;
  for (const key of ATTRIBUTE_KEYS) {
    if (position !== "GK" && GK_ONLY.includes(key)) {
      attrs[key] = 1;
      continue;
    }
    const mul = profile[key] ?? 0.95;
    const jitter = rng.clampedNormal(0, 1.4);
    attrs[key] = clamp(Math.round(quality * mul + jitter), 1, 20);
  }
  return attrs;
}

const parseColour = (s: string): number => Number.parseInt(s.replace(/^0x/, ""), 16);

export function loadTeams(seed = "squads-v1"): TeamDef[] {
  const rng = new Rng(seed);
  return (squadsJson as { teams: RawTeam[] }).teams.map((raw, teamIndex) => {
    const players: PlayerDef[] = raw.players.map((rp, i) => ({
      id: teamIndex * 100 + i,
      name: rp.name,
      squadNumber: rp.number,
      position: rp.position as Position,
      attributes: expandAttributes(rp.quality, rp.position as Position, rng),
      foot: rng.chance(0.24) ? "left" : rng.chance(0.08) ? "both" : "right",
    }));
    return {
      id: raw.id,
      name: raw.name,
      shortName: raw.shortName,
      kit: {
        primary: parseColour(raw.kit.primary ?? "0xffffff"),
        secondary: parseColour(raw.kit.secondary ?? "0x000000"),
        number: parseColour(raw.kit.number ?? "0xffffff"),
        gkPrimary: parseColour(raw.kit.gkPrimary ?? "0x00ff00"),
        gkSecondary: parseColour(raw.kit.gkSecondary ?? "0x000000"),
        gkNumber: parseColour(raw.kit.gkNumber ?? "0x000000"),
      },
      players,
    };
  });
}

/**
 * The move pool: the authored patterns plus whatever the recorder has mined
 * from real simulated matches (tools/record-moves.mjs). One pool, one format —
 * a recorded move is run exactly like an authored one.
 */
export function loadPlaybook(): Playbook {
  const authored = (playbookJson as Playbook).moves as PlaybookMove[];
  const recorded = (recordedJson as Playbook).moves as PlaybookMove[];
  return { moves: [...authored, ...recorded].filter(isRunnable) };
}

/**
 * A move that does not make sense is dropped rather than run. The recorder
 * writes this file automatically from simulated matches, so a bad recording is
 * a data problem that must never become a match problem: a step naming a role
 * nobody plays, or a player passing to himself, would either crash the
 * executor or produce nonsense on the pitch.
 */
export function isRunnable(move: PlaybookMove): boolean {
  const roles = new Set(move.cast.map((c) => c.role));
  if (roles.size !== move.cast.length) return false;
  if (move.steps.length < 2) return false;
  for (const step of move.steps) {
    if (!roles.has(step.actor)) return false;
    if ((step.kind === "pass" || step.kind === "cross") && (!roles.has(step.to) || step.to === step.actor)) {
      return false;
    }
  }
  return true;
}

export const DEFAULT_INSTRUCTIONS: TeamInstructions = {
  mentality: 4,
  tempo: 0.5,
  width: 0.5,
  defensiveLine: 0.5,
  lineOfEngagement: 0.5,
  pressing: 0.5,
  passingDirectness: 0.45,
  counterPress: false,
  counter: false,
  timeWasting: 0,
};

export function defaultTactics(formationId = "4-2-3-1"): Tactics {
  return {
    formationId,
    instructions: { ...DEFAULT_INSTRUCTIONS },
    roles: Array.from({ length: 11 }, () => "default"),
  };
}
