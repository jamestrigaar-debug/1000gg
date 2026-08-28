/* ============================================================================
 * INTENTS — what a player is trying to do, and how tactics change that.
 *
 * The brains used to be if-ladders: press if you are nearest, mark if you are
 * not, hold shape otherwise. That works, but it makes a tactical instruction
 * into a code change — "press higher" has to find a branch to live in — and it
 * makes a role (a ball-playing centre-half, a pressing forward) impossible to
 * express at all.
 *
 * So the choice is a weight, and every weight is a product of three things:
 *
 *   BASE[role][intent]        what this role is for            (data)
 *   collective(side, intent)  what the team has been told      (instructions)
 *   emergent(player, intent)  what the situation demands       (the match)
 *
 * The executors are unchanged — this file only decides WHICH one runs. That
 * matters: the on-ball decision is already scored in a real currency (the
 * probability the possession ends in a goal), and throwing that away for a
 * product of weights would be a downgrade. So on the ball, these weights
 * MODULATE the scores; off the ball, where there is no such currency, they
 * select the intent outright.
 * ========================================================================== */

import { clamp } from "./math";
import type { Position, TeamInstructions } from "./types";

export type Intent =
  | "HoldShape"
  | "Support"
  | "Press"
  | "TrackRunner"
  | "DropDeep"
  | "StepUp"
  | "Dribble"
  | "Pass"
  | "Shoot"
  | "Clear";

export const INTENTS: Intent[] = [
  "HoldShape",
  "Support",
  "Press",
  "TrackRunner",
  "DropDeep",
  "StepUp",
  "Dribble",
  "Pass",
  "Shoot",
  "Clear",
];

/** A role's bias, as a multiplier per intent. 1 is "no opinion". */
export type RoleWeights = Partial<Record<Intent, number>>;

/**
 * The role table. Adding a role is a data edit, not a branch — which is the
 * whole point of the layer. Each role belongs to the positions it makes sense
 * for; the default for a position is the first role listed for it.
 */
export const ROLES: Record<string, { positions: Position[]; weights: RoleWeights; name: string }> = {
  default: { positions: [], name: "Balanced", weights: {} },

  sweeperKeeper: { positions: ["GK"], name: "Sweeper Keeper", weights: { StepUp: 1.4, Press: 1.2 } },

  stopper: { positions: ["DC"], name: "Stopper", weights: { Press: 1.35, TrackRunner: 1.3, StepUp: 1.2, Pass: 0.9 } },
  ballPlaying: { positions: ["DC"], name: "Ball-Playing Defender", weights: { Pass: 1.3, Dribble: 1.15, DropDeep: 1.1, Clear: 0.75 } },
  cover: { positions: ["DC"], name: "Cover", weights: { DropDeep: 1.35, HoldShape: 1.2, Press: 0.7 } },

  fullBack: { positions: ["DL", "DR"], name: "Full-Back", weights: { HoldShape: 1.1, TrackRunner: 1.15 } },
  wingBack: { positions: ["DL", "DR"], name: "Wing-Back", weights: { Support: 1.4, StepUp: 1.3, Dribble: 1.2, HoldShape: 0.8 } },
  invertedBack: { positions: ["DL", "DR"], name: "Inverted Full-Back", weights: { Pass: 1.3, Support: 1.2, Dribble: 0.85 } },

  anchor: { positions: ["DM"], name: "Anchor Man", weights: { HoldShape: 1.35, DropDeep: 1.25, Press: 0.85, Shoot: 0.5 } },
  ballWinner: { positions: ["DM"], name: "Ball-Winning Midfielder", weights: { Press: 1.5, TrackRunner: 1.35, Clear: 1.1, Shoot: 0.6 } },
  deepPlaymaker: { positions: ["DM", "MC"], name: "Deep-Lying Playmaker", weights: { Pass: 1.45, DropDeep: 1.15, Shoot: 0.7 } },

  boxToBox: { positions: ["MC"], name: "Box to Box", weights: { Support: 1.3, StepUp: 1.25, Press: 1.15, Shoot: 1.1 } },
  playmaker: { positions: ["MC", "AM"], name: "Playmaker", weights: { Pass: 1.5, Dribble: 1.15, Shoot: 1.05 } },
  mezzala: { positions: ["MC"], name: "Mezzala", weights: { Dribble: 1.3, Support: 1.25, Shoot: 1.15 } },

  winger: { positions: ["ML", "MR"], name: "Winger", weights: { Dribble: 1.35, Support: 1.2, Pass: 1.1, TrackRunner: 0.8 } },
  insideForward: { positions: ["ML", "MR"], name: "Inside Forward", weights: { Shoot: 1.4, Dribble: 1.25, StepUp: 1.2, TrackRunner: 0.7 } },
  wideMidfielder: { positions: ["ML", "MR"], name: "Wide Midfielder", weights: { HoldShape: 1.2, TrackRunner: 1.2, Press: 1.1 } },

  shadowStriker: { positions: ["AM"], name: "Shadow Striker", weights: { Shoot: 1.45, StepUp: 1.35, Support: 1.15 } },
  trequartista: { positions: ["AM"], name: "Trequartista", weights: { Pass: 1.4, Dribble: 1.3, Press: 0.55, TrackRunner: 0.5 } },

  poacher: { positions: ["ST"], name: "Poacher", weights: { Shoot: 1.5, StepUp: 1.3, Press: 0.6, Pass: 0.8 } },
  targetMan: { positions: ["ST"], name: "Target Man", weights: { Shoot: 1.25, HoldShape: 1.2, Pass: 1.1, Dribble: 0.85 } },
  pressingForward: { positions: ["ST"], name: "Pressing Forward", weights: { Press: 1.6, TrackRunner: 1.3, Shoot: 0.95 } },
  falseNine: { positions: ["ST"], name: "False Nine", weights: { Pass: 1.35, DropDeep: 1.3, Dribble: 1.15, Shoot: 0.9 } },
};

/** Roles a position can be given, for the team-sheet screen. */
export function rolesFor(position: Position): { id: string; name: string }[] {
  return Object.entries(ROLES)
    .filter(([, r]) => r.positions.includes(position))
    .map(([id, r]) => ({ id, name: r.name }));
}

/**
 * The role a slot plays if the tactics do not name one: the balanced one, with
 * no opinions at all. A default that quietly made every striker a poacher
 * would mean the engine had a tactical bias nobody chose.
 */
export function defaultRole(_position: Position): string {
  return "default";
}

export function roleWeight(roleId: string, intent: Intent): number {
  return ROLES[roleId]?.weights[intent] ?? 1;
}

/**
 * What the team has been told, as a multiplier per intent. This is the layer
 * that makes a slider mean something: raising `pressing` really does make
 * pressing the more attractive thing to do for every player on the side, and
 * it does it without a single new branch.
 */
/** The instruction set every weight is measured against: nothing on any
 *  slider, mentality in the middle. A side set up like this gets 1 for every
 *  intent, which is what makes the layer a no-op by default. */
export const NEUTRAL_INSTRUCTIONS: TeamInstructions = {
  mentality: 4,
  tempo: 0.5,
  width: 0.5,
  defensiveLine: 0.5,
  lineOfEngagement: 0.5,
  pressing: 0.5,
  passingDirectness: 0.5,
  counterPress: false,
  counter: false,
  timeWasting: 0,
};

export function collectiveWeight(ins: TeamInstructions, intent: Intent): number {
  /* EVERY term is a deviation from the neutral instruction set — mentality 4,
   * every slider at 0.5, no time-wasting — so a side that has been told
   * nothing in particular gets exactly 1 for everything and the whole layer is
   * a no-op. That is the property that makes this a refactor rather than a
   * rebalance: the first version was not centred, and it quietly pushed both
   * defensive lines three metres up the pitch and put sixty-three shots in a
   * match. */
  const mentality = (ins.mentality - 4) / 3; // -1 .. 1
  const press = ins.pressing - 0.5;
  const engage = ins.lineOfEngagement - 0.5;
  const line = ins.defensiveLine - 0.5;
  const width = ins.width - 0.5;
  const direct = ins.passingDirectness - 0.5;
  const tempo = ins.tempo - 0.5;
  const wasting = ins.timeWasting;

  switch (intent) {
    case "Press":
      return clamp(1 + 1.4 * press + 0.5 * engage + 0.25 * mentality, 0.15, 3);
    case "TrackRunner":
      return clamp(1 + 0.8 * press - 0.3 * line, 0.3, 2.2);
    case "HoldShape":
      return clamp(1 - 0.6 * press - 0.4 * engage + 0.4 * wasting, 0.3, 2.2);
    case "DropDeep":
      return clamp(1 - 1.2 * line + 0.3 * wasting - 0.2 * mentality, 0.2, 2.4);
    case "StepUp":
      return clamp(1 + 1.2 * line + 0.6 * engage + 0.3 * mentality, 0.2, 2.4);
    case "Support":
      return clamp(1 + 0.5 * width - 0.4 * direct + 0.2 * mentality, 0.3, 2.2);
    case "Pass":
      return clamp(1 - 0.35 * direct + 0.15 * tempo, 0.5, 1.8);
    case "Dribble":
      return clamp(1 - 0.4 * direct + 0.15 * mentality, 0.4, 1.7);
    case "Shoot":
      return clamp(1 + 0.3 * mentality + 0.25 * direct, 0.4, 1.8);
    case "Clear":
      return clamp(1 - 0.8 * line + 0.5 * direct - 0.3 * mentality, 0.3, 2.2);
    default:
      return 1;
  }
}

/**
 * Score and clock. A side leading late does not play the same football it
 * played at 0-0, and this is where that lives — it is a property of the
 * situation, not of any one player's brain.
 */
export function gameStateWeight(
  intent: Intent,
  goalDifference: number,
  minutesLeft: number,
): number {
  const late = minutesLeft < 15;
  if (!late) return 1;
  if (goalDifference > 0) {
    // Protecting a lead.
    if (intent === "HoldShape" || intent === "DropDeep" || intent === "Clear") return 1.35;
    if (intent === "StepUp" || intent === "Shoot") return 0.85;
    return 1;
  }
  if (goalDifference < 0) {
    // Chasing it.
    if (intent === "StepUp" || intent === "Press" || intent === "Shoot" || intent === "Support") return 1.3;
    if (intent === "DropDeep" || intent === "HoldShape") return 0.75;
    return 1;
  }
  return 1;
}
