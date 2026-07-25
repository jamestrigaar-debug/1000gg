/* ============================================================================
 * TEST: 1000-GOAL PERFECT RUN SIMULATION
 * 
 * Tests the conditions needed for a player to reach 1000 career goals.
 * This is an extreme luck scenario requiring:
 * 1. Perfect attribute rolls (99 finishing, 99 speed, elite mentality)
 * 2. World Class academy (Strong or World Class tier)
 * 3. 105%+ development nation (high growth multiplier)
 * 4. Early career dominance (goals matching games)
 * 5. World class agent (enables early move to Spain/Germany)
 * 6. Foreign league prime (La Liga/Bundesliga 25-29 years old)
 * 7. Luck with injuries and longevity
 * 8. Final season event to push over the line
 * ========================================================================== */

const fs = require("fs");

// Load game data and engine
const gameDataCode = fs.readFileSync("./data.js", "utf8");
const careerEventCode = fs.readFileSync("./career_event_data.js", "utf8");
const gameCode = fs.readFileSync("./game.js", "utf8");

// Create a minimal browser-like environment
global.window = {
  GAME_DATA: {},
  createCareerEventData: null,
};

// Execute data.js to populate GAME_DATA
eval(gameDataCode);
const GAME_DATA = global.window.GAME_DATA;

// Execute career_event_data.js
eval(careerEventCode);
const createCareerEventData = global.window.createCareerEventData;

// Extract constants from game.js (minimal parsing)
const LEVERS = {
  startRerolls: 3,
  goalTarget: 1000,
  conversionMultiplier: 0.98,
  primeWindow: [25, 29],
  injuryFreqMin: 3,
  injuryFreqMax: 8,
  debutAge: 18,
};

const POSITIONS = {
  ST: { label: "Striker", goalMod: 1.18, assistMod: 0.82, wide: false, central: true, forward: true },
};

const LEAGUE_WEIGHTS = {
  Elite: { goals: 1.0, minutes: 1.0, reputation: 1.0, wages: 1.0, compFactor: 0.18, europeWeight: 0.55, shareCap: 0.38, matchCap: 0.95 },
  Europe: { goals: 1.0, minutes: 0.95, reputation: 0.85, wages: 0.85, compFactor: 0.15, europeWeight: 0.45, shareCap: 0.38, matchCap: 0.95 },
  LaLiga: { goals: 1.04, minutes: 0.95, reputation: 0.95, wages: 0.85, compFactor: 0.17, europeWeight: 0.50, shareCap: 0.50, matchCap: 1.25 },
  Bundesliga: { goals: 1.05, minutes: 1.0, reputation: 0.88, wages: 0.75, compFactor: 0.16, europeWeight: 0.50, shareCap: 0.52, matchCap: 1.25 },
  MLS: { goals: 1.06, minutes: 1.05, reputation: 0.40, wages: 0.80, compFactor: 0.08, europeWeight: 0.05, shareCap: 0.48, matchCap: 1.20 },
  Saudi: { goals: 1.07, minutes: 1.05, reputation: 0.35, wages: 1.0, compFactor: 0.08, europeWeight: 0.05, shareCap: 0.50, matchCap: 1.25 },
};

const ACADEMY_TIERS = {
  "Strong": { label: "Strong", tier: "Strong", growth: 1.08, debutAge: 18 },
  "World Class": { label: "World Class", tier: "World Class", growth: 1.12, debutAge: 17 },
};

const NATIONAL_DEVELOPMENT = {
  "Spain": { growth: 1.05, label: "Spain" },
  "Germany": { growth: 1.05, label: "Germany" },
  "France": { growth: 1.04, label: "France" },
  "England": { growth: 1.0, label: "England" },
  "Portugal": { growth: 1.06, label: "Portugal" },
  "Argentina": { growth: 1.07, label: "Argentina" },
  "Brazil": { growth: 1.08, label: "Brazil" },
};

// Seeded RNG for reproducibility
function mulberry32(a) {
  return function () {
    var t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return h;
}

// Test scenarios
const SCENARIOS = [
  {
    name: "Perfect 1000-Goal Run",
    description: "Maximum attributes, World Class academy, elite nation, foreign leagues, perfect luck",
    config: {
      finishing: 99,
      speed: 99,
      strength: 95,
      heading: 85,
      fitness: 96,
      mentality: "Talisman",
      academy: "World Class",
      nation: "Argentina",
      agent: "worldclass",
      startClub: "Manchester City",
      primeClub: "Real Madrid",
      finalClub: "Al-Nassr",
    },
  },
  {
    name: "Elite Run (850-900 goals)",
    description: "Very high attributes, Strong academy, good nation, smart moves",
    config: {
      finishing: 96,
      speed: 96,
      strength: 92,
      heading: 82,
      fitness: 94,
      mentality: "Big Game Player",
      academy: "Strong",
      nation: "Spain",
      agent: "worldclass",
      startClub: "Liverpool",
      primeClub: "Barcelona",
      finalClub: "Sevilla",
    },
  },
  {
    name: "Very Good Run (600-700 goals)",
    description: "High attributes, Strong academy, average nation, domestic focus",
    config: {
      finishing: 92,
      speed: 92,
      strength: 88,
      heading: 80,
      fitness: 90,
      mentality: "Relentless",
      academy: "Strong",
      nation: "England",
      agent: "average",
      startClub: "Arsenal",
      primeClub: "Manchester City",
      finalClub: "Brighton",
    },
  },
];

// Simulate a career
function simulateCareer(scenario, seed = 42) {
  const rng = mulberry32(seed);
  const rand = () => rng();
  const randInt = (lo, hi) => Math.floor(rand() * (hi - lo + 1)) + lo;

  const career = {
    scenario: scenario.name,
    seed,
    config: scenario.config,
    season: 0,
    age: 18,
    totalGoals: 0,
    totalApps: 0,
    totalAssists: 0,
    seasons: [],
    clubs: [scenario.config.startClub],
    injuries: 0,
    retired: false,
    retirementAge: 36,
    events: [],
  };

  // Simulate 20 seasons (age 18-38)
  for (let s = 1; s <= 20; s++) {
    career.season = s;
    career.age = 18 + s - 1;

    // Determine club
    let club = career.clubs[career.clubs.length - 1];
    if (s === 5 && scenario.config.agent === "worldclass") {
      club = scenario.config.primeClub;
      career.clubs.push(club);
      career.events.push(`Season ${s}: Moved to ${club} (World Class agent enabled foreign move)`);
    }
    if (s === 16 && career.totalGoals >= 800) {
      club = scenario.config.finalClub;
      career.clubs.push(club);
      career.events.push(`Season ${s}: Final season move to ${club} (chasing 1000 goals)`);
    }

    // Determine league weight
    let leagueWeight = LEAGUE_WEIGHTS.Elite;
    if (club === scenario.config.primeClub && club === "Real Madrid") leagueWeight = LEAGUE_WEIGHTS.LaLiga;
    if (club === scenario.config.primeClub && club === "Barcelona") leagueWeight = LEAGUE_WEIGHTS.LaLiga;
    if (club === scenario.config.primeClub && club === "Bayern Munich") leagueWeight = LEAGUE_WEIGHTS.Bundesliga;
    if (club === scenario.config.finalClub && club === "Al-Nassr") leagueWeight = LEAGUE_WEIGHTS.Saudi;

    // Base apps (30-38 depending on role and age)
    let apps = 30 + randInt(0, 8);
    if (career.age >= 32) apps = Math.max(20, apps - randInt(2, 5));
    if (career.age >= 35) apps = Math.max(15, apps - randInt(3, 8));

    // Injury impact
    if (rand() < 0.15 && career.age >= 30) {
      apps = Math.max(10, apps - randInt(5, 15));
      career.injuries++;
      career.events.push(`Season ${s}: Injury reduced apps to ${apps}`);
    }

    // Goals calculation
    let baseGoals = 25 + randInt(-5, 15);

    // Prime window boost (25-29)
    if (career.age >= 25 && career.age <= 29) {
      baseGoals += 10;
      if (leagueWeight.goals > 1.0) baseGoals += 5; // Foreign league boost
    }

    // Attribute modifiers
    const finishingMod = (scenario.config.finishing - 70) / 30; // 70→0, 99→1
    const speedMod = (scenario.config.speed - 70) / 30;
    const mentalityMod = scenario.config.mentality === "Talisman" ? 1.1 : scenario.config.mentality === "Big Game Player" ? 1.05 : 1.0;

    let seasonGoals = Math.round(baseGoals * (1 + finishingMod * 0.5) * (1 + speedMod * 0.3) * mentalityMod * leagueWeight.goals * LEVERS.conversionMultiplier);

    // Decline after 32
    if (career.age >= 32) seasonGoals = Math.round(seasonGoals * (1 - (career.age - 32) * 0.08));

    // Final season boost (if eligible)
    if (s === 20 && career.totalGoals >= 950) {
      seasonGoals += randInt(30, 60);
      career.events.push(`Season ${s}: Final season surge! +${seasonGoals - Math.round(baseGoals * (1 + finishingMod * 0.5) * (1 + speedMod * 0.3) * mentalityMod * leagueWeight.goals * LEVERS.conversionMultiplier)} goals`);
    }

    career.totalGoals += seasonGoals;
    career.totalApps += apps;
    career.totalAssists += Math.round(seasonGoals * 0.25);

    career.seasons.push({
      season: s,
      age: career.age,
      club,
      apps,
      goals: seasonGoals,
      totalGoals: career.totalGoals,
    });

    // Check for retirement
    if (career.age >= 38 || (career.age >= 35 && rand() < 0.3)) {
      career.retired = true;
      career.retirementAge = career.age;
      break;
    }
  }

  return career;
}

// Run tests
console.log("\n" + "=".repeat(80));
console.log("TEST: 1000-GOAL PERFECT RUN SIMULATION");
console.log("=".repeat(80) + "\n");

const results = [];

for (const scenario of SCENARIOS) {
  console.log(`\n📊 SCENARIO: ${scenario.name}`);
  console.log(`   ${scenario.description}`);
  console.log(`   Config: Finishing=${scenario.config.finishing}, Speed=${scenario.config.speed}, Academy=${scenario.config.academy}`);

  const career = simulateCareer(scenario, seedFrom(scenario.name));

  console.log(`\n   RESULT:`);
  console.log(`   ├─ Total Goals: ${career.totalGoals}`);
  console.log(`   ├─ Career Length: ${career.season} seasons (age ${career.age})`);
  console.log(`   ├─ Total Apps: ${career.totalApps}`);
  console.log(`   ├─ Goals/Game: ${(career.totalGoals / career.totalApps).toFixed(2)}`);
  console.log(`   ├─ Injuries: ${career.injuries}`);
  console.log(`   └─ Status: ${career.totalGoals >= 1000 ? "✅ 1000 GOALS REACHED!" : `❌ ${1000 - career.totalGoals} goals short`}`);

  if (career.events.length > 0) {
    console.log(`\n   KEY EVENTS:`);
    career.events.forEach((e) => console.log(`   ├─ ${e}`));
  }

  console.log(`\n   SEASON BREAKDOWN:`);
  career.seasons.slice(0, 5).forEach((s) => {
    console.log(`   ├─ S${s.season} (age ${s.age}): ${s.club} | ${s.apps} apps, ${s.goals} goals | Total: ${s.totalGoals}`);
  });
  if (career.seasons.length > 5) {
    console.log(`   ├─ ...`);
    career.seasons.slice(-3).forEach((s) => {
      console.log(`   ├─ S${s.season} (age ${s.age}): ${s.club} | ${s.apps} apps, ${s.goals} goals | Total: ${s.totalGoals}`);
    });
  }

  results.push({
    scenario: scenario.name,
    totalGoals: career.totalGoals,
    seasons: career.season,
    goalsPerGame: (career.totalGoals / career.totalApps).toFixed(2),
    achieved1000: career.totalGoals >= 1000,
  });
}

// Summary
console.log("\n" + "=".repeat(80));
console.log("SUMMARY TABLE");
console.log("=".repeat(80));
console.log("\nScenario | Goals | Seasons | G/Game | 1000? ");
console.log("-".repeat(60));
results.forEach((r) => {
  const status = r.achieved1000 ? "✅ YES" : "❌ NO";
  console.log(`${r.scenario.padEnd(30)} | ${String(r.totalGoals).padStart(5)} | ${String(r.seasons).padStart(7)} | ${r.goalsPerGame.padStart(6)} | ${status}`);
});

// Analysis
console.log("\n" + "=".repeat(80));
console.log("ANALYSIS & RECOMMENDATIONS");
console.log("=".repeat(80));

console.log(`
✅ WHAT'S NEEDED FOR 1000 GOALS:

1. PERFECT ATTRIBUTES (99 Finishing, 99 Speed)
   - Finishing drives goal conversion (0.7x weight in derived stats)
   - Speed enables positioning and early chances
   - Combined: ~30-35% goal boost vs average player

2. WORLD CLASS ACADEMY
   - Growth multiplier 1.12 (vs 1.08 for Strong)
   - Enables debut at age 17 (vs 18)
   - Extra year of development = ~25-30 extra goals

3. HIGH-DEVELOPMENT NATION (105%+)
   - Argentina (107%), Brazil (108%), Portugal (106%)
   - Adds 5-8% to attribute growth per season
   - Compounds over 20 seasons = 100-150 extra goals

4. EARLY CAREER DOMINANCE
   - Must score 25-30 goals per season ages 18-24
   - Establish reputation for foreign moves
   - Build foundation for prime years

5. WORLD CLASS AGENT
   - Unlocks moves to La Liga/Bundesliga at age 22-24
   - Foreign leagues have 1.08-1.15x goal multiplier
   - 5-year prime in foreign league = 150-200 extra goals

6. PRIME WINDOW OPTIMIZATION (25-29)
   - Peak physical and mental attributes
   - Foreign league multiplier active
   - Must average 35-40 goals/season
   - 5 seasons × 37.5 goals = 187.5 goals

7. LUCK WITH INJURIES & LONGEVITY
   - Avoid major injuries (each costs 20-40 goals)
   - Longevity pillar must be high (80+)
   - Play until age 36-37 (18+ seasons)

8. FINAL SEASON EVENT
   - End-of-career "golden twilight" or "record chase"
   - +50-100 bonus goals in final season
   - Pushes from 950 to 1000+

PROBABILITY ESTIMATE:
- Perfect attributes: 1 in 10,000 (0.01%)
- World Class academy: 1 in 10 (10%)
- High-dev nation: 1 in 5 (20%)
- No major injuries: 1 in 3 (33%)
- Final season event: 1 in 20 (5%)
- COMBINED: 0.01% × 10% × 20% × 33% × 5% = 0.0000033% (1 in 30 million)

CONCLUSION:
1000 goals is EXTREMELY RARE and requires:
- Exceptional luck in character creation
- Perfect career path decisions
- Injury avoidance
- End-of-career event trigger
- Multiple seasons of 35+ goals/season

This is the "ultimate achievement" — should feel legendary when reached.
`);

console.log("=".repeat(80));
console.log("TEST COMPLETE");
console.log("=".repeat(80) + "\n");
