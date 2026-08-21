/* ============================================================================
 * FOOTBALL MANAGER — COMPETITIONS
 *
 * Fixtures, league tables, domestic cups, European football and the English
 * promotion/relegation ladder. Every division in the world is played out in
 * full every season — nothing is estimated from a strength ranking, because
 * the moment a division is estimated rather than played, the manager carousel
 * inside it stops meaning anything.
 *
 * The season is played in two halves with a hook in between. That hook is
 * where clubs in crisis sack their manager mid-campaign, which is both the
 * most common way a real manager loses his job and the reason a club's second
 * half of the season can look nothing like its first.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /* ------------------------------- TABLES --------------------------------- */
  function newRow(club) {
    return { clubId: club.id, name: club.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
  }
  function recordResult(row, gf, ga) {
    row.played++; row.gf += gf; row.ga += ga; row.gd = row.gf - row.ga;
    if (gf > ga) { row.won++; row.pts += 3; }
    else if (gf === ga) { row.drawn++; row.pts += 1; }
    else row.lost++;
  }
  function sortTable(rows) {
    return rows.slice().sort((a, b) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));
  }

  /* ------------------------------ FIXTURES --------------------------------
   * A real calendar of MATCHDAYS, not a shuffled bag of pairs.
   *
   * The old builder listed every ordered pair and shuffled the lot. That was
   * survivable while a season had exactly one checkpoint in it: nobody could
   * see that the first fifth of the list gave one club twelve games and the
   * club below it three. With the season split into five blocks it is the
   * first thing you notice, and it goes straight at the point of the split —
   * a manager who changes his shape in October is supposed to get two months
   * of football to judge it by, not three fixtures because the shuffle
   * happened to deal him a quiet autumn.
   *
   * The circle method gives every club exactly one fixture per matchday, so a
   * fifth of the calendar is a fifth of everybody's season. The matchdays
   * themselves are shuffled, so the order of the season still differs by seed.
   *
   * Pairs hold club IDS, not club objects. A season now pauses five times
   * instead of once, so its state has to survive a save — and a fixture list
   * of object references drags a second copy of every club in the division
   * into the file with it. Ten divisions, plus the cups, plus Europe, and the
   * save is mostly duplicated squads. IDs cost one index lookup per match.
   *
   * Returns an array of matchdays, each an array of [homeId, awayId]. */
  function buildRounds(rng, clubs, singleRoundRobin) {
    const ids = clubs.map((c) => c.id);
    // An odd division sits one club out each matchday, exactly as a real one does.
    if (ids.length % 2 === 1) ids.push(null);
    const n = ids.length;
    const fixed = ids[0];
    const rot = ids.slice(1);
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const line = [fixed].concat(rot);
      const day = [];
      for (let i = 0; i < n / 2; i++) {
        const a = line[i], b = line[n - 1 - i];
        if (a == null || b == null) continue;   // the bye
        // Alternate the venue down the matchday so no club is always at home.
        day.push(i % 2 === 0 ? [a, b] : [b, a]);
      }
      if (day.length) rounds.push(day);
      rot.unshift(rot.pop());                   // rotate for the next matchday
    }
    if (singleRoundRobin) {
      // One meeting per pair: randomise who gets home advantage instead.
      for (const day of rounds) for (const f of day) if (rng.chance(0.5)) { const t = f[0]; f[0] = f[1]; f[1] = t; }
      return rng.shuffle(rounds);
    }
    // The return fixtures: the same matchdays with the venues reversed.
    const back = rounds.map((day) => day.map((f) => [f[1], f[0]]));
    return rng.shuffle(rounds).concat(rng.shuffle(back));
  }

  /* ----------------------------- LEAGUE SEASON ----------------------------
   * `ctx` carries the per-club profiles and selections so they can be rebuilt
   * for a club that changes manager at the halfway hook. */
  /* A league season is played in three resumable pieces rather than one
   * closed loop, so the game can genuinely STOP part-way through and hand
   * control back — which is what the early-season decision window needs. A
   * season simulated in a single pass can only ever offer decisions before
   * kick-off or after the trophy, and "react to how the opening weeks
   * actually went" is a different kind of decision from either.
   *
   * runLeague below is unchanged in behaviour: it is these three calls in a
   * row, and every league the player is not in still goes through it. */
  function beginLeague(world, leagueId) {
    const rng = world.rng;
    const clubs = world.clubsInLeague(leagueId);
    if (clubs.length < 4) return null;
    const league = MG.clubs.LEAGUES[leagueId];
    const single = clubs.length > 24;

    const table = {};
    for (const c of clubs) {
      const row = newRow(c);
      // A points deduction imposed for financial trouble lands at kick-off,
      // before a ball is played, exactly like the real EFL sanction it is
      // modelled on — see clubs.checkFinancialHealth.
      if (c.pendingPointsDeduction) {
        row.deduction = c.pendingPointsDeduction;
        row.pts -= row.deduction;
        c.pendingPointsDeduction = 0;
      }
      table[c.id] = row;
    }

    /* The calendar is flattened to one list of fixtures — advanceLeague walks
     * an index, and always has — but `roundIndex` remembers where each
     * matchday starts, so the season can be cut at a matchday boundary rather
     * than mid-way through one. roundIndex[r] is the first fixture of round r
     * and roundIndex[rounds] is the end of the season. */
    const rounds = buildRounds(rng, clubs, single);
    const fixtures = [];
    const roundIndex = [0];
    for (const day of rounds) {
      for (const f of day) fixtures.push(f);
      roundIndex.push(fixtures.length);
    }
    return {
      leagueId, leagueName: league.name, clubIds: clubs.map((c) => c.id), table, fixtures,
      rounds: rounds.length, roundIndex,
      cursor: 0, midSeasonDone: false, fieldSize: clubs.length,
    };
  }

  /** The fixture index a league stands at after `part` of `whole` of its
   *  season — snapped to a matchday, so every club has played the same number
   *  of games at every stop. */
  function leagueCut(st, part, whole) {
    const r = Math.min(st.rounds, Math.round(st.rounds * part / whole));
    return st.roundIndex[r];
  }

  /** The clubs in a league state, resolved from the ids it stores. */
  function leagueClubs(world, st) {
    return st.clubIds.map((id) => world.clubById(id)).filter(Boolean);
  }

  /** Play a league state forward to (not including) fixture index `to`. */
  function advanceLeague(world, st, to) {
    const rng = world.rng;
    const league = MG.clubs.LEAGUES[st.leagueId];
    const limit = Math.min(to, st.fixtures.length);
    for (let i = st.cursor; i < limit; i++) {
      const home = world.clubById(st.fixtures[i][0]), away = world.clubById(st.fixtures[i][1]);
      if (!home || !away) continue;
      const hp = world.profile(home.id), ap = world.profile(away.id);
      const derby = MG.match.isDerby(home.name, away.name);
      const res = MG.match.simulateMatch(rng, hp, ap, { derby });
      recordResult(st.table[home.id], res.homeGoals, res.awayGoals);
      recordResult(st.table[away.id], res.awayGoals, res.homeGoals);
      const hs = world.selection(home.id), as = world.selection(away.id);
      MG.match.attributeGoals(rng, hs, res.homeGoals);
      MG.match.attributeGoals(rng, as, res.awayGoals);
      MG.match.recordAppearances(rng, hs);
      MG.match.recordAppearances(rng, as);
      world.recordManagerResult(home.id, res.homeGoals, res.awayGoals);
      world.recordManagerResult(away.id, res.awayGoals, res.homeGoals);
      /* The engine already knows WHY this result happened — how many chances
       * each side deserved, whether it was an upset, whether it was a derby —
       * and used to throw all of it away the moment the score was recorded.
       * Keeping it for the managed club is what lets the season be explained
       * back rather than just tallied. */
      if (world.playerClubId === home.id || world.playerClubId === away.id) {
        world.recordPlayerMatch({
          round: i + 1, competition: league.name,
          homeId: home.id, awayId: away.id, homeName: home.name, awayName: away.name,
          hg: res.homeGoals, ag: res.awayGoals,
          homeXG: res.homeXG, awayXG: res.awayXG,
          upset: res.upset, derby,
        });
      }
    }
    st.cursor = limit;
    return st;
  }

  /** The live table mid-season, positions filled in — what a paused season
   *  actually looks like to the manager standing in it. */
  function leagueStanding(st) {
    const sorted = sortTable(Object.values(st.table));
    sorted.forEach((row, i) => { row.position = i + 1; });
    return sorted;
  }

  function finishLeague(st) {
    const sorted = leagueStanding(st);
    return { leagueId: st.leagueId, leagueName: st.leagueName, table: sorted, fieldSize: st.fieldSize };
  }

  /** Carry a part-played league through to the whistle, firing the winter
   *  sacking hook on the way if it has not already gone off. */
  function resumeLeague(world, st, hooks) {
    const halfway = leagueCut(st, 1, 2);
    if (!st.midSeasonDone) {
      advanceLeague(world, st, halfway);
      if (hooks && hooks.midSeason) hooks.midSeason(st.leagueId, leagueStanding(st), leagueClubs(world, st));
      st.midSeasonDone = true;
    }
    advanceLeague(world, st, st.fixtures.length);
    return finishLeague(st);
  }

  function runLeague(world, leagueId, hooks) {
    const st = beginLeague(world, leagueId);
    if (!st) return null;
    return resumeLeague(world, st, hooks);
  }

  /* ------------------------------- CUPS ------------------------------------
   * A single-elimination knockout over an arbitrary field. Byes go to the
   * highest-reputation clubs, which is how a National League side ends up
   * playing its first tie in the third round against a Championship club. */
  const ROUND_LABELS = ["F", "SF", "QF", "R5", "R4", "R3", "R2", "R1"];

  function roundLabel(roundsRemaining) {
    return ROUND_LABELS[Math.min(roundsRemaining - 1, ROUND_LABELS.length - 1)] || "R1";
  }

  /* ------------------------ KNOCKOUTS, ONE ROUND AT A TIME -----------------
   * A cup used to be played start to finish inside a single call, which was
   * right when a season was one call too. With the campaign split into
   * two-month blocks it is not: a cup that resolves in one go either happens
   * entirely in one block (so four of the five blocks have no cup football in
   * them at all) or has to be held back to the end of the season, where the
   * manager finds out he went out in the third round at the same moment he
   * finds out where he finished.
   *
   * So the tournament is a STATE that rounds are played against, and
   * runKnockout below is now a loop over that state — same arguments, same
   * return shape, same results for the same seed, so every existing caller is
   * untouched. What is new is that world.js can hold the state between blocks
   * and play one round at a time.
   *
   * The draw for each round is made when that round is played, not up front.
   * That matters for the seeded RNG: shuffling only the clubs still alive, at
   * the moment they are still alive, is what the original loop did, and doing
   * it any other way would change every cup result in the game. */
  function beginKnockout(world, field, opts) {
    const rng = world.rng;
    const o = opts || {};
    if (!field || field.length < 2) return null;

    // Pad the field to a power of two with byes for the biggest clubs.
    const seeded = field.slice().sort((a, b) => b.reputation - a.reputation);
    let size = 1;
    while (size < seeded.length) size *= 2;
    const byes = size - seeded.length;

    const alive = seeded.slice(byes).map((c) => c.id);      // play the opening round
    const waiting = seeded.slice(0, byes).map((c) => c.id);  // enter next round
    rng.shuffle(alive);

    return {
      opts: o, name: o.name,
      alive, waiting, byes,
      openingRoundPending: byes > 0,
      roundsRemaining: Math.log2(size),
      exits: {}, log: [],
      done: false, winnerId: null,
    };
  }

  /* A round is played against club objects but the state only ever holds ids,
   * for the same reason the fixture list does — see buildFixtures. */
  function resolveAlive(world, st) {
    return st.alive.map((id) => world.clubById(id)).filter(Boolean);
  }

  /** Play ONE round. Returns the round's label, or null if it is over. */
  function knockoutRound(world, st) {
    if (!st || st.done) return null;
    const rng = world.rng;
    const o = st.opts;

    /* The opening round, when byes exist, is only half a round wide — the
     * seeded clubs sitting out join the winners afterwards. Treated as the
     * same DEPTH as the round they enter at, exactly as before. */
    if (st.openingRoundPending) {
      const label = roundLabel(st.roundsRemaining);
      const field = resolveAlive(world, st);
      const winners = [];
      for (let i = 0; i + 1 < field.length; i += 2) {
        const a = field[i], b = field[i + 1];
        const res = playCupTie(world, a, b, o);
        st.exits[res.loser.id] = label;
        winners.push(res.winner.id);
        st.log.push({ round: label, home: a.name, away: b.name, ...res.score, winnerId: res.winner.id });
      }
      if (field.length % 2 === 1) winners.push(field[field.length - 1].id);
      st.alive = st.waiting.concat(winners);
      st.waiting = [];
      st.roundsRemaining--;
      st.openingRoundPending = false;
      if (st.alive.length <= 1) { st.done = true; st.winnerId = st.alive[0] || null; if (st.winnerId) st.exits[st.winnerId] = "W"; }
      return label;
    }

    if (st.alive.length <= 1) {
      st.done = true;
      st.winnerId = st.alive[0] || null;
      if (st.winnerId) st.exits[st.winnerId] = "W";
      return null;
    }

    rng.shuffle(st.alive);
    const label = roundLabel(st.roundsRemaining);
    const field = resolveAlive(world, st);
    const winners = [];
    for (let i = 0; i + 1 < field.length; i += 2) {
      const a = field[i], b = field[i + 1];
      const final = field.length === 2;
      const res = playCupTie(world, a, b, { ...o, neutral: final || o.neutral, legs: final ? 1 : o.legs });
      st.exits[res.loser.id] = label;
      winners.push(res.winner.id);
      st.log.push({ round: label, home: a.name, away: b.name, ...res.score, winnerId: res.winner.id });
    }
    if (field.length % 2 === 1) winners.push(field[field.length - 1].id);
    st.alive = winners;
    st.roundsRemaining--;
    if (st.alive.length <= 1) {
      st.done = true;
      st.winnerId = st.alive[0] || null;
      if (st.winnerId) st.exits[st.winnerId] = "W";
    }
    return label;
  }

  /** How many rounds are still to be played. Used to spread a cup over blocks. */
  function knockoutRoundsLeft(st) {
    if (!st || st.done) return 0;
    let n = st.openingRoundPending ? 1 : 0;
    let alive = st.openingRoundPending ? st.waiting.length + Math.ceil(st.alive.length / 2) : st.alive.length;
    while (alive > 1) { n++; alive = Math.ceil(alive / 2); }
    return n;
  }

  function finishKnockout(world, st) {
    if (!st) return null;
    return {
      name: st.name,
      winner: st.winnerId ? world.clubById(st.winnerId) : null,
      exits: st.exits, log: st.log,
    };
  }

  /** The whole tournament in one call — unchanged behaviour, now expressed as
   *  a loop over the resumable pieces above. */
  function runKnockout(world, field, opts) {
    const st = beginKnockout(world, field, opts);
    if (!st) return null;
    while (!st.done) {
      if (knockoutRound(world, st) === null && !st.done) break;
    }
    return finishKnockout(world, st);
  }

  function playCupTie(world, a, b, o) {
    const rng = world.rng;
    const comp = o.competition || "cup";
    const ap = world.profile(a.id, comp), bp = world.profile(b.id, comp);
    if (o.legs === 2) {
      const tie = MG.match.simulateTie(rng, ap, bp, { legs: 2 });
      const winner = tie.winner.id === a.id ? a : b;
      const loser = winner.id === a.id ? b : a;
      attributeTie(world, a, b, tie.aGoals, tie.bGoals);
      return { winner, loser, score: { homeGoals: tie.aGoals, awayGoals: tie.bGoals, twoLegs: true } };
    }
    const res = MG.match.simulateMatch(rng, ap, bp, { neutral: !!o.neutral, derby: MG.match.isDerby(a.name, b.name) });
    let winner, loser;
    if (res.homeGoals > res.awayGoals) { winner = a; loser = b; }
    else if (res.awayGoals > res.homeGoals) { winner = b; loser = a; }
    else {
      const edge = (ap.attack + ap.defence - bp.attack - bp.defence) / 300;
      const aWins = rng.next() < 0.5 + clamp(edge, -0.18, 0.18);
      winner = aWins ? a : b; loser = aWins ? b : a;
    }
    attributeTie(world, a, b, res.homeGoals, res.awayGoals);
    return { winner, loser, score: { homeGoals: res.homeGoals, awayGoals: res.awayGoals } };
  }

  function attributeTie(world, a, b, aGoals, bGoals) {
    const rng = world.rng;
    MG.match.attributeGoals(rng, world.selection(a.id), aGoals);
    MG.match.attributeGoals(rng, world.selection(b.id), bGoals);
    MG.match.recordAppearances(rng, world.selection(a.id));
    MG.match.recordAppearances(rng, world.selection(b.id));
  }

  /* Prize money by how far a club goes, in £m, scaled by competition. */
  const CUP_PRIZE = { R1: 0, R2: 0.1, R3: 0.3, R4: 0.6, R5: 1.2, QF: 2.2, SF: 4, F: 7, W: 12 };
  const EURO_PRIZE = {
    UCL:  { R1: 0, R2: 0, R3: 18, R4: 22, R5: 26, QF: 34, SF: 48, F: 64, W: 85 },
    UEL:  { R1: 0, R2: 0, R3: 6,  R4: 8,  R5: 10, QF: 14, SF: 20, F: 26, W: 34 },
    UECL: { R1: 0, R2: 0, R3: 3,  R4: 4,  R5: 5,  QF: 7,  SF: 10, F: 13, W: 17 },
  };

  /* ------------------------------- EUROPE ---------------------------------
   * Qualification from the four European leagues in the database, then a
   * straight knockout. The real competitions have a league phase; this is a
   * deliberate simplification that keeps the number of simulated matches
   * sensible while still producing a champion, prize money and the European
   * places that a boardroom's targets are written against. */
  const EURO_LEAGUES = ["PL", "LaLiga", "SerieA", "Bundesliga"];

  function europeanQualifiers(seasonResults, cupWinners) {
    const entries = { UCL: [], UEL: [], UECL: [] };
    for (const leagueId of EURO_LEAGUES) {
      const res = seasonResults[leagueId];
      if (!res) continue;
      res.table.forEach((row, i) => {
        if (i < 4) entries.UCL.push(row.clubId);
        else if (i < 6) entries.UEL.push(row.clubId);
        else if (i < 7) entries.UECL.push(row.clubId);
      });
      // The domestic cup winner takes a Europa League place.
      const cw = cupWinners[MG.clubs.LEAGUES[leagueId].country];
      if (cw && !entries.UCL.includes(cw) && !entries.UEL.includes(cw)) entries.UEL.push(cw);
    }
    return entries;
  }

  /* --------------------- PROMOTION AND RELEGATION -------------------------
   * Two automatic places plus a play-off, resolved as an actual four-team
   * play-off rather than a weighted draw, so the club that goes up is the one
   * that won the matches. */
  function runPlayoff(world, contenders) {
    if (contenders.length < 4) return contenders[0] || null;
    const [c3, c4, c5, c6] = contenders;
    const semi1 = MG.match.simulateTie(world.rng, world.profile(c3.id), world.profile(c6.id), { legs: 2 });
    const semi2 = MG.match.simulateTie(world.rng, world.profile(c4.id), world.profile(c5.id), { legs: 2 });
    const f1 = world.clubById(semi1.winner.id), f2 = world.clubById(semi2.winner.id);
    const final = MG.match.simulateTie(world.rng, world.profile(f1.id), world.profile(f2.id), { legs: 1, neutral: true });
    return world.clubById(final.winner.id);
  }

  function runPromotionRelegation(world, seasonResults) {
    const moves = [];
    const pyramid = MG.clubs.ENGLISH_PYRAMID;
    for (let i = 0; i < pyramid.length - 1; i++) {
      const upperId = pyramid[i], lowerId = pyramid[i + 1];
      const upper = seasonResults[upperId], lower = seasonResults[lowerId];
      if (!upper || !lower) continue;
      const upperCfg = MG.clubs.LEAGUES[upperId];
      const down = upperCfg.down || 3;
      const autoUp = lowerId === "NationalLeague" ? 1 : 2;

      const relegated = upper.table.slice(-down).map((r) => world.clubById(r.clubId));
      const promotedAuto = lower.table.slice(0, autoUp).map((r) => world.clubById(r.clubId));
      const playoffField = lower.table.slice(autoUp, autoUp + 4).map((r) => world.clubById(r.clubId));
      const playoffWinner = playoffField.length >= 4 ? runPlayoff(world, playoffField) : playoffField[0];
      const promoted = promotedAuto.concat(playoffWinner ? [playoffWinner] : []);

      for (const c of relegated) {
        c.leagueId = lowerId;
        c.history.relegations++;
        MG.clubs.adjustReputation(c, -3);
        moves.push({ type: "relegated", club: c.name, from: upperId, to: lowerId });
      }
      for (const c of promoted) {
        c.leagueId = upperId;
        c.history.promotions++;
        MG.clubs.adjustReputation(c, 3);
        moves.push({ type: "promoted", club: c.name, from: lowerId, to: upperId, viaPlayoff: playoffWinner && c.id === playoffWinner.id });
      }
    }
    return moves;
  }

  MG.competitions = {
    newRow, recordResult, sortTable, buildRounds, runLeague,
    beginLeague, advanceLeague, resumeLeague, finishLeague, leagueStanding, leagueClubs, leagueCut,
    runKnockout, beginKnockout, knockoutRound, knockoutRoundsLeft, finishKnockout,
    roundLabel, ROUND_LABELS, CUP_PRIZE, EURO_PRIZE,
    EURO_LEAGUES, europeanQualifiers, runPromotionRelegation, runPlayoff,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
