/* ============================================================================
 * TYPES — squads, attributes, tactics, and the shape of a match's inputs.
 *
 * Everything here is plain data: it structured-clones into the worker and
 * JSON-round-trips into a replay without a custom serialiser.
 * ========================================================================== */

import type { Vec2 } from "./math";

export type TeamSide = 0 | 1; // 0 = home, 1 = away

/** FM-flavoured attributes, all 1..20. Every one of these is read by at least
 *  one mechanic; see docs/ATTRIBUTES.md for the map. */
export interface Attributes {
  // Technical
  passing: number;
  technique: number;
  firstTouch: number;
  dribbling: number;
  finishing: number;
  crossing: number;
  heading: number;
  tackling: number;
  marking: number;
  longShots: number;
  // Mental
  vision: number;
  decisions: number;
  anticipation: number;
  composure: number;
  offTheBall: number;
  positioning: number;
  concentration: number;
  teamwork: number;
  aggression: number;
  bravery: number;
  workRate: number;
  // Physical
  pace: number;
  acceleration: number;
  agility: number;
  stamina: number;
  strength: number;
  jumpReach: number;
  balance: number;
  // Goalkeeping (0 for outfielders)
  reflexes: number;
  handling: number;
  commandOfArea: number;
  kicking: number;
}

export type Position = "GK" | "DC" | "DL" | "DR" | "DM" | "MC" | "ML" | "MR" | "AM" | "ST";

export interface PlayerDef {
  id: number;
  name: string;
  squadNumber: number;
  position: Position;
  attributes: Attributes;
  /** Preferred foot biases carry direction and shooting angle penalties. */
  foot: "left" | "right" | "both";
}

export interface TeamKit {
  primary: number; // 0xRRGGBB
  secondary: number;
  number: number;
  gkPrimary: number;
  gkSecondary: number;
  gkNumber: number;
}

export interface TeamDef {
  id: string;
  name: string;
  shortName: string;
  kit: TeamKit;
  players: PlayerDef[]; // [0..10] start, rest are substitutes
}

/* --- Tactics ------------------------------------------------------------- */

export type Phase =
  | "AttackBuildUp"
  | "AttackFinal"
  | "Transition"
  | "DefendBlock"
  | "DefendPress"
  | "SetPiece";

/** A formation slot's anchor per phase, in normalised pitch space
 *  (0..1 along the attacking axis, 0..1 across), so a formation file is
 *  independent of pitch dimensions and of which way the team is kicking. */
export interface FormationSlot {
  position: Position;
  anchors: Record<Phase, Vec2>;
}

export interface Formation {
  id: string;
  name: string; // "4-2-3-1"
  /** One line describing what the shape is for, shown on the pre-match and
   *  team-sheet screens. Carried through from the Manager's own table. */
  blurb: string;
  /** The Manager's unit bias for this shape, in rating points. The simulation
   *  does not read it — the anchors already say what the shape does — but the
   *  pre-match comparison shows it, and the Manager's season engine uses it. */
  bias: { attack: number; midfield: number; defence: number };
  slots: FormationSlot[]; // exactly 11
}

export interface TeamInstructions {
  mentality: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  tempo: number; // 0..1
  width: number; // 0..1
  defensiveLine: number; // 0..1 deep..high
  lineOfEngagement: number; // 0..1 deep..high
  pressing: number; // 0..1
  passingDirectness: number; // 0..1 short..direct
  counterPress: boolean;
  counter: boolean;
  timeWasting: number; // 0..1, the director scales this by score and clock
}

export interface Tactics {
  formationId: string;
  instructions: TeamInstructions;
  /** slot index -> role id, resolved against the role table. */
  roles: string[];
}

/* --- Match setup --------------------------------------------------------- */

export interface Weather {
  /** 0 dry/quick .. 1 heavy/wet. Feeds ball friction and touch error. */
  pitchCondition: number;
  rain: number; // 0..1, presentation + a nudge to firstTouch
  windX: number;
  windY: number;
}

export interface MatchSetup {
  seed: string;
  home: TeamDef;
  away: TeamDef;
  homeTactics: Tactics;
  awayTactics: Tactics;
  weather: Weather;
}

/** Anything the user did mid-match. Replays are {setup, userCommands}. */
export type UserCommand =
  | { tick: number; kind: "tactics"; side: TeamSide; tactics: Tactics }
  | { tick: number; kind: "substitution"; side: TeamSide; off: number; on: number };
