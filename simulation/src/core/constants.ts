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
/** Turn rate ceiling, rad/s = base + perAttr * agility. This limits how fast
 *  the DIRECTION OF TRAVEL may change, not how fast a player may be pointed:
 *  a body carries its momentum through a turn. */
export const TURN_BASE = 3.0;
export const TURN_PER_AGILITY = 0.35;

/** How much more freely a player may turn when he is barely moving. Standing
 *  still you can pivot on the spot; at a sprint you have to arc. Before this
 *  existed the engine simply SNAPPED a player's heading to his desired
 *  direction whenever he dropped below 0.3 m/s, which is most of the pitch
 *  most of the time — and a dot easing onto its position, dipping under the
 *  threshold and instantly facing somewhere else is the twitch that made
 *  twenty-two of them look like insects rather than footballers. */
export const TURN_EASE_AT_REST = 2.6;
/** The speed below which the turn limit starts to relax, reaching "free" at a
 *  standstill: setting off from standing in any direction costs nothing, as
 *  it does in life. The relaxation is a RAMP, not a threshold — see
 *  turnStep() in player.ts for why that distinction is the whole fix. */
export const TURN_FREE_BELOW = 0.6;
/** Below this speed a player's facing is left alone rather than being taken
 *  from a velocity too small to have a meaningful direction. */
export const HEADING_HOLD_SPEED = 0.15;

/** Slowing down is harder than speeding up in the legs, but not by much; a
 *  footballer stopping is doing work, not coasting. Multiplies aMax when the
 *  desired velocity is slower than the current one. */
export const BRAKE_FACTOR = 1.8;

/** Inside this distance a player is "there" and stops asking to move. Wide
 *  enough that he settles rather than hunting across his anchor by
 *  millimetres for the rest of the match. */
export const ARRIVE_STOP_RADIUS = 0.35;
/** Fraction of top speed retained while carrying the ball, at dribbling 1
 *  and at dribbling 20. Interpolated linearly. */
export const CARRY_SPEED_MIN = 0.74;
export const CARRY_SPEED_MAX = 0.94;
/** Late-game fatigue: full-stamina players lose ~1%, drained ones ~3%. */
export const FATIGUE_SPEED_LOSS_MIN = 0.01;
export const FATIGUE_SPEED_LOSS_MAX = 0.03;

/** Stamina cost of one second of football, at the reference workload of an
 *  ordinary midfielder. Calibrated so a normal shift leaves a player around
 *  0.6-0.8 at full time and only genuinely relentless running empties him.
 *  Calibrated against the workload the engine's players ACTUALLY produce
 *  (measured, not assumed), which is higher than a real footballer's because
 *  they never stop to walk:
 *  before this was measured, EVERY player finished EVERY match on zero, which
 *  made the stamina attribute do nothing at all and applied the full late-game
 *  speed penalty to all twenty-two from the half-hour mark. */
export const STAMINA_DRAIN_PER_SECOND = 0.000055;

/* --- Off-ball shape ------------------------------------------------------ */

/** How far a wide player pushes towards his own touchline when his side has
 *  the ball. A possession side STRETCHES the pitch; before this the whole
 *  team shifted towards the ball together, which narrowed the side in
 *  possession — the exact opposite of what it should do, and the reason the
 *  engine's attacks all funnelled through the middle. */
export const WIDTH_HOLD = 7.5;
/** An anchor further than this from the centre line, in metres, belongs to a
 *  wide role. Derived from the formation, so it needs no per-slot flag. */
export const WIDE_ROLE_OFFSET = 12;

/** A full-back overlaps when his side has the ball ahead of him on his flank.
 *  How far beyond the ball he will run, and how often he decides to. */
export const OVERLAP_AHEAD = 9;
export const OVERLAP_CHANCE = 0.30;

/** How far a supporting player will step off his anchor to open a passing
 *  lane that an opponent is standing in. */
export const LANE_ADJUST = 4.5;

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

/* --- Aerial duels and crossing (M5) -------------------------------------- */

/** Horizontal radius within which a player can contest a ball in the air. */
export const AERIAL_RANGE = 3.2;
/** Head height standing, and what a jumpReach of 20 adds to it. */
export const AERIAL_REACH_BASE = 1.7;
export const AERIAL_REACH_JUMP = 0.7;
/** Below the first, it is a ball for the feet; above the second, nobody in
 *  football is reaching it. */
export const AERIAL_BAND_LOW = 0.9;
export const AERIAL_BAND_HIGH = 2.6;
/** Ticks before a ball in the air may be contested again. This is not a
 *  cosmetic guard: at ten ticks the engine produced eight hundred and seventy
 *  aerial duels a match, because every header sent the ball back into the band
 *  it had just been headed out of. A real match has forty to sixty. */
export const AERIAL_LOCK_TICKS = 110;

/** Loft on a cross: high enough to clear a defender, flat enough to be
 *  attacked rather than caught. */
export const CROSS_LOFT = 0.55;
/** Metres of scatter on a cross at zero delivery quality. */
export const CROSS_TARGET_SPREAD = 5.0;

/** How much better a keeper deals with a ball played by his own side than
 *  with a stray from the opposition: he is set for it and it is coming at him
 *  from in front. Multiplies the beat chance. */
export const OWN_GOAL_SAVE_BONUS = 0.08;

/* --- Officials ----------------------------------------------------------- */

/** How often the assistant misses an offside that genuinely was one. Real
 *  officials are wrong on a small but real fraction of tight calls, and that
 *  residue is where a contentious goal comes from. Not a get-out for the
 *  players: awareness governs whether the pass is PLAYED, not whether the flag
 *  goes up. */
export const ASSISTANT_MISS = 0.06;

/** Spread on a blocked shot's rebound, either side of straight back at the
 *  shooter. Wide enough that a block is genuinely loose and dangerous, narrow
 *  enough that it does not carry on into the net's direction — a full circle
 *  sent a quarter of all blocks behind for a corner. */
export const BLOCK_SPREAD = 1.15;

/** Fouls away from the ball — the shirt pull on a man running in behind.
 *
 * Every foul in this engine came from a challenge on the carrier, inside 1.8
 * metres of him. Real football gives away a good share of its free kicks with
 * the ball nowhere near: a defender beaten for pace who grabs a handful of
 * shirt, a blocking run, a body checked at a corner. It is also the offence
 * the rest of this work created the conditions for — now that strikers make
 * genuine runs in behind against a line they can misread, there are runners to
 * foul.
 *
 * Per steering beat, per defender-runner pair in range, so it is small. Tuned
 * on the batch harness: 0.0007 put the foul count at 25.1 a match, the very
 * top of the real 18-26 band, and the extra free kicks inflated set-piece
 * chances behind it. This lands it mid-range. */
export const OFF_BALL_FOUL_BASE = 0.00038;
/** How close he has to be to get a hand on him. */
export const OFF_BALL_FOUL_RANGE = 1.7;
/** ...and how fast the runner has to be going, as a fraction of his top speed.
 *  You do not haul down a man who is jogging. */
export const OFF_BALL_RUNNER_SPEED = 0.72;

/* --- Fouls and cards (M5) ------------------------------------------------ */

/** How often a defender in range actually goes in for the ball, per steering
 *  beat, at parity. Most engagements do not win it and do not foul: they are
 *  simply a defender pressing a carrier. */
export const TACKLE_ENGAGE_BASE = 0.02;

/** Base probability that a tackle which did NOT win the ball was a foul.
 *  Scaled by how clean and how reckless the defender is. Calibrated against
 *  the real rate of about 22 fouls in a match. */
export const FOUL_BASE = 0.26;

/** Seconds the referee lets an advantage run before pulling it back. */
export const ADVANTAGE_SECONDS = 5;

/** Card thresholds. A booking is not a random draw off a foul: it is a foul
 *  that was cynical, late, or stopped something. */
export const YELLOW_BASE = 0.075;
/** Extra booking chance for stopping a side that was breaking away. */
export const YELLOW_PROMISING_ATTACK = 0.2;
/** A foul that denies a clear scoring chance is a sending off. */
export const RED_DOGSO = 0.06;
/** ...and a small chance any foul is violent enough on its own. */
export const RED_VIOLENT = 0.006;
/** A booked player pulls out of challenges he would otherwise make. */
export const BOOKED_CAUTION = 0.55;

/** Seconds added for each stoppage type, for the derived clock. */
export const STOPPAGE_PER_CARD = 25;
export const STOPPAGE_PER_INJURY = 45;

/* --- Home advantage ------------------------------------------------------ */

/* Home advantage is real and it is worth about a quarter of a goal, but it is
 * not one mechanic — it is a crowd, a familiar pitch, and a referee who gives
 * the marginal decision to the home side. So it is applied where those things
 * actually show up, scaled by the club's own homeAdvantage rating (0-10):
 *
 *   passes come off slightly more often
 *   shots are struck slightly better
 *   the marginal foul goes against the away side
 *
 * Each is small. Together, at a rating of 5, they move a season's worth of
 * results by roughly the right amount. */
export const HOME_EDGE_PASS = 0.01; // per rating point, added to completion
export const HOME_EDGE_SHOT = 0.03; // per rating point, added to shot skill
export const HOME_EDGE_FOUL = 0.045; // per rating point, off the foul chance

/* --- Attribute scale ----------------------------------------------------- */

/** FM attributes run 1..20; most mechanics want a 0..1 normal of them. */
export const ATTR_MIN = 1;
export const ATTR_MAX = 20;

/* --- BLOCKED SHOTS ---------------------------------------------------------
 *
 * A block used to be counted by sweeping a 1.3 m corridor from the shooter to
 * the middle of the goal and charging 0.15 per body found in it. Measured
 * against real football that model was wrong by a factor of five AND wrong in
 * its sign: 1% of shots inside eleven metres were blocked against a real 25%,
 * rising to 27% beyond twenty-two metres, because a fixed-width corridor gets
 * LONGER with range and so sweeps up more bodies the further out you shoot.
 * Reality is the other way round — the crowded place is the six-yard box.
 *
 * The replacement asks the only question that actually decides a block: how
 * much of the goal can the shooter still SEE? Each defender's body is
 * projected from the shooter's eye onto the goal line, the shadows are merged,
 * and the fraction of the seven-and-a-third metres that is hidden is the
 * chance the strike hits somebody. It needs no distance term, because the
 * geometry already has one: a defender a metre away blacks out the whole goal,
 * and the same defender twenty metres away hides a foot of it.
 */
/** Effective radius a defender presents to a struck ball. Larger than a body,
 *  because blocking is an act — a leg goes out, a man turns his back and
 *  spreads. */
export const BLOCK_BODY = 0.62;
/** Not every shot into a shadow is blocked: it can be lifted, slid under, or
 *  struck through a gap the geometry rounds away. */
export const BLOCK_COVER = 0.82;
/** Even a shooter with a wall in front of him sometimes finds a way through. */
export const BLOCK_MAX = 0.72;
/** A defender must be genuinely goal-side to block; level with the shooter he
 *  is beaten. */
export const BLOCK_MIN_AHEAD = 0.35;

/* --- THE DEFENSIVE LINE LEADS THE BALL -------------------------------------
 *
 * A line set from where the ball IS can never be in position, and the shot
 * probe proved it: at every shot sampled, all ten outfielders of the
 * defending side were sprinting at exactly vMax, with full stamina, and were
 * still ten to twenty-three metres short of the position their own brains had
 * chosen. They were not deciding badly — they were losing a footrace they
 * could not win, because a pass travels twenty metres in under a second and a
 * defender needs two and a half. The measured consequence: 0.89 opponents
 * goal-side of the shooter and 1.74 in the box, against a real six to eight,
 * so 73% of shots were struck with literally nobody in front of the ball.
 *
 * Anticipation is the only thing that closes a gap like that, and it is what
 * defenders actually do — you drop as the ball is played, not once it has
 * arrived.
 */
/** Seconds of ball travel the line reads ahead of itself. */
export const LINE_LOOKAHEAD = 0.85;
/** ...and the most it will concede to one ball, so a goal kick does not put
 *  the whole back four on its own six-yard line. */
export const LINE_LEAD_MAX = 15;

/** What a shot struck into a defender is worth relative to a clear sight of
 *  goal. Not zero — a block spills, deflects, or wins a corner — but small
 *  enough that a player with a body in front of him looks for another way. */
export const BLOCKED_SHOT_WORTH = 0.22;

/** How close to its own goal the back line will sit. Defenders stand ON the
 *  line for a shot from six yards; the old 5.5 m floor meant a striker eight
 *  metres out was level with the centre-halves rather than behind them, and
 *  4.3% of shots from inside eleven metres were blocked against a real 25%. */
export const LINE_FLOOR = 3;
/** The tightest a block ever gets, front edge to back. A side defending its
 *  own six-yard box is not thirty metres deep. */
export const BLOCK_MIN_DEPTH = 6;

/* --- A REHEARSED CHANCE ----------------------------------------------------
 *
 * How hard a side plays the pattern the director called. These bias the
 * option scorer; they do not bypass it, which matters — a pass into the
 * nominated man is still weighed against whether it arrives, and a defender
 * who reads it still intercepts it. What they buy is INTENT, and the
 * measurement is blunt about how much that was worth: with no intent at all,
 * the nominated player struck the ball in one staged passage out of
 * twenty-five, and 96% of the reel fell back to a standing start.
 */
/** How much more a pass to the man the move is for is worth. */
export const DECREE_PASS_BIAS = 3.4;
/** ...and how much more his shot is worth once he is in the position. */
export const DECREE_SHOOT_BIAS = 7;
/** ...and driving at it when he has the ball but is not there yet. */
export const DECREE_CARRY_BIAS = 2.6;
/** How near the intended position counts as being in it, in metres. */
export const DECREE_SPOT_RADIUS = 8;

/* --- STRIKING IT FIRST TIME ------------------------------------------------
 *
 * How long a player takes to settle a ball, and what a shot is worth before he
 * has. The old rule was a hard gate — nothing at all for the first quarter
 * second — and since a reception zeroes the possession clock and the next
 * brain beat lands an eighth of a second later, it meant no player in this
 * engine had ever shot first time. A striker receiving a cutback six metres
 * out laid it off. Measured on staged chances: he received it in 79% of
 * passages and struck it in 2%.
 */
export const SETTLE_SECONDS = 0.25;
/** What a first-time strike is worth against a settled one, for a player of
 *  no particular technique. Scaled up by First Touch, Technique and Composure,
 *  which is where the difference between a poacher and a defender shows. */
export const FIRST_TIME_FLOOR = 0.42;
