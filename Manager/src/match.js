/* ============================================================================
 * FOOTBALL MANAGER — MATCH ENGINE
 *
 * Transposed from 1000goals' simulateMatch/resolveDuel with the same shape:
 * an xG per side from an attack-versus-defence duel, modulated by the tactical
 * matchup, midfield control, manager quality, home advantage and form, then a
 * Poisson draw for the score. The 1000goals version is well-tuned and produces
 * believable league tables, so the maths is deliberately preserved.
 *
 * What is new here:
 *   - the ratings come from the SQUAD (players.js) and the MANAGER (managers.js)
 *     rather than from a drifting number on the club
 *   - goalkeepers exist as a separate term, because in a management game the
 *     difference between a good and a bad keeper is a thing you go and buy
 *   - goals are attributed to individual players, so the world has top scorers
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /* Rock-paper-scissors between the six systems. Straight from 1000goals. */
  const TACTICAL = {
    Possession:     { strongVs: ["Direct", "Route One"], weakVs: ["High Press"],  atk: 1.00, mid: 1.08, chaos: 0 },
    "High Press":   { strongVs: ["Possession"],          weakVs: ["Counter"],     atk: 1.04, def: 0.98, chaos: 6 },
    Counter:        { strongVs: ["High Press"],          weakVs: ["Park the Bus"],atk: 1.05, chaos: 4 },
    Direct:         { strongVs: ["Park the Bus"],        weakVs: ["Possession"],  atk: 1.03, chaos: 4 },
    "Park the Bus": { strongVs: ["Counter"],             weakVs: ["Direct"],      atk: 0.90, def: 0.90, chaos: -4 },
    "Route One":    { strongVs: [],                      weakVs: ["Possession"],  atk: 1.00, chaos: 12 },
  };

  const DERBY_PAIRS = [
    ["Manchester United", "Liverpool"], ["Arsenal", "Tottenham"], ["Chelsea", "Arsenal"],
    ["Manchester City", "Manchester United"], ["Everton", "Liverpool"], ["Newcastle United", "Sunderland"],
    ["West Ham", "Tottenham"], ["Aston Villa", "Birmingham City"], ["Sheffield United", "Sheffield Wednesday"],
    ["Real Madrid", "Barcelona"], ["Atletico Madrid", "Real Madrid"], ["Inter Milan", "AC Milan"],
    ["Roma", "Lazio"], ["Juventus", "Inter Milan"], ["Borussia Dortmund", "Bayern Munich"],
    ["Celtic", "Rangers"], ["Nottingham Forest", "Derby County"], ["Portsmouth", "Southampton"],
  ];
  const DERBY_SET = new Set(DERBY_PAIRS.map((p) => p.slice().sort().join("|")));
  function isDerby(a, b) { return DERBY_SET.has([a, b].sort().join("|")); }

  function applyTacticalMatchup(homeStyle, awayStyle) {
    const h = TACTICAL[homeStyle] || {}, a = TACTICAL[awayStyle] || {};
    let homeAtkMod = h.atk || 1, awayAtkMod = a.atk || 1;
    const homeDefMod = h.def || 1, awayDefMod = a.def || 1;
    const chaosMod = 15 + (h.chaos || 0) + (a.chaos || 0);
    if ((h.strongVs || []).includes(awayStyle)) { homeAtkMod *= 1.06; awayAtkMod *= 0.96; }
    if ((a.strongVs || []).includes(homeStyle)) { awayAtkMod *= 1.06; homeAtkMod *= 0.96; }
    return { homeAtkMod, awayAtkMod, homeDefMod, awayDefMod, chaosMod: clamp(chaosMod, 5, 30) };
  }

  /* 1000goals uses `1.3 + diff / 20`. Two changes here, both measured against
   * manager/tests/realism.js rather than guessed:
   *
   *   - the divisor is widened to 24, because this engine's ratings spread
   *     further than 1000goals' do and at /20 the gap between a title-winning
   *     attack and a relegated defence produced 130-goal champions
   *   - the constant is 1.00, not 1.3, because attack ratings in this engine
   *     sit structurally about 8 points above defence ratings (the attacking
   *     unit aggregates a side's best forwards; the defensive one is dragged
   *     down by the goalkeeper term). That gap fed straight into every xG and
   *     the league ran at 3.5 goals a game against a real-world 2.75.
   *
   * If the rating scales are ever rebalanced, re-run the benchmark and retune
   * this constant — it is calibration, not physics. */
  const BASE_XG = 0.90;
  function resolveDuel(rng, attack, defence, chaosRange) {
    const diff = attack - defence;
    const baseXG = BASE_XG + diff / 24;
    const chaos = rng.between(-chaosRange, chaosRange) / 100;
    return Math.max(0.1, baseXG * (1 + chaos));
  }

  /* --------------------------- DIXON-COLES --------------------------------
   * Two independent Poisson draws under-produce the low-scoring draws real
   * football is full of: the benchmark had 0-0 at 3.8% against a real 7.5%.
   * Dixon and Coles' correction reweights the four lowest scorelines, pushing
   * mass into 0-0 and 1-1 and out of 1-0 and 0-1.
   *
   * The reference report suggests multiplying 0-0 and 1-1 by ~0.85 to make them
   * RARER. That is the wrong way round for football and for this engine — the
   * published correction uses a negative rho precisely because independent
   * Poisson gives too FEW of them, and our own measurements agreed. Implemented
   * in the published direction.
   *
   * Only the 2x2 block of scores is touched, and the block's total probability
   * is preserved, so everything from 2-0 upwards is left exactly as the Poisson
   * draw produced it. */
  const DC_RHO = -0.13;

  function dixonColes(rng, homeGoals, awayGoals, lambda, mu) {
    if (homeGoals > 1 || awayGoals > 1) return { homeGoals, awayGoals };
    // Only k of 0 and 1 ever reach here, and 0! = 1! = 1, so the factorial is
    // omitted rather than written out.
    const p = (k, l) => Math.exp(-l) * Math.pow(l, k);
    const cells = [[0, 0], [0, 1], [1, 0], [1, 1]];
    const tau = (x, y) => {
      if (x === 0 && y === 0) return 1 - lambda * mu * DC_RHO;
      if (x === 0 && y === 1) return 1 + lambda * DC_RHO;
      if (x === 1 && y === 0) return 1 + mu * DC_RHO;
      return 1 - DC_RHO;
    };
    let plain = 0, corrected = 0;
    const weights = cells.map(([x, y]) => {
      const base = p(x, lambda) * p(y, mu);
      const c = base * tau(x, y);
      plain += base; corrected += c;
      return c;
    });
    if (!(corrected > 0) || !(plain > 0)) return { homeGoals, awayGoals };
    // Re-draw within the block, keeping the block's own total mass unchanged.
    let roll = rng.next() * corrected;
    for (let i = 0; i < cells.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return { homeGoals: cells[i][0], awayGoals: cells[i][1] };
    }
    return { homeGoals, awayGoals };
  }

  /* ------------------------- GIANT-KILLING ---------------------------------
   * An explicit upset roll, on top of the chaos already inside the duel. The
   * reference report's own formula does not produce the probabilities it
   * claims (it reads ~50% at parity, not 10%), so the curve here is written to
   * hit the numbers the report was aiming for: about one match in ten between
   * equals has a flavour of the unexpected, falling to about one in twenty-five
   * when one side is far stronger.
   *
   * On a trigger the weaker side's xG is lifted and the stronger side's shaded,
   * which is what a smash-and-grab actually looks like on a scoresheet. */
  function upsetChance(strengthDiff) {
    return clamp(0.11 / (1 + Math.exp(Math.abs(strengthDiff) / 6 - 1.6)), 0.015, 0.12);
  }

  /* ---------------------------- TEAM PROFILES -----------------------------
   * The match engine never touches a club or a manager directly — it is handed
   * a flat profile. That keeps it usable for a neutral-venue cup tie, a
   * simulated friendly, or a future "what if" screen, and it means one profile
   * can be built once per season instead of once per match. */
  function teamProfile(club, manager) {
    const mods = manager ? MG.managers.matchModifiers(manager, club) : {
      attack: 0, midfield: 0, defence: 0, home: 1, quality: 0.5, fit: 1, variance: 1,
    };
    const r = club.ratings;
    // A goalkeeper is worth roughly a fifth of the defensive rating — enough
    // that an elite keeper behind an ordinary back four is worth buying.
    const defence = r.defence * 0.8 + r.keeper * 0.2;
    return {
      id: club.id,
      name: club.name,
      attack: r.attack + mods.attack,
      midfield: r.midfield + mods.midfield,
      defence: defence + mods.defence,
      keeper: r.keeper,
      style: manager ? manager.tactic : club.tacticalStyle,
      // The shape, so the engine can read one formation against the other.
      formation: club.formation || "4-4-2",
      // How well the squad is covered behind the eleven, 0-100. Depth pays off
      // across a season of injuries and fatigue rather than in any one match.
      depth: MG.tactics ? MG.tactics.depthScore(club) : 50,
      // Playstyle, shape, training and the manager himself, read together —
      // see tactics.js. 1.0 is neutral; the match engine applies it straight
      // to this side's xG.
      synergy: MG.tactics && MG.tactics.synergyScore ? MG.tactics.synergyScore(club, manager).xgMult : 1,
      homeAdvantage: (club.homeAdvantage || 5) * mods.home,
      managerQuality: mods.quality * 100,
      variance: mods.variance,
      /* Three separate things add up here:
       *   club.form        in-season momentum, swinging with recent results
       *   modifiers.form   the standing swing a decision bought for the season
       *   morale           how the dressing room actually feels
       * Morale is deliberately the smallest of the three — it colours a
       * season, it does not decide one. */
      form: (club.form || 0)
        + ((club.modifiers && club.modifiers.form) || 0)
        + (MG.tactics ? (MG.tactics.teamMorale(club) - 60) / 12 : 0),
    };
  }

  /** One match. `opts.neutral` drops home advantage (cup finals, tournaments). */
  function simulateMatch(rng, home, away, opts) {
    const o = opts || {};
    const t = applyTacticalMatchup(home.style, away.style);

    const midDiff = home.midfield - away.midfield;
    const homeMid = 1 + midDiff / 200, awayMid = 1 - midDiff / 200;

    const mgrDiff = home.managerQuality - away.managerQuality;
    const mgrSwing = mgrDiff / 220;
    const mgrChaosTrim = clamp(Math.abs(mgrDiff) / 10, 0, 4);

    const derbyChaos = o.derby ? 8 : 0;
    // A tinkerer's side is less predictable; a man-manager's is more.
    const homeChaos = (t.chaosMod + derbyChaos) * (home.variance || 1) - (mgrDiff > 0 ? mgrChaosTrim : 0);
    const awayChaos = (t.chaosMod + derbyChaos) * (away.variance || 1) - (mgrDiff < 0 ? mgrChaosTrim : 0);

    let homeXG = resolveDuel(rng, home.attack * t.homeAtkMod, away.defence * t.awayDefMod, clamp(homeChaos, 4, 40));
    let awayXG = resolveDuel(rng, away.attack * t.awayAtkMod, home.defence * t.homeDefMod, clamp(awayChaos, 4, 40));
    homeXG *= homeMid; awayXG *= awayMid;
    homeXG += mgrSwing;
    awayXG -= mgrSwing;
    /* Home advantage is divided by 34, not 100. At /100 it was worth about
     * 0.07 of a goal and the benchmark showed away sides winning 38% of
     * matches against a real-world 32%; real home advantage is worth roughly a
     * quarter of a goal. */
    if (!o.neutral) homeXG += (home.homeAdvantage || 0) / 34;
    homeXG *= 1 + (home.form || 0) / 100;
    awayXG *= 1 + (away.form || 0) / 100;

    // Giant-killing: the underdog's day.
    const strengthDiff = ((home.attack + home.defence) - (away.attack + away.defence)) / 2;
    let upset = false;
    if (rng.chance(upsetChance(strengthDiff))) {
      upset = true;
      if (strengthDiff >= 0) { awayXG *= 1.65; homeXG *= 0.78; }
      else { homeXG *= 1.65; awayXG *= 0.78; }
    }

    /* Shape against shape. The matchup matrix is the base modifier the
     * reference table recommends: a midfield three against a flat two is worth
     * something before either side's players are considered. It is deliberately
     * small — a fifth of a goal at most — because formation should tilt a
     * match, never decide one over a better squad. */
    if (MG.tactics && MG.tactics.formationEdge) {
      homeXG += MG.tactics.formationEdge(home.formation, away.formation);
      awayXG += MG.tactics.formationEdge(away.formation, home.formation);
    }

    /* Tactical synergy — playstyle, shape, training and the manager read
     * together (tactics.js). A small multiplier, +/-7% at the extremes,
     * because this is a whole season's set-up tilting a match, not deciding
     * one. Every club in the world gets this read, not just the player's —
     * the same symmetry as the formation matchup above. */
    if (home.synergy) homeXG *= home.synergy;
    if (away.synergy) awayXG *= away.synergy;

    homeXG = Math.max(0.08, homeXG);
    awayXG = Math.max(0.08, awayXG);

    let hg = rng.poisson(homeXG), ag = rng.poisson(awayXG);
    ({ homeGoals: hg, awayGoals: ag } = dixonColes(rng, hg, ag, homeXG, awayXG));

    return {
      homeGoals: hg,
      awayGoals: ag,
      homeXG: Math.round(homeXG * 100) / 100,
      awayXG: Math.round(awayXG * 100) / 100,
      upset,
    };
  }

  /** Two legs, away goals ignored (modern rules), penalties on aggregate level. */
  function simulateTie(rng, a, b, opts) {
    const o = opts || {};
    const legs = o.legs === 1 ? 1 : 2;
    let aGoals = 0, bGoals = 0;
    const results = [];
    if (legs === 1) {
      const r = simulateMatch(rng, a, b, { neutral: o.neutral !== false });
      aGoals = r.homeGoals; bGoals = r.awayGoals;
      results.push(r);
    } else {
      const first = simulateMatch(rng, a, b, {});
      const second = simulateMatch(rng, b, a, {});
      aGoals = first.homeGoals + second.awayGoals;
      bGoals = first.awayGoals + second.homeGoals;
      results.push(first, second);
    }
    let winner;
    if (aGoals > bGoals) winner = a;
    else if (bGoals > aGoals) winner = b;
    else {
      // Penalties: a coin flip nudged by the stronger side and the keepers.
      const edge = ((a.attack + a.defence + a.keeper * 0.5) - (b.attack + b.defence + b.keeper * 0.5)) / 300;
      winner = rng.next() < 0.5 + clamp(edge, -0.18, 0.18) ? a : b;
    }
    return { winner, loser: winner === a ? b : a, aGoals, bGoals, results, penalties: aGoals === bGoals };
  }

  /* -------------------------- GOAL ATTRIBUTION ----------------------------
   * A season selection is built once per club: who plays, how much, and how
   * likely each of them is to score. Attributing every goal through this is
   * what gives the world a golden boot race and gives the board a real number
   * for how many minutes the kids actually got. */
  const GOAL_WEIGHT = { FW: 10, WG: 6, AM: 5, CM: 2.2, DM: 0.7, FB: 0.6, CB: 0.9, GK: 0.02 };
  const ASSIST_WEIGHT = { FW: 4, WG: 8, AM: 8, CM: 5, DM: 1.6, FB: 3, CB: 0.7, GK: 0.1 };

  function buildSelection(club, manager, rng) {
    const squad = club.squad;
    const youthShare = clamp(
      MG.managers.youthAppetite(manager, club) + ((club.modifiers && club.modifiers.youthBias) || 0),
      0.02, 0.6);
    const byPos = {};
    for (const p of squad) (byPos[p.pos] = byPos[p.pos] || []).push(p);

    const entries = [];
    for (const [pos, list] of Object.entries(byPos)) {
      const def = MG.players.POSITIONS[pos];
      if (!def) continue;
      // Selection order: quality, with a thumb on the scale for youngsters at
      // clubs whose manager trusts them.
      const ranked = list.slice().sort((a, b) => {
        const youthA = a.age <= 21 ? youthShare * 30 : 0;
        const youthB = b.age <= 21 ? youthShare * 30 : 0;
        // Availability sorts the injured down the pecking order, which is how
        // a squad player gets his season.
        return (b.overall * MG.players.availability(b) + youthB)
             - (a.overall * MG.players.availability(a) + youthA);
      });
      ranked.forEach((p, i) => {
        // Starters play most of it, the next man in plays a chunk, the rest
        // pick up scraps. Rotation is implicit rather than per-match.
        const starters = def.starters;
        let share;
        if (i < starters) share = 0.78 - i * 0.04;
        else if (i < starters + 1) share = 0.34;
        else if (i < starters + 2) share = 0.15;
        else share = 0.05;
        share *= rng.between(0.85, 1.12);
        // An injured man plays only the part of the season he is fit for.
        share *= MG.players.availability(p);
        entries.push({ player: p, share: clamp(share, 0, 0.95) });
      });
    }

    // Normalise so the whole squad's minutes add up to eleven places.
    const outfield = entries.filter((e) => e.player.pos !== "GK");
    const totalShare = outfield.reduce((t, e) => t + e.share, 0) || 1;
    const scale = 10 / totalShare;   // ten outfield slots
    for (const e of outfield) e.share = clamp(e.share * scale, 0.01, 1);

    let goalTotal = 0, assistTotal = 0;
    for (const e of entries) {
      const p = e.player;
      const quality = Math.pow(Math.max(1, p.overall - 45) / 10, 1.6);
      e.goalWeight = (GOAL_WEIGHT[p.pos] || 1) * quality * e.share;
      e.assistWeight = (ASSIST_WEIGHT[p.pos] || 1) * quality * e.share;
      goalTotal += e.goalWeight;
      assistTotal += e.assistWeight;
      p.season.minutesShare = e.share;
    }
    return {
      entries,
      goalPicker: entries.map((e) => ({ item: e.player, weight: e.goalWeight })),
      assistPicker: entries.map((e) => ({ item: e.player, weight: e.assistWeight })),
      goalTotal, assistTotal,
      youthMinutesPct: minutesPctUnder21(entries),
    };
  }

  function minutesPctUnder21(entries) {
    let total = 0, young = 0;
    for (const e of entries) {
      if (e.player.pos === "GK") continue;
      total += e.share;
      if (e.player.age <= 21) young += e.share;
    }
    return total > 0 ? (young / total) * 100 : 0;
  }

  /** Hand out `goals` goals (and assists) from a selection. */
  function attributeGoals(rng, selection, goals) {
    for (let i = 0; i < goals; i++) {
      const scorer = rng.weighted(selection.goalPicker);
      if (!scorer) continue;
      scorer.season.goals++;
      // Roughly two in three goals are assisted, and never by the scorer.
      if (rng.chance(0.66)) {
        const assister = rng.weighted(selection.assistPicker.filter((a) => a.item.id !== scorer.id));
        if (assister) assister.season.assists++;
      }
    }
  }

  /** Bank a match's worth of appearances across the selection. */
  function recordAppearances(rng, selection) {
    for (const e of selection.entries) {
      if (rng.chance(e.share)) e.player.season.apps++;
    }
  }

  MG.match = {
    TACTICAL, DERBY_PAIRS, isDerby, applyTacticalMatchup, resolveDuel, dixonColes, upsetChance, BASE_XG, DC_RHO,
    teamProfile, simulateMatch, simulateTie,
    buildSelection, attributeGoals, recordAppearances, minutesPctUnder21,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
