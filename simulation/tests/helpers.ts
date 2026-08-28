import { createHash } from "node:crypto";
import { MatchSim } from "../src/core/match";
import { defaultTactics, loadFormations, loadTeams } from "../src/data";
import type { MatchSetup } from "../src/core/types";

export function makeSetup(seed = "test-seed"): MatchSetup {
  const teams = loadTeams();
  const home = teams[0]!;
  const away = teams[1]!;
  return {
    seed,
    home,
    away,
    homeTactics: defaultTactics("4-2-3-1"),
    awayTactics: defaultTactics("4-4-2"),
    weather: { pitchCondition: 0.35, rain: 0, windX: 0, windY: 0 },
  };
}

export function makeSim(seed = "test-seed"): MatchSim {
  return new MatchSim(makeSetup(seed), { formations: loadFormations() });
}

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
