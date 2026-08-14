/* ============================================================================
 * FOOTBALL MANAGER — SCOUTING, DATA-DRIVEN FOCUS
 *
 * Report formula 7. Until now the game showed every club and every player at
 * full resolution — a National League side's scouting department could read a
 * Real Madrid dressing room as accurately as its own. That is backwards: a
 * scouting department is an asset like any other, built out of money, staff
 * and reach, and a small club's read on the wider game should be a guess, not
 * a certainty.
 *
 * FOUR INPUTS, all of them numbers the game already keeps somewhere:
 *   Training Ground Quality   club.facilities.scouting — the department's own
 *                              staff and analysis, distinct from the pitches
 *                              and gym that train the first team
 *   Board & Team Wealth       club.board.wealth — hidden from the player,
 *                              exactly like the boardroom's own finances are
 *   Morale & Happiness        the average of club.board.confidence and
 *                              club.fans — a club at war with itself reads
 *                              the game worse than a settled one does
 *   Scout Strength            the club's reach (network.js) blended with the
 *                              manager's transferAcumen — a wide network run
 *                              by a sharp eye beats a narrow one run badly
 *
 * WHAT IT PRODUCES
 *   A single 0-100 STRENGTH score, and — the actual gameplay effect — a
 *   scouted FLOOR/CEILING band around any other club's ratings or any other
 *   club's player's rating, exactly the pattern the academy already uses for
 *   its own prospects (youth.js). Your own club is always read exactly; a
 *   rival two divisions away, scouted by a threadbare department, might be
 *   ten points wide in either direction.
 *
 *   This is entirely a DISPLAY layer — it fuzzes what is shown, never what the
 *   match engine actually uses to play a game out — so it cannot touch the
 *   realism benchmark. The bands are DETERMINISTIC (a hash of the two club ids
 *   and the player, not the world's RNG) so the same pairing reads the same
 *   way from one screen to the next instead of rerolling on every render.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /* A cheap, stable pseudo-random number in [0, 1) from an integer seed —
   * no state, so the same (viewer, target[, player]) triple always reads the
   * same until the underlying rating actually moves. */
  function hashRand(seed) {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  const NETWORK_TIER_SCORE = { global: 92, continental: 72, regional: 50, home: 28 };

  /** Which reach ring a club's own network sits in — mirrors network.js's own
   *  bands so the two systems always agree on what "global reach" means. */
  function networkTier(club) {
    if (!MG.network) return "home";
    if (club.leagueId === "Saudi") return "global";
    const rep = club.reputation;
    return rep >= MG.network.GLOBAL_REP ? "global"
      : rep >= MG.network.CONTINENTAL_REP ? "continental"
        : rep >= MG.network.REGIONAL_REP ? "regional" : "home";
  }

  /** How good this club's intelligence department is right now, 0-100, with
   *  the four inputs broken out for the tactics screen to explain itself. */
  function strength(world, club) {
    const manager = world.managerById ? world.managerById(club.managerId) : null;
    const training = club.facilities.scouting != null ? club.facilities.scouting : club.facilities.training;
    const wealth = (club.board && club.board.wealth != null) ? club.board.wealth : 50;
    const morale = ((club.board ? club.board.confidence : 55) + (club.fans != null ? club.fans : 56)) / 2;
    const tier = networkTier(club);
    const acumen = manager ? (manager.attrs.transferAcumen || 55) : 55;
    const network = (NETWORK_TIER_SCORE[tier] || 28) * 0.7 + acumen * 0.3;

    const score = clamp(Math.round(training * 0.30 + wealth * 0.25 + morale * 0.20 + network * 0.25), 5, 99);
    return { score, training: Math.round(training), wealth: Math.round(wealth), morale: Math.round(morale), network: Math.round(network), tier };
  }

  const STRENGTH_LABELS = [
    { at: 78, label: "Elite network", blurb: "Contacts everywhere, and the staff to act on what they see." },
    { at: 60, label: "Well-resourced", blurb: "A proper department. Reports you can mostly trust." },
    { at: 42, label: "Modest", blurb: "A handful of scouts covering a lot of ground." },
    { at: 24, label: "Threadbare", blurb: "One man, a laptop, and hope." },
    { at: 0, label: "Nonexistent", blurb: "Word of mouth and what you can see with your own eyes." },
  ];
  function strengthLabel(score) {
    for (const l of STRENGTH_LABELS) if (score >= l.at) return l;
    return STRENGTH_LABELS[STRENGTH_LABELS.length - 1];
  }

  /** How well `viewer` actually knows `target` — playing them twice a season
   *  tells you more than a name in a foreign table you can barely reach. */
  function familiarity(viewer, target) {
    if (viewer.id === target.id) return 1;
    if (viewer.leagueId === target.leagueId) return 0.82;
    if (MG.network && MG.network.canRecruit(viewer, target)) return 0.5;
    return 0.22;
  }

  /** The scouted band around one true rating. Width shrinks with the viewer's
   *  scouting strength and with how familiar the target actually is; a club
   *  scouting itself always gets the true number back. */
  function band(world, viewer, target, trueValue, seed) {
    const v = Math.round(trueValue);
    if (viewer.id === target.id) return { floor: v, ceiling: v, confident: true };
    const st = strength(world, viewer).score;
    const fam = familiarity(viewer, target);
    const noise = clamp((1 - fam) * 15 + (1 - st / 100) * 11, 1, 24);
    const off = (hashRand(seed) - 0.5) * 2;   // stable -1..1 for this pairing
    const centre = trueValue + off * noise * 0.35;
    return {
      floor: Math.round(clamp(centre - noise, 1, 99)),
      ceiling: Math.round(clamp(centre + noise, 1, 99)),
      confident: noise <= 6,
    };
  }

  /** A rival club's intelligence report: the department's own read on itself,
   *  plus the three unit ratings as bands rather than points. */
  function clubReport(world, viewer, target) {
    const r = target.ratings;
    const s = strength(world, viewer);
    const seedBase = viewer.id * 100003 + target.id * 7;
    return {
      strength: s,
      label: strengthLabel(s.score),
      attack: band(world, viewer, target, r.attack, seedBase + 1),
      midfield: band(world, viewer, target, r.midfield, seedBase + 2),
      defence: band(world, viewer, target, r.defence, seedBase + 3),
    };
  }

  /** One player's scouted rating, as seen by a rival club. */
  function playerBand(world, viewer, target, player) {
    return band(world, viewer, target, player.overall, viewer.id * 100003 + target.id * 131 + player.id);
  }

  MG.scouting = {
    strength, strengthLabel, STRENGTH_LABELS, networkTier, familiarity, band, clubReport, playerBand,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
