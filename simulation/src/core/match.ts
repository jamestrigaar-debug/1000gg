/* ============================================================================
 * MATCH — the fixed-timestep simulation loop.
 *
 * This is the whole product in one object: pure, deterministic, no DOM, no
 * clock, no Math.random. Feed it a MatchSetup and a seed and it will produce
 * the same match every time, on any machine, in a worker or in a test.
 *
 * Loop shape per tick (1/120 s):
 *   1. brains   — only the players whose beat falls on this tick (8 Hz,
 *                 staggered by player index so the cost spreads evenly)
 *   2. movement — steering -> body limits -> integrate
 *   3. ball     — integrate, resolve contacts, resolve possession
 *   4. laws     — line crossings, goals, restarts, clock and period
 *
 * MILESTONE STATUS (M1). The brain in this file is a placeholder: players hold
 * their formation anchors, the nearest player chases a loose ball, and the
 * carrier plays a simple forward pass or shot. It exists so that M0-M1 —
 * pitch, dots, ball flight, possession coupling and restarts — can be seen and
 * verified end to end. M3 replaces `runBrain` with the utility scorer; nothing
 * outside this function should need to change when it does.
 * ========================================================================== */

import {
  BALL_RADIUS,
  CONTROL_MAX_HEIGHT,
  CONTROL_RADIUS,
  DT,
  GOAL_HEIGHT,
  GRAVITY,
  GOAL_WIDTH,
  HALF_LENGTH_SECONDS,
  HALVES,
  STOPPAGE_MAX_SECONDS,
  KEYFRAME_INTERVAL_SECONDS,
  ADVANTAGE_SECONDS,
  AERIAL_BAND_HIGH,
  AERIAL_BAND_LOW,
  AERIAL_LOCK_TICKS,
  AERIAL_RANGE,
  AERIAL_REACH_BASE,
  AERIAL_REACH_JUMP,
  BOOKED_CAUTION,
  CROSS_LOFT,
  CROSS_TARGET_SPREAD,
  FOUL_BASE,
  HOME_EDGE_FOUL,
  HOME_EDGE_PASS,
  HOME_EDGE_SHOT,
  KICK_CONTROL_LOCK,
  KICK_MAX_PACE,
  KICK_SELF_LOCK,
  KNOCK_AHEAD_SECONDS,
  LANE_ADJUST,
  OVERLAP_AHEAD,
  OVERLAP_CHANCE,
  PHYSICS_HZ,
  PITCH_LENGTH,
  PITCH_WIDTH,
  POST_RADIUS,
  POST_RESTITUTION,
  OWN_GOAL_SAVE_BONUS,
  POST_TANGENT_JITTER,
  RESTART_DISTANCE,
  WIDE_ROLE_OFFSET,
  WIDTH_HOLD,
  RED_DOGSO,
  RED_VIOLENT,
  STOPPAGE_PER_CARD,
  TACKLE_ENGAGE_BASE,
  TICKS_PER_BRAIN_BEAT,
  TICKS_PER_STEER,
  TOUCH_DISTANCE_MAX,
  YELLOW_BASE,
  YELLOW_PROMISING_ATTACK,
  TOUCH_DISTANCE_MIN,
} from "./constants";
import { createBall, frictionFor, integrateBall, isDead, type BallState } from "./ball";
import { EventLog, type MatchEvent, type MatchEventDraft } from "./events";
import { kickOffAnchor, slotAnchor } from "./formation";
import { SpatialGrid } from "./grid";
import { attr01, clamp, dist, distToSegment, lerp, type Vec2, type Vec3 } from "./math";
import {
  createPlayer,
  integratePlayer,
  refreshCeilings,
  steerPlayer,
  type Player,
} from "./player";
import {
  CENTRE,
  crossedLine,
  SIM_MAX_X,
  SIM_MAX_Y,
  SIM_MIN_X,
  SIM_MIN_Y,
  distanceToGoal,
  penaltySpot,
  inBox,
  penaltyArea,
  sixYardBox,
  goalCentre,
  goalPostY,
  nearestCorner,
  type Direction,
} from "./pitch";
import { kickSkill, minimumSpeedFor, solveKick, strikeVelocity } from "./kick";
import {
  expectedGoals,
  goalMouthPoint,
  postShotXG,
  resolveShot,
  saveFailChance,
  type ShotOutcome,
} from "./shot";
import { BASE_THREAT, zoneThreat } from "./threat";
import {
  collectiveWeight,
  defaultRole,
  gameStateWeight,
  roleWeight,
  type Intent,
} from "./intent";
import {
  candidates,
  MOVE_MAX_SECONDS,
  pitchToZone,
  roleOf,
  stepsFor,
  zoneToPitch,
  type ActiveMove,
  type MoveStep,
  type Playbook,
  type PlaybookMove,
} from "./playbook";
import { Rng } from "./rng";
import {
  KeyframeRing,
  type BallSnapshot,
  type FullSnapshot,
  type PlayPhase,
  type PlayerSnapshot,
  type RenderSnapshot,
} from "./snapshot";
import type { Formation, MatchSetup, Phase, TeamSide, UserCommand } from "./types";

export interface MatchOptions {
  formations: Record<string, Formation>;
  /** The pool of recorded moves this match may run. Optional: without it the
   *  utility brain plays every ball itself, which is what the tests that
   *  isolate the decision layer want. */
  playbook?: Playbook;
  /** Keyframes kept for seeking; 200 covers a full match at 30 s spacing. */
  keyframeCapacity?: number;
}

interface PendingRestart {
  kind: "kickOff" | "throw" | "corner" | "goalKick" | "freeKick" | "penalty";
  side: TeamSide;
  at: Vec2;
  /** Tick at which the restart is actually taken (a beat of dead time). */
  takeAt: number;
}

export class MatchSim {
  readonly setup: MatchSetup;
  readonly log = new EventLog();
  readonly rng: Rng;

  tick = 0;
  period = 1;
  play: PlayPhase = "preKickOff";
  score: [number, number] = [0, 0];
  /** Home side's attacking direction; away is always the negation. */
  homeDir: Direction = 1;

  readonly players: Player[] = [];
  readonly ball: BallState;

  private readonly formations: Record<string, Formation>;
  private readonly playbook: Playbook | null;
  /** The move each side is running, if any. */
  private readonly activeMove: [ActiveMove | null, ActiveMove | null] = [null, null];
  private readonly grid = new SpatialGrid<Player>();
  private readonly keyframes: KeyframeRing;
  private readonly friction: number;
  /** 0 at a neutral venue; the home club's rating otherwise. */
  private readonly homeAdvantage: number;
  private readonly neighbourBuf: Player[] = [];
  /** Rebuilt in place each tick: allocating a fresh array 120 times a second
   *  for 90 minutes is the difference between a batch of 1,000 matches taking
   *  minutes and taking an hour. */
  private readonly activeBuf: Player[] = [];
  private readonly byId = new Map<number, Player>();
  private readonly queryBuf: Player[] = [];
  private readonly pressureBuf: Player[] = [];
  private readonly mateBuf: Player[] = [];
  private readonly optionBuf: Player[] = [];
  /** Ticks during which the ball in the air may not be contested again. */
  private aerialLockTick = 0;
  private readonly aerialBuf: Player[] = [];
  /** Tick of the last restart, so a shot can say whether it came from one. */
  private lastRestartTick = -9999;
  /** A foul the referee is holding the whistle on. */
  private advantage: { side: TeamSide; at: Vec2; until: number } | null = null;
  private readonly offsideLineTick: [number, number] = [-1, -1];
  private readonly offsideLineCache: [number, number] = [0, 0];

  private pending: PendingRestart | null = null;
  private lastEventIndex = 0;
  /** Ticks the ball has been dead-and-unowned; feeds the stall watchdog. */
  private stalledTicks = 0;
  /** Tick the current carrier took possession; the stub brain reads it. */
  private ownedSinceTick = 0;
  /** Nobody may control the ball before this tick; the striker of it not
   *  before `selfLockTick`. Set by every kick. */
  private controlLockTick = 0;
  private selfLockTick = 0;
  private lastKickerId: number | null = null;
  /** Ticks during which a stray ball has already been faced by a keeper. */
  private strayFacedUntil = 0;
  /** While the ball in flight is a shot the model has already ruled on, no
   *  other mechanic may touch it: not the keeper's sweep, not the stray-ball
   *  save. Without this a shot the model called a goal is re-faced as if it
   *  were a wayward clearance and saved on the line, and the engine's goals
   *  quietly disappear. */
  private resolvedShotUntil = 0;
  /** A shot in flight whose outcome the model has already decided. The ball
   *  flies for the view; this is what actually happens when it arrives. */
  private pendingShot:
    | { outcome: ShotOutcome; side: TeamSide; dir: Direction; shooterId: number }
    | null = null;
  /** Tick the attacking side won the ball; a shot inside COUNTER_WINDOW of a
   *  turnover in their own half counts as a counter-attack for the xG model. */
  private readonly wonBallTick: [number, number] = [0, 0];
  private readonly wonBallDeep: [boolean, boolean] = [false, false];
  /** Seconds of stoppage accrued this period, derived from stoppage events. */
  private stoppageSeconds = 0;
  /** Ticks each side has had the ball at its feet. Possession as football
   *  means it: time in control, not time since the last touch. */
  private readonly possessionTicks: [number, number] = [0, 0];

  constructor(setup: MatchSetup, options: MatchOptions) {
    this.setup = setup;
    this.formations = options.formations;
    this.playbook = options.playbook ?? null;
    this.rng = new Rng(setup.seed);
    this.friction = frictionFor(setup.weather.pitchCondition);
    this.homeAdvantage = clamp(setup.homeAdvantage ?? 0, 0, 10);
    /* One keyframe every KEYFRAME_INTERVAL_SECONDS, and the ring has to span
     * the longest match the engine can produce or seeking loses the start of
     * it. Two 45s plus the six-minute stoppage ceiling each is 102 minutes,
     * and runToEnd's own guard allows 130; 280 frames covers 140 minutes with
     * room to spare, at a few hundred KB. The old 200 covered 100 minutes,
     * which any match that ran to full stoppage quietly overran. */
    this.keyframes = new KeyframeRing(options.keyframeCapacity ?? 280);
    this.ball = createBall({ x: CENTRE.x, y: CENTRE.y, z: 0 });

    this.spawnTeam(0);
    this.spawnTeam(1);
    this.setupKickOff(0);

    /* A keyframe for the kick-off itself.
     *
     * maybeKeyframe() runs at the END of step(), after the tick counter has
     * already moved, so the first frame it ever writes is at tick 3600 — half
     * a minute in. Nothing covered the thirty seconds before it, seeking into
     * them found no frame at or before the target, and the highlight ended the
     * moment it was clicked. That is one dead passage in every single match:
     * the kick-off is always the reel's first line. */
    this.keyframes.push(this.fullSnapshot());
  }

  /* --- clock ------------------------------------------------------------ */

  get matchSecond(): number {
    return this.tick / PHYSICS_HZ;
  }

  /** Seconds elapsed within the current period. */
  get periodSecond(): number {
    return this.matchSecond - (this.period - 1) * HALF_LENGTH_SECONDS;
  }

  get finished(): boolean {
    return this.play === "fullTime";
  }

  /* --- setup ------------------------------------------------------------ */

  private tacticsFor(side: TeamSide) {
    return side === 0 ? this.setup.homeTactics : this.setup.awayTactics;
  }

  private teamFor(side: TeamSide) {
    return side === 0 ? this.setup.home : this.setup.away;
  }

  dirFor(side: TeamSide): Direction {
    return side === 0 ? this.homeDir : ((-this.homeDir) as Direction);
  }

  private formationFor(side: TeamSide): Formation {
    const id = this.tacticsFor(side).formationId;
    const f = this.formations[id];
    if (!f) throw new Error(`unknown formation "${id}"`);
    return f;
  }

  private spawnTeam(side: TeamSide): void {
    const team = this.teamFor(side);
    const formation = this.formationFor(side);
    const ins = this.tacticsFor(side).instructions;
    const dir = this.dirFor(side);
    for (let slot = 0; slot < 11; slot++) {
      const def = team.players[slot];
      if (!def) throw new Error(`${team.name} has no player for slot ${slot}`);
      const anchor = slotAnchor(formation, slot, "AttackBuildUp", dir, ins);
      const p = createPlayer(def, side, slot, anchor);
      // Stagger brain beats across the whole beat window so 22 brains never
      // land on the same tick; this is what keeps frame cost flat.
      p.nextBrainTick = (side * 11 + slot) % TICKS_PER_BRAIN_BEAT;
      this.players.push(p);
    }
  }

  private setupKickOff(taking: TeamSide): void {
    this.play = "preKickOff";
    this.ball.pos = { x: CENTRE.x, y: CENTRE.y, z: 0 };
    this.ball.vel = { x: 0, y: 0, z: 0 };
    this.ball.spin = 0;
    this.ball.owner = null;
    for (const p of this.players) {
      if (!p.onPitch) continue;
      const anchor = kickOffAnchor(
        this.formationFor(p.side),
        p.slot,
        this.dirFor(p.side),
        this.tacticsFor(p.side).instructions,
        p.side === taking,
      );
      p.pos = { ...anchor };
      p.vel = { x: 0, y: 0 };
      p.target = { ...anchor };
      p.state = "HoldShape";
    }
    this.pending = {
      kind: "kickOff",
      side: taking,
      at: { x: CENTRE.x, y: CENTRE.y },
      takeAt: this.tick + PHYSICS_HZ, // one second of settling
    };
  }

  /* --- main loop -------------------------------------------------------- */

  /** Advance exactly one physics tick. */
  step(): void {
    if (this.play === "fullTime") return;

    // The grid backs the steering and brain queries, so it is rebuilt on the
    // steering beat rather than every tick: nothing reads it in between.
    const steerBeat = this.tick % TICKS_PER_STEER === 0;
    if (steerBeat) {
      this.activeBuf.length = 0;
      for (const p of this.players) if (p.onPitch) this.activeBuf.push(p);
      this.grid.rebuild(this.activeBuf);
    }

    for (const p of this.players) {
      if (!p.onPitch) continue;
      if (this.tick >= p.nextBrainTick) {
        // Ceilings only move as stamina drains, which is a brain-beat-scale
        // effect: recomputing them 120 times a second buys nothing.
        refreshCeilings(p);
        this.runBrain(p);
        p.nextBrainTick = this.tick + TICKS_PER_BRAIN_BEAT;
      }
      const maxSpeed = this.maxSpeedFor(p);
      if (steerBeat) {
        steerPlayer(
          p,
          p.target.x,
          p.target.y,
          this.grid.query(p.pos, 4, this.neighbourBuf),
          maxSpeed,
        );
      }
      integratePlayer(p, maxSpeed, DT);
    }

    this.updateMoves();
    this.updateAdvantage();
    if (steerBeat) this.contestCarrier();
    this.stepBall();
    this.resolveAerial();
    this.faceStrayBall();
    this.resolvePendingShot();
    this.resolveRestart();
    this.resolveLaws();
    this.watchdog();

    const carrier = this.ball.owner === null ? null : this.playerById(this.ball.owner);
    if (carrier) this.possessionTicks[carrier.side]++;

    this.tick++;
    this.maybeKeyframe();
    this.advancePeriod();
  }

  /** Advance `seconds` of match time. The director's steps-per-second knob. */
  stepSeconds(seconds: number): void {
    const ticks = Math.round(seconds * PHYSICS_HZ);
    for (let i = 0; i < ticks && !this.finished; i++) this.step();
  }

  /** Run to the final whistle. Used by the headless batch runner. */
  runToEnd(maxTicks = PHYSICS_HZ * 60 * 130): void {
    let guard = 0;
    while (!this.finished && guard++ < maxTicks) this.step();
  }

  /**
   * How fast a player is actually trying to move, which is not the same as how
   * fast he can. Nobody sprints for ninety minutes: a defender holding a line
   * jogs, a striker pressing a centre-half does not. Before this existed every
   * player ran flat out at every moment and finished every match on zero
   * stamina, which made the stamina attribute meaningless.
   */
  private maxSpeedFor(p: Player): number {
    if (this.ball.owner === p.def.id) return p.vMax * p.carryFactor;
    const urgency =
      p.state === "ChaseBall" || p.state === "Press" || p.state === "Contest" || p.state === "RunBehind"
        ? 1
        : p.state === "TrackRunner"
          ? 0.9
          : // Holding a shape: jog, and only stretch when badly out of position.
            clamp(0.5 + dist(p.pos, p.target) / 14, 0.5, 1);
    return p.vMax * urgency;
  }

  /* --- ball ------------------------------------------------------------- */

  private stepBall(): void {
    const owner = this.ball.owner === null ? null : this.playerById(this.ball.owner);

    if (owner) {
      // Owner coupling: the ball sits a knock ahead of the carrier, in the
      // direction they are travelling. Poor first touch pushes it further.
      const speed = Math.hypot(owner.vel.x, owner.vel.y);
      const touch = lerp(
        TOUCH_DISTANCE_MAX,
        TOUCH_DISTANCE_MIN,
        attr01(owner.def.attributes.firstTouch),
      );
      const ahead = Math.max(touch, speed * KNOCK_AHEAD_SECONDS);
      this.ball.pos = {
        x: owner.pos.x + Math.cos(owner.heading) * ahead,
        y: owner.pos.y + Math.sin(owner.heading) * ahead,
        z: 0,
      };
      this.ball.vel = { x: owner.vel.x, y: owner.vel.y, z: 0 };
      return;
    }

    const before: Vec3 = { ...this.ball.pos };
    integrateBall(this.ball, DT, this.friction);
    this.resolveWoodwork(before);
    this.keeperClaim();
    this.resolvePossession();
  }

  /** Post and bar as capsules. A shot that clips the woodwork must not simply
   *  pass through it — the rebound is often the most interesting ball in the
   *  match, and the tiny tangent jitter stops it being predictable. */
  private resolveWoodwork(before: Vec3): void {
    for (const dir of [1, -1] as Direction[]) {
      const gx = goalCentre(dir).x;
      const { near, far } = goalPostY();
      // Only test when the ball is at the goal line's depth this step.
      const crossing =
        (before.x - gx) * (this.ball.pos.x - gx) <= 0 || Math.abs(this.ball.pos.x - gx) < 0.3;
      if (!crossing) continue;
      if (this.ball.pos.z > GOAL_HEIGHT + 0.4) continue;

      for (const postY of [near, far]) {
        const d = Math.hypot(this.ball.pos.x - gx, this.ball.pos.y - postY);
        if (d > POST_RADIUS + BALL_RADIUS || this.ball.pos.z > GOAL_HEIGHT) continue;
        const nx = d < 1e-6 ? 1 : (this.ball.pos.x - gx) / d;
        const ny = d < 1e-6 ? 0 : (this.ball.pos.y - postY) / d;
        this.reflect(nx, ny);
        return;
      }

      // Crossbar: at goal height, between the posts.
      const atBarHeight =
        Math.abs(this.ball.pos.z - GOAL_HEIGHT) < BALL_RADIUS + POST_RADIUS;
      if (this.ball.pos.y > near && this.ball.pos.y < far && atBarHeight && this.ball.vel.z > 0) {
        this.ball.vel.z = -Math.abs(this.ball.vel.z) * POST_RESTITUTION;
        this.ball.vel.x *= POST_RESTITUTION;
        this.ball.vel.y *= POST_RESTITUTION;
        this.ball.pos.z = GOAL_HEIGHT - BALL_RADIUS;
        return;
      }
    }
  }

  private reflect(nx: number, ny: number): void {
    const v = this.ball.vel;
    const dotp = v.x * nx + v.y * ny;
    let rx = (v.x - 2 * dotp * nx) * POST_RESTITUTION;
    let ry = (v.y - 2 * dotp * ny) * POST_RESTITUTION;
    const jitter = this.rng.range(-POST_TANGENT_JITTER, POST_TANGENT_JITTER);
    const c = Math.cos(jitter);
    const s = Math.sin(jitter);
    [rx, ry] = [rx * c - ry * s, rx * s + ry * c];
    v.x = rx;
    v.y = ry;
    v.z *= POST_RESTITUTION;
    // Nudge clear of the post so the next tick cannot re-collide.
    this.ball.pos.x += nx * 0.05;
    this.ball.pos.y += ny * 0.05;
  }

  /** A loose, low, slow-enough ball is taken by the closest eligible player. */
  private resolvePossession(): void {
    if (this.ball.owner !== null || this.play !== "live") return;
    if (this.ball.pos.z > CONTROL_MAX_HEIGHT) return;
    if (this.tick < this.controlLockTick) return;

    const near = this.grid.query(
      { x: this.ball.pos.x, y: this.ball.pos.y },
      CONTROL_RADIUS + 0.5,
      this.queryBuf,
    );
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of near) {
      if (!p.onPitch) continue;
      // The player who struck it cannot simply run onto his own pass.
      if (p.def.id === this.lastKickerId && this.tick < this.selfLockTick) continue;
      const d = dist(p.pos, this.ball.pos);
      // Ties break on player id, never on iteration order — determinism.
      if (d < bestD || (d === bestD && best !== null && p.def.id < best.def.id)) {
        best = p;
        bestD = d;
      }
    }
    if (!best || bestD > CONTROL_RADIUS) return;

    // A fizzing ball is harder to bring down; first touch decides.
    const ballSpeed = Math.hypot(this.ball.vel.x, this.ball.vel.y);
    const control = attr01(best.def.attributes.firstTouch);
    const difficulty = clamp(ballSpeed / 22 - control * 0.6, 0, 1);
    if (this.rng.chance(difficulty * 0.55)) {
      // Bad touch: the ball squirts away and stays loose.
      const angle = this.rng.range(0, Math.PI * 2);
      const push = lerp(1.2, 3.4, difficulty);
      this.ball.vel.x = Math.cos(angle) * push;
      this.ball.vel.y = Math.sin(angle) * push;
      this.ball.lastTouch = best.def.id;
      this.ball.lastTouchTeam = best.side;
      return;
    }

    if (this.ball.lastTouchTeam !== null && this.ball.lastTouchTeam !== best.side) {
      this.recordTurnover(best);
    }
    this.ball.owner = best.def.id;
    this.ball.lofted = false;
    this.ownedSinceTick = this.tick;
    this.ball.lastTouch = best.def.id;
    this.ball.lastTouchTeam = best.side;
    this.ball.vel = { x: 0, y: 0, z: 0 };
    best.state = best.isKeeper ? "Distribute" : "Dribble";
  }

  /* --- placeholder brain (replaced in M3) -------------------------------- */

  private runBrain(p: Player): void {
    const dir = this.dirFor(p.side);
    const carrier = this.ball.owner === null ? null : this.playerById(this.ball.owner);

    if (carrier === p) {
      if (p.isKeeper) {
        // A keeper collecting the ball ends whatever his side was running.
        this.abortMove(p.side);
        this.keeperDistribution(p, dir);
      } else if (!this.runMove(p, dir)) {
        // The man on the ball is not doing his part of the move — because it
        // has run out of steps, or because his role belongs to someone else.
        // Rather than leave a half-run move governing everyone else's runs,
        // it is abandoned and the whole side plays off the brain again.
        if (this.activeMove[p.side] && !roleOf(this.activeMove[p.side], p.def.id)) {
          this.abortMove(p.side);
        }
        this.carrierBrain(p, dir);
      }
      return;
    }

    // Off the ball, a player with a part in the move plays it.
    if (this.runMove(p, dir)) return;

    if (p.isKeeper) {
      this.keeperBrain(p, dir, carrier);
      return;
    }

    /* Which side is "in possession" is not the same question as who is
     * holding the ball. A loose ball belongs, for the purposes of shape, to
     * whoever is going to reach it — otherwise, since a match engine's ball
     * spends most of its life in flight or on the deck between players, both
     * teams stand in their formation shape doing nothing for eighty of the
     * ninety minutes. That was measurably what this engine was doing. */
    const owning = this.possessionSide();
    const phase: Phase = owning === p.side ? "AttackBuildUp" : "DefendBlock";
    const anchor = slotAnchor(
      this.formationFor(p.side),
      p.slot,
      phase,
      dir,
      this.tacticsFor(p.side).instructions,
    );

    /* Both sides go for a loose ball, not just whichever team happens to be
     * nearest: the closest man on EACH side goes to where the ball is going to
     * be. That is what produces a contest — two players arriving at the same
     * dropping ball — and without it the engine had six contested aerial
     * duels in a match against a real forty. */
    if (this.ball.owner === null && this.nearestOfSideToBall(p.side) === p) {
      p.state = "ChaseBall";
      p.target = this.ballInterceptPoint(p);
      return;
    }
    if (this.ball.owner !== null && owning !== p.side && this.nearestOfSideToBall(p.side) === p) {
      // Their ball, but he is the closest: go and press it.
      p.state = "ChaseBall";
      p.target = this.ballInterceptPoint(p);
      return;
    }

    if (owning !== p.side) {
      this.defendBrain(p, dir, anchor, carrier);
      return;
    }

    /* A forward with the ball in front of him gambles on a run in behind.
     * These are the runs that get caught offside — and the reason a real match
     * has four or five of them and this engine had one. */
    const gambler =
      (p.def.position === "ST" || p.def.position === "AM") &&
      carrier !== null &&
      carrier.side === p.side &&
      (carrier.pos.x - p.pos.x) * dir < 0;
    if (gambler && this.rng.chance(0.12 + attr01(p.def.attributes.offTheBall) * 0.12)) {
      p.state = "RunBehind";
      const goal = goalCentre(dir);
      p.target = {
        x: clamp(this.offsideLineX(p.side) + dir * this.rng.range(0, 4), 2, PITCH_LENGTH - 2),
        y: clamp(p.pos.y + (goal.y - p.pos.y) * 0.3, 3, PITCH_WIDTH - 3),
      };
      return;
    }

    this.supportBrain(p, dir, anchor, carrier);
  }

  /**
   * IN POSSESSION, OFF THE BALL.
   *
   * This used to be one line: shift everyone towards the ball and a bit
   * further up the pitch. It is the single biggest reason the match looked
   * unintelligent, and for a specific reason — shifting EVERYONE towards the
   * ball narrows the side that has it. A team in possession does the
   * opposite: it makes the pitch as big as it can, because space is the thing
   * it is trying to create. The old rule had all eleven converging on the ball
   * like a school playground, which is why every attack came through the
   * middle and why the wings were empty all match.
   *
   * So the shape now does four things, in this order:
   *
   *   WIDTH      wide roles hold their touchline instead of drifting inside.
   *              Whether a role is wide is read off its own formation anchor,
   *              so it needs no per-slot flag and it follows the shape the
   *              user picked.
   *   DEPTH      everyone pushes up with the ball, as before.
   *   OVERLAP    a full-back whose flank the ball is on, in the opposition
   *              half, runs BEYOND it down the line. This is the run that
   *              makes a back four look like a modern one.
   *   THE ANGLE  if an opponent is standing in the line between the ball and
   *              where he means to stand, he steps off it. Offering a passing
   *              option is what a supporting player is FOR, and standing in a
   *              covered lane is the same as not being there.
   */
  private supportBrain(p: Player, dir: Direction, anchor: Vec2, carrier: Player | null): void {
    const centre = PITCH_WIDTH / 2;
    const eagerness = this.intentWeight(p, "Support");

    /* DEPTH. Push on with the ball, as before. */
    const support = clamp((this.ball.pos.x - anchor.x) * 0.22 * eagerness, -10, 10);
    let wantX = anchor.x + support;

    /* WIDTH. A wide role is one whose own anchor sits away from the middle. */
    const fromCentre = anchor.y - centre;
    const wide = Math.abs(fromCentre) > WIDE_ROLE_OFFSET;
    let wantY: number;
    if (wide) {
      /* Hold the touchline. The far-side wide man tucks in a little to attack
       * the back post, but never all the way across — somebody has to be
       * there when the ball is switched. */
      const ballSide = Math.sign(this.ball.pos.y - centre) === Math.sign(fromCentre);
      const stretch = ballSide ? WIDTH_HOLD : WIDTH_HOLD * 0.45;
      wantY = anchor.y + Math.sign(fromCentre) * stretch;
    } else {
      // Central players shift towards the ball to give a short option.
      wantY = anchor.y + clamp((this.ball.pos.y - centre) * 0.3, -8, 8);
    }

    /* OVERLAP. A full-back on the ball's flank, in the opposition half, goes
     * beyond it. Gated on the chance, his engine and his legs, so it is a run
     * he chooses to make rather than one he makes every time. */
    const fullBack = p.def.position === "DL" || p.def.position === "DR";
    if (
      fullBack &&
      carrier !== null &&
      carrier.side === p.side &&
      (this.ball.pos.x - PITCH_LENGTH / 2) * dir > -8 &&
      Math.sign(this.ball.pos.y - centre) === Math.sign(fromCentre) &&
      Math.abs(this.ball.pos.y - p.pos.y) < 22 &&
      p.stamina > 0.35 &&
      this.rng.chance(
        OVERLAP_CHANCE * (0.5 + attr01(p.def.attributes.workRate) * 0.5) * eagerness,
      )
    ) {
      wantX = this.ball.pos.x + dir * OVERLAP_AHEAD;
      wantY = anchor.y + Math.sign(fromCentre) * WIDTH_HOLD;
    }

    let spot: Vec2 = {
      x: clamp(wantX, 1, PITCH_LENGTH - 1),
      y: clamp(wantY, 1, PITCH_WIDTH - 1),
    };

    /* THE ANGLE. Standing in a lane an opponent is covering is the same as
     * not offering the pass at all: step off it. */
    if (carrier !== null && carrier.side === p.side && this.laneBlocked(carrier.pos, spot)) {
      spot = this.openLane(carrier.pos, spot);
    }

    p.state = "Support";
    p.target = this.keepOnside(p, spot);
  }

  /** Is an opponent of `from`'s side standing in the line between two points? */
  private laneBlocked(from: Vec2, to: Vec2): boolean {
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const radius = Math.max(dist(from, to) / 2, 1) + 2;
    for (const q of this.grid.query(mid, radius, this.optionBuf)) {
      if (!q.onPitch || q.isKeeper) continue;
      if (distToSegment(q.pos, from, to) < 1.8) return true;
    }
    return false;
  }

  /**
   * Step sideways off a covered lane, picking whichever side is clearer.
   * Both candidates are tried and the first clear one wins; if neither is
   * clear the wider of the two is taken, because moving is still better than
   * standing behind a defender.
   */
  private openLane(from: Vec2, spot: Vec2): Vec2 {
    const dx = spot.x - from.x;
    const dy = spot.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    // Unit normal to the passing line.
    const nx = -dy / len;
    const ny = dx / len;
    for (const sign of [1, -1]) {
      const candidate = {
        x: clamp(spot.x + nx * LANE_ADJUST * sign, 1, PITCH_LENGTH - 1),
        y: clamp(spot.y + ny * LANE_ADJUST * sign, 1, PITCH_WIDTH - 1),
      };
      if (!this.laneBlocked(from, candidate)) return candidate;
    }
    return {
      x: clamp(spot.x + nx * LANE_ADJUST, 1, PITCH_LENGTH - 1),
      y: clamp(spot.y + ny * LANE_ADJUST, 1, PITCH_WIDTH - 1),
    };
  }

  /**
   * Out of possession. One man goes to the ball (handled by the caller), the
   * next covers the space behind him, and everybody else picks up a man —
   * with a limit on how far up the pitch they will follow him, which is what
   * gives the side a block to defend in rather than a chase.
   */
  private defendBrain(p: Player, dir: Direction, anchor: Vec2, carrier: Player | null): void {
    const ownDir = dir === 1 ? (-1 as Direction) : (1 as Direction);
    const own = goalCentre(ownDir);
    const focus: Vec2 = carrier ? carrier.pos : { x: this.ball.pos.x, y: this.ball.pos.y };
    const rank = this.ballRank(p);
    const ins = this.tacticsFor(p.side).instructions;

    // First man goes to the ball; second man covers the space behind him.
    // Nobody else leaves the block — a defence that collapses onto the ball
    // is a defence with nothing between the ball and the goal, which is how
    // this engine used to concede sixteen goals a match.
    /* The nearest man presses — unless his side is set up not to, in which
     * case he shows the carrier inside and holds the line instead. That choice
     * is the pressing instruction and the role, nothing else. */
    if (rank === 0) {
      const press = this.intentWeight(p, "Press");
      const hold = this.intentWeight(p, "HoldShape");
      if (press >= hold * 0.8 || dist(focus, own) < 28) {
        p.state = "Press";
        const gx = own.x - focus.x;
        const gy = own.y - focus.y;
        const gl = Math.hypot(gx, gy) || 1;
        p.target = { x: focus.x + (gx / gl) * 0.7, y: focus.y + (gy / gl) * 0.7 };
        return;
      }
      // Jockey: stay between him and goal, a couple of yards off.
      p.state = "TrackRunner";
      p.target = { x: lerp(focus.x, own.x, 0.12), y: lerp(focus.y, own.y, 0.12) };
      return;
    }
    if (rank === 1) {
      p.state = "TrackRunner";
      p.target = { x: lerp(focus.x, own.x, 0.32), y: lerp(focus.y, own.y, 0.32) };
      return;
    }

    /* THE BLOCK.
     *
     * The line sits a set distance goal-side of the ball, and the whole team
     * holds a band roughly 30 m deep behind it — high line, compact block.
     * Each player keeps his own slot's shape inside that band rather than
     * chasing: the point of a block is that it is still there when the ball
     * arrives. Marking only happens inside it, for runners in the box. */
    // How far the ball is from the goal being defended, measured along the
    // direction this side attacks, so the same arithmetic works at both ends.
    const ballProgress = (focus.x - own.x) * dir;
    const engage = 12 + ins.lineOfEngagement * 16;
    /* The back line sits goal-side of the ball. Both terms matter: a set
     * distance behind it when the ball is upfield, and — this is the one the
     * engine was missing — never in FRONT of it when the ball is close. With
     * only the first term, a ball five metres from goal put the whole defence
     * eight metres further out than the ball, so nobody at all was in the
     * six-yard box and every chance was a tap-in. */
    const lineX =
      own.x +
      dir * clamp(Math.min(ballProgress - engage, ballProgress * 0.6), 5.5, PITCH_LENGTH * 0.62);
    const depth = 34 - ins.pressing * 8;

    // Where this slot sits within the band, front to back, from its own
    // anchor: the block keeps the team's shape, it does not flatten it.
    const slotDepth = clamp((anchor.x - own.x) * dir, 0, PITCH_LENGTH);
    const bandPos = clamp(slotDepth / (PITCH_LENGTH * 0.7), 0, 1);
    /* The line sits deeper or higher according to what the side has been told
     * and what the scoreboard says: a team protecting a lead in the last ten
     * minutes drops, a team chasing one steps up. */
    const lineShift = clamp(
      (this.intentWeight(p, "StepUp") - this.intentWeight(p, "DropDeep")) * 6,
      -8,
      8,
    );
    const wantX = lineX + dir * bandPos * depth;

    // Narrow towards the ball's side without abandoning the far post.
    const squeeze = 0.28 + ins.pressing * 0.14;
    const wantY = lerp(anchor.y, focus.y, squeeze);

    // In the defensive third, pick up whoever is nearest and unclaimed: the
    // difference between a block and a wall of statues is that somebody goes
    // with the runner.
    if (dist(p.pos, own) < 30) {
      const mark = this.markFor(p, carrier);
      if (mark && dist(p.pos, mark.pos) < 14) {
        p.state = "TrackRunner";
        const gx = own.x - mark.pos.x;
        const gy = own.y - mark.pos.y;
        const gl = Math.hypot(gx, gy) || 1;
        const tight = lerp(1.9, 0.9, attr01(p.def.attributes.marking));
        p.target = {
          x: clamp(mark.pos.x + (gx / gl) * tight, 1, PITCH_LENGTH - 1),
          y: clamp(mark.pos.y + (gy / gl) * tight, 1, PITCH_WIDTH - 1),
        };
        return;
      }
    }

    p.state = "HoldShape";
    p.target = {
      x: clamp(wantX + dir * lineShift, 1, PITCH_LENGTH - 1),
      y: clamp(wantY, 1, PITCH_WIDTH - 1),
    };
  }

  private keeperBrain(p: Player, dir: Direction, carrier: Player | null): void {
    const ownGoalDir = dir === 1 ? (-1 as Direction) : (1 as Direction);

    /* First job: if anything is heading for his goal, get across to it. This
     * covers shots, deflections and — the one the engine kept conceding — a
     * team-mate's backpass rolling towards an empty net. */
    const line = this.ballCrossingPoint(ownGoalDir);
    if (line !== null && this.ball.owner === null) {
      p.state = "Contest";
      const { near, far } = goalPostY();
      p.target = {
        x: goalCentre(ownGoalDir).x - ownGoalDir * 0.4,
        y: clamp(line, near - 0.5, far + 0.5),
      };
      return;
    }
    // Rush out: an opponent carrying the ball into the area is the keeper's
    // problem, not the defence's.
    if (
      carrier &&
      carrier.side !== p.side &&
      inBox(carrier.pos, penaltyArea(ownGoalDir)) &&
      dist(carrier.pos, goalCentre(ownGoalDir)) < 12 + attr01(p.def.attributes.commandOfArea) * 4
    ) {
      p.state = "Contest";
      p.target = { x: carrier.pos.x, y: carrier.pos.y };
      return;
    }
    // Otherwise hold the arc between the ball and the middle of the goal.
    const g = goalCentre(ownGoalDir);
    const toBall = { x: this.ball.pos.x - g.x, y: this.ball.pos.y - g.y };
    const l = Math.hypot(toBall.x, toBall.y) || 1;
    const off = clamp(l * 0.08, 0.6, 4.5);
    p.state = "TendGoal";
    p.target = { x: g.x + (toBall.x / l) * off, y: g.y + (toBall.y / l) * off };
  }

  /** Which side the ball belongs to: its carrier's, or — for a loose ball —
   *  whichever side is closest to it. */
  private possessionSide(): TeamSide | null {
    if (this.ball.owner !== null) return this.playerById(this.ball.owner)?.side ?? null;
    const nearest = this.closestTo(this.ball.pos);
    return nearest ? nearest.side : null;
  }

  /**
   * Where to run to meet the ball, rather than where it is now.
   *
   * For a ball in the air that means the landing point: a defender under a
   * cross runs to where it is coming down, not to the shadow beneath it. The
   * projection ignores drag, which over the second or two a ball hangs is
   * worth a few tens of centimetres.
   */
  private ballInterceptPoint(p: Player): Vec2 {
    const b = this.ball;
    if (b.pos.z > 0.5 || b.vel.z > 1) {
      // t for the ball to fall back to heading height.
      const target = Math.min(b.pos.z, 1.8);
      const disc = b.vel.z * b.vel.z + 2 * GRAVITY * (b.pos.z - target);
      const t = disc > 0 ? (b.vel.z + Math.sqrt(disc)) / GRAVITY : 0;
      const flight = clamp(t, 0, 3);
      return {
        x: clamp(b.pos.x + b.vel.x * flight, SIM_MIN_X, SIM_MAX_X),
        y: clamp(b.pos.y + b.vel.y * flight, SIM_MIN_Y, SIM_MAX_Y),
      };
    }
    const lead = clamp(dist(p.pos, b.pos) / Math.max(p.vMax, 1), 0, 1.2);
    return { x: b.pos.x + b.vel.x * lead * 0.6, y: b.pos.y + b.vel.y * lead * 0.6 };
  }

  /**
   * Where the ball will cross the goal line at `dir`'s end, or null if it is
   * not going to. Used by the keeper to get across, and deliberately generous
   * about the posts: a keeper covers a ball a yard wide of his post too.
   */
  private ballCrossingPoint(dir: Direction): number | null {
    const b = this.ball;
    const goalX = goalCentre(dir).x;
    const toGoal = (goalX - b.pos.x) * dir;
    if (toGoal <= 0 || toGoal > 40) return null;
    const closing = b.vel.x * dir;
    if (closing <= 0.3) return null;
    const t = toGoal / closing;
    if (t > 4) return null;
    const y = b.pos.y + b.vel.y * t;
    const z = b.pos.z + b.vel.z * t - 0.5 * GRAVITY * t * t;
    if (z > GOAL_HEIGHT + 1) return null;
    const { near, far } = goalPostY();
    if (y < near - 3 || y > far + 3) return null;
    return y;
  }

  /** The closest man of one side to the ball; ties break on id. */
  private nearestOfSideToBall(side: TeamSide): Player | null {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const q of this.players) {
      if (q.side !== side || !q.onPitch || q.sentOff || q.isKeeper) continue;
      const d = dist(q.pos, this.ball.pos);
      if (d < bestD || (d === bestD && best && q.def.id < best.def.id)) {
        best = q;
        bestD = d;
      }
    }
    return best;
  }

  /** 0 = closest of his side to the ball, 1 = second, -1 = further back. */
  private ballRank(p: Player): number {
    let closer = 0;
    const mine = dist(p.pos, this.ball.pos);
    for (const q of this.players) {
      if (q === p || q.side !== p.side || !q.onPitch || q.isKeeper) continue;
      const d = dist(q.pos, this.ball.pos);
      if (d < mine || (d === mine && q.def.id < p.def.id)) closer++;
      if (closer > 1) return -1;
    }
    return closer;
  }

  /**
   * A goalkeeper with the ball in his hands is not a carrier: he is choosing
   * between a short ball to a free defender and putting it into the opponent
   * half. Letting him run the outfield option scorer had him passing into a
   * press outside his own box, which is where a startling number of the
   * engine's goals were coming from.
   */
  private keeperDistribution(gk: Player, dir: Direction): void {
    gk.state = "Distribute";
    const kicking = attr01(gk.def.attributes.kicking);

    // Short: the freest team-mate inside 25 m who is not being pressed.
    let shortest: Player | null = null;
    let bestFree = 0;
    for (const m of this.teamMates(gk)) {
      const d = dist(gk.pos, m.pos);
      if (d > 26) continue;
      const free = (1 - this.pressureOn(m)) * this.passCompletion(gk, m);
      if (free > bestFree) {
        bestFree = free;
        shortest = m;
      }
    }
    if (shortest && bestFree > 0.55) {
      this.playPass(gk, shortest);
      return;
    }

    // Long: down the pitch towards the most advanced man, aiming at the
    // channel rather than at feet. A poor kicker gives it away more often.
    const target = {
      x: clamp(gk.pos.x + dir * (45 + kicking * 25), 4, PITCH_LENGTH - 4),
      y: clamp(gk.pos.y + this.rng.range(-18, 18), 3, PITCH_WIDTH - 3),
      z: 0,
    };
    this.strike(gk, target, 0.9, 0.55, "clear", { targetId: null, completed: false });
  }

  /* --- the playbook ----------------------------------------------------- */

  /**
   * Start a move if one fits and none is running. Called when a side settles
   * on the ball: a move is a thing you begin from a settled possession, not
   * something you start halfway through a tackle.
   */
  private maybeStartMove(carrier: Player, pressure: number): void {
    if (!this.playbook) return;
    const side = carrier.side;
    if (this.activeMove[side]) return;
    if (this.tick - this.ownedSinceTick < TICKS_PER_BRAIN_BEAT) return;

    const dir = this.dirFor(side);
    const zone = pitchToZone(carrier.pos, dir);
    const options = candidates(this.playbook, { zone, pressure });
    if (options.length === 0) return;

    // Weighted pick from the seeded stream, so the same match runs the same
    // moves every time it is replayed.
    let total = 0;
    for (const move of options) total += move.weight;
    let roll = this.rng.next() * total;
    let chosen: PlaybookMove | null = null;
    for (const move of options) {
      roll -= move.weight;
      if (roll <= 0) {
        chosen = move;
        break;
      }
    }
    if (!chosen) chosen = options[options.length - 1] as PlaybookMove;

    const cast = this.castMove(chosen, carrier);
    if (!cast) return; // nobody to play the parts
    this.activeMove[side] = {
      move: chosen,
      cast,
      step: 0,
      stepStartTick: this.tick,
      startTick: this.tick,
    };
  }

  /** Fill a move's roles from the players actually on the pitch. */
  private castMove(move: PlaybookMove, carrier: Player): Map<string, number> | null {
    const dir = this.dirFor(carrier.side);
    const cast = new Map<string, number>();
    const used = new Set<number>();
    const mates = this.players.filter(
      (p) => p.side === carrier.side && p.onPitch && !p.isKeeper && p !== carrier,
    );

    for (const { role, from } of move.cast) {
      let pick: Player | null = null;
      switch (from) {
        case "carrier":
          pick = carrier;
          break;
        case "nearestAhead":
          pick = this.bestBy(mates, used, (p) =>
            (p.pos.x - carrier.pos.x) * dir > 2 ? -dist(p.pos, carrier.pos) : -Infinity,
          );
          break;
        case "wideSameSide":
          pick = this.bestBy(mates, used, (p) =>
            Math.sign(p.pos.y - PITCH_WIDTH / 2) === Math.sign(carrier.pos.y - PITCH_WIDTH / 2)
              ? Math.abs(p.pos.y - PITCH_WIDTH / 2)
              : -Infinity,
          );
          break;
        case "wideFarSide":
          pick = this.bestBy(mates, used, (p) =>
            Math.sign(p.pos.y - PITCH_WIDTH / 2) !== Math.sign(carrier.pos.y - PITCH_WIDTH / 2)
              ? Math.abs(p.pos.y - PITCH_WIDTH / 2)
              : -Infinity,
          );
          break;
        case "supportBehind":
          pick = this.bestBy(mates, used, (p) =>
            (p.pos.x - carrier.pos.x) * dir < 1 ? -dist(p.pos, carrier.pos) : -Infinity,
          );
          break;
        case "centreForward":
          pick = this.bestBy(mates, used, (p) => (p.pos.x - carrier.pos.x) * dir);
          break;
      }
      if (!pick) return null;
      used.add(pick.def.id);
      cast.set(role, pick.def.id);
    }
    return cast;
  }

  private bestBy(
    players: readonly Player[],
    used: ReadonlySet<number>,
    score: (p: Player) => number,
  ): Player | null {
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const p of players) {
      if (used.has(p.def.id)) continue;
      const value = score(p);
      // Ties break on id so casting never depends on array order.
      if (value > bestScore || (value === bestScore && best && p.def.id < best.def.id)) {
        best = p;
        bestScore = value;
      }
    }
    return bestScore === -Infinity ? null : best;
  }

  /** Abandon a move that is no longer on. */
  private abortMove(side: TeamSide): void {
    this.activeMove[side] = null;
  }

  /** Housekeeping: drop moves that have run their course or lost the ball. */
  private updateMoves(): void {
    for (const side of [0, 1] as TeamSide[]) {
      const active = this.activeMove[side];
      if (!active) continue;
      const owner = this.ball.owner === null ? null : this.playerById(this.ball.owner);
      if (!owner || owner.side !== side) {
        this.abortMove(side);
        continue;
      }
      if ((this.tick - active.startTick) / PHYSICS_HZ > MOVE_MAX_SECONDS) this.abortMove(side);
      if (active.step >= active.move.steps.length) this.abortMove(side);
    }
  }

  /**
   * Run one player's part of the active move. Returns true if the move handled
   * him, false to fall through to the ordinary brain — which is what happens
   * to everyone without a role in it, and to everyone once it breaks down.
   */
  private runMove(p: Player, dir: Direction): boolean {
    const active = this.activeMove[p.side];
    if (!active) return false;
    const role = roleOf(active, p.def.id);
    if (!role) return false;

    const steps = stepsFor(active, role);
    if (steps.length === 0) return false;

    const carrying = this.ball.owner === p.def.id;
    for (const step of steps) {
      // A player can only do a ball step if he actually has the ball.
      const needsBall = step.kind !== "run";
      if (needsBall && !carrying) continue;
      if (this.executeStep(p, dir, active, step)) return true;
    }
    return false;
  }

  private executeStep(
    p: Player,
    dir: Direction,
    active: ActiveMove,
    step: MoveStep,
  ): boolean {
    const advance = (): void => {
      active.step++;
      active.stepStartTick = this.tick;
    };
    const timedOut = (seconds: number): boolean =>
      (this.tick - active.stepStartTick) / PHYSICS_HZ > seconds;

    switch (step.kind) {
      case "run": {
        /* A rehearsed run is TIMED, and a timed run goes beyond the last
         * defender — that is the whole point of it, and it is where offsides
         * come from. Holding these runs onside gave the engine less than one
         * offside a match against a real four. */
        const to = zoneToPitch(step.zone, dir);
        p.state = "RunBehind";
        p.target = to;
        return true;
      }
      case "carry": {
        const to = zoneToPitch(step.zone, dir);
        if (dist(p.pos, to) < 3 || timedOut(step.seconds)) {
          advance();
          return false;
        }
        p.state = "Dribble";
        p.target = to;
        return true;
      }
      case "pass": {
        const mate = this.castPlayer(active, step.to);
        if (!mate) {
          this.abortMove(p.side);
          return false;
        }
        advance();
        this.playPass(p, mate);
        return true;
      }
      case "cross": {
        const mate = this.castPlayer(active, step.to);
        // A cross is a pass, and the flag goes up for one exactly the same.
        if (mate && this.wouldPlayOffside(p, mate)) {
          advance();
          this.flagOffside(p, mate);
          return true;
        }
        const goal = goalCentre(dir);
        const aimY =
          step.target === "near"
            ? goal.y - dir * 4
            : step.target === "far"
              ? goal.y + dir * 5
              : goal.y;
        const target: Vec3 = mate
          ? { x: mate.pos.x, y: mate.pos.y, z: step.target === "cutback" ? 0 : 2.1 }
          : { x: goal.x - dir * 8, y: aimY, z: 2.1 };
        advance();
        this.strike(p, target, 0.75, step.target === "cutback" ? 0 : 0.4, "pass", {
          targetId: mate ? mate.def.id : null,
          completed: mate ? this.rng.chance(this.passCompletion(p, mate)) : false,
        });
        return true;
      }
      case "shoot": {
        advance();
        this.takeShot(p, dir, this.pressureOn(p));
        return true;
      }
    }
  }

  private castPlayer(active: ActiveMove, role: string): Player | null {
    const id = active.cast.get(role);
    return id === undefined ? null : this.playerById(id);
  }

  /**
   * On-ball decision. Every option is scored in the same currency — the
   * probability this possession ends in a goal — so they can be compared at
   * all: a shot is its xG, a pass is the receiver's threat discounted by
   * whether it arrives, a carry is the threat of where he would get to.
   */
  private carrierBrain(p: Player, dir: Direction): void {
    const pressure = this.pressureOn(p);
    // A settled carrier may start a rehearsed move; if one starts, it takes
    // over from the next beat.
    this.maybeStartMove(p, pressure);
    const held = (this.tick - this.ownedSinceTick) / PHYSICS_HZ;
    const counter = this.isCounter(p.side);

    const shotXG = expectedGoals({
      from: p.pos,
      dir,
      header: false,
      pressure,
      counter,
      penalty: false,
    });
    /* A shot is worth more than its xG. It ends the move in the opponent's
     * half, and what follows a miss — a rebound, a corner, a throw, a keeper
     * under pressure — is worth something too. Priced at xG alone, a footballer
     * never strikes one from twenty yards, and the engine produced a mean shot
     * distance of seven metres against a real-world seventeen. */
    const shootValue =
      held < 0.25
        ? 0 // he has not got it under control yet
        : shotXG * (1 + SHOT_FOLLOW_UP) * lerp(0.75, 1.15, attr01(p.def.attributes.finishing));

    // Best pass available. Vision gates how many options he even sees.
    const lanes = 2 + Math.round(attr01(p.def.attributes.vision) * 5);
    let bestMate: Player | null = null;
    let bestPass = 0;
    for (const m of this.passOptions(p, lanes)) {
      const d = dist(p.pos, m.pos);
      if (d < 3 || d > 45) continue;
      // A pass to a man stood offside is not an option a footballer weighs.
      if (this.offsidePosition(m, p.side)) continue;
      const completion = this.passCompletion(p, m);
      const threat = this.threatAt(m.pos, dir, clamp(this.pressureOn(m), 0, 1), counter);
      const value = completion * threat * CONTINUATION;
      if (value > bestPass) {
        bestPass = value;
        bestMate = m;
      }
    }

    // Carrying: where he would be in a second, if there is space to go.
    const goal = goalCentre(dir);
    const gx = goal.x - p.pos.x;
    const gy = goal.y - p.pos.y;
    const gl = Math.hypot(gx, gy) || 1;
    const carryTo = { x: p.pos.x + (gx / gl) * 6, y: p.pos.y + (gy / gl) * 6 };
    let ahead = 0;
    for (const o of this.grid.queryLane(p.pos, carryTo, 3, this.queryBuf)) {
      if (o.side !== p.side && o.onPitch && !o.isKeeper) ahead++;
    }
    const space = clamp(
      1 - ahead * 0.55 - pressure * 0.6 + attr01(p.def.attributes.dribbling) * 0.22,
      0.05,
      1,
    );
    const carryValue =
      space * this.threatAt(carryTo, dir, pressure * 0.8, counter) * CONTINUATION;

    // Decisions gates the noise: a poor decision-maker sometimes picks the
    // second-best option, which is what makes bad teams look bad.
    const noise = (1 - attr01(p.def.attributes.decisions)) * 0.35;
    const jitter = (): number => 1 + this.rng.range(-noise, noise);
    /* The scores stay in their own currency — the probability this possession
     * ends in a goal — and the intent layer MODULATES them. A poacher's shot
     * is worth more to him than the same shot is to an anchor man; a side told
     * to play direct values the pass forward more than the carry. */
    const shootScore = shootValue * jitter() * this.intentWeight(p, "Shoot");
    const passScore = bestPass * jitter() * this.intentWeight(p, "Pass");
    const carryScore = carryValue * jitter() * this.intentWeight(p, "Dribble");

    if (shootScore >= passScore && shootScore >= carryScore && shotXG > MIN_SHOT_XG) {
      this.takeShot(p, dir, pressure);
      return;
    }

    /* A ball into the box from wide is not the same option as a pass, and it
     * cannot be scored like one: its value is the chance that SOMEBODY gets on
     * the end of it, which is an aerial contest, not a completion. So it is
     * chosen positionally — from the flank, in the final third — and its
     * quality comes from the crossing attribute. */
    const cross = this.crossTarget(p, dir);
    if (cross) {
      const a = p.def.attributes;
      const quality = attr01(a.crossing) * 0.7 + attr01(a.technique) * 0.3;
      const scatter = CROSS_TARGET_SPREAD * (1 - quality);
      this.strike(
        p,
        {
          x: clamp(cross.x + this.rng.range(-scatter, scatter), 2, PITCH_LENGTH - 2),
          y: clamp(cross.y + this.rng.range(-scatter, scatter), 2, PITCH_WIDTH - 2),
          z: 1.6 + this.rng.range(0, 0.8),
        },
        0.65,
        CROSS_LOFT,
        "pass",
        { targetId: null, completed: false },
      );
      return;
    }

    // In his own box with anyone near him, a defender clears it. Playing out
    // from there is a decision, not a default, and rebounds were otherwise
    // recycled into fresh chances inside the six-yard box.
    const ownDir = dir === 1 ? (-1 as Direction) : (1 as Direction);
    const own = goalCentre(ownDir);
    const inOwnThird = dist(p.pos, own) < PITCH_LENGTH / 3;
    const bestOption = Math.max(shootScore, passScore, carryScore);
    const panic = inBox(p.pos, penaltyArea(ownDir)) && pressure > 0.3;
    const clearBias = this.intentWeight(p, "Clear");
    if (panic || (inOwnThird && pressure > 0.55 && bestOption < BASE_THREAT * 2.5 * clearBias)) {
      this.strike(
        p,
        {
          x: clamp(p.pos.x + dir * this.rng.range(30, 45), 3, PITCH_LENGTH - 3),
          y: clamp(p.pos.y + this.rng.range(-20, 20), 3, PITCH_WIDTH - 3),
          z: 0,
        },
        0.9,
        0.5,
        "clear",
        { targetId: null, completed: false },
      );
      return;
    }

    if (bestMate && passScore >= carryScore) {
      this.playPass(p, bestMate);
      return;
    }
    p.state = "Dribble";
    p.target = carryTo;
  }

  /**
   * Play a pass. Like a shot, the model decides first and the ball is then
   * sent where that decision says it went: completion is rolled from the
   * lane, and a failed pass is aimed at whoever cut it out rather than being
   * left to a coin-flip of physics.
   */
  private playPass(from: Player, to: Player): void {
    if (this.wouldPlayOffside(from, to)) {
      this.flagOffside(from, to);
      return;
    }

    const completion = this.passCompletion(from, to);
    const completed = this.rng.chance(completion);
    const interceptor = completed ? null : this.laneInterceptor(from, to);

    // Lead the pass: aim where the receiver will be, not where he is.
    const flight = Math.max(dist(from.pos, to.pos) / 14, 0.2);
    const aimAt = interceptor
      ? { x: interceptor.pos.x, y: interceptor.pos.y }
      : { x: to.pos.x + to.vel.x * flight * 0.8, y: to.pos.y + to.vel.y * flight * 0.8 };

    this.strike(from, { x: aimAt.x, y: aimAt.y, z: 0 }, 0.45, this.passLoft(from, to), "pass", {
      targetId: to.def.id,
      completed,
    });
    if (interceptor) {
      this.emit({
        type: "Interception",
        actorId: interceptor.def.id,
        team: interceptor.side,
        from: { x: interceptor.pos.x, y: interceptor.pos.y, z: 0 },
        to: null,
      });
    }
  }

  /** Play the ball to a man in an offside position, and pay for it. */
  private flagOffside(from: Player, to: Player): void {
    this.strike(from, { x: to.pos.x, y: to.pos.y, z: 0 }, 0.45, 0, "pass", {
      targetId: to.def.id,
      completed: false,
    });
    this.emit({
      type: "Offside",
      actorId: to.def.id,
      team: to.side,
      from: { x: to.pos.x, y: to.pos.y, z: 0 },
      to: null,
      passerId: from.def.id,
    });
    this.emit({ type: "Whistle", kind: "offside", actorId: null, team: null, from: null, to: null });
    this.abortMove(from.side);
    this.deadBall("freeKick", (1 - from.side) as TeamSide, {
      x: clamp(to.pos.x, 2, PITCH_LENGTH - 2),
      y: clamp(to.pos.y, 2, PITCH_WIDTH - 2),
    });
  }

  /** The opponent best placed to cut a pass out — nearest to the lane. */
  private laneInterceptor(from: Player, to: Player): Player | null {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const o of this.grid.queryLane(from.pos, to.pos, 4.5, this.queryBuf)) {
      if (o.side === from.side || !o.onPitch) continue;
      const d = distToSegment(o.pos, from.pos, to.pos);
      if (d < bestD || (d === bestD && best && o.def.id < best.def.id)) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * Offside, judged at kick-commit: the receiver's position when the ball is
   * PLAYED, against the second-last defender at that same instant. Judging it
   * on arrival — or against a fixed "defensive line" number — is the classic
   * way to get a match engine's offsides looking nothing like the real thing.
   */
  private offsidePosition(receiver: Player, side: TeamSide): boolean {
    const dir = this.dirFor(side);
    if ((receiver.pos.x - PITCH_LENGTH / 2) * dir <= 0) return false;
    if ((receiver.pos.x - this.ball.pos.x) * dir <= 0) return false;
    return receiver.pos.x * dir > this.offsideLineX(side) * dir + 0.15;
  }

  /** Would this player be flagged, and would the passer notice in time? */
  private wouldPlayOffside(passer: Player, receiver: Player): boolean {
    if (!this.offsidePosition(receiver, passer.side)) return false;
    const awareness =
      attr01(passer.def.attributes.decisions) * 0.5 +
      attr01(receiver.def.attributes.offTheBall) * 0.5;
    return !this.rng.chance(0.16 + (1 - awareness) * 0.3);
  }

  /**
   * x of the second-last defender for a side's attack: the offside line.
   * Cached per tick because every attacker asks for it on every brain beat.
   */
  private offsideLineX(side: TeamSide): number {
    if (this.offsideLineTick[side] === this.tick) return this.offsideLineCache[side] as number;
    const dir = this.dirFor(side);
    let deepest = -Infinity;
    let second = -Infinity;
    for (const o of this.players) {
      if (o.side === side || !o.onPitch) continue;
      const depth = o.pos.x * dir;
      if (depth > deepest) {
        second = deepest;
        deepest = depth;
      } else if (depth > second) {
        second = depth;
      }
    }
    const line = second === -Infinity ? goalCentre(dir).x : second * dir * dir;
    this.offsideLineTick[side] = this.tick;
    this.offsideLineCache[side] = line;
    return line;
  }

  /**
   * Hold a supporting position without straying offside. A forward standing
   * on his attacking anchor is beyond the last defender whenever his own side
   * is penned in, which makes him unpassable-to for the whole match — and the
   * defending side then cannot break out at all.
   */
  private keepOnside(p: Player, target: Vec2): Vec2 {
    const dir = this.dirFor(p.side);
    const line = this.offsideLineX(p.side);
    if ((target.x - line) * dir <= 0) return target;
    return { x: line - dir * 0.5, y: target.y };
  }

  /**
   * Where a cross should go, or null if this is not a crossing position.
   *
   * Wide and in the final third is the trigger. The delivery goes near post,
   * far post or cut back, weighted by where the ball is: from the byline you
   * pull it back, from deeper you hang it up.
   */
  private crossTarget(p: Player, dir: Direction): Vec2 | null {
    const goal = goalCentre(dir);
    const wide = Math.abs(p.pos.y - PITCH_WIDTH / 2) > 17;
    const progress = (p.pos.x - PITCH_LENGTH / 2) * dir;
    if (!wide || progress < 14) return null;
    // Somebody has to be in there to attack it.
    let arriving = 0;
    for (const m of this.players) {
      if (m.side !== p.side || m === p || !m.onPitch) continue;
      if (dist(m.pos, goal) < 18) arriving++;
    }
    if (arriving === 0) return null;
    if (!this.rng.chance(0.55 + attr01(p.def.attributes.crossing) * 0.25)) return null;

    const byline = progress > 34;
    const { near, far } = goalPostY();
    const nearSide = Math.abs(p.pos.y - near) < Math.abs(p.pos.y - far) ? near : far;
    if (byline && this.rng.chance(0.45)) {
      // Cut back to the edge of the six-yard box.
      return { x: goal.x - dir * 11, y: goal.y + (p.pos.y > goal.y ? -3 : 3) };
    }
    return this.rng.chance(0.5)
      ? { x: goal.x - dir * 6, y: nearSide }
      : { x: goal.x - dir * 8, y: goal.y + (goal.y - nearSide) * 0.8 };
  }

  /**
   * What the ball is worth at a position: the zone's own value (xT) plus the
   * chance a shot from there goes in. Both are in the same currency — the
   * probability this possession ends in a goal — which is what lets a pass,
   * a carry and a shot be compared at all.
   */
  private threatAt(at: Vec2, dir: Direction, pressure: number, counter: boolean): number {
    const shot = expectedGoals({ from: at, dir, header: false, pressure, counter, penalty: false });
    return zoneThreat(at, dir) + shot * 0.45;
  }

  /** Probability a pass finds its man: distance, bodies in the lane, ability. */
  private passCompletion(from: Player, to: Player): number {
    const d = dist(from.pos, to.pos);
    let blockers = 0;
    for (const o of this.grid.queryLane(from.pos, to.pos, 1.6, this.queryBuf)) {
      if (o.side === from.side || !o.onPitch) continue;
      blockers++;
    }
    // A marked receiver is the other half of a pass being cut out: the lane
    // can be clear and the ball still lost because he has a defender on his
    // shoulder when it arrives.
    let markers = 0;
    for (const o of this.grid.query(to.pos, 4, this.queryBuf)) {
      if (o.side !== from.side && o.onPitch && !o.isKeeper) markers++;
    }
    /* A ball INTO the penalty area is the hardest pass in football: it is the
     * one every defender is watching, and the one they are all goal-side of.
     * Without charging for it the engine walked the ball into the six-yard box
     * and took its shots from ten metres, against a real average of
     * seventeen. */
    const receiverDir = this.dirFor(from.side);
    const intoBox = inBox(to.pos, penaltyArea(receiverDir)) ? 0.06 : 0;
    const skill = attr01(from.def.attributes.passing) * 0.7 + attr01(from.def.attributes.vision) * 0.3;
    const control = attr01(to.def.attributes.firstTouch) * 0.1;
    const base = 0.93 - d * 0.014 - blockers * 0.22 - markers * 0.16 - intoBox;
    return clamp(
      base + skill * 0.16 + control - this.pressureOn(from) * 0.14 + this.homeEdge(from.side, HOME_EDGE_PASS),
      0.04,
      0.97,
    );
  }

  /** Chip it when there is a body in the way, drill it when there is not. */
  private passLoft(from: Player, to: Player): number {
    for (const o of this.grid.queryLane(from.pos, to.pos, 1.2, this.queryBuf)) {
      if (o.side !== from.side && o.onPitch) return 0.3;
    }
    return 0;
  }

  /**
   * The team-mates this player actually weighs. Vision sets how many of the
   * nearest options he reads, but the two most advanced men are always on the
   * list: a centre-half looking up and hitting the striker is not a feat of
   * vision, and without them in the list the whole side passes sideways.
   */
  private passOptions(p: Player, lanes: number): Player[] {
    const mates = this.teamMates(p); // nearest first
    this.optionBuf.length = 0;
    for (let i = 0; i < mates.length && this.optionBuf.length < lanes; i++) {
      this.optionBuf.push(mates[i] as Player);
    }
    const dir = this.dirFor(p.side);
    let first: Player | null = null;
    let second: Player | null = null;
    for (const m of mates) {
      const depth = m.pos.x * dir;
      if (!first || depth > first.pos.x * dir) {
        second = first;
        first = m;
      } else if (!second || depth > second.pos.x * dir) {
        second = m;
      }
    }
    for (const m of [first, second]) {
      if (m && !this.optionBuf.includes(m)) this.optionBuf.push(m);
    }
    return this.optionBuf;
  }

  private teamMates(p: Player): Player[] {
    this.mateBuf.length = 0;
    for (const m of this.players) {
      if (m === p || m.side !== p.side || !m.onPitch || m.isKeeper) continue;
      this.mateBuf.push(m);
    }
    // Nearest first, so the vision cap keeps the options a player would
    // actually see rather than an arbitrary slice of the squad list.
    this.mateBuf.sort((a, b) => {
      const da = dist(p.pos, a.pos);
      const db = dist(p.pos, b.pos);
      return da === db ? a.def.id - b.def.id : da - db;
    });
    return this.mateBuf;
  }

  /**
   * Who this defender picks up. Assignments are computed the same way by
   * every defender on the team — walk the opponents in a fixed order, give
   * each to the nearest defender who has not already claimed someone closer —
   * so the eleven agree without any of them talking to each other, and the
   * result cannot depend on the order the brains happen to beat in.
   */
  private markFor(p: Player, carrier: Player | null): Player | null {
    const own = goalCentre(this.dirFor(p.side) === 1 ? (-1 as Direction) : (1 as Direction));
    let best: Player | null = null;
    let bestScore = Infinity;
    for (const o of this.players) {
      if (o.side === p.side || !o.onPitch || o.isKeeper || o === carrier) continue;
      // Only threats: an opponent behind the ball is not going to score.
      const ballRef = carrier ? carrier.pos : { x: this.ball.pos.x, y: this.ball.pos.y };
      const goalSide = dist(o.pos, own) < dist(ballRef, own) + 22;
      if (!goalSide) continue;
      const d = dist(p.pos, o.pos);
      if (d > 26) continue;
      // Whoever is nearest wins the man, unless a team-mate is nearer still.
      let claimedByCloser = false;
      for (const q of this.players) {
        if (q === p || q.side !== p.side || !q.onPitch || q.isKeeper) continue;
        if (this.ballRank(q) <= 1) continue; // the ball and cover men are busy
        const dq = dist(q.pos, o.pos);
        if (dq < d || (dq === d && q.def.id < p.def.id)) {
          claimedByCloser = true;
          break;
        }
      }
      if (claimedByCloser) continue;
      if (d < bestScore) {
        bestScore = d;
        best = o;
      }
    }
    return best;
  }


  /** The one place a player parts with the ball. */
  private strike(
    p: Player,
    target: Vec3,
    pace: number,
    loft: number,
    kind: "pass" | "clear",
    pass?: { targetId: number | null; completed: boolean },
  ): void {
    const a = p.def.attributes;
    // Everything struck through here is a delivery, not a shot: shots have
    // their own path through takeShot, where the model decides the outcome.
    const attribute = kind === "clear" ? a.kicking || a.passing : a.passing;
    const from: Vec3 = { x: this.ball.pos.x, y: this.ball.pos.y, z: BALL_RADIUS };
    const range = Math.hypot(target.x - from.x, target.y - from.y);
    const pressure = this.pressureOn(p);
    const difficulty = clamp(range / 45, 0, 1);

    const result = solveKick(
      from,
      { target, pace, loft, spin: 0 },
      {
        friction: this.friction,
        maxPace: lerp(18, 32, attr01(a.technique) * 0.5 + attr01(a.strength) * 0.5),
        skill: kickSkill(attribute, pressure, difficulty),
        rng: this.rng,
      },
    );

    this.ball.owner = null;
    this.ball.vel = result.vel;
    this.ball.spin = result.spin;
    // Anything struck with real height on it is a ball to be attacked in the
    // air; a chip over a defender's foot is not.
    this.ball.lofted = loft >= 0.4;
    this.ball.lastTouch = p.def.id;
    this.ball.lastTouchTeam = p.side;
    this.lastKickerId = p.def.id;
    this.controlLockTick = this.tick + Math.round(KICK_CONTROL_LOCK * PHYSICS_HZ);
    this.selfLockTick = this.tick + Math.round(KICK_SELF_LOCK * PHYSICS_HZ);
    p.state = "Support";

    this.emit({
      type: "Pass",
      actorId: p.def.id,
      team: p.side,
      from,
      to: target,
      targetId: pass?.targetId ?? null,
      completed: pass?.completed ?? true,
      length: range,
    });
  }

  /**
   * Take a shot. The model decides the outcome first; the ball is then flown
   * to wherever that outcome says it went, so what the viewer sees and what
   * the stats record are the same event and cannot drift apart.
   */
  private takeShot(
    p: Player,
    dir: Direction,
    pressure: number,
    opts: { header?: boolean; penalty?: boolean } = {},
  ): void {
    const header = opts.header === true;
    const penalty = opts.penalty === true;
    const keeper = this.keeperOf((1 - p.side) as TeamSide);
    const outcome = resolveShot(
      {
        from: p.pos,
        dir,
        header,
        // Nobody is closing down a penalty taker.
        pressure: penalty ? 0 : pressure,
        counter: this.isCounter(p.side),
        penalty,
      },
      this.strikeSkill(p, header),
      keeper
        ? {
            reflexes: keeper.def.attributes.reflexes,
            handling: keeper.def.attributes.handling,
            positioning: keeper.def.attributes.positioning,
          }
        : { reflexes: 8, handling: 8, positioning: 8 },
      this.rng,
      this.blockChance(p, dir),
    );

    const target = goalMouthPoint(dir, outcome.aim.y, Math.max(outcome.aim.z, 0.1));
    const from: Vec3 = { x: this.ball.pos.x, y: this.ball.pos.y, z: BALL_RADIUS };

    /* Strike it at the pace the model says, on the elevation that actually
     * reaches the target at that pace. Drag costs a little range, so the
     * struck speed carries a margin over the drag-free minimum. */
    const needed = minimumSpeedFor(from, target) * 1.12;
    const pace = clamp(Math.max(outcome.pace, needed), 8, KICK_MAX_PACE);
    const velocity = strikeVelocity(from, target, pace);

    this.ball.owner = null;
    this.ball.vel = velocity;
    this.ball.spin = 0;
    this.ball.lofted = false;
    this.ball.lastTouch = p.def.id;
    this.ball.lastTouchTeam = p.side;
    this.lastKickerId = p.def.id;
    this.controlLockTick = this.tick + Math.round(KICK_CONTROL_LOCK * PHYSICS_HZ);
    this.selfLockTick = this.tick + Math.round(KICK_SELF_LOCK * PHYSICS_HZ);
    p.state = "Support";

    const onTarget = outcome.kind === "goal" || outcome.kind === "saved";
    this.emit({
      type: "Shot",
      actorId: p.def.id,
      team: p.side,
      from,
      to: target,
      xg: outcome.xg,
      psxg: outcome.psxg,
      onTarget,
      header,
      penalty,
      // A shot within a few seconds of a restart came from that restart.
      setPiece: this.tick - this.lastRestartTick < PHYSICS_HZ * 6,
      result:
        outcome.kind === "goal"
          ? "goal"
          : outcome.kind === "saved"
            ? "saved"
            : outcome.kind === "blocked"
              ? "blocked"
              : outcome.kind === "post"
                ? "post"
                : "off",
    });

    if (outcome.kind === "blocked") {
      // A block kills the pace and leaves it live in a crowded area.
      const angle = this.rng.range(0, Math.PI * 2);
      this.ball.vel = { x: Math.cos(angle) * 4, y: Math.sin(angle) * 4, z: 1.5 };
      return;
    }

    this.pendingShot = { outcome, side: p.side, dir, shooterId: p.def.id };
    // Hands off the ball for the length of the flight plus a beat: this shot's
    // outcome is already decided.
    this.resolvedShotUntil = this.tick + Math.round(PHYSICS_HZ * 3);
    if (keeper) {
      // Send the keeper at the ball's line. He will not always get there —
      // that is the point of the save model having already decided.
      keeper.state = "Contest";
      keeper.target = {
        x: goalCentre(dir).x - dir * 0.4,
        y: clamp(outcome.aim.y, PITCH_WIDTH / 2 - 5, PITCH_WIDTH / 2 + 5),
      };
      keeper.nextBrainTick = this.tick + TICKS_PER_BRAIN_BEAT;
    }
  }

  /**
   * What the shooter brings to the strike. A header is struck with the head,
   * so the attribute that decides a shot with the feet has nothing to do with
   * it; and a player shooting at home does so a fraction better, which is one
   * of the three places home advantage lives.
   */
  private strikeSkill(p: Player, header: boolean): {
    finishing: number;
    technique: number;
    composure: number;
    longShots: number;
  } {
    const a = p.def.attributes;
    const edge = this.homeEdge(p.side, HOME_EDGE_SHOT) * 20; // in attribute points
    const lift = (value: number): number => clamp(value + edge, 1, 20);
    return header
      ? {
          finishing: lift(a.heading),
          technique: lift(a.heading),
          composure: lift(a.composure),
          longShots: lift(a.heading),
        }
      : {
          finishing: lift(a.finishing),
          technique: lift(a.technique),
          composure: lift(a.composure),
          longShots: lift(a.longShots),
        };
  }

  /** Defenders in the shooting lane. Each body is worth a chunk of block. */
  private blockChance(p: Player, dir: Direction): number {
    const goal = goalCentre(dir);
    let blockers = 0;
    for (const o of this.grid.queryLane(p.pos, goal, 1.3, this.queryBuf)) {
      if (o.side === p.side || o.isKeeper || !o.onPitch) continue;
      // Only bodies actually between the shooter and the goal count.
      if ((o.pos.x - p.pos.x) * dir <= 0) continue;
      blockers++;
    }
    return clamp(blockers * 0.15, 0, 0.55);
  }

  /**
   * Any ball heading for the goal that is not already a resolved shot — a
   * sliced clearance, an overhit backpass, a deflected cross — has to be
   * faced by the keeper, through the same save model a shot goes through.
   * Without this, half the goals in a match were stray passes flying past a
   * goalkeeper who had no reason to react to them.
   */
  private faceStrayBall(): void {
    if (this.pendingShot !== null || this.play !== "live" || this.ball.owner !== null) return;
    if (this.tick < this.strayFacedUntil || this.tick < this.resolvedShotUntil) return;

    for (const dir of [1, -1] as Direction[]) {
      const goalX = goalCentre(dir).x;
      const toGoal = (goalX - this.ball.pos.x) * dir;
      if (toGoal <= 0 || toGoal > 30) continue; // wrong way, or too far out
      const closing = this.ball.vel.x * dir;
      // Even a ball trickling towards the goal has to be dealt with: the
      // engine's own goals were all slow ones rolling in past a keeper who was
      // not looking at them.
      if (closing <= 0.5) continue;

      const t = toGoal / closing;
      const y = this.ball.pos.y + this.ball.vel.y * t;
      const z = this.ball.pos.z + this.ball.vel.z * t - 0.5 * GRAVITY * t * t;
      const { near, far } = goalPostY();
      if (y <= near || y >= far || z <= 0 || z >= GOAL_HEIGHT) continue;

      // Only face it once: the keeper does not get a second attempt at the
      // same ball on the next tick.
      this.strayFacedUntil = this.tick + Math.round(PHYSICS_HZ * 1.5);

      const defending: TeamSide = this.dirFor(0) === dir ? 1 : 0;
      const keeper = this.keeperOf(defending);
      if (!keeper) return;
      const pace = Math.hypot(this.ball.vel.x, this.ball.vel.y, this.ball.vel.z);
      /* A ball nobody meant to put on target is one the keeper has seen all
       * the way: he is beaten by it far less often than by a struck shot. And
       * a ball played by his OWN side — a backpass, a sliced clearance — he is
       * set and waiting for, which is why own goals are freak events rather
       * than a weekly occurrence. The engine was producing more than one a
       * match before this. */
      const friendly = this.ball.lastTouchTeam === defending;
      const psxg = postShotXG(y, z, pace, toGoal, false);
      const beaten = this.rng.chance(
        saveFailChance(psxg, {
          reflexes: keeper.def.attributes.reflexes,
          handling: keeper.def.attributes.handling,
          positioning: keeper.def.attributes.positioning,
        }) *
          STRAY_BALL_SAVE_BONUS *
          (friendly ? OWN_GOAL_SAVE_BONUS : 1),
      );
      if (beaten) return; // it is going in, and the laws will award it

      this.pendingShot = {
        outcome: {
          kind: "saved",
          xg: 0,
          psxg,
          aim: { y, z },
          pace,
          held: this.rng.chance(0.6 + attr01(keeper.def.attributes.handling) * 0.3),
        },
        side: (1 - defending) as TeamSide,
        dir,
        shooterId: this.ball.lastTouch ?? -1,
      };
      keeper.state = "Contest";
      keeper.target = { x: goalX - dir * 0.6, y: clamp(y, PITCH_WIDTH / 2 - 5, PITCH_WIDTH / 2 + 5) };
      return;
    }
  }

  /**
   * The shot has reached the keeper's line. Apply whatever the model decided:
   * a goal simply carries on into the net, a save is held or parried into a
   * live rebound, and a shot off target is left to run out of play.
   */
  private resolvePendingShot(): void {
    const pending = this.pendingShot;
    if (!pending) return;
    const goalX = goalCentre(pending.dir).x;
    const reached = (this.ball.pos.x - goalX) * pending.dir > -1.2;
    if (!reached) return;
    this.pendingShot = null;
    // A goal carries on into the net untouched; a save is resolved right here.
    // Once it has, the ball is live again immediately — a parry that nobody is
    // allowed to gather for a second and a half is a second chance handed to
    // the attack every time.
    this.resolvedShotUntil = this.tick + Math.round(PHYSICS_HZ * 0.4);

    /* The model has already decided where this shot ended up, so the ball is
     * put there. Letting the flight decide instead means the solver's own
     * centimetres of error re-open a shot the model called wide — which is
     * exactly what was happening: most of the engine's goals were shots
     * recorded as OFF TARGET drifting back inside the post. */
    const outcome = pending.outcome;
    if (outcome.kind === "off" || outcome.kind === "post") {
      const speed = Math.hypot(this.ball.vel.x, this.ball.vel.y, this.ball.vel.z) || 1;
      const dy = outcome.aim.y - this.ball.pos.y;
      const dz = outcome.aim.z - this.ball.pos.z;
      this.ball.pos.y = outcome.aim.y;
      this.ball.pos.z = Math.max(outcome.aim.z, 0);
      // Nudge the velocity so the ball carries on the way it arrived rather
      // than kinking; over a tenth of a second this is invisible.
      this.ball.vel.y += dy * 2;
      this.ball.vel.z += dz * 2;
      const rescale = speed / (Math.hypot(this.ball.vel.x, this.ball.vel.y, this.ball.vel.z) || 1);
      this.ball.vel.x *= rescale;
      this.ball.vel.y *= rescale;
      this.ball.vel.z *= rescale;
      if (outcome.kind === "post") {
        const { near, far } = goalPostY();
        const postY = Math.abs(outcome.aim.y - near) < Math.abs(outcome.aim.y - far) ? near : far;
        const nx = pending.dir === 1 ? -1 : 1;
        const ny = Math.sign(this.ball.pos.y - postY) || 1;
        this.ball.pos.y = postY + ny * (POST_RADIUS + BALL_RADIUS);
        this.reflect(nx * 0.7, ny * 0.7);
      }
      return;
    }
    if (outcome.kind !== "saved") return; // a goal carries on into the net

    const keeper = this.keeperOf((1 - pending.side) as TeamSide);
    if (!keeper) return;
    /* Gathered a clear stride off his line, never on it: a keeper holding the
     * ball level with the goal line is one turn away from carrying it in.
     *
     * He also DIVES to it rather than appearing at it — capped at what a
     * keeper can actually cover in the moment, so the save is a movement the
     * viewer can follow instead of a body blinking sideways. The ball is then
     * placed at his hands, not the other way round. */
    const contactX = goalX - pending.dir * 1.6;
    const wantY = clamp(this.ball.pos.y, PITCH_WIDTH / 2 - 4, PITCH_WIDTH / 2 + 4);
    const dy = clamp(wantY - keeper.pos.y, -2.2, 2.2);
    keeper.pos = { x: contactX, y: keeper.pos.y + dy };
    keeper.vel = { x: 0, y: 0 };
    const contact: Vec2 = { x: contactX, y: keeper.pos.y };
    this.ball.pos = { x: contact.x, y: contact.y, z: Math.max(this.ball.pos.z, 0) };

    this.emit({
      type: "Save",
      actorId: keeper.def.id,
      team: keeper.side,
      from: { ...this.ball.pos },
      to: null,
      shooterId: pending.shooterId,
      held: outcome.held,
      parried: !outcome.held,
    });

    if (outcome.held) {
      this.ball.owner = keeper.def.id;
      this.ownedSinceTick = this.tick;
      this.ball.vel = { x: 0, y: 0, z: 0 };
      keeper.state = "Distribute";
    } else {
      // A parry is the most dangerous ball in football: it goes out into the
      // area at an angle, live, with everyone reacting to it.
      // Parried away from the goal rather than straight behind it: a keeper
      // pushing every save over his own bar gave twenty corners a match.
      const angle = this.rng.range(-0.75, 0.75);
      const speed = this.rng.range(9, 15);
      this.ball.vel = {
        x: -pending.dir * Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
        z: this.rng.range(0.4, 2.2),
      };
      this.controlLockTick = this.tick + Math.round(0.15 * PHYSICS_HZ);
      this.lastKickerId = keeper.def.id;
      this.selfLockTick = this.tick + Math.round(0.4 * PHYSICS_HZ);
    }
    this.ball.lastTouch = keeper.def.id;
    this.ball.lastTouchTeam = keeper.side;
  }

  private recordTurnover(winner: Player): void {
    this.wonBallTick[winner.side] = this.tick;
    // "Deep" means in their own half — the ball being won high up is a press,
    // not a counter, and the defence is not stretched behind it.
    const dir = this.dirFor(winner.side);
    this.wonBallDeep[winner.side] =
      dir === 1 ? winner.pos.x < PITCH_LENGTH / 2 : winner.pos.x > PITCH_LENGTH / 2;
  }

  private keeperOf(side: TeamSide): Player | null {
    for (const p of this.players) if (p.side === side && p.isKeeper && p.onPitch) return p;
    return null;
  }

  /** A shot within 8 seconds of winning the ball deep is a counter-attack. */
  private isCounter(side: TeamSide): boolean {
    return (
      this.wonBallDeep[side] === true &&
      this.tick - (this.wonBallTick[side] ?? 0) < PHYSICS_HZ * 8
    );
  }

  /* --- intents ------------------------------------------------------------ */

  /** The role this player has been given, or the default for his position. */
  private roleOf(p: Player): string {
    const named = this.tacticsFor(p.side).roles[p.slot];
    if (named && named !== "default") return named;
    return defaultRole(p.def.position);
  }

  /**
   * How much this player wants to do this, before the situation is considered:
   * his role, his side's instructions, and the state of the game multiplied
   * together. This is the layer that makes a tactical slider or a role change
   * mean something without a new branch anywhere.
   */
  private intentWeight(p: Player, intent: Intent): number {
    const ins = this.tacticsFor(p.side).instructions;
    const goalDifference = this.score[p.side] - this.score[p.side === 0 ? 1 : 0];
    const minutesLeft = Math.max(0, (HALVES * HALF_LENGTH_SECONDS - this.matchSecond) / 60);
    return (
      roleWeight(this.roleOf(p), intent) *
      collectiveWeight(ins, intent) *
      gameStateWeight(intent, goalDifference, minutesLeft)
    );
  }

  /** The home side's edge for this player, in the units each caller wants. */
  private homeEdge(side: TeamSide, perPoint: number): number {
    return side === 0 ? this.homeAdvantage * perPoint : 0;
  }

  /** 0..1 how closed down a player is: the input to composure everywhere. */
  private pressureOn(p: Player): number {
    let worst = 0;
    for (const o of this.grid.query(p.pos, 6, this.pressureBuf)) {
      if (o.side === p.side || !o.onPitch) continue;
      worst = Math.max(worst, 1 - clamp(dist(p.pos, o.pos) / 6, 0, 1));
    }
    return worst;
  }

  /**
   * Proto-duel (placeholder for M5's full duel + foul model). An opponent
   * inside tackling range of the carrier gets a chance each tick to take the
   * ball off them, scaled by tackling against dribbling and strength. Without
   * something here a carrier simply walks the ball into the net, which makes
   * everything downstream of possession impossible to eyeball.
   */
  private contestCarrier(): void {
    if (this.ball.owner === null || this.play !== "live") return;
    const carrier = this.playerById(this.ball.owner);
    if (!carrier) return;
    for (const o of this.grid.query(carrier.pos, 1.8, this.queryBuf)) {
      if (o.side === carrier.side || !o.onPitch) continue;
      if (o.isKeeper) {
        // A keeper at a carrier's feet is smothering the ball, not tackling.
        const smother = clamp(
          0.02 * TICKS_PER_STEER * (0.5 + attr01(o.def.attributes.commandOfArea)),
          0,
          0.3,
        );
        if (dist(o.pos, carrier.pos) < 1.5 && this.rng.chance(smother)) {
          this.ball.owner = o.def.id;
          this.ownedSinceTick = this.tick;
          this.ball.lastTouch = o.def.id;
          this.ball.lastTouchTeam = o.side;
          this.ball.vel = { x: 0, y: 0, z: 0 };
          o.state = "Distribute";
          carrier.state = "Recover";
          this.emit({
            type: "Duel",
            actorId: o.def.id,
            team: o.side,
            from: { ...this.ball.pos },
            to: null,
            opponentId: carrier.def.id,
            won: true,
            aerial: false,
          });
          return;
        }
        continue;
      }
      const attack =
        attr01(carrier.def.attributes.dribbling) * 0.6 +
        attr01(carrier.def.attributes.strength) * 0.25 +
        attr01(carrier.def.attributes.balance) * 0.15;
      const defend =
        attr01(o.def.attributes.tackling) * 0.65 + attr01(o.def.attributes.strength) * 0.35;

      /* A challenge is three questions, not one: does he go in, does he win
       * it, and if he does not, was it a foul. Rolled on the steering beat
       * rather than every tick, so the per-roll chance is three times the
       * per-tick one. A booked man goes in less often, which is the whole
       * point of a booking. */
      const caution = o.yellowCards > 0 ? BOOKED_CAUTION : 1;
      const engage = clamp(
        (TACKLE_ENGAGE_BASE * TICKS_PER_STEER * (0.6 + defend) * caution) / (0.6 + attack),
        0,
        0.3,
      );
      if (!this.rng.chance(engage)) continue;

      const winProb = clamp(0.34 + (defend - attack) * 0.65, 0.08, 0.86);
      if (this.rng.chance(winProb)) {
        this.winTackle(o, carrier);
        return;
      }

      // He went in and missed. Whether that is a foul is about how cleanly he
      // tackles and how recklessly he plays, not about luck alone.
      const cleanliness =
        attr01(o.def.attributes.tackling) * 0.7 +
        attr01(o.def.attributes.composure) * 0.15 +
        attr01(o.def.attributes.anticipation) * 0.15;
      /* A defender in his own box does not throw himself at people: he
       * shepherds, jockeys and waits, because the cost of getting it wrong is
       * a penalty. Without this the engine gave away nearly two spot kicks a
       * match against a real-world one every four. */
      const ownDir = this.dirFor(o.side) === 1 ? (-1 as Direction) : (1 as Direction);
      const careful = inBox(o.pos, penaltyArea(ownDir)) ? 0.2 : 1;
      // The marginal decision goes to the home side.
      const refereeEdge = 1 - this.homeEdge((1 - o.side) as TeamSide, HOME_EDGE_FOUL);
      const foulChance = clamp(
        refereeEdge *
        FOUL_BASE *
          (1.15 - cleanliness) *
          (0.7 + attr01(o.def.attributes.aggression) * 0.6) *
          careful,
        0.02,
        0.8,
      );
      if (this.rng.chance(foulChance)) {
        this.commitFoul(o, carrier);
        return;
      }
      // Beaten: the carrier goes past him.
      o.state = "Recover";
      return;
    }
  }

  /** A challenge won cleanly: the ball changes feet. */
  private winTackle(winner: Player, loser: Player): void {
    this.ball.owner = winner.def.id;
    this.ownedSinceTick = this.tick;
    this.ball.lastTouch = winner.def.id;
    this.ball.lastTouchTeam = winner.side;
    winner.state = "Dribble";
    loser.state = "Recover";
    this.recordTurnover(winner);
    this.abortMove(loser.side);
    this.emit({
      type: "Duel",
      actorId: winner.def.id,
      team: winner.side,
      from: { ...this.ball.pos },
      to: null,
      opponentId: loser.def.id,
      won: true,
      aerial: false,
    });
  }

  /* --- balls in the air --------------------------------------------------- */

  /** How high this player can get his head, in metres. */
  private aerialReach(p: Player): number {
    return AERIAL_REACH_BASE + attr01(p.def.attributes.jumpReach) * AERIAL_REACH_JUMP;
  }

  /**
   * A ball in the air is contested, not waited for.
   *
   * The contest happens on the way DOWN, once, inside the band where a header
   * is possible at all. Whoever wins it heads it: a defender clears his lines,
   * an attacker either has a go at goal or glances it on. This is where
   * heading, jumpReach and bravery earn their place in the attribute list, and
   * it is what turns a cross or a corner from a hopeful arc into a chance.
   */
  private resolveAerial(): void {
    const b = this.ball;
    if (b.owner !== null || this.play !== "live") return;
    if (b.pos.z <= AERIAL_BAND_LOW || b.pos.z > AERIAL_BAND_HIGH) return;
    if (!b.lofted) return;
    if (this.tick < this.aerialLockTick || this.tick < this.resolvedShotUntil) return;
    if (b.vel.z > 0.5) return; // still climbing: nobody is heading this yet
    // A ball drifting down through head height at walking pace is a ball to
    // control, not to contest.
    if (Math.hypot(b.vel.x, b.vel.y, b.vel.z) < 3) return;

    const near = this.grid.query({ x: b.pos.x, y: b.pos.y }, AERIAL_RANGE, this.queryBuf);
    this.aerialBuf.length = 0;
    for (const p of near) {
      if (!p.onPitch || p.sentOff) continue;
      if (this.aerialReach(p) < b.pos.z) continue;
      this.aerialBuf.push(p);
    }
    if (this.aerialBuf.length === 0) return;

    const strengthOf = (p: Player): number => {
      const a = p.def.attributes;
      return (
        attr01(a.heading) * 0.34 +
        attr01(a.jumpReach) * 0.26 +
        attr01(a.strength) * 0.16 +
        attr01(a.bravery) * 0.12 +
        attr01(a.positioning) * 0.12 +
        // A keeper coming for a cross claims a lot of them, but not so many
        // that a corner is a formality: at 0.35 he ate the entire set-piece
        // threat of both sides.
        (p.isKeeper ? 0.2 : 0)
      );
    };

    let best: Player | null = null;
    let bestScore = -Infinity;
    let bestClean = 0;
    for (const p of this.aerialBuf) {
      const clean = strengthOf(p);
      const rolled = clean + this.rng.range(-0.08, 0.08);
      if (rolled > bestScore || (rolled === bestScore && best && p.def.id < best.def.id)) {
        best = p;
        bestScore = rolled;
        bestClean = clean;
      }
    }
    if (!best) return;

    let opponent: Player | null = null;
    let opponentClean = 0;
    for (const p of this.aerialBuf) {
      if (p === best || p.side === best.side) continue;
      const clean = strengthOf(p);
      if (clean > opponentClean) {
        opponent = p;
        opponentClean = clean;
      }
    }

    this.aerialLockTick = this.tick + AERIAL_LOCK_TICKS;

    /* Even the better header of a ball only wins a share of them, and a
     * contested ball is often won by neither: it flicks off a shoulder and
     * runs. That is what the win check is for. */
    const winProb = opponent
      ? clamp((bestClean / (bestClean + opponentClean + 1e-6)) * 0.85 + 0.1, 0.1, 0.95)
      : 0.92;
    if (!this.rng.chance(winProb)) return;

    /* Only a CONTESTED header is a duel. A defender heading a long ball clear
     * with nobody near him is not winning anything, and counting it produced
     * hundreds of "aerial duels" a match against a real forty to sixty. */
    if (opponent) {
      this.emit({
        type: "Duel",
        actorId: best.def.id,
        team: best.side,
        from: { ...b.pos },
        to: null,
        opponentId: opponent.def.id,
        won: true,
        aerial: true,
      });
    }

    b.lastTouch = best.def.id;
    b.lastTouchTeam = best.side;
    this.lastKickerId = best.def.id;
    this.controlLockTick = this.tick + Math.round(KICK_CONTROL_LOCK * PHYSICS_HZ);
    this.selfLockTick = this.tick + Math.round(KICK_SELF_LOCK * PHYSICS_HZ);

    const dir = this.dirFor(best.side);
    if (best.isKeeper) {
      // He claims it.
      b.owner = best.def.id;
      b.lofted = false;
      this.ownedSinceTick = this.tick;
      b.vel = { x: 0, y: 0, z: 0 };
      best.state = "Distribute";
      return;
    }

    /* What he does with it depends on where he is. In his own third he clears
     * it; in the attacking third he attacks the goal; everywhere else — which
     * is most of the pitch — he brings it down or nods it to a team-mate.
     * Heading every ball forty yards downfield is how the engine ended up with
     * three hundred aerial duels in a match: two sides heading the same ball
     * back and forth for ninety minutes. */
    const ownDir = dir === 1 ? (-1 as Direction) : (1 as Direction);
    if (distanceToGoal(best.pos, ownDir) < PITCH_LENGTH / 3) {
      this.headClear(best, dir);
      return;
    }
    if (distanceToGoal(best.pos, dir) < PITCH_LENGTH / 3) {
      this.headTarget(best, dir);
      return;
    }
    const a = best.def.attributes;
    const cushion = clamp(0.35 + attr01(a.firstTouch) * 0.35 + attr01(a.technique) * 0.15, 0, 0.9);
    if (this.rng.chance(cushion)) {
      b.owner = best.def.id;
      b.lofted = false;
      this.ownedSinceTick = this.tick;
      b.vel = { x: 0, y: 0, z: 0 };
      b.pos.z = 0;
      best.state = "Dribble";
      return;
    }
    this.headTarget(best, dir);
  }

  /** A defensive header: distance and width, away from the danger. Flat
   *  enough to come down and be played, rather than hanging in the air to be
   *  headed again by the next man. */
  private headClear(p: Player, dir: Direction): void {
    this.strike(
      p,
      {
        x: clamp(p.pos.x + dir * this.rng.range(18, 34), 2, PITCH_LENGTH - 2),
        y: clamp(p.pos.y + this.rng.range(-16, 16), 2, PITCH_WIDTH - 2),
        z: 0,
      },
      0.7,
      0.5,
      "clear",
      { targetId: null, completed: false },
    );
  }

  /** An attacking header: a go at goal if he is close enough, or a nod on. */
  private headTarget(p: Player, dir: Direction): void {
    const range = distanceToGoal(p.pos, dir);
    const pressure = this.pressureOn(p);
    if (range < 16 && pressure < 0.75) {
      this.takeShot(p, dir, pressure, { header: true });
      return;
    }
    const mate = this.passOptions(p, 3).find((m) => m !== p && !this.offsidePosition(m, p.side));
    if (mate) {
      this.strike(p, { x: mate.pos.x, y: mate.pos.y, z: 0.4 }, 0.5, 0.5, "pass", {
        targetId: mate.def.id,
        completed: this.rng.chance(this.passCompletion(p, mate) * 0.8),
      });
      return;
    }
    this.headClear(p, dir);
  }

  /* --- fouls, cards and the advantage ------------------------------------ */

  /**
   * A foul. Three things follow from it, in this order:
   *
   *  1. Is it a penalty? A foul inside the defending side's own area is, and
   *     that is the only way this engine produces one.
   *  2. What does the referee do with the card? A booking is not a dice roll
   *     off every foul — it is for cynical challenges, and for the ones that
   *     stopped a side that was going somewhere.
   *  3. Does play stop at all? If the fouled side still has the ball and is
   *     facing forward, the referee plays advantage for five seconds and only
   *     pulls it back if nothing comes of it.
   */
  private commitFoul(offender: Player, victim: Player): void {
    const at: Vec2 = { x: victim.pos.x, y: victim.pos.y };
    const ownDir = this.dirFor(offender.side) === 1 ? (-1 as Direction) : (1 as Direction);
    const inPenaltyArea = inBox(at, penaltyArea(ownDir));

    // Was the victim going somewhere? A foul on a man running into space is a
    // different offence from one in the middle of a crowded midfield.
    const promising =
      Math.hypot(victim.vel.x, victim.vel.y) > victim.vMax * 0.7 &&
      (victim.pos.x - PITCH_LENGTH / 2) * this.dirFor(victim.side) > 0;
    /* Denying a goal-scoring opportunity is a specific thing, not "a foul near
     * the goal": the man fouled has to have the ball, be running at goal, and
     * have nobody but the keeper left to beat. Without all three the engine
     * sent someone off twice a match. */
    const clearChance =
      this.ball.owner === victim.def.id &&
      !offender.isKeeper &&
      promising &&
      this.defendersGoalSide(victim) <= 1 &&
      // ...and the chance he was denied has to have been a real one. Distance
      // alone is not enough: a man clear on the touchline forty yards out is
      // not a goal-scoring opportunity, and the engine was sending people off
      // for stopping him.
      expectedGoals({
        from: victim.pos,
        dir: this.dirFor(victim.side),
        header: false,
        pressure: 0.2,
        counter: true,
        penalty: false,
      }) > 0.07;

    const card = this.judgeCard(offender, promising, clearChance);
    if (card !== "none") this.addStoppage(STOPPAGE_PER_CARD);

    if (inPenaltyArea) {
      this.emit({
        type: "Foul",
        actorId: offender.def.id,
        team: offender.side,
        from: { x: at.x, y: at.y, z: 0 },
        to: null,
        victimId: victim.def.id,
        card,
        advantage: false,
      });
      this.awardPenalty(victim.side, ownDir);
      return;
    }

    /* Advantage. The ball is at the victim's feet and he is still going: the
     * referee holds the whistle. If the move breaks down inside the window the
     * free kick is pulled back to here, which is what the pending record is
     * for. */
    const playOn = promising && this.ball.owner === victim.def.id;
    this.emit({
      type: "Foul",
      actorId: offender.def.id,
      team: offender.side,
      from: { x: at.x, y: at.y, z: 0 },
      to: null,
      victimId: victim.def.id,
      card,
      advantage: playOn,
    });

    if (playOn) {
      this.advantage = {
        side: victim.side,
        at,
        until: this.tick + ADVANTAGE_SECONDS * PHYSICS_HZ,
      };
      return;
    }
    this.stopForFreeKick(victim.side, at);
  }

  /** Blow up and give the free kick. */
  private stopForFreeKick(side: TeamSide, at: Vec2): void {
    this.advantage = null;
    this.emit({ type: "Whistle", kind: "foul", actorId: null, team: null, from: null, to: null });
    this.deadBall("freeKick", side, {
      x: clamp(at.x, 1, PITCH_LENGTH - 1),
      y: clamp(at.y, 1, PITCH_WIDTH - 1),
    });
  }

  /**
   * The advantage clock. It ends one of three ways: the side keeps the ball
   * for the full five seconds and play simply goes on, they score (same
   * thing), or they lose it — and then the referee brings it back.
   */
  private updateAdvantage(): void {
    const advantage = this.advantage;
    if (!advantage) return;
    if (this.play !== "live") {
      this.advantage = null;
      return;
    }
    const owner = this.ball.owner === null ? null : this.playerById(this.ball.owner);
    if (this.tick >= advantage.until) {
      this.advantage = null; // it came to something, or near enough
      return;
    }
    if (owner && owner.side !== advantage.side) {
      // Lost it: pull it back.
      this.stopForFreeKick(advantage.side, advantage.at);
    }
  }

  /** How many defenders are between this player and the goal he attacks. */
  private defendersGoalSide(p: Player): number {
    const dir = this.dirFor(p.side);
    let count = 0;
    for (const o of this.players) {
      if (o.side === p.side || !o.onPitch) continue;
      if ((o.pos.x - p.pos.x) * dir > 0) count++;
    }
    return count;
  }

  /** What the referee reaches for. */
  private judgeCard(
    offender: Player,
    promising: boolean,
    clearChance: boolean,
  ): "none" | "yellow" | "red" {
    // Denying an obvious goal-scoring opportunity is the one automatic red.
    if (clearChance && this.rng.chance(RED_DOGSO)) return this.sendOff(offender);
    if (this.rng.chance(RED_VIOLENT)) return this.sendOff(offender);

    const chance = clamp(
      YELLOW_BASE +
        (promising ? YELLOW_PROMISING_ATTACK : 0) +
        attr01(offender.def.attributes.aggression) * 0.12 -
        attr01(offender.def.attributes.tackling) * 0.06,
      0.02,
      0.75,
    );
    if (!this.rng.chance(chance)) return "none";

    offender.yellowCards++;
    if (offender.yellowCards >= 2) return this.sendOff(offender);
    return "yellow";
  }

  private sendOff(offender: Player): "red" {
    offender.sentOff = true;
    offender.onPitch = false;
    this.abortMove(offender.side);
    return "red";
  }

  /** A foul in the box. */
  private awardPenalty(side: TeamSide, defendingDir: Direction): void {
    const spot = penaltySpot(defendingDir);
    this.emit({ type: "Whistle", kind: "foul", actorId: null, team: null, from: null, to: null });
    this.addStoppage(20);
    this.deadBall("penalty", side, { x: spot.x, y: spot.y });
  }

  /**
   * Keeper claim (placeholder for M4's shot/save model). A loose, low ball
   * inside the six-yard box is gathered by the keeper defending it. It is the
   * minimum needed to stop the stub brain dribbling into an empty net.
   */
  private keeperClaim(): void {
    if (this.ball.owner !== null || this.play !== "live" || this.ball.pos.z > 1.8) return;
    // A shot the model has already resolved is not the keeper's to hoover up
    // on the way past, and neither is anything travelling at pace: those are
    // saves, and saves go through the save model.
    if (this.pendingShot !== null || this.tick < this.resolvedShotUntil) return;
    if (Math.hypot(this.ball.vel.x, this.ball.vel.y) > 12) return;
    for (const gk of this.players) {
      if (!gk.isKeeper || !gk.onPitch) continue;
      const ownGoal = this.dirFor(gk.side) === 1 ? (-1 as Direction) : (1 as Direction);
      const at = { x: this.ball.pos.x, y: this.ball.pos.y };
      // A keeper sweeps his whole box, not just the six-yard line; how far he
      // will come for it is what command of area buys.
      if (!inBox(at, penaltyArea(ownGoal))) continue;
      const reach = inBox(at, sixYardBox(ownGoal))
        ? 3 + attr01(gk.def.attributes.commandOfArea) * 2.5
        : 1.6 + attr01(gk.def.attributes.commandOfArea) * 2;
      if (dist(gk.pos, this.ball.pos) > reach) continue;
      this.ball.owner = gk.def.id;
      this.ownedSinceTick = this.tick;
      this.ball.lastTouch = gk.def.id;
      this.ball.lastTouchTeam = gk.side;
      this.ball.vel = { x: 0, y: 0, z: 0 };
      gk.state = "Distribute";
      return;
    }
  }

  /* --- laws ------------------------------------------------------------- */

  private resolveLaws(): void {
    if (this.play !== "live") return;

    const from = this.prevBallPos ?? this.ball.pos;
    const to = this.ball.pos;
    this.prevBallPos = { ...to };

    const cross = crossedLine(
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
    );
    if (!cross) return;

    if (cross.line === "goal") {
      const { near, far } = goalPostY();
      // A goal is a ball that has been PLAYED over the line. A ball still at a
      // carrier's feet crossing it is a player running out of play — without
      // this, a keeper who gathers on his line and turns is credited with
      // scoring past himself.
      const inMouth =
        this.ball.owner === null &&
        cross.at.y > near &&
        cross.at.y < far &&
        this.ballHeightAt(cross.t) < GOAL_HEIGHT;
      if (inMouth) {
        this.scoreGoal(cross.side);
        return;
      }
      const attackingTeamOfLastTouch = this.ball.lastTouchTeam;
      const defendingSide: TeamSide = this.dirFor(0) === cross.side ? 1 : 0;
      const conceded = attackingTeamOfLastTouch !== defendingSide;
      if (conceded) {
        // Attacker put it out: goal kick to the defenders.
        this.deadBall("goalKick", defendingSide, {
          x: cross.side === 1 ? PITCH_LENGTH - 5.5 : 5.5,
          y: PITCH_WIDTH / 2,
        });
      } else {
        this.deadBall(
          "corner",
          (1 - defendingSide) as TeamSide,
          nearestCorner(cross.at, cross.side),
        );
      }
      return;
    }

    const throwTo: TeamSide =
      this.ball.lastTouchTeam === null ? 0 : ((1 - this.ball.lastTouchTeam) as TeamSide);
    this.deadBall("throw", throwTo, {
      x: clamp(cross.at.x, 0, PITCH_LENGTH),
      y: cross.side === "top" ? 0 : PITCH_WIDTH,
    });
  }

  private prevBallPos: Vec3 | null = null;

  /** Ball height at fraction t of the step that crossed the line. */
  private ballHeightAt(t: number): number {
    const prevZ = this.prevBallPos ? this.prevBallPos.z : this.ball.pos.z;
    return lerp(prevZ, this.ball.pos.z, t);
  }

  private scoreGoal(goalSide: Direction): void {
    // A goal at `goalSide`'s end is scored by whoever attacks that end.
    const scoringSide: TeamSide = this.dirFor(0) === goalSide ? 0 : 1;
    this.score[scoringSide]++;
    const scorer = this.ball.lastTouch;
    const ownGoal = this.ball.lastTouchTeam !== null && this.ball.lastTouchTeam !== scoringSide;
    this.emit({
      type: "Goal",
      actorId: scorer,
      team: scoringSide,
      from: { ...this.ball.pos },
      to: { ...goalCentre(goalSide), z: 0 },
      scorerId: scorer ?? -1,
      assistId: null,
      ownGoal,
    });
    this.emit({ type: "Whistle", kind: "goalGiven", actorId: null, team: null, from: null, to: null });
    this.addStoppage(35); // a celebration and the walk back
    this.setupKickOff((1 - scoringSide) as TeamSide);
  }

  private deadBall(
    kind: "throw" | "corner" | "goalKick" | "freeKick" | "penalty",
    side: TeamSide,
    at: Vec2,
  ): void {
    this.play = "deadBall";
    this.ball.owner = null;
    this.ball.vel = { x: 0, y: 0, z: 0 };
    this.ball.pos = { x: at.x, y: at.y, z: 0 };
    // Added time comes from the things that actually stop the clock — goals,
    // injuries, cards, substitutions — not from every throw-in. Charging a
    // few seconds per restart put six minutes on the end of every half.
    if (kind === "freeKick") this.addStoppage(4);
    this.emit({
      type: "Restart",
      kind,
      actorId: null,
      team: side,
      from: { x: at.x, y: at.y, z: 0 },
      to: null,
    });
    this.pending = { kind, side, at, takeAt: this.tick + Math.round(PHYSICS_HZ * 1.5) };
    this.lastRestartTick = this.tick;
  }

  /** A pending restart is taken by the nearest eligible player of the side. */
  private resolveRestart(): void {
    const pending = this.pending;
    if (!pending || this.tick < pending.takeAt) return;

    if (pending.kind === "kickOff") {
      const taker = this.closestTo({ x: pending.at.x, y: pending.at.y, z: 0 }, pending.side);
      this.pending = null;
      this.play = "live";
      this.prevBallPos = { ...this.ball.pos };
      this.emit({
        type: "KickOff",
        actorId: taker?.def.id ?? null,
        team: pending.side,
        from: { ...this.ball.pos },
        to: null,
        period: this.period,
      });
      if (taker) {
        this.ball.owner = taker.def.id;
        this.ownedSinceTick = this.tick;
        this.ball.lastTouch = taker.def.id;
        this.ball.lastTouchTeam = taker.side;
      }
      return;
    }

    if (pending.kind === "penalty") {
      this.takePenalty(pending.side, pending.at);
      return;
    }

    const taker = this.closestTo({ x: pending.at.x, y: pending.at.y, z: 0 }, pending.side);
    if (!taker) {
      this.pending = null;
      this.play = "live";
      return;
    }

    /* The taker WALKS to the ball. Teleporting him onto it moved a player up
     * to fifty metres in a single tick, which the renderer faithfully drew as
     * a body vanishing and reappearing somewhere else. Waiting for him is also
     * what a throw-in actually looks like. */
    const arrived = dist(taker.pos, pending.at) <= 1.2;
    const waited = this.tick - pending.takeAt > PHYSICS_HZ * 8;
    if (!arrived && !waited) {
      taker.state = "ChaseBall";
      taker.target = { x: pending.at.x, y: pending.at.y };
      taker.nextBrainTick = this.tick + TICKS_PER_BRAIN_BEAT;
      return;
    }
    if (!arrived) taker.pos = { x: pending.at.x, y: pending.at.y };

    this.pending = null;
    this.play = "live";
    this.ball.pos = { x: pending.at.x, y: pending.at.y, z: 0 };
    this.prevBallPos = { ...this.ball.pos };

    const dir = this.dirFor(pending.side);
    if (pending.kind === "corner") {
      this.takeCorner(taker, dir);
      return;
    }
    if (pending.kind === "freeKick") {
      this.takeFreeKick(taker, dir, pending.at);
      return;
    }
    const target: Vec3 = {
      x: pending.at.x + dir * this.rng.range(14, 30),
      y: clamp(pending.at.y + this.rng.range(-14, 14), 2, PITCH_WIDTH - 2),
      z: 0,
    };
    this.strike(taker, target, pending.kind === "goalKick" ? 0.8 : 0.6, pending.kind === "throw" ? 0.25 : 0.55, "pass");
  }

  /**
   * A corner is a routine, not a hoof. The taker picks a delivery — near post,
   * far post, the edge, or short — and the side sends bodies to meet it. The
   * ball itself is then an ordinary flighted ball, which means the aerial
   * contest decides what happens to it, exactly as it does from open play.
   */
  private takeCorner(taker: Player, dir: Direction): void {
    const goal = goalCentre(dir);
    const { near, far } = goalPostY();
    const nearPost = Math.abs(taker.pos.y - near) < Math.abs(taker.pos.y - far) ? near : far;
    const quality = attr01(taker.def.attributes.crossing);

    // Send the big men in, and leave one out for the second ball.
    const attackers = this.players
      .filter((p) => p.side === taker.side && p.onPitch && p !== taker && !p.isKeeper)
      .sort((a, b) => b.def.attributes.jumpReach - a.def.attributes.jumpReach);
    const spots: Vec2[] = [
      { x: goal.x - dir * 5.5, y: nearPost },
      { x: goal.x - dir * 8, y: goal.y },
      { x: goal.x - dir * 6.5, y: goal.y + (goal.y - nearPost) * 0.9 },
      { x: goal.x - dir * 11, y: goal.y + (goal.y - nearPost) * 0.4 },
      { x: goal.x - dir * 18, y: goal.y },
    ];
    for (const [i, p] of attackers.entries()) {
      const spot = spots[i];
      if (!spot) break;
      p.state = "RunBehind";
      p.target = { ...spot };
      p.nextBrainTick = this.tick + TICKS_PER_BRAIN_BEAT * 3;
    }

    const roll = this.rng.next();
    let target: Vec3;
    let loft = 0.65;
    if (roll < 0.12) {
      // Short: to a team-mate near the flag, and play restarts from there.
      const short = attackers[attackers.length - 1];
      target = short
        ? { x: short.pos.x, y: short.pos.y, z: 0 }
        : { x: taker.pos.x + dir * 6, y: taker.pos.y, z: 0 };
      loft = 0;
    } else if (roll < 0.45) {
      target = { x: goal.x - dir * 5.5, y: nearPost, z: 2.2 };
    } else if (roll < 0.8) {
      target = { x: goal.x - dir * 7, y: goal.y + (goal.y - nearPost) * 0.9, z: 2.3 };
    } else {
      target = { x: goal.x - dir * 16, y: goal.y, z: 1.6 };
    }
    // A poor crosser hangs it up where the keeper can claim it.
    const scatter = CROSS_TARGET_SPREAD * (1 - quality) * 0.6;
    this.strike(
      taker,
      {
        x: clamp(target.x + this.rng.range(-scatter, scatter), 1, PITCH_LENGTH - 1),
        y: clamp(target.y + this.rng.range(-scatter, scatter), 1, PITCH_WIDTH - 1),
        z: target.z,
      },
      0.6,
      loft,
      "pass",
      { targetId: null, completed: false },
    );
  }

  /**
   * A free kick. In range of goal it is a shot at goal over a wall; further
   * out it is a delivery into the box. The wall is real: defenders stand at
   * the mandated distance in the line of the shot, and the ball can hit them.
   */
  private takeFreeKick(taker: Player, dir: Direction, at: Vec2): void {
    const range = distanceToGoal(at, dir);
    const a = taker.def.attributes;
    const shootable = range < 30 && range > 6 && this.rng.chance(0.35 + attr01(a.technique) * 0.4);

    if (!shootable) {
      if (range < 45) {
        // Into the mixer.
        const goal = goalCentre(dir);
        this.markBoxRunners(taker.side, dir);
        this.strike(
          taker,
          { x: goal.x - dir * 8, y: goal.y + this.rng.range(-8, 8), z: 2.2 },
          0.6,
          0.6,
          "pass",
          { targetId: null, completed: false },
        );
        return;
      }
      const mate = this.passOptions(taker, 4).find((m) => !this.offsidePosition(m, taker.side));
      if (mate) this.playPass(taker, mate);
      else this.strike(taker, { x: at.x + dir * 25, y: at.y, z: 0 }, 0.7, 0.4, "clear");
      return;
    }

    const wall = this.formWall(at, range, (1 - taker.side) as TeamSide, dir);
    // Over the wall, or round it: a technical taker bends it, a powerful one
    // hits through the gap. Either way the wall gets a chance to block it.
    this.takeShot(taker, dir, 0, {});
    if (wall.length > 0 && this.pendingShot) {
      const jumper = wall[0] as Player;
      const block = clamp(0.18 + attr01(jumper.def.attributes.jumpReach) * 0.22, 0, 0.45);
      if (this.rng.chance(block)) {
        this.pendingShot = null;
        this.resolvedShotUntil = 0;
        const angle = this.rng.range(0, Math.PI * 2);
        this.ball.pos = { x: jumper.pos.x, y: jumper.pos.y, z: 1.2 };
        this.ball.vel = { x: Math.cos(angle) * 6, y: Math.sin(angle) * 6, z: 2 };
        this.ball.lofted = false;
      }
    }
  }

  /** Send the tall men into the box for a delivery. */
  private markBoxRunners(side: TeamSide, dir: Direction): void {
    const goal = goalCentre(dir);
    const runners = this.players
      .filter((p) => p.side === side && p.onPitch && !p.isKeeper)
      .sort((a, b) => b.def.attributes.jumpReach - a.def.attributes.jumpReach)
      .slice(0, 4);
    for (const [i, p] of runners.entries()) {
      p.state = "RunBehind";
      p.target = { x: goal.x - dir * (6 + i * 2), y: goal.y + (i % 2 === 0 ? -4 : 4) };
      p.nextBrainTick = this.tick + TICKS_PER_BRAIN_BEAT * 3;
    }
  }

  /**
   * Build a wall: the closer the free kick, the more bodies in it. They stand
   * the mandated 9.15 m from the ball, on the line between it and the near
   * post, which is what actually makes a taker have to go over or around.
   */
  private formWall(at: Vec2, range: number, side: TeamSide, attackDir: Direction): Player[] {
    const count = clamp(Math.round((30 - range) / 7) + 1, 1, 4);
    const goal = goalCentre(attackDir);
    const toGoal = { x: goal.x - at.x, y: goal.y - at.y };
    const length = Math.hypot(toGoal.x, toGoal.y) || 1;
    const ux = toGoal.x / length;
    const uy = toGoal.y / length;
    const anchor = { x: at.x + ux * RESTART_DISTANCE, y: at.y + uy * RESTART_DISTANCE };

    const defenders = this.players
      .filter((p) => p.side === side && p.onPitch && !p.isKeeper)
      .sort(
        (a, b) => dist(a.pos, anchor) - dist(b.pos, anchor) || a.def.id - b.def.id,
      )
      .slice(0, count);
    for (const [i, p] of defenders.entries()) {
      const offset = (i - (defenders.length - 1) / 2) * 0.9;
      p.state = "HoldShape";
      p.pos = { x: anchor.x - uy * offset, y: anchor.y + ux * offset };
      p.vel = { x: 0, y: 0 };
      p.target = { ...p.pos };
      p.nextBrainTick = this.tick + TICKS_PER_BRAIN_BEAT * 3;
    }
    return defenders;
  }

  /**
   * A penalty. The best striker of a ball takes it, everyone else is cleared
   * out of the area, and the kick itself goes through the same shot model as
   * everything else — which already prices a spot kick at the historical 0.76
   * and hands it to the save model to be kept out.
   */
  private takePenalty(side: TeamSide, spot: Vec2): void {
    const dir = this.dirFor(side);
    let taker: Player | null = null;
    let best = -Infinity;
    for (const p of this.players) {
      if (p.side !== side || !p.onPitch || p.isKeeper) continue;
      const a = p.def.attributes;
      const score = attr01(a.composure) * 0.5 + attr01(a.finishing) * 0.4 + attr01(a.technique) * 0.1;
      if (score > best || (score === best && taker && p.def.id < taker.def.id)) {
        best = score;
        taker = p;
      }
    }
    this.pending = null;
    this.play = "live";
    if (!taker) return;

    // Clear the area: everyone but the taker and the keeper stands outside it,
    // which is a dead-ball reposition, not a run.
    const area = penaltyArea(dir);
    for (const p of this.players) {
      if (!p.onPitch || p === taker || p.isKeeper) continue;
      if (!inBox(p.pos, area)) continue;
      p.pos = { x: spot.x - dir * this.rng.range(4, 8), y: clamp(p.pos.y, 6, PITCH_WIDTH - 6) };
      p.vel = { x: 0, y: 0 };
    }

    taker.pos = { x: spot.x - dir * 1, y: spot.y };
    this.ball.pos = { x: spot.x, y: spot.y, z: 0 };
    this.ball.owner = null;
    this.ball.vel = { x: 0, y: 0, z: 0 };
    this.prevBallPos = { ...this.ball.pos };
    this.takeShot(taker, dir, 0, { penalty: true });
  }

  /** Ball dead and nobody near it for too long: force someone to go and get
   *  it. Without this a sim can sit in a stalemate and burn the whole half. */
  private watchdog(): void {
    if (this.play !== "live" || !isDead(this.ball)) {
      this.stalledTicks = 0;
      return;
    }
    this.stalledTicks++;
    if (this.stalledTicks < PHYSICS_HZ * 8) return;
    this.stalledTicks = 0;
    const chaser = this.closestTo(this.ball.pos);
    if (chaser) {
      chaser.state = "ChaseBall";
      chaser.target = { x: this.ball.pos.x, y: this.ball.pos.y };
      chaser.nextBrainTick = this.tick + TICKS_PER_BRAIN_BEAT * 4;
    }
  }

  private addStoppage(seconds: number): void {
    this.stoppageSeconds = Math.min(this.stoppageSeconds + seconds, STOPPAGE_MAX_SECONDS);
  }

  private advancePeriod(): void {
    if (this.play === "fullTime") return;
    // Each period runs its 45 minutes plus the stoppage this period earned.
    const periodEnd = this.period * HALF_LENGTH_SECONDS + this.stoppageSeconds;
    if (this.matchSecond < periodEnd) return;
    // The half only ends when the ball is not in a live, dangerous moment —
    // but a carrier who never lets go must not be able to hold the clock
    // hostage, so the referee blows anyway once well past the added time.
    const grace = periodEnd + 60;
    if (this.play === "live" && this.ball.owner !== null && this.matchSecond < grace) return;

    if (this.period >= HALVES) {
      this.play = "fullTime";
      this.emit({ type: "Whistle", kind: "fullTime", actorId: null, team: null, from: null, to: null });
      return;
    }
    this.emit({ type: "Whistle", kind: "halfTime", actorId: null, team: null, from: null, to: null });
    this.period++;
    this.homeDir = -this.homeDir as Direction;
    this.stoppageSeconds = 0;
    this.setupKickOff(1);
  }

  /* --- helpers ---------------------------------------------------------- */

  playerById(id: number): Player | null {
    if (this.byId.size !== this.players.length) {
      this.byId.clear();
      for (const p of this.players) this.byId.set(p.def.id, p);
    }
    return this.byId.get(id) ?? null;
  }

  /** Share of controlled time per side; [0.5, 0.5] before anyone touches it. */
  possessionShare(): [number, number] {
    const total = this.possessionTicks[0] + this.possessionTicks[1];
    if (total === 0) return [0.5, 0.5];
    return [this.possessionTicks[0] / total, this.possessionTicks[1] / total];
  }

  private closestTo(p: Vec2 | Vec3, side?: TeamSide): Player | null {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const q of this.players) {
      if (!q.onPitch || q.sentOff) continue;
      if (side !== undefined && q.side !== side) continue;
      if (side !== undefined && q.isKeeper) continue;
      const d = dist(q.pos, p);
      if (d < bestD || (d === bestD && best && q.def.id < best.def.id)) {
        best = q;
        bestD = d;
      }
    }
    return best;
  }

  private emit(e: MatchEventDraft): void {
    this.log.push({
      ...(e as MatchEvent),
      tick: this.tick,
      matchSecond: this.matchSecond,
      period: this.period,
    });
  }

  /** Mid-match user command. Applied at a tick boundary so it only ever
   *  affects the future, and recorded so the replay reproduces it. */
  applyCommand(cmd: UserCommand): void {
    if (cmd.kind === "tactics") {
      if (cmd.side === 0) (this.setup as { homeTactics: typeof cmd.tactics }).homeTactics = cmd.tactics;
      else (this.setup as { awayTactics: typeof cmd.tactics }).awayTactics = cmd.tactics;
      this.emit({ type: "TacticChange", actorId: null, team: cmd.side, from: null, to: null });
    }
  }

  /* --- snapshots -------------------------------------------------------- */

  private maybeKeyframe(): void {
    if (this.tick % (KEYFRAME_INTERVAL_SECONDS * PHYSICS_HZ) !== 0) return;
    this.keyframes.push(this.fullSnapshot());
  }

  keyframeRing(): KeyframeRing {
    return this.keyframes;
  }

  fullSnapshot(): FullSnapshot {
    return {
      tick: this.tick,
      matchSecond: this.matchSecond,
      period: this.period,
      play: this.play,
      score: [this.score[0], this.score[1]],
      rngState: this.rng.getState(),
      eventCount: this.log.length,
      homeDir: this.homeDir,
      prevBallPos: this.prevBallPos ? { ...this.prevBallPos } : null,
      clock: {
        stoppageSeconds: this.stoppageSeconds,
        possessionTicks: [this.possessionTicks[0], this.possessionTicks[1]],
      },
      possession: {
        ownedSinceTick: this.ownedSinceTick,
        controlLockTick: this.controlLockTick,
        selfLockTick: this.selfLockTick,
        lastKickerId: this.lastKickerId,
        strayFacedUntil: this.strayFacedUntil,
        stalledTicks: this.stalledTicks,
        wonBallTick: [this.wonBallTick[0], this.wonBallTick[1]],
        wonBallDeep: [this.wonBallDeep[0], this.wonBallDeep[1]],
      },
      pendingShot: this.pendingShot ? structuredCloneish(this.pendingShot) : null,
      pendingRestart: this.pending ? structuredCloneish(this.pending) : null,
      aerialLockTick: this.aerialLockTick,
      resolvedShotUntil: this.resolvedShotUntil,
      lastRestartTick: this.lastRestartTick,
      advantage: this.advantage
        ? { side: this.advantage.side, at: { ...this.advantage.at }, until: this.advantage.until }
        : null,
      activeMoves: [serialiseMove(this.activeMove[0]), serialiseMove(this.activeMove[1])],
      ball: {
        pos: { ...this.ball.pos },
        vel: { ...this.ball.vel },
        spin: this.ball.spin,
        owner: this.ball.owner,
        lastTouch: this.ball.lastTouch,
        lastTouchTeam: this.ball.lastTouchTeam,
        lofted: this.ball.lofted,
      },
      players: this.players.map((p) => ({
        id: p.def.id,
        slot: p.slot,
        pos: { ...p.pos },
        vel: { ...p.vel },
        heading: p.heading,
        state: p.state,
        stamina: p.stamina,
        nextBrainTick: p.nextBrainTick,
        yellowCards: p.yellowCards,
        sentOff: p.sentOff,
        onPitch: p.onPitch,
        target: { ...p.target },
        steerX: p.steerX,
        steerY: p.steerY,
        vMax: p.vMax,
        aMax: p.aMax,
        turnRate: p.turnRate,
      })),
    };
  }

  /** Restore a keyframe. Everything that can vary — including the RNG cursor —
   *  comes back, so continuing from here reproduces the original match. */
  restore(frame: FullSnapshot): void {
    this.tick = frame.tick;
    this.period = frame.period;
    this.play = frame.play;
    this.score = [frame.score[0], frame.score[1]];
    this.rng.setState(frame.rngState);
    this.homeDir = frame.homeDir;
    this.stoppageSeconds = frame.clock.stoppageSeconds;
    this.possessionTicks[0] = frame.clock.possessionTicks[0];
    this.possessionTicks[1] = frame.clock.possessionTicks[1];
    this.ownedSinceTick = frame.possession.ownedSinceTick;
    this.controlLockTick = frame.possession.controlLockTick;
    this.selfLockTick = frame.possession.selfLockTick;
    this.lastKickerId = frame.possession.lastKickerId;
    this.strayFacedUntil = frame.possession.strayFacedUntil;
    this.stalledTicks = frame.possession.stalledTicks;
    this.wonBallTick[0] = frame.possession.wonBallTick[0];
    this.wonBallTick[1] = frame.possession.wonBallTick[1];
    this.wonBallDeep[0] = frame.possession.wonBallDeep[0];
    this.wonBallDeep[1] = frame.possession.wonBallDeep[1];
    this.pendingShot = (frame.pendingShot ?? null) as typeof this.pendingShot;
    this.pending = (frame.pendingRestart ?? null) as typeof this.pending;
    this.aerialLockTick = frame.aerialLockTick;
    this.resolvedShotUntil = frame.resolvedShotUntil;
    this.lastRestartTick = frame.lastRestartTick;
    this.advantage = frame.advantage
      ? { side: frame.advantage.side, at: { ...frame.advantage.at }, until: frame.advantage.until }
      : null;
    /* Rewind the event stream to where it stood at this tick. Replaying the
     * passage re-emits exactly these events again, so without the rewind the
     * log grows a second copy of every passage that has been watched — and
     * commentary, stats and the reel are all derived from that log. */
    this.log.truncate(frame.eventCount);
    /* The delta feed the renderer reads is "events since the last snapshot",
     * so after a rewind it has to start from where the log actually is — not
     * from where the keyframe thinks it is. Seeking BACKWARDS (watch minute
     * 40, then minute 12) leaves the log shorter than the keyframe's count,
     * and pointing the cursor past the end of it silently swallowed the first
     * events of the passage being played. */
    this.lastEventIndex = this.log.length;
    this.activeMove[0] = deserialiseMove(frame.activeMoves[0]);
    this.activeMove[1] = deserialiseMove(frame.activeMoves[1]);
    // The offside line is cached per tick; a restored tick must not read a
    // cache computed for a different one.
    this.offsideLineTick[0] = -1;
    this.offsideLineTick[1] = -1;
    this.ball.pos = { ...frame.ball.pos };
    this.ball.vel = { ...frame.ball.vel };
    this.ball.spin = frame.ball.spin;
    this.ball.owner = frame.ball.owner;
    this.ball.lastTouch = frame.ball.lastTouch;
    this.ball.lastTouchTeam = frame.ball.lastTouchTeam;
    this.ball.lofted = frame.ball.lofted;
    for (const ps of frame.players) {
      const p = this.playerById(ps.id);
      if (!p) continue;
      p.slot = ps.slot;
      p.pos = { ...ps.pos };
      p.vel = { ...ps.vel };
      p.heading = ps.heading;
      p.state = ps.state;
      p.stamina = ps.stamina;
      p.nextBrainTick = ps.nextBrainTick;
      p.yellowCards = ps.yellowCards;
      p.sentOff = ps.sentOff;
      p.onPitch = ps.onPitch;
      p.target = { ...ps.target };
      p.steerX = ps.steerX;
      p.steerY = ps.steerY;
      p.vMax = ps.vMax;
      p.aMax = ps.aMax;
      p.turnRate = ps.turnRate;
    }
    this.prevBallPos = frame.prevBallPos ? { ...frame.prevBallPos } : null;
  }


  /** Compact view for the render thread, carrying the events since last call. */
  renderSnapshot(): RenderSnapshot {
    const events = this.log.since(this.lastEventIndex);
    this.lastEventIndex = this.log.length;
    const ball: BallSnapshot = {
      x: this.ball.pos.x,
      y: this.ball.pos.y,
      z: this.ball.pos.z,
      vx: this.ball.vel.x,
      vy: this.ball.vel.y,
      vz: this.ball.vel.z,
      owner: this.ball.owner,
    };
    const players: PlayerSnapshot[] = this.players.map((p) => ({
      id: p.def.id,
      side: p.side,
      number: p.def.squadNumber,
      pos: { x: p.pos.x, y: p.pos.y },
      vel: { x: p.vel.x, y: p.vel.y },
      heading: p.heading,
      state: p.state,
      stamina: p.stamina,
      isKeeper: p.isKeeper,
      onPitch: p.onPitch,
    }));
    return {
      tick: this.tick,
      matchSecond: this.matchSecond,
      period: this.period,
      stoppageSeconds: this.stoppageSeconds,
      play: this.play,
      score: [this.score[0], this.score[1]],
      attackingDir: [this.dirFor(0), this.dirFor(1)],
      players,
      ball,
      events,
    };
  }
}

/** One-ply continuation discount. A pass or a carry only puts someone ELSE in
 *  a shooting position; he still has to beat his man and finish. Without a
 *  discount the scorer walks the ball to the goal line every time, because the
 *  next position is always worth more than shooting from this one. */
const CONTINUATION = 0.74;
/** How much easier an unintended ball on target is to keep out than a struck
 *  shot: it is slower, it is central, and the keeper has watched it all the
 *  way. Applied to the beat chance, so 0.35 means a third as likely to go in. */
const STRAY_BALL_SAVE_BONUS = 0.2;
/** What a shot is worth beyond the goal itself — rebounds, corners, a keeper
 *  forced into a mistake — as a fraction of its own xG. */
const SHOT_FOLLOW_UP = 0.7;
/** No one shoots at a chance worse than this, however bare the alternatives. */
const MIN_SHOT_XG = 0.03;

/** Goal mouth constants re-exported for the renderer's convenience. */
/** A Map does not survive JSON, so the cast is stored as pairs. */
function serialiseMove(active: ActiveMove | null): unknown {
  if (!active) return null;
  return {
    move: active.move,
    cast: [...active.cast.entries()],
    step: active.step,
    stepStartTick: active.stepStartTick,
    startTick: active.startTick,
  };
}

function deserialiseMove(raw: unknown): ActiveMove | null {
  if (!raw) return null;
  const data = raw as {
    move: PlaybookMove;
    cast: [string, number][];
    step: number;
    stepStartTick: number;
    startTick: number;
  };
  return {
    move: data.move,
    cast: new Map(data.cast),
    step: data.step,
    stepStartTick: data.stepStartTick,
    startTick: data.startTick,
  };
}

/** Deep copy of a plain, JSON-safe object graph. The keyframes have to be
 *  structured-clonable across the worker boundary and serialisable into a
 *  replay, so nothing in them may share a reference with the live sim. */
function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const GOAL_MOUTH = { width: GOAL_WIDTH, height: GOAL_HEIGHT };
