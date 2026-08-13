/* ============================================================================
 * FOOTBALL MANAGER — CLUBS, FINANCES AND THE BOARDROOM
 *
 * A club is three things stacked on top of each other:
 *
 *   1. A SQUAD, which produces the attack/midfield/defence numbers the match
 *      engine reads (see players.js). Nothing else sets those numbers — if a
 *      club gets better it is because its players got better or its manager
 *      bought better ones.
 *
 *   2. A BALANCE SHEET. Revenue comes from the division you are in and the
 *      position you finish in; it goes back out as wages and transfer fees.
 *      Money is the reason a good manager at a small club cannot simply buy
 *      his way up, and the reason a bad one at a big club can paper over it
 *      for a while.
 *
 *   3. A BOARDROOM, which is the club's decision-maker. Every club has one and
 *      every club's boardroom runs the same evaluation every season, whether a
 *      human is managing there or not — that symmetry is what makes the world
 *      move on its own.
 *
 * BOARDROOM STYLES
 *   Balanced   — expects roughly what the squad deserves, reacts proportionally
 *   Patient    — accepts a project, judges over years, cares about youth
 *   Chaotic    — expectations wander, reactions are erratic, nobody is safe
 *   Aggressive — demands overachievement now, punishes any shortfall hard
 *
 * The board sets TARGETS relative to the club's standing (where its squad ranks
 * in its own division), then reports back on a fixed set of METRICS. Those
 * metrics are what the end-of-season and pre-season decision screens will be
 * built from, and they are the same numbers that get an AI manager sacked in
 * League Two in season 14.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp, round1 } = MG.util;

  /* ------------------------------- LEAGUES --------------------------------
   * `tier`/`promotesTo`/`relegatesTo` wire up the English pyramid. Foreign
   * leagues are single-tier islands: the database has no second division for
   * them, so clubs there never move between divisions (a known limit, and the
   * one place the world is less alive than England).
   *
   * Money is in £m per season. `tv` is the flat distribution, `merit` the extra
   * paid out on a sliding scale by finishing position. matchdayMax/commercialMax
   * are what a club with a reputation of 100 in that division would earn. */
  const LEAGUES = {
    PL:             { name: "Premier League",  country: "England", tier: 1, prestige: 1.00, relegatesTo: "Championship", down: 3,
                      tv: 90,  merit: 45,  matchdayMax: 120, commercialMax: 300, repBase: 62 },
    Championship:   { name: "Championship",    country: "England", tier: 2, prestige: 0.62, promotesTo: "PL", relegatesTo: "League1", up: 3, down: 3,
                      tv: 10,  merit: 4,   matchdayMax: 25,  commercialMax: 30,  repBase: 32 },
    League1:        { name: "League One",      country: "England", tier: 3, prestige: 0.40, promotesTo: "Championship", relegatesTo: "League2", up: 3, down: 3,
                      tv: 2.5, merit: 1,   matchdayMax: 7,   commercialMax: 6,   repBase: 20 },
    League2:        { name: "League Two",      country: "England", tier: 4, prestige: 0.28, promotesTo: "League1", relegatesTo: "NationalLeague", up: 3, down: 2,
                      tv: 1.6, merit: 0.6, matchdayMax: 4,   commercialMax: 3,   repBase: 13 },
    NationalLeague: { name: "National League", country: "England", tier: 5, prestige: 0.18, promotesTo: "League2", up: 2,
                      tv: 0.8, merit: 0.3, matchdayMax: 2.5, commercialMax: 1.5, repBase: 7 },
    LaLiga:         { name: "La Liga",         country: "Spain",   tier: 1, prestige: 0.92,
                      tv: 40,  merit: 25,  matchdayMax: 70,  commercialMax: 260, repBase: 55 },
    SerieA:         { name: "Serie A",         country: "Italy",   tier: 1, prestige: 0.88,
                      tv: 35,  merit: 20,  matchdayMax: 55,  commercialMax: 170, repBase: 52 },
    Bundesliga:     { name: "Bundesliga",      country: "Germany", tier: 1, prestige: 0.88,
                      tv: 38,  merit: 20,  matchdayMax: 60,  commercialMax: 200, repBase: 52 },
    Saudi:          { name: "Saudi Pro League",country: "Saudi Arabia", tier: 1, prestige: 0.55,
                      tv: 8,   merit: 4,   matchdayMax: 12,  commercialMax: 60,  repBase: 30 },
    MLS:            { name: "MLS",             country: "USA",     tier: 1, prestige: 0.50,
                      tv: 9,   merit: 3,   matchdayMax: 25,  commercialMax: 45,  repBase: 26 },
  };
  const LEAGUE_KEYS = Object.keys(LEAGUES);
  /** The four prestige bands src/data.js uses for Premier League clubs. */
  const PL_BANDS = ["Elite", "Europe", "Mid", "Lower"];
  const ENGLISH_PYRAMID = ["PL", "Championship", "League1", "League2", "NationalLeague"];

  function leagueIdFor(rawLeague) { return PL_BANDS.includes(rawLeague) ? "PL" : rawLeague; }

  /* ---------------------------- PLAYER LEVEL ------------------------------
   * The average player `overall` a division runs at. Every generated squad,
   * every squad top-up and every academy graduate is built against this, and
   * a club's own level is this number shifted by how big the club is.
   *
   * This replaced a least-squares fit of player quality against the tuned team
   * ratings. The fit was elegant and wrong: it could only be measured across
   * the twenty Premier League clubs that have both numbers, and extrapolating
   * that line down to a National League club's rating of 35 put its players on
   * roughly the same level as a Championship squad. The pyramid collapsed into
   * a plateau. An explicit table is less clever, tunable in one place, and
   * actually separates the divisions. */
  const LEAGUE_PLAYER_LEVEL = {
    /* The PL-to-Championship gap was 11 points, which left a promoted club so
     * far adrift that the bottom of the table finished on about 20 points
     * against a real-world 26 while champions landed bang on 88. The second
     * tier is genuinely close to the bottom of the first — a promoted side is
     * overmatched, not doomed — so the gap is 8. Re-check bottom points in
     * manager/tests/realism.js if this is ever retuned. */
    PL: 74, Championship: 66, League1: 58, League2: 51, NationalLeague: 45,
    LaLiga: 71, SerieA: 69, Bundesliga: 69, Saudi: 62, MLS: 58,
  };

  /** The quality of player this specific club should be fielding. */
  function playerLevelFor(club) {
    const base = LEAGUE_PLAYER_LEVEL[club.leagueId] != null ? LEAGUE_PLAYER_LEVEL[club.leagueId] : 55;
    const league = LEAGUES[club.leagueId];
    // Reputation within the division sets the spread: the biggest club in a
    // division fields players several points better than the smallest.
    const spread = (club.reputation - league.repBase) * 0.42;
    return clamp(base + spread, 30, 88);
  }

  /* ----------------------------- BOARDROOMS -------------------------------
   * expectationShift  how far from the club's true standing the target sits
   *                   (negative = demands better than the squad deserves)
   * tolerance         how many places either side of target counts as "met"
   * reactivity        multiplier on every confidence swing
   * patience          seasons of grace a new manager is given. Never below 2:
   *                   every manager in the world gets a full season to be
   *                   judged on before the axe can fall, which is both fair
   *                   and what stops a career ending before it starts.
   * sackFloor         confidence at which the axe falls
   * drift             random noise added to expectations each season
   * weights           how the season's metrics are weighted into the verdict
   * backing           appetite to fund transfers out of the owner's pocket
   */
  const BOARD_STYLES = {
    Balanced: {
      label: "Balanced", blurb: "Expects what the squad deserves and reacts in proportion.",
      expectationShift: 0, tolerance: 2, reactivity: 1.0, patience: 2, sackFloor: 28, drift: 0.6,
      weights: { league: 0.45, cup: 0.15, finance: 0.20, youth: 0.20 }, backing: 0.5,
    },
    Patient: {
      label: "Patient", blurb: "Backs a project. Judges over years, values the academy.",
      expectationShift: 2, tolerance: 4, reactivity: 0.6, patience: 4, sackFloor: 16, drift: 0.3,
      weights: { league: 0.30, cup: 0.10, finance: 0.25, youth: 0.35 }, backing: 0.4,
    },
    Chaotic: {
      label: "Chaotic", blurb: "Moves the goalposts. Nobody is ever quite safe.",
      expectationShift: -1, tolerance: 2, reactivity: 1.25, patience: 2, sackFloor: 34, drift: 3.2,
      weights: { league: 0.40, cup: 0.20, finance: 0.15, youth: 0.25 }, backing: 0.6,
    },
    Aggressive: {
      label: "Aggressive", blurb: "Demands more than the squad deserves, and demands it now.",
      expectationShift: -1.5, tolerance: 1, reactivity: 1.55, patience: 2, sackFloor: 36, drift: 0.8,
      weights: { league: 0.60, cup: 0.20, finance: 0.10, youth: 0.10 }, backing: 0.75,
    },
  };
  const BOARD_STYLE_KEYS = Object.keys(BOARD_STYLES);

  /** Bigger clubs attract more demanding boardrooms; small ones muddle along. */
  function rollBoardStyle(rng, reputation) {
    const big = clamp((reputation - 30) / 60, 0, 1);
    return rng.weightedKey({
      Balanced: 34,
      Patient: 30 - big * 14,
      Chaotic: 16 + big * 4,
      Aggressive: 12 + big * 30,
    });
  }

  /* ------------------------------- CLUBS ---------------------------------- */
  function createClub(rng, name, raw, opts) {
    const leagueId = leagueIdFor(raw.league);
    const league = LEAGUES[leagueId];
    const baseline = (raw.attack + raw.midfield + raw.defence + raw.manager) / 4;

    const club = {
      id: opts.id,
      name,
      leagueId,
      band: PL_BANDS.includes(raw.league) ? raw.league : null,
      country: league.country,
      tacticalStyle: raw.tacticalStyle,
      homeAdvantage: raw.homeAdvantage,
      // The tuned strength from src/data.js. Squad ratings are calibrated
      // against this at world creation and it is never read again — it exists
      // so that season 1 looks like the real world.
      baseline: { attack: raw.attack, midfield: raw.midfield, defence: raw.defence, manager: raw.manager, avg: baseline },
      reputation: 0,       // set in calibrateReputation once every club exists
      squad: [],
      // identity: the permanent gap between what a squad's raw quality says and
      // what the club actually achieves — stadium, coaching, infrastructure,
      // the things that are not on the team sheet. Fixed at creation so that
      // from then on, changes in results come from changes in the squad.
      identity: { attack: 0, midfield: 0, defence: 0 },
      ratings: { attack: 0, midfield: 0, defence: 0, keeper: 0 },
      facilities: { training: 50, youth: 50 },
      academyTier: "Average",
      managerId: null,
      finances: {
        balance: 0, revenue: 0, wageBill: 0, transferBudget: 0, wageBudget: 0,
        spent: 0, received: 0, lastProfit: 0, debt: 0,
      },
      board: null,
      history: { titles: 0, cups: 0, promotions: 0, relegations: 0, europeanTitles: 0, seasons: [] },
      form: 0,
      lastPosition: null,
      formation: "4-4-2",   // overwritten per club at creation
      xi: null,             // null = auto-pick the best available side
      focus: null,          // "league" | "cup" | "europe" — the season's priority
      /* Levers the decision layer pulls. Everything here is applied by the
       * simulation and then decayed at the end of the season, so a choice made
       * in the summer shapes the campaign that follows it and no more —
       * unless it set a multi-season boost, which is what makes long-term
       * decisions distinguishable from quick fixes. */
      modifiers: {
        form: 0,            // season-long form swing, read by the match engine
        injuryRisk: 1,      // multiplier on every injury roll in this squad
        unit: { attack: 0, midfield: 0, defence: 0 },   // rating shifts, in points
        unitSeasons: 0,     // how many more seasons the unit shifts survive
        youthBias: 0,       // pushes minutes toward under-21s
        wageStrain: 0,      // extra wage cost agreed in a decision
      },
      flags: {},            // narrative flags with a season countdown
    };
    return club;
  }

  /* Reputation is stateful from here on: it is set once against the club's
   * peers, then nudged by trophies, promotions and relegations. Recomputing it
   * from the current division every season would mean a relegated giant
   * instantly became a small club, which is exactly wrong. */
  function calibrateReputation(clubs) {
    const byLeague = {};
    for (const c of clubs) (byLeague[c.leagueId] = byLeague[c.leagueId] || []).push(c);
    for (const [leagueId, list] of Object.entries(byLeague)) {
      const league = LEAGUES[leagueId];
      const avg = list.reduce((t, c) => t + c.baseline.avg, 0) / list.length;
      for (const c of list) {
        c.reputation = clamp(Math.round(league.repBase + (c.baseline.avg - avg) * 1.6), 3, 99);
      }
    }
  }

  /** Training and youth quality. Rich, well-run clubs coach better. */
  function calibrateFacilities(club, academyTier) {
    const tierBonus = { "World Class": 22, Strong: 12, Average: 0, Weak: -10 }[academyTier] || 0;
    club.academyTier = academyTier || "Average";
    club.facilities.training = clamp(Math.round(28 + club.reputation * 0.55 + tierBonus * 0.5), 15, 95);
    club.facilities.youth = clamp(Math.round(25 + club.reputation * 0.45 + tierBonus), 10, 95);
  }

  /** Recompute the three unit ratings from the squad plus the fixed identity
   *  offset and whatever the manager's decisions did. Called after every
   *  transfer window and every development pass. */
  function refreshRatings(club) {
    // Ratings come from the ELEVEN on the pitch, not the whole squad — see
    // tactics.js. Picking a team is supposed to matter, and it cannot matter
    // if the numbers are computed from twenty-six players regardless.
    const r = MG.tactics ? MG.tactics.xiRatings(club) : MG.players.squadRatings(club.squad);
    const mod = (club.modifiers && club.modifiers.unit) || { attack: 0, midfield: 0, defence: 0 };
    club.ratings.attack   = clamp(r.attack   + club.identity.attack   + mod.attack,   20, 99);
    club.ratings.midfield = clamp(r.midfield + club.identity.midfield + mod.midfield, 20, 99);
    club.ratings.defence  = clamp(r.defence  + club.identity.defence  + mod.defence,  20, 99);
    club.ratings.keeper   = clamp(r.keeper, 20, 99);
    return club.ratings;
  }

  /** Lock in the identity offsets so that season 1 reproduces the tuned data. */
  function calibrateIdentity(club) {
    // Must use the same source as refreshRatings or every club in the world
    // starts life with a bogus offset.
    const r = MG.tactics ? MG.tactics.xiRatings(club) : MG.players.squadRatings(club.squad);
    club.identity.attack   = club.baseline.attack   - r.attack;
    club.identity.midfield = club.baseline.midfield - r.midfield;
    club.identity.defence  = club.baseline.defence  - r.defence;
    refreshRatings(club);
  }

  /** Overall club quality on the 0-99 scale, for ranking and job appeal. */
  function clubStrength(club) {
    const r = club.ratings;
    return (r.attack + r.midfield + r.defence + r.keeper * 0.6) / 3.6;
  }

  /* ------------------------------ FINANCES -------------------------------- */
  /** Season revenue. Position is 1-indexed; null before a season is played. */
  function computeRevenue(club, position, fieldSize, europeanRun) {
    const league = LEAGUES[club.leagueId];
    const rep = club.reputation / 100;
    const meritShare = position ? 1 - (position - 1) / Math.max(fieldSize - 1, 1) : 0.5;
    const tv = league.tv + league.merit * meritShare;
    const matchday = league.matchdayMax * Math.pow(rep, 2);
    const commercial = league.commercialMax * Math.pow(rep, 2.5);
    const euro = europeanRun || 0;
    return round1(tv + matchday + commercial + euro);
  }

  function wageBill(club) {
    // Wages are stored in £k/week; a season is 52 weeks of them.
    return round1(club.squad.reduce((t, p) => t + p.contract.wage, 0) * 52 / 1000);
  }

  /* Budgets are set in the summer, before the transfer window. The board is
   * what decides how much of the club's money the manager is allowed to touch,
   * which is why the style matters here as much as the balance does. */
  function setBudgets(club, rng) {
    const style = BOARD_STYLES[club.board.style];
    const f = club.finances;
    const projected = computeRevenue(club, club.lastPosition, 20, 0);
    const backing = style.backing * (club.board.wealth / 100);

    // Wage budget: a share of projected revenue, wider for a board that is
    // happy to gamble, tighter for one watching the pennies.
    // Kept below (1 - OPERATING_COST_SHARE) so that a club spending to its
    // full wage budget still breaks even. It used to top out at 0.82, which
    // with running costs meant almost every club in the world lost money every
    // season and 176 of 221 ended up in the red.
    const wageShare = clamp(0.54 + backing * 0.18 - (club.board.style === "Patient" ? 0.05 : 0), 0.44, 0.74);
    f.wageBudget = round1(projected * wageShare);

    // Transfer budget: whatever the club can afford from its balance, plus a
    // slice of revenue, plus whatever the owner feels like putting in.
    const fromBalance = Math.max(0, f.balance) * (0.25 + backing * 0.45);
    const fromRevenue = projected * (0.10 + backing * 0.22);
    const injection = club.board.wealth > 70 ? projected * backing * 0.35 : 0;
    let budget = fromBalance + fromRevenue + injection;
    if (club.board.style === "Chaotic") budget *= rng.between(0.45, 1.8);
    // Hard ceiling: what is in the bank plus a slice of next season's income.
    // Without it a club with an ambitious board spent a fraction of its revenue
    // every single summer whether it had the money or not, and twenty seasons
    // later Al Hilal were £1.8bn in the red and still buying.
    budget = Math.min(budget, Math.max(0, f.balance) + projected * 0.2);
    if (f.balance < 0) budget = 0;                        // in the red: sell before you buy
    f.transferBudget = round1(Math.max(0, budget));
    // A club this far under water has to raise money, and the only asset it
    // has is its players. buildListings reads this.
    club.mustSell = f.balance < -projected * 0.35;
    f.spent = 0;
    f.received = 0;
    return f;
  }

  /* Everything that is not a player's wage: coaching and academy staff, the
   * stadium, the training ground, the people who run the place. Without it a
   * big club's balance compounds into the billions over a long save, because
   * playing wages alone never come close to consuming the revenue. */
  const OPERATING_COST_SHARE = 0.24;

  /** Book the season's money. Returns the profit/loss for the news feed. */
  function settleFinances(club, position, fieldSize, europeanRun) {
    const f = club.finances;
    f.revenue = computeRevenue(club, position, fieldSize, europeanRun);
    f.wageBill = wageBill(club);
    f.operating = round1(f.revenue * OPERATING_COST_SHARE);
    const profit = round1(f.revenue - f.wageBill - f.operating - f.spent + f.received);
    f.balance = round1(f.balance + profit);
    f.lastProfit = profit;
    // Sustained losses become debt, which is what eventually forces a selling
    // club to sell. There is no bailout here beyond the owner's backing.
    if (f.balance < 0) f.debt = round1(-f.balance);
    else f.debt = 0;
    reinvestSurplus(club);
    return profit;
  }

  /* Clubs do not sit on cash. Anything much beyond a season's turnover goes
   * into the building — the training ground, the academy, the stadium — which
   * is both what really happens and the thing that stops a twenty-season save
   * ending with five clubs holding billions they can never spend. It also
   * gives success a compounding edge that is not simply "buy another striker":
   * a rich club grows a better academy and develops players faster. */
  function reinvestSurplus(club) {
    const f = club.finances;
    const cap = Math.max(5, f.revenue * 1.2);
    if (f.balance <= cap) return 0;
    const surplus = f.balance - cap;
    f.balance = round1(cap);
    f.invested = round1((f.invested || 0) + surplus);
    const scale = f.revenue > 0 ? surplus / f.revenue : 0;
    club.facilities.training = clamp(Math.round(club.facilities.training + scale * 1.6), 15, 99);
    club.facilities.youth = clamp(Math.round(club.facilities.youth + scale * 1.3), 10, 99);
    return surplus;
  }

  /* ------------------------------ BOARDROOM ------------------------------- */
  function createBoard(rng, club) {
    const style = rollBoardStyle(rng, club.reputation);
    const cfg = BOARD_STYLES[style];
    // Wealth is the owner's pocket, only loosely tied to the club's size — a
    // rich owner at a small club is one of the ways the world reshuffles.
    const wealthRoll = rng.next();
    const wealth = clamp(Math.round(
      club.reputation * 0.6 + (wealthRoll > 0.94 ? 45 : wealthRoll > 0.75 ? 18 : 0) + rng.gauss() * 12
    ), 5, 100);
    return {
      style,
      wealth,
      confidence: rng.int(55, 75),
      // Set each summer in setSeasonTargets.
      targets: null,
      // Filled in at the end of each season by evaluateSeason.
      report: null,
      seasonsWithManager: 0,
      grace: cfg.patience,
      history: [],
    };
  }

  /** Where the squad says this club should finish, 1-indexed. */
  function standingIn(club, leagueClubs) {
    const ranked = leagueClubs.slice().sort((a, b) => clubStrength(b) - clubStrength(a));
    return ranked.findIndex((c) => c.id === club.id) + 1;
  }

  /* The season's brief, handed to the manager before a ball is kicked. Every
   * club in the world gets one; the human's is simply the one that gets shown. */
  function setSeasonTargets(club, leagueClubs, rng) {
    const cfg = BOARD_STYLES[club.board.style];
    const league = LEAGUES[club.leagueId];
    const size = leagueClubs.length;
    const standing = standingIn(club, leagueClubs);

    const drift = cfg.drift * rng.gauss();
    let position = Math.round(standing + cfg.expectationShift + drift);
    position = clamp(position, 1, size);

    // A board whose club sits in the promotion places expects promotion, and
    // one at the bottom expects survival. These are the lines the report reads.
    const promotionSpot = league.promotesTo ? Math.max(2, Math.round(size * 0.12)) : null;
    const relegationLine = league.relegatesTo ? size - (league.down || 3) : null;

    const cupTarget = club.reputation >= 70 ? "SF" : club.reputation >= 50 ? "QF" : club.reputation >= 30 ? "R4" : "R3";
    const youthTarget = clamp(Math.round((cfg.weights.youth * 100) * 0.7 + club.facilities.youth * 0.18), 6, 38);

    club.board.targets = {
      position,
      tolerance: cfg.tolerance,
      standing,
      promotion: promotionSpot != null && position <= promotionSpot,
      survival: relegationLine != null && position > relegationLine - 3,
      europe: club.leagueId === "PL" || league.tier === 1 ? position <= 5 : false,
      cup: cupTarget,
      // Percentage of league minutes the board wants going to under-21s.
      youthMinutes: youthTarget,
      // Wage bill must stay under this or the finance metric goes red.
      wageCeiling: club.finances.wageBudget,
      summary: null,
    };
    club.board.targets.summary = describeTargets(club);
    return club.board.targets;
  }

  function describeTargets(club) {
    const t = club.board.targets;
    const league = LEAGUES[club.leagueId];
    const ord = (n) => {
      const s = ["th", "st", "nd", "rd"], v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };
    if (t.promotion) return `Win promotion from the ${league.name}`;
    if (t.position === 1) return `Win the ${league.name}`;
    if (t.europe && t.position <= 4) return `Qualify for the Champions League (top 4)`;
    if (t.europe) return `Qualify for Europe (top ${t.position})`;
    if (t.survival) return `Survive — stay out of the bottom ${league.down || 3}`;
    return `Finish around ${ord(t.position)} in the ${league.name}`;
  }

  /* ---------------------------- SEASON REPORT -----------------------------
   * Each metric scores in [-1, +1]: +1 is "smashed it", 0 is "as asked",
   * -1 is "nowhere near". The weighted total is the confidence swing, which
   * is what sacks managers. Keeping every metric on the same scale is what
   * lets a Patient board and an Aggressive board read the same season and
   * come to opposite conclusions. */
  const CUP_ROUND_RANK = { none: 0, R3: 1, R4: 2, R5: 3, QF: 4, SF: 5, F: 6, W: 7 };

  function evaluateSeason(club, result, rng) {
    const cfg = BOARD_STYLES[club.board.style];
    const t = club.board.targets || { position: 10, tolerance: 3, cup: "R4", youthMinutes: 10, wageCeiling: 999 };
    const size = result.fieldSize || 20;

    // League: distance from target, normalised by how big the division is.
    const miss = t.position - result.position;                 // positive = better than asked
    const scale = Math.max(t.tolerance, 1) + size * 0.12;
    let league = clamp(miss / scale, -1, 1);
    if (result.promoted) league = 1;
    if (result.relegated) league = -1;
    if (result.champion) league = 1;

    // Cup: rounds above or below the brief.
    const reached = CUP_ROUND_RANK[result.cupRound || "none"] || 0;
    const asked = CUP_ROUND_RANK[t.cup] || 2;
    const cup = clamp((reached - asked) / 3, -1, 1);

    // Finance: wage bill against the ceiling, with the balance as a backstop.
    /* Neutral sits a little ABOVE the ceiling rather than exactly on it.
     * Clubs habitually run over their wage budget — measured across the world
     * the median club sits around 1.1x — and scoring against a hard 1.0 made
     * the finance metric a standing negative for almost every manager alive,
     * which quietly turned every board's verdict sour no matter what the team
     * did on the pitch. */
    const wageRatio = t.wageCeiling > 0 ? club.finances.wageBill / t.wageCeiling : 1;
    let finance = clamp((1.08 - wageRatio) * 3, -1, 1);
    if (club.finances.balance < 0) finance = Math.min(finance, -0.5);
    if (club.finances.lastProfit > 0 && wageRatio < 1) finance = Math.min(1, finance + 0.2);

    // Youth: share of minutes given to under-21s against the brief.
    const youthPct = result.youthMinutesPct || 0;
    const youth = clamp((youthPct - t.youthMinutes) / Math.max(t.youthMinutes, 6), -1, 1);

    const w = focusWeights(club);
    let total = league * w.league + cup * w.cup + finance * w.finance + youth * w.youth;

    /* Headline results override the arithmetic. A weighted average let a club
     * win its division and come out at "met expectations" because the wage
     * bill was high and the kids did not play — which is not how any boardroom
     * on earth reacts to a trophy. Winning, going up or going down is the
     * story of the season and the verdict has to say so. */
    if (result.champion || result.promoted) total = Math.max(total, 0.55);
    if (result.relegated) total = Math.min(total, -0.55);

    /* A promise made in the summer is called in now. Beating the brief after
     * promising to is worth more; missing it after promising to costs more.
     * This is the only thing that makes the boardroom promise card a gamble
     * rather than free confidence. */
    if (club.flags && club.flags.promised) {
      total *= total >= 0 ? 1.25 : 1.6;
    }

    // A chaotic board sometimes simply decides it does not like you.
    if (club.board.style === "Chaotic") total += rng.between(-0.45, 0.45);

    const swing = Math.round(total * 26 * cfg.reactivity);
    // Gravity: confidence sags back toward neutral every season regardless of
    // the verdict. Without it, a few good years bank a manager enough goodwill
    // to sit at 100 for the rest of his life and the top of the game stops
    // turning over at all.
    const gravity = (55 - club.board.confidence) * 0.12;
    club.board.confidence = clamp(club.board.confidence + swing + gravity, 0, 100);
    club.board.seasonsWithManager++;
    if (club.board.grace > 0) club.board.grace--;

    const report = {
      season: result.season,
      metrics: {
        league:  { score: round1(league),  target: t.position, actual: result.position, label: "League position" },
        cup:     { score: round1(cup),     target: t.cup,      actual: result.cupRound || "none", label: "Cup run" },
        finance: { score: round1(finance), target: `£${round1(t.wageCeiling)}m wages`, actual: `£${club.finances.wageBill}m`, label: "Financial discipline" },
        youth:   { score: round1(youth),   target: `${t.youthMinutes}%`, actual: `${Math.round(youthPct)}%`, label: "Youth development" },
      },
      weights: w,
      total: round1(total),
      swing,
      confidence: club.board.confidence,
      verdict: verdictFor(total, club.board.style),
    };
    club.board.report = report;
    club.board.history.push({ season: result.season, confidence: club.board.confidence, total: round1(total) });
    if (club.board.history.length > 30) club.board.history.shift();
    return report;
  }

  function verdictFor(total, style) {
    if (total >= 0.5) return style === "Aggressive" ? "Delivered" : "Outstanding";
    if (total >= 0.15) return "Above expectations";
    if (total >= -0.15) return "Met expectations";
    if (total >= -0.45) return "Below expectations";
    return "Unacceptable";
  }

  /** Should this board sack its manager? Grace protects a new appointment. */
  function wantsSacking(club, rng) {
    const cfg = BOARD_STYLES[club.board.style];
    if (!club.managerId) return false;
    if (club.board.grace > 0 && club.board.confidence > 12) return false;
    if (club.board.confidence <= cfg.sackFloor) return true;
    // Chaotic boards occasionally sack a manager who did nothing wrong.
    if (club.board.style === "Chaotic" && rng.chance(0.07)) return true;
    return false;
  }

  /** Confidence reset when a new manager walks in. */
  function onManagerAppointed(club, manager) {
    const cfg = BOARD_STYLES[club.board.style];
    club.managerId = manager ? manager.id : null;
    club.board.confidence = clamp(55 + (manager ? (manager.reputation - club.reputation) * 0.25 : 0), 35, 85);
    club.board.seasonsWithManager = 0;
    club.board.grace = cfg.patience;
    club.board.report = null;
  }

  /** Wind decision effects down at the end of a season. Unit boosts last as
   *  many seasons as the decision bought; everything else is a one-year lever
   *  and resets, so a manager has to keep making choices. */
  function decayModifiers(club) {
    const m = club.modifiers;
    if (!m) return;
    m.form = 0;
    m.injuryRisk = 1;
    m.youthBias = 0;
    m.wageStrain = 0;
    if (m.unitSeasons > 0) {
      m.unitSeasons--;
      if (m.unitSeasons <= 0) m.unit = { attack: 0, midfield: 0, defence: 0 };
    } else {
      m.unit = { attack: 0, midfield: 0, defence: 0 };
    }
    for (const k of Object.keys(club.flags || {})) {
      club.flags[k]--;
      if (club.flags[k] <= 0) delete club.flags[k];
    }
  }

  /* ----------------------------- SEASON FOCUS ------------------------------
   * Where the manager points the season. A squad cannot chase everything: the
   * chosen competition gets a real edge and the others pay for it, which is
   * what makes the choice a choice rather than a free bonus. The board's own
   * metric weights shift with it too — tell them you are going for the cup and
   * they will judge the cup run more heavily. */
  const FOCUS = {
    league: { label: "The League", blurb: "Everything at the table. Rotate in the cups.",
              bonus: { league: 3, cup: -3, europe: -3 }, weights: { league: 0.12, cup: -0.08 } },
    cup:    { label: "The Cup", blurb: "A trophy is a trophy. Points can wait.",
              bonus: { league: -2, cup: 5, europe: -2 }, weights: { league: -0.12, cup: 0.14 } },
    europe: { label: "Europe", blurb: "The nights that make a club's name.",
              bonus: { league: -2, cup: -3, europe: 6 }, weights: { league: -0.08, cup: 0.04 } },
  };
  const FOCUS_KEYS = Object.keys(FOCUS);

  /** Rating shift for a club in a given competition, from its season focus. */
  function focusBonus(club, competition) {
    const f = FOCUS[club.focus];
    if (!f) return 0;
    return f.bonus[competition || "league"] || 0;
  }

  /** The board's weights, adjusted for what the manager said he was chasing. */
  function focusWeights(club) {
    const cfg = BOARD_STYLES[club.board.style];
    const base = Object.assign({}, cfg.weights);
    const f = FOCUS[club.focus];
    if (f) {
      for (const [k, v] of Object.entries(f.weights)) base[k] = clamp((base[k] || 0) + v, 0.02, 0.8);
      // Renormalise so a verdict is still scored out of one.
      const total = Object.values(base).reduce((a, b) => a + b, 0);
      for (const k of Object.keys(base)) base[k] = base[k] / total;
    }
    return base;
  }

  /** Reputation drifts with what the club actually achieves. */
  function adjustReputation(club, delta) {
    club.reputation = clamp(Math.round(club.reputation + delta), 3, 99);
  }

  MG.clubs = {
    LEAGUES, LEAGUE_KEYS, PL_BANDS, ENGLISH_PYRAMID, leagueIdFor,
    BOARD_STYLES, BOARD_STYLE_KEYS, rollBoardStyle,
    createClub, calibrateReputation, calibrateFacilities, calibrateIdentity, refreshRatings, clubStrength,
    computeRevenue, wageBill, setBudgets, settleFinances, reinvestSurplus, OPERATING_COST_SHARE,
    LEAGUE_PLAYER_LEVEL, playerLevelFor,
    createBoard, standingIn, setSeasonTargets, describeTargets, evaluateSeason, wantsSacking,
    onManagerAppointed, adjustReputation, CUP_ROUND_RANK, decayModifiers,
    FOCUS, FOCUS_KEYS, focusBonus, focusWeights,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
