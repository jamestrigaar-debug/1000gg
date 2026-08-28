/* ============================================================================
 * HEADLESS BALANCE BATCH — the tuning instrument.
 *
 * Not part of the default test run (it simulates whole matches). Run it with
 *
 *   npm run batch            # 20 matches
 *   MATCHES=200 npm run batch
 *
 * and read the table against the "real" column. A formula that sounds clever
 * is only worth having if it moves these numbers toward reality — the same
 * rule the Manager's own engine is held to in Manager/tests/realism.js.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import { MatchSim } from "../src/core/match";
import { defaultTactics, loadFormations, loadTeams } from "../src/data";
import type { MatchEvent } from "../src/core/events";

const MATCHES = Number(process.env.MATCHES ?? 20);

interface Row {
  homeGoals: number;
  awayGoals: number;
  shots: [number, number];
  onTarget: [number, number];
  xg: [number, number];
  possession: [number, number];
}

function runOne(seed: string): Row {
  const teams = loadTeams();
  const sim = new MatchSim(
    {
      seed,
      home: teams[0]!,
      away: teams[1]!,
      homeTactics: defaultTactics("4-2-3-1"),
      awayTactics: defaultTactics("4-4-2"),
      weather: { pitchCondition: 0.35, rain: 0, windX: 0, windY: 0 },
    },
    { formations: loadFormations() },
  );
  sim.runToEnd();

  const row: Row = {
    homeGoals: sim.score[0],
    awayGoals: sim.score[1],
    shots: [0, 0],
    onTarget: [0, 0],
    xg: [0, 0],
    possession: sim.possessionShare(),
  };
  for (const e of sim.log.all() as readonly MatchEvent[]) {
    if (e.type !== "Shot" || e.team === null) continue;
    row.shots[e.team]++;
    if (e.onTarget) row.onTarget[e.team]++;
    row.xg[e.team] += e.xg;
  }
  return row;
}

describe("balance batch", () => {
  it(`simulates ${MATCHES} matches and reports the distribution`, () => {
    const rows: Row[] = [];
    for (let i = 0; i < MATCHES; i++) rows.push(runOne(`batch-${i}`));

    const n = rows.length;
    const goals = rows.reduce((t, r) => t + r.homeGoals + r.awayGoals, 0) / n;
    const homeWins = rows.filter((r) => r.homeGoals > r.awayGoals).length / n;
    const draws = rows.filter((r) => r.homeGoals === r.awayGoals).length / n;
    const awayWins = 1 - homeWins - draws;
    const shots = rows.reduce((t, r) => t + r.shots[0] + r.shots[1], 0) / (n * 2);
    const onT = rows.reduce((t, r) => t + r.onTarget[0] + r.onTarget[1], 0) / (n * 2);
    const xg = rows.reduce((t, r) => t + r.xg[0] + r.xg[1], 0) / (n * 2);
    const totalShots = rows.reduce((t, r) => t + r.shots[0] + r.shots[1], 0);
    const totalXg = rows.reduce((t, r) => t + r.xg[0] + r.xg[1], 0);
    const poss = rows.reduce((t, r) => t + r.possession[0], 0) / n;

    if (process.env.ROWS) {
      for (const [i, r] of rows.entries()) {
        console.log(
          `  #${i} ${r.homeGoals}-${r.awayGoals}  shots ${r.shots[0]}/${r.shots[1]}` +
            `  xG ${r.xg[0].toFixed(1)}/${r.xg[1].toFixed(1)}  poss ${(r.possession[0] * 100).toFixed(0)}%`,
        );
      }
    }

    const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
    /* eslint-disable no-console */
    console.log(`
  matches            ${n}
  goals/match        ${goals.toFixed(2)}        (target 2.5 - 3.0)
  home/draw/away     ${pct(homeWins)} / ${pct(draws)} / ${pct(awayWins)}   (target 46 / 26 / 28)
  shots/team         ${shots.toFixed(1)}        (target 9 - 14)
  on target          ${pct(onT / Math.max(shots, 1e-9))}       (target 30 - 38%)
  xG/team            ${xg.toFixed(2)}        (target 1.1 - 1.6)
  xG/shot            ${(totalXg / Math.max(totalShots, 1)).toFixed(3)}       (target 0.08 - 0.13)
  home possession    ${pct(poss)}
`);
    expect(rows.every((r) => Number.isFinite(r.homeGoals) && Number.isFinite(r.awayGoals))).toBe(true);
  }, 3_600_000);
});
