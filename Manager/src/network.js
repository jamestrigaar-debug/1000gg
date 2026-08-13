/* ============================================================================
 * FOOTBALL MANAGER — THE AGENT NETWORK
 *
 * Until now the transfer market was a flat global pool: a National League club
 * could, in principle, evaluate a Real Madrid reserve. That is not how football
 * works, and it made the world feel smaller than it is. This layer is the
 * networking that sits behind the boardroom's dealing — the agents and channels
 * a club actually has access to.
 *
 * THE RULE
 *   REACH is a function of a club's standing. A giant scouts the planet; a
 *   lower-league side scouts its own country. Between those, reach widens with
 *   reputation, out from the home leagues to the confederation to the world.
 *
 *   Saudi clubs are the deliberate outlier: their reach is global whatever
 *   their reputation, modelling the real-world spending power that lets them
 *   buy from anywhere. That is the one place money overrides standing.
 *
 * WHY IT MATTERS
 *   It makes the pyramid feel connected the way it really is — your rivals for
 *   a target are the clubs in your reach, not every club alive — and it gives
 *   the player a reason to grow the club's reputation beyond the league table:
 *   a bigger name opens a bigger market.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});

  /* Which confederation a league's country belongs to — the middle ring of
   * reach, between the home country and the whole world. */
  const COUNTRY_CONF = {
    England: "UEFA", Spain: "UEFA", Italy: "UEFA", Germany: "UEFA",
    "Saudi Arabia": "AFC", USA: "CONCACAF",
  };
  function confOf(country) { return COUNTRY_CONF[country] || "UEFA"; }

  /* Reputation thresholds for each ring of reach. Tuned so that season one has
   * roughly the right shape: the handful of true giants scout globally, the
   * established top-flight clubs reach across the continent, mid-table clubs
   * reach their own country plus the nearest big leagues, and everyone below
   * shops at home. */
  const GLOBAL_REP = 78;
  const CONTINENTAL_REP = 58;
  const REGIONAL_REP = 38;

  const _cache = {};
  /** The set of league ids a club can realistically recruit from. Cached per
   *  (leagueId, reputation-band) because it is asked once per club per window. */
  function reachLeagues(club) {
    const L = MG.clubs.LEAGUES;
    const all = MG.clubs.LEAGUE_KEYS;
    const country = L[club.leagueId].country;
    const saudi = club.leagueId === "Saudi";
    const rep = club.reputation;
    const band = saudi ? "global" : rep >= GLOBAL_REP ? "global"
      : rep >= CONTINENTAL_REP ? "continental" : rep >= REGIONAL_REP ? "regional" : "home";
    const key = `${club.leagueId}|${band}`;
    if (_cache[key]) return _cache[key];

    let leagues;
    const ownCountry = all.filter((k) => L[k].country === country);
    if (band === "global") {
      leagues = all.slice();
    } else if (band === "continental") {
      // Home pyramid, every other top division, and the money leagues.
      const topFlights = all.filter((k) => L[k].tier === 1);
      leagues = unique([...ownCountry, ...topFlights]);
    } else if (band === "regional") {
      // Home pyramid plus the top divisions of the same confederation.
      const conf = confOf(country);
      const nearby = all.filter((k) => L[k].tier === 1 && confOf(L[k].country) === conf);
      leagues = unique([...ownCountry, ...nearby]);
    } else {
      // Home only.
      leagues = ownCountry;
    }
    _cache[key] = new Set(leagues);
    return _cache[key];
  }
  function resetCache() { for (const k of Object.keys(_cache)) delete _cache[k]; }

  /** Can `buyer` reach into `seller`'s league to sign a player? A club can
   *  always recruit within its own division regardless of reach. */
  function canRecruit(buyer, seller) {
    if (buyer.id === seller.id) return false;
    if (buyer.leagueId === seller.leagueId) return true;
    return reachLeagues(buyer).has(seller.leagueId);
  }

  /** A short human description of a club's reach, for the recruitment panel. */
  function reachLabel(club) {
    const rep = club.reputation;
    if (club.leagueId === "Saudi") return "global (unlimited spending power)";
    if (rep >= GLOBAL_REP) return "global — the whole world";
    if (rep >= CONTINENTAL_REP) return "continental — home plus every major league";
    if (rep >= REGIONAL_REP) return `regional — home plus the ${confOf(MG.clubs.LEAGUES[club.leagueId].country)} big leagues`;
    return "home — your own country only";
  }

  function unique(arr) { return [...new Set(arr)]; }

  MG.network = {
    COUNTRY_CONF, confOf, reachLeagues, canRecruit, reachLabel, resetCache,
    GLOBAL_REP, CONTINENTAL_REP, REGIONAL_REP,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
