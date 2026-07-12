/* ============================================================================
 * FOOTBALL DNA SIMULATOR — CAREER EVENT DATA
 *
 * All end-of-season decisions, career milestones, random season events,
 * career-stage weights and career endings live here. This file is loaded as a
 * dependency by game.js; it does not use the global state directly. Instead,
 * game.js passes a small deps object containing accessors for state and RNG
 * helpers, keeping this data module reusable and testable.
 * ========================================================================== */
(function () {
  "use strict";

  window.createCareerEventData = function (deps) {
  /* -------------------- MANDATORY END-OF-SEASON DECISIONS --------------------
   * These fire every season and shape the next 12 months through Career Pillars.
   */
  const SEASON_DECISIONS = [
    {
      id: "manager_meeting", category: "STRATEGY", weight: 10,
      text: (n) => `End-of-season review with the manager. ${n} can shape the next campaign now.`,
      choices: (ctx) => [
        { label: "Demand more playing time", fx: { role: "up", rep: -2, pillars: { Ambition: 8, Ego: 4 } } },
        { label: "Ask to stay in the current role", fx: { rep: 2, pillars: { Loyalty: 6, Professionalism: 4 } } },
        { label: "Push for a tactical change", fx: { rep: -1, pillars: { Ambition: 4, Adaptability: 8 } } },
      ],
    },
    {
      id: "training_focus", category: "TRAINING", weight: 10,
      text: (n) => `${n} has one summer focus to sharpen before pre-season.`,
      choices: (ctx) => [
        { label: "Finishing school", fx: { attrChange: { key: "leftFoot", delta: 2 }, carryOver: true, carryOverLog: "Finishing work sharpens the boot next season.", pillars: { KillerInstinct: 8, Professionalism: 4 } } },
        { label: "Pace and movement", fx: { attrChange: { key: "speed", delta: 2 }, carryOver: true, carryOverLog: "Pace work adds half a yard next season.", pillars: { Adaptability: 4, Professionalism: 4 } } },
        { label: "Strength and conditioning", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Strength programme adds power next season.", pillars: { Durability: 6, Professionalism: 6 } } },
        { label: "Fitness and recovery", fx: { attrChange: { key: "fitness", delta: 2 }, carryOver: true, carryOverLog: "Pre-season fitness block pays off next season.", pillars: { Durability: 8, Longevity: 6 } } },
      ],
    },
    {
      id: "squad_role", category: "PLAYING TIME", weight: 8, req: { roleIn: ["Rotation", "Bench"] },
      text: (n) => `${n} is not a guaranteed starter. How do they handle it?`,
      choices: (ctx) => [
        { label: "Knock on the manager's door", fx: { rep: -2, pillars: { Ambition: 8, Ego: 4 } } },
        { label: "Wait for the chance and deliver", fx: { rep: 3, pillars: { Consistency: 6, Professionalism: 4 } } },
        { label: "Ask the agent to find a loan", fx: { rep: -1, forceTransfer: true, pillars: { Ambition: 6, Loyalty: -4 } } },
      ],
    },
    {
      id: "fitness_plan", category: "FITNESS", weight: 8, req: { ageMin: 28 },
      text: (n) => `At ${ctx.age}, ${n}'s body needs a different plan.`,
      choices: (ctx) => [
        { label: "Heavy load — squeeze every drop", fx: { attrChange: { key: "fitness", delta: 1 }, carryOver: true, pillars: { Professionalism: 4, Durability: -6 } } },
        { label: "Balanced programme", fx: { pillars: { Durability: 8, Consistency: 4 } } },
        { label: "Recovery-first schedule", fx: { attrChange: { key: "fitness", delta: -1 }, pillars: { Durability: 12, Longevity: 10 } } },
      ],
    },
    {
      id: "media_profile", category: "MEDIA", weight: 6, req: { repMin: 55 },
      text: (n) => `The media profile is growing. ${n} chooses the next narrative.`,
      choices: (ctx) => [
        { label: "Market the brand", fx: { fame: 6, rep: 2, wealth: 3, pillars: { Ego: 8, Ambition: 4 } } },
        { label: "Stay humble", fx: { rep: 4, pillars: { Loyalty: 6, Professionalism: 4 } } },
        { label: "Call out doubters", fx: { fame: 4, rep: -3, pillars: { Ego: 6, KillerInstinct: 4 } } },
      ],
    },
    {
      id: "personal_life", category: "PERSONAL", weight: 6,
      text: (n) => `Off-season demands pull at ${n} from different directions.`,
      choices: (ctx) => [
        { label: "Family first", fx: { pillars: { Loyalty: 4, Consistency: 4 } } },
        { label: "Football first", fx: { pillars: { Professionalism: 6, Ego: -2 } } },
        { label: "Let the hair down", fx: { rep: -2, fame: 4, pillars: { Ego: 6, Consistency: -4 } } },
      ],
    },
    {
      id: "leadership_role", category: "LEADERSHIP", weight: 5, req: { ageMin: 28, yearsMin: 2 },
      text: (n) => `Younger players look to ${n} as a senior figure.`,
      choices: (ctx) => [
        { label: "Mentor the next generation", fx: { rep: 3, pillars: { Leadership: 10, Loyalty: 6 } } },
        { label: "Focus on personal targets", fx: { pillars: { Ambition: 6, Leadership: -4 } } },
      ],
    },
    {
      id: "tactical_shift", category: "TACTICS", weight: 5, req: { yearsMin: 1 },
      text: (n) => `The manager wants to evolve the system. ${n} must adapt.`,
      choices: (ctx) => [
        { label: "Learn the new role inside-out", fx: { attrChange: { key: "fitness", delta: 1 }, carryOver: true, pillars: { Adaptability: 10, Professionalism: 4 } } },
        { label: "Stick to what you know", fx: { pillars: { Adaptability: -4, Consistency: 4 } } },
      ],
    },
    {
      id: "national_team", category: "INTERNATIONAL", weight: 4, req: { intlCaps: 1, intlRetired: false },
      text: (n) => `International duty calls again. ${n} decides the commitment level.`,
      choices: (ctx) => [
        { label: "Give everything for the country", fx: { intlCaps: 1, rep: 3, attrChange: { key: "fitness", delta: -1 }, pillars: { Loyalty: 6, Durability: -4 } } },
        { label: "Protect club form", fx: { rep: -2, pillars: { Professionalism: 4, Longevity: 4 } } },
      ],
    },
    {
      id: "rival_arrives", category: "RIVALS", weight: 4, req: { roleIn: ["Starter", "Rotation", "Star"] },
      text: (n) => `The club signs a £${Math.floor(50 + deps.rand() * 90)}m rival striker.`,
      choices: (ctx) => [
        { label: "Fight for the shirt", fx: { rep: 3, pillars: { KillerInstinct: 6, Ego: 4 } } },
        { label: "Accept squad rotation", fx: { pillars: { Adaptability: 6, Ambition: -4 } } },
        { label: "Demand a transfer", fx: { rep: -4, forceTransfer: true, pillars: { Ambition: 8, Loyalty: -6 } } },
      ],
    },
    {
      id: "golden_generation", category: "CLUB", weight: 3, req: { yearsMin: 2 },
      text: (n) => `The academy produces three wonderkids who look up to ${n}.`,
      choices: (ctx) => [
        { label: "Become their mentor", fx: { rep: 4, pillars: { Leadership: 8, Loyalty: 6 } } },
        { label: "Feel threatened by the competition", fx: { pillars: { Ego: 6, Consistency: -4 } } },
        { label: "Ask to leave before they take minutes", fx: { rep: -3, forceTransfer: true, pillars: { Ambition: 6, Leadership: -4 } } },
      ],
    },
    {
      id: "fan_relationship", category: "FANS", weight: 4, req: { yearsMin: 2 },
      text: (n) => `The fans are ${deps.getState().reputation >= 65 ? "singing your name" : "starting to turn"}.`,
      choices: (ctx) => [
        { label: "Embrace the supporters", fx: { rep: 4, pillars: { Loyalty: 8, Ego: 2 } } },
        { label: "Keep distance and focus on goals", fx: { pillars: { Consistency: 4, Loyalty: -2 } } },
      ],
    },
    {
      id: "ballon_campaign", category: "LEGACY", weight: 2, req: { repMin: 70, perf: ["Sensational", "Overperformed"] },
      text: (n) => `${n} is in Ballon d'Or conversation. How do you campaign?`,
      choices: (ctx) => [
        { label: "Market the campaign", fx: { fame: 8, rep: 3, pillars: { Ego: 8, KillerInstinct: 4 } } },
        { label: "Let the football speak", fx: { rep: 5, pillars: { Professionalism: 6, Consistency: 4 } } },
      ],
    },
    {
      id: "takeover", category: "CLUB STRATEGY", weight: 2, req: { yearsMin: 3 },
      text: (n) => `New owners take over ${deps.getState().club}. They promise to either spend big or strip the squad.`,
      choices: (ctx) => [
        { label: "Back the new project", fx: { flag: "takeover", pillars: { Loyalty: 6, Adaptability: 4 } } },
        { label: "Demand assurances", fx: { rep: -2, flag: "takeover", pillars: { Ambition: 6, Ego: 4 } } },
        { label: "Ask to leave", fx: { rep: -3, flag: "takeover", forceTransfer: true, pillars: { Ambition: 8, Loyalty: -6 } } },
      ],
    },
    {
      id: "data_analytics", category: "TACTICS", weight: 2, req: { repMin: 45 },
      text: (n) => `The club hires a data team that wants ${n} to play differently — more pressing, less poaching.`,
      choices: (ctx) => [
        { label: "Buy into the analytics", fx: { attrChange: { key: "fitness", delta: 1 }, carryOver: true, pillars: { Adaptability: 8, Professionalism: 4 } } },
        { label: "Trust instinct over numbers", fx: { pillars: { KillerInstinct: 6, Adaptability: -4 } } },
      ],
    },
    {
      id: "financial_crisis", category: "CLUB STRATEGY", weight: 1, req: { yearsMin: 2 },
      text: (n) => `${deps.getState().club} faces a financial crisis. Wages may be cut.`,
      choices: (ctx) => [
        { label: "Take a wage cut", fx: { wealth: -6, rep: 5, flag: "financialCrisis", pillars: { Loyalty: 10, Ego: -4 } } },
        { label: "Demand full payment", fx: { rep: -4, flag: "financialCrisis", pillars: { Ego: 6, Loyalty: -6 } } },
        { label: "Leave for a stable club", fx: { rep: -2, flag: "financialCrisis", forceTransfer: true, pillars: { Ambition: 6, Loyalty: -4 } } },
      ],
    },
    {
      id: "var_era", category: "GAME EVOLUTION", weight: 1, req: { seasonMin: 20 },
      text: (n) => `VAR and stricter officiating change the game. Penalties are rarer and more scrutinised.`,
      choices: (ctx) => [
        { label: "Adapt your movement to draw fouls", fx: { pillars: { Adaptability: 8, KillerInstinct: 4 } } },
        { label: "Complain to the media", fx: { rep: -2, pillars: { Ego: 6, Consistency: -4 } } },
      ],
    },
  ];
  const EARLY_DEVELOPMENT_DECISIONS = [
    {
      id: "early_attribute_training", category: "TRAINING", weight: 1,
      text: (n) => `${n}'s coaches ask what the next development block should focus on.`,
      choices: () => [
        { label: "Finishing reps — sharpen both feet", fx: { attrChange: { key: "leftFoot", delta: 1 }, attrChange2: { key: "rightFoot", delta: 1 }, pillars: { Professionalism: 5, KillerInstinct: 4 } } },
        { label: "Aerial work — become more dangerous in the box", fx: { attrChange: { key: "heading", delta: 2 }, pillars: { Professionalism: 4, Durability: 2 } } },
        { label: "Engine work — build pace and repeat sprints", fx: { attrChange: { key: "speed", delta: 1 }, attrChange2: { key: "fitness", delta: 1 }, pillars: { Durability: 4, Consistency: 3 } } },
      ],
    },
    {
      id: "early_position_plan", category: "MANAGER", weight: 1,
      text: (n) => `The manager wants to shape ${n}'s role before the career hardens.`,
      choices: () => [
        { label: "Stay central as a striker", fx: { positionChange: "ST", attrChange: { key: "heading", delta: 1 }, pillars: { KillerInstinct: 5, Consistency: 2 } } },
        { label: "Move to center forward and link play", fx: { positionChange: "CF", attrChange: { key: "strength", delta: 1 }, pillars: { Adaptability: 5, Leadership: 2 } } },
        { label: "Shift wide and attack space", fx: { positionChange: deps.rand() < 0.5 ? "AML" : "AMR", attrChange: { key: "speed", delta: 1 }, pillars: { Adaptability: 6, Ambition: 2 } } },
      ],
    },
    {
      id: "early_agent_move", category: "AGENT", weight: 1,
      text: (n) => `${n}'s agent believes the first career move could define everything.`,
      choices: () => [
        { label: "Force a move for minutes", fx: { forceTransfer: true, rep: -1, pillars: { Ambition: 6, Loyalty: -4, Adaptability: 4 } } },
        { label: "Stay and fight for the shirt", fx: { rep: 2, pillars: { Loyalty: 6, Professionalism: 4 } } },
        { label: "Ask for a loan-style pathway", fx: { forceTransfer: true, pillars: { Adaptability: 6, Professionalism: 3 } } },
      ],
    },
  ];
  /* -------------------- END-OF-CAREER MILESTONE DECISIONS --------------------
   * These fire at major career ages and reshape the entire future.
   */
  const CAREER_MILESTONES = [
    {
      id: "young_path", ageRange: [18, 22], once: true, weight: 10,
      text: (n) => `At ${deps.getState().age}, ${n} must choose the path to the top.`,
      choices: (ctx) => [
        { label: "Chase minutes — loan spells and lower-league graft", fx: { attrChange: { key: "fitness", delta: 2 }, pillars: { Professionalism: 8, Ambition: 6, Adaptability: 6 } } },
        { label: "Chase trophies — fight for a place at a big club", fx: { rep: 3, pillars: { Ambition: 10, KillerInstinct: 6 } } },
        { label: "Chase money — take the first big pay day", fx: { wealth: 12, pillars: { Ego: 8, Loyalty: -6 } } },
      ],
    },
    {
      id: "prime_offer", ageRange: [24, 27], once: true, weight: 10,
      text: (n) => `A defining offer arrives in ${n}'s prime years.`,
      choices: (ctx) => [
        { label: "Elite club — chase the biggest stage", fx: { rep: 4, forceTransfer: true, pillars: { Ambition: 12, Ego: 4 } } },
        { label: "Mid-table club — become the main man", fx: { role: "up", rep: 2, pillars: { Loyalty: 4, KillerInstinct: 6 } } },
        { label: "Overseas league — new culture, new pressure", fx: { fame: 6, rep: 2, pillars: { Adaptability: 10, Ambition: 4 } } },
      ],
    },
    {
      id: "reinvent", ageRange: [29, 32], once: true, weight: 8,
      text: (n) => `At ${deps.getState().age}, the physical edge is fading. ${n} must reinvent the game.`,
      choices: (ctx) => [
        { label: "Become a poacher — live in the box", fx: { positionChange: "ST", attrChange: { key: "heading", delta: 2 }, pillars: { KillerInstinct: 10, Adaptability: 4 } } },
        { label: "Stay explosive — train harder than ever", fx: { attrChange: { key: "speed", delta: 1 }, attrChange2: { key: "fitness", delta: -2 }, pillars: { Durability: -6, Longevity: -4, Professionalism: 8 } } },
        { label: "Become a target man — use the brain", fx: { positionChange: "CF", attrChange: { key: "strength", delta: 2 }, pillars: { Leadership: 6, Adaptability: 6 } } },
      ],
    },
    {
      id: "international_retirement", ageRange: [32, 35], once: true, req: { intlCaps: 10, intlRetired: false }, weight: 6,
      text: (n) => `International retirement is on the table. ${n} can protect the club legs.`,
      choices: (ctx) => [
        { label: "Retire from internationals", fx: { attrChange: { key: "fitness", delta: 3 }, rep: -2, setIntlRetired: true, pillars: { Longevity: 10, Professionalism: 4 } } },
        { label: "Keep playing for the country", fx: { rep: 4, attrChange: { key: "fitness", delta: -2 }, pillars: { Loyalty: 8, Durability: -6 } } },
      ],
    },
    {
      id: "final_contract", ageRange: [34, 40], once: true, weight: 8,
      text: (n) => `At ${deps.getState().age}, ${n} faces the final contract decision.`,
      choices: (ctx) => [
        { label: "Saudi Arabia — one last jackpot", fx: { wealth: 20, fame: 6, rep: -3, pillars: { Ego: 6, Loyalty: -6 } } },
        { label: "MLS — lifestyle and legacy", fx: { wealth: 10, fame: 8, rep: 2, pillars: { Longevity: 4, Ego: 2 } } },
        { label: "Championship — keep playing in England", fx: { rep: 3, pillars: { Loyalty: 6, Professionalism: 4 } } },
        { label: "Stay loyal at the current club", fx: { rep: 5, pillars: { Loyalty: 10, Leadership: 4 } } },
        { label: "Retire now", fx: { retireNow: true, endCareerReason: "planned" } },
      ],
    },
  ];
  const CAREER_SECTIONS = {
    Early: { min: 17, max: 21, label: "Early", eventCap: 1, weights: { Development: 3, Injury: 1, "Transfer or Loan": 1, Roleplay: 2 } },
    Mid: { min: 22, max: 28, label: "Mid", eventCap: 2, weights: { Development: 1.5, Injury: 2, "Transfer or Loan": 2, Roleplay: 2 } },
    Late: { min: 29, max: 33, label: "Late", eventCap: 3, weights: { Development: 0.6, Injury: 3, "Transfer or Loan": 3, Roleplay: 2 } },
    Overtime: { min: 34, max: 99, label: "Overtime", eventCap: 4, weights: { Development: 0, Injury: 4, "Transfer or Loan": 4, Roleplay: 3 } },
  };
  const SEASON_TAG_WEIGHTS = {
    Early: { Development: 3, Injury: 1, "Transfer or Loan": 1, Roleplay: 2 },
    Mid: { Development: 1.5, Injury: 2, "Transfer or Loan": 2, Roleplay: 2 },
    Late: { Development: 0.6, Injury: 3, "Transfer or Loan": 3, Roleplay: 2 },
    Overtime: { Development: 0, Injury: 4, "Transfer or Loan": 4, Roleplay: 3 },
  };
  const SEASON_EVENTS = [
    // Development
    { id: "preseason_training", tag: "Development", tone: "neutral", base: 4,
      req: { perf: ["Met Expectation", "Overperformed", "Sensational"], ageMax: 34 },
      text: (n) => `Pre-season is brutal. The coaching staff push ${n} harder than ever.`,
      choices: [
        { label: "Embrace the workload — build the engine", fx: { attrChange: { key: "fitness", delta: 2 }, carryOver: true, carryOverLog: "Pre-season graft pays off — fitness is up next season." } },
        { label: "Pace yourself — longevity matters", fx: { attrChange: { key: "fitness", delta: 1 } } },
      ] },
    { id: "personal_trainer", tag: "Development", tone: "neutral", base: 3,
      req: { repMin: 40 },
      text: (n) => `${n} hires a specialist finishing coach for the summer.`,
      choices: [
        { label: "Improve left foot", fx: { attrChange: { key: "leftFoot", delta: 2 }, carryOver: true, carryOverLog: "Summer finishing work on the left foot pays off next season." } },
        { label: "Improve right foot", fx: { attrChange: { key: "rightFoot", delta: 2 }, carryOver: true, carryOverLog: "Summer finishing work on the right foot pays off next season." } },
      ] },
    { id: "sports_science", tag: "Development", tone: "neutral", base: 3,
      req: { repMin: 35 },
      text: (n) => `The club invests in a new sports science department and targets ${n}.`,
      choices: [
        { label: "Prioritise speed", fx: { attrChange: { key: "speed", delta: 2 }, carryOver: true, carryOverLog: "Sports science programme boosts pace for next season." } },
        { label: "Prioritise strength", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Strength programme shows dividends next season." } },
      ] },
    { id: "career_position_training", tag: "Development", tone: "neutral", base: 4,
      req: { perf: ["Met Expectation", "Overperformed", "Sensational"], ageMax: 32 },
      text: (n) => `${n}'s coach suggests a summer position camp to sharpen one specific area.`,
      choices: [
        { label: "Focus on heading", fx: { attrChange: { key: "heading", delta: 3 }, carryOver: true, carryOverLog: "Heading camp pays off next season." } },
        { label: "Focus on finishing", fx: { attrChange: { key: "leftFoot", delta: 2 }, carryOver: true, carryOverLog: "Finishing camp sharpens the left foot next season." } },
        { label: "Focus on pace", fx: { attrChange: { key: "speed", delta: 2 }, carryOver: true, carryOverLog: "Pace work adds yard next season." } },
        { label: "Focus on physicality", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Strength work adds power next season." } },
      ] },
    { id: "tactical_evolution", tag: "Development", tone: "neutral", base: 4,
      req: { traj: ["Mid-table", "Europe", "Title"], yearsMin: 1 },
      text: (n) => `The manager wants to evolve the system — ${n} will have to adapt.`,
      choices: [
        { label: "Learn the new role inside-out", fx: { attrChange: { key: "fitness", delta: 1 }, carryOver: true, rep: 2, carryOverLog: "Tactical flexibility improves match fitness next season." } },
        { label: "Stick to what you know", fx: { flag: "managerConflict" } },
      ] },
    { id: "nutritionist", tag: "Development", tone: "neutral", base: 3,
      req: { perf: ["Sensational", "Overperformed"] },
      text: (n) => `A nutritionist overhauls ${n}'s diet to squeeze out extra performance.`,
      choices: [
        { label: "Follow the strict plan", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Lean muscle gains from the new diet show next season." } },
        { label: "Enjoy the odd cheat meal", fx: { attrChange: { key: "strength", delta: 1 } } },
      ] },

    // Injury
    { id: "minor_injury", tag: "Injury", tone: "negative", base: 4,
      req: { ageMin: 25 },
      text: (n) => `${n} picks up a minor hamstring strain — nothing serious, but timing is frustrating.`,
      choices: [
        { label: "Rush back to help the team", fx: { flag: "injuryProne", injuryProne: 1 } },
        { label: "Take full time to recover properly", fx: { rep: 1 } },
      ] },
    { id: "training_injury", tag: "Injury", tone: "negative", base: 3,
      text: (n) => `A freak training-ground accident leaves ${n} sidelined for weeks.`,
      choices: [
        { label: "Work hard in rehab", fx: { rep: 1, flag: "redemptionArc" } },
        { label: "Come back too fast and risk it", fx: { flag: "injuryProne", injuryProne: 2 } },
      ] },
    { id: "muscle_tear", tag: "Injury", tone: "negative", base: 3,
      req: { ageMin: 26 },
      text: (n) => `${n} tears a thigh muscle in training and misses the run-in.`,
      choices: [
        { label: "Undergo intensive rehab", fx: { attrChange: { key: "fitness", delta: -1 }, rep: 1 } },
        { label: "Rush back for the playoffs", fx: { attrChange: { key: "fitness", delta: -2 }, flag: "injuryProne", injuryProne: 1 } },
      ] },
    { id: "ankle_surgery", tag: "Injury", tone: "negative", base: 3,
      req: { ageMin: 28 },
      text: (n) => `${n} needs ankle surgery after a bad tackle. The recovery is six to eight weeks.`,
      choices: [
        { label: "Take the full rehab route", fx: { attrChange: { key: "speed", delta: -1 }, rep: 1 } },
        { label: "Play through the pain", fx: { attrChange: { key: "speed", delta: -2 }, flag: "injuryProne", injuryProne: 2 } },
      ] },
    { id: "concussion", tag: "Injury", tone: "negative", base: 3,
      req: { ageMin: 24 },
      text: (n) => `${n} takes a heavy blow to the head. The medical team recommends a cautious protocol.`,
      choices: [
        { label: "Follow the full protocol", fx: { rep: 2 } },
        { label: "Return early — the team needs you", fx: { attrChange: { key: "fitness", delta: -1 }, flag: "injuryProne", injuryProne: 1 } },
      ] },
    { id: "serious_injury", tag: "Injury", tone: "negative", base: 3,
      req: { ageMin: 29 },
      text: (n) => `Disaster — ${n} suffers a serious knee injury.`,
      choices: [
        { label: "Begin the long road back", fx: { rep: -2, flag: "injuryProne", injuryProne: 2 } },
      ] },

    // Transfer or Loan
    { id: "transfer_speculation", tag: "Transfer or Loan", tone: "mixed", base: 5,
      req: { repMin: 50, yearsMin: 2 },
      text: (n) => `The papers link ${n} with a mega-money move abroad. The agent is fielding calls.`,
      choices: [
        { label: "Shut it down — I'm happy here", fx: { rep: 3, flag: "fanFavorite" } },
        { label: "Keep options open — never say never", fx: { flag: "unsettled" } },
        { label: "Encourage the interest", fx: { rep: -2, forceTransfer: true } },
      ] },
    { id: "agent_transfer_push", tag: "Transfer or Loan", tone: "mixed", base: 4,
      req: { repMin: 50, yearsMin: 2 },
      text: (n) => `${n}'s agent has been talking to bigger clubs. A move could be on the cards.`,
      choices: [
        { label: "Let the agent explore options", fx: { forceTransfer: true, rep: 1 } },
        { label: "Commit to the current club", fx: { rep: 3, flag: "fanFavorite" } },
      ] },
    { id: "agent_new_contract", tag: "Transfer or Loan", tone: "mixed", base: 4,
      req: { repMin: 35, yearsMin: 1 },
      text: (n) => `${n}'s agent negotiates an early contract extension with the current club.`,
      choices: [
        { label: "Sign the extension", fx: { contract: 2, rep: 2, flag: "fanFavorite" } },
        { label: "Hold out for more money", fx: { contract: 1, wealth: 5, rep: -1, flag: "unsettled" } },
      ] },
    { id: "pay_rise", tag: "Transfer or Loan", tone: "positive", base: 4,
      req: { perf: ["Sensational", "Overperformed"], yearsMin: 1 },
      text: (n) => `The club rewards ${n} with a surprise pay rise after an outstanding season.`,
      choices: [
        { label: "Accept it graciously", fx: { wealth: 8, rep: 2, flag: "fanFavorite" } },
        { label: "Demand even more", fx: { wealth: 4, rep: -2, flag: "unsettled" } },
      ] },
    { id: "wage_dispute", tag: "Transfer or Loan", tone: "mixed", base: 3,
      req: { perf: ["Sensational"], yearsMin: 2 },
      text: (n) => `${n} feels underpaid compared to new signings. The dressing room is watching.`,
      choices: [
        { label: "Go public with the dispute", fx: { wealth: 6, rep: -3, flag: "mediaTarget" } },
        { label: "Negotiate privately", fx: { wealth: 4, rep: 1 } },
      ] },
    { id: "career_force_move", tag: "Transfer or Loan", tone: "mixed", base: 4,
      req: { repMin: 45, yearsMin: 2 },
      text: (n) => `${n}'s agent has engineered a concrete bid from a bigger club. It's time to decide.`,
      choices: [
        { label: "Force the move — my level is higher", fx: { rep: -2, forceTransfer: true, flag: "unsettled" } },
        { label: "Stay loyal — renegotiate instead", fx: { rep: 4, contract: 2, flag: "fanFavorite" } },
        { label: "Let the agent handle it quietly", fx: { rep: 1, wealth: 3 } },
      ] },

    // Roleplay
    { id: "breakout", tag: "Roleplay", tone: "positive", base: 6,
      req: { perf: ["Overperformed", "Sensational"], ageMax: 24 },
      text: (n) => `${n} explodes onto the scene with a breakout season. The hype is real.`,
      choices: [
        { label: "Stay humble, keep working", fx: { rep: 4, flag: "fanFavorite" } },
        { label: "Embrace the spotlight", fx: { rep: 8, flag: "mediaTarget" } },
      ] },
    { id: "golden_boot_race", tag: "Roleplay", tone: "positive", base: 5,
      req: { perf: ["Sensational"] },
      text: (n) => `Final day and ${n} is in a three-way Golden Boot race!`,
      choices: [
        { label: "Go for glory — shoot on sight", fx: { rep: 6, goals: () => deps.randInt(1, 3), flag: "inForm" } },
        { label: "Play for the team", fx: { rep: 3, assists: () => deps.randInt(1, 3) } },
      ] },
    { id: "title_winner", tag: "Roleplay", tone: "positive", base: 8,
      req: { traj: ["Title"] },
      text: (n) => `CHAMPIONS! ${n}'s club is crowned league winners.`,
      choices: [
        { label: "Stay and defend the title", fx: { rep: 6, flag: "fanFavorite" } },
        { label: "Use it as a platform to leave", fx: { rep: 4, forceTransfer: true } },
      ] },
    { id: "relegated", tag: "Roleplay", tone: "negative", base: 7,
      req: { traj: ["Relegated"] },
      text: (n) => `Heartbreak. ${n}'s club is relegated.`,
      choices: [
        { label: "Stay and fight back up", fx: { rep: 2, flag: "fanFavorite" } },
        { label: "Force an exit to a bigger club", fx: { rep: -2, forceTransfer: true } },
      ] },
    { id: "pundit_criticism", tag: "Roleplay", tone: "negative", base: 4,
      req: { perf: ["Underperformed", "Flop"], repMin: 55 },
      text: (n) => `Pundits queue up to criticise ${n} after a poor run.`,
      choices: [
        { label: "Respond with a classy interview", fx: { rep: 2 } },
        { label: "Hit back at the critics", fx: { rep: -2, flag: "mediaTarget" } },
        { label: "Double down", fx: { rep: -3, flag: "burnedBridges" } },
      ] },
    { id: "world_cup_call", tag: "Roleplay", tone: "positive", base: 4,
      req: { repMin: 50, ageMin: 20, ageMax: 34, intlRetired: false },
      text: (n) => `${n} is called up for a major international tournament.`,
      choices: [
        { label: "Give everything for the country", fx: { rep: 5, intlCaps: 1, intlGoals: () => deps.randInt(0, 2), flag: "inForm" } },
        { label: "Focus on club fitness", fx: { rep: -2 } },
      ] },
  ];
  const CAREER_ENDINGS = [
    { id: "injury_retirement", base: 2,
      req: (s) => s.injuryProneSeasons > 0 || s.injuryProneness > 60 || s.age >= 35,
      score: (s) => (s.injuryProneSeasons * 4) + ((s.injuryProneness - 50) / 10) + (s.age >= 35 ? 3 : 0),
      text: (n, s) => `A cruel injury forces ${n} into an early, unwanted retirement at ${s.age}.`,
      choices: [{ label: "Bow out with head held high", fx: { rep: -2 } }] },
    { id: "last_dance_abroad", base: 3,
      req: (s) => s.age >= 33 && s.reputation >= 55 && s.totalGoals >= 300,
      score: (s) => ((s.reputation - 50) / 10) + (s.totalGoals / 100) + (s.clubsPlayed.size >= 3 ? 2 : 0) + ((s.pillars?.Ambition || 50) >= 60 ? 2 : 0),
      text: (n, s) => `${n} signs one final sunset deal abroad — a last adventure to close the story.`,
      choices: [
        { label: "One final adventure", fx: { finalSeason: { destination: "abroad", note: "Final season abroad" } } },
        { label: "Retire at home", fx: {} },
      ] },
    { id: "lower_league_final", base: 3,
      req: (s) => s.age >= 35 && s.reputation >= 40 && s.totalGoals >= 250,
      score: (s) => ((s.pillars?.Loyalty || 50) >= 60 ? 3 : 0) + ((s.pillars?.Professionalism || 50) >= 60 ? 2 : 0) + (s.reputation < 60 ? 2 : 0),
      text: (n, s) => `${n} drops down the leagues for a heroic final season, mentoring the next generation.`,
      choices: [
        { label: "One last hurrah in the lower leagues", fx: { finalSeason: { destination: "lower leagues", note: "Final season in the lower leagues" } } },
        { label: "Retire a club legend", fx: {} },
      ] },
    { id: "pundit", base: 2,
      req: (s) => s.reputation >= 60 || s.fame >= 50,
      score: (s) => ((s.reputation - 60) / 5) + ((s.fame - 40) / 10) + ((s.pillars?.Ego || 50) >= 60 ? 2 : 0),
      text: (n, s) => `${n} is snapped up by a broadcaster as a star pundit — the face of football analysis.`,
      choices: [{ label: "Head to the studio", fx: { epilogue: "pundit" } }] },
    { id: "manager", base: 2,
      req: (s) => (s.honours.leagueTitles + s.honours.europeanCups) >= 1 || (s.pillars?.Leadership || 50) >= 60,
      score: (s) => (((s.pillars?.Leadership || 50) - 50) / 10) + (s.honours.leagueTitles * 3) + (s.honours.europeanCups * 2) + (s.reputation >= 70 ? 2 : 0),
      text: (n, s) => `${n} moves straight into the dugout, beginning a management career.`,
      choices: [{ label: "Take the manager's job", fx: { epilogue: "manager" } }] },
    { id: "coach", base: 2,
      req: (s) => (s.pillars?.Professionalism || 50) >= 50 || (s.pillars?.Loyalty || 50) >= 60,
      score: (s) => (((s.pillars?.Professionalism || 50) - 50) / 10) + (((s.pillars?.Loyalty || 50) - 50) / 10) + (s.honours.leagueTitles ? 2 : 0),
      text: (n, s) => `${n} steps back from the spotlight and becomes a respected coach, shaping the next generation.`,
      choices: [{ label: "Take the coaching role", fx: { epilogue: "coach" } }] },
    { id: "normal_retirement", base: 4,
      score: (s) => 0,
      text: (n, s) => `${n} calls time on a storied career, hanging up the boots for good at ${s.age}.`,
      choices: [{ label: "Retire a legend", fx: {} }] },
  ];

    return {
      SEASON_DECISIONS,
      EARLY_DEVELOPMENT_DECISIONS,
      CAREER_MILESTONES,
      CAREER_SECTIONS,
      SEASON_TAG_WEIGHTS,
      SEASON_EVENTS,
      CAREER_ENDINGS,
    };
  };
})();
