/* ============================================================================
 * FOOTBALL MANAGER — FORMATIONS, THE STARTING XI, AND MORALE
 *
 * Until now a club's attack/midfield/defence came from its whole squad. That
 * is fine for a background world but wrong for the club you manage: picking a
 * team has to matter. So the ratings now come from ELEVEN NAMED PLAYERS in a
 * formation, with the rest of the squad contributing only a depth tail.
 *
 * Every club in the world uses this — the AI auto-picks its best XI for its
 * manager's shape — so the same rules that reward you for a good team sheet
 * reward the computer, and the tables stay honest.
 *
 * THREE THINGS DECIDE WHAT AN XI IS WORTH
 *   1. quality       the players' overall ratings
 *   2. familiarity   a winger at left-back is worse at it than he looks
 *   3. morale        a player who is unhappy plays below himself
 *
 * A formation also carries a tactical bias — 3-5-2 is a midfield overload,
 * 5-3-2 is a back five — which stacks with the manager's system (Possession,
 * Counter, and so on) rather than replacing it.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp, round1 } = MG.util;

  /* ------------------------------ FORMATIONS -------------------------------
   * `slots` lists the eleven shirts and the position each one wants. `bias`
   * shifts the three unit ratings, in points, the way TACTICS.shift does. */
  const FORMATIONS = {
    "4-4-2": {
      label: "4-4-2", blurb: "Two banks of four and a strike partnership. Nothing clever, hard to break.",
      slots: ["GK", "FB", "CB", "CB", "FB", "WG", "CM", "CM", "WG", "FW", "FW"],
      bias: { attack: 1, midfield: 0, defence: 1 },
    },
    "4-3-3": {
      label: "4-3-3", blurb: "Width and a front three. Commits bodies forward.",
      slots: ["GK", "FB", "CB", "CB", "FB", "CM", "CM", "CM", "WG", "FW", "WG"],
      bias: { attack: 3, midfield: 1, defence: -1 },
    },
    "4-2-3-1": {
      label: "4-2-3-1", blurb: "A double pivot behind a three. The modern default.",
      slots: ["GK", "FB", "CB", "CB", "FB", "DM", "DM", "WG", "AM", "WG", "FW"],
      bias: { attack: 1, midfield: 3, defence: 1 },
    },
    "3-5-2": {
      label: "3-5-2", blurb: "Wing-backs and a packed middle. Owns the centre, exposed wide.",
      slots: ["GK", "CB", "CB", "CB", "FB", "CM", "CM", "CM", "FB", "FW", "FW"],
      bias: { attack: 2, midfield: 4, defence: -2 },
    },
    "5-3-2": {
      label: "5-3-2", blurb: "A back five. Concede the ball and dare them to break you down.",
      slots: ["GK", "FB", "CB", "CB", "CB", "FB", "CM", "CM", "CM", "FW", "FW"],
      bias: { attack: -2, midfield: 0, defence: 5 },
    },
    "4-5-1": {
      label: "4-5-1", blurb: "Five across the middle and a lone striker. Suffocating, blunt.",
      slots: ["GK", "FB", "CB", "CB", "FB", "WG", "CM", "DM", "CM", "WG", "FW"],
      bias: { attack: -1, midfield: 4, defence: 2 },
    },
  };
  const FORMATION_KEYS = Object.keys(FORMATIONS);

  /* --------------------------- POSITION FAMILIARITY ------------------------
   * How well a player copes in a slot that is not his own. 1.0 is his own
   * position; the numbers below are the fraction of his rating he carries into
   * someone else's. A goalkeeper anywhere else is a disaster, and so is anyone
   * else in goal — which is the point of carrying a second keeper. */
  const FAMILIARITY = {
    GK: { GK: 1.0 },
    CB: { CB: 1.0, FB: 0.85, DM: 0.75 },
    FB: { FB: 1.0, CB: 0.8, WG: 0.8, DM: 0.7 },
    DM: { DM: 1.0, CM: 0.9, CB: 0.75, FB: 0.7 },
    CM: { CM: 1.0, DM: 0.9, AM: 0.9, WG: 0.75 },
    AM: { AM: 1.0, CM: 0.88, WG: 0.85, FW: 0.8 },
    WG: { WG: 1.0, AM: 0.85, FW: 0.8, FB: 0.75 },
    FW: { FW: 1.0, AM: 0.8, WG: 0.8 },
  };
  const OUT_OF_POSITION = 0.55;   // anything not listed above

  function familiarity(playerPos, slot) {
    const row = FAMILIARITY[playerPos];
    if (!row) return OUT_OF_POSITION;
    return row[slot] != null ? row[slot] : OUT_OF_POSITION;
  }

  /* -------------------------------- MORALE ---------------------------------
   * 0-100, sitting at 60 for a settled player. It moves with playing time,
   * results and what the manager does to him — being transfer-listed is the
   * single biggest hit, which is the cost of using the list as a lever. */
  function initMorale(player) {
    if (player.morale == null) player.morale = 60;
    return player.morale;
  }

  /** Player's effective quality in a slot. Five things stack here, and each one
   *  is a lever the player can actually pull:
   *
   *    roleRating   what he is worth AT THIS ROLE, from his attributes
   *    familiarity  whether the role is his (a winger at left-back is not)
   *    morale       how he feels about being here
   *    seasonForm   his consistency roll for this campaign
   *    availability how much of the season he is fit for
   */
  function effectiveOverall(player, slot) {
    const fam = slot ? familiarity(player.pos, slot) : 1;
    const morale = (player.morale == null ? 60 : player.morale);
    // Morale is worth about +/-6% of a player's level, which is enough to swing
    // a tight season without ever turning a bad squad into a good one.
    const moraleMult = 1 + (morale - 60) / 600;
    const avail = MG.players.availability(player);
    const base = MG.ratings && slot ? MG.ratings.roleRating(player, slot) : player.overall;
    const form = (player.season && player.season.form) || 1;
    return base * fam * moraleMult * form * (0.45 + 0.55 * avail);
  }

  /** Squad-wide morale, weighted toward the players who actually play. */
  function teamMorale(club) {
    if (!club.squad.length) return 60;
    const xi = new Set(effectiveXI(club).map((p) => p && p.id));
    let total = 0, weight = 0;
    for (const p of club.squad) {
      const w = xi.has(p.id) ? 3 : 1;
      total += (p.morale == null ? 60 : p.morale) * w;
      weight += w;
    }
    return weight ? total / weight : 60;
  }

  /** Move a whole squad's morale, e.g. after a season's results. */
  function shiftMorale(club, delta, filter) {
    for (const p of club.squad) {
      if (filter && !filter(p)) continue;
      p.morale = clamp((p.morale == null ? 60 : p.morale) + delta, 5, 100);
    }
  }

  /* Season-end morale from how it went and how much each player played. */
  function settleMorale(club, outcome) {
    const target = club.board && club.board.targets ? club.board.targets.position : 10;
    const beat = target - (outcome.position || target);
    for (const p of club.squad) {
      let delta = clamp(beat * 1.5, -12, 12);
      const share = p.season.minutesShare || 0;
      // Playing is what footballers want. Not playing corrodes.
      if (share >= 0.6) delta += 5;
      else if (share >= 0.3) delta += 1;
      else if (share >= 0.12) delta -= 4;
      else delta -= 9;
      if (p.transferListed) delta -= 6;
      if ((p.season.injured || 0) > 0.4) delta -= 4;
      p.morale = clamp((p.morale == null ? 60 : p.morale) + delta, 5, 100);
    }
  }

  /* ----------------------------- PICKING A TEAM ---------------------------- */

  /** The best available XI for a formation — greedy, hardest slots first. */
  function autoPick(club, formationKey) {
    const formation = FORMATIONS[formationKey] || FORMATIONS["4-4-2"];
    const available = club.squad.filter((p) => !p.retired);
    const taken = new Set();
    const xi = new Array(formation.slots.length).fill(null);

    // Fill specialist slots first (a keeper, then the rest), because filling
    // an easy slot with a specialist leaves the hard slot to a passenger.
    const order = formation.slots
      .map((slot, i) => ({ slot, i, scarcity: slot === "GK" ? 0 : available.filter((p) => p.pos === slot).length }))
      .sort((a, b) => a.scarcity - b.scarcity);

    for (const { slot, i } of order) {
      let best = null, bestScore = -Infinity;
      for (const p of available) {
        if (taken.has(p.id)) continue;
        // Never put an outfielder in goal, or a keeper outfield, while any
        // alternative exists — the familiarity penalty alone is not enough.
        if ((slot === "GK") !== (p.pos === "GK")) continue;
        const score = effectiveOverall(p, slot);
        if (score > bestScore) { best = p; bestScore = score; }
      }
      if (!best) {
        // Nobody of the right type at all: take anyone left.
        for (const p of available) {
          if (taken.has(p.id)) continue;
          const score = effectiveOverall(p, slot) * 0.6;
          if (score > bestScore) { best = p; bestScore = score; }
        }
      }
      if (best) { taken.add(best.id); xi[i] = best; }
    }
    return xi;
  }

  /** The XI a club will actually field: the manager's picked side if it is
   *  still valid, otherwise the best available. */
  function effectiveXI(club) {
    const formationKey = club.formation || "4-4-2";
    const formation = FORMATIONS[formationKey] || FORMATIONS["4-4-2"];
    if (club.xi && club.xi.length === formation.slots.length) {
      const byId = {};
      for (const p of club.squad) byId[p.id] = p;
      const picked = club.xi.map((id) => byId[id] || null);
      // A named side is only used while everyone in it is still at the club.
      // Injuries do NOT invalidate it — picking an unfit player is a decision
      // the manager is allowed to make, and to pay for.
      if (picked.every(Boolean)) return picked;
    }
    return autoPick(club, formationKey);
  }

  /** Store a chosen XI. Pass an array of player ids in slot order. */
  function setXI(club, ids) {
    club.xi = ids ? ids.slice() : null;
    MG.clubs.refreshRatings(club);
    return club.xi;
  }

  function setFormation(club, key) {
    if (!FORMATIONS[key]) return;
    club.formation = key;
    club.xi = null;              // the old side no longer maps to the shape
    MG.clubs.refreshRatings(club);
  }

  /* --------------------------- XI -> UNIT RATINGS --------------------------
   * Each slot contributes to the three units by the same weights players.js
   * uses, but now weighted by who is actually in that slot. The bench adds a
   * small tail so that depth still counts for something across a long season. */
  function xiRatings(club) {
    const formationKey = club.formation || "4-4-2";
    const formation = FORMATIONS[formationKey] || FORMATIONS["4-4-2"];
    const xi = effectiveXI(club);
    const units = { attack: 0, midfield: 0, defence: 0 };
    const weights = { attack: 0, midfield: 0, defence: 0 };
    let keeper = 45;

    xi.forEach((p, i) => {
      if (!p) return;
      const slot = formation.slots[i];
      const value = effectiveOverall(p, slot);
      if (slot === "GK") { keeper = value; return; }
      const w = MG.players.POSITIONS[slot].unit;
      for (const unit of ["attack", "midfield", "defence"]) {
        if (w[unit] <= 0.05) continue;
        units[unit] += value * w[unit];
        weights[unit] += w[unit];
      }
    });

    /* Depth, counted per shirt rather than as a flat bench average. Seven spare
     * wingers used to look exactly as deep as a squad properly covered in every
     * position; now the tail is the average of the men who would ACTUALLY come
     * in for each starter, so cover in the positions you are thin at is what
     * moves the number. */
    const covers = backupsFor(club).filter((r) => r.backup && r.slot !== "GK");
    const benchAvg = covers.length
      ? covers.reduce((t, r) => t + r.rating, 0) / covers.length
      : 0;

    const out = {};
    for (const unit of ["attack", "midfield", "defence"]) {
      const core = weights[unit] ? units[unit] / weights[unit] : 40;
      // 88% the eleven on the pitch, 12% the squad behind them.
      out[unit] = covers.length ? core * 0.88 + benchAvg * 0.12 : core;
      out[unit] += formation.bias[unit] || 0;
    }
    out.keeper = keeper;
    return out;
  }

  /** How well the picked side fits the shape — surfaced to the player so a bad
   *  team sheet is visible before it costs points, not after. */
  function xiReport(club) {
    const formationKey = club.formation || "4-4-2";
    const formation = FORMATIONS[formationKey] || FORMATIONS["4-4-2"];
    const xi = effectiveXI(club);
    const rows = xi.map((p, i) => {
      const slot = formation.slots[i];
      if (!p) return { slot, player: null, fam: 0, warning: "empty" };
      const fam = familiarity(p.pos, slot);
      return {
        slot, player: p, fam,
        outOfPosition: fam < 0.9,
        injured: (p.season.injured || 0) > 0,
        morale: p.morale == null ? 60 : p.morale,
        warning: fam < 0.7 ? "badly out of position" : fam < 0.9 ? "out of position" : null,
      };
    });
    const problems = rows.filter((r) => r.warning).length;
    return { formation: formationKey, rows, problems, averageFamiliarity: round1(rows.reduce((t, r) => t + r.fam, 0) / rows.length * 100) };
  }

  /* ------------------------- THE MATCHUP MATRIX ----------------------------
   * Shape against shape, before a single player is considered.
   *
   * Until now a formation only changed your own rating bias; who you were
   * playing against made no difference, so a 4-4-2 was exactly as effective
   * against a midfield three as against another 4-4-2. That is the opposite of
   * how football works, and it made the formation choice nearly cosmetic.
   *
   * Read as ROW versus COLUMN: the value is what your shape is worth against
   * theirs. The table is antisymmetric — if 4-3-3 is +1 against 4-4-2 then
   * 4-4-2 is -1 against 4-3-3 — so both sides of a fixture can be looked up
   * independently and the two agree.
   *
   *   +2 strong advantage   +1 slight   0 balanced   -1 slight   -2 strong
   *
   * The logic behind the numbers, in one line each:
   *   4-4-2    two central midfielders get overrun by any midfield three
   *   4-3-3    central overload against flat fours; pins wing-backs high
   *   4-2-3-1  the No.10 sits in the hole a flat midfield two cannot cover
   *   3-5-2    spare centre-back handles two strikers; exposed behind the
   *            wing-backs against high wide forwards
   *   5-3-2    compact five denies the crossing lanes a 4-4-2 depends on
   *   4-5-1    smothers the middle against 4-4-2, outflanked by wing-backs
   */
  const MATCHUP = {
    "4-4-2":   { "4-4-2": 0, "4-3-3": -1, "4-2-3-1": -1, "3-5-2": 0, "5-3-2": -1, "4-5-1": -1 },
    "4-3-3":   { "4-4-2": 1, "4-3-3": 0, "4-2-3-1": 0, "3-5-2": 1, "5-3-2": 0, "4-5-1": 0 },
    "4-2-3-1": { "4-4-2": 1, "4-3-3": 0, "4-2-3-1": 0, "3-5-2": 1, "5-3-2": 0, "4-5-1": 0 },
    "3-5-2":   { "4-4-2": 0, "4-3-3": -1, "4-2-3-1": -1, "3-5-2": 0, "5-3-2": 0, "4-5-1": 1 },
    "5-3-2":   { "4-4-2": 1, "4-3-3": 0, "4-2-3-1": 0, "3-5-2": 0, "5-3-2": 0, "4-5-1": 0 },
    "4-5-1":   { "4-4-2": 1, "4-3-3": 0, "4-2-3-1": 0, "3-5-2": -1, "5-3-2": 0, "4-5-1": 0 },
  };
  /* What each step is worth in expected goals. A slight edge is a fifth of a
   * goal a game, which across a season is a few points — enough to matter,
   * never enough to beat a better squad on its own. */
  const MATCHUP_XG = { 2: 0.15, 1: 0.05, 0: 0, "-1": -0.05, "-2": -0.15 };

  /** What `mine` is worth in xG against `theirs`. */
  function formationEdge(mine, theirs) {
    const row = MATCHUP[mine];
    if (!row) return 0;
    const v = row[theirs];
    return v == null ? 0 : (MATCHUP_XG[v] || 0);
  }
  /** The same thing as a readable verdict, for the tactics screen. */
  function matchupLabel(mine, theirs) {
    const row = MATCHUP[mine];
    const v = row && row[theirs] != null ? row[theirs] : 0;
    return { value: v, text: v >= 2 ? "strong advantage" : v === 1 ? "slight advantage"
      : v === 0 ? "balanced" : v === -1 ? "slight disadvantage" : "strong disadvantage" };
  }

  /* ---------------------------- SQUAD DEPTH --------------------------------
   * Every shirt now has a named understudy. Depth used to be a single average
   * of the seven best players not in the side, rated in their own positions —
   * which meant a squad with three spare wingers and no reserve goalkeeper
   * looked exactly as deep as one properly covered in every position. Cover is
   * per-shirt or it is not cover. */
  function backupsFor(club) {
    const formationKey = club.formation || "4-4-2";
    const formation = FORMATIONS[formationKey] || FORMATIONS["4-4-2"];
    const xi = effectiveXI(club);
    const xiIds = new Set(xi.map((p) => p && p.id));
    const rest = club.squad.filter((p) => !xiIds.has(p.id));
    const used = new Set();
    return formation.slots.map((slot, i) => {
      let best = null, bestVal = -1;
      for (const p of rest) {
        if (used.has(p.id)) continue;
        const val = effectiveOverall(p, slot);
        if (val > bestVal) { best = p; bestVal = val; }
      }
      if (best) used.add(best.id);
      const starter = xi[i];
      return {
        slot, index: i, starter, backup: best,
        rating: best ? Math.round(bestVal) : 0,
        // How far the side drops if the starter is unavailable.
        dropOff: starter && best ? Math.round(effectiveOverall(starter, slot) - bestVal) : null,
      };
    });
  }

  /** One number for how well covered a squad is, 0-100. */
  function depthScore(club) {
    const rows = backupsFor(club);
    const covered = rows.filter((r) => r.backup);
    if (!covered.length) return 0;
    const avgDrop = covered.reduce((t, r) => t + (r.dropOff == null ? 12 : r.dropOff), 0) / covered.length;
    const missing = rows.length - covered.length;
    // No drop-off at all is a perfect 100; a twenty-point cliff is nothing.
    return clamp(Math.round(100 - avgDrop * 5 - missing * 8), 0, 100);
  }

  MG.tactics = {
    FORMATIONS, FORMATION_KEYS, FAMILIARITY, familiarity,
    initMorale, effectiveOverall, teamMorale, shiftMorale, settleMorale,
    autoPick, effectiveXI, setXI, setFormation, xiRatings, xiReport,
    MATCHUP, MATCHUP_XG, formationEdge, matchupLabel, backupsFor, depthScore,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
