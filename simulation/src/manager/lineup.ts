/* ============================================================================
 * TEAM SHEET — picking an eleven for a shape.
 *
 * The Manager picks its side with a greedy fill, hardest slot first, scoring
 * each player by his overall multiplied by how well he copes in that slot
 * (Manager/src/tactics.js: autoPick + FAMILIARITY). The same rules are used
 * here, for the same reason it uses them: filling an easy slot with a
 * specialist leaves the hard slot to a passenger.
 *
 * This matters to the simulation and not just to the screen. The eleven this
 * returns is handed over in formation-slot order, and the slot decides where a
 * player stands, which flank he is on, and which anchors he holds through
 * every phase of the match.
 * ========================================================================== */

import type { Formation } from "../core/types";
import type { ManagerPlayer, ManagerPosition } from "./contract";

/** How well a player copes in a slot that is not his own: the fraction of his
 *  rating he carries into someone else's position. Transposed verbatim from
 *  Manager/src/tactics.js — a keeper anywhere else is a disaster, and so is
 *  anyone else in goal, which is the point of carrying a second keeper. */
const FAMILIARITY: Record<ManagerPosition, Partial<Record<ManagerPosition, number>>> = {
  GK: { GK: 1.0 },
  CB: { CB: 1.0, FB: 0.85, DM: 0.75 },
  FB: { FB: 1.0, CB: 0.8, WG: 0.8, DM: 0.7 },
  DM: { DM: 1.0, CM: 0.9, CB: 0.75, FB: 0.7 },
  CM: { CM: 1.0, DM: 0.9, AM: 0.9, WG: 0.75 },
  AM: { AM: 1.0, CM: 0.88, WG: 0.85, FW: 0.8 },
  WG: { WG: 1.0, AM: 0.85, FW: 0.8, FB: 0.75 },
  FW: { FW: 1.0, AM: 0.8, WG: 0.8 },
};
const OUT_OF_POSITION = 0.55;

export function familiarity(playerPos: ManagerPosition, slot: ManagerPosition): number {
  return FAMILIARITY[playerPos]?.[slot] ?? OUT_OF_POSITION;
}

/** This engine's slot positions back onto the Manager's coarser set, so a
 *  formation slot can be scored against a player's listed position. */
export function slotToManagerPosition(position: string): ManagerPosition {
  switch (position) {
    case "GK":
      return "GK";
    case "DC":
      return "CB";
    case "DL":
    case "DR":
      return "FB";
    case "DM":
      return "DM";
    case "MC":
      return "CM";
    case "ML":
    case "MR":
      return "WG";
    case "AM":
      return "AM";
    default:
      return "FW";
  }
}

export interface PickedEleven {
  /** Eleven players in formation-slot order; nulls only if the squad is short. */
  eleven: ManagerPlayer[];
  /** Players not selected, best first — the bench. */
  bench: ManagerPlayer[];
  /** Slots where the best available man is genuinely out of position, for the
   *  pre-match screen to flag. */
  problems: { slot: number; position: ManagerPosition; player: string; fit: number }[];
}

/**
 * Pick the best eleven for a shape. Scarce slots are filled first: with one
 * keeper and four centre-halves in the squad, the keeper's slot must be
 * resolved before a centre-half is spent somewhere else.
 */
export function pickEleven(squad: readonly ManagerPlayer[], formation: Formation): PickedEleven {
  const slots = formation.slots.map((s) => slotToManagerPosition(s.position));
  const available = squad.slice();
  const taken = new Set<ManagerPlayer>();

  const supply: Partial<Record<ManagerPosition, number>> = {};
  for (const p of available) supply[p.pos] = (supply[p.pos] ?? 0) + 1;

  const order = slots
    .map((position, index) => ({
      position,
      index,
      scarcity: position === "GK" ? -1 : (supply[position] ?? 0),
    }))
    .sort((a, b) => a.scarcity - b.scarcity || a.index - b.index);

  const eleven: (ManagerPlayer | null)[] = new Array(slots.length).fill(null);
  const problems: PickedEleven["problems"] = [];

  for (const { position, index } of order) {
    let best: ManagerPlayer | null = null;
    let bestScore = -Infinity;
    let bestFit = 0;
    for (const player of available) {
      if (taken.has(player)) continue;
      // Never put an outfielder in goal or a keeper outfield while any
      // alternative exists: the familiarity penalty alone is not enough.
      if ((position === "GK") !== (player.pos === "GK")) continue;
      const fit = familiarity(player.pos, position);
      const score = player.overall * fit;
      if (score > bestScore) {
        best = player;
        bestScore = score;
        bestFit = fit;
      }
    }
    if (!best) {
      for (const player of available) {
        if (taken.has(player)) continue;
        const fit = familiarity(player.pos, position) * 0.6;
        const score = player.overall * fit;
        if (score > bestScore) {
          best = player;
          bestScore = score;
          bestFit = fit;
        }
      }
    }
    if (!best) continue;
    taken.add(best);
    eleven[index] = best;
    if (bestFit < 0.85) {
      problems.push({ slot: index, position, player: best.name, fit: bestFit });
    }
  }

  return {
    eleven: eleven.filter((p): p is ManagerPlayer => p !== null),
    bench: available.filter((p) => !taken.has(p)).sort((a, b) => b.overall - a.overall),
    problems,
  };
}
