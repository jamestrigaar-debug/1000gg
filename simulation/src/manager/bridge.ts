/* ============================================================================
 * BRIDGE — a Manager fixture becomes a match this engine can play.
 *
 * This is the whole integration surface. The Manager hands over two clubs as
 * plain objects; it gets back a MatchSetup it can hand to the worker, and,
 * once the match has run, a report whose every number is derived from the
 * event stream.
 *
 * What crosses over, and where it lands:
 *
 *   club.formation   -> formations.json (identical keys and shapes: the
 *                       anchors here are the Manager's own coords)
 *   club.style       -> team instructions (styles.ts)
 *   the eleven       -> players, in formation slot order, with the slot
 *                       deciding left/right and the player's overall and
 *                       attributes deciding what he can do (attributes.ts)
 *   fixture.seed     -> the match. Same seed, same match, every time.
 * ========================================================================== */

import { loadFormations } from "../data";
import type { Formation, MatchSetup, PlayerDef, Position, TeamDef, Tactics } from "../core/types";
import { convertAttributes, enginePosition, footFor } from "./attributes";
import { instructionsFor } from "./styles";
import type { ManagerClub, ManagerFixture, ManagerPlayer } from "./contract";

const DEFAULT_KIT = {
  home: { primary: 0xd11f2a, secondary: 0xffffff, number: 0xffffff },
  away: { primary: 0x1746a2, secondary: 0xf2c14e, number: 0xffffff },
  gk: { primary: 0x2ad14f, secondary: 0x101418, number: 0x101418 },
};

const parseColour = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const hex = value.replace(/^(0x|#)/, "");
  const n = Number.parseInt(hex, 16);
  return Number.isFinite(n) ? n : fallback;
};

/** Which flank a formation slot is on, so a Manager "FB" becomes a DL or DR. */
export function slotSide(formation: Formation, index: number): "L" | "R" | "C" {
  const slot = formation.slots[index];
  if (!slot) return "C";
  const y = slot.anchors.AttackBuildUp.y;
  if (y < 0.36) return "R";
  if (y > 0.64) return "L";
  return "C";
}

/**
 * Turn a Manager club into a team this engine can pick. The squad is taken in
 * the order given — the Manager's own `effectiveXI` order, which already
 * matches the formation's slots — so the shape on the pitch is the shape the
 * user picked on the team-sheet screen.
 */
export function toTeamDef(
  club: ManagerClub,
  side: 0 | 1,
  formations: Record<string, Formation>,
  idBase: number,
): TeamDef {
  const formation = formations[club.formation] ?? (formations["4-4-2"] as Formation);
  const kitDefaults = side === 0 ? DEFAULT_KIT.home : DEFAULT_KIT.away;

  const players: PlayerDef[] = club.squad.map((p: ManagerPlayer, index: number) => {
    const position: Position =
      index < 11
        ? enginePosition(p.pos, slotSide(formation, index))
        : enginePosition(p.pos, "C");
    return {
      id: idBase + index,
      name: p.name,
      squadNumber: p.squadNumber ?? index + 1,
      position,
      attributes: convertAttributes(p, position),
      foot: footFor(p.attrs),
    };
  });

  return {
    id: String(club.id),
    name: club.name,
    shortName: club.shortName ?? club.name.slice(0, 3).toUpperCase(),
    kit: {
      primary: parseColour(club.kit?.primary, kitDefaults.primary),
      secondary: parseColour(club.kit?.secondary, kitDefaults.secondary),
      number: parseColour(club.kit?.number, kitDefaults.number),
      gkPrimary: DEFAULT_KIT.gk.primary,
      gkSecondary: DEFAULT_KIT.gk.secondary,
      gkNumber: DEFAULT_KIT.gk.number,
    },
    players,
  };
}

export function toTactics(club: ManagerClub, formations: Record<string, Formation>): Tactics {
  const formationId = formations[club.formation] ? club.formation : "4-4-2";
  return {
    formationId,
    instructions: instructionsFor(club.style),
    roles: Array.from({ length: 11 }, () => "default"),
  };
}

/**
 * The one call the Manager makes. Everything the match needs is in the
 * returned object, and the object is plain data: it structured-clones into
 * the worker and JSON-serialises into a replay.
 */
export function buildMatchSetup(fixture: ManagerFixture): MatchSetup {
  const formations = loadFormations();
  return {
    seed: fixture.seed,
    home: toTeamDef(fixture.home, 0, formations, 1000),
    away: toTeamDef(fixture.away, 1, formations, 2000),
    homeTactics: toTactics(fixture.home, formations),
    awayTactics: toTactics(fixture.away, formations),
    weather: {
      pitchCondition: fixture.weather?.pitchCondition ?? 0.35,
      rain: fixture.weather?.rain ?? 0,
      windX: 0,
      windY: 0,
    },
  };
}

/** The formations this engine can play, for the Manager's team-sheet screen. */
export function availableFormations(): { id: string; name: string; blurb: string }[] {
  const formations = loadFormations();
  return Object.values(formations).map((f) => ({
    id: f.id,
    name: f.name,
    blurb: f.blurb,
  }));
}
