/* ============================================================================
 * FOOTBALL DNA SIMULATOR — GAME ENGINE  (Alpha 1.1)
 * Build a striker by drafting attributes from 8 different football eras,
 * then chase 1000 career goals across a fully-simulated career.
 *
 * Alpha 1.1 features:
 *   1. Hidden attribute influence  2. Academy club-roll  3. Free selection
 *   4. Team+Era flow / sorted rosters  5. Expanded stats + league tables
 *   6. End-of-career events  7. Physical-build synergy  8. Peak ratings
 *   9. Hidden-rating mentality system
 * Data lives in data.js (window.GAME_DATA).
 * ========================================================================== */
(function () {
  "use strict";

  const D = window.GAME_DATA;
  const {
    MENTALITY_TRAITS,
    ACADEMY_TIERS,
    CLUB_ACADEMY,
    PLAYER_DATABASE,
    PLAYER_DATABASE_2025_26,
    TEAM_DATABASE,
    ACADEMY_STARTING_POOL,
    NATIONAL_TEAM,
    FOREIGN_LEAGUES,
  } = D;

  // TEAM_DATABASE is mutated over the course of a career (strength drift via
  // updateTeamStrengths, and league changes via promotion/relegation). Keep a
  // pristine deep-clone snapshot so a brand-new career always starts from the
  // same baseline instead of carrying over drift/promotions from a previous
  // playthrough in the same browser session.
  const PRISTINE_TEAM_DATABASE = JSON.parse(JSON.stringify(TEAM_DATABASE));
  function resetTeamDatabase() {
    for (const club of Object.keys(TEAM_DATABASE)) {
      if (!PRISTINE_TEAM_DATABASE[club]) { delete TEAM_DATABASE[club]; continue; }
      Object.assign(TEAM_DATABASE[club], PRISTINE_TEAM_DATABASE[club]);
    }
  }

  // Manager profiles per team: visible during club-offer selection to help the
  // player choose a destination aligned with their striker's strengths.
  const MANAGER_DATABASE = {
    "Manchester City": { name: "P. Guardiola", focus: "Tactical Perfection", tag: "Elite signings", youth: "Low", project: "Win-now possession machine" },
    "Liverpool": { name: "J. Klopp", focus: "High Intensity", tag: "Pressing merchants", youth: "Medium", project: "Counter-attacking dynamo" },
    "Arsenal": { name: "M. Arteta", focus: "Youth Trust", tag: "Develops wonderkids", youth: "High", project: "Technical rebuild" },
    "Manchester United": { name: "E. ten Hag", focus: "Disciplined Structure", tag: "Mixed profile", youth: "Medium", project: "Rebuild with stars" },
    "Chelsea": { name: "M. Maresca", focus: "Squad Rotation", tag: "High-profile signings", youth: "Medium", project: "Deep squad competition" },
    "Tottenham": { name: "A. Postecoglou", focus: "Attack First", tag: "Entertainment project", youth: "Medium", project: "All-out attack" },
    "Newcastle United": { name: "E. Howe", focus: "High Work Rate", tag: "High-profile targets", youth: "Low", project: "Elite ambition" },
    "Aston Villa": { name: "U. Emery", focus: "Tactical Specialist", tag: "Smart signings", youth: "Medium", project: "Tournament-ready" },
    "Brighton": { name: "F. Hurzeler", focus: "Tactical Development", tag: "Trusts youth", youth: "High", project: "Data-driven academy" },
    "West Ham": { name: "G. Potter", focus: "Balanced Build", tag: "Squad players", youth: "Medium", project: "Mid-table stability" },
    "Crystal Palace": { name: "O. Glasner", focus: "Physical Organisation", tag: "Trusts youth", youth: "High", project: "Eagles identity" },
    "Brentford": { name: "T. Frank", focus: "System Striker", tag: "Analytics signings", youth: "Low", project: "Set-piece kings" },
    "Fulham": { name: "M. Silva", focus: "Technical Build", tag: "Squad players", youth: "Medium", project: "Possession underdogs" },
    "Everton": { name: "D. Moyes", focus: "Fighting Spirit", tag: "Mixed profile", youth: "Medium", project: "Defensive resilience" },
    "Wolves": { name: "V. Pereira", focus: "Tactical Flexibility", tag: "Development project", youth: "High", project: "Rebuild transition" },
    "Nottingham Forest": { name: "N. Williams", focus: "Counter Attacks", tag: "High-profile targets", youth: "Low", project: "Squad overhaul" },
    "Bournemouth": { name: "A. Iraola", focus: "High Press", tag: "Trusts youth", youth: "High", project: "High-energy press" },
    "Burnley": { name: "S. Parker", focus: "Disciplined Press", tag: "Squad players", youth: "Medium", project: "Relegation scrap" },
    "Huddersfield Town": { name: "C. Wilder", focus: "Organised Battle", tag: "Squad players", youth: "Medium", project: "Defensive underdogs" },
    "Luton Town": { name: "R. Edwards", focus: "Underdog Spirit", tag: "Development project", youth: "High", project: "Minnow mentality" },
  };

  /* --------------------------- CONFIG / LEVERS --------------------------- */
  // The 7 attributes drafted from Team+Era squads (chosen in any order).
  const POSITIONS = {
    "ST": { label: "Striker", goalMod: 1.18, assistMod: 0.82, wide: false, central: true, forward: true },
    "CF": { label: "Center Forward", goalMod: 1.08, assistMod: 0.92, wide: false, central: true, forward: true },
    "AML": { label: "Attacking Midfield Left", goalMod: 0.85, assistMod: 1.20, wide: true, central: false, forward: false },
    "AMR": { label: "Attacking Midfield Right", goalMod: 0.85, assistMod: 1.20, wide: true, central: false, forward: false },
    "AMC": { label: "Attacking Midfield Center", goalMod: 0.90, assistMod: 1.15, wide: false, central: true, forward: false },
    "Winger": { label: "Winger", goalMod: 0.95, assistMod: 1.10, wide: true, central: false, forward: false },
  };
  const POSITION_KEYS = Object.keys(POSITIONS);

  const AGENT_TIERS = [
    { key: "poor", label: "Poor", influence: 0, contractBonus: 0, wealth: 10, weight: 20 },
    { key: "med", label: "Mediocre", influence: 0.08, contractBonus: 0, wealth: 25, weight: 35 },
    { key: "average", label: "Average", influence: 0.18, contractBonus: 1, wealth: 50, weight: 30 },
    { key: "worldclass", label: "World Class", influence: 0.35, contractBonus: 2, wealth: 80, weight: 15 },
  ];
  const AGENT_BY_KEY = Object.fromEntries(AGENT_TIERS.map((a) => [a.key, a]));

  // All-time records for the career stats comparison tables.
  const ALL_TIME_RECORDS = {
    plGoals: { recordHolder: "Alan Shearer", total: 260 },
    plAssists: { recordHolder: "Ryan Giggs", total: 162 },
    plAppearances: { recordHolder: "James Milner", total: 658 },
    plCleanSheets: { recordHolder: "Petr Čech", total: 202 },
    plPenaltiesSaved: { recordHolder: "David James", total: 13 },
    careerGoals: { recordHolder: "Cristiano Ronaldo", total: 900 },
    careerAssists: { recordHolder: "Lionel Messi", total: 380 },
    careerAppearances: { recordHolder: "Cristiano Ronaldo", total: 1226 },
    ballonDors: { recordHolder: "Lionel Messi", total: 8 },
    championsLeagueGoals: { recordHolder: "Cristiano Ronaldo", total: 140 },
    championsLeagueAssists: { recordHolder: "Cristiano Ronaldo", total: 42 },
    worldCupGoals: { recordHolder: "Miroslav Klose", total: 16 },
    worldCupAssists: { recordHolder: "Lionel Messi", total: 9 },
    worldCupAppearances: { recordHolder: "Lionel Messi", total: 26 },
    intlCaps: { recordHolder: "Cristiano Ronaldo", total: 221 },
    intlGoals: { recordHolder: "Cristiano Ronaldo", total: 143 },
  };
  const TOP_10_PL_GOALS = [
    { name: "Alan Shearer", total: 260 },
    { name: "Harry Kane", total: 213 },
    { name: "Wayne Rooney", total: 208 },
    { name: "Mohamed Salah", total: 193 },
    { name: "Andy Cole", total: 187 },
    { name: "Sergio Agüero", total: 184 },
    { name: "Frank Lampard", total: 177 },
    { name: "Thierry Henry", total: 175 },
    { name: "Robbie Fowler", total: 163 },
    { name: "Jermain Defoe", total: 162 },
  ];
  const TOP_10_PL_ASSISTS = [
    { name: "Ryan Giggs", total: 162 },
    { name: "Kevin De Bruyne", total: 121 },
    { name: "Cesc Fàbregas", total: 111 },
    { name: "Wayne Rooney", total: 103 },
    { name: "Frank Lampard", total: 102 },
    { name: "Mohamed Salah", total: 94 },
    { name: "Dennis Bergkamp", total: 94 },
    { name: "David Silva", total: 93 },
    { name: "Steven Gerrard", total: 92 },
    { name: "James Milner", total: 90 },
  ];
  const TOP_10_PL_APPEARANCES = [
    { name: "James Milner", total: 658 },
    { name: "Gareth Barry", total: 653 },
    { name: "Ryan Giggs", total: 632 },
    { name: "Frank Lampard", total: 609 },
    { name: "David James", total: 572 },
  ];
  const TOP_10_ALL_TIME_GOALS = [
    { name: "Cristiano Ronaldo", total: 900 },
    { name: "Lionel Messi", total: 860 },
    { name: "Josef Bican", total: 805 },
    { name: "Romário", total: 770 },
    { name: "Pelé", total: 760 },
    { name: "Ferenc Puskás", total: 725 },
    { name: "Gerd Müller", total: 735 },
    { name: "Robert Lewandowski", total: 700 },
    { name: "Jimmy Jones", total: 640 },
    { name: "Eusébio", total: 620 },
  ];
  const TOP_10_INTL_CAPS = [
    { name: "Cristiano Ronaldo", total: 221 },
    { name: "Bader Al-Mutawa", total: 196 },
    { name: "Soh Chin Ann", total: 195 },
    { name: "Lionel Messi", total: 193 },
    { name: "Ahmed Hassan", total: 184 },
  ];
  const TOP_10_INTL_GOALS = [
    { name: "Cristiano Ronaldo", total: 143 },
    { name: "Lionel Messi", total: 120 },
    { name: "Ali Daei", total: 109 },
    { name: "Sunil Chhetri", total: 95 },
    { name: "Mokhtar Dahari", total: 89 },
  ];

  const ATTRS = [
    { key: "heading", name: "Heading", short: "HDR", type: "numeric", desc: "Aerial threat — wins headers and attacks crosses." },
    { key: "mentality", name: "Mentality", short: "MEN", type: "mentality", desc: "Personality & temperament — hidden influence on big moments." },
    { key: "body", name: "Fitness & Strength", short: "PHY", type: "body", desc: "Stamina to play every game and hold off defenders." },
    { key: "build", name: "Build", short: "BLD", type: "build", desc: "Height and weight frame — rolled, not drafted." },
    { key: "leftFoot", name: "Left Foot", short: "LF", type: "numeric", desc: "Finishing quality with the left foot." },
    { key: "rightFoot", name: "Right Foot", short: "RF", type: "numeric", desc: "Finishing quality with the right foot." },
    { key: "speed", name: "Speed", short: "PAC", type: "numeric", desc: "Raw pace to beat defenders and run in behind." },
    { key: "position", name: "Position", short: "POS", type: "position", desc: "Primary playing position — rolled, not drafted." },
  ];
  const ATTR_BY_KEY = Object.fromEntries(ATTRS.map((a) => [a.key, a]));
  const DRAFT_ATTRS = ATTRS.filter((a) => a.type !== "build" && a.type !== "position");
  // skill attributes that receive hidden-influence blending
  const HIDDEN_KEYS = ["heading", "fitness", "strength", "leftFoot", "rightFoot", "speed"];
  const HIDDEN_WEIGHT = 0.22;

  const LEVERS = {
    startRerolls: 3,
    goalTarget: 1000,
    conversionMultiplier: 1.085,
    primeWindow: [25, 29],
    injuryFreqMin: 3,
    injuryFreqMax: 6,
    debutAge: 17,
  };

  // League prestige & structural modifiers (★ = higher value)
  const LEAGUE_WEIGHTS = {
    // shareCap: max fraction of team goals a player can claim per match
    // matchCap:  max Poisson lambda per match (prevents multi-goal haul every game)
    Elite:         { goals: 1.0,  minutes: 1.0,  reputation: 1.0,  wages: 1.0,  compFactor: 0.18, europeWeight: 0.55, shareCap: 0.38, matchCap: 0.95 },
    Europe:        { goals: 1.0,  minutes: 0.95, reputation: 0.85, wages: 0.85, compFactor: 0.15, europeWeight: 0.45, shareCap: 0.38, matchCap: 0.95 },
    Mid:           { goals: 1.02, minutes: 1.0,  reputation: 0.70, wages: 0.70, compFactor: 0.08, europeWeight: 0.25, shareCap: 0.40, matchCap: 1.00 },
    Lower:         { goals: 1.05, minutes: 1.0,  reputation: 0.55, wages: 0.55, compFactor: 0.04, europeWeight: 0.10, shareCap: 0.42, matchCap: 1.05 },
    LaLiga:        { goals: 1.0,  minutes: 0.95, reputation: 0.95, wages: 0.85, compFactor: 0.17, europeWeight: 0.50, shareCap: 0.50, matchCap: 1.20 },
    SerieA:        { goals: 0.95, minutes: 0.95, reputation: 0.85, wages: 0.75, compFactor: 0.16, europeWeight: 0.50, shareCap: 0.46, matchCap: 1.10 },
    Bundesliga:    { goals: 1.05, minutes: 1.0,  reputation: 0.88, wages: 0.75, compFactor: 0.16, europeWeight: 0.50, shareCap: 0.50, matchCap: 1.20 },
    MLS:           { goals: 0.85, minutes: 1.05, reputation: 0.40, wages: 0.80, compFactor: 0.08, europeWeight: 0.05, shareCap: 0.44, matchCap: 1.05 },
    Saudi:         { goals: 0.90, minutes: 1.05, reputation: 0.35, wages: 1.0,  compFactor: 0.08, europeWeight: 0.05, shareCap: 0.44, matchCap: 1.05 },
    Championship:  { goals: 0.80, minutes: 1.05, reputation: 0.35, wages: 0.40, compFactor: 0.07, europeWeight: 0.05, shareCap: 0.38, matchCap: 0.95 },
    League1:       { goals: 0.75, minutes: 1.05, reputation: 0.22, wages: 0.20, compFactor: 0.05, europeWeight: 0.00, shareCap: 0.38, matchCap: 0.95 },
    League2:       { goals: 0.70, minutes: 1.05, reputation: 0.15, wages: 0.12, compFactor: 0.04, europeWeight: 0.00, shareCap: 0.38, matchCap: 0.95 },
    NationalLeague:{ goals: 0.65, minutes: 1.05, reputation: 0.10, wages: 0.07, compFactor: 0.03, europeWeight: 0.00, shareCap: 0.38, matchCap: 0.95 },
  };

  /* ---- SYNERGY SCORING: deep mathematical model ----
   * Evaluates how well attributes complement each other.
   * Each pairing produces a sub-score in [-1, +1]. The composite
   * synergy multiplier is product(1 + subScore * weight) — multiplicative
   * so perfect synergy compounds while mismatches cancel out.
   * Range: roughly 0.80x (terrible) to 1.20x (perfect) on the rating. */
  const SYNERGY_PAIRS = [
    // Dual-foot synergy: being elite with both feet is exponentially valuable
    { keys: ["leftFoot", "rightFoot"], weight: 0.06,
      score: (a) => { const lo = Math.min(a.leftFoot, a.rightFoot), hi = Math.max(a.leftFoot, a.rightFoot);
        if (lo >= 85) return 1; if (lo >= 75) return 0.5; if (lo >= 65) return 0; if (lo >= 55) return -0.3; return -0.6; } },
    // Pace + Finishing: the classic striker combo
    { keys: ["speed", "leftFoot"], weight: 0.05,
      score: (a) => pairScore(a.speed, a.leftFoot, 85) },
    { keys: ["speed", "rightFoot"], weight: 0.05,
      score: (a) => pairScore(a.speed, a.rightFoot, 85) },
    // Heading + Strength: aerial dominance
    { keys: ["heading", "strength"], weight: 0.05,
      score: (a) => pairScore(a.heading, a.strength, 85) },
    // Height + Heading: physical + technical
    { keys: ["height", "heading"], weight: 0.04,
      score: (a) => { if (a.height >= 188 && a.heading >= 85) return 1; if (a.height >= 183 && a.heading >= 80) return 0.4; if (a.height < 175 && a.heading >= 85) return -0.5; return 0; } },
    // Speed + Fitness: engine for relentless running
    { keys: ["speed", "fitness"], weight: 0.04,
      score: (a) => pairScore(a.speed, a.fitness, 82) },
    // Strength + Fitness: physical durability
    { keys: ["strength", "fitness"], weight: 0.03,
      score: (a) => pairScore(a.strength, a.fitness, 80) },
    // Height penalty for speed: tall + fast is rare
    { keys: ["height", "speed"], weight: 0.04,
      score: (a) => { if (a.height >= 195 && a.speed >= 88) return -0.5; if (a.height >= 190 && a.speed >= 90) return -0.3; if (a.height <= 174 && a.speed >= 85) return 0.5; return 0; } },
    // Weak foot penalty: one-footed wonder is predictable
    { keys: ["leftFoot", "rightFoot"], weight: 0.03,
      score: (a) => { const gap = Math.abs(a.leftFoot - a.rightFoot); if (gap <= 5) return 0.3; if (gap <= 12) return 0; if (gap <= 20) return -0.2; return -0.4; } },
  ];

  function pairScore(v1, v2, threshold) {
    const avg = (v1 + v2) / 2;
    if (avg >= threshold + 5 && Math.min(v1, v2) >= threshold) return 1;
    if (avg >= threshold && Math.min(v1, v2) >= threshold - 5) return 0.5;
    if (avg >= threshold - 8) return 0;
    if (avg >= threshold - 15) return -0.3;
    return -0.5;
  }

  function computeSynergyMultiplier(a) {
    let mult = 1;
    const notes = [];
    for (const p of SYNERGY_PAIRS) {
      const sub = p.score(a);
      if (sub === 0) continue;
      mult *= (1 + sub * p.weight);
      if (sub > 0.5) notes.push({ good: true, text: `SYNERGY: ${p.keys.join(" + ")} pairing is elite.` });
      else if (sub < -0.3) notes.push({ good: false, text: `MISMATCH: ${p.keys.join(" + ")} combination works against you.` });
    }
    return { multiplier: clamp(mult, 0.75, 1.22), notes };
  }

  /* --------------------------- HIDDEN TRAITS ---------------------------
   * Discovered during character creation; some are deterministic from the
   * build, others are partially random. They affect age curve, injuries,
   * reputation, transfer likelihood, and match output. */
  const HIDDEN_TRAITS = {
    "Early Bloomer": { desc: "Peaks fast and fades early — a prodigy who burns bright.", type: "age" },
    "Late Bloomer": { desc: "Raw at first, then unstoppable after 27.", type: "age" },
    "Speedster": { desc: "Pace terrorises defenders and unlocks space.", type: "play" },
    "Aerial Threat": { desc: "Wins everything in the air.", type: "play" },
    "Powerhouse": { desc: "Bullies centre-backs and holds up play.", type: "play" },
    "Clinical Finisher": { desc: "Turns half-chances into goals.", type: "play" },
    "Two-Footed": { desc: "No weak foot — unpredictable from any angle.", type: "play" },
    "One-Footed Wonder": { desc: "Devastating on one foot, limited on the other.", type: "play" },
    "Injury Prone": { desc: "The physio room is a second home.", type: "fitness" },
    "Iron Man": { desc: "Plays through knocks and rarely misses a match.", type: "fitness" },
    "Big Game Player": { desc: "Delivers when the lights are brightest.", type: "mentality" },
    "Leader": { desc: "The dressing room follows him.", type: "mentality" },
    "Workhorse": { desc: "Covers every blade of grass.", type: "mentality" },
    "Volatile": { desc: "Genius or disaster — never boring.", type: "mentality" },
    "High Ceiling": { desc: "Raw diamond with superstar potential.", type: "development" },
    "Set-Piece Specialist": { desc: "Free-kicks and penalties are his currency.", type: "play" },
    "Playmaker": { desc: "Sees passes nobody else does.", type: "play" },
    "Goal Poacher": { desc: "Lives where the ball is going to land.", type: "play" },
    "Journeyman": { desc: "Always itching for the next shirt.", type: "career" },
    "One-Club Man": { desc: "Built to become a legend at one club.", type: "career" },
  };
  const TRAIT_TIER_NAMES = { 1: "Bronze", 2: "Silver", 3: "Gold" };
  const TRAIT_TIER_COLORS = { 1: "#cd7f32", 2: "#c0c0c0", 3: "#f5e050" };

  function generateHiddenTraits(a, s) {
    const traits = new Set();
    const bestFoot = Math.max(a.leftFoot, a.rightFoot);
    const worstFoot = Math.min(a.leftFoot, a.rightFoot);

    // Playstyle traits
    if (a.speed >= 90) traits.add("Speedster");
    if (a.heading >= 88 && a.height >= 188) traits.add("Aerial Threat");
    if (a.strength >= 88) traits.add("Powerhouse");
    if (bestFoot >= 92) traits.add("Clinical Finisher");
    if (a.leftFoot >= 80 && a.rightFoot >= 80) traits.add("Two-Footed");
    if (bestFoot - worstFoot >= 25) traits.add("One-Footed Wonder");
    if (bestFoot >= 85 && a.mentalityRating >= 75) traits.add("Set-Piece Specialist");
    if (a.leftFoot >= 85 && a.rightFoot >= 85 && a.speed >= 80) traits.add("Playmaker");
    if (bestFoot >= 85 && a.speed >= 80 && a.heading >= 70) traits.add("Goal Poacher");

    // Fitness traits
    if (a.fitness >= 90) traits.add("Iron Man");
    else if (a.fitness < 65 || rand() < 0.10) traits.add("Injury Prone");

    // Mentality traits
    if (["Big Game Player", "Ice Cold", "Winner", "Talisman"].includes(s.mentality)) traits.add("Big Game Player");
    if (s.mentality === "Leader") traits.add("Leader");
    if (["Relentless", "Determined", "Perfectionist", "Consistent"].includes(s.mentality)) traits.add("Workhorse");
    if (["Maverick", "Mercurial", "Temperamental", "Fearless"].includes(s.mentality)) traits.add("Volatile");

    // Development curve — usually one or none, random otherwise
    if (s.baseRating >= 82 && s.age <= 19) traits.add("High Ceiling");
    const origin = s.player.origin || COUNTRY_ORIGINS["England"];
    const originDev = origin.development || 1.0;
    const earlyThreshold = 0.12 + (originDev - 1) * 0.5; // faster-developing countries lean early bloomer
    const lateThreshold = 0.12;
    if (rand() < earlyThreshold) traits.add("Early Bloomer");
    else if (rand() < lateThreshold) traits.add("Late Bloomer");

    // Country-of-origin bias adds narrative hidden traits
    const bias = origin.bias || "balanced";
    if (bias === "flair" && rand() < 0.15) traits.add("Volatile");
    if (bias === "athletic" && a.speed >= 82 && rand() < 0.15) traits.add("Speedster");
    if (bias === "physical" && a.height >= 185 && rand() < 0.15) traits.add("Aerial Threat");
    if (bias === "workrate" && rand() < 0.15) traits.add("Workhorse");
    if (bias === "tactical" && rand() < 0.10) traits.add("Leader");
    if (bias === "technical" && a.leftFoot >= 75 && a.rightFoot >= 75 && rand() < 0.10) traits.add("Two-Footed");

    // Career trajectory — mutually exclusive-ish
    if (rand() < 0.08) traits.add("Journeyman");
    else if (rand() < 0.08) traits.add("One-Club Man");

    // Saka-style early bloomer override: if high base + young + no late bloomer, lean early
    if (s.baseRating >= 78 && s.age <= 18 && !traits.has("Late Bloomer")) traits.add("Early Bloomer");
    // Vardy-style late bloomer override: if starting rating is modest but finishing/mentality strong
    if (s.baseRating <= 68 && bestFoot >= 80 && s.mentalityRating >= 70 && !traits.has("Early Bloomer")) traits.add("Late Bloomer");

    return [...traits];
  }

  function hasTrait(name) { return state.hiddenTraits && state.hiddenTraits.includes(name); }
  function traitCount() { return state.hiddenTraits ? state.hiddenTraits.length : 0; }
  function getTraitTier(name) { return state.traitProgress && state.traitProgress[name] ? Math.min(3, Math.max(1, state.traitProgress[name].tier || 1)) : 1; }
  function setTraitProgress(name, xp) {
    if (!state.traitProgress) state.traitProgress = {};
    if (!state.traitProgress[name]) state.traitProgress[name] = { xp: 0, tier: 1 };
    state.traitProgress[name].xp += xp;
    // Level up: 100 xp -> tier 2, 300 xp -> tier 3
    if (state.traitProgress[name].xp >= 300) state.traitProgress[name].tier = 3;
    else if (state.traitProgress[name].xp >= 100) state.traitProgress[name].tier = 2;
  }
  function addTrait(name) {
    if (!state.hiddenTraits) state.hiddenTraits = [];
    if (!state.hiddenTraits.includes(name)) {
      state.hiddenTraits.push(name);
      setTraitProgress(name, 0);
      log(`🧬 DNA discovered: ${name}`, "great");
    }
  }
  function upgradeTrait(name, xp) {
    if (hasTrait(name)) {
      const before = getTraitTier(name);
      setTraitProgress(name, xp);
      const after = getTraitTier(name);
      if (after > before) {
        log(`🧬 DNA evolved: ${name} ${TRAIT_TIER_NAMES[before]} → ${TRAIT_TIER_NAMES[after]}`, "great");
      }
    }
  }

  // Career Pillars are removed; getPillar remains as a neutral stub returning 50.
  function getPillar(key) { return 50; }
  function applyPillarEffects(fx) { return; }
  function pillarDescription(key) {
    const map = {
      Ambition: "Drives moves to bigger clubs and contract demands.",
      Loyalty: "Builds fan love, captaincy, and one-club legacy.",
      Professionalism: "Improves training gains and injury resistance.",
      Ego: "Feeds media attention and dressing-room friction.",
      Leadership: "Unlocks captaincy, mentoring, and team rallies.",
      Durability: "Reduces time lost to injuries.",
      KillerInstinct: "Boosts penalties, clutch goals, and Golden Boots.",
      Adaptability: "Helps you thrive under new managers and tactics.",
      Consistency: "Smooths out boom-and-bust seasons.",
      Longevity: "Pushes back retirement age and late decline.",
    };
    return map[key] || "";
  }
  function pillarsHtml() {
    if (!state.pillars) return "";
    const rows = Object.entries(state.pillars).map(([k, v]) => {
      const color = v >= 70 ? "var(--accent)" : v <= 30 ? "var(--bad)" : "var(--gold)";
      return `<div class="pillar-row" title="${esc(pillarDescription(k))}"><span class="pillar-k">${esc(k.replace(/([A-Z])/g, " $1").trim())}</span><div class="pillar-bar"><div class="pillar-fill" style="width:${v}%;background:${color}"></div></div><span class="pillar-v">${v}</span></div>`;
    }).join("");
    return `<div class="pillars-block"><h3>Career Pillars</h3>${rows}</div>`;
  }

  function rollAgent() {
    const pick = weightedRandomPick(AGENT_TIERS.map((t) => ({ item: t, weight: t.weight })));
    const agent = pick || AGENT_TIERS[1];
    state.agent = { key: agent.key, label: agent.label, influence: agent.influence, contractBonus: agent.contractBonus };
    state.wealth = agent.wealth;
    state.fame = Math.floor(agent.wealth / 2);
  }

  // Compute the six radar axes from raw attributes + career state.
  // Aerial blends heading with height; Physical merges strength + fitness;
  // Mental combines the hidden personality rating with the career pillars;
  // Balance & Agility uses the existing derived agility/balance values;
  // Shooting uses the existing derived finishing value.
  function computeRadarValues(attrs) {
    const dv = state.derived || {};
    const pillarValues = state.pillars ? Object.values(state.pillars) : [];
    const avgPillars = pillarValues.length ? pillarValues.reduce((s, v) => s + v, 0) / pillarValues.length : 50;
    const heightCm = attrs.height || 180;
    const heightAerial = clamp((heightCm - 165) / (195 - 165) * 100, 0, 100);
    const agility = dv.agility || attrs.speed || 50;
    const balance = dv.balance || attrs.strength || 50;
    return {
      aerial: attrs.heading * 0.75 + heightAerial * 0.25,
      shooting: dv.finishing || ((attrs.leftFoot + attrs.rightFoot) / 2),
      mental: (state.mentalityRating || 50) * 0.7 + avgPillars * 0.3,
      speed: attrs.speed,
      balanceAgility: (agility + balance) / 2,
      physical: (attrs.strength + attrs.fitness) / 2,
    };
  }

  function drawRadarChart(canvas, attrs) {
    if (!canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 28;
    const values = computeRadarValues(attrs);
    const labels = ["Aerial", "Shooting", "Mental", "Speed", "Balance & Agility", "Physical"];
    const keys = ["aerial", "shooting", "mental", "speed", "balanceAgility", "physical"];
    const n = labels.length;

    // The composite axes (mental, aerial, balance & agility) are more spread out
    // than the old raw attributes, so show 50-100 as the full visual range.
    const radarFloor = 50;
    const radarScale = 50;
    const radarVal = (v) => Math.max(0, Math.min(100, ((clamp(v, 0, 100) - radarFloor) / radarScale) * 100));

    ctx.clearRect(0, 0, w, h);
    // grid rings
    ctx.strokeStyle = "rgba(245, 224, 80, 0.25)";
    ctx.lineWidth = 1;
    for (let r = 1; r <= 4; r++) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const radius = (maxR * r) / 4;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    // axes
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
    }
    ctx.stroke();
    // data polygon
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const val = radarVal(values[keys[i]]);
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = (val / 100) * maxR;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 208, 108, 0.35)";
    ctx.fill();
    ctx.strokeStyle = "#00d06c";
    ctx.lineWidth = 3;
    ctx.stroke();
    // highlight vertices
    for (let i = 0; i < n; i++) {
      const val = radarVal(values[keys[i]]);
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = (val / 100) * maxR;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#f5e050";
      ctx.fill();
    }
    // labels
    ctx.fillStyle = "#f4fff8";
    ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const lx = cx + Math.cos(angle) * (maxR + 18);
      const ly = cy + Math.sin(angle) * (maxR + 18);
      ctx.fillText(labels[i], lx, ly);
    }
  }

  const DIFFICULTIES = {
    easy:       { label: "EASY",       rerolls: 3, hideStats: false, desc: "3 rerolls · all attributes visible" },
    medium:     { label: "MEDIUM",     rerolls: 1, hideStats: false, desc: "1 reroll · all attributes visible" },
    hard:       { label: "HARD",       rerolls: 0, hideStats: false, desc: "0 rerolls · all attributes visible" },
    impossible: { label: "IMPOSSIBLE", rerolls: 0, hideStats: true,  desc: "0 rerolls · names only, no attributes" },
  };

  // Combine the historical database with the 2024/25 and 2025/26 season squads.
  const ALL_PLAYER_DATABASE = { ...PLAYER_DATABASE, ...PLAYER_DATABASE_2025_26 };
  const SQUAD_KEYS = Object.keys(ALL_PLAYER_DATABASE);
  const CLUB_KEYS = Object.keys(CLUB_ACADEMY);

  // Keep a pristine, era-specific copy of the database for "Rating at the Time" mode.
  function cloneDatabase(src) {
    const out = {};
    for (const k of Object.keys(src)) out[k] = src[k].map((p) => ({ ...p }));
    return out;
  }
  const PLAYER_DATABASE_ORIGINAL = cloneDatabase(ALL_PLAYER_DATABASE);

  // Normalise each player to the best version of themselves across all seasons.
  // This powers "Peak Rating" mode: a striker who peaked in 2008 still carries
  // that peak when they appear in a 2004 donor squad.
  function buildPeakDatabase(src) {
    const peak = {};
    const keys = Object.keys(src);
    for (const squad of keys) {
      for (const pl of src[squad]) {
        const best = peak[pl.name];
        if (!best) {
          peak[pl.name] = { ...pl };
          continue;
        }
        best.heading = Math.max(best.heading, pl.heading);
        best.fitness = Math.max(best.fitness, pl.fitness);
        best.strength = Math.max(best.strength, pl.strength);
        best.leftFoot = Math.max(best.leftFoot, pl.leftFoot);
        best.rightFoot = Math.max(best.rightFoot, pl.rightFoot);
        best.speed = Math.max(best.speed, pl.speed);
        best.mentalityRating = Math.max(best.mentalityRating, pl.mentalityRating);
        best.overall = Math.max(best.overall, pl.overall);
        // physical build: keep the "tallest and heaviest" version as the canonical frame
        best.height = Math.max(best.height, pl.height);
        best.weight = Math.max(best.weight, pl.weight);
        // preserve the latest mentality trait if it is special
        if (MENTALITY_TRAITS[pl.mentality]?.special) best.mentality = pl.mentality;
        // keep the highest tier badge
        const tierRank = { "": 0, L: 1, VG: 2, G: 3, E: 4, VG: 2 };
        if ((tierRank[pl.tier] || 0) > (tierRank[best.tier] || 0)) best.tier = pl.tier;
      }
    }
    const out = {};
    for (const squad of keys) {
      out[squad] = src[squad].map((pl) => ({ ...peak[pl.name] }));
    }
    return out;
  }
  const PLAYER_DATABASE_PEAK = buildPeakDatabase(PLAYER_DATABASE_ORIGINAL);

  // Active mode switches in the setup screen.
  const RATING_MODE = { PEAK: "peak", AT_TIME: "at-time" };
  const ERA_OPTIONS = [
    { key: "all", label: "All Eras (1992–2026)", years: [1992, 2026] },
    { key: "classic", label: "Classic Era (1992–2004)", years: [1992, 2004] },
    { key: "modern", label: "Modern Era (2005–2014)", years: [2005, 2014] },
    { key: "recent", label: "Recent Era (2015–2024)", years: [2015, 2024] },
    { key: "current", label: "Current Season (2025–26)", years: [2025, 2025] },
  ];
  const COUNTRY_ORIGINS = {
    "England": { flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", development: 1.0, bias: "balanced", story: "Homegrown under the English rain", intlDifficulty: 3, intlStrength: 84 },
    "Brazil": { flag: "🇧🇷", development: 1.08, bias: "flair", story: "Samba flair, raw street football", intlDifficulty: 8, intlStrength: 89 },
    "Argentina": { flag: "🇦🇷", development: 1.05, bias: "clutch", story: "Warrior mentality from Buenos Aires", intlDifficulty: 8, intlStrength: 88 },
    "France": { flag: "🇫🇷", development: 1.06, bias: "athletic", story: "Elite athletic academy product", intlDifficulty: 6, intlStrength: 88 },
    "Spain": { flag: "🇪🇸", development: 1.06, bias: "technical", story: "La Masia-style technical grounding", intlDifficulty: 6, intlStrength: 86 },
    "Germany": { flag: "🇩🇪", development: 1.05, bias: "workrate", story: "Relentless efficiency and pressing", intlDifficulty: 6, intlStrength: 85 },
    "Portugal": { flag: "🇵🇹", development: 1.04, bias: "flair", story: "Trickery and seaside ambition", intlDifficulty: 3, intlStrength: 83 },
    "Netherlands": { flag: "🇳🇱", development: 1.05, bias: "technical", story: "Total Football upbringing", intlDifficulty: 6, intlStrength: 85 },
    "Italy": { flag: "🇮🇹", development: 1.04, bias: "tactical", story: "Tactical schooling from the boot", intlDifficulty: 6, intlStrength: 85 },
    "Nigeria": { flag: "🇳🇬", development: 1.07, bias: "athletic", story: "Power and pace from West Africa", intlDifficulty: 5, intlStrength: 78 },
    "Ivory Coast": { flag: "🇨🇮", development: 1.06, bias: "athletic", story: "Strength and street football", intlDifficulty: 5, intlStrength: 77 },
    "Norway": { flag: "🇳🇴", development: 1.08, bias: "physical", story: "Viking physique and discipline", intlDifficulty: 4, intlStrength: 78 },
    "Sweden": { flag: "🇸🇪", development: 1.05, bias: "physical", story: "Tall, aerial Scandinavian threat", intlDifficulty: 4, intlStrength: 79 },
    "Belgium": { flag: "🇧🇪", development: 1.05, bias: "technical", story: "Diamond generation technique", intlDifficulty: 3, intlStrength: 84 },
    "Scotland": { flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", development: 1.02, bias: "workrate", story: "Grit from the Glasgow streets", intlDifficulty: 4, intlStrength: 76 },
    "Iran": { flag: "🇮🇷", development: 1.03, bias: "tactical", story: "Asian qualification grinding", intlDifficulty: 2, intlStrength: 76 },
    "Uruguay": { flag: "🇺🇾", development: 1.05, bias: "clutch", story: "Grit from the Río de la Plata", intlDifficulty: 9, intlStrength: 83 },
    "New Zealand": { flag: "🇳🇿", development: 1.03, bias: "physical", story: "Oceania giant in a small pond", intlDifficulty: 1, intlStrength: 72 },
    "San Marino": { flag: "🇸🇲", development: 0.94, bias: "workrate", story: "Underdog spirit in Europe's basement", intlDifficulty: 10, intlStrength: 48 },
    "Croatia": { flag: "🇭🇷", development: 1.05, bias: "technical", story: "Adriatic technique and fighting spirit", intlDifficulty: 6, intlStrength: 85 },
    "Denmark": { flag: "🇩🇰", development: 1.04, bias: "tactical", story: "Nordic organisation and team ethic", intlDifficulty: 4, intlStrength: 80 },
    "Poland": { flag: "🇵🇱", development: 1.03, bias: "physical", story: "Eastern European power and aerial threat", intlDifficulty: 4, intlStrength: 78 },
    "Serbia": { flag: "🇷🇸", development: 1.04, bias: "technical", story: "Balkan flair and stubborn mentality", intlDifficulty: 5, intlStrength: 79 },
    "Switzerland": { flag: "🇨🇭", development: 1.04, bias: "tactical", story: "Alpine efficiency and discipline", intlDifficulty: 4, intlStrength: 80 },
    "Colombia": { flag: "🇨🇴", development: 1.06, bias: "flair", story: "South American rhythm and passion", intlDifficulty: 6, intlStrength: 81 },
    "Mexico": { flag: "🇲🇽", development: 1.04, bias: "technical", story: "CONCACAF pedigree and heart", intlDifficulty: 3, intlStrength: 79 },
    "USA": { flag: "🇺🇸", development: 1.05, bias: "athletic", story: "Rising athletic program on the world stage", intlDifficulty: 3, intlStrength: 78 },
    "Japan": { flag: "🇯🇵", development: 1.05, bias: "tactical", story: "Asian discipline and technical precision", intlDifficulty: 3, intlStrength: 79 },
    "South Korea": { flag: "🇰🇷", development: 1.05, bias: "workrate", story: "Relentless Asian dynamism", intlDifficulty: 3, intlStrength: 78 },
    "Egypt": { flag: "🇪🇬", development: 1.04, bias: "flair", story: "North African skill and pride", intlDifficulty: 3, intlStrength: 77 },
    "Senegal": { flag: "🇸🇳", development: 1.06, bias: "athletic", story: "West African pace and power", intlDifficulty: 4, intlStrength: 79 },
    "Morocco": { flag: "🇲🇦", development: 1.05, bias: "tactical", story: "North African grit and tactical nous", intlDifficulty: 4, intlStrength: 80 },
    "Tunisia": { flag: "🇹🇳", development: 1.03, bias: "workrate", story: "North African resilience and craft", intlDifficulty: 3, intlStrength: 75 },
    "Australia": { flag: "🇦🇺", development: 1.04, bias: "physical", story: "Socceroos fighting spirit from down under", intlDifficulty: 2, intlStrength: 76 },
    "Ukraine": { flag: "🇺🇦", development: 1.03, bias: "technical", story: "Eastern European technique and resilience", intlDifficulty: 4, intlStrength: 77 },
    "Czech Republic": { flag: "🇨🇿", development: 1.03, bias: "tactical", story: "Central European footballing tradition", intlDifficulty: 4, intlStrength: 78 },
    "Austria": { flag: "🇦🇹", development: 1.03, bias: "tactical", story: "Alpine discipline and emerging quality", intlDifficulty: 4, intlStrength: 77 },
    "Turkey": { flag: "🇹🇷", development: 1.04, bias: "flair", story: "Passionate football culture bridging continents", intlDifficulty: 4, intlStrength: 78 },
    "Wales": { flag: "🏴󠁧󠁢󠁷󠁬󠁳󠁿", development: 1.02, bias: "workrate", story: "Dragon-hearted underdog from the British Isles", intlDifficulty: 3, intlStrength: 75 },
    "Republic of Ireland": { flag: "🇮🇪", development: 1.02, bias: "workrate", story: "Green army grit and island pride", intlDifficulty: 3, intlStrength: 74 },
    "Northern Ireland": { flag: "🏴󠁧󠁢󠁮󠁩󠁲󠁿", development: 1.01, bias: "workrate", story: "Small nation, huge heart", intlDifficulty: 2, intlStrength: 72 },
    "Iceland": { flag: "🇮🇸", development: 1.02, bias: "physical", story: "Viking thunderclap and unity", intlDifficulty: 2, intlStrength: 73 },
    "Ghana": { flag: "🇬🇭", development: 1.06, bias: "athletic", story: "West African Black Stars power", intlDifficulty: 4, intlStrength: 78 },
    "Cameroon": { flag: "🇨🇲", development: 1.05, bias: "athletic", story: "Indomitable Lions physicality", intlDifficulty: 4, intlStrength: 77 },
    "Algeria": { flag: "🇩🇿", development: 1.04, bias: "flair", story: "North African technical quality", intlDifficulty: 4, intlStrength: 77 },
    "Chile": { flag: "🇨🇱", development: 1.05, bias: "clutch", story: "Andean warrior mentality", intlDifficulty: 6, intlStrength: 80 },
    "Ecuador": { flag: "🇪🇨", development: 1.05, bias: "athletic", story: "High-altitude South American athleticism", intlDifficulty: 5, intlStrength: 78 },
    "Canada": { flag: "🇨🇦", development: 1.04, bias: "athletic", story: "North American rapid rise", intlDifficulty: 2, intlStrength: 75 },
    "Paraguay": { flag: "🇵🇾", development: 1.04, bias: "workrate", story: "Guaraní fight and defensive steel", intlDifficulty: 5, intlStrength: 76 },
    "Peru": { flag: "🇵🇪", development: 1.03, bias: "technical", story: "Inca technique and passion", intlDifficulty: 4, intlStrength: 76 },
    "Venezuela": { flag: "🇻🇪", development: 1.03, bias: "flair", story: "Vinotinto emerging passion", intlDifficulty: 3, intlStrength: 74 },
    "Bolivia": { flag: "🇧🇴", development: 1.02, bias: "physical", story: "High-altitude battlers", intlDifficulty: 3, intlStrength: 72 },
    "Greece": { flag: "🇬🇷", development: 1.02, bias: "tactical", story: "Mediterranean tactical discipline", intlDifficulty: 4, intlStrength: 76 },
    "Romania": { flag: "🇷🇴", development: 1.02, bias: "technical", story: "Eastern European technical flair", intlDifficulty: 3, intlStrength: 75 },
    "Bulgaria": { flag: "🇧🇬", development: 1.01, bias: "technical", story: "Balkan technical tradition", intlDifficulty: 3, intlStrength: 74 },
    "Finland": { flag: "🇫🇮", development: 1.02, bias: "physical", story: "Nordic resilience and quiet quality", intlDifficulty: 2, intlStrength: 73 },
    "Hungary": { flag: "🇭🇺", development: 1.02, bias: "tactical", story: "Central European football heritage", intlDifficulty: 3, intlStrength: 75 },
    "Mali": { flag: "🇲🇱", development: 1.06, bias: "athletic", story: "West African emerging powerhouse", intlDifficulty: 3, intlStrength: 76 },
    "South Africa": { flag: "🇿🇦", development: 1.03, bias: "athletic", story: "Bafana Bafana pace and promise", intlDifficulty: 2, intlStrength: 74 },
    "Jamaica": { flag: "🇯🇲", development: 1.04, bias: "athletic", story: "Caribbean pace and spirit", intlDifficulty: 1, intlStrength: 72 },
    "Panama": { flag: "🇵🇦", development: 1.02, bias: "workrate", story: "Central American grit", intlDifficulty: 1, intlStrength: 71 },
    "Costa Rica": { flag: "🇨🇷", development: 1.03, bias: "tactical", story: "Tico defensive unity", intlDifficulty: 2, intlStrength: 74 },
    "Saudi Arabia": { flag: "🇸🇦", development: 1.03, bias: "flair", story: "Middle Eastern rising investment", intlDifficulty: 2, intlStrength: 75 },
    "Qatar": { flag: "🇶🇦", development: 1.02, bias: "flair", story: "Gulf state hosting ambition", intlDifficulty: 1, intlStrength: 72 },
    "India": { flag: "🇮🇳", development: 1.02, bias: "workrate", story: "South Asian giant awakening", intlDifficulty: 1, intlStrength: 70 },
    "China": { flag: "🇨🇳", development: 1.03, bias: "tactical", story: "Eastern Asian disciplined rise", intlDifficulty: 1, intlStrength: 73 },
    "Russia": { flag: "🇷🇺", development: 1.03, bias: "physical", story: "Eastern European physical power", intlDifficulty: 3, intlStrength: 77 },
    "Slovakia": { flag: "🇸🇰", development: 1.02, bias: "tactical", story: "Central European organisation", intlDifficulty: 3, intlStrength: 75 },
    "Slovenia": { flag: "🇸🇮", development: 1.02, bias: "tactical", story: "Small Alpine nation, big quality", intlDifficulty: 2, intlStrength: 74 },
    "Bosnia & Herzegovina": { flag: "🇧🇦", development: 1.03, bias: "technical", story: "Balkan technical fight", intlDifficulty: 3, intlStrength: 75 },
    "North Macedonia": { flag: "🇲🇰", development: 1.01, bias: "workrate", story: "Balkan underdog spirit", intlDifficulty: 2, intlStrength: 73 },
    "Albania": { flag: "🇦🇱", development: 1.01, bias: "workrate", story: "Adriatic passion and pride", intlDifficulty: 2, intlStrength: 72 },
    "Kosovo": { flag: "🇽🇰", development: 1.02, bias: "flair", story: "Balkan new nation energy", intlDifficulty: 1, intlStrength: 71 },
    "Montenegro": { flag: "🇲🇪", development: 1.02, bias: "technical", story: "Adriatic technical quality", intlDifficulty: 2, intlStrength: 73 },
    "Georgia": { flag: "🇬🇪", development: 1.03, bias: "flair", story: "Caucasus rising flair", intlDifficulty: 2, intlStrength: 74 },
    "Armenia": { flag: "🇦🇲", development: 1.01, bias: "workrate", story: "Caucasus fighting spirit", intlDifficulty: 1, intlStrength: 71 },
    "Azerbaijan": { flag: "🇦🇿", development: 1.00, bias: "workrate", story: "Caucasus development project", intlDifficulty: 1, intlStrength: 70 },
    "Kazakhstan": { flag: "🇰🇿", development: 1.00, bias: "physical", story: "Steppe physicality", intlDifficulty: 1, intlStrength: 70 },
    "Uzbekistan": { flag: "🇺🇿", development: 1.02, bias: "tactical", story: "Central Asian rising organisation", intlDifficulty: 1, intlStrength: 72 },
    "Thailand": { flag: "🇹🇭", development: 1.02, bias: "flair", story: "Southeast Asian technical energy", intlDifficulty: 1, intlStrength: 71 },
    "Vietnam": { flag: "🇻🇳", development: 1.02, bias: "workrate", story: "Southeast Asian fighting spirit", intlDifficulty: 1, intlStrength: 71 },
    "Malaysia": { flag: "🇲🇾", development: 1.01, bias: "workrate", story: "Southeast Asian development", intlDifficulty: 1, intlStrength: 70 },
    "Indonesia": { flag: "🇮🇩", development: 1.02, bias: "flair", story: "Southeast Asian giant potential", intlDifficulty: 1, intlStrength: 71 },
    "Philippines": { flag: "🇵🇭", development: 1.01, bias: "workrate", story: "Southeast Asian passion", intlDifficulty: 1, intlStrength: 70 },
    "Syria": { flag: "🇸🇾", development: 1.00, bias: "workrate", story: "War-torn football resilience", intlDifficulty: 1, intlStrength: 70 },
    "Lebanon": { flag: "🇱🇧", development: 1.00, bias: "workrate", story: "Middle Eastern resilience", intlDifficulty: 1, intlStrength: 70 },
    "Iraq": { flag: "🇮🇶", development: 1.01, bias: "workrate", story: "Middle Eastern fighting spirit", intlDifficulty: 1, intlStrength: 71 },
    "Jordan": { flag: "🇯🇴", development: 1.00, bias: "tactical", story: "Middle Eastern organisation", intlDifficulty: 1, intlStrength: 70 },
    "Oman": { flag: "🇴🇲", development: 1.00, bias: "workrate", story: "Gulf state work ethic", intlDifficulty: 1, intlStrength: 70 },
    "Kuwait": { flag: "🇰🇼", development: 1.00, bias: "flair", story: "Gulf football heritage", intlDifficulty: 1, intlStrength: 70 },
    "Bahrain": { flag: "🇧🇭", development: 1.00, bias: "workrate", story: "Gulf island battlers", intlDifficulty: 1, intlStrength: 70 },
    "UAE": { flag: "🇦🇪", development: 1.02, bias: "flair", story: "Gulf state rising quality", intlDifficulty: 1, intlStrength: 72 },
    "Israel": { flag: "🇮🇱", development: 1.02, bias: "tactical", story: "Middle Eastern technical tradition", intlDifficulty: 2, intlStrength: 74 },
    "Cyprus": { flag: "🇨🇾", development: 1.00, bias: "workrate", story: "Mediterranean island spirit", intlDifficulty: 1, intlStrength: 70 },
    "Luxembourg": { flag: "🇱🇺", development: 1.00, bias: "workrate", story: "Small European nation on the rise", intlDifficulty: 1, intlStrength: 70 },
    "Malta": { flag: "🇲🇹", development: 0.99, bias: "workrate", story: "Mediterranean underdog", intlDifficulty: 1, intlStrength: 68 },
    "Liechtenstein": { flag: "🇱🇮", development: 0.98, bias: "workrate", story: "Tiny Alpine minnow", intlDifficulty: 1, intlStrength: 66 },
    "Andorra": { flag: "🇦🇩", development: 0.97, bias: "workrate", story: "Pyrenean football minnow", intlDifficulty: 1, intlStrength: 65 },
    "Gibraltar": { flag: "🇬🇮", development: 0.97, bias: "workrate", story: "Rock-solid underdogs", intlDifficulty: 1, intlStrength: 64 },
    "Faroe Islands": { flag: "🇫🇴", development: 0.98, bias: "physical", story: "North Atlantic warriors", intlDifficulty: 1, intlStrength: 67 },
    "Estonia": { flag: "🇪🇪", development: 1.00, bias: "workrate", story: "Baltic resilience", intlDifficulty: 1, intlStrength: 70 },
    "Latvia": { flag: "🇱🇻", development: 1.00, bias: "workrate", story: "Baltic fighting spirit", intlDifficulty: 1, intlStrength: 70 },
    "Lithuania": { flag: "🇱🇹", development: 1.00, bias: "workrate", story: "Baltic determination", intlDifficulty: 1, intlStrength: 70 },
    "Moldova": { flag: "🇲🇩", development: 0.99, bias: "workrate", story: "Eastern European underdog", intlDifficulty: 1, intlStrength: 69 },
    "Belarus": { flag: "🇧🇾", development: 1.00, bias: "physical", story: "Eastern European physicality", intlDifficulty: 1, intlStrength: 70 },
    "Zimbabwe": { flag: "🇿🇼", development: 1.02, bias: "athletic", story: "Southern African warriors", intlDifficulty: 1, intlStrength: 71 },
    "Zambia": { flag: "🇿🇲", development: 1.02, bias: "athletic", story: "Copperbelt athleticism", intlDifficulty: 1, intlStrength: 71 },
    "Kenya": { flag: "🇰🇪", development: 1.02, bias: "athletic", story: "East African pace and stamina", intlDifficulty: 1, intlStrength: 71 },
  };

  const CONFEDERATIONS = {
    CONMEBOL: ["Brazil", "Argentina", "Uruguay", "Colombia", "Chile", "Ecuador", "Paraguay", "Peru", "Venezuela", "Bolivia"],
    CAF: ["Nigeria", "Ivory Coast", "Ghana", "Cameroon", "Algeria", "Senegal", "Morocco", "Tunisia", "Egypt", "South Africa", "Mali", "Zimbabwe", "Zambia", "Kenya"],
    AFC: ["Iran", "Japan", "South Korea", "Australia", "Saudi Arabia", "Qatar", "China", "India", "Uzbekistan", "Thailand", "Vietnam", "Malaysia", "Indonesia", "Philippines", "Syria", "Lebanon", "Iraq", "Jordan", "Oman", "Kuwait", "Bahrain", "UAE"],
    CONCACAF: ["Mexico", "USA", "Canada", "Jamaica", "Panama", "Costa Rica"],
    OFC: ["New Zealand"],
  };
  const COUNTRY_CONFEDERATION = {};
  for (const [conf, list] of Object.entries(CONFEDERATIONS)) {
    for (const c of list) COUNTRY_CONFEDERATION[c] = conf;
  }
  function getCountryConfederation(country) { return COUNTRY_CONFEDERATION[country] || "UEFA"; }

  function getEraSquadKeys(eraKey) {
    const era = ERA_OPTIONS.find((e) => e.key === eraKey) || ERA_OPTIONS[0];
    const [min, max] = era.years;
    return SQUAD_KEYS.filter((k) => {
      const y = parseSquadKey(k).year;
      return y >= min && y <= max;
    });
  }
  function getPlayerDatabase(mode) {
    return mode === RATING_MODE.AT_TIME ? PLAYER_DATABASE_ORIGINAL : PLAYER_DATABASE_PEAK;
  }
  let activePlayerDatabase = PLAYER_DATABASE_PEAK;
  function setRatingMode(mode) {
    activePlayerDatabase = getPlayerDatabase(mode);
  }
  // Premier League tiers are stored as 4 prestige bands on TEAM_DATABASE
  // (Elite/Europe/Mid/Lower) but together they form ONE 20-club division.
  // Championship is a second, dynamic 24-club division. Both memberships can
  // change at runtime via promotion/relegation (see LEAGUE PYRAMID section),
  // so these must be computed fresh from TEAM_DATABASE rather than cached
  // once at module load — otherwise promoted/relegated clubs would never
  // actually move fixture pools.
  const PL_TIERS = ["Elite", "Europe", "Mid", "Lower"];
  const FOREIGN_LEAGUE_KEYS = ["LaLiga", "SerieA", "Bundesliga", "Saudi", "MLS"];
  // English pyramid tier order (top → bottom) used for promotion/relegation logic.
  const ENGLISH_PYRAMID = ["PL", "Championship", "League1", "League2", "NationalLeague"];
  const ALL_CLUBS = Object.keys(TEAM_DATABASE);
  function getPLLeagueClubs() {
    return ALL_CLUBS.filter((c) => PL_TIERS.includes(TEAM_DATABASE[c].league));
  }
  function getChampionshipClubs() {
    return ALL_CLUBS.filter((c) => TEAM_DATABASE[c].league === "Championship");
  }
  function getLeague1Clubs() {
    return ALL_CLUBS.filter((c) => TEAM_DATABASE[c].league === "League1");
  }
  function getLeague2Clubs() {
    return ALL_CLUBS.filter((c) => TEAM_DATABASE[c].league === "League2");
  }
  function getNationalLeagueClubs() {
    return ALL_CLUBS.filter((c) => TEAM_DATABASE[c].league === "NationalLeague");
  }
  function getForeignLeagueClubs() {
    return ALL_CLUBS.filter((c) => FOREIGN_LEAGUE_KEYS.includes(TEAM_DATABASE[c].league));
  }
  function getClubLeague(club) {
    return (TEAM_DATABASE[club] || {}).league;
  }
  function getLeagueClubs(club) {
    const league = getClubLeague(club);
    if (league === "Championship") return getChampionshipClubs();
    if (league === "League1") return getLeague1Clubs();
    if (league === "League2") return getLeague2Clubs();
    if (league === "NationalLeague") return getNationalLeagueClubs();
    if (FOREIGN_LEAGUE_KEYS.includes(league)) return FOREIGN_LEAGUES[league] || [club];
    return getPLLeagueClubs();
  }

  /* ------------------------------ STATE --------------------------------- */
  let state = null;

  function freshState() {
    return {
      // setup
      era: "all",
      ratingMode: RATING_MODE.PEAK,
      country: "England",
      seed: null,
      rngState: null,
      // genesis
      difficulty: "easy",
      synergyMultiplier: 1,
      phase: "country", // country -> build -> attributes -> academy
      rerolls: LEVERS.startRerolls,
      currentSpin: null, // { squadKey, team, year } or club/build/country spin
      chosenAttr: null,
      selectedDonorIdx: null,
      pendingClub: null,  // club selected from offers on confirm screen
      clubOffers: [],     // generated club offers for confirm screen
      player: { name: "Your Striker", slots: {}, usedDonors: [], position: null, build: null, origin: null, academy: null },
      academy: null, // { club, tier }
      // compiled
      attrs: null, mentality: null, mentalityRating: 60, playstyle: null,
      potentialRating: 50, determination: 50, longevity: 50, injuryRating: 50,
      baseRating: 0, synergyNotes: [], mutationNotes: [], derived: null, derivedBonuses: { agility: 0, balance: 0 }, hiddenTraits: [], traitProgress: {},
      position: "ST", contractYears: 0, contractSignedAt: 0, contractEndSeason: 0, contractRole: null,
      retireNow: false, agent: null, wealth: 0, fame: 0,
      // career
      season: 0, age: LEVERS.debutAge, club: null, role: "Rotation",
      reputation: 20, reputationTier: "Unknown",
      totalGoals: 0, totalApps: 0, totalAssists: 0, leagueGoals: 0, cupGoals: 0, europeGoals: 0,
      totalYellow: 0, totalRed: 0, teamCleanSheets: 0,
      careerLog: [], flags: {}, cooldowns: {}, pendingCarryOver: [],
      bioMoments: [], bioClosing: null,
      yearsAtClub: 0, injuryProneSeasons: 0, milestonesHit: {}, pillarMilestones: {},
      intlCaps: 0, intlGoals: 0, intlDebut: false, intlCaptain: false, intlRetired: false, intlTrait: "balanced",
      injuryProneness: 50, retirementAge: 40, luck: 0, injuryCount: 0,
      seasonHistory: [], retired: false, bestRating: 0,
      clubsPlayed: new Set(), clubStats: {}, lastPerformanceTier: "Met Expectation",
      honours: {
        leagueTitles: 0, domesticCups: 0, europeanCups: 0, intlTrophies: 0,
        goldenBoots: 0, ballonDors: 0, playerOfSeason: 0, youngPlayer: 0, tots: 0,
      },
      competitionHistory: [],
      leagueTable: null,
      leagueStandings: null,
      pendingTransfer: false,
      endCareerReason: null,
      endOfCareerTriggered: false,
      finalSeasonForced: false,
      finalSeason: null,
      // Loan system: null when not out on loan, otherwise
      // { parentClub, parentRole, parentYearsAtClub, dueBackSeason }.
      loan: null,
    };
  }

  /* ------------------------------ UTILS --------------------------------- */
  function hashSeed(input) {
    let h = 2166136261;
    const s = String(input || Date.now());
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function setSeed(seed) {
    if (!state) return;
    state.seed = seed || `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    state.rngState = hashSeed(state.seed) || 1;
  }
  function rand() {
    if (!state || state.rngState == null) return Math.random();
    let x = state.rngState >>> 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    state.rngState = x >>> 0;
    return (state.rngState || 1) / 4294967296;
  }
  function randInt(min, max) { if (min > max) { const t = min; min = max; max = t; } return Math.floor(rand() * (max - min + 1)) + min; }
  function randomBetween(min, max) { return rand() * (max - min) + min; }
  function randBetween(min, max) { return randomBetween(min, max); }
  function choice(arr) { if (!arr || !arr.length) return undefined; return arr[Math.floor(rand() * arr.length)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function poissonRandom(lambda) {
    if (lambda <= 0) return 0;
    // Cap lambda to avoid underflow of Math.exp(-lambda) and infinite loops.
    if (lambda > 700) lambda = 700;
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do {
      k++;
      p *= rand();
      // Hard safety cap: if L underflows to 0, p will always be > 0 and we'd loop forever.
      if (L <= 0 || k > 10000) return Math.round(lambda);
    } while (p > L);
    return k - 1;
  }
  function weightedRandomPick(items) {
    const total = items.reduce((s, i) => s + i.weight, 0);
    if (total <= 0) return null;
    let r = rand() * total;
    for (const i of items) { r -= i.weight; if (r <= 0) return i.item; }
    return items[items.length - 1].item;
  }
  function academyDisplay(name) { return name ? String(name).replace(/_/g, " ") : "—"; }
  function parseSquadKey(key) {
    const m = key.match(/^(.*) \((\d{4})\)$/);
    return m ? { team: m[1], year: parseInt(m[2], 10) } : { team: key, year: 0 };
  }
  function mentTag(trait) { return (MENTALITY_TRAITS[trait] || {}).tag || "neutral"; }
  function mentIsSpecial(trait) { return !!(MENTALITY_TRAITS[trait] || {}).special; }

  /* --------------------------- SAVE SYSTEM ------------------------------ */
  const SAVE_KEY = "football-dna-save";
  const SAVE_VERSION = 2;

  function normalizeContractState(s) {
    if (!s || typeof s !== "object") return migrateState({});
    s.contractYears = Math.max(0, Number.isFinite(Number(s.contractYears)) ? Number(s.contractYears) : 0);
    if (s.contractYears === 0 && s.contractRole == null && s.role) s.contractRole = s.role;
    s.contractForceStays = Number.isFinite(Number(s.contractForceStays)) ? Number(s.contractForceStays) : 0;
    s.contractEndSeason = Number.isFinite(Number(s.contractEndSeason)) ? Number(s.contractEndSeason) : s.contractSignedAt + s.contractYears;
    return s;
  }
  function migrateState(raw) {
    const base = freshState();
    const s = Object.assign({}, base, raw || {});
    s.player = Object.assign({}, base.player, raw && raw.player ? raw.player : {});
    s.player.slots = s.player.slots || {};
    s.player.usedDonors = Array.isArray(s.player.usedDonors) ? s.player.usedDonors : [];
    s.honours = Object.assign({}, base.honours, raw && raw.honours ? raw.honours : {});
    s.flags = s.flags || {};
    s.cooldowns = s.cooldowns || {};
    s.clubStats = s.clubStats || {};
    s.milestonesHit = s.milestonesHit || {};
    s.pillarMilestones = s.pillarMilestones || {};
    s.pillars = null; // pillars removed from gameplay
    s.pendingCarryOver = Array.isArray(s.pendingCarryOver) ? s.pendingCarryOver : [];
    s.seasonHistory = Array.isArray(s.seasonHistory) ? s.seasonHistory : [];
    s.competitionHistory = Array.isArray(s.competitionHistory) ? s.competitionHistory : [];
    s.careerLog = Array.isArray(s.careerLog) ? s.careerLog : [];
    s.bioMoments = Array.isArray(s.bioMoments) ? s.bioMoments : [];
    if (typeof s.injuryCount !== "number") s.injuryCount = 0;
    if (!s.derivedBonuses || typeof s.derivedBonuses !== "object") s.derivedBonuses = { agility: 0, balance: 0 };
    if (!s.intlTrait || !["balanced", "nationalistic", "icon"].includes(s.intlTrait)) s.intlTrait = "balanced";
    if (!s.leagueStandings || typeof s.leagueStandings !== "object") s.leagueStandings = null;
    if (s.intlRetired == null) s.intlRetired = false;
    s.clubsPlayed = s.clubsPlayed instanceof Set ? s.clubsPlayed : new Set(Array.isArray(s.clubsPlayed) ? s.clubsPlayed : []);
    if (!s.seed) s.seed = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    if (s.rngState == null) s.rngState = hashSeed(s.seed) || 1;
    if (!POSITIONS[s.position]) s.position = s.player.position || "ST";
    if (!["country", "build", "attributes"].includes(s.phase)) s.phase = s.attrs ? "attributes" : "country";
    return normalizeContractState(s);
  }
  function serializeState(s) {
    const copy = Object.assign({}, s);
    copy.clubsPlayed = [...(s.clubsPlayed || [])];
    return JSON.stringify({ version: SAVE_VERSION, state: copy });
  }

  function deserializeState(json) {
    try {
      const wrapped = JSON.parse(json);
      return migrateState(wrapped && (wrapped.state || wrapped));
    } catch (e) {
      console.warn("Deserialize failed:", e);
      return migrateState({});
    }
  }

  function saveState() {
    if (!state) return;
    try { localStorage.setItem(SAVE_KEY, serializeState(state)); }
    catch (e) { console.warn("Save failed:", e); }
  }

  function loadSavedState() {
    try {
      const json = localStorage.getItem(SAVE_KEY);
      if (!json) return null;
      return deserializeState(json);
    } catch (e) { console.warn("Load failed:", e); return null; }
  }

  function hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  function renderCareerLog() {
    const wrap = document.getElementById("career-log");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!state || !state.careerLog) return;
    state.careerLog.forEach((entry) => {
      const div = document.createElement("div");
      div.className = "log-entry " + (entry.cls || "");
      div.textContent = entry.text;
      wrap.appendChild(div);
    });
  }

  function resumeGame() {
    const loaded = loadSavedState();
    if (!loaded) { showScreen("screen-welcome"); return; }
    state = loaded;
    setRatingMode(state.ratingMode || RATING_MODE.PEAK);
    renderCareerLog();
    if (state.retired) {
      endCareer(state.totalGoals >= LEVERS.goalTarget);
    } else if (state.endCareerReason) {
      showScreen("screen-career");
      renderCareerHeader();
      beginRetirement(state.endCareerReason);
    } else if (state.season > 0) {
      showScreen("screen-career");
      renderCareerHeader();
      document.getElementById("season-result").innerHTML = "";
      renderSeasonReady();
    } else if (state.attrs) {
      showScreen("screen-confirm");
      renderConfirm();
    } else {
      showScreen("screen-genesis");
      beginTurn();
    }
  }

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ============================ SETUP ================================= */
  function startCreation(difficulty) {
    clearSave();
    resetTeamDatabase();
    state = freshState();
    setSeed();
    state.difficulty = difficulty || "easy";
    const cfg = DIFFICULTIES[state.difficulty];
    state.rerolls = cfg.rerolls;
    showScreen("screen-setup");
  }

  function beginSetup() {
    const era = document.querySelector('input[name="setup-era"]:checked')?.value || "all";
    const mode = document.querySelector('input[name="setup-mode"]:checked')?.value || RATING_MODE.PEAK;
    state.era = era;
    state.ratingMode = mode;
    state.country = null;
    state.player.origin = null;
    setRatingMode(mode);
    showScreen("screen-genesis");
    beginTurn();
  }

  /* ============================ GENESIS ================================= */

  function setBtn(id, show) {
    const b = document.getElementById(id);
    b.style.display = show ? "inline-block" : "none";
    b.disabled = !show;
    const mobile = document.getElementById(id + "-mobile");
    if (mobile) {
      mobile.style.display = show ? "flex" : "none";
      mobile.disabled = !show;
    }
  }

  const COUNTRY_KEYS = Object.keys(COUNTRY_ORIGINS);

  function beginTurn() {
    state.currentSpin = null;
    state.chosenAttr = null;
    state.selectedDonorIdx = null;
    const phase = state.phase;
    const phaseLabels = {
      country: ["Country of Origin", "Roll where your striker was born."],
      build: ["Academy, Build & Position", "Roll your academy club, height/weight and primary position in one go."],
      attributes: ["Roll a Squad", "Spin to draw a random squad & era, then choose which attribute to draft from it."],
    };
    const [title, desc] = phaseLabels[phase] || phaseLabels.attributes;
    document.getElementById("attr-name").textContent = title;
    document.getElementById("attr-desc").textContent = desc;

    const done = DRAFT_ATTRS.length - remainingAttrs().length;
    const counter = phase === "attributes" ? `Attribute ${done + 1} of ${DRAFT_ATTRS.length}` :
      phase === "country" ? "Country" : "Build";
    document.getElementById("roll-counter").textContent = counter;
    document.getElementById("reroll-count").textContent = state.rerolls;

    const action = phase === "country" ? "roll a country" : phase === "build" ? "roll your build" : "draw a squad";
    document.getElementById("roll-result").innerHTML =
      `<div class="placeholder">Press <strong>SPIN</strong> to ${action}.</div>`;
    setBtn("btn-spin", true);
    setBtn("btn-accept", false);
    setBtn("btn-reroll", false);
    renderPreview();
  }

  function spinBoard(leftLabel, leftValue, rightLabel, rightValue, spinning) {
    return `<div class="spin-board${spinning ? " spinning" : ""}">
      <div class="spin-labels"><div class="spin-label">${esc(leftLabel)}</div><div class="spin-label">${esc(rightLabel)}</div></div>
      <div class="spin-boxes"><div class="spin-box">${esc(leftValue || "")}</div><div class="spin-x">×</div><div class="spin-box accented">${esc(rightValue || "")}</div></div>
    </div>`;
  }
  function playRollTick() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(420, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch (e) { /* ignore audio failures */ }
  }

  function spin() {
    document.getElementById("btn-spin").disabled = true;
    if (state.phase !== "attributes") playRollTick();
    const target = document.getElementById("roll-result");
    const phase = state.phase;
    let ticks = 0;
    const totalTicks = 16;
    const iv = setInterval(() => {
      if (phase !== "attributes") playRollTick();
      if (phase === "country") {
        const c = choice(COUNTRY_KEYS);
        const o = COUNTRY_ORIGINS[c];
        target.innerHTML = spinBoard("Country", `${o.flag} ${c}`, "Origin", o.bias || "rolled", true);
      } else if (phase === "build") {
        const c = choice(CLUB_KEYS);
        target.innerHTML = spinBoard("Club", c, "Academy", CLUB_ACADEMY[c], true);
      } else {
        const { team, year } = parseSquadKey(choice(getEraSquadKeys(state.era)));
        target.innerHTML = spinBoard("Club", team, "Season", year, true);
      }
      if (++ticks >= totalTicks) {
        clearInterval(iv);
        if (phase === "country") landCountry();
        else if (phase === "build") landBuild();
        else landSquad();
      }
    }, 80);
  }

  /* ---- country roll ---- */
  function landCountry() {
    const country = choice(COUNTRY_KEYS);
    const origin = COUNTRY_ORIGINS[country];
    state.currentSpin = { country, origin };
    document.getElementById("roll-result").innerHTML = `
      <div class="roll-landed">🌍 Born in <strong>${origin.flag} ${esc(country)}</strong></div>
      <div class="academy-card" style="text-align:center">
        <div class="academy-flavor">${esc(origin.story)}</div>
        <div class="academy-tier">Development speed ${(origin.development * 100).toFixed(0)}%</div>
      </div>
      <div class="chooser-label">Accept this birthplace, or reroll for a different origin.</div>`;
    setBtn("btn-spin", false);
    setBtn("btn-accept", true);
    setBtn("btn-reroll", state.rerolls > 0);
  }

  /* ---- merged build roll: academy + position + build ---- */
  function rollPosition() { return choice(POSITION_KEYS); }
  function rollBuild() {
    const height = randInt(168, 196);
    const weight = clamp(Math.round((height - 100) * 0.9 + randInt(-6, 10)), 64, 98);
    return { height, weight };
  }
  function landBuild() {
    const club = choice(CLUB_KEYS);
    const tier = CLUB_ACADEMY[club];
    const position = rollPosition();
    const build = rollBuild();
    state.currentSpin = { club, tier, position, build };
    const info = ACADEMY_TIERS[tier] || {};
    document.getElementById("roll-result").innerHTML = `
      <div class="roll-landed">🎓 <strong>${esc(club)}</strong> · ${tier} academy</div>
      <div class="academy-card tier-${tier.replace(/\s/g, "")}">
        <div class="academy-flavor">${esc(info.flavor || "")}</div>
      </div>
      <div class="roll-landed" style="margin-top:10px">${(POSITIONS[position] || POSITIONS.ST).label} · ${build.height}cm · ${build.weight}kg</div>
      <div class="chooser-label">Accept this academy, position and build, or reroll the lot.</div>`;
    setBtn("btn-spin", false);
    setBtn("btn-accept", true);
    setBtn("btn-reroll", state.rerolls > 0);
  }

  function remainingAttrs() {
    return DRAFT_ATTRS.filter((a) => !state.player.slots[a.key]);
  }

  /* ---- attribute squad roll ---- */
  function landSquad() {
    const squadKey = choice(getEraSquadKeys(state.era));
    const { team, year } = parseSquadKey(squadKey);
    state.currentSpin = { squadKey, team, year, awaitingContinue: true };
    document.getElementById("roll-result").innerHTML = `
      <div class="roll-landed">🎯 <strong>${esc(team)}</strong> <span class="year-chip">${year}</span></div>
      ${spinBoard("Club", team, "Season", year, false)}
      <div class="chooser-label">Continue to view the squad, or reroll for a different club and season.</div>`;
    setBtn("btn-spin", false);
    setBtn("btn-accept", true);
    setBtn("btn-reroll", state.rerolls > 0);
  }

  function renderAttrChooser() {
    const { team, year } = state.currentSpin;
    const chips = remainingAttrs().map((a) =>
      `<button class="attr-chip" data-key="${a.key}">${a.name}</button>`).join("");
    document.getElementById("roll-result").innerHTML = `
      <div class="roll-landed">🎯 <strong>${esc(team)}</strong> <span class="year-chip">${year}</span></div>
      <div class="chooser-label">Choose which attribute to draft from this squad:</div>
      <div class="attr-chips">${chips}</div>
      <div id="roster-slot"></div>`;
    document.querySelectorAll(".attr-chip").forEach((c) =>
      c.addEventListener("click", () => chooseAttr(c.dataset.key)));
    setBtn("btn-spin", false);
    setBtn("btn-accept", false);
    setBtn("btn-reroll", state.rerolls > 0);
    const firstKey = remainingAttrs()[0].key;
    chooseAttr(firstKey);
  }

  function statForAttr(key, pl) {
    switch (key) {
      case "heading": case "leftFoot": case "rightFoot": case "speed": return pl[key];
      case "body": return Math.round((pl.fitness + pl.strength) / 2);
      case "mentality": return pl.overall;
      default: return pl.overall || 0;
    }
  }

  function donorValueText(key, pl) {
    switch (key) {
      case "heading": return `Heading ${pl.heading}`;
      case "leftFoot": return `Left Foot ${pl.leftFoot}`;
      case "rightFoot": return `Right Foot ${pl.rightFoot}`;
      case "speed": return `Speed ${pl.speed}`;
      case "body": return `Fitness ${pl.fitness} · Strength ${pl.strength}`;
      case "mentality": return `${esc(pl.mentality)}${mentIsSpecial(pl.mentality) ? " ★" : ""}`;
      default: return "";
    }
  }

  function donorAttrGrid(key, pl) {
    const rows = [
      { k: "heading", label: "HDR", v: pl.heading },
      { k: "fitness", label: "FIT", v: pl.fitness, host: "body" },
      { k: "strength", label: "STR", v: pl.strength, host: "body" },
      { k: "leftFoot", label: "LF", v: pl.leftFoot },
      { k: "rightFoot", label: "RF", v: pl.rightFoot },
      { k: "speed", label: "SPD", v: pl.speed },
      { k: "mentality", label: "MEN", v: pl.mentality, text: true },
    ];
    return `<div class="donor-attrs">${rows.map((r) =>
      `<div class="donor-attr${(r.host || r.k) === key ? " highlight" : ""}"><span>${r.label}</span><b>${r.text ? esc(r.v) : r.v}</b></div>`
    ).join("")}</div>`;
  }

  function surnameOf(name) {
    const parts = String(name || "").trim().split(/\s+/);
    return parts[parts.length - 1] || name;
  }
  function donorRatingClass(pl) {
    if (pl.pos === "GK") return "keeper";
    if (["FW", "WG", "AM"].includes(pl.pos)) return "attack";
    if (["CB", "FB"].includes(pl.pos)) return "defence";
    return "midfield";
  }
  function donorPosClass(pos) {
    if (["FW", "WG", "AM"].includes(pos)) return "attack";
    if (["CB", "FB"].includes(pos)) return "defence";
    if (pos === "GK") return "keeper";
    return "midfield";
  }
  function chooseAttr(key) {
    state.chosenAttr = key;
    state.selectedDonorIdx = null;
    state.rosterSort = state.rosterSort || "rating";
    document.querySelectorAll(".attr-chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.key === key));
    const cfg = ATTR_BY_KEY[key];

    const { squadKey } = state.currentSpin;
    const sortMode = state.rosterSort || "rating";
    const squad = activePlayerDatabase[squadKey]
      .map((pl, idx) => ({ pl, idx }))
      .sort((a, b) => sortMode === "name"
        ? surnameOf(a.pl.name).localeCompare(surnameOf(b.pl.name)) || a.pl.name.localeCompare(b.pl.name)
        : (b.pl.overall || 0) - (a.pl.overall || 0));

    const used = new Set(state.player.usedDonors || []);
    const hideStats = DIFFICULTIES[state.difficulty].hideStats;
    const cards = squad.map(({ pl, idx }) => {
      const badge = pl.overall || statForAttr(key, pl);
      const tierChip = pl.tier ? `<span class="legend-chip">${esc(pl.tier)}</span>` : "";
      const isUsed = used.has(pl.name);
      const posClass = donorPosClass(pl.pos);
      return `
        <button class="donor-card${isUsed ? " used" : ""}" data-idx="${idx}"${isUsed ? " disabled" : ""}>
          ${hideStats ? `<div class="donor-rating ok">?</div>` : `<div class="donor-rating ${donorRatingClass(pl)}">${badge}</div>`}
          <div class="donor-main">
            <div class="donor-name">${esc(pl.name)} ${tierChip}${isUsed ? " <span class='used-tag'>USED</span>" : ""}</div>
            ${hideStats ? "" : `<div class="donor-value">${donorValueText(key, pl)}</div>${donorAttrGrid(key, pl)}`}
          </div>
          ${hideStats ? "" : `<div class="donor-side"><span class="donor-pos ${posClass}">${esc(pl.pos)}</span></div>`}
        </button>`;
    }).join("");

    document.getElementById("roster-slot").innerHTML = `
      <div class="roster-toolbar">
        <div class="roster-toolbar-title">Pick any player, then choose which open attribute to slot them into.</div>
        <div class="sort-tabs"><button class="sort-tab ${sortMode === "rating" ? "active" : ""}" data-sort="rating">Rating</button><button class="sort-tab ${sortMode === "name" ? "active" : ""}" data-sort="name">Surname A-Z</button></div>
      </div>
      <div class="roster-grid">${cards}</div>
      <div id="selected-donor"></div>`;
    document.querySelectorAll("#roster-slot .sort-tab").forEach((b) =>
      b.addEventListener("click", () => { state.rosterSort = b.dataset.sort; chooseAttr(key); }));
    document.querySelectorAll("#roster-slot .donor-card").forEach((c) =>
      c.addEventListener("click", () => {
        if (c.disabled) return;
        selectDonor(parseInt(c.dataset.idx, 10));
      }));
  }

  function selectDonor(idx) {
    const { squadKey } = state.currentSpin;
    const pl = activePlayerDatabase[squadKey][idx];
    if ((state.player.usedDonors || []).includes(pl.name)) {
      document.getElementById("selected-donor").innerHTML = `<span class="bad">${esc(pl.name)} has already been used. Pick a different donor.</span>`;
      state.selectedDonorIdx = null;
      setBtn("btn-accept", false);
      return;
    }
    state.selectedDonorIdx = idx;
    document.querySelectorAll("#roster-slot .donor-card").forEach((c) =>
      c.classList.toggle("selected", parseInt(c.dataset.idx, 10) === idx));
    const hideStats = DIFFICULTIES[state.difficulty].hideStats;
    const donorInfo = hideStats ? "" : ` — ${donorValueText(state.chosenAttr, pl)}`;
    document.getElementById("selected-donor").innerHTML =
      `Selected: <strong>${esc(pl.name)}</strong>${donorInfo} <em>(${esc(state.currentSpin.team)} ${state.currentSpin.year})</em>`;
    setBtn("btn-accept", true);
    setBtn("btn-reroll", state.rerolls > 0);
  }

  function accept() {
    if (state.phase === "country") {
      if (!state.currentSpin || !state.currentSpin.country) return;
      state.country = state.currentSpin.country;
      state.player.origin = state.currentSpin.origin;
      state.phase = "build";
      saveState();
      beginTurn();
      return;
    }
    if (state.phase === "build") {
      if (!state.currentSpin || !state.currentSpin.club) return;
      state.academy = { club: state.currentSpin.club, tier: state.currentSpin.tier };
      state.player.academy = state.academy;
      state.player.position = state.currentSpin.position;
      state.player.build = state.currentSpin.build;
      state.phase = "attributes";
      saveState();
      beginTurn();
      return;
    }
    if (state.phase === "attributes" && state.currentSpin && state.currentSpin.awaitingContinue) {
      state.currentSpin.awaitingContinue = false;
      renderAttrChooser();
      return;
    }
    // attribute phase
    const key = state.chosenAttr;
    if (!key || state.selectedDonorIdx == null) return;
    const { squadKey, team, year } = state.currentSpin;
    const pl = activePlayerDatabase[squadKey][state.selectedDonorIdx];
    if ((state.player.usedDonors || []).includes(pl.name)) return;
    const slot = { donor: pl.name, donorObj: pl, team, year };
    if (key === "body") { slot.value = pl.fitness; slot.value2 = pl.strength; }
    else if (key === "mentality") { slot.value = pl.mentality; slot.rating = pl.mentalityRating; }
    else slot.value = pl[key];
    state.player.slots[key] = slot;
    state.player.usedDonors.push(pl.name);

    if (remainingAttrs().length === 0) {
      try {
        compilePlayer();
      } catch (err) {
        console.error("compilePlayer failed after final attribute:", err);
        alert("Failed to compile player: " + err.message);
      }
      return;
    }
    saveState();
    beginTurn();
  }

  function reroll() {
    if (state.rerolls <= 0) return;
    state.rerolls--;
    document.getElementById("reroll-count").textContent = state.rerolls;
    setBtn("btn-accept", false);
    setBtn("btn-reroll", false);
    if (state.phase === "attributes") {
      state.selectedDonorIdx = null;
      state.chosenAttr = null;
      spin();
      return;
    }
    state.selectedDonorIdx = null;
    state.currentSpin = null;
    spin();
  }

  function renderPreview() {
    const wrap = document.getElementById("player-preview");
    const slots = state.player.slots;
    const origin = state.player.origin;
    const pos = state.player.position;
    const build = state.player.build;
    const acad = state.academy;
    const rows = DRAFT_ATTRS.map((cfg) => {
      const s = slots[cfg.key];
      if (!s) return `<div class="prev-row empty"><span>${cfg.name}</span><span>—</span></div>`;
      let val;
      if (cfg.key === "body") val = `${s.value}/${s.value2}`;
      else val = s.value;
      return `<div class="prev-row"><span>${cfg.name}</span><span class="prev-val">${val}</span><span class="prev-src">${esc(s.donor)}, ${esc(s.team)} ${s.year}</span></div>`;
    }).join("");
    const originRow = origin
      ? `<div class="prev-row"><span>Origin</span><span class="prev-val">${origin.flag} ${state.country}</span><span class="prev-src">${origin.story}</span></div>`
      : `<div class="prev-row empty"><span>Origin</span><span>—</span></div>`;
    const posRow = pos
      ? `<div class="prev-row"><span>Position</span><span class="prev-val">${(POSITIONS[pos] || POSITIONS.ST).label}</span></div>`
      : "";
    const buildRow = build
      ? `<div class="prev-row"><span>Build</span><span class="prev-val">${build.height}cm · ${build.weight}kg</span></div>`
      : "";
    const acadRow = acad
      ? `<div class="prev-row"><span>Academy</span><span class="prev-val">${acad.tier}</span><span class="prev-src">${esc(acad.club)}</span></div>`
      : `<div class="prev-row empty"><span>Academy</span><span>—</span></div>`;
    const scout = scoutFeedback(slots, pos, build, acad, origin);
    wrap.innerHTML = `<h3>Your DNA so far</h3>${originRow}${posRow}${buildRow}${rows}${acadRow}
      <div class="scout-feedback"><strong>Scout report:</strong> ${scout}</div>
      <div class="preview-hint">Every donor you pick secretly nudges your other attributes — trade-offs are real.</div>`;
  }

  function scoutFeedback(slots, pos, build, acad, origin) {
    const filled = Object.values(slots).filter(Boolean).length;
    if (filled === 0 && !pos && !build && !origin) return "We need a bigger sample size. Start spinning to build a profile.";
    const notes = [];
    if (pos === "ST") notes.push("a traditional penalty-box presence");
    else if (pos === "CF") notes.push("a mobile frontman");
    else if (pos === "Winger") notes.push("a wide goal threat");
    else if (pos) notes.push(`a ${(POSITIONS[pos] || POSITIONS.ST).label.toLowerCase()}`);
    if (build) {
      if (build.height >= 190) notes.push("imposing aerial frame");
      else if (build.height <= 173) notes.push("low centre of gravity");
      if (build.weight >= 85) notes.push("physical strength to hold off defenders");
      else if (build.weight <= 68) notes.push("sharp agility over raw power");
    }
    if (slots.heading && slots.heading.value >= 85) notes.push("elite heading ability");
    if (slots.leftFoot && slots.leftFoot.value >= 85) notes.push("devastating left foot");
    if (slots.rightFoot && slots.rightFoot.value >= 85) notes.push("devastating right foot");
    if (slots.speed && slots.speed.value >= 85) notes.push("blistering pace");
    if (slots.body && slots.body.value >= 85) notes.push("excellent engine");
    if (slots.mentality) {
      const ment = slots.mentality.value;
      if (["Big Game Player", "Winner", "Talisman", "Fearless", "Ice Cold"].includes(ment)) notes.push("a mentality made for big moments");
      else if (["Professional", "Determined", "Diligent"].includes(ment)) notes.push("a solid professional attitude");
    }
    if (origin) notes.push(`roots in ${origin.flag} ${state.country}`);
    if (acad) notes.push(`graduated from a ${acad.tier.toLowerCase()} academy`);
    const missing = DRAFT_ATTRS.filter((cfg) => !slots[cfg.key]).map((cfg) => cfg.name);
    if (missing.length) notes.push(`still needs ${missing.join(", ")}`);
    if (notes.length === 0) return "Early days — the profile is still forming.";
    return notes.join(" · ") + ".";
  }

  /* ==================== COMPILE: HIDDEN INFLUENCE + SYNERGY ============== */
  function hostSlotFor(attr) {
    return { heading: "heading", speed: "speed", leftFoot: "leftFoot", rightFoot: "rightFoot", fitness: "body", strength: "body" }[attr];
  }

  function compilePlayer() {
    const slots = state.player.slots;
    const donors = Object.values(slots).map((s) => s.donorObj).filter(Boolean);
    if (donors.length < DRAFT_ATTRS.length) throw new Error("Incomplete DNA draft");

    // explicit picks for each skill attribute
    const explicit = {
      heading: slots.heading.donorObj.heading,
      fitness: slots.body.donorObj.fitness,
      strength: slots.body.donorObj.strength,
      leftFoot: slots.leftFoot.donorObj.leftFoot,
      rightFoot: slots.rightFoot.donorObj.rightFoot,
      speed: slots.speed.donorObj.speed,
    };

    // hidden influence: blend each skill attr with the AVERAGE of the OTHER donors' same attr
    const attrs = {};
    HIDDEN_KEYS.forEach((k) => {
      const source = slots[hostSlotFor(k)].donorObj;
      const others = donors.filter((d) => d !== source);
      const avgOther = others.reduce((s, d) => s + d[k], 0) / (others.length || 1);
      attrs[k] = Math.round(clamp(explicit[k] * (1 - HIDDEN_WEIGHT) + avgOther * HIDDEN_WEIGHT, 40, 99));
    });
    // height/weight come from the merged build roll
    attrs.height = state.player.build.height;
    attrs.weight = state.player.build.weight;

    // Heading is physically tied to height: tall frames dominate aerially, short frames struggle.
    const h = attrs.height;
    let headingHeightMod = 0;
    if (h >= 196) headingHeightMod = 12;
    else if (h >= 190) headingHeightMod = 8;
    else if (h >= 185) headingHeightMod = 4;
    else if (h >= 180) headingHeightMod = 1;
    else if (h <= 169) headingHeightMod = -6;
    else if (h <= 174) headingHeightMod = -3;
    attrs.heading = clamp(attrs.heading + headingHeightMod, 40, 99);

    // Defender foot nerf: defenders are not natural finishers, so their foot contributions are capped.
    const DEFENSIVE_POSITIONS = new Set(["CB", "LB", "RB", "LWB", "RWB", "GK", "DM", "SW"]);
    function isDefender(pl) { return DEFENSIVE_POSITIONS.has(pl.pos); }
    const lfDonor = slots.leftFoot.donorObj;
    const rfDonor = slots.rightFoot.donorObj;
    if (isDefender(lfDonor)) attrs.leftFoot = clamp(Math.round(attrs.leftFoot * 0.80), 40, 99);
    if (isDefender(rfDonor)) attrs.rightFoot = clamp(Math.round(attrs.rightFoot * 0.80), 40, 99);

    // DNA mutations: when a build clashes with a donor attribute, reality mutates the player.
    const mutations = [];
    const headingDonor = slots.heading.donorObj;
    const speedDonor = slots.speed.donorObj;
    const bodyDonor = slots.body.donorObj;
    const heightGap = h - (headingDonor.height || h);
    const bodyHeightGap = h - (bodyDonor.height || h);
    if (h <= 175 && (headingDonor.height || 0) >= 188 && headingDonor.heading >= 78) {
      attrs.heading = clamp(attrs.heading + 5, 40, 99);
      attrs.speed = clamp(attrs.speed - 6, 40, 99);
      attrs.fitness = clamp(attrs.fitness - 4, 40, 99);
      mutations.push("Aerial mutation — small frame copying a tower gains leap but loses engine");
    } else if (heightGap <= -10 && headingDonor.heading >= 80) {
      attrs.heading = clamp(attrs.heading - 5, 40, 99);
      mutations.push("Size mismatch — tall-player heading DNA does not fully transfer");
    }
    if (h >= 190 && (speedDonor.height || 190) <= 178 && speedDonor.speed >= 86) {
      attrs.speed = clamp(attrs.speed - 5, 40, 99);
      attrs.strength = clamp(attrs.strength + 3, 40, 99);
      attrs.fitness = clamp(attrs.fitness - 3, 40, 99);
      mutations.push("Giant speedster risk — small-player pace DNA strains a big frame");
    } else if (h >= 188 && speedDonor.speed >= 88) {
      attrs.speed = clamp(attrs.speed + 2, 40, 99);
      attrs.fitness = clamp(attrs.fitness - 4, 40, 99);
      mutations.push("Heavy acceleration load — pace costs durability");
    }
    if (Math.abs(bodyHeightGap) >= 12 || Math.abs(attrs.weight - (bodyDonor.weight || attrs.weight)) >= 12) {
      if (rand() < 0.5) {
        attrs.strength = clamp(attrs.strength - 4, 40, 99);
        attrs.fitness = clamp(attrs.fitness - 3, 40, 99);
        mutations.push("Body mutation — mismatched frame rejects some physical DNA");
      } else {
        attrs.strength = clamp(attrs.strength + 2, 40, 99);
        attrs.speed = clamp(attrs.speed - 3, 40, 99);
        mutations.push("Body mutation — power transfers but agility suffers");
      }
    }
    // Defensive body mutation: power donor is a defender, so finishing instinct is dulled
    if (isDefender(bodyDonor) && (attrs.leftFoot + attrs.rightFoot) / 2 >= 75) {
      attrs.leftFoot = clamp(attrs.leftFoot - 4, 40, 99);
      attrs.rightFoot = clamp(attrs.rightFoot - 4, 40, 99);
      attrs.strength = clamp(attrs.strength + 4, 40, 99);
      mutations.push("Defensive body — grit over guile");
    }
    // One-trick mutation: a single extreme donor creates a lopsided specialist
    const explicitVals = { heading: slots.heading.donorObj.heading, leftFoot: slots.leftFoot.donorObj.leftFoot, rightFoot: slots.rightFoot.donorObj.rightFoot, speed: slots.speed.donorObj.speed };
    const maxExplicit = Math.max(...Object.values(explicitVals));
    const minExplicit = Math.min(...Object.values(explicitVals));
    if (maxExplicit - minExplicit >= 30) {
      const topKey = Object.keys(explicitVals).find((k) => explicitVals[k] === maxExplicit);
      attrs[topKey] = clamp(attrs[topKey] + 3, 40, 99);
      const weakKeys = Object.keys(explicitVals).filter((k) => explicitVals[k] <= minExplicit + 5);
      weakKeys.forEach((k) => { attrs[k] = clamp(attrs[k] - 3, 40, 99); });
      mutations.push("One-trick specialist — brilliant at one thing, exposed elsewhere");
    }
    state.mutationNotes = mutations;

    // Mentality: 95% of players get a balanced/default trait; 5% roll a rare special trait.
    const mSource = slots.mentality.donorObj;
    const balancedTraits = Object.keys(MENTALITY_TRAITS).filter((k) => !MENTALITY_TRAITS[k].special);
    const specialTraits = Object.keys(MENTALITY_TRAITS).filter((k) => MENTALITY_TRAITS[k].special);
    let chosenMentality;
    if (rand() < 0.05) {
      // Rare special: prefer the donor's mentality if it is special, otherwise random special
      chosenMentality = specialTraits.includes(mSource.mentality) ? mSource.mentality : choice(specialTraits);
    } else {
      // Default: prefer the donor's mentality if it is balanced, otherwise random balanced
      chosenMentality = balancedTraits.includes(mSource.mentality) ? mSource.mentality : choice(balancedTraits);
    }
    state.mentality = chosenMentality;
    // The numeric rating remains hidden from the UI; keep it for simulation impact.
    const otherRatings = donors.filter((d) => d !== mSource).map((d) => d.mentalityRating);
    const avgMent = otherRatings.reduce((s, r) => s + r, 0) / (otherRatings.length || 1);
    state.mentalityRating = Math.round(clamp(mSource.mentalityRating * 0.8 + avgMent * 0.2, 15, 99));

    // Hidden international trait based on mentality, country and a roll of the dice.
    state.intlTrait = deriveInternationalTrait();

    // primary position from the merged build roll
    state.position = state.player.position;

    // physical build synergy
    const syn = applyPhysicalSynergy(attrs);
    state.attrs = syn.attrs;
    state.synergyNotes = syn.notes;
    state.derived = deriveStats(syn.attrs);
    applyDerivedBonuses();

    state.academyTier = state.academy.tier;
    state.luck = rollLuck();
    state.playstyle = inferPlaystyle(state.attrs);
    state.determination = calculateDetermination(state);
    state.injuryRating = calculateInjuryRating(state);
    state.longevity = calculateLongevity(state);
    state.injuryProneness = calculateInjuryProneness(state.attrs, state.academy.tier, state.luck, state.injuryRating);
    state.retirementAge = calculateRetirementAge(state.injuryProneness, state.attrs.fitness, state.longevity);
    state.baseRating = calculateStrikerRating(state.attrs);

    // deep synergy scoring
    const syn2 = computeSynergyMultiplier(state.attrs);
    state.synergyMultiplier = syn2.multiplier;
    state.baseRating = Math.round(clamp(state.baseRating * syn2.multiplier, 40, 99));
    state.synergyNotes = state.synergyNotes.concat(syn2.notes);

    // hidden traits and potential
    state.hiddenTraits = generateHiddenTraits(state.attrs, state);
    state.traitProgress = {};
    state.hiddenTraits.forEach((t) => setTraitProgress(t, 0));
    state.potentialRating = calculatePotentialRating(state);

    // agent roll
    rollAgent();

    // starting club
    const academyTeam = findTeamForAcademy(state.academy.club);
    if (academyTeam) {
      state.pendingClub = academyTeam;
      state.clubOffers = [];
    } else {
      state.pendingClub = null;
      state.clubOffers = generateClubOffers(state.baseRating, state.academy.tier);
    }

    renderConfirm();
    showScreen("screen-confirm");
    saveState();
  }

  // New derived values requested for the beta rework.
  function calculateLongevity(s) {
    const a = s.attrs;
    const playstyleMod = { "Target Man": 2, "Pace Merchant": -2, "Powerhouse": 3, "Clinical Finisher": 0, "Complete Forward": 1, "False Nine": 0, "Two-Footed Threat": 1 }[s.playstyle] || 0;
    const mentMod = { "workrate": 2, "consistency": 2, "leader": 1, "neutral": 0, "volatile": -2, "negative": -3, "aggressive": -1, "clutch": 1, "winner": 1, "talisman": 1 }[mentTag(s.mentality)] || 0;
    const base = 50
      + (a.fitness + a.strength) / 4
      + playstyleMod * 3
      + mentMod * 3
      + s.luck;
    return Math.round(clamp(base + randInt(-5, 5), 15, 95));
  }

  function calculateInjuryRating(s) {
    const a = s.attrs;
    const academyMod = { "World Class": -8, "Strong": -4, "Average": 0, "Weak": +5 }[s.academy.tier] || 0;
    const base = 50
      - a.fitness * 0.22
      - a.strength * 0.18
      + academyMod
      + s.luck;
    return Math.round(clamp(base + randInt(-5, 5), 10, 95));
  }

  function calculateDetermination(s) {
    const mentMod = { "workrate": 10, "consistency": 8, "leader": 6, "neutral": 0, "volatile": -4, "negative": -8, "aggressive": 2, "clutch": 4, "winner": 6, "talisman": 6 }[mentTag(s.mentality)] || 0;
    const academyMod = { "World Class": 6, "Strong": 3, "Average": 0, "Weak": -3 }[s.academy.tier] || 0;
    const playstyleMod = { "Target Man": 2, "Pace Merchant": 0, "Powerhouse": 4, "Clinical Finisher": 2, "Complete Forward": 3, "False Nine": 0, "Two-Footed Threat": 2 }[s.playstyle] || 0;
    const base = 50
      + mentMod
      + academyMod
      + playstyleMod * 2
      + s.luck;
    return Math.round(clamp(base + randInt(-5, 5), 15, 95));
  }

  function calculatePotentialRating(s) {
    const donors = Object.values(s.player.slots || {}).map((slot) => slot.donorObj).filter(Boolean);
    const donorPeak = donors.length ? donors.reduce((sum, d) => sum + d.overall, 0) / donors.length : 70;
    const academyMod = { "World Class": 8, "Strong": 4, "Average": 0, "Weak": -4 }[s.academy.tier] || 0;
    const originDev = s.player.origin ? s.player.origin.development : 1.0;
    const base = donorPeak * 0.55
      + (s.determination / 100) * 20
      + academyMod
      + (originDev - 1) * 40
      + s.luck;
    return Math.round(clamp(base + randInt(-5, 5), 30, 99));
  }

  // Updated injury-proneness calculation now incorporates the new Injury Rating.
  function calculateInjuryProneness(a, academyTier, luck, injuryRating) {
    const base = calculateInjuryPronenessBase(a, academyTier, luck);
    const durability = getPillar("Durability");
    return Math.round(clamp((base + (injuryRating || 50)) / 2 - (durability - 50) / 8, 5, 95));
  }
  function calculateInjuryPronenessBase(a, academyTier, luck) {
    const bmi = a.weight / Math.pow(a.height / 100, 2);
    let buildScore = 0;
    if (bmi >= 22 && bmi <= 25) buildScore = 8;
    else if (bmi >= 20 && bmi < 22) buildScore = 4;
    else if (bmi > 25 && bmi <= 28) buildScore = 2;
    else buildScore = -2;
    if (a.height >= 196) buildScore -= 4;
    else if (a.height <= 170) buildScore -= 2;
    const academyMod = { "World Class": -6, "Strong": -3, "Average": 0, "Weak": +5 }[academyTier] || 0;
    let p = 50
      - a.fitness * 0.28
      - a.strength * 0.18
      + buildScore
      + academyMod
      + luck;
    return Math.round(clamp(p, 5, 95));
  }

  function calculateRetirementAge(injuryProneness, fitness, longevity) {
    const long = longevity || 50;
    const pillarLong = getPillar("Longevity");
    // Minimum of 35 prevents players from being forced out at 31 when rng rolls poorly.
    return Math.round(clamp(34 + (100 - injuryProneness) / 22 + fitness / 45 + (long - 50) / 20 + (pillarLong - 50) / 10, 35, 44));
  }

  function applyPhysicalSynergy(a0) {
    const a = Object.assign({}, a0);
    const notes = [];
    const h = a.height;
    const bmi = a.weight / Math.pow(a.height / 100, 2);
    // Physical build adjustments — smaller flat bonuses, bigger penalties for mismatches
    if (h >= 190) {
      a.heading = clamp(a.heading + 2, 40, 99);
      a.strength = clamp(a.strength + 2, 40, 99);
      notes.push({ good: true, text: `Towering ${h}cm frame boosts Heading & Strength.` });
      if (a.speed >= 88) { a.speed = clamp(a.speed - 5, 40, 99); notes.push({ good: false, text: "So tall that elite pace is slightly unrealistic (−Speed)." }); }
      if (h >= 196) { a.speed = clamp(a.speed - 3, 40, 99); }
    } else if (h <= 172) {
      a.speed = clamp(a.speed + 2, 40, 99);
      notes.push({ good: true, text: `Low ${h}cm centre of gravity aids Agility & Speed.` });
      if (a.heading >= 86) { a.heading = clamp(a.heading - 6, 40, 99); notes.push({ good: false, text: "Too short to dominate aerially (−Heading)." }); }
    } else {
      notes.push({ good: true, text: "Well-proportioned frame — no physical penalties." });
    }
    if (bmi >= 26) { a.strength = clamp(a.strength + 1, 40, 99); a.speed = clamp(a.speed - 3, 40, 99); notes.push({ good: false, text: "Heavy build adds raw Strength but costs mobility (−Speed)." }); }
    return { attrs: a, notes };
  }

  function deriveStats(a) {
    const foot = Math.max(a.leftFoot, a.rightFoot);
    const agility = Math.round(clamp(a.speed * 0.55 + (188 - a.height) * 0.9 + 22, 30, 99));
    const balance = Math.round(clamp(a.strength * 0.4 + (186 - a.height) * 0.5 + 30, 30, 99));
    const dribbling = Math.round(clamp(a.speed * 0.4 + foot * 0.35 + agility * 0.2, 30, 99));
    return { agility, balance, dribbling, finishing: Math.round(foot * 0.7 + Math.min(a.leftFoot, a.rightFoot) * 0.3) };
  }

  function applyDerivedBonuses() {
    const b = state.derivedBonuses || { agility: 0, balance: 0 };
    if (!state.derived) return;
    state.derived.agility = clamp((state.derived.agility || 0) + (b.agility || 0), 30, 99);
    state.derived.balance = clamp((state.derived.balance || 0) + (b.balance || 0), 30, 99);
    state.derived.dribbling = clamp((state.derived.dribbling || 0) + (b.agility || 0) * 0.2 + (b.balance || 0) * 0.1, 30, 99);
  }

  function calculateStrikerRating(a) {
    const bestFoot = Math.max(a.leftFoot, a.rightFoot);
    const weakFoot = Math.min(a.leftFoot, a.rightFoot);
    // Finishing: weighted heavily toward best foot, but weak foot matters
    const finishing = bestFoot * 0.68 + weakFoot * 0.32;
    // Nonlinear: diminishing returns only kick in above 95, so true elite players can separate from the pack
    const dim = (v) => v <= 95 ? v : 95 + (v - 95) * 0.5;
    const rating =
      dim(finishing) * 0.38 + dim(a.heading) * 0.14 + dim(a.speed) * 0.18 +
      dim(a.strength) * 0.10 + dim(a.fitness) * 0.10 + dim((a.leftFoot + a.rightFoot) / 2) * 0.10;
    return Math.round(clamp(rating, 40, 99));
  }

  function inferPlaystyle(a) {
    if (a.heading >= 88 && a.height >= 189) return "Target Man";
    if (a.speed >= 90) return "Pace Merchant";
    if (a.strength >= 88) return "Powerhouse";
    if (Math.max(a.leftFoot, a.rightFoot) >= 92) return "Clinical Finisher";
    if (state.derived && state.derived.dribbling >= 85) return "Dribbler";
    if (a.speed >= 85 && a.strength >= 80) return "Complete Forward";
    return "Complete Forward";
  }

  const PLAYSTYLE_PROFILES = {
    "Target Man": { goalMod: 1.04, injuryRisk: 1.08, desc: "Aerial dominance — more goals from crosses, but physical toll from duels." },
    "Pace Merchant": { goalMod: 1.08, injuryRisk: 1.14, desc: "Burns defenders on the break — hamstrings and knocks are common." },
    "Powerhouse": { goalMod: 1.03, injuryRisk: 1.10, desc: "Bullies defenders — relentless but attritional." },
    "Clinical Finisher": { goalMod: 1.11, injuryRisk: 1.04, desc: "Needs fewer chances — lower injury risk from minimal off-ball work." },
    "Dribbler": { goalMod: 1.06, injuryRisk: 1.16, desc: "Creates chaos — but tackles from desperate defenders add up." },
    "Complete Forward": { goalMod: 1.00, injuryRisk: 1.00, desc: "Balanced threat — no extreme bonuses or drawbacks." },
  };

  function renderConfirm() {
    const a = state.attrs, dv = state.derived;
    const card = document.getElementById("confirm-card");
    const lines = [
      ["Position", (POSITIONS[state.position] || POSITIONS.ST).label],
      ["Heading", a.heading], ["Left Foot", a.leftFoot], ["Right Foot", a.rightFoot],
      ["Speed", a.speed], ["Strength", a.strength], ["Fitness", a.fitness],
      ["Height", a.height + " cm"], ["Weight", a.weight + " kg"],
      ["Agility", dv.agility], ["Balance", dv.balance], ["Dribbling", dv.dribbling],
    ];
    const rows = lines.map(([k, v]) =>
      `<div class="dna-row"><span class="dna-k">${k}</span><span class="dna-v">${v}</span></div>`).join("");
    const synHtml = state.synergyNotes.map((n) =>
      `<div class="syn-note ${n.good ? "good" : "bad"}">${n.good ? "✔" : "✖"} ${esc(n.text)}</div>`).join("");
    const mutHtml = (state.mutationNotes || []).length
      ? `<div class="mutation-block"><h3>DNA Mutations</h3>${state.mutationNotes.map((n) => `<div class="syn-note bad">🧬 ${esc(n)}</div>`).join("")}</div>`
      : "";
    const acad = state.academy;
    const academyTeam = findTeamForAcademy(acad.club);
    let clubSectionHtml;
    if (academyTeam) {
      const mgr = MANAGER_DATABASE[academyTeam] || {};
      const mgrHtml = mgr.name
        ? `<div class="club-assigned-manager">${esc(mgr.name)} · ${esc(mgr.focus)} · ${esc(mgr.tag)} · Youth: ${esc(mgr.youth)}</div>
           <div class="club-assigned-project">${esc(mgr.project)}</div>`
        : "";
      clubSectionHtml = `<div class="club-assigned">
        <div class="club-assigned-label">Your academy club is in the league — you'll start at:</div>
        <div class="club-assigned-name">${esc(academyTeam)}</div>
        <div class="club-assigned-tier">${TEAM_DATABASE[academyTeam].league} tier · Attack ${TEAM_DATABASE[academyTeam].attack} · ${TEAM_DATABASE[academyTeam].tacticalStyle}</div>
        ${mgrHtml}
      </div>`;
    } else {
      const offers = state.clubOffers;
      const offerCards = offers.map((c) => {
        const td = TEAM_DATABASE[c];
        const mgr = MANAGER_DATABASE[c] || {};
        const gap = state.baseRating - td.attack;
        const role = gap >= 6 ? "Star" : gap >= -3 ? "Starter" : gap >= -10 ? "Rotation" : "Bench";
        const mgrHtml = mgr.name
          ? `<div class="club-offer-manager">${esc(mgr.name)} · ${esc(mgr.focus)}</div>
             <div class="club-offer-tags"><span class="tag">${esc(mgr.tag)}</span><span class="tag">Youth: ${esc(mgr.youth)}</span></div>
             <div class="club-offer-project">${esc(mgr.project)}</div>`
          : "";
        return `<button class="club-offer-card" data-club="${esc(c)}">
          <div class="club-offer-name">${esc(c)}</div>
          <div class="club-offer-tier">${td.league} · Attack ${td.attack} · ${td.tacticalStyle}</div>
          <div class="club-offer-role">Projected: ${role}</div>
          ${mgrHtml}
        </button>`;
      }).join("");
      clubSectionHtml = `<div class="club-offers">
        <div class="club-offers-label">Your academy (${esc(acad.club)}) isn't in the league. Choose your starting club:</div>
        <div class="club-offers-grid">${offerCards}</div>
      </div>`;
    }
    const traitsHtml = state.hiddenTraits.length
      ? `<div class="traits-block"><h3>DNA Traits</h3><div class="traits-list">${state.hiddenTraits.map((t) => {
        const tier = getTraitTier(t);
        const color = TRAIT_TIER_COLORS[tier];
        const name = TRAIT_TIER_NAMES[tier];
        return `<span class="trait-chip trait-tier-${tier}" title="${esc(HIDDEN_TRAITS[t].desc)} (${name})" style="border-color:${color};color:${color}">${esc(t)} <small>${tier}</small></span>`;
      }).join("")}</div></div>`
      : "";
    const radarId = "confirm-radar";
    const radarHtml = `<div class="radar-wrap"><canvas id="${radarId}" width="320" height="240"></canvas></div>`;

    card.innerHTML = `
      <div class="rating-hero">
        <div class="rating-num">${state.baseRating}</div>
        <div class="rating-label">STRIKER RATING</div>
        <div class="playstyle-chip">${esc(state.playstyle)}</div>
        <div class="ment-chip ${mentIsSpecial(state.mentality) ? "rare" : ""}">${esc(state.mentality)}</div>
        <div class="acad-chip">🎓 ${esc(acad.club)} · ${esc(acad.tier)} academy</div>
        <div class="agent-chip">${esc(state.agent.label)} agent · Wealth ${state.wealth}</div>
        <div class="longevity-chip">Retires ~${state.retirementAge} · Durability ${100 - state.injuryProneness}/100</div>
        <div class="longevity-chip">Potential ${state.potentialRating} · Determination ${state.determination} · Longevity ${state.longevity} · Injury Risk ${state.injuryRating}</div>
        <div class="acad-chip">${state.player.origin.flag} ${esc(state.country)} · ${esc(state.player.origin.story)}</div>
      </div>
      <div class="confirm-body">
        <div class="dna-table">${rows}</div>
        ${radarHtml}
      </div>
      ${traitsHtml}
      ${mutHtml}
      <div class="synergy-block"><h3>Synergy Analysis</h3>
        <div class="syn-note ${state.synergyMultiplier >= 1 ? "good" : "bad"}">Synergy Multiplier: <strong>${(state.synergyMultiplier * 100).toFixed(0)}%</strong> ${state.synergyMultiplier >= 1 ? "▲" : "▼"}</div>
        ${synHtml}</div>
      ${pillarsHtml()}
      ${clubSectionHtml}`;

    // draw the radar chart after the DOM is updated
    requestAnimationFrame(() => {
      const canvas = document.getElementById(radarId);
      if (canvas) drawRadarChart(canvas, state.attrs);
    });
    // wire up club offer selection
    if (!academyTeam && state.clubOffers.length > 0) {
      document.querySelectorAll(".club-offer-card").forEach((btn) =>
        btn.addEventListener("click", () => {
          document.querySelectorAll(".club-offer-card").forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
          state.pendingClub = btn.dataset.club;
        }));
    }
  }

  /* ============================ CAREER START =========================== */
  // Normalize academy club names to match TEAM_DATABASE keys
  const ACADEMY_NAME_MAP = {
    "Brighton and Hove Albion": "Brighton",
    "Tottenham Hotspur": "Tottenham",
    "West Ham United": "West Ham",
    "Wolverhampton Wanderers": "Wolves",
  };
  function findTeamForAcademy(academyName) {
    if (TEAM_DATABASE[academyName]) return academyName;
    if (ACADEMY_NAME_MAP[academyName]) return ACADEMY_NAME_MAP[academyName];
    const clean = (s) => s.replace(/^AFC\s+/, "").replace(/\s+FC$/i, "").replace(/\s+AFC$/i, "").trim();
    const cleaned = clean(academyName);
    for (const teamKey of Object.keys(TEAM_DATABASE)) {
      if (clean(teamKey) === cleaned) return teamKey;
    }
    return null;
  }

  // Generate 1-3 club offers based on player skill and academy tier
  function generateClubOffers(rating, academyTier) {
    const tierOrder = ["Elite", "Europe", "Mid", "Lower"];
    // Determine which tier bands the player attracts offers from
    let targetTiers;
    if (rating >= 82) targetTiers = ["Elite", "Europe"];
    else if (rating >= 72) targetTiers = ["Europe", "Mid"];
    else if (rating >= 62) targetTiers = ["Mid", "Lower"];
    else targetTiers = ["Lower"];

    // Number of offers: higher skill = more suitors
    let numOffers;
    if (rating >= 80) numOffers = 3;
    else if (rating >= 68) numOffers = 2;
    else numOffers = 1;
    // World Class academy bumps offers up by 1 (well-connected)
    if (academyTier === "World Class") numOffers = Math.min(3, numOffers + 1);

    // Build candidate pool from target tiers, sorted by team strength (descending)
    const candidates = getPLLeagueClubs()
      .filter((c) => targetTiers.includes(TEAM_DATABASE[c].league))
      .sort((a, b) => {
        const ta = TEAM_DATABASE[a], tb = TEAM_DATABASE[b];
        return (tb.attack + tb.midfield + tb.defence) - (ta.attack + ta.midfield + ta.defence);
      });

    // Pick offers: weighted toward clubs where the player would be a star
    // (team attack rating close to but below player rating = good fit)
    const offers = [];
    const used = new Set();
    for (let i = 0; i < numOffers && candidates.length > 0; i++) {
      // Weight: prefer clubs where player rating > team attack (player would be the star)
      const weighted = candidates
        .filter((c) => !used.has(c))
        .map((c) => {
          const teamAtk = TEAM_DATABASE[c].attack;
          const gap = rating - teamAtk;
          // Positive gap (player better than team) = higher weight, but not too far above
          const w = gap >= 0 && gap <= 15 ? 3 : gap > 15 ? 2 : gap >= -10 ? 1.5 : 1;
          return { item: c, weight: w };
        });
      if (weighted.length === 0) break;
      const pick = weightedRandomPick(weighted);
      used.add(pick);
      offers.push(pick);
    }
    return offers;
  }
  function startCareer() {
    const nameInput = document.getElementById("player-name-input");
    state.player.name = (nameInput.value || "").trim() || "Your Striker";
    const tier = state.academy.tier;

    // If club offers were presented but none selected, block start
    if (state.clubOffers.length > 0 && !state.pendingClub) {
      alert("Please select a starting club before starting your career.");
      return;
    }

    // Use the club selected on the confirm screen
    if (!state.pendingClub) {
      // Fallback: pick from academy pool if nothing selected
      const pool = ACADEMY_STARTING_POOL[tier] || ACADEMY_STARTING_POOL.Average;
      state.club = choice(pool);
    } else {
      state.club = state.pendingClub;
    }
    state.clubsPlayed.add(state.club);
    ensureClubStat(state.club);
    state.season = 1;
    state.age = LEVERS.debutAge + (tier === "Strong" || tier === "World Class" ? 0 : randInt(0, 1));
    state.contractYears = 3;
    state.contractSignedAt = 1;
    state.contractEndSeason = 4;
    state.contractForceStays = 0;
    state.contractRole = tier === "World Class" ? "Starter" : "Rotation";

    showScreen("screen-career");
    addBioMoment(generateBioIntro());
    log(`🎬 ${state.player.name} begins their career at ${state.club} (${tier} academy). The chase for ${LEVERS.goalTarget} goals starts now.`, "milestone");
    renderCareerHeader();
    renderBiography();
    renderSeasonReady();
  }

  function ensureClubStat(club) {
    if (!state.clubStats[club]) state.clubStats[club] = { apps: 0, goals: 0, assists: 0, seasons: 0, titles: 0 };
  }

  /* ====================== CAREER SIMULATION ENGINE ====================== */
  function getAgeModifier(age) {
    // Nonlinear curve: slow rise, prime window, gradual decline.
    // Peak at age 27 (~1.00x). After 32 the drop is gentler so veterans stay useful.
    let base;
    if (age <= 20) base = 0.55 + (age - 17) * 0.067;      // 0.55 → 0.75
    else if (age <= 24) base = 0.75 + (age - 21) * 0.067;      // 0.75 → 0.95
    else if (age <= 27) base = 0.95 + (age - 25) * 0.025;      // 0.95 → 1.00 (prime peak)
    else if (age <= 29) base = 1.00 - (age - 27) * 0.03;       // 1.00 → 0.94
    else if (age <= 32) base = 0.94 - (age - 29) * 0.035;      // 0.94 → 0.84
    else base = Math.max(0.45, 0.84 - (age - 32) * 0.045);      // gradual decline: 84 at 33 → 45 at 41

    // Hidden traits tweak the curve
    if (hasTrait("Early Bloomer")) {
      if (age <= 25) base *= 1.10;
      else if (age >= 29) base *= 0.88;
    }
    if (hasTrait("Late Bloomer")) {
      if (age <= 23) base *= 0.90;
      else if (age >= 28) base *= 1.12;
    }
    return base;
  }
  function agedRating() {
    let r = state.baseRating * getAgeModifier(state.age);
    // hidden mentality rating: consistent players squeeze a touch more out
    r *= 1 + (state.mentalityRating - 60) / 500;
    return r;
  }

  const TACTICAL = {
    Possession: { strongVs: ["Direct", "Route One"], weakVs: ["High Press"], atk: 1.0, mid: 1.08, chaos: 0 },
    "High Press": { strongVs: ["Possession"], weakVs: ["Counter"], atk: 1.04, def: 0.98, chaos: 6 },
    Counter: { strongVs: ["High Press"], weakVs: ["Park the Bus"], atk: 1.05, chaos: 4 },
    Direct: { strongVs: ["Park the Bus"], weakVs: ["Possession"], atk: 1.03, chaos: 4 },
    "Park the Bus": { strongVs: ["Counter"], weakVs: ["Direct"], atk: 0.9, def: 0.9, chaos: -4 },
    "Route One": { strongVs: [], weakVs: ["Possession"], atk: 1.0, chaos: 12 },
  };
  const DERBY_PAIRS = [
    ["Manchester United", "Liverpool"], ["Arsenal", "Tottenham"], ["Chelsea", "Arsenal"], ["Manchester City", "Manchester United"],
    ["Everton", "Liverpool"], ["Newcastle", "Sunderland"], ["West Ham", "Tottenham"], ["Aston Villa", "Birmingham"],
  ];
  function isDerby(home, away) {
    return DERBY_PAIRS.some((p) => (p[0] === home && p[1] === away) || (p[0] === away && p[1] === home));
  }
  function generateMatchNarrative(home, away, homeGoals, awayGoals, isPlayerTeam, myGoals, posContext) {
    const total = homeGoals + awayGoals;
    const winner = homeGoals > awayGoals ? home : awayGoals > homeGoals ? away : null;
    const margin = Math.abs(homeGoals - awayGoals);
    const isTopOpponent = TEAM_DATABASE[away] && TEAM_DATABASE[away].attack >= 86 || TEAM_DATABASE[home] && TEAM_DATABASE[home].attack >= 86;
    const playerWon = winner === state.club;
    const playerLost = winner && winner !== state.club;
    const lines = [];
    if (isDerby(home, away)) lines.push(`Derby day ${homeGoals}-${awayGoals}`);
    if (posContext && posContext.titleRace && margin <= 1) lines.push(`A crucial result in the title race`);
    if (posContext && posContext.relegationBattle && margin <= 1) lines.push(`A huge result in the relegation battle`);
    if (margin >= 4) lines.push(`${winner} ran riot in a ${margin}-goal demolition`);
    if (homeGoals > 0 && awayGoals > 0 && winner && Math.abs(homeGoals - awayGoals) === 1) lines.push(`A tight, back-and-forth contest`);
    if (homeGoals === 0 && awayGoals === 0) lines.push(`A stale, goalless draw`);
    if (isPlayerTeam && myGoals >= 3) lines.push(`${state.player.name} hit a hat-trick`);
    if (isPlayerTeam && myGoals === 2) lines.push(`${state.player.name} scored a brace`);
    if (isPlayerTeam && playerWon && isTopOpponent) lines.push(`A statement win against a top side`);
    if (isPlayerTeam && playerLost && isTopOpponent) lines.push(`Outclassed by elite opposition`);
    if (lines.length === 0) return null;
    return lines.join(" — ");
  }
  function applyTacticalMatchup(homeStyle, awayStyle) {
    const h = TACTICAL[homeStyle] || {}, a = TACTICAL[awayStyle] || {};
    let homeAtkMod = h.atk || 1, awayAtkMod = a.atk || 1;
    let homeDefMod = h.def || 1, awayDefMod = a.def || 1;
    let chaosMod = 15 + (h.chaos || 0) + (a.chaos || 0);
    if ((h.strongVs || []).includes(awayStyle)) { homeAtkMod *= 1.06; awayAtkMod *= 0.96; }
    if ((a.strongVs || []).includes(homeStyle)) { awayAtkMod *= 1.06; homeAtkMod *= 0.96; }
    return { homeAtkMod, awayAtkMod, homeDefMod, awayDefMod, chaosMod: clamp(chaosMod, 5, 30) };
  }
  function resolveDuel(attack, defence, chaosRange) {
    const diff = attack - defence;
    const baseXG = 1.3 + diff / 20;
    const chaos = randomBetween(-chaosRange, chaosRange) / 100;
    return Math.max(0.1, baseXG * (1 + chaos));
  }
  function simulateMatch(home, away, homeForm, awayForm, derby) {
    const t = applyTacticalMatchup(home.tacticalStyle, away.tacticalStyle);
    const midDiff = home.midfield - away.midfield;
    const homeMid = 1 + midDiff / 200, awayMid = 1 - midDiff / 200;
    const mgrSwing = (home.manager - away.manager) / 300;
    // Derby matches are more volatile and unpredictable
    const derbyChaos = derby ? 8 : 0;
    let homeXG = resolveDuel(home.attack * t.homeAtkMod, away.defence * t.awayDefMod, t.chaosMod + derbyChaos);
    let awayXG = resolveDuel(away.attack * t.awayAtkMod, home.defence * t.homeDefMod, t.chaosMod + derbyChaos);
    homeXG *= homeMid; awayXG *= awayMid;
    homeXG += mgrSwing + (home.homeAdvantage || 0) / 100;
    awayXG -= mgrSwing;
    homeXG *= 1 + (homeForm || 0) / 100;
    awayXG *= 1 + (awayForm || 0) / 100;
    homeXG = Math.max(0.1, homeXG); awayXG = Math.max(0.1, awayXG);
    return { homeGoals: poissonRandom(homeXG), awayGoals: poissonRandom(awayXG) };
  }

  function getTacticalFitMultiplier(playstyle, teamStyle) {
    const fit = {
      "Target Man": { Direct: 1.25, "Route One": 1.2, "Park the Bus": 0.85, Possession: 0.95 },
      "Pace Merchant": { Counter: 1.25, "High Press": 1.15, Direct: 1.1, "Park the Bus": 0.85 },
      Powerhouse: { Direct: 1.15, "Route One": 1.15, Counter: 1.05 },
      "Clinical Finisher": { Possession: 1.2, "High Press": 1.1, Counter: 1.1 },
      Dribbler: { Possession: 1.15, Counter: 1.15, "High Press": 1.05 },
      "Complete Forward": { Possession: 1.1, Counter: 1.1, Direct: 1.05 },
    };
    const base = (fit[playstyle] && fit[playstyle][teamStyle]) || 1.0;
    const adapt = getPillar("Adaptability");
    return base + (base < 1 ? -(adapt - 50) / 200 : (adapt - 50) / 200);
  }
  function getRoleMultiplier(role) {
    return { Star: 1.15, Starter: 1.0, Rotation: 0.7, Bench: 0.4 }[role] || 0.8;
  }
  function getTraitMatchMultiplier(teamStyle) {
    let m = 1;
    if (hasTrait("Speedster") && (teamStyle === "Counter" || teamStyle === "High Press")) m += 0.08;
    if (hasTrait("Aerial Threat") && (teamStyle === "Direct" || teamStyle === "Route One")) m += 0.08;
    if (hasTrait("Powerhouse") && (teamStyle === "Direct" || teamStyle === "Route One")) m += 0.08;
    if (hasTrait("Clinical Finisher") && teamStyle === "Possession") m += 0.08;
    if (hasTrait("Goal Poacher")) m += 0.05;
    if (hasTrait("Set-Piece Specialist")) m += 0.05;
    if (hasTrait("Playmaker")) m += 0.04;
    if (hasTrait("Two-Footed")) m += 0.06;
    if (hasTrait("One-Footed Wonder")) m -= 0.06;
    if (hasTrait("Big Game Player")) m += 0.04;
    if (hasTrait("Leader")) m += 0.04;
    return m;
  }
  function getPositionModifiers() {
    const p = POSITIONS[state.position] || POSITIONS.ST;
    return { goal: p.goalMod, assist: p.assistMod };
  }
  function getPositionTacticalMultiplier(teamStyle) {
    const p = POSITIONS[state.position] || POSITIONS.ST;
    if (p.wide && (teamStyle === "Counter" || teamStyle === "High Press")) return 1.04;
    if (p.central && (teamStyle === "Possession" || teamStyle === "Direct")) return 1.03;
    return 1.0;
  }
  function roleRank(role) {
    return { Star: 4, Starter: 3, Rotation: 2, Bench: 1 }[role] || 0;
  }

  function determineNaturalRole(club) {
    const r = agedRating();
    const teamAtk = TEAM_DATABASE[club].attack;
    const leadership = getPillar("Leadership");
    const gap = r - teamAtk + (leadership - 50) / 15;
    let role;
    if (state.age <= 19 && state.academyTier !== "World Class" && state.academyTier !== "Strong")
      role = gap > 6 ? "Starter" : "Rotation";
    else if (gap >= 6) role = "Star";
    else if (gap >= -3) role = "Starter";
    else if (gap >= -10) role = "Rotation";
    else role = "Bench";
    // A powerful agent can negotiate a stronger squad place
    if (state.agent && state.agent.influence >= 0.25) {
      if (role === "Bench") role = "Rotation";
      if (role === "Rotation") role = "Starter";
    }
    return role;
  }

  function determineRole() {
    let role = determineNaturalRole(state.club);
    // Contractual playtime acts as a floor: a Star contract guarantees Star minutes;
    // a Bench contract still lets a clearly better player earn a natural higher role.
    if (state.contractRole && roleRank(role) < roleRank(state.contractRole)) {
      role = state.contractRole;
    }
    return role;
  }
  function formModifier() {
    let f = 0;
    if (state.flags.inForm) f += 8;
    if (state.flags.coldStreak) f -= 6;
    if (state.flags.redemptionArc) f += 4;
    return f;
  }

  function newTable() {
    const t = {};
    getLeagueClubs(state.club).forEach((c) => (t[c] = { team: c, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0 }));
    return t;
  }
  function recordResult(row, gf, ga) {
    row.P++; row.GF += gf; row.GA += ga;
    if (gf > ga) { row.W++; row.Pts += 3; } else if (gf === ga) { row.D++; row.Pts++; } else row.L++;
  }
  function sortedTable(table) {
    return Object.values(table).sort((a, b) =>
      b.Pts - a.Pts || (b.GF - b.GA) - (a.GF - a.GA) || b.GF - a.GF || a.team.localeCompare(b.team));
  }

  // Minimum stat floor per league tier so lower-division clubs aren't pushed up
  // to the PL floor by updateTeamStrengths / nudge / transfer clamping.
  const TIER_FLOOR = {
    Elite: 75, Europe: 70, Mid: 62, Lower: 58,
    Championship: 55, League1: 42, League2: 35, NationalLeague: 30,
    LaLiga: 62, SerieA: 60, Bundesliga: 62, Saudi: 55, MLS: 55,
  };
  function tierFloor(league) { return TIER_FLOOR[league] || 35; }

  function updateTeamStrengths() {
    // Team strengths evolve between seasons to reflect transfers, managerial
    // changes, and broader market movements. Clubs are capped to stay realistic.
    const clubs = Object.keys(TEAM_DATABASE);
    for (const c of clubs) {
      const t = TEAM_DATABASE[c];
      const floor = tierFloor(t.league);
      const base = t.attack + t.midfield + t.defence + t.manager;
      const volatility = 1.5 + (t.league === "Elite" ? 0.5 : 0); // elite clubs move more
      const drift = Math.round((rand() - 0.5) * volatility * 2);
      const managerChange = rand() < 0.12 ? Math.round((rand() - 0.5) * 4) : 0;
      t.attack = clamp(t.attack + drift, floor, 99);
      t.midfield = clamp(t.midfield + drift, floor, 99);
      t.defence = clamp(t.defence + drift, floor, 99);
      t.manager = clamp(t.manager + managerChange, floor, 99);
      // Slight regression toward original mean to stop runaway inflation
      const change = t.attack + t.midfield + t.defence + t.manager - base;
      if (change > 5) {
        const pull = Math.round((change - 5) / 4);
        t.attack = clamp(t.attack - pull, floor, 99);
        t.midfield = clamp(t.midfield - pull, floor, 99);
        t.defence = clamp(t.defence - pull, floor, 99);
        t.manager = clamp(t.manager - pull, floor, 99);
      } else if (change < -5) {
        const pull = Math.round((Math.abs(change) - 5) / 4);
        t.attack = clamp(t.attack + pull, floor, 99);
        t.midfield = clamp(t.midfield + pull, floor, 99);
        t.defence = clamp(t.defence + pull, floor, 99);
        t.manager = clamp(t.manager + pull, floor, 99);
      }
    }
  }

  function applyPlayerTransferImpact(club, leaving) {
    // A star arrival boosts attack; a departure weakens it.
    const impact = Math.round(clamp(state.reputation / 25, 1, 4));
    if (!TEAM_DATABASE[club]) return;
    const floor = tierFloor(TEAM_DATABASE[club].league);
    if (leaving) {
      TEAM_DATABASE[club].attack = clamp(TEAM_DATABASE[club].attack - impact, floor, 99);
    } else {
      TEAM_DATABASE[club].attack = clamp(TEAM_DATABASE[club].attack + impact, floor, 99);
    }
  }

  function simulateSeason() {
    const club = state.club;
    updateTeamStrengths();
    ensureClubStat(club);
    state.role = determineRole();
    const threat = agedRating();
    const clubData = TEAM_DATABASE[club];
    const table = newTable();
    const fm = formModifier();
    const fitMult = getTacticalFitMultiplier(state.playstyle, clubData.tacticalStyle);
    const roleMult = getRoleMultiplier(state.role);
    const leagueWeights = LEAGUE_WEIGHTS[clubData.league] || LEAGUE_WEIGHTS.Elite;
    const appearanceChance = clamp(({ Star: 0.97, Starter: 0.9, Rotation: 0.6, Bench: 0.3 }[state.role] || 0.7) * leagueWeights.minutes, 0.25, 1.0);
    const mentClutch = mentTag(state.mentality);
    const clutchBonus = ["clutch", "winner", "talisman"].includes(mentClutch) ? state.mentalityRating / 100 : 0;

    const seasonClubs = getLeagueClubs(club);
    const leagueGames = (seasonClubs.length - 1) * 2;

    // injuries — driven by hidden injury proneness, fitness, age, playstyle risk, and Durability pillar
    const fitness = state.attrs.fitness;
    const styleRisk = (PLAYSTYLE_PROFILES[state.playstyle] || {}).injuryRisk || 1;
    let gamesMissed = Math.round((randInt(LEVERS.injuryFreqMin, LEVERS.injuryFreqMax) + state.injuryProneness / 18) * styleRisk) +
      (state.injuryProneSeasons > 0 ? randInt(2, 6) : 0) + (state.age >= 32 ? randInt(1, 4) : 0);
    // Age 35+ injury risk starts to climb and accumulate with past injuries.
    if (state.age >= 35) {
      gamesMissed += randInt(2, 5) + Math.floor((state.age - 34) / 2) * randInt(1, 3) + Math.floor(state.injuryCount / 2);
    }
    const durability = getPillar("Durability");
    gamesMissed = Math.max(0, gamesMissed - Math.round((durability - 50) / 10));
    if (hasTrait("Iron Man")) gamesMissed = Math.max(0, gamesMissed - 6);
    else if (fitness >= 90) gamesMissed = Math.max(0, gamesMissed - 3);
    else if (fitness >= 80) gamesMissed = Math.max(0, gamesMissed - 1);
    if (hasTrait("Injury Prone")) gamesMissed += randInt(3, 7);
    if (["workrate"].includes(mentClutch)) gamesMissed = Math.max(0, gamesMissed - 1);

    // Injury season: an entire campaign derailed by fitness issues, more likely as players get older.
    let injurySeason = false;
    if (state.age >= 30 && rand() < 0.1 + Math.min(0.35, (state.age - 30) * 0.025)) {
      injurySeason = true;
      const missedShare = 0.5 + rand() * 0.5; // 50-100% of league games missed
      gamesMissed = Math.round(leagueGames * missedShare);
      log(`   ↳ 🚑 Injury season: ${state.player.name} is expected to miss ${Math.round(missedShare * 100)}% of the campaign.`, "milestone");
    }

    gamesMissed = clamp(gamesMissed, 0, leagueGames);
    // 48+ players are stopped by a career-ending injury; log and flag retirement.
    if (state.age >= 48 && gamesMissed >= 1) {
      log(`   ↳ 🚑 ${state.player.name} suffers a career-ending injury. At ${state.age}, the body simply won't recover.`, "milestone");
      state.retireNow = true;
    }
    // Track cumulative injury burden: severe games missed add to the count.
    if (gamesMissed >= 4) state.injuryCount += Math.floor(gamesMissed / 4);

    let leagueGoals = 0, assists = 0, apps = 0, cleanSheets = 0, playerMatch = 0;
    let momentum = 0; // shifts with recent results, from -3 to +3
    let lastResults = [];
    const matchHighlights = [];
    for (const h of seasonClubs) {
      for (const a of seasonClubs) {
        if (h === a) continue;
        const home = TEAM_DATABASE[h], away = TEAM_DATABASE[a];
        const involves = h === club || a === club;
        const derby = isDerby(h, a);
        const hForm = h === club ? (fm + momentum * 3) * 0.2 : 0, aForm = a === club ? (fm + momentum * 3) * 0.2 : 0;
        const res = simulateMatch(home, away, hForm, aForm, derby);
        recordResult(table[h], res.homeGoals, res.awayGoals);
        recordResult(table[a], res.awayGoals, res.homeGoals);
        if (!involves) continue;
        playerMatch++;
        const myGoals = h === club ? res.homeGoals : res.awayGoals;
        const oppGoals = h === club ? res.awayGoals : res.homeGoals;
        const playerWon = (h === club && res.homeGoals > res.awayGoals) || (a === club && res.awayGoals > res.homeGoals);
        const opp = h === club ? a : h;
        const oppData = TEAM_DATABASE[opp];
        const isTopOpponent = oppData.attack >= 86;
        const isTitleRace = playerMatch > 28 && (clubData.attack >= 85 || state.reputation >= 70);
        const relegationBattle = playerMatch > 28 && clubData.defence <= 54;

        // Update momentum based on result
        if (playerWon) {
          lastResults.push(1); momentum = clamp(momentum + 0.5, -3, 3);
        } else if (myGoals === oppGoals) {
          lastResults.push(0); momentum = clamp(momentum - 0.2, -3, 3);
        } else {
          lastResults.push(-1); momentum = clamp(momentum - 0.6, -3, 3);
        }
        if (lastResults.length > 5) lastResults.shift();

        const playing = playerMatch > gamesMissed && rand() < appearanceChance;
        if (!playing) continue;
        apps++;
        if (oppGoals === 0) cleanSheets++;
        const posMod = getPositionModifiers();
        const teammateThreat = clubData.attack * 3.2;
        let share = threat / (threat + teammateThreat);
        const styleMod = (PLAYSTYLE_PROFILES[state.playstyle] || {}).goalMod || 1;
        const ki = getPillar("KillerInstinct");
        const killerBonus = 1 + (ki - 50) / 250;
        share *= fitMult * roleMult * styleMod * getTraitMatchMultiplier(clubData.tacticalStyle) * getPositionTacticalMultiplier(clubData.tacticalStyle) * (1 + (fm + momentum * 3) / 100) * (1 + clutchBonus * 0.12) * killerBonus * leagueWeights.goals;
        // Big games: top opponents and derbies bring the best out of stars
        if (isTopOpponent || derby) share *= 1.08;
        if (isTitleRace && (state.role === "Star" || state.role === "Starter")) share *= 1.05;
        share = clamp(share, 0.03, leagueWeights.shareCap || 0.38);
        // Per-match goal expectation is capped per-league — foreign static leagues
        // allow higher individual dominance (Messi/Ronaldo La Liga, Lewandowski Bundesliga).
        const matchGoalLambda = Math.min(myGoals * share * posMod.goal * LEVERS.conversionMultiplier, leagueWeights.matchCap || 0.95);
        const mine = poissonRandom(matchGoalLambda);
        leagueGoals += mine;
        if (myGoals - mine > 0 && rand() < 0.35) assists += poissonRandom((myGoals - mine) * 0.25 * posMod.assist);

        // Capture notable match narratives
        const narrative = generateMatchNarrative(h, a, res.homeGoals, res.awayGoals, true, mine, { titleRace: isTitleRace, relegationBattle: relegationBattle });
        if (narrative) matchHighlights.push({ match: playerMatch, text: narrative, opponent: opp, mine, myGoals });
      }
    }

    // Log a couple of the most dramatic highlights so the season feels like matches, not just numbers
    if (matchHighlights.length) {
      const topHighlights = matchHighlights
        .sort((x, y) => (y.mine - y.myGoals * 0.5) - (x.mine - x.myGoals * 0.5))
        .slice(0, 2);
      for (const hl of topHighlights) {
        log(`   Match ${hl.match}: ${esc(hl.text)}`, "info");
      }
    }

    // cup + european goals (all comps count toward 1000)
    const compFactor = leagueWeights.compFactor;
    const cupEuroGoals = poissonRandom(leagueGoals * compFactor);
    const cupApps = Math.round(cupEuroGoals * 1.3) + (apps > 0 ? randInt(2, 6) : 0);
    // Split cup/European goals proportionally by league prestige
    const europeGoals = Math.round(cupEuroGoals * leagueWeights.europeWeight);
    const cupGoals = cupEuroGoals - europeGoals;
    const seasonGoals = leagueGoals + cupGoals + europeGoals;
    apps += cupApps;

    // cards
    let yellow = poissonRandom(apps * 0.14);
    let red = rand() < (mentClutch === "aggressive" || mentClutch === "negative" ? 0.09 : 0.03) ? 1 : 0;
    if (mentClutch === "aggressive" || mentClutch === "negative") yellow += poissonRandom(2);

    // finalize table
    const sorted = sortedTable(table);
    const pos = sorted.findIndex((r) => r.team === club) + 1;
    const champion = sorted[0].team;
    const trajectory = trajectoryFromPos(pos);
    state.lastTrajectory = trajectory;
    state.leagueTable = sorted;
    // Snapshot all division standings for the Leagues tab
    captureLeagueStandings(sorted);
    // Apply PL finance boosts every season regardless of which division the player is in.
    // When the player is in the PL we use the real simulated table; otherwise we generate
    // a lightweight strength-ranked estimate so all 20 PL clubs still get their finance update.
    if (PL_TIERS.includes(clubData.league)) {
      applyPLFinances(sorted);
    } else {
      const plRanked = rankClubsByStrength(getPLLeagueClubs());
      applyPLFinances(plRanked.map((team) => ({ team })));
    }

    // season rating (influenced by hidden mentality consistency and Consistency pillar)
    const consistency = getPillar("Consistency");
    const mentVar = (mentClutch === "volatile" ? randomBetween(-0.6, 0.6) : 0) * (1 - (consistency - 50) / 100);
    const seasonRating = round1(clamp(6.0 + (seasonGoals / Math.max(apps, 1)) * 4.2 +
      (state.role === "Star" ? 0.4 : 0) + (state.mentalityRating - 60) / 120 + mentVar, 5.3, 9.9));
    state.bestRating = Math.max(state.bestRating, seasonRating);
    const perfTier = performanceTier(seasonGoals, apps, state.role);
    state.lastPerformanceTier = perfTier;

    // ----- honours & awards -----
    const honoursThisSeason = [];
    if (champion === club) {
      state.honours.leagueTitles++; state.clubStats[club].titles++;
      honoursThisSeason.push("League Title");
      state.competitionHistory.push({ season: state.season, club, text: `🏆 League champions with ${club}` });
    }
    // domestic cup (weighted by strength)
    const cupWinner = weightedRandomPick(seasonClubs.map((c) => {
      const t = TEAM_DATABASE[c];
      return { item: c, weight: t.attack + t.defence + t.midfield + t.manager };
    }));
    if (cupWinner === club && rand() < 0.6) {
      state.honours.domesticCups++;
      honoursThisSeason.push("Domestic Cup");
      state.competitionHistory.push({ season: state.season, club, text: `🥇 Won the domestic cup with ${club}` });
    }
    // european trophy (only for top-4 qualifiers, strong teams)
    if (pos <= 4 && clubData.league === "Elite") {
      const euroField = sorted.slice(0, 6).map((r) => ({ item: r.team, weight: TEAM_DATABASE[r.team].attack + TEAM_DATABASE[r.team].defence }));
      const euroWinner = weightedRandomPick(euroField);
      if (euroWinner === club && rand() < 0.5) {
        state.honours.europeanCups++;
        honoursThisSeason.push("European Cup");
        state.competitionHistory.push({ season: state.season, club, text: `🌍 European champions with ${club}!` });
      }
    }
    // individual awards
    const awards = [];
    const bestAttack = Math.max(...seasonClubs.map((c) => TEAM_DATABASE[c].attack));
    const rivalTop = clamp(randInt(19, 26) + Math.round((bestAttack - 84) / 3), 15, 40);
    const isTopScorer = leagueGoals >= rivalTop && leagueGoals >= 16;
    if (isTopScorer) { state.honours.goldenBoots++; awards.push("Golden Boot"); }
    const potsScore = seasonRating * 10 + (champion === club ? 15 : 0) + (isTopScorer ? 15 : 0) + seasonGoals * 0.4 + state.reputation * 0.1;
    if (potsScore >= 128 && (perfTier === "Sensational" || perfTier === "Overperformed")) {
      state.honours.playerOfSeason++; awards.push("Player of the Season");
    }
    if (state.reputation >= 80 && (champion === club || honoursThisSeason.includes("European Cup")) &&
        (isTopScorer || seasonRating >= 8.3) && perfTier === "Sensational") {
      state.honours.ballonDors++; awards.push("Ballon d'Or");
    }
    if (state.age <= 21 && (seasonGoals >= 14 || perfTier === "Sensational" || perfTier === "Overperformed")) {
      state.honours.youngPlayer++; awards.push("Young Player of the Year");
    }
    if (perfTier === "Sensational" || perfTier === "Overperformed" || seasonRating >= 8.0) {
      state.honours.tots++; awards.push("Team of the Season");
    }

    // totals
    state.totalGoals += seasonGoals;
    state.leagueGoals += leagueGoals;
    state.cupGoals += cupGoals;
    state.europeGoals += europeGoals;
    state.totalApps += apps;
    state.totalAssists += assists;
    state.totalYellow += yellow;
    state.totalRed += red;
    state.teamCleanSheets += cleanSheets;
    const cs = state.clubStats[club];
    cs.apps += apps; cs.goals += seasonGoals; cs.assists += assists; cs.seasons++;

    // reputation drift
    let repDelta = { Sensational: 12, Overperformed: 7, "Met Expectation": 2, Underperformed: -3, Flop: -7 }[perfTier];
    if (champion === club) repDelta += 4;
    if (awards.includes("Ballon d'Or")) repDelta += 6;
    repDelta = Math.round(repDelta * leagueWeights.reputation);
    adjustReputation(repDelta);

    // English pyramid promotion/relegation: whichever division the player's
    // club is in already has the fully-simulated table, so pass it through.
    const pyramidLeagues = { PL: true, Championship: true, League1: true, League2: true, NationalLeague: true };
    const playerPoolKey = PL_TIERS.includes(clubData.league) ? "PL" : pyramidLeagues[clubData.league] ? clubData.league : null;
    const promotionRelegation = runPromotionRelegation(sorted, playerPoolKey);
    if (promotionRelegation) {
      const { relegated, promoted, champL1, l1L2, l2NL } = promotionRelegation;
      if (relegated.includes(club)) {
        log(`   ↳ 📉 ${club} are relegated to the Championship.`, "milestone");
      } else if (promoted.includes(club)) {
        log(`   ↳ 📈 ${club} are promoted to the Premier League!`, "milestone");
      } else if (champL1.relegated && champL1.relegated.includes(club)) {
        log(`   ↳ 📉 ${club} are relegated to League One.`, "milestone");
      } else if (champL1.promoted && champL1.promoted.includes(club)) {
        log(`   ↳ 📈 ${club} are promoted to the Championship!`, "milestone");
      } else if (l1L2.relegated && l1L2.relegated.includes(club)) {
        log(`   ↳ 📉 ${club} are relegated to League Two.`, "milestone");
      } else if (l1L2.promoted && l1L2.promoted.includes(club)) {
        log(`   ↳ 📈 ${club} are promoted to League One!`, "milestone");
      } else if (l2NL.relegated && l2NL.relegated.includes(club)) {
        log(`   ↳ 📉 ${club} are relegated to the National League.`, "milestone");
      } else if (l2NL.promoted && l2NL.promoted.includes(club)) {
        log(`   ↳ 📈 ${club} are promoted to League Two!`, "milestone");
      }
    }

    const seasonData = {
      season: state.season, age: state.age, club, role: state.role,
      goals: seasonGoals, leagueGoals, cupGoals, europeGoals, assists, apps, rating: seasonRating,
      yellow, red, cleanSheets, pos, trajectory, perfTier, gamesMissed,
      champion, honours: honoursThisSeason, awards, isTopScorer, promotionRelegation,
    };
    state.seasonHistory.push(seasonData);
    return seasonData;
  }

  function rollLuck() { return Math.round(randBetween(-8, 8)); }

  function recomputePlayerStats() {
    const syn = applyPhysicalSynergy(state.attrs);
    state.attrs = syn.attrs;
    state.synergyNotes = syn.notes;
    state.derived = deriveStats(state.attrs);
    applyDerivedBonuses();
    state.baseRating = calculateStrikerRating(state.attrs);
    const syn2 = computeSynergyMultiplier(state.attrs);
    state.synergyMultiplier = syn2.multiplier;
    state.baseRating = Math.round(clamp(state.baseRating * syn2.multiplier, 40, 99));
    state.synergyNotes = state.synergyNotes.concat(syn2.notes);
    state.playstyle = inferPlaystyle(state.attrs);
    // Recalculate derived durability values when core physicals change
    const academyTier = state.academyTier || (state.academy && state.academy.tier);
    if (academyTier && state.luck !== undefined) {
      state.injuryRating = calculateInjuryRating(state);
      state.longevity = calculateLongevity(state);
      state.injuryProneness = calculateInjuryProneness(state.attrs, academyTier, state.luck, state.injuryRating);
      state.retirementAge = calculateRetirementAge(state.injuryProneness, state.attrs.fitness, state.longevity);
    }
  }

  function applySeasonalAttributeChanges(sd) {
    const a = state.attrs;
    const age = state.age;
    const perf = sd.perfTier;
    const bestFoot = Math.max(a.leftFoot, a.rightFoot);
    const origin = state.player.origin || COUNTRY_ORIGINS["England"];
    const development = origin.development || 1.0;

    // Growth phase: young players improve — playstyle, mentality, origin, determination, potential, professionalism and injury shape the path
    if (age <= 22) {
      let growthPoints = { Sensational: 3, Overperformed: 2, "Met Expectation": 1, Underperformed: 0, Flop: -1 }[perf] || 0;
      if (hasTrait("High Ceiling")) growthPoints += 1;
      const professionalism = getPillar("Professionalism");
      if (professionalism >= 65) growthPoints += 1;
      if (professionalism >= 85) growthPoints += 1;
      // Country development speed
      growthPoints += Math.round((development - 1) * 6);
      // Determination and potential accelerate development
      if (state.determination >= 70) growthPoints += 1;
      if (state.potentialRating >= 80) growthPoints += 1;
      if (state.potentialRating >= 60 && state.baseRating < state.potentialRating) growthPoints += 1;
      // Injury rating drags on development
      if (state.injuryRating >= 70) growthPoints -= 1;
      growthPoints = Math.max(0, growthPoints);
      const tag = mentTag(state.mentality);
      const style = state.playstyle;
      const growthPool = (() => {
        const base = ["heading", "speed", "strength", "leftFoot", "rightFoot", "fitness"];
        // playstyle pushes its favoured attributes
        if (style === "Pace Merchant") return ["speed", "speed", "fitness", "leftFoot", "rightFoot"];
        if (style === "Target Man") return ["heading", "heading", "strength", "fitness", "leftFoot"];
        if (style === "Powerhouse") return ["strength", "strength", "heading", "fitness", "leftFoot"];
        if (style === "Clinical Finisher") return ["leftFoot", "rightFoot", "heading", "speed", "fitness"];
        if (style === "Dribbler") return ["leftFoot", "rightFoot", "speed", "fitness", "heading"];
        // mentality adds a secondary bias
        if (tag === "workrate") return ["fitness", "fitness", "strength", "speed", "heading"];
        if (tag === "clutch") return ["leftFoot", "rightFoot", "heading", "fitness", "speed"];
        if (tag === "aggressive") return ["strength", "heading", "fitness", "speed", "leftFoot"];
        if (tag === "consistency") return ["fitness", "leftFoot", "rightFoot", "heading", "speed"];
        return base;
      })();
      for (let i = 0; i < growthPoints; i++) {
        const key = choice(growthPool);
        a[key] = clamp(a[key] + randInt(1, 2), 40, 99);
      }
    }

    // Decline phase: older players lose sharpness — longevity, professionalism and injury rating soften or accelerate it
    if (age >= 33) {
      const longMod = state.longevity >= 70 ? -1 : state.longevity <= 30 ? 1 : 0;
      const injuryMod = state.injuryRating >= 75 ? 1 : state.injuryRating <= 35 ? -1 : 0;
      const prof = getPillar("Professionalism");
      const profMod = prof >= 75 ? -1 : prof <= 30 ? 1 : 0;
      const decay = Math.max(0, 1 + Math.floor((age - 32) / 2) + longMod + injuryMod + profMod);
      for (let i = 0; i < decay; i++) {
        const key = choice(["speed", "fitness", "strength", "heading"]);
        a[key] = clamp(a[key] - randInt(1, 2), 40, 99);
      }
      // Late bloomers resist the fade
      if (hasTrait("Late Bloomer") && age >= 30) {
        const key = choice(["heading", "leftFoot", "rightFoot"]);
        a[key] = clamp(a[key] + randInt(1, 2), 40, 99);
      }
    }

    // Injuries knock down physical attributes — scaled by injury rating and games missed.
    // Compounding: repeated injuries stack on fitness, speed and strength together.
    if (sd.gamesMissed >= 6) {
      const injurySeverity = state.injuryRating >= 70 ? 1 : 0;
      const missedTier = sd.gamesMissed >= 12 ? 2 : sd.gamesMissed >= 9 ? 1 : 0;
      const baseDrop = 1 + missedTier + injurySeverity;
      const physicalKeys = ["fitness", "speed", "strength"];
      for (const key of physicalKeys) {
        a[key] = clamp(a[key] - randInt(baseDrop, baseDrop + 2), 40, 99);
      }
    }

    // Age 35+ wear and tear: speed and strength gradually erode and build up over time.
    if (age >= 35) {
      const ageWear = randInt(0, 1 + Math.floor((age - 34) / 2));
      const injuryWear = Math.min(state.injuryCount, 10);
      const speedDrop = ageWear + Math.floor(injuryWear / 3);
      const strengthDrop = ageWear + Math.floor(injuryWear / 3);
      a.speed = clamp(a.speed - speedDrop, 40, 99);
      a.strength = clamp(a.strength - strengthDrop, 40, 99);
    }

    // Mentality-driven development: consistent/workhorse players shore up weak spots
    if (hasTrait("Workhorse") && perf !== "Flop" && perf !== "Underperformed") {
      const key = choice(["fitness", "strength"]);
      a[key] = clamp(a[key] + 1, 40, 99);
    }

    // Volatile players can spike or drop a random attribute
    if (hasTrait("Volatile") && rand() < 0.25) {
      const key = choice(["heading", "leftFoot", "rightFoot", "speed"]);
      a[key] = clamp(a[key] + (rand() < 0.5 ? randInt(1, 3) : -randInt(1, 3)), 40, 99);
    }

    // Trait progression: performance, milestones, and age shape DNA evolution
    const xp = { Sensational: 25, Overperformed: 15, "Met Expectation": 8, Underperformed: 3, Flop: 0 }[perf] || 0;
    if (sd.goals >= 30) upgradeTrait("Clinical Finisher", 20);
    if (sd.goals >= 25 && hasTrait("Goal Poacher")) upgradeTrait("Goal Poacher", 15);
    if (sd.assists >= 10 && hasTrait("Playmaker")) upgradeTrait("Playmaker", 15);
    if (sd.isTopScorer) upgradeTrait("Clinical Finisher", 10);
    if (sd.honours && sd.honours.length) upgradeTrait("Big Game Player", 12);
    if (sd.gamesMissed <= 2 && state.totalApps > 50) upgradeTrait("Iron Man", 12);
    if (sd.gamesMissed >= 8 && hasTrait("Injury Prone")) upgradeTrait("Injury Prone", 8);
    if (age <= 22 && state.baseRating >= 80) upgradeTrait("High Ceiling", 15);
    if (age >= 28 && hasTrait("Late Bloomer")) upgradeTrait("Late Bloomer", 12);
    if (age >= 24 && hasTrait("Early Bloomer")) upgradeTrait("Early Bloomer", 8);
    if (state.yearsAtClub >= 4 && hasTrait("One-Club Man")) upgradeTrait("One-Club Man", 10);
    if (state.clubsPlayed.size >= 3 && hasTrait("Journeyman")) upgradeTrait("Journeyman", 10);
    // Generic XP for all existing traits
    state.hiddenTraits.forEach((t) => upgradeTrait(t, xp));
    // Discovery: new traits can emerge mid-career
    if (state.totalGoals >= 100 && a.heading >= 80 && !hasTrait("Aerial Threat")) addTrait("Aerial Threat");
    if (state.totalGoals >= 100 && a.speed >= 85 && !hasTrait("Speedster")) addTrait("Speedster");
    if (state.totalGoals >= 150 && bestFoot >= 88 && !hasTrait("Clinical Finisher")) addTrait("Clinical Finisher");
    if (state.totalGoals >= 50 && a.leftFoot >= 80 && a.rightFoot >= 80 && !hasTrait("Two-Footed")) addTrait("Two-Footed");
    if (state.intlGoals >= 20 && !hasTrait("Big Game Player")) addTrait("Big Game Player");
    if (state.totalGoals >= 200 && !hasTrait("Leader")) addTrait("Leader");

    recomputePlayerStats();
  }

  function trajectoryFromPos(pos) {
    if (pos === 1) return "Title";
    if (pos <= 6) return "Europe";
    if (pos <= 14) return "Mid-table";
    if (pos <= 17) return "Battled Relegation";
    return "Relegated";
  }

  /* -------------------- LEAGUE PYRAMID: PROMOTION / RELEGATION --------------
   * The Premier League (20 clubs, split across the Elite/Europe/Mid/Lower
   * prestige bands used for match-weighting) and the Championship (24 clubs)
   * swap exactly 3 clubs at the end of every season, so both divisions stay
   * a constant size forever:
   *   - Bottom 3 of the PL table are relegated to the Championship.
   *   - Top 2 of the Championship table are promoted automatically; a 3rd
   *     spot is decided by a weighted "play-off" among 3rd-6th place.
   * Foreign leagues (LaLiga, SerieA, Bundesliga, Saudi, MLS) are treated as a
   * single tier in this sim and are not affected.
   *
   * Whichever of PL/Championship the player's club belongs to already has a
   * fully-simulated match-by-match table for this season (computed in
   * simulateSeason); the other division is ranked with a lightweight
   * strength+noise estimate so we don't have to double-simulate an entire
   * division the player never sets foot in.
   */
  function rankClubsByStrength(clubs) {
    return clubs
      .map((c) => {
        const t = TEAM_DATABASE[c];
        return { team: c, score: t.attack + t.midfield + t.defence + t.manager + randomBetween(-6, 6) };
      })
      .sort((a, b) => b.score - a.score)
      .map((r) => r.team);
  }

  function nudgeClubStrength(club, delta) {
    const t = TEAM_DATABASE[club];
    if (!t) return;
    const floor = tierFloor(t.league);
    t.attack   = clamp(t.attack   + delta, floor, 96);
    t.midfield = clamp(t.midfield + delta, floor, 92);
    t.defence  = clamp(t.defence  + delta, floor, 92);
    t.manager  = clamp(t.manager  + delta, floor, 96);
  }

  // ── League Standings snapshot ──────────────────────────────────────────────
  // Captures a sorted table per division after each season so the Leagues tab
  // can display final standings for every tier.
  function captureLeagueStandings(playerSorted) {
    const snap = {};
    // The player's own division uses the already-simulated (accurate) table.
    const playerLeague = TEAM_DATABASE[state.club] && TEAM_DATABASE[state.club].league;
    const addDivision = (label, clubs, existingTable) => {
      if (!clubs.length) return;
      if (existingTable) { snap[label] = existingTable; return; }
      const ranked = rankClubsByStrength(clubs);
      snap[label] = ranked.map((c, i) => ({ team: c, pos: i + 1 }));
    };
    const plClubs = getPLLeagueClubs();
    addDivision("Premier League", plClubs,
      PL_TIERS.includes(playerLeague) ? playerSorted.map((r, i) => ({ ...r, pos: i + 1 })) : null);
    addDivision("Championship", getChampionshipClubs(),
      playerLeague === "Championship" ? playerSorted.map((r, i) => ({ ...r, pos: i + 1 })) : null);
    addDivision("League 1", getLeague1Clubs(),
      playerLeague === "League1" ? playerSorted.map((r, i) => ({ ...r, pos: i + 1 })) : null);
    addDivision("League 2", getLeague2Clubs(),
      playerLeague === "League2" ? playerSorted.map((r, i) => ({ ...r, pos: i + 1 })) : null);
    addDivision("National League", getNationalLeagueClubs(),
      playerLeague === "NationalLeague" ? playerSorted.map((r, i) => ({ ...r, pos: i + 1 })) : null);
    state.leagueStandings = snap;
  }

  // ── PL Finance System ──────────────────────────────────────────────────────
  // Premier League clubs earn revenue based on their final league position each
  // season. Revenue converts to stat boosts (attack / midfield / defence).
  // Non-PL English clubs and foreign clubs are static — no finance modifier.
  //
  // Revenue model (broadcast + prize money approximation):
  //   Base equal-share:  +1 for all PL clubs
  //   Merit payment:     position 1 = +6, position 2 = +5 … position 20 = -4
  //   Longevity bonus:   +1 per season of continuous PL membership (capped at +4)
  //   Relegated penalty: -6 applied when a club drops to Championship
  //
  // Net revenue is then converted to a stat delta using:
  //   delta = round(revenue * 0.08)   — keeps individual season swings small
  //   applied to attack, midfield, defence (manager gets 50% of delta)
  const PL_CLUB_TENURE = {};  // track consecutive seasons in PL per club
  function applyPLFinances(sortedPLTable) {
    if (!sortedPLTable || !sortedPLTable.length) return;
    const n = sortedPLTable.length;
    sortedPLTable.forEach((row, i) => {
      const club = row.team;
      const t = TEAM_DATABASE[club];
      if (!t || !PL_TIERS.includes(t.league)) return;
      // Track tenure
      PL_CLUB_TENURE[club] = (PL_CLUB_TENURE[club] || 0) + 1;
      const tenure = Math.min(PL_CLUB_TENURE[club], 5);
      // Merit: position 1 gets +6 merit, last position gets -(n-14) or so
      // Smoothly: merit = 7 - round((i / (n-1)) * 10)  → ranges +7 to -3
      const merit = Math.round(7 - (i / Math.max(n - 1, 1)) * 10);
      const revenue = 1 + merit + Math.floor(tenure / 2);
      const delta = Math.round(revenue * 0.08);
      if (delta === 0) return;
      const floor = tierFloor(t.league);
      t.attack   = clamp(t.attack   + delta, floor, 99);
      t.midfield = clamp(t.midfield + delta, floor, 99);
      t.defence  = clamp(t.defence  + delta, floor, 99);
      t.manager  = clamp(t.manager  + Math.round(delta * 0.5), floor, 99);
    });
    // Reset tenure for relegated clubs (handled in runPromotionRelegation swap)
    // — clearing happens when a club's league changes to Championship.
    getPLLeagueClubs(); // no-op, tenure reset triggered by league change below
  }
  function onClubRelegate(club) {
    // Called by swapTiers when a PL club is relegated — resets their PL tenure.
    delete PL_CLUB_TENURE[club];
  }

  // playerPoolSortedTable: the `sorted` table array from simulateSeason if the
  // player's club is in the PL or Championship this season, else null.
  // playerPoolKey: "PL" | "Championship" | null (null when the player's club
  // is in a foreign league this season, so both English divisions are
  // estimated with the lightweight ranking).
  // Resolve a single tier boundary: bottom `numRel` clubs in `higherOrder`
  // are swapped with the top clubs in `lowerOrder` (top 2 auto-up + 1 playoff
  // winner for the standard 3-up/3-down English rules). Returns { relegated, promoted }.
  function swapTiers(higherOrder, lowerOrder, higherLeague, lowerLeague, higherLeagueName, lowerLeagueName, numRel, numAuto) {
    if (higherOrder.length < numRel || lowerOrder.length < numAuto + 1) return { relegated: [], promoted: [] };
    const relegated = higherOrder.slice(-numRel);
    const autoPromoted = lowerOrder.slice(0, numAuto);
    const playoffField = lowerOrder.slice(numAuto, numAuto + 4);
    const playoffWinner = playoffField.length
      ? weightedRandomPick(playoffField.map((c, i) => ({ item: c, weight: playoffField.length - i })))
      : null;
    const promoted = [...autoPromoted, playoffWinner].filter(Boolean);
    for (const club of relegated) {
      if (!TEAM_DATABASE[club]) continue;
      if (TEAM_DATABASE[club].league !== lowerLeague && PL_TIERS.includes(TEAM_DATABASE[club].league)) onClubRelegate(club);
      TEAM_DATABASE[club].league = lowerLeague;
      nudgeClubStrength(club, -4);
    }
    for (const club of promoted) {
      if (!TEAM_DATABASE[club]) continue;
      TEAM_DATABASE[club].league = higherLeague;
      nudgeClubStrength(club, 4);
    }
    return { relegated, promoted };
  }

  function runPromotionRelegation(playerPoolSortedTable, playerPoolKey) {
    const plClubs    = getPLLeagueClubs();
    const champClubs = getChampionshipClubs();
    const l1Clubs    = getLeague1Clubs();
    const l2Clubs    = getLeague2Clubs();
    const nlClubs    = getNationalLeagueClubs();

    // Safety guards: need enough clubs in each division to run meaningful swaps
    if (plClubs.length < 3 || champClubs.length < 6) return null;

    // Ranked orders — use the actual simulated table when the player is in that division
    const plOrder    = playerPoolKey === "PL"            && playerPoolSortedTable ? playerPoolSortedTable.map((r) => r.team) : rankClubsByStrength(plClubs);
    const champOrder = playerPoolKey === "Championship"  && playerPoolSortedTable ? playerPoolSortedTable.map((r) => r.team) : rankClubsByStrength(champClubs);
    const l1Order    = playerPoolKey === "League1"       && playerPoolSortedTable ? playerPoolSortedTable.map((r) => r.team) : rankClubsByStrength(l1Clubs);
    const l2Order    = playerPoolKey === "League2"       && playerPoolSortedTable ? playerPoolSortedTable.map((r) => r.team) : rankClubsByStrength(l2Clubs);
    const nlOrder    = playerPoolKey === "NationalLeague" && playerPoolSortedTable ? playerPoolSortedTable.map((r) => r.team) : rankClubsByStrength(nlClubs);

    // PL <-> Championship: 3 relegated, 3 promoted (2 auto + 1 playoff)
    const plChamp = swapTiers(plOrder, champOrder, "Lower", "Championship", "Premier League", "Championship", 3, 2);

    // Championship <-> League 1: 3 relegated, 3 promoted (2 auto + 1 playoff)
    // Re-fetch after PL swap mutated leagues
    const champOrderFresh = rankClubsByStrength(getChampionshipClubs());
    const l1OrderFresh    = l1Order;
    const champL1 = l1Clubs.length >= 6
      ? swapTiers(champOrderFresh, l1OrderFresh, "Championship", "League1", "Championship", "League 1", 3, 2)
      : { relegated: [], promoted: [] };

    // League 1 <-> League 2: 3 relegated, 3 promoted (2 auto + 1 playoff)
    const l1OrderFresh2 = rankClubsByStrength(getLeague1Clubs());
    const l2OrderFresh  = l2Order;
    const l1L2 = l2Clubs.length >= 6
      ? swapTiers(l1OrderFresh2, l2OrderFresh, "League1", "League2", "League 1", "League 2", 3, 2)
      : { relegated: [], promoted: [] };

    // League 2 <-> National League: 2 relegated (no automatic promotion for NL clubs,
    // just 1 auto + 1 playoff from NL side to stay realistic)
    const l2OrderFresh2 = rankClubsByStrength(getLeague2Clubs());
    const nlOrderFresh  = nlOrder;
    const l2NL = nlClubs.length >= 4
      ? swapTiers(l2OrderFresh2, nlOrderFresh, "League2", "NationalLeague", "League 2", "National League", 2, 1)
      : { relegated: [], promoted: [] };

    return {
      relegated:  plChamp.relegated,
      promoted:   plChamp.promoted,
      champL1,
      l1L2,
      l2NL,
    };
  }
  function performanceTier(goals, apps, role) {
    const per = goals / Math.max(apps, 1);
    if (goals >= 30 || per >= 0.95) return "Sensational";
    if (goals >= 20 || per >= 0.7) return "Overperformed";
    if (goals >= 12 || per >= 0.45) return "Met Expectation";
    if (goals >= 6) return "Underperformed";
    return "Flop";
  }
  function ageBracket(age) {
    if (age <= 20) return "Wonderkid";
    if (age <= 24) return "Rising";
    if (age <= 29) return "Prime";
    if (age <= 33) return "Veteran";
    return "Twilight";
  }
  function reputationTier(rep) {
    if (rep >= 90) return "Icon";
    if (rep >= 75) return "Superstar";
    if (rep >= 55) return "Star";
    if (rep >= 35) return "Squad Player";
    return "Unknown";
  }
  function adjustReputation(delta) {
    state.reputation = clamp(state.reputation + delta, 0, 100);
    state.reputationTier = reputationTier(state.reputation);
  }

  /* ---------------------- INTERNATIONAL CAREER -------------------------- */
  function deriveInternationalTrait() {
    const origin = state.player.origin || COUNTRY_ORIGINS["England"];
    const tag = mentTag(state.mentality);
    const strength = origin.intlStrength || 80;
    const difficulty = origin.intlDifficulty || 5;
    const chances = { icon: 0.2, nationalistic: 0.2, balanced: 0.6 };
    // Elite football nations and clutch/winner mentalities lean toward "icon".
    if (strength >= 85 && difficulty >= 6) {
      chances.icon += 0.12;
      chances.balanced -= 0.12;
    }
    if (["clutch", "winner", "talisman"].includes(tag)) {
      chances.icon += 0.1;
      chances.balanced -= 0.1;
    }
    // Nations with passionate or hard paths and leader/workrate mentalities lean toward "nationalistic".
    if (difficulty >= 4) {
      chances.nationalistic += 0.08;
      chances.balanced -= 0.08;
    }
    if (["leader", "workrate", "consistency"].includes(tag)) {
      chances.nationalistic += 0.08;
      chances.balanced -= 0.08;
    }
    const r = rand();
    let c = 0;
    if (r < (c += chances.icon)) return "icon";
    if (r < (c += chances.nationalistic)) return "nationalistic";
    return "balanced";
  }

  const INTERNATIONAL_TOURNAMENTS = {
    WorldCup: {
      name: "FIFA World Cup",
      emoji: "🌍",
      governing: "FIFA",
      frequency: 4,
      firstHeld: 1930,
      context: "The most prestigious tournament in international football. Only eight nations have ever won it.",
      topCountries: { Brazil: 5, "Germany (incl. West Germany)": 4, Italy: 4, Argentina: 3, France: 2, Uruguay: 2, England: 1, Spain: 1 },
      recentWinners: ["2022: Argentina", "2018: France", "2014: Germany", "2010: Spain", "2006: Italy", "2002: Brazil", "1998: France", "1994: Brazil"]
    },
    Euro: {
      name: "UEFA European Championship",
      emoji: "🇪🇺",
      governing: "UEFA",
      frequency: 4,
      firstHeld: 1960,
      context: "The premier continental tournament for European nations. Ten different countries have won it.",
      topCountries: { Spain: 4, "Germany (incl. West Germany)": 3, France: 2, Italy: 2 },
      recentWinners: ["2024: Spain", "2020 (21): Italy", "2016: Portugal", "2012: Spain", "2008: Spain", "2004: Greece", "2000: France", "1996: Germany"]
    },
    AFCON: {
      name: "Africa Cup of Nations",
      emoji: "🇿🇦",
      governing: "CAF",
      frequency: 2,
      firstHeld: 1957,
      context: "Africa's most prestigious national team tournament, known for passionate crowds and unpredictable outcomes.",
      topCountries: { Egypt: 7, Cameroon: 5, Ghana: 4, "Côte d'Ivoire": 3, Nigeria: 3 },
      recentWinners: ["2025: Senegal", "2023: Côte d'Ivoire", "2021: Senegal", "2019: Algeria", "2017: Cameroon", "2015: Côte d'Ivoire", "2013: Nigeria", "2012: Zambia"]
    },
    CopaAmerica: {
      name: "Copa América",
      emoji: "🌎",
      governing: "CONMEBOL",
      frequency: 2,
      firstHeld: 1916,
      context: "The oldest international continental football tournament. Eight of the ten CONMEBOL members have won it at least once.",
      topCountries: { Argentina: 16, Uruguay: 15, Brazil: 9 },
      recentWinners: ["2024: Argentina", "2021: Argentina", "2019: Brazil", "2016: Chile", "2015: Chile", "2011: Uruguay", "2007: Brazil", "2004: Brazil"]
    },
    AsianCup: {
      name: "AFC Asian Cup",
      emoji: "🌏",
      governing: "AFC",
      frequency: 4,
      firstHeld: 1956,
      context: "The premier continental competition for Asian nations. Australia has competed since joining the AFC.",
      topCountries: { Japan: 4, Iran: 3, "Saudi Arabia": 3, "South Korea": 2 },
      recentWinners: ["2023: Qatar", "2019: Qatar", "2015: Australia", "2011: Japan", "2007: Iraq", "2004: Japan", "2000: Japan", "1996: Saudi Arabia"]
    },
    GoldCup: {
      name: "CONCACAF Gold Cup",
      emoji: "🇺🇸",
      governing: "CONCACAF",
      frequency: 2,
      firstHeld: 1963,
      context: "The premier tournament for North, Central America and the Caribbean.",
      topCountries: { Mexico: 12, "United States": 7, "Costa Rica": 3 },
      recentWinners: ["2025: Mexico", "2023: Mexico", "2021: USA", "2019: Mexico", "2017: USA", "2015: Mexico", "2013: USA", "2011: Mexico"]
    },
    OFCNationsCup: {
      name: "OFC Nations Cup",
      emoji: "🇳🇿",
      governing: "OFC",
      frequency: 4,
      firstHeld: 1973,
      context: "Oceania's premier national team tournament. Australia left the OFC to join the AFC in 2006.",
      topCountries: { "New Zealand": 6, Australia: 4, Tahiti: 1 },
      recentWinners: ["2024: New Zealand", "2016: New Zealand", "2012: Tahiti", "2008: New Zealand", "2004: Australia", "2002: New Zealand", "2000: Australia", "1998: Australia"]
    }
  };
  const TOURNAMENT_BY_CONFEDERATION = {
    UEFA: "Euro",
    CONMEBOL: "CopaAmerica",
    CAF: "AFCON",
    AFC: "AsianCup",
    CONCACAF: "GoldCup",
    OFC: "OFCNationsCup"
  };
  function getTournamentForSeason() {
    const cycle = state.season % 4;
    if (cycle === 0) return INTERNATIONAL_TOURNAMENTS.WorldCup;
    if (cycle === 2) {
      const conf = getCountryConfederation(state.country);
      const key = TOURNAMENT_BY_CONFEDERATION[conf] || "WorldCup";
      return INTERNATIONAL_TOURNAMENTS[key];
    }
    return null;
  }

  function getNationalTeam() {
    const origin = state.player.origin || COUNTRY_ORIGINS["England"];
    const strength = origin.intlStrength || 80;
    return {
      name: state.country,
      attack: strength,
      midfield: Math.round(strength * 0.96),
      defence: Math.round(strength * 0.97),
      manager: Math.round(strength * 0.95),
      tacticalStyle: "Possession",
      homeAdvantage: 6,
    };
  }

  function getOpponentDifficulty() {
    const origin = state.player.origin || COUNTRY_ORIGINS["England"];
    const d = origin.intlDifficulty || 5;
    // Easy groups (1-3) = weaker opponents, hard (8-10) = stronger opponents, plus fewer caps
    const baseMin = 55 + d * 2; // 57-75
    const baseMax = 70 + d * 2; // 72-90
    return { min: baseMin, max: baseMax, difficulty: d };
  }

  function simulateInternational() {
    if (state.intlRetired) return null;
    const origin = state.player.origin || COUNTRY_ORIGINS["England"];
    const nat = getNationalTeam();
    if (!state.intlDebut && state.reputation >= 45) {
      state.intlDebut = true;
      log(`🦁 ${state.player.name} earns a first ${state.country} call-up!`, "intl");
    }
    if (!state.intlDebut) return null;
    const tournament = getTournamentForSeason();
    const isTournament = !!tournament;
    const tournamentName = tournament ? tournament.name : null;
    const oppDiff = getOpponentDifficulty();
    // Hard confederations have fewer caps and fewer easy games
    let games = isTournament ? randInt(5, 7) : randInt(4, 6);
    if (oppDiff.difficulty >= 8) games = Math.max(2, games - 1);
    if (oppDiff.difficulty <= 2) games += 1;
    // "Icon" players get selected for more big international summers.
    if (state.intlTrait === "icon" && isTournament) games += 1;
    let g = 0;
    let caps = 0;
    const trait = state.intlTrait || "balanced";
    for (let i = 0; i < games; i++) {
      const opp = { attack: randInt(oppDiff.min, oppDiff.max), midfield: randInt(oppDiff.min, oppDiff.max), defence: randInt(oppDiff.min, oppDiff.max), manager: randInt(oppDiff.min, oppDiff.max), tacticalStyle: choice(["Possession", "Counter", "High Press", "Direct"]), homeAdvantage: 4 };
      const res = simulateMatch(nat, opp, 0, 0);
      const teammateThreat = nat.attack * 4;
      let share = clamp(agedRating() / (agedRating() + teammateThreat), 0.03, 0.42);
      // Hard groups: team scores fewer, individual share is higher, but raw chances are scarce
      if (oppDiff.difficulty >= 8) share *= 0.85;
      // Hidden international trait: icons are more decisive, nationalists score more.
      if (trait === "icon") share *= 1.15;
      if (trait === "nationalistic") share *= 1.2;
      g += poissonRandom(res.homeGoals * share * 0.85);
      caps++;
    }
    state.intlCaps += caps;
    state.intlGoals += g;
    state.totalGoals += g;
    let wonTrophy = false;
    let trophyChance = 0.15;
    if (trait === "icon") trophyChance += 0.1;
    if (trait === "nationalistic") trophyChance += 0.05;
    if (isTournament && (g >= 3 || rand() < trophyChance) && state.reputation >= 60) {
      wonTrophy = true;
      state.honours.intlTrophies++;
      const trophyLabel = tournament ? tournament.name : "an international tournament";
      state.competitionHistory.push({ season: state.season, club: state.country, text: `🦁 Won ${trophyLabel} with ${state.country} (${g} goals)` });
      adjustReputation(8);
      log(`🏆 Tournament glory! ${state.player.name} lifts ${trophyLabel} silverware with ${state.country} (${g} goals).`, "intl");
    }
    return { caps, games: caps, goals: g, isTournament, tournamentName, wonTrophy };
  }

  /* ------------------------- DECISION ENGINE ---------------------------- */
  /*
  const EVENTS = [

    { id: "breakout", category: "PERFORMANCE", base: 6, req: { perf: ["Overperformed", "Sensational"], ageMax: 24 },
      text: (n) => `${n} explodes onto the scene with a breakout season. The hype is real.`,
      choices: [{ label: "Stay humble, keep working", fx: { rep: 4, flag: "fanFavorite" } }, { label: "Embrace the spotlight", fx: { rep: 8, flag: "mediaTarget" } }] },
    { id: "golden_boot_race", category: "PERFORMANCE", base: 5, req: { perf: ["Sensational"] },
      text: (n) => `Final day and ${n} is in a three-way Golden Boot race!`,
      choices: [{ label: "Go for glory — shoot on sight", fx: { rep: 6, goals: () => randInt(1, 3), flag: "inForm" } }, { label: "Play for the team", fx: { rep: 3, assists: () => randInt(1, 3) } }] },
    { id: "bench_frustration", category: "PERFORMANCE", base: 6, req: { perf: ["Underperformed", "Flop"], roleIn: ["Rotation", "Bench"] },
      text: (n) => `${n} is frustrated after another spell on the bench.`,
      choices: [{ label: "Talk with the manager", fx: { rep: 1, flag: "managerConflict" } }, { label: "Stay patient, train harder", fx: { rep: 2, flag: "redemptionArc" } }, { label: "Ask to leave", fx: { forceTransfer: true } }] },
    { id: "scapegoat", category: "PERFORMANCE", base: 5, req: { traj: ["Relegated", "Battled Relegation"], perf: ["Flop", "Underperformed"] },
      text: (n) => `The fans need someone to blame, and ${n} is in the crosshairs.`,
      choices: [{ label: "Take responsibility publicly", fx: { rep: -2, flag: "fanFavorite" } }, { label: "Blame teammates", fx: { rep: -6, flag: "burnedBridges" } }, { label: "Go quiet", fx: { rep: -3 } }] },
    // trajectory
    { id: "title_winner", category: "TRAJECTORY", base: 8, req: { traj: ["Title"] },
      text: (n) => `CHAMPIONS! ${n}'s club is crowned league winners.`,
      choices: [{ label: "Stay and defend the title", fx: { rep: 6, flag: "fanFavorite" } }, { label: "Use it as a platform to leave", fx: { rep: 4, forceTransfer: true } }] },
    { id: "cup_final", category: "TRAJECTORY", base: 6, req: { traj: ["Title", "Europe"] },
      text: (n) => `${n}'s side reaches a major cup final. Ninety minutes from glory.`,
      choices: [{ label: "Step up in the big moment", fx: { rep: 7, goals: () => randInt(1, 2), flag: "inForm" } }, { label: "Let the team carry it", fx: { rep: 3 } }] },
    { id: "relegated", category: "TRAJECTORY", base: 7, req: { traj: ["Relegated"] },
      text: (n) => `Heartbreak. ${n}'s club is relegated.`,
      choices: [{ label: "Stay and fight back up", fx: { rep: 2, flag: "fanFavorite" } }, { label: "Force an exit to a bigger club", fx: { rep: -2, forceTransfer: true } }] },
    { id: "manager_sacked", category: "TRAJECTORY", base: 4, req: { traj: ["Mid-table", "Battled Relegation", "Relegated"] },
      text: () => `The manager is sacked. A new boss arrives with a completely different system.`,
      choices: [{ label: "Adapt to the new tactics", fx: { rep: 2 } }, { label: "Clash with the new philosophy", fx: { flag: "managerConflict" } }] },
    // MENTALITY — driven by trait tags + hidden rating
    { id: "captain_armband", category: "MENTALITY", base: 7, req: { mentTag: ["leader"], yearsMin: 3 },
      text: (n) => `After years of service, ${n} is handed the captain's armband.`,
      choices: [{ label: "Lead from the front", fx: { rep: 6, flag: "fanFavorite" } }] },
    { id: "clutch_moment", category: "MENTALITY", base: 7, req: { mentTag: ["clutch", "winner", "talisman"], traj: ["Title", "Europe"] },
      text: (n) => `Penalty shootout. The stadium holds its breath as ${n} steps up.`,
      choices: [{ label: "Ice in the veins — bury it", fx: { rep: 6, goals: () => 1, flag: "inForm" } }] },
    { id: "maverick_viral", category: "MENTALITY", base: 6, req: { mentTraits: ["Maverick", "Mercurial"] },
      text: (n) => `An outrageous piece of skill from ${n} goes viral worldwide.`,
      choices: [{ label: "Milk the fame", fx: { rep: 7, flag: "mediaTarget" } }, { label: "Stay focused on football", fx: { rep: 3, flag: "inForm" } }] },
    { id: "temper_bustup", category: "MENTALITY", base: 6, req: { mentTag: ["negative", "volatile", "aggressive"], mentRatingMax: 60 },
      text: (n) => `A training-ground bust-up: ${n} squares up to a teammate after a poor result.`,
      choices: [{ label: "Apologise publicly", fx: { rep: 1, flag: "redemptionArc" } }, { label: "Demand a transfer", fx: { rep: -5, forceTransfer: true, flag: "burnedBridges" } }, { label: "Let your agent handle it", fx: { flag: "unsettled" } }] },
    { id: "relentless_ironman", category: "MENTALITY", base: 5, req: { mentTag: ["workrate", "consistency"] },
      text: (n) => `${n}'s relentless work ethic sees them play almost every minute.`,
      choices: [{ label: "Durability reputation grows", fx: { rep: 3 } }] },
    { id: "loyalty_test", category: "MENTALITY", base: 5, req: { mentTag: ["leader", "consistency"], repMin: 55 },
      text: (n) => `A huge offer arrives, but the club wants ${n} to sign a loyalty extension.`,
      choices: [{ label: "Sign for life", fx: { rep: 5, flag: "fanFavorite" } }, { label: "Chase the money", fx: { rep: -2, forceTransfer: true } }] },
    // injury / media
    { id: "serious_injury", category: "INJURY", base: 3, req: { ageMin: 29 },
      text: (n) => `Disaster — ${n} suffers a serious knee injury.`,
      choices: [{ label: "Begin the long road back", fx: { rep: -2, flag: "injuryProne", injuryProne: 2 } }] },
    { id: "sponsorship", category: "MEDIA", base: 4, req: { repMin: 55 },
      text: (n) => `A major boot brand offers ${n} a lucrative sponsorship deal.`,
      choices: [{ label: "Sign the deal", fx: { rep: 2 } }] },
    { id: "ballon_shortlist", category: "MEDIA", base: 4, req: { perf: ["Sensational"], repMin: 75 },
      text: (n) => `${n} is shortlisted for the Ballon d'Or!`,
      choices: [{ label: "An incredible honour", fx: { rep: 6, flag: "inForm" } }] },
    { id: "pundit_criticism", category: "MEDIA", base: 4, req: { perf: ["Underperformed", "Flop"], repMin: 55 },
      text: (n) => `Pundits queue up to criticise ${n} after a poor run.`,
      choices: [{ label: "Respond with a classy interview", fx: { rep: 2 } }, { label: "Hit back at the critics", fx: { rep: -2, flag: "mediaTarget" } }] },
    // ---- new events (Alpha 1.2) ----
    // PERFORMANCE
    { id: "hat_trick_heroics", category: "PERFORMANCE", base: 5, req: { perf: ["Sensational"] },
      text: (n) => `${n} bags a hat-trick in a crucial match — the crowd is on their feet.`,
      choices: [{ label: "Celebrate with the fans", fx: { rep: 5, flag: "fanFavorite" } }, { label: "Stay clinical, focus on the next game", fx: { rep: 3, flag: "inForm" } }] },
    { id: "goal_drought", category: "PERFORMANCE", base: 5, req: { perf: ["Underperformed", "Flop"] },
      text: (n) => `${n} hasn't scored in eight games. The press is counting the days.`,
      choices: [{ label: "Extra shooting practice after training", fx: { rep: 2, flag: "redemptionArc" } }, { label: "Change your boots for luck", fx: { rep: 1 } }, { label: "Speak to a sports psychologist", fx: { rep: 2, flag: "inForm" } }] },
    { id: "scoring_streak", category: "PERFORMANCE", base: 5, req: { perf: ["Sensational", "Overperformed"] },
      text: (n) => `${n} has scored in six consecutive games. The record is in sight.`,
      choices: [{ label: "Keep the streak alive — shoot on sight", fx: { rep: 4, goals: () => randInt(1, 2), flag: "inForm" } }, { label: "Don't force it — let it come naturally", fx: { rep: 2 } }] },
    { id: "assist_king", category: "PERFORMANCE", base: 4, req: { perf: ["Overperformed", "Sensational"] },
      text: (n) => `${n} is leading the league in assists — the ultimate team player.`,
      choices: [{ label: "Embrace the playmaker role", fx: { rep: 4, assists: () => randInt(1, 3) } }, { label: "I'm a striker — I should be scoring", fx: { rep: 1, flag: "managerConflict" } }] },
    // TRAJECTORY
    { id: "derby_hero", category: "TRAJECTORY", base: 6, req: { traj: ["Title", "Europe", "Mid-table"] },
      text: (n) => `Derby day. The atmosphere is electric and ${n} is in the starting XI.`,
      choices: [{ label: "Rise to the occasion", fx: { rep: 5, goals: () => randInt(1, 2), flag: "fanFavorite" } }, { label: "Keep a cool head — don't get caught up", fx: { rep: 2 } }] },
    { id: "european_night", category: "TRAJECTORY", base: 5, req: { traj: ["Title", "Europe"] },
      text: (n) => `Under the floodlights in Europe, ${n} has a chance to make a name on the continent.`,
      choices: [{ label: "Seize the moment", fx: { rep: 6, goals: () => randInt(1, 3), flag: "inForm" } }, { label: "Play it safe — don't lose position", fx: { rep: 2 } }] },
    { id: "relegation_battle", category: "TRAJECTORY", base: 6, req: { traj: ["Battled Relegation", "Relegated"] },
      text: (n) => `Six-pointer. ${n}'s team needs a hero to drag them to safety.`,
      choices: [{ label: "Put the team on your back", fx: { rep: 4, goals: () => randInt(1, 2), flag: "fanFavorite" } }, { label: "This squad isn't good enough — let me leave", fx: { rep: -2, forceTransfer: true } }] },
    { id: "new_manager_bounce", category: "TRAJECTORY", base: 4, req: { traj: ["Mid-table", "Battled Relegation"] },
      text: (n) => `A new manager comes in and immediately builds the attack around ${n}.`,
      choices: [{ label: "Repay the faith with goals", fx: { rep: 3, flag: "inForm" } }, { label: "Wait and see if it lasts", fx: { rep: 1 } }] },
    // MENTALITY
    { id: "vice_captain", category: "MENTALITY", base: 5, req: { mentTag: ["leader", "consistency", "workrate"], yearsMin: 2 },
      text: (n) => `The manager names ${n} vice-captain — a sign of growing respect.`,
      choices: [{ label: "Step up as a leader", fx: { rep: 4, flag: "fanFavorite" } }, { label: "Lead by example on the pitch", fx: { rep: 3, flag: "inForm" } }] },
    { id: "comeback_story", category: "MENTALITY", base: 5, req: { mentTag: ["leader", "clutch", "winner", "workrate"], perf: ["Overperformed", "Sensational"] },
      text: (n) => `After early setbacks, ${n} silences the doubters with a stunning resurgence.`,
      choices: [{ label: "I never stopped believing", fx: { rep: 5, flag: "fanFavorite" } }, { label: "Use this as fuel — keep pushing", fx: { rep: 3, flag: "inForm" } }] },
    { id: "contract_renewal", category: "MENTALITY", base: 4, req: { repMin: 40, yearsMin: 2 },
      text: (n) => `The board offers ${n} a lucrative contract extension.`,
      choices: [{ label: "Sign — this is home", fx: { rep: 3, flag: "fanFavorite" } }, { label: "Demand a release clause", fx: { rep: 1, flag: "unsettled" } }, { label: "Reject — I want a bigger club", fx: { rep: -3, forceTransfer: true } }] },
    // INJURY
    { id: "minor_injury", category: "INJURY", base: 4, req: { ageMin: 25 },
      text: (n) => `${n} picks up a minor hamstring strain — nothing serious, but timing is frustrating.`,
      choices: [{ label: "Rush back to help the team", fx: { flag: "injuryProne", injuryProne: 1 } }, { label: "Take full time to recover properly", fx: { rep: 1 } }] },
    { id: "training_injury", category: "INJURY", base: 3,
      text: (n) => `A freak training-ground accident leaves ${n} sidelined for weeks.`,
      choices: [{ label: "Work hard in rehab", fx: { rep: 1, flag: "redemptionArc" } }, { label: "Come back too fast and risk it", fx: { flag: "injuryProne", injuryProne: 2 } }] },
    // MEDIA
    { id: "viral_moment", category: "MEDIA", base: 4, req: { perf: ["Sensational", "Overperformed"] },
      text: (n) => `${n}'s wonder goal circulates social media — millions of views overnight.`,
      choices: [{ label: "Enjoy the fame", fx: { rep: 5, flag: "mediaTarget" } }, { label: "Stay grounded — it's just one goal", fx: { rep: 2, flag: "fanFavorite" } }] },
    { id: "charity_work", category: "MEDIA", base: 3, req: { repMin: 30 },
      text: (n) => `${n} visits a local children's hospital — the photos melt hearts everywhere.`,
      choices: [{ label: "Keep it quiet — it's not for the cameras", fx: { rep: 4, flag: "fanFavorite" } }, { label: "Use the platform to raise awareness", fx: { rep: 5, flag: "fanFavorite" } }] },
    { id: "social_media_storm", category: "MEDIA", base: 4, req: { perf: ["Underperformed", "Flop"] },
      text: (n) => `${n}'s cryptic social media post sparks a storm of speculation.`,
      choices: [{ label: "Clarify — it was taken out of context", fx: { rep: 1 } }, { label: "Delete and say nothing", fx: { rep: -2, flag: "mediaTarget" } }, { label: "Double down — I meant what I said", fx: { rep: -3, flag: "burnedBridges" } }] },
    { id: "transfer_speculation", category: "MEDIA", base: 5, req: { repMin: 50, yearsMin: 2 },
      text: (n) => `The papers link ${n} with a mega-money move abroad. The agent is fielding calls.`,
      choices: [{ label: "Shut it down — I'm happy here", fx: { rep: 3, flag: "fanFavorite" } }, { label: "Keep options open — never say never", fx: { flag: "unsettled" } }, { label: "Encourage the interest", fx: { rep: -2, forceTransfer: true } }] },
    // TEAM
    { id: "teammate_bond", category: "TEAM", base: 4,
      text: (n) => `${n} develops an uncanny on-pitch understanding with a new signing.`,
      choices: [{ label: "Build the partnership", fx: { rep: 2, flag: "inForm", assists: () => randInt(1, 2) } }, { label: "Focus on your own game", fx: { rep: 1 } }] },
    { id: "position_rivalry", category: "TEAM", base: 4, req: { roleIn: ["Rotation", "Bench"] },
      text: (n) => `A new signing plays in ${n}'s position. The competition is on.`,
      choices: [{ label: "Rise to the challenge", fx: { rep: 3, flag: "inForm" } }, { label: "Ask the manager for guarantees", fx: { flag: "managerConflict" } }, { label: "Seek a move elsewhere", fx: { rep: -1, forceTransfer: true } }] },
    { id: "fan_appreciation", category: "TEAM", base: 4, req: { repMin: 50, perf: ["Sensational", "Overperformed"] },
      text: (n) => `The supporters sing ${n}'s name non-stop. A genuine fan favourite.`,
      choices: [{ label: "Soak it in — this is what it's all about", fx: { rep: 4, flag: "fanFavorite" } }, { label: "Stay focused — don't get complacent", fx: { rep: 2, flag: "inForm" } }] },
    { id: "record_chase", category: "TEAM", base: 4, req: { repMin: 60 },
      text: (n) => `${n} is closing in on the club's all-time scoring record. The fans can feel it.`,
      choices: [{ label: "Chase the record — it's meant to be", fx: { rep: 5, goals: () => randInt(1, 2), flag: "inForm" } }, { label: "Records don't matter — winning does", fx: { rep: 3, flag: "fanFavorite" } }] },
    // ---- new carry-over / attribute events (Alpha 1.2) ----
    { id: "preseason_training", category: "TRAINING", base: 4, req: { perf: ["Met Expectation", "Overperformed", "Sensational"] },
      text: (n) => `Pre-season is brutal. The coaching staff push ${n} harder than ever.`,
      choices: [
        { label: "Embrace the workload — build the engine", fx: { attrChange: { key: "fitness", delta: 2 }, carryOver: true, carryOverLog: "Pre-season graft pays off — fitness is up next season." } },
        { label: "Pace yourself — longevity matters", fx: { attrChange: { key: "fitness", delta: 1 } } },
      ] },
    { id: "personal_trainer", category: "TRAINING", base: 3, req: { repMin: 40 },
      text: (n) => `${n} hires a specialist finishing coach for the summer.`,
      choices: [
        { label: "Improve left foot", fx: { attrChange: { key: "leftFoot", delta: 2 }, carryOver: true, carryOverLog: "Summer finishing work on the left foot pays off next season." } },
        { label: "Improve right foot", fx: { attrChange: { key: "rightFoot", delta: 2 }, carryOver: true, carryOverLog: "Summer finishing work on the right foot pays off next season." } },
      ] },
    { id: "sports_science", category: "TRAINING", base: 3, req: { repMin: 35 },
      text: (n) => `The club invests in a new sports science department and targets ${n}.`,
      choices: [
        { label: "Prioritise speed", fx: { attrChange: { key: "speed", delta: 2 }, carryOver: true, carryOverLog: "Sports science programme boosts pace for next season." } },
        { label: "Prioritise strength", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Strength programme shows dividends next season." } },
      ] },
    { id: "tactical_evolution", category: "TRAJECTORY", base: 4, req: { traj: ["Mid-table", "Europe", "Title"], yearsMin: 1 },
      text: (n) => `The manager wants to evolve the system — ${n} will have to adapt.`,
      choices: [
        { label: "Learn the new role inside-out", fx: { attrChange: { key: "fitness", delta: 1 }, carryOver: true, rep: 2, carryOverLog: "Tactical flexibility improves match fitness next season." } },
        { label: "Stick to what you know", fx: { flag: "managerConflict" } },
      ] },
    { id: "media_distraction", category: "MEDIA", base: 4, req: { repMin: 50 },
      text: (n) => `Off-field noise swirls around ${n}: family, transfer talk, and sponsor obligations.`,
      choices: [
        { label: "Hire a media team to shield you", fx: { rep: 2, attrChange: { key: "fitness", delta: 1 }, carryOver: true, carryOverLog: "Better media management protects focus next season." } },
        { label: "Deal with it yourself", fx: { rep: -2, attrChange: { key: "fitness", delta: -1 } } },
      ] },
    { id: "injury_recovery", category: "INJURY", base: 5, req: { gamesMin: 6 },
      text: (n) => `${n} has surgery on a long-standing issue. The rehab will be long.`,
      choices: [
        { label: "Take the full recovery window", fx: { attrChange: { key: "fitness", delta: 3 }, carryOver: true, carryOverLog: "Surgery rehab pays off — fitness returns next season." } },
        { label: "Rush back for the run-in", fx: { attrChange: { key: "fitness", delta: -2 }, flag: "injuryProne", injuryProne: 1 } },
      ] },
    { id: "nutritionist", category: "TRAINING", base: 3, req: { perf: ["Sensational", "Overperformed"] },
      text: (n) => `A nutritionist overhauls ${n}'s diet to squeeze out extra performance.`,
      choices: [
        { label: "Follow the strict plan", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Lean muscle gains from the new diet show next season." } },
        { label: "Enjoy the odd cheat meal", fx: { attrChange: { key: "strength", delta: 1 } } },
      ] },
    // ---- position changes & risk/reward (Alpha 1.2) ----
    { id: "striker_conversion", category: "TRAJECTORY", base: 3, req: { posNot: ["ST"], perf: ["Sensational", "Overperformed"], ageMax: 32 },
      text: (n) => `The manager wants ${n} to lead the line as a pure striker. More goals, more pressure.`,
      choices: [
        { label: "Embrace the No.9 role", fx: { positionChange: "ST", attrChange: { key: "fitness", delta: -2 }, rep: 3 } },
        { label: "Stay in your current role", fx: { rep: 1 } },
      ] },
    { id: "winger_drop", category: "TRAJECTORY", base: 3, req: { posIn: ["ST", "CF"], ageMin: 28 },
      text: (n) => `With pace fading, the coach suggests ${n} drops to the wing to preserve their legs.`,
      choices: [
        { label: "Reinvent as a winger", fx: { positionChange: "Winger", attrChange: { key: "fitness", delta: 2 }, rep: -1 } },
        { label: "Stay central", fx: { attrChange: { key: "strength", delta: 1 } } },
      ] },
    { id: "playmaker_role", category: "TRAJECTORY", base: 3, req: { posNot: ["AMC", "AML", "AMR"], repMin: 50, ageMin: 26 },
      text: (n) => `${n}'s vision is praised — a deep-lying playmaker role could prolong the career.`,
      choices: [
        { label: "Drop into the hole", fx: { positionChange: "AMC", attrChange: { key: "fitness", delta: 2 }, rep: 2, contract: 2 } },
        { label: "Keep scoring", fx: { attrChange: { key: "leftFoot", delta: 1 }, rep: 1 } },
      ] },
    { id: "ronaldo_shift", category: "TRAJECTORY", base: 2, req: { posIn: ["Winger", "AML", "AMR"], repMin: 70, ageMin: 28 },
      text: (n) => `Like Ronaldo before you, ${n} is offered a move from the wing to the penalty box.`,
      choices: [
        { label: "Become the striker", fx: { positionChange: "ST", attrChange: { key: "heading", delta: 2 }, rep: 4 } },
        { label: "Keep the wide threat", fx: { attrChange: { key: "speed", delta: 1 } } },
      ] },
    { id: "career_threatening_injury", category: "INJURY", base: 4, req: { gamesMin: 8, ageMin: 30 },
      text: (n) => `A specialist warns ${n}'s knee may not survive another full season.`,
      choices: [
        { label: "Risk one more year", fx: { attrChange: { key: "fitness", delta: -3 }, injuryProne: 2, carryOver: true, carryOverLog: "The knee gamble backfires — fitness drops next season." } },
        { label: "Call it a day", fx: { retireNow: true } },
      ] },
    { id: "late_career_prolong", category: "TRAJECTORY", base: 3, req: { ageMin: 34 },
      text: (n) => `${n} can take a reduced squad role to extend the career — but goals will dry up.`,
      choices: [
        { label: "Play the elder statesman", fx: { attrChange: { key: "fitness", delta: 2 }, positionChange: "CF", rep: 2, carryOver: true, carryOverLog: "Veteran savvy improves fitness next season." } },
        { label: "Go out on your own terms", fx: { rep: 1 } },
      ] },

    // ---- AGENT SYSTEM EVENTS ----
    { id: "agent_power_play", category: "AGENT", base: 5, req: { repMin: 30 },
      text: (n) => `${n}'s agent goes to war with the board — demanding a better squad status and improved terms.`,
      choices: [
        { label: "Back the agent", fx: { rep: 2, contract: 1, flag: "unsettled" } },
        { label: "Calm it down — don't upset the club", fx: { rep: 1 } },
      ] },
    { id: "agent_sponsor", category: "AGENT", base: 4, req: { repMin: 40 },
      text: (n) => `${n}'s agent lands a lucrative commercial deal — boots, watches, and a billboard in the city centre.`,
      choices: [
        { label: "Sign every deal", fx: { wealth: 12, fame: 8, rep: 2, flag: "mediaTarget" } },
        { label: "Pick one quality partner", fx: { wealth: 6, fame: 3, rep: 1 } },
      ] },
    { id: "agent_transfer_push", category: "AGENT", base: 4, req: { repMin: 50, yearsMin: 2 },
      text: (n) => `${n}'s agent has been talking to bigger clubs. A move could be on the cards.`,
      choices: [
        { label: "Let the agent explore options", fx: { forceTransfer: true, rep: 1 } },
        { label: "Commit to the current club", fx: { rep: 3, flag: "fanFavorite" } },
      ] },
    { id: "agent_conflict", category: "AGENT", base: 3, req: { perf: ["Underperformed", "Flop"] },
      text: (n) => `${n} and their agent clash publicly over a failed move — the relationship is fraying.`,
      choices: [
        { label: "Sack the agent", fx: { rep: -2, wealth: -5, agent: { key: "poor", label: "Poor", influence: 0, contractBonus: 0 } } },
        { label: "Patch things up", fx: { rep: -1, flag: "unsettled" } },
      ] },
    { id: "agent_new_contract", category: "AGENT", base: 4, req: { repMin: 35, yearsMin: 1 },
      text: (n) => `${n}'s agent negotiates an early contract extension with the current club.`,
      choices: [
        { label: "Sign the extension", fx: { contract: 2, rep: 2, flag: "fanFavorite" } },
        { label: "Hold out for more money", fx: { contract: 1, wealth: 5, rep: -1, flag: "unsettled" } },
      ] },

    // ---- AGENT-DRIVEN CAREER DIRECTIVES (Alpha 1.3 beta) ----
    { id: "agent_ask_longer_contract", category: "AGENT", base: 5, req: { repMin: 35, yearsMin: 1 },
      text: (n) => `${n}'s agent wants to lock in long-term security. The club is reluctant to add years.`,
      choices: [
        { label: "Demand a 4-year deal", fx: { contract: 3, rep: -2, wealth: 3, flag: "unsettled" } },
        { label: "Take a 2-year extension and renegotiate later", fx: { contract: 1, rep: 1 } },
        { label: "Ask the agent to drop it", fx: { rep: 2, flag: "fanFavorite" } },
      ] },
    { id: "agent_ask_more_playtime", category: "AGENT", base: 5, req: { roleIn: ["Rotation", "Bench"], repMin: 30 },
      text: (n) => `${n}'s agent meets the manager to demand more minutes. The gaffer is not happy.`,
      choices: [
        { label: "Back the agent publicly", fx: { rep: -3, flag: "managerConflict", contract: 1 } },
        { label: "Let your football do the talking", fx: { rep: 3, flag: "inForm" } },
        { label: "Ask for a loan move", fx: { rep: 1, forceTransfer: true } },
      ] },
    { id: "agent_ask_wealth", category: "AGENT", base: 4, req: { repMin: 40, wealth: 15 },
      text: (n) => `${n}'s agent says commercial opportunities are being left on the table.`,
      choices: [
        { label: "Chase every sponsorship", fx: { wealth: 12, fame: 6, rep: -2, flag: "mediaTarget" } },
        { label: "Pick one prestige brand", fx: { wealth: 6, fame: 3, rep: 2 } },
        { label: "Focus on football, not money", fx: { rep: 3, flag: "fanFavorite" } },
      ] },
    { id: "speak_to_agent", category: "AGENT", base: 6, req: { repMin: 25 },
      text: (n) => `End-of-season review with the agent. The next 12 months can be shaped now.`,
      choices: [
        { label: "Push for a bigger club", fx: { rep: 1, forceTransfer: true } },
        { label: "Lock down a better contract", fx: { contract: 2, wealth: 4, flag: "unsettled" } },
        { label: "Invest in a personal skills coach", fx: { attrChange: { key: "fitness", delta: 2 }, carryOver: true, carryOverLog: "Personal skills coach improves fitness for next season." } },
      ] },
    { id: "career_position_training", category: "TRAINING", base: 5, req: { perf: ["Met Expectation", "Overperformed", "Sensational"], ageMax: 32 },
      text: (n) => `${n}'s coach suggests a summer position camp to sharpen one specific area.`,
      choices: [
        { label: "Focus on heading", fx: { attrChange: { key: "heading", delta: 3 }, carryOver: true, carryOverLog: "Heading camp pays off next season." } },
        { label: "Focus on finishing", fx: { attrChange: { key: "leftFoot", delta: 2 }, carryOver: true, carryOverLog: "Finishing camp sharpens the left foot next season." } },
        { label: "Focus on pace", fx: { attrChange: { key: "speed", delta: 2 }, carryOver: true, carryOverLog: "Pace work adds yard next season." } },
        { label: "Focus on physicality", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Strength work adds power next season." } },
      ] },
    { id: "career_force_move", category: "AGENT", base: 4, req: { repMin: 45, yearsMin: 2 },
      text: (n) => `${n}'s agent has engineered a concrete bid from a bigger club. It's time to decide.`,
      choices: [
        { label: "Force the move — my level is higher", fx: { rep: -2, forceTransfer: true, flag: "unsettled" } },
        { label: "Stay loyal — renegotiate instead", fx: { rep: 4, contract: 2, flag: "fanFavorite" } },
        { label: "Let the agent handle it quietly", fx: { rep: 1, wealth: 3 } },
      ] },

    // ---- WEALTH / FAME EVENTS (rare, unlocked by wealth/fame) ----
    { id: "fashion_brand", category: "FAME", base: 2, req: { repMin: 60, ageMin: 22 }, rare: true,
      text: (n) => `${n} launches a clothing line — the launch party is packed with celebrities.`,
      choices: [
        { label: "Go all-in on the brand", fx: { wealth: 15, fame: 10, rep: 3, flag: "mediaTarget" } },
        { label: "Keep it small and authentic", fx: { wealth: 6, fame: 3, rep: 2 } },
      ] },
    { id: "documentary_deal", category: "FAME", base: 2, req: { repMin: 70, ageMin: 24 }, rare: true,
      text: (n) => `A streaming giant wants to make a documentary about ${n}'s rise.`,
      choices: [
        { label: "Give them full access", fx: { wealth: 12, fame: 12, rep: 2, flag: "mediaTarget" } },
        { label: "Control the narrative", fx: { wealth: 8, fame: 6, rep: 3 } },
      ] },
    { id: "charity_foundation", category: "FAME", base: 2, req: { repMin: 50, ageMin: 23 }, rare: true,
      text: (n) => `${n} sets up a foundation for underprivileged kids. The media calls it a legacy move.`,
      choices: [
        { label: "Donate a season's wages", fx: { wealth: -10, fame: 15, rep: 8, flag: "fanFavorite" } },
        { label: "Use your platform quietly", fx: { fame: 5, rep: 4 } },
      ] },
    { id: "nightclub_scandal", category: "FAME", base: 3, req: { perf: ["Underperformed", "Flop"], ageMin: 20 }, rare: true,
      text: (n) => `${n} is photographed leaving a nightclub at 4am before a big match.`,
      choices: [
        { label: "Apologise to the fans", fx: { rep: -1, fame: 5, flag: "redemptionArc" } },
        { label: "My private life is my own", fx: { rep: -4, fame: 8, flag: "mediaTarget" } },
      ] },
    { id: "luxury_lifestyle", category: "FAME", base: 2, req: { wealth: 40, ageMin: 22 }, rare: true,
      text: (n) => `${n} buys a mansion and a supercar collection — the lifestyle is starting to draw attention.`,
      choices: [
        { label: "Show it off on social media", fx: { wealth: -8, fame: 10, rep: -2, flag: "mediaTarget" } },
        { label: "Keep it private", fx: { wealth: -3, fame: 3 } },
      ] },
    { id: "autobiography", category: "FAME", base: 2, req: { ageMin: 27, repMin: 55 }, rare: true,
      text: (n) => `${n} is offered a seven-figure book deal for an autobiography.`,
      choices: [
        { label: "Write it all — the good and the bad", fx: { wealth: 12, fame: 8, rep: -2, flag: "mediaTarget" } },
        { label: "Keep it focused on football", fx: { wealth: 8, fame: 4, rep: 2 } },
      ] },
    { id: "reality_show", category: "FAME", base: 1, req: { fame: 40, ageMin: 24 }, rare: true,
      text: (n) => `A reality TV producer wants ${n} and their family in a fly-on-the-wall series.`,
      choices: [
        { label: "Sign the deal", fx: { wealth: 14, fame: 15, rep: -3, flag: "mediaTarget" } },
        { label: "Protect your family privacy", fx: { rep: 3, fame: 2 } },
      ] },

    // ---- MORE INJURY EVENTS (age-weighted by getEventWeight) ----
    { id: "muscle_tear", category: "INJURY", base: 3, req: { ageMin: 26 },
      text: (n) => `${n} tears a thigh muscle in training and misses the run-in.`,
      choices: [
        { label: "Undergo intensive rehab", fx: { attrChange: { key: "fitness", delta: -1 }, rep: 1 } },
        { label: "Rush back for the playoffs", fx: { attrChange: { key: "fitness", delta: -2 }, flag: "injuryProne", injuryProne: 1 } },
      ] },
    { id: "ankle_surgery", category: "INJURY", base: 3, req: { ageMin: 28 },
      text: (n) => `${n} needs ankle surgery after a bad tackle. The recovery is six to eight weeks.`,
      choices: [
        { label: "Take the full rehab route", fx: { attrChange: { key: "speed", delta: -1 }, rep: 1 } },
        { label: "Play through the pain", fx: { attrChange: { key: "speed", delta: -2 }, flag: "injuryProne", injuryProne: 2 } },
      ] },
    { id: "concussion", category: "INJURY", base: 3, req: { ageMin: 24 },
      text: (n) => `${n} takes a heavy blow to the head. The medical team recommends a cautious protocol.`,
      choices: [
        { label: "Follow the full protocol", fx: { rep: 2 } },
        { label: "Return early — the team needs you", fx: { attrChange: { key: "fitness", delta: -1 }, flag: "injuryProne", injuryProne: 1 } },
      ] },
    { id: "back_injury", category: "INJURY", base: 3, req: { ageMin: 30 },
      text: (n) => `${n} is struggling with a chronic back issue. It might never fully go away.`,
      choices: [
        { label: "Manage it with specialists", fx: { attrChange: { key: "strength", delta: -1 }, rep: 1 } },
        { label: "Mask it and keep playing", fx: { attrChange: { key: "strength", delta: -2 }, flag: "injuryProne", injuryProne: 2 } },
      ] },
    { id: "hip_surgery", category: "INJURY", base: 2, req: { ageMin: 33 },
      text: (n) => `${n}'s hip is bone-on-bone. Surgery could end the season — or the career.`,
      choices: [
        { label: "Have the surgery", fx: { attrChange: { key: "fitness", delta: -3 }, rep: 2 } },
        { label: "Delay it and gamble", fx: { attrChange: { key: "fitness", delta: -4 }, flag: "injuryProne", injuryProne: 3, retireNow: true } },
      ] },

    // ---- CONTRACT & FINANCE EVENTS ----
    { id: "pay_rise", category: "CONTRACT", base: 4, req: { perf: ["Sensational", "Overperformed"], yearsMin: 1 },
      text: (n) => `The club rewards ${n} with a surprise pay rise after an outstanding season.`,
      choices: [
        { label: "Accept it graciously", fx: { wealth: 8, rep: 2, flag: "fanFavorite" } },
        { label: "Demand even more", fx: { wealth: 4, rep: -2, flag: "unsettled" } },
      ] },
    { id: "wage_dispute", category: "CONTRACT", base: 3, req: { perf: ["Sensational"], yearsMin: 2 },
      text: (n) => `${n} feels underpaid compared to new signings. The dressing room is watching.`,
      choices: [
        { label: "Go public with the dispute", fx: { wealth: 6, rep: -3, flag: "mediaTarget" } },
        { label: "Negotiate privately", fx: { wealth: 4, rep: 1 } },
      ] },
    { id: "release_clause", category: "CONTRACT", base: 3, req: { repMin: 50, ageMin: 22 },
      text: (n) => `A release clause is inserted into ${n}'s new contract. It could change everything.`,
      choices: [
        { label: "Accept — it gives flexibility", fx: { rep: 1, flag: "unsettled" } },
        { label: "Refuse — I want stability", fx: { contract: 1, rep: 2 } },
      ] },

    // ---- INTERNATIONAL EVENTS ----
    { id: "world_cup_call", category: "INTERNATIONAL", base: 4, req: { repMin: 50, ageMin: 20, ageMax: 34, intlRetired: false },
      text: (n) => `${n} is called up for a major international tournament.`,
      choices: [
        { label: "Give everything for the country", fx: { rep: 5, intlCaps: 1, intlGoals: () => randInt(0, 2), flag: "inForm" } },
        { label: "Focus on club fitness", fx: { rep: -2 } },
      ] },
    { id: "international_captain", category: "INTERNATIONAL", base: 3, req: { repMin: 70, ageMin: 26, intlCaps: 5, intlRetired: false },
      text: (n) => `${n} is named national team captain.`,
      choices: [
        { label: "Lead with pride", fx: { rep: 8, fame: 6, flag: "fanFavorite", setIntlCaptain: true } },
        { label: "Share the armband", fx: { rep: 3 } },
      ] },
    { id: "international_retirement", category: "INTERNATIONAL", base: 3, req: { ageMin: 32, intlCaps: 10, intlRetired: false }, once: true,
      text: (n) => `${n} is asked to retire from international duty to prolong club form.`,
      choices: [
        { label: "Retire from internationals", fx: { attrChange: { key: "fitness", delta: 2 }, rep: -2, setIntlRetired: true } },
        { label: "Keep playing for the country", fx: { rep: 4, attrChange: { key: "fitness", delta: -1 }, flag: "injuryProne", injuryProne: 1 } },
      ] },

    // ---- PERSONAL LIFE & CAREER DEVELOPMENT ----
    { id: "new_baby", category: "PERSONAL", base: 3, req: { ageMin: 22, ageMax: 35 },
      text: (n) => `${n} becomes a parent. Sleep is about to become a luxury.`,
      choices: [
        { label: "Family comes first", fx: { attrChange: { key: "fitness", delta: -1 }, rep: 2, fame: 2 } },
        { label: "Hire full-time help", fx: { wealth: -4, attrChange: { key: "fitness", delta: 1 } } },
      ] },
    { id: "family_bereavement", category: "PERSONAL", base: 2, req: { ageMin: 24 },
      text: (n) => `${n} loses a close family member. The season feels insignificant.`,
      choices: [
        { label: "Take time away from football", fx: { attrChange: { key: "fitness", delta: -2 }, rep: 3, carryOver: true, carryOverLog: "Grief affects form early next season." } },
        { label: "Play through it", fx: { attrChange: { key: "fitness", delta: -1 }, rep: 1 } },
      ] },
    { id: "coaching_badge", category: "PERSONAL", base: 3, req: { ageMin: 28 },
      text: (n) => `${n} starts a coaching badge, thinking about life after boots.`,
      choices: [
        { label: "Study hard", fx: { rep: 2, mentalityChange: 2 } },
        { label: "Dip in and out", fx: { rep: 1 } },
      ] },
    { id: "language_lessons", category: "PERSONAL", base: 2, req: { ageMin: 23, repMin: 45 },
      text: (n) => `${n} takes language lessons — rumours of a move abroad are swirling.`,
      choices: [
        { label: "Learn Spanish", fx: { rep: 2, fame: 2 } },
        { label: "Learn French", fx: { rep: 2, fame: 2 } },
        { label: "Learn Italian", fx: { rep: 2, fame: 2 } },
      ] },

    // ---- TEAM / MANAGER / FAN EVENTS ----
    { id: "manager_praise", category: "TEAM", base: 4, req: { perf: ["Sensational", "Overperformed"], yearsMin: 1 },
      text: (n) => `The manager calls ${n} "unplayable" in a post-match interview.`,
      choices: [
        { label: "Praise the team system", fx: { rep: 3, flag: "fanFavorite" } },
        { label: "Say you're just getting started", fx: { rep: 2, flag: "inForm" } },
      ] },
    { id: "fan_protest", category: "TEAM", base: 3, req: { perf: ["Flop"], yearsMin: 2 },
      text: (n) => `Fans protest outside the ground, demanding ${n} be dropped.`,
      choices: [
        { label: "Address the fans directly", fx: { rep: -1, flag: "redemptionArc" } },
        { label: "Ignore them and train harder", fx: { rep: 1, flag: "inForm" } },
      ] },
    { id: "statue_campaign", category: "TEAM", base: 2, req: { repMin: 75, yearsMin: 5 }, rare: true,
      text: (n) => `Supporters start a campaign for a statue of ${n} outside the stadium.`,
      choices: [
        { label: "Humbly ask them to wait until you retire", fx: { rep: 6, fame: 5, flag: "fanFavorite" } },
        { label: "Enjoy the love", fx: { rep: 3, fame: 8, flag: "mediaTarget" } },
      ] },
    { id: "dressing_room_leader", category: "TEAM", base: 3, req: { ageMin: 28, yearsMin: 2 },
      text: (n) => `Younger players look to ${n} as the dressing-room leader.`,
      choices: [
        { label: "Mentor them", fx: { rep: 3, mentalityChange: 1 } },
        { label: "Focus on your own game", fx: { rep: 1 } },
      ] },

    // ---- MEDIA & SOCIAL EVENTS ----
    { id: "twitter_spat", category: "MEDIA", base: 3, req: { perf: ["Underperformed", "Flop"], repMin: 40 },
      text: (n) => `${n} gets into a public Twitter spat with a rival player.`,
      choices: [
        { label: "Delete the tweet and apologise", fx: { rep: 1, fame: 2 } },
        { label: "Double down", fx: { rep: -3, fame: 6, flag: "mediaTarget" } },
      ] },
    { id: "podcast_guest", category: "MEDIA", base: 3, req: { repMin: 45, ageMin: 22 },
      text: (n) => `A popular podcast wants ${n} as a guest. The host asks controversial questions.`,
      choices: [
        { label: "Be brutally honest", fx: { rep: -1, fame: 5, flag: "mediaTarget" } },
        { label: "Play it safe", fx: { rep: 2 } },
      ] },
    { id: "tabloid_rumours", category: "MEDIA", base: 3, req: { repMin: 50 },
      text: (n) => `Tabloids run a story about ${n}'s private life. Some of it is true.`,
      choices: [
        { label: "Issue a legal statement", fx: { rep: 2, wealth: -3 } },
        { label: "Let it blow over", fx: { rep: -2, fame: 4 } },
      ] },
  ];
  */

  const FLAG_DEFAULT_DURATION = 2;
  const EVENT_REWARD_MULTIPLIER = 1.7; // events are rarer now, so each one should pack a bigger punch

  /* -------------------- CAREER EVENT DATA --------------------
   * Loaded from career_event_data.js; see that file for the raw definitions.
   */
  const { SEASON_DECISIONS, EARLY_DEVELOPMENT_DECISIONS, CAREER_MILESTONES, SEASON_EVENTS, SEASON_TAG_WEIGHTS, CAREER_SECTIONS, CAREER_ENDINGS } = window.createCareerEventData({ getState: () => state, rand, randInt, choice });


  function meetsSeasonDecisionReq(ev, ctx) {
    const r = ev.req || {};
    if (r.roleIn && !r.roleIn.includes(ctx.role)) return false;
    if (r.ageMin != null && ctx.age < r.ageMin) return false;
    if (r.ageMax != null && ctx.age > r.ageMax) return false;
    if (r.yearsMin != null && ctx.yearsAtClub < r.yearsMin) return false;
    if (r.repMin != null && ctx.rep < r.repMin) return false;
    if (r.intlCaps != null && state.intlCaps < r.intlCaps) return false;
    if (r.perf && !r.perf.includes(ctx.perf)) return false;
    if (r.seasonMin != null && state.season < r.seasonMin) return false;
    return true;
  }

  function pickEarlyDevelopmentDecision() {
    if (state.season > 4) return null;
    state.earlyDevEvents = state.earlyDevEvents || {};
    if (state.earlyDevEvents[state.season]) return null;
    if (rand() >= 0.5) return null;
    const eligible = EARLY_DEVELOPMENT_DECISIONS.filter((e) => !state.earlyDevEvents[e.id]);
    if (!eligible.length) return null;
    const ev = choice(eligible);
    state.earlyDevEvents[state.season] = true;
    state.earlyDevEvents[ev.id] = true;
    return ev;
  }
  function pickSeasonDecision(ctx) {
    const early = pickEarlyDevelopmentDecision();
    if (early) return early;
    const eligible = SEASON_DECISIONS.map((e) => ({ item: e, weight: meetsSeasonDecisionReq(e, ctx) ? e.weight : 0 })).filter((e) => e.weight > 0);
    if (!eligible.length) return null;
    return weightedRandomPick(eligible);
  }
  function presentSeasonDecision(sd, intl) {
    const ctx = buildContext(sd);
    const ev = pickSeasonDecision(ctx);
    if (!ev) { proceedToTransfer(sd, intl); return; }
    const name = state.player.name;
    const text = typeof ev.text === "function" ? ev.text(name, ctx) : ev.text;
    const choices = typeof ev.choices === "function" ? ev.choices(ctx) : ev.choices;
    const choicesHtml = choices.map((c, i) => `<button class="btn choice" data-i="${i}">${c.label}</button>`).join("");
    const box = document.getElementById("season-action");
    box.innerHTML = `
      <div class="decision season-decision">
        <div class="decision-tag">END OF SEASON — ${ev.category}</div>
        <div class="decision-text">${esc(text)}</div>
        <div class="decision-choices">${choicesHtml}</div>
      </div>`;
    box.querySelectorAll(".choice").forEach((btn) => {
      btn.addEventListener("click", withFailsafe(() => {
        const c = choices[parseInt(btn.dataset.i, 10)];
        applyEffects(c.fx, 1);
        log(`   ↳ 🎯 End-of-season: ${text.replace(/\.$/, "")} → "${c.label}"`, "decision");
        renderCareerHeader();
        saveState();
        if (state.retireNow) { state.retireNow = false; beginRetirement("injury"); return; }
        const eventCount = determineEventCount(ctx);
        const events = pickSeasonEvents(ctx, eventCount);
        if (events.length > 0) presentEventQueue(events, 0, sd, intl, ctx); else proceedToTransfer(sd, intl);
      }));
    });
  }


  function checkCareerMilestone() {
    for (const m of CAREER_MILESTONES) {
      if (state.pillarMilestones && state.pillarMilestones[m.id]) continue;
      if (state.age < m.ageRange[0] || state.age > m.ageRange[1]) continue;
      if (m.req && !meetsSeasonDecisionReq(m, buildContext({ perfTier: state.lastPerformanceTier, trajectory: state.lastTrajectory || "Mid-table" }))) continue;
      if (rand() < m.weight / 10) {
        if (!state.pillarMilestones) state.pillarMilestones = {};
        state.pillarMilestones[m.id] = true;
        return m;
      }
    }
    return null;
  }
  function presentCareerMilestone(milestone, sd, intl) {
    const name = state.player.name;
    const ctx = buildContext(sd);
    const text = typeof milestone.text === "function" ? milestone.text(name, ctx) : milestone.text;
    const choices = typeof milestone.choices === "function" ? milestone.choices(ctx) : milestone.choices;
    const choicesHtml = choices.map((c, i) => `<button class="btn choice" data-i="${i}">${c.label}</button>`).join("");
    const box = document.getElementById("season-action");
    box.innerHTML = `
      <div class="decision milestone-event">
        <div class="decision-tag">CAREER MILESTONE — ${state.age} YEARS OLD</div>
        <div class="decision-text">${esc(text)}</div>
        <div class="decision-choices">${choicesHtml}</div>
      </div>`;
    box.querySelectorAll(".choice").forEach((btn) => {
      btn.addEventListener("click", withFailsafe(() => {
        const c = choices[parseInt(btn.dataset.i, 10)];
        applyEffects(c.fx, 1);
        log(`   ↳ 🏅 Career milestone: ${text.replace(/\.$/, "")} → "${c.label}"`, "decision");
        renderCareerHeader();
        saveState();
        if (state.retireNow) { state.retireNow = false; beginRetirement("injury"); return; }
        presentSeasonDecision(sd, intl);
      }));
    });
  }

  function buildContext(sd) {
    return {
      mentality: state.mentality, mentTag: mentTag(state.mentality), mentRating: state.mentalityRating,
      academyTier: state.academyTier, perf: sd.perfTier, traj: sd.trajectory,
      ageBracket: ageBracket(state.age), age: state.age, yearsAtClub: state.yearsAtClub,
      repTier: state.reputationTier, rep: state.reputation, role: state.role,
      position: state.position, season: state.season, flags: state.flags, gamesMissed: sd.gamesMissed,
    };
  }
  function meetsHardRequirements(ev, ctx) {
    const r = ev.req || {};
    if (r.mentTag && !r.mentTag.includes(ctx.mentTag)) return false;
    if (r.mentTraits && !r.mentTraits.includes(ctx.mentality)) return false;
    if (r.mentRatingMax != null && ctx.mentRating > r.mentRatingMax) return false;
    if (r.mentRatingMin != null && ctx.mentRating < r.mentRatingMin) return false;
    if (r.perf && !r.perf.includes(ctx.perf)) return false;
    if (r.traj && !r.traj.includes(ctx.traj)) return false;
    if (r.roleIn && !r.roleIn.includes(ctx.role)) return false;
    if (r.ageMax != null && ctx.age > r.ageMax) return false;
    if (r.ageMin != null && ctx.age < r.ageMin) return false;
    if (r.yearsMin != null && ctx.yearsAtClub < r.yearsMin) return false;
    if (r.repMin != null && ctx.rep < r.repMin) return false;
    if (r.seasonMax != null && ctx.season > r.seasonMax) return false;
    if (r.gamesMin != null && (ctx.gamesMissed || 0) < r.gamesMin) return false;
    if (r.posIn && !r.posIn.includes(ctx.position)) return false;
    if (r.posNot && r.posNot.includes(ctx.position)) return false;
    if (r.wealth != null && (state.wealth || 0) < r.wealth) return false;
    if (r.fame != null && (state.fame || 0) < r.fame) return false;
    if (r.intlRetired != null && !!state.intlRetired !== r.intlRetired) return false;
    return true;
  }
  // Career-stage risk profile: as a career matures, negative/harsher events
  // (bad tone) become proportionally more likely and positive/safe events
  // become proportionally less likely. This is layered on top of the
  // per-tag SEASON_TAG_WEIGHTS (which already skews Injury/Transfer up and
  // Development down in later stages) to make Early feel gentler and
  // Late/Overtime feel notably riskier and more eventful.
  const STAGE_NEGATIVE_RISK = { Early: 0.55, Mid: 1.0, Late: 1.4, Overtime: 1.85 };
  const STAGE_POSITIVE_SAFETY = { Early: 1.5, Mid: 1.1, Late: 0.85, Overtime: 0.6 };

  function getEventWeight(ev, ctx) {
    if (!meetsHardRequirements(ev, ctx)) return 0;
    if (state.cooldowns[ev.id] > 0) return 0;
    const section = getCareerSection(state.age);
    const tagWeights = SEASON_TAG_WEIGHTS[section] || SEASON_TAG_WEIGHTS.Mid;
    let w = ev.base * 0.65 * (tagWeights[ev.tag] || 1);

    // Stage risk: later career stages skew toward negative-tone events.
    if (ev.tone === "negative") w *= STAGE_NEGATIVE_RISK[section] || 1;
    else if (ev.tone === "positive") w *= STAGE_POSITIVE_SAFETY[section] || 1;
    else if (ev.tone === "mixed") w *= (STAGE_NEGATIVE_RISK[section] + STAGE_POSITIVE_SAFETY[section]) / 2 || 1;

    // Performance drives positivity: good seasons = more positive events, poor seasons = more randomness and worse events
    const perf = ctx.perf;
    if (["Sensational", "Overperformed"].includes(perf)) {
      if (ev.tone === "positive") w *= 1.6;
      if (ev.tone === "negative") w *= 0.5;
      if (ev.tone === "mixed") w *= 1.2;
    } else if (["Flop", "Underperformed"].includes(perf)) {
      if (ev.tone === "negative") w *= 1.8;
      if (ev.tone === "mixed") w *= 1.4;
      if (ev.tone === "positive") w *= 0.6;
    }

    // Personality nudges
    if (ev.tag === "Injury") {
      const durability = getPillar("Durability");
      w += (state.injuryRating || 50) / 30 - durability / 30;
      if (ctx.age >= 32) w += 2;
      if (ctx.age >= 35) w += 3;
      if (ctx.age >= 38) w += 5;
    }
    if (ev.tag === "Development") {
      const prof = getPillar("Professionalism");
      w += (prof - 50) / 20;
      const academyTrainingMod = { "World Class": 4, "Strong": 2, "Average": 0, "Weak": -1 }[state.academy.tier] || 0;
      w += academyTrainingMod;
    }
    if (ev.tag === "Transfer or Loan") {
      const ambition = getPillar("Ambition");
      const loyalty = getPillar("Loyalty");
      w += (ambition - 50) / 20 - (loyalty - 50) / 30;
      if (state.agent) w += state.agent.influence * 10;
    }
    if (ev.tag === "Roleplay") {
      const ego = getPillar("Ego");
      w += (ego - 50) / 25;
      if (ctx.flags.mediaTarget && ev.id === "pundit_criticism") w += 3;
      if (ctx.flags.managerConflict && ev.id === "relegated") w += 2;
    }

    // Wealth and fame unlock rare, high-profile events
    if (ev.rare) {
      const fame = (state.fame || 0) + (state.wealth || 0) / 4;
      w += fame / 15;
    }
    return Math.max(0, w);
  }

  const MILESTONES = [
    { goals: 100, title: "Local Hero" }, { goals: 250, title: "Club Legend" },
    { goals: 500, title: "Generational Talent" }, { goals: 750, title: "All-Time Great" },
    { goals: 1000, title: "Football God" },
  ];
  function checkMilestoneInterrupt() {
    for (const m of MILESTONES) {
      if (state.totalGoals >= m.goals && !state.milestonesHit[m.goals]) {
        state.milestonesHit[m.goals] = true;
        addBioMoment(`A landmark achievement: ${state.totalGoals} career goals and counting, cementing ${state.player.name} as a "${m.title}".`);
        return { id: "milestone_" + m.goals, milestone: true, category: "MILESTONE",
          text: () => `🏅 MILESTONE: ${state.totalGoals} career goals — "${m.title}"!`,
          choices: [{ label: "Onwards", fx: { rep: m.goals >= 500 ? 6 : 3 } }] };
      }
    }
    return null;
  }
  function pickSeasonEvent(ctx) {
    const eligible = SEASON_EVENTS.map((e) => ({ item: e, weight: getEventWeight(e, ctx) })).filter((e) => e.weight > 0);
    if (!eligible.length) return null;
    return weightedRandomPick(eligible);
  }

  // Minimum guaranteed events per stage — later stages always have at least
  // one more event brewing than earlier ones, on top of the random/cap range.
  const STAGE_EVENT_FLOOR = { Early: 0, Mid: 1, Late: 1, Overtime: 1 };
  const STAGE_EVENT_BASE = { Early: 0, Mid: 1.4, Late: 1.8, Overtime: 2.0 };
  function determineEventCount(ctx) {
    const stage = getCareerSection(state.age);
    const section = CAREER_SECTIONS[stage];
    const cap = section.eventCap;
    const base = STAGE_EVENT_BASE[stage] != null ? STAGE_EVENT_BASE[stage] : cap;
    // Consistency smooths the count, ego adds noise
    const consistency = getPillar("Consistency");
    const ego = getPillar("Ego");
    const randomSwing = (rand() * 2 - 1) * (1 - (consistency - 50) / 100);
    const egoMod = (ego - 50) / 100;
    let perfMod = 0;
    if (["Sensational", "Overperformed"].includes(ctx.perf)) perfMod = 0.25;
    if (["Flop", "Underperformed"].includes(ctx.perf)) perfMod = -0.25;
    const count = Math.round(base + randomSwing + perfMod + egoMod);
    return clamp(count, STAGE_EVENT_FLOOR[stage] || 0, cap);
  }
  function eventContradictsExisting(ev, events) {
    if (!ev) return true;
    if (events.some((e) => e.id === ev.id || e.tag === ev.tag)) return true;
    if (state.pendingTransfer && ev.tag === "Transfer or Loan") return true;
    if (events.some((e) => e.tag === "Injury") && ev.tag === "Development") return true;
    return false;
  }
  function pickSeasonEvents(ctx, count) {
    const events = [];
    const milestone = checkMilestoneInterrupt();
    if (milestone) events.push(milestone);
    const attempts = Math.max(8, count * 6);
    for (let i = 0; i < attempts && events.length < count + (milestone ? 1 : 0); i++) {
      const ev = pickSeasonEvent(ctx);
      if (!ev || eventContradictsExisting(ev, events)) continue;
      state.cooldowns[ev.id] = ev.cooldown || 3;
      events.push(ev);
    }
    return events;
  }

  function applyEffects(fx, multiplier = 1) {
    if (!fx) return;
    // Carry-over: some choices have a 50% chance to affect NEXT season instead of now
    if (fx.carryOver && rand() < 0.5) {
      state.pendingCarryOver = state.pendingCarryOver || [];
      state.pendingCarryOver.push(fx);
      return;
    }
    applyEffectsRaw(fx, multiplier);
    if (state.attrs && (fx.attrChange || fx.attrChange2 || fx.derivedChange || fx.positionChange)) recomputePlayerStats();
  }
  function applyEffectsRaw(fx, multiplier = 1) {
    if (!fx) return;
    if (fx.rep) adjustReputation(Math.round(fx.rep * multiplier));
    if (fx.goals) { const g = Math.round((typeof fx.goals === "function" ? fx.goals() : fx.goals) * multiplier); state.totalGoals += g; if (state.seasonHistory.length) state.seasonHistory[state.seasonHistory.length - 1].goals += g; }
    if (fx.apps) { const ap = Math.round((typeof fx.apps === "function" ? fx.apps() : fx.apps) * multiplier); state.totalApps += ap; }
    if (fx.intlGoals) { const ig = Math.round((typeof fx.intlGoals === "function" ? fx.intlGoals() : fx.intlGoals) * multiplier); state.intlGoals += ig; state.totalGoals += ig; }
    if (fx.assists) { const a = Math.round((typeof fx.assists === "function" ? fx.assists() : fx.assists) * multiplier); state.totalAssists += a; }
    if (fx.wealth) state.wealth = clamp((state.wealth || 0) + Math.round((typeof fx.wealth === "function" ? fx.wealth() : fx.wealth) * multiplier), 0, 100);
    if (fx.fame) state.fame = clamp((state.fame || 0) + Math.round((typeof fx.fame === "function" ? fx.fame() : fx.fame) * multiplier), 0, 100);
    if (fx.finalSeason) state.finalSeason = fx.finalSeason;
    if (fx.endCareerReason) state.endCareerReason = fx.endCareerReason;
    if (fx.flag) setFlag(fx.flag, FLAG_DEFAULT_DURATION);
    if (fx.injuryProne) state.injuryProneSeasons = Math.max(state.injuryProneSeasons, fx.injuryProne);
    if (fx.ratingBoost) state.baseRating = clamp(state.baseRating + Math.round(fx.ratingBoost * multiplier), 40, 99);
    if (fx.forceTransfer) state.pendingTransfer = true;
    if (fx.attrChange) {
      const { key, delta } = fx.attrChange;
      state.attrs[key] = clamp(state.attrs[key] + Math.round(delta * multiplier), 40, 99);
    }
    if (fx.attrChange2) {
      const { key, delta } = fx.attrChange2;
      state.attrs[key] = clamp(state.attrs[key] + Math.round(delta * multiplier), 40, 99);
    }
    if (fx.derivedChange) {
      state.derivedBonuses = state.derivedBonuses || { agility: 0, balance: 0 };
      if (fx.derivedChange.agility != null) state.derivedBonuses.agility = (state.derivedBonuses.agility || 0) + Math.round(fx.derivedChange.agility * multiplier);
      if (fx.derivedChange.balance != null) state.derivedBonuses.balance = (state.derivedBonuses.balance || 0) + Math.round(fx.derivedChange.balance * multiplier);
    }
    if (fx.mentalityChange) {
      state.mentalityRating = clamp(state.mentalityRating + Math.round(fx.mentalityChange * multiplier), 15, 99);
    }
    if (fx.positionChange) {
      state.position = fx.positionChange;
    }
    if (fx.contract) {
      state.contractYears = Math.max(0, state.contractYears + Math.round(fx.contract * multiplier));
    }
    if (fx.agent) {
      state.agent = fx.agent;
    }
    if (fx.intlCaps) {
      state.intlCaps += fx.intlCaps;
    }
    if (fx.retireNow) {
      state.retireNow = true;
    }
    if (fx.setIntlCaptain) {
      state.intlCaptain = true;
    }
    if (fx.setIntlRetired) {
      state.intlRetired = true;
    }
    if (fx.role === "up") {
      const order = ["Bench", "Rotation", "Starter", "Star"];
      const i = order.indexOf(state.role);
      if (i >= 0 && i < order.length - 1 && rand() < 0.6) state.role = order[i + 1];
    }
    if (fx.role === "down") {
      const order = ["Bench", "Rotation", "Starter", "Star"];
      const i = order.indexOf(state.role);
      if (i > 0) state.role = order[i - 1];
    }
  }
  function applyPendingCarryOver() {
    if (!state.pendingCarryOver || !state.pendingCarryOver.length) return;
    const list = state.pendingCarryOver;
    state.pendingCarryOver = [];
    for (const fx of list) {
      applyEffectsRaw(fx, EVENT_REWARD_MULTIPLIER);
      if (fx.carryOverLog) log(fx.carryOverLog, "decision");
    }
    recomputePlayerStats();
  }
  function setFlag(name, dur) { state.flags[name] = dur; }
  function decayFlags() {
    for (const k of Object.keys(state.flags)) { state.flags[k]--; if (state.flags[k] <= 0) delete state.flags[k]; }
    for (const k of Object.keys(state.cooldowns)) { state.cooldowns[k]--; if (state.cooldowns[k] <= 0) delete state.cooldowns[k]; }
  }

  /* --------------------------- TRANSFERS -------------------------------- */
  function generateOffers(sd) {
    let tierByRep = state.reputation >= 80 ? ["Elite", "Europe"] :
      state.reputation >= 60 ? ["Elite", "Europe", "Mid"] :
      state.reputation >= 40 ? ["Europe", "Mid", "Lower"] : ["Mid", "Lower", "Championship"];
    const ambition = getPillar("Ambition");
    if (ambition >= 70 && !tierByRep.includes("Elite")) tierByRep.push("Elite");
    if (ambition >= 85 && !tierByRep.includes("Europe")) tierByRep.push("Europe");
    // Fame unlocks top-club interest: a famous player (high wages = high fame) attracts
    // elite clubs even if reputation hasn't fully caught up yet.
    const fame = state.fame || 0;
    if (fame >= 60 && !tierByRep.includes("Elite")) tierByRep.push("Elite");
    if (fame >= 40 && !tierByRep.includes("Europe")) tierByRep.push("Europe");
    // Championship players can also receive offers from within the Championship
    const currentLeague = TEAM_DATABASE[state.club]?.league;
    if (currentLeague === "Championship" && !tierByRep.includes("Championship")) tierByRep.push("Championship");
    if (["League1","League2"].includes(currentLeague)) { tierByRep = ["Championship","League1","League2"]; }
    const englishPool = [...getPLLeagueClubs(), ...getChampionshipClubs(), ...getLeague1Clubs(), ...getLeague2Clubs()];
    const pool = englishPool.filter((t) => t !== state.club && tierByRep.includes(TEAM_DATABASE[t].league) &&
      !(PL_TIERS.includes(TEAM_DATABASE[t].league) && state.age > 37));
    // Abroad moves require a World Class agent (or a very high-profile player).
    // Without a world class agent abroad offers are almost never generated.
    const agentKey = state.agent ? state.agent.key : "poor";
    const abroadChance = agentKey === "worldclass" ? 0.85 : agentKey === "average" ? 0.08 : 0.02;
    if (rand() < abroadChance && state.reputation >= 50) {
      const foreignElite = getForeignLeagueClubs().filter((t) => t !== state.club && ["LaLiga", "SerieA", "Bundesliga"].includes(TEAM_DATABASE[t].league));
      pool.push(...foreignElite);
    }
    const n = clamp(randInt(1, 3), 1, pool.length);
    const offers = [], used = new Set();
    // Bound on used.size (not offers.length) — every candidate is tried at most once,
    // so this always terminates even if every club in the pool refuses to offer a deal.
    while (offers.length < n && used.size < pool.length) {
      const c = choice(pool);
      if (used.has(c)) continue;
      used.add(c);
      const offer = computeClubContractOffer(sd, c);
      if (offer.refused) continue; // team declines to offer a contract
      offers.push({ club: c, years: offer.years, playtime: offer.playtime, injuryRisk: offer.injuryRisk });
    }
    return offers;
  }

  // Agent forces a better offer. Better agents pull from higher tiers and have a
  // higher chance of finding a destination at all.
  function generateAgentForcedOffers(sd, agent) {
    const offers = [];
    const rep = state.reputation;
    // Start at the player's natural tier then push upward based on agent.
    let tierByRep = rep >= 80 ? ["Elite", "Europe"] :
      rep >= 60 ? ["Elite", "Europe", "Mid"] :
      rep >= 40 ? ["Europe", "Mid", "Lower"] : ["Mid", "Lower", "Championship"];
    if (agent.influence >= 0.08 && !tierByRep.includes("Elite")) tierByRep.push("Elite");
    if (agent.influence >= 0.18 && !tierByRep.includes("Europe")) tierByRep.push("Europe");
    const englishPool = [...getPLLeagueClubs(), ...getChampionshipClubs(), ...getLeague1Clubs(), ...getLeague2Clubs()];
    const pool = englishPool.filter((t) => t !== state.club && tierByRep.includes(TEAM_DATABASE[t].league) &&
      !(PL_TIERS.includes(TEAM_DATABASE[t].league) && state.age > 37));
    if (agent.key === "worldclass" && rep >= 50) {
      const foreign = getForeignLeagueClubs().filter((t) => t !== state.club && ["LaLiga", "SerieA", "Bundesliga"].includes(TEAM_DATABASE[t].league));
      pool.push(...foreign);
    }
    if (!pool.length) return [];
    // Agent influence also improves the quality of the club chosen (sort by strength, weight top).
    const sorted = pool.map((c) => ({ c, str: TEAM_DATABASE[c].attack + TEAM_DATABASE[c].midfield + TEAM_DATABASE[c].defence + TEAM_DATABASE[c].manager })).sort((a, b) => b.str - a.str);
    const top = sorted.slice(0, Math.min(sorted.length, 8));
    const n = Math.min(3, top.length);
    const used = new Set();
    // Bound on used.size (not offers.length) — every candidate is tried at most once,
    // so this always terminates even if every club in the top pool refuses a deal.
    while (offers.length < n && used.size < top.length) {
      const pick = weightedRandomPick(top.map((x) => ({ item: x, weight: x.str })));
      if (!pick || used.has(pick.c)) continue;
      used.add(pick.c);
      const offer = computeClubContractOffer(sd, pick.c);
      if (offer.refused) continue;
      offers.push({ club: pick.c, years: offer.years, playtime: offer.playtime, injuryRisk: offer.injuryRisk, wage: offer.wage });
    }
    return offers;
  }

  // Forced offers to MLS/Saudi/Championship for aging players only (33+).
  // Prime star players at elite clubs should never be randomly forced abroad
  // or down to the Championship.
  function generateForcedDestinationOffers(sd) {
    const offers = [];
    const age = state.age;
    const rep = state.reputation;
    const clubData = TEAM_DATABASE[state.club];
    const isEliteStar = state.role === "Star" && clubData.league === "Elite";
    if (isEliteStar && age < 33) return offers;
    // MLS/Saudi for older players with some reputation
    if (age >= 33 && rep >= 35) {
      const pool = getForeignLeagueClubs().filter((t) => ["MLS", "Saudi"].includes(TEAM_DATABASE[t].league));
      const c = choice(pool);
      const offer = computeClubContractOffer(sd, c);
      if (!offer.refused) offers.push({ club: c, years: offer.years, playtime: offer.playtime, injuryRisk: offer.injuryRisk, wage: offer.wage, forced: true, foreign: true });
    }
    // Championship for players who drop off the elite ladder
    if (age >= 33 && rep >= 25 && !offers.length) {
      const pool = getChampionshipClubs().filter((t) => t !== state.club);
      if (pool.length) {
        const c = choice(pool);
        const offer = computeClubContractOffer(sd, c);
        if (!offer.refused) offers.push({ club: c, years: offer.years, playtime: offer.playtime, injuryRisk: offer.injuryRisk, wage: offer.wage, forced: true });
      }
    }
    return offers;
  }

  /* ------------------------------ SEASON FLOW --------------------------- */
  function renderCareerStats() {
    const el = document.getElementById("career-stats-content");
    if (!el) return;
    const h = state.honours;

    // ── Trophies & Awards ──
    const trophies = [];
    if (h.leagueTitles) trophies.push({ label: `League Titles ${h.leagueTitles}`, cls: "" });
    if (h.domesticCups) trophies.push({ label: `Domestic Cups ${h.domesticCups}`, cls: "" });
    if (h.europeanCups) trophies.push({ label: `European Cups ${h.europeanCups}`, cls: "" });
    if (h.intlTrophies) trophies.push({ label: `Intl Trophies ${h.intlTrophies}`, cls: "intl" });
    const awards = [];
    if (h.goldenBoots) awards.push({ label: `Golden Boots ${h.goldenBoots}`, cls: "award" });
    if (h.ballonDors) awards.push({ label: `Ballon d'Or ${h.ballonDors}`, cls: "award" });
    if (h.playerOfSeason) awards.push({ label: `POTS ${h.playerOfSeason}`, cls: "award" });
    if (h.youngPlayer) awards.push({ label: `Young POTY ${h.youngPlayer}`, cls: "award" });
    if (h.tots) awards.push({ label: `TOTS ${h.tots}`, cls: "award" });
    const trophyHtml = trophies.length
      ? `<div class="cs-honours">${trophies.map((t) => `<span class="cs-hon ${t.cls}">${esc(t.label)}</span>`).join("")}</div>`
      : `<div class="cs-empty">No trophies yet</div>`;
    const awardsHtml = awards.length
      ? `<div class="cs-honours">${awards.map((a) => `<span class="cs-hon ${a.cls}">${esc(a.label)}</span>`).join("")}</div>`
      : `<div class="cs-empty">No individual awards yet</div>`;
    const intlHtml = state.intlCaps
      ? `<div class="cs-honours"><span class="cs-hon intl">${state.intlCaps} caps / ${state.intlGoals} goals</span></div>`
      : `<div class="cs-empty">No international caps yet</div>`;

    // ── Career numbers ──
    const g = state.totalGoals;
    const a = state.totalAssists;
    const apps = state.totalApps;
    const leagueG = state.leagueGoals;
    const cupG = state.cupGoals;
    const euroG = state.europeGoals;
    const intlG = state.intlGoals;
    const seasons = Math.max(1, state.season);
    const avgGoals = (g / seasons).toFixed(1);
    const avgApps = (apps / seasons).toFixed(1);
    const gpg = apps > 0 ? (g / apps).toFixed(2) : "0.00";
    const apg = apps > 0 ? (a / apps).toFixed(2) : "0.00";
    const gRate = Math.round((g / LEVERS.goalTarget) * 100);

    // ── Profile section ──
    const agent = state.agent || { key: "poor", label: "—" };
    const origin = state.player.origin || COUNTRY_ORIGINS["England"];
    const atrs = state.attrs || {};
    const agentBadgeClass = agent.key || "poor";
    const radarId = "career-radar";

    // ── Club history table ──
    const clubOrder = [...(state.clubsPlayed || [])];
    const clubHistoryRows = clubOrder.map((club) => {
      const cs = state.clubStats[club] || { apps: 0, goals: 0, assists: 0, seasons: 0, titles: 0 };
      const titleStr = cs.titles > 0 ? `🏆${cs.titles}` : "—";
      const leagueLabel = (TEAM_DATABASE[club] || {}).league || "—";
      return `<tr>
        <td class="ch-club">${esc(club)}</td>
        <td class="ch-muted">${esc(leagueLabel)}</td>
        <td class="ch-muted">${cs.seasons}</td>
        <td class="ch-num">${cs.goals}</td>
        <td class="ch-muted">${cs.assists}</td>
        <td class="ch-muted">${cs.apps}</td>
        <td class="ch-muted">${titleStr}</td>
      </tr>`;
    }).join("");
    const clubHistoryHtml = clubOrder.length
      ? `<table class="club-history-table">
          <thead><tr><th>Club</th><th>League</th><th>Seasons</th><th>Goals</th><th>Assists</th><th>Apps</th><th>Titles</th></tr></thead>
          <tbody>${clubHistoryRows}</tbody>
        </table>`
      : `<div class="cs-empty">No clubs yet</div>`;

    el.innerHTML = `
      <div class="career-stats-grid">
        <div class="cs-box"><div class="cs-num">${g}</div><div class="cs-lab">Career Goals</div></div>
        <div class="cs-box"><div class="cs-num">${apps}</div><div class="cs-lab">Apps</div></div>
        <div class="cs-box"><div class="cs-num">${a}</div><div class="cs-lab">Assists</div></div>
        <div class="cs-box"><div class="cs-num">${leagueG}</div><div class="cs-lab">League</div></div>
        <div class="cs-box"><div class="cs-num">${cupG}</div><div class="cs-lab">Cups</div></div>
        <div class="cs-box"><div class="cs-num">${euroG}</div><div class="cs-lab">Europe</div></div>
      </div>
      <div class="cs-section-title">Averages</div>
      <div class="career-stats-grid">
        <div class="cs-box"><div class="cs-num">${avgGoals}</div><div class="cs-lab">Goals / Season</div></div>
        <div class="cs-box"><div class="cs-num">${avgApps}</div><div class="cs-lab">Apps / Season</div></div>
        <div class="cs-box"><div class="cs-num">${gpg}</div><div class="cs-lab">Goals / Game</div></div>
        <div class="cs-box"><div class="cs-num">${apg}</div><div class="cs-lab">Assists / Game</div></div>
        <div class="cs-box"><div class="cs-num">${gRate}%</div><div class="cs-lab">To 1000</div></div>
        <div class="cs-box"><div class="cs-num">${state.bestRating}</div><div class="cs-lab">Best Rating</div></div>
      </div>
      <div class="cs-section-title">Trophies</div>${trophyHtml}
      <div class="cs-section-title">Awards</div>${awardsHtml}
      <div class="cs-section-title">International</div>${intlHtml}
      <div class="cs-section-title">Club Career History</div>${clubHistoryHtml}
      <div class="cs-section-title">Player Profile</div>
      <div class="profile-top">
        <div class="profile-left">
          <div class="profile-grid">
            <div class="profile-card">
              <div class="pc-label">Playstyle</div>
              <div class="pc-val">${esc(state.playstyle)}</div>
              <div class="pc-meta">${esc(PLAYSTYLE_PROFILES[state.playstyle]?.desc || "")}</div>
            </div>
            <div class="profile-card">
              <div class="pc-label">Position</div>
              <div class="pc-val">${esc((POSITIONS[state.position] || POSITIONS.ST).label)}</div>
              <div class="pc-meta">${esc(state.position)}</div>
            </div>
            <div class="profile-card">
              <div class="pc-label">Origin</div>
              <div class="pc-val">${origin.flag} ${esc(state.country)}</div>
              <div class="pc-meta">${esc(origin.story)}</div>
            </div>
            <div class="profile-card">
              <div class="pc-label">Mentality</div>
              <div class="pc-val ${mentIsSpecial(state.mentality) ? "rare" : ""}">${esc(state.mentality)}</div>
              <div class="pc-meta">Personality on the pitch</div>
            </div>
            <div class="profile-card">
              <div class="pc-label">Agent</div>
              <div class="pc-val">${esc(agent.label)}<span class="agent-tier-badge ${agentBadgeClass}">${esc(agent.label)}</span></div>
              <div class="pc-meta">Contract negotiator${agent.key === "worldclass" ? " · unlocks abroad moves" : ""}</div>
            </div>
            <div class="profile-card">
              <div class="pc-label">Peak Rating</div>
              <div class="pc-val">${state.baseRating}</div>
              <div class="pc-meta">Current ability</div>
            </div>
          </div>
          <div class="profile-section" style="margin-top:0">
            <h4>Attributes</h4>
            <div class="profile-attrs">
              <div><span>Heading</span><b>${atrs.heading || "—"}</b></div>
              <div><span>Left Foot</span><b>${atrs.leftFoot || "—"}</b></div>
              <div><span>Right Foot</span><b>${atrs.rightFoot || "—"}</b></div>
              <div><span>Speed</span><b>${atrs.speed || "—"}</b></div>
              <div><span>Strength</span><b>${atrs.strength || "—"}</b></div>
              <div><span>Fitness</span><b>${atrs.fitness || "—"}</b></div>
              <div><span>Height</span><b>${atrs.height || "—"}cm</b></div>
              <div><span>Weight</span><b>${atrs.weight || "—"}kg</b></div>
            </div>
          </div>
        </div>
        <div class="profile-radar"><canvas id="${radarId}" width="400" height="320"></canvas></div>
      </div>
      <div class="profile-section career-biography">
        <h4>Career Biography</h4>
        <div id="career-biography-content">${buildBiographyHtml()}</div>
      </div>`;
    requestAnimationFrame(() => {
      const canvas = document.getElementById(radarId);
      if (canvas && state.attrs) drawRadarChart(canvas, state.attrs);
    });
  }

  function renderAllTimeGreats() {
    const el = document.getElementById("alltime-content");
    if (!el) return;
    const g = state.totalGoals;
    const a = state.totalAssists;
    const apps = state.totalApps;
    const leagueG = state.leagueGoals;
    const intlG = state.intlGoals;
    const rec = ALL_TIME_RECORDS;
    const recordsHtml = `
      <div class="records-table">
        <div class="rec-row head"><span>Stat</span><span>Record Holder</span><span>Total</span><span>You</span></div>
        <div class="rec-row"><span>PL Goals</span><span>${esc(rec.plGoals.recordHolder)}</span><span>${rec.plGoals.total}</span><span>${leagueG}</span></div>
        <div class="rec-row"><span>PL Assists</span><span>${esc(rec.plAssists.recordHolder)}</span><span>${rec.plAssists.total}</span><span>${a}</span></div>
        <div class="rec-row"><span>PL Appearances</span><span>${esc(rec.plAppearances.recordHolder)}</span><span>${rec.plAppearances.total}</span><span>${apps}</span></div>
        <div class="rec-row"><span>Career Goals</span><span>${esc(rec.careerGoals.recordHolder)}</span><span>${rec.careerGoals.total}</span><span>${g}</span></div>
        <div class="rec-row"><span>Career Assists</span><span>${esc(rec.careerAssists.recordHolder)}</span><span>${rec.careerAssists.total}</span><span>${a}</span></div>
        <div class="rec-row"><span>Intl Caps</span><span>${esc(rec.intlCaps.recordHolder)}</span><span>${rec.intlCaps.total}</span><span>${state.intlCaps}</span></div>
        <div class="rec-row"><span>Intl Goals</span><span>${esc(rec.intlGoals.recordHolder)}</span><span>${rec.intlGoals.total}</span><span>${intlG}</span></div>
        <div class="rec-row"><span>Ballon d'Or</span><span>${esc(rec.ballonDors.recordHolder)}</span><span>${rec.ballonDors.total}</span><span>${state.honours.ballonDors}</span></div>
        <div class="rec-row"><span>UCL Goals</span><span>${esc(rec.championsLeagueGoals.recordHolder)}</span><span>${rec.championsLeagueGoals.total}</span><span>${state.europeGoals}</span></div>
        <div class="rec-row"><span>World Cup Goals</span><span>${esc(rec.worldCupGoals.recordHolder)}</span><span>${rec.worldCupGoals.total}</span><span>—</span></div>
      </div>`;
    const mkTop10 = (list, val) => insertPlayerIntoTop10(list, val, state.player.name || "You")
      .map((r, i) => `<div class="top10-row${r.mine ? " mine" : ""}"><span>${i + 1}</span><span>${esc(r.name)}</span><span>${r.total}</span></div>`)
      .join("");
    el.innerHTML = `
      <div class="wip-banner">
        <div class="wip-banner-title">🏆 All Time Greats</div>
        <div class="wip-banner-sub">Work in progress — more legends, head-to-head comparisons and era rankings coming soon.</div>
      </div>
      <div class="cs-section-title">All-Time Records</div>${recordsHtml}
      <div class="cs-section-title">All-Time Top Scorers</div>
      <div class="top10-table">${mkTop10(TOP_10_ALL_TIME_GOALS, g)}</div>
      <div class="cs-section-title">Top PL Scorers</div>
      <div class="top10-table">${mkTop10(TOP_10_PL_GOALS, leagueG)}</div>
      <div class="cs-section-title">Top PL Assists</div>
      <div class="top10-table">${mkTop10(TOP_10_PL_ASSISTS, a)}</div>
      <div class="cs-section-title">Top PL Appearances</div>
      <div class="top10-table">${mkTop10(TOP_10_PL_APPEARANCES, apps)}</div>
      <div class="cs-section-title">Top International Caps</div>
      <div class="top10-table">${mkTop10(TOP_10_INTL_CAPS, state.intlCaps)}</div>
      <div class="cs-section-title">Top International Goals</div>
      <div class="top10-table">${mkTop10(TOP_10_INTL_GOALS, intlG)}</div>`;
  }

  function insertPlayerIntoTop10(list, total, name) {
    const copy = list.map((r) => ({ ...r, mine: false }));
    if (total > 0) {
      const idx = copy.findIndex((r) => total > r.total);
      if (idx !== -1) {
        copy.splice(idx, 0, { name, total, mine: true });
      } else {
        copy.push({ name, total, mine: true });
      }
    }
    return copy.slice(0, 10);
  }

  function renderProfile() {
    const el = document.getElementById("profile-content");
    if (!el) return;
    const agent = state.agent || { label: "—" };
    const origin = state.player.origin || COUNTRY_ORIGINS["England"];
    const a = state.attrs;
    const radarId = "profile-radar";
    el.innerHTML = `
      <div class="profile-grid">
        <div class="profile-card">
          <div class="pc-label">Playstyle</div>
          <div class="pc-val">${esc(state.playstyle)}</div>
          <div class="pc-meta">${esc(PLAYSTYLE_PROFILES[state.playstyle]?.desc || "")}</div>
        </div>
        <div class="profile-card">
          <div class="pc-label">Position</div>
          <div class="pc-val">${esc((POSITIONS[state.position] || POSITIONS.ST).label)}</div>
          <div class="pc-meta">${esc(state.position)}</div>
        </div>
        <div class="profile-card">
          <div class="pc-label">Origin</div>
          <div class="pc-val">${origin.flag} ${esc(state.country)}</div>
          <div class="pc-meta">${esc(origin.story)}</div>
        </div>
        <div class="profile-card">
          <div class="pc-label">Mentality</div>
          <div class="pc-val ${mentIsSpecial(state.mentality) ? "rare" : ""}">${esc(state.mentality)}</div>
          <div class="pc-meta">Personality on the pitch</div>
        </div>
        <div class="profile-card">
          <div class="pc-label">Agent</div>
          <div class="pc-val">${esc(agent.label)}</div>
          <div class="pc-meta">Contract negotiator</div>
        </div>
        <div class="profile-card">
          <div class="pc-label">Peak Rating</div>
          <div class="pc-val">${state.baseRating}</div>
          <div class="pc-meta">Current ability</div>
        </div>
      </div>
      <div class="profile-section">
        <h4>Attributes</h4>
        <div class="profile-attrs">
          <div><span>Heading</span><b>${a.heading}</b></div>
          <div><span>Left Foot</span><b>${a.leftFoot}</b></div>
          <div><span>Right Foot</span><b>${a.rightFoot}</b></div>
          <div><span>Speed</span><b>${a.speed}</b></div>
          <div><span>Strength</span><b>${a.strength}</b></div>
          <div><span>Fitness</span><b>${a.fitness}</b></div>
          <div><span>Height</span><b>${a.height}cm</b></div>
          <div><span>Weight</span><b>${a.weight}kg</b></div>
        </div>
      </div>
      <div class="profile-radar"><canvas id="${radarId}" width="260" height="200"></canvas></div>
    `;
    requestAnimationFrame(() => {
      const canvas = document.getElementById(radarId);
      if (canvas && state.attrs) drawRadarChart(canvas, state.attrs);
    });
  }

  function toggleProfile(show) {
    const panel = document.getElementById("profile-panel");
    if (!panel) return;
    panel.style.display = show ? "block" : "none";
    if (show) renderProfile();
  }

  function switchCareerTab(tab) {
    document.querySelectorAll(".career-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    document.querySelectorAll(".career-panel").forEach((p) => p.classList.toggle("active", p.dataset.tab === tab));
    if (tab === "stats") renderCareerStats();
    if (tab === "history") renderCareerLog();
    if (tab === "leagues") renderLeaguesView();
    if (tab === "alltime") renderAllTimeGreats();
  }

  // ── Log Preview (Season tab) ───────────────────────────────────────────────
  function renderLogPreview() {
    const wrap = document.getElementById("log-preview-entries");
    if (!wrap || typeof wrap.appendChild !== "function" || !state || !state.careerLog) return;
    const entries = state.careerLog.slice(0, 5);
    wrap.innerHTML = "";
    if (!entries.length) { wrap.innerHTML = `<div class="log-entry info">No activity yet.</div>`; return; }
    entries.forEach((entry) => {
      const div = document.createElement("div");
      div.className = "log-entry " + (entry.cls || "");
      div.textContent = entry.text;
      wrap.appendChild(div);
    });
  }

  // ── Leagues View ───────────────────────────────────────────────────────────
  const LEAGUE_DISPLAY_ORDER = [
    "Premier League", "Championship", "League 1", "League 2", "National League",
  ];
  const LEAGUE_RELEGATION_ZONES = {
    "Premier League": 3, "Championship": 3, "League 1": 3, "League 2": 2, "National League": 2,
  };
  const LEAGUE_UCL_SPOTS = { "Premier League": 4 };
  const LEAGUE_UEL_SPOTS = { "Premier League": 2 };

  function renderLeaguesView() {
    const el = document.getElementById("leagues-view-content");
    if (!el) return;
    const snap = state && state.leagueStandings;
    if (!snap || !Object.keys(snap).length) {
      el.innerHTML = `<div class="leagues-no-data">Play a season to see league standings.</div>`;
      return;
    }
    const blocks = LEAGUE_DISPLAY_ORDER
      .filter((name) => snap[name] && snap[name].length)
      .map((name) => {
        const rows = snap[name];
        const winner = rows[0] ? rows[0].team : "—";
        const n = rows.length;
        const relZone = LEAGUE_RELEGATION_ZONES[name] || 3;
        const relStart = n - relZone;
        const uclSpots = LEAGUE_UCL_SPOTS[name] || 0;
        const uelSpots = LEAGUE_UEL_SPOTS[name] || 0;
        const isPlayerLeague = state.club && rows.some((r) => r.team === state.club);

        const tableRows = rows.map((r, i) => {
          const mine = r.team === state.club ? "mine" : "";
          const zone = i === 0 ? "champ"
            : (uclSpots && i < uclSpots) ? "ucl"
            : (uelSpots && i < uclSpots + uelSpots) ? "uel"
            : i >= relStart ? "releg" : "";
          const gd = r.GD != null ? r.GD : (r.GF != null && r.GA != null ? r.GF - r.GA : "—");
          const gdStr = typeof gd === "number" ? (gd > 0 ? "+" + gd : String(gd)) : gd;
          if (r.P != null) {
            return `<tr class="${zone} ${mine}"><td>${i + 1}</td><td class="lt-team">${esc(r.team)}</td><td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td><td>${r.GF}</td><td>${r.GA}</td><td>${gdStr}</td><td class="lt-pts">${r.Pts}</td></tr>`;
          } else {
            return `<tr class="${zone} ${mine}"><td>${i + 1}</td><td class="lt-team" colspan="9">${esc(r.team)}</td></tr>`;
          }
        }).join("");

        const hasFullStats = rows[0] && rows[0].P != null;
        const thead = hasFullStats
          ? `<tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr>`
          : `<tr><th>#</th><th>Club</th></tr>`;

        return `<div class="league-block${isPlayerLeague ? " open" : ""}" data-league="${esc(name)}">
          <div class="league-block-header" onclick="this.parentElement.classList.toggle('open')">
            <span class="league-block-name">${esc(name)}</span>
            <span class="league-block-winner">🏆 ${esc(winner)}</span>
          </div>
          <div class="league-block-table">
            <table class="league-table">
              <thead>${thead}</thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>`;
      });

    el.innerHTML = `<div class="leagues-view">${blocks.join("")}</div>`;
  }

  function renderCareerHeader() {
    document.getElementById("career-season").textContent = `SEASON ${state.season}`;
    document.getElementById("hdr-age").textContent = state.age;
    document.getElementById("hdr-goals").textContent = state.totalGoals;
    document.getElementById("hdr-club").textContent = state.club;
    const pos = POSITIONS[state.position] || POSITIONS.ST;
    document.getElementById("hdr-position").innerHTML = `${esc(pos.label)} <span class="career-pos">${esc(state.position)}</span>`;
    const pct = clamp((state.totalGoals / LEVERS.goalTarget) * 100, 0, 100);
    document.getElementById("goal-progress-fill").style.width = pct + "%";
    document.getElementById("goal-progress-label").textContent = `${state.totalGoals} / ${LEVERS.goalTarget} career goals`;
    renderCareerStats();
    renderLogPreview();
  }

  function renderSeasonReady() {
    const box = document.getElementById("season-action");
    const pos = POSITIONS[state.position] || POSITIONS.ST;
    box.innerHTML = `
      <div class="season-prompt">Age ${state.age} · ${esc(state.club)} · ${pos.label} · projected role: <strong>${determineRole()}</strong> · ${ageBracket(state.age)}</div>
      <button class="btn primary big" id="btn-play-season">▶ PLAY SEASON ${state.season}</button>`;
    document.getElementById("btn-play-season").addEventListener("click", playSeason);
  }

  function playSeason() {
    document.getElementById("season-action").innerHTML = `<div class="simming">Simulating season ${state.season}…</div>`;
    // Snapshot before simulating so a mid-simulation crash can be rolled back cleanly
    // instead of leaving partially-applied mutations behind on retry.
    const preSeasonSnapshot = serializeState(state);
    setTimeout(() => {
      try {
        applyPendingCarryOver(); // delayed effects from previous season decisions
        if (state.retireNow) { state.retireNow = false; beginRetirement("injury"); return; }
        const sd = simulateSeason();
        if (state.retireNow) { state.retireNow = false; beginRetirement("injury"); return; }
        const intl = simulateInternational();
        renderSeasonResult(sd, intl);
        renderCareerHeader();
        let line = `S${state.season} (age ${state.age}) — ${state.club}: ${sd.goals}g ${sd.assists}a in ${sd.apps} apps (${sd.rating}). ${ordinal(sd.pos)} [${sd.trajectory}]. ${sd.role}.`;
        if (sd.honours.length) line += ` 🏆 ${sd.honours.join(", ")}.`;
        if (sd.awards.length) line += ` 🎖 ${sd.awards.join(", ")}.`;
        if (intl && intl.goals) line += ` 🦁 +${intl.goals} for ${state.country}${intl.tournamentName ? ` at ${intl.tournamentName}` : ""}.`;
        log(line, perfClass(sd.perfTier));
        const bioLine = narrateSeasonForBio(sd, intl);
        if (bioLine) addBioMoment(bioLine);
        if (state.finalSeasonForced) {
          state.finalSeasonForced = false;
          log(`   ↳ 🕯️ Last Dance complete. ${state.player.name} is forced into retirement.`, "milestone");
          beginRetirement("planned");
          return;
        }

        // Career milestone (age-gated) first, then mandatory season decision, then random events.
        const milestone = checkCareerMilestone();
        if (milestone) presentCareerMilestone(milestone, sd, intl);
        else presentSeasonDecision(sd, intl);
      } catch (err) {
        console.error("Season simulation failed", err);
        // Failsafe: a simulation crash before age 35 is a bug, not a real career-ending
        // event — force-retiring a young player here would be incorrect. Instead, roll
        // back any partial mutations from this attempt and let the user retry the
        // same season rather than losing the career.
        if (state.age < 35) {
          state = deserializeState(preSeasonSnapshot);
          renderCareerFlowError(playSeason);
          return;
        }
        // 35+ players: treat the crash as a career-ending injury rather than leaving
        // the player stuck on a frozen screen.
        log(`   ↳ 🚑 ${state.player.name} suffered a career-ending injury in pre-season and is forced to retire.`, "milestone");
        state.retired = true;
        state.endCareerReason = "injury";
        state.seasonHistory.push({ season: state.season, club: state.club, goals: 0, apps: 0, assists: 0, pos: 0 });
        saveState();
        beginRetirement("injury");
      }
    }, 400);
  }

  // Generic recovery screen shown whenever a career-flow action throws below age 35.
  // `retry` re-runs the exact action that failed (state has already been rolled back).
  function renderCareerFlowError(retry) {
    const box = document.getElementById("season-action");
    box.innerHTML = `
      <div class="season-prompt">⚠️ Something went wrong continuing the career (age ${state.age}). This is a bug, not a career-ending event — no progress was lost.</div>
      <button class="btn primary big" id="btn-retry-action">🔄 Retry</button>`;
    document.getElementById("btn-retry-action").addEventListener("click", retry);
  }

  // Wraps a career-flow action (typically a button click handler) so that a thrown
  // error below age 35 rolls back to the pre-action state and offers a retry instead
  // of leaving the game stuck on a frozen screen or forcing an incorrect retirement.
  // 35+ is treated as a real career-ending injury, matching the playSeason failsafe.
  function withFailsafe(fn) {
    const wrapped = function (...args) {
      const snapshot = serializeState(state);
      try {
        return fn.apply(this, args);
      } catch (err) {
        console.error("Career action failed", err);
        if (state.age < 35) {
          state = deserializeState(snapshot);
          renderCareerFlowError(() => wrapped.apply(this, args));
        } else {
          state = deserializeState(snapshot);
          log(`   ↳ 🚑 ${state.player.name} suffered a career-ending injury and is forced to retire.`, "milestone");
          state.retired = true;
          state.endCareerReason = "injury";
          saveState();
          beginRetirement("injury");
        }
      }
    };
    return wrapped;
  }

  function renderSeasonResult(sd, intl) {
    const box = document.getElementById("season-result");
    const intlHtml = intl ? `<div class="stat-box"><div class="sb-num">${intl.caps}</div><div class="sb-lab">${state.country} Caps</div></div><div class="stat-box"><div class="sb-num">${intl.goals}</div><div class="sb-lab">${state.country} Goals</div></div>` : "";
    const honoursHtml = (sd.honours.length || sd.awards.length)
      ? `<div class="season-honours">${sd.honours.map((h) => `<span class="hon-badge title">🏆 ${h}</span>`).join("")}${sd.awards.map((a) => `<span class="hon-badge award">🎖 ${a}</span>`).join("")}</div>` : "";
    const seasonSummary = `
      <div class="season-summary">
        <div class="summary-row">
          <span class="summary-label">Season total</span>
          <span class="summary-val">${sd.goals} goals · ${sd.assists} assists · ${sd.apps} apps</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Goal breakdown</span>
          <span class="summary-val">League ${sd.leagueGoals || sd.goals} · Cup ${sd.cupGoals || 0} · Europe ${sd.europeGoals || 0}</span>
        </div>
        ${intl ? `<div class="summary-row"><span class="summary-label">International</span><span class="summary-val">${intl.caps} caps · ${intl.goals} goals${intl.tournamentName ? ` · ${intl.tournamentName}` : ""}</span></div>` : ""}
        <div class="summary-row">
          <span class="summary-label">Career total</span>
          <span class="summary-val">${state.totalGoals} goals · ${state.totalAssists} assists · ${state.totalApps} apps</span>
        </div>
      </div>`;
    box.innerHTML = `
      <div class="result-banner ${perfClass(sd.perfTier)}">${sd.perfTier} season — finished ${ordinal(sd.pos)} (${sd.trajectory})${sd.champion === state.club ? " 🏆" : ""}</div>
      ${seasonSummary}
      ${honoursHtml}
      <div class="stat-grid">
        <div class="stat-box"><div class="sb-num">${sd.goals}</div><div class="sb-lab">Goals</div></div>
        <div class="stat-box"><div class="sb-num">${sd.assists}</div><div class="sb-lab">Assists</div></div>
        <div class="stat-box"><div class="sb-num">${sd.apps}</div><div class="sb-lab">Apps</div></div>
        <div class="stat-box"><div class="sb-num">${sd.rating}</div><div class="sb-lab">Avg Rating</div></div>
        <div class="stat-box"><div class="sb-num">${sd.yellow}/${sd.red}</div><div class="sb-lab">Yel/Red</div></div>
        ${intlHtml}
      </div>
      ${renderLeagueTable(sd)}`;
  }

  function renderLeagueTable(sd) {
    if (!state.leagueTable) return "";
    const tableSize = state.leagueTable.length;
    // Relegation zone: bottom 3 for PL (20 clubs), bottom 3 for Championship/L1/L2 (24 clubs),
    // bottom 2 for National League. UCL/UEL zones only apply in the PL.
    const isPL = PL_TIERS.includes(TEAM_DATABASE[state.club] && TEAM_DATABASE[state.club].league);
    const relegStart = tableSize - (tableSize <= 20 ? 3 : tableSize <= 24 ? 3 : 2);
    const rows = state.leagueTable.map((r, i) => {
      const gd = r.GF - r.GA;
      const zone = i === 0 ? "champ" : isPL && i <= 3 ? "ucl" : isPL && i <= 5 ? "uel" : i >= relegStart ? "releg" : "";
      const mine = r.team === state.club ? "mine" : "";
      return `<tr class="${zone} ${mine}"><td>${i + 1}</td><td class="lt-team">${esc(r.team)}</td><td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td><td>${r.GF}</td><td>${r.GA}</td><td>${gd > 0 ? "+" : ""}${gd}</td><td class="lt-pts">${r.Pts}</td></tr>`;
    }).join("");
    return `
      <details class="league-details"><summary>Final League Table — ${ordinal(sd.pos)}</summary>
      <table class="league-table"><thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
      <tbody>${rows}</tbody></table></details>`;
  }

  function presentEventQueue(events, idx, sd, intl, ctx) {
    if (!events || !events[idx]) {
      proceedToTransfer(sd, intl);
      return;
    }
    const ev = events[idx];
    const box = document.getElementById("season-action");
    const name = state.player.name;
    const ctx2 = ctx || buildContext(sd);
    const text = typeof ev.text === "function" ? ev.text(name, ctx2) : ev.text;
    const choices = typeof ev.choices === "function" ? ev.choices(ctx2) : ev.choices;
    const eventNum = events.length > 1 ? ` (${idx + 1}/${events.length})` : "";
    const choicesHtml = choices.map((c, i) => `<button class="btn choice" data-i="${i}">${c.label}</button>`).join("");
    box.innerHTML = `
      <div class="decision ${ev.milestone ? "milestone-event" : ""}">
        <div class="decision-tag">${ev.milestone ? "MILESTONE" : ev.tag} EVENT${eventNum}</div>
        <div class="decision-text">${esc(text)}</div>
        <div class="decision-choices">${choicesHtml}</div>
      </div>`;
    box.querySelectorAll(".choice").forEach((btn) => {
      btn.addEventListener("click", withFailsafe(() => {
        const c = choices[parseInt(btn.dataset.i, 10)];
        applyEffects(c.fx, ev.milestone ? 1 : EVENT_REWARD_MULTIPLIER);
        log(`   ↳ ${ev.milestone ? "🏅" : "🗲"} ${text.replace(/\.$/, "")} → "${c.label}"`, "decision");
        renderCareerHeader();
        saveState();
        if (state.retireNow) { state.retireNow = false; beginRetirement("injury"); return; }
        if (idx + 1 < events.length) presentEventQueue(events, idx + 1, sd, intl, ctx2);
        else proceedToTransfer(sd, intl);
      }));
    });
  }

  function proceedToTransfer(sd, intl) {
    if (state.totalGoals >= LEVERS.goalTarget) { beginRetirement("goal"); return; }
    returnFromLoanIfDue();
    applySeasonalAttributeChanges(sd);
    state.yearsAtClub++;
    // Fire-agent event: eligible once every 3 seasons, only if not already world class,
    // and only for players with some established career (season 3+).
    const agentKey = state.agent ? state.agent.key : "poor";
    const fireAgentCooldown = state.cooldowns["fireAgent"] || 0;
    if (agentKey !== "worldclass" && fireAgentCooldown <= 0 && state.season >= 3 && rand() < 0.28) {
      presentFireAgentEvent(sd, intl, () => _proceedToTransferInner(sd, intl));
      return;
    }
    _proceedToTransferInner(sd, intl);
  }

  function _proceedToTransferInner(sd, intl) {
    // Players now see out their contract unless an end-of-season event forces a move
    // or the club decides to sell them. Automatic restlessness is suppressed while contracted.
    const hasContract = state.contractYears > 0;
    const eventForcedMove = state.pendingTransfer;
    const restless = !hasContract && (
      (mentTag(state.mentality) === "winner" && state.age >= 24 && state.age <= 27 && TEAM_DATABASE[state.club].league !== "Elite") ||
      (state.reputation >= 70 && TEAM_DATABASE[state.club].league === "Lower") ||
      (rand() < 0.18 && state.yearsAtClub >= 3)
    );
    const wantsMove = eventForcedMove || restless;
    const loyalStay = hasContract && (mentTag(state.mentality) === "leader" || mentTag(state.mentality) === "consistency") && rand() < 0.6;
    const clubSells = shouldClubTransferOut(sd);
    // Loan candidates: young or out-of-favor players not already forced to
    // move/sold elsewhere get an occasional chance at a development loan for
    // regular first-team minutes.
    const loanEligible = !state.loan && !clubSells && !(wantsMove && !loyalStay) && hasContract &&
      ["Bench", "Rotation"].includes(state.role) && state.age <= 29 && rand() < 0.3;
    if (clubSells) presentTransfer(generateOffers(sd), sd, intl, true, clubSells.reason);
    else if (wantsMove && !loyalStay) presentTransfer(generateOffers(sd), sd, intl, false);
    else if (loanEligible) {
      const loanOffers = generateLoanOffers(sd);
      if (loanOffers.length) presentLoanOffers(loanOffers, sd, intl);
      else handleContractPhase(sd, intl);
    }
    else if (state.age >= 33 && !["LaLiga", "SerieA", "Bundesliga", "Saudi", "MLS", "Championship"].includes(TEAM_DATABASE[state.club].league) && rand() < 0.25) {
      const forced = generateForcedDestinationOffers(sd);
      if (forced.length) presentTransfer(forced, sd, intl, true);
      else handleContractPhase(sd, intl);
    }
    else handleContractPhase(sd, intl);
  }

  function handleContractPhase(sd, intl) {
    // Contract countdown; when it hits 0, force negotiation before next season
    normalizeContractState(state);
    state.contractYears = Math.max(0, state.contractYears - 1);
    if (state.contractYears <= 0) {
      presentContractNegotiation(sd, intl);
      return;
    }
    advanceToNextSeason();
  }

  function shouldClubTransferOut(sd) {
    const clubData = TEAM_DATABASE[state.club];
    const triggers = [];
    if (state.age <= 21 && state.reputation >= 50 && ["Star", "Starter"].includes(state.role) && clubData.league !== "Elite") triggers.push({ reason: "bigger clubs are circling", chance: 0.35 });
    if (state.age >= 31 && ["Flop", "Underperformed"].includes(sd.perfTier)) triggers.push({ reason: "the board questions your decline", chance: 0.28 });
    if (state.reputation >= 70 && clubData.league === "Lower") triggers.push({ reason: "the club cannot keep a star this big", chance: 0.38 });
    if (sd.trajectory === "Relegated" && ["Star", "Starter"].includes(state.role)) triggers.push({ reason: "relegation forces a rebuild", chance: 0.35 });
    if (state.flags.takeover || state.flags.financialCrisis) triggers.push({ reason: "boardroom pressure changes the project", chance: 0.30 });
    if (state.flags.rivalStriker || state.flags.newSigning) triggers.push({ reason: "a new attacking signing shifts the plan", chance: 0.25 });
    if (hasTrait("Journeyman") && state.reputation >= 60 && state.yearsAtClub >= 2) triggers.push({ reason: "the board cashes in on a hot market", chance: 0.25 });
    const hit = triggers.find((t) => rand() < t.chance);
    if (!hit) return null;
    return hit;
  }

  function presentTransfer(offers, sd, intl, forced, forcedReason, agentLock = false) {
    const box = document.getElementById("season-action");
    const isContractOffer = offers.length > 0 && offers[0].years != null;
    const isForeignForced = forced && offers.length > 0 && offers.every((o) => o.foreign);
    const isFreeAgent = isContractOffer && !forced;
    const isSold = forced && !isForeignForced;

    // Free agent / expired contract: cannot stay at the same club, must pick an offer or retire.
    // If the board is selling the player (not a free agent), force-stay is allowed but capped.
    const cards = offers.map((o, i) => {
      const t = TEAM_DATABASE[o.club];
      const roleEmoji = { Star: "⭐", Starter: "▶️", Rotation: "🔄", Bench: "🪑" }[o.playtime] || "";
      const riskLabel = o.injuryRisk >= 60 ? "high" : o.injuryRisk >= 35 ? "moderate" : "low";
      const riskColor = o.injuryRisk >= 60 ? "var(--bad)" : o.injuryRisk >= 35 ? "var(--gold)" : "var(--accent)";
      const estApps = Math.round({ Star: 34, Starter: 28, Rotation: 17, Bench: 8 }[o.playtime]);
      return `<button class="btn offer" data-i="${i}">
        <div class="offer-club">${esc(o.club)}</div>
        <div class="offer-meta">${t.league} · ATK ${t.attack} MID ${t.midfield} DEF ${t.defence} · ${t.tacticalStyle}</div>
        <div class="offer-contract">${o.years}-year deal · ${roleEmoji} ${o.playtime} · ~${estApps} apps</div>
        <div class="offer-wage">Wage: £${o.wage}k/week</div>
        <div class="offer-risk">Injury risk <span style="color:${riskColor}">${riskLabel}</span></div>
      </button>`;
    }).join("");

    const text = isForeignForced
      ? `A move abroad has come in for ${esc(state.player.name)}. Pick one of the offers — this is a one-time path that will define the rest of your career.`
      : isFreeAgent
        ? `Your contract at ${esc(state.club)} has expired. Clubs want you on a free transfer. Pick one or retire.`
        : isSold
          ? `The board wants to sell ${esc(state.player.name)}${forcedReason ? ` because ${esc(forcedReason)}` : ""}. You can force a stay, but the manager will likely reduce your role.`
          : `Offers are on the table${state.pendingTransfer ? " — and you've pushed to leave." : ""}. Where next?`;

    const stayBtn = isForeignForced || isFreeAgent
      ? `<button class="btn ghost" id="btn-stay">Retire instead</button>`
      : isSold
        ? `<button class="btn ghost" id="btn-stay">Refuse all offers — force a stay</button>`
        : `<button class="btn ghost" id="btn-stay">Stay at ${esc(state.club)}</button>`;

    // Agent can force a better move if the player has an agent and this is a transfer (not already free-agent contract offers).
    const canAgentForce = state.agent && !isFreeAgent && !isForeignForced && !agentLock;
    const agentBtn = canAgentForce
      ? `<button class="btn choice" id="btn-agent-force">🤝 Ask agent to force a better move</button>`
      : "";

    // Agent can negotiate a better situation when the player is forced out or on a free.
    const canAgentNegotiate = state.agent && (isFreeAgent || isSold) && !agentLock;
    const agentNegotiateBtn = canAgentNegotiate
      ? `<button class="btn choice" id="btn-agent-negotiate">🗣️ Send agent to negotiate</button>`
      : "";

    box.innerHTML = `
      <div class="transfer">
        <div class="decision-tag">${forced ? "CLUB FORCES TRANSFER" : isFreeAgent ? "FREE AGENT" : "TRANSFER WINDOW"}</div>
        <div class="decision-text">${esc(text)}</div>
        <div class="offers">${cards}</div>
        <div class="decision-choices" style="margin-top:12px; flex-wrap:wrap; gap:8px;">
          ${agentBtn}
          ${agentNegotiateBtn}
          ${stayBtn}
        </div>
      </div>`;

    box.querySelectorAll(".offer").forEach((btn) => {
      btn.addEventListener("click", withFailsafe(() => {
        const o = offers[parseInt(btn.dataset.i, 10)];
        moveToClub(o.club);
        if (isContractOffer) {
          signAndAdvance(o.years, sd, intl, `Signed a ${o.years}-year deal with ${state.club}.`, o.playtime, o.wage);
        } else {
          handleContractPhase(sd, intl);
        }
      }));
    });

    const stayEl = document.getElementById("btn-stay");
    if (stayEl) {
      stayEl.addEventListener("click", withFailsafe(() => {
        if (isForeignForced || isFreeAgent) {
          log(`   ↳ ${state.player.name} turns down the offers and hangs up the boots.`, "decision");
          beginRetirement("planned");
          return;
        }
        if (isSold) {
          const forceStays = (state.contractForceStays || 0) + 1;
          state.contractForceStays = forceStays;
          state.pendingTransfer = false;
          if (forceStays >= 2) {
            // After two forced stays the board refuses to keep the player; they must leave.
            // Force an actual resolution here instead of re-presenting the same screen —
            // otherwise a player with zero offers would be stuck refusing forever.
            log(`   ↳ ✋ ${state.player.name} tries to refuse the sale again, but the board forces the move through.`, "decision");
            if (offers.length) {
              const o = offers[0];
              moveToClub(o.club);
              if (isContractOffer) signAndAdvance(o.years, sd, intl, `Forced to sign a ${o.years}-year deal with ${state.club}.`, o.playtime, o.wage);
              else handleContractPhase(sd, intl);
            } else {
              goToMarketOrRetire(sd, intl);
            }
            return;
          }
          // 75% chance the manager reduces the player's role after forcing a stay.
          if (rand() < 0.75) {
            applyEffectsRaw({ role: "down", pillars: { Loyalty: -4, Ego: 3 } });
            log(`   ↳ ✋ ${state.player.name} refuses the sale and stays at ${state.club}, but the manager drops their role.`, "decision");
          } else {
            log(`   ↳ ✋ ${state.player.name} refuses the sale and stays at ${state.club} — for now.`, "decision");
          }
        } else {
          state.pendingTransfer = false;
          log(`   ↳ ✋ ${state.player.name} snubs the offers and stays at ${state.club}.`, "decision");
        }
        handleContractPhase(sd, intl);
      }));
    }

    const agentEl = document.getElementById("btn-agent-force");
    if (agentEl) {
      agentEl.addEventListener("click", withFailsafe(() => {
        const agent = state.agent || { key: "poor", influence: 0 };
        // Better agent = higher chance to find a better destination, and the pool is pulled higher.
        const chance = 0.25 + agent.influence;
        if (rand() < chance) {
          const betterOffers = generateAgentForcedOffers(sd, agent);
          if (betterOffers.length) {
            log(`   ↳ 🤝 ${agent.label} agent forces a better offer for ${state.player.name}.`, "decision");
            presentTransfer(betterOffers, sd, intl, forced, forcedReason, true);
            return;
          }
        }
        log(`   ↳ 😬 ${agent.label} agent couldn't find a better move.`, "decision");
        state.reputation = Math.max(0, state.reputation - 2);
        renderCareerHeader();
        // Agent action is consumed for this event; re-render without the agent buttons.
        presentTransfer(offers, sd, intl, forced, forcedReason, true);
      }));
    }

    const agentNegotiateEl = document.getElementById("btn-agent-negotiate");
    if (agentNegotiateEl) {
      agentNegotiateEl.addEventListener("click", withFailsafe(() => {
        const agent = state.agent || { key: "poor", influence: 0 };
        // Success rate scales from 10% for a poor agent to 75% for a world-class agent.
        const successRate = 0.10 + (agent.influence / 0.35) * 0.65;
        if (rand() < successRate) {
          log(`   ↳ 🗣️ ${agent.label} agent negotiates hard and keeps ${state.player.name} at ${state.club} on a new deal.`, "decision");
          state.pendingTransfer = false;
          // Renew contract for 2 years at the current club with a small rep/fame boost.
          signAndAdvance(2, sd, intl, `Agent negotiated a new 2-year deal at ${state.club}.`, state.role, 25);
          return;
        } else {
          log(`   ↳ 😬 ${agent.label} agent couldn't strike a deal — the club holds firm.`, "decision");
          state.reputation = Math.max(0, state.reputation - 2);
          renderCareerHeader();
          // Agent action is consumed for this event; re-render without the agent buttons.
          presentTransfer(offers, sd, intl, forced, forcedReason, true);
        }
      }));
    }
  }

  function moveToClub(club) {
    const fromClub = state.club;
    log(`   ↳ ✈️ Transfer: ${state.player.name} joins ${club} (${TEAM_DATABASE[club].league}).`, "transfer");
    if (fromClub && state.bioMoments) addBioMoment(narrateTransferForBio(fromClub, club));
    applyPlayerTransferImpact(state.club, true);
    applyPlayerTransferImpact(club, false);
    state.club = club; state.clubsPlayed.add(club); ensureClubStat(club);
    state.yearsAtClub = 0; state.pendingTransfer = false;
  }

  /* ------------------------------ LOAN SYSTEM ----------------------------
   * A loan is a temporary, single-season move: the player leaves for a
   * lower-tier club to guarantee first-team minutes, then automatically
   * returns to the parent club the following season with their original
   * role/tenure restored. The parent club's contract clock is frozen for
   * the duration (advanceToNextSeason is called directly, bypassing the
   * normal contract countdown in handleContractPhase).
   */
  function generateLoanOffers(sd) {
    const currentLeague = TEAM_DATABASE[state.club].league;
    // Map the player's current league position in the English pyramid,
    // then offer clubs from the tiers immediately below as loan destinations.
    // PL tiers (Elite/Europe/Mid/Lower) all map to index 0.
    const pyramidTierMap = {
      Elite: 0, Europe: 0, Mid: 0, Lower: 0,
      Championship: 1, League1: 2, League2: 3, NationalLeague: 4,
    };
    const loanTiersByPyramidIdx = [
      // PL clubs → Championship + League 1
      ["Championship", "League1"],
      // Championship clubs → League 1 + League 2
      ["League1", "League2"],
      // League 1 clubs → League 2 + National League
      ["League2", "NationalLeague"],
      // League 2 clubs → National League
      ["NationalLeague"],
      // National League clubs → no lower tier available
      [],
    ];
    const pyramidIdx = pyramidTierMap[currentLeague] ?? -1;
    const targetTiers = pyramidIdx >= 0 ? loanTiersByPyramidIdx[pyramidIdx] : ["Championship", "League1"];
    const pool = [
      ...getPLLeagueClubs(), ...getChampionshipClubs(),
      ...getLeague1Clubs(), ...getLeague2Clubs(), ...getNationalLeagueClubs(),
    ].filter((c) => c !== state.club && targetTiers.includes(TEAM_DATABASE[c].league));
    if (!pool.length) return [];
    const n = clamp(randInt(1, 3), 1, pool.length);
    const offers = [];
    const used = new Set();
    while (offers.length < n && offers.length < pool.length) {
      const c = choice(pool);
      if (used.has(c)) continue;
      used.add(c);
      offers.push({ club: c, type: "loan", years: 1, playtime: "Starter", injuryRisk: 25 });
    }
    return offers;
  }

  function presentLoanOffers(offers, sd, intl) {
    if (!offers.length) { handleContractPhase(sd, intl); return; }
    const box = document.getElementById("season-action");
    const cards = offers.map((o, i) => {
      const t = TEAM_DATABASE[o.club];
      return `<button class="btn offer" data-i="${i}">
        <div class="offer-club">${esc(o.club)} <span class="offer-loan-tag">(Loan)</span></div>
        <div class="offer-meta">${t.league} · ATK ${t.attack} MID ${t.midfield} DEF ${t.defence} · ${t.tacticalStyle}</div>
        <div class="offer-contract">1-season loan · ▶️ Starter minutes guaranteed</div>
      </button>`;
    }).join("");
    box.innerHTML = `
      <div class="transfer">
        <div class="decision-tag">LOAN OPTION</div>
        <div class="decision-text">${esc(state.player.name)} isn't getting enough game time at ${esc(state.club)}. A temporary loan elsewhere could help development.</div>
        <div class="offers">${cards}</div>
        <button class="btn ghost" id="btn-stay">Stay and fight for your place</button>
      </div>`;
    box.querySelectorAll(".offer").forEach((btn) => {
      btn.addEventListener("click", withFailsafe(() => {
        const o = offers[parseInt(btn.dataset.i, 10)];
        goOnLoan(o.club);
        renderCareerHeader();
        saveState();
        advanceToNextSeason();
      }));
    });
    document.getElementById("btn-stay").addEventListener("click", withFailsafe(() => {
      log(`   ↳ ✋ ${state.player.name} rejects the loan and stays to fight for a place at ${state.club}.`, "decision");
      handleContractPhase(sd, intl);
    }));
  }

  function goOnLoan(club) {
    log(`   ↳ 🔁 Loan: ${state.player.name} joins ${club} on a season-long loan from ${state.club}.`, "transfer");
    state.loan = {
      parentClub: state.club,
      parentRole: state.role,
      parentYearsAtClub: state.yearsAtClub,
      dueBackSeason: state.season + 1,
    };
    applyPlayerTransferImpact(state.club, true);
    applyPlayerTransferImpact(club, false);
    state.club = club;
    state.clubsPlayed.add(club);
    ensureClubStat(club);
    state.role = "Starter"; // the point of a loan is regular first-team minutes
    state.yearsAtClub = 0;
  }

  function returnFromLoanIfDue() {
    if (!state.loan || state.season < state.loan.dueBackSeason) return;
    const parent = state.loan.parentClub;
    log(`   ↳ 🔁 Loan spell over. ${state.player.name} returns to ${parent}.`, "transfer");
    applyPlayerTransferImpact(state.club, true);
    applyPlayerTransferImpact(parent, false);
    state.club = parent;
    state.role = state.loan.parentRole || determineRole();
    state.yearsAtClub = state.loan.parentYearsAtClub || 0;
    state.loan = null;
    ensureClubStat(state.club);
  }

  // ── Fire Agent event ───────────────────────────────────────────────────────
  // Presented at end of season once per 3 seasons at earliest. 50/50 outcome:
  // better agent (one tier up) or same / worse (stays or drops one tier).
  function presentFireAgentEvent(sd, intl, onDone) {
    const currentKey = state.agent ? state.agent.key : "poor";
    const tierIdx = AGENT_TIERS.findIndex((t) => t.key === currentKey);
    const box = document.getElementById("season-action");
    if (!box) { onDone(); return; }
    box.innerHTML = `
      <div class="decision">
        <div class="decision-tag">AGENT EVENT</div>
        <div class="decision-text">${esc(state.player.name)} is unhappy with their current ${esc(state.agent ? state.agent.label : "Poor")} agent. Fire them and roll the dice for a better deal?</div>
        <div class="decision-choices">
          <button class="btn choice" id="btn-fire-agent">🔥 Fire agent — take the gamble (50/50)</button>
          <button class="btn choice ghost" id="btn-keep-agent">Keep current agent</button>
        </div>
      </div>`;
    document.getElementById("btn-fire-agent").addEventListener("click", withFailsafe(() => {
      if (rand() < 0.5) {
        // Better agent
        const newTier = AGENT_TIERS[Math.min(tierIdx + 1, AGENT_TIERS.length - 1)];
        state.agent = { key: newTier.key, label: newTier.label, influence: newTier.influence, contractBonus: newTier.contractBonus };
        state.fame = Math.max(state.fame || 0, Math.floor(newTier.wealth / 2));
        log(`   ↳ 🤝 Upgraded to a ${newTier.label} agent. Better contracts and opportunities ahead.`, "milestone");
      } else {
        // Same or worse
        const newTier = AGENT_TIERS[Math.max(tierIdx - 1, 0)];
        state.agent = { key: newTier.key, label: newTier.label, influence: newTier.influence, contractBonus: newTier.contractBonus };
        log(`   ↳ 😬 New agent turned out to be ${newTier.label}. Not the upgrade expected.`, "decision");
      }
      state.cooldowns["fireAgent"] = 3;
      renderCareerHeader();
      saveState();
      onDone();
    }));
    document.getElementById("btn-keep-agent").addEventListener("click", withFailsafe(() => {
      log(`   ↳ ${state.player.name} sticks with their current agent.`, "decision");
      state.cooldowns["fireAgent"] = 2;
      saveState();
      onDone();
    }));
  }

  function advanceToNextSeason() {
    decayFlags();
    if (state.injuryProneSeasons > 0) state.injuryProneSeasons--;
    if (state.endOfCareerTriggered && !state.finalSeasonForced) { endCareer(false); return; }
    state.age++; state.season++;
    const ra = state.retirementAge || 40;
    let retireChance = 0;
    if (state.age >= ra) retireChance = 1;
    else if (state.age >= ra - 2) retireChance = 0.15 + (state.age - (ra - 2)) * 0.20;
    else if (state.age >= ra - 4) retireChance = 0.03;
    const retireMod = contractRetireModifier();
    if (rand() < retireChance * retireMod) { beginRetirement("age"); return; }
    renderCareerHeader();
    document.getElementById("season-result").innerHTML = "";
    renderSeasonReady();
    saveState();
  }

  function contractRetireModifier() {
    // Longer contracts reduce the chance of an age-forced retirement
    const y = state.contractYears || 0;
    if (y >= 5) return 0.2;
    if (y === 4) return 0.4;
    if (y === 3) return 0.6;
    if (y === 2) return 0.8;
    return 1.0;
  }

  function getContractOptions() {
    if (state.age <= 36) return [1, 2, 3, 4, 5];
    if (state.age <= 40) return [1, 2, 3, 4];
    return [1, 2];
  }

  function signContract(years, wage) {
    state.contractYears = years;
    state.contractSignedAt = state.season;
    state.contractEndSeason = state.season + years;
    state.contractForceStays = 0;
    const fx = { rep: 0, attrChange: null, injuryProne: 0 };
    if (years === 1) fx.rep = 3;
    else if (years === 2) fx.rep = 1;
    else if (years === 4) fx.rep = state.age >= 32 ? -2 : 1;
    else if (years === 5) {
      fx.rep = state.age >= 32 ? -4 : 2;
      if (state.age >= 32) fx.injuryProne = 1;
      if (state.age >= 34) fx.attrChange = { key: "fitness", delta: -2 };
    }
    if (wage) state.wealth += Math.round(wage * years / 5);
    applyEffectsRaw(fx);
    if (fx.attrChange) recomputePlayerStats();
  }

  /* ------------------- CLUB-DRIVEN CONTRACT NEGOTIATION ------------------- */
  function computeClubContractOffer(sd, club) {
    club = club || state.club;
    const age = state.age;
    const perf = sd.perfTier || "Average";
    const rep = state.reputation;
    const injuryProne = state.injuryProneSeasons > 0;
    const agentInfluence = state.agent ? state.agent.influence : 0;
    const agentBonus = state.agent ? state.agent.contractBonus : 0;
    const leagueWeights = LEAGUE_WEIGHTS[TEAM_DATABASE[club].league] || LEAGUE_WEIGHTS.Elite;

    // Base years by age, then capped for veterans
    let baseYears;
    if (age <= 24) baseYears = 4;
    else if (age <= 28) baseYears = 3;
    else if (age <= 32) baseYears = 2;
    else if (age <= 34) baseYears = 1;
    else baseYears = 1;

    // 34+ players are offered only one-year deals, or none at all
    if (age >= 34) baseYears = 1;

    let perfMod = 0;
    if (perf === "Sensational") perfMod = 2;
    else if (perf === "Overperformed") perfMod = 1;
    else if (perf === "Met Expectation") perfMod = 0;
    else if (perf === "Underperformed") perfMod = -1;
    else if (perf === "Flop") perfMod = -2;

    let repMod = 0;
    if (rep >= 80) repMod = 1;
    else if (rep < 30) repMod = -1;

    const loyalty = getPillar("Loyalty");
    const loyaltyYears = Math.round((loyalty - 50) / 20);
    let offerYears = clamp(baseYears + perfMod + repMod + agentBonus + loyaltyYears, 1, 5);
    let maxYears = clamp(offerYears + 1 + agentBonus, 1, 5);
    if (age >= 34) { offerYears = 1; maxYears = 1; }

    // Expected playtime at this club — bigger clubs offer lower squad status for similar players
    let playtime = determineNaturalRole(club);
    if (club === state.club && state.role && roleRank(state.role) > roleRank(playtime)) playtime = state.role;
    // Agent can negotiate a better squad role
    if (agentInfluence >= 0.18 && roleRank(playtime) < 3) playtime = roleRank(playtime) === 2 ? "Starter" : "Rotation";
    if (agentInfluence >= 0.30 && roleRank(playtime) < 4) playtime = "Star";

    // Injury risk estimate: more minutes + older age + existing proneness = more risk
    const leagueGames = 38;
    const estApps = Math.round({ Star: 0.9, Starter: 0.75, Rotation: 0.45, Bench: 0.2 }[playtime] * leagueGames);
    let injuryRisk = clamp(Math.round((estApps / 38) * 40 + (age - 30) * 2 + state.injuryProneness * 0.25 + (injuryProne ? 15 : 0)), 5, 95);
    if (hasTrait("Iron Man")) injuryRisk = Math.max(5, injuryRisk - 25);
    if (hasTrait("Injury Prone")) injuryRisk = Math.min(95, injuryRisk + 20);

    // Refusal conditions — clubs decide whether to renew based on age, performance, reputation, injury and agent.
    let refused = false;
    const isPL = PL_TIERS.includes(TEAM_DATABASE[club].league);
    // Premier League physical barrier: clubs won't sign players over 37.
    if (isPL && age > 37) refused = true;
    // Tiered league physical barrier for new signings: PL is strict, Spain/Italy/Germany less so.
    if (club !== state.club) {
      const league = TEAM_DATABASE[club].league;
      const tier = isPL ? 1 : ["LaLiga", "SerieA", "Bundesliga"].includes(league) ? 2 : 3;
      const attrs = state.attrs || { strength: 60, fitness: 60 };
      const physicalAvg = (attrs.strength + attrs.fitness) / 2;
      const physicalMin = Math.min(attrs.strength, attrs.fitness);
      if (tier === 1 && (physicalAvg < 55 || physicalMin < 45)) refused = true;
      if (tier === 2 && (physicalAvg < 45 || physicalMin < 40)) refused = true;
      // Tier 3 (Championship, MLS, Saudi, etc.) has no physical barrier.
    }
    if (age >= 39 && rep < 55) refused = true;
    if (age >= 37 && rep < 30) refused = true;
    if (age >= 35 && perf === "Flop" && rep < 60) refused = true;
    if (age >= 34 && injuryProne && perf === "Flop" && rep < 55) refused = true;
    if (age >= 33 && rep < 25 && perf === "Flop") refused = true;
    if (age >= 34 && playtime === "Bench" && rep < 50 && rand() < 0.35) refused = true;

    // A poor/mediocre agent makes the club more likely to let the player leave on a free.
    // A world-class agent fights harder to keep a deal on the table.
    if (refused && rand() < agentInfluence) refused = false;
    if (refused && rand() < (loyalty - 50) / 200) refused = false;

    // Star/performing players at big clubs should almost always be renewed unless there is a clear reason not to.
    if (refused && (state.role === "Star" || rep >= 70 || ["Sensational", "Overperformed"].includes(perf))) refused = false;

    // Wage estimate (k/week) influenced by league wealth, reputation, performance, fame, and age.
    // Fame (driven by agent negotiation) amplifies wage offers — higher fame = higher market value.
    const fameMult = 1 + clamp((state.fame || 0) / 200, 0, 0.5);
    let wage = Math.round((rep * 5 + ({ Sensational: 25, Overperformed: 15, "Met Expectation": 5, Underperformed: 0, Flop: -5 }[perf] || 0)) * leagueWeights.wages * fameMult);
    if (age >= 34) wage = Math.round(wage * 0.6);
    else if (age >= 30) wage = Math.round(wage * 0.85);
    wage = Math.max(5, wage);

    if (refused) return { years: 0, maxYears: 0, playtime, injuryRisk, wage: 0, refused: true };
    return { years: offerYears, maxYears, playtime, injuryRisk, wage, refused: false };
  }

  function clubWillAcceptYears(requestedYears, maxYears, sd) {
    if (requestedYears <= maxYears) return { accept: true };

    const age = state.age;
    const perf = sd.perfTier || "Average";
    const rep = state.reputation;
    const overAsk = requestedYears - maxYears;

    let chance = 0;
    if (perf === "Sensational") chance = 0.5;
    else if (perf === "Overperformed") chance = 0.3;
    else if (perf === "Met Expectation") chance = 0.15;
    else chance = 0.05;

    if (rep >= 80) chance += 0.2;
    else if (rep >= 60) chance += 0.1;
    if (age <= 28) chance += 0.1;
    if (age >= 33) chance -= 0.15;
    if (overAsk >= 2) chance -= 0.3;
    if (state.agent) chance += state.agent.influence;
    chance = clamp(chance, 0, 1);

    if (rand() < chance) return { accept: true };
    return { accept: false, counter: maxYears > 0 ? maxYears : 0 };
  }

  function presentContractNegotiation(sd, intl) {
    const offer = computeClubContractOffer(sd);
    if (offer.refused) {
      clubRefusesContract(sd, intl);
      return;
    }
    state.pendingContractOffer = offer;
    renderContractOffer(offer, sd, intl);
  }

  function renderContractOffer(offer, sd, intl, message) {
    const box = document.getElementById("season-action");
    const plusOne = Math.min(offer.years + 1, 5);
    const plusTwo = Math.min(offer.years + 2, 5);
    const text = message || `${state.club} has offered you a new contract at age ${state.age}.`;
    const riskLabel = offer.injuryRisk >= 60 ? "high" : offer.injuryRisk >= 35 ? "moderate" : "low";
    const riskColor = offer.injuryRisk >= 60 ? "var(--bad)" : offer.injuryRisk >= 35 ? "var(--gold)" : "var(--accent)";
    const roleEmoji = { Star: "⭐", Starter: "▶️", Rotation: "🔄", Bench: "🪑" }[offer.playtime] || "";

    const plusOneDisabled = plusOne <= offer.years ? "disabled" : "";
    const plusTwoDisabled = plusTwo <= offer.years ? "disabled" : "";

    box.innerHTML = `
      <div class="decision milestone-event">
        <div class="decision-tag">CONTRACT OFFER</div>
        <div class="decision-text">${text}</div>
        <div class="contract-offer">
          <div class="contract-club">${esc(state.club)}</div>
          <div class="contract-terms">${offer.years}-year contract · ${roleEmoji} ${offer.playtime} · £${offer.wage}k/week</div>
          <div class="contract-meta">Age ${state.age} · Rating ${state.baseRating} · Rep ${state.reputation} · ${sd.perfTier} season</div>
          <div class="contract-risk">Expected apps ${Math.round({ Star: 34, Starter: 28, Rotation: 17, Bench: 8 }[offer.playtime])} · Injury risk <span style="color:${riskColor}">${riskLabel}</span></div>
        </div>
        <div class="decision-choices">
          <button class="btn primary choice" id="btn-accept-offer">Accept ${offer.years}-year deal</button>
          <button class="btn choice" id="btn-ask-plus-one" ${plusOneDisabled}>Ask for ${plusOne} years</button>
          <button class="btn choice" id="btn-ask-plus-two" ${plusTwoDisabled}>Ask for ${plusTwo} years</button>
          <button class="btn ghost choice" id="btn-reject-offer">Reject & test the market</button>
          <button class="btn ghost choice" id="btn-retire-offer">Retire</button>
        </div>
      </div>`;

    document.getElementById("btn-accept-offer").addEventListener("click", withFailsafe(() => signAndAdvance(offer.years, sd, intl, null, offer.playtime)));
    document.getElementById("btn-ask-plus-one").addEventListener("click", withFailsafe(() => handleAskForYears(plusOne, offer, sd, intl)));
    document.getElementById("btn-ask-plus-two").addEventListener("click", withFailsafe(() => handleAskForYears(plusTwo, offer, sd, intl)));
    document.getElementById("btn-reject-offer").addEventListener("click", withFailsafe(() => rejectContractAndTransfer(sd, intl)));
    document.getElementById("btn-retire-offer").addEventListener("click", withFailsafe(() => beginRetirement("planned")));
  }

  function handleAskForYears(requestedYears, offer, sd, intl) {
    const result = clubWillAcceptYears(requestedYears, offer.maxYears, sd);
    if (result.accept) {
      signAndAdvance(requestedYears, sd, intl, `Club accepted the request for ${requestedYears} years.`, offer.playtime);
    } else if (result.counter > 0) {
      renderContractCounter(result.counter, sd, intl, offer.playtime);
    } else {
      clubRefusesContract(sd, intl);
    }
  }

  function renderContractCounter(counterYears, sd, intl, role) {
    const box = document.getElementById("season-action");
    box.innerHTML = `
      <div class="decision milestone-event">
        <div class="decision-tag">CLUB COUNTER OFFER</div>
        <div class="decision-text">${esc(state.club)} refuses your demand. They are only willing to offer ${counterYears} years.</div>
        <div class="decision-choices">
          <button class="btn primary choice" id="btn-accept-counter">Accept ${counterYears}-year deal</button>
          <button class="btn ghost choice" id="btn-reject-counter">Reject & test the market</button>
          <button class="btn ghost choice" id="btn-retire-counter">Retire</button>
        </div>
      </div>`;
    document.getElementById("btn-accept-counter").addEventListener("click", withFailsafe(() => signAndAdvance(counterYears, sd, intl, null, role)));
    document.getElementById("btn-reject-counter").addEventListener("click", withFailsafe(() => rejectContractAndTransfer(sd, intl)));
    document.getElementById("btn-retire-counter").addEventListener("click", withFailsafe(() => beginRetirement("planned")));
  }

  function signAndAdvance(years, sd, intl, message, role, wage) {
    signContract(years, wage);
    state.contractRole = role || state.contractRole || determineNaturalRole(state.club);
    log(message ? `   ↳ ✍️ ${message}` : `   ↳ ✍️ Signed a ${years}-year contract at ${state.club} (${state.contractRole}).`, "milestone");
    renderCareerHeader();
    advanceToNextSeason();
  }

  function rejectContractAndTransfer(sd, intl) {
    log(`   ↳ ✋ ${state.player.name} rejects ${state.club}'s contract offer and tests the market.`, "decision");
    goToMarketOrRetire(sd, intl);
  }

  function clubRefusesContract(sd, intl) {
    log(`   ↳ ❌ ${state.club} refuses to offer ${state.player.name} a new contract.`, "decision");
    goToMarketOrRetire(sd, intl);
  }

  function goToMarketOrRetire(sd, intl) {
    const rawOffers = generateOffers(sd);
    if (rawOffers.length === 0) {
      log(`   ↳ No club wants ${state.player.name}. The phone stops ringing.`, "decision");
      beginRetirement("unwanted");
      return;
    }
    presentTransfer(rawOffers, sd, intl, false);
  }

  /* --------------------- END-OF-CAREER EVENTS --------------------------- */
  /*
  const END_EVENTS = [

    { id: "immediate_retire", base: 6, text: (n) => `${n} calls time on a storied career, hanging up the boots for good.`,
      choices: [{ label: "Retire a legend", fx: {} }] },
    { id: "one_more_year", base: 4, req: (s) => s.age < 38, text: (n) => `${n} isn't ready to stop — there's one more season in those legs.`,
      choices: [{ label: "Play one final season", fx: { extend: true } }, { label: "Retire now instead", fx: {} }] },
    { id: "return_home", base: 4, req: (s) => s.clubsPlayed.size > 1, text: (n) => `${n} is offered a fairytale return to a former club for a farewell season.`,
      choices: [{ label: "Go back for one last dance", fx: { returnHome: true } }, { label: "Retire where you are", fx: {} }] },
    { id: "become_manager", base: 3, req: (s) => mentTag(s.mentality) === "leader" || s.honours.leagueTitles > 0, text: (n) => `${n} moves straight into the dugout, beginning a management career.`,
      choices: [{ label: "Take the manager's job", fx: { epilogue: "manager" } }] },
    { id: "become_pundit", base: 3, req: (s) => s.reputation >= 60, text: (n) => `${n} is snapped up by a broadcaster as a star pundit.`,
      choices: [{ label: "Head to the studio", fx: { epilogue: "pundit" } }] },
    { id: "final_trophy", base: 4, req: (s) => s.reputation >= 55, text: (n) => `In a storybook finish, ${n} lifts one final trophy before retiring.`,
      choices: [{ label: "The perfect send-off", fx: { trophy: true } }] },
    { id: "career_ending_injury", base: 3, req: (s) => s.injuryProneSeasons > 0 || s.age >= 34, text: (n) => `A cruel injury forces ${n} into an early, unwanted retirement.`,
      choices: [{ label: "Bow out with head held high", fx: { rep: -1 } }] },
    { id: "testimonial", base: 4, req: (s) => s.honours.leagueTitles > 0 || s.reputation >= 70, text: (n) => `A packed stadium turns out for ${n}'s legendary testimonial match.`,
      choices: [{ label: "Soak up the adoration", fx: { rep: 2 } }] },

    // ---- RARE END-OF-CAREER GOAL SURGES (the only path from ~800 to 1000) ----
    { id: "golden_twilight", base: 2, req: (s) => s.age >= 34 && s.reputation >= 75 && s.totalGoals >= 650 && TEAM_DATABASE[s.club].league === "Elite", rare: true,
      text: (n) => `In a golden twilight, ${n} defies age and delivers a season for the ages.`,
      choices: [
        { label: "Rewrite the record books", fx: { goals: () => randInt(80, 150), rep: 5, fame: 8, trophy: true } },
        { label: "Retire while the legend is intact", fx: { rep: 3 } },
      ] },
    { id: "record_chase_finale", base: 2, req: (s) => s.totalGoals >= 700 && s.reputation >= 80 && s.honours.ballonDors >= 1, rare: true,
      text: (n) => `The world watches as ${n} chases the impossible 1000-goal mark.`,
      choices: [
        { label: "One more year, one last chase", fx: { goals: () => randInt(100, 200), rep: 6, fame: 10, extend: true } },
        { label: "Stop at the summit", fx: { rep: 4 } },
      ] },
    { id: "international_swan_song", base: 2, req: (s) => s.age >= 32 && s.intlCaptain && s.intlGoals >= 15 && s.reputation >= 75, rare: true,
      text: (n) => `${n} leads the national team on a triumphant international swansong.`,
      choices: [
        { label: "Give everything for the country", fx: { goals: () => randInt(50, 100), intlGoals: () => randInt(6, 12), rep: 5, fame: 6 } },
        { label: "Focus on club football", fx: { rep: 2 } },
      ] },
    { id: "one_last_dance", base: 2, req: (s) => s.age >= 35 && s.reputation >= 70 && s.clubsPlayed.size >= 3 && s.totalGoals >= 600, rare: true,
      text: (n) => `A former club offers ${n} one final dance — and the fans believe in miracles.`,
      choices: [
        { label: "Return and chase the thousand", fx: { goals: () => randInt(70, 130), returnHome: true, rep: 4, fame: 5 } },
        { label: "Retire here instead", fx: { rep: 2 } },
      ] },

    // ---- FINAL SEASON ABROAD / LOWER LEAGUE ROLEPLAY EVENTS ----
    { id: "final_mls", base: 3, req: (s) => s.age >= 33 && s.reputation >= 55 && s.totalGoals >= 350, rare: true,
      text: (n) => `${n} signs a final sunset deal in MLS — one last stage to pad the career totals.`,
      choices: [
        { label: "Light up the American stage", fx: { goals: () => randInt(12, 30), apps: () => randInt(20, 34), finalSeason: { destination: "MLS", note: "Final season in MLS" }, rep: 2 } },
        { label: "Retire at home", fx: {} },
      ] },
    { id: "final_saudi", base: 3, req: (s) => s.age >= 33 && s.reputation >= 55 && s.totalGoals >= 400, rare: true,
      text: (n) => `A Saudi club offers ${n} a lucrative farewell contract — the desert payday awaits.`,
      choices: [
        { label: "Take the gold and score", fx: { goals: () => randInt(15, 35), apps: () => randInt(18, 32), finalSeason: { destination: "Saudi Arabia", note: "Final season in Saudi Arabia" }, rep: 2, wealth: 20 } },
        { label: "Stay in Europe", fx: {} },
      ] },
    { id: "final_abroad", base: 3, req: (s) => s.age >= 33 && s.reputation >= 50 && s.totalGoals >= 300, rare: true,
      text: (n) => `${n} accepts one last adventure abroad in Japan, Turkey, or the USA.`,
      choices: [
        { label: "Enjoy the farewell tour", fx: { goals: () => randInt(10, 25), apps: () => randInt(15, 30), finalSeason: { destination: "abroad", note: "Final season abroad" }, rep: 1 } },
        { label: "Retire instead", fx: {} },
      ] },
    { id: "final_lower_league", base: 3, req: (s) => s.age >= 35 && s.reputation >= 40 && s.totalGoals >= 250, rare: true,
      text: (n) => `${n} drops down the leagues for a heroic final season, mentoring the next generation.`,
      choices: [
        { label: "One last hurrah in the lower leagues", fx: { goals: () => randInt(8, 20), apps: () => randInt(20, 38), finalSeason: { destination: "lower leagues", note: "Final season in the lower leagues" }, rep: 1 } },
        { label: "Retire a club legend", fx: {} },
      ] },
  ];
  */

  function beginRetirement(reason) {
    state.endCareerReason = state.endCareerReason || reason;
    // reached the 1000-goal target -> celebrate straight to legacy
    if (reason === "goal" || state.totalGoals >= LEVERS.goalTarget) { endCareer(true); return; }
    // one-shot end-of-career event: if already triggered, finish the career without re-picking
    if (state.endOfCareerTriggered) { endCareer(false); return; }
    state.endOfCareerTriggered = true;
    const eligible = CAREER_ENDINGS.filter((e) => !e.req || e.req(state)).map((e) => ({ item: e, weight: getCareerOutcomeScore(state, e) }));
    const ev = weightedRandomPick(eligible) || CAREER_ENDINGS[CAREER_ENDINGS.length - 1];
    presentEndEvent(ev);
    saveState();
  }

  function presentEndEvent(ev) {
    const box = document.getElementById("season-action");
    document.getElementById("season-result").innerHTML = "";
    const text = typeof ev.text === "function" ? ev.text(state.player.name, state) : ev.text;
    const choicesHtml = ev.choices.map((c, i) => `<button class="btn choice" data-i="${i}">${c.label}</button>`).join("");
    box.innerHTML = `
      <div class="decision endcareer">
        <div class="decision-tag">END OF CAREER</div>
        <div class="decision-text">${esc(text)}</div>
        <div class="decision-choices">${choicesHtml}</div>
      </div>`;
    box.querySelectorAll(".choice").forEach((btn) => {
      btn.addEventListener("click", withFailsafe(() => {
        const c = ev.choices[parseInt(btn.dataset.i, 10)];
        handleEndChoice(c.fx, text, c.label, ev);
      }));
    });
  }

  function findFinalSeasonDestination(destination) {
    if (destination === "lower leagues") {
      const pool = [
        ...getPLLeagueClubs(), ...getChampionshipClubs(), ...getLeague1Clubs(),
      ].filter((c) => ["Lower", "Championship", "League1"].includes(TEAM_DATABASE[c].league));
      return pool.length ? choice(pool) : null;
    }
    if (destination === "abroad") {
      const sd = { perfTier: state.lastPerformanceTier || "Met Expectation" };
      const offers = generateForcedDestinationOffers(sd);
      if (offers.length) {
        const foreign = offers.find((o) => FOREIGN_LEAGUE_KEYS.includes(TEAM_DATABASE[o.club].league));
        if (foreign) return foreign.club;
      }
      const pool = getForeignLeagueClubs().filter((c) => FOREIGN_LEAGUE_KEYS.includes(TEAM_DATABASE[c].league));
      return pool.length ? choice(pool) : null;
    }
    return null;
  }

  function handleEndChoice(fx, text, label, ending) {
    fx = fx || {};
    log(`   ↳ 🎬 ${text.replace(/\.$/, "")} → "${label}"`, "milestone");
    // Apply standard numeric effects (goals, assists, rep, fame, wealth) directly — end-of-career events are not subject to the seasonal reward multiplier
    applyEffects(fx, 1);
    if (fx.trophy) {
      state.honours.domesticCups++;
      state.competitionHistory.push({ season: state.season, club: state.club, text: `🏆 Lifted a final trophy in a farewell season` });
    }
    // Final-season outcomes: play one last campaign then retire for good
    if (fx.finalSeason || fx.extend || fx.returnHome) {
      if (fx.returnHome) {
        const formers = [...state.clubsPlayed].filter((c) => c !== state.club && TEAM_DATABASE[c]);
        if (formers.length) moveToClub(choice(formers));
      }
      if (fx.finalSeason && fx.finalSeason.destination) {
        const dest = findFinalSeasonDestination(fx.finalSeason.destination);
        if (dest && dest !== state.club) moveToClub(dest);
      }
      state.finalSeasonForced = true;
      state.age++; state.season++;
      renderCareerHeader();
      document.getElementById("season-result").innerHTML = "";
      renderSeasonReady();
      saveState();
      return;
    }
    if (fx.epilogue || (ending && ending.epilogue)) state.epilogue = fx.epilogue || ending.epilogue;
    endCareer(false);
  }

  /* ----------------------------- LEGACY --------------------------------- */
  function endCareer(reachedGoal) {
    state.retired = true;
    state.bioClosing = generateBioClosing();
    showScreen("screen-legacy");
    const won = reachedGoal || state.totalGoals >= LEVERS.goalTarget;
    const newAchievements = unlockAchievements(checkCareerAchievements());
    if (newAchievements.length) {
      const names = newAchievements.map((id) => (ACHIEVEMENTS.find((a) => a.id === id) || {}).name || id);
      log(`Unlocked ${newAchievements.length} account achievement${newAchievements.length > 1 ? "s" : ""}: ${names.join(", ")}`, "achievement");
    }
    const statusEl = document.getElementById("legacy-status");
    statusEl.textContent = won ? "⚽ FOOTBALL GOD — 1000 GOALS!" : (state.totalGoals >= 500 ? "LEGENDARY CAREER!" : "CAREER COMPLETE");
    statusEl.className = "legacy-status " + (won ? "god" : (state.totalGoals >= 500 ? "legend" : ""));
    document.getElementById("legacy-goals").textContent = state.totalGoals;

    document.getElementById("legacy-grid").innerHTML = [
      ["Seasons", state.season], ["Clubs", state.clubsPlayed.size], ["Final Age", state.age],
      ["Career Goals", state.totalGoals], ["League Goals", state.leagueGoals], ["Cup Goals", state.cupGoals],
      ["Europe Goals", state.europeGoals], ["Assists", state.totalAssists], ["Apps", state.totalApps],
      ["Yellow/Red", `${state.totalYellow}/${state.totalRed}`],
      [`${state.country} Caps`, state.intlCaps], [`${state.country} Goals`, state.intlGoals],
      ["Best Rating", state.bestRating || "—"], ["Peak Rep", `${state.reputationTier}`],
    ].map(([k, v]) => `<div class="leg-box"><div class="leg-num">${v}</div><div class="leg-lab">${k}</div></div>`).join("");

    renderHonours();
    renderClubBreakdown();
    renderCompetitionHistory();
    renderEpilogue();
    renderCareerSummary();
    renderLegacyBiography();
    renderLegacyDNA();
    renderShareCard();
    renderShareTagline();
    saveState();
  }

  function generateCareerSummary() {
    const h = state.honours;
    const pos = POSITIONS[state.position] || POSITIONS.ST;
    const playstyle = state.playstyle || "Complete Forward";
    const total = state.totalGoals;
    const apps = Math.max(1, state.totalApps);
    const gpg = (total / apps).toFixed(2);
    const years = Math.max(1, state.season);
    const avg = (total / years).toFixed(1);

    const taglines = [];
    if (total >= 1000) taglines.push("a once-in-history goal machine who scaled the impossible 1000-goal mountain");
    else if (total >= 800) taglines.push("a genuine all-time great who flirted with the 1000-goal summit");
    else if (total >= 600) taglines.push("a legendary striker who defined a generation");
    else if (total >= 400) taglines.push("a prolific forward who terrorised defenders across the leagues");
    else if (total >= 200) taglines.push("a reliable goalscorer who built a respectable career");
    else taglines.push("a professional who left their mark on the game");

    if (state.clubsPlayed.size >= 5) taglines.push("a true journeyman");
    if (state.clubsPlayed.size === 1) taglines.push("a one-club icon");
    if (state.honours.ballonDors > 0) taglines.push("a Ballon d'Or winner");
    if (h.leagueTitles >= 3) taglines.push("a serial champion");
    if (state.intlGoals >= 20) taglines.push(`a ${esc(state.country)} national hero`);
    else if (state.intlCaps >= 20) taglines.push(`a loyal ${esc(state.country)} servant`);

    const clubList = Object.entries(state.clubStats)
      .filter(([, s]) => s.goals > 0)
      .sort((a, b) => b[1].goals - a[1].goals)
      .slice(0, 3)
      .map(([c]) => esc(c));
    const clubLine = clubList.length ? ` Their best work came at ${clubList.join(", ")}.` : "";

    const body = `${esc(state.player.name)} was ${esc(taglines[0])}${taglines.length > 1 ? ", " + taglines.slice(1).map(esc).join(" and ") : ""}.` +
      ` Over ${years} seasons as a ${esc(pos.label)} ${esc(state.country)} international, they scored <span class="highlight">${total} goals</span> in ${apps} appearances — ` +
      `${avg} goals per season at ${gpg} goals per game.` +
      `${clubLine} They collected ${h.leagueTitles} league title${h.leagueTitles !== 1 ? "s" : ""}, ${h.domesticCups} domestic cup${h.domesticCups !== 1 ? "s" : ""}, ${h.europeanCups} European trophy${h.europeanCups !== 1 ? "ies" : "y"}, ${h.goldenBoots} Golden Boot${h.goldenBoots !== 1 ? "s" : ""}, ${h.ballonDors} Ballon d'Or${h.ballonDors !== 1 ? "s" : ""}, and ${h.intlTrophies} international trophy${h.intlTrophies !== 1 ? "ies" : "y"}.`;

    return { title: `${esc(state.player.name)} — ${esc(playstyle)}`, body };
  }

  function renderCareerSummary() {
    const el = document.getElementById("legacy-summary");
    if (!el) return;
    const summary = generateCareerSummary();
    el.innerHTML = `<h3>Career Summary</h3><div class="legacy-summary-text">${summary.body}</div>`;
  }

  function renderHonours() {
    const h = state.honours;
    const items = [
      ["🏆", "League Titles", h.leagueTitles], ["🥇", "Domestic Cups", h.domesticCups],
      ["🌍", "European Cups", h.europeanCups], ["🦁", "Intl Trophies", h.intlTrophies],
      ["👟", "Golden Boots", h.goldenBoots], ["🏅", "Ballon d'Ors", h.ballonDors],
      ["⭐", "Player of the Season", h.playerOfSeason], ["🌱", "Young Player", h.youngPlayer],
      ["📋", "Team of the Season", h.tots],
    ].filter(([, , v]) => v > 0);
    const el = document.getElementById("legacy-honours");
    if (!items.length) { el.innerHTML = "<h3>Honours & Awards</h3><div class='muted'>No major honours — but a career to be proud of.</div>"; return; }
    el.innerHTML = "<h3>Honours & Awards</h3><div class='honours-grid'>" +
      items.map(([ic, k, v]) => `<div class="hon-item"><span class="hon-ic">${ic}</span><span class="hon-count">${v}×</span><span class="hon-name">${k}</span></div>`).join("") + "</div>";
  }

  function renderClubBreakdown() {
    const clubs = Object.entries(state.clubStats).filter(([, s]) => s.apps > 0)
      .sort((a, b) => b[1].goals - a[1].goals);
    const rows = clubs.map(([c, s]) =>
      `<tr><td class="lt-team">${esc(c)}</td><td>${s.seasons}</td><td>${s.apps}</td><td class="lt-pts">${s.goals}</td><td>${s.assists}</td><td>${s.titles}</td></tr>`).join("");
    document.getElementById("legacy-clubs").innerHTML = `
      <h3>Career by Club</h3>
      <div class="table-scroll">
        <table class="league-table clubs-table"><thead><tr><th>Club</th><th>Sea</th><th>Apps</th><th>Goals</th><th>Ast</th><th>🏆</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>`;
  }

  function renderCompetitionHistory() {
    const el = document.getElementById("legacy-history");
    if (!state.competitionHistory.length) { el.innerHTML = ""; return; }
    const items = state.competitionHistory.slice().reverse().map((c) =>
      `<li><span class="hist-season">S${c.season}</span> ${esc(c.text)}</li>`).join("");
    el.innerHTML = `<h3>Trophy Cabinet Timeline</h3><ul class="history-list">${items}</ul>`;
  }

  function renderEpilogue() {
    const el = document.getElementById("legacy-epilogue");
    const map = {
      manager: "🧑‍💼 After hanging up the boots, they moved into management, chasing silverware from the dugout.",
      pundit: "🎙️ They became a beloved TV pundit, dissecting the game for millions every weekend.",
      coach: "⚽ They became a respected coach, shaping the next generation from the training ground.",
    };
    const reasonMap = {
      age: "Retired gracefully with age catching up.",
      planned: "Bowed out after a planned farewell season.",
      goal: "Retired the moment the 1000-goal dream was realised.",
      unwanted: "No club was willing to offer a new contract.",
    };
    const parts = [];
    if (state.endCareerReason && reasonMap[state.endCareerReason]) parts.push(reasonMap[state.endCareerReason]);
    if (state.epilogue && map[state.epilogue]) parts.push(map[state.epilogue]);
    if (state.finalSeason) parts.push(`🌍 ${state.finalSeason.note}.`);
    el.innerHTML = parts.length ? `<div class="epilogue">${parts.map((p) => `<div>${p}</div>`).join("")}</div>` : "";
  }

  function renderLegacyDNA() {
    const a = state.attrs;
    const traitsHtml = state.hiddenTraits.length
      ? `<div class="traits-list" style="margin-bottom:12px;">${state.hiddenTraits.map((t) => {
        const tier = getTraitTier(t);
        const color = TRAIT_TIER_COLORS[tier];
        const name = TRAIT_TIER_NAMES[tier];
        return `<span class="trait-chip trait-tier-${tier}" title="${esc(HIDDEN_TRAITS[t].desc)} (${name})" style="border-color:${color};color:${color}">${esc(t)} <small>${tier}</small></span>`;
      }).join("")}</div>`
      : "";
    const radarId = "legacy-radar";
    const pos = POSITIONS[state.position] || POSITIONS.ST;
    const rv = computeRadarValues(a);
    document.getElementById("legacy-dna").innerHTML = `
      <h3>Player DNA</h3>
      <div class="dna-summary">
        <span class="tag">${esc(pos.label)}</span>
        <span class="tag">${esc(state.playstyle)}</span>
        <span class="tag ${mentIsSpecial(state.mentality) ? "rare" : ""}">${esc(state.mentality)}</span>
        <span class="tag">🎓 ${esc(state.academy.club)} (${esc(state.academy.tier)})</span>
        <span class="tag">Peak ${state.baseRating}</span>
      </div>
      ${traitsHtml}
      <div class="legacy-radar"><canvas id="${radarId}" width="340" height="260"></canvas></div>
      <div class="dna-key">
        ${dnaLine("Aerial", Math.round(rv.aerial))}${dnaLine("Shooting", Math.round(rv.shooting))}${dnaLine("Mental", Math.round(rv.mental))}
        ${dnaLine("Speed", Math.round(rv.speed))}${dnaLine("Balance & Agility", Math.round(rv.balanceAgility))}${dnaLine("Physical", Math.round(rv.physical))}
        ${dnaLine("Height", a.height + "cm")}${dnaLine("Weight", a.weight + "kg")}
      </div>`;
    function dnaLine(label, v) { return `<div class="dna-row"><span class="dna-k">${label}</span><span class="dna-v">${v}</span></div>`; }
    requestAnimationFrame(() => {
      const canvas = document.getElementById(radarId);
      if (canvas) drawRadarChart(canvas, a);
    });
  }

  /* ------------------------- SHAREABLE CAREER CARD ------------------------- */
  function computeCareerRarity() {
    const goals = state.totalGoals;
    const h = state.honours;
    const trophies = h.leagueTitles + h.domesticCups + h.europeanCups + h.intlTrophies;
    if (goals >= 1000 || h.ballonDors >= 1 || trophies >= 5) return { label: "FOOTBALL GOD", color: "#f6c453", border: "#ff8a3c" };
    if (goals >= 700 || h.ballonDors >= 1 || trophies >= 3) return { label: "LEGENDARY", color: "#f6c453", border: "#f6c453" };
    if (goals >= 400 || trophies >= 2) return { label: "WORLD CLASS", color: "#4de0b4", border: "#4de0b4" };
    if (goals >= 200 || trophies >= 1 || state.reputation >= 70) return { label: "CULT HERO", color: "#70a7ff", border: "#70a7ff" };
    if (state.clubsPlayed.size >= 5) return { label: "JOURNEYMAN", color: "#b8c0d0", border: "#b8c0d0" };
    return { label: "PROFESSIONAL", color: "#b8c0d0", border: "#b8c0d0" };
  }

  function getCardDNA() {
    // Gather donor names from the drafted attribute slots.
    const slots = state.player.slots || {};
    const donors = [];
    Object.values(slots).forEach((s) => {
      if (s && s.donor && !donors.includes(s.donor)) donors.push(s.donor);
    });
    if (!donors.length && state.player.usedDonors) {
      state.player.usedDonors.forEach((n) => { if (!donors.includes(n)) donors.push(n); });
    }
    return donors.slice(0, 4);
  }

  function renderShareCard() {
    const canvas = document.getElementById("share-card-canvas");
    const cardWrap = document.getElementById("share-card");
    if (!canvas || !cardWrap) return;
    // Skip in headless/test environments where the canvas context is unavailable.
    if (typeof canvas.getContext !== "function") return;
    cardWrap.style.display = "block";
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#0f111a");
    grad.addColorStop(0.5, "#171a27");
    grad.addColorStop(1, "#0c0d14");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Card border
    const rarity = computeCareerRarity();
    ctx.lineWidth = 8;
    ctx.strokeStyle = rarity.color;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Rarity badge
    ctx.fillStyle = rarity.color;
    ctx.beginPath();
    ctx.roundRect(40, 40, 200, 36, 8);
    ctx.fill();
    ctx.fillStyle = "#0f111a";
    ctx.font = "bold 18px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(rarity.label, 140, 65);

    // Name & position
    const pos = POSITIONS[state.position] || POSITIONS.ST;
    const flag = state.player.origin?.flag || "🏴";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 42px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(state.player.name.toUpperCase(), w / 2, 150);

    ctx.fillStyle = rarity.color;
    ctx.font = "bold 24px Arial, sans-serif";
    ctx.fillText(`${flag} ${pos.label} · ${state.country}`, w / 2, 192);

    // Overall rating circle
    const rating = state.baseRating;
    ctx.beginPath();
    ctx.arc(w / 2, 280, 60, 0, Math.PI * 2);
    ctx.fillStyle = "#1a1d2b";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = rarity.color;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 52px Arial, sans-serif";
    ctx.fillText(String(rating), w / 2, 295);
    ctx.fillStyle = "#b8c0d0";
    ctx.font = "12px Arial, sans-serif";
    ctx.fillText("OVERALL", w / 2, 320);

    // Career stats
    const h2 = state.honours;
    const stats = [
      ["GOALS", state.totalGoals],
      ["APPS", state.totalApps],
      ["TROPHIES", h2.leagueTitles + h2.domesticCups + h2.europeanCups + h2.intlTrophies],
      ["ASSISTS", state.totalAssists],
    ];
    const startX = 70, gap = 120, statY = 395;
    stats.forEach(([label, val], i) => {
      const x = startX + i * gap;
      ctx.fillStyle = "#f6c453";
      ctx.font = "bold 34px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(val), x, statY);
      ctx.fillStyle = "#b8c0d0";
      ctx.font = "bold 12px Arial, sans-serif";
      ctx.fillText(label, x, statY + 20);
    });

    // Radar chart (rendered on an offscreen canvas and copied over)
    const radarCanvas = document.createElement("canvas");
    radarCanvas.width = 260; radarCanvas.height = 220;
    drawRadarChart(radarCanvas, state.attrs);
    ctx.drawImage(radarCanvas, w - 260, 420, 240, 200);

    // DNA stats
    const a = state.attrs;
    const dnaLines = [
      ["Heading", a.heading],
      ["Left Foot", a.leftFoot],
      ["Right Foot", a.rightFoot],
      ["Speed", a.speed],
      ["Strength", a.strength],
      ["Fitness", a.fitness],
      ["Height", a.height + "cm"],
      ["Weight", a.weight + "kg"],
    ];
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("DNA", 55, 435);
    ctx.font = "13px Arial, sans-serif";
    dnaLines.forEach(([label, val], i) => {
      const y = 460 + i * 26;
      ctx.fillStyle = "#b8c0d0";
      ctx.fillText(label, 55, y);
      ctx.fillStyle = rarity.color;
      ctx.font = "bold 13px Arial, sans-serif";
      ctx.fillText(String(val), 140, y);
      ctx.font = "13px Arial, sans-serif";
    });

    // Honours as symbols
    const hon = [
      ["🏆", h2.leagueTitles],
      ["🥇", h2.domesticCups],
      ["🌍", h2.europeanCups],
      ["🦁", h2.intlTrophies],
      ["👟", h2.goldenBoots],
      ["🏅", h2.ballonDors],
    ].filter(([, v]) => v > 0);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("HONOURS", 55, 680);
    if (hon.length) {
      let x = 55;
      const y = 710;
      hon.forEach(([icon, val]) => {
        const text = `${icon} ${val}×`;
        const width = ctx.measureText(text).width + 16;
        ctx.fillStyle = "#1a1d2b";
        ctx.strokeStyle = "#3a4055";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y - 18, width, 28, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#f6c453";
        ctx.font = "bold 16px Arial, sans-serif";
        ctx.fillText(text, x + 8, y + 1);
        x += width + 8;
      });
    } else {
      ctx.fillStyle = "#b8c0d0";
      ctx.font = "14px Arial, sans-serif";
      ctx.fillText("No major honours", 55, 710);
    }

    // Branding + QR
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("1000GOALS.CO.UK", 55, h - 45);
    ctx.fillStyle = "#b8c0d0";
    ctx.font = "12px Arial, sans-serif";
    ctx.fillText("Football DNA Simulator", 55, h - 22);

    // QR code image
    const qr = new Image();
    qr.crossOrigin = "anonymous";
    qr.src = "https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https://1000goals.co.uk";
    qr.onload = () => {
      ctx.drawImage(qr, w - 120, h - 130, 80, 80);
    };

    // Buttons
    document.getElementById("btn-download-card").onclick = downloadShareCard;
    document.getElementById("btn-share-card").onclick = shareShareCard;
  }

  function downloadShareCard() {
    const canvas = document.getElementById("share-card-canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${state.player.name.replace(/\s+/g, "_")}_career_card.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function shareShareCard() {
    const canvas = document.getElementById("share-card-canvas");
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      const file = new File([blob], `${state.player.name.replace(/\s+/g, "_")}_career_card.png`, { type: "image/png" });
      const text = generateShareTagline();
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title: "Football DNA Simulator Career Card", text, files: [file] });
          return;
        } catch (e) {
          // Fall through to clipboard fallback
        }
      }
      try {
        await navigator.clipboard.writeText(text);
        alert("Tagline copied to clipboard. Use the Download button to save the image.");
      } catch (e) {
        alert("Use the Download button to save your career card.");
      }
    }, "image/png");
  }

  function generateShareTagline() {
    const clubCount = state.clubsPlayed.size;
    const rarity = computeCareerRarity().label;
    return `My Football DNA player, ${state.player.name}, scored ${state.totalGoals} goals across ${clubCount} club${clubCount !== 1 ? "s" : ""} and is rated ${rarity}. Build yours and try to beat me → https://1000goals.co.uk`;
  }

  function renderShareTagline() {
    const taglineEl = document.getElementById("share-tagline");
    const cardEl = document.getElementById("share-tagline-card");
    const codeEl = document.getElementById("career-code");
    const codeBox = document.getElementById("career-code-box");
    if (!taglineEl || !cardEl) return;
    cardEl.style.display = "block";
    taglineEl.textContent = generateShareTagline();
    if (codeEl && codeBox) {
      codeBox.style.display = "block";
      try {
        const code = generateCareerCode();
        codeEl.value = code || "Career code unavailable";
      } catch (e) {
        codeEl.value = "Career code unavailable";
      }
    }
    document.getElementById("btn-copy-tagline").onclick = copyShareTagline;
    document.getElementById("btn-copy-url").onclick = copyCareerURL;
  }

  function copyShareTagline() {
    const text = generateShareTagline();
    try {
      navigator.clipboard.writeText(text).then(() => alert("Tagline copied!"));
    } catch (e) {
      alert(text);
    }
  }

  function copyCareerURL() {
    try {
      const code = generateCareerCode();
      const url = `https://1000goals.co.uk/#career=${code}`;
      navigator.clipboard.writeText(url).then(() => alert("Career link copied!"));
    } catch (e) {
      alert("Could not copy career link.");
    }
  }

  function generateCareerCode() {
    // Encode the full career state as a base64 fragment. This is client-side only
    // (no server required) and allows a full career breakdown to be shared as a URL.
    const payload = serializeState(state);
    const code = btoa(unescape(encodeURIComponent(payload))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return code;
  }

  function loadCareerCode(code) {
    try {
      const base64 = code.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
      const json = decodeURIComponent(escape(atob(padded)));
      const loaded = deserializeState(json);
      if (!loaded) return false;
      state = loaded;
      resetTeamDatabase();
      setRatingMode(state.ratingMode || RATING_MODE.PEAK);
      endCareer(true);
      return true;
    } catch (e) {
      console.error("Career code failed", e);
      return false;
    }
  }

  function checkUrlHashCareer() {
    try {
      if (!window.location) return;
      const hash = window.location.hash || "";
      if (hash.startsWith("#career=")) {
        const code = hash.slice(8);
        if (code && loadCareerCode(code)) {
          window.location.hash = "";
        }
      }
    } catch (e) {
      console.error("Hash check failed", e);
    }
  }

  function startDailyChallenge() {
    // Every player gets the same seed for a given UTC day, so the same DNA and start is available to all.
    const now = new Date();
    const dateSeed = `daily-${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;
    clearSave();
    resetTeamDatabase();
    state = freshState();
    setSeed(dateSeed);
    state.difficulty = "medium";
    state.rerolls = DIFFICULTIES.medium.rerolls;
    state.era = "all";
    state.ratingMode = RATING_MODE.PEAK;
    log(`🔥 Daily Challenge: ${dateSeed}`, "milestone");
    showScreen("screen-genesis");
    beginTurn();
  }

  /* ----------------------------- LOG ------------------------------------ */
  function log(text, cls) {
    state.careerLog.unshift({ text, cls });
    const wrap = document.getElementById("career-log");
    if (!wrap) return;
    const div = document.createElement("div");
    div.className = "log-entry " + (cls || "");
    div.textContent = text;
    wrap.insertBefore(div, wrap.firstChild);
  }

  /* --------------------------- BIOGRAPHY --------------------------------- */
  // Unlike the mechanical career log, the biography is a hand-picked, prose
  // retelling of the standout chapters of a career — written as it happens.
  function addBioMoment(text) {
    if (!text) return;
    if (!state.bioMoments) state.bioMoments = [];
    state.bioMoments.push({ season: state.season, age: state.age, text });
  }

  function generateBioIntro() {
    const n = state.player.name;
    const origin = state.player.origin || COUNTRY_ORIGINS["England"];
    const acad = state.academy || {};
    const posLabel = ((POSITIONS[state.position] || POSITIONS.ST).label || "forward").toLowerCase();
    const style = state.playstyle ? state.playstyle.toLowerCase() : "developing";
    const ment = state.mentality ? state.mentality.toLowerCase() : "unproven";
    const traits = state.hiddenTraits || [];
    const traitFlavor = traits.length
      ? ` Even in the academy, there were early signs of a ${choice(traits).toLowerCase()} streak that would come to define their game.`
      : "";
    const originStory = origin.story || "humble beginnings";
    const openings = [
      `${origin.flag || ""} ${n} grew up on ${originStory}, dreaming of the big stage.`,
      `${origin.flag || ""} The story begins with ${originStory} — an unlikely starting point for ${n}'s journey.`,
      `${origin.flag || ""} Long before the headlines, ${n} was just another kid shaped by ${originStory}.`,
    ];
    return `${choice(openings)} They came through the ${acad.club || "local"} academy` +
      (acad.tier ? ` (${acad.tier} tier)` : "") +
      ` as a ${posLabel}, carrying a ${style} style of play and a ${ment} temperament.${traitFlavor}`;
  }

  function narrateSeasonForBio(sd, intl) {
    const n = state.player.name;
    const club = state.club;
    const lines = [];

    if (sd.champion === club) {
      lines.push(choice([
        `${club} were crowned champions, and ${n} played a starring role, scoring ${sd.goals} goals in a title-winning season.`,
        `A season to frame forever: ${club} went all the way to the title, with ${n} chipping in ${sd.goals} goals and ${sd.assists} assists.`,
        `${n} finally got their hands on a winner's medal as ${club} swept to the championship.`,
      ]));
    }
    if (sd.honours.includes("European Cup")) {
      lines.push(`Continental glory — ${n} became a European champion with ${club}.`);
    }
    if (sd.honours.includes("Domestic Cup")) {
      lines.push(`${n} lifted a domestic cup with ${club}, adding another line to the trophy cabinet.`);
    }
    if (sd.awards.includes("Ballon d'Or")) {
      lines.push(`The ultimate individual honour arrived: ${n} was crowned the world's best player, the Ballon d'Or capping off a ${sd.goals}-goal season.`);
    }
    if (sd.awards.includes("Player of the Season")) {
      lines.push(`${n} was named Player of the Season, the standout performer in a campaign that produced ${sd.goals} goals and ${sd.assists} assists.`);
    }
    if (sd.isTopScorer) {
      lines.push(`${n} topped the scoring charts and claimed the Golden Boot with ${sd.leagueGoals} league goals.`);
    }
    if (sd.awards.includes("Young Player of the Year")) {
      lines.push(`Still only ${state.age}, ${n} was recognised as the league's brightest young talent.`);
    }
    if (sd.trajectory === "Relegated") {
      lines.push(`It ended in heartbreak — ${club} were relegated despite ${n}'s ${sd.goals} goals.`);
    }
    if (sd.promotionRelegation && sd.promotionRelegation.promoted && sd.promotionRelegation.promoted.includes(club)) {
      lines.push(`${club} won promotion, ${n} playing a key part in the climb up the pyramid.`);
    }
    if (!lines.length) {
      if (sd.perfTier === "Sensational") {
        lines.push(choice([
          `A career-defining year — ${sd.goals} goals and ${sd.assists} assists in ${sd.apps} appearances, the kind of form that gets an entire league talking.`,
          `${n} was simply unplayable this season, racking up ${sd.goals} goals in ${sd.apps} games for ${club}.`,
        ]));
      } else if (sd.perfTier === "Flop" && sd.apps > 0) {
        lines.push(choice([
          `A season to forget — form and fitness deserted ${n}, who managed just ${sd.goals} goals in ${sd.apps} appearances.`,
          `Not every year is a highlight reel: ${club} and ${n} both struggled for rhythm this season.`,
        ]));
      }
    }
    if (sd.gamesMissed >= 12) {
      lines.push(`Persistent injury trouble kept ${n} sidelined for a big chunk of the year — ${sd.gamesMissed} games missed.`);
    }
    if (intl && intl.goals >= 3) {
      const stage = intl.tournamentName ? `at the ${intl.tournamentName}` : "on the international stage";
      lines.push(`${n} was electric ${stage} for ${state.country}, scoring ${intl.goals} in ${intl.caps} caps.`);
    }
    if (intl && intl.wonTrophy) {
      const trophy = intl.tournamentName ? `the ${intl.tournamentName}` : "international silverware";
      lines.push(`${n} lifted ${trophy} with ${state.country} this summer.`);
    }

    if (!lines.length) return null;
    return lines.join(" ");
  }

  function narrateTransferForBio(fromClub, toClub) {
    const n = state.player.name;
    const td = TEAM_DATABASE[toClub] || {};
    const bigMove = td.attack >= 84;
    const templates = bigMove ? [
      `A blockbuster move — ${n} said goodbye to ${fromClub} and signed for ${toClub}, one of the biggest clubs in ${td.league || "the league"}.`,
      `${n} sealed a dream transfer to ${toClub}, stepping up to the top level of ${td.league || "the game"}.`,
      `The move everyone was talking about: ${n} left ${fromClub} to join ${toClub}.`,
    ] : [
      `${n} left ${fromClub} behind for a fresh start at ${toClub}.`,
      `A new chapter began as ${n} signed for ${toClub} after their time at ${fromClub}.`,
    ];
    return choice(templates);
  }

  function generateBioClosing() {
    const n = state.player.name;
    const clubs = state.clubsPlayed ? state.clubsPlayed.size : 0;
    const h = state.honours || {};
    const trophyBits = [];
    if (h.leagueTitles) trophyBits.push(`${h.leagueTitles} league title${h.leagueTitles > 1 ? "s" : ""}`);
    if (h.domesticCups) trophyBits.push(`${h.domesticCups} domestic cup${h.domesticCups > 1 ? "s" : ""}`);
    if (h.europeanCups) trophyBits.push(`${h.europeanCups} European Cup${h.europeanCups > 1 ? "s" : ""}`);
    if (h.ballonDors) trophyBits.push(`${h.ballonDors} Ballon d'Or${h.ballonDors > 1 ? "s" : ""}`);
    if (h.goldenBoots) trophyBits.push(`${h.goldenBoots} Golden Boot${h.goldenBoots > 1 ? "s" : ""}`);
    const trophyLine = trophyBits.length
      ? ` Along the way they collected ${trophyBits.join(", ")}.`
      : " The trophy cabinet stayed bare, but the goals never stopped coming.";
    const reasonFlavor = {
      goal: `walked away on their own terms, having smashed the ${LEVERS.goalTarget}-goal mark`,
      planned: "called time on their own terms, at peace with a job well done",
      injury: "was forced into an early, unwanted retirement by injury",
    }[state.endCareerReason] || "hung up the boots for the final time";
    return `After ${state.season} seasons and ${clubs} club${clubs !== 1 ? "s" : ""}, ${n} ${reasonFlavor}, finishing with ${state.totalGoals} career goals and ${state.totalAssists} assists in ${state.totalApps} appearances.${trophyLine}`;
  }

  function buildBiographyHtml() {
    const moments = state.bioMoments || [];
    const intro = moments[0]?.text || generateBioIntro();
    const momentsHtml = moments.slice(1).map((m) =>
      `<div class="bio-entry"><span class="bio-tag">Season ${m.season} · Age ${m.age}</span><p>${esc(m.text)}</p></div>`
    ).join("");
    const closingHtml = state.bioClosing
      ? `<div class="bio-entry bio-closing"><span class="bio-tag">Retirement</span><p>${esc(state.bioClosing)}</p></div>`
      : "";
    return `<div class="bio-intro"><p>${esc(intro)}</p></div>` +
      (momentsHtml || `<div class="bio-empty">The story is only just beginning…</div>`) + closingHtml;
  }

  function renderBiography() {
    const el = document.getElementById("career-biography-content") || document.getElementById("biography-content");
    if (el) el.innerHTML = buildBiographyHtml();
  }

  function renderLegacyBiography() {
    const el = document.getElementById("legacy-biography");
    if (el) el.innerHTML = buildBiographyHtml();
  }
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function perfClass(tier) {
    return { Sensational: "great", Overperformed: "good", "Met Expectation": "ok", Underperformed: "bad", Flop: "awful" }[tier] || "";
  }

  /* ----------------------------- ACCOUNT SYSTEM ------------------------- */
  const ACC_KEY = "football-dna-account";
  const ACHIEVEMENTS = [
    { id: "1000_goals", name: "1000 Club", desc: "Reach 1000 career goals", rare: true },
    { id: "50_season", name: "Half-Century Season", desc: "Score 50+ goals in a single season", rare: true },
    { id: "golden_boot_haul", name: "Golden Boot Haul", desc: "Win 3 Golden Boots", rare: true },
    { id: "ballon_dor", name: "World's Best", desc: "Win the Ballon d'Or", rare: true },
    { id: "title_dynasty", name: "Title Dynasty", desc: "Win 5 league titles", rare: true },
    { id: "europe_king", name: "Continental King", desc: "Win 2 European Cups", rare: true },
    { id: "intl_star", name: "International Star", desc: "Score 20+ international goals", rare: true },
    { id: "one_club_man", name: "One Club Man", desc: "Spend 10+ seasons at a single club", rare: true },
    { id: "world_traveller", name: "World Traveller", desc: "Play for clubs in 3+ different countries", rare: true },
    { id: "journeyman", name: "Journeyman", desc: "Play for 5+ different clubs", rare: false },
    { id: "wonderkid", name: "Wonderkid", desc: "Win Young Player of the Year", rare: false },
    { id: "captain", name: "Captain", desc: "Become international captain", rare: true },
    { id: "cup_hero", name: "Cup Hero", desc: "Win 3 domestic cups", rare: true },
    { id: "statue_worthy", name: "Statue Worthy", desc: "Reach 90+ reputation at one club", rare: true },
    { id: "perfect_10", name: "Perfect 10", desc: "Achieve a 10.0 season rating", rare: true },
  ];
  function generateId(len) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function generatePassword() {
    return generateId(4) + "-" + generateId(4) + "-" + generateId(4);
  }
  function generateUsername() {
    return "striker_" + generateId(8);
  }
  function createAccount() {
    const account = { username: generateUsername(), password: generatePassword(), achievements: [] };
    try { localStorage.setItem(ACC_KEY, JSON.stringify(account)); } catch (e) {}
    return account;
  }
  function loadAccount() {
    try {
      const raw = localStorage.getItem(ACC_KEY);
      if (!raw) return null;
      const acc = JSON.parse(raw);
      acc.achievements = acc.achievements || [];
      return acc;
    } catch (e) { return null; }
  }
  function saveAccount(acc) {
    try { localStorage.setItem(ACC_KEY, JSON.stringify(acc)); } catch (e) {}
  }
  function loginAccount(username, password) {
    const acc = loadAccount();
    if (!acc) return { ok: false, message: "No account found. Create one first." };
    if (acc.username === username && acc.password === password) return { ok: true, message: "Logged in successfully." };
    return { ok: false, message: "Invalid username or password." };
  }

  function getClubCountry(club) {
    const league = (TEAM_DATABASE[club] || {}).league;
    if (["LaLiga"].includes(league)) return "Spain";
    if (["SerieA"].includes(league)) return "Italy";
    if (["Bundesliga"].includes(league)) return "Germany";
    return "England";
  }
  function getCountriesPlayed() {
    return new Set([...state.clubsPlayed].map(getClubCountry)).size;
  }
  function getMaxYearsAtClub() {
    return Math.max(0, ...Object.values(state.clubStats || {}).map((c) => c.years || 0));
  }
  function getSeasonBestGoals() {
    return Math.max(0, ...(state.seasonHistory || []).map((s) => s.goals || 0));
  }
  function checkCareerAchievements() {
    const h = state.honours;
    const newIds = [];
    const tests = {
      "1000_goals": state.totalGoals >= 1000,
      "50_season": getSeasonBestGoals() >= 50,
      "golden_boot_haul": h.goldenBoots >= 3,
      "ballon_dor": h.ballonDors >= 1,
      "title_dynasty": h.leagueTitles >= 5,
      "europe_king": h.europeanCups >= 2,
      "intl_star": state.intlGoals >= 20,
      "one_club_man": getMaxYearsAtClub() >= 10,
      "world_traveller": getCountriesPlayed() >= 3,
      "journeyman": state.clubsPlayed.size >= 5,
      "wonderkid": h.youngPlayer >= 1,
      "captain": state.intlCaptain,
      "cup_hero": h.domesticCups >= 3,
      "statue_worthy": state.reputation >= 90,
      "perfect_10": state.bestRating >= 10,
    };
    const acc = loadAccount();
    const unlocked = acc ? acc.achievements : [];
    for (const [id, ok] of Object.entries(tests)) {
      if (ok && !unlocked.includes(id)) newIds.push(id);
    }
    return newIds;
  }
  function unlockAchievements(ids) {
    if (!ids || !ids.length) return [];
    const acc = loadAccount();
    if (!acc) return ids;
    const before = new Set(acc.achievements);
    for (const id of ids) before.add(id);
    acc.achievements = [...before];
    saveAccount(acc);
    return ids;
  }
  function renderAchievements() {
    const acc = loadAccount();
    const unlocked = acc ? acc.achievements : [];
    const list = ACHIEVEMENTS.map((a) => {
      const got = unlocked.includes(a.id);
      return `<div class="ach-row ${got ? "unlocked" : "locked"}"><span class="ach-name">${got ? "✓" : "○"} ${a.name}</span><span class="ach-desc">${a.desc}</span>${a.rare ? '<span class="ach-rare">RARE</span>' : ""}</div>`;
    }).join("");
    return list;
  }
  function renderAccountModal() {
    const modal = document.getElementById("account-modal");
    const createBox = document.getElementById("account-create");
    const infoBox = document.getElementById("account-info");
    const status = document.getElementById("account-status");
    const acc = loadAccount();
    modal.style.display = "flex";
    if (acc) {
      createBox.style.display = "none";
      infoBox.style.display = "block";
      document.getElementById("acc-username").value = acc.username;
      document.getElementById("acc-password").value = acc.password;
      document.getElementById("achievements-list").innerHTML = renderAchievements();
      document.getElementById("account-achievements").style.display = "block";
      status.textContent = "Account loaded. Use the credentials below to log in on this device.";
    } else {
      createBox.style.display = "block";
      infoBox.style.display = "none";
      status.textContent = "No account yet. Create one to save your credentials on this browser.";
    }
  }
  function closeAccountModal() {
    document.getElementById("account-modal").style.display = "none";
  }
  function wireAccount() {
    document.getElementById("btn-account").addEventListener("click", renderAccountModal);
    document.getElementById("btn-close-account").addEventListener("click", closeAccountModal);
    document.querySelector("#account-modal .modal-backdrop").addEventListener("click", closeAccountModal);
    document.getElementById("btn-create-account").addEventListener("click", () => {
      const acc = createAccount();
      renderAccountModal();
      document.getElementById("account-status").textContent = "Account created! Copy and save your username and password.";
    });
    document.getElementById("btn-copy-user").addEventListener("click", () => {
      const el = document.getElementById("acc-username");
      el.select();
      document.execCommand("copy");
      document.getElementById("account-status").textContent = "Username copied to clipboard.";
    });
    document.getElementById("btn-show-pass").addEventListener("click", () => {
      const el = document.getElementById("acc-password");
      el.type = el.type === "password" ? "text" : "password";
      document.getElementById("btn-show-pass").textContent = el.type === "password" ? "Show" : "Hide";
    });
    document.getElementById("btn-login").addEventListener("click", () => {
      const user = document.getElementById("acc-login-user").value.trim();
      const pass = document.getElementById("acc-login-pass").value.trim();
      const res = loginAccount(user, pass);
      document.getElementById("account-status").textContent = res.message;
    });
  }

  /* ----------------------------- WIRING --------------------------------- */
  function init() {
    checkUrlHashCareer();
    document.getElementById("btn-start").addEventListener("click", () => showScreen("screen-difficulty"));
    document.querySelectorAll(".btn-difficulty").forEach((b) =>
      b.addEventListener("click", () => startCreation(b.dataset.difficulty)));
    const btnSetupContinue = document.getElementById("btn-setup-continue");
    const btnSetupBack = document.getElementById("btn-setup-back");
    if (btnSetupContinue) btnSetupContinue.addEventListener("click", beginSetup);
    if (btnSetupBack) btnSetupBack.addEventListener("click", () => showScreen("screen-difficulty"));
    const dailyBtn = document.getElementById("btn-daily-challenge");
    if (dailyBtn) {
      dailyBtn.addEventListener("click", startDailyChallenge);
      document.getElementById("daily-challenge-box").style.display = "block";
    }
    if (hasSave()) {
      document.getElementById("continue-box").style.display = "block";
      document.getElementById("btn-continue").addEventListener("click", resumeGame);
    }
    document.getElementById("btn-spin").addEventListener("click", spin);
    document.getElementById("btn-accept").addEventListener("click", accept);
    document.getElementById("btn-reroll").addEventListener("click", reroll);
    const mSpin = document.getElementById("btn-spin-mobile");
    if (mSpin) mSpin.addEventListener("click", spin);
    const mAccept = document.getElementById("btn-accept-mobile");
    if (mAccept) mAccept.addEventListener("click", accept);
    const mReroll = document.getElementById("btn-reroll-mobile");
    if (mReroll) mReroll.addEventListener("click", reroll);
    document.getElementById("btn-confirm-career").addEventListener("click", startCareer);
    const btnProfile = document.getElementById("btn-profile");
    const btnCloseProfile = document.getElementById("btn-close-profile");
    if (btnProfile) btnProfile.addEventListener("click", () => switchCareerTab("profile"));
    if (btnCloseProfile) btnCloseProfile.addEventListener("click", () => switchCareerTab("season"));
    const btnViewFullLog = document.getElementById("btn-view-full-log");
    if (btnViewFullLog) btnViewFullLog.addEventListener("click", () => switchCareerTab("history"));
    document.querySelectorAll(".career-tab").forEach((t) =>
      t.addEventListener("click", () => switchCareerTab(t.dataset.tab)));
    document.querySelectorAll(".btn-play-again").forEach((b) => b.addEventListener("click", () => {
      clearSave();
      document.getElementById("career-log").innerHTML = "";
      document.getElementById("season-result").innerHTML = "";
      document.getElementById("continue-box").style.display = "none";
      switchCareerTab("season");
      showScreen("screen-welcome");
    }));
    wireAccount();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();




  function getCareerSection(age) {
    for (const [key, sec] of Object.entries(CAREER_SECTIONS)) {
      if (age >= sec.min && age <= sec.max) return key;
    }
    return "Overtime";
  }


  function getCareerOutcomeScore(s, ending) {
    let score = ending.base;
    if (ending.score) score += ending.score(s);
    return Math.max(0, score);
  }

  function resolveEndOfCareerEvent() {
    if (state.totalGoals >= LEVERS.goalTarget) return { extended: false, event: "goal_target" };
    if (state.endOfCareerTriggered) return { extended: false, event: "already_triggered" };
    const eligible = CAREER_ENDINGS.filter((e) => !e.req || e.req(state)).map((e) => ({ item: e, weight: getCareerOutcomeScore(state, e) }));
    if (!eligible.length) return { extended: false, event: "none" };
    const ev = weightedRandomPick(eligible);
    const c = weightedRandomPick(ev.choices.map((ch) => ({ item: ch, weight: ch.weight || 1 })));
    handleEndChoice(c.fx, ev.text(state.player.name, state), c.label, ev);
    if (c.fx && (c.fx.finalSeason || c.fx.extend || c.fx.returnHome)) return { extended: true, event: ev.id };
    return { extended: false, event: ev.id };
  }

  // DEBUG expose for stress testing
  window.__STRESS_TEST__ = {
    startCreation, compilePlayer, simulateSeason, applySeasonalAttributeChanges, playSeason,
    recomputePlayerStats, simulateInternational, computeClubContractOffer, generateOffers, generateForcedDestinationOffers, determineNaturalRole,
    getPillar, checkCareerMilestone, pickSeasonDecision, applyEffects, applyEffectsRaw,
    getEventWeight, pickSeasonEvent, pickSeasonEvents, determineEventCount, getCareerSection, getCareerOutcomeScore, resolveEndOfCareerEvent,
    getState: () => state, setState: (s) => { state = migrateState(s); }, setSeed, serializeState, deserializeState, normalizeContractState,
    get LEAGUE_CLUBS() { return getPLLeagueClubs(); },
    getPLLeagueClubs, getChampionshipClubs, getLeague1Clubs, getLeague2Clubs, getNationalLeagueClubs,
    getForeignLeagueClubs, runPromotionRelegation,
    generateLoanOffers, goOnLoan, returnFromLoanIfDue,
    FOREIGN_LEAGUES, TEAM_DATABASE, SEASON_EVENTS, CAREER_ENDINGS, CAREER_SECTIONS
  };
})();
