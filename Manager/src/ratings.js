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
  const AXIS_CAL = {
    def: [1.140,  -0.2], phy: [1.242, -12.6], att: [1.002,   8.4],
    aer: [1.171,  -2.2], men: [1.412, -15.8],
  };
  const POS_OFFSET = {
    GK: 0.7, CB: -1.6, FB: -1.1, DM: 1.2, CM: 0.5, AM: 1.9, WG: 1.5, FW: -1.4,
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
  function calibrate(key, pos, v, overall) {
    const c = AXIS_CAL[key] || [1, 0];
    return clamp(Math.round(soften(v * c[0] + c[1] + (POS_OFFSET[pos] || 0) + eliteLift(overall))), 2, 99);
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
      { label: "Aerial", value: calibrate("aer", pos, (a.heading || 50) * 0.7 + (a.strength || 50) * 0.1 + heightPts * 0.2, player.overall) },
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
  const DEF_ATR_WEIGHT = { GK: 1.0, CB: 1.0, FB: 1.0, DM: 0.9, CM: 0.9, AM: 0.75, WG: 0.7, FW: 0.65 };
  function heightScore(cm) { return clamp(Math.round(((cm || 180) - 160) * 1.8), 10, 99); }
  function defenceAttribute(player) {
    const a = player.attrs || {};
    const weight = DEF_ATR_WEIGHT[player.pos] != null ? DEF_ATR_WEIGHT[player.pos] : 0.8;
    const physical = ((a.strength || 50) + heightScore(a.height) + (a.heading || 50) + (a.fitness || 50)) / 4;
    return clamp(Math.round(player.overall * weight * 0.6 + physical * 0.4), 1, 99);
  }

  MG.ratings = {
    ROLE_WEIGHTS, ROLE_INFLUENCE, attrValue, roleRating,
    hidden, resetHidden, pruneHidden, rollSeasonForm, fatigueFactor,
    radarAxes, DEF_ATR_WEIGHT, heightScore, defenceAttribute,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
