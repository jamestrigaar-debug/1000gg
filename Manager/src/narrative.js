/* ============================================================================
 * FOOTBALL MANAGER — THE STORY OF THE SEASON
 *
 * The world was never short of detail; it was short of TESTIMONY. The match
 * engine computes, for every one of five thousand fixtures, how many chances
 * each side deserved and whether the result defied them — and then reported a
 * score. A player looking at "lost 1-0" had no way to know whether his team
 * had been outclassed or had hit the woodwork four times.
 *
 * This module reads what the simulation already produced and says it out loud:
 *
 *   PLAYER RATINGS   a season mark out of ten for everyone who played, derived
 *                    from what he actually contributed relative to his position
 *   MATCH REPORTS    the handful of matches that defined the season, each with
 *                    the reason it went the way it did
 *   THE STORY        form streaks, the turning point, who carried the team
 *
 * NOTHING HERE INVENTS ANYTHING. Every sentence is derived from a number the
 * engine already computed — xG against goals, the upset flag, the derby flag,
 * appearances, injuries. If the text says the team was wasteful, it is because
 * expected goals genuinely outran real ones. That rule is what stops this from
 * becoming decorative flavour text, which is the one thing it must not be.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp, round1 } = MG.util;

  /* ----------------------------- PLAYER RATINGS ----------------------------
   * A season mark out of ten, on the scale football actually uses: 6.0 is a
   * competent season nobody remembers, 7.0 is good, 8+ is a season that wins
   * awards. Judged against what a player in that position is FOR — a striker
   * on goals, a centre-half on what the team conceded — so a defender is never
   * punished for not scoring. */
  const GOAL_EXPECTATION = { FW: 0.46, WG: 0.34, AM: 0.32, CM: 0.16, DM: 0.09, FB: 0.09, CB: 0.06, GK: 0.01 };

  function seasonRating(player, club, outcome) {
    const apps = player.season.apps || 0;
    if (!apps) return null;                       // did not play: no mark
    const pos = player.pos;
    const expected = GOAL_EXPECTATION[pos] != null ? GOAL_EXPECTATION[pos] : 0.15;
    const per = (player.season.goals + player.season.assists * 0.6) / apps;
    const attacking = pos === "FW" || pos === "WG" || pos === "AM";

    let r = 6.5 + (per - expected) * (attacking ? 2.4 : 4.2);

    // Defenders and keepers ride the team's defensive record, because that is
    // the thing their season is actually measured by.
    if (pos === "GK" || pos === "CB" || pos === "FB") {
      const gaPg = outcome && outcome.played ? (outcome.ga || 0) / outcome.played : 1.35;
      r += clamp((1.35 - gaPg) * 1.2, -1.2, 1.2);
    }
    // Quality relative to the division he plays in, and the season's form roll.
    r += clamp((player.overall - (club.level || 60)) * 0.045, -1.1, 1.4);
    r += ((player.season.form || 1) - 1) * 2.0;
    // A player who barely featured cannot carry a headline mark.
    if (apps < 10) r -= 0.45;
    return clamp(round1(r), 4.0, 9.6);
  }

  /** Mark every player at a club for the season just played.
   *
   *  The mark is written to `lastSeason` as well as to `season`, because
   *  `p.season` is replaced wholesale when the new campaign starts — a rating
   *  left only there was gone by the time anyone could look at it. `lastSeason`
   *  is the player's permanent record of the year just finished, and carrying
   *  his overall in it is what lets the squad list show how far he came. */
  function rateSquad(club, outcome) {
    for (const p of club.squad) {
      const rating = seasonRating(p, club, outcome);
      p.season.rating = rating;
      p.lastSeason = {
        season: outcome ? outcome.season : null,
        rating,
        apps: p.season.apps || 0,
        goals: p.season.goals || 0,
        assists: p.season.assists || 0,
        // His level at the end of the season, BEFORE the summer's development
        // pass — so comparing it with his current overall shows a year's growth.
        overall: p.overall,
        club: club.name,
      };
    }
  }

  /* ------------------------------ MATCH REPORTS ---------------------------- */
  const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  /** One match from the managed club's point of view. */
  function fromClub(m, clubId) {
    const home = m.homeId === clubId;
    return {
      home,
      opponent: home ? m.awayName : m.homeName,
      gf: home ? m.hg : m.ag,
      ga: home ? m.ag : m.hg,
      xgFor: home ? m.homeXG : m.awayXG,
      xgAgainst: home ? m.awayXG : m.homeXG,
      upset: m.upset, derby: m.derby, round: m.round, competition: m.competition,
    };
  }

  /* The reason a match went the way it did, read off the engine's own numbers.
   * The gap between expected goals and real ones is the whole story of most
   * football matches, and it is a number we already have. */
  function whyLine(v) {
    const won = v.gf > v.ga, drew = v.gf === v.ga;
    const xgEdge = v.xgFor - v.xgAgainst;          // who deserved more
    const luck = (v.gf - v.ga) - xgEdge;           // how far the score outran it

    /* The MARGIN outranks the underlying numbers. Reading xG first produced
     * sentences that argued with the scoreline printed next to them — a 6-1 win
     * described as "a smash and grab" because the expected goals were level, and
     * a 0-4 defeat as "fine margins". Three goals is not a fine margin whatever
     * the chances said, so a rout is called a rout first and the xG only
     * colours HOW emphatic it was. */
    const margin = Math.abs(v.gf - v.ga);
    if (won) {
      if (margin >= 3) return luck > 1.5 ? "a rout, and even more emphatic than the play deserved" : "a rout from first minute to last";
      if (xgEdge < -0.3) return "a smash and grab — they had the better of it and you won anyway";
      if (luck > 1.2) return "ruthless: every half-chance went in";
      if (xgEdge > 1.2) return "thoroughly deserved; you created far more than they did";
      return "a tight one, decided by the chances that went in";
    }
    if (drew) {
      if (xgEdge > 1) return "two points dropped — you made the chances and could not take them";
      if (xgEdge < -1) return "a point rescued; you were second best throughout";
      return "an even game that nobody deserved to win";
    }
    if (margin >= 3) return xgEdge > 0 ? "a hammering the performance did not deserve — every mistake was punished" : "taken apart";
    if (xgEdge > 0.8) return "harsh — you had the better of it and lost anyway";
    if (xgEdge < -1.2) return "outplayed from start to finish";
    return "fine margins, and they fell the wrong way";
  }

  function scoreLine(v) {
    return `${v.gf}-${v.ga} ${v.home ? "at home to" : "away at"} ${v.opponent}`;
  }

  /** Turn one match into a reportable sentence. */
  function matchReport(v) {
    const verb = v.gf > v.ga ? "Beat" : v.gf === v.ga ? "Drew with" : "Lost to";
    const head = v.gf > v.ga ? `${verb} ${v.opponent} ${v.gf}-${v.ga}`
      : v.gf === v.ga ? `Drew ${v.gf}-${v.ga} with ${v.opponent}`
        : `Lost ${v.gf}-${v.ga} to ${v.opponent}`;
    const tags = [];
    if (v.derby) tags.push("derby");
    if (v.upset) tags.push("against the odds");
    return `${head}${v.home ? "" : ", away"}${tags.length ? ` (${tags.join(", ")})` : ""} — ${whyLine(v)}.`;
  }

  /* ------------------------------- THE STORY -------------------------------
   * Which matches actually defined the season. A full fixture-by-fixture report
   * would be forty lines nobody reads; these are the five or six a supporter
   * would still be talking about in June. */
  function keyMatches(matches, clubId) {
    const views = matches.map((m) => fromClub(m, clubId));
    if (!views.length) return [];
    const picked = [];
    const take = (v, why) => {
      if (!v || picked.some((p) => p.v === v)) return;
      picked.push({ v, why });
    };

    const byMargin = views.slice().sort((a, b) => (b.gf - b.ga) - (a.gf - a.ga));
    take(byMargin[0], "best result");
    take(byMargin[byMargin.length - 1], "worst result");

    // The giant-killings, both directions — the engine flags these explicitly.
    const upsetWin = views.find((v) => v.upset && v.gf > v.ga);
    const upsetLoss = views.find((v) => v.upset && v.gf < v.ga);
    take(upsetWin, "upset win");
    take(upsetLoss, "upset defeat");

    // The derbies always matter, whatever the score.
    for (const v of views.filter((v2) => v2.derby).slice(0, 2)) take(v, "derby");

    // The night the chances would not go in: biggest xG overperformance against.
    const robbed = views.slice().sort((a, b) =>
      ((a.gf - a.ga) - (a.xgFor - a.xgAgainst)) - ((b.gf - b.ga) - (b.xgFor - b.xgAgainst)))[0];
    take(robbed, "hard luck");

    return picked.slice(0, 6);
  }

  /** The longest unbeaten and losing runs — the shape of the season. */
  function streaks(matches, clubId) {
    let bestUnbeaten = 0, run = 0, worstLosing = 0, losing = 0;
    for (const m of matches) {
      const v = fromClub(m, clubId);
      if (v.gf >= v.ga) { run++; bestUnbeaten = Math.max(bestUnbeaten, run); } else run = 0;
      if (v.gf < v.ga) { losing++; worstLosing = Math.max(worstLosing, losing); } else losing = 0;
    }
    return { bestUnbeaten, worstLosing };
  }

  /**
   * The full written season for the managed club: ratings, the matches that
   * mattered, and the shape of the campaign. Returns log lines; the caller
   * decides where they go.
   */
  function seasonStory(world, club, outcome) {
    const lines = [];
    const matches = (world.playerMatches || []).filter((m) => m.homeId === club.id || m.awayId === club.id);
    if (!matches.length) return lines;

    const { bestUnbeaten, worstLosing } = streaks(matches, club.id);
    if (bestUnbeaten >= 5) lines.push(`A run of ${bestUnbeaten} unbeaten was the backbone of the season.`);
    if (worstLosing >= 4) lines.push(`A run of ${worstLosing} straight defeats was where it came apart.`);

    for (const { v } of keyMatches(matches, club.id)) lines.push(matchReport(v));

    // Who actually had a season, by the marks just awarded.
    const rated = club.squad.filter((p) => p.season.rating != null && (p.season.apps || 0) >= 8)
      .sort((a, b) => b.season.rating - a.season.rating);
    if (rated.length) {
      const best = rated[0];
      lines.push(`Player of the season: ${best.name} (${best.pos}) — ${best.season.rating.toFixed(1)} from ${best.season.apps} appearances.`);
      const worst = rated[rated.length - 1];
      if (worst && worst.season.rating <= 5.9 && worst.id !== best.id) {
        lines.push(`${worst.name} struggled all year — ${worst.season.rating.toFixed(1)} across ${worst.season.apps} games.`);
      }
    }
    return lines;
  }

  MG.narrative = {
    GOAL_EXPECTATION, seasonRating, rateSquad,
    fromClub, whyLine, matchReport, keyMatches, streaks, seasonStory, scoreLine, ord,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
