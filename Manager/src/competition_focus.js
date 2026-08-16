/* ============================================================================
 * FOOTBALL MANAGER — COMPETITION FOCUS SYSTEM
 *
 * Replaces the old single "formation-based plan" concept with a more strategic
 * three-competition model. The manager sets:
 *   - One formation/playstyle for the season
 *   - Effort allocation across League, Cup, and Europe (if qualified)
 *   - How many "squad levels" to rotate through each competition
 *
 * This allows the user to:
 *   "I'm going for the league, so cup gets B-team"
 *   "I'm chasing Europe, so I'll rest the starters domestically"
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});

  /* Available effort levels for each competition. Higher level = more starters
   * get played, more investment in that specific competition. */
  const EFFORT_LEVELS = {
    minimal: { label: "Minimal", blurb: "B-team. Reserves and youth.", value: 0 },
    moderate: { label: "Moderate", blurb: "Rotated squad. Mix of starters and backups.", value: 1 },
    full: { label: "Full Strength", blurb: "Your best eleven, every game.", value: 2 }
  };

  const EFFORT_KEYS = Object.keys(EFFORT_LEVELS);

  /* Squad level distribution. A squad has multiple "levels":
   *   Level 1 = XI (starters)
   *   Level 2 = Squad rotation
   *   Level 3 = Fringe / young players
   * When effort is "minimal", that competition draws from Level 3.
   * When effort is "full", it draws from Level 1.
   */
  const EFFORT_TO_SQUAD_LEVEL = {
    minimal: 3,
    moderate: 2,
    full: 1
  };

  /** Get or create competition focus settings for a club. */
  function ensure(club) {
    if (!club.competitionFocus) {
      club.competitionFocus = {
        league: "full",      // League always starts at full effort
        cup: "moderate",     // Cup at moderate
        europe: "moderate"   // Europe (if available) at moderate
      };
    }
    return club.competitionFocus;
  }

  /** Get effort level for a competition. */
  function getEffort(club, competition) {
    const cf = ensure(club);
    return cf[competition] || "moderate";
  }

  /** Set effort level for a competition. */
  function setEffort(club, competition, level) {
    const cf = ensure(club);
    if (EFFORT_LEVELS[level]) {
      cf[competition] = level;
    }
  }

  /** Reset to defaults (league=full, cup=moderate, europe=moderate). */
  function reset(club) {
    club.competitionFocus = {
      league: "full",
      cup: "moderate",
      europe: "moderate"
    };
  }

  /** Get the numeric squad level (1–3) for a competition's effort. */
  function squadLevelFor(effort) {
    return EFFORT_TO_SQUAD_LEVEL[effort] || 2;
  }

  /** Return a form multiplier based on competition focus.
   *  If a competition has "minimal" effort, it carries a small form penalty
   *  (the squad is not as sharp). "Full" carries no penalty. */
  function formMultiplier(effort) {
    switch (effort) {
      case "minimal": return -1.5;   // morale/sharpness penalty
      case "moderate": return 0;     // neutral
      case "full": return 1;         // focus bonus
      default: return 0;
    }
  }

  MG.competitionFocus = {
    EFFORT_LEVELS, EFFORT_KEYS,
    ensure, getEffort, setEffort, reset,
    squadLevelFor, formMultiplier
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
