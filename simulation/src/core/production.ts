/* ============================================================================
 * PRODUCTION — turning a director's plan into a match you can watch.
 *
 * The pipeline, end to end:
 *
 *   director.ts   decides what happens: the result, and every beat in it
 *   THIS FILE     stages the beats worth showing and plays them out
 *   the physics   draws them — runs, marking, blocks, all emergent
 *   the validator throws away any passage that did not come out right
 *   events        everything downstream reads this and nothing else
 *
 * WHAT IS ACTUALLY SIMULATED, AND WHY THAT IS THE POINT
 *
 * A ninety-minute match is 648,000 physics ticks and takes about five seconds
 * of wall clock. A reel of twenty passages is a little over four minutes of
 * football — a fifteenth of that. Only the beats that make the reel are ever
 * played; the rest are recorded straight into the event log from the plan,
 * because a shot nobody watches needs to exist in the statistics and nowhere
 * else.
 *
 * THE VALIDATOR IS THE PART THAT MATTERS
 *
 * The original complaint about this engine was that highlights did not match
 * what was selected and sometimes did not play at all. Both were unfixable in
 * the old design, because a highlight was a WINDOW cut out of a simulation
 * that had already happened — if the window was wrong there was nothing to be
 * done about it. Here a passage is generated for a purpose, checked against
 * that purpose, and re-rolled on a fresh seed if it fails. Nothing reaches the
 * screen without having been confirmed to show the thing it claims to show.
 *
 * After a few attempts it falls back to a direct staging — the man on the
 * ball, in the position, striking it — which cannot fail, so the reel never
 * has a hole in it. That is the "re-roll silently, then fall back" the design
 * asked for.
 * ========================================================================== */

import type { Beat, MatchPlan } from "./director";
import { directMatch } from "./director";
import type { MatchEvent } from "./events";
import type { Highlight, HighlightMode } from "./highlights";
import type { CommentaryLine } from "./commentary";
import { MatchSim, type StageOptions } from "./match";
import { clamp, len2, type Vec2 } from "./math";
import { PHYSICS_HZ, PITCH_LENGTH, PITCH_WIDTH } from "./constants";
import type { Direction } from "./pitch";
import { Rng } from "./rng";
import type { Formation, MatchSetup, TeamSide } from "./types";
import type { Playbook } from "./playbook";

/** How long a staged passage runs for, in seconds. Long enough for a move to
 *  develop, short enough that nothing wanders off into a different match. */
const SCENE_SECONDS = 15;
/** How far before the beat's own minute the passage is staged, so the chance
 *  lands in the middle of the window rather than at the start of it. */
const SCENE_LEAD = 9;
/** Attempts on a fresh sub-seed before falling back to a direct staging. */
const MAX_ATTEMPTS = 5;

/** How many passages each mode asks for. */
const SCENE_BUDGET: Record<HighlightMode, number> = {
  key: 6,
  extended: 14,
  comprehensive: 30,
  full: 30,
};

/**
 * Event types the PLAN owns. A scene may not contribute them.
 *
 * Without this the statistics depend on how much of the match you chose to
 * watch: a staged passage emits its own shots, fouls and corners on top of the
 * ones the director already accounted for, so re-cutting the same match from
 * six clips to thirty moved the shot count from 13 to 15. The same match has
 * to have the same statistics whatever you watch of it.
 *
 * So the division is absolute. The plan owns the accounting — every shot,
 * goal, save, card, corner and offside in the record comes from it. A scene
 * owns the TEXTURE: the passes, the duels, the interceptions, the dribbles
 * that happened while the chance was being made. Which is the same split as
 * everywhere else in this design, applied to the event log.
 */
const PLAN_OWNS = new Set(["Shot", "Goal", "Save", "Foul", "Offside", "Restart"]);

export interface Scene {
  beat: Beat;
  /** When the authored moment actually landed, in match seconds. The plan's
   *  own events are re-stamped to it so the commentary's minute and the clip
   *  agree to the second. */
  momentSecond: number;
  /** The sim this passage lives in. Held so the worker can play it back. */
  sim: MatchSim;
  fromTick: number;
  toTick: number;
  /** How many staging attempts it took. 1 is the common case. */
  attempts: number;
  /** True if it had to fall back to putting the ball at his feet. */
  fellBack: boolean;
  events: MatchEvent[];
}

export interface Production {
  plan: MatchPlan;
  /** Playable passages, in match order. */
  scenes: Scene[];
  /** The whole match's events — scenes and unwatched beats alike, time
   *  ordered. Stats, commentary, ratings and the reel all derive from this. */
  events: MatchEvent[];
  /** Diagnostics for the tools: how well the staging is working, and why it
   *  is not working when it is not. */
  quality: {
    staged: number;
    firstTry: number;
    fellBack: number;
    /** Beats whose authored moment never happened even on the fallback, so
     *  the plan was written into the log on paper instead. */
    paper: number;
    reasons: Record<string, number>;
  };
}

/* --- validating a passage -------------------------------------------------- */

/**
 * Did this passage actually show what it was staged to show?
 *
 * Deliberately cheap and deliberately strict. Cheap because it runs on every
 * attempt of every beat; strict because the whole reason the pipeline exists
 * is that nothing dubious should reach the screen.
 */
function validate(sim: MatchSim, beat: Beat, fromTick: number): string | null {
  /* What counts as right depends on what the beat IS, and getting this wrong
   * was expensive: the first version demanded a decreed shot from every
   * passage, so corners, fouls and offsides — which have no shot in them —
   * failed every attempt and fell straight through to the fallback. Most of a
   * 78% fallback rate was this check, not the staging. */
  if (beat.kind === "shot" || beat.kind === "penalty") {
    if (!sim.decreeSpent) return "the authored moment never happened";
    const shots = sim.log
      .all()
      .filter((e): e is Extract<MatchEvent, { type: "Shot" }> => e.type === "Shot");
    const mine = shots.find((e) => e.actorId === beat.actorId);
    if (!mine) return "the nominated player never struck it";
    /* An authored goal is checked on the GOAL EVENT, not on the shot's own
     * result. A shot resolved as a goal whose ball is then cleared off the
     * line by the physics leaves the log a goal short of the plan, and the
     * score on the strip stops matching the score in the table. The event that
     * counts is the one the rest of the engine counts. */
    const scored = sim.log
      .all()
      .some((e) => e.type === "Goal" && e.scorerId === beat.actorId);
    if (beat.outcome === "goal" && !scored) return "the goal was not scored";
    if (beat.outcome !== "goal" && mine.result === "goal") return "an unauthored goal";
  } else {
    // A passage staged around a corner, a foul or an offside only has to be a
    // coherent piece of football with the ball live in the right area.
    if (sim.log.length < 2) return "nothing happened";
  }
  if (sim.log.all().some((e) => e.type === "Goal") && beat.outcome !== "goal") {
    return "an unauthored goal";
  }

  // Nothing may be NaN, off the pitch, or standing still for the whole passage.
  let moved = 0;
  for (const p of sim.players) {
    if (!p.onPitch) continue;
    if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) return "a player went to NaN";
    if (p.pos.x < -12 || p.pos.x > PITCH_LENGTH + 12) return "a player left the ground";
    if (p.pos.y < -12 || p.pos.y > PITCH_WIDTH + 12) return "a player left the ground";
    if (len2(p.vel.x, p.vel.y) > 0.4) moved++;
  }
  if (moved < 6) return "nobody was moving";
  if (!Number.isFinite(sim.ball.pos.x) || !Number.isFinite(sim.ball.pos.y)) return "the ball went to NaN";
  if (sim.tick - fromTick < PHYSICS_HZ * 2) return "the passage was too short to watch";
  return null;
}

/* --- staging one beat ------------------------------------------------------ */

/**
 * THE AUDITION LADDER.
 *
 * The first attempt at any beat is staged as a proper passage of football: the
 * move begins twenty-odd metres out against a set defence and has to work its
 * way to the chance. That is the version worth watching, and when it comes off
 * it is indistinguishable from a simulated match, because it IS one.
 *
 * Most of the time it does not come off, and it should not: asking emergent
 * play to manufacture a specific goal for a specific man against an organised
 * back four is roughly a one-in-twenty proposition, which is exactly what makes
 * football worth watching. So each retry makes it a little easier — the move
 * starts nearer, the defence is caught a little less set, the man is already
 * closer to where he needs to be — until it works.
 *
 * This is why the ladder is a ladder rather than five identical rolls. Five
 * identical hard attempts would fail five times and fall back; five graded
 * ones almost always find a rung where the football is still real and the
 * chance still arrives. The reel gets the best build-up that actually happened
 * rather than the first one that did.
 */
function stageOptionsFor(beat: Beat, rng: Rng, attempt: number, direct: boolean): StageOptions {
  // 0 on the first attempt, 1 on the last before the fallback.
  const ease = clamp(attempt / (MAX_ATTEMPTS - 1), 0, 1);
  /* How the chance arrived decides how the passage is set up, and this is
   * where the phases the director drew earn their keep. A counter is staged
   * with the defence caught out and the move starting deep; a corner is staged
   * on top of the six-yard box with everybody in it; a long shot is staged
   * against a set block, because that is why it is a long shot. */
  const setBase =
    beat.phase === "counter"
      ? rng.range(0.05, 0.28)
      : beat.phase === "corner"
        ? 1
        : beat.phase === "longShot"
          ? rng.range(0.7, 1)
          : rng.range(0.4, 0.85);
  const backBase =
    beat.phase === "counter"
      ? rng.range(24, 40)
      : beat.phase === "corner"
        ? rng.range(7, 13)
        : beat.phase === "longShot"
          ? rng.range(8, 16)
          : rng.range(12, 22);
  /* A corner is a corner however many attempts it takes — the defence is in
   * the six-yard box because that is where a defence is for a corner, not
   * because the passage is being made easy. */
  const set = beat.phase === "corner" ? setBase : setBase * (1 - ease * 0.55);
  const startBack = Math.max(5, backBase * (1 - ease * 0.62));
  return {
    atSecond: Math.max(2, beat.at - SCENE_LEAD),
    period: beat.period,
    side: beat.side,
    spot: beat.kind === "corner" ? { x: PITCH_LENGTH - 8, y: PITCH_WIDTH / 2 } : beat.from,
    actorId: beat.actorId,
    /* Only a shot beat decrees a strike. Everything else is played with the
     * scoreboard simply locked, which stage() does by handing over a decree
     * that is already spent. */
    outcome: beat.kind === "shot" || beat.kind === "penalty" ? beat.outcome : null,
    startBack,
    set,
    direct,
    /* How close the man starts to the position the move is for. On the first
     * attempt he has to make the run; by the last he is already there. */
    actorBack: 11 - ease * 8,
  };
}

/**
 * Play one beat until it comes out right.
 *
 * Each attempt is a whole new simulation on its own sub-seed, so a re-roll of
 * one passage cannot disturb any other passage or the plan: the reel is still
 * a pure function of the match seed.
 */
export function runScene(
  setup: MatchSetup,
  beat: Beat,
  options: { formations: Record<string, Formation>; playbook?: Playbook },
  reasons?: Record<string, number>,
): Scene {
  let last: { sim: MatchSim; fromTick: number } | null = null;

  for (let attempt = 0; attempt <= MAX_ATTEMPTS; attempt++) {
    const direct = attempt === MAX_ATTEMPTS;
    const rng = new Rng(`${beat.seed}#${attempt}`);
    const sim = new MatchSim(
      { ...setup, seed: `${beat.seed}#${attempt}` },
      { ...options, keyframeCapacity: 24 },
    );
    sim.stage(stageOptionsFor(beat, rng, attempt, direct));
    const fromTick = sim.tick;
    const toTick = fromTick + Math.round(SCENE_SECONDS * PHYSICS_HZ);
    while (sim.tick < toTick && !sim.finished) sim.step();

    last = { sim, fromTick };
    const why = validate(sim, beat, fromTick);
    if (why !== null && reasons) reasons[why] = (reasons[why] ?? 0) + 1;
    if (direct || why === null) {
      return {
        beat,
        momentSecond: momentOf(sim, beat, fromTick),
        sim,
        fromTick,
        toTick: sim.tick,
        attempts: attempt + 1,
        fellBack: direct,
        events: sim.log.all().filter((e) => !PLAN_OWNS.has(e.type)),
      };
    }
  }

  /* Unreachable: the last attempt is always a direct staging, which puts the
   * ball at his feet in front of goal and cannot fail to produce a strike.
   * Kept as a total function anyway rather than a non-null assertion. */
  const sim = last!.sim;
  return {
    beat,
    momentSecond: momentOf(sim, beat, last!.fromTick),
    sim,
    fromTick: last!.fromTick,
    toTick: sim.tick,
    attempts: MAX_ATTEMPTS + 1,
    fellBack: true,
    events: sim.log.all().filter((e) => !PLAN_OWNS.has(e.type)),
  };
}

/** When the passage's own moment happened, so the plan can be stamped to it. */
function momentOf(sim: MatchSim, beat: Beat, fromTick: number): number {
  const shot = sim.log.all().find((e) => e.type === "Shot" && e.actorId === beat.actorId);
  if (shot) return shot.matchSecond;
  // No strike in this kind of passage: the middle of it is the moment.
  return (fromTick + (sim.tick - fromTick) * 0.6) / PHYSICS_HZ;
}

/* --- beats nobody watches -------------------------------------------------- */

/** Mirror a directed spot into world coordinates for a side and period. */
function worldSpot(spot: Vec2, side: TeamSide, period: 1 | 2): Vec2 {
  const homeDir: Direction = period === 1 ? 1 : -1;
  const dir = side === 0 ? homeDir : ((-homeDir) as Direction);
  return dir === 1 ? { ...spot } : { x: PITCH_LENGTH - spot.x, y: PITCH_WIDTH - spot.y };
}

/**
 * Write a beat straight into the event log without playing it.
 *
 * A shot in the fourteenth minute that does not make a six-clip reel still
 * has to exist: it is in the shot count, in the xG, in the player's rating and
 * in the text commentary. It just never needs a ball flying anywhere.
 */
function paperEvents(beat: Beat, plan: MatchPlan, atSecond?: number): MatchEvent[] {
  const out: MatchEvent[] = [];
  const at = atSecond ?? beat.at;
  const tick = Math.round(at * PHYSICS_HZ);
  const base = {
    tick,
    matchSecond: at,
    period: beat.period,
    actorId: beat.actorId,
    team: beat.side,
  };
  const from = worldSpot(beat.from, beat.side, beat.period);
  const goal = worldSpot({ x: PITCH_LENGTH, y: PITCH_WIDTH / 2 }, beat.side, beat.period);

  switch (beat.kind) {
    case "shot":
    case "penalty": {
      const onTarget = beat.outcome === "goal" || beat.outcome === "saved";
      out.push({
        ...base,
        type: "Shot",
        from: { ...from, z: 0.11 },
        to: { ...goal, z: 0.8 },
        xg: beat.xg,
        psxg: onTarget ? beat.xg : 0,
        onTarget,
        header: beat.header,
        penalty: beat.penalty,
        setPiece: beat.phase === "corner" || beat.phase === "freeKick",
        result: beat.outcome,
      });
      if (beat.outcome === "saved") {
        out.push({
          ...base,
          matchSecond: at + 0.3,
          tick: tick + 36,
          type: "Save",
          actorId: null,
          team: (1 - beat.side) as TeamSide,
          from: { ...goal, z: 0.8 },
          to: null,
          shooterId: beat.actorId,
          held: true,
          parried: false,
        });
      }
      if (beat.outcome === "goal") {
        out.push({
          ...base,
          matchSecond: at + 0.4,
          tick: tick + 48,
          type: "Goal",
          from: { ...from, z: 0.11 },
          to: { ...goal, z: 0.8 },
          scorerId: beat.actorId,
          assistId: null,
          ownGoal: false,
        });
      }
      break;
    }
    case "corner":
      out.push({
        ...base,
        type: "Restart",
        from: null,
        to: { ...worldSpot(beat.from, beat.side, beat.period), z: 0 },
        kind: "corner",
      });
      break;
    case "foul":
      out.push({
        ...base,
        type: "Foul",
        from: { ...from, z: 0 },
        to: null,
        victimId: beat.victimId ?? 0,
        card: beat.card,
        advantage: false,
      });
      break;
    case "offside":
      out.push({
        ...base,
        type: "Offside",
        from: { ...from, z: 0 },
        to: null,
        passerId: beat.actorId,
      });
      break;
  }
  void plan;
  return out;
}

/* --- the connective tissue ------------------------------------------------- */

/**
 * The eighty-odd minutes nobody watches.
 *
 * Passing volume is the one statistic a highlights engine cannot get from what
 * it renders: a reel is four minutes of a ninety-minute match, so counting only
 * the passes in it would report a side completing forty. The passes actually
 * played in the passages are real and are kept; the rest of the match is filled
 * in at the rate the plan implies, so the panel reads like football and the
 * accuracy figure stays an honest ratio of real attempts to real completions.
 */
function connectivePasses(
  plan: MatchPlan,
  setup: MatchSetup,
  secondsShown: number,
  rng: Rng,
): MatchEvent[] {
  const out: MatchEvent[] = [];
  const unseen = clamp(1 - secondsShown / 5400, 0, 1);
  for (const side of [0, 1] as TeamSide[]) {
    const team = side === 0 ? setup.home : setup.away;
    const xi = team.players.slice(0, 11);
    // Around 480 passes a side in a match with even possession.
    const volume = Math.round(960 * plan.possession[side] * unseen);
    for (let i = 0; i < volume; i++) {
      const at = rng.range(0, 5400);
      const passer = xi[rng.int(0, 10)]!;
      const target = xi[rng.int(0, 10)]!;
      out.push({
        tick: Math.round(at * PHYSICS_HZ),
        matchSecond: at,
        period: at < 2700 ? 1 : 2,
        actorId: passer.id,
        team: side,
        from: { x: rng.range(6, PITCH_LENGTH - 6), y: rng.range(3, PITCH_WIDTH - 3), z: 0.11 },
        to: { x: rng.range(6, PITCH_LENGTH - 6), y: rng.range(3, PITCH_WIDTH - 3), z: 0.11 },
        type: "Pass",
        targetId: target.id,
        // 76-86% in open play is the real band; a stronger side keeps it better.
        completed: rng.chance(0.79 + (plan.possession[side] - 0.5) * 0.2),
        length: rng.range(6, 28),
        kind: "open",
      });
    }
  }
  return out;
}

/* --- the whole match ------------------------------------------------------- */

/** Which beats are worth the simulation budget. */
function chooseBeats(plan: MatchPlan, mode: HighlightMode): Beat[] {
  const budget = SCENE_BUDGET[mode];
  /* Goals are never negotiable — a reel that skips one is not a highlights
   * package, it is a bug. Everything else competes on importance, and ties go
   * to the better chance so a reel of six is six good ones. */
  const goals = plan.beats.filter((b) => b.outcome === "goal");
  const rest = plan.beats
    .filter((b) => b.outcome !== "goal")
    .sort((a, b) => b.importance - a.importance || b.xg - a.xg);
  return [...goals, ...rest.slice(0, Math.max(0, budget - goals.length))].sort(
    (a, b) => a.at - b.at,
  );
}

export function produceMatch(
  setup: MatchSetup,
  options: {
    formations: Record<string, Formation>;
    playbook?: Playbook;
    mode: HighlightMode;
    onProgress?: (fraction: number) => void;
  },
): Production {
  const plan = directMatch(setup);
  const chosen = chooseBeats(plan, options.mode);
  const chosenIds = new Set(chosen.map((b) => b.index));

  const scenes: Scene[] = [];
  const events: MatchEvent[] = [];
  let firstTry = 0;
  let fellBack = 0;
  let secondsShown = 0;

  const reasons: Record<string, number> = {};
  let paper = 0;
  for (let i = 0; i < chosen.length; i++) {
    const beat = chosen[i]!;
    const scene = runScene(setup, beat, options, reasons);
    /* LAST LINE OF DEFENCE. If even the fallback did not produce the authored
     * moment, the passage is thrown away and the beat is written into the log
     * on paper. It costs one clip off the reel; what it buys is that the event
     * log and the plan can never disagree, so the score on the strip, the
     * scorer in the commentary and the table at the end of the season are
     * always the same match. That invariant is worth more than a clip. */
    if (validate(scene.sim, beat, scene.fromTick) !== null) {
      paper++;
      events.push(...paperEvents(beat, plan));
      continue;
    }
    scenes.push(scene);
    // The accounting, stamped to when the passage actually produced it, and
    // the texture that happened around it.
    events.push(...paperEvents(beat, plan, scene.momentSecond));
    events.push(...scene.events);
    secondsShown += (scene.toTick - scene.fromTick) / PHYSICS_HZ;
    if (scene.attempts === 1) firstTry++;
    if (scene.fellBack) fellBack++;
    options.onProgress?.((i + 1) / Math.max(chosen.length, 1));
  }

  for (const beat of plan.beats) {
    if (chosenIds.has(beat.index)) continue;
    events.push(...paperEvents(beat, plan));
  }

  const rng = new Rng(`${setup.seed}::tissue`);
  events.push(...connectivePasses(plan, setup, secondsShown, rng));

  /* The whistles. A match has to start, break and end whatever else it does,
   * and the reel's first and last lines are always these. */
  const whistle = (matchSecond: number, kind: "kickOffWhistle" | "halfTime" | "fullTime"): MatchEvent => ({
    tick: Math.round(matchSecond * PHYSICS_HZ),
    matchSecond,
    period: matchSecond < 2700 ? 1 : 2,
    actorId: null,
    team: null,
    from: null,
    to: null,
    type: "Whistle",
    kind,
  });
  events.push(whistle(0, "kickOffWhistle"), whistle(2700, "halfTime"), whistle(5400, "fullTime"));

  events.sort((a, b) => a.matchSecond - b.matchSecond || a.tick - b.tick);

  return {
    plan,
    scenes,
    events,
    quality: { staged: scenes.length, firstTry, fellBack, paper, reasons },
  };
}

/* ============================================================================
 * THE REEL
 *
 * One clip per staged passage, in match order, and the alignment is the whole
 * point. In the old design a highlight was a WINDOW cut out of a finished
 * simulation by a threshold on importance, and the text beside it was whatever
 * commentary line happened to fall inside that window. When the two disagreed
 * — which was the original complaint about this engine — there was nothing to
 * be done, because neither had been built from the other.
 *
 * Here a clip IS a passage that was staged for a beat and then confirmed to
 * show it, and its text is that beat's own commentary line. They cannot come
 * apart, because they are the same object read two ways.
 * ========================================================================== */

export function buildReel(
  production: Production,
  lines: readonly CommentaryLine[],
  playerName: (id: number | null) => string = () => "",
): Highlight[] {
  /* Running score, from the plan rather than from the clips: the strip has to
   * read 2-1 during the passage that makes it 2-1. */
  const goals = production.plan.beats
    .filter((b) => b.outcome === "goal")
    .map((b) => ({ at: b.at, side: b.side }))
    .sort((a, b) => a.at - b.at);

  return production.scenes.map((scene) => {
    const at = scene.momentSecond;
    /* THE LINE FOR THIS BEAT, matched on the moment rather than on a window.
     *
     * The plan's own events are stamped to the second the passage produced
     * them, so this beat's line is at that exact second and no searching is
     * really required — the tolerance is there for the save and goal events
     * that follow a shot by a fraction. Preferring the most important line at
     * that moment is what makes a goal read "GOAL!" rather than "he shoots".
     *
     * An earlier version also skipped lines of importance 0, which threw away
     * the perfectly good line every ordinary shot produces and labelled three
     * clips in a thirteen-clip reel "A chance goes begging". A clip's own line
     * is its own line whatever tier it sits in. */
    let best: CommentaryLine | null = null;
    for (const l of lines) {
      if (Math.abs(l.matchSecond - at) > 1.2) continue;
      if (l.team !== null && l.team !== scene.beat.side) continue;
      if (best === null || l.importance > best.importance) best = l;
    }
    const score: [number, number] = [0, 0];
    for (const g of goals) {
      if (g.at <= scene.beat.at + 0.5) score[g.side]++;
    }
    return {
      from: scene.fromTick / PHYSICS_HZ,
      to: scene.toTick / PHYSICS_HZ,
      at,
      minute: Math.max(1, Math.floor(at / 60) + 1),
      importance: scene.beat.importance,
      kind: best?.kind ?? scene.beat.kind,
      team: scene.beat.side,
      text: best?.text ?? describeBeat(scene.beat, playerName),
      score,
    };
  });
}

/** A last-resort label, for a passage whose commentary line went missing. */
function describeBeat(beat: Beat, playerName: (id: number | null) => string): string {
  const who = playerName(beat.actorId) || "the striker";
  const range = beat.distance > 22 ? "from distance" : beat.distance < 11 ? "from close in" : "from the edge";
  switch (beat.kind) {
    case "penalty":
      return `${who} steps up from the spot.`;
    case "corner":
      return "A corner swung into the box.";
    case "foul":
      return beat.card === "none" ? `A free kick, given against ${who}.` : `${who} goes into the book.`;
    case "offside":
      return `The flag goes up against ${who}.`;
    default:
      switch (beat.outcome) {
        case "goal":
          return `${who} finds the net ${range}.`;
        case "saved":
          return `${who} works the keeper ${range}.`;
        case "blocked":
          return `${who} has it charged down ${range}.`;
        case "post":
          return `${who} strikes the woodwork ${range}.`;
        default:
          return `${who} drags it wide ${range}.`;
      }
  }
}
