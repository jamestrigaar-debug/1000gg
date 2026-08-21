/* ============================================================================
 * FOOTBALL MANAGER — THE ACADEMY
 *
 * Until now youth was something that happened TO you: every summer the intake
 * ran, a teenager or two appeared in your senior squad, and the only lever you
 * had was a decision card that shifted a percentage. There was nothing to look
 * at and nothing to decide.
 *
 * Now every club carries a real academy — a small pool of teenagers who age,
 * train and improve behind the first team — and the manager of the club you
 * run gets three things to do with it:
 *
 *   SEE IT       who is in there, how good they are, and what the coaches
 *                think they might become
 *   SHAPE IT     a training focus that decides which attributes the whole
 *                intake develops, so an academy has a character
 *   PROMOTE      pull one into the senior squad when he is ready, or leave him
 *                another year and risk him stalling
 *
 * The pool is deliberately SMALL and partly hidden: you see the graded verdict
 * of your coaches, not a spreadsheet of every kid at the club. AI clubs run the
 * same academy on the same rules and promote their best automatically, so the
 * world's player population keeps refreshing whether or not a human is looking.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp, round1 } = MG.util;

  const POOL_TARGET = 8;        // how many prospects an academy carries
  const PROMOTE_AGE = 21;       // past this he is taking up a place he cannot use

  /* ------------------------------ TRAINING --------------------------------
   * What the academy is FOR. Each focus pushes the intake's development into
   * different attributes, so two clubs with identical facilities produce
   * recognisably different players. The gain is the same size in every case —
   * this is a choice about shape, not about quality. */
  const FOCUS = {
    balanced: {
      label: "Balanced", blurb: "Well-rounded footballers. No specialism, no glaring hole.",
      attrs: { speed: 0.5, strength: 0.5, fitness: 0.5, heading: 0.5, rightFoot: 0.5, leftFoot: 0.5 }, mental: 0.5,
    },
    technical: {
      label: "Technical", blurb: "Feet first. Produces footballers who can play, and who may get bullied.",
      attrs: { rightFoot: 1.5, leftFoot: 1.3, speed: 0.3 }, mental: 0.4,
    },
    physical: {
      label: "Physical", blurb: "Athletes. Quick, strong and durable; the polish comes later, if at all.",
      attrs: { speed: 1.3, strength: 1.3, fitness: 1.2, heading: 0.6 }, mental: 0.1,
    },
    mentality: {
      label: "Mentality", blurb: "Character and decision-making. Slower to look impressive, better in a crisis.",
      attrs: { fitness: 0.4, heading: 0.3 }, mental: 1.6,
    },
  };
  const FOCUS_KEYS = Object.keys(FOCUS);

  function ensure(club) {
    if (!club.academy) club.academy = { focus: "balanced", players: [], lastIntake: 0 };
    if (!FOCUS[club.academy.focus]) club.academy.focus = "balanced";
    return club.academy;
  }

  /* ------------------------------- INTAKE ---------------------------------
   * Produced against the club's own level rather than a fixed number, for the
   * same reason the senior intake is: an academy that can only make players
   * worse than the division it feeds drags the whole club down over a save. */
  function makeProspect(rng, world, club) {
    const level = club.level != null ? club.level : MG.clubs.playerLevelFor(club);
    const youthRating = club.facilities.youth;
    const manager = world.managerById(club.managerId);
    const devBonus = manager ? (manager.attrs.development - 60) / 300 : 0;
    const age = rng.int(15, 17);
    const target = Math.max(26 + youthRating * 0.28, level - 26) + rng.gauss() * 4;
    const p = MG.players.generate(rng, {
      league: club.leagueId, pos: rng.pick(MG.players.POSITION_KEYS), age,
      // `target` above is already what a fifteen-to-seventeen-year-old is
      // rated, not a peak — generate's own age discount would apply it twice
      // and hand every academy a squad of thirty-rated children.
      target, spread: 3, homegrown: true, rawTarget: true,
      nationality: MG.names.nationForLeague(rng, club.leagueId),
    });
    // The interesting number is the ceiling, and only a good academy finds one.
    const roll = rng.next() * (1 + devBonus);
    const ceiling = roll > 0.975 - youthRating / 2200 ? level + rng.int(6, 18)
      : roll > 0.86 ? level + rng.int(-3, 7)
        : level - rng.int(3, 18);
    p.potential = clamp(Math.max(p.overall + 4, ceiling), p.overall, 96);
    p.contract = { years: rng.int(2, 4), wage: round1(MG.players.expectedWage(p, club.leagueId) * 0.3) };
    p.clubId = club.id;
    p.academy = true;
    /* What the coaches will admit to. A scouting grade rather than the raw
     * ceiling: good academies read their own players better, so the range you
     * are shown narrows as the facilities improve. */
    const noise = clamp(28 - youthRating * 0.22, 4, 22);
    p.scouted = {
      floor: Math.round(clamp(p.potential - rng.between(2, noise), p.overall, 96)),
      ceiling: Math.round(clamp(p.potential + rng.between(2, noise), p.overall, 99)),
    };
    return p;
  }

  /** Top the academy back up to strength. */
  function intake(world, club) {
    const a = ensure(club);
    const rng = world.rng;
    const added = [];
    let guard = 0;
    while (a.players.length < POOL_TARGET && guard++ < 20) {
      const p = makeProspect(rng, world, club);
      a.players.push(p);
      added.push(p);
    }
    a.lastIntake = world.season;
    return added;
  }

  /* ------------------------------ TRAINING --------------------------------
   * A year in the academy. Development is faster than the senior curve at this
   * age but entirely dependent on the facilities and the coaching, which is
   * what makes the training ground worth spending money on. */
  function develop(world, club) {
    const a = ensure(club);
    const rng = world.rng;
    const focus = FOCUS[a.focus];
    const manager = world.managerById(club.managerId);
    const coaching = MG.managers.coachingQuality(manager, club);
    const quality = (club.facilities.youth * 0.6 + coaching * 0.4) / 100;   // 0-1

    for (const p of a.players) {
      p.age++;
      const headroom = p.potential - p.overall;
      // Academy players train rather than play, so minutes are assumed steady.
      const gain = (0.9 + headroom * 0.11) * (0.5 + quality) + rng.gauss() * 0.7;
      /* Overall and attributes move together — see players.js's
       * applyDevelopment. This used to add the gain to `overall` alone and
       * leave the attributes to the focus nudge below, which is a fraction of
       * the size: an academy player growing twenty-five points between 15 and
       * 20 gained about eight points of attributes, and graduated into the
       * first team already badly adrift. Regens spend their formative years
       * here, which made this the single biggest source of the drift. */
      MG.players.applyDevelopment(p, Math.max(-0.5, gain));
      /* The focus still decides WHICH attributes come on fastest — applied on
       * top as a lean rather than as the whole movement. applyDevelopment's
       * convergence term pulls the LEVEL back onto the population line over
       * the following seasons while the SHAPE the focus built persists, which
       * is exactly the division of labour wanted: the academy decides what
       * kind of player he becomes, not how good the badge says he is. */
      for (const [k, w] of Object.entries(focus.attrs)) {
        p.attrs[k] = clamp(Math.round(p.attrs[k] + w * (0.6 + quality) + rng.gauss() * 0.4), 20, 99);
      }
      // Attributes moved: drop this player's role-rating cache.
      if (MG.ratings.touchAttrs) MG.ratings.touchAttrs(p);
      if (focus.mental) p.mentalityRating = clamp(Math.round(p.mentalityRating + focus.mental * (0.6 + quality)), 20, 99);
      p.value = MG.players.marketValue(p);
      // The scouting range tightens as he plays and trains in front of them.
      if (p.scouted) {
        p.scouted.floor = Math.round(clamp(p.scouted.floor + (p.potential - p.scouted.floor) * 0.3, p.overall, 96));
        p.scouted.ceiling = Math.round(clamp(p.scouted.ceiling - (p.scouted.ceiling - p.potential) * 0.3, p.overall, 99));
      }
    }
  }

  /** Move a prospect up. Returns the player, or null if he is not there.
   *  `season` is optional — callers that have a world handy pass it so the
   *  promotion shows a year on the player's career history. */
  function promote(club, playerId, season) {
    const a = ensure(club);
    const i = a.players.findIndex((p) => p.id === playerId);
    if (i < 0) return null;
    const p = a.players.splice(i, 1)[0];
    p.academy = false;
    p.clubId = club.id;
    MG.players.recordMove(p, club.name, season);
    MG.tactics.initMorale(p);
    club.squad.push(p);
    MG.clubs.refreshRatings(club);
    return p;
  }

  /** The board's own first instinct when a shirt needs filling: look in the
   *  academy before it looks anywhere else. Picks the best prospect in the
   *  right position who is actually ready — the same bar the profile screen
   *  marks "ready for the first team" with — and promotes him. Returns null
   *  if nobody in the academy is close, which is the common case; the caller
   *  falls through to the market exactly as before. */
  function promoteReadyForPos(world, club, pos) {
    const a = ensure(club);
    const level = club.level != null ? club.level : MG.clubs.playerLevelFor(club);
    const candidates = a.players
      .filter((p) => p.pos === pos && p.overall >= level - 8)
      .sort((x, y) => y.overall - x.overall);
    if (!candidates.length) return null;
    return promote(club, candidates[0].id, world ? world.season : null);
  }

  /** Release one — the other half of the decision. */
  function release(club, playerId) {
    const a = ensure(club);
    const i = a.players.findIndex((p) => p.id === playerId);
    if (i < 0) return null;
    const p = a.players.splice(i, 1)[0];
    p.retired = true;
    return p;
  }

  /* EVERY club's academy is run by its own staff, the player's included.
   *
   * It used to carve out an exception — "the player's club is left alone:
   * those are his calls to make" — which put a PROMOTE and a RELEASE button
   * beside each boy and made the manager the academy's line manager. Beta
   * feedback asked for the opposite, and it is the better model: a first-team
   * manager does not personally decide which sixteen-year-old is stepping up,
   * the academy staff do, and he finds out when a name appears in his squad.
   * It also removes a screen of unrewarding admin — promoting the obvious
   * candidate every season was a decision only in the sense that it required
   * a tap.
   *
   * So the rule is one rule for everybody. What the player gets instead is
   * VISIBILITY: the group, its grades, and the three the coaches rate — plus
   * a line in the log naming anyone the staff push up or let go, which is
   * more than he ever got about his own academy before.
   *
   * Returns what happened, so runSeason can report it. */
  /* WHAT THE ACADEMY COACHES FOR, chosen by the club rather than the manager.
   * The focus buttons used to sit on the YOUTH tab; with the academy handed to
   * the board they go too, so this picks a house style the club would plausibly
   * have. Deterministic and stable — a club's academy has an identity, and a
   * manager arriving should find one already there rather than a blank slate.
   * A well-funded youth setup can afford to coach the ball; a poor one falls
   * back on athletes, which is exactly what happens in the real world. */
  function boardFocus(club) {
    const youth = club.facilities ? club.facilities.youth : 50;
    const training = club.facilities ? club.facilities.training : 50;
    if (youth >= 78) return "technical";
    if (youth >= 62) return training >= 70 ? "technical" : "balanced";
    if (youth <= 42) return "physical";
    return club.board && club.board.style === "Patient" ? "mentality" : "balanced";
  }

  /* ============================ THE RESERVES ===============================
   * The tier the club was missing, and the reason a squad used to be either
   * "good enough to play" or "gone".
   *
   * The academy fed the first team DIRECTLY: a boy was either ready for the
   * senior squad at twenty or released at twenty-one, and there was nowhere in
   * between for the ordinary case — the twenty-year-old who is genuinely
   * promising and genuinely not ready. Meanwhile a fringe senior whose contract
   * ran out simply walked, because the only alternative on offer was a first-
   * team place he had not earned. Between them those two facts are most of the
   * turnover the testers complained about: every club spent every summer
   * refilling a squad it had just emptied, out of a market rather than out of
   * its own building.
   *
   * A reserve list fixes both, and it is how a real club is actually shaped.
   * Prospects graduate INTO it rather than into the first team. Fringe players
   * whose deals expire can drop INTO it rather than out of the club. Everyone
   * in it trains, develops and is available — so when the first team needs a
   * body, the club looks downstairs before it looks at the market.
   *
   * INVISIBLE on purpose. There is no reserves screen and no reserves
   * decision: the board runs this exactly as it runs the academy, and the
   * manager sees the group summarised on the YOUTH tab and hears about
   * promotions in his log. Adding a second squad list to manage would undo the
   * very thing handing the academy to the board was meant to achieve. */
  const RESERVE_TARGET = 10;        // the size the board keeps it around
  const RESERVE_MAX_AGE = 23;       // past this he is not a prospect, he is a squad player or gone

  function ensureReserves(club) {
    if (!club.reserves) club.reserves = [];
    return club.reserves;
  }

  /** Move a player into the reserves. Used by the academy and by transfers.js
   *  when a young fringe player's contract runs out. */
  function toReserves(world, club, p) {
    const res = ensureReserves(club);
    p.academy = false;
    p.reserve = true;
    p.clubId = club.id;
    if (!p.contract || p.contract.years <= 0) {
      p.contract = { years: 2, wage: Math.max(1, Math.round((p.contract && p.contract.wage) || 1)) };
    }
    if (MG.tactics && MG.tactics.initMorale) MG.tactics.initMorale(p);
    res.push(p);
    return p;
  }

  /** Into the first team. */
  function fromReserves(world, club, p) {
    const res = ensureReserves(club);
    const i = res.indexOf(p);
    if (i >= 0) res.splice(i, 1);
    p.reserve = false;
    p.clubId = club.id;
    MG.players.recordMove(p, club.name, world ? world.season : null);
    if (MG.tactics && MG.tactics.initMorale) MG.tactics.initMorale(p);
    club.squad.push(p);
    return p;
  }

  /** Is he ready for the senior squad? */
  function reserveReady(club, p) {
    const level = club.level != null ? club.level : 50;
    return p.overall >= level - 4 || (p.age >= RESERVE_MAX_AGE && p.overall >= level - 8);
  }

  /** The best reserve who can fill a given position, promoted. Read by
   *  transfers.js's topUpSquads BEFORE it looks at the academy or the market. */
  function readyFromReserves(world, club, pos) {
    const res = ensureReserves(club);
    const options = res.filter((p) => p.pos === pos).sort((a, b) => b.overall - a.overall);
    if (!options.length) return null;
    return fromReserves(world, club, options[0]);
  }

  /* A season in the reserves. They age, they train and they develop — see the
   * development floor in players.js, which is the other half of this: being AT
   * a club is now worth real progress even without first-team minutes, so a
   * reserve is a player getting better rather than a player parked. */
  function developReserves(world, club) {
    const res = ensureReserves(club);
    if (!res.length) return { promoted: [], released: [] };
    const manager = world.managerById ? world.managerById(club.managerId) : null;
    const coaching = MG.managers.coachingQuality(manager, club);
    const promoted = [], released = [], keep = [];
    for (const p of res) {
      p.age++;
      /* Reserve football: real training, a handful of senior minutes. Passed as
       * a small minutes share rather than zero, because the floor in
       * developmentDelta is what carries him and this is the top-up. */
      const delta = MG.players.developmentDelta(world.rng, p, coaching, 0.18);
      MG.players.applyDevelopment(p, delta);
      p.value = MG.players.marketValue(p);
      if (p.contract) p.contract.years--;
      if (reserveReady(club, p)) { promoted.push(p); continue; }
      if (p.age > RESERVE_MAX_AGE) { released.push(p); continue; }
      keep.push(p);
    }
    club.reserves = keep;
    // Promotions happen after the walk so the array is not mutated under it.
    for (const p of promoted) fromReserves(world, club, p);
    for (const p of released) { p.reserve = false; p.clubId = null; p._leftClubId = club.id; p._leftSeason = world.season; }
    return { promoted, released };
  }

  function autoManage(world, club) {
    const a = ensure(club);
    a.focus = boardFocus(club);
    const level = club.level != null ? club.level : 50;
    const res = ensureReserves(club);
    const keep = [], graduated = [], released = [];
    for (const p of a.players) {
      const ready = p.overall >= level - 8 || p.potential >= level + 4;
      /* Graduation goes to the RESERVES, not to the first team. The bar comes
       * down accordingly — the question is no longer "is he a senior player
       * already?" but "is he worth keeping on at the club?", which is a much
       * lower and much more realistic hurdle for a twenty-year-old. */
      if (p.age >= PROMOTE_AGE - 1 && (ready || res.length < RESERVE_TARGET)) {
        toReserves(world, club, p);
        graduated.push(p);
        continue;
      }
      // Aged out and never made it — released, wherever he is.
      if (p.age > PROMOTE_AGE) { p.retired = true; released.push(p); continue; }
      keep.push(p);
    }
    a.players = keep;
    return { graduated, released };
  }

  /** The whole academy year, for every club. Returns news for the player's. */
  function runSeason(world) {
    const news = [];
    for (const club of world.clubs) {
      develop(world, club);
      /* Order matters: the reserves have their year FIRST, so anyone ready
       * steps up before this summer's academy graduates arrive to replace him.
       * Run the other way round a boy would graduate into the reserves and be
       * assessed for the first team in the same breath, having trained for
       * exactly no time at all. */
      const res = developReserves(world, club);
      const moved = autoManage(world, club);
      const isPlayerClub = club.id === world.playerClubId;
      if (isPlayerClub && res.promoted.length) {
        news.push({
          type: "youth",
          text: `RESERVES — ${res.promoted.map((p) => `${p.name} (${p.pos}, ${p.age}, ${Math.round(p.overall)})`).join(", ")} step${res.promoted.length === 1 ? "s" : ""} up to the first-team squad.`,
          clubId: club.id,
        });
      }
      /* The board runs the academy now, so the manager has to be TOLD what it
       * did — a boy appearing in the senior squad with no explanation is the
       * "the game moved on without you" failure the log exists to prevent. */
      if (isPlayerClub && moved.graduated.length) {
        news.push({
          type: "youth",
          text: `ACADEMY — ${moved.graduated.map((p) => `${p.name} (${p.pos}, ${p.age})`).join(", ")} graduate${moved.graduated.length === 1 ? "s" : ""} to the reserves.`,
          clubId: club.id,
        });
      }
      if (isPlayerClub && moved.released.length) {
        news.push({
          type: "youth",
          text: `ACADEMY — released after ageing out: ${moved.released.map((p) => p.name).join(", ")}.`,
          clubId: club.id,
        });
      }
      const added = intake(world, club);
      if (club.id === world.playerClubId && added.length) {
        const best = added.slice().sort((x, y) => y.potential - x.potential)[0];
        news.push({
          type: "youth",
          text: `ACADEMY — ${added.length} new scholar${added.length === 1 ? "" : "s"} join the youth team, the pick of them ${best.name} (${best.pos}, ${best.age}).`,
          clubId: club.id,
        });
      }
    }
    return news;
  }

  /** A grade for what the coaches think a prospect can become. */
  function grade(p) {
    const s = p.scouted || { floor: p.potential, ceiling: p.potential };
    const mid = (s.floor + s.ceiling) / 2;
    if (mid >= 80) return { label: "Exceptional", cls: "gold" };
    if (mid >= 70) return { label: "Promising", cls: "accent" };
    if (mid >= 58) return { label: "Useful", cls: "" };
    return { label: "Limited", cls: "muted" };
  }

  MG.youth = {
    FOCUS, FOCUS_KEYS, POOL_TARGET, PROMOTE_AGE,
    ensure, intake, develop, promote, promoteReadyForPos, release, autoManage, boardFocus, runSeason, grade, makeProspect,
    RESERVE_TARGET, RESERVE_MAX_AGE, ensureReserves, toReserves, fromReserves, readyFromReserves, developReserves, reserveReady,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
