/* ============================================================================
 * FOOTBALL MANAGER — PLAYER AGENTS
 *
 * The transfer window used to treat every player the same way once a buyer
 * could reach his league: whoever wanted him and could afford him, got a
 * shot. Real football does not work like that. A player is represented, and
 * how many clubs even get a phone call is a function of who represents him —
 * a Super-Agency works a star to a dozen boardrooms at once and drives the
 * price into a genuine auction; a small-town agent with three clients on his
 * books gets his man one conversation, with one club, and that's the move or
 * there isn't one.
 *
 * TEN AGENTS, deterministically assigned per player (a hash of his id, not
 * the world's RNG — see scoutin.js's hashRand for the same pattern, and the
 * same reason: this must read the same way on every render, and it must
 * never consume a draw the rest of the simulation is counting on). Better
 * players land with better-networked agents more often, never certainly —
 * a wonderkid can still be on a local agent's books, which is exactly the
 * story of a club unearthing him before anyone bigger notices.
 *
 * WHAT IT ACTUALLY CHANGES: transfers.js's bidding rounds. When several clubs
 * nominate the same player in the same round, the number that actually get to
 * bid is capped by his agent's reach — a narrow agent lets one club through
 * and the rest simply don't get the call this round, however much they want
 * him and however much they could pay. A wide agent lets the whole queue
 * through and then works the winner up harder once it is contested. Nothing
 * here touches who a club can afford or whether it needs the position; it
 * only touches how many of the clubs that DO want him ever get a seat at the
 * table, which is exactly the piece the transfer market was missing.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  function hashRand(seed) {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  /* network: how many boardrooms this agent can realistically work in a
   * single window. Ranges from a one-man-band to a super-agency; the spread
   * is deliberately wide because the difference in reach is the whole point.
   */
  /* baseShare is how much of the WHOLE population — a National League
   * reserve as much as a Ballon d'Or contender — this agent's book would
   * carry with no quality weighting at all. Most players in the game, like
   * most players alive, are on a small agent's books; a Super-Agency client
   * is genuinely rare. Quality weighting (below) pulls a good player's odds
   * up the list, but it works against these baselines, not instead of them. */
  const AGENTS = [
    { id: "vantage", name: "Vantage Sports Group", tier: "Super-agency", network: 96, baseShare: 2,
      blurb: "Runs the biggest book in the game and is never off the phone during a window." },
    { id: "meridian", name: "Meridian Talent", tier: "Super-agency", network: 90, baseShare: 2,
      blurb: "Global reach, a handful of genuine superstars, and a price to match." },
    { id: "sterling", name: "Sterling & Co", tier: "Major", network: 74, baseShare: 6,
      blurb: "A serious continental network built over twenty years in the game." },
    { id: "cortex", name: "Cortex Football Management", tier: "Major", network: 68, baseShare: 8,
      blurb: "Data-driven, well-connected, always shopping a client to more than one club." },
    { id: "harborview", name: "Harborview Sports", tier: "Regional", network: 48, baseShare: 13,
      blurb: "Strong in a couple of leagues, thin everywhere else." },
    { id: "iron_gate", name: "Iron Gate Representation", tier: "Regional", network: 42, baseShare: 14,
      blurb: "Domestic reach, a domestic reputation, and no ambition to be anything else." },
    { id: "brightline", name: "Brightline Player Management", tier: "Regional", network: 36, baseShare: 14,
      blurb: "A handful of clubs it deals with again and again, nobody else." },
    { id: "kestrel", name: "Kestrel Associates", tier: "Local", network: 22, baseShare: 17,
      blurb: "One man, a laptop, and whichever club rings first." },
    { id: "parkside", name: "Parkside Player Services", tier: "Local", network: 16, baseShare: 12,
      blurb: "Local knowledge, local contacts, one conversation at a time." },
    { id: "freehold", name: "Freehold Independent", tier: "Local", network: 10, baseShare: 12,
      blurb: "No network to speak of — whichever club gets there first, gets him." },
  ];
  const AGENT_INDEX = {};
  for (const a of AGENTS) AGENT_INDEX[a.id] = a;

  /* Weighted so a better player more often lands a better-networked agent,
   * without it ever being certain. prestige is ~0 for anyone below a good
   * first-teamer and climbs steeply — and only steeply — once a player is
   * genuinely very good, so the pull toward the super-agencies stays rare
   * even after weighting: an 88-overall star's odds shift hard toward the
   * top of the list, a 65-overall squad player's barely move at all. */
  function agentFor(player) {
    const prestige = clamp(Math.pow(clamp((player.overall - 60) / 30, 0, 1), 2), 0, 1);
    // A network-heavy agent's slice grows with prestige; a weak one's shrinks
    // — computed fresh per player (ten agents, so this is cheap) since the
    // weights no longer sum to a fixed total once prestige pulls them apart.
    const weights = AGENTS.map((a) => a.baseShare * Math.max(1 + prestige * (a.network / 45 - 1) * 6, 0.08));
    const total = weights.reduce((t, w) => t + w, 0);
    const roll = hashRand(player.id * 7.13 + 41) * total;
    let acc = 0;
    for (let i = 0; i < AGENTS.length; i++) {
      acc += weights[i];
      if (roll < acc) return AGENTS[i];
    }
    return AGENTS[AGENTS.length - 1];
  }

  /* How many suitors get to actually bid on this player in a single round,
   * once more than one club has nominated him. A narrow agent isn't running
   * an auction — he is making one call. */
  function suitorCap(agent) {
    if (agent.network >= 85) return 8;   // super-agency: essentially uncapped
    if (agent.network >= 60) return 5;
    if (agent.network >= 40) return 3;
    if (agent.network >= 25) return 2;
    return 1;                            // local: one club, one conversation
  }

  /* The premium a contested move costs on top of the runner-up's ceiling. A
   * well-networked agent plays two boardrooms off each other properly; a
   * local one barely knows there is a second bidder to leverage. */
  function contestPremium(agent) {
    return 1.02 + (agent.network / 100) * 0.09;   // 1.03 .. 1.11
  }

  /* Trims a round's bidders for one player down to who his agent actually
   * lets through — kept by score, so the club that wants him most (not just
   * whoever happened to be read first) gets the seat when there are more
   * suitors than the agent has time for. Anyone dropped simply gets no deal
   * done on him this round; nothing else about their state changes, so they
   * are free to try again — for him or someone else — next round. */
  function filterSuitors(player, bidList) {
    const agent = agentFor(player);
    const cap = suitorCap(agent);
    if (bidList.length <= cap) return { list: bidList, agent };
    const kept = bidList.slice().sort((a, b) => b.score - a.score).slice(0, cap);
    return { list: kept, agent };
  }

  MG.agents = { AGENTS, AGENT_INDEX, agentFor, suitorCap, contestPremium, filterSuitors };
})(typeof globalThis !== "undefined" ? globalThis : this);
