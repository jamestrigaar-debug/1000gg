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
  function teamMorale(club, knownXI) {
    if (!club.squad.length) return 60;
    const xi = new Set((knownXI || effectiveXI(club)).map((p) => p && p.id));
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

    /* Picking a side is the hottest path in the whole engine — every club in
     * the world picks one several times a summer — so the two counts this
     * needs are taken in a single pass instead of a filter per slot, and the
     * squad is split by keeper/outfielder once rather than re-testing every
     * player against every slot. Same eleven out the other end. */
    const posCount = {};
    const keepers = [], outfield = [];
    for (const p of available) {
      posCount[p.pos] = (posCount[p.pos] || 0) + 1;
      (p.pos === "GK" ? keepers : outfield).push(p);
    }

    // Fill specialist slots first (a keeper, then the rest), because filling
    // an easy slot with a specialist leaves the hard slot to a passenger.
    const order = formation.slots
      .map((slot, i) => ({ slot, i, scarcity: slot === "GK" ? 0 : (posCount[slot] || 0) }))
      .sort((a, b) => a.scarcity - b.scarcity);

    for (const { slot, i } of order) {
      let best = null, bestScore = -Infinity;
      // Never put an outfielder in goal, or a keeper outfield, while any
      // alternative exists — the familiarity penalty alone is not enough.
      const eligible = slot === "GK" ? keepers : outfield;
      for (const p of eligible) {
        if (taken.has(p.id)) continue;
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
    const covers = backupsFor(club, xi).filter((r) => r.backup && r.slot !== "GK");
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
  /* `knownXI` is an optimisation, not a feature: picking a side is the single
   * most expensive thing the engine does, and xiRatings/depthScore both used to
   * compute the XI and then call in here, which computed exactly the same XI a
   * second time. Callers that already have it pass it through; callers that do
   * not still get the old behaviour. */
  /* The assignment has to be made ACROSS the whole bench at once, not shirt by
   * shirt down the team sheet. Walking the slots in formation order and giving
   * each one the best player still unused spent the good reserves on whichever
   * shirts happened to come first and left the rest with whoever was still
   * standing — measured on a champion squad it put the reserve goalkeeper at
   * centre-forward and a defensive midfielder on the wing, and reported the
   * side as having no depth at all. By season three 120 of 221 clubs scored a
   * flat zero, which is not a squad problem, it is an ordering artefact.
   *
   * Instead: score every (spare player, shirt) pair, take them best-first, and
   * lock in each pairing whose player and shirt are both still free. A reserve
   * keeper's best pair by a mile is the goalkeeping shirt, so that is where he
   * lands and he is never in contention for the forward line. Greedy on a
   * sorted pair list is not a guaranteed optimum, but on eleven shirts it is
   * within a point or two of one and it is deterministic, which matters more
   * here than the last point of precision. */
  function backupsFor(club, knownXI) {
    const formationKey = club.formation || "4-4-2";
    const formation = FORMATIONS[formationKey] || FORMATIONS["4-4-2"];
    const xi = knownXI || effectiveXI(club);
    const xiIds = new Set(xi.map((p) => p && p.id));
    const rest = club.squad.filter((p) => !xiIds.has(p.id));
    const slots = formation.slots;

    /* Flat arrays rather than an array of {slot, player, value} objects: this
     * runs inside xiRatings, which runs inside refreshRatings, which the world
     * calls thousands of times a season — eleven shirts against a dozen spares
     * is a hundred-odd pairs each time, and a hundred-odd short-lived objects
     * each time is work for the collector that buys nothing. Two arrays and an
     * index sort do the same job with two allocations. */
    const nSlots = slots.length, nRest = rest.length;
    const vals = new Float64Array(nSlots * nRest);
    for (let i = 0; i < nSlots; i++) {
      for (let j = 0; j < nRest; j++) vals[i * nRest + j] = effectiveOverall(rest[j], slots[i]);
    }
    const order = new Array(nSlots * nRest);
    for (let k = 0; k < order.length; k++) order[k] = k;
    // Ties broken on player id, then shirt, so the same squad always reads the
    // same way however the squad array happens to be ordered.
    order.sort((a, b) => vals[b] - vals[a]
      || rest[a % nRest].id - rest[b % nRest].id
      || (a / nRest | 0) - (b / nRest | 0));
    const takenSlot = new Array(nSlots).fill(-1);
    const usedPlayer = new Uint8Array(nRest);
    let filled = 0;
    for (let k = 0; k < order.length && filled < nSlots && filled < nRest; k++) {
      const idx = order[k], i = (idx / nRest) | 0, j = idx % nRest;
      if (takenSlot[i] >= 0 || usedPlayer[j]) continue;
      takenSlot[i] = j;
      usedPlayer[j] = 1;
      filled++;
    }

    return slots.map((slot, i) => {
      const j = takenSlot[i];
      const hit = j >= 0 ? { p: rest[j], val: vals[i * nRest + j] } : null;
      const starter = xi[i];
      const dropOff = starter && hit ? Math.round(effectiveOverall(starter, slot) - hit.val) : null;
      return {
        slot, index: i, starter, backup: hit ? hit.p : null,
        rating: hit ? Math.round(hit.val) : 0,
        // How far the side drops if the starter is unavailable.
        dropOff,
        /* Someone would have to wear the shirt, and the row still names him —
         * but a man who is thirty points worse in that position is a hole the
         * team sheet is hiding, not an understudy. Counted as uncovered by
         * depthScore, and flagged as such on the screen, so a squad with a
         * reserve goalkeeper nominally "covering" centre-half does not read
         * as a squad with eleven backups. */
        adequate: !!hit && (dropOff == null || dropOff < NO_COVER_DROP),
      };
    });
  }
  const NO_COVER_DROP = 30;

  /** One number for how well covered a squad is, 0-100.
   *
   *  Calibrated against a simulated world once the assignment above was fixed:
   *  the average drop-off across a division runs about 8-16 points, so the
   *  penalty is 3.5 a point rather than 5 — at 5 an ordinary, properly stocked
   *  squad still bottomed out at zero and the number told you nothing. A drop
   *  of zero is a perfect 100; a squad averaging a 25-point cliff behind its
   *  first eleven is at 12 and deserves to be. An uncovered shirt costs 8 on
   *  top, because no cover at all is worse than bad cover. */
  function depthScore(club, knownXI) {
    const rows = backupsFor(club, knownXI);
    const covered = rows.filter((r) => r.adequate);
    if (!covered.length) return 0;
    const avgDrop = covered.reduce((t, r) => t + (r.dropOff == null ? 12 : r.dropOff), 0) / covered.length;
    const missing = rows.length - covered.length;
    return clamp(Math.round(100 - avgDrop * 3.5 - missing * 8), 0, 100);
  }

  /* ---------------------------- TACTICAL SYNERGY ---------------------------
   * Report formula 6. A club's football is not one decision, it is four:
   *
   *   PLAYSTYLE   the manager's system (MG.managers.TACTICS) — the
   *               philosophical identity, High Press or Route One
   *   TACTIC      the shape it is played in — the formation, above
   *   TRAINING    what the week is actually spent on — see TRAINING_FOCUS
   *   MANAGER     the man himself — is this the football he is actually
   *               built to coach, or a system the board asked him to bolt on
   *
   * When the four agree the side is more than the sum of its ratings: smoother
   * transitions, better pass completion, fewer defensive gaps, all of which
   * show up as one thing the match engine can actually use — a small
   * multiplier on expected goals. When they fight each other the same
   * multiplier works against you.
   *
   * The report's own worked example puts this at "+15% xG" for a perfectly
   * synergetic side over a mismatched one. That is too big a lever: the
   * formation-matchup table above caps out at a fifth of a goal precisely so
   * that shape tilts a match rather than deciding it, and this system is the
   * same kind of thing at the level of a whole season's set-up. SWING below is
   * +/-7% — a side that has everything pointing the same way plays a shade
   * better than its ratings say, a side fighting itself plays a shade worse,
   * and neither ever stops a stronger squad from winning. */
  const TRAINING_FOCUS = {
    /* `axis` is the report's Performance <-> Improvement bar: 1 is pure
     * short-term (this Saturday), 0 is pure long-term (next year). It feeds
     * developmentMultiplier below, independently of how well the focus suits
     * the manager's system. */
    matchSharpness:   { label: "Match Sharpness", axis: 1.0,
      blurb: "Shape, patterns, finishing practice. Sharper for the games ahead, no eye on next year." },
    setPieces:        { label: "Set Pieces", axis: 0.8,
      blurb: "Routines from corners and free-kicks. A cheap route to a goal, this season only." },
    highIntensity:    { label: "High-Intensity", axis: 0.6,
      blurb: "Conditioning and pressing triggers. Suits a team built to hunt the ball back." },
    balanced:         { label: "Balanced", axis: 0.5,
      blurb: "A bit of everything. Nothing sharpened, nothing neglected." },
    possessionDrill:  { label: "Possession Drilling", axis: 0.4,
      blurb: "Rondos and patient build-up. Suits a team built to keep the ball." },
    youthDevelopment: { label: "Youth Development", axis: 0.0,
      blurb: "Coaching time spent on growth rather than Saturday. Pays off in years, not weeks." },
  };
  const TRAINING_FOCUS_KEYS = Object.keys(TRAINING_FOCUS);

  /* How well each playstyle suits each formation — hand-authored the same way
   * MATCHUP is: 1.0 is textbook, low numbers are actively contradictory (a
   * high press with a back five, a possession game with no one between the
   * lines). Not every combination is listed; anything missing defaults to a
   * fair middle value in formationFit(). */
  const FORMATION_FIT = {
    Possession:     { "4-4-2": 0.45, "4-3-3": 0.80, "4-2-3-1": 0.95, "3-5-2": 0.70, "5-3-2": 0.25, "4-5-1": 0.50 },
    Counter:        { "4-4-2": 0.70, "4-3-3": 0.50, "4-2-3-1": 0.55, "3-5-2": 0.60, "5-3-2": 0.60, "4-5-1": 0.50 },
    "High Press":   { "4-4-2": 0.50, "4-3-3": 0.85, "4-2-3-1": 1.00, "3-5-2": 0.60, "5-3-2": 0.20, "4-5-1": 0.60 },
    Direct:         { "4-4-2": 0.90, "4-3-3": 0.50, "4-2-3-1": 0.50, "3-5-2": 0.50, "5-3-2": 0.55, "4-5-1": 0.70 },
    "Park the Bus": { "4-4-2": 0.40, "4-3-3": 0.15, "4-2-3-1": 0.20, "3-5-2": 0.40, "5-3-2": 1.00, "4-5-1": 0.75 },
    "Route One":    { "4-4-2": 0.80, "4-3-3": 0.30, "4-2-3-1": 0.35, "3-5-2": 0.40, "5-3-2": 0.65, "4-5-1": 0.55 },
  };
  function formationFit(tacticKey, formationKey) {
    const row = FORMATION_FIT[tacticKey];
    const v = row ? row[formationKey] : null;
    return v == null ? 0.5 : v;
  }

  /* How well each training focus serves each playstyle — a high press wants
   * high-intensity conditioning, a possession side wants the ball drilled
   * into its feet, and a team parking the bus gets more from set pieces than
   * from rondos. Youth development and a flat balanced week are deliberately
   * never terrible at anything and never ideal for anything either. */
  const TRAINING_FIT = {
    matchSharpness:   { Possession: 0.60, Counter: 0.80, "High Press": 0.70, Direct: 0.70, "Park the Bus": 0.60, "Route One": 0.60 },
    setPieces:        { Possession: 0.40, Counter: 0.60, "High Press": 0.40, Direct: 0.80, "Park the Bus": 0.80, "Route One": 1.00 },
    highIntensity:    { Possession: 0.50, Counter: 0.60, "High Press": 1.00, Direct: 0.60, "Park the Bus": 0.30, "Route One": 0.40 },
    balanced:         { Possession: 0.55, Counter: 0.55, "High Press": 0.55, Direct: 0.55, "Park the Bus": 0.55, "Route One": 0.55 },
    possessionDrill:  { Possession: 1.00, Counter: 0.30, "High Press": 0.70, Direct: 0.30, "Park the Bus": 0.30, "Route One": 0.20 },
    youthDevelopment: { Possession: 0.40, Counter: 0.40, "High Press": 0.40, Direct: 0.40, "Park the Bus": 0.40, "Route One": 0.40 },
  };
  function trainingFit(focusKey, tacticKey) {
    const row = TRAINING_FIT[focusKey];
    const v = row ? row[tacticKey] : null;
    return v == null ? 0.5 : v;
  }

  /* Whether the manager is playing his own natural game. ARCHETYPES carries
   * the system he was drafted to play; TACTICS cards (pre_system, the summer
   * decision) let the club talk him into something else. A perfectionist
   * forced into Route One is exactly the mismatch the report's "Manager
   * Style" element is about — an adaptable coach absorbs it better than a
   * rigid one does. */
  function managerFit(manager) {
    if (!manager) return 0.5;
    const archetype = MG.managers && MG.managers.ARCHETYPES ? MG.managers.ARCHETYPES[manager.archetype] : null;
    const native = archetype ? archetype.tactic : null;
    if (!native || native === manager.tactic) return 1;
    const adapt = (manager.attrs && manager.attrs.adaptability) || 50;
    return clamp(0.25 + (adapt - 40) / 130, 0.15, 0.75);
  }

  /** The synergy read for a club right now: 0-100 score, the xG multiplier the
   *  match engine applies, and the three factors that produced it (for the
   *  tactics screen — this is meant to be legible, not a hidden dice roll). */
  function synergyScore(club, manager) {
    if (!manager) return { score: 50, xgMult: 1, aligned: false, clash: false, factors: { formation: 0.5, training: 0.5, manager: 0.5 } };
    const focusKey = club.trainingFocus && TRAINING_FOCUS[club.trainingFocus] ? club.trainingFocus : "balanced";
    const fFit = formationFit(manager.tactic, club.formation || "4-4-2");
    const tFit = trainingFit(focusKey, manager.tactic);
    const mFit = managerFit(manager);
    const score = (fFit + tFit + mFit) / 3;
    const SWING = 0.07;   // +/-7% of a side's xG, top to bottom — see the header note
    const xgMult = clamp(1 + (score - 0.5) * SWING * 2, 1 - SWING, 1 + SWING);
    return {
      score: Math.round(score * 100), xgMult,
      aligned: score >= 0.8, clash: score <= 0.32,
      factors: { formation: fFit, training: tFit, manager: mFit }, focusKey,
    };
  }

  /** The OTHER half of Training Focus — development speed, independent of
   *  whether the focus suits the manager's system. Read by developSquads in
   *  transfers.js as a multiplier on coaching quality. A club that never
   *  touches this (every AI club, by default) gets exactly 1 — "balanced"
   *  sits at axis 0.5, the formula's own neutral point, so leaving the world
   *  alone leaves the world's development rates alone. */
  function developmentMultiplier(club) {
    const focus = (club.trainingFocus && TRAINING_FOCUS[club.trainingFocus]) || TRAINING_FOCUS.balanced;
    return clamp(1 + (0.5 - focus.axis) * 0.24, 0.88, 1.12);
  }

  function setTrainingFocus(club, key) {
    if (!TRAINING_FOCUS[key]) return;
    club.trainingFocus = key;
  }

  /* A sensible default for a manager nobody has told what to do — set once,
   * when he takes the job (world.js's appointManager), the same moment his
   * tactic and formation are set. The player can then change it like any
   * other tactics-screen lever; the AI never revisits it. */
  function autoTrainingFocus(manager) {
    if (!manager) return "balanced";
    const traits = manager.traits || [];
    if (traits.includes("Youth Developer")) return "youthDevelopment";
    if (traits.includes("Set-Piece Specialist")) return "setPieces";
    if (manager.tactic === "High Press") return "highIntensity";
    if (manager.tactic === "Possession") return "possessionDrill";
    if (traits.includes("Analytics") || traits.includes("Tinkerer")) return "matchSharpness";
    return "balanced";
  }

  /* A cheap fingerprint of WHO is in a squad — used by world.js's selection
   * cache to notice a signing, a sale or a promotion without every one of
   * those call sites needing to remember to invalidate it by hand. Sum of
   * ids rather than a sorted join: collisions are astronomically unlikely
   * for a squad-sized set and this is called every time a match is about to
   * be simulated, so it has to be next to free. */
  function squadStamp(club) {
    let s = club.squad.length * 100003;
    for (const p of club.squad) s += p.id;
    return s;
  }

  /* ---------------------- TACTICAL PREDICTABILITY ---------------------------
   * A system that never changes gets worked out. Every other side in the
   * division watches you twice a year, and by the fourth or fifth season of the
   * same playstyle in the same shape they know where the ball is going before
   * you play it.
   *
   * This is the answer to the flattest thing about a long career: find a set-up
   * that beats the league, and there was previously no reason on earth ever to
   * touch it again. Nothing degraded, nobody adjusted, and the tenth season
   * played exactly like the second. Now standing still has a price, and it
   * compounds in the one direction a manager cannot buy his way out of.
   *
   * Deliberately symmetric — every club in the world is aged the same way, so a
   * rival who has run one shape for a decade is readable to YOU as well, and it
   * shows up on the scouting screen. And deliberately escapable: changing
   * playstyle or formation resets the clock, at the cost of the settling-in
   * penalty the tactical decision cards already charge. That trade — a
   * known quantity going stale versus a fresh idea that needs a season to bed
   * in — is the decision this whole mechanic exists to create.
   *
   * A system is (playstyle, formation). Changing either resets it: a new shape
   * for the same philosophy is genuinely new information for an opponent. */
  const PREDICT_RAMP = 5;        // seasons from brand new to fully worked out
  const PREDICT_COST = 2.5;      // attack rating points at full predictability

  function systemKey(club, manager) {
    const style = manager ? manager.tactic : (club.tacticalStyle || "Possession");
    return `${style}|${club.formation || "4-4-2"}`;
  }

  /** Advance the clock. Called once a season, before a ball is kicked. */
  function ageSystem(club, manager) {
    const key = systemKey(club, manager);
    if (club._systemKey === key) club.systemSeasons = (club.systemSeasons || 1) + 1;
    else { club._systemKey = key; club.systemSeasons = 1; }
    return club.systemSeasons;
  }

  /** 0 = nobody has a read on you. 1 = the division knows what is coming. */
  function predictability(club, manager) {
    const seasons = club.systemSeasons || 1;
    // An adaptable coach disguises a system for longer — same shape on the team
    // sheet, different problem to prepare for. Uses the attribute the match
    // engine already reads for midfield, so it costs nothing new to model.
    const adapt = manager && manager.attrs ? (manager.attrs.adaptability - 60) / 200 : 0;
    return clamp((seasons - 1) / PREDICT_RAMP - adapt, 0, 1);
  }

  /** How it reads on a screen, for the pre-season brief and the scouting page. */
  function predictabilityLabel(p) {
    if (p >= 0.8) return { key: "read", label: "worked out", blurb: "the division knows exactly what is coming — a change of shape or philosophy would buy back the surprise" };
    if (p >= 0.5) return { key: "known", label: "well known", blurb: "opponents have seen this often enough to prepare for it properly" };
    if (p >= 0.25) return { key: "studied", label: "being studied", blurb: "the better-prepared sides are starting to get a read on it" };
    return { key: "fresh", label: "fresh", blurb: "nobody in the division has a settled plan for it yet" };
  }

  MG.tactics = {
    PREDICT_RAMP, PREDICT_COST, systemKey, ageSystem, predictability, predictabilityLabel,
    FORMATIONS, FORMATION_KEYS, FAMILIARITY, familiarity,
    initMorale, effectiveOverall, teamMorale, shiftMorale, settleMorale,
    autoPick, effectiveXI, setXI, setFormation, xiRatings, xiReport,
    MATCHUP, MATCHUP_XG, formationEdge, matchupLabel, backupsFor, depthScore,
    TRAINING_FOCUS, TRAINING_FOCUS_KEYS, formationFit, trainingFit, managerFit,
    synergyScore, developmentMultiplier, setTrainingFocus, autoTrainingFocus,
    squadStamp,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
