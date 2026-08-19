/* ============================================================================
 * FOOTBALL MANAGER — PLAYER MODEL
 *
 * 1000goals models a club as four numbers (attack / midfield / defence /
 * manager) that drift on a random walk. For a management game that is the
 * wrong way round: the four numbers have to be a CONSEQUENCE of the squad, so
 * that signing a striker visibly moves the attack rating, selling your centre
 * halves visibly wrecks the defence, and a manager who develops youth slowly
 * out-grows a manager who does not.
 *
 * So this module owns:
 *   - the player record (attributes, age, contract, value, wage, potential)
 *   - squad construction, from the real 2025/26 database where it exists and
 *     procedurally everywhere else, calibrated to the club's tuned baseline
 *   - ageing, development and decline
 *   - unit ratings: how a list of players becomes attack/midfield/defence
 *
 * AGE: the shipped database has no age field (see src/data.js — every record
 * is name/pos/attributes/overall). Ages are inferred from the 666 historical
 * rosters: a player's first appearance in a Premier League squad list dates
 * their arrival, and most players arrive between 20 and 22. That is accurate
 * to within a few years for the ~75% of current players with history, and
 * falls back to an overall-weighted guess for the rest. When real ages are
 * added to the database, delete inferAge and read the field.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /* ------------------------------ POSITIONS -------------------------------
   * The eight position keys used by src/data.js. `line` groups them for squad
   * building; `unit` weights say how much a player of this position feeds each
   * of the three team ratings. A winger is most of an attack and a little bit
   * of a midfield; a defensive midfielder is the reverse. */
  const POSITIONS = {
    GK: { name: "Goalkeeper",          line: "GK",  need: 3, starters: 1, unit: { attack: 0.00, midfield: 0.00, defence: 0.00 } },
    CB: { name: "Centre-Back",         line: "DEF", need: 4, starters: 2, unit: { attack: 0.05, midfield: 0.10, defence: 1.00 } },
    FB: { name: "Full-Back",           line: "DEF", need: 4, starters: 2, unit: { attack: 0.25, midfield: 0.25, defence: 0.80 } },
    DM: { name: "Defensive Midfielder",line: "MID", need: 2, starters: 1, unit: { attack: 0.15, midfield: 0.90, defence: 0.55 } },
    CM: { name: "Central Midfielder",  line: "MID", need: 4, starters: 2, unit: { attack: 0.40, midfield: 1.00, defence: 0.30 } },
    AM: { name: "Attacking Midfielder",line: "MID", need: 2, starters: 1, unit: { attack: 0.75, midfield: 0.70, defence: 0.10 } },
    WG: { name: "Winger",              line: "ATT", need: 4, starters: 2, unit: { attack: 0.90, midfield: 0.35, defence: 0.10 } },
    FW: { name: "Forward",             line: "ATT", need: 3, starters: 2, unit: { attack: 1.00, midfield: 0.15, defence: 0.05 } },
  };
  const POSITION_KEYS = Object.keys(POSITIONS);
  /** Total of the `need` column — the size of a properly stocked squad. */
  const SQUAD_TARGET = POSITION_KEYS.reduce((n, k) => n + POSITIONS[k].need, 0); // 26

  /* Goalkeepers are rated on a different scale to outfielders in the source
   * data and contribute to results through a separate term in the match
   * engine, so they are kept out of the three unit ratings entirely. */

  /* --------------------------- AGE INFERENCE ------------------------------ */
  let FIRST_SEASON = null;
  /** name -> earliest season year that name appears in the historical rosters. */
  function firstSeasonIndex(GAME_DATA) {
    if (FIRST_SEASON) return FIRST_SEASON;
    FIRST_SEASON = {};
    const dbs = [GAME_DATA.PLAYER_DATABASE, GAME_DATA.PLAYER_DATABASE_2025, GAME_DATA.PLAYER_DATABASE_2026];
    for (const db of dbs) {
      if (!db) continue;
      for (const key of Object.keys(db)) {
        const m = /\((\d{4})\)/.exec(key);
        if (!m) continue;
        const year = Number(m[1]);
        for (const p of db[key]) {
          const prev = FIRST_SEASON[p.name];
          if (prev == null || year < prev) FIRST_SEASON[p.name] = year;
        }
      }
    }
    return FIRST_SEASON;
  }

  /* A player good enough to be in a first-team squad is usually in his
   * mid-twenties; the very best are older than the squad filler around them
   * because it takes years to get there. This is the fallback when a name has
   * no history to date it. */
  function guessAgeFromRating(rng, overall) {
    const prime = 23 + (overall - 60) * 0.18;       // 78-rated -> ~26, 90 -> ~28.4
    const age = Math.round(prime + rng.gauss() * 3.4);
    return clamp(age, 17, 38);
  }

  /* A real player imported from the database (fromDatabase/fromForeign)
   * starts with career.seasons at makePlayer's default of 0 — accurate for
   * a generated academy graduate, but wrong for a 36-year-old real signing,
   * who reads his FIRST in-game retirement roll as "hangs up his boots
   * after 1 season", real career entirely uncounted. A rough debut age of
   * 19 is close enough for the number to stop looking broken without
   * needing real career-history data the source never carried. */
  function estimateCareerSeasons(age) { return clamp(Math.round(age - 19), 0, 24); }

  function inferAge(rng, player, currentYear, firstSeason) {
    const first = firstSeason[player.name];
    const guess = guessAgeFromRating(rng, player.overall);
    if (first == null) return guess;
    // +20: the modal age at which a player first appears in a PL squad list.
    const dated = clamp((currentYear - first) + 20 + Math.round(rng.gauss() * 1.2), 17, 41);
    // A first appearance three or more years ago dates a player well. A first
    // appearance THIS season says nothing — he could be an 18-year-old debutant
    // or a 31-year-old signing from abroad — so lean on the rating instead.
    const trust = first <= currentYear - 3 ? 0.8 : 0.35;
    return Math.round(dated * trust + guess * (1 - trust));
  }

  /* ------------------------- POTENTIAL & GROWTH --------------------------- */
  /** Ceiling a player can still reach. Young players carry real spread here —
   *  that spread is the entire point of scouting and youth development. */
  function rollPotential(rng, overall, age) {
    if (age >= 29) return overall;                       // what you see is what you get
    const yearsLeft = clamp(27 - age, 0, 10);
    // A wonderkid curve: most players add a little, a few add a lot.
    const roll = rng.next();
    const ceiling = roll > 0.97 ? 18 : roll > 0.85 ? 11 : roll > 0.55 ? 6 : 3;
    const growth = Math.round(ceiling * (yearsLeft / 10) + rng.between(0, 3));
    return clamp(overall + growth, overall, 96);
  }

  /* The development curve. Returns the change in overall for one season.
   *   coaching  0-100, the club's training quality blended with the manager's
   *             development attribute
   *   minutes   0-1, share of available minutes played — a player who does not
   *             play does not improve, which is what makes squad selection and
   *             loans matter later */
  /* ------------------------- AGEING BY POSITION ---------------------------
   * A goalkeeper at 32 is in his prime; a winger at 32 is finished. The curve
   * used to be one shape for everybody — grow to 23, improve to 27, plateau to
   * 30, decline — which made every squad age at the same rate and quietly
   * removed one of the real judgements in football: when to sell.
   *
   *   grow      the age up to which a player still has real upward movement
   *   peakEnd   the last year before decline starts
   *   decline   how steeply he falls once it does
   *
   * Wingers and attacking midfielders live on speed, so they rise early and go
   * early. Keepers and centre-halves live on reading the game and rise late. */
  const AGE_CURVE = {
    GK: { grow: 27, peakEnd: 34, decline: 0.30 },
    CB: { grow: 25, peakEnd: 32, decline: 0.38 },
    FB: { grow: 24, peakEnd: 29, decline: 0.48 },
    DM: { grow: 25, peakEnd: 31, decline: 0.40 },
    CM: { grow: 24, peakEnd: 30, decline: 0.44 },
    AM: { grow: 23, peakEnd: 28, decline: 0.52 },
    WG: { grow: 23, peakEnd: 28, decline: 0.58 },
    FW: { grow: 24, peakEnd: 30, decline: 0.50 },
  };
  const DEFAULT_CURVE = { grow: 24, peakEnd: 30, decline: 0.45 };
  function ageCurve(pos) { return AGE_CURVE[pos] || DEFAULT_CURVE; }

  function developmentDelta(rng, player, coaching, minutes) {
    const age = player.age;
    const headroom = player.potential - player.overall;
    const coach = (coaching - 50) / 50;                  // -1 .. +1
    const played = clamp(minutes, 0, 1);
    const curve = ageCurve(player.pos);

    // The steep early years: a teenager with headroom moves fast if he plays.
    if (age <= curve.grow - 1) {
      const base = headroom > 0 ? 1.6 + headroom * 0.14 : 0.2;
      const gain = base * (0.45 + played * 0.75) * (1 + coach * 0.45) + rng.gauss() * 0.8;
      return Math.max(-1, gain);
    }
    // Still improving, more slowly, into the start of the peak.
    if (age <= curve.grow + 3) {
      const base = headroom > 0 ? 0.7 + headroom * 0.08 : 0;
      return base * (0.5 + played * 0.6) * (1 + coach * 0.3) + rng.gauss() * 0.7;
    }
    // The plateau: drifting either way, holding his level.
    if (age <= curve.peakEnd) return rng.gauss() * 0.7 - 0.15 + coach * 0.25;
    // Decline, steepening with age and softened a little by good coaching and
    // by the player's own fitness attribute.
    const fitness = (player.attrs.fitness - 60) / 60;
    const steep = (age - curve.peakEnd) * curve.decline;
    return -(steep) * (1 - fitness * 0.25) * (1 - coach * 0.15) + rng.gauss() * 0.6;
  }

  /* --------------------- DEVELOPMENT MOVES EVERYTHING ----------------------
   * A player's overall and his attributes are the same fact stated two ways.
   * They were not being kept that way: developSquads added the full delta to
   * `overall` and then nudged three attributes by hand — speed by 30% of it,
   * fitness by 48%, strength by a FLAT 0.6 that ignored the delta entirely —
   * and never touched heading, left foot or right foot at all.
   *
   * Over one season that is invisible. Over a career it is the whole problem:
   * an academy graduate who grows twenty points of overall between 18 and 25
   * gains about six points of attributes, and arrives in his prime rated 89
   * with a stat pool that reads like a 55. Two regens measured in a live save
   * sat 28 and 34 points adrift. Every screen that reads attributes was
   * describing a different player from the one the badge claimed, and the
   * longer a save ran the worse it got.
   *
   * So development is expressed ONCE, here, and every attribute moves with the
   * overall. Two terms:
   *
   *   1. THE DELTA TERM. Each attribute has its own historical slope (see
   *      HOUSE), so a point of overall is worth 1.09 points of heading and
   *      0.39 of left foot — the real relationship, not a flat share. Age
   *      profile on top: improvement goes disproportionately into technique,
   *      because that is what coaching actually adds, while decline takes the
   *      legs first and leaves the technique alone. The weights sum to the
   *      attribute count in both directions, so the MEAN moves by exactly what
   *      the delta says it should and only the mix changes.
   *
   *   2. THE CONVERGENCE TERM. A small pull toward where the population says
   *      this attribute should sit for this overall. Without it, rounding to
   *      integers every season lets error accumulate in one direction over a
   *      twenty-season career. With it, drift cannot build up — and an
   *      already-broken player from an older save heals over three or four
   *      seasons instead of staying wrong forever.
   *
   * Relative shape is preserved throughout: a slow centre-half stays slow,
   * because both terms move him from where he already is rather than snapping
   * him onto an average. */
  /* Creativity gains readily and decays barely at all — it is the last thing
   * to leave a footballer, which is why thirty-four-year-old playmakers still
   * have a career after the legs have gone. Both tables MUST cover every key
   * in HOUSE: applyDevelopment reads w[k] straight, so a missing entry would
   * silently turn the attribute into NaN for every player in the world. */
  const GAIN_WEIGHTS    = { heading: 1.0, fitness: 0.9, strength: 1.0, leftFoot: 1.2, rightFoot: 1.2, speed: 0.7, creativity: 1.1 };
  const DECLINE_WEIGHTS = { heading: 0.9, fitness: 1.3, strength: 0.8, leftFoot: 0.5, rightFoot: 0.5, speed: 2.0, creativity: 0.35 };
  const CONVERGE = 0.30;   // share of any residual gap closed per season

  /* ---------------------------- BALANCE & AGILITY --------------------------
   * The eighth attribute, and the one that finally lets a squad have BODY
   * TYPES instead of every top-rated player converging on "big, strong, fast,
   * all at once" — which was the real complaint: the source data rewards size
   * and power on every axis at once, so a small technical player could not
   * reach an elite badge without also being physically imposing, and the
   * squad's whole top end read the same way.
   *
   * Nothing in the source measures this directly, so it is built the way the
   * real thing works. A light, compact frame turns and recovers faster than a
   * tall, heavy one, all else equal — SIZE COST, measured against the
   * population's own median build (181cm/76kg, from the 6,050 outfield
   * players in the shipped database), and it cuts both ways: shorter/lighter
   * than that median is a genuine gift, not just the absence of a penalty.
   *
   * Real athleticism buys a lot of the size cost back, but ONLY through a
   * square-root curve: going from an average athlete to a good one recovers
   * most of what size cost him; going from good to elite recovers
   * comparatively little more. A player elite in strength, fitness AND speed
   * still pays some of the size tax if he is genuinely big — the real-world
   * "immense, but never quite as nimble as the smallest man on the pitch"
   * outcome, which is exactly what a Virgil van Dijk-shaped defender or an
   * Erling Haaland-shaped forward should read as: very good here, not the
   * best in the world at it, however good everything else is.
   *
   * RECOMPUTED, not developed on its own curve. Height and weight never
   * change after creation, so balance is entirely a function of the three
   * attributes that DO develop (applyDevelopment calls this fresh every
   * season below) — storing a second, independently-drifting number for the
   * same relationship would only let it fall out of sync with the body it
   * describes. */
  const BAL_HEIGHT_NEUTRAL = 181, BAL_WEIGHT_NEUTRAL = 76;   // the population's own median build
  function deriveBalanceAgility(strength, fitness, speed, heightCm, weightKg) {
    const h = heightCm || 181, w = weightKg || 76;
    const heightCost = Math.max(0, h - BAL_HEIGHT_NEUTRAL) * 1.05;
    const weightCost = Math.max(0, w - BAL_WEIGHT_NEUTRAL) * 0.85;
    const heightGift = Math.max(0, BAL_HEIGHT_NEUTRAL - h) * 0.80;
    const weightGift = Math.max(0, BAL_WEIGHT_NEUTRAL - w) * 0.62;
    const sizeCost = heightCost + weightCost;

    const athletic = clamp((strength || 50) * 0.28 + (fitness || 50) * 0.32 + (speed || 50) * 0.40, 0, 99);
    // Diminishing returns: the SHARE of the size cost recovered rises with the
    // square root of how far above a modest baseline (40) the player's
    // athleticism sits — an ordinary athlete claws back almost none of it, an
    // elite one claws back most of it, and the curve bends hard between the
    // two rather than paying out in a straight line.
    const recoveryShare = Math.sqrt(clamp((athletic - 40) / 58, 0, 1));
    const recovered = sizeCost * recoveryShare * 0.88;

    const bal = 58 + heightGift + weightGift - sizeCost + recovered + (athletic - 60) * 0.12;
    return clamp(Math.round(bal), 15, 99);
  }

  /** Apply one season's change in overall to the player, attributes included. */
  function applyDevelopment(player, delta) {
    player.overall = clamp(Math.round((player.overall + delta) * 10) / 10, 25, 96);
    if (player.overall > player.potential) player.potential = player.overall;
    const w = delta >= 0 ? GAIN_WEIGHTS : DECLINE_WEIGHTS;
    for (const k of Object.keys(HOUSE)) {
      const now = player.attrs[k];
      if (now == null) continue;
      const slope = HOUSE[k][0];
      const residual = houseTarget(k, player.overall) - now;
      const move = slope * delta * w[k] + residual * CONVERGE;
      player.attrs[k] = clamp(Math.round(now + move), 20, 99);
    }
    // Balance tracks the body it describes, not its own curve — see above.
    if (player.attrs.balance != null) {
      player.attrs.balance = deriveBalanceAgility(
        player.attrs.strength, player.attrs.fitness, player.attrs.speed,
        player.attrs.height, player.attrs.weight);
    }
    return player;
  }

  /* ------------------------------ INJURIES --------------------------------
   * Rolled once per season, before a ball is kicked, as a share of the campaign
   * the player misses. A season-at-a-time game cannot model a hamstring in
   * October, but it can model "your first-choice centre half was fit for nine
   * games", which is the part a manager actually feels: the squad you planned
   * around is not the squad you get.
   *
   * Risk rises with age and falls with fitness, and `clubRisk` is the hook the
   * decision layer pulls on — a manager who ran a brutal pre-season or refused
   * to rotate carries a higher number into every roll. */
  function rollInjury(rng, player, clubRisk) {
    const age = player.age;
    const fitness = player.attrs.fitness || 60;
    let risk = 0.16 + Math.max(0, age - 28) * 0.022 + Math.max(0, 20 - age) * 0.01;
    risk *= 1 - (fitness - 60) / 240;
    risk *= clubRisk == null ? 1 : clubRisk;
    // Hidden injury proneness — some players simply break more often, and the
    // manager only ever finds out by watching. Carrying last season's workload
    // into this one is what makes flogging a small squad expensive.
    if (MG.ratings) {
      const h = MG.ratings.hidden(player);
      risk *= h.injuryProneness;
      const lastLoad = player.lastLoad || 0;
      risk *= 1 + lastLoad * 0.25;
    }
    risk = clamp(risk, 0.02, 0.75);
    if (!rng.chance(risk)) return 0;
    // Most knocks cost a few weeks; a small tail wrecks the year.
    const roll = rng.next();
    const share = roll > 0.94 ? rng.between(0.6, 1.0)
      : roll > 0.75 ? rng.between(0.3, 0.6)
        : rng.between(0.05, 0.3);
    return Math.round(share * 100) / 100;
  }

  /** 0-1: how much of the season this player is actually available for. */
  function availability(player) {
    return clamp(1 - (player.season.injured || 0), 0, 1);
  }

  /* ------------------------------ DURABILITY -------------------------------
   * A visible fitness read, built only from what a manager could actually
   * know — the fitness attribute and age — never the hidden injury-proneness
   * roll that decides the real outcome. This is deliberately not a squad-
   * selection mechanic: the game simulates a whole season in one pass rather
   * than match by match, so there is no matchday squad to drop a tired player
   * from. What it gives instead is the same information in the form a manager
   * actually uses it — "how many games in a row can I lean on him" — as a
   * single number and a short, honest projection.
   *
   * A player 30 or over loses durability 15% faster per year past 29, which is
   * the age penalty asked for, applied to the SCORE rather than invented as a
   * separate day-count the game has no way to honour. */
  function durability(player) {
    const fit = player.attrs.fitness || 60;
    const ageOver = Math.max(0, player.age - 29);
    const agePenalty = 1 - Math.min(0.6, ageOver * 0.15);
    const score = clamp(Math.round(((fit - 35) / 60) * 100 * agePenalty), 5, 99);
    // "Games survived" out of a five-match run at full intensity before he
    // would be expected to drop below three-quarters effectiveness.
    const gamesSurvived = clamp(Math.round(score / 20), 0, 5);
    return { score, gamesSurvived };
  }

  /* --------------------------- VALUE & WAGES ------------------------------ */
  /* Keyed by league ID — the value clubs.leagueId actually holds. It was
   * originally keyed by the four Premier League prestige bands from
   * src/data.js (Elite/Europe/Mid/Lower), which no club object ever carries,
   * so every wage in the world fell through to the default and Manchester City
   * ran a £9m wage bill on £570m of revenue.
   *
   * The first-tier factors were cut ~17% (PL 3.0 → 2.5, and the four other top
   * divisions with it) because a full squad priced at the going rate for every
   * player came out at about 76% of its club's revenue, against a real figure
   * of 55-65%. These are WEEKLY wages and they are weekly-scaled: Haaland
   * lands on £524k a week against a real £525k, Salah on £403k against £350k.
   * The English lower divisions were already close and are untouched — their
   * half of the problem was revenue, not wages (see clubs.js). */
  const LEAGUE_WAGE_FACTOR = {
    PL: 2.5,
    LaLiga: 1.7, SerieA: 1.45, Bundesliga: 1.5,
    Saudi: 1.4, MLS: 0.6,
    Championship: 1.6, League1: 0.8, League2: 0.5, NationalLeague: 0.35,
  };

  /* Where the wage curve stops being exponential, and how steeply it climbs
   * after it. See expectedWage. */
  const WAGE_KNEE = 84;
  const WAGE_KNEE_SLOPE = 0.55;

  function ageValueFactor(age) {
    if (age <= 20) return 1.30;
    if (age <= 25) return 1.35;
    if (age <= 28) return 1.10;
    if (age <= 30) return 0.80;
    if (age <= 32) return 0.50;
    if (age <= 34) return 0.26;
    return 0.10;
  }

  /** Transfer value in £m. */
  function marketValue(player) {
    const q = Math.max(0.2, (player.overall - 40) / 10);
    let v = Math.pow(q, 3.2) * 0.7 * ageValueFactor(player.age);
    // A 19-year-old who might become world class costs more than he is worth.
    const headroom = player.potential - player.overall;
    if (player.age <= 23 && headroom >= 6) v *= 1 + Math.min(headroom, 18) * 0.06;
    // Contract running down: leverage moves to the player.
    if (player.contract.years <= 1) v *= 0.55;
    else if (player.contract.years === 2) v *= 0.85;
    // A proven international carries a premium in the market.
    if (MG.international) v *= MG.international.valuePremium(player);
    return Math.max(0.05, Math.round(v * 100) / 100);
  }

  /** Weekly wage in £k. */
  function expectedWage(player, league) {
    const factor = LEAGUE_WAGE_FACTOR[league] != null ? LEAGUE_WAGE_FACTOR[league] : 0.5;
    /* Calibrated so a 90-rated player in the Premier League earns around
     * £350k a week and a 60-rated one around £12k — the curve has to be steep,
     * because the gap between a very good player and a great one is most of
     * what a wage budget is spent on. A shallower curve had entire Premier
     * League squads costing £30m a year against £550m of revenue, which made
     * the board's financial metric impossible to fail. */
    /* THE CURVE HAS TO BEND AT THE TOP, because an exponential does not stop
     * and a wage bill does. Left running it had drifted a long way from the
     * calibration described above: a 90-rated player was asking £674k a week
     * against the £350k this comment specifies, and a 96-rated one £1.4m —
     * roughly three times the largest wage in the real game.
     *
     * Two things broke because of it. A club could not re-sign its own best
     * player, because his number exceeded the share of the wage budget any
     * board will commit to one man: Haaland walked out of Manchester City and
     * Alisson out of Liverpool on free transfers, neither club having
     * declined. And once the renewal logic was fixed so that clubs DID keep
     * them, the elite ran straight into insolvency instead — City carrying
     * £521m of wages against £535m of revenue, a ratio of 97% against a real
     * one nearer 58%.
     *
     * The knee restores the documented calibration exactly (90 → £350k, 96 →
     * £528k) and leaves everything below 78 — the great majority of the
     * population, and all of the lower divisions the board's finance metric
     * was tuned against — completely untouched. */
    const eff = player.overall <= WAGE_KNEE
      ? player.overall
      : WAGE_KNEE + (player.overall - WAGE_KNEE) * WAGE_KNEE_SLOPE;
    const base = 1.9 * Math.exp((eff - 50) / 8.4);
    const ageAdj = player.age <= 21 ? 0.55 : player.age <= 24 ? 0.85 : player.age >= 33 ? 0.9 : 1;
    // The floor is a part-time National League wage, not a professional one —
    // at 0.5 it was higher than the entire division could afford.
    return Math.max(0.12, Math.round(base * factor * ageAdj * 10) / 10);
  }

  /* --------------------------- PLAYER RECORDS ----------------------------- */
  let NEXT_ID = 1;
  function resetIds() { NEXT_ID = 1; }
  /** Fast-forward the counter — used when a save is loaded, so the next
   *  signing, academy graduate or regen never collides with an id already
   *  alive in the world it is loading into. */
  function setNextId(n) { if (n > NEXT_ID) NEXT_ID = n; }

  function makePlayer(fields) {
    const p = Object.assign({
      id: NEXT_ID++,
      name: "Unnamed",
      nationality: "England",
      pos: "CM",
      age: 24,
      overall: 60,
      potential: 60,
      attrs: { heading: 60, fitness: 60, strength: 60, leftFoot: 60, rightFoot: 60, speed: 60, creativity: 60, balance: 60, height: 180, weight: 76 },
      mentality: "Balanced",
      mentalityRating: 55,
      clubId: null,
      contract: { years: 3, wage: 5 },
      homegrown: false,
      form: 0,
      // Career totals, so a fifteen-season save can show you who the world's
      // record scorer became.
      career: { apps: 0, goals: 0, assists: 0, seasons: 0, clubs: [] },
      season: { apps: 0, goals: 0, assists: 0, minutesShare: 0, injured: 0 },
      retired: false,
    }, fields);
    p.value = marketValue(p);
    return p;
  }

  /* A player's move is recorded twice: `career.clubs` (a flat name list, the
   * original field — kept so nothing that already reads it breaks) and
   * `career.history` (club, season, age), which is what a profile actually
   * needs to show a career as a timeline rather than a bag of names. Season
   * is best-effort — a few sites (initial squad generation, an academy
   * promotion reached through a code path with no world in scope) cannot
   * always supply one, and the profile just leaves the year blank there
   * rather than guessing. */
  function recordMove(player, clubName, season, opts) {
    player.career.clubs.push(clubName);
    if (!player.career.history) player.career.history = [];
    player.career.history.push({ club: clubName, season: season != null ? season : null, age: player.age });
    /* The one flag every arrival passes through, whatever brought him in —
     * see sellOne's guard in transfers.js for what it is for: stopping the
     * board's own automated "who do we cash in on" picks from landing on a
     * man who was signed earlier in this exact same summer.
     *
     * Building the world is NOT an arrival, and saying it was broke exactly
     * that guard in season one: every player in every starting squad was
     * stamped as having just arrived, so sellOne could never find anybody to
     * sell and all three "cash in on him" decision cards silently did
     * nothing for the whole first season. World creation passes initial. */
    if (season != null && !(opts && opts.initial)) player._arrivedSeason = season;
  }

  /** Convert a record from src/data.js into a live player. */
  function fromDatabase(rng, raw, currentYear, firstSeason, league) {
    const age = inferAge(rng, raw, currentYear, firstSeason);
    const p = makePlayer({
      name: raw.name,
      /* A real player's actual nationality when we have it; the league-weighted
       * roll only as a fallback. See MG.names.PLAYER_NATIONALITY. */
      nationality: MG.names.knownNationality(raw.name) || MG.names.nationForLeague(rng, league),
      pos: POSITIONS[raw.pos] ? raw.pos : "CM",
      age,
      overall: raw.overall,
      attrs: {
        heading: raw.heading, fitness: raw.fitness, strength: raw.strength,
        leftFoot: raw.leftFoot, rightFoot: raw.rightFoot, speed: raw.speed,
        creativity: deriveCreativity(raw.pos, raw.overall, raw.leftFoot, raw.rightFoot,
          footballIntelligence(raw.mentalityRating, raw.overall)),
        balance: deriveBalanceAgility(raw.strength, raw.fitness, raw.speed, raw.height, raw.weight),
        height: raw.height, weight: raw.weight,
      },
      mentality: raw.mentality,
      mentalityRating: footballIntelligence(raw.mentalityRating, raw.overall),
      contract: { years: rng.int(1, 5), wage: 0 },
    });
    p.career.seasons = estimateCareerSeasons(p.age);
    p.potential = rollPotential(rng, p.overall, p.age);
    p.contract.wage = expectedWage(p, league);
    p.value = marketValue(p);
    return p;
  }

  /* --------------------------- FOREIGN DATABASE ----------------------------
   * src/data.js only carries real attribute detail for the Premier League.
   * The other five real-data leagues (see src/data_foreign.js) come from a
   * squad report on the EA-FC-26 scale: OVR plus four composites — PAC, PHY
   * (physical/strength/stamina), ATT (finishing/dribbling/chance creation)
   * and DEF (tackling/defensive awareness, or work rate for attackers). None
   * of those four map 1:1 onto this game's eight attributes, so this is a
   * genuine conversion, not a field copy — "hardcode the framework, not the
   * outcome": one formula for every player in the source, not a hand-tuned
   * number per name.
   *
   * `overall` is taken from the report AS GIVEN — it is the one number
   * already calibrated against real players (Mbappé 91, Haaland 96, etc.)
   * and roleRating (ratings.js) is zero-centred against it, so overall has to
   * stay the anchor. Attributes only decide which roles a player is zero-
   * centred BETTER or WORSE than his own average at.
   *
   * `speed` is set directly from PAC with no further transform — the same
   * number the profile's speed bar reads — so there is no second scale for
   * "actual speed" to disagree with, which is the exact bug already fixed
   * once this session (see rollInjury/roleRating history) and the brief
   * explicitly asks never to reopen. */
  const FOREIGN_POS = {
    GK: "GK", CB: "CB", LB: "FB", RB: "FB", CDM: "DM", CM: "CM", CAM: "AM",
    LM: "WG", RM: "WG", LW: "WG", RW: "WG", ST: "FW", CF: "FW",
  };
  function foreignPos(pos) { return FOREIGN_POS[pos] || "CM"; }

  /* ------------------- RECONCILING ATTRIBUTES WITH OVERALL ------------------
   * Four source stats cannot describe a footballer. PAC/PHY/ATT/DEF carry no
   * passing, no vision, no first touch, no composure — so a player whose
   * greatness lives in those things (Yamal, Kane, De Bruyne) came out of the
   * conversion below with a physical profile indistinguishable from a decent
   * Championship midfielder, while his `overall` still said 89. Measured across
   * the whole foreign set, the mapping produced
   *
   *     attrMean = 0.465 * ovr + 31.0
   *
   * against this game's own convention, fitted over the 6,050 outfield players
   * in src/data.js's historical database:
   *
   *     attrMean = 0.808 * ovr + 9.9
   *
   * Barely half the slope. At overall 50 the two agree; at overall 90 the
   * mapping undershoots by nearly ten points, which is why an 89-rated forward
   * displayed six attributes with nothing above 81 and a mean in the sixties.
   * Every screen that reads attributes — the profile bars, the radar, the role
   * fit — was describing a different player from the one the number claimed.
   *
   * The correction is a shift in overall-space: the gap between the two lines,
   * which is negative at the bottom of the pyramid and positive at the top, so
   * it steepens the relationship rather than just lifting everyone.
   *
   * SPEED IS DELIBERATELY EXEMPT. It is the one attribute taken verbatim from
   * the source (PAC), and the profile's speed bar is meant to read that exact
   * number — a second scale for "actual speed" is a bug this project has
   * already fixed once and the brief asks never to reopen. So the five DERIVED
   * attributes, the ones that are inference rather than data, carry the whole
   * correction between them. */
  /* Corrected PER ATTRIBUTE, not by one shared shift. A shared shift fixed the
   * average and left the shape wrong: PHY drives both fitness and strength in
   * the map below, so those two came out far too high (strength median 82
   * against a historical 64) while heading came out too low and right foot
   * pinned 17 players against the 99 ceiling. Getting the mean right is not
   * the same as getting the player right.
   *
   * So each derived attribute is moved onto its OWN historical line. Both sets
   * of constants are least-squares fits of `attribute = slope * overall +
   * intercept`, HOUSE over the 6,050 outfield players in src/data.js and MAP
   * over the 1,373 players this conversion produces before correction. The
   * correction is their difference, so the foreign population reproduces the
   * historical relationship attribute by attribute.
   *
   * Re-fit both sides if the conversion below is ever retuned — scratch fits
   * live in the same shape: group by name, drop keepers, regress on overall.
   * The check that matters is that a corrected foreign population lands within
   * a point of HOUSE at overall 60 and at overall 90. */
  const HOUSE = {
    heading:   [1.090, -14.5], fitness: [0.914,  8.1], strength: [0.901,  2.0],
    leftFoot:  [0.394,  31.9], rightFoot: [0.683, 23.1], speed: [0.864, 9.1],
    creativity: [0.900,  1.5],
  };

  /* ------------------------------ CREATIVITY -------------------------------
   * A seventh attribute, and the one the source data was crying out for.
   *
   * The shipped database has no vision, passing or flair field. What it does
   * have is BOTH FEET — and two good feet is the single most reliable public
   * signal that a footballer has options: he can go either way, receive on
   * either side, pick a pass he is not square to. The population's median weak
   * foot is 55 and its 99th percentile is 75, so a genuinely two-footed player
   * is rare enough to mean something.
   *
   * That was being read exactly backwards. The Attacking axis averaged the two
   * feet, so Lautaro Martínez — right foot 91, left 65, which is the profile of
   * an elite one-footed finisher — read as a 78 attacker, worse than players
   * he is plainly better than. Being one-footed made him look like a worse
   * striker instead of a different kind of striker.
   *
   * So the two feet now split into two different questions. His STRONG foot
   * decides how good a finisher he is (Attacking). The WEAK one, with his
   * football intelligence and his own level behind it, decides how creative he
   * is — a separate axis he can be low on without it costing him anywhere
   * else. Martínez comes out an elite finisher who is not a playmaker, which
   * is exactly what he is.
   *
   * Position matters because the roles genuinely differ: an attacking
   * midfielder is picked for this, a centre half is not. And a player's own
   * level counts, because seeing the pass is most of what separates a very
   * good player from a great one. */
  const CREATIVE_POS = { AM: 9, WG: 6, CM: 5, FW: 2, DM: 1, FB: 1, CB: -4, GK: -8 };
  function deriveCreativity(pos, overall, leftFoot, rightFoot, mentalityRating) {
    const weak = Math.min(leftFoot || 50, rightFoot || 50);
    return clamp(Math.round(
      38
      + clamp(weak - 52, -20, 40) * 0.75       // both feet: options
      + ((mentalityRating || 60) - 62) * 0.35  // football intelligence
      /* A light touch only. The DISPLAY already carries a quality term (see
       * ratings.eliteLift), and an earlier cut weighted this at 0.55 as well,
       * which double-counted: Virgil van Dijk — weak foot 60, a centre half —
       * came out reading 90 for creativity purely because he is very good at
       * football. What this attribute is for is telling two players of the
       * SAME quality apart, so the quality term has to be the small one. */
      + (overall - 62) * 0.30
      + (CREATIVE_POS[pos] || 0)
    ), 15, 99);
  }

  /* ---------------------- FOOTBALL INTELLIGENCE AT THE TOP -----------------
   * The database's own mentalityRating rises with quality exactly as it should
   * — it averages 62 through the bulk of the population and 82.8 across the
   * players rated 85 and above — but the individual records are noisy, and the
   * noise shows worst precisely where it matters. Federico Valverde at 89
   * carried a 69 and Lautaro Martínez at 88 a 68, so two world-class players
   * displayed a Mental score in the middle of the range while a journeyman
   * beside them displayed a better one.
   *
   * A floor rather than a rewrite: the rating is left alone below 78 and for
   * anyone already reading above the line, so the real spread the data carries
   * survives intact and only the implausible bottom of the elite band moves.
   * At 88 the floor is 73, at 94 it is 84 — under the band's own average
   * either way, so this is correcting an obvious wrong reading, not inventing
   * a new one. */
  function footballIntelligence(mentalityRating, overall) {
    const men = mentalityRating || 60;
    if (overall < 78) return men;
    return Math.max(men, Math.round(55 + (overall - 78) * 1.8));
  }
  /** What the population says an attribute looks like at a given overall. */
  function houseTarget(k, ovr) { const h = HOUSE[k]; return h ? h[0] * ovr + h[1] : ovr; }
  const MAP = {
    heading:   [0.325,  25.1], fitness: [0.388, 41.9], strength: [0.292, 53.0],
    leftFoot:  [0.642,   4.1], rightFoot: [0.843,  8.7],
  };

  function reconcileToOverall(attrs, ovr) {
    for (const k of Object.keys(MAP)) {          // MAP omits speed, deliberately
      const h = HOUSE[k], m = MAP[k];
      const correction = (h[0] * ovr + h[1]) - (m[0] * ovr + m[1]);
      attrs[k] = clamp(Math.round(attrs[k] + correction), 15, 99);
    }
    return attrs;
  }

  function mapForeignAttrs(rng, raw, pos) {
    const ovr = raw.ovr;
    const tall = pos === "CB" || pos === "GK" || pos === "FW";
    if (pos === "GK" || raw.pac == null) {
      // Keepers carry no PAC/PHY/ATT/DEF in the source (goalkeepers aren't
      // scored on them there either) — built from OVR alone, same shape
      // generate() already uses for a procedural keeper.
      return {
        heading: clamp(Math.round(ovr - 20), 20, 70),
        fitness: clamp(Math.round(ovr - 3), 30, 92),
        strength: clamp(Math.round(ovr - 5), 30, 92),
        leftFoot: clamp(Math.round(ovr - 25), 15, 70),
        rightFoot: clamp(Math.round(ovr - 15), 20, 82),
        speed: clamp(Math.round(ovr - 15), 25, 70),
        height: rng.int(185, 199),
        weight: rng.int(78, 92),
      };
    }
    const { pac, phy, att, def } = raw;
    /* Shape first, from the four source stats; then reconciled against the
     * overall so the level matches what that overall claims. The shape is a
     * pure translation of the five derived attributes, so a quick weak winger
     * stays a quick weak winger relative to himself — he just stops reading as
     * a Championship player with an elite badge on him. */
    return reconcileToOverall({
      // Aerial ability: physical composite plus defensive awareness, with a
      // position lean for the classically tall/aerial-heavy roles.
      heading: clamp(Math.round(phy * 0.35 + def * 0.35 + (tall ? 12 : -8)), 20, 99),
      // Fitness leans on PHY (which folds in stamina) with a touch of OVR so
      // a genuinely elite player never reads as unfit relative to his level.
      fitness: clamp(Math.round(phy * 0.78 + ovr * 0.15), 25, 99),
      strength: clamp(Math.round(phy * 0.82 + def * 0.18), 25, 99),
      // Footedness/technical ability: ATT is the closest real proxy the
      // source has (finishing/dribbling/chance creation). Right foot reads
      // ATT almost directly; the left is a plausible weaker-foot spread off
      // the same number rather than a second independent roll.
      rightFoot: clamp(Math.round(att * 0.85 + ovr * 0.15), 25, 99),
      leftFoot: clamp(Math.round(att * 0.6 + def * 0.15 + ovr * 0.1 - 8 + rng.gauss() * 5), 15, 96),
      // Speed = PAC, verbatim. See the note above — this is the whole point.
      speed: clamp(Math.round(pac), 15, 99),
      height: tall ? rng.int(182, 198) : rng.int(168, 188),
      weight: rng.int(66, 92),
    }, ovr);
  }

  /** Convert a record from src/data_foreign.js (real LaLiga/Bundesliga/
   *  SerieA/Saudi/MLS squads) into a live player, on the same schema
   *  fromDatabase produces for the Premier League. */
  function fromForeign(rng, raw, league) {
    const pos = foreignPos(raw.pos);
    const age = clamp(raw.age != null ? raw.age : guessAgeFromRating(rng, raw.ovr), 15, 42);
    const mentalityRating = footballIntelligence(rollMentalityRating(rng, raw.ovr), raw.ovr);
    const attrs = mapForeignAttrs(rng, raw, pos);
    attrs.creativity = deriveCreativity(pos, raw.ovr, attrs.leftFoot, attrs.rightFoot, mentalityRating);
    attrs.balance = deriveBalanceAgility(attrs.strength, attrs.fitness, attrs.speed, attrs.height, attrs.weight);
    const p = makePlayer({
      name: raw.name,
      nationality: MG.names.knownNationality(raw.name) || raw.nationality || MG.names.nationForLeague(rng, league),
      pos,
      age,
      overall: raw.ovr,
      attrs,
      mentality: rollMentalityTrait(rng, mentalityRating),
      mentalityRating,
      contract: { years: rng.int(1, 5), wage: 0 },
    });
    p.career.seasons = estimateCareerSeasons(p.age);
    p.potential = rollPotential(rng, p.overall, p.age);
    p.contract.wage = expectedWage(p, league);
    p.value = marketValue(p);
    return p;
  }

  /* ------------------------------- MENTALITY -------------------------------
   * The database's own mentalityRating (src/data.js) averages 66 across the
   * real 2025/26 squads, spanning 35-94 with real width either side. Every
   * GENERATED player used to get a synthetic version of the same number
   * centred on 45 — twenty points below the real data — which is why regens
   * read as uniformly timid: not wrong on any one player, wrong on every one
   * of them the same way. Recentred here to sit where the real data sits,
   * with the same spread and the same gentle lean toward the player's own
   * quality the original formula had.
   *
   * The mentality TRAIT (the label, "Composed"/"Mercurial"/etc.) was never
   * rolled for a generated player at all — makePlayer's own default
   * ("Balanced") is a real trait, but it appears in barely 1% of the actual
   * database, so every regen in the world showing it was the same bug from
   * the other side: an unrolled field standing in as if it were the roll. */
  const MENTALITY_TRAITS = {
    high: ["Composed", "Fearless", "Leader", "Determined", "Professional", "Unflappable", "Big Game Player", "Talisman", "Winner", "Ice Cold"],
    mid: ["Reliable", "Measured", "Steady", "Focused", "Consistent", "Dependable", "Diligent", "Adaptable", "Calm", "Balanced"],
    low: ["Mercurial", "Temperamental", "Maverick", "Modest", "Quiet", "Understated", "Grounded", "Honest"],
  };
  function rollMentalityRating(rng, overall) {
    return clamp(Math.round(60 + rng.gauss() * 16 + (overall - 60) * 0.25), 20, 96);
  }
  function rollMentalityTrait(rng, rating) {
    const pool = rating >= 70 ? MENTALITY_TRAITS.high : rating >= 50 ? MENTALITY_TRAITS.mid : MENTALITY_TRAITS.low;
    return rng.pick(pool);
  }

  /* ------------------------ TARGET IS A PEAK, NOT A NOW --------------------
   * `target` is the quality this player reaches AT HIS PEAK, and a player who
   * has not got there yet is generated below it with the room to grow into it.
   *
   * It used to be applied flat, whatever his age, which is where the world's
   * runaway inflation came from: every squad-filler slot that happened to roll
   * a teenager produced an eighteen-year-old already rated at his club's level
   * — Real Madrid's depth chart manufacturing an 85-rated 18-year-old with a
   * potential of 91 — who then spent eight seasons developing on top of that.
   * Measured over twelve seasons, thirty-seven of the world's top fifty were
   * generated players rated 93-96, against a real database whose best is 94.
   * The knock-on was the transfer market: an inflated supply of world-class
   * players is what let mid-table clubs shop at the top of it.
   *
   * The discount is per position, off the same AGE_CURVE the development model
   * uses, so a winger (mature at 23) is generated much closer to his peak than
   * a goalkeeper (27) of the same age — which is the real shape of it.
   *
   * `rawTarget` opts out for a caller whose target is already an age-specific
   * rating rather than a peak: the youth academy sizes its intake as fifteen-
   * to seventeen-year-olds directly (youth.js), and discounting that twice
   * would produce prospects rated in the thirties. */
  const YOUTH_SHORTFALL = 1.7;      // rating points a year short of maturity

  /** A generated player who peaks at roughly `target` quality. */
  function generate(rng, opts) {
    const league = opts.league || "Championship";
    const pos = opts.pos || rng.pick(POSITION_KEYS);
    const nationality = opts.nationality || MG.names.nationForLeague(rng, league);
    const nationBonus = (MG.names.NATIONS[nationality] || {}).strength || 0;
    const age = opts.age != null ? opts.age : rng.int(18, 33);
    const peak = clamp(Math.round((opts.target || 60) + rng.gauss() * (opts.spread || 4) + nationBonus), 30, 94);
    const yearsShort = opts.rawTarget ? 0 : Math.max(0, ageCurve(pos).grow - age);
    const overall = clamp(Math.round(peak - yearsShort * YOUTH_SHORTFALL), 30, 94);

    // Physical attributes track the position: centre-halves are tall and
    // strong, wingers are quick, goalkeepers are neither.
    const tall = pos === "CB" || pos === "GK" || pos === "FW";
    const quick = pos === "WG" || pos === "FB" || pos === "FW";
    const around = (base, spread) => clamp(Math.round(base + rng.gauss() * spread), 25, 99);
    const mentalityRating = footballIntelligence(rollMentalityRating(rng, overall), overall);
    const genAttrs = {
      heading: around(overall + (tall ? 6 : -6), 6),
      fitness: around(overall, 6),
      strength: around(overall + (pos === "CB" || pos === "FW" ? 5 : -3), 6),
      leftFoot: around(overall - 10, 12),
      rightFoot: around(overall - 2, 10),
      speed: around(overall + (quick ? 7 : pos === "GK" || pos === "CB" ? -8 : 0), 7),
      height: pos === "GK" ? rng.int(185, 199) : tall ? rng.int(182, 196) : rng.int(168, 186),
      weight: rng.int(66, 92),
    };
    // Derived from the feet he just rolled, exactly as an imported player's is
    // derived from the feet the database gave him — one rule for everybody.
    genAttrs.creativity = deriveCreativity(pos, overall, genAttrs.leftFoot, genAttrs.rightFoot, mentalityRating);
    genAttrs.balance = deriveBalanceAgility(genAttrs.strength, genAttrs.fitness, genAttrs.speed, genAttrs.height, genAttrs.weight);
    const p = makePlayer({
      name: MG.names.personName(rng, nationality),
      nationality, pos, age, overall,
      attrs: genAttrs,
      mentality: rollMentalityTrait(rng, mentalityRating),
      mentalityRating,
      contract: { years: rng.int(1, 4), wage: 0 },
      homegrown: !!opts.homegrown,
    });
    /* The other half of the discount: a player generated short of his peak has
     * to be given the headroom to reach it, or the world simply gets worse
     * every season instead of better. rollPotential still runs on top, so the
     * occasional wonderkid clears his intended peak — that is where a
     * generated world is supposed to get its new stars from, rather than from
     * every teenager arriving finished. */
    p.potential = opts.potential != null ? opts.potential
      : clamp(Math.max(yearsShort ? peak : 0, rollPotential(rng, p.overall, p.age)), p.overall, 96);
    p.contract.wage = expectedWage(p, league);
    p.value = marketValue(p);
    return p;
  }

  /* ---------------------------- UNIT RATINGS ------------------------------
   * The bridge from "a list of players" back to the attack/midfield/defence
   * numbers the match engine speaks. Each unit takes its starters' weighted
   * quality, with a small tail from the rest of the squad so that depth is
   * worth something without a bench of reserves dragging a first eleven down. */
  function unitRating(players, unit) {
    const scored = [];
    for (const p of players) {
      if (p.pos === "GK") continue;
      const w = POSITIONS[p.pos].unit[unit];
      if (w <= 0.05) continue;
      /* An injured player is worth less to the side than his rating says, and
       * the man behind him gets picked instead. Discounting him here — rather
       * than removing him — is what makes squad depth matter: a club with a
       * good replacement barely notices, a club without one falls apart. */
      const ov = p.overall * (0.45 + 0.55 * availability(p));
      scored.push({ q: ov * w, w, ov });
    }
    if (!scored.length) return 40;
    // Rank by contribution: the four biggest contributors to this unit are the
    // ones actually on the pitch in that role.
    scored.sort((a, b) => b.q - a.q);
    const core = scored.slice(0, 4);
    const depth = scored.slice(4, 9);
    let wsum = 0, vsum = 0;
    core.forEach((s, i) => { const k = [1, 0.9, 0.75, 0.55][i] * s.w; vsum += s.ov * k; wsum += k; });
    const coreRating = wsum ? vsum / wsum : 40;
    const depthRating = depth.length ? depth.reduce((t, s) => t + s.ov, 0) / depth.length : coreRating - 6;
    return coreRating * 0.86 + depthRating * 0.14;
  }

  function keeperRating(players) {
    const gks = players.filter((p) => p.pos === "GK")
      .map((p) => ({ p, ov: p.overall * (0.45 + 0.55 * availability(p)) }))
      .sort((a, b) => b.ov - a.ov);
    if (!gks.length) return 45;
    return gks[0].ov * 0.9 + (gks[1] ? gks[1].ov * 0.1 : gks[0].ov * 0.1);
  }

  /** All four derived numbers for a squad, before manager/board modifiers. */
  function squadRatings(players) {
    return {
      attack: unitRating(players, "attack"),
      midfield: unitRating(players, "midfield"),
      defence: unitRating(players, "defence"),
      keeper: keeperRating(players),
    };
  }

  /** How badly a squad is missing bodies in each position. Drives recruitment. */
  function squadNeeds(players) {
    const counts = {};
    for (const k of POSITION_KEYS) counts[k] = 0;
    for (const p of players) counts[p.pos] = (counts[p.pos] || 0) + 1;
    const needs = [];
    for (const k of POSITION_KEYS) {
      const short = POSITIONS[k].need - counts[k];
      if (short > 0) needs.push({ pos: k, short, urgency: short * 2 + (counts[k] < POSITIONS[k].starters ? 6 : 0) });
    }
    return { counts, needs };
  }

  /** Quality of the weakest starting slot — what a manager shops for when the
   *  squad is full but not good enough. */
  function weakestUnit(players) {
    const r = squadRatings(players);
    const units = [
      { unit: "attack", value: r.attack, positions: ["FW", "WG", "AM"] },
      { unit: "midfield", value: r.midfield, positions: ["CM", "DM", "AM"] },
      { unit: "defence", value: r.defence, positions: ["CB", "FB"] },
      { unit: "keeper", value: r.keeper, positions: ["GK"] },
    ];
    units.sort((a, b) => a.value - b.value);
    return units[0];
  }

  MG.players = {
    POSITIONS, POSITION_KEYS, SQUAD_TARGET,
    firstSeasonIndex, inferAge, guessAgeFromRating, rollPotential, developmentDelta, applyDevelopment, houseTarget, deriveCreativity, footballIntelligence, deriveBalanceAgility,
    AGE_CURVE, ageCurve, MENTALITY_TRAITS, rollMentalityRating, rollMentalityTrait,
    marketValue, expectedWage, ageValueFactor, LEAGUE_WAGE_FACTOR,
    makePlayer, fromDatabase, fromForeign, generate, resetIds, setNextId, rollInjury, availability, durability, recordMove,
    unitRating, keeperRating, squadRatings, squadNeeds, weakestUnit,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
