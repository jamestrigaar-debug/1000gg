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
   * high number; a 170cm one reads as a low one. */
  function attrValue(player, key) {
    if (key === "height") return clamp((player.attrs.height - 165) * (99 / 35), 5, 99);
    if (key === "weight") return clamp((player.attrs.weight - 60) * (99 / 40), 5, 99);
    if (key === "mentalityRating") return player.mentalityRating || 55;
    return player.attrs[key] != null ? player.attrs[key] : 55;
  }

  /* How much of a player's effective rating comes from role fit rather than his
   * headline number. At 0.45 a specialist reads about six points better in his
   * best role than in a role he does not suit, which is enough to make squad
   * building a real decision without overturning the database's own judgement. */
  const ROLE_INFLUENCE = 0.45;

  /** A player's ability IN A GIVEN ROLE, on the same 0-99 scale as `overall`. */
  function roleRating(player, slot) {
    const weights = ROLE_WEIGHTS[slot];
    if (!weights) return player.overall;
    let weighted = 0, weightSum = 0, plain = 0, n = 0;
    for (const [key, w] of Object.entries(weights)) {
      const v = attrValue(player, key);
      weighted += v * w; weightSum += w;
      plain += v; n++;
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
   * Six axes, top and then clockwise: Aerial, Mental, Finishing, Pace,
   * Physical, Defense (Goalkeeping for a keeper) — chosen so that three
   * players who all rate 78 look like three different footballers.
   *
   * The old set — pace, physical, aerial, stamina, technique, mentality — read
   * the raw attributes almost directly, and the two that separate a technical
   * forward from a centre-half (technique and aerial) were single numbers with
   * everything else shared. A poacher, a playmaker and a stopper all came out
   * as roughly the same hexagon.
   *
   * These axes are COMPOSITES, each built from the attributes that actually
   * make up that quality, and each stretched around the population's midpoint
   * so real differences are visible rather than crowded into the top third:
   *
   *   AERIAL      heading with height and strength behind it
   *   MENTAL      the mentality rating on its own axis — the one place
   *               temperament gets to stand for itself rather than only
   *               sharpening finishing
   *   FINISHING   the better foot, sharpened by mentality — the quality that
   *               separates a goalscorer from a good footballer
   *   PACE        speed, with stamina deciding how often he can use it
   *   PHYSICAL    strength and build
   *   DEFENSE     DEF-ATR (GK-ATR for a keeper) — see defenceAttribute below
   */
  function stretch(v) {
    // Pull the population's actual band out across the whole dial, so a
    // difference of a few points reads as a visibly different shape rather
    // than two nearly-identical hexagons — the same reason 1000goals stretches
    // its own card radars rather than plotting raw attributes.
    return clamp(Math.round((v - 34) * 1.7), 2, 99);
  }
  function radarAxes(player) {
    const a = player.attrs || {};
    const men = player.mentalityRating || 55;
    const height = a.height || 180;
    return [
      { label: "Aerial", value: stretch((a.heading || 50) * 0.68 + (a.strength || 50) * 0.14 + clamp((height - 165) * 1.1, 0, 60) * 0.18) },
      { label: "Mental", value: stretch(men) },
      { label: "Finishing", value: stretch(finishingAttribute(player)) },
      { label: "Pace", value: stretch((a.speed || 50) * 0.82 + (a.fitness || 50) * 0.18) },
      // Strength and fitness — the database's own physical attributes — not
      // height, which already has its own job on the Aerial axis. Folding
      // height in here too made every tall player read as "physical" whatever
      // his actual strength or conditioning said.
      { label: "Physical", value: stretch((a.strength || 50) * 0.5 + (a.fitness || 50) * 0.5) },
      { label: player.pos === "GK" ? "Goalkeeping" : "Defense", value: stretch(defenceAttribute(player)) },
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

  /* -------------------------------- FINISHING -------------------------------
   * The mirror image of DEF-ATR, and the fix for a real problem: the database's
   * rightFoot/leftFoot ratings are a broad "how good is he with that foot"
   * number — passing, dribbling, tricks and shooting all folded into one — not
   * a shooting rating specifically. Reading that number straight for every
   * position produced technically excellent CENTRE-BACKS showing up with
   * finishing to rival a striker, because a ball-playing defender's foot
   * rating is genuinely high even though he is never actually asked to shoot.
   *
   * FINISHING_WEIGHT debuffs the foot component by how much of a position's
   * job is actually about getting shots away — heaviest for the back line,
   * lighter through midfield, none at all for a forward, the same shape as
   * DEF_ATR_WEIGHT but pointed the other way. Mentality (composure in front of
   * goal) is left unweighted — a defender who is calm under pressure is calm
   * under pressure whatever his position — only the technical foot rating is
   * discounted. */
  const FINISHING_WEIGHT = { GK: 0.15, CB: 0.30, FB: 0.45, DM: 0.50, CM: 0.65, AM: 0.85, WG: 0.85, FW: 1.0 };
  function finishingAttribute(player) {
    const a = player.attrs || {};
    const weight = FINISHING_WEIGHT[player.pos] != null ? FINISHING_WEIGHT[player.pos] : 0.8;
    const foot = Math.max(a.rightFoot || 50, a.leftFoot || 50);
    const men = player.mentalityRating || 55;
    return clamp(Math.round(foot * weight * 0.72 + men * 0.28), 1, 99);
  }

  MG.ratings = {
    ROLE_WEIGHTS, ROLE_INFLUENCE, attrValue, roleRating,
    hidden, resetHidden, rollSeasonForm, fatigueFactor,
    radarAxes, DEF_ATR_WEIGHT, heightScore, defenceAttribute,
    FINISHING_WEIGHT, finishingAttribute,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
