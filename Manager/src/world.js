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

    // Real nationalities for ~2,000 players (Premier League plus the five
    // foreign-database leagues — see src/data_foreign.js), sourced from an
    // actual squad report rather than the league-weighted roll every
    // uncovered player still falls back to. This layers ON TOP OF names.js's
    // own REAL_NATIONALITY table (530 hand-checked PL entries, loaded at
    // module init) — where the two disagree, this newer, wider report wins,
    // since it is the more recent authoritative source. Anything neither
    // table covers still falls back to the league-weighted roll, unchanged.
    if (MG.dataForeign && MG.dataForeign.NATIONALITY) {
      MG.names.setNationalities(MG.dataForeign.NATIONALITY);
    }

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
        MG.players.recordMove(player, club.name, world.season, { initial: true });
        return player;
      });
      realSquads.push(club);
    }

    /* ---- squads: real LaLiga/Bundesliga/SerieA/Saudi/MLS data next ----
     * src/data_foreign.js carries real names, positions, nationalities and
     * EA-FC-26-scale attributes for the clubs in those five leagues a squad
     * report actually covered (see MG.players.fromForeign for the
     * conversion). A club with no entry there still falls through to the
     * generated squad below, exactly as it always did. */
    for (const club of world.clubs) {
      if (club.squad.length) continue;
      const raw = MG.dataForeign && MG.dataForeign.SQUADS[club.name];
      if (!raw || !raw.length) continue;
      club.squad = raw.map((p) => {
        const player = MG.players.fromForeign(world.rng, p, club.leagueId);
        player.clubId = club.id;
        MG.players.recordMove(player, club.name, world.season, { initial: true });
        return player;
      });
      // The report is deliberately a CORE first-team squad, not a full 26-man
      // registered list — some clubs list as few as four players, several
      // list no goalkeeper at all. Filled out to the same shape every other
      // squad in the world has, exactly as a club with no real data at all
      // gets built (generateSquad below), so relegation, rotation and squad
      // audits never see a real club fielding a nine-man squad.
      topUpForeignSquad(world.rng, club);
      realSquads.push(club);
    }

    // A named sub-stream of its own (see rng.js), so relabelling a generated
    // squad with real names can never shift a single draw anything else in
    // the simulation makes — this is cosmetic and must stay that way.
    const introRng = MG.createRng(world.seed, "intl-names");
    for (const club of world.clubs) {
      club.level = MG.clubs.playerLevelFor(club);
      if (club.squad.length) continue;
      club.squad = generateSquad(world.rng, club);
      applyRealNamesIntl(introRng, club);
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

    /* The radar's per-axis ruler, fitted from the population that was just
     * built — see ratings.fitRadarScale. Has to happen after the squads exist
     * and before anything draws a profile. */
    if (MG.ratings.fitRadarScale) MG.ratings.fitRadarScale(world);

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
        // Only ever called at world creation (season 1) — this is a player's
        // starting club, not a move, so the season is simply known rather
        // than threaded through as a parameter nothing else needs.
        MG.players.recordMove(p, club.name, 1, { initial: true });
        squad.push(p);
      }
    }
    return squad;
  }

  /** Tops up a real-data squad (foreign database) to every position's full
   *  complement — see the call site above for why this is needed: the source
   *  report is a first-team core, not a registered 26-man squad. Same
   *  per-slot shape as generateSquad (starters near the club's level, depth
   *  below it) so a topped-up club reads no differently to one built
   *  entirely from scratch. club.level is not set yet at this point in
   *  createWorld, so computed directly here rather than read off the club. */
  function topUpForeignSquad(rng, club) {
    const level = MG.clubs.playerLevelFor(club);
    const have = {};
    for (const p of club.squad) have[p.pos] = (have[p.pos] || 0) + 1;
    for (const pos of MG.players.POSITION_KEYS) {
      const def = MG.players.POSITIONS[pos];
      const already = have[pos] || 0;
      for (let i = already; i < def.need; i++) {
        const drop = i < def.starters ? rng.between(-1, 3) : rng.between(3, 11);
        const age = i < def.starters ? rng.int(21, 32) : rng.chance(0.45) ? rng.int(17, 21) : rng.int(22, 34);
        const p = MG.players.generate(rng, {
          league: club.leagueId, pos, age, target: level - drop, spread: 3.2,
        });
        p.clubId = club.id;
        MG.players.recordMove(p, club.name, 1, { initial: true });
        club.squad.push(p);
      }
    }
  }

  /* Real names, ages and positions for 63 clubs outside the Premier League —
   * see src/data_intl.js. Unlike the PL database this carries no attribute
   * ratings, so it never replaces a squad, only relabels the best-fitting
   * generated player in each position: the club still plays at its calibrated
   * level, it just does it with the actual players who play for it. Best
   * generated player in a position gets the best-known real name in that
   * position, so a club's real stars land on its real starting shirts rather
   * than being handed out at random. */
  function applyRealNamesIntl(rng, club) {
    const roster = MG.dataIntl && MG.dataIntl.REAL_SQUADS_INTL[club.name];
    if (!roster) return;
    const byPos = {};
    for (const p of club.squad) (byPos[p.pos] = byPos[p.pos] || []).push(p);
    const rosterByPos = {};
    for (const r of roster) (rosterByPos[r.pos] = rosterByPos[r.pos] || []).push(r);
    for (const [pos, reals] of Object.entries(rosterByPos)) {
      const need = (MG.players.POSITIONS[pos] || {}).need || 0;
      // generateSquad builds each position's slots quality-first, so index-
      // aligning the two lists puts a club's biggest real name on its best
      // generated shirt in that position, without knowing anything about who
      // any of these procedural players actually are.
      const slots = (byPos[pos] || []).slice(0, need);
      const count = Math.min(slots.length, reals.length);
      for (let i = 0; i < count; i++) {
        const real = reals[i], slot = slots[i];
        slot.name = real.name;
        slot.nationality = MG.names.knownNationality(real.name) || slot.nationality;
        if (real.age != null && real.age !== slot.age) {
          slot.age = real.age;
          // The generated potential was rolled against the generated age;
          // re-roll it now the age is a real one, or a real 18-year-old can
          // end up with a veteran's flat ceiling.
          slot.potential = MG.players.rollPotential(rng, slot.overall, slot.age);
        }
      }
    }
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
    // He is employed again; the "just left" block is spent.
    manager._leftClubId = null;
    manager._leftSeason = null;
    manager.history.push({ club: club.name, from: world.season, to: null, reason: null });
    MG.clubs.onManagerAppointed(club, manager);
    // The manager imposes his own football on the club.
    club.tacticalStyle = manager.tactic;
    // And a training focus that suits how he actually wants to play — the
    // player can override it like any other tactics-screen lever, and the AI
    // never revisits it once it is set. See tactics.js's synergy system.
    club.trainingFocus = MG.tactics && MG.tactics.autoTrainingFocus ? MG.tactics.autoTrainingFocus(manager) : "balanced";
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
    /* Who he just left, and when. A board that has this afternoon sacked its
     * manager must not appoint the same man this evening — which is exactly
     * what happened in a live save: Chelsea sacked a manager and then hired him
     * straight back, because hireFor scored every free manager on merit and the
     * best free manager available was, inevitably, the one they had just let
     * go. Read by hireFor; cleared when he takes a job somewhere. */
    manager._leftClubId = club.id;
    manager._leftSeason = world.season;
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
        p = MG.match.teamProfile(club, world.managerById(club.managerId), comp);
        const bonus = MG.clubs.focusBonus(club, comp);
        p.attack += bonus; p.midfield += bonus; p.defence += bonus;
        /* And how the side is set up for THIS block — push on, sit in, or the
         * shape they drilled in pre-season. Applied here rather than baked into
         * club.ratings because it lasts two months, not a season, and the
         * profile cache is already dropped at every block boundary. */
        if (MG.blocks) {
          const shift = MG.blocks.shiftFor(club);
          p.attack += shift.attack;
          p.defence += shift.defence;
          p.midfield += shift.midfield || 0;
        }
        /* teamProfile's own `form` is club.form (momentum) PLUS
         * modifiers.form (a decision card's season-long swing) PLUS a morale
         * term — see match.js. Momentum is the one part of that sum which
         * changes on every match without the cache being invalidated
         * (recordManagerResult updates it after every result deliberately
         * without paying for a full profile rebuild), so it has to be
         * refreshed below on every read. Isolating it here, once, at build
         * time is what lets that refresh add fresh momentum back onto the
         * OTHER two terms rather than replacing the whole sum with momentum
         * alone — which is what the line below used to do. Every decision
         * card whose effect is a form swing (ninety-plus of them) was
         * discarded here the instant it was computed: form(n) added the
         * points, teamProfile summed them in correctly, and this line threw
         * the sum away and substituted momentum on its own, every single
         * time a profile was read for a match. */
        p._staticForm = p.form - (club.form || 0);
        world._profiles[key] = p;
      }
      p.form = (world.clubIndex[clubId].form || 0) + (p._staticForm || 0);
      return p;
    };
    world.invalidateProfile = (clubId) => {
      for (const k of Object.keys(world._profiles)) {
        if (k === String(clubId) || k.startsWith(`${clubId}|`)) delete world._profiles[k];
      }
    };
    /* A selection is only valid for the squad it was built from.
     *
     * It used to be cached until prepareSeason wiped the lot, which was fine
     * while squads only ever changed in the summer — after the last ball of
     * the season and before the next selection was built. The human club
     * breaks that assumption every single year: prepareSeason builds its
     * selection at the END of the previous advanceSeason, and the transfer
     * window, the pre-season cards and now the early-season window all
     * change the squad AFTER that. The consequence was silent and severe —
     * a marquee signing was not in the cached selection, so he played no
     * games and scored no goals all season, while his OLD club's cached
     * selection still listed him and went on crediting him with the
     * appearances and goals from ITS fixtures. Measured on a test save:
     * Salah signed for Manchester City, finished the season on 0 apps for
     * City and 32 apps / 18 goals generated by Liverpool's matches.
     *
     * Keying on the squad's own fingerprint fixes it for every path at once
     * — a signing, a sale, a youth promotion, a vetoed transfer — without
     * needing every caller to remember to invalidate. */
    world.selection = (clubId) => {
      const club = world.clubIndex[clubId];
      const stamp = MG.tactics ? MG.tactics.squadStamp(club) : club.squad.length;
      let s = world._selections[clubId];
      if (!s || s.stamp !== stamp) {
        /* Its own stream, NOT world.rng. Building a selection draws a rotation
         * jitter per player, so while it drew from the shared sequence the
         * simulation's numbers depended on WHEN this cache happened to miss —
         * and the cache is derived state that a save throws away. Loading a
         * mid-season save rebuilt every selection at once, spent draws the
         * original run had spent much earlier, and the rest of the campaign
         * came out different: same seed, same squads, same tables, different
         * season. Keyed on the squad stamp, so a signing still reshuffles the
         * pecking order — it just does it reproducibly. */
        /* The block and the squad plan are part of the key: rotating in October
         * has to produce a different set of minutes from rotating in August, or
         * "rotate" means picking the same eleven with a different label on it. */
        const S = world.seasonState;
        const plan = MG.blocks ? MG.blocks.planFor(club).squad : "";
        const rng = MG.createRng(`${world.seed}|selection|${clubId}|${stamp}|${S ? S.block : 0}|${plan}`);
        s = world._selections[clubId] = MG.match.buildSelection(club, world.managerById(club.managerId), rng);
        s.stamp = stamp;
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

    // A stable, ever-increasing id on every entry — what the notification
    // system uses to know which lines the manager has already seen, since
    // array position shifts every time the 4000-entry buffer trims.
    let _newsSeq = 0;
    world.report = (text, type, clubId) => {
      world.news.push({ id: ++_newsSeq, season: world.season, year: world.year, type: type || "news", text, clubId: clubId || null });
      if (world.news.length > 4000) world.news.splice(0, world.news.length - 4000);
      return text;
    };

    world.prepareSeason = () => prepareSeason(world);
    world.advanceSeason = () => advanceSeason(world);
    world.beginSeason = () => beginSeason(world);
    /* The next two months, everywhere. Returns the block report for the
     * managed club — see the five-blocks header below. */
    world.playBlock = () => playBlock(world);
    world.blockPreview = () => blockPreview(world);
    world.blocksLeft = () => {
      const S = world.seasonState;
      return S && S.season === world.season ? Math.max(0, BLOCKS - S.block) : BLOCKS;
    };
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
      // Consumed here, not in decayModifiers — see clubs.js's decayModifiers
      // for why resetting it in both places made the whole lever dead.
      if (club.modifiers) club.modifiers.injuryRisk = 1;
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
      MG.clubs.setSeasonTargets(club, world.clubsInLeague(club.leagueId), world.rng, world.managerById(club.managerId));
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
  /* ======================= THE SEASON, IN FIVE BLOCKS ======================
   * A season used to be one simulation call with a single stop in it. That is
   * why the game read as flat: the manager picked a shape in July, watched a
   * third of a season, changed something, and then found out in one go how the
   * other two thirds had gone. Nothing he chose could be seen taking effect,
   * because there was never a moment small enough to see it in.
   *
   * So the campaign is now a STATE that gets played forward five times, in
   * two-month blocks, and the manager stands in the middle of it four times
   * over rather than once:
   *
   *     AUG-SEP   OCT-NOV   DEC-JAN   FEB-MAR   APR-MAY
   *        |         |         |         |         |
   *      block 1   block 2   block 3   block 4   block 5
   *
   * What changed structurally, and why each piece had to move:
   *
   *   - The WHOLE WORLD ticks together. Every division advances by a fifth
   *     each block, not just the managed one. A block report that showed the
   *     manager his own table while the rest of the world was still on zero
   *     games would be a lie he could read straight off the screen.
   *   - Cups and Europe are spread across blocks 2-5 instead of being played
   *     end-to-end after the league finished. A cup that resolves in one pass
   *     either happens entirely inside one block, or the manager learns he
   *     went out in the third round at the same moment he learns where he
   *     finished. Both are what the old build did, and both are why the cup
   *     never felt like part of the season.
   *   - Europe is entered on LAST season's finishing positions. It always
   *     should have been; the old code could get away with reading the
   *     current table because Europe ran after the league had already ended.
   *     Starting the continental campaign in October means the table it would
   *     have read does not exist yet. See seedEuroQualification for the one
   *     season that has nothing behind it.
   *
   * Everything from the final whistle onwards — money, the boardroom,
   * promotion and relegation, the carousel, the awards, the summer — is
   * untouched, and still runs exactly once, at the end of advanceSeason.
   *
   * advanceSeason itself is now a loop over playBlock followed by that
   * end-of-season half, so a headless world (every test harness, the realism
   * benchmark) plays precisely the same football as a managed one without
   * needing to know blocks exist at all. */
  const BLOCKS = 5;
  const BLOCK_NAMES = ["AUG–SEP", "OCT–NOV", "DEC–JAN", "FEB–MAR", "APR–MAY"];
  /* No cup football in the opening block: the league is what August is for,
   * and it keeps the first stop of a new season about the league table. */
  const CUP_FIRST_BLOCK = 2;

  /** How many rounds of a knockout should be complete by the end of block `b`,
   *  spread evenly so the final lands in the last block of the season. */
  function roundsDueBy(totalRounds, b) {
    if (b < CUP_FIRST_BLOCK) return 0;
    const span = BLOCKS - CUP_FIRST_BLOCK + 1;
    return Math.min(totalRounds, Math.ceil(totalRounds * (b - CUP_FIRST_BLOCK + 1) / span));
  }

  /* Advance every club's tactical clock — how many seasons running it has
   * played the same playstyle in the same shape, which is what tactics.js turns
   * into how thoroughly the division has worked it out.
   *
   * Called at KICK-OFF, from whichever entry point actually starts the season,
   * and stamped with the season so it can only ever run once per campaign.
   * Two things forced that shape:
   *
   *   - not prepareSeason, which runs at the tail of the PREVIOUS season's
   *     advanceSeason, before the manager has seen a pre-season card. Ageing
   *     there would read last season's set-up, so a summer switch of formation
   *     or philosophy would not take effect until the season after the one it
   *     was made for — and buying back the surprise for the campaign you
   *     changed for is the entire point of offering the choice.
   *   - not beginSeason alone, which returns early when no human is managing
   *     anyone. Every headless world (the benchmark harnesses, and any future
   *     spectate mode) would have left the clock frozen at one season forever,
   *     so the mechanic would have applied to the player and to nobody else.
   *
   * Profiles are dropped so the new reading actually reaches the pitch. */
  function ageSystems(world) {
    if (!MG.tactics.ageSystem) return;
    if (world._systemAgedSeason === world.season) return;
    for (const c of world.clubs) MG.tactics.ageSystem(c, world.managerById(c.managerId));
    world._systemAgedSeason = world.season;
    world._profiles = {};
  }

  /* The very first season of a save has no table behind it, and Europe is
   * entered on last season's finishing positions. Reputation is what the world
   * was built from in the first place, so it stands in for the season nobody
   * played — the clubs that would have qualified are the clubs the database
   * says are the biggest. */
  function seedEuroQualification(world) {
    const res = {};
    for (const leagueId of MG.competitions.EURO_LEAGUES) {
      const clubs = world.clubsInLeague(leagueId).slice().sort((a, b) => b.reputation - a.reputation);
      if (clubs.length < 7) continue;
      res[leagueId] = {
        leagueId, fieldSize: clubs.length,
        table: clubs.map((c, i) => ({ clubId: c.id, position: i + 1 })),
      };
    }
    return res;
  }

  /** Build the season's state — every division, every cup, Europe — or hand
   *  back the one already in flight. Idempotent, and keyed on the season, so
   *  neither beginSeason nor advanceSeason can start a campaign twice. */
  function ensureSeasonState(world) {
    if (world.seasonState && world.seasonState.season === world.season) return world.seasonState;
    ageSystems(world);
    /* A new season, so a new match record. This lives here rather than in
     * advanceSeason because advanceSeason runs at the END of a campaign the
     * blocks have already been recording: clearing there wiped everything the
     * manager had already seen results for. */
    world.playerMatches = [];

    const leagues = {};
    for (const leagueId of MG.clubs.LEAGUE_KEYS) {
      const st = MG.competitions.beginLeague(world, leagueId);
      if (st) leagues[leagueId] = st;
    }

    const cups = {};
    const countries = {};
    for (const club of world.clubs) (countries[club.country] = countries[club.country] || []).push(club);
    for (const [country, field] of Object.entries(countries)) {
      if (field.length < 8) continue;
      const st = MG.competitions.beginKnockout(world, field, { name: `${country} Cup` });
      if (!st) continue;
      st.country = country;
      st.totalRounds = MG.competitions.knockoutRoundsLeft(st);
      cups[country] = st;
    }

    const euro = {};
    const qualifiers = MG.competitions.europeanQualifiers(
      world._lastEuroQualification || seedEuroQualification(world),
      world._lastCupWinners || {});
    for (const [comp, ids] of Object.entries(qualifiers)) {
      const field = ids.map((cid) => world.clubById(cid)).filter(Boolean);
      if (field.length < 4) continue;
      const st = MG.competitions.beginKnockout(world, field, { name: comp, legs: 2, competition: "europe" });
      if (!st) continue;
      st.comp = comp;
      st.totalRounds = MG.competitions.knockoutRoundsLeft(st);
      euro[comp] = st;
    }

    world.seasonState = {
      season: world.season, block: 0,
      leagues, cups, euro,
      // Accumulated as the blocks are played; read by the end-of-season half.
      results: {}, cupWinners: {}, cupExits: {},
      euroNames: {}, euroPrize: {}, euroRuns: {},
      carousel: [], matchMark: 0,
    };
    return world.seasonState;
  }

  /* The winter sacking window. Lifted out of advanceSeason unchanged: a board
   * with a short fuse and a side well adrift of its brief pulls the trigger in
   * December rather than waiting for May. */
  function midSeasonReview(world, S, leagueId, table) {
    const rng = world.rng;
    for (let i = 0; i < table.length; i++) {
      const club = world.clubById(table[i].clubId);
      if (!club) continue;
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
      const odds = clamp(pressure * style.reactivity * 0.65, 0, 0.75);
      if (!rng.chance(odds)) continue;
      const out = removeManager(world, club, "sacked mid-season");
      club.board.confidence = clamp(club.board.confidence - 20, 0, 100);
      const replacement = hireFor(world, club, { midSeason: true });
      S.carousel.push({ club: club.name, out: out ? out.name : null, in: replacement ? replacement.name : null, reason: "mid-season sacking", season: world.season });
      world.report(
        `${club.name} sack ${out ? out.name : "their manager"} in ${leagueId === "PL" ? "the Premier League" : MG.clubs.LEAGUES[leagueId].name} with the side ${ordinal(i + 1)}${replacement ? ` — ${replacement.name} takes over` : ""}.`,
        "sack", club.id);
    }
  }

  function settleCup(world, S, st) {
    const cup = MG.competitions.finishKnockout(world, st);
    if (!cup || !cup.winner) return;
    S.cupWinners[st.country] = cup.winner.id;
    Object.assign(S.cupExits, cup.exits);
    cup.winner.history.cups++;
    MG.clubs.adjustReputation(cup.winner, 1);
    world.report(`${cup.winner.name} win the ${st.country === "England" ? "FA Cup" : `${st.country} Cup`}.`, "trophy", cup.winner.id);
  }

  function settleEurope(world, S, st) {
    const run = MG.competitions.finishKnockout(world, st);
    if (!run || !run.winner) return;
    const comp = st.comp;
    S.euroNames[comp] = run.winner.name;
    /* Europe was running perfectly and was completely invisible: a club could
     * qualify, play a full continental campaign and go out in the quarter-finals
     * without a single word appearing anywhere, which is exactly why it read as
     * broken. Each club's run is stashed here and attached to its season outcome
     * later, so the log, the season review and the boardroom can all see it. */
    for (const [cid, label] of Object.entries(run.exits)) {
      S.euroPrize[cid] = (S.euroPrize[cid] || 0) + (MG.competitions.EURO_PRIZE[comp][label] || 0);
      S.euroRuns[cid] = { comp, round: label };
    }
    S.euroRuns[run.winner.id] = { comp, round: "W" };
    run.winner.history.europeanTitles++;
    MG.clubs.adjustReputation(run.winner, comp === "UCL" ? 3 : 1);
    world.report(`${run.winner.name} win the ${comp === "UCL" ? "Champions League" : comp === "UEL" ? "Europa League" : "Conference League"}.`, "trophy", run.winner.id);
  }

  /** Play whatever rounds of a knockout are owed by the end of block `b`. */
  function playDueRounds(world, S, st, b, settle) {
    if (st.done) return;
    const due = roundsDueBy(st.totalRounds, b);
    let played = st.totalRounds - MG.competitions.knockoutRoundsLeft(st);
    while (played < due && !st.done) {
      MG.competitions.knockoutRound(world, st);
      played++;
    }
    if (st.done) settle(world, S, st);
  }

  /** Play the next two months of the season, everywhere. Returns the block
   *  report for the managed club, or null when nobody is managing. */
  function playBlock(world) {
    const S = ensureSeasonState(world);
    if (S.block >= BLOCKS) return blockReport(world, S, BLOCKS);
    const b = ++S.block;
    openBlock(world, S);

    for (const leagueId of Object.keys(S.leagues)) {
      const st = S.leagues[leagueId];
      const to = MG.competitions.leagueCut(st, b, BLOCKS);
      /* The winter window is a point in the CALENDAR, not a point in the block
       * list: a division of 20 and a division of 24 do not reach their halfway
       * matchday in the same block. Play up to it, hold the review, then carry
       * on to the end of the block. */
      const halfway = MG.competitions.leagueCut(st, 1, 2);
      if (!st.midSeasonDone && to >= halfway) {
        MG.competitions.advanceLeague(world, st, halfway);
        midSeasonReview(world, S, leagueId, MG.competitions.leagueStanding(st));
        st.midSeasonDone = true;
      }
      MG.competitions.advanceLeague(world, st, to);
      if (st.cursor >= st.fixtures.length && !S.results[leagueId]) {
        S.results[leagueId] = MG.competitions.finishLeague(st);
      }
    }

    for (const st of Object.values(S.cups)) playDueRounds(world, S, st, b, settleCup);
    for (const st of Object.values(S.euro)) playDueRounds(world, S, st, b, settleEurope);

    closeBlock(world, S);
    const report = blockReport(world, S, b);
    S.matchMark = (world.playerMatches || []).length;
    return report;
  }

  /* -------------------------- THE BLOCK BOUNDARY ---------------------------
   * Two months of football does things to the people who played it, and this
   * is where those things happen. openBlock decides how every side in the
   * world is setting up and remembers where they stood; closeBlock charges
   * them for it — fatigue, the treatment room, and the dressing room. See
   * blocks.js for the model itself. */
  function openBlock(world, S) {
    if (!MG.blocks) return;
    const rng = world.rng;
    for (const leagueId of Object.keys(S.leagues)) {
      const st = S.leagues[leagueId];
      const standing = MG.competitions.leagueStanding(st);
      standing.forEach((row, i) => {
        const club = world.clubById(row.clubId);
        if (!club) return;
        /* The managed club's plan is the manager's own, chosen on the block
         * start screen and left exactly as he set it. Everybody else's is
         * chosen for them, or his is the only lever being pulled in a
         * division of statues. */
        if (club.id !== world.playerClubId) MG.blocks.aiPlan(world, club, rng, i + 1);
        const plan = MG.blocks.planFor(club);
        /* CHANGING SHAPE IS AN EVENT, NOT A STATE. Left as a standing approach
         * it did two wrong things at once: the side kept paying the higher
         * running cost of a rebuild for ever, and the brief went on showing
         * "SWITCH TO 4-3-3" as the selected card while changing nothing —
         * plan.shape already equalled the formation, so the tap the manager
         * could see highlighted was doing nothing at all. You change shape,
         * and then you play it. */
        /* Read the focus the approach implies BEFORE spending the reshape,
         * or the one block that most needs to be drilling the new shape is the
         * one block that trains for nothing. */
        const implied = APPROACH_FOCUS(plan);
        if (plan.approach === "reshape") {
          if (plan.shape && plan.shape !== club.formation) MG.tactics.setFormation(club, plan.shape);
          plan.approach = "drilled";
          plan.shape = null;
        }
        /* The approach implies a training focus, but only while it is in
         * force. Without remembering what the manager actually chose, one
         * block of PUSH ON overwrote his pre-season training choice
         * permanently — going back to AS DRILLED restored nothing, because
         * the drilled approach names no focus of its own. The pre-season
         * control quietly stopped meaning anything after the first block. */
        if (implied) {
          if (!club._ownFocus) club._ownFocus = club.trainingFocus || "balanced";
          MG.tactics.setTrainingFocus(club, implied);
        } else if (club._ownFocus) {
          MG.tactics.setTrainingFocus(club, club._ownFocus);
          club._ownFocus = null;
        }
        MG.blocks.markBlockStart(club, row, club.id === world.playerClubId);
      });
    }
    // The plan changes what the side is worth and who plays in it.
    world._profiles = {};
    world._selections = {};
    MG.tactics.dropXICache();
  }
  const APPROACH_FOCUS = (plan) => {
    const a = MG.blocks.APPROACH[plan.approach];
    return a && a.focus ? a.focus : null;
  };

  function closeBlock(world, S) {
    if (!MG.blocks) return;
    const rng = world.rng;
    const touched = [];
    for (const leagueId of Object.keys(S.leagues)) {
      const st = S.leagues[leagueId];
      for (const clubId of st.clubIds) {
        const club = world.clubById(clubId);
        if (!club) continue;
        const row = st.table[clubId];
        const mark = club._blockMark || {};
        const blockResult = {
          played: (row ? row.played : 0) - (mark.played || 0),
          pts: (row ? row.pts : 0) - (mark.pts || 0),
        };
        const medical = MG.blocks.settleClub(world, club, rng);
        MG.blocks.settleMorale(club, blockResult);
        club._blockMedical = medical;
        touched.push(club);
      }
    }
    /* Fatigue is charged relative to the rest of the world, so the world's own
     * level has to be measured before it can be charged — see blocks.js.
     *
     * BEFORE the ratings refresh, not after. refreshRatings reads a player's
     * effective level, which reads fatigueRel, so re-rating first and
     * re-measuring second left every club in the world carrying the PREVIOUS
     * block's fatigue in its ratings — a whole two months out of date, all
     * season, every season. */
    MG.blocks.markFatiguePar(world.clubs);
    if (!MG.blocks.T || MG.blocks.T.refresh !== 0) {
      for (const club of touched) MG.clubs.refreshRatings(club);
    }
    /* Injuries and fatigue both change who is worth picking, so the cached
     * teams and profiles have to go — otherwise the man who broke his leg in
     * October keeps playing until somebody signs a striker. */
    world._profiles = {};
    world._selections = {};
    MG.tactics.dropXICache();
  }

  /* ---------------------------- THE BLOCK REPORT ---------------------------
   * What the manager is actually shown when the game stops. A superset of the
   * old early-season snapshot — every field it had is still here and still
   * means the same thing — plus what only makes sense now that there is more
   * than one stop: which block this is, how the last two months went as
   * opposed to the season so far, and where the club stands in the cup and in
   * Europe while both are still undecided. */
  function cupProgress(world, st, clubId, club) {
    if (!st) return null;
    const alive = st.alive.indexOf(clubId) >= 0 || st.waiting.indexOf(clubId) >= 0;
    const exit = st.exits[clubId] || null;
    if (!alive && !exit) return null;   // not in this competition at all
    const ties = st.log.filter((l) => l.home === club.name || l.away === club.name);
    const last = ties[ties.length - 1] || null;
    return {
      name: st.name, comp: st.comp || null, clubId,
      alive: alive && !st.done,
      won: exit === "W",
      round: exit && exit !== "W" ? exit : MG.competitions.roundLabel(st.roundsRemaining),
      lastTie: last,
      played: ties.length,
    };
  }

  /* The two or three players worth naming, best and worst. A block is eight
   * games — enough to have an opinion about, not enough to rank a squad. */
  function blockPerformers(club, row) {
    const ppg = row && row.played ? row.pts / row.played : 1.35;
    const rated = [];
    for (const p of club.squad) {
      const r = MG.blocks.blockRating(p, ppg);
      if (r && r.apps >= 2) rated.push({ id: p.id, name: p.name, pos: p.pos, ...r });
    }
    if (rated.length < 3) return rated;
    rated.sort((a, b) => b.rating - a.rating);
    // Two who deserve it and the one who does not — a review that only ever
    // praises is a review nobody reads twice.
    return [rated[0], rated[1], rated[rated.length - 1]];
  }

  function blockMedical(club, world) {
    const m = club._blockMedical || { hurt: [], returning: [] };
    const byId = {};
    for (const p of club.squad) byId[p.id] = p;
    const row = (id) => {
      const p = byId[id];
      return p ? { id: p.id, name: p.name, pos: p.pos } : null;
    };
    let tired = 0;
    for (const p of club.squad) if (MG.blocks.fatigueOf(p) >= 0.5) tired++;
    return {
      // A man sold between the injury and the report is simply gone.
      hurt: (m.hurt || []).map((h) => { const r = row(h.id); return r && { ...r, blocks: h.blocks }; }).filter(Boolean),
      back: (m.returning || []).map(row).filter(Boolean),
      tired,
    };
  }

  /* The board does not deliver a verdict until May — that is the point of the
   * annual review, and cheapening it would cost the one moment in the season
   * that genuinely lands. What it does do, every couple of months, is have an
   * opinion. Non-binding, unscored, and never a number. */
  function boardMood(club, standing, row) {
    const t = club.board.targets;
    if (!t || !row) return null;
    const gap = t.position - row.position;
    const name = club.board.style;
    if (gap >= 4) return `The board are quietly delighted — ${ordinal(row.position)} is well beyond what they asked for.`;
    if (gap >= 1) return `The board are satisfied. ${ordinal(row.position)} is ahead of the brief, and they have noticed.`;
    if (gap === 0) return `The board see exactly what they asked for, and expect it to hold.`;
    if (gap >= -3) return `The board are watching. ${ordinal(row.position)} is short of the brief, and ${name === "Chaotic" ? "this one does not wait long" : "patience is not infinite"}.`;
    return `The board are unhappy. ${ordinal(row.position)} against a brief of ${ordinal(t.position)} is the kind of gap that ends careers.`;
  }

  function blockReport(world, S, b) {
    const club = world.playerClubId ? world.clubById(world.playerClubId) : null;
    if (!club) return null;
    const st = S.leagues[club.leagueId];
    if (!st) return null;

    const standing = MG.competitions.leagueStanding(st);
    const row = standing.find((r) => r.clubId === club.id) || null;
    const targets = club.board.targets;
    const injured = club.squad.filter((p) => (p.season.injured || 0) >= 0.25);
    const scorer = club.squad.slice().sort((a, x) => (x.season.goals || 0) - (a.season.goals || 0))[0] || null;
    const matches = (world.playerMatches || []).slice();
    const blockMatches = matches.slice(S.matchMark);
    // Form over the opening weeks, as points per game against what the
    // division's own pace looks like.
    const ppg = row && row.played ? row.pts / row.played : 0;
    const resultOf = (m) => {
      const us = m.homeId === club.id ? m.hg : m.ag;
      const them = m.homeId === club.id ? m.ag : m.hg;
      return us > them ? "W" : us === them ? "D" : "L";
    };

    return {
      block: b, blocks: BLOCKS,
      blockName: BLOCK_NAMES[b - 1] || "",
      first: b === 1, last: b >= BLOCKS,
      leagueId: club.leagueId,
      leagueName: st.leagueName,
      fieldSize: st.fieldSize,
      played: row ? row.played : 0,
      // Counted off the calendar rather than inferred from the field size: an
      // odd division sits a club out on some matchdays, so "everyone plays
      // twice against everyone" is not true of every league in the game.
      remaining: row ? Math.max(0, st.fixtures.reduce((n, f) => n + (f[0] === club.id || f[1] === club.id ? 1 : 0), 0) - row.played) : 0,
      position: row ? row.position : null,
      pts: row ? row.pts : 0,
      won: row ? row.won : 0, drawn: row ? row.drawn : 0, lost: row ? row.lost : 0,
      gf: row ? row.gf : 0, ga: row ? row.ga : 0,
      ppg: round1(ppg),
      target: targets ? targets.position : null,
      // Positive = doing better than the brief asked for.
      vsTarget: (targets && row) ? targets.position - row.position : 0,
      relegationZone: row ? row.position > st.fieldSize - 3 : false,
      promotionRace: row ? row.position <= Math.max(2, Math.round(st.fieldSize * 0.12)) : false,
      injured: injured.length,
      injuredNames: injured.slice(0, 3).map((p) => p.name),
      topScorer: scorer && scorer.season.goals ? { name: scorer.name, goals: scorer.season.goals, id: scorer.id } : null,
      matches,
      blockMatches,
      form: matches.slice(-5).map(resultOf).join(""),
      blockForm: blockMatches.map(resultOf).join(""),
      standing,
      /* WHAT THE BLOCK DID, as opposed to where the season stands. The review
       * screen is a small end-of-season report, and these are its rows. */
      wasPosition: (club._blockMark && club._blockMark.position) || null,
      performers: blockPerformers(club, row),
      medical: blockMedical(club, world),
      moraleLabel: MG.blocks.moraleLabel(MG.tactics.teamMorale(club)),
      boardMood: boardMood(club, standing, row),
      cup: cupProgress(world, S.cups[club.country], club.id, club),
      europe: (() => {
        for (const st2 of Object.values(S.euro)) {
          const p = cupProgress(world, st2, club.id, club);
          if (p) return p;
        }
        return null;
      })(),
    };
  }

  /* ---------------------------- THE BLOCK BRIEF ----------------------------
   * What the manager is shown BEFORE the next two months are played, as
   * opposed to blockReport, which is what he is shown after. Four questions
   * and no more, because four is what fits on a phone and what a manager
   * actually needs before setting a side up:
   *
   *   1. what is coming up      the fixtures, the cup tie, the European night
   *   2. what state am I in     who is out, who is tired, how the room feels
   *   3. what does the board    where they want him and what they think now
   *      expect
   *   4. what is my plan        the two levers, which is the only part of this
   *                             screen he can change
   *
   * Anything that does not answer one of those four belongs somewhere else. */
  function blockPreview(world) {
    const club = world.playerClubId ? world.clubById(world.playerClubId) : null;
    if (!club) return null;
    const S = ensureSeasonState(world);
    const next = Math.min(BLOCKS, S.block + 1);
    const st = S.leagues[club.leagueId];
    if (!st) return null;

    // 1. WHAT IS COMING UP — this club's league fixtures inside the next block.
    const from = MG.competitions.leagueCut(st, S.block, BLOCKS);
    const to = MG.competitions.leagueCut(st, next, BLOCKS);
    const standing = MG.competitions.leagueStanding(st);
    const posOf = {};
    standing.forEach((r, i) => { posOf[r.clubId] = i + 1; });
    const fixtures = [];
    for (let i = from; i < to; i++) {
      const f = st.fixtures[i];
      if (!f) continue;
      const home = f[0] === club.id, oppId = home ? f[1] : f[0];
      if (f[0] !== club.id && f[1] !== club.id) continue;
      const opp = world.clubById(oppId);
      if (!opp) continue;
      fixtures.push({
        opponent: opp.name, home, position: posOf[opp.id] || null,
        strength: Math.round(MG.clubs.clubStrength(opp)),
        derby: MG.match.isDerby(club.name, opp.name),
      });
    }

    /* A cup or European round only appears if one actually falls in the block
     * ahead. The opponent is genuinely not known — the draw for each round is
     * made when that round is played (see competitions.js) — and saying so is
     * better than inventing one. */
    const tieIn = (state) => {
      if (!state || state.done) return null;
      const played = state.totalRounds - MG.competitions.knockoutRoundsLeft(state);
      if (roundsDueBy(state.totalRounds, next) <= played) return null;
      if (state.alive.indexOf(club.id) < 0 && state.waiting.indexOf(club.id) < 0) return null;
      return {
        name: state.name, comp: state.comp || null,
        round: MG.competitions.roundLabel(state.roundsRemaining),
        left: state.alive.length + state.waiting.length,
      };
    };
    const cup = tieIn(S.cups[club.country]);
    let euro = null;
    for (const e of Object.values(S.euro)) { euro = euro || tieIn(e); }

    // 2. WHAT STATE AM I IN.
    const out = [], tired = [];
    for (const p of club.squad) {
      const blocks = (p.season && p.season.outBlocks) || 0;
      if (blocks > 0) { out.push({ id: p.id, name: p.name, pos: p.pos, blocks, overall: p.overall }); continue; }
      const f = MG.blocks.fatigueOf(p);
      if (f >= 0.5 && (p.season.minutesShare || 0) >= 0.2) {
        tired.push({ id: p.id, name: p.name, pos: p.pos, fatigue: Math.round(f * 100), label: MG.blocks.fatigueLabel(f) });
      }
    }
    out.sort((a, b) => b.overall - a.overall);
    tired.sort((a, b) => b.fatigue - a.fatigue);
    const morale = MG.tactics.teamMorale(club);

    // 3. WHAT DOES THE BOARD EXPECT.
    const row = standing.find((r) => r.clubId === club.id) || null;
    const targets = club.board.targets;

    return {
      block: next, blocks: BLOCKS, blockName: BLOCK_NAMES[next - 1] || "",
      first: next === 1,
      leagueName: st.leagueName,
      fixtures, cup, euro,
      squad: {
        size: club.squad.length,
        available: club.squad.length - out.length,
        out, tired,
        fatigue: Math.round(MG.blocks.xiFatigue(club) * 100),
        morale: Math.round(morale),
        moraleLabel: MG.blocks.moraleLabel(morale),
      },
      board: {
        target: targets ? targets.position : null,
        summary: targets ? targets.summary : null,
        position: row ? row.position : null,
        played: row ? row.played : 0,
        vsTarget: (targets && row) ? targets.position - row.position : 0,
        confidence: Math.round(club.board.confidence),
        style: club.board.style,
      },
      plan: { ...MG.blocks.planFor(club) },
      shapeOnOffer: MG.blocks.suggestShape(world, club),
      formation: club.formation || "4-4-2",
    };
  }

  /** Open the season WITHOUT playing any of it: build every division, every
   *  cup and the European draw, and stop. It used to play the first block on
   *  the way through, which meant the manager was shown his opening-weeks
   *  brief after the opening weeks had already been played — the one screen
   *  where the whole point is that nothing has happened yet.
   *
   *  Returns null before a ball is kicked, and the current block's report when
   *  a mid-season save is being resumed. That report is DERIVED from the state,
   *  never stored in it — a saved copy would be a second, staler answer to a
   *  question the tables can already answer. */
  function beginSeason(world) {
    if (!world.playerClubId) return null;
    const S = ensureSeasonState(world);
    return S.block === 0 ? null : blockReport(world, S, S.block);
  }

  function advanceSeason(world) {
    /* The season is played as five blocks and then settled. A managed career
     * calls playBlock four times through the UI and arrives here with the
     * campaign already at April; a headless world arrives here with nothing
     * played and the loop below plays the lot. Either way the football is the
     * same football, and everything after the loop happens exactly once. */
    const S = ensureSeasonState(world);
    while (S.block < BLOCKS) playBlock(world);

    const rng = world.rng;
    const seasonNews = [];
    const results = S.results;
    const carousel = S.carousel;
    const cupWinners = S.cupWinners;
    const cupExits = S.cupExits;
    const euro = S.euroNames;
    const euroPrize = S.euroPrize;
    const euroRuns = S.euroRuns;
    /* Next season's European places, decided by the season that just finished
     * rather than by the one about to start — see the block header. */
    world._lastEuroQualification = results;
    world._lastCupWinners = cupWinners;

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
        // Two seasons of deep debt costs the NEXT season points at kick-off —
        // checked right after the money is booked, so it reads this season's
        // real result rather than a stale one.
        const deduction = MG.clubs.checkFinancialHealth(club);
        if (deduction) {
          const text = `FINANCIAL CRISIS — sustained losses cost ${club.name} a ${deduction}-point deduction next season.`;
          if (club.id === world.playerClubId || club.reputation >= 55) world.report(text, "sack", club.id);
        }
        club.lastPosition = row.position;
        club.lastLeagueId = club.leagueId;
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
          // Points already lost to a deduction imposed at kick-off, if any —
          // see clubs.checkFinancialHealth from last season.
          deduction: row.deduction || 0,
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
      if (MG.narrative) MG.narrative.rateSquad(club, club._outcome, world.year);
      boardReports[club.id] = MG.clubs.evaluateSeason(club, club._outcome, rng);
      // Morale settles on what the season delivered and who got to play in it.
      MG.tactics.settleMorale(club, club._outcome);
      // The board judges the season the modifiers produced, then they expire.
      MG.clubs.decayModifiers(club);
      const manager = world.managerById(club.managerId);
      if (manager) {
        manager.tenure++;
        manager.record.seasons++;
        /* A manager's standing follows what his board thinks of him, damped by
         * the size of club he is doing it at — but only lightly, and with
         * achievement able to override the damping entirely.
         *
         * The damping used to be 0.12 of the gap. That meant a reputation-96
         * coach at a reputation-80 club shed nearly two points every season
         * however well he did, and nothing anywhere in the world ever created
         * a new elite name to replace him: every rookie appointment is seeded
         * BELOW its club's reputation, so the pool only ever leaked downward.
         * Measured across twelve simulated seasons the Premier League's median
         * manager fell from 74 to 50 and the best coach in the world from 96 to
         * 85, while a human manager climbing on results alone gains about six a
         * season. The player was not pulling away from the field so much as the
         * field was walking backwards — and manager reputation is 40% of
         * matchModifiers' quality term, which is a direct edge in every single
         * match played. Halved, and floored on achievement below. */
        let swing = boardReports[club.id].total * 6 + (club.reputation - manager.reputation) * 0.05;
        /* Winning something is what actually makes a name, and it is what keeps
         * elite reputations in the world at all. A good league finish is
         * already in report.total; this is the part that outlives the season. */
        const o = club._outcome;
        if (o) {
          if (o.champion) swing += 4;
          else if (o.promoted) swing += 2.5;
          if (o.europe && o.europe.round === "W") swing += 3;
          if (o.relegated) swing -= 3;
        }
        /* Climbing gets harder the higher you already are. Without this the
         * same six-a-season a competent manager earns in the third tier keeps
         * paying all the way to 99, so any human who simply does his job
         * arrives at the ceiling inside a decade and stays there — with a
         * permanent match-engine edge over every opponent, since reputation is
         * 40% of manager quality. Above the low 80s the difference between a
         * very good manager and a great one stops being another solid season
         * and starts being trophies, which is exactly what the flat bonuses
         * above deliver: they are damped too, but they are large enough to
         * still move a reputation that ordinary competence no longer can. */
        if (swing > 0 && manager.reputation > 82) {
          swing *= clamp(1 - (manager.reputation - 82) / 24, 0.25, 1);
        }
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

    /* Agents reassess their books once a season, after the carousel has
     * settled who actually has a job — a manager's reputation for this
     * purpose is the one he heads into the summer with. */
    if (MG.agents) MG.agents.reassessRosters(world);

    // Drop the hidden-attribute cache entries for anyone who left the world
    // this season — see ratings.js's pruneHidden for why this cannot just
    // be left to grow.
    if (MG.ratings && MG.ratings.pruneHidden) MG.ratings.pruneHidden(world);

    // Does anyone genuinely bigger want to talk to the manager THIS season is
    // ending on? Checked after the carousel and the sackings above, so a
    // manager who just lost his job this summer is not also offered a new
    // one in the same breath.
    const playerApproach = checkPlayerManagerApproach(world);

    /* ---- 7. awards ---- */
    const awards = computeAwards(world, results, boardReports, euro);

    /* The managed club's own top scorer for the season THAT JUST FINISHED —
     * captured here, before a single retirement or transfer touches the
     * squad. The end-of-season screen used to read this straight off
     * `club.squad` after advanceSeason() returned, which is AFTER the
     * summer's transfer window (below) has already run: a sale already
     * removed the man from the squad array, so the screen silently showed
     * the second-highest scorer for a season its actual top scorer had just
     * finished — the exact "the game already moved on before you saw it"
     * problem the decision engine has to avoid everywhere, not just in the
     * SIGN/VETO cards themselves. */
    let clubTopScorer = null;
    /* THE SEASON AS A STORY, captured in the same breath and for the same
     * reason. The club's European campaign, its best scorers and the shape of
     * its year all live on objects the summer is about to rewrite — the squad
     * gets sold from, `_outcome` is deleted a few lines down — so anything the
     * end-of-season screens want to TELL the manager has to be taken now,
     * while it is still true. */
    let playerSeason = null;
    if (world.playerClubId) {
      const pc = world.clubById(world.playerClubId);
      if (pc) {
        for (const p of pc.squad) {
          if (!clubTopScorer || p.season.goals > clubTopScorer.goals) {
            clubTopScorer = { name: p.name, goals: p.season.goals, playerId: p.id };
          }
        }
        const scorers = pc.squad.slice()
          .filter((p) => (p.season.goals || 0) > 0 || (p.season.assists || 0) > 0)
          .sort((a, b) => (b.season.goals - a.season.goals) || (b.season.assists - a.season.assists))
          .slice(0, 5)
          .map((p) => ({ id: p.id, name: p.name, pos: p.pos, goals: p.season.goals || 0, assists: p.season.assists || 0 }));
        /* WHO CAME OF AGE. Measured against a stamp taken at the previous
         * summary, not against the start of this season — development is a
         * SUMMER pass (transfers.developSquads), so a player's rating does not
         * move between kick-off and the final whistle at all, and comparing
         * across those two points would report a gain of zero for everybody,
         * forever. Year on year is the interval that actually contains the
         * change, and it is the one a manager thinks in: the boy who was 68
         * last May and is 74 this one. Nobody rises in the first season of a
         * save, because there is no earlier stamp to measure from — which is
         * correct rather than a gap. */
        let riser = null;
        for (const p of pc.squad) {
          const gain = p._lastSeasonOverall != null ? p.overall - p._lastSeasonOverall : 0;
          if (gain > 0.9 && (!riser || gain > riser.gain)) {
            riser = {
              id: p.id, name: p.name, pos: p.pos, age: p.age,
              gain: round1(gain), overall: Math.round(p.overall),
              was: Math.round(p._lastSeasonOverall),
            };
          }
        }
        for (const p of pc.squad) p._lastSeasonOverall = p.overall;
        /* And the club's own shape, for the same year-on-year comparison the
         * pre-season briefing makes: "your defence is four points weaker than
         * the side that finished fifth" is a sentence a manager can act on,
         * where a bare rating is only a number. Stamped BEFORE the summer
         * rewrites the squad, so next pre-season compares like with like. */
        pc._lastRatings = {
          attack: round1(pc.ratings.attack), midfield: round1(pc.ratings.midfield),
          defence: round1(pc.ratings.defence), squadSize: pc.squad.length,
        };
        playerSeason = {
          europe: (pc._outcome && pc._outcome.europe) || null,
          cupRound: pc._outcome ? pc._outcome.cupRound : null,
          scorers, riser,
          matches: (world.playerMatches || []).slice(),
        };
      }
    }

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
    /* Ownership rarely changes hands — about one or two clubs a season across
     * the whole world — but it has to happen before budgets are set, since a
     * takeover is exactly the kind of thing that changes how much a club can
     * spend the same summer it happens. */
    for (const club of world.clubs) {
      const change = MG.clubs.rollBoardroomChange(rng, club);
      if (!change) continue;
      const label = MG.clubs.OWNER_TYPES[change.to.owner].label;
      world.report(
        change.from.owner !== change.to.owner
          ? `TAKEOVER — ${club.name} come under new ownership. ${label}, and a ${change.to.style.toLowerCase()} boardroom.`
          : `BOARDROOM CHANGE — ${club.name}'s board turns over. Still ${label.toLowerCase()}, now a ${change.to.style.toLowerCase()} temperament.`,
        "hire", club.id);
      MG.clubs.fansReact(club, change.from.owner !== change.to.owner ? 4 : 0, "new ownership at the club");
    }
    for (const club of world.clubs) MG.clubs.setBudgets(club, rng);
    /* ---- AI CYCLE 1: ASSESS ----
     * Every AI club reads its own season and takes a posture for the summer
     * before a single bid is made — rebuilding, pushing, consolidating,
     * firefighting or steady — and writes down the positions it intends to
     * fix, in order. See ai.js. Budgets are set first because a club's money
     * is half of what decides its posture. */
    if (MG.ai) MG.ai.planWorld(world);
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
    /* ---- AI CYCLE 2: ACT ---- the window itself, aimed by the plan. */
    const window = MG.transfers.runWindow(world);
    /* ---- AI CYCLE 3: REVIEW ----
     * The plan meets what actually happened. A club that failed to fill a
     * priority position now solves it another way — a prospect promoted ahead
     * of schedule, or a free agent it would not have looked at in cycle 2 —
     * rather than sleepwalking into the season with the hole still in it.
     * Runs before signFreeAgents so a desperate club gets first refusal on the
     * free market, and takes its man out of the pool so nobody signs him twice. */
    const reviewNews = MG.ai ? MG.ai.reviewWindow(world, freeAgents) : [];
    const freeNews = MG.transfers.signFreeAgents(world, freeAgents) || [];
    const fillerNews = MG.transfers.topUpSquads(world) || [];
    /* The academy year: train, promote or release, then take a new intake.
     * This is the ONLY source of academy graduates. A second, older intake
     * used to run alongside it, quietly adding a batch of teenagers straight
     * into every senior squad on top of the academy's own promotions — two
     * youth pipelines firing every summer, neither mentioning the other, and
     * a real part of the squad-overhaul problem. That one is gone. */
    const academyNews = MG.youth ? MG.youth.runSeason(world) : [];
    const youthNews = [];
    // Last job of the summer: the blocked prospects go out to find games.
    const loansOut = MG.transfers.runLoans(world);
    for (const club of world.clubs) {
      MG.clubs.refreshRatings(club);
      delete club._outcome;
    }

    for (const n of retireNews.concat(window.news.slice(0, 60)).concat(youthNews)
      .concat(loanReturns).concat(loansOut.news).concat(reviewNews).concat(freeNews)
      .concat(fillerNews).concat(academyNews)) {
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
      clubTopScorer,
      playerSeason,
      transferCount: window.deals,
      contestedDeals: window.contested || 0,
      transferRejections: window.rejections || 0,
      loansOut: loansOut.sent,
      bigTransfers: window.news.length,
      managerWindow,
      playerApproach: playerApproach ? { clubId: playerApproach.club.id } : null,
      /* The season's news, narrowed to the club the manager is at. The full
       * season log used to go in here, and world.history keeps sixty seasons
       * of summaries — so every save carried a complete SECOND copy of the
       * log, over a megabyte of it after forty seasons, to serve exactly one
       * reader: the result screen looking for its own sacking. */
      news: world.news.filter((n) => n.season === world.season
        && (n.clubId === world.playerClubId || n.type === "trophy")),
    };
    world.history.push(summary);
    if (world.history.length > 60) world.history.shift();

    world.season++;
    world.year++;
    /* The campaign is over, so its state goes. Dropped only after the calendar
     * has rolled: everything above still reads the tables, the cup exits and
     * the European runs out of it. */
    world.seasonState = null;
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
    const deductionNote = o.deduction ? ` (${o.deduction} deducted for financial breaches — ${o.pts + o.deduction} earned on the pitch)` : "";
    world.report(`— ${label} SEASON REVIEW — ${headline}, ${o.pts} points from ${o.played} games (${o.won}W ${o.drawn}D ${o.lost}L, ${o.gf} scored, ${o.ga} conceded)${deductionNote}.`, "season", club.id);

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
    // A manager gets ONE approach a summer, whatever happens with it — dangled
    // in front of every vacancy in the pyramid in the same window read as
    // every big club somehow knowing to try the same available man at once.
    const approached = new Set();
    let guard = 0;
    while (queue.length && guard++ < 400) {
      const club = queue.shift();
      if (club.managerId) continue;
      const hired = hireFor(world, club, { queue, approached });
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

    /* A club cannot re-appoint the man it just parted with, in the season it
     * parted with him. Anywhere else, and any later season, he is fair game —
     * a manager returning to an old club years on is a real and welcome story;
     * a club un-sacking someone within the same window is not. */
    const justLeft = (m) => m._leftClubId === club.id && m._leftSeason === world.season;
    for (const m of world.freeManagers) {
      if (justLeft(m)) continue;
      candidates.push({ manager: m, from: null, score: MG.managers.candidateScore(m, club, rng) });
    }
    // Employed managers are only approached by clubs meaningfully bigger than
    // their own — and a mid-season vacancy rarely prises anyone away at all.
    if (!o.midSeason) {
      for (const m of world.managers) {
        if (!m.clubId || m.isPlayer) continue;
        if (o.approached && o.approached.has(m.id)) continue;    // already had his one approach this window
        const from = world.clubById(m.clubId);
        if (!from || from.id === club.id) continue;
        if (justLeft(m)) continue;
        if (!MG.managers.wouldMove(m, from, club)) continue;
        if (o.approached) o.approached.add(m.id);
        candidates.push({ manager: m, from, score: MG.managers.candidateScore(m, club, rng) * 1.05 });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    let chosen = candidates[0];
    /* Boards do not always get their first choice — but a board with real pull
     * usually does. Flat at 0.3 for everyone, the biggest clubs in the world
     * missed on their target as often as a mid-table one, which is the other
     * half of why elite coaching drained out of the world: nothing above the
     * appointment itself ever concentrated the best managers at the best
     * clubs. */
    const missChance = club.reputation >= 70 ? 0.12 : club.reputation >= 50 ? 0.22 : 0.3;
    if (candidates.length > 2 && rng.chance(missChance)) chosen = rng.pick(candidates.slice(0, 3));

    if (!chosen || chosen.score < club.reputation * 0.25) {
      /* Nobody suitable: the club appoints an unknown. Seeded off the club's
       * own standing — a giant forced into the market late still appoints
       * someone near its level rather than a total unknown, where the flat
       * "5 to 20 points below" applied to every club in the pyramid was one
       * of the leaks that walked the world's coaching quality down. */
      const drop = rng.int(2, Math.max(4, Math.round(22 - club.reputation * 0.22)));
      const rookie = MG.managers.generate(rng, clamp(club.reputation - drop, 3, 92));
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

  /* The player's own manager is deliberately never a candidate inside
   * hireFor above — an AI vacancy silently swallowing him mid-loop would
   * end a career with no chance to say yes or no. This is the interactive
   * equivalent, checked once a season, post-carousel, alongside every AI
   * manager's own one approach: does a genuinely bigger job want to talk to
   * him? "Genuinely bigger" and a modest base chance both matter here — a
   * manager doing well gets an offer occasionally, not every single summer,
   * which is the whole point of this being rarer than an ordinary transfer. */
  function checkPlayerManagerApproach(world) {
    if (!world.playerClubId) return null;
    const rng = world.rng;
    const current = world.clubById(world.playerClubId);
    if (!current || current.managerId == null) return null;
    const manager = world.managerById(current.managerId);
    if (!manager || !manager.isPlayer) return null;
    if (!rng.chance(0.22)) return null;    // most summers, nobody comes calling

    const candidates = [];
    for (const club of world.clubs) {
      if (club.id === current.id) continue;
      if (!MG.managers.wouldMove(manager, current, club)) continue;
      const score = MG.managers.candidateScore(manager, club, rng);
      if (score < club.reputation * 0.6) continue;   // not a serious approach
      candidates.push({ club, score });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return { club: candidates[0].club, manager };
  }
  function computeAwards(world, results, boardReports, euro) {
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
    const ballonDor = computeBallonDor(world, results, euro);
    return { topScorer, goldenBoots, managerOfYear, ballonDor };
  }

  /* ------------------------------ BALLON D'OR -------------------------------
   * The criteria, fixed every season rather than reinvented each time:
   *
   *   1. A POOL of the season's top performers, drawn from the four leagues
   *      that actually produce Ballon d'Or contenders in real life (see
   *      EURO_LEAGUES) — goals and assists (weighted so a defender's tally
   *      counts for more than a forward's, the same logic the real voting
   *      panel applies) plus the player's own quality, since output alone
   *      would hand it to a hot striker at a mid-table club over a genuinely
   *      world-class one having a quieter statistical season.
   *
   *   2. TWO WINS, EACH WORTH DOUBLE. Winning your league doubles your score;
   *      winning the Champions League doubles it again — the same player can
   *      collect both, which is exactly how a real treble-winning season
   *      dominates the real vote. Nothing else in the pool gets a boost:
   *      silverware is the only thing that multiplies, everything else only
   *      adds.
   *
   *   3. A PSEUDO VOTE, not a straight top-of-the-list pick. The real award
   *      is decided by a panel of national-team captains, coaches and
   *      journalists, not a stat sheet — which is why the "best numbers"
   *      candidate does not always win. Drawn with rng.weighted so the
   *      leading names usually take it and an upset can still happen, the
   *      same shape as the giant-killing roll in match.js and for the same
   *      reason: an award that always goes to whoever the model likes best is
   *      not a vote, it is a leaderboard. */
  const BALLON_DOR_LEAGUES = MG.competitions.EURO_LEAGUES;
  const BALLON_DOR_POOL_SIZE = 25;
  /* Per-GOAL weight: what one goal is worth as evidence, by position. A
   * centre half who scores eight has done something a striker who scores
   * eight has not, so his are worth more each. This is not the same thing as
   * the vote favouring defenders — see BALLON_POS_PRESTIGE below, which is. */
  const BALLON_GOAL_WEIGHT = { FW: 1.0, WG: 1.0, AM: 1.05, CM: 1.15, DM: 1.3, FB: 1.4, CB: 1.5, GK: 1.6 };

  /* ------------------------ WHAT THE VOTERS ACTUALLY DO --------------------
   * Tester feedback, and the numbers backed it up hard. Across 32 simulated
   * awards only 31% of winners came from the merit top three, a quarter won
   * with fewer than twelve goals — one with TWO — and the shortlist was on
   * average half-filled by a single club, because a treble winner handed every
   * name on its teamsheet a fourfold multiplier. The award was a raffle.
   *
   * Three things were wrong, and all three are things the real vote gets right.
   *
   * 1. THE VOTE IS NOT POSITION-BLIND. Ballon d'Or voters have given it to a
   *    forward in the overwhelming majority of years. It is not a rule and it
   *    is not absolute — Rodri won it off a Champions League and a European
   *    Championship, Modrić and Cannavaro before him — but a centre half needs
   *    an extraordinary season to beat a striker's ordinary great one. That is
   *    a prestige multiplier on the whole score, quite separate from what a
   *    single goal is worth as evidence.
   *
   * 2. A STRIKER AT A BIG CLUB IS SEEN MORE. Thirty goals for the champions
   *    of Spain is a different campaign from thirty for a mid-table side, and
   *    the voters have never pretended otherwise. Club reputation lifts the
   *    attacking positions specifically, because that is where the effect is
   *    real: nobody wins this by defending well for Real Madrid.
   *
   * 3. SILVERWARE IS NOT SHARED EQUALLY. The doubling for a league title and
   *    for Europe stays exactly as specified — but it is earned by the men who
   *    played, not by everyone who owns the shirt. Gated on minutes, a regular
   *    still gets the full double and a squad player gets a fraction, which is
   *    what stops one treble-winning teamsheet swamping the shortlist. */
  /* The deep positions are deliberately not crushed. A first cut set CM/DM in
   * the low sixties and across thirty-two simulated awards not one midfielder
   * or defender ever won — which trades one wrong answer for another, because
   * a save long enough to contain a whole career should contain a Rodri year.
   * These sit high enough that a genuinely extraordinary season (a double
   * winner who played every minute) can break through, and no higher. */
  /* WHAT COUNTS AS EVIDENCE depends on the job. A striker is measured by what
   * he produces and the goal column says almost everything about his year. A
   * holding midfielder's season is not in that column at all — Rodri won this
   * award on eight goals — so for the deeper roles the case has to be carried
   * by how good he actually was. Without this the prestige table alone could
   * not save them: raising CM and DM into the high seventies still produced
   * forty straight forward-or-winger winners, because no midfielder can out-
   * score a striker no matter how the score is weighted afterwards. */
  const BALLON_QUALITY_WEIGHT = { FW: 2.0, WG: 2.2, AM: 3.0, CM: 5.5, DM: 6.0, FB: 5.2, CB: 6.0, GK: 6.2 };
  const BALLON_POS_PRESTIGE = {
    FW: 1.00, WG: 0.90, AM: 0.84, CM: 0.78, DM: 0.77, FB: 0.60, CB: 0.64, GK: 0.56,
  };
  /* How much a big club's shop window is worth, and to whom. */
  const BALLON_STAGE_POS = { FW: 1.00, WG: 0.85, AM: 0.75, CM: 0.45, DM: 0.40, FB: 0.25, CB: 0.25, GK: 0.20 };
  const BALLON_STAGE_MAX = 0.35;        // up to +35% for a forward at the biggest club
  /* The floor a fringe player gets from his club's trophies, before minutes. */
  const BALLON_TROPHY_FLOOR = 0.30;
  /* How sharply the vote concentrates on the leaders. Weights are the ratio of
   * a candidate's score to the best score, raised to this — so a man on 90% of
   * the leader's case is a live contender, one on 60% is a long shot, and the
   * bottom of the shortlist is decoration rather than a lottery ticket. At 9
   * the best case wins about two years in three, which is roughly how the real
   * award behaves. */
  const BALLON_VOTE_SHARPNESS = 8;

  function computeBallonDor(world, results, euro) {
    const leagueChampions = new Set();
    for (const leagueId of BALLON_DOR_LEAGUES) {
      const table = results[leagueId] && results[leagueId].table;
      if (table && table[0]) leagueChampions.add(table[0].clubId);
    }
    const ucl = euro && euro.UCL ? world.clubByName(euro.UCL) : null;

    const candidates = [];
    for (const club of world.clubs) {
      if (!BALLON_DOR_LEAGUES.includes(club.leagueId)) continue;
      for (const p of club.squad) {
        const goals = p.season.goals || 0, assists = p.season.assists || 0;
        if (!goals && !assists && p.overall < 84) continue;   // cheap prefilter
        const w = BALLON_GOAL_WEIGHT[p.pos] || 1;
        const qw = BALLON_QUALITY_WEIGHT[p.pos] || 2.4;
        let score = (goals * 3.4 + assists * 2.0) * w + Math.max(0, p.overall - 74) * qw;
        if (score <= 0) continue;
        // What position he plays, and how big a stage he plays it on.
        score *= BALLON_POS_PRESTIGE[p.pos] || 0.6;
        const stature = clamp(((club.reputation || 50) - 55) / 45, 0, 1);
        score *= 1 + stature * BALLON_STAGE_MAX * (BALLON_STAGE_POS[p.pos] || 0.3);
        /* Silverware doubles the case, earned by minutes played. A regular
         * collects the full double; a man who watched most of it collects the
         * floor. Both trophies still stack, as specified. */
        const played = clamp(p.season.minutesShare == null ? 0.5 : p.season.minutesShare, 0, 1);
        const involvement = BALLON_TROPHY_FLOOR + (1 - BALLON_TROPHY_FLOOR) * played;
        if (leagueChampions.has(club.id)) score *= 1 + involvement;
        if (ucl && club.id === ucl.id) score *= 1 + involvement;
        candidates.push({ playerId: p.id, name: p.name, club: club.name, clubId: club.id, pos: p.pos,
          goals, assists, overall: Math.round(p.overall), score: round1(score) });
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    const pool = candidates.slice(0, BALLON_DOR_POOL_SIZE);

    /* The vote. Weighted on each candidate's case AS A SHARE OF THE BEST CASE,
     * rather than on the raw score — the old version raised the absolute score
     * to a power, which meant how random the award felt depended on how big the
     * numbers happened to be that season rather than on how close the race was.
     * A ratio has no such drift: a 90%-of-the-leader season is a live contender
     * in a tight year and in a runaway one alike. */
    const best = pool[0].score || 1;
    const items = pool.map((c) => ({
      item: c,
      weight: Math.pow(Math.max(0, c.score) / best, BALLON_VOTE_SHARPNESS),
    }));
    const winner = world.rng.weighted(items);
    return { winner, pool, leagueChampions: [...leagueChampions], uclWinnerId: ucl ? ucl.id : null };
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

  MG.world = { createWorld, REAL_MANAGERS, appointManager, removeManager, hireFor, ordinal, attachApi };
})(typeof globalThis !== "undefined" ? globalThis : this);
