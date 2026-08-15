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
   * an auction — he is making one call. Three is the ceiling whatever the
   * agent — even a Super-Agency works a room of three genuine bidders, not
   * an open-ended auction; the difference a bigger network makes is that a
   * weaker agent rarely gets that far in the first place. */
  const MAX_PLAYER_APPROACHES = 3;
  function suitorCap(agent) {
    if (agent.network >= 60) return MAX_PLAYER_APPROACHES;
    if (agent.network >= 30) return 2;
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

  /* Same idea, for a manager's reputation instead of a player's overall — a
   * different hash seed so the two populations decorrelate (a manager and a
   * player who happen to share a numeric id are not otherwise linked). Used
   * as the stateless fallback for anyone not tracked on a roster below. */
  function agentForManager(manager) {
    const prestige = clamp(Math.pow(clamp((manager.reputation - 55) / 35, 0, 1), 2), 0, 1);
    const weights = AGENTS.map((a) => a.baseShare * Math.max(1 + prestige * (a.network / 45 - 1) * 6, 0.08));
    const total = weights.reduce((t, w) => t + w, 0);
    const roll = hashRand(manager.id * 5.77 + 13) * total;
    let acc = 0;
    for (let i = 0; i < AGENTS.length; i++) {
      acc += weights[i];
      if (roll < acc) return AGENTS[i];
    }
    return AGENTS[AGENTS.length - 1];
  }

  /* ============================================================================
   * STATEFUL ROSTERS — the part that makes an agent a relationship rather
   * than a hash lookup, for the clients worth tracking one by one.
   *
   * Every player and manager in the world nominally "has" an agent (the
   * functions above), but genuinely maintaining a roster for all five
   * thousand-odd players every season would cost real time for no payoff —
   * nobody is going to notice or care which small agency their nineteenth
   * squad player is nominally on the books of. What a manager DOES notice is
   * a star's camp, and the actual football-agent behaviour — a limited
   * book, a client dropped when someone better comes along, a bigger cut for
   * a bigger name — only reads as real for the players and managers actually
   * worth tracking. So: a roster is kept ONLY for NOTABLE clients (a good
   * top-flight regular, or a manager with a real reputation); everyone else
   * is read through the cheap stateless lookup above exactly as before.
   * ========================================================================== */
  const ROSTER_CAPACITY = { "Super-agency": 8, "Major": 16, "Regional": 30, "Local": Infinity };
  const NOTABLE_PLAYER_OVERALL = 74;
  const NOTABLE_MANAGER_REPUTATION = 60;

  function notablePlayer(p) { return !p.retired && p.overall >= NOTABLE_PLAYER_OVERALL; }
  function notableManager(m) { return !m.retired && m.reputation >= NOTABLE_MANAGER_REPUTATION; }

  function ensureRosters(world) {
    if (!world.agentRosters) {
      world.agentRosters = {};
      for (const a of AGENTS) world.agentRosters[a.id] = [];
    }
    return world.agentRosters;
  }

  /* The percentage of a deal an agent actually takes — the "higher talent,
   * higher cut" half of the brief. A player nobody outside his own club has
   * heard of is not worth a big negotiation, so his agent settles for a thin
   * slice; a genuine star is worth fighting the club over every clause, and
   * the agent prices that effort in. Purely informational today (shown on
   * the roster entry) — the fee and wage mechanics it would feed are already
   * carried by contestPremium above. */
  function cutPercent(prestige) {
    return Math.round(clamp(5 + (prestige - 55) * 0.42, 4, 24));
  }

  const TIER_ORDER = ["Super-agency", "Major", "Regional", "Local"];
  function agentsInTier(tier) { return AGENTS.filter((a) => a.tier === tier); }
  function makeEntry(c) { return { id: c.id, kind: c.kind, prestige: c.prestige, cutPct: cutPercent(c.prestige) }; }

  /* Places one client on the best roster that will have him, tier by tier
   * from his natural pick downward. A full tier does not automatically mean
   * "try the next one down" — if the newcomer outranks the WEAKEST client
   * anywhere in that tier, he bumps him instead, and the bumped client is
   * the one who cascades further down. Without this, processing order alone
   * decided who got the big agency: the genuinely best player in the world
   * could lose out on a Super-Agency slot to a lesser one simply because the
   * lesser one happened to be evaluated first and the tier filled up before
   * the best one's turn came round. Local's capacity is infinite, so this
   * always terminates. Within a tier, which of its agents gets the client is
   * a deterministic hash of his id — spreads a tier's business across all
   * the agents who share it instead of the first one always taking the lot. */
  /* Where a client STARTS the placement search — by prestige directly, not
   * by the stateless hash pick above. That hash is deliberately probabilistic
   * (a wonderkid can land with a nobody agent, which is the story of a club
   * unearthing him early) and that is exactly wrong for the roster: it means
   * placement could never self-correct, and the actual best player in the
   * world could sit with a corner-shop agent for his whole career on one
   * unlucky roll with nothing in the system ever able to notice. The tier a
   * genuine talent COMPETES for should track how good he actually is; the
   * bump fight inside that tier is what still means most of them lose out to
   * someone even better and land lower — which is the real texture. */
  function tierForPrestige(prestige) {
    if (prestige >= 88) return 0;   // Super-agency
    if (prestige >= 78) return 1;   // Major
    if (prestige >= 66) return 2;   // Regional
    return 3;                       // Local
  }

  function place(rosters, entity, kind, prestige) {
    let current = { id: entity.id, kind, prestige };
    const startTier = tierForPrestige(prestige);
    for (let t = startTier; t < TIER_ORDER.length; t++) {
      const tierName = TIER_ORDER[t];
      const cap = ROSTER_CAPACITY[tierName];
      const agentsHere = agentsInTier(tierName)
        .slice()
        .sort((a, b) => hashRand(current.id * 3.11 + a.network * 0.7) - hashRand(current.id * 3.11 + b.network * 0.7));
      for (const agent of agentsHere) {
        if (rosters[agent.id].length < cap) {
          rosters[agent.id].push(makeEntry(current));
          return agent.id;
        }
      }
      // The whole tier is full. Does this client outrank its weakest member?
      let weakestAgentId = null, weakestIdx = -1, weakestVal = Infinity;
      for (const agent of agentsHere) {
        const list = rosters[agent.id];
        for (let j = 0; j < list.length; j++) {
          if (list[j].prestige < weakestVal) { weakestVal = list[j].prestige; weakestAgentId = agent.id; weakestIdx = j; }
        }
      }
      if (weakestAgentId != null && weakestVal < current.prestige) {
        const list = rosters[weakestAgentId];
        const bumped = list[weakestIdx];
        list[weakestIdx] = makeEntry(current);
        current = bumped;      // the client who just lost his seat cascades on
        continue;
      }
      // Not good enough to bump anyone in this tier — try the next one down.
    }
    // Should not happen (Local is uncapped) — last resort, force onto Local.
    const local = agentsInTier("Local")[0];
    rosters[local.id].push(makeEntry(current));
    return local.id;
  }

  /** The once-a-season tick. Every notable player and manager is placed
   *  fresh, best prestige first — a full rebuild rather than patching the
   *  old rosters in place. Patching only ever PROMOTED someone the season he
   *  first became notable; a player who broke in at 80 and grew to a
   *  95-overall talent over the next three years was never looked at again
   *  once he had an agent, so the actual best player in the world could sit
   *  with whoever he signed with as a promising kid for his whole career.
   *  Rebuilding fresh means the placement question — "does he outrank the
   *  tier's weakest client now?" — gets asked properly every single season,
   *  which is what "agents reassess who they have" actually has to mean.
   *  Called from world.js's advanceSeason, alongside the manager carousel. */
  function reassessRosters(world) {
    const rosters = ensureRosters(world);
    for (const agentId of Object.keys(rosters)) rosters[agentId] = [];

    const players = [];
    for (const c of world.clubs) for (const p of c.squad) if (notablePlayer(p)) players.push(p);
    players.sort((a, b) => b.overall - a.overall);
    for (const p of players) place(rosters, p, "player", p.overall);

    const managerIndex = world.managerIndex || {};
    const managers = Object.keys(managerIndex).map((mid) => managerIndex[mid]).filter((m) => m && notableManager(m));
    managers.sort((a, b) => b.reputation - a.reputation);
    for (const m of managers) place(rosters, m, "manager", m.reputation);
  }

  /** The agent actually representing this player or manager right now — his
   *  roster placement if he is notable enough to have one, the same
   *  deterministic read as everyone else in the world otherwise. */
  function agentOf(world, entity, kind) {
    const rosters = world.agentRosters;
    if (rosters) {
      for (const agentId of Object.keys(rosters)) {
        const hit = rosters[agentId].find((e) => e.kind === kind && e.id === entity.id);
        if (hit) return { agent: AGENT_INDEX[agentId], cutPct: hit.cutPct, rostered: true };
      }
    }
    const agent = kind === "player" ? agentFor(entity) : agentForManager(entity);
    return { agent, cutPct: cutPercent(kind === "player" ? entity.overall : entity.reputation), rostered: false };
  }

  MG.agents = {
    AGENTS, AGENT_INDEX, agentFor, agentForManager, suitorCap, contestPremium, filterSuitors,
    MAX_PLAYER_APPROACHES, ROSTER_CAPACITY, NOTABLE_PLAYER_OVERALL, NOTABLE_MANAGER_REPUTATION,
    notablePlayer, notableManager, ensureRosters, reassessRosters, agentOf, cutPercent,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
