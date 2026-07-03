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
    TEAM_DATABASE,
    ACADEMY_STARTING_POOL,
    NATIONAL_TEAM,
    FOREIGN_LEAGUES,
  } = D;

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
    "Sheffield United": { name: "C. Wilder", focus: "Organised Battle", tag: "Squad players", youth: "Medium", project: "Defensive underdogs" },
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
  // skill attributes that receive hidden-influence blending
  const HIDDEN_KEYS = ["heading", "fitness", "strength", "leftFoot", "rightFoot", "speed"];
  const HIDDEN_WEIGHT = 0.38;

  const LEVERS = {
    startRerolls: 3,
    goalTarget: 1000,
    conversionMultiplier: 1.0,
    primeWindow: [25, 29],
    injuryFreqMin: 3,
    injuryFreqMax: 6,
    debutAge: 17,
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
    "Early Bloomer": { desc: "Reaches peak around 24-26; fades earlier.", type: "age" },
    "Late Bloomer": { desc: "Slow starter, peaks after 27.", type: "age" },
    "Speedster": { desc: "Elite pace changes games.", type: "play" },
    "Aerial Threat": { desc: "Dominant in the air.", type: "play" },
    "Powerhouse": { desc: "Physical bully up front.", type: "play" },
    "Clinical Finisher": { desc: "Lethal with his best foot.", type: "play" },
    "Two-Footed": { desc: "Equally dangerous off both feet.", type: "play" },
    "One-Footed Wonder": { desc: "Specialist with one foot, predictable with the other.", type: "play" },
    "Injury Prone": { desc: "Struggles to stay fit.", type: "fitness" },
    "Iron Man": { desc: "Rarely misses a game.", type: "fitness" },
    "Big Game Player": { desc: "Rises to the occasion.", type: "mentality" },
    "Leader": { desc: "Natural captain material.", type: "mentality" },
    "Workhorse": { desc: "Relentless off-the-ball work.", type: "mentality" },
    "Volatile": { desc: "Unpredictable — brilliant or a liability.", type: "mentality" },
    "High Ceiling": { desc: "Young with superstar potential.", type: "development" },
    "Journeyman": { desc: "Likely to move clubs often.", type: "career" },
    "One-Club Man": { desc: "Loyal to a fault.", type: "career" },
  };

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
    if (rand() < 0.12) traits.add("Early Bloomer");
    else if (rand() < 0.12) traits.add("Late Bloomer");

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

  function rollAgent() {
    const pick = weightedRandomPick(AGENT_TIERS.map((t) => ({ item: t, weight: t.weight })));
    const agent = pick || AGENT_TIERS[1];
    state.agent = { key: agent.key, label: agent.label, influence: agent.influence, contractBonus: agent.contractBonus };
    state.wealth = agent.wealth;
    state.fame = Math.floor(agent.wealth / 2);
  }

  function drawRadarChart(canvas, attrs) {
    if (!canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 28;
    const labels = ["Heading", "Left Foot", "Right Foot", "Speed", "Strength", "Fitness"];
    const keys = ["heading", "leftFoot", "rightFoot", "speed", "strength", "fitness"];
    const n = labels.length;

    ctx.clearRect(0, 0, w, h);
    // grid rings
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
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
      const val = clamp(attrs[keys[i]], 0, 100);
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = (val / 100) * maxR;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(37, 208, 122, 0.25)";
    ctx.fill();
    ctx.strokeStyle = "#25d07a";
    ctx.lineWidth = 2;
    ctx.stroke();
    // labels
    ctx.fillStyle = "#e8edf7";
    ctx.font = "11px Segoe UI, sans-serif";
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

  const SQUAD_KEYS = Object.keys(PLAYER_DATABASE);
  const CLUB_KEYS = Object.keys(CLUB_ACADEMY);

  // Normalise each player to the best version of themselves across all seasons.
  // This guarantees that a striker who peaked in 2008 still carries that peak
  // when they appear in a 2004 donor squad, protecting the player against stale data.
  const playerBest = {};
  for (const squad of SQUAD_KEYS) {
    for (const pl of PLAYER_DATABASE[squad]) {
      const best = playerBest[pl.name];
      if (!best) {
        playerBest[pl.name] = { ...pl };
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
  // Mutate the existing player objects in place so the local constant and
  // the game data both reference the normalised versions.
  for (const squad of SQUAD_KEYS) {
    const squadList = PLAYER_DATABASE[squad];
    for (let i = 0; i < squadList.length; i++) {
      squadList[i] = playerBest[squadList[i].name];
    }
  }
  const LEAGUE_CLUBS = Object.keys(TEAM_DATABASE).filter((c) => ["Elite", "Europe", "Mid", "Lower"].includes(TEAM_DATABASE[c].league));
  const FOREIGN_LEAGUE_KEYS = ["LaLiga", "SerieA", "Bundesliga"];
  function getClubLeague(club) {
    return (TEAM_DATABASE[club] || {}).league;
  }
  function getLeagueClubs(club) {
    const league = getClubLeague(club);
    if (FOREIGN_LEAGUE_KEYS.includes(league)) return FOREIGN_LEAGUES[league] || [club];
    return LEAGUE_CLUBS;
  }

  /* ------------------------------ STATE --------------------------------- */
  let state = null;

  function freshState() {
    return {
      // genesis
      difficulty: "easy",
      synergyMultiplier: 1,
      phase: "attributes", // attributes -> academy
      rerolls: LEVERS.startRerolls,
      currentSpin: null, // { squadKey/club, team, year } or club spin
      chosenAttr: null,  // attribute key selected this turn
      selectedDonorIdx: null,
      pendingClub: null,  // club selected from offers on confirm screen
      clubOffers: [],     // generated club offers for confirm screen
      player: { name: "Your Striker", slots: {}, usedDonors: [] }, // attr -> { donor, donorObj, team, year, value, value2 }
      academy: null, // { club, tier }
      // compiled
      attrs: null, mentality: null, mentalityRating: 60, playstyle: null,
      baseRating: 0, synergyNotes: [], derived: null, hiddenTraits: [],
      position: "ST", contractYears: 0, contractSignedAt: 0, retireNow: false,
      agent: null, wealth: 0, fame: 0,
      // career
      season: 0, age: LEVERS.debutAge, club: null, role: "Rotation",
      reputation: 20, reputationTier: "Unknown",
      totalGoals: 0, totalApps: 0, totalAssists: 0, leagueGoals: 0,
      totalYellow: 0, totalRed: 0, teamCleanSheets: 0,
      careerLog: [], flags: {}, cooldowns: {}, pendingCarryOver: [],
      yearsAtClub: 0, injuryProneSeasons: 0, milestonesHit: {},
      intlCaps: 0, intlGoals: 0, intlDebut: false, intlCaptain: false,
      injuryProneness: 50, retirementAge: 40, luck: 0,
      seasonHistory: [], retired: false, bestRating: 0,
      clubsPlayed: new Set(), clubStats: {}, lastPerformanceTier: "Met Expectation",
      honours: {
        leagueTitles: 0, domesticCups: 0, europeanCups: 0, intlTrophies: 0,
        goldenBoots: 0, ballonDors: 0, playerOfSeason: 0, youngPlayer: 0, tots: 0,
      },
      competitionHistory: [],
      leagueTable: null,
      pendingTransfer: false,
      endCareerReason: null,
      finalSeasonForced: false,
    };
  }

  /* ------------------------------ UTILS --------------------------------- */
  const rand = Math.random;
  function randInt(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }
  function randomBetween(min, max) { return rand() * (max - min) + min; }
  function randBetween(min, max) { return randomBetween(min, max); }
  function choice(arr) { return arr[Math.floor(rand() * arr.length)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function poissonRandom(lambda) {
    if (lambda <= 0) return 0;
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
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
  const SAVE_VERSION = 1;

  function serializeState(s) {
    const copy = Object.assign({}, s);
    copy.clubsPlayed = [...s.clubsPlayed];
    return JSON.stringify({ version: SAVE_VERSION, state: copy });
  }

  function deserializeState(json) {
    const wrapped = JSON.parse(json);
    const s = wrapped.state || wrapped;
    if (s.clubsPlayed) s.clubsPlayed = new Set(s.clubsPlayed);
    return s;
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
      const wrapped = JSON.parse(json);
      if (wrapped.version !== SAVE_VERSION) { console.warn("Save version mismatch"); return null; }
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

  /* ============================ GENESIS ================================= */
  function startCreation(difficulty) {
    clearSave();
    state = freshState();
    state.difficulty = difficulty || "easy";
    const cfg = DIFFICULTIES[state.difficulty];
    state.rerolls = cfg.rerolls;
    showScreen("screen-genesis");
    beginTurn();
  }

  function remainingAttrs() {
    return ATTRS.filter((a) => !state.player.slots[a.key]);
  }

  function beginTurn() {
    state.currentSpin = null;
    state.chosenAttr = null;
    state.selectedDonorIdx = null;

    const isAcademy = state.phase === "academy";
    document.getElementById("attr-name").textContent = isAcademy ? "Academy Roll" : "Roll a Squad";
    document.getElementById("attr-desc").textContent = isAcademy
      ? "Roll a Premier League club — whichever comes up decides which academy your striker graduated from."
      : "Spin to draw a random squad & era, then choose which attribute to draft from it.";

    const done = ATTRS.length - remainingAttrs().length;
    document.getElementById("roll-counter").textContent = isAcademy
      ? "Academy" : `Attribute ${done + 1} of ${ATTRS.length}`;
    document.getElementById("reroll-count").textContent = state.rerolls;

    document.getElementById("roll-result").innerHTML =
      `<div class="placeholder">Press <strong>SPIN</strong> to ${isAcademy ? "roll a club" : "draw a squad"}.</div>`;
    setBtn("btn-spin", true);
    setBtn("btn-accept", false);
    setBtn("btn-reroll", false);
    renderPreview();
  }

  function setBtn(id, show) {
    const b = document.getElementById(id);
    b.style.display = show ? "inline-block" : "none";
    b.disabled = !show;
  }

  function spin() {
    document.getElementById("btn-spin").disabled = true;
    const target = document.getElementById("roll-result");
    const isAcademy = state.phase === "academy";
    let ticks = 0;
    const totalTicks = 16;
    const iv = setInterval(() => {
      if (isAcademy) {
        const c = choice(CLUB_KEYS);
        target.innerHTML = `<div class="spinner-team">${esc(c)}<span class="spinner-year">${CLUB_ACADEMY[c]} academy</span></div>`;
      } else {
        const { team, year } = parseSquadKey(choice(SQUAD_KEYS));
        target.innerHTML = `<div class="spinner-team">${esc(team)}<span class="spinner-year">${year}</span></div>`;
      }
      if (++ticks >= totalTicks) { clearInterval(iv); isAcademy ? landClub() : landSquad(); }
    }, 80);
  }

  /* ---- attribute squad roll ---- */
  function landSquad() {
    const squadKey = choice(SQUAD_KEYS);
    const { team, year } = parseSquadKey(squadKey);
    state.currentSpin = { squadKey, team, year };
    renderAttrChooser();
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
      case "mentality": return pl.overall; // sort mentality donors by peak overall
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
      case "mentality": return `${pl.mentality}${mentIsSpecial(pl.mentality) ? " ★" : ""}`;
      default: return "";
    }
  }

  function chooseAttr(key) {
    state.chosenAttr = key;
    state.selectedDonorIdx = null;
    document.querySelectorAll(".attr-chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.key === key));
    const cfg = ATTR_BY_KEY[key];

    if (cfg.key === "position") { renderPositionRoll(); return; }
    if (cfg.key === "build") { renderBuildRoll(); return; }

    const { squadKey, team, year } = state.currentSpin;
    // sort players high -> low by the chosen attribute
    const squad = PLAYER_DATABASE[squadKey]
      .map((pl, idx) => ({ pl, idx }))
      .sort((a, b) => statForAttr(key, b.pl) - statForAttr(key, a.pl));

    const used = new Set(state.player.usedDonors || []);
    const hideStats = DIFFICULTIES[state.difficulty].hideStats;
    const cards = squad.map(({ pl, idx }) => {
      const badge = statForAttr(key, pl);
      const tierChip = pl.tier ? `<span class="legend-chip">${pl.tier}</span>` : "";
      const isUsed = used.has(pl.name);
      return `
        <button class="donor-card${isUsed ? " used" : ""}" data-idx="${idx}"${isUsed ? " disabled" : ""}>
          ${hideStats ? "" : `<div class="donor-badge">${key === "mentality" ? "" : badge}</div>`}
          <div class="donor-name">${esc(pl.name)} ${tierChip}${isUsed ? " <span class='used-tag'>USED</span>" : ""}</div>
          ${hideStats ? "" : `<div class="donor-pos">${pl.pos}</div>`}
          ${hideStats ? "" : `<div class="donor-value">${donorValueText(key, pl)}</div>`}
        </button>`;
    }).join("");

    document.getElementById("roster-slot").innerHTML = `
      <div class="chooser-label">Pick the <strong>${cfg.name}</strong> donor (sorted best → worst):</div>
      <div class="roster-grid">${cards}</div>
      <div id="selected-donor"></div>`;
    document.querySelectorAll("#roster-slot .donor-card").forEach((c) =>
      c.addEventListener("click", () => {
        if (c.disabled) return;
        selectDonor(parseInt(c.dataset.idx, 10));
      }));
  }

  function renderPositionRoll() {
    const wrap = document.getElementById("roster-slot");
    const slot = state.player.slots.position;
    const result = slot
      ? `<div class="roll-result big">${POSITIONS[slot.position].label}</div>`
      : `<div class="roll-placeholder">Click ROLL to determine your position</div>`;
    const canRoll = state.rerolls > 0 || !slot;
    wrap.innerHTML = `
      <div class="chooser-label">Roll your primary position:</div>
      ${result}
      <button class="btn primary" id="btn-roll-position" ${slot ? "" : "disabled"} style="display:${slot ? "none" : "inline-block"}">ROLL POSITION</button>
      <div id="selected-donor"></div>`;
    if (!slot) {
      document.getElementById("btn-roll-position").disabled = false;
      document.getElementById("btn-roll-position").addEventListener("click", () => {
        const pos = rollPosition();
        state.player.slots.position = { position: pos, value: pos, donor: "Rolled", team: "—", year: "—", type: "position" };
        renderPositionRoll();
        renderPreview();
        setBtn("btn-accept", true);
        setBtn("btn-reroll", state.rerolls > 0);
      });
    }
  }

  function renderBuildRoll() {
    const wrap = document.getElementById("roster-slot");
    const slot = state.player.slots.build;
    const result = slot
      ? `<div class="roll-result big">${slot.height}cm · ${slot.weight}kg</div>`
      : `<div class="roll-placeholder">Click ROLL to determine your build</div>`;
    wrap.innerHTML = `
      <div class="chooser-label">Roll your height &amp; weight:</div>
      ${result}
      <button class="btn primary" id="btn-roll-build" style="display:${slot ? "none" : "inline-block"}">ROLL BUILD</button>
      <div id="selected-donor"></div>`;
    if (!slot) {
      document.getElementById("btn-roll-build").addEventListener("click", () => {
        const b = rollBuild();
        state.player.slots.build = { height: b.height, weight: b.weight, value: b.height, value2: b.weight, donor: "Rolled", team: "—", year: "—", type: "build" };
        renderBuildRoll();
        renderPreview();
        setBtn("btn-accept", true);
        setBtn("btn-reroll", state.rerolls > 0);
      });
    }
  }

  function rollPosition() { return choice(POSITION_KEYS); }
  function rollBuild() {
    const height = randInt(168, 196);
    const weight = clamp(Math.round((height - 100) * 0.9 + randInt(-6, 10)), 64, 98);
    return { height, weight };
  }

  function selectDonor(idx) {
    const { squadKey } = state.currentSpin;
    const pl = PLAYER_DATABASE[squadKey][idx];
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

  /* ---- academy club roll ---- */
  function landClub() {
    const club = choice(CLUB_KEYS);
    const tier = CLUB_ACADEMY[club];
    state.currentSpin = { club, tier };
    const info = ACADEMY_TIERS[tier] || {};
    document.getElementById("roll-result").innerHTML = `
      <div class="roll-landed">🎓 Youth product of <strong>${esc(club)}</strong></div>
      <div class="academy-card tier-${tier.replace(/\s/g, "")}">
        <div class="academy-tier">${tier} Academy</div>
        <div class="academy-flavor">${esc(info.flavor || "")}</div>
      </div>
      <div class="chooser-label">Accept this academy, or reroll for a different club.</div>`;
    setBtn("btn-spin", false);
    setBtn("btn-accept", true);
    setBtn("btn-reroll", state.rerolls > 0);
  }

  function accept() {
    if (state.phase === "academy") {
      if (!state.currentSpin || !state.currentSpin.club) return;
      state.academy = { club: state.currentSpin.club, tier: state.currentSpin.tier };
      try {
        compilePlayer();
      } catch (err) {
        console.error("compilePlayer failed during academy accept:", err);
        alert("Failed to compile player: " + err.message);
      }
      return;
    }
    // attribute phase
    const key = state.chosenAttr;
    if (!key) return;

    // position and build are rolled, not drafted from a donor
    if (key === "position" || key === "build") {
      if (!state.player.slots[key]) return;
      if (remainingAttrs().length === 0) { state.phase = "academy"; }
      saveState();
      beginTurn();
      return;
    }

    if (state.selectedDonorIdx == null) return;
    const { squadKey, team, year } = state.currentSpin;
    const pl = PLAYER_DATABASE[squadKey][state.selectedDonorIdx];
    if ((state.player.usedDonors || []).includes(pl.name)) return;
    const slot = { donor: pl.name, donorObj: pl, team, year };
    if (key === "body") { slot.value = pl.fitness; slot.value2 = pl.strength; }
    else if (key === "mentality") { slot.value = pl.mentality; slot.rating = pl.mentalityRating; }
    else slot.value = pl[key];
    state.player.slots[key] = slot;
    state.player.usedDonors.push(pl.name);

    if (remainingAttrs().length === 0) { state.phase = "academy"; }
    saveState();
    beginTurn();
  }

  function reroll() {
    if (state.rerolls <= 0) return;
    state.rerolls--;
    document.getElementById("reroll-count").textContent = state.rerolls;
    setBtn("btn-accept", false);
    setBtn("btn-reroll", false);
    const key = state.chosenAttr;
    if (key === "position" || key === "build") {
      state.player.slots[key] = null;
      renderAttrChooser();
      chooseAttr(key);
      renderPreview();
      return;
    }
    state.selectedDonorIdx = null;
    spin();
  }

  function renderPreview() {
    const wrap = document.getElementById("player-preview");
    const slots = state.player.slots;
    const rows = ATTRS.map((cfg) => {
      const s = slots[cfg.key];
      if (!s) return `<div class="prev-row empty"><span>${cfg.name}</span><span>—</span></div>`;
      let val;
      if (cfg.key === "body") val = `${s.value}/${s.value2}`;
      else if (cfg.key === "build") val = `${s.height}cm · ${s.weight}kg`;
      else if (cfg.key === "position") val = (POSITIONS[s.position] || POSITIONS.ST).label;
      else val = s.value;
      return `<div class="prev-row"><span>${cfg.name}</span><span class="prev-val">${val}</span><span class="prev-src">${esc(s.donor)}, ${esc(s.team)} ${s.year}</span></div>`;
    }).join("");
    const acad = state.academy
      ? `<div class="prev-row"><span>Academy</span><span class="prev-val">${state.academy.tier}</span><span class="prev-src">${esc(state.academy.club)}</span></div>`
      : `<div class="prev-row empty"><span>Academy</span><span>—</span></div>`;
    const scout = scoutFeedback(slots);
    wrap.innerHTML = `<h3>Your DNA so far</h3>${rows}${acad}
      <div class="scout-feedback"><strong>Scout report:</strong> ${scout}</div>
      <div class="preview-hint">Every donor you pick secretly nudges your other attributes — trade-offs are real.</div>`;
  }

  function scoutFeedback(slots) {
    const filled = Object.values(slots).filter(Boolean).length;
    if (filled === 0) return "We need a bigger sample size. Start spinning squads to build a profile.";
    const notes = [];
    const pos = slots.position ? slots.position.position : null;
    if (pos === "ST") notes.push("a traditional penalty-box presence");
    else if (pos === "CF") notes.push("a mobile frontman");
    else if (pos === "Winger") notes.push("a wide goal threat");
    else if (pos) notes.push(`a ${(POSITIONS[pos] || POSITIONS.ST).label.toLowerCase()}`);
    const build = slots.build;
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
    const missing = ATTRS.filter((cfg) => !slots[cfg.key]).map((cfg) => cfg.name);
    if (missing.length) notes.push(`still needs ${missing.join(", ")}`);
    if (notes.length === 0) return "Early days — the profile is still forming.";
    return notes.join(" · ") + ".";
  }

  /* ==================== COMPILE: HIDDEN INFLUENCE + SYNERGY ============== */
  function compilePlayer() {
    const slots = state.player.slots;
    const donors = Object.values(slots).map((s) => s.donorObj).filter(Boolean);

    // explicit picks
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
      const source = slots[hostSlotFor(k)].donorObj; // the donor explicitly chosen for this attr
      const others = donors.filter((d) => d !== source);
      const avgOther = others.reduce((s, d) => s + d[k], 0) / (others.length || 1);
      attrs[k] = Math.round(clamp(explicit[k] * (1 - HIDDEN_WEIGHT) + avgOther * HIDDEN_WEIGHT, 40, 99));
    });
    // height/weight come from the rolled build slot
    attrs.height = slots.build.height;
    attrs.weight = slots.build.weight;
    // primary position from the rolled position slot
    state.position = slots.position.position;

    // mentality: trait from the mentality donor; hidden rating nudged by locker-room average
    const mSource = slots.mentality.donorObj;
    const otherRatings = donors.filter((d) => d !== mSource).map((d) => d.mentalityRating);
    const avgMent = otherRatings.reduce((s, r) => s + r, 0) / (otherRatings.length || 1);
    state.mentality = mSource.mentality;
    state.mentalityRating = Math.round(clamp(mSource.mentalityRating * 0.8 + avgMent * 0.2, 15, 99));

    // physical build synergy
    const syn = applyPhysicalSynergy(attrs);
    state.attrs = syn.attrs;
    state.synergyNotes = syn.notes;
    state.derived = deriveStats(syn.attrs);

    state.academyTier = state.academy.tier;
    state.luck = rollLuck();
    state.injuryProneness = calculateInjuryProneness(state.attrs, state.academy.tier, state.luck);
    state.retirementAge = calculateRetirementAge(state.injuryProneness, state.attrs.fitness);
    state.baseRating = calculateStrikerRating(state.attrs);
    state.playstyle = inferPlaystyle(state.attrs);

    // deep synergy scoring — multiplicative modifier on base rating
    const syn2 = computeSynergyMultiplier(state.attrs);
    state.synergyMultiplier = syn2.multiplier;
    state.baseRating = Math.round(clamp(state.baseRating * syn2.multiplier, 40, 99));
    state.synergyNotes = state.synergyNotes.concat(syn2.notes);

    // hidden traits — discovered at creation, based on build + randomness
    state.hiddenTraits = generateHiddenTraits(state.attrs, state);

    // agent roll — shapes wealth, fame, and contract negotiating power
    rollAgent();

    // Determine starting club: if academy is in the league, start there;
    // otherwise generate club offers based on skill
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

  function hostSlotFor(k) {
    if (k === "fitness" || k === "strength") return "body";
    return k; // heading, leftFoot, rightFoot, speed
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
      ? `<div class="traits-block"><h3>Hidden Traits</h3><div class="traits-list">${state.hiddenTraits.map((t) => `<span class="trait-chip" title="${esc(HIDDEN_TRAITS[t].desc)}">${esc(t)}</span>`).join("")}</div></div>`
      : "";
    const radarId = "confirm-radar";
    const radarHtml = `<div class="radar-wrap"><canvas id="${radarId}" width="320" height="240"></canvas></div>`;

    card.innerHTML = `
      <div class="rating-hero">
        <div class="rating-num">${state.baseRating}</div>
        <div class="rating-label">STRIKER RATING</div>
        <div class="playstyle-chip">${state.playstyle}</div>
        <div class="ment-chip ${mentIsSpecial(state.mentality) ? "rare" : ""}">${state.mentality}</div>
        <div class="acad-chip">🎓 ${esc(acad.club)} · ${acad.tier} academy</div>
        <div class="agent-chip">${state.agent.label} agent · Wealth ${state.wealth}</div>
        <div class="longevity-chip">Longevity: ${state.retirementAge} seasons · Durability ${100 - state.injuryProneness}/100</div>
      </div>
      <div class="confirm-body">
        <div class="dna-table">${rows}</div>
        ${radarHtml}
      </div>
      ${traitsHtml}
      <div class="synergy-block"><h3>Synergy Analysis</h3>
        <div class="syn-note ${state.synergyMultiplier >= 1 ? "good" : "bad"}">Synergy Multiplier: <strong>${(state.synergyMultiplier * 100).toFixed(0)}%</strong> ${state.synergyMultiplier >= 1 ? "▲" : "▼"}</div>
        ${synHtml}</div>
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
    const candidates = LEAGUE_CLUBS
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

    showScreen("screen-career");
    log(`🎬 ${state.player.name} begins their career at ${state.club} (${tier} academy). The chase for ${LEVERS.goalTarget} goals starts now.`, "milestone");
    renderCareerHeader();
    renderSeasonReady();
  }

  function ensureClubStat(club) {
    if (!state.clubStats[club]) state.clubStats[club] = { apps: 0, goals: 0, assists: 0, seasons: 0, titles: 0 };
  }

  /* ====================== CAREER SIMULATION ENGINE ====================== */
  function getAgeModifier(age) {
    // Nonlinear curve: slow rise, prime window, gradual decline.
    // Peak at age 27 (~1.08x). After 32 the drop is gentler so veterans stay useful.
    let base;
    if (age <= 20) base = 0.55 + (age - 17) * 0.08;       // 0.55 → 0.79
    else if (age <= 24) base = 0.79 + (age - 21) * 0.06;       // 0.79 → 1.03
    else if (age <= 27) base = 1.03 + (age - 25) * 0.025;      // 1.03 → 1.08 (prime peak)
    else if (age <= 29) base = 1.08 - (age - 27) * 0.03;       // 1.08 → 1.02
    else if (age <= 32) base = 1.02 - (age - 29) * 0.04;       // 1.02 → 0.90
    else base = Math.max(0.45, 0.90 - (age - 32) * 0.05);       // gradual decline: 90 at 33 → 45 at 41

    // Hidden traits tweak the curve
    if (hasTrait("Early Bloomer")) {
      if (age <= 25) base *= 1.06;
      else if (age >= 30) base *= 0.94;
    }
    if (hasTrait("Late Bloomer")) {
      if (age <= 23) base *= 0.94;
      else if (age >= 28) base *= 1.08;
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
    return (fit[playstyle] && fit[playstyle][teamStyle]) || 1.0;
  }
  function getRoleMultiplier(role) {
    return { Star: 1.25, Starter: 1.0, Rotation: 0.7, Bench: 0.4 }[role] || 0.8;
  }
  function getTraitMatchMultiplier(teamStyle) {
    let m = 1;
    if (hasTrait("Speedster") && (teamStyle === "Counter" || teamStyle === "High Press")) m += 0.05;
    if (hasTrait("Aerial Threat") && (teamStyle === "Direct" || teamStyle === "Route One")) m += 0.05;
    if (hasTrait("Powerhouse") && (teamStyle === "Direct" || teamStyle === "Route One")) m += 0.05;
    if (hasTrait("Clinical Finisher") && teamStyle === "Possession") m += 0.04;
    if (hasTrait("Two-Footed")) m += 0.03;
    if (hasTrait("One-Footed Wonder")) m -= 0.03;
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
  function determineRole() {
    const r = agedRating();
    const teamAtk = TEAM_DATABASE[state.club].attack;
    const gap = r - teamAtk;
    let role;
    if (state.age <= 19 && state.academyTier !== "World Class" && state.academyTier !== "Strong")
      role = gap > 6 ? "Starter" : "Rotation";
    else if (gap >= 6) role = "Star";
    else if (gap >= -3) role = "Starter";
    else if (gap >= -10) role = "Rotation";
    else role = "Bench";
    // A powerful agent can negotiate a stronger squad place
    if (state.agent && state.agent.influence >= 0.25) {
      if (role === "Bench") return "Rotation";
      if (role === "Rotation") return "Starter";
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

  function simulateSeason() {
    const club = state.club;
    ensureClubStat(club);
    state.role = determineRole();
    const threat = agedRating();
    const clubData = TEAM_DATABASE[club];
    const table = newTable();
    const fm = formModifier();
    const fitMult = getTacticalFitMultiplier(state.playstyle, clubData.tacticalStyle);
    const roleMult = getRoleMultiplier(state.role);
    const appearanceChance = { Star: 0.97, Starter: 0.9, Rotation: 0.6, Bench: 0.3 }[state.role] || 0.7;
    const mentClutch = mentTag(state.mentality);
    const clutchBonus = ["clutch", "winner", "talisman"].includes(mentClutch) ? state.mentalityRating / 100 : 0;

    // injuries — driven by hidden injury proneness, fitness, age, and playstyle risk
    const fitness = state.attrs.fitness;
    const styleRisk = (PLAYSTYLE_PROFILES[state.playstyle] || {}).injuryRisk || 1;
    let gamesMissed = Math.round((randInt(LEVERS.injuryFreqMin, LEVERS.injuryFreqMax) + state.injuryProneness / 18) * styleRisk) +
      (state.injuryProneSeasons > 0 ? randInt(2, 6) : 0) + (state.age >= 32 ? randInt(1, 4) : 0);
    if (hasTrait("Iron Man")) gamesMissed = Math.max(0, gamesMissed - 4);
    else if (fitness >= 90) gamesMissed = Math.max(0, gamesMissed - 3);
    else if (fitness >= 80) gamesMissed = Math.max(0, gamesMissed - 1);
    if (hasTrait("Injury Prone")) gamesMissed += randInt(2, 5);
    if (["workrate"].includes(mentClutch)) gamesMissed = Math.max(0, gamesMissed - 1);
    gamesMissed = clamp(gamesMissed, 0, 30);

    let leagueGoals = 0, assists = 0, apps = 0, cleanSheets = 0, playerMatch = 0;
    let momentum = 0; // shifts with recent results, from -3 to +3
    let lastResults = [];
    const matchHighlights = [];

    const seasonClubs = getLeagueClubs(club);
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
        share *= fitMult * roleMult * styleMod * getTraitMatchMultiplier(clubData.tacticalStyle) * getPositionTacticalMultiplier(clubData.tacticalStyle) * (1 + (fm + momentum * 3) / 100) * (1 + clutchBonus * 0.12);
        // Big games: top opponents and derbies bring the best out of stars
        if (isTopOpponent || derby) share *= 1.08;
        if (isTitleRace && (state.role === "Star" || state.role === "Starter")) share *= 1.05;
        share = clamp(share, 0.03, 0.78);
        const mine = poissonRandom(myGoals * share * posMod.goal * LEVERS.conversionMultiplier);
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
    const compFactor = { Elite: 0.38, Europe: 0.26, Mid: 0.12, Lower: 0.05, LaLiga: 0.34, SerieA: 0.32, Bundesliga: 0.32 }[clubData.league] || 0.08;
    const cupEuroGoals = poissonRandom(leagueGoals * compFactor);
    const cupApps = Math.round(cupEuroGoals * 1.3) + (apps > 0 ? randInt(2, 6) : 0);
    const seasonGoals = leagueGoals + cupEuroGoals;
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
    state.leagueTable = sorted;

    // season rating (influenced by hidden mentality consistency)
    const mentVar = mentClutch === "volatile" ? randomBetween(-0.6, 0.6) : 0;
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
    adjustReputation(repDelta);

    const seasonData = {
      season: state.season, age: state.age, club, role: state.role,
      goals: seasonGoals, leagueGoals, assists, apps, rating: seasonRating,
      yellow, red, cleanSheets, pos, trajectory, perfTier, gamesMissed,
      champion, honours: honoursThisSeason, awards, isTopScorer,
    };
    state.seasonHistory.push(seasonData);
    return seasonData;
  }

  function calculateInjuryProneness(a, academyTier, luck) {
    const bmi = a.weight / Math.pow(a.height / 100, 2);
    // Ideal durability builds: moderate BMI with strong frame
    let buildScore = 0;
    if (bmi >= 22 && bmi <= 25) buildScore = 8;
    else if (bmi >= 20 && bmi < 22) buildScore = 4;
    else if (bmi > 25 && bmi <= 28) buildScore = 2;
    else buildScore = -2;
    // Extreme heights are harder on the body over a long career
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
  function calculateRetirementAge(injuryProneness, fitness) {
    return Math.round(clamp(36 + (100 - injuryProneness) / 22 + fitness / 45, 34, 42));
  }
  function rollLuck() { return Math.round(randBetween(-8, 8)); }

  function recomputePlayerStats() {
    const syn = applyPhysicalSynergy(state.attrs);
    state.attrs = syn.attrs;
    state.synergyNotes = syn.notes;
    state.derived = deriveStats(state.attrs);
    state.baseRating = calculateStrikerRating(state.attrs);
    const syn2 = computeSynergyMultiplier(state.attrs);
    state.synergyMultiplier = syn2.multiplier;
    state.baseRating = Math.round(clamp(state.baseRating * syn2.multiplier, 40, 99));
    state.synergyNotes = state.synergyNotes.concat(syn2.notes);
    state.playstyle = inferPlaystyle(state.attrs);
    // Recalculate longevity if core physicals changed
    const academyTier = state.academyTier || (state.academy && state.academy.tier);
    if (academyTier && state.luck !== undefined) {
      state.injuryProneness = calculateInjuryProneness(state.attrs, academyTier, state.luck);
      state.retirementAge = calculateRetirementAge(state.injuryProneness, state.attrs.fitness);
    }
  }

  function applySeasonalAttributeChanges(sd) {
    const a = state.attrs;
    const age = state.age;
    const perf = sd.perfTier;

    // Growth phase: young players improve — playstyle and mentality shape the path
    if (age <= 22) {
      let growthPoints = { Sensational: 3, Overperformed: 2, "Met Expectation": 1, Underperformed: 0, Flop: -1 }[perf] || 0;
      if (hasTrait("High Ceiling")) growthPoints += 1;
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

    // Decline phase: older players lose sharpness
    if (age >= 33) {
      const decay = 1 + Math.floor((age - 32) / 2);
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

    // Injuries knock down physical attributes
    if (sd.gamesMissed >= 6) {
      const key = choice(["fitness", "speed", "strength"]);
      a[key] = clamp(a[key] - randInt(2, 4), 40, 99);
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

    recomputePlayerStats();
  }

  function trajectoryFromPos(pos) {
    if (pos === 1) return "Title";
    if (pos <= 6) return "Europe";
    if (pos <= 14) return "Mid-table";
    if (pos <= 17) return "Battled Relegation";
    return "Relegated";
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
  function simulateInternational() {
    if (!state.intlDebut && state.reputation >= 45) {
      state.intlDebut = true;
      log(`🦁 ${state.player.name} earns a first England call-up!`, "intl");
    }
    if (!state.intlDebut) return null;
    const isTournament = state.season % 2 === 0;
    const games = isTournament ? randInt(5, 7) : randInt(4, 6);
    let g = 0;
    for (let i = 0; i < games; i++) {
      const opp = { attack: randInt(72, 88), midfield: randInt(72, 86), defence: randInt(72, 88), manager: randInt(74, 86), tacticalStyle: choice(["Possession", "Counter", "High Press", "Direct"]), homeAdvantage: 4 };
      const res = simulateMatch(NATIONAL_TEAM, opp, 0, 0);
      const teammateThreat = NATIONAL_TEAM.attack * 4;
      const share = clamp(agedRating() / (agedRating() + teammateThreat), 0.03, 0.42);
      g += poissonRandom(res.homeGoals * share * 0.85);
    }
    state.intlCaps += games;
    state.intlGoals += g;
    state.totalGoals += g;
    let wonTrophy = false;
    if (isTournament && (g >= 3 || rand() < 0.15) && state.reputation >= 60) {
      wonTrophy = true;
      state.honours.intlTrophies++;
      state.competitionHistory.push({ season: state.season, club: "England", text: `🦁 Won an international tournament with England (${g} goals)` });
      adjustReputation(8);
      log(`🏆 Tournament glory! ${state.player.name} lifts silverware with England (${g} goals).`, "intl");
    }
    return { games, goals: g, isTournament, wonTrophy };
  }

  /* ------------------------- DECISION ENGINE ---------------------------- */
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
    { id: "world_cup_call", category: "INTERNATIONAL", base: 4, req: { repMin: 50, ageMin: 20, ageMax: 34 },
      text: (n) => `${n} is called up for a major international tournament.`,
      choices: [
        { label: "Give everything for the country", fx: { rep: 5, intlCaps: 1, intlGoals: () => randInt(0, 2), flag: "inForm" } },
        { label: "Focus on club fitness", fx: { rep: -2 } },
      ] },
    { id: "international_captain", category: "INTERNATIONAL", base: 3, req: { repMin: 70, ageMin: 26, intlCaps: 5 },
      text: (n) => `${n} is named national team captain.`,
      choices: [
        { label: "Lead with pride", fx: { rep: 8, fame: 6, flag: "fanFavorite", setIntlCaptain: true } },
        { label: "Share the armband", fx: { rep: 3 } },
      ] },
    { id: "international_retirement", category: "INTERNATIONAL", base: 3, req: { ageMin: 32, intlCaps: 10 },
      text: (n) => `${n} is asked to retire from international duty to prolong club form.`,
      choices: [
        { label: "Retire from internationals", fx: { attrChange: { key: "fitness", delta: 2 }, rep: -2 } },
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

  const FLAG_DEFAULT_DURATION = 2;
  const EVENT_REWARD_MULTIPLIER = 1.7; // events are rarer now, so each one should pack a bigger punch

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
    return true;
  }
  function getEventWeight(ev, ctx) {
    if (!meetsHardRequirements(ev, ctx)) return 0;
    if (state.cooldowns[ev.id] > 0) return 0;
    let w = ev.base * 0.65; // events are intentionally rarer now
    if (ctx.flags.mediaTarget && ev.category === "MEDIA") w += 4;
    if (ctx.flags.managerConflict && ev.id === "manager_sacked") w += 6;
    if (ctx.flags.injuryProne && ev.category === "INJURY") w += 6;
    // Age dramatically increases injury risk
    if (ev.category === "INJURY") {
      if (ctx.age >= 32) w += 3;
      if (ctx.age >= 35) w += 5;
      if (ctx.age >= 38) w += 8;
    }
    // Wealth and fame unlock rare, high-profile events
    if (ev.rare) {
      const fame = (state.fame || 0) + (state.wealth || 0) / 4;
      w += fame / 15;
    }
    // Agent-related events are more frequent with a powerful agent
    if (ev.category === "AGENT" && state.agent) {
      w += state.agent.influence * 10;
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
        return { id: "milestone_" + m.goals, milestone: true, category: "MILESTONE",
          text: () => `🏅 MILESTONE: ${state.totalGoals} career goals — "${m.title}"!`,
          choices: [{ label: "Onwards", fx: { rep: m.goals >= 500 ? 6 : 3 } }] };
      }
    }
    return null;
  }
  function pickSeasonEvent(ctx) {
    const eligible = EVENTS.map((e) => ({ item: e, weight: getEventWeight(e, ctx) })).filter((e) => e.weight > 0);
    if (!eligible.length) return null;
    return weightedRandomPick(eligible);
  }

  function isMidCareer() {
    return state.season >= 3 && state.age >= 21 && state.age <= 33;
  }
  function determineEventCount() {
    // Fewer events overall, but each one should carry more weight
    if (state.age >= 30) {
      const roll = rand();
      if (roll < 0.10) return 3;
      if (roll < 0.45) return 2;
      return 1;
    }
    if (isMidCareer()) {
      const roll = rand();
      if (roll < 0.15) return 2;
      if (roll < 0.55) return 1;
      return 0;
    }
    return 0;
  }
  function pickSeasonEvents(ctx, count) {
    const events = [];
    const milestone = checkMilestoneInterrupt();
    if (milestone) events.push(milestone);
    for (let i = 0; i < count; i++) {
      const ev = pickSeasonEvent(ctx);
      if (!ev) break;
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
  }
  function applyEffectsRaw(fx, multiplier = 1) {
    if (!fx) return;
    if (fx.rep) adjustReputation(Math.round(fx.rep * multiplier));
    if (fx.goals) { const g = Math.round((typeof fx.goals === "function" ? fx.goals() : fx.goals) * multiplier); state.totalGoals += g; if (state.seasonHistory.length) state.seasonHistory[state.seasonHistory.length - 1].goals += g; }
    if (fx.assists) { const a = Math.round((typeof fx.assists === "function" ? fx.assists() : fx.assists) * multiplier); state.totalAssists += a; }
    if (fx.flag) setFlag(fx.flag, FLAG_DEFAULT_DURATION);
    if (fx.injuryProne) state.injuryProneSeasons = Math.max(state.injuryProneSeasons, fx.injuryProne);
    if (fx.ratingBoost) state.baseRating = clamp(state.baseRating + Math.round(fx.ratingBoost * multiplier), 40, 99);
    if (fx.forceTransfer) state.pendingTransfer = true;
    if (fx.attrChange) {
      const { key, delta } = fx.attrChange;
      state.attrs[key] = clamp(state.attrs[key] + Math.round(delta * multiplier), 40, 99);
    }
    if (fx.mentalityChange) {
      state.mentalityRating = clamp(state.mentalityRating + Math.round(fx.mentalityChange * multiplier), 15, 99);
    }
    if (fx.positionChange) {
      state.position = fx.positionChange;
    }
    if (fx.contract) {
      state.contractYears += Math.round(fx.contract * multiplier);
    }
    if (fx.wealth) {
      state.wealth = clamp(state.wealth + Math.round(fx.wealth * multiplier), 0, 100);
    }
    if (fx.fame) {
      state.fame = clamp(state.fame + Math.round(fx.fame * multiplier), 0, 100);
    }
    if (fx.agent) {
      state.agent = fx.agent;
    }
    if (fx.intlCaps) {
      state.intlCaps += fx.intlCaps;
    }
    if (fx.intlGoals) {
      const g = Math.round((typeof fx.intlGoals === "function" ? fx.intlGoals() : fx.intlGoals) * multiplier);
      state.intlGoals += g;
    }
    if (fx.retireNow) {
      state.retireNow = true;
    }
    if (fx.setIntlCaptain) {
      state.intlCaptain = true;
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
  function generateOffers() {
    const tierByRep = state.reputation >= 80 ? ["Elite", "Europe"] :
      state.reputation >= 60 ? ["Elite", "Europe", "Mid"] :
      state.reputation >= 40 ? ["Europe", "Mid"] : ["Mid", "Lower"];
    const pool = LEAGUE_CLUBS.filter((t) => t !== state.club && tierByRep.includes(TEAM_DATABASE[t].league));
    const n = clamp(randInt(1, 3), 1, pool.length);
    const offers = [], used = new Set();
    while (offers.length < n && offers.length < pool.length) {
      const c = choice(pool);
      if (used.has(c)) continue;
      used.add(c); offers.push(c);
    }
    return offers;
  }

  /* ------------------------------ SEASON FLOW --------------------------- */
  function renderCareerStats() {
    const el = document.getElementById("career-stats-content");
    if (!el) return;
    const h = state.honours;
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
    const radarId = "career-radar";
    el.innerHTML = `
      <div class="career-stats-grid">
        <div class="cs-box"><div class="cs-num">${state.totalGoals}</div><div class="cs-lab">Goals</div></div>
        <div class="cs-box"><div class="cs-num">${state.totalApps}</div><div class="cs-lab">Apps</div></div>
        <div class="cs-box"><div class="cs-num">${state.totalAssists}</div><div class="cs-lab">Assists</div></div>
        <div class="cs-box"><div class="cs-num">${state.leagueGoals}</div><div class="cs-lab">League</div></div>
        <div class="cs-box"><div class="cs-num">${state.teamCleanSheets}</div><div class="cs-lab">Clean Sheets</div></div>
        <div class="cs-box"><div class="cs-num">${state.totalYellow}/${state.totalRed}</div><div class="cs-lab">Y/R</div></div>
      </div>
      <div class="cs-radar"><canvas id="${radarId}" width="240" height="180"></canvas></div>
      <div class="cs-section-title">Trophies</div>${trophyHtml}
      <div class="cs-section-title">Awards</div>${awardsHtml}
      <div class="cs-section-title">International</div>${intlHtml}`;
    requestAnimationFrame(() => {
      const canvas = document.getElementById(radarId);
      if (canvas && state.attrs) drawRadarChart(canvas, state.attrs);
    });
  }

  function renderCareerHeader() {
    document.getElementById("career-season").textContent = `SEASON ${state.season}`;
    document.getElementById("hdr-age").textContent = state.age;
    document.getElementById("hdr-goals").textContent = state.totalGoals;
    document.getElementById("hdr-club").textContent = state.club;
    const pos = POSITIONS[state.position] || POSITIONS.ST;
    document.getElementById("hdr-position").innerHTML = `${pos.label} <span class="career-pos">${state.position}</span>`;
    document.getElementById("hdr-contract").innerHTML = `${state.contractYears}yr <span class="career-contract">${state.contractSignedAt ? "S" + state.contractSignedAt : "new"}</span>`;
    document.getElementById("hdr-rep").textContent = `${state.reputationTier} (${state.reputation})`;
    const agent = state.agent || { label: "—" };
    document.getElementById("hdr-agent").textContent = agent.label;
    document.getElementById("hdr-wealth").textContent = state.wealth;
    const pct = clamp((state.totalGoals / LEVERS.goalTarget) * 100, 0, 100);
    document.getElementById("goal-progress-fill").style.width = pct + "%";
    document.getElementById("goal-progress-label").textContent = `${state.totalGoals} / ${LEVERS.goalTarget} career goals`;
    renderCareerStats();
  }

  function renderSeasonReady() {
    const box = document.getElementById("season-action");
    const pos = POSITIONS[state.position] || POSITIONS.ST;
    box.innerHTML = `
      <div class="season-prompt">Age ${state.age} · ${state.club} · ${pos.label} · projected role: <strong>${determineRole()}</strong> · ${ageBracket(state.age)}</div>
      <button class="btn primary big" id="btn-play-season">▶ PLAY SEASON ${state.season}</button>`;
    document.getElementById("btn-play-season").addEventListener("click", playSeason);
  }

  function playSeason() {
    document.getElementById("season-action").innerHTML = `<div class="simming">Simulating season ${state.season}…</div>`;
    setTimeout(() => {
      applyPendingCarryOver(); // delayed effects from previous season decisions
      if (state.retireNow) { state.retireNow = false; beginRetirement("injury"); return; }
      const sd = simulateSeason();
      const intl = simulateInternational();
      renderSeasonResult(sd, intl);
      renderCareerHeader();
      let line = `S${state.season} (age ${state.age}) — ${state.club}: ${sd.goals}g ${sd.assists}a in ${sd.apps} apps (${sd.rating}). ${ordinal(sd.pos)} [${sd.trajectory}]. ${sd.role}.`;
      if (sd.honours.length) line += ` 🏆 ${sd.honours.join(", ")}.`;
      if (sd.awards.length) line += ` 🎖 ${sd.awards.join(", ")}.`;
      if (intl && intl.goals) line += ` 🦁 +${intl.goals} for England.`;
      log(line, perfClass(sd.perfTier));

      const ctx = buildContext(sd);
      const eventCount = determineEventCount();
      const events = pickSeasonEvents(ctx, eventCount);
      if (events.length > 0) presentEventQueue(events, 0, sd, intl); else proceedToTransfer(sd, intl);
    }, 400);
  }

  function renderSeasonResult(sd, intl) {
    const box = document.getElementById("season-result");
    const intlHtml = intl ? `<div class="stat-box"><div class="sb-num">${intl.goals}</div><div class="sb-lab">England</div></div>` : "";
    const honoursHtml = (sd.honours.length || sd.awards.length)
      ? `<div class="season-honours">${sd.honours.map((h) => `<span class="hon-badge title">🏆 ${h}</span>`).join("")}${sd.awards.map((a) => `<span class="hon-badge award">🎖 ${a}</span>`).join("")}</div>` : "";
    box.innerHTML = `
      <div class="result-banner ${perfClass(sd.perfTier)}">${sd.perfTier} season — finished ${ordinal(sd.pos)} (${sd.trajectory})${sd.champion === state.club ? " 🏆" : ""}</div>
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
    const rows = state.leagueTable.map((r, i) => {
      const gd = r.GF - r.GA;
      const zone = i === 0 ? "champ" : i <= 3 ? "ucl" : i <= 5 ? "uel" : i >= 17 ? "releg" : "";
      const mine = r.team === state.club ? "mine" : "";
      return `<tr class="${zone} ${mine}"><td>${i + 1}</td><td class="lt-team">${esc(r.team)}</td><td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td><td>${r.GF}</td><td>${r.GA}</td><td>${gd > 0 ? "+" : ""}${gd}</td><td class="lt-pts">${r.Pts}</td></tr>`;
    }).join("");
    return `
      <details class="league-details"><summary>Final League Table — ${ordinal(sd.pos)}</summary>
      <table class="league-table"><thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
      <tbody>${rows}</tbody></table></details>`;
  }

  function presentEventQueue(events, idx, sd, intl) {
    const ev = events[idx];
    const box = document.getElementById("season-action");
    const name = state.player.name;
    const text = typeof ev.text === "function" ? ev.text(name) : ev.text;
    const eventNum = events.length > 1 ? ` (${idx + 1}/${events.length})` : "";
    const choicesHtml = ev.choices.map((c, i) => `<button class="btn choice" data-i="${i}">${c.label}</button>`).join("");
    box.innerHTML = `
      <div class="decision ${ev.milestone ? "milestone-event" : ""}">
        <div class="decision-tag">${ev.milestone ? "MILESTONE" : ev.category} EVENT${eventNum}</div>
        <div class="decision-text">${text}</div>
        <div class="decision-choices">${choicesHtml}</div>
      </div>`;
    box.querySelectorAll(".choice").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = ev.choices[parseInt(btn.dataset.i, 10)];
        applyEffects(c.fx, ev.milestone ? 1 : EVENT_REWARD_MULTIPLIER);
        log(`   ↳ ${ev.milestone ? "🏅" : "🗲"} ${text.replace(/\.$/, "")} → "${c.label}"`, "decision");
        renderCareerHeader();
        saveState();
        if (state.retireNow) { state.retireNow = false; beginRetirement("injury"); return; }
        if (idx + 1 < events.length) presentEventQueue(events, idx + 1, sd, intl);
        else proceedToTransfer(sd, intl);
      });
    });
  }

  function proceedToTransfer(sd, intl) {
    if (state.totalGoals >= LEVERS.goalTarget) { beginRetirement("goal"); return; }
    applySeasonalAttributeChanges(sd);
    state.yearsAtClub++;
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
    if (clubSells) presentTransfer(generateOffers(), sd, intl, true);
    else if (wantsMove && !loyalStay) presentTransfer(generateOffers(), sd, intl, false);
    else handleContractPhase(sd, intl);
  }

  function handleContractPhase(sd, intl) {
    // Contract countdown; when it hits 0, force negotiation before next season
    state.contractYears--;
    if (state.contractYears <= 0) {
      presentContractNegotiation(sd, intl);
      return;
    }
    advanceToNextSeason();
  }

  function shouldClubTransferOut(sd) {
    const clubData = TEAM_DATABASE[state.club];
    // Young talent poached by bigger clubs
    if (state.age <= 21 && state.reputation >= 50 && ["Star", "Starter"].includes(state.role) && clubData.league !== "Elite" && rand() < 0.45) return true;
    // Aging star offloaded after a bad season
    if (state.age >= 31 && sd.perfTier === "Flop" && rand() < 0.4) return true;
    // Star too big for a lower-tier club
    if (state.reputation >= 70 && clubData.league === "Lower" && rand() < 0.5) return true;
    // Club rebuilds after relegation
    if (sd.trajectory === "Relegated" && state.role === "Star" && rand() < 0.4) return true;
    // Board cashes in on overperforming journeyman
    if (hasTrait("Journeyman") && state.reputation >= 60 && state.yearsAtClub >= 2 && rand() < 0.35) return true;
    return false;
  }

  function presentTransfer(offers, sd, intl, forced, newContractYears) {
    const box = document.getElementById("season-action");
    const isContractOffer = newContractYears != null && newContractYears > 0;
    const contractLine = isContractOffer ? `<div class="offer-contract">${newContractYears}-year deal offered</div>` : "";
    const cards = offers.map((o, i) => {
      const t = TEAM_DATABASE[o];
      return `<button class="btn offer" data-i="${i}"><div class="offer-club">${o}</div><div class="offer-meta">${t.league} · ATK ${t.attack} MID ${t.midfield} DEF ${t.defence} · ${t.tacticalStyle}</div>${contractLine}</button>`;
    }).join("");
    const text = forced
      ? `The board has accepted an offer for ${state.player.name}. Unless you force a stay, you're on the move.`
      : isContractOffer
        ? `Clubs want you on a free. Each offer below comes with a ${newContractYears}-year contract.`
        : `Offers are on the table${state.pendingTransfer ? " — and you've pushed to leave." : "."} Where next?`;
    const stayBtn = isContractOffer
      ? `<button class="btn ghost" id="btn-stay">Retire instead</button>`
      : forced
        ? `<button class="btn ghost" id="btn-stay">Refuse all offers — force a stay</button>`
        : `<button class="btn ghost" id="btn-stay">Stay at ${state.club}</button>`;
    box.innerHTML = `
      <div class="transfer">
        <div class="decision-tag">${forced ? "CLUB FORCES TRANSFER" : isContractOffer ? "FREE AGENT OFFERS" : "TRANSFER WINDOW"}</div>
        <div class="decision-text">${text}</div>
        <div class="offers">${cards}</div>
        ${stayBtn}
      </div>`;
    box.querySelectorAll(".offer").forEach((btn) => {
      btn.addEventListener("click", () => {
        const newClub = offers[parseInt(btn.dataset.i, 10)];
        moveToClub(newClub);
        if (isContractOffer) {
          signAndAdvance(newContractYears, sd, intl, `Signed a ${newContractYears}-year deal with ${state.club}.`);
        } else {
          handleContractPhase(sd, intl);
        }
      });
    });
    document.getElementById("btn-stay").addEventListener("click", () => {
      if (isContractOffer) {
        log(`   ↳ ${state.player.name} turns down the offers and hangs up the boots.`, "decision");
        beginRetirement("planned");
      } else {
        state.pendingTransfer = false;
        log(`   ↳ ✋ ${state.player.name} snubs the offers and stays at ${state.club}.`, "decision");
        handleContractPhase(sd, intl);
      }
    });
  }

  function moveToClub(club) {
    log(`   ↳ ✈️ Transfer: ${state.player.name} joins ${club} (${TEAM_DATABASE[club].league}).`, "transfer");
    state.club = club; state.clubsPlayed.add(club); ensureClubStat(club);
    state.yearsAtClub = 0; state.pendingTransfer = false;
  }

  function advanceToNextSeason() {
    decayFlags();
    if (state.injuryProneSeasons > 0) state.injuryProneSeasons--;
    if (state.finalSeasonForced) { beginRetirement("planned"); return; }
    state.age++; state.season++;
    const ra = state.retirementAge || 40;
    let retireChance = 0;
    if (state.age >= ra) retireChance = 1;
    else if (state.age >= ra - 2) retireChance = 0.35 + (state.age - (ra - 2)) * 0.25;
    else if (state.age >= ra - 4) retireChance = 0.10;
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

  function signContract(years) {
    state.contractYears = years;
    state.contractSignedAt = state.season;
    const fx = { rep: 0, attrChange: null, injuryProne: 0 };
    if (years === 1) fx.rep = 3;
    else if (years === 2) fx.rep = 1;
    else if (years === 4) fx.rep = state.age >= 32 ? -2 : 1;
    else if (years === 5) {
      fx.rep = state.age >= 32 ? -4 : 2;
      if (state.age >= 32) fx.injuryProne = 1;
      if (state.age >= 34) fx.attrChange = { key: "fitness", delta: -2 };
    }
    applyEffectsRaw(fx);
    if (fx.attrChange) recomputePlayerStats();
  }

  /* ------------------- CLUB-DRIVEN CONTRACT NEGOTIATION ------------------- */
  function computeClubContractOffer(sd) {
    const age = state.age;
    const perf = sd.perfTier || "Average";
    const rep = state.reputation;
    const injuryProne = state.injuryProneSeasons > 0;

    let baseYears;
    if (age <= 24) baseYears = 4;
    else if (age <= 28) baseYears = 3;
    else if (age <= 32) baseYears = 2;
    else if (age <= 36) baseYears = 1;
    else baseYears = 1;

    let perfMod = 0;
    if (perf === "Elite") perfMod = 1;
    else if (perf === "Great") perfMod = 0;
    else if (perf === "Good") perfMod = 0;
    else if (perf === "Average") perfMod = -1;
    else if (perf === "Flop") perfMod = -2;

    let repMod = 0;
    if (rep >= 80) repMod = 1;
    else if (rep < 30) repMod = -1;

    let agentBonus = state.agent ? state.agent.contractBonus : 0;
    let offerYears = clamp(baseYears + perfMod + repMod + agentBonus, 1, 5);
    let maxYears = clamp(offerYears + 1 + agentBonus, 1, 5);

    // Refusal conditions — club may simply not offer a new deal
    let refused = false;
    if (age >= 38) refused = true;
    if (age >= 37 && rep < 30) refused = true;
    if (age >= 35 && perf === "Flop") refused = true;
    if (age >= 34 && injuryProne && perf === "Flop") refused = true;
    if (age >= 33 && rep < 25 && perf === "Flop") refused = true;

    if (refused) return { years: 0, maxYears: 0, refused: true };
    return { years: offerYears, maxYears, refused: false };
  }

  function clubWillAcceptYears(requestedYears, maxYears, sd) {
    if (requestedYears <= maxYears) return { accept: true };

    const age = state.age;
    const perf = sd.perfTier || "Average";
    const rep = state.reputation;
    const overAsk = requestedYears - maxYears;

    let chance = 0;
    if (perf === "Elite") chance = 0.5;
    else if (perf === "Great") chance = 0.3;
    else if (perf === "Good") chance = 0.15;
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

    const plusOneDisabled = plusOne <= offer.years ? "disabled" : "";
    const plusTwoDisabled = plusTwo <= offer.years ? "disabled" : "";

    box.innerHTML = `
      <div class="decision milestone-event">
        <div class="decision-tag">CONTRACT OFFER</div>
        <div class="decision-text">${text}</div>
        <div class="contract-offer">
          <div class="contract-club">${esc(state.club)}</div>
          <div class="contract-terms">${offer.years}-year contract</div>
          <div class="contract-meta">Age ${state.age} · Rating ${state.baseRating} · Rep ${state.reputation} · ${sd.perfTier} season</div>
        </div>
        <div class="decision-choices">
          <button class="btn primary choice" id="btn-accept-offer">Accept ${offer.years}-year deal</button>
          <button class="btn choice" id="btn-ask-plus-one" ${plusOneDisabled}>Ask for ${plusOne} years</button>
          <button class="btn choice" id="btn-ask-plus-two" ${plusTwoDisabled}>Ask for ${plusTwo} years</button>
          <button class="btn ghost choice" id="btn-reject-offer">Reject & test the market</button>
          <button class="btn ghost choice" id="btn-retire-offer">Retire</button>
        </div>
      </div>`;

    document.getElementById("btn-accept-offer").addEventListener("click", () => signAndAdvance(offer.years, sd, intl));
    document.getElementById("btn-ask-plus-one").addEventListener("click", () => handleAskForYears(plusOne, offer, sd, intl));
    document.getElementById("btn-ask-plus-two").addEventListener("click", () => handleAskForYears(plusTwo, offer, sd, intl));
    document.getElementById("btn-reject-offer").addEventListener("click", () => rejectContractAndTransfer(sd, intl));
    document.getElementById("btn-retire-offer").addEventListener("click", () => beginRetirement("planned"));
  }

  function handleAskForYears(requestedYears, offer, sd, intl) {
    const result = clubWillAcceptYears(requestedYears, offer.maxYears, sd);
    if (result.accept) {
      signAndAdvance(requestedYears, sd, intl, `Club accepted the request for ${requestedYears} years.`);
    } else if (result.counter > 0) {
      renderContractCounter(result.counter, sd, intl);
    } else {
      clubRefusesContract(sd, intl);
    }
  }

  function renderContractCounter(counterYears, sd, intl) {
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
    document.getElementById("btn-accept-counter").addEventListener("click", () => signAndAdvance(counterYears, sd, intl));
    document.getElementById("btn-reject-counter").addEventListener("click", () => rejectContractAndTransfer(sd, intl));
    document.getElementById("btn-retire-counter").addEventListener("click", () => beginRetirement("planned"));
  }

  function signAndAdvance(years, sd, intl, message) {
    signContract(years);
    log(message ? `   ↳ ✍️ ${message}` : `   ↳ ✍️ Signed a ${years}-year contract at ${state.club}.`, "milestone");
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
    const rawOffers = generateOffers();
    if (rawOffers.length === 0) {
      log(`   ↳ No club wants ${state.player.name}. The phone stops ringing.`, "decision");
      beginRetirement("unwanted");
      return;
    }
    const offer = computeClubContractOffer(sd);
    if (offer.refused) {
      log(`   ↳ Clubs are interested, but none will commit to a contract for ${state.player.name}.`, "decision");
      beginRetirement("unwanted");
    } else {
      presentTransfer(rawOffers, sd, intl, false, offer.years);
    }
  }

  /* --------------------- END-OF-CAREER EVENTS --------------------------- */
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
  ];

  function beginRetirement(reason) {
    state.endCareerReason = reason;
    // reached the 1000-goal target -> celebrate straight to legacy
    if (reason === "goal" || state.totalGoals >= LEVERS.goalTarget) { endCareer(true); return; }
    const eligible = END_EVENTS.filter((e) => !e.req || e.req(state)).map((e) => ({ item: e, weight: e.base }));
    const ev = weightedRandomPick(eligible) || END_EVENTS[0];
    presentEndEvent(ev);
    saveState();
  }

  function presentEndEvent(ev) {
    const box = document.getElementById("season-action");
    document.getElementById("season-result").innerHTML = "";
    const text = typeof ev.text === "function" ? ev.text(state.player.name) : ev.text;
    const choicesHtml = ev.choices.map((c, i) => `<button class="btn choice" data-i="${i}">${c.label}</button>`).join("");
    box.innerHTML = `
      <div class="decision endcareer">
        <div class="decision-tag">END OF CAREER</div>
        <div class="decision-text">${text}</div>
        <div class="decision-choices">${choicesHtml}</div>
      </div>`;
    box.querySelectorAll(".choice").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = ev.choices[parseInt(btn.dataset.i, 10)];
        handleEndChoice(c.fx, text, c.label);
      });
    });
  }

  function handleEndChoice(fx, text, label) {
    fx = fx || {};
    log(`   ↳ 🎬 ${text.replace(/\.$/, "")} → "${label}"`, "milestone");
    // Apply standard numeric effects (goals, assists, rep, fame, wealth) directly — end-of-career events are not subject to the seasonal reward multiplier
    applyEffects(fx, 1);
    if (fx.trophy) {
      state.honours.domesticCups++;
      state.competitionHistory.push({ season: state.season, club: state.club, text: `🏆 Lifted a final trophy in a farewell season` });
    }
    if (fx.extend || fx.returnHome) {
      if (fx.returnHome) {
        const formers = [...state.clubsPlayed].filter((c) => c !== state.club && TEAM_DATABASE[c]);
        if (formers.length) moveToClub(choice(formers));
      }
      state.finalSeasonForced = true;
      state.age++; state.season++;
      renderCareerHeader();
      document.getElementById("season-result").innerHTML = "";
      renderSeasonReady();
      saveState();
      return;
    }
    if (fx.epilogue) state.epilogue = fx.epilogue;
    endCareer(false);
  }

  /* ----------------------------- LEGACY --------------------------------- */
  function endCareer(reachedGoal) {
    state.retired = true;
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
      ["Apps", state.totalApps], ["Assists", state.totalAssists], ["League Goals", state.leagueGoals],
      ["Yellow/Red", `${state.totalYellow}/${state.totalRed}`],
      ["England Caps", state.intlCaps], ["England Goals", state.intlGoals],
      ["Best Rating", state.bestRating || "—"], ["Peak Rep", `${state.reputationTier}`],
    ].map(([k, v]) => `<div class="leg-box"><div class="leg-num">${v}</div><div class="leg-lab">${k}</div></div>`).join("");

    renderHonours();
    renderClubBreakdown();
    renderCompetitionHistory();
    renderEpilogue();
    renderLegacyDNA();
    saveState();
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
      <table class="league-table clubs-table"><thead><tr><th>Club</th><th>Sea</th><th>Apps</th><th>Goals</th><th>Ast</th><th>🏆</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
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
    };
    const reasonMap = {
      age: "Retired gracefully with age catching up.",
      planned: "Bowed out after a planned farewell season.",
      goal: "Retired the moment the 1000-goal dream was realised.",
    };
    const parts = [];
    if (state.endCareerReason && reasonMap[state.endCareerReason]) parts.push(reasonMap[state.endCareerReason]);
    if (state.epilogue && map[state.epilogue]) parts.push(map[state.epilogue]);
    el.innerHTML = parts.length ? `<div class="epilogue">${parts.map((p) => `<div>${p}</div>`).join("")}</div>` : "";
  }

  function renderLegacyDNA() {
    const a = state.attrs;
    const traitsHtml = state.hiddenTraits.length
      ? `<div class="traits-list" style="margin-bottom:12px;">${state.hiddenTraits.map((t) => `<span class="trait-chip" title="${esc(HIDDEN_TRAITS[t].desc)}">${esc(t)}</span>`).join("")}</div>`
      : "";
    const radarId = "legacy-radar";
    const pos = POSITIONS[state.position] || POSITIONS.ST;
    document.getElementById("legacy-dna").innerHTML = `
      <h3>Player DNA</h3>
      <div class="dna-summary">
        <span class="tag">${pos.label}</span>
        <span class="tag">${state.playstyle}</span>
        <span class="tag ${mentIsSpecial(state.mentality) ? "rare" : ""}">${state.mentality}</span>
        <span class="tag">🎓 ${esc(state.academy.club)} (${state.academy.tier})</span>
        <span class="tag">Peak ${state.baseRating}</span>
      </div>
      ${traitsHtml}
      <div class="legacy-radar"><canvas id="${radarId}" width="340" height="260"></canvas></div>
      <div class="dna-key">
        ${dnaLine("Heading", a.heading)}${dnaLine("Left Foot", a.leftFoot)}${dnaLine("Right Foot", a.rightFoot)}
        ${dnaLine("Speed", a.speed)}${dnaLine("Strength", a.strength)}${dnaLine("Fitness", a.fitness)}
        ${dnaLine("Height", a.height + "cm")}${dnaLine("Weight", a.weight + "kg")}
      </div>`;
    function dnaLine(label, v) { return `<div class="dna-row"><span class="dna-k">${label}</span><span class="dna-v">${v}</span></div>`; }
    requestAnimationFrame(() => {
      const canvas = document.getElementById(radarId);
      if (canvas) drawRadarChart(canvas, a);
    });
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
    document.getElementById("btn-start").addEventListener("click", () => showScreen("screen-difficulty"));
    document.querySelectorAll(".btn-difficulty").forEach((b) =>
      b.addEventListener("click", () => startCreation(b.dataset.difficulty)));
    if (hasSave()) {
      document.getElementById("continue-box").style.display = "block";
      document.getElementById("btn-continue").addEventListener("click", resumeGame);
    }
    document.getElementById("btn-spin").addEventListener("click", spin);
    document.getElementById("btn-accept").addEventListener("click", accept);
    document.getElementById("btn-reroll").addEventListener("click", reroll);
    document.getElementById("btn-confirm-career").addEventListener("click", startCareer);
    document.querySelectorAll(".btn-play-again").forEach((b) => b.addEventListener("click", () => {
      clearSave();
      document.getElementById("career-log").innerHTML = "";
      document.getElementById("season-result").innerHTML = "";
      document.getElementById("continue-box").style.display = "none";
      showScreen("screen-welcome");
    }));
    wireAccount();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  function resolveEndOfCareerEvent() {
    if (state.totalGoals >= LEVERS.goalTarget) return { extended: false, event: "goal_target" };
    const eligible = END_EVENTS.filter((e) => !e.req || e.req(state)).map((e) => ({ item: e, weight: e.base }));
    if (!eligible.length) return { extended: false, event: "none" };
    const ev = weightedRandomPick(eligible);
    const c = weightedRandomPick(ev.choices.map((ch) => ({ item: ch, weight: 1 })));
    handleEndChoice(c.fx, ev.text(state.player.name), c.label);
    if (c.fx && (c.fx.extend || c.fx.returnHome)) return { extended: true, event: ev.id };
    return { extended: false, event: ev.id };
  }

  // DEBUG expose for stress testing
  window.__STRESS_TEST__ = {
    startCreation, compilePlayer, simulateSeason, applySeasonalAttributeChanges,
    recomputePlayerStats, getState: () => state, setState: (s) => { state = s; },
    LEAGUE_CLUBS, FOREIGN_LEAGUES, TEAM_DATABASE, resolveEndOfCareerEvent
  };
})();
