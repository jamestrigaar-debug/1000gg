/* ============================================================================
 * FOOTBALL MANAGER — THE MANAGER DRAFT
 *
 * 1000goals opens by drafting a player out of the DNA of real footballers.
 * This opens by drafting a MANAGER out of a genuinely wider gene pool: five
 * independent rolls that combine rather than one archetype that bundles
 * everything together.
 *
 *   1. TACTIC       the system he wants to play — Possession, High Press...
 *   2. ORIGIN        where he is from, which nations produce a coaching
 *                    pedigree the game actually rewards, and which specific
 *                    club he is quietly still attached to
 *   3. CAREER + AGE  how he actually got here — a recently retired pro, a
 *                    National League grinder, a development coach, someone's
 *                    long-serving assistant — which sets his age and the
 *                    range his reputation can fall in. A three-in-four chance
 *                    of a second chapter (a media stint, a spell upstairs,
 *                    time out of the game) layers a further, smaller nudge.
 *   4. PERSONALITY DNA  and
 *   5. ATTRIBUTES DNA   two INDEPENDENT rolls from the same ten-name pool of
 *                    history's most influential coaches (LEGENDS below), so a
 *                    manager can inherit one man's temperament and a
 *                    different man's coaching shape — Ferguson's man-
 *                    management on Sacchi's back four, or the other way
 *                    round. Two legendary names, three rare, five common.
 *
 * WHAT NEVER APPEARS ON THE REEL: reputation, coaching badge, club
 * affiliation's actual effect, and two rolls that are hidden entirely —
 * Manager Traits (managers.js) and Agent Level, which decides how far his
 * reach into the job market actually goes. All of it is DERIVED once the
 * five rolls are in, not shown as a number while you are choosing. That is
 * deliberate: the report this is built from asks for the draft to be hard to
 * read at a glance, so that knowing what actually makes a good manager is
 * something a save teaches you rather than something the screen tells you.
 * Reroll all you like — you still will not see the number underneath.
 *
 * Each step reseeds from (seed, step, spin count) exactly as 1000goals'
 * draft stream does, so spending a reroll changes THAT step's offer and
 * nothing else — and two players on the same seed see the same offers.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  function gameData() {
    const w = typeof window !== "undefined" ? window : root;
    return (w && w.GAME_DATA) || root.GAME_DATA;
  }

  /* Reputation bands — no longer something rolled directly, only something a
   * derived number is classified into afterward, for the offers screen. */
  const REPUTATION_TIERS = [
    { key: "unknown",     label: "Unknown",     min: 0,  max: 20, blurb: "Nobody has heard of you. The National League is where you prove them wrong." },
    { key: "journeyman",  label: "Journeyman",  min: 21, max: 38, blurb: "A few years in the lower leagues. Somebody will take a chance on you." },
    { key: "respected",   label: "Respected",   min: 39, max: 56, blurb: "You have done a decent job somewhere. Championship clubs are watching." },
    { key: "established", label: "Established", min: 57, max: 72, blurb: "A known quantity. A top-flight club would consider you." },
    { key: "elite",       label: "Elite",       min: 73, max: 99, blurb: "A serious name. The big jobs are open to you from day one." },
  ];
  function tierForReputation(rep) {
    for (const t of REPUTATION_TIERS) if (rep >= t.min && rep <= t.max) return t.label;
    return REPUTATION_TIERS[REPUTATION_TIERS.length - 1].label;
  }

  const DRAFT_STEPS = ["tactic", "origin", "career", "personality", "attributes"];

  /* --------------------------------- ORIGIN --------------------------------
   * Nationality on the draft is weighted toward the football nations that
   * actually produce managers, not the ones that produce players. TOP_NATIONS
   * is the "multiplier for the main nations" the report asks for — a real
   * but never-stated nudge to reputation and to the coaching-adjacent
   * attributes, on the idea that a handful of footballing nations have
   * produced a disproportionate share of the games's actual coaching
   * pedigree. Nothing on the origin reel says so directly. */
  const MANAGER_NATION_WEIGHTS = {
    England: 26, Scotland: 8, Ireland: 5, Wales: 3,
    Spain: 12, Italy: 11, Germany: 9, Portugal: 8, France: 7, Netherlands: 6,
    Argentina: 5, Brazil: 4, Belgium: 3, Croatia: 2, Serbia: 2, Denmark: 2,
    Norway: 2, Sweden: 2, Austria: 2, Switzerland: 2, Poland: 2, Turkey: 2,
    USA: 2, Japan: 1, Australia: 1, Morocco: 1, Senegal: 1,
  };
  const TOP_NATIONS = new Set(["England", "Spain", "Italy", "Germany", "Portugal", "Netherlands", "Argentina", "Brazil"]);

  function rollNationality(rng) { return rng.weightedKey(MANAGER_NATION_WEIGHTS); }

  /* Every club actually in that manager's own country, from the tuned club
   * database — weighted toward the ones with a real footballing history, so
   * "attached to" reads like it means something rather than landing on
   * whichever eighteenth-placed side the roll happened to hit. */
  function clubsFromNation(nationality) {
    const D = gameData();
    if (!D || !D.TEAM_DATABASE || !MG.clubs) return [];
    const out = [];
    for (const [name, raw] of Object.entries(D.TEAM_DATABASE)) {
      const league = MG.clubs.LEAGUES[MG.clubs.leagueIdFor(raw.league)];
      if (league && league.country === nationality) out.push({ name, raw });
    }
    return out;
  }
  function rollAffiliation(rng, nationality) {
    const pool = clubsFromNation(nationality);
    if (!pool.length) return null;
    const weighted = pool.map(({ name, raw }) => ({ item: name, weight: Math.max(1, (raw.attack + raw.midfield + raw.defence) / 3 - 40) }));
    return rng.weighted(weighted);
  }

  /* ---------------------------- CAREER + AGE -------------------------------
   * How he actually got here. `repRange`/`ageRange` are never shown as
   * numbers — only the blurb is — but they are what actually decides which
   * clubs will talk to him. `attrs` are flat nudges on top of whatever the
   * Attributes DNA roll gave him. */
  const CAREER_PATHS = {
    exPlayer: {
      key: "exPlayer", label: "Just Hung Up His Boots", weight: 22,
      ageRange: [32, 42], repRange: [15, 55],
      blurb: "A recognisable name from a recent dressing room, one step from playing to one step from managing.",
      attrs: { manManagement: 6, attacking: 4, development: -4 },
    },
    nonLeague: {
      key: "nonLeague", label: "Built From the Bottom", weight: 26,
      ageRange: [38, 58], repRange: [6, 30],
      blurb: "Years in the parks and the pyramid nobody televises. Whatever he knows, he earned twice over.",
      attrs: { discipline: 8, manManagement: 4, transferAcumen: -4 },
    },
    academyCoach: {
      key: "academyCoach", label: "A Development Man", weight: 20,
      ageRange: [34, 50], repRange: [15, 40],
      blurb: "Years spent making other people's kids better before anyone let him near the first team.",
      attrs: { development: 10, adaptability: 4, attacking: -2 },
    },
    assistant: {
      key: "assistant", label: "The Understudy", weight: 18,
      ageRange: [36, 54], repRange: [20, 50],
      blurb: "Stood a yard behind somebody significant for a long time, taking notes.",
      attrs: { transferAcumen: 6, adaptability: 6, discipline: 4 }, agentBonus: 8,
    },
    foreignImport: {
      key: "foreignImport", label: "Made His Name Abroad", weight: 14,
      ageRange: [35, 55], repRange: [20, 55],
      blurb: "A reputation built somewhere the cameras back home were not really watching.",
      attrs: { adaptability: 10, transferAcumen: 4 }, agentBonus: 16,
    },
  };
  const CAREER_KEYS = Object.keys(CAREER_PATHS);

  /* A three-in-four chance of a second chapter — a smaller nudge layered on
   * top of the primary career, and part of the same blurb rather than a
   * separate reel step. */
  const SECOND_CAREERS = {
    pundit: { key: "pundit", text: "a couple of quiet years behind a microphone before the touchline pulled him back", attrs: { manManagement: 3 } },
    dof: { key: "dof", text: "a stint upstairs as a director of football before he decided he missed the grass", attrs: { transferAcumen: 5 } },
    youthNT: { key: "youthNT", text: "time coaching a country's age-group sides in between club jobs", attrs: { development: 5 } },
    playerManager: { key: "playerManager", text: "a couple of seasons picking himself before the legs finally settled the argument", attrs: { attacking: 3 } },
    reinvention: { key: "reinvention", text: "a few years out of the game entirely, and came back a different manager for it", attrs: { adaptability: 5 } },
  };
  const SECOND_CAREER_KEYS = Object.keys(SECOND_CAREERS);

  const COACHING_BADGES = {
    exPlayer: "UEFA Pro Licence (fast-tracked)",
    nonLeague: "UEFA B Licence, earned the long way",
    academyCoach: "UEFA A Licence, youth pathway",
    assistant: "UEFA Pro Licence",
    foreignImport: "Continental Licence, unrecognised at home",
  };

  function rollCareer(rng) {
    const key = rng.weighted(CAREER_KEYS.map((k) => ({ item: k, weight: CAREER_PATHS[k].weight })));
    const second = rng.chance(0.75) ? rng.pick(SECOND_CAREER_KEYS) : null;
    return { key, second };
  }

  /* ------------------------- PERSONALITY / ATTRIBUTES DNA -------------------
   * Ten names from football history, deliberately distinct from managers.js'
   * ARCHETYPES (which are pattern-matched to managers still working today) —
   * these are who taught the modern game the shapes it still plays in. The
   * SAME pool is drawn from twice, independently, for Personality DNA and
   * Attributes DNA — a manager can inherit one man's temperament and a wholly
   * different man's coaching shape. */
  const LEGENDS = {
    ferguson: {
      key: "ferguson", name: "The Trafford Empire-Builder", basedOn: "Sir Alex Ferguson", rarity: "Legendary",
      blurb: "Twenty-plus years at one club and never once looked settled. Rebuilt the same empire three times over.",
      personality: "Ruthless", traits: ["Man-Manager", "Rebuilder"],
      attrs: { attacking: 78, defending: 80, development: 88, manManagement: 96, transferAcumen: 82, adaptability: 80, discipline: 92 },
    },
    shankly: {
      key: "shankly", name: "The Kop's First Prophet", basedOn: "Bill Shankly", rarity: "Legendary",
      blurb: "Made a football club into a religion out of nothing but conviction and a very good boot room.",
      personality: "Charismatic", traits: ["Man-Manager", "Motivator"],
      attrs: { attacking: 80, defending: 74, development: 78, manManagement: 94, transferAcumen: 66, adaptability: 70, discipline: 82 },
    },
    cruyff: {
      key: "cruyff", name: "The Total Footballer", basedOn: "Johan Cruyff", rarity: "Rare",
      blurb: "Believed the ball should do the running. Would rather lose playing his way than win playing anyone else's.",
      personality: "Idealist", traits: ["Attacking Idealist", "Youth Developer"],
      attrs: { attacking: 94, defending: 58, development: 90, manManagement: 70, transferAcumen: 72, adaptability: 64, discipline: 60 },
    },
    sacchi: {
      key: "sacchi", name: "The Zonal Revolutionary", basedOn: "Arrigo Sacchi", rarity: "Rare",
      blurb: "Never played the game at any level worth mentioning. Coached a back four like it was a piece of engineering.",
      personality: "Aloof", traits: ["Disciplinarian", "Tinkerer"],
      attrs: { attacking: 82, defending: 88, development: 76, manManagement: 64, transferAcumen: 70, adaptability: 86, discipline: 88 },
    },
    clough: {
      key: "clough", name: "The Provincial Maverick", basedOn: "Brian Clough", rarity: "Rare",
      blurb: "Never met an authority he did not enjoy needling. Won things nobody could explain how.",
      personality: "Volatile", traits: ["Motivator", "Firefighter"],
      attrs: { attacking: 80, defending: 76, development: 74, manManagement: 88, transferAcumen: 68, adaptability: 66, discipline: 70 },
    },
    paisley: {
      key: "paisley", name: "The Quiet Continuity Man", basedOn: "Bob Paisley", rarity: "Common",
      blurb: "Never raised his voice, never chased a headline, quietly won more than the men who did both.",
      personality: "Calm", traits: ["Loyalist", "Man-Manager"],
      attrs: { attacking: 74, defending: 76, development: 80, manManagement: 86, transferAcumen: 74, adaptability: 68, discipline: 78 },
    },
    chapman: {
      key: "chapman", name: "The First Tactician", basedOn: "Herbert Chapman", rarity: "Common",
      blurb: "Numbered the shirts, floodlit the ground, picked the formation everyone else spent a decade copying.",
      personality: "Charismatic", traits: ["Set-Piece Specialist", "Analytics"],
      attrs: { attacking: 78, defending: 78, development: 72, manManagement: 74, transferAcumen: 80, adaptability: 74, discipline: 76 },
    },
    stein: {
      key: "stein", name: "The Lisbon Lion Tamer", basedOn: "Jock Stein", rarity: "Common",
      blurb: "Took a team of players born within thirty miles of the stadium and beat the whole of Europe with them.",
      personality: "Charismatic", traits: ["Motivator", "Disciplinarian"],
      attrs: { attacking: 80, defending: 78, development: 76, manManagement: 88, transferAcumen: 68, adaptability: 70, discipline: 80 },
    },
    herrera: {
      key: "herrera", name: "The Catenaccio Architect", basedOn: "Helenio Herrera", rarity: "Common",
      blurb: "Built a defence so mean it had its own name, and never apologised for a single one-nil.",
      personality: "Ruthless", traits: ["Disciplinarian", "Chequebook"],
      attrs: { attacking: 68, defending: 92, development: 64, manManagement: 76, transferAcumen: 78, adaptability: 72, discipline: 86 },
    },
    lobanovskyi: {
      key: "lobanovskyi", name: "The Systems Scientist", basedOn: "Valeriy Lobanovskyi", rarity: "Common",
      blurb: "Treated a football team like a system to be optimised, years before anyone had the numbers to check him.",
      personality: "Aloof", traits: ["Analytics", "Tinkerer"],
      attrs: { attacking: 76, defending: 84, development: 82, manManagement: 62, transferAcumen: 70, adaptability: 84, discipline: 84 },
    },
  };
  const LEGEND_KEYS = Object.keys(LEGENDS);
  // 2 legendary, 3 rare, 5 common — legendary the rarest draw, common the
  // most frequent, but no rarity is ever printed on the reel itself.
  const LEGEND_RARITY_WEIGHT = { Legendary: 3, Rare: 8, Common: 15 };
  function rollLegend(rng) {
    return rng.weighted(LEGEND_KEYS.map((k) => ({ item: k, weight: LEGEND_RARITY_WEIGHT[LEGENDS[k].rarity] || 10 })));
  }

  function rollTactic(rng) { return rng.pick(MG.managers.TACTIC_KEYS); }

  /** Assemble the finished manager from everything landed on the reel. This
   *  is where reputation, age, the hidden traits and the hidden agent level
   *  all come from — none of it visible while the five rolls were happening. */
  function buildFromDNA(rng, landed, name) {
    const career = CAREER_PATHS[landed.career.key] || CAREER_PATHS.nonLeague;
    const second = landed.career.second ? SECOND_CAREERS[landed.career.second] : null;
    const personalityLegend = LEGENDS[landed.personality] || LEGENDS.paisley;
    const attrsLegend = LEGENDS[landed.attributes] || LEGENDS.paisley;
    const nationality = landed.nationality || rollNationality(rng);
    const topNation = TOP_NATIONS.has(nationality);

    // Reputation: derived, not rolled. The career path sets the band, a top
    // footballing nation and a rare DNA draw both nudge it up a little, and
    // none of that arithmetic is shown anywhere on the draft screen.
    const repBase = rng.int(career.repRange[0], career.repRange[1]);
    const nationBump = topNation ? rng.int(3, 9) : 0;
    const rarityBump = (legend) => legend.rarity === "Legendary" ? rng.int(4, 9) : legend.rarity === "Rare" ? rng.int(1, 5) : 0;
    const reputation = clamp(Math.round(repBase + nationBump + rarityBump(personalityLegend) + rarityBump(attrsLegend) + rng.gauss() * 4), 4, 96);

    const age = clamp(Math.round(rng.between(career.ageRange[0], career.ageRange[1])), 26, 68);

    // Attributes: the ATTRIBUTES DNA legend, scaled to reputation the same
    // way the old archetype draft always was, then layered with the career
    // path's own nudges and (rarely) the second career's.
    const scale = 0.55 + (reputation / 99) * 0.5;
    const attrs = {};
    for (const [k, v] of Object.entries(attrsLegend.attrs)) attrs[k] = clamp(Math.round(v * scale + rng.gauss() * 4), 12, 99);
    for (const [k, v] of Object.entries(career.attrs || {})) attrs[k] = clamp((attrs[k] || 50) + v, 10, 99);
    if (second && second.attrs) for (const [k, v] of Object.entries(second.attrs)) attrs[k] = clamp((attrs[k] || 50) + v, 10, 99);
    if (topNation) { attrs.transferAcumen = clamp((attrs.transferAcumen || 50) + 4, 10, 99); attrs.development = clamp((attrs.development || 50) + 3, 10, 99); }

    // Traits — hidden. Signature trait(s) from the PERSONALITY DNA legend,
    // with the same "a third trait a third of the time" roll managers.js's
    // own archetype draft uses, so two managers who land the same
    // personality name still are not identical.
    const traits = personalityLegend.traits.slice();
    if (rng.chance(0.35)) {
      const extra = rng.pick(MG.managers.TRAIT_KEYS.filter((t) => !traits.includes(t)));
      if (extra) traits.push(extra);
    }
    MG.managers.applyTraitAttrs(attrs, traits);

    // Agent level — hidden. How far his reach into the job market actually
    // goes: a well-connected background opens more of the world, a National
    // League grinder's agent has one phone and a local number. Read by
    // jobOffers below.
    let agentLevel = rng.int(20, 55) + (topNation ? 10 : 0) + (career.agentBonus || 0);
    agentLevel = clamp(Math.round(agentLevel + rng.gauss() * 6), 5, 99);

    const affiliation = landed.affiliation !== undefined ? landed.affiliation : rollAffiliation(rng, nationality);

    const m = {
      id: MG.managers.nextId(),
      name: name || MG.names.managerName(rng, nationality),
      nationality,
      age,
      archetype: null,              // built from DNA, not a template — tactics.js's managerFit() treats this as "always his own game"
      archetypeName: career.label,
      reputation,
      personality: personalityLegend.personality,
      tactic: landed.tactic || rollTactic(rng),
      traits,
      attrs,
      clubId: null,
      tenure: 0,
      joblessSeasons: 0,
      isPlayer: true,
      clubPreference: MG.managers.rollClubPreference(rng),
      careerPreference: MG.managers.rollCareerPreference(rng, reputation),
      honours: { titles: 0, cups: 0, promotions: 0, relegations: 0, european: 0 },
      record: { seasons: 0, played: 0, won: 0, drawn: 0, lost: 0 },
      history: [],
      // The visible parts of the DNA record, for a future manager sheet;
      // agentLevel and the exact arithmetic above are never surfaced.
      dna: {
        career: career.key, careerLabel: career.label,
        secondCareer: second ? second.key : null, secondCareerText: second ? second.text : null,
        personality: personalityLegend.key, attributes: attrsLegend.key,
        affiliation, badge: COACHING_BADGES[career.key],
        agentLevel,
      },
    };
    m.reputationTier = tierForReputation(reputation);
    return m;
  }

  /** One complete manager, rolled in a single call — used by the tests and
   *  anywhere the game wants a manager without running the reel. */
  function rollManager(rng, opts) {
    const o = opts || {};
    const landed = {
      tactic: o.tactic || rollTactic(rng),
      nationality: o.nationality || rollNationality(rng),
      career: o.career || rollCareer(rng),
      personality: o.personality || rollLegend(rng),
      attributes: o.attributes || rollLegend(rng),
    };
    landed.affiliation = rollAffiliation(rng, landed.nationality);
    return buildFromDNA(rng, landed, o.name);
  }

  /* ------------------------------ DRAFT FLOW -------------------------------
   * A five-step reel with rerolls, mirroring 1000goals' genesis screen. */
  function createDraft(seed, opts) {
    const o = opts || {};
    const draft = {
      seed,
      rerolls: o.rerolls != null ? o.rerolls : 3,
      step: 0,
      spins: { tactic: 0, origin: 0, career: 0, personality: 0, attributes: 0 },
      landed: { tactic: null, nationality: null, affiliation: null, career: null, personality: null, attributes: null },
      done: false,
    };

    /* Each step draws from its own stream, keyed by how many times it has been
     * spun — so a reroll re-rolls this step and leaves every other step, and
     * the world's own seed, exactly where they were. */
    function streamFor(step) {
      return MG.createRng(`${draft.seed}|draft|${step}|${draft.spins[step]}`);
    }

    draft.currentStep = () => DRAFT_STEPS[draft.step] || null;

    draft.spin = () => {
      const step = draft.currentStep();
      if (!step) return null;
      const rng = streamFor(step);
      if (step === "tactic") {
        draft.landed.tactic = rollTactic(rng);
        return MG.managers.TACTICS[draft.landed.tactic];
      }
      if (step === "origin") {
        draft.landed.nationality = rollNationality(rng);
        draft.landed.affiliation = rollAffiliation(rng, draft.landed.nationality);
        return { nationality: draft.landed.nationality, affiliation: draft.landed.affiliation, top: TOP_NATIONS.has(draft.landed.nationality) };
      }
      if (step === "career") {
        draft.landed.career = rollCareer(rng);
        return { path: CAREER_PATHS[draft.landed.career.key], second: draft.landed.career.second ? SECOND_CAREERS[draft.landed.career.second] : null };
      }
      if (step === "personality") {
        draft.landed.personality = rollLegend(rng);
        return LEGENDS[draft.landed.personality];
      }
      draft.landed.attributes = rollLegend(rng);
      return LEGENDS[draft.landed.attributes];
    };

    /** Spend a reroll on the step just landed. */
    draft.reroll = () => {
      const step = draft.currentStep();
      if (!step || draft.rerolls <= 0) return null;
      draft.rerolls--;
      draft.spins[step]++;
      return draft.spin();
    };

    /** Lock the current step in and move on. */
    draft.accept = () => {
      if (draft.step < DRAFT_STEPS.length - 1) { draft.step++; return draft.currentStep(); }
      draft.done = true;
      return null;
    };

    /** The finished manager. Deterministic for a given seed and reroll pattern. */
    draft.build = (name) => {
      const rng = MG.createRng(`${draft.seed}|draft|build|${DRAFT_STEPS.map((s) => draft.spins[s]).join("")}`);
      return buildFromDNA(rng, draft.landed, name || undefined);
    };

    return draft;
  }

  /* ------------------------- FIRST JOB ON THE BOARD -------------------------
   * Which clubs would actually give this manager a job. Reputation still
   * does most of the work, but the hidden Agent Level now does two things a
   * flat reputation gap never could: a well-connected manager gets a look at
   * a slightly bigger job than his reputation alone would justify, and reads
   * a foreign vacancy as just as real an option as a domestic one — where a
   * poorly-connected manager's world is smaller than his reputation says. */
  function jobOffers(world, manager, count) {
    const rng = world.rng;
    const agent = (manager.dna && manager.dna.agentLevel != null) ? manager.dna.agentLevel : 50;
    const affiliation = manager.dna && manager.dna.affiliation;
    const offers = [];
    for (const club of world.clubs) {
      const gap = manager.reputation - club.reputation;
      const gapCeiling = 34 + (agent - 50) * 0.3;
      if (gap < -14 || gap > gapCeiling) continue;
      const board = MG.clubs.BOARD_STYLES[club.board.style];
      let appeal = MG.managers.candidateScore(manager, club, rng);
      if (affiliation && club.name === affiliation) appeal += 14;
      if (club.country !== manager.nationality) appeal += (agent - 50) * 0.25;
      offers.push({
        club,
        appeal,
        leagueName: MG.clubs.LEAGUES[club.leagueId].name,
        boardStyle: club.board.style,
        boardBlurb: board.blurb,
        brief: club.board.targets ? club.board.targets.summary : null,
        budget: club.finances.transferBudget,
        squadRating: Math.round(MG.clubs.clubStrength(club)),
      });
    }
    offers.sort((a, b) => b.appeal - a.appeal);
    // Spread the offers across divisions rather than handing over the five
    // clubs with the same reputation.
    const seen = {};
    const spread = [];
    for (const o of offers) {
      seen[o.club.leagueId] = (seen[o.club.leagueId] || 0) + 1;
      if (seen[o.club.leagueId] > 2) continue;
      spread.push(o);
      if (spread.length >= (count || 4)) break;
    }
    return spread;
  }

  MG.draft = {
    REPUTATION_TIERS, tierForReputation, DRAFT_STEPS, MANAGER_NATION_WEIGHTS, TOP_NATIONS,
    CAREER_PATHS, CAREER_KEYS, SECOND_CAREERS, SECOND_CAREER_KEYS, COACHING_BADGES,
    LEGENDS, LEGEND_KEYS, LEGEND_RARITY_WEIGHT,
    rollTactic, rollNationality, rollAffiliation, rollCareer, rollLegend,
    buildFromDNA, rollManager, createDraft, jobOffers,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
