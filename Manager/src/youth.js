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
      target, spread: 3, homegrown: true,
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
      p.overall = clamp(round1(p.overall + Math.max(-0.5, gain)), 25, 96);
      if (p.overall > p.potential) p.potential = p.overall;
      // The focus decides WHICH attributes come on.
      for (const [k, w] of Object.entries(focus.attrs)) {
        p.attrs[k] = clamp(Math.round(p.attrs[k] + w * (0.6 + quality) + rng.gauss() * 0.4), 20, 99);
      }
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

  /** Release one — the other half of the decision. */
  function release(club, playerId) {
    const a = ensure(club);
    const i = a.players.findIndex((p) => p.id === playerId);
    if (i < 0) return null;
    const p = a.players.splice(i, 1)[0];
    p.retired = true;
    return p;
  }

  /* An AI club promotes anyone good enough for its senior squad, and lets go of
   * anyone who has aged out without getting there. The player's club is left
   * alone: those are his calls to make. */
  function autoManage(world, club) {
    const a = ensure(club);
    const isPlayerClub = club.id === world.playerClubId;
    const level = club.level != null ? club.level : 50;
    const keep = [];
    for (const p of a.players) {
      const ready = p.overall >= level - 8 || p.potential >= level + 4;
      if (p.age >= PROMOTE_AGE - 1 && ready && !isPlayerClub) {
        p.academy = false;
        p.clubId = club.id;
        MG.players.recordMove(p, club.name, world.season);
        MG.tactics.initMorale(p);
        club.squad.push(p);
        continue;
      }
      // Aged out and never made it — released, wherever he is.
      if (p.age > PROMOTE_AGE) { p.retired = true; continue; }
      keep.push(p);
    }
    a.players = keep;
  }

  /** The whole academy year, for every club. Returns news for the player's. */
  function runSeason(world) {
    const news = [];
    for (const club of world.clubs) {
      develop(world, club);
      autoManage(world, club);
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
    ensure, intake, develop, promote, release, autoManage, runSeason, grade, makeProspect,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
