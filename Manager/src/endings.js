/* ============================================================================
 * FOOTBALL MANAGER — HOW A CAREER ENDS
 *
 * 1000goals ends a career with a weighted draw from CAREER_ENDINGS: the goal
 * target, one more year, the fairytale return, the testimonial. This is the
 * same idea for a manager, and deliberately rarer.
 *
 * The two games are not the same shape. A striker's career ends when his legs
 * go, and 1000goals leans on that constantly. A manager's career mostly ends
 * because somebody sacks him — which the boardroom already handles — so these
 * endings are the OTHER ways out, and they should feel like an event when they
 * land rather than a mechanic you learn to expect.
 *
 *   THE HARD CAP    thirty seasons and the game calls it, whatever you say
 *   AGE             from sixty, rising every year
 *   UPSTAIRS        director of football, sporting director — the office
 *   THE NATIONAL JOB the one offer worth leaving club football for
 *   WALKING AWAY    burnout, health, or a chance to stop at the very top
 *
 * Every ending is a card with choices, exactly like a decision — most give you
 * a way to refuse and carry on, and refusing has a cost. Nothing here fires
 * without a requirement being met, and nothing common fires often.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /** Thirty seasons is a full life in management, and the end of the game. */
  const SEASON_CAP = 30;

  const ENDINGS = [
    /* ------------------------------ THE CAP ------------------------------- */
    {
      id: "career_complete", weight: 100, forced: true,
      req: (c) => c.seasons >= SEASON_CAP,
      text: (c) => `Thirty seasons in management. ${c.managerName} has nothing left to prove to anyone.`,
      choices: () => [
        { label: "Call it a career", detail: "Walk away on your own terms.", ending: "retired" },
      ],
    },

    /* -------------------------------- AGE --------------------------------- */
    {
      id: "old_age", weight: 40,
      req: (c) => c.age >= 62,
      chance: (c) => clamp((c.age - 60) * 0.11, 0, 0.85),
      text: (c) => `${c.managerName} is ${c.age}. The travelling, the Tuesday nights, the phone calls at midnight — it is a young man's job and everybody has started saying so.`,
      choices: (c) => [
        { label: "Retire", detail: "Enough. Go and watch a game as a supporter.", ending: "retired" },
        { label: "One more season", detail: "You are not finished yet.", extend: true, fx: (api) => { api.confidence(-3); return `You tell them you have another year in you. Not everyone is convinced.`; } },
      ],
    },
    {
      id: "health", weight: 12,
      req: (c) => c.age >= 55 && c.seasons >= 6,
      chance: () => 0.05,
      text: (c) => `A routine medical comes back with a warning. The doctor is blunt about what another decade in this job would do.`,
      choices: () => [
        { label: "Listen to the doctor", detail: "Step away while you still can.", ending: "retired" },
        { label: "Ignore it", detail: "You have heard worse from referees.", extend: true, fx: (api) => { api.confidence(-2); return `You put the letter in a drawer and take training the next morning.`; } },
      ],
    },

    /* ------------------------------ UPSTAIRS ------------------------------ */
    {
      id: "director_of_football", weight: 26,
      req: (c) => c.reputation >= 52 && c.seasons >= 5 && c.age >= 48,
      chance: () => 0.09,
      text: (c) => `${c.clubName} offer ${c.managerName} the director of football role — the whole footballing operation, the recruitment, the academy, and never another press conference after a defeat.`,
      choices: (c) => [
        { label: "Take the office", detail: "Shape the club without the touchline.", ending: "director" },
        { label: "Stay in the dugout", detail: "You are a coach, not an executive.", extend: true, fx: (api) => { api.confidence(4); return `You turn it down. The board take it as a statement of commitment.`; } },
      ],
    },
    {
      id: "sporting_director_abroad", weight: 14,
      req: (c) => c.reputation >= 62 && c.seasons >= 8,
      chance: () => 0.05,
      text: (c) => `A club abroad wants ${c.managerName} to build a whole football department from scratch — their money, your blueprint, no results due until year three.`,
      choices: () => [
        { label: "Build something instead", detail: "Leave coaching behind for the project.", ending: "director" },
        { label: "Not yet", detail: "There is still a season in front of you.", extend: true },
      ],
    },

    /* -------------------------- THE NATIONAL JOB -------------------------- */
    {
      id: "national_team", weight: 22,
      req: (c) => c.reputation >= 68 && c.seasons >= 5,
      chance: () => 0.08,
      text: (c) => `${c.nationality} come calling. The national job: six games a year, a tournament every two summers, and the whole country watching.`,
      choices: () => [
        { label: "Answer your country", detail: "The last job you take.", ending: "international" },
        { label: "Turn them down", detail: "Club football is the real thing.", extend: true, fx: (api) => { api.rep(2); return `You say no, publicly and politely. It does your standing no harm at all.`; } },
      ],
    },

    /* ----------------------------- WALKING AWAY --------------------------- */
    {
      id: "burnout", weight: 18,
      req: (c) => c.seasons >= 10 && c.confidence < 45,
      chance: () => 0.07,
      text: (c) => `${c.seasons} seasons of this. The mornings are getting harder and the wins have stopped feeling like anything.`,
      choices: () => [
        { label: "Walk away", detail: "Before it takes anything else.", ending: "walked" },
        { label: "Push through it", detail: "The next win will fix it. It usually does.", extend: true, fx: (api) => { api.confidence(-4); return `You say nothing to anybody and get on with it.`; } },
      ],
    },
    {
      id: "top_of_the_mountain", weight: 20,
      req: (c) => c.titles >= 3 && c.seasons >= 8 && c.wonSomethingLastSeason,
      chance: () => 0.10,
      text: (c) => `Another trophy, and the obvious question: what exactly is left? ${c.managerName} could stop here, on the highest note there is.`,
      choices: () => [
        { label: "Retire as a champion", detail: "Nobody ever regrets leaving a season early.", ending: "legend" },
        { label: "Chase the next one", detail: "There is always a next one.", extend: true, fx: (api) => { api.rep(2); return `You are not done. You are never done.`; } },
      ],
    },
    {
      id: "nobody_calls", weight: 30,
      req: (c) => c.justSacked && c.reputation <= 22 && c.seasons >= 3,
      chance: () => 0.35,
      text: (c) => `The phone does not ring. Weeks pass, then a season, and the game quietly moves on without ${c.managerName}.`,
      choices: () => [
        { label: "Accept it", detail: "Some careers end without a farewell.", ending: "faded" },
        { label: "Drop down the leagues and start again", detail: "Anything, anywhere.", extend: true, fx: (api) => { api.rep(-3); return `You will take whatever is offered, wherever it is.`; } },
      ],
    },
    {
      id: "punditry", weight: 16,
      req: (c) => c.justSacked && c.reputation >= 48,
      chance: () => 0.12,
      text: (c) => `A broadcaster offers ${c.managerName} a seat on the panel — good money, no relegation battles, home every night.`,
      choices: () => [
        { label: "Take the studio job", detail: "Talk about it instead of doing it.", ending: "pundit" },
        { label: "Get back in the dugout", detail: "You would be terrible on television.", extend: true },
      ],
    },
  ];

  /* Titles for the legacy screen, keyed by how the career finished. */
  const ENDING_LABELS = {
    retired: { title: "RETIRED", blurb: "Left the game on his own terms." },
    director: { title: "MOVED UPSTAIRS", blurb: "Traded the touchline for the boardroom." },
    international: { title: "TOOK THE NATIONAL JOB", blurb: "Left club football for his country." },
    walked: { title: "WALKED AWAY", blurb: "Stopped before the game stopped him." },
    legend: { title: "RETIRED A CHAMPION", blurb: "Went out at the very top." },
    faded: { title: "FADED OUT", blurb: "The phone stopped ringing." },
    pundit: { title: "LEFT FOR THE STUDIO", blurb: "Talks about it now instead of doing it." },
    sacked: { title: "SACKED", blurb: "The last board ran out of patience." },
  };

  /** What the endings can ask about. */
  function buildContext(world, manager, club, opts) {
    const o = opts || {};
    return {
      managerName: manager.name,
      clubName: club ? club.name : "your club",
      nationality: manager.nationality,
      age: manager.age,
      seasons: manager.record.seasons,
      reputation: manager.reputation,
      titles: manager.honours.titles,
      promotions: manager.honours.promotions,
      confidence: club ? Math.round(club.board.confidence) : 50,
      justSacked: !!o.justSacked,
      wonSomethingLastSeason: !!o.wonSomethingLastSeason,
    };
  }

  /** Draw an ending, or null if the career carries on. Forced endings (the
   *  thirty-season cap) bypass the dice entirely. */
  /* A career should last a good long time — the whole appeal is building
   * something across a couple of decades, the way a 1000goals striker plays a
   * full career before the retirement events start. Nothing but the 30-season
   * cap ends a career before this, and even after it the odds ramp up steadily
   * toward 30 rather than firing the moment they become legal. Getting sacked
   * is NOT a career ending — you go back to the job market and take a smaller
   * club — so an early sacking never ends the game. */
  const MIN_ENDING_SEASON = 18;

  /** Scales every ending's chance from ~0 at season 18 to full by season 30. */
  function seasonRamp(seasons) {
    return clamp((seasons - MIN_ENDING_SEASON) / (SEASON_CAP - MIN_ENDING_SEASON), 0, 1);
  }

  function check(world, manager, club, opts) {
    const ctx = buildContext(world, manager, club, opts);
    const rng = world.rng;

    // The cap is the one hard ending; it always wins.
    const forced = ENDINGS.filter((e) => e.forced && e.req(ctx));
    if (forced.length) return { ending: forced[0], ctx };

    // Below the floor, a career simply carries on — sacked managers find
    // another job, nobody retires, the game keeps going.
    if (ctx.seasons < MIN_ENDING_SEASON) return null;

    const ramp = seasonRamp(ctx.seasons);
    const eligible = ENDINGS.filter((e) => {
      if (e.forced) return false;
      if (!e.req(ctx)) return false;
      const chance = (e.chance ? e.chance(ctx) : 0.05) * ramp;
      return rng.chance(chance);
    });
    if (!eligible.length) return null;
    const ending = rng.weighted(eligible.map((e) => ({ item: e, weight: e.weight || 10 })));
    return ending ? { ending, ctx } : null;
  }

  function present(entry) {
    return {
      id: entry.ending.id,
      text: entry.ending.text(entry.ctx),
      choices: entry.ending.choices(entry.ctx),
    };
  }

  /** Apply a chosen ending option. Returns { text, ending } — `ending` is null
   *  when the manager talked his way out of it. */
  function apply(world, club, manager, ctx, choice) {
    let text = null;
    if (choice.fx && club) {
      const api = MG.decisions.makeApi(world, club, manager, ctx);
      try { text = choice.fx(api); } catch (err) { text = null; }
    }
    return { text: text || choice.label, ending: choice.ending || null };
  }

  /** The numbers the legacy screen is built from. */
  function legacy(manager, career, endingKey) {
    const label = ENDING_LABELS[endingKey] || ENDING_LABELS.retired;
    const played = manager.record.played || 1;
    const clubs = [];
    for (const s of career) if (!clubs.includes(s.club)) clubs.push(s.club);
    const best = career.reduce((b, s) => (s.position && (!b || s.position < b.position) ? s : b), null);
    return {
      title: label.title, blurb: label.blurb,
      seasons: manager.record.seasons,
      clubs,
      titles: manager.honours.titles,
      cups: manager.honours.cups,
      promotions: manager.honours.promotions,
      relegations: manager.honours.relegations,
      european: manager.honours.european,
      reputation: manager.reputation,
      age: manager.age,
      record: manager.record,
      winRate: Math.round((manager.record.won / played) * 100),
      bestSeason: best,
    };
  }

  MG.endings = { SEASON_CAP, ENDINGS, ENDING_LABELS, buildContext, check, present, apply, legacy };
})(typeof globalThis !== "undefined" ? globalThis : this);
