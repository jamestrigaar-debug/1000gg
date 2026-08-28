/* ============================================================================
 * MANAGER CONTRACT — the shapes this engine accepts from /Manager.
 *
 * The Manager game (Manager/src/*.js) is a dependency-free browser game built
 * around a global `MG` namespace: clubs carry a squad of players, a formation
 * key and a tactical style, and its own match engine turns two clubs into a
 * scoreline with a Poisson xG duel.
 *
 * This file is the boundary. It describes what the Manager already has — not
 * what would be convenient — so the integration is a read, never a migration:
 *
 *   Manager                          this engine
 *   -------------------------------  -----------------------------------
 *   club.formation "4-2-3-1"         formations.json, same keys
 *   club.tacticalStyle "High Press"  TeamInstructions (styles.ts)
 *   player.overall 25..96            the anchor for all 32 attributes
 *   player.attrs (8 numbers, 0..99)  the individual variation on top
 *   MG.tactics.effectiveXI(club)     the eleven, in formation slot order
 *
 * Nothing here imports from Manager and nothing in Manager imports from here:
 * the Manager passes plain objects in and gets a plain report back.
 * ========================================================================== */

/** Manager position codes. Note they are NOT this engine's position codes:
 *  the Manager has no left/right distinction, which the bridge derives from
 *  the formation slot instead. */
export type ManagerPosition = "GK" | "CB" | "FB" | "DM" | "CM" | "AM" | "WG" | "FW";

/** The six styles in Manager/src/match.js's TACTICAL table. */
export type ManagerStyle =
  | "Possession"
  | "High Press"
  | "Counter"
  | "Direct"
  | "Park the Bus"
  | "Route One";

/** The six shapes in Manager/src/tactics.js's FORMATIONS table. */
export type ManagerFormation = "4-4-2" | "4-3-3" | "4-2-3-1" | "3-5-2" | "5-3-2" | "4-5-1";

/** Manager's eight attributes, plus the body. All 0..99 except the body. */
export interface ManagerAttrs {
  heading: number;
  fitness: number;
  strength: number;
  leftFoot: number;
  rightFoot: number;
  speed: number;
  creativity: number;
  balance: number;
  height?: number;
  weight?: number;
}

export interface ManagerPlayer {
  id: number | string;
  name: string;
  pos: ManagerPosition;
  /** 25..96, the number the Manager's whole world is calibrated on. */
  overall: number;
  attrs: ManagerAttrs;
  /** 0..99 football intelligence; drives the mental attributes here. */
  mentalityRating?: number;
  age?: number;
  /** 0..100, 60 is settled. Nudges composure and concentration. */
  morale?: number;
  squadNumber?: number;
}

export interface ManagerClub {
  id: string | number;
  name: string;
  shortName?: string;
  formation: ManagerFormation | string;
  /** club.tacticalStyle, or the manager's own tactic if he has one. */
  style: ManagerStyle | string;
  /** The eleven, in formation slot order — MG.tactics.effectiveXI(club).
   *  Anything after the eleventh is treated as a substitute. */
  squad: ManagerPlayer[];
  /** Club unit ratings, if the caller has them (MG.clubs.ratingsFor). Used
   *  only for the pre-match comparison, never by the simulation itself. */
  ratings?: { attack: number; midfield: number; defence: number; keeper: number };
  kit?: { primary?: string; secondary?: string; number?: string };
  /** club.homeAdvantage and club.form, for presentation. */
  homeAdvantage?: number;
  form?: number;
}

export interface ManagerFixture {
  home: ManagerClub;
  away: ManagerClub;
  /** Anything stable per fixture: "2027-league-14-riverside-kingsport". The
   *  same string always produces the same match, which is what lets a season
   *  be re-watched rather than re-rolled. */
  seed: string;
  competition?: string;
  neutralVenue?: boolean;
  weather?: { pitchCondition?: number; rain?: number };
}

/** What the Manager gets back. Everything here is derived from the event
 *  stream, so the text report and the 2D match can never disagree. */
export interface ManagerMatchReport {
  seed: string;
  homeGoals: number;
  awayGoals: number;
  homeXG: number;
  awayXG: number;
  possession: [number, number];
  shots: [number, number];
  onTarget: [number, number];
  corners: [number, number];
  offsides: [number, number];
  scorers: { team: 0 | 1; playerId: number | string; name: string; minute: number }[];
  /** The text match: one line per highlight, in minute order. */
  highlights: {
    minute: number;
    importance: number;
    kind: string;
    team: 0 | 1 | null;
    text: string;
    /** Match seconds this passage covers, for watching it back in 2D. */
    from: number;
    to: number;
  }[];
}
