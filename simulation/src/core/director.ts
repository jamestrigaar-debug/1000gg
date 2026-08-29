/* ============================================================================
 * THE DIRECTOR — who decides what happens in the match, before any of it is
 * played.
 *
 * WHY THIS EXISTS, AND WHAT IT REPLACES
 *
 * The engine used to simulate ninety minutes of continuous football at 120 Hz
 * and hope that league-realistic statistics fell out of the far end. They did
 * not, and the reason is measurement rather than modelling: the batch harness
 * needs about two hundred matches to resolve a quarter-goal change at 95%
 * confidence, so every coefficient was tuned through noise. An afternoon's
 * work moved goals from 4.19 to 3.13 against a target of 2.5-3.0, and four of
 * the nine headline metrics were still out of band.
 *
 * So the causality is inverted. The director samples the SHAPE of the match
 * first — how many chances each side gets, how good they are, when they fall,
 * which of them go in — from distributions that are real football by
 * construction. Nothing has to emerge, so nothing can drift.
 *
 * WHAT IT DOES NOT DECIDE, WHICH MATTERS JUST AS MUCH
 *
 * It decides the RESULT and the BEATS. It does not decide how any of it looks.
 * Each beat is then handed to scene.ts and played out by the same physics,
 * steering, perception and defensive shape as before — so a chance the
 * director priced at 0.31 is a real move, with real runs, real marking and a
 * real block, that happens to end the way it was always going to end. The
 * football is emergent; only its accounting is authored.
 *
 * That split is the whole design. Authoring the accounting is what makes the
 * numbers right. Emergent physics is what makes it worth watching. Neither
 * half does the other's job.
 *
 * DETERMINISM is unchanged: the plan is a pure function of the seed and the
 * two squads, so the same fixture always produces the same match.
 * ========================================================================== */

import { PITCH_LENGTH, PITCH_WIDTH } from "./constants";
import { attr01, clamp, type Vec2 } from "./math";
import type { Direction } from "./pitch";
import { drawReferee, type Referee } from "./referee";
import { Rng } from "./rng";
import { expectedGoals } from "./shot";
import type { MatchSetup, PlayerDef, TeamDef, TeamSide } from "./types";

/* --- what real football looks like, in numbers ----------------------------
 *
 * Every constant below is a published top-five-league figure, and each one is
 * the thing the old engine was trying and failing to produce as a side effect.
 * They are now inputs. The comment beside each is what the continuous
 * simulation actually measured on 2026-08-29, for the record.
 */

/** Goals per team in an average match. Engine measured 1.57.
 *
 *  Lower than the 1.38 a league table shows, and deliberately: the strength
 *  ratio below is convex, so its average across a fixture list sits above one
 *  and multiplying by it inflates the mean. Calibrated on 2,000 authored
 *  matches against the real 2.5-3.0 rather than assumed. */
const BASE_GOALS = 1.2;
/** Mean xG per attempt, which sets how many shots a given goal rate implies.
 *  Engine measured 0.105 — this part it had right. */
const XG_PER_SHOT = 0.107;
/** Corners per team. Engine measured 12.7 against a real 4-7. */
const BASE_CORNERS = 5.4;
/** Fouls per team. Engine measured 10.1 a side, which was in band. */
const BASE_FOULS = 10.6;
/** Offsides per team. */
const BASE_OFFSIDES = 1.6;
/** Share of attempts struck from each range band, and the on-target and block
 *  rates within it. The engine's own shot map, measured band by band, is what
 *  showed these could not be left to emerge: it produced 36% of its shots from
 *  inside eleven metres against the 26% here, and blocked 2.9% of them against
 *  25%. */
/**
 * `saved` is the chance a NON-GOAL, unblocked attempt is on target, and it has
 * to be derived rather than quoted. A goal is already on target, and the goals
 * are drawn first, so quoting the raw per-band on-target figure counts them
 * twice — which is exactly what the first version of this table did, and it
 * produced 48.7% on target against a real 33%. The identity that has to hold
 * per band is:
 *
 *   onTargetOfAll = goalRate + saved * (1 - blocked - goalRate)
 *
 * so `saved` is (onTargetOfAll - goalRate) / (1 - blocked - goalRate). The
 * three published figures reconcile to a 33.5% aggregate under the shares
 * here, which is the number worth pinning.
 */
const BANDS = [
  { min: 4, max: 11, share: 0.26, blocked: 0.25, saved: 0.466 },
  { min: 11, max: 16, share: 0.3, blocked: 0.28, saved: 0.446 },
  { min: 16, max: 22, share: 0.28, blocked: 0.3, saved: 0.371 },
  { min: 22, max: 34, share: 0.16, blocked: 0.28, saved: 0.263 },
];
/** Penalties per side per match. Roughly one every eight games. */
const PENALTY_CHANCE = 0.058;
/** How much of the shot count a stronger side takes off a weaker one. The
 *  exponent on the strength ratio: 1 is linear, higher is more brutal. */
const STRENGTH_EXPONENT = 2.4;
/** How often a tight one-goal game is levelled late by the side chasing it.
 *  Tuned on the lab against the real 46/26/28 split. */
const LATE_LEVELLER = 0.1;
/** Home advantage as a multiplier on expected goals. Tuned so the split lands
 *  near the real 46/26/28, which the continuous engine never managed — it was
 *  producing 63/19/19. */
const HOME_EDGE = 1.22;

export type BeatPhase = "openPlay" | "cross" | "counter" | "corner" | "freeKick" | "longShot";

/** What the scene has to end in. The physics gets to decide everything else. */
export type BeatOutcome = "goal" | "saved" | "blocked" | "off" | "post";

export type BeatKind = "shot" | "corner" | "foul" | "offside" | "penalty";

export interface Beat {
  index: number;
  /** When it happens, in match seconds. */
  at: number;
  period: 1 | 2;
  side: TeamSide;
  kind: BeatKind;
  phase: BeatPhase;
  /** Where the attempt is struck from, in pitch metres for a side attacking
   *  +x. scene.ts mirrors it for the other end. */
  from: Vec2;
  /** Distance to the goal being attacked. Carried so nothing downstream has
   *  to re-derive it and get the end wrong, which is a mistake this codebase
   *  has already made once and reported a mean shot distance of 61 m. */
  distance: number;
  xg: number;
  outcome: BeatOutcome;
  header: boolean;
  penalty: boolean;
  /** Who takes it. Chosen by the director so the scorer is plausible for the
   *  squad rather than whoever the physics happened to leave nearest. */
  actorId: number;
  /** For a foul: who gave it away, and what the referee did about it. */
  card: "none" | "yellow" | "red";
  victimId: number | null;
  /** Its own sub-seed, so re-rolling one bad scene cannot change any other. */
  seed: string;
  /** How much this beat is worth showing. Drives which make the reel. */
  importance: number;
}

export interface MatchPlan {
  seed: string;
  referee: Referee;
  score: [number, number];
  possession: [number, number];
  shots: [number, number];
  corners: [number, number];
  fouls: [number, number];
  offsides: [number, number];
  /** Everything that happens, in time order. */
  beats: Beat[];
}

/* --- squad strength -------------------------------------------------------
 *
 * Derived from the attributes rather than read from a table, so it works for
 * any squad the user builds and cannot fall out of step with an edited rating.
 */

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0.5 : xs.reduce((t, v) => t + v, 0) / xs.length;

/** Attack and defence, each 0..1, from the starting eleven. */
export function squadStrength(team: TeamDef): { attack: number; defence: number } {
  const xi = team.players.slice(0, 11);
  const outfield = xi.filter((p) => p.position !== "GK");
  const keeper = xi.find((p) => p.position === "GK") ?? null;
  const attack = mean(
    outfield.map((p) =>
      attr01(
        (p.attributes.finishing +
          p.attributes.passing +
          p.attributes.technique +
          p.attributes.vision +
          p.attributes.offTheBall +
          p.attributes.dribbling) /
          6,
      ),
    ),
  );
  const defence = mean([
    ...outfield.map((p) =>
      attr01(
        (p.attributes.tackling +
          p.attributes.marking +
          p.attributes.positioning +
          p.attributes.concentration +
          p.attributes.strength) /
          5,
      ),
    ),
    // The keeper is a third of a defence and belongs in the number.
    keeper
      ? attr01((keeper.attributes.reflexes + keeper.attributes.handling + keeper.attributes.positioning) / 3)
      : 0.5,
    keeper ? attr01((keeper.attributes.reflexes + keeper.attributes.commandOfArea) / 2) : 0.5,
  ]);
  return { attack, defence };
}

/* --- sampling helpers ----------------------------------------------------- */

/** Knuth's method. Fine at these rates and it costs one uniform per event. */
function poisson(rng: Rng, lambda: number): number {
  const l = Math.exp(-Math.max(lambda, 0));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > l && k < 40);
  return k - 1;
}

function pick<T>(rng: Rng, items: readonly T[], weight: (t: T) => number): T {
  let total = 0;
  for (const it of items) total += weight(it);
  let r = rng.next() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}

/**
 * When something happens.
 *
 * Not uniform: football has more goals in the second half than the first, and
 * more in the last fifteen minutes than any other quarter, because sides tire
 * and chase. A mild power curve reproduces that without a table.
 */
function sampleMinute(rng: Rng): { at: number; period: 1 | 2 } {
  const u = rng.next() ** 0.86;
  const at = u * 5400;
  return { at, period: at < 2700 ? 1 : 2 };
}

/* --- who does it ----------------------------------------------------------
 *
 * The director picks the man, and this is one of the places the change earns
 * itself. In the continuous engine the scorer was whoever the physics left
 * nearest the ball, so a centre-half finished as many chances as a striker.
 * Weighting by position and by finishing puts the goals where a squad's shape
 * says they should go.
 */

const SHOOTER_WEIGHT: Record<string, number> = {
  ST: 1,
  AM: 0.62,
  ML: 0.34,
  MR: 0.34,
  MC: 0.3,
  DM: 0.12,
  DL: 0.07,
  DR: 0.07,
  DC: 0.09,
  GK: 0,
};
/** Who gives fouls away. Aggression and a defensive job, mostly. */
const FOULER_WEIGHT: Record<string, number> = {
  DC: 1,
  DM: 1,
  DL: 0.8,
  DR: 0.8,
  MC: 0.85,
  ML: 0.6,
  MR: 0.6,
  AM: 0.45,
  ST: 0.5,
  GK: 0.05,
};

function chooseShooter(rng: Rng, team: TeamDef, phase: BeatPhase, header: boolean): PlayerDef {
  const xi = team.players.slice(0, 11);
  return pick(rng, xi, (p) => {
    const base = SHOOTER_WEIGHT[p.position] ?? 0.2;
    if (base === 0) return 0;
    // A corner is headed in by whoever goes up for it, which is a different
    // list of players from whoever finishes a cutback.
    const skill = header
      ? attr01(p.attributes.heading) * 0.6 + attr01(p.attributes.jumpReach) * 0.4
      : phase === "longShot"
        ? attr01(p.attributes.longShots)
        : attr01(p.attributes.finishing) * 0.7 + attr01(p.attributes.offTheBall) * 0.3;
    const positional = header && (p.position === "DC" || p.position === "ST") ? 1.7 : 1;
    return base * positional * (0.35 + skill);
  });
}

function chooseFouler(rng: Rng, team: TeamDef): PlayerDef {
  const xi = team.players.slice(0, 11);
  return pick(
    rng,
    xi,
    (p) =>
      (FOULER_WEIGHT[p.position] ?? 0.5) *
      (0.4 + attr01(p.attributes.aggression) * 0.8) *
      (1.4 - attr01(p.attributes.tackling) * 0.6),
  );
}

/* --- where it is struck from ---------------------------------------------- */

/**
 * Range first, then the phase that fits it — and the order is the whole point.
 *
 * The first version drew the phase first and let a corner or a cross force the
 * range band, which meant the 30% of attempts that are set pieces and crosses
 * all landed inside sixteen metres and the shot map came out 35/30/17/18
 * against a real 26/30/28/16. Drawing the band from its published share and
 * then asking which phases could have produced it makes the shot map exact by
 * construction, which is the entire reason for authoring the match at all.
 */
const PHASE_BY_BAND: Array<Array<{ phase: BeatPhase; weight: number }>> = [
  // Inside 11 m: tap-ins, cutbacks, headers from corners.
  [
    { phase: "cross", weight: 0.3 },
    { phase: "corner", weight: 0.3 },
    { phase: "openPlay", weight: 0.28 },
    { phase: "counter", weight: 0.12 },
  ],
  [
    { phase: "openPlay", weight: 0.42 },
    { phase: "cross", weight: 0.2 },
    { phase: "corner", weight: 0.2 },
    { phase: "counter", weight: 0.13 },
    { phase: "freeKick", weight: 0.05 },
  ],
  [
    { phase: "openPlay", weight: 0.48 },
    { phase: "counter", weight: 0.16 },
    { phase: "corner", weight: 0.14 },
    { phase: "freeKick", weight: 0.12 },
    { phase: "longShot", weight: 0.1 },
  ],
  // Beyond 22 m it is a long shot or a free kick, and very little else.
  [
    { phase: "longShot", weight: 0.62 },
    { phase: "freeKick", weight: 0.24 },
    { phase: "openPlay", weight: 0.1 },
    { phase: "counter", weight: 0.04 },
  ],
];

function sampleBand(rng: Rng): number {
  let r = rng.next();
  for (let i = 0; i < BANDS.length; i++) {
    r -= BANDS[i]!.share;
    if (r <= 0) return i;
  }
  return BANDS.length - 1;
}

function sampleSpot(rng: Rng, bandIndex: number): { from: Vec2; distance: number } {
  const band = BANDS[bandIndex]!;
  const distance = rng.range(band.min, band.max);
  /* Angle from the goal's centre. Shots are taken from in front of goal far
   * more often than from the flanks, so the lateral offset is a clamped normal
   * rather than a uniform sweep across the arc. */
  const maxLateral = Math.min(distance * 0.92, PITCH_WIDTH / 2 - 3);
  const lateral = clamp(rng.clampedNormal(0, distance * 0.42), -maxLateral, maxLateral);
  const forward = Math.sqrt(Math.max(distance * distance - lateral * lateral, 0.25));
  return {
    from: { x: PITCH_LENGTH - forward, y: PITCH_WIDTH / 2 + lateral },
    distance,
  };
}

/* --- the plan ------------------------------------------------------------- */

/**
 * Build the whole match on paper.
 *
 * Order of decisions matters and is deliberate:
 *
 *   1. how many goals each side scores      — the result, drawn first
 *   2. how many attempts that implies       — from the real mean xG per shot
 *   3. what each attempt was worth          — band, phase, geometry, xG
 *   4. WHICH attempts went in               — weighted by xG, without
 *                                             replacement, to hit the count
 *
 * Step four is the one worth pausing on. Drawing goals independently per shot
 * would give the right rate but the wrong football: a match would routinely
 * produce four goals from four half-chances and none from the six good ones.
 * Choosing exactly `goals` attempts, weighted by what each was worth, gives
 * both the authored result AND the property that good chances are the ones
 * that get scored.
 */
export function directMatch(setup: MatchSetup): MatchPlan {
  const rng = new Rng(`${setup.seed}::director`);
  const referee = drawReferee(rng);

  const home = squadStrength(setup.home);
  const away = squadStrength(setup.away);
  const edge = clamp(setup.homeAdvantage ?? 5, 0, 10) / 5; // 1 at a typical ground

  /* Expected goals for each side: the base rate, moved by how this attack
   * compares with that defence. Both are 0..1 means, so the ratio is stable
   * and a very good side against a very poor one lands around three to one
   * rather than running away to double figures. */
  const ratio = (atk: number, def: number): number =>
    clamp(((atk + 0.35) / (def + 0.35)) ** STRENGTH_EXPONENT, 0.35, 2.9);
  const lambdaHome = BASE_GOALS * ratio(home.attack, away.defence) * (1 + (HOME_EDGE - 1) * edge);
  const lambdaAway = BASE_GOALS * ratio(away.attack, home.defence);

  const score: [number, number] = [poisson(rng, lambdaHome), poisson(rng, lambdaAway)];

  /* CHASING THE GAME.
   *
   * Two independent Poisson draws give the right goal rate and slightly the
   * wrong results: 46/23/31 against a real 46/26/28. Football has more draws
   * than independence predicts, and not by coincidence — a side a goal down
   * with twenty minutes left plays differently from one level, and a side a
   * goal up defends its lead. The scorelines that feel that effect most are
   * the close, low-scoring ones, which is exactly where the published
   * discrepancy sits.
   *
   * Modelled as what it is rather than as a fudge on the distribution: a
   * one-goal game, still tight, occasionally gets levelled late. */
  if (Math.abs(score[0] - score[1]) === 1 && score[0] + score[1] <= 3 && rng.chance(LATE_LEVELLER)) {
    score[score[0] < score[1] ? 0 : 1]++;
  }

  /* Attempts follow from expected goals, not from the goals actually drawn:
   * a side that scores three off two shots had a lucky day, and the shot count
   * should not retroactively pretend otherwise. */
  const attempts: [number, number] = [
    Math.max(score[0], poisson(rng, lambdaHome / XG_PER_SHOT)),
    Math.max(score[1], poisson(rng, lambdaAway / XG_PER_SHOT)),
  ];

  const beats: Beat[] = [];
  const shotsBySide: Beat[][] = [[], []];

  for (const side of [0, 1] as TeamSide[]) {
    const team = side === 0 ? setup.home : setup.away;
    for (let i = 0; i < attempts[side]; i++) {
      const penalty = rng.chance(PENALTY_CHANCE / Math.max(attempts[side], 1));
      const bandIndex = sampleBand(rng);
      const phase: BeatPhase = penalty
        ? "openPlay"
        : pick(rng, PHASE_BY_BAND[bandIndex]!, (p) => p.weight).phase;
      const header = !penalty && (phase === "corner" ? rng.chance(0.62) : rng.chance(0.09));
      const { from, distance } = penalty
        ? { from: { x: PITCH_LENGTH - 11, y: PITCH_WIDTH / 2 }, distance: 11 }
        : sampleSpot(rng, bandIndex);
      const shooter = penalty
        ? // The penalty taker is the best finisher on the pitch, which is who
          // takes them, rather than whoever won it.
          setup[side === 0 ? "home" : "away"].players
            .slice(0, 11)
            .reduce((best, p) =>
              p.attributes.finishing + p.attributes.composure >
              best.attributes.finishing + best.attributes.composure
                ? p
                : best,
            )
        : chooseShooter(rng, team, phase, header);
      const xg = expectedGoals({
        from,
        dir: 1 as Direction,
        header,
        // A chance the director has decided is a chance was not struck under
        // maximum pressure; a long shot from distance usually was.
        /* Nobody strikes a chance completely unopposed. Calibrated on the lab
         * against a real mean of 0.107 xG per attempt; at rng.range(0.05, 0.5)
         * the authored match priced its chances at 0.128 apiece. */
        pressure: phase === "longShot" ? rng.range(0.4, 0.9) : rng.range(0.15, 0.7),
        counter: phase === "counter",
        penalty,
      });
      const { at, period } = sampleMinute(rng);
      shotsBySide[side]!.push({
        index: 0,
        at,
        period,
        side,
        kind: penalty ? "penalty" : "shot",
        phase,
        from,
        distance,
        xg,
        outcome: "off", // decided below
        header,
        penalty,
        actorId: shooter.id,
        card: "none",
        victimId: null,
        seed: `${setup.seed}::b${side}-${i}`,
        importance: 0,
      });
    }
  }

  /* WHICH ONES GO IN. Weighted sampling without replacement, by xG, exactly
   * as many as the result says. */
  for (const side of [0, 1] as TeamSide[]) {
    const pool = [...shotsBySide[side]!];
    for (let g = 0; g < score[side] && pool.length > 0; g++) {
      const chosen = pick(rng, pool, (b) => b.xg + 0.02);
      chosen.outcome = "goal";
      pool.splice(pool.indexOf(chosen), 1);
    }
    /* Everything else is blocked, saved, off, or the woodwork, at the rates
     * its own range band actually produces. This is where 33% on target comes
     * from — not from a shooting model that has to be coaxed into it. */
    for (const b of pool) {
      const band = BANDS.find((x) => b.distance < x.max) ?? BANDS[3]!;
      if (b.penalty) {
        b.outcome = rng.chance(0.72) ? "saved" : rng.chance(0.4) ? "post" : "off";
        continue;
      }
      if (rng.chance(band.blocked)) {
        b.outcome = "blocked";
        continue;
      }
      if (rng.chance(band.saved)) {
        b.outcome = "saved";
        continue;
      }
      b.outcome = rng.chance(0.06) ? "post" : "off";
    }
    beats.push(...shotsBySide[side]!);
  }

  /* Corners, fouls and offsides. These never needed the physics to produce
   * them and the physics was producing them badly — twelve corners a side
   * against a real four to seven, because a blocked shot or a cut-out cross
   * kept running through to the goal line. */
  const corners: [number, number] = [0, 0];
  const fouls: [number, number] = [0, 0];
  const offsides: [number, number] = [0, 0];
  for (const side of [0, 1] as TeamSide[]) {
    const team = side === 0 ? setup.home : setup.away;
    const other = side === 0 ? setup.away : setup.home;
    const pressureShare = attempts[side] / Math.max(attempts[0] + attempts[1], 1);
    corners[side] = poisson(rng, BASE_CORNERS * 2 * pressureShare);
    fouls[side] = poisson(rng, BASE_FOULS * referee.strictness);
    offsides[side] = poisson(rng, BASE_OFFSIDES);

    for (let i = 0; i < corners[side]; i++) {
      const { at, period } = sampleMinute(rng);
      beats.push({
        index: 0,
        at,
        period,
        side,
        kind: "corner",
        phase: "corner",
        from: { x: PITCH_LENGTH, y: rng.chance(0.5) ? 0 : PITCH_WIDTH },
        distance: 0,
        xg: 0,
        outcome: "off",
        header: false,
        penalty: false,
        actorId: chooseShooter(rng, team, "cross", false).id,
        card: "none",
        victimId: null,
        seed: `${setup.seed}::c${side}-${i}`,
        importance: 0,
      });
    }
    for (let i = 0; i < fouls[side]; i++) {
      const { at, period } = sampleMinute(rng);
      const offender = chooseFouler(rng, team);
      const victim = pick(rng, other.players.slice(0, 11), (p) => (p.position === "GK" ? 0.05 : 1));
      /* Cards come off the referee's own temperament, which is drawn once per
       * match in referee.ts. A whistle-happy official who books nobody is a
       * real type, and so is the reverse. */
      const cardRoll = rng.next();
      const yellowRate = 0.11 * referee.cardHappy * (0.6 + attr01(offender.attributes.aggression));
      beats.push({
        index: 0,
        at,
        period,
        side,
        kind: "foul",
        phase: "openPlay",
        from: {
          x: rng.range(PITCH_LENGTH * 0.18, PITCH_LENGTH * 0.92),
          y: rng.range(4, PITCH_WIDTH - 4),
        },
        distance: 0,
        xg: 0,
        outcome: "off",
        header: false,
        penalty: false,
        actorId: offender.id,
        card: cardRoll < yellowRate * 0.045 ? "red" : cardRoll < yellowRate ? "yellow" : "none",
        victimId: victim.id,
        seed: `${setup.seed}::f${side}-${i}`,
        importance: 0,
      });
    }
    for (let i = 0; i < offsides[side]; i++) {
      const { at, period } = sampleMinute(rng);
      beats.push({
        index: 0,
        at,
        period,
        side,
        kind: "offside",
        phase: "openPlay",
        from: { x: PITCH_LENGTH * 0.72, y: rng.range(8, PITCH_WIDTH - 8) },
        distance: 0,
        xg: 0,
        outcome: "off",
        header: false,
        penalty: false,
        actorId: chooseShooter(rng, team, "openPlay", false).id,
        card: "none",
        victimId: null,
        seed: `${setup.seed}::o${side}-${i}`,
        importance: 0,
      });
    }
  }

  beats.sort((a, b) => a.at - b.at);
  beats.forEach((b, i) => {
    b.index = i;
    b.importance = importanceOf(b);
  });

  /* Possession tracks who had the attempts, loosely. A side can dominate the
   * ball and lose, so the coupling is deliberately weak. */
  const share = clamp(
    0.5 + (attempts[0] - attempts[1]) * 0.018 + rng.range(-0.07, 0.07),
    0.3,
    0.7,
  );

  return {
    seed: setup.seed,
    referee,
    score,
    possession: [share, 1 - share],
    shots: attempts,
    corners,
    fouls,
    offsides,
    beats,
  };
}

/**
 * How much a beat is worth showing, on the same 0-4 scale the highlight cutter
 * already uses. This is what decides which beats become scenes, so it is also
 * what decides where the simulation budget goes: a reel of twenty passages
 * plays twenty of these, not the ninety minutes around them.
 */
export function importanceOf(b: Beat): number {
  if (b.kind === "penalty") return 4;
  if (b.kind === "shot" && b.outcome === "goal") return 4;
  if (b.card === "red") return 4;
  if (b.kind === "shot" && b.outcome === "post") return 3;
  if (b.kind === "shot" && b.xg > 0.25) return 3;
  if (b.kind === "shot" && b.outcome === "saved") return 2;
  if (b.card === "yellow") return 2;
  if (b.kind === "corner") return 1;
  if (b.kind === "offside") return 1;
  if (b.kind === "shot") return 1;
  return 0;
}
