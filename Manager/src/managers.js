/* ============================================================================
 * FOOTBALL MANAGER — MANAGERS, PERSONALITY AND THE CAROUSEL
 *
 * Every one of the 221 clubs has a manager, and every one of those managers is
 * a real record with a personality, traits, a preferred way of playing and a
 * career history. They are not decoration: a manager's traits decide who his
 * club signs, his tactic decides how his club plays, his development rating
 * decides how fast his club's youngsters improve, and his board's verdict on
 * all of that decides whether he is still there next season.
 *
 * The carousel is the loop that makes the world feel alive. A bad season gets
 * a manager sacked; the vacancy is filled from a pool that includes managers
 * currently employed at smaller clubs; that poaching opens a vacancy one rung
 * down, and so on until the churn runs out of rungs. Nothing about it depends
 * on the human player being anywhere near it.
 *
 * ARCHETYPES: the eight templates below are modelled on the managers already
 * shipped in the repository's MANAGER_DATABASE (src/game.js). They are the
 * placeholder DNA pool for the manager draft — you roll one and inherit its
 * tactic, trait leanings and attribute shape — and they double as the families
 * the world's generated managers are drawn from.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /* ------------------------------- TACTICS --------------------------------
   * `shift` is what a system does to a team's three ratings, in RATING POINTS.
   *
   * These began as 1000goals' MANAGER_TACTICS multipliers (Park the Bus was
   * attack x0.80, defence x1.25). Those numbers are decoration in 1000goals —
   * nothing reads them — and applying them literally here was catastrophic: on
   * a scale where a whole division spans about 65 to 95, a 20% cut took a
   * mid-table attack to 59 against defences of 84, and the xG duel floored at
   * 0.1. A side set up to defend could not score at all.
   *
   * As additive shifts the same trade-off survives — you give up going forward
   * to get it back at the other end — at a size that reads as a tactical choice
   * rather than a self-inflicted relegation.
   *
   * `demands` names the player attributes a system actually needs, so a squad
   * of slow, technical players set up to counter-attack underperforms its raw
   * ratings. That is what makes a manager's fit with a club matter. */
  const TACTICS = {
    Possession:    { label: "Possession",     shift: { attack: 2, midfield: 3, defence: -1 }, home: 1.00,
                     demands: { rightFoot: 0.4, leftFoot: 0.2, fitness: 0.4 }, blurb: "Control the ball, starve the opposition." },
    Counter:       { label: "Counter-Attack", shift: { attack: 4, midfield: -2, defence: 1 }, home: 1.10,
                     demands: { speed: 0.7, strength: 0.3 }, blurb: "Sit in, break at speed." },
    "High Press":  { label: "High Press",     shift: { attack: 1, midfield: 4, defence: -1 }, home: 1.15,
                     demands: { fitness: 0.6, speed: 0.4 }, blurb: "Win it back high and suffocate." },
    Direct:        { label: "Direct",         shift: { attack: 3, midfield: -3, defence: 2 }, home: 1.05,
                     demands: { strength: 0.5, heading: 0.3, speed: 0.2 }, blurb: "Get it forward early." },
    "Park the Bus":{ label: "Park the Bus",   shift: { attack: -4, midfield: -1, defence: 5 }, home: 1.20,
                     demands: { strength: 0.5, heading: 0.5 }, blurb: "Concede the ball, concede nothing else." },
    "Route One":   { label: "Route One",      shift: { attack: 2, midfield: -4, defence: 3 }, home: 1.00,
                     demands: { heading: 0.6, strength: 0.4 }, blurb: "Front post, second ball, feed off scraps." },
  };
  const TACTIC_KEYS = Object.keys(TACTICS);

  /* ------------------------------- TRAITS ---------------------------------
   * Each trait is a lever on a specific system. Nothing here is flavour text
   * with no effect — if a trait is listed, something reads it. */
  const TRAITS = {
    "Youth Developer":     { blurb: "Trusts kids and makes them better.", attrs: { development: 12 }, recruit: { maxAge: 23, potentialBias: 1.6 }, youthMinutes: 1.7 },
    "Chequebook":          { blurb: "Solves problems by signing someone.", attrs: { transferAcumen: -4 }, recruit: { minAge: 24, readyBias: 1.5, spend: 1.35 } },
    "Analytics":           { blurb: "Finds the player nobody else rated.", attrs: { transferAcumen: 14 }, recruit: { valueBias: 1.8, spend: 0.8 } },
    "Disciplinarian":      { blurb: "Organised, hard to beat, no nonsense.", attrs: { defending: 9, discipline: 12 }, match: { defence: 1.5 } },
    "Motivator":           { blurb: "Gets more out of less on the big days.", attrs: { manManagement: 13 }, match: { underdog: 1.5 } },
    "Firefighter":         { blurb: "Thrives when the club is in trouble.", attrs: { manManagement: 7 }, match: { crisis: 2 } },
    "Tinkerer":            { blurb: "Never names the same side twice.", attrs: { adaptability: 8 }, match: { variance: 1.35 } },
    "Loyalist":            { blurb: "Builds slowly, keeps his players.", attrs: { manManagement: 6 }, recruit: { spend: 0.6, churn: 0.5 }, tenureBonus: 1.5 },
    "Set-Piece Specialist":{ blurb: "Turns dead balls into a points return.", attrs: { attacking: 6 }, match: { attack: 1 } },
    "Rebuilder":           { blurb: "Tears it down before he builds it up.", attrs: { development: 7 }, recruit: { maxAge: 26, churn: 1.6 } },
    "Man-Manager":         { blurb: "The dressing room would run through a wall.", attrs: { manManagement: 15 }, match: { consistency: 1.1 } },
    "Attacking Idealist":  { blurb: "Would rather win 4-3 than 1-0.", attrs: { attacking: 12, defending: -6 }, match: { attack: 2, defence: -1.5 } },
  };
  const TRAIT_KEYS = Object.keys(TRAITS);

  /* ---------------------------- PERSONALITIES ------------------------------
   * Personality is how a manager handles the boardroom and the pressure, not
   * how his team plays. It modifies confidence swings, job-hunting appeal and
   * how likely he is to walk into a fight with his own board. */
  const PERSONALITIES = {
    Calm:        { blurb: "Unmoved by a bad run.",            boardSwing: 0.8, appeal: 1.0,  volatility: 0.7 },
    Volatile:    { blurb: "Brilliant, and a liability.",      boardSwing: 1.3, appeal: 0.9,  volatility: 1.5 },
    Charismatic: { blurb: "Sells a project to anyone.",       boardSwing: 0.85, appeal: 1.25, volatility: 1.0 },
    Aloof:       { blurb: "Does not court the boardroom.",    boardSwing: 1.15, appeal: 0.85, volatility: 0.9 },
    Ruthless:    { blurb: "Will move anyone on, including himself.", boardSwing: 1.0, appeal: 1.1, volatility: 1.2 },
    Idealist:    { blurb: "Will go down playing his way.",    boardSwing: 1.1, appeal: 0.95, volatility: 1.1 },
  };
  const PERSONALITY_KEYS = Object.keys(PERSONALITIES);

  /* ----------------------------- ARCHETYPES --------------------------------
   * Eight templates drawn from the real managers already in the repository's
   * MANAGER_DATABASE. `weight` is the draft roll weight — the rarest templates
   * are the ones that define an era. `rarity` drives the draft presentation.
   *
   * This is the placeholder DNA pool. The intended expansion is a full draft
   * where you take individual traits from several of these, the way 1000goals
   * takes attributes from several donor squads. */
  const ARCHETYPES = {
    perfectionist: {
      key: "perfectionist", name: "The Perfectionist", basedOn: "P. Guardiola", club: "Manchester City",
      tactic: "Possession", rarity: "Legendary", weight: 6,
      blurb: "Total control of the ball and of everything else. Demands elite players and gets elite returns.",
      attrs: { attacking: 88, defending: 76, development: 70, manManagement: 68, transferAcumen: 74, adaptability: 58, discipline: 86 },
      traits: ["Attacking Idealist", "Disciplinarian"], personality: "Idealist",
    },
    intensity: {
      key: "intensity", name: "The Firestarter", basedOn: "J. Klopp", club: "Liverpool",
      tactic: "High Press", rarity: "Legendary", weight: 7,
      blurb: "Heavy-metal football. Runs harder than everyone and makes his players believe they can too.",
      attrs: { attacking: 84, defending: 74, development: 78, manManagement: 90, transferAcumen: 76, adaptability: 66, discipline: 72 },
      traits: ["Motivator", "Man-Manager"], personality: "Charismatic",
    },
    tactician: {
      key: "tactician", name: "The Tactician", basedOn: "U. Emery", club: "Aston Villa",
      tactic: "Counter", rarity: "Rare", weight: 12,
      blurb: "Prepares for the specific opponent in front of him. Overachieves in knockout football.",
      attrs: { attacking: 74, defending: 84, development: 66, manManagement: 64, transferAcumen: 78, adaptability: 88, discipline: 80 },
      traits: ["Tinkerer", "Disciplinarian"], personality: "Aloof",
    },
    architect: {
      key: "architect", name: "The Architect", basedOn: "M. Arteta", club: "Arsenal",
      tactic: "Possession", rarity: "Rare", weight: 13,
      blurb: "Builds a side from the academy up. Slow to start, very hard to stop once it clicks.",
      attrs: { attacking: 78, defending: 80, development: 86, manManagement: 74, transferAcumen: 72, adaptability: 62, discipline: 84 },
      traits: ["Youth Developer", "Disciplinarian"], personality: "Idealist",
    },
    entertainer: {
      key: "entertainer", name: "The Entertainer", basedOn: "A. Postecoglou", club: "Tottenham",
      tactic: "Direct", rarity: "Uncommon", weight: 16,
      blurb: "Attack first, ask questions later. Wins fans and loses 4-3.",
      attrs: { attacking: 88, defending: 56, development: 74, manManagement: 78, transferAcumen: 62, adaptability: 52, discipline: 60 },
      traits: ["Attacking Idealist", "Motivator"], personality: "Charismatic",
    },
    grafter: {
      key: "grafter", name: "The Grafter", basedOn: "D. Moyes", club: "Everton",
      tactic: "Park the Bus", rarity: "Common", weight: 18,
      blurb: "Organised, streetwise, impossible to break down. Survives where others get sacked.",
      attrs: { attacking: 56, defending: 88, development: 64, manManagement: 76, transferAcumen: 66, adaptability: 72, discipline: 88 },
      traits: ["Disciplinarian", "Firefighter"], personality: "Calm",
    },
    analyst: {
      key: "analyst", name: "The Analyst", basedOn: "T. Frank", club: "Brentford",
      tactic: "Direct", rarity: "Uncommon", weight: 15,
      blurb: "Wins the transfer market before he wins the match. Every set piece is a rehearsed routine.",
      attrs: { attacking: 72, defending: 76, development: 76, manManagement: 72, transferAcumen: 92, adaptability: 74, discipline: 78 },
      traits: ["Analytics", "Set-Piece Specialist"], personality: "Calm",
    },
    scrapper: {
      key: "scrapper", name: "The Scrapper", basedOn: "C. Wilder", club: "Sheffield United",
      tactic: "Route One", rarity: "Common", weight: 13,
      blurb: "Lower-league know-how and a squad that runs through walls. Gets clubs promoted.",
      attrs: { attacking: 66, defending: 78, development: 70, manManagement: 84, transferAcumen: 64, adaptability: 68, discipline: 82 },
      traits: ["Motivator", "Firefighter"], personality: "Volatile",
    },
  };
  const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);

  /* ------------------------------ CREATION -------------------------------- */
  let NEXT_ID = 1;
  function resetIds() { NEXT_ID = 1; }
  /* Claim the next free id without building a manager. The player's own manager
   * is drafted BEFORE the world exists, so it is minted from whatever the
   * counter happened to be — and createWorld() then resets the counter and hands
   * the same number to the first AI manager it generates. Two managers with one
   * id meant two clubs pointed at the same man: his seasons and tenure counted
   * twice (a career on season 10 reporting 20), the manager index resolved to
   * whichever was registered last, and the carousel crashed the moment one of
   * them was moved on. The player's manager is re-issued an id from here once
   * the world is built. */
  function nextId() { return NEXT_ID++; }

  function applyTraitAttrs(attrs, traits) {
    for (const t of traits) {
      const def = TRAITS[t];
      if (!def || !def.attrs) continue;
      for (const [k, v] of Object.entries(def.attrs)) attrs[k] = clamp((attrs[k] || 50) + v, 10, 99);
    }
    return attrs;
  }

  /** Build a manager from an archetype, scaled to a target reputation. A
   *  National League manager built from the Perfectionist template is the same
   *  shape of manager, just markedly worse at all of it. */
  function fromArchetype(rng, archetypeKey, opts) {
    const a = ARCHETYPES[archetypeKey] || ARCHETYPES.grafter;
    const o = opts || {};
    const reputation = clamp(Math.round(o.reputation != null ? o.reputation : 50), 1, 99);
    // Attribute scale tracks reputation: the templates are written at elite
    // level (reputation ~85), so anything below that is discounted.
    const scale = 0.55 + (reputation / 99) * 0.5;
    const attrs = {};
    for (const [k, v] of Object.entries(a.attrs)) {
      attrs[k] = clamp(Math.round(v * scale + rng.gauss() * 4), 12, 99);
    }
    const traits = o.traits || pickTraits(rng, a);
    applyTraitAttrs(attrs, traits);

    const nationality = o.nationality || MG.names.randomNation(rng);
    const m = {
      id: NEXT_ID++,
      name: o.name || MG.names.managerName(rng, nationality),
      nationality,
      age: o.age != null ? o.age : clamp(Math.round(36 + reputation * 0.18 + rng.gauss() * 6), 28, 68),
      archetype: a.key,
      archetypeName: a.name,
      reputation,
      personality: o.personality || (rng.chance(0.6) ? a.personality : rng.pick(PERSONALITY_KEYS)),
      tactic: o.tactic || (rng.chance(0.75) ? a.tactic : rng.pick(TACTIC_KEYS)),
      traits,
      attrs,
      clubId: null,
      tenure: 0,
      joblessSeasons: 0,
      isPlayer: !!o.isPlayer,
      honours: { titles: 0, cups: 0, promotions: 0, relegations: 0, european: 0 },
      record: { seasons: 0, played: 0, won: 0, drawn: 0, lost: 0 },
      history: [],   // { club, from, to, reason, finish }
    };
    return m;
  }

  function pickTraits(rng, archetype) {
    const traits = archetype.traits.slice();
    // A third trait about a third of the time, which is what stops two managers
    // of the same archetype behaving identically.
    if (rng.chance(0.35)) {
      const extra = rng.pick(TRAIT_KEYS.filter((t) => !traits.includes(t)));
      if (extra) traits.push(extra);
    }
    return traits;
  }

  /** A brand-new manager for a vacancy nobody good wants: ex-players, coaches
   *  stepping up, and the occasional gamble on somebody's reputation. */
  function generate(rng, reputation) {
    const key = rng.weighted(ARCHETYPE_KEYS.map((k) => ({ item: k, weight: ARCHETYPES[k].weight })));
    return fromArchetype(rng, key, { reputation: clamp(Math.round(reputation + rng.gauss() * 7), 3, 96) });
  }

  /* --------------------------- MANAGER EFFECTS ----------------------------
   * How a manager turns into numbers the rest of the engine reads. */

  /* ------------------- THE TACTICAL PARAMETER MATRIX ----------------------
   * Report formula 4. Rather than adding five sliders to a game whose whole
   * point is that you make a handful of decisions a year, each of the six
   * systems is EXPRESSED as a parameter vector, and its effect on the three
   * ratings is derived from that vector instead of being hand-typed.
   *
   *   mentality  -1 defensive .. +1 attacking
   *   tempo       0 patient    .. 1 frantic
   *   width       0 narrow     .. 1 wide
   *   defLine     0 deep       .. 1 high
   *   pressing    0 contain    .. 1 suffocate
   *
   * The pay-off is that pressing now costs something real: it feeds the fatigue
   * model, so a high-press side burns its legs over a season. */
  const TACTIC_PARAMS = {
    Possession:     { mentality: 0.2,  tempo: 0.3, width: 0.6, defLine: 0.7, pressing: 0.5 },
    Counter:        { mentality: -0.2, tempo: 0.9, width: 0.4, defLine: 0.2, pressing: 0.3 },
    "High Press":   { mentality: 0.5,  tempo: 0.8, width: 0.5, defLine: 0.9, pressing: 1.0 },
    Direct:         { mentality: 0.4,  tempo: 0.8, width: 0.5, defLine: 0.5, pressing: 0.5 },
    "Park the Bus": { mentality: -0.9, tempo: 0.2, width: 0.2, defLine: 0.1, pressing: 0.2 },
    "Route One":    { mentality: 0.1,  tempo: 0.7, width: 0.3, defLine: 0.3, pressing: 0.4 },
  };

  /** How hard this system presses, 0-1. Read by the fatigue model. */
  function pressIntensity(tacticKey) {
    const p = TACTIC_PARAMS[tacticKey];
    return p ? p.pressing : 0.5;
  }

  /* Derive the rating shifts from the parameter vector. The coefficients are
   * scaled from the report's (which assume multipliers on a 0-1 rating) onto
   * this engine's 0-99 point scale, and tuned so the six systems land in the
   * same +/-5 point band they occupied when the numbers were hand-written —
   * the balance was already right, this just makes it derived rather than
   * asserted, and keeps pressing and tempo honest against fatigue. */
  function deriveShift(tacticKey) {
    const p = TACTIC_PARAMS[tacticKey];
    if (!p) return { attack: 0, midfield: 0, defence: 0 };
    return {
      attack: p.mentality * 3.4 + p.tempo * 1.6 - p.width * 0.8,
      midfield: (1 - Math.abs(p.mentality)) * 3.0 + p.pressing * 1.8 - p.tempo * 2.2,
      defence: -p.mentality * 2.6 + (1 - p.defLine) * 2.4 + p.pressing * 0.8,
    };
  }

  /** How well a squad suits a tactic: 1.0 is neutral, ~0.93-1.07 in practice. */
  function tacticalFit(manager, squad) {
    const tac = TACTICS[manager.tactic];
    if (!tac || !squad.length) return 1;
    let score = 0, weight = 0;
    for (const [attr, w] of Object.entries(tac.demands)) {
      let total = 0, n = 0;
      for (const p of squad) {
        if (p.pos === "GK") continue;
        total += (p.attrs[attr] || 50) - p.overall;   // is he good at this FOR his level?
        n++;
      }
      if (!n) continue;
      score += (total / n) * w;
      weight += w;
    }
    if (!weight) return 1;
    return clamp(1 + (score / weight) * 0.012, 0.9, 1.1);
  }

  /* --------------------- MENTORING AND RECRUITMENT ------------------------
   * How many players a manager can personally mentor (extra development), and
   * how many signings the board will action on his say-so in a window. Both
   * scale with the manager himself — a better developer mentors more, a better
   * negotiator gets more deals over the line — which is what makes the manager
   * draft matter to squad-building, not just to match day. */
  function mentorCapacity(manager) {
    if (!manager) return 1;
    const d = manager.attrs.development || 55;
    return d >= 82 ? 3 : d >= 64 ? 2 : 1;
  }
  function recruitCapacity(manager) {
    if (!manager) return 2;
    const a = manager.attrs.transferAcumen || 55;
    return a >= 80 ? 4 : a >= 62 ? 3 : 2;
  }
  /** Extra overall a mentored player gains per season, on top of normal growth. */
  function mentorBoost(manager) {
    if (!manager) return 0.8;
    return 0.6 + (manager.attrs.development - 50) / 60;
  }

  /** The manager's contribution to a club's match-day strength, in rating
   *  points to be ADDED to the squad's own ratings. A very good manager of a
   *  well-suited squad is worth roughly eight points; a poor one at a club
   *  that does not fit him costs about the same. */
  function matchModifiers(manager, club) {
    const tac = TACTICS[manager.tactic] || TACTICS.Possession;
    const fit = tacticalFit(manager, club.squad);
    const quality = (manager.reputation * 0.4 + manager.attrs.manManagement * 0.3 + manager.attrs.discipline * 0.3) / 100;

    const shift = deriveShift(manager.tactic) || tac.shift;
    let attack = shift.attack, midfield = shift.midfield, defence = shift.defence;
    let variance = 1, consistency = 1;
    for (const t of manager.traits) {
      const m = (TRAITS[t] || {}).match;
      if (!m) continue;
      if (m.attack) attack += m.attack;
      if (m.defence) defence += m.defence;
      if (m.variance) variance *= m.variance;
      if (m.consistency) consistency *= m.consistency;
    }
    // A coach's attacking and defending work is worth a few points either way.
    attack   += (manager.attrs.attacking - 60) / 9;
    defence  += (manager.attrs.defending - 60) / 9;
    midfield += (manager.attrs.adaptability - 60) / 14;

    // Fit is a multiplier in the 0.9-1.1 range; on this scale that is worth
    // about five points of every rating.
    const fitShift = (fit - 1) * 55;

    return {
      attack: attack + fitShift,
      midfield: midfield + fitShift,
      defence: defence + fitShift,
      home: tac.home * (1 + (manager.attrs.manManagement - 60) / 1200),
      quality,
      fit,
      variance: variance / consistency,
    };
  }

  /** Coaching quality for player development: facilities plus the manager. */
  function coachingQuality(manager, club) {
    const base = club.facilities.training;
    if (!manager) return base * 0.85;
    return clamp(base * 0.55 + manager.attrs.development * 0.45, 10, 99);
  }

  /** How much of a squad's minutes a manager gives to under-21s. */
  function youthAppetite(manager, club) {
    let appetite = 0.06 + (club.facilities.youth / 100) * 0.10;
    if (manager) {
      appetite *= 1 + (manager.attrs.development - 60) / 200;
      for (const t of manager.traits) {
        const mult = (TRAITS[t] || {}).youthMinutes;
        if (mult) appetite *= mult;
      }
    }
    return clamp(appetite, 0.02, 0.45);
  }

  /** Combined recruitment policy from the manager's traits. */
  function recruitmentPolicy(manager) {
    const policy = { minAge: 16, maxAge: 34, potentialBias: 1, readyBias: 1, valueBias: 1, spend: 1, churn: 1 };
    if (!manager) return policy;
    for (const t of manager.traits) {
      const r = (TRAITS[t] || {}).recruit;
      if (!r) continue;
      if (r.minAge) policy.minAge = Math.max(policy.minAge, r.minAge);
      if (r.maxAge) policy.maxAge = Math.min(policy.maxAge, r.maxAge);
      if (r.potentialBias) policy.potentialBias *= r.potentialBias;
      if (r.readyBias) policy.readyBias *= r.readyBias;
      if (r.valueBias) policy.valueBias *= r.valueBias;
      if (r.spend) policy.spend *= r.spend;
      if (r.churn) policy.churn *= r.churn;
    }
    // A ruthless personality churns the squad harder; a calm one less.
    policy.churn *= manager.personality === "Ruthless" ? 1.3 : manager.personality === "Calm" ? 0.85 : 1;
    return policy;
  }

  /* ------------------------------ CAROUSEL --------------------------------
   * Sackings, then vacancies filled biggest-club-first. Filling a vacancy with
   * an employed manager opens the vacancy he leaves behind, which is appended
   * to the queue — that cascade is why one Premier League sacking can end with
   * a new manager in League Two. */

  /** How attractive a candidate is to a specific boardroom. */
  function candidateScore(manager, club, rng) {
    const board = club.board;
    let score = manager.reputation;

    // Reputation gap: a club will not appoint someone far above or below it.
    const gap = manager.reputation - club.reputation;
    if (gap > 18) score -= (gap - 18) * 1.5;      // he would not come anyway
    if (gap < -25) score -= (-gap - 25) * 2.2;    // not the calibre they want

    // Boardroom taste.
    if (board.style === "Patient") {
      score += manager.attrs.development * 0.28;
      if (manager.traits.includes("Youth Developer")) score += 12;
      if (manager.traits.includes("Chequebook")) score -= 8;
    } else if (board.style === "Aggressive") {
      score += (manager.honours.titles * 8 + manager.honours.cups * 4);
      score += manager.attrs.attacking * 0.15;
      if (manager.traits.includes("Chequebook")) score += 6;
      if (manager.traits.includes("Rebuilder")) score -= 10;
    } else if (board.style === "Balanced") {
      score += manager.attrs.manManagement * 0.18 + manager.honours.titles * 4;
    } else if (board.style === "Chaotic") {
      score += rng.between(-25, 25);
      if (manager.traits.includes("Firefighter")) score += 8;
    }

    // A club in trouble wants someone who has done it before.
    if (club.lastPosition && club.board.targets && club.lastPosition > club.board.targets.position + 4) {
      if (manager.traits.includes("Firefighter")) score += 10;
    }
    score *= (PERSONALITIES[manager.personality] || {}).appeal || 1;
    // Being out of work is not fatal, but it costs you something every year.
    score -= manager.joblessSeasons * 3;
    return score + rng.between(-6, 6);
  }

  /** Would this employed manager leave his club for that one? */
  function wouldMove(manager, from, to) {
    if (!from) return true;
    const step = to.reputation - from.reputation;
    if (step >= 8) return true;                                  // clear promotion
    if (step >= 3 && from.board.confidence < 45) return true;    // sideways, but he is under pressure
    if (from.board.confidence < 25 && step >= -5) return true;   // jumping before he is pushed
    return false;
  }

  MG.managers = {
    TACTICS, TACTIC_KEYS, TRAITS, TRAIT_KEYS, PERSONALITIES, PERSONALITY_KEYS,
    ARCHETYPES, ARCHETYPE_KEYS,
    fromArchetype, generate, resetIds, nextId, applyTraitAttrs,
    tacticalFit, matchModifiers, coachingQuality, youthAppetite, recruitmentPolicy,
    mentorCapacity, recruitCapacity, mentorBoost,
    TACTIC_PARAMS, pressIntensity, deriveShift,
    candidateScore, wouldMove,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
