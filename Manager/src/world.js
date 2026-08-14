/* ============================================================================
 * FOOTBALL MANAGER — THE WORLD
 *
 * The orchestrator. createWorld() builds 221 clubs, ~5,000 players, 221 boards
 * and 221 managers from a single seed; advanceSeason() plays every division,
 * every domestic cup and every European competition, judges every manager
 * against his own board's targets, sacks the ones who failed, refills the
 * vacancies, then ages, develops and trades the entire player population.
 *
 * There is no player character anywhere in this file. That is the point: the
 * world has to be worth managing in before anyone manages in it, and it has to
 * keep running whether or not anyone does.
 *
 * SCALE CALIBRATION
 *   src/data.js carries two different number scales — clubs are tuned on a
 *   35-99 team-strength scale and players on a 58-94 overall scale. The twenty
 *   Premier League clubs are the only place both exist for the same club, so
 *   the world fits a line through those twenty at creation and uses it to
 *   generate every other squad. That keeps one player scale across all 221
 *   clubs, which is what lets a Championship club sign a Premier League
 *   reserve without either club's rating jumping.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp, round1 } = MG.util;

  /* The dugouts of the Premier League at kick-off, copied from the
   * MANAGER_DATABASE in 1000goals' src/game.js so that season one has the
   * right names in the right places. Everything after season one is generated. */
  const REAL_MANAGERS = {
    "Manchester City": { name: "P. Guardiola", archetype: "perfectionist", rep: 96 },
    "Liverpool": { name: "A. Slot", archetype: "intensity", rep: 84 },
    "Arsenal": { name: "M. Arteta", archetype: "architect", rep: 86 },
    "Manchester United": { name: "R. Amorim", archetype: "architect", rep: 78 },
    "Chelsea": { name: "E. Maresca", archetype: "perfectionist", rep: 74 },
    "Tottenham": { name: "T. Frank", archetype: "analyst", rep: 76 },
    "Newcastle United": { name: "E. Howe", archetype: "intensity", rep: 80 },
    "Aston Villa": { name: "U. Emery", archetype: "tactician", rep: 88 },
    "Brighton": { name: "F. Hurzeler", archetype: "architect", rep: 68 },
    "West Ham": { name: "G. Potter", archetype: "architect", rep: 70 },
    "Crystal Palace": { name: "O. Glasner", archetype: "tactician", rep: 76 },
    "Brentford": { name: "K. Andrews", archetype: "analyst", rep: 62 },
    "Fulham": { name: "M. Silva", archetype: "architect", rep: 72 },
    "Everton": { name: "D. Moyes", archetype: "grafter", rep: 74 },
    "Wolves": { name: "V. Pereira", archetype: "tactician", rep: 64 },
    "Nottingham Forest": { name: "N. Espirito Santo", archetype: "grafter", rep: 72 },
    "Bournemouth": { name: "A. Iraola", archetype: "intensity", rep: 76 },
    "Burnley": { name: "S. Parker", archetype: "grafter", rep: 62 },
    "Leeds United": { name: "D. Farke", archetype: "architect", rep: 68 },
    "Sunderland": { name: "R. Le Bris", archetype: "intensity", rep: 60 },
  };

  /* ------------------------------- CREATION ------------------------------- */
  function gameData() {
    const w = typeof window !== "undefined" ? window : root;
    return (w && w.GAME_DATA) || root.GAME_DATA;
  }

  function createWorld(options) {
    const opts = options || {};
    const seed = opts.seed || `world-${Date.now()}`;
    const D = gameData();
    if (!D) throw new Error("GAME_DATA not loaded — include ../src/data.js before world.js");

    MG.players.resetIds();
    MG.managers.resetIds();
    if (MG.network) MG.network.resetCache();

    const world = {
      seed,
      rng: MG.createRng(seed, "world"),
      year: opts.startYear || 2026,
      season: 1,
      clubs: [],
      clubIndex: {},
      managers: [],
      managerIndex: {},
      freeManagers: [],
      news: [],
      history: [],
      _profiles: {},
      _selections: {},
    };
    attachApi(world);

    /* ---- clubs ---- */
    let id = 1;
    for (const [name, raw] of Object.entries(D.TEAM_DATABASE)) {
      const club = MG.clubs.createClub(world.rng, name, raw, { id: id++ });
      world.clubs.push(club);
      world.clubIndex[club.id] = club;
    }
    MG.clubs.calibrateReputation(world.clubs);
    for (const club of world.clubs) {
      MG.clubs.calibrateFacilities(club, academyTierFor(D, club.name));
    }

    /* ---- squads: real data first, so the scale can be fitted from them ---- */
    const firstSeason = MG.players.firstSeasonIndex(D);
    const realSquads = [];
    for (const club of world.clubs) {
      const raw = realSquadFor(D, club.name);
      if (!raw) continue;
      club.squad = raw.map((p) => {
        const player = MG.players.fromDatabase(world.rng, p, world.year, firstSeason, club.leagueId);
        player.clubId = club.id;
        player.career.clubs.push(club.name);
        return player;
      });
      realSquads.push(club);
    }

    for (const club of world.clubs) {
      club.level = MG.clubs.playerLevelFor(club);
      if (club.squad.length) continue;
      club.squad = generateSquad(world.rng, club);
    }
    void realSquads;

    /* Give every club a shape that suits its manager's system before the
     * identity offsets are locked in, or the offsets absorb a mismatch that
     * the manager would never have picked. */
    for (const club of world.clubs) {
      club.formation = formationFor(world.rng, club.tacticalStyle);
      for (const p of club.squad) MG.tactics.initMorale(p);
    }
    for (const club of world.clubs) {
      MG.clubs.calibrateIdentity(club);
      club.board = MG.clubs.createBoard(world.rng, club);
      club.finances.balance = round1(MG.clubs.computeRevenue(club, null, 20, 0) * world.rng.between(0.05, 0.4));
      club.finances.wageBill = MG.clubs.wageBill(club);
    }

    /* ---- managers ---- */
    for (const club of world.clubs) {
      const manager = createStartingManager(world, club);
      appointManager(world, club, manager, { quiet: true });
    }

    /* ---- a pool of managers out of work, so vacancies have candidates ---- */
    for (let i = 0; i < 45; i++) {
      const rep = clamp(Math.round(world.rng.between(12, 72)), 5, 90);
      const m = MG.managers.generate(world.rng, rep);
      world.managers.push(m);
      world.managerIndex[m.id] = m;
      world.freeManagers.push(m);
    }

    // Every club starts with a stocked academy, so season one has prospects.
    if (MG.youth) for (const club of world.clubs) MG.youth.intake(world, club);

    world.prepareSeason();
    return world;
  }

  /* Which shape a system tends to be played in. Not a hard rule — a third of
   * clubs pick something else, which is what stops every Possession side in
   * the world lining up identically. */
  const STYLE_FORMATION = {
    Possession: ["4-3-3", "4-2-3-1"],
    "High Press": ["4-3-3", "4-2-3-1"],
    Counter: ["4-4-2", "4-5-1"],
    Direct: ["4-4-2", "3-5-2"],
    "Park the Bus": ["5-3-2", "4-5-1"],
    "Route One": ["4-4-2", "5-3-2"],
  };
  function formationFor(rng, style) {
    const list = STYLE_FORMATION[style];
    if (list && rng.chance(0.7)) return rng.pick(list);
    return rng.pick(MG.tactics.FORMATION_KEYS);
  }

  function academyTierFor(D, clubName) {
    if (D.CLUB_ACADEMY[clubName]) return D.CLUB_ACADEMY[clubName];
    // The academy table keys clubs by their long draft-screen names.
    const key = Object.keys(D.CLUB_ACADEMY).find((k) => k.startsWith(clubName));
    return key ? D.CLUB_ACADEMY[key] : "Average";
  }

  /** The real 2025/26 squad for a club, if the database has one. */
  const SQUAD_NAME_BRIDGE = {
    "Liverpool": "Liverpool FC", "Arsenal": "Arsenal FC", "Chelsea": "Chelsea FC",
    "Tottenham": "Tottenham Hotspur", "Brighton": "Brighton & Hove Albion",
    "West Ham": "West Ham United", "Brentford": "Brentford FC", "Fulham": "Fulham FC",
    "Everton": "Everton FC", "Wolves": "Wolverhampton Wanderers", "Bournemouth": "AFC Bournemouth",
    "Burnley": "Burnley FC",
  };
  function realSquadFor(D, clubName) {
    const base = SQUAD_NAME_BRIDGE[clubName] || clubName;
    const key = Object.keys(D.PLAYER_DATABASE_2026).find((k) => k.startsWith(base + " ("));
    return key ? D.PLAYER_DATABASE_2026[key] : null;
  }

  /* Least-squares fit of squad-derived quality against the tuned team rating,
   * over the clubs where both exist. Returns { slope, intercept, toPlayer }. */
  function fitPlayerScale(clubs) {
    const pts = clubs.map((c) => {
      const r = MG.players.squadRatings(c.squad);
      return { x: (r.attack + r.midfield + r.defence) / 3, y: c.baseline.avg };
    });
    const n = pts.length;
    if (n < 4) return defaultScale();
    const mx = pts.reduce((t, p) => t + p.x, 0) / n;
    const my = pts.reduce((t, p) => t + p.y, 0) / n;
    let num = 0, den = 0;
    for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) * (p.x - mx); }
    const slope = den ? num / den : 0;
    if (!(slope > 0.2)) return defaultScale();
    const intercept = my - slope * mx;
    return {
      slope: round1(slope), intercept: round1(intercept),
      /** team-strength -> the player overall a squad of that level averages */
      toPlayer(teamRating) { return clamp((teamRating - intercept) / slope, 28, 92); },
    };
  }
  function defaultScale() {
    // Fallback if the real squads ever disappear from the database: a straight
    // mapping that keeps the two scales in the same ballpark.
    return { slope: 1.6, intercept: -46, toPlayer(t) { return clamp((t + 46) / 1.6, 28, 92); } };
  }

  /** A full squad for a club with no real data, built to the club's level. */
  function generateSquad(rng, club) {
    const level = club.level;
    const squad = [];
    for (const pos of MG.players.POSITION_KEYS) {
      const def = MG.players.POSITIONS[pos];
      for (let i = 0; i < def.need; i++) {
        // Starters at the club's level, squad players below it.
        const drop = i < def.starters ? rng.between(-1, 3) : rng.between(3, 11);
        const age = i < def.starters ? rng.int(21, 32) : rng.chance(0.45) ? rng.int(17, 21) : rng.int(22, 34);
        const p = MG.players.generate(rng, {
          league: club.leagueId, pos, age, target: level - drop, spread: 3.2,
        });
        p.clubId = club.id;
        p.career.clubs.push(club.name);
        squad.push(p);
      }
    }
    return squad;
  }

  function createStartingManager(world, club) {
    const rng = world.rng;
    const real = REAL_MANAGERS[club.name];
    if (real) {
      return MG.managers.fromArchetype(rng, real.archetype, {
        name: real.name, reputation: real.rep, tactic: club.tacticalStyle,
      });
    }
    // Everyone else: an archetype that matches how the club is set up to play.
    const matching = MG.managers.ARCHETYPE_KEYS.filter((k) => MG.managers.ARCHETYPES[k].tactic === club.tacticalStyle);
    const key = matching.length && rng.chance(0.7)
      ? rng.pick(matching)
      : rng.weighted(MG.managers.ARCHETYPE_KEYS.map((k) => ({ item: k, weight: MG.managers.ARCHETYPES[k].weight })));
    const rep = clamp(Math.round(club.reputation + rng.gauss() * 8), 4, 95);
    return MG.managers.fromArchetype(rng, key, { reputation: rep, tactic: club.tacticalStyle });
  }

  function appointManager(world, club, manager, opts) {
    const o = opts || {};
    if (!world.managerIndex[manager.id]) {
      world.managers.push(manager);
      world.managerIndex[manager.id] = manager;
    }
    world.freeManagers = world.freeManagers.filter((m) => m.id !== manager.id);
    manager.clubId = club.id;
    manager.tenure = 0;
    manager.joblessSeasons = 0;
    manager.history.push({ club: club.name, from: world.season, to: null, reason: null });
    MG.clubs.onManagerAppointed(club, manager);
    // The manager imposes his own football on the club.
    club.tacticalStyle = manager.tactic;
    world.invalidateProfile(club.id);
    if (!o.quiet) {
      world.report(`${club.name} appoint ${manager.name} (${manager.archetypeName}, ${manager.tactic}).`, "hire", club.id);
    }
    return manager;
  }

  function removeManager(world, club, reason) {
    const manager = world.managerById(club.managerId);
    if (!manager) return null;
    const entry = manager.history[manager.history.length - 1];
    if (entry && entry.to == null) { entry.to = world.season; entry.reason = reason; }
    manager.clubId = null;
    manager.tenure = 0;
    club.managerId = null;
    world.freeManagers.push(manager);
    world.invalidateProfile(club.id);
    return manager;
  }

  /* ------------------------------ WORLD API ------------------------------- */
  function attachApi(world) {
    world.clubById = (id) => world.clubIndex[id];
    world.managerById = (id) => (id == null ? null : world.managerIndex[id] || null);
    world.clubsInLeague = (leagueId) => world.clubs.filter((c) => c.leagueId === leagueId);
    world.clubByName = (name) => world.clubs.find((c) => c.name === name);

    /* Profiles are cached per club AND per competition, because a club that
     * has pointed its season at the cup is a different side on a Tuesday night
     * than it is on a Saturday. */
    world.profile = (clubId, competition) => {
      const comp = competition || "league";
      const key = `${clubId}|${comp}`;
      let p = world._profiles[key];
      if (!p) {
        const club = world.clubIndex[clubId];
        p = MG.match.teamProfile(club, world.managerById(club.managerId));
        const bonus = MG.clubs.focusBonus(club, comp);
        p.attack += bonus; p.midfield += bonus; p.defence += bonus;
        world._profiles[key] = p;
      }
      p.form = world.clubIndex[clubId].form || 0;
      return p;
    };
    world.invalidateProfile = (clubId) => {
      for (const k of Object.keys(world._profiles)) {
        if (k === String(clubId) || k.startsWith(`${clubId}|`)) delete world._profiles[k];
      }
    };
    world.selection = (clubId) => {
      let s = world._selections[clubId];
      if (!s) {
        const club = world.clubIndex[clubId];
        s = world._selections[clubId] = MG.match.buildSelection(club, world.managerById(club.managerId), world.rng);
      }
      return s;
    };

    world.recordManagerResult = (clubId, gf, ga) => {
      const club = world.clubIndex[clubId];
      const manager = world.managerById(club.managerId);
      // Momentum, the same shape as 1000goals: a win nudges a side up, a defeat
      // knocks it down further, and it decays back toward neutral.
      const delta = gf > ga ? 0.5 : gf === ga ? -0.15 : -0.55;
      club.form = clamp((club.form || 0) * 0.94 + delta, -3, 3);
      if (!manager) return;
      manager.record.played++;
      if (gf > ga) manager.record.won++;
      else if (gf === ga) manager.record.drawn++;
      else manager.record.lost++;
    };

    world.report = (text, type, clubId) => {
      world.news.push({ season: world.season, year: world.year, type: type || "news", text, clubId: clubId || null });
      if (world.news.length > 4000) world.news.splice(0, world.news.length - 4000);
      return text;
    };

    world.prepareSeason = () => prepareSeason(world);
    world.advanceSeason = () => advanceSeason(world);
    world.leagueTable = (leagueId) => {
      const last = world.history[world.history.length - 1];
      return last && last.leagues[leagueId] ? last.leagues[leagueId].table : null;
    };
    /* The managed club's own matches, kept so the season can be told back to
     * the player. Only his club — 46 records a season instead of five thousand,
     * which is what makes narrating a season affordable in a game that
     * simulates ten divisions in under half a second. */
    world.playerMatches = [];
    world.recordPlayerMatch = (m) => {
      if (!world.playerClubId) return;
      world.playerMatches.push(m);
    };
    /* The prospects a club has out getting games elsewhere. They live in the
     * loan club's squad, so without this the manager loses sight of his own
     * players the moment he sends them away. */
    world.loanedOut = (clubId) => {
      const out = [];
      for (const c of world.clubs) {
        for (const p of c.squad) if (p.loan && p.loan.parentId === clubId) out.push({ player: p, at: c });
      }
      return out;
    };
    world.newsFor = (clubId, limit) =>
      world.news.filter((n) => n.clubId === clubId).slice(-(limit || 20)).reverse();
    world.recentNews = (limit) => world.news.slice(-(limit || 40)).reverse();
  }

  /* ---------------------------- SEASON SET-UP ----------------------------- */
  function prepareSeason(world) {
    world._profiles = {};
    world._selections = {};
    for (const club of world.clubs) {
      club.form = 0;
      // A club's target player level follows its division and its standing in
      // it, so a relegated club's recruitment drops to its new level and a
      // promoted one's rises — over transfer windows, not overnight.
      club.level = MG.clubs.playerLevelFor(club);
      /* Injuries are rolled here, before the ratings are computed, so the
       * attack rating a club carries into the season is the attack it can
       * actually field. This is the one place the squad you planned and the
       * squad you get come apart, and it is what makes depth worth paying for. */
      const risk = (club.modifiers && club.modifiers.injuryRisk) || 1;
      for (const p of club.squad) {
        MG.tactics.initMorale(p);
        const lastShare = p.season ? p.season.minutesShare || 0 : 0;
        p.lastLoad = lastShare;
        p.season = { apps: 0, goals: 0, assists: 0, minutesShare: 0, injured: 0, form: 1 };
        // Consistency roll: a metronome lands near 1.00 every year, a maverick
        // swings between a career season and a write-off.
        p.season.form = MG.ratings.rollSeasonForm(world.rng, p);
        p.season.injured = MG.players.rollInjury(world.rng, p, risk);
      }
      MG.clubs.refreshRatings(club);
      MG.clubs.setBudgets(club, world.rng);
    }
    // Targets need every club's ratings to be current, so they come second.
    for (const club of world.clubs) {
      MG.clubs.setSeasonTargets(club, world.clubsInLeague(club.leagueId), world.rng);
    }
    // Build selections up front so youth minutes are decided before a ball is
    // kicked — a manager picks his squad, he does not discover it in May.
    for (const club of world.clubs) world.selection(club.id);

    /* Fatigue can only be computed once minutes are known, so it lands here and
     * feeds the season as a form penalty. A side that leans on eleven men in a
     * high-pressing system arrives at the run-in tired; a rotated one does not.
     * This is what makes squad depth worth paying for. */
    for (const club of world.clubs) {
      const manager = world.managerById(club.managerId);
      const press = manager ? MG.managers.pressIntensity(manager.tactic) : 0.5;
      const xi = MG.tactics.effectiveXI(club);
      let total = 0, n = 0;
      for (const p of xi) {
        if (!p) continue;
        total += MG.ratings.fatigueFactor(p, press);
        n++;
      }
      const factor = n ? total / n : 1;
      club.modifiers.fatigue = factor;
      // A factor of 0.90 is a badly overworked side: worth about two points of
      // form across a campaign.
      club.modifiers.form += (factor - 1) * 20;
      world.invalidateProfile(club.id);
    }
  }

  /* ------------------------------ THE SEASON ------------------------------ */
  function advanceSeason(world) {
    const rng = world.rng;
    const seasonNews = [];
    const results = {};
    const carousel = [];
    // Last season's match record is done with; this season writes its own.
    world.playerMatches = [];

    /* ---- 1. every division, with a winter sacking window ---- */
    const midSeason = (leagueId, table) => {
      for (let i = 0; i < table.length; i++) {
        const club = world.clubById(table[i].clubId);
        const targets = club.board.targets;
        if (!targets) continue;
        const behind = (i + 1) - targets.position;
        const style = MG.clubs.BOARD_STYLES[club.board.style];
        // Only a real collapse gets you sacked in December, and only from a
        // board with a short fuse.
        const threshold = style.tolerance + 4;
        if (behind <= threshold) continue;
        // Grace is absolute in the winter window: a manager appointed last
        // summer is not sacked in his first December, however bad it looks.
        // Without this a career could end before its first board review.
        if (club.board.grace > 0) continue;
        const pressure = (behind - threshold) / 10;
        const odds = clamp(pressure * style.reactivity * 0.5, 0, 0.7);
        if (!rng.chance(odds)) continue;
        const out = removeManager(world, club, "sacked mid-season");
        club.board.confidence = clamp(club.board.confidence - 20, 0, 100);
        const replacement = hireFor(world, club, { midSeason: true });
        carousel.push({ club: club.name, out: out ? out.name : null, in: replacement ? replacement.name : null, reason: "mid-season sacking", season: world.season });
        world.report(
          `${club.name} sack ${out ? out.name : "their manager"} in ${leagueId === "PL" ? "the Premier League" : MG.clubs.LEAGUES[leagueId].name} with the side ${ordinal(i + 1)}${replacement ? ` — ${replacement.name} takes over` : ""}.`,
          "sack", club.id);
      }
    };

    for (const leagueId of MG.clubs.LEAGUE_KEYS) {
      const res = MG.competitions.runLeague(world, leagueId, { midSeason });
      if (res) results[leagueId] = res;
    }

    /* ---- 2. domestic cups, one per country ---- */
    const cupWinners = {};
    const cupExits = {};
    const countries = {};
    for (const club of world.clubs) (countries[club.country] = countries[club.country] || []).push(club);
    for (const [country, field] of Object.entries(countries)) {
      if (field.length < 8) continue;
      const cup = MG.competitions.runKnockout(world, field, { name: `${country} Cup` });
      if (!cup || !cup.winner) continue;
      cupWinners[country] = cup.winner.id;
      Object.assign(cupExits, cup.exits);
      cup.winner.history.cups++;
      MG.clubs.adjustReputation(cup.winner, 1);
      world.report(`${cup.winner.name} win the ${country === "England" ? "FA Cup" : `${country} Cup`}.`, "trophy", cup.winner.id);
    }

    /* ---- 3. Europe ---- */
    const euro = {};
    const euroPrize = {};
    /* Europe was running perfectly and was completely invisible: a club could
     * qualify, play a full continental campaign and go out in the quarter-finals
     * without a single word appearing anywhere, which is exactly why it read as
     * broken. Each club's run is stashed here and attached to its season outcome
     * below, so the log, the season review and the boardroom can all see it. */
    const euroRuns = {};
    const qualifiers = MG.competitions.europeanQualifiers(world._lastEuroQualification || results, cupWinners);
    for (const [comp, ids] of Object.entries(qualifiers)) {
      const field = ids.map((cid) => world.clubById(cid)).filter(Boolean);
      if (field.length < 4) continue;
      const run = MG.competitions.runKnockout(world, field, { name: comp, legs: 2, competition: "europe" });
      if (!run || !run.winner) continue;
      euro[comp] = run.winner.name;
      for (const [cid, label] of Object.entries(run.exits)) {
        euroPrize[cid] = (euroPrize[cid] || 0) + (MG.competitions.EURO_PRIZE[comp][label] || 0);
      }
      run.winner.history.europeanTitles++;
      MG.clubs.adjustReputation(run.winner, comp === "UCL" ? 3 : 1);
      world.report(`${run.winner.name} win the ${comp === "UCL" ? "Champions League" : comp === "UEL" ? "Europa League" : "Conference League"}.`, "trophy", run.winner.id);
      /* Europe was running perfectly and was completely invisible: a club could
       * qualify, play a full continental campaign and go out in the
       * quarter-finals without a single word appearing anywhere, which is why it
       * read as broken. The managed club's own run is now recorded on its
       * outcome so the log, the season review and the boardroom can all see it. */
      for (const [cid, label] of Object.entries(run.exits)) {
        euroRuns[cid] = { comp, round: label };
      }
      euroRuns[run.winner.id] = { comp, round: "W" };
    }
    world._lastEuroQualification = results;

    /* ---- 4. settle the season for every club: money, then the board ---- */
    const boardReports = {};
    for (const leagueId of Object.keys(results)) {
      const res = results[leagueId];
      const champion = world.clubById(res.table[0].clubId);
      champion.history.titles++;
      MG.clubs.adjustReputation(champion, MG.clubs.LEAGUES[leagueId].tier === 1 ? 2 : 1);
      const championManager = world.managerById(champion.managerId);
      if (championManager) championManager.honours.titles++;
      world.report(`${champion.name} win the ${MG.clubs.LEAGUES[leagueId].name}.`, "trophy", champion.id);

      res.table.forEach((row) => {
        const club = world.clubById(row.clubId);
        const cupLabel = cupExits[club.id] || "none";
        const prize = (MG.competitions.CUP_PRIZE[cupLabel] || 0) + (euroPrize[club.id] || 0);
        MG.clubs.settleFinances(club, row.position, res.fieldSize, prize);
        club.lastPosition = row.position;
        const selection = world.selection(club.id);
        const outcome = {
          season: world.season,
          position: row.position,
          fieldSize: res.fieldSize,
          champion: row.position === 1,
          cupRound: cupLabel,
          youthMinutesPct: selection ? selection.youthMinutesPct : 0,
          promoted: false, relegated: false,
          /* The division the season was actually PLAYED in. Promotion and
           * relegation move the club before the summary is written, so reading
           * club.leagueId afterwards had a Championship winner celebrating as
           * "champions of the Premier League" — the division they were about to
           * join rather than the one they had just won. */
          leagueId,
          // The European campaign, if there was one.
          europe: euroRuns[club.id] || null,
          // The raw season, carried through for the supporters: they judge how
          // watchable it was, not just where it finished.
          played: row.played, won: row.won, drawn: row.drawn, lost: row.lost,
          gf: row.gf, ga: row.ga, pts: row.pts,
        };
        club._outcome = outcome;
      });
    }

    /* ---- 5. promotion and relegation, before the boards pass judgement ---- */
    const moves = MG.competitions.runPromotionRelegation(world, results);
    for (const m of moves) {
      const club = world.clubByName(m.club);
      if (!club || !club._outcome) continue;
      if (m.type === "promoted") club._outcome.promoted = true;
      else club._outcome.relegated = true;
      const manager = world.managerById(club.managerId);
      if (manager) {
        if (m.type === "promoted") manager.honours.promotions++;
        else manager.honours.relegations++;
      }
      world.report(
        m.type === "promoted"
          ? `${club.name} are promoted to ${MG.clubs.LEAGUES[m.to].name}${m.viaPlayoff ? " through the play-offs" : ""}.`
          : `${club.name} are relegated to ${MG.clubs.LEAGUES[m.to].name}.`,
        m.type, club.id);
    }

    for (const club of world.clubs) {
      if (!club._outcome) continue;
      /* Mark every player in the world for the season he just had, before the
       * squads are aged and the numbers are gone. Doing it for all clubs rather
       * than just the managed one means a rival's squad reads the same way when
       * you scout it. */
      if (MG.narrative) MG.narrative.rateSquad(club, club._outcome);
      boardReports[club.id] = MG.clubs.evaluateSeason(club, club._outcome, rng);
      // Morale settles on what the season delivered and who got to play in it.
      MG.tactics.settleMorale(club, club._outcome);
      // The board judges the season the modifiers produced, then they expire.
      MG.clubs.decayModifiers(club);
      const manager = world.managerById(club.managerId);
      if (manager) {
        manager.tenure++;
        manager.record.seasons++;
        // A manager's standing follows what his board thinks of him, damped by
        // the size of club he is doing it at.
        const swing = boardReports[club.id].total * 6 + (club.reputation - manager.reputation) * 0.12;
        manager.reputation = clamp(Math.round(manager.reputation + swing), 3, 99);
      }
    }

    /* The managed club gets a written season summary in its log — the digest
     * 1000goals ends a season with, so the feed reads as a story rather than a
     * pile of disconnected lines. Pushed here, once the board has ruled, so it
     * sits directly beneath the summer that follows it in the newest-first log. */
    if (world.playerClubId) {
      const pc = world.clubById(world.playerClubId);
      if (pc && pc._outcome) writeSeasonSummary(world, pc, boardReports[pc.id]);
    }

    /* ---- 6. managers age out, then the carousel ---- */
    carousel.push(...retireManagers(world));
    carousel.push(...runCarousel(world));

    /* ---- 7. awards ---- */
    const awards = computeAwards(world, results, boardReports);

    /* ---- 8. the summer ---- */
    /* The international season runs behind the club game: caps and goals are
     * awarded now, so the development pass that follows can read them. */
    const intlNews = MG.international ? MG.international.runSeason(world) : [];
    for (const n of intlNews) world.report(n.text, n.type, n.clubId);
    MG.transfers.developSquads(world);
    /* Loanees develop on the minutes they got at the club they were lent to,
     * so they come home AFTER the development pass and before contracts are
     * settled — his deal is with his parent club, not the one he played for. */
    const loanReturns = MG.transfers.returnLoans(world);
    const { news: retireNews, freeAgents } = MG.transfers.retirementsAndExpiries(world);
    for (const club of world.clubs) MG.clubs.refreshRatings(club);
    for (const club of world.clubs) MG.clubs.setBudgets(club, rng);
    /* The managed club's own instructions are executed before the AI window
     * opens — you get first refusal on your own targets, and the world reacts
     * to a squad you have already changed. */
    let managerWindow = null;
    if (world.playerClubId) {
      const pc = world.clubById(world.playerClubId);
      if (pc) {
        managerWindow = MG.transfers.executeManagerRequests(world, pc);
        // The player's own dealings belong in the Club Log — the report's rule
        // that everything touching your club shows up in your own feed.
        for (const b of managerWindow.bought) world.report(`IN — ${b.player.name} (${b.player.pos}, ${Math.round(b.player.overall)}) signs from ${b.from} for ${money(b.fee)}.`, "transfer", pc.id);
        for (const s of managerWindow.sold) world.report(`OUT — ${s.player.name} joins ${s.to} for ${money(s.fee)}.`, "transfer", pc.id);
        // The board reporting back on what it tried and could not do — the log
        // is where the manager sees the deals that fell through, not just the
        // ones that landed.
        for (const r of managerWindow.refused) world.report(`NO DEAL — ${r.player.name}: ${r.reason}.`, "sack", pc.id);
      }
    }
    const window = MG.transfers.runWindow(world);
    const freeNews = MG.transfers.signFreeAgents(world, freeAgents) || [];
    const fillerNews = MG.transfers.topUpSquads(world) || [];
    const youthNews = MG.transfers.youthIntake(world);
    // The academy year: train, promote or release, then take a new intake.
    const academyNews = MG.youth ? MG.youth.runSeason(world) : [];
    // Last job of the summer: the blocked prospects go out to find games.
    const loansOut = MG.transfers.runLoans(world);
    for (const club of world.clubs) {
      MG.clubs.refreshRatings(club);
      delete club._outcome;
    }

    for (const n of retireNews.concat(window.news.slice(0, 60)).concat(youthNews)
      .concat(loanReturns).concat(loansOut.news).concat(freeNews).concat(fillerNews).concat(academyNews)) {
      world.report(n.text, n.type, n.clubId);
      seasonNews.push(n);
    }

    /* ---- 9. roll the calendar ---- */
    const summary = {
      season: world.season,
      year: world.year,
      leagues: results,
      cups: cupWinners,
      europe: euro,
      moves,
      carousel,
      awards,
      transferCount: window.deals,
      contestedDeals: window.contested || 0,
      transferRejections: window.rejections || 0,
      loansOut: loansOut.sent,
      bigTransfers: window.news.length,
      managerWindow,
      news: world.news.filter((n) => n.season === world.season),
    };
    world.history.push(summary);
    if (world.history.length > 60) world.history.shift();

    world.season++;
    world.year++;
    for (const m of world.freeManagers) m.joblessSeasons++;
    world.prepareSeason();
    return summary;
  }

  /* Managers get a year older every season and eventually stop. This is what
   * guarantees the top of the game turns over on a long save: without it the
   * same eight elite names hold the same eight elite jobs forever, because a
   * winning manager is never sacked and never poached. */
  function retireManagers(world) {
    const rng = world.rng;
    const events = [];
    const going = [];
    for (const m of world.managers) {
      m.age++;
      if (m.isPlayer) continue;
      const odds = m.age >= 72 ? 1 : m.age >= 68 ? 0.45 : m.age >= 64 ? 0.22 : m.age >= 60 ? 0.10 : 0;
      // A manager out of work for years drifts out of the game earlier.
      const drift = !m.clubId && m.joblessSeasons >= 4 ? 0.3 : 0;
      if (odds + drift > 0 && rng.chance(odds + drift)) going.push(m);
    }
    for (const m of going) {
      const club = m.clubId ? world.clubById(m.clubId) : null;
      if (club) {
        removeManager(world, club, "retired");
        world.report(
          `${m.name} retires at ${m.age} after ${m.record.seasons} seasons in management — ${m.honours.titles} league title${m.honours.titles === 1 ? "" : "s"}, ${m.honours.cups} cup${m.honours.cups === 1 ? "" : "s"}, ${m.honours.promotions} promotion${m.honours.promotions === 1 ? "" : "s"}.`,
          "retirement", club.id);
        events.push({ club: club.name, out: m.name, in: null, reason: "retired", season: world.season });
      }
      m.retired = true;
      world.freeManagers = world.freeManagers.filter((x) => x.id !== m.id);
      world.managers = world.managers.filter((x) => x.id !== m.id);
      delete world.managerIndex[m.id];
    }
    // Keep a supply of coaches coming through, or the pool empties out.
    while (world.freeManagers.length < 30) {
      const rookie = MG.managers.generate(rng, clamp(Math.round(rng.between(8, 55)), 4, 80));
      rookie.age = rng.int(33, 46);
      world.managers.push(rookie);
      world.managerIndex[rookie.id] = rookie;
      world.freeManagers.push(rookie);
    }
    return events;
  }

  /* --------------------------- THE SEASON DIGEST ---------------------------
   * One block of lines closing off the season for the managed club: how it
   * finished, who carried it, what the cup did, and what the boardroom and the
   * stands made of it. The rest of the log is events as they happen; this is
   * the paragraph that ties them together. */
  const CUP_WORDS = { none: "did not enter", R1: "went out in the first round", R2: "went out in the second round",
    R3: "went out in the third round", R4: "went out in the fourth round", R5: "went out in the fifth round",
    QF: "reached the quarter-final", SF: "reached the semi-final", F: "reached the final", W: "WON THE CUP" };

  function writeSeasonSummary(world, club, report) {
    const o = club._outcome;
    const league = MG.clubs.LEAGUES[o.leagueId || club.leagueId];
    const label = `${world.year}/${String(world.year + 1).slice(2)}`;
    const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

    const headline = o.champion ? `CHAMPIONS of the ${league.name}`
      : o.promoted ? `PROMOTED out of the ${league.name}`
        : o.relegated ? `RELEGATED from the ${league.name}`
          : `${ord(o.position)} in the ${league.name}`;
    world.report(`— ${label} SEASON REVIEW — ${headline}, ${o.pts} points from ${o.played} games (${o.won}W ${o.drawn}D ${o.lost}L, ${o.gf} scored, ${o.ga} conceded).`, "season", club.id);

    // Who actually did it.
    const scorers = club.squad.slice().filter((p) => p.season.goals > 0).sort((a, b) => b.season.goals - a.season.goals);
    if (scorers.length) {
      const top = scorers[0];
      const rest = scorers.slice(1, 3).map((p) => `${p.name} ${p.season.goals}`).join(", ");
      world.report(`Top scorer: ${top.name} with ${top.season.goals} in ${top.season.apps} appearances${rest ? ` · then ${rest}` : ""}.`, "season", club.id);
    }
    world.report(`Cup: the club ${CUP_WORDS[o.cupRound] || "did not enter"}.`, "season", club.id);
    if (o.europe) {
      const compName = o.europe.comp === "UCL" ? "the Champions League"
        : o.europe.comp === "UEL" ? "the Europa League" : "the Conference League";
      world.report(o.europe.round === "W"
        ? `EUROPE: CHAMPIONS OF ${compName.toUpperCase()}.`
        : `Europe: in ${compName}, the club ${CUP_WORDS[o.europe.round] || "went out early"}.`, "season", club.id);
    }

    /* The matches that decided it, each with the reason it went that way —
     * read off the expected goals the engine already computed rather than
     * invented after the fact. */
    if (MG.narrative) {
      for (const line of MG.narrative.seasonStory(world, club, o)) {
        world.report(line, "match", club.id);
      }
    }

    // The two verdicts that matter, side by side.
    if (report) {
      world.report(`The boardroom: "${report.verdict}" — confidence ${report.swing >= 0 ? "+" : ""}${report.swing} to ${Math.round(report.confidence)}/100.`, "season", club.id);
      const f = report.fans;
      if (f) {
        const why = (f.notes || []).concat((f.eventNotes || []).map((n) => n.reason)).slice(0, 3);
        world.report(`The supporters: ${f.mood.label.toLowerCase()} (${f.score}/100, ${f.swing >= 0 ? "+" : ""}${f.swing})${why.length ? ` — ${why.join("; ")}` : ""}.`, "season", club.id);
      }
    }
  }

  /* ----------------------------- THE CAROUSEL ----------------------------- */
  function runCarousel(world) {
    const rng = world.rng;
    const events = [];
    const vacancies = [];

    for (const club of world.clubs) {
      if (!club.managerId) { vacancies.push(club); continue; }
      if (!MG.clubs.wantsSacking(club, rng)) continue;
      const out = removeManager(world, club, "sacked");
      // A club can point at a manager the index cannot resolve. That should not
      // happen, but a broken pointer must cost one log line rather than the
      // whole career, so the vacancy is still opened and the season continues.
      if (!out) { vacancies.push(club); continue; }
      const report = club.board.report;
      world.report(
        `${club.name} part company with ${out.name} after ${out.record.seasons} season${out.record.seasons === 1 ? "" : "s"} — the board's verdict: ${report ? report.verdict.toLowerCase() : "unacceptable"}.`,
        "sack", club.id);
      events.push({ club: club.name, out: out.name, in: null, reason: "sacked", season: world.season });
      vacancies.push(club);
    }

    // Biggest clubs pick first, and their picks open the vacancies below them.
    vacancies.sort((a, b) => b.reputation - a.reputation);
    const queue = vacancies.slice();
    let guard = 0;
    while (queue.length && guard++ < 400) {
      const club = queue.shift();
      if (club.managerId) continue;
      const hired = hireFor(world, club, { queue });
      const ev = events.find((e) => e.club === club.name && !e.in);
      if (ev) ev.in = hired ? hired.name : null;
      else events.push({ club: club.name, out: null, in: hired ? hired.name : null, reason: "vacancy", season: world.season });
    }
    return events;
  }

  /** Fill one vacancy. Poaching an employed manager pushes his old club onto
   *  the queue, which is what makes the churn cascade down the pyramid. */
  function hireFor(world, club, opts) {
    const o = opts || {};
    const rng = world.rng;
    const candidates = [];

    for (const m of world.freeManagers) {
      candidates.push({ manager: m, from: null, score: MG.managers.candidateScore(m, club, rng) });
    }
    // Employed managers are only approached by clubs meaningfully bigger than
    // their own — and a mid-season vacancy rarely prises anyone away at all.
    if (!o.midSeason) {
      for (const m of world.managers) {
        if (!m.clubId || m.isPlayer) continue;
        const from = world.clubById(m.clubId);
        if (!from || from.id === club.id) continue;
        if (!MG.managers.wouldMove(m, from, club)) continue;
        candidates.push({ manager: m, from, score: MG.managers.candidateScore(m, club, rng) * 1.05 });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    let chosen = candidates[0];
    // Boards do not always get their first choice.
    if (candidates.length > 2 && rng.chance(0.3)) chosen = rng.pick(candidates.slice(0, 3));

    if (!chosen || chosen.score < club.reputation * 0.25) {
      // Nobody suitable: the club appoints an unknown.
      const rookie = MG.managers.generate(rng, clamp(club.reputation - rng.int(5, 20), 3, 90));
      world.managers.push(rookie);
      world.managerIndex[rookie.id] = rookie;
      return appointManager(world, club, rookie);
    }

    if (chosen.from) {
      removeManager(world, chosen.from, "left for another club");
      world.report(`${chosen.manager.name} leaves ${chosen.from.name} to take charge of ${club.name}.`, "hire", club.id);
      if (o.queue) o.queue.push(chosen.from);
      else if (chosen.from) {
        // Mid-season poaching still has to leave someone in the dugout.
        hireFor(world, chosen.from, { midSeason: true });
      }
      appointManager(world, club, chosen.manager, { quiet: true });
      return chosen.manager;
    }
    return appointManager(world, club, chosen.manager);
  }

  /* -------------------------------- AWARDS -------------------------------- */
  function computeAwards(world, results, boardReports) {
    let topScorer = null;
    for (const club of world.clubs) {
      for (const p of club.squad) {
        if (!topScorer || p.season.goals > topScorer.goals) {
          topScorer = { name: p.name, club: club.name, goals: p.season.goals, playerId: p.id, league: club.leagueId };
        }
      }
    }
    // One per division. The field is taken from the division's own table, not
    // from who is in the division now — promotion and relegation have already
    // been applied by this point, and a Championship top scorer should not be
    // handed the Premier League's Golden Boot on his way up.
    const goldenBoots = {};
    for (const leagueId of Object.keys(results)) {
      let best = null;
      for (const row of results[leagueId].table) {
        const club = world.clubById(row.clubId);
        if (!club) continue;
        for (const p of club.squad) {
          if (!best || p.season.goals > best.goals) best = { name: p.name, club: club.name, goals: p.season.goals };
        }
      }
      if (best) goldenBoots[leagueId] = best;
    }

    let managerOfYear = null;
    for (const club of world.clubs) {
      const report = boardReports[club.id];
      const manager = world.managerById(club.managerId);
      if (!report || !manager) continue;
      // Overachievement against the board's brief, weighted by how hard the
      // brief was — winning the National League is not Manager of the Year.
      const score = report.total * 10 + MG.clubs.LEAGUES[club.leagueId].prestige * 6;
      if (!managerOfYear || score > managerOfYear.score) {
        managerOfYear = { name: manager.name, club: club.name, score: round1(score), verdict: report.verdict };
      }
    }
    return { topScorer, goldenBoots, managerOfYear };
  }

  function money(m) {
    const a = Math.abs(m);
    if (a >= 1000) return `£${(m / 1000).toFixed(1)}bn`;
    if (a >= 10) return `£${Math.round(m)}m`;
    if (a >= 0.1) return `£${m.toFixed(1)}m`;
    return `£${Math.round(m * 1000)}k`;
  }
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  MG.world = { createWorld, REAL_MANAGERS, appointManager, removeManager, hireFor, fitPlayerScale, ordinal };
})(typeof globalThis !== "undefined" ? globalThis : this);
