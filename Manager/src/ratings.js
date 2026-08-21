/* ============================================================================
 * FOOTBALL MANAGER — ROLE RATINGS AND HIDDEN ATTRIBUTES
 *
 * Adopted from the reference report on how FM-class engines turn attributes
 * into ability. Two ideas from it are worth having, and one is not.
 *
 * WORTH HAVING — position-specific attribute weighting (report formula 1).
 * Until now a player's contribution was his `overall` scaled by a position
 * weight, which meant two 74-rated wingers were interchangeable. Now each role
 * asks for the attributes it actually needs: a winger is read on pace, a
 * centre-half on heading and strength, a midfielder on both feet. The database
 * shipped in src/data.js carries those attributes for all 24,000 players and
 * was barely being used.
 *
 * WORTH HAVING — hidden attributes as long-term multipliers (report section 2).
 * Consistency, injury proneness and work rate are rolled per player, never
 * shown as numbers, and act across a season rather than per action.
 *
 * NOT ADOPTED — the report's core recommendation of an agent-based, four-
 * slices-per-second match engine. This game simulates roughly 5,000 matches
 * per season across ten divisions in about 160ms, because the whole design is
 * that the world keeps living while you make one decision a year. Per-slice
 * agent modelling is on the order of ten million operations per match; it is
 * the right architecture for a game where you watch one match, and the wrong
 * one for a game where you watch none.
 *
 * CALIBRATION NOTE
 * roleRating is deliberately ZERO-CENTRED against the player's own average. It
 * asks "is he better at THIS role's demands than at everything else?", not
 * "how good is he?". That keeps `overall` as the anchor the whole world is
 * calibrated on, and prevents the weighting from silently inflating or
 * deflating every rating in the game.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /* --------------------------- ROLE WEIGHTINGS -----------------------------
   * Keyed by the slot a player is being asked to fill. Only attributes the
   * shipped database actually carries appear here — there is no point weighting
   * "off the ball" when no player in the world has a value for it. */
  const ROLE_WEIGHTS = {
    GK: { mentalityRating: 1.3, height: 1.1, strength: 0.8, fitness: 0.5, speed: 0.3 },
    CB: { heading: 1.4, strength: 1.4, height: 1.0, mentalityRating: 0.8, speed: 0.7 },
    FB: { speed: 1.3, strength: 0.9, fitness: 1.0, heading: 0.7, rightFoot: 0.5 },
    DM: { fitness: 1.2, strength: 1.1, mentalityRating: 1.1, rightFoot: 0.9, heading: 0.7 },
    CM: { rightFoot: 1.3, fitness: 1.2, mentalityRating: 1.0, leftFoot: 0.7, speed: 0.6 },
    AM: { rightFoot: 1.3, speed: 1.0, mentalityRating: 1.0, leftFoot: 0.9, fitness: 0.7 },
    WG: { speed: 1.6, rightFoot: 1.0, fitness: 1.0, leftFoot: 0.8, strength: 0.4 },
    FW: { speed: 1.2, rightFoot: 1.1, mentalityRating: 1.1, heading: 1.0, strength: 1.0 },
  };

  /* Height and weight are on a different scale to the 0-99 attributes, so they
   * are mapped onto it before being weighted. A 195cm centre-half reads as a
   * high number; a 170cm one reads as a low one. Height used to be rescaled
   * TWICE, two different ways, in two different files: this steep 165-200cm
   * curve here for roleRating, and heightScore()'s much gentler 160-215cm
   * curve for defenceAttribute and the Aerial axis. The same 195cm forward
   * read as an 85 to one formula and a 63 to the other — exactly the kind of
   * "the numbers don't agree with each other" bug a player would (rightly)
   * read as broken maths. heightScore is the one everything else already
   * shares, so roleRating now reads off it too. */
  function attrValue(player, key) {
    if (key === "height") return heightScore(player.attrs.height);
    if (key === "weight") return clamp((player.attrs.weight - 60) * (99 / 40), 5, 99);
    if (key === "mentalityRating") return player.mentalityRating || 55;
    return player.attrs[key] != null ? player.attrs[key] : 55;
  }

  /* roleRating is the single hottest function in the engine — measured at 3.7
   * million calls across six simulated seasons, because picking a side walks
   * every player against every slot and the whole world picks a side several
   * times a summer. It used to call Object.entries(weights) on every one of
   * those calls, allocating a fresh array of pairs each time purely to iterate
   * a table that never changes. The pairs, their weight sum and their count are
   * all constant per slot, so they are computed once here instead. Same
   * arithmetic, same results — just not rebuilt three million times. */
  /* The same argument applies one level down, to attrValue. Every one of those
   * millions of calls re-ran the same three string comparisons ("is this key
   * height? weight? mentalityRating?") to work out which of four readings it
   * wanted — for a key that, like the weights themselves, is fixed the moment
   * the table is built. So the decision is made once, here, and each key gets
   * the one accessor it will ever need. attrValue stays exported behaviour for
   * anything that reads a single attribute by name; the hot loop no longer
   * goes through it. */
  const ATTR_GETTER = {
    height: (p) => heightScore(p.attrs.height),
    weight: (p) => clamp((p.attrs.weight - 60) * (99 / 40), 5, 99),
    mentalityRating: (p) => p.mentalityRating || 55,
  };
  function getterFor(key) {
    return ATTR_GETTER[key] || ((p) => (p.attrs[key] != null ? p.attrs[key] : 55));
  }

  const ROLE_WEIGHT_LIST = {};
  for (const [slot, weights] of Object.entries(ROLE_WEIGHTS)) {
    const keys = Object.keys(weights);
    ROLE_WEIGHT_LIST[slot] = {
      keys,
      gets: keys.map(getterFor),
      vals: keys.map((k) => weights[k]),
      weightSum: keys.reduce((t, k) => t + weights[k], 0),
      n: keys.length,
    };
  }

  /* How much of a player's effective rating comes from role fit rather than his
   * headline number. At 0.45 a specialist reads about six points better in his
   * best role than in a role he does not suit, which is enough to make squad
   * building a real decision without overturning the database's own judgement. */
  const ROLE_INFLUENCE = 0.45;

  /** A player's ability IN A GIVEN ROLE, on the same 0-99 scale as `overall`. */
  function roleRating(player, slot) {
    const table = ROLE_WEIGHT_LIST[slot];
    if (!table) return player.overall;
    const { gets, vals, weightSum, n } = table;
    let weighted = 0, plain = 0;
    for (let i = 0; i < n; i++) {
      const v = gets[i](player);
      weighted += v * vals[i];
      plain += v;
    }
    if (!weightSum || !n) return player.overall;
    // Zero-centred: how much better he is at this role's demands than at the
    // same attributes taken flat.
    const fit = (weighted / weightSum) - (plain / n);
    return clamp(player.overall + fit * ROLE_INFLUENCE, 15, 99);
  }

  /* A "what position is he REALLY?" helper was written here and then removed.
   * With only six attributes in the shipped database it cannot work: weight
   * familiarity properly and it returns the listed position for all 5,680
   * players in the world, which is no signal; drop familiarity and it decides
   * a technical playmaker is a full-back because his fitness outran his own
   * average. roleRating below is the part that does work — it says how good a
   * player is at a role he is actually being asked to play. Reinstate the
   * finder if the database ever grows real technical and mental attributes. */

  /* --------------------------- HIDDEN ATTRIBUTES ---------------------------
   * Rolled deterministically from the player's id, so they never need storing,
   * never drift, and are identical on every machine for a given world. They are
   * never displayed as numbers — the player finds out by watching.
   *
   *   consistency      0-1. How reliably he plays to his level.
   *   injuryProneness  0.6-1.6. Multiplier on his injury rolls.
   *   workRate         0-1. Drives fatigue, and how much a pressing system
   *                    costs him over a season.
   */
  /* Keyed by player id, which never repeats — NEXT_ID only ever climbs. That
   * makes this an UNBOUNDED leak on a long save: retired and released
   * players kept their entry forever, since nothing ever removed one. In a
   * page that is meant to stay open for a whole career rather than restart
   * between seasons, "never" is a real span — measured on a 30-season run,
   * ~800 new player ids a season left 22,800 entries in a cache serving a
   * ~5,000-player world, most of them for men no longer in it. pruneHidden
   * below is the fix: called once a season, it drops anyone not currently
   * standing in a squad or an academy anywhere in the world. */
  const HIDDEN_CACHE = {};
  function hidden(player) {
    if (HIDDEN_CACHE[player.id]) return HIDDEN_CACHE[player.id];
    // A small dedicated stream per player: stable, and independent of every
    // other draw in the simulation.
    const rng = MG.createRng(`hidden|${player.id}`);
    const h = {
      consistency: clamp(rng.next() * 0.75 + (player.mentalityRating || 55) / 400, 0.05, 0.98),
      injuryProneness: clamp(0.6 + rng.next() * 1.0, 0.6, 1.6),
      workRate: clamp(0.25 + rng.next() * 0.6 + ((player.attrs.fitness || 60) - 60) / 300, 0.1, 1),
    };
    HIDDEN_CACHE[player.id] = h;
    return h;
  }
  function resetHidden() { for (const k of Object.keys(HIDDEN_CACHE)) delete HIDDEN_CACHE[k]; }

  /** Drop every cache entry for a player id not currently live in `world` —
   *  not in any club's squad, not in any academy. Cheap (one pass building a
   *  Set, one pass filtering keys) against the alternative of holding every
   *  player who has ever existed in a save for as long as the tab stays open. */
  function pruneHidden(world) {
    const live = new Set();
    for (const c of world.clubs) {
      for (const p of c.squad) live.add(p.id);
      if (c.academy) for (const p of c.academy.players) live.add(p.id);
    }
    for (const k of Object.keys(HIDDEN_CACHE)) {
      if (!live.has(Number(k))) delete HIDDEN_CACHE[k];
    }
  }

  /* ------------------------- CONSISTENCY AND FORM --------------------------
   * Report formula 7, applied per season rather than per match because this
   * game's unit of time is a season. A very consistent player lands close to
   * 1.0 every year; an inconsistent one swings between a career year and a
   * write-off, which is exactly the player you cannot plan around. */
  function rollSeasonForm(rng, player) {
    const c = hidden(player).consistency;
    const spread = 0.30 * (1 - c);          // 0 for the metronome, 0.30 for the maverick
    return clamp(1 + (rng.next() * 2 - 1) * spread, 0.7, 1.3);
  }

  /* ------------------------------- FATIGUE ---------------------------------
   * Report formula 6 is a per-minute exponential decay. Compressed to a season:
   * a player who plays nearly every game, in a high-pressing side, with a heavy
   * work rate, arrives at the run-in tired. Fatigue is what makes squad depth
   * and rotation matter, and it is the cost the pressing systems pay.
   *
   * Returns a multiplier on his effective rating for the season, 0.88 to 1.0.
   */
  function fatigueFactor(player, pressIntensity) {
    const share = clamp(player.season.minutesShare || 0, 0, 1);
    const h = hidden(player);
    const stamina = clamp((player.attrs.fitness || 60) / 99, 0.2, 1);
    const press = pressIntensity == null ? 0.5 : clamp(pressIntensity, 0, 1);
    // Load rises with minutes, work rate and how hard the side presses; it is
    // absorbed by natural stamina.
    const load = share * (0.55 + h.workRate * 0.45) * (0.75 + press * 0.5);
    const drain = Math.max(0, load - stamina * 0.75);
    return clamp(1 - drain * 0.22, 0.86, 1);
  }

  /* ------------------------------ THE RADAR --------------------------------
   * SIX axes, top and then clockwise: Defending, Physical, Speed, Attacking,
   * Aerial, Mental — chosen so that three players who all rate 78 look like
   * three different footballers.
   *
   *   DEFENDING   DEF-ATR (GK-ATR for a keeper) — see defenceAttribute below
   *   PHYSICAL    strength and fitness, with balance & agility now folded in
   *               — not height, which has its own job on Aerial
   *   SPEED       raw speed, on its own, and never adjusted — see below
   *   ATTACKING   his STRONG foot, weak foot behind it, creativity behind that
   *   AERIAL      heading with height and strength behind it
   *   MENTAL      football intelligence, with creativity folded in
   *
   * Creativity and balance & agility are real attributes (players.js) but do
   * NOT carry a dial of their own — they were tried as two more axes and
   * pulled back out, because a radar's whole job is to make an elite-
   * everywhere player look like a hexagon and an elite-at-one-thing player
   * look like a spike, and a ninth or tenth corner just rounds every shape
   * back off. Folded into the axes that actually need them instead:
   *
   *   BALANCE feeds PHYSICAL. Agility and a low centre of gravity are a
   *   physical quality, not a separate one — folding it in is what lets a
   *   small, light, athletic player read well there without also needing to
   *   be strong, which is half of why the top of the game used to need
   *   "high everything" to reach a top badge.
   *
   *   CREATIVITY feeds ATTACKING and MENTAL. A quarter of the Attacking axis
   *   and just over a quarter of Mental, alongside the strong foot and the
   *   underlying mentality rating that still do most of the work on each.
   *   The other half of "high everything": a big, powerful, heavy-footed
   *   forward and a small, clever, two-footed one can now land on the same
   *   overall by two genuinely different routes through the same six axes.
   *
   * TWO EARLIER CHANGES, BOTH STILL IN FORCE.
   *
   * 1. ATTACKING WAS THE AVERAGE OF BOTH FEET, which reads a one-footed player
   *    as a worse footballer rather than a different one. Lautaro Martínez —
   *    right foot 91, left 65, the profile of an elite finisher — came out at
   *    78, below players he is plainly better than, and his 88 badge looked
   *    unearned as a result. A striker finishes with his good foot. Attacking
   *    is now his strong foot with the weak one behind it, and what the weak
   *    foot really tells you (creativity) has its own, smaller say instead.
   *
   * 2. THE AXES DID NOT ADD UP TO THE BADGE, and the error was worst at the
   *    top, which is where anyone looks. The raw attributes describe a
   *    winger's game almost completely and a goalkeeper's barely at all, so a
   *    90-rated keeper's profile read in the mid-seventies and a 90-rated
   *    winger's read at 88 — the same badge, two completely different-looking
   *    players, and the reason "they have 90 rating but are clearly not 90
   *    rated players".
   *
   *    Each position carries its own calibration, fitted across the 6,700
   *    players in the shared database so that the six axes AVERAGE to the
   *    overall the player actually holds. It is a presentation correction and
   *    nothing else — no rating the match engine reads is touched — but it is
   *    what makes a profile justify its badge, and it means the shape of the
   *    radar is pure information about the player rather than mostly
   *    information about what position he plays.
   */
  /* TWO STAGES, and they do different jobs.
   *
   * AXIS_CAL puts each axis on the same scale as a rating, by matching its
   * distribution across the whole population to the distribution of `overall`
   * — same mean, same spread. So an axis reading 90 means "as far above
   * average at this as a 90-rated player is at football", which is what anyone
   * reading it assumes. It is deliberately GLOBAL, not per position, because
   * the positional differences are real information: a forward genuinely
   * cannot defend and a centre half genuinely is not creative, and flattening
   * those out would leave every radar the same shape.
   *
   * Moment matching rather than regression, because regressing `overall` on an
   * axis flattens any axis that predicts it weakly — fitted that way mentality
   * came out with a slope of 0.6, which would have squashed every player's
   * Mental toward the middle of the dial and thrown away the one attribute
   * that genuinely varies independently of quality.
   *
   * POS_OFFSET is the small residual left over: the shift that makes the six
   * axes together average to the badge for each position. It comes out inside
   * ±2 everywhere, which is the useful confirmation that stage one was doing
   * the real work and this is only tidying up after it.
   *
   * Refitted when creativity and balance folded INTO att/phy/men rather than
   * carrying their own axes — the raw values feeding those three keys changed
   * shape, so the old constants no longer matched the population. */
  /* Refitted after the Aerial axis gained its balance counterweight and the
   * forward relevance changed — the raw distribution feeding `aer` moved, so
   * the constants that put it on the ratings scale had to move with it. */
  const AXIS_CAL = {
    def: [0.961,  17.3], phy: [1.212, -11.2], att: [0.955,  10.6],
    aer: [1.201,  -4.1], men: [1.354, -13.0],
  };
  const POS_OFFSET = {
    GK: -1.1, CB: -4.5, FB: -1.3, DM: 0.1, CM: 1.7, AM: 3.6, WG: 3.4, FW: 0.7,
  };

  /* A SOFT CEILING, because the calibration has slopes greater than one and a
   * hard clamp at 99 would spend them pinning the whole top of the game to the
   * same number. An early cut had Haaland on 99 Physical, 99 Attacking, 99
   * Mental and 98 Aerial — a perfectly calibrated average and a radar shaped
   * like a heptagon, which tells you nothing about him at all. The knee bends
   * everything above 86 into the last thirteen points asymptotically, so an
   * outstanding attribute still reads as outstanding, a freakish one still
   * beats it, and nothing ever quite touches the ceiling. */
  const AXIS_KNEE = 86, AXIS_CEIL = 99;
  function soften(v) {
    if (v <= AXIS_KNEE) return v;
    return AXIS_KNEE + (AXIS_CEIL - AXIS_KNEE) * (1 - Math.exp(-(v - AXIS_KNEE) / (AXIS_CEIL - AXIS_KNEE)));
  }
  /* AND A QUALITY TERM, which is the last piece and the one the whole exercise
   * was reported for. Even with every axis correctly scaled, a 94-rated
   * player's seven axes averaged 89 and an 88-rated player's averaged 83 —
   * because the attributes the database carries genuinely under-describe the
   * best players. What separates a very good footballer from a great one is
   * mostly the things no attribute list holds: the first touch under pressure,
   * the run he makes without the ball, the pass he sees a beat earlier. It is
   * real, it is why `overall` is not simply the mean of the columns, and left
   * uncorrected it is exactly the complaint that started this — "they have 90
   * rating but are clearly not 90 rated players".
   *
   * Zero below 70 and rising from there, so it touches only the band where the
   * shortfall actually exists. Presentation only: nothing the match engine
   * reads goes anywhere near this. */
  const ELITE_FROM = 70, ELITE_RATE = 0.26;
  function eliteLift(overall) {
    return Math.max(0, (overall || 60) - ELITE_FROM) * ELITE_RATE;
  }

  /* ---------------------- WHERE THE ELITE LIFT IS ALLOWED TO LAND ----------
   * The lift above used to be added to every axis equally, and that was the
   * single loudest piece of beta feedback: a 90-rated winger read 81 for
   * DEFENDING and an 89-rated one read 91, because being good at football
   * paid out identically on all six dials. Padding a great attacker's
   * defensive and aerial numbers is precisely what makes a profile look
   * invented — the reader knows Mohamed Salah is not an 81 defender, and one
   * number he can see is wrong poisons the five beside it that are right.
   *
   * So the lift is SHARED OUT rather than sprayed: each position declares how
   * much of its game genuinely runs through each axis, and the quality bonus
   * follows that shape. A winger's spends itself on speed, attacking and
   * mental; a centre half's on defending, aerial and physical.
   *
   * NORMALISED, so this redistributes rather than deletes. The shares are
   * scaled to average exactly 1 across the five calibrated axes, which means
   * the TOTAL lift a player receives is unchanged and the property the whole
   * calibration rests on — that a player's axes average to his badge — still
   * holds exactly. What changes is only WHERE it goes, which is the entire
   * complaint. Speed is not in the table because speed is never calibrated at
   * all (see radarAxes): it is a straight copy of the raw attribute, and that
   * stays true here. */
  /* The population's median balance, the point the Aerial counterweight above
   * pivots on. Kept here as a named constant rather than a bare number so the
   * two places that care — the axis and the refit harness — cannot drift. */
  const BAL_NEUTRAL = 62;

  /* ------------------- HOW AERIAL A POSITION'S GAME ACTUALLY IS ------------
   * The mirror of DEF_ATR_WEIGHT, and added for the same reason that one
   * exists: an axis built purely from attributes describes a BODY, not a role.
   * Heading, height and strength are all genuinely high for centre forwards in
   * the source data, so the axis had the average striker reading 71.4 in the
   * air against 64.9 for his attacking — aerial ability was the single best
   * thing about 54% of the world's strikers, which is not a game anyone
   * recognises. Balance (above) separates the target man from the nimble one
   * beautifully, but it cannot fix the LEVEL, because the calibration
   * moment-matches the axis onto the ratings scale and simply scales any
   * global change straight back out again.
   *
   * So the level is set per position, here. A centre half's game really is
   * played in the air and he keeps every point of it; a winger's is not. The
   * points a forward loses here do not vanish — POS_OFFSET is refitted
   * afterwards so his six axes still average to his badge, which pushes them
   * into his attacking, his pace and his football brain instead. That is the
   * redistribution the whole balance-and-creativity rework was for. */
  const AER_POS = { GK: -5, CB: 3, FB: -2, DM: -2, CM: -3, AM: -4, WG: -4, FW: -8 };
  const AXIS_RELEVANCE = {
    GK: { def: 1.00, phy: 0.55, att: 0.15, aer: 0.60, men: 0.95 },
    CB: { def: 1.00, phy: 0.90, att: 0.25, aer: 1.00, men: 0.80 },
    FB: { def: 0.85, phy: 0.75, att: 0.55, aer: 0.40, men: 0.65 },
    DM: { def: 0.95, phy: 0.85, att: 0.55, aer: 0.65, men: 0.95 },
    CM: { def: 0.65, phy: 0.75, att: 0.85, aer: 0.40, men: 1.00 },
    AM: { def: 0.30, phy: 0.55, att: 1.00, aer: 0.30, men: 1.00 },
    WG: { def: 0.25, phy: 0.50, att: 1.00, aer: 0.22, men: 0.85 },
    /* FW aerial was 0.85 — a 1.15 SHARE, meaning a forward received more of
     * his quality bonus in the air than the average axis got. That is true of
     * a target man and false of most strikers, and it is half of why the
     * position read the way the testers described. Cut to 0.55 (a 0.75 share)
     * with the difference going to attacking and mental, which is where
     * creativity feeds — so an elite forward's bonus now lands on his
     * finishing and his football brain, and his aerial ability has to come
     * from actually being good in the air. */
    FW: { def: 0.20, phy: 0.75, att: 1.05, aer: 0.55, men: 0.90 },
  };
  const RELEVANCE_KEYS = ["def", "phy", "att", "aer", "men"];
  const DEFAULT_RELEVANCE = { def: 0.7, phy: 0.7, att: 0.7, aer: 0.7, men: 0.7 };
  /* Precomputed once: the normalising divisor per position, so the per-axis
   * shares average 1. Done at load rather than per call because radarAxes runs
   * for every player in a 5,000-player world every time a list is drawn. */
  const RELEVANCE_NORM = {};
  for (const pos of Object.keys(AXIS_RELEVANCE)) {
    const rel = AXIS_RELEVANCE[pos];
    RELEVANCE_NORM[pos] = RELEVANCE_KEYS.reduce((t, k) => t + rel[k], 0) / RELEVANCE_KEYS.length;
  }
  function eliteShare(pos, key) {
    const rel = AXIS_RELEVANCE[pos] || DEFAULT_RELEVANCE;
    const norm = RELEVANCE_NORM[pos] || 0.7;
    const r = rel[key];
    return r == null ? 1 : r / norm;
  }

  function calibrate(key, pos, v, overall) {
    const c = AXIS_CAL[key] || [1, 0];
    const lift = eliteLift(overall) * eliteShare(pos, key);
    const aer = key === "aer" ? (AER_POS[pos] || 0) : 0;
    return clamp(Math.round(soften(v * c[0] + c[1] + (POS_OFFSET[pos] || 0) + aer + lift)), 2, 99);
  }

  /* --------------------- THE RADAR'S OWN SCALE ----------------------------
   * Every axis used to be drawn on the same 38-to-99 ruler, and that is why
   * every good player filled the hexagon: the axes do not share a range. Real
   * Defending in this database runs from the teens to the mid-nineties;
   * Mental is squeezed into a band barely thirty points wide. Drawn on one
   * ruler, the wide axis does all the talking and the narrow ones sit at a
   * constant middling radius on every single player — six corners, two of
   * which ever move.
   *
   * So each axis gets its own ruler, fitted to what the database actually
   * contains: the bottom of the chart is the 3rd percentile of that axis
   * across every player in the world, the top is the 99th. An axis is then
   * showing where this player sits AMONG FOOTBALLERS on that quality, which
   * is the only question a radar was ever answering, and a player who is
   * genuinely elite at one thing gets a spike instead of a slightly longer
   * corner.
   *
   * Fitted once, from the world, at creation. Percentiles of the real
   * population rather than hand-set bounds, so it stays honest if the
   * database changes underneath it. */
  const AXIS_KEYS = ["def", "phy", "spd", "att", "aer", "men"];
  let RADAR_SCALE = null;

  function fitRadarScale(world) {
    const cols = AXIS_KEYS.map(() => []);
    for (const c of world.clubs) {
      for (const p of c.squad) {
        const axes = radarAxes(p);
        for (let i = 0; i < axes.length && i < cols.length; i++) cols[i].push(axes[i].value);
      }
    }
    const scale = {};
    AXIS_KEYS.forEach((k, i) => {
      const v = cols[i].sort((a, b) => a - b);
      if (v.length < 50) { scale[k] = [38, 99]; return; }
      const at = (q) => v[clamp(Math.floor(v.length * q), 0, v.length - 1)];
      const lo = at(0.03), hi = at(0.99);
      // Never let a degenerate axis collapse to a point.
      scale[k] = hi - lo >= 12 ? [lo, hi] : [lo, lo + 12];
    });
    RADAR_SCALE = scale;
    return scale;
  }

  /** [lo, hi] for the axis at index `i`, or a sane default before fitting. */
  function radarScale(i) {
    const k = AXIS_KEYS[i];
    if (RADAR_SCALE && RADAR_SCALE[k]) return RADAR_SCALE[k];
    return [38, 99];
  }

  function radarAxes(player) {
    const a = player.attrs || {};
    const men = player.mentalityRating || 55;
    const pos = player.pos;
    /* Aerial used to average heading and strength (both 0-99) against a
     * height term that was scaled 0-60 before being blended in — Erling
     * Haaland (heading 88, strength 94, 195cm) read as an Aerial ability in
     * the low 80s, well below his heading alone, because that undersized
     * height term dragged every blend down whenever height carried any real
     * weight. heightScore() (already used by DEF-ATR below) puts height on
     * the same 0-99 footing as everything else, so a genuinely elite header
     * of the ball now reads as one. */
    const heightPts = heightScore(a.height);
    const lf = a.leftFoot || 50, rf = a.rightFoot || 50;
    const strong = Math.max(lf, rf), weak = Math.min(lf, rf);
    const cre = a.creativity != null ? a.creativity : (weak * 0.6 + men * 0.4);
    const bal = a.balance != null ? a.balance : 55;
    /* SIX AXES, not seven. Creativity and balance are raw attributes now (see
     * players.js) but they do not get a dial of their own — they were pulled
     * back OUT of the radar and folded into the axes they actually describe,
     * because giving every new attribute its own axis is how a radar stops
     * meaning anything: the point of a shape with six corners is that a
     * player who is elite everywhere reads as a hexagon and a player who
     * is elite at ONE thing reads as a spike, and a ninth or tenth corner
     * just flattens every shape back toward round.
     *
     * Folding them in also does the real job they were built for. Balance
     * feeds Physical — agility and a low centre of gravity are physical
     * qualities as much as raw strength is, so a small, light, athletic
     * player no longer has to also be strong to read well there. Creativity
     * feeds Attacking (a quarter of it, alongside the strong foot that still
     * decides most of a finisher's rating) and Mental (just over a quarter,
     * alongside the underlying mentality rating). Between the two of them
     * this is what stops the top of the game reading as "high everything":
     * a big, powerful, but heavy-footed forward and a small, clever,
     * two-footed one can land on the same overall by two genuinely
     * different routes through the six axes, instead of the same one. */
    return [
      { label: pos === "GK" ? "Goalkeeping" : "Defending", value: calibrate("def", pos, defenceAttribute(player), player.overall) },
      { label: "Physical", value: calibrate("phy", pos, (a.strength || 50) * 0.40 + (a.fitness || 50) * 0.35 + bal * 0.25, player.overall) },
      /* SPEED IS NEVER ADJUSTED. Every other axis here is a blend, so the
       * number it shows corresponds to nothing the player can look up
       * elsewhere and a correction costs nothing. Speed is the exception: it
       * is a straight copy of one raw attribute that is ALSO printed in the
       * raw-attribute grid further down the same profile. Adjusted, the bar
       * would read 84 while the grid two inches below read SPD 82 — the same
       * word, the same player, two numbers. That is exactly the "second scale
       * for actual speed" this project has already removed once and the brief
       * asks never to reopen. One attribute, one number. */
      { label: "Speed", value: clamp(Math.round(a.speed || 50), 2, 99) },
      { label: "Attacking", value: calibrate("att", pos, strong * 0.60 + weak * 0.16 + cre * 0.24, player.overall) },
      /* AERIAL, WITH BALANCE PULLING THE OTHER WAY.
       *
       * This read heading, strength and height and nothing else, so nothing in
       * it could tell a target man from a nimble one — and the result was the
       * loudest thing in the tester feedback: the average FORWARD came out on
       * 71.4 aerial against 65.1 attacking, and aerial was the single best axis
       * for 54% of strikers. A striker whose best quality is his head, more
       * often than not, is not a striker anyone recognises.
       *
       * Balance is the counterweight the axis was missing, and it is the right
       * one because it is the same fact stated the other way round: balance is
       * built from being small, light and quick to turn, which is precisely
       * what a man does NOT want when the ball is in the air. Subtracting it
       * sharpens the contrast the two attributes exist to draw — an Erling
       * Haaland (imposing, low balance) climbs, a Lamine Yamal (light, high
       * balance) does not — instead of leaving every well-built forward
       * reading as a target man. Centred on the population's own balance so
       * this redistributes rather than deflates. */
      { label: "Aerial", value: calibrate("aer", pos,
        (a.heading || 50) * 0.66 + (a.strength || 50) * 0.10 + heightPts * 0.24 - (bal - BAL_NEUTRAL) * 0.26,
        player.overall) },
      { label: "Mental", value: calibrate("men", pos, men * 0.72 + cre * 0.28, player.overall) },
    ];
  }

  /* ------------------------------ DEF-ATR / GK-ATR -------------------------
   * A second read on a player, distinct from his role rating: how much of his
   * game is built on winning physical duels rather than on the ball — the
   * number that separates a ball-playing centre-half from a genuine stopper,
   * or a winger who tracks back from one who does not.
   *
   *   DEF_ATR_WEIGHT   how much a position's game is built on defending —
   *                    1.0 for a centre-half, 0.7 for a forward
   *   physical         the average of strength, height (rescaled onto the
   *                    same 0-99 scale as everything else), heading and
   *                    fitness — the four attributes that actually win a
   *                    header or a footrace back
   *
   * The requested formula (position-weighted overall PLUS the raw physical
   * average, capped at 99) saturates at the cap for almost any player above a
   * modest overall — its own worked example already hits the cap on a single
   * good centre-midfielder. A stat every good player is capped at is not a
   * stat that differentiates anyone, which is the entire point of having one.
   * This blends the two terms instead of summing them, which is what keeps it
   * spread across the same range `overall` already occupies rather than
   * pinned to the ceiling.
   *
   * Goalkeepers get the same shape rather than a genuinely different
   * calculation: the database bakes a keeper down to one overall number with
   * no separate reflexes or handling attribute to reweight, so GK_ATR reads
   * heading as commanding the box and leans on the same physical blend. */
  /* THE SPREAD HAD TO WIDEN. The old table ran 1.0 down to only 0.65, and
   * since `overall` enters at weight*0.6 that meant 39% of a FORWARD's rating
   * was counted as defensive ability before a single defensive attribute was
   * read — the second and larger half of the beta-feedback padding, and the
   * reason Pedri read 89 and Raphinha 91 at defending. A great forward being
   * automatically three-quarters as good a defender as a great centre half is
   * not a calibration nuance, it is the model saying something false.
   *
   * Now it runs 1.0 down to 0.22, so out-of-position defending is carried by
   * the player's actual physical attributes rather than by his badge. A
   * hard-working forward can still read respectably here — strength, heading
   * and fitness are his to earn — but he can no longer inherit it. */
  const DEF_ATR_WEIGHT = { GK: 1.0, CB: 1.0, FB: 0.86, DM: 0.80, CM: 0.58, AM: 0.34, WG: 0.26, FW: 0.22 };
  function heightScore(cm) { return clamp(Math.round(((cm || 180) - 160) * 1.8), 10, 99); }
  function defenceAttribute(player) {
    const a = player.attrs || {};
    const weight = DEF_ATR_WEIGHT[player.pos] != null ? DEF_ATR_WEIGHT[player.pos] : 0.8;
    const physical = ((a.strength || 50) + heightScore(a.height) + (a.heading || 50) + (a.fitness || 50)) / 4;
    return clamp(Math.round(player.overall * weight * 0.6 + physical * 0.4), 1, 99);
  }

  /* ------------------- "DO HIS AXES ADD UP TO HIS BADGE?" -------------------
   * The number the TOP RATED list prints beside a player, and a testing
   * instrument rather than a feature: it should read near zero for a
   * well-formed player and in double figures for one whose stat pool and
   * rating describe different footballers.
   *
   * WEIGHTED, because a flat mean of six axes quietly libelled goalkeepers.
   * Five of the six — physical, speed, attacking, aerial, mental — barely
   * describe a keeper at all, so the flat average of a genuinely elite one
   * came out ten to thirteen points under his badge and the list flagged
   * Donnarumma, Alisson and Courtois as broken players when nothing was wrong
   * with them. Weighting each axis by how much the position actually plays
   * through it (the same AXIS_RELEVANCE the elite lift uses) asks the question
   * the indicator was always meant to ask: does he add up as a player in HIS
   * position, rather than as an average of six dials.
   *
   * Speed gets a nominal relevance of its own here — it is never calibrated,
   * but it is on the radar and a winger's pace is a real part of whether he
   * adds up. */
  const SPEED_RELEVANCE = { GK: 0.20, CB: 0.45, FB: 0.95, DM: 0.45, CM: 0.55, AM: 0.70, WG: 1.00, FW: 0.75 };
  /* Recentred per position, and deliberately NOT by moving POS_OFFSET.
   *
   * Weighting the mean shifts where it sits — it leans on the axes a position
   * is good at, so it lands a couple of points above the badge. That could be
   * absorbed by refitting POS_OFFSET against the weighted mean instead of the
   * flat one, and it was tried: it works, and it costs two to five points off
   * every radar in the game, because the calibration would then be solving for
   * a diagnostic rather than for what the player sees. Deflating the radar —
   * the actual user-facing artefact — to make an internal instrument read
   * zero is the wrong way round.
   *
   * So the radar keeps its own calibration and the INDICATOR carries the
   * offset. These are the mean weighted gaps measured across two full worlds,
   * subtracted so a well-formed player of any position reads about zero and
   * the number means the same thing for a keeper as for a winger. */
  const INDICATOR_BASELINE = { GK: 3.2, CB: 2.5, FB: 1.2, DM: 0.6, CM: 0.8, AM: 2.4, WG: 3.3, FW: 2.2 };
  function axisMean(player) {
    const axes = radarAxes(player);
    const pos = player.pos;
    const rel = AXIS_RELEVANCE[pos] || DEFAULT_RELEVANCE;
    // radarAxes order: def, phy, spd, att, aer, men
    const weights = [
      rel.def, rel.phy, SPEED_RELEVANCE[pos] != null ? SPEED_RELEVANCE[pos] : 0.6,
      rel.att, rel.aer, rel.men,
    ];
    let vsum = 0, wsum = 0;
    for (let i = 0; i < axes.length; i++) { vsum += axes[i].value * weights[i]; wsum += weights[i]; }
    if (!wsum) return 0;
    return vsum / wsum - (INDICATOR_BASELINE[pos] || 0);
  }

  MG.ratings = {
    ROLE_WEIGHTS, ROLE_INFLUENCE, attrValue, roleRating,
    hidden, resetHidden, pruneHidden, rollSeasonForm, fatigueFactor,
    radarAxes, radarScale, fitRadarScale, AXIS_KEYS, axisMean, AXIS_RELEVANCE, AER_POS, DEF_ATR_WEIGHT, heightScore, defenceAttribute,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
