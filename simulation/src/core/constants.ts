/* ============================================================================
 * CONSTANTS — single tuning surface for the simulation.
 *
 * Everything a designer might want to turn lives here with a comment saying
 * what it does and which direction to push it. Nothing in src/core may read a
 * magic number that is not defined in this file.
 * ========================================================================== */

/* --- Time -------------------------------------------------------------- */

/** Physics timestep. 120 Hz keeps a 30 m/s shot inside 25 cm per step, which
 *  is small enough that swept post/line tests stay exact enough to trust. */
export const PHYSICS_HZ = 120;
export const DT = 1 / PHYSICS_HZ;

/** Steering rate. Bodies integrate every physics tick, but the *desired*
 *  velocity — arrive plus separation, the part that needs a neighbour query —
 *  is recomputed at 40 Hz. A player covers at most 8 cm between steering
 *  updates at full sprint, so the path is indistinguishable, and it removes
 *  two thirds of the neighbour queries in the match. */
export const STEER_HZ = 40;

/** Decision ("brain") rate per player. 8 Hz is the FM-ish sweet spot: fast
 *  enough that a press looks reactive, slow enough that 22 brains are cheap.
 *  Beats are staggered by player index so the load spreads across ticks. */
export const BRAIN_HZ = 8;
export const TICKS_PER_BRAIN_BEAT = PHYSICS_HZ / BRAIN_HZ; // 15
export const TICKS_PER_STEER = PHYSICS_HZ / STEER_HZ; // 3

/** Full-state snapshots for instant seek (ring buffer in the director). */
export const KEYFRAME_INTERVAL_SECONDS = 30;

/** Match structure. Stoppage is derived from the event stream, not a constant. */
export const HALF_LENGTH_SECONDS = 45 * 60;
export const HALVES = 2;
/** Stoppage is derived from the event stream, but a referee's arm has limits:
 *  cap what a period can add so a scrappy half cannot run away with the clock. */
export const STOPPAGE_MAX_SECONDS = 6 * 60;

/* --- Pitch geometry (metres, IFAB) -------------------------------------- */

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;

/** Playable apron simulated outside the touchlines so the ball, throws and
 *  goalkeeper rushes have somewhere to be before the whistle goes. */
export const APRON = 10;

export const GOAL_WIDTH = 7.32;
export const GOAL_HEIGHT = 2.44;
/** Depth of the net behind the goal line, for ball-in-goal containment. */
export const GOAL_DEPTH = 2.0;
export const POST_RADIUS = 0.06;

export const PEN_AREA_WIDTH = 40.32; // across the pitch (y extent)
export const PEN_AREA_DEPTH = 16.5; // out from the goal line (x extent)
export const SIX_YARD_WIDTH = 18.32;
export const SIX_YARD_DEPTH = 5.5;
export const PENALTY_SPOT_DIST = 11;
export const CENTRE_CIRCLE_RADIUS = 9.15;
/** Mandated distance for a defensive wall / opponents at a restart. */
export const RESTART_DISTANCE = 9.15;
export const CORNER_ARC_RADIUS = 1;

/* --- Ball physics -------------------------------------------------------- */

export const GRAVITY = 9.81;
/** Ball radius (size 5 ≈ 0.11 m). Used for bounce, post capsules, line tests. */
export const BALL_RADIUS = 0.11;

/** Quadratic air drag coefficient, per metre of travel: dv = -k*|v|*v.
 *  k ≈ 0.004 gives a 30 m/s strike losing ~15% of pace over 20 m, which is
 *  about right for a modern ball. Raise for a heavier, "wetter" ball. */
export const AIR_DRAG_K = 0.004;

/** Rolling deceleration on grass, m/s^2. Sampled between the two by pitch
 *  condition: 3 = quick, watered surface, 7 = a heavy winter pitch. */
export const GROUND_FRICTION_MIN = 3;
export const GROUND_FRICTION_MAX = 7;

/** Vertical restitution on bounce, and the tangential speed kept per bounce. */
export const BOUNCE_RESTITUTION = 0.6;
export const BOUNCE_TANGENT_KEEP = 0.82;
/** Below this upward speed after a bounce the ball is treated as grounded. */
export const BOUNCE_SETTLE_SPEED = 0.35;

/** Post/bar collision: lively woodwork, plus a hair of tangent jitter so
 *  rebounds are not perfectly mirror-symmetric and predictable. */
export const POST_RESTITUTION = 0.7;
export const POST_TANGENT_JITTER = 0.06; // radians, ± uniform

/** Magnus-ish lateral acceleration per unit spin per m/s of pace. Spin is
 *  normalised to [-1, 1] (negative = curls towards -y). */
export const SPIN_ACCEL_K = 0.011;

/** A ball slower than this on the deck with no owner is "dead" for the
 *  watchdog that forces a decision rather than letting play stall. */
export const BALL_DEAD_SPEED = 0.25;

/* --- Kick solver --------------------------------------------------------- */

/** Newton refinement passes applied to the analytic (drag-free) solution.
 *  2-3 lands within a few cm at 40 m; more is wasted work. */
export const KICK_NEWTON_PASSES = 3;
/** Max pace a kick can be struck with (m/s) before skill scaling. */
export const KICK_MAX_PACE = 34;
/** Loft 0..1 maps to this launch-angle range in radians. */
export const KICK_MIN_LAUNCH = 0;
export const KICK_MAX_LAUNCH = Math.PI / 3; // 60°, a hoofed clearance

/* --- Player movement ----------------------------------------------------- */

/** vMax = base + perAttr * pace(1..20)  -> 6.0 .. 9.4 m/s. */
export const SPEED_BASE = 5.8;
export const SPEED_PER_PACE = 0.18;
/** aMax = base + perAttr * acceleration(1..20) -> 3.15 .. 6.0 m/s^2. */
export const ACCEL_BASE = 3;
export const ACCEL_PER_ACCELERATION = 0.15;
/** Turn rate ceiling, rad/s = base + perAttr * agility. */
export const TURN_BASE = 3.0;
export const TURN_PER_AGILITY = 0.35;
/** Fraction of top speed retained while carrying the ball, at dribbling 1
 *  and at dribbling 20. Interpolated linearly. */
export const CARRY_SPEED_MIN = 0.74;
export const CARRY_SPEED_MAX = 0.94;
/** Late-game fatigue: full-stamina players lose ~1%, drained ones ~3%. */
export const FATIGUE_SPEED_LOSS_MIN = 0.01;
export const FATIGUE_SPEED_LOSS_MAX = 0.03;

/** Personal space radius used by the separation steering term. */
export const SEPARATION_RADIUS = 1.6;
export const SEPARATION_WEIGHT = 1.1;
/** Arrive() slows inside this radius so players settle onto anchors. */
export const ARRIVE_SLOW_RADIUS = 3.0;

/** Uniform spatial hash cell size for neighbour, duel and lane queries. */
export const GRID_CELL = 5;

/* --- Ball control -------------------------------------------------------- */

/** How close a player must be to take possession of a loose ground ball. */
export const CONTROL_RADIUS = 0.9;
/** Ball above this height cannot be taken in a normal ground control. */
export const CONTROL_MAX_HEIGHT = 0.9;
/** firstTouch 1..20 maps to how far the ball squirts away on control. */
export const TOUCH_DISTANCE_MAX = 1.5;
export const TOUCH_DISTANCE_MIN = 0.4;
/** A carrier knocks the ball this far ahead of themselves, in seconds of
 *  travel at current speed. */
export const KNOCK_AHEAD_SECONDS = 0.28;

/** After a kick, nobody may take control for this long, and the striker of the
 *  ball himself for this much longer. Without it a passer stands inside his
 *  own pass's control radius and immediately re-collects it, which reads as a
 *  player passing to himself eight times a second. */
export const KICK_CONTROL_LOCK = 0.22;
export const KICK_SELF_LOCK = 0.75;

/* --- Attribute scale ----------------------------------------------------- */

/** FM attributes run 1..20; most mechanics want a 0..1 normal of them. */
export const ATTR_MIN = 1;
export const ATTR_MAX = 20;
