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
      id: "manager_meeting", category: "STRATEGY", weight: 8,
      text: (n) => `End-of-season review with the manager. ${n} can shape the next campaign now.`,
      choices: (ctx) => [
        { label: "Demand more playing time", fx: { role: "up", rep: -2, pillars: { Ambition: 8, Ego: 4 } } },
        { label: "Ask to stay in the current role", fx: { rep: 2, pillars: { Loyalty: 6, Professionalism: 4 } } },
        { label: "Push for a tactical change", fx: { rep: -1, pillars: { Ambition: 4, Adaptability: 8 } } },
      ],
    },
    {
      id: "training_focus", category: "TRAINING", weight: 5,
      text: (n) => `${n} has one summer focus to sharpen before pre-season.`,
      choices: (ctx) => [
        { label: "Finishing school", fx: { attrChange: { key: "leftFoot", delta: 2 }, carryOver: true, carryOverLog: "Finishing work sharpens the boot next season.", pillars: { KillerInstinct: 8, Professionalism: 4 } } },
        { label: "Pace and movement", fx: { attrChange: { key: "speed", delta: 2 }, carryOver: true, carryOverLog: "Pace work adds half a yard next season.", pillars: { Adaptability: 4, Professionalism: 4 } } },
        { label: "Strength and conditioning", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Strength programme adds power next season.", pillars: { Durability: 6, Professionalism: 6 } } },
        { label: "Fitness and recovery", fx: { attrChange: { key: "fitness", delta: 2 }, carryOver: true, carryOverLog: "Pre-season fitness block pays off next season.", pillars: { Durability: 8, Longevity: 6 } } },
        { label: "Agility and balance", fx: { derivedChange: { agility: 2, balance: 1 }, carryOver: true, carryOverLog: "Agility and balance work sharpens movement next season.", pillars: { Adaptability: 6, Professionalism: 4 } } },
      ],
    },
    {
      id: "squad_role", category: "PLAYING TIME", weight: 4, req: { roleIn: ["Rotation", "Bench"] },
      text: (n) => `${n} is not a guaranteed starter. How do they handle it?`,
      choices: (ctx) => [
        { label: "Knock on the manager's door", fx: { rep: -2, pillars: { Ambition: 8, Ego: 4 } } },
        { label: "Wait for the chance and deliver", fx: { rep: 3, pillars: { Consistency: 6, Professionalism: 4 } } },
        { label: "Ask the agent to find a loan", fx: { rep: -1, forceTransfer: true, pillars: { Ambition: 6, Loyalty: -4 } } },
      ],
    },
    {
      id: "fitness_plan", category: "FITNESS", weight: 5, req: { ageMin: 28 },
      text: (n, ctx) => `At ${ctx.age}, ${n}'s body needs a different plan.`,
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
    {
      id: "trophy_celebration", category: "HONOURS", weight: 4, req: { honourThisSeason: true },
      text: (n) => `${n} just won a major trophy. How to celebrate the achievement?`,
      choices: (ctx) => [
        { label: "Humble gratitude — thank the team", fx: { rep: 4, pillars: { Loyalty: 8, Leadership: 6 } } },
        { label: "Soak in the glory", fx: { fame: 6, rep: 2, pillars: { Ego: 8, Consistency: 2 } } },
        { label: "Immediately focus on the next target", fx: { rep: 3, pillars: { Ambition: 10, Professionalism: 4 } } },
      ],
    },
    {
      id: "injury_recovery", category: "RECOVERY", weight: 3, req: { gamesMissedMin: 6 },
      text: (n) => `${n} is recovering from a significant injury. The comeback plan matters.`,
      choices: (ctx) => [
        { label: "Aggressive rehabilitation — return quickly", fx: { attrChange: { key: "fitness", delta: 1 }, pillars: { Professionalism: 8, Durability: -4 } } },
        { label: "Patient recovery — protect long-term health", fx: { attrChange: { key: "fitness", delta: 2 }, pillars: { Durability: 10, Longevity: 8 } } },
        { label: "Psychological support — rebuild confidence", fx: { pillars: { Consistency: 8, Professionalism: 4 } } },
      ],
    },
    {
      id: "contract_renewal", category: "BUSINESS", weight: 5, req: { yearsMin: 1 },
      text: (n) => `Contract renewal talks are underway. ${n} has leverage.`,
      choices: (ctx) => [
        { label: "Demand a raise", fx: { wealth: 8, rep: -1, pillars: { Ego: 6, Ambition: 4 } } },
        { label: "Accept fair terms", fx: { rep: 2, pillars: { Loyalty: 6, Professionalism: 4 } } },
        { label: "Ask for a release clause", fx: { rep: -2, pillars: { Ambition: 8, Ego: 4 } } },
      ],
    },
    {
      id: "legacy_moment", category: "LEGACY", weight: 2, req: { ageMin: 30, repMin: 60 },
      text: (n) => `${n} is entering the legacy phase. What story to write?`,
      choices: (ctx) => [
        { label: "One-club legend — retire here", fx: { rep: 6, pillars: { Loyalty: 12, Leadership: 8 } } },
        { label: "Conquer new frontiers", fx: { fame: 8, rep: 2, pillars: { Ambition: 10, Adaptability: 6 } } },
        { label: "Mentor the next generation", fx: { rep: 5, pillars: { Leadership: 12, Loyalty: 4 } } },
      ],
    },
    {
      id: "contract_expiring_soon", category: "BUSINESS", weight: 6, req: { contractMax: 1 },
      text: (n) => `${n}'s contract expires in less than a year. Time to negotiate or explore options.`,
      choices: (ctx) => [
        { label: "Demand a new long-term deal", fx: { wealth: 6, rep: -1, pillars: { Ambition: 8, Ego: 6 } } },
        { label: "Accept a shorter extension to stay", fx: { rep: 3, pillars: { Loyalty: 8, Professionalism: 4 } } },
        { label: "Let it run down — keep options open", fx: { pillars: { Ambition: 6, Adaptability: 4 } } },
      ],
    },
    {
      id: "long_term_security", category: "BUSINESS", weight: 5, req: { contractMin: 3 },
      text: (n) => `${n} has signed a long-term contract. How to make the most of this stability?`,
      choices: (ctx) => [
        { label: "Settle in and build a legacy", fx: { rep: 4, pillars: { Loyalty: 10, Consistency: 6 } } },
        { label: "Use it as leverage to demand more wages", fx: { wealth: 6, rep: -2, pillars: { Ego: 8, Ambition: 4 } } },
        { label: "Focus entirely on performance", fx: { rep: 3, pillars: { Professionalism: 10, Consistency: 6 } } },
      ],
    },
    {
      id: "free_agent_interest", category: "BUSINESS", weight: 4, req: { contractMax: 0, ageMin: 25 },
      text: (n) => `${n} is out of contract and a free agent. Elite clubs are circling.`,
      choices: (ctx) => [
        { label: "Sign with a bigger club", fx: { rep: 4, fame: 6, pillars: { Ambition: 10, Ego: 4 } } },
        { label: "Negotiate a lucrative deal at current club", fx: { wealth: 10, rep: 2, pillars: { Ego: 6, Ambition: 4 } } },
        { label: "Take a calculated risk on a project", fx: { rep: 2, pillars: { Adaptability: 8, Ambition: 6 } } },
      ],
    },
    {
      id: "club_director_offer", category: "BUSINESS", weight: 3, req: { ageMin: 32, yearsMin: 3, repMin: 50 },
      text: (n) => `${deps.getState().club} offers ${n} a role as club director, overseeing academy and recruitment.`,
      choices: (ctx) => [
        { label: "Accept the director role", fx: { rep: 6, pillars: { Leadership: 12, Professionalism: 8 } } },
        { label: "Negotiate for more power", fx: { wealth: 8, rep: -2, pillars: { Ambition: 8, Ego: 6 } } },
        { label: "Decline and focus on playing", fx: { pillars: { Professionalism: 4, Consistency: 4 } } },
      ],
    },
    {
      id: "agent_training_choice", category: "DEVELOPMENT", weight: 5,
      text: (n) => `End of season: ${n} can either work with their agent on the next move or focus on intensive training.`,
      choices: (ctx) => [
        { label: "Agent focus — negotiate next contract/transfer", fx: { rep: 2, wealth: 4, pillars: { Ambition: 8, Ego: 4 } } },
        { label: "Training focus — sharpen finishing", fx: { attrChange: { key: "leftFoot", delta: 2 }, carryOver: true, carryOverLog: "Intensive finishing work pays off next season.", pillars: { Professionalism: 8, KillerInstinct: 6 } } },
        { label: "Training focus — build strength and pace", fx: { attrChange: { key: "speed", delta: 1 }, attrChange2: { key: "strength", delta: 1 }, carryOver: true, carryOverLog: "Athletic development programme boosts next season.", pillars: { Durability: 8, Professionalism: 6 } } },
        { label: "Balanced approach — agent + light training", fx: { rep: 1, wealth: 2, attrChange: { key: "fitness", delta: 1 }, carryOver: true, carryOverLog: "Balanced off-season keeps fitness sharp.", pillars: { Professionalism: 6, Adaptability: 4 } } },
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
        { label: "Movement work — sharpen agility and balance", fx: { derivedChange: { agility: 1, balance: 1 }, pillars: { Adaptability: 5, Professionalism: 3 } } },
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
    Early: { min: 17, max: 21, label: "Early", eventCap: 0, weights: { Development: 1.2, Injury: 0.7, "Transfer or Loan": 0.8, Roleplay: 1.0 } },
    Mid: { min: 22, max: 28, label: "Mid", eventCap: 1, weights: { Development: 0.8, Injury: 1.3, "Transfer or Loan": 1.2, Roleplay: 0.9 } },
    Late: { min: 29, max: 33, label: "Late", eventCap: 1, weights: { Development: 0.4, Injury: 1.8, "Transfer or Loan": 1.5, Roleplay: 0.6 } },
    Overtime: { min: 34, max: 99, label: "Overtime", eventCap: 1, weights: { Development: 0, Injury: 2.0, "Transfer or Loan": 1.8, Roleplay: 0.4 } },
  };
  const SEASON_TAG_WEIGHTS = {
    Early: { Development: 1.2, Injury: 0.7, "Transfer or Loan": 0.8, Roleplay: 1.0 },
    Mid: { Development: 0.8, Injury: 1.3, "Transfer or Loan": 1.2, Roleplay: 0.9 },
    Late: { Development: 0.4, Injury: 1.8, "Transfer or Loan": 1.5, Roleplay: 0.6 },
    Overtime: { Development: 0, Injury: 2.0, "Transfer or Loan": 1.8, Roleplay: 0.4 },
  };
  const SEASON_EVENTS = [
    // Development
    { id: "preseason_training", tag: "Development", tone: "neutral", base: 4,
      req: { perf: ["Met Expectation", "Overperformed", "Sensational"], ageMax: 34 },
      text: [
        (n) => `Pre-season is brutal. The coaching staff push ${n} harder than ever.`,
        (n) => `The new fitness coach has ideas. ${n}'s pre-season is the hardest of their career.`,
        (n) => `Double sessions, heat, and a lactate monitor. ${n} is being pushed to a limit.`,
      ],
      choices: [
        { label: "Embrace the workload — build the engine", fx: { attrChange: { key: "fitness", delta: 2 }, carryOver: true, carryOverLog: "Pre-season graft pays off — fitness is up next season." } },
        { label: "Pace yourself — longevity matters", fx: { attrChange: { key: "fitness", delta: 1 } } },
      ] },
    { id: "personal_trainer", tag: "Development", tone: "neutral", base: 3,
      req: { repMin: 40 },
      text: [
        (n) => `${n} hires a specialist finishing coach for the summer.`,
        (n) => `${n} spends the summer with a private finishing coach and a bag of balls.`,
        (n) => `A former striker is hired to work with ${n} one-on-one through July.`,
      ],
      choices: [
        { label: "Improve left foot", fx: { attrChange: { key: "leftFoot", delta: 2 }, carryOver: true, carryOverLog: "Summer finishing work on the left foot pays off next season." } },
        { label: "Improve right foot", fx: { attrChange: { key: "rightFoot", delta: 2 }, carryOver: true, carryOverLog: "Summer finishing work on the right foot pays off next season." } },
      ] },
    { id: "sports_science", tag: "Development", tone: "neutral", base: 3,
      req: { repMin: 35 },
      text: [
        (n) => `The club invests in a new sports science department and targets ${n}.`,
        (n) => `New GPS vests, new data, new targets — and ${n} is the test case.`,
        (n) => `The club's sports science overhaul lands on ${n}'s programme first.`,
      ],
      choices: [
        { label: "Prioritise speed", fx: { attrChange: { key: "speed", delta: 2 }, carryOver: true, carryOverLog: "Sports science programme boosts pace for next season." } },
        { label: "Prioritise strength", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Strength programme shows dividends next season." } },
      ] },
    { id: "career_position_training", tag: "Development", tone: "neutral", base: 4,
      req: { perf: ["Met Expectation", "Overperformed", "Sensational"], ageMax: 32 },
      text: [
        (n) => `${n}'s coach suggests a summer position camp to sharpen one specific area.`,
        (n) => `A specialist camp is booked for the summer. ${n} picks one thing to fix.`,
        (n) => `${n} is told to choose: one area, six weeks, real improvement.`,
      ],
      choices: [
        { label: "Focus on heading", fx: { attrChange: { key: "heading", delta: 3 }, carryOver: true, carryOverLog: "Heading camp pays off next season." } },
        { label: "Focus on finishing", fx: { attrChange: { key: "leftFoot", delta: 2 }, carryOver: true, carryOverLog: "Finishing camp sharpens the left foot next season." } },
        { label: "Focus on pace", fx: { attrChange: { key: "speed", delta: 2 }, carryOver: true, carryOverLog: "Pace work adds yard next season." } },
        { label: "Focus on physicality", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Strength work adds power next season." } },
      ] },
    { id: "tactical_evolution", tag: "Development", tone: "neutral", base: 4,
      req: { traj: ["Mid-table", "Europe", "Title", "Auto Promotion", "Playoffs"], yearsMin: 1 },
      text: [
        (n) => `The manager wants to evolve the system — ${n} will have to adapt.`,
        (n) => `A new system arrives over the summer, and ${n}'s role in it is unclear.`,
        (n) => `The manager redraws the shape. ${n} will have to learn it or lose the shirt.`,
      ],
      choices: [
        { label: "Learn the new role inside-out", fx: { attrChange: { key: "fitness", delta: 1 }, carryOver: true, rep: 2, carryOverLog: "Tactical flexibility improves match fitness next season." } },
        { label: "Stick to what you know", fx: { flag: "managerConflict" } },
      ] },
    { id: "promotion_step_up", tag: "Roleplay", tone: "positive", base: 6,
      req: { traj: ["Auto Promotion"] },
      text: (n) => `Promotion is sealed. ${n} is about to face a completely different level of defender.`,
      choices: [
        { label: "Train all summer for the step up", fx: { rep: 3, attrChange: { key: "speed", delta: 1 }, carryOver: true, carryOverLog: "Summer of hard work readies the body for the top flight." } },
        { label: "Enjoy the promotion party", fx: { fame: 4, rep: -1 } },
      ] },
    { id: "playoff_heartbreak", tag: "Roleplay", tone: "mixed", base: 5,
      req: { traj: ["Playoffs"] },
      text: (n) => `The play-offs decided the season and ${n} is left to process how it ended.`,
      choices: [
        { label: "Use it as fuel for next season", fx: { rep: 2, flag: "inForm" } },
        { label: "Demand a move to a promotion favourite", fx: { rep: -2, forceTransfer: true } },
      ] },
    { id: "nutritionist", tag: "Development", tone: "neutral", base: 3,
      req: { perf: ["Sensational", "Overperformed"] },
      text: [
        (n) => `A nutritionist overhauls ${n}'s diet to squeeze out extra performance.`,
        (n) => `A nutritionist arrives with body-fat calipers and strong opinions about ${n}'s diet.`,
        (n) => `Every meal ${n} eats is now weighed, logged and argued about.`,
      ],
      choices: [
        { label: "Follow the strict plan", fx: { attrChange: { key: "strength", delta: 2 }, carryOver: true, carryOverLog: "Lean muscle gains from the new diet show next season." } },
        { label: "Enjoy the odd cheat meal", fx: { attrChange: { key: "strength", delta: 1 } } },
      ] },

    // Injury
    { id: "minor_injury", tag: "Injury", tone: "negative", base: 4,
      req: { ageMin: 25 },
      text: [
        (n) => `${n} picks up a minor hamstring strain — nothing serious, but timing is frustrating.`,
        (n) => `A tight hamstring pulls ${n} out of training. The scan says days, not weeks.`,
        (n) => `${n} feels something go in the warm-up. It is minor — but the timing is awful.`,
      ],
      choices: [
        { label: "Rush back to help the team", fx: { flag: "injuryProne", injuryProne: 1 } },
        { label: "Take full time to recover properly", fx: { rep: 1 } },
      ] },
    { id: "training_injury", tag: "Injury", tone: "negative", base: 3,
      text: [
        (n) => `A freak training-ground accident leaves ${n} sidelined for weeks.`,
        (n) => `A stray challenge in a five-a-side leaves ${n} on crutches. Nobody meant it.`,
        (n) => `${n} lands awkwardly in a routine drill and does not get up.`,
      ],
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
      text: [
        (n) => `${n} takes a heavy blow to the head. The medical team recommends a cautious protocol.`,
        (n) => `A clash of heads leaves ${n} on the turf and the doctor sprinting on.`,
        (n) => `${n} does not remember the second half. The protocol starts immediately.`,
      ],
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
      text: [
        (n) => `${n} is called up for a major international tournament.`,
        (n, c) => `The squad is announced and ${n} is on the list.`,
        (n) => `${n} gets the call: a major tournament, and a place on the plane.`,
      ],
      choices: [
        { label: "Give everything for the country", fx: { rep: 5, intlCaps: 1, intlGoals: () => deps.randInt(0, 2), flag: "inForm" } },
        { label: "Focus on club fitness", fx: { rep: -2 } },
      ] },

    /* ---- Added to widen the rotation ----
     * The pool was 26 events with a 3-season cooldown, so a long career cycled
     * the same handful in a near-fixed order. These are new situations rather
     * than re-skins, spread across all four tags so every career stage has
     * more it can draw from. */
    { id: "set_piece_duty", tag: "Development", tone: "neutral", base: 3,
      req: { repMin: 45 },
      text: [
        (n) => `The regular penalty taker has left. The manager asks who wants the ball on the spot.`,
        (n) => `Free-kicks and penalties are up for grabs in pre-season. ${n} fancies it.`,
      ],
      choices: [
        { label: "Take the responsibility", fx: { attrChange: { key: "rightFoot", delta: 2 }, rep: 2, carryOver: true, carryOverLog: "Owning set pieces sharpens the shooting next season." } },
        { label: "Leave it to someone else", fx: { attrChange: { key: "fitness", delta: 1 } } },
      ] },
    { id: "video_analysis", tag: "Development", tone: "neutral", base: 3,
      req: { perf: ["Underperformed", "Flop", "Met Expectation"] },
      text: [
        (n) => `The analyst has cut together every chance ${n} missed last season. It is not comfortable viewing.`,
        (n) => `${n} is handed a tablet with ninety minutes of their own worst moments on it.`,
      ],
      choices: [
        { label: "Study every clip honestly", fx: { attrChange: { key: "leftFoot", delta: 2 }, rep: 1, carryOver: true, carryOverLog: "The video work shows in next season's finishing." } },
        { label: "Trust your instincts instead", fx: { rep: -1, flag: "inForm" } },
      ] },
    { id: "veteran_mentor", tag: "Development", tone: "positive", base: 3,
      req: { ageMax: 24, repMin: 30 },
      text: [
        (n) => `A veteran in the dressing room takes ${n} aside and offers to help.`,
        (n) => `The club captain, twelve years older, starts staying behind after training with ${n}.`,
      ],
      choices: [
        { label: "Listen to every word", fx: { attrChange: { key: "heading", delta: 2 }, rep: 2, carryOver: true, carryOverLog: "The veteran's coaching shows up in next season's game." } },
        { label: "Learn your own way", fx: { attrChange: { key: "speed", delta: 1 } } },
      ] },
    { id: "back_spasm", tag: "Injury", tone: "negative", base: 3,
      req: { ageMin: 30 },
      text: [
        (n) => `${n}'s back locks up in the warm-up. It is the third time this year.`,
        (n) => `A recurring back problem starts costing ${n} training days every week.`,
      ],
      choices: [
        { label: "Manage the load carefully", fx: { attrChange: { key: "fitness", delta: -1 }, rep: 1 } },
        { label: "Play every game regardless", fx: { attrChange: { key: "fitness", delta: -2 }, flag: "injuryProne", injuryProne: 1, rep: 2 } },
      ] },
    { id: "illness_layoff", tag: "Injury", tone: "negative", base: 2,
      text: [
        (n) => `A virus goes through the squad and hits ${n} hardest — two weeks of nothing.`,
        (n) => `${n} loses half a stone to illness and comes back weaker than they left.`,
      ],
      choices: [
        { label: "Rebuild slowly and properly", fx: { attrChange: { key: "strength", delta: -1 }, rep: 1 } },
        { label: "Force your way straight back in", fx: { attrChange: { key: "strength", delta: -2 }, flag: "injuryProne", injuryProne: 1 } },
      ] },
    { id: "contract_standoff", tag: "Transfer or Loan", tone: "mixed", base: 4,
      req: { repMin: 55, yearsMin: 2 },
      text: [
        (n) => `Talks over a new deal have stalled. The club's offer is well short of what the agent wants for ${n}.`,
        (n) => `${n}'s agent goes public about the contract negotiations. The club is not pleased.`,
      ],
      choices: [
        { label: "Sit tight and let the club move", fx: { rep: -1, flag: "unsettled" } },
        { label: "Sign what is on the table", fx: { rep: 2, flag: "fanFavorite" } },
      ] },
    { id: "loan_interest", tag: "Transfer or Loan", tone: "mixed", base: 4,
      req: { ageMax: 26, roleIn: ["Bench", "Rotation"] },
      text: [
        (n) => `A club a division below wants ${n} on loan for regular football.`,
        (n) => `${n} is training well but not playing. A loan offer arrives with a guarantee of minutes.`,
      ],
      choices: [
        { label: "Go and play every week", fx: { rep: 2, forceTransfer: true } },
        { label: "Stay and fight for the shirt", fx: { rep: 1, flag: "redemptionArc" } },
      ] },
    { id: "release_clause_leak", tag: "Transfer or Loan", tone: "mixed", base: 3,
      req: { repMin: 65 },
      text: [
        (n) => `${n}'s release clause is leaked to the press, and suddenly every big club knows the number.`,
        (n) => `A journalist prints the exact figure it would take to sign ${n}. The phone starts ringing.`,
      ],
      choices: [
        { label: "Let the club handle it", fx: { rep: 1 } },
        { label: "Tell the world you are available", fx: { rep: -2, forceTransfer: true } },
      ] },
    { id: "captaincy_offer", tag: "Roleplay", tone: "positive", base: 4,
      req: { repMin: 60, yearsMin: 2, ageMin: 26 },
      text: [
        (n) => `The armband is free, and the manager thinks ${n} should wear it.`,
        (n) => `The squad votes. ${n} is asked to captain the club.`,
      ],
      choices: [
        { label: "Lead from the front", fx: { rep: 5, flag: "fanFavorite" } },
        { label: "Decline — just focus on goals", fx: { rep: -1, flag: "inForm" } },
      ] },
    { id: "fan_backlash", tag: "Roleplay", tone: "negative", base: 3,
      req: { perf: ["Flop", "Underperformed"], repMin: 40 },
      text: [
        (n) => `A section of the crowd turns on ${n} during a home defeat.`,
        (n) => `${n}'s name is booed when the team sheet is read out.`,
      ],
      choices: [
        { label: "Front up and apologise publicly", fx: { rep: 2 } },
        { label: "Point at the badge and say nothing", fx: { rep: -2, flag: "mediaTarget" } },
      ] },
    { id: "charity_work", tag: "Roleplay", tone: "positive", base: 3,
      req: { repMin: 45 },
      text: [
        (n) => `A children's hospital near the ground asks ${n} to become a patron.`,
        (n) => `${n} is invited to fund a community pitch in the area they grew up in.`,
      ],
      choices: [
        { label: "Give the time and the money", fx: { rep: 4, wealth: -5 } },
        { label: "Send a signed shirt and stay focused", fx: { rep: -1, flag: "inForm" } },
      ] },
    { id: "documentary_offer", tag: "Roleplay", tone: "mixed", base: 3,
      req: { repMin: 65, fame: 50 },
      text: [
        (n) => `A streaming service wants to follow ${n} for a full season, cameras in the house and all.`,
        (n) => `${n} is offered a documentary deal — total access, total exposure.`,
      ],
      choices: [
        { label: "Let the cameras in", fx: { fame: 12, rep: -2, flag: "mediaTarget" } },
        { label: "Keep your private life private", fx: { rep: 3 } },
      ] },
  ];
  /* ---------------------------- CAREER ENDINGS ----------------------------
   * How a career closes. One of these fires when retirement is triggered.
   *
   * IMPORTANT — why these gates look the way they do: every ending here used
   * to be gated on `s.pillars?.X || 50`, and `state.pillars` is permanently
   * null (pillars were removed from gameplay; see migrateState). That made
   * the expression a hard-coded 50 in every ending, so nine of the sixteen
   * could NEVER fire — `>= 55`, `>= 65`, `>= 70` and `>= 75` are all false
   * against a constant 50 — and `released_on_free` read `s.contractLength`,
   * a field that does not exist on state at all (it is `contractYears`).
   * Players saw the same handful of endings every single career.
   *
   * Every gate below now reads a field the career actually maintains:
   * reputation, fame, wealth, yearsAtClub, clubsPlayed, honours, intlCaps,
   * intlCaptain, totalGoals, age, contractYears. The SPIRIT of each ending is
   * preserved — the loyal one-club servant still becomes an ambassador, the
   * well-travelled pro still moves into agency work — the signal is just one
   * the game genuinely tracks.
   *
   * `text` may be a single function/string OR an array of variants; the
   * renderer picks one per firing (see resolveEventText in game.js), so the
   * same ending does not read word-for-word identically every time.
   */
  const CAREER_ENDINGS = [
    { id: "injury_retirement", base: 2,
      req: (s) => s.injuryProneSeasons > 0 || s.injuryProneness > 60 || s.age >= 35,
      score: (s) => (s.injuryProneSeasons * 4) + ((s.injuryProneness - 50) / 10) + (s.age >= 35 ? 3 : 0),
      text: [
        (n, s) => `A cruel injury forces ${n} into an early, unwanted retirement at ${s.age}.`,
        (n, s) => `The specialist is blunt: the knee will not take another season. ${n} is done at ${s.age}.`,
        (n, s) => `One challenge too many. At ${s.age}, ${n}'s body finally refuses to answer.`,
      ],
      choices: [{ label: "Bow out with head held high", fx: { rep: -2 } }] },
    { id: "last_dance_abroad", base: 3,
      req: (s) => s.age >= 33 && s.reputation >= 55 && s.totalGoals >= 300,
      score: (s) => ((s.reputation - 50) / 10) + (s.totalGoals / 100) + (s.clubsPlayed.size >= 3 ? 2 : 0),
      text: [
        (n) => `${n} signs one final sunset deal abroad — a last adventure to close the story.`,
        (n) => `An offer arrives from overseas: big money, warm weather, one more year of football for ${n}.`,
        (n) => `A league on the other side of the world wants a marquee name. ${n} is the name.`,
      ],
      choices: [
        { label: "One final adventure", fx: { finalSeason: { destination: "abroad", note: "Final season abroad" } } },
        { label: "Retire at home", fx: {} },
      ] },
    { id: "lower_league_final", base: 3,
      req: (s) => s.age >= 35 && s.reputation >= 40 && s.totalGoals >= 250,
      score: (s) => (s.clubsPlayed.size <= 2 ? 3 : 0) + (s.yearsAtClub >= 4 ? 2 : 0) + (s.reputation < 60 ? 2 : 0),
      text: [
        (n) => `${n} drops down the leagues for a heroic final season, mentoring the next generation.`,
        (n) => `A struggling lower-league side asks ${n} for one season — as much for the dressing room as the goals.`,
        (n) => `No fanfare, no cameras: just a small club, a small crowd, and one more year for ${n}.`,
      ],
      choices: [
        { label: "One last hurrah in the lower leagues", fx: { finalSeason: { destination: "lower leagues", note: "Final season in the lower leagues" } } },
        { label: "Retire a club legend", fx: {} },
      ] },
    { id: "pundit", base: 2,
      req: (s) => s.reputation >= 60 || s.fame >= 50,
      score: (s) => ((s.reputation - 60) / 5) + ((s.fame - 40) / 10),
      text: [
        (n) => `${n} is snapped up by a broadcaster as a star pundit — the face of football analysis.`,
        (n) => `The Saturday-night studio wants a new voice. ${n} signs before the boots are even off.`,
        (n) => `A rival network doubles the offer. ${n} will be on television by August.`,
      ],
      choices: [{ label: "Head to the studio", fx: { epilogue: "pundit" } }] },
    { id: "manager", base: 2,
      // A dugout job needs proof you can win, or that you led on the pitch.
      req: (s) => (s.honours.leagueTitles + s.honours.europeanCups) >= 1 || s.intlCaptain,
      score: (s) => (s.honours.leagueTitles * 3) + (s.honours.europeanCups * 2) + (s.intlCaptain ? 3 : 0) + (s.reputation >= 70 ? 2 : 0),
      text: [
        (n) => `${n} moves straight into the dugout, beginning a management career.`,
        (n) => `The badges are already done. ${n} takes a first job in management within weeks.`,
        (n) => `A former club comes calling — not for a testimonial, but for a manager.`,
      ],
      choices: [{ label: "Take the manager's job", fx: { epilogue: "manager" } }] },
    { id: "coach", base: 2,
      // The default backroom path — open to any long professional career.
      req: (s) => s.season >= 8,
      score: (s) => (s.season / 4) + (s.honours.leagueTitles ? 2 : 0) + (s.reputation < 65 ? 2 : 0),
      text: [
        (n) => `${n} steps back from the spotlight and becomes a respected coach, shaping the next generation.`,
        (n) => `No cameras, no armband — just a tracksuit, a whistle, and a group of teenagers to teach.`,
        (n) => `${n} joins the backroom staff, passing on twenty years of hard-won detail.`,
      ],
      choices: [{ label: "Take the coaching role", fx: { epilogue: "coach" } }] },
    { id: "club_ambassador", base: 2,
      // The loyal servant: a long stay at one club, and few clubs overall.
      req: (s) => s.yearsAtClub >= 5 && s.clubsPlayed.size <= 3 && s.reputation >= 50,
      score: (s) => (s.yearsAtClub) + (s.honours.leagueTitles * 2) + (s.clubsPlayed.size <= 2 ? 3 : 0),
      text: [
        (n) => `${n} becomes a global ambassador for the club, forever tied to its badge.`,
        (n) => `There is a statue outside the ground now. ${n} is asked to stay on and represent the club worldwide.`,
        (n) => `One badge, one story. The club makes ${n} its ambassador for life.`,
      ],
      choices: [{ label: "Become club ambassador", fx: { epilogue: "ambassador" } }] },
    { id: "agent_scout", base: 2,
      // The well-travelled pro who knows every dressing room and every market.
      req: (s) => s.clubsPlayed.size >= 4,
      score: (s) => (s.clubsPlayed.size * 1.5) + (s.reputation >= 60 ? 2 : 0) + (s.wealth >= 55 ? 2 : 0),
      text: [
        (n) => `${n} moves into the business side of the game, becoming a sharp agent and scout.`,
        (n) => `Five dressing rooms, five markets, a contacts book nobody else has — ${n} turns it into a business.`,
        (n) => `${n} starts representing young players, having learned the hard way how the deals really work.`,
      ],
      choices: [{ label: "Enter the agent world", fx: { epilogue: "agent" } }] },
    { id: "academy_director", base: 2,
      // Came through an academy, stayed long enough to owe one something back.
      req: (s) => s.season >= 10 && (s.honours.youngPlayer >= 1 || s.yearsAtClub >= 4),
      score: (s) => (s.honours.youngPlayer * 3) + (s.yearsAtClub / 2) + (s.season / 6),
      text: [
        (n) => `${n} takes charge of a club academy, dedicated to developing the next generation.`,
        (n) => `The academy that made ${n} asks for a director. There is only one answer.`,
        (n) => `${n} takes over youth development, determined that the next one gets a better run at it.`,
      ],
      choices: [{ label: "Run the academy", fx: { epilogue: "academyDirector" } }] },
    { id: "business_mogul", base: 2,
      req: (s) => s.wealth >= 60 && s.fame >= 50,
      score: (s) => ((s.wealth - 50) / 8) + ((s.fame - 40) / 10),
      text: [
        (n) => `${n} pivots into business, building a commercial empire off the back of a football fortune.`,
        (n) => `The boots come off and the suits go on: ${n} turns a fortune into an empire.`,
        (n) => `Property, media, a clothing label — ${n}'s second career is bigger business than the first.`,
      ],
      choices: [{ label: "Build the business empire", fx: { epilogue: "businessMogul" } }] },
    { id: "hometown_hero", base: 3,
      // Never chased the money: few clubs, modest fame, real standing.
      req: (s) => s.clubsPlayed.size <= 2 && s.reputation >= 50 && s.fame < 70,
      score: (s) => ((s.reputation - 40) / 10) + (s.clubsPlayed.size === 1 ? 4 : 2),
      text: [
        (n) => `${n} returns home to grassroots football, giving back to the community that raised them.`,
        (n) => `A local pitch, a set of donated kits, and ${n} running sessions on a Sunday morning.`,
        (n) => `${n} goes back to where it started — the same club, the same park, thirty years on.`,
      ],
      choices: [{ label: "Give back to the community", fx: { epilogue: "hometownHero" } }] },
    { id: "released_on_free", base: 2,
      // NB contractYears, not contractLength — the latter is not a state field.
      req: (s) => s.age >= 32 && (s.contractYears || 0) <= 0,
      score: (s) => (s.age >= 35 ? 3 : 1) + (s.reputation < 55 ? 2 : 0) + (s.injuryProneness > 55 ? 2 : 0),
      text: [
        (n, s) => `${n}'s contract expires and the club decides not to renew. Released on a free transfer at ${s.age}.`,
        (n, s) => `The email arrives in June: no new deal. At ${s.age}, ${n} is a free agent nobody is rushing to sign.`,
        (n) => `The club thanks ${n} for their service in a two-line statement, and moves on.`,
      ],
      choices: [
        { label: "Sign with a smaller club for one last season", fx: { finalSeason: { destination: "lower leagues", note: "Final season after release" } } },
        { label: "Retire with dignity", fx: {} },
      ] },
    { id: "club_director_path", base: 2,
      // Boardroom, not touchline: needs standing at a club AND silverware.
      req: (s) => s.yearsAtClub >= 5 && (s.honours.leagueTitles + s.honours.europeanCups + s.honours.domesticCups) >= 2,
      score: (s) => (s.yearsAtClub / 2) + (s.honours.leagueTitles * 2) + (s.reputation >= 70 ? 3 : 0),
      text: [
        (n) => `${n} transitions from player to director, taking charge of the club's future strategy and academy development.`,
        (n) => `${n} swaps the training ground for the boardroom, with a say over everything from transfers to the academy.`,
        (n) => `The owners want someone who understands the dressing room. ${n} is made a director.`,
      ],
      choices: [{ label: "Become club director", fx: { epilogue: "clubDirector" } }] },
    { id: "conspiracy_theorist", base: 1,
      // Famous, but the reputation never matched the noise.
      req: (s) => s.fame >= 60 && s.reputation < 60,
      score: (s) => ((s.fame - 50) / 8) + ((60 - s.reputation) / 8),
      text: [
        (n) => `${n} retires from football and becomes an internet personality, posting conspiracy theories and hot takes on social media.`,
        (n) => `${n}'s account starts posting at 3am about what "they" don't want you to know. The engagement is enormous.`,
        (n) => `The podcast launches within a month. The takes get worse, and more popular, every week.`,
      ],
      choices: [{ label: "Become a social media provocateur", fx: { epilogue: "conspiracyTheorist" } }] },
    { id: "rural_farmer", base: 1,
      // Walked away quietly: low fame, no interest in the circus.
      req: (s) => s.fame < 45 && s.season >= 8,
      score: (s) => ((45 - s.fame) / 6) + (s.clubsPlayed.size <= 2 ? 2 : 0),
      text: [
        (n) => `${n} leaves football behind entirely, buying a farm in the countryside to live a quiet, simple life away from the spotlight.`,
        (n) => `No book, no podcast, no farewell tour. ${n} buys a smallholding and stops answering the phone.`,
        (n) => `${n} is spotted a year later at a country market, and politely declines to talk about football.`,
      ],
      choices: [{ label: "Become a rural farmer", fx: { epilogue: "ruralFarmer" } }] },

    /* ---- Endings added to widen the pool beyond the same handful ---- */
    { id: "testimonial_farewell", base: 3,
      // A full house says goodbye — earned by staying somewhere long enough.
      req: (s) => s.yearsAtClub >= 4 && s.reputation >= 55,
      score: (s) => (s.yearsAtClub) + ((s.reputation - 50) / 8),
      text: [
        (n) => `A packed house turns out for ${n}'s testimonial. The old team-mates come back for one night.`,
        (n) => `The club announces a testimonial. It sells out in under an hour.`,
      ],
      choices: [
        { label: "Take the applause and retire", fx: { rep: 3 } },
        { label: "Sign on for one more year off the back of it", fx: { extend: true, note: "One more season after the testimonial" } },
      ] },
    { id: "national_farewell", base: 3,
      // The international send-off, for a career that meant something to a country.
      req: (s) => s.intlCaps >= 40 && s.intlGoals >= 10,
      score: (s) => (s.intlCaps / 12) + (s.intlGoals / 8) + (s.honours.intlTrophies * 3) + (s.intlCaptain ? 2 : 0),
      text: [
        (n, s) => `${s.country} gives ${n} a farewell cap — a full stadium, an armband, and ninety minutes to say goodbye.`,
        (n, s) => `The national federation schedules a friendly purely so ${n} can walk off to an ovation.`,
      ],
      choices: [{ label: "Walk off to an ovation", fx: { rep: 4, epilogue: "nationalIcon" } }] },
    { id: "media_meltdown", base: 1,
      // A famous name and a poor final season: the press smells blood.
      req: (s) => s.fame >= 55 && s.reputation < 55 && s.age >= 32,
      score: (s) => ((s.fame - 50) / 8) + ((55 - s.reputation) / 8),
      text: [
        (n) => `A leaked dressing-room row ends ${n}'s season, and the club's patience, in the same week.`,
        (n) => `The back pages run the story for six days straight. ${n} never plays for the club again.`,
      ],
      choices: [
        { label: "Retire rather than answer the questions", fx: { rep: -4 } },
        { label: "Rebuild the name somewhere smaller", fx: { rep: -1, finalSeason: { destination: "lower leagues", note: "Final season rebuilding a reputation" } } },
      ] },
    { id: "goal_record_chase", base: 2,
      // Retiring within touching distance of the number the whole game is about.
      req: (s) => s.totalGoals >= 700 && s.totalGoals < 1000,
      score: (s) => (s.totalGoals - 650) / 25,
      text: [
        (n, s) => `${n} finishes on ${s.totalGoals} career goals — close enough to the thousand to feel it, far enough to hurt.`,
        (n, s) => `The record stays out of reach by ${1000 - s.totalGoals}. ${n} has to decide whether one more year is worth it.`,
      ],
      choices: [
        { label: "Chase it for one more season", fx: { extend: true, note: "One more season chasing the record" } },
        { label: "Accept the number and retire", fx: { rep: 2 } },
      ] },
    { id: "player_coach", base: 2,
      // The veteran who is already half a coach in the dressing room.
      req: (s) => s.age >= 34 && s.season >= 12,
      score: (s) => (s.age - 32) + (s.honours.leagueTitles ? 2 : 0),
      text: [
        (n) => `The club offers ${n} a player-coach role: train the kids, and start a handful of games.`,
        (n) => `${n} is handed a clipboard as often as a shirt now. The club makes it official.`,
      ],
      choices: [
        { label: "Take the hybrid role for one more year", fx: { extend: true, note: "Final season as player-coach" } },
        { label: "Go into coaching full time", fx: { epilogue: "coach" } },
      ] },
    { id: "quiet_release", base: 2,
      // The unremarkable ending — no statue, no studio, no farewell.
      req: (s) => s.reputation < 50 && s.age >= 31,
      score: (s) => ((50 - s.reputation) / 6) + (s.totalGoals < 200 ? 3 : 0),
      text: [
        (n) => `There is no announcement. ${n} simply stops being named in a squad, and that is that.`,
        (n) => `The retirement makes a single paragraph on the club website, below the youth-team results.`,
      ],
      choices: [{ label: "Slip quietly out of the game", fx: {} }] },

    { id: "normal_retirement", base: 4,
      score: (s) => 0,
      text: [
        (n, s) => `${n} calls time on a storied career, hanging up the boots for good at ${s.age}.`,
        (n, s) => `At ${s.age}, ${n} announces it: one last handshake with the manager, and it is over.`,
        (n, s) => `${n} retires at ${s.age}, on their own terms and at a time of their own choosing.`,
      ],
      choices: [{ label: "Retire a legend", fx: {} }] },
  ];

  /* -------------------- VALIDATION FUNCTIONS --------------------
   * Ensure data integrity at load time
   */
  function validateEventData(data) {
    const ids = new Set();
    const errors = [];
    
    const allEvents = [
      ...data.SEASON_DECISIONS,
      ...data.EARLY_DEVELOPMENT_DECISIONS,
      ...data.CAREER_MILESTONES,
      ...data.SEASON_EVENTS,
      ...data.CAREER_ENDINGS,
    ];
    
    for (const event of allEvents) {
      if (!event.id) {
        errors.push("Event missing id field");
        continue;
      }
      if (ids.has(event.id)) {
        errors.push(`Duplicate event ID: ${event.id}`);
      }
      ids.add(event.id);
    }
    
    if (errors.length > 0) {
      throw new Error(`Event data validation failed:\n${errors.join("\n")}`);
    }
    
    return true;
  }

  /* -------------------- EVENT DIFFICULTY SCALING --------------------
   * Adapt event weight and effects based on player performance tier
   * Sensational players get harder choices, Flop players get easier ones
   */
  function getPerformanceTierMultiplier(performanceTier) {
    const multipliers = {
      "Sensational": 1.3,      // Harder challenges, bigger rewards
      "Overperformed": 1.15,   // Slightly harder
      "Met Expectation": 1.0,  // Normal
      "Underperformed": 0.85,  // Easier
      "Flop": 0.7,             // Much easier
    };
    return multipliers[performanceTier] || 1.0;
  }

  function scaleEventWeight(baseWeight, performanceTier) {
    const multiplier = getPerformanceTierMultiplier(performanceTier);
    return Math.round(baseWeight * multiplier);
  }

  function scaleEffectValue(baseValue, performanceTier, isPositive = true) {
    const multiplier = getPerformanceTierMultiplier(performanceTier);
    if (isPositive) {
      // Sensational players get bigger rewards
      return Math.round(baseValue * multiplier);
    } else {
      // Sensational players face bigger penalties
      return Math.round(baseValue * multiplier);
    }
  }

  /* -------------------- CAREER MOMENTUM TRACKING --------------------
   * Track decision patterns to create narrative momentum
   * Consecutive similar choices unlock special events and bonuses
   */
  function createMomentumTracker() {
    return {
      lastChoices: [],        // Last 5 choices made
      streakType: null,       // Current streak type (e.g., "ambitious", "loyal")
      streakLength: 0,        // How many consecutive similar choices
      momentumScore: 0,       // 0-100, affects event selection
      
      recordChoice: function(choiceLabel, effectPillars) {
        // Determine choice type from pillars
        let choiceType = null;
        if (effectPillars?.Ambition > 5) choiceType = "ambitious";
        else if (effectPillars?.Loyalty > 5) choiceType = "loyal";
        else if (effectPillars?.Professionalism > 5) choiceType = "professional";
        else if (effectPillars?.Adaptability > 5) choiceType = "adaptable";
        else if (effectPillars?.Leadership > 5) choiceType = "leader";
        
        this.lastChoices.push({ type: choiceType, label: choiceLabel });
        if (this.lastChoices.length > 5) this.lastChoices.shift();
        
        // Update streak
        if (choiceType === this.streakType) {
          this.streakLength++;
          this.momentumScore = Math.min(100, this.momentumScore + 10);
        } else {
          this.streakType = choiceType;
          this.streakLength = 1;
          this.momentumScore = Math.max(0, this.momentumScore - 5);
        }
      },
      
      getMomentumBonus: function() {
        // Bonus effects when streak reaches certain lengths
        if (this.streakLength >= 5) return { rep: 3, pillars: { Consistency: 8 } };
        if (this.streakLength >= 3) return { rep: 1, pillars: { Consistency: 4 } };
        return {};
      },
      
      getStreakDescription: function() {
        const descriptions = {
          ambitious: "on an ambitious streak",
          loyal: "showing loyalty",
          professional: "being professional",
          adaptable: "adapting well",
          leader: "showing leadership",
        };
        return descriptions[this.streakType] || "making varied choices";
      }
    };
  }

  /* -------------------- CONTEXT SCHEMA --------------------
   * Formal schema for context object used in requirement checking
   */
  const CONTEXT_SCHEMA = {
    age: "number",
    role: "string (Star|Starter|Rotation|Bench)",
    yearsAtClub: "number",
    reputation: "number",
    performance: "string (Sensational|Overperformed|Met Expectation|Underperformed|Flop)",
    contractYears: "number",
    gamesMissed: "number",
    trajectory: "string",
    intlCaps: "number",
    intlRetired: "boolean",
    wonHonour: "boolean",
    season: "number",
  };

  /* -------------------- PILLAR SYNERGY SYSTEM --------------------
   * Complementary pillars boost each other when both are high
   * Creates emergent character archetypes
   */
  function calculatePillarSynergies(pillars) {
    const synergies = {};
    
    // Ambition + Leadership = Visionary (rep boost)
    if ((pillars.Ambition || 50) >= 60 && (pillars.Leadership || 50) >= 60) {
      synergies.visionary = { rep: 2, fame: 1 };
    }
    
    // Loyalty + Professionalism = Reliable (contract boost)
    if ((pillars.Loyalty || 50) >= 60 && (pillars.Professionalism || 50) >= 60) {
      synergies.reliable = { contract: 1, rep: 1 };
    }
    
    // Adaptability + Consistency = Versatile (role flexibility)
    if ((pillars.Adaptability || 50) >= 60 && (pillars.Consistency || 50) >= 60) {
      synergies.versatile = { attrBonus: 1 };
    }
    
    // KillerInstinct + Durability = Relentless (goal boost)
    if ((pillars.KillerInstinct || 50) >= 60 && (pillars.Durability || 50) >= 60) {
      synergies.relentless = { goals: 2, rep: 1 };
    }
    
    // Leadership + Loyalty = Captain (intl boost)
    if ((pillars.Leadership || 50) >= 65 && (pillars.Loyalty || 50) >= 65) {
      synergies.captain = { intlCaps: 1, rep: 2 };
    }
    
    return synergies;
  }

  function describeSynergies(synergies) {
    const descriptions = [];
    if (synergies.visionary) descriptions.push("visionary leader");
    if (synergies.reliable) descriptions.push("reliable professional");
    if (synergies.versatile) descriptions.push("versatile player");
    if (synergies.relentless) descriptions.push("relentless competitor");
    if (synergies.captain) descriptions.push("natural captain");
    return descriptions;
  }

  /* -------------------- EFFECT SCHEMA --------------------
   * Formal schema for effect objects applied to player state
   */
  const EFFECT_SCHEMA = {
    attrChange: { key: "string", delta: "number" },
    attrChange2: { key: "string", delta: "number" },
    derivedChange: { agility: "number", balance: "number" },
    rep: "number",
    fame: "number",
    wealth: "number",
    role: "string (up|down)",
    forceTransfer: "boolean",
    pillars: { "[pillarName]": "number" },
    flag: "string",
    carryOver: "boolean",
    carryOverLog: "string",
    contract: "number",
    intlCaps: "number",
    intlGoals: "number",
    setIntlRetired: "boolean",
    retireNow: "boolean",
    finalSeason: { destination: "string", note: "string" },
    epilogue: "string",
    goals: "function|number",
    assists: "function|number",
    positionChange: "string",
    injuryProne: "number",
  };

  // Validate event data at load time
  try {
    validateEventData({
      SEASON_DECISIONS,
      EARLY_DEVELOPMENT_DECISIONS,
      CAREER_MILESTONES,
      SEASON_EVENTS,
      CAREER_ENDINGS,
    });
  } catch (err) {
    console.error("Career event data validation error:", err.message);
    if (typeof window !== "undefined" && window.console) {
      console.error(err);
    }
  }

    return {
      SEASON_DECISIONS,
      EARLY_DEVELOPMENT_DECISIONS,
      CAREER_MILESTONES,
      CAREER_SECTIONS,
      SEASON_TAG_WEIGHTS,
      SEASON_EVENTS,
      CAREER_ENDINGS,
      CONTEXT_SCHEMA,
      EFFECT_SCHEMA,
      validateEventData,
      getPerformanceTierMultiplier,
      scaleEventWeight,
      scaleEffectValue,
      createMomentumTracker,
      calculatePillarSynergies,
      describeSynergies,
    };
  };
  
  // Initialize with empty deps for now; game.js will call this with proper deps
  if (typeof window !== "undefined" && !window.__CAREER_EVENT_DATA_INITIALIZED__) {
    window.__CAREER_EVENT_DATA_INITIALIZED__ = true;
  }
})();
