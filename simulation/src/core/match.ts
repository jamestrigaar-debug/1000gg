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
  KICK_CONTROL_LOCK,
  KICK_MAX_PACE,
  KICK_SELF_LOCK,
  KNOCK_AHEAD_SECONDS,
  PHYSICS_HZ,
  PITCH_LENGTH,
  PITCH_WIDTH,
  POST_RADIUS,
  POST_RESTITUTION,
  POST_TANGENT_JITTER,
  TICKS_PER_BRAIN_BEAT,
  TICKS_PER_STEER,
  TOUCH_DISTANCE_MAX,
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
  /** Keyframes kept for seeking; 200 covers a full match at 30 s spacing. */
  keyframeCapacity?: number;
}

interface PendingRestart {
  kind: "kickOff" | "throw" | "corner" | "goalKick" | "freeKick";
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
  private readonly grid = new SpatialGrid<Player>();
  private readonly keyframes: KeyframeRing;
  private readonly friction: number;
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
    this.rng = new Rng(setup.seed);
    this.friction = frictionFor(setup.weather.pitchCondition);
    this.keyframes = new KeyframeRing(options.keyframeCapacity ?? 200);
    this.ball = createBall({ x: CENTRE.x, y: CENTRE.y, z: 0 });

    this.spawnTeam(0);
    this.spawnTeam(1);
    this.setupKickOff(0);
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

    if (steerBeat) this.contestCarrier();
    this.stepBall();
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

  private maxSpeedFor(p: Player): number {
    return this.ball.owner === p.def.id ? p.vMax * p.carryFactor : p.vMax;
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
      if (p.isKeeper) this.keeperDistribution(p, dir);
      else this.carrierBrain(p, dir);
      return;
    }

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

    // Whoever is closest to the ball goes and contests it, on either side.
    const chaser = this.closestTo(this.ball.pos);
    if (chaser === p && (this.ball.owner === null || owning !== p.side)) {
      p.state = "ChaseBall";
      p.target = this.ballInterceptPoint(p);
      return;
    }

    if (owning !== p.side) {
      this.defendBrain(p, dir, anchor, carrier);
      return;
    }

    // In possession without the ball: hold shape, shifted to the ball's side,
    // pushed on, and never beyond the last defender.
    const shift = clamp((this.ball.pos.y - PITCH_WIDTH / 2) * 0.3, -8, 8);
    const support = clamp((this.ball.pos.x - anchor.x) * 0.22, -8, 8);
    p.state = "Support";
    p.target = this.keepOnside(p, {
      x: clamp(anchor.x + support, 1, PITCH_LENGTH - 1),
      y: clamp(anchor.y + shift, 1, PITCH_WIDTH - 1),
    });
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
    if (rank === 0) {
      p.state = "Press";
      const gx = own.x - focus.x;
      const gy = own.y - focus.y;
      const gl = Math.hypot(gx, gy) || 1;
      p.target = { x: focus.x + (gx / gl) * 0.7, y: focus.y + (gy / gl) * 0.7 };
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
    // The back line sits a set distance goal-side of the ball, floored so it
    // never drops into the six-yard box and capped so it never overruns the
    // halfway line by more than a sensible high line would.
    const lineX = own.x + dir * clamp(ballProgress - engage, 8, PITCH_LENGTH * 0.62);
    const depth = 34 - ins.pressing * 8;

    // Where this slot sits within the band, front to back, from its own
    // anchor: the block keeps the team's shape, it does not flatten it.
    const slotDepth = clamp((anchor.x - own.x) * dir, 0, PITCH_LENGTH);
    const bandPos = clamp(slotDepth / (PITCH_LENGTH * 0.7), 0, 1);
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
      x: clamp(wantX, 1, PITCH_LENGTH - 1),
      y: clamp(wantY, 1, PITCH_WIDTH - 1),
    };
  }

  private keeperBrain(p: Player, dir: Direction, carrier: Player | null): void {
    const ownGoalDir = dir === 1 ? (-1 as Direction) : (1 as Direction);
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

  /** Where to run to meet a loose ball, rather than where it is now. */
  private ballInterceptPoint(p: Player): Vec2 {
    const lead = clamp(dist(p.pos, this.ball.pos) / Math.max(p.vMax, 1), 0, 1.2);
    return {
      x: this.ball.pos.x + this.ball.vel.x * lead * 0.6,
      y: this.ball.pos.y + this.ball.vel.y * lead * 0.6,
    };
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

  /**
   * On-ball decision. Every option is scored in the same currency — the
   * probability this possession ends in a goal — so they can be compared at
   * all: a shot is its xG, a pass is the receiver's threat discounted by
   * whether it arrives, a carry is the threat of where he would get to.
   */
  private carrierBrain(p: Player, dir: Direction): void {
    const pressure = this.pressureOn(p);
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
    const shootScore = shootValue * jitter();
    const passScore = bestPass * jitter();
    const carryScore = carryValue * jitter();

    if (shootScore >= passScore && shootScore >= carryScore && shotXG > MIN_SHOT_XG) {
      this.takeShot(p, dir, pressure);
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
    if (panic || (inOwnThird && pressure > 0.55 && bestOption < BASE_THREAT * 2.5)) {
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
      this.deadBall("freeKick", (1 - from.side) as TeamSide, {
        x: clamp(to.pos.x, 2, PITCH_LENGTH - 2),
        y: clamp(to.pos.y, 2, PITCH_WIDTH - 2),
      });
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
    return !this.rng.chance(0.08 + (1 - awareness) * 0.22);
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
    const skill = attr01(from.def.attributes.passing) * 0.7 + attr01(from.def.attributes.vision) * 0.3;
    const control = attr01(to.def.attributes.firstTouch) * 0.1;
    const base = 0.93 - d * 0.014 - blockers * 0.22 - markers * 0.16;
    return clamp(base + skill * 0.16 + control - this.pressureOn(from) * 0.14, 0.04, 0.97);
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
    kind: "pass" | "shot" | "clear",
    pass?: { targetId: number | null; completed: boolean },
  ): void {
    const a = p.def.attributes;
    const attribute = kind === "shot" ? a.finishing : a.passing;
    const from: Vec3 = { x: this.ball.pos.x, y: this.ball.pos.y, z: BALL_RADIUS };
    const range = Math.hypot(target.x - from.x, target.y - from.y);
    const pressure = this.pressureOn(p);
    const difficulty = clamp(range / 45 + (kind === "shot" ? 0.25 : 0), 0, 1);

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
    this.ball.lastTouch = p.def.id;
    this.ball.lastTouchTeam = p.side;
    this.lastKickerId = p.def.id;
    this.controlLockTick = this.tick + Math.round(KICK_CONTROL_LOCK * PHYSICS_HZ);
    this.selfLockTick = this.tick + Math.round(KICK_SELF_LOCK * PHYSICS_HZ);
    p.state = "Support";

    if (kind === "shot") {
      this.emit({
        type: "Shot",
        actorId: p.def.id,
        team: p.side,
        from,
        to: target,
        xg: 0,
        psxg: 0,
        onTarget: false,
        header: false,
        result: "off",
      });
    } else {
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
  }

  /**
   * Take a shot. The model decides the outcome first; the ball is then flown
   * to wherever that outcome says it went, so what the viewer sees and what
   * the stats record are the same event and cannot drift apart.
   */
  private takeShot(p: Player, dir: Direction, pressure: number): void {
    const a = p.def.attributes;
    const keeper = this.keeperOf((1 - p.side) as TeamSide);
    const outcome = resolveShot(
      {
        from: p.pos,
        dir,
        header: false,
        pressure,
        counter: this.isCounter(p.side),
        penalty: false,
      },
      { finishing: a.finishing, technique: a.technique, composure: a.composure, longShots: a.longShots },
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
      header: false,
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
    return clamp(blockers * 0.11, 0, 0.45);
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
      if (closing <= 2) continue; // not actually going anywhere near it

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
      // A ball nobody meant to put on target is one the keeper has seen all
      // the way: he is beaten by it far less often than by a struck shot.
      const psxg = postShotXG(y, z, pace, toGoal, false);
      const beaten = this.rng.chance(
        saveFailChance(psxg, {
          reflexes: keeper.def.attributes.reflexes,
          handling: keeper.def.attributes.handling,
          positioning: keeper.def.attributes.positioning,
        }) * STRAY_BALL_SAVE_BONUS,
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
    // Gathered a clear stride off his line, never on it: a keeper holding the
    // ball level with the goal line is one turn away from carrying it in.
    const contact: Vec2 = { x: goalX - pending.dir * 1.6, y: this.ball.pos.y };
    keeper.pos = { x: contact.x, y: clamp(contact.y, PITCH_WIDTH / 2 - 4, PITCH_WIDTH / 2 + 4) };
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
      const angle = this.rng.range(-1.1, 1.1);
      const speed = this.rng.range(10, 17);
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
      // Rolled on the steering beat rather than every tick, so the per-roll
      // chance is three times the per-tick one: ~1.5 s in contact is a coin
      // flip at parity.
      const p = clamp((0.006 * TICKS_PER_STEER * (0.6 + defend)) / (0.6 + attack), 0, 0.14);
      if (!this.rng.chance(p)) continue;
      this.ball.owner = o.def.id;
      this.ownedSinceTick = this.tick;
      this.ball.lastTouch = o.def.id;
      this.ball.lastTouchTeam = o.side;
      o.state = "Dribble";
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
    kind: "throw" | "corner" | "goalKick" | "freeKick",
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
  }

  /** A pending restart is taken by the nearest eligible player of the side. */
  private resolveRestart(): void {
    const pending = this.pending;
    if (!pending || this.tick < pending.takeAt) return;

    const taker = this.closestTo({ x: pending.at.x, y: pending.at.y, z: 0 }, pending.side);
    this.pending = null;
    this.play = "live";
    this.prevBallPos = { ...this.ball.pos };

    if (pending.kind === "kickOff") {
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

    if (!taker) return;
    taker.pos = { x: pending.at.x, y: pending.at.y };
    this.ball.pos = { x: pending.at.x, y: pending.at.y, z: 0 };
    const dir = this.dirFor(pending.side);
    const target: Vec3 =
      pending.kind === "corner"
        ? { ...goalCentre(dir), z: 2.2 }
        : {
            x: pending.at.x + dir * this.rng.range(14, 30),
            y: clamp(pending.at.y + this.rng.range(-14, 14), 2, PITCH_WIDTH - 2),
            z: 0,
          };
    this.strike(
      taker,
      target,
      pending.kind === "goalKick" ? 0.8 : 0.6,
      pending.kind === "throw" ? 0.25 : 0.55,
      "pass",
    );
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
      ball: {
        pos: { ...this.ball.pos },
        vel: { ...this.ball.vel },
        spin: this.ball.spin,
        owner: this.ball.owner,
        lastTouch: this.ball.lastTouch,
        lastTouchTeam: this.ball.lastTouchTeam,
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
      refreshCeilings(p);
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
const CONTINUATION = 0.62;
/** How much easier an unintended ball on target is to keep out than a struck
 *  shot: it is slower, it is central, and the keeper has watched it all the
 *  way. Applied to the beat chance, so 0.35 means a third as likely to go in. */
const STRAY_BALL_SAVE_BONUS = 0.2;
/** What a shot is worth beyond the goal itself — rebounds, corners, a keeper
 *  forced into a mistake — as a fraction of its own xG. */
const SHOT_FOLLOW_UP = 0.35;
/** No one shoots at a chance worse than this, however bare the alternatives. */
const MIN_SHOT_XG = 0.05;

/** Goal mouth constants re-exported for the renderer's convenience. */
/** Deep copy of a plain, JSON-safe object graph. The keyframes have to be
 *  structured-clonable across the worker boundary and serialisable into a
 *  replay, so nothing in them may share a reference with the live sim. */
function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const GOAL_MOUTH = { width: GOAL_WIDTH, height: GOAL_HEIGHT };
