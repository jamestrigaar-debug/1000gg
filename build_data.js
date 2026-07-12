/* ============================================================================
 * BUILD SCRIPT — generates data.js from 686 Premier League roster JSON files.
 * Emits the FULL data.js (constants + PLAYER_DATABASE + exports).
 *
 * Source data lives in /home/trigaar/Downloads/DATA_JSON/ (Season_1992..Season_2024).
 * Run with: node build_data.js /path/to/DATA_JSON ./data.js
 *
 * Alpha 1.1 changes:
 *  - Peak ratings: each player is seeded by their ID only, so the SAME player
 *    has identical (peak) attributes across every season/squad they appear in.
 *  - Legend boosting: known greats are lifted to tiered peak ratings.
 *  - New mentality system: a descriptive trait + a HIDDEN numeric rating.
 *  - Position codes + a per-player peak "overall".
 *  - Club -> academy tier mapping used by the new academy club-roll.
 * ========================================================================== */
const fs = require("fs");
const path = require("path");

const ATTACH = process.env.ATTACH_DIR || (process.argv[2] || "./attachments");
const OUT = process.env.OUT_FILE || (process.argv[3] || "./data.js");

/* ---- deterministic RNG (seeded per player id, for peak-rating stability) ---- */
function seedFrom(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/* ------------------------------------------------------------------ *
 * CSV PARSER (handles quoted fields for EA FC data)
 * ------------------------------------------------------------------ */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"') {
        if (next === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else { cell += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(cell); cell = ""; }
      else if (c === '\n' || c === '\r') {
        if (cell.length || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; }
      } else { cell += c; }
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function normName(s) {
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function loadEAFC(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const rows = parseCSV(fs.readFileSync(filePath, "utf8"));
  if (rows.length < 2) return {};
  const headers = rows[0];
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < headers.length) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = r[j];
    const name = (obj.commonName || `${obj.firstName || ""} ${obj.lastName || ""}`).trim();
    if (!name) continue;
    out[normName(name)] = obj;
  }
  return out;
}

const EAFC_DIR = path.join(__dirname, "data");
const EAFC_OUTFIELD = loadEAFC(path.join(EAFC_DIR, "ea_fc26_players.csv"));
const EAFC_GK = loadEAFC(path.join(EAFC_DIR, "ea_fc26_goalkeepers.csv"));
const EAFC = { ...EAFC_OUTFIELD, ...EAFC_GK };

/* ------------------------------------------------------------------ *
 * MENTALITY SYSTEM (hidden rating + descriptive trait)
 * ~75% neutral/balanced, ~25% rarer & more impactful (some negative).
 * ------------------------------------------------------------------ */
const NEUTRAL_TRAITS = ["Calm", "Composed", "Professional", "Steady", "Balanced",
  "Grounded", "Level-Headed", "Measured", "Reliable", "Focused", "Diligent",
  "Team Player", "Dependable", "Unflappable", "Adaptable", "Consistent",
  "Quiet", "Modest", "Honest", "Understated"];

// special traits: [name, min, max, tag]
const SPECIAL_TRAITS = [
  ["Leader", 74, 88, "leader"],
  ["Big Game Player", 78, 92, "clutch"],
  ["Ice Cold", 80, 94, "clutch"],
  ["Fearless", 72, 88, "aggressive"],
  ["Relentless", 74, 90, "workrate"],
  ["Determined", 70, 86, "workrate"],
  ["Perfectionist", 68, 86, "consistency"],
  ["Winner", 80, 93, "winner"],
  ["Talisman", 82, 95, "talisman"],
  ["Maverick", 55, 92, "volatile"],
  ["Mercurial", 45, 90, "volatile"],
  ["Temperamental", 28, 58, "negative"],
];
const SPECIAL_POSITIVE = SPECIAL_TRAITS.filter((t) => t[3] !== "negative" && t[3] !== "volatile");

function pickMentality(rng, isLegend) {
  if (isLegend) {
    if (rng() < 0.8) {
      const t = pick(rng, SPECIAL_POSITIVE);
      const mid = Math.round((t[1] + t[2]) / 2);
      return { trait: t[0], rating: ri(rng, mid, t[2]) };
    }
    return { trait: pick(rng, NEUTRAL_TRAITS), rating: ri(rng, 62, 74) };
  }
  if (rng() < 0.25) {
    const t = pick(rng, SPECIAL_TRAITS);
    return { trait: t[0], rating: ri(rng, t[1], t[2]) };
  }
  return { trait: pick(rng, NEUTRAL_TRAITS), rating: ri(rng, 44, 70) };
}

/* ------------------------------------------------------------------ *
 * POSITION GROUPS + attribute ranges
 * ------------------------------------------------------------------ */
function posGroup(pos) {
  const p = (pos || "").toLowerCase();
  if (p.includes("goalkeep")) return "GK";
  if (p.includes("centre-back") || p === "defender") return "CB";
  if (p.includes("-back")) return "FB";
  if (p.includes("defensive mid")) return "DM";
  if (p.includes("central mid") || p.includes("left mid") || p.includes("right mid")) return "CM";
  if (p.includes("attacking mid")) return "AM";
  if (p.includes("wing")) return "WG";
  if (p.includes("forward") || p.includes("striker")) return "FW";
  return "CM";
}

const RANGES = {
  // Audit bands: Average/Squad 65-79, Below Average 55-64, Low 45-54.
  // Non-legend base generation is weighted into Average/Squad and Below Average.
  GK: { heading: [46, 76], speed: [38, 60], strength: [52, 78], defH: 190 },
  CB: { heading: [55, 80], speed: [48, 70], strength: [58, 82], defH: 187 },
  FB: { heading: [42, 66], speed: [60, 84], strength: [46, 70], defH: 179 },
  DM: { heading: [48, 72], speed: [52, 74], strength: [54, 76], defH: 182 },
  CM: { heading: [45, 68], speed: [54, 76], strength: [48, 72], defH: 180 },
  AM: { heading: [40, 64], speed: [60, 84], strength: [42, 66], defH: 178 },
  WG: { heading: [35, 60], speed: [68, 90], strength: [38, 64], defH: 177 },
  FW: { heading: [50, 78], speed: [60, 84], strength: [50, 78], defH: 184 },
};

// headline attributes by position group (the ones lifted highest for legends)
const HEADLINE = {
  GK: ["strength", "heading"],
  CB: ["heading", "strength"],
  FB: ["speed", "strength"],
  DM: ["strength", "heading"],
  CM: ["fitness", "strength"],
  AM: ["speed"],
  WG: ["speed"],
  FW: ["heading", "speed"],
};

function parseHeight(h, defH) {
  if (!h) return defH;
  const m = String(h).replace("m", "").replace(",", ".").trim();
  const v = parseFloat(m);
  if (isNaN(v) || v < 1.4 || v > 2.2) return defH;
  return Math.round(v * 100);
}

/* ------------------------------------------------------------------ *
 * LEGENDS — audit-calibrated tiered peak ratings.
 * L = Legendary (95-99), E = Elite (90-94), VG = Very Good (85-89),
 * G = Good (80-84). Matched by accent-insensitive name.
 * ------------------------------------------------------------------ */
const TIER_INFO = {
  "L":  { overall: 97, floor: 90 }, // Legendary 95-99
  "E":  { overall: 92, floor: 86 }, // Elite 90-94
  "VG": { overall: 87, floor: 82 }, // Very Good 85-89
  "G":  { overall: 82, floor: 76 }, // Good 80-84
};
const LEGEND_TIERS = {
  "L": [
    "Thierry Henry", "Alan Shearer", "Cristiano Ronaldo", "Wayne Rooney",
    "Kevin De Bruyne", "Mohamed Salah", "Ryan Giggs", "Dennis Bergkamp",
    "Erling Haaland", "Sergio Aguero", "Luis Suarez", "Peter Schmeichel",
    "Petr Cech", "John Terry", "Virgil van Dijk", "Roy Keane", "Patrick Vieira",
    "Steven Gerrard", "Frank Lampard", "N'Golo Kante", "Ashley Cole",
    "Rio Ferdinand", "Nemanja Vidic", "David Silva", "Paul Scholes", "Didier Drogba",
  ],
  "E": [
    "Harry Kane", "Robin van Persie", "Gareth Bale", "Eden Hazard", "Carlos Tevez",
    "Fernando Torres", "Andy Cole", "Jermain Defoe", "Ian Wright", "Teddy Sheringham",
    "Dwight Yorke", "Ruud van Nistelrooy", "Michael Owen", "David Beckham", "Sadio Mane",
    "Raheem Sterling", "Son Heung-min", "Robert Pires", "Marc Overmars", "Riyad Mahrez",
    "Alexis Sanchez", "Cesc Fabregas", "Claude Makelele", "Michael Carrick", "Xabi Alonso",
    "Bernardo Silva", "Rodri", "Fernandinho", "Nemanja Matic", "Michael Essien",
    "Phil Foden", "Yaya Toure", "Ricardo Carvalho", "Jaap Stam", "Sol Campbell",
    "Ruben Dias", "Tony Adams", "William Gallas", "Steve Bruce", "Gary Pallister",
    "Gary Neville", "Denis Irwin", "Patrice Evra", "Andy Robertson", "Trent Alexander-Arnold",
    "David Seaman", "David de Gea", "Alisson Becker", "Ederson", "Eric Cantona", "Jamie Vardy",
  ],
  "VG": [
    "Romelu Lukaku", "Emile Heskey", "Nicolas Anelka", "Demba Ba", "Peter Crouch",
    "Les Ferdinand", "Dion Dublin", "Leroy Sane", "Andrei Kanchelskis", "Lee Sharpe",
    "Damien Duff", "Shaun Wright-Phillips", "Antonio Valencia", "Ashley Young",
    "Jesus Navas", "Ilkay Gundogan", "Jordan Henderson", "James Milner", "Gareth Barry",
    "Nicky Butt", "Darren Fletcher", "Moussa Dembele", "David Ginola", "Gianfranco Zola",
    "Matt Le Tissier", "Mesut Ozil", "Sami Hyypia", "Martin Skrtel", "Gary Cahill",
    "Ledley King", "Wes Brown", "Kolo Toure", "Martin Keown", "Cesar Azpilicueta",
    "Pablo Zabaleta", "Lee Dixon", "Wayne Bridge", "Gael Clichy", "Leighton Baines",
    "Nigel Martyn", "Mark Schwarzer", "Brad Friedel", "Kasper Schmeichel", "Hugo Lloris",
  ],
  "G": [
    "Danny Welbeck", "Olivier Giroud", "Gabriel Jesus", "Callum Wilson", "Danny Ings",
    "Darren Bent", "Kevin Phillips", "Chris Sutton", "Darius Vassell", "Jay Bothroyd",
    "Aaron Lennon", "Stewart Downing", "Adam Johnson", "Theo Walcott", "Wilfried Zaha",
    "Adama Traore", "Matt Jarvis", "Scott Parker", "Cheick Tiote", "Lee Cattermole",
    "Kevin Nolan", "Joey Barton", "Kieron Dyer", "Paul Ince", "Ray Parlour",
    "Nicky Shorey", "Nigel de Jong", "Joleon Lescott", "Michael Dawson", "Wes Morgan",
    "Robert Huth", "Ryan Shawcross", "Curtis Davies", "Phil Jones", "Chris Smalling",
    "Glen Johnson", "Kyle Walker", "Stephen Carr", "Ryan Bertrand", "Jose Enrique",
    "Shay Given", "Tim Howard", "Jussi Jaaskelainen", "Ben Foster", "Joe Hart",
    "Rob Green", "Paul Robinson",
  ],
};
const LEGENDS = {};
for (const tier of Object.keys(LEGEND_TIERS)) {
  for (const name of LEGEND_TIERS[tier]) {
    const k = normName(name);
    if (!(k in LEGENDS)) LEGENDS[k] = tier; // first (best) tier wins
  }
}

/* ------------------------------------------------------------------ *
 * ATTRIBUTE AUDIT OVERRIDES — real-world spikes per player.
 * Each entry maps a normalised name to min/max ranges for the game
 * attributes: speed, heading, fitness, strength, foot (strong foot).
 * ------------------------------------------------------------------ */
const ATTRIBUTE_OVERRIDES = {
  // ⚡ PACE / SPEED MONSTERS
  "Theo Walcott": { speed: [92, 96], foot: [80, 86] },
  "Micky van de Ven": { speed: [94, 97], strength: [80, 86] },
  "Kyle Walker": { speed: [93, 96], strength: [78, 84] },
  "Chiedozie Ogbene": { speed: [91, 95] },
  "Anthony Elanga": { speed: [91, 95] },
  "Pedro Neto": { speed: [90, 94], foot: [86, 92] },
  "Jamie Vardy": { speed: [93, 96], foot: [88, 93], strength: [78, 84] },
  "Leroy Sane": { speed: [91, 95], foot: [86, 91] },
  "Adama Traore": { speed: [93, 96], strength: [88, 94] },
  "Dominik Szoboszlai": { speed: [88, 92], fitness: [85, 91] },
  "Gabriel Martinelli": { speed: [90, 94] },
  "Jeremie Frimpong": { speed: [91, 95] },
  "Daniel James": { speed: [91, 95] },
  "Anthony Gordon": { speed: [92, 96] },
  "Jackson Tchatchoua": { speed: [94, 97] },
  "Michael Owen": { speed: [90, 94], foot: [90, 96] },
  "Aaron Lennon": { speed: [91, 95] },
  "Gareth Bale": { speed: [94, 97], foot: [89, 94], strength: [86, 92] },
  "Thierry Henry": { speed: [94, 97], foot: [95, 99], heading: [85, 91] },
  "Cristiano Ronaldo": { speed: [91, 96], foot: [94, 99], heading: [88, 94], strength: [86, 92] },
  "Mohamed Salah": { speed: [89, 93], foot: [90, 95] },
  "Erling Haaland": { speed: [88, 92], foot: [94, 99], heading: [92, 98], strength: [92, 98] },
  "Sadio Mane": { speed: [90, 94], foot: [87, 92] },
  "Raheem Sterling": { speed: [90, 94] },
  "Son Heung-min": { speed: [89, 93], foot: [88, 93] },
  "Andy Robertson": { speed: [88, 92], fitness: [88, 94] },
  "Trent Alexander-Arnold": { speed: [86, 90], foot: [85, 91] },
  "Ashley Cole": { speed: [87, 91], fitness: [85, 90] },
  "Patrice Evra": { speed: [87, 91], fitness: [85, 90] },
  "Sol Campbell": { speed: [84, 88], heading: [90, 96], strength: [92, 97] },
  "Rio Ferdinand": { speed: [85, 89] },
  "Virgil van Dijk": { speed: [85, 89], heading: [94, 99], strength: [93, 98] },

  // 🪄 DRIBBLING / SKILL
  "Eden Hazard": { foot: [94, 99], speed: [88, 92] },
  "Jeremy Doku": { foot: [89, 94], speed: [91, 95] },
  "Iliman Ndiaye": { foot: [86, 91] },
  "Bernardo Silva": { foot: [91, 96], fitness: [88, 93] },
  "Ryan Giggs": { foot: [93, 98], speed: [88, 93], fitness: [88, 93] },
  "Nwankwo Kanu": { foot: [86, 91] },
  "Dimitar Berbatov": { foot: [88, 93], heading: [86, 91] },
  "David Silva": { foot: [91, 96] },
  "Robert Pires": { foot: [89, 94], speed: [85, 89] },
  "Cesc Fabregas": { foot: [88, 93] },
  "Mesut Ozil": { foot: [89, 94] },
  "Gianfranco Zola": { foot: [90, 95] },
  "Matt Le Tissier": { foot: [89, 94] },
  "David Ginola": { foot: [88, 93] },
  "Paul Scholes": { foot: [89, 94], fitness: [86, 91] },
  "Kevin De Bruyne": { foot: [93, 98], fitness: [86, 91] },
  "Steven Gerrard": { foot: [90, 95], fitness: [88, 93], strength: [85, 90] },
  "Frank Lampard": { foot: [88, 93], fitness: [90, 95] },
  "David Beckham": { foot: [89, 94], fitness: [86, 91] },
  "Wayne Rooney": { foot: [90, 95], strength: [88, 93] },
  "Robin van Persie": { foot: [91, 96], heading: [86, 91] },
  "Ruud van Nistelrooy": { foot: [91, 96], heading: [87, 92] },
  "Dennis Bergkamp": { foot: [93, 98], speed: [85, 89] },
  "Eric Cantona": { foot: [90, 95], strength: [86, 91] },
  "Robinho": { foot: [88, 93] },
  "Juninho Paulista": { foot: [87, 92] },

  // 🎯 FINISHING / SHOOTING
  "Alan Shearer": { foot: [95, 99], heading: [94, 99], strength: [90, 96] },
  "Sergio Aguero": { foot: [94, 99], speed: [86, 90] },
  "Robbie Fowler": { foot: [93, 98] },
  "Didier Drogba": { foot: [90, 95], heading: [90, 96], strength: [92, 97] },
  "Luis Suarez": { foot: [93, 98], strength: [85, 90] },
  "Harry Kane": { foot: [93, 98], heading: [89, 94] },
  "Dwight Yorke": { foot: [88, 93], heading: [85, 90] },
  "Ian Wright": { foot: [89, 94], heading: [85, 90] },
  "Zlatan Ibrahimovic": { foot: [91, 96], heading: [89, 94], strength: [93, 98] },
  "Zlatan Ibrahimović": { foot: [91, 96], heading: [89, 94], strength: [93, 98] },
  "Jermain Defoe": { foot: [87, 92] },
  "Nicolas Anelka": { foot: [87, 92] },
  "Andy Cole": { foot: [88, 93], heading: [86, 91] },
  "Teddy Sheringham": { foot: [88, 93], heading: [87, 92] },
  "Les Ferdinand": { foot: [86, 91], heading: [87, 92] },
  "Peter Crouch": { heading: [90, 96], foot: [78, 84] },
  "Emile Heskey": { heading: [87, 92], strength: [88, 93] },
  "Romelu Lukaku": { foot: [87, 92], strength: [89, 94], heading: [85, 90] },
  "Dion Dublin": { heading: [86, 91], foot: [84, 89] },
  "Kevin Phillips": { foot: [86, 91] },
  "Darren Bent": { foot: [85, 90] },
  "Danny Ings": { foot: [86, 91] },
  "Callum Wilson": { foot: [85, 90] },
  "Chris Sutton": { foot: [85, 90], heading: [85, 90] },
  "Olivier Giroud": { heading: [89, 94], foot: [86, 91], strength: [86, 91] },
  "Gabriel Jesus": { foot: [86, 91] },

  // 💪 STRENGTH / PHYSICALITY
  "Patrick Vieira": { strength: [92, 97], fitness: [88, 93], foot: [84, 89] },
  "Roy Keane": { strength: [88, 93], fitness: [88, 93], foot: [83, 88] },
  "N'Golo Kante": { strength: [80, 85], fitness: [94, 99] },
  "John Terry": { strength: [91, 96], heading: [93, 98] },
  "Nemanja Vidic": { strength: [91, 96], heading: [89, 94] },
  "Jaap Stam": { strength: [92, 97], heading: [88, 93] },
  "Ricardo Carvalho": { strength: [84, 89] },
  "Michael Essien": { strength: [88, 93], fitness: [86, 91] },
  "Yaya Toure": { strength: [89, 94], foot: [86, 91], fitness: [85, 90] },
  "Moussa Dembele": { strength: [88, 93], foot: [86, 91] },
  "Marouane Chamakh": { heading: [88, 93] },
  "Marouane Fellaini": { heading: [90, 96], strength: [89, 94] },
  "Christian Benteke": { heading: [89, 94], strength: [89, 94] },
  "Andy Carroll": { heading: [90, 96], strength: [90, 96] },
  "Adebayo Akinfenwa": { strength: [95, 99], heading: [85, 90] },
  "Michail Antonio": { strength: [88, 93], heading: [86, 91] },
  "Troy Deeney": { strength: [87, 92], heading: [85, 90] },
  "Grant Holt": { strength: [86, 91], heading: [85, 90] },
  "Steve Bruce": { heading: [89, 94], strength: [88, 93] },
  "Tony Adams": { heading: [88, 93], strength: [89, 94] },
  "Martin Keown": { heading: [87, 92], strength: [88, 93] },
  "Gary Pallister": { heading: [87, 92], strength: [88, 93] },
  "Sam Allardyce": { strength: [80, 85] },

  // ⏱️ STAMINA / WORK RATE
  "James Milner": { fitness: [92, 97], strength: [82, 87] },
  "Gareth Barry": { fitness: [88, 93], foot: [82, 87] },
  "Declan Rice": { fitness: [88, 93], strength: [85, 90] },
  "Jordan Henderson": { fitness: [86, 91] },
  "Michael Carrick": { fitness: [85, 90] },
  "Phil Neville": { fitness: [85, 90] },
  "Gary Neville": { fitness: [86, 91] },
  "Denis Irwin": { fitness: [85, 90] },
  "Lee Dixon": { fitness: [84, 89] },
  "Pablo Zabaleta": { fitness: [86, 91] },
  "Cesar Azpilicueta": { fitness: [86, 91] },
  "Nicky Butt": { fitness: [84, 89] },
  "Darren Fletcher": { fitness: [85, 90] },

  // ✈️ HEADING / AERIAL
  "Gary Cahill": { heading: [88, 93], strength: [87, 92] },
  "Ledley King": { heading: [87, 92] },
  "Kolo Toure": { heading: [85, 90] },
  "Wes Brown": { heading: [86, 91] },
  "Robert Huth": { heading: [87, 92], strength: [87, 92] },
  "Ryan Shawcross": { heading: [87, 92], strength: [87, 92] },
  "Christopher Samba": { heading: [88, 93], strength: [88, 93] },
  "Brede Hangeland": { heading: [88, 93], strength: [87, 92] },
  "Per Mertesacker": { heading: [89, 94], strength: [84, 89] },
  "Laurent Koscielny": { heading: [86, 91] },
  "Duncan Ferguson": { heading: [89, 94], strength: [89, 94] },
  "Kevin Davies": { heading: [87, 92], strength: [88, 93] },

  // 🧤 GOALKEEPER PRESENCE (mapped into physical/mental traits for drafting)
  "Peter Schmeichel": { strength: [90, 95], heading: [84, 89] },
  "Edwin van der Sar": { strength: [86, 91], heading: [82, 87] },
  "David Seaman": { strength: [87, 92], heading: [83, 88] },
  "Petr Cech": { strength: [88, 93], heading: [84, 89] },
  "Brad Friedel": { strength: [85, 90] },
  "Shay Given": { strength: [84, 89] },
  "Nigel Martyn": { strength: [86, 91] },
  "David James": { strength: [85, 90] },
  "Alisson Becker": { strength: [88, 93], heading: [82, 87] },
  "Ederson": { strength: [86, 91], heading: [80, 85] },
  "Joe Hart": { strength: [86, 91], heading: [82, 87] },
  "Hugo Lloris": { strength: [85, 90] },
  "Kasper Schmeichel": { strength: [84, 89] },
  "Tim Howard": { strength: [85, 90] },
  "Jussi Jaaskelainen": { strength: [85, 90] },
  "Ben Foster": { strength: [84, 89] },
  "Mark Schwarzer": { strength: [84, 89] },
};
const ATTRIBUTE_OVERRIDES_NORM = {};
for (const [name, overrides] of Object.entries(ATTRIBUTE_OVERRIDES)) {
  ATTRIBUTE_OVERRIDES_NORM[normName(name)] = overrides;
}

function computeOverall(a, g) {
  // generic peak overall from attributes, position-weighted
  const foot = Math.max(a.leftFoot, a.rightFoot);
  if (g === "GK") return Math.round((a.strength * 0.4 + a.heading * 0.35 + a.fitness * 0.25));
  if (g === "FW" || g === "AM" || g === "WG")
    return Math.round(foot * 0.35 + a.speed * 0.25 + a.heading * 0.18 + a.strength * 0.12 + a.fitness * 0.10);
  if (g === "CB" || g === "DM")
    return Math.round(a.heading * 0.32 + a.strength * 0.32 + a.speed * 0.16 + a.fitness * 0.16 + foot * 0.04);
  if (g === "FB")
    return Math.round(a.speed * 0.28 + a.fitness * 0.22 + a.strength * 0.18 + a.heading * 0.14 + foot * 0.18);
  return Math.round(a.strength * 0.22 + a.speed * 0.20 + a.heading * 0.18 + a.fitness * 0.20 + foot * 0.20);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const FOOT_CAPS = {
  GK: { strong: 62, weak: 55 },
  CB: { strong: 72, weak: 58 },
  FB: { strong: 76, weak: 62 },
  DM: { strong: 76, weak: 62 },
  CM: { strong: 82, weak: 68 },
  AM: { strong: 88, weak: 74 },
  WG: { strong: 90, weak: 76 },
  FW: { strong: 92, weak: 78 },
};
// Legends get a higher ceiling than regular players, but are never fully
// exempt from position-appropriate foot caps (a legendary CB should not
// out-finish a legendary striker).
const LEGEND_FOOT_CAPS = {
  GK: { strong: 68, weak: 60 },
  CB: { strong: 80, weak: 64 },
  FB: { strong: 84, weak: 68 },
  DM: { strong: 84, weak: 68 },
  CM: { strong: 88, weak: 74 },
  AM: { strong: 92, weak: 80 },
  WG: { strong: 94, weak: 82 },
  FW: { strong: 96, weak: 84 },
};
function applyPositionFootCaps(a, g, isLegend) {
  const caps = (isLegend ? LEGEND_FOOT_CAPS[g] : FOOT_CAPS[g]) || (isLegend ? LEGEND_FOOT_CAPS.CM : FOOT_CAPS.CM);
  if (a.leftFoot >= a.rightFoot) {
    a.leftFoot = clamp(a.leftFoot, 1, caps.strong);
    a.rightFoot = clamp(a.rightFoot, 1, caps.weak);
  } else {
    a.rightFoot = clamp(a.rightFoot, 1, caps.strong);
    a.leftFoot = clamp(a.leftFoot, 1, caps.weak);
  }
}
const toInt = (s) => { const v = parseInt(s, 10); return isNaN(v) ? 0 : v; };

function applyEAFC(a, eafc, foot, isGK) {
  // Map EA FC 26 attributes into the 5 game attributes.
  const heading = Math.max(toInt(eafc.headingAccuracy), toInt(eafc.headingaccuracy));
  const stamina = toInt(eafc.stamina);
  const strength = toInt(eafc.strength);
  const pace = toInt(eafc.pac);
  const acceleration = toInt(eafc.acceleration);
  const sprintSpeed = toInt(eafc.sprintSpeed);
  const speed = Math.max(pace, Math.round((acceleration + sprintSpeed) / 2));

  a.heading = clamp(heading || a.heading, 1, 99);
  a.fitness = clamp(stamina || a.fitness, 1, 99);
  a.strength = clamp(strength || a.strength, 1, 99);
  a.speed = clamp(speed || a.speed, 1, 99);

  if (isGK) return; // keep generated foot ratings for goalkeepers

  // Foot = shooting + dribbling quality on each foot.
  const finishing = toInt(eafc.finishing);
  const shotPower = toInt(eafc.shotPower);
  const dribbling = toInt(eafc.dribbling);
  const ballControl = toInt(eafc.ballControl);
  const positioning = toInt(eafc.positioning);
  const strongFootVal = Math.round((finishing + shotPower + dribbling + ballControl + positioning) / 5);
  const weakFootStars = toInt(eafc.weakFootAbility); // 1-5
  const weakFootVal = Math.round(strongFootVal * (0.35 + 0.65 * weakFootStars / 5));

  // EA FC preferredFoot: 1 = Right, 2 = Left. JSON foot overrides if present.
  let leftStrong = false;
  if (foot === "left") leftStrong = true;
  else if (foot === "right") leftStrong = false;
  else if (foot === "both") leftStrong = false;
  else if (toInt(eafc.preferredFoot) === 2) leftStrong = true;

  a.leftFoot = clamp(leftStrong ? strongFootVal : weakFootVal, 1, 99);
  a.rightFoot = clamp(leftStrong ? weakFootVal : strongFootVal, 1, 99);
}

function applyOverrides(a, overrides, foot, rng) {
  if (!overrides) return;
  for (const key of Object.keys(overrides)) {
    const [lo, hi] = overrides[key];
    if (key === "foot") {
      // Apply to the dominant foot (or both if foot === "both")
      const leftStrong = foot === "left" || (foot !== "right" && a.leftFoot >= a.rightFoot);
      const val = ri(rng, lo, hi);
      if (foot === "both") {
        a.leftFoot = clamp(val, 1, 99);
        a.rightFoot = clamp(val, 1, 99);
      } else if (leftStrong) {
        a.leftFoot = clamp(val, 1, 99);
      } else {
        a.rightFoot = clamp(val, 1, 99);
      }
    } else {
      a[key] = clamp(ri(rng, lo, hi), 1, 99);
    }
  }
}

function transformPlayer(pl) {
  // Seed by normalized name (not the per-roster-file id, which can differ for
  // the same real player across seasons/clubs) so peak attributes stay
  // identical everywhere that player appears.
  const seedKey = normName(pl.name);
  const rng = mulberry32(seedFrom(seedKey));
  const g = posGroup(pl.position);
  const R = RANGES[g];
  const height = parseHeight(pl.height, R.defH);
  const bmi = 22.0 + rng() * 2.2;
  const weight = Math.round(bmi * Math.pow(height / 100, 2));

  const a = {
    heading: ri(rng, R.heading[0], R.heading[1]),
    speed: ri(rng, R.speed[0], R.speed[1]),
    strength: ri(rng, R.strength[0], R.strength[1]),
    fitness: ri(rng, 52, 90),
    height, weight,
  };
  const foot = (pl.foot || "").toLowerCase();
  const caps = FOOT_CAPS[g] || FOOT_CAPS.CM;
  const strongLo = Math.max(58, caps.strong - 18);
  const weakLo = Math.max(38, caps.weak - 16);
  if (foot === "left") { a.leftFoot = ri(rng, strongLo, caps.strong); a.rightFoot = ri(rng, weakLo, caps.weak); }
  else if (foot === "both") { a.leftFoot = ri(rng, weakLo + 6, caps.strong); a.rightFoot = ri(rng, weakLo + 6, caps.strong); }
  else { a.rightFoot = ri(rng, strongLo, caps.strong); a.leftFoot = ri(rng, weakLo, caps.weak); }

  // EA FC 26 attribute context for current players.
  const eafc = EAFC[normName(pl.name)];
  if (eafc) {
    applyEAFC(a, eafc, foot, g === "GK");
  }

  const tier = LEGENDS[normName(pl.name)];
  const isLegend = !!tier;
  if (isLegend) {
    const info = TIER_INFO[tier];
    const headline = HEADLINE[g] || [];
    const lift = (key, target) => { a[key] = Math.min(99, Math.max(a[key], ri(rng, target - 3, target + 2))); };
    // lift all skill attributes to at least floor-6, headline to ~overall
    ["heading", "speed", "strength", "fitness"].forEach((k) =>
      lift(k, headline.includes(k) ? info.overall : info.floor - 4));
    // strong foot to peak, weak foot lifted modestly
    if (a.leftFoot >= a.rightFoot) { lift("leftFoot", info.overall); lift("rightFoot", info.floor - 10); }
    else { lift("rightFoot", info.overall); lift("leftFoot", info.floor - 10); }
  }

  // Apply real-world attribute audit overrides (pace, finishing, strength, etc.)
  const overrides = ATTRIBUTE_OVERRIDES_NORM[normName(pl.name)];
  applyOverrides(a, overrides, foot, rng);
  applyPositionFootCaps(a, g, isLegend);

  const ment = pickMentality(rng, isLegend);
  let overall = computeOverall(a, g);
  if (isLegend) overall = Math.max(overall, TIER_INFO[tier].overall);
  overall = Math.min(99, overall);

  return {
    name: pl.name, pos: g,
    heading: a.heading, fitness: a.fitness, strength: a.strength,
    height: a.height, weight: a.weight,
    leftFoot: a.leftFoot, rightFoot: a.rightFoot, speed: a.speed,
    mentality: ment.trait, mentalityRating: ment.rating,
    overall, tier: tier || "",
  };
}

/* ------------------------------------------------------------------ *
 * Gather files -> DB keyed by "Club (Year)"
 * ------------------------------------------------------------------ */
function parseFile(base) {
  const noExt = base.replace(/\.json$/, "");
  const parts = noExt.split("_");
  const year = parts[parts.length - 1];
  let name = parts.slice(0, parts.length - 2).join(" ");
  name = name.replace(/\s*-\s*\d{4}\s*$/, "").trim();
  return { club: name, year };
}

const files = [];
for (const d of fs.readdirSync(ATTACH)) {
  const dir = path.join(ATTACH, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".json")) files.push(path.join(dir, f));
  }
}

const DB = {};
const clubs = new Set();
let totalPlayers = 0, legendCount = 0;
const legendSeen = new Set();
for (const fp of files) {
  const base = path.basename(fp);
  const { club, year } = parseFile(base);
  const key = `${club} (${year})`;
  let json;
  try { json = JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch (e) { console.error("parse fail", base, e.message); continue; }
  const players = Array.isArray(json.players) ? json.players : [];
  if (!players.length) continue;
  const arr = (DB[key] = DB[key] || []);
  for (const pl of players) {
    if (!pl || !pl.name) continue;
    const t = transformPlayer(pl);
    arr.push(t);
    totalPlayers++;
    if (t.tier) { legendCount++; legendSeen.add(normName(pl.name)); }
  }
  clubs.add(club);
}

/* ------------------------------------------------------------------ *
 * CLUB -> ACADEMY TIER (used by the academy club-roll)
 * ------------------------------------------------------------------ */
const ACADEMY_TIER_BY_CLUB = {
  "Manchester United": "World Class", "Manchester City": "World Class",
  "Chelsea FC": "World Class", "Arsenal FC": "World Class", "Liverpool FC": "World Class",
  "Southampton FC": "Strong", "Tottenham Hotspur": "Strong", "Everton FC": "Strong",
  "Leeds United": "Strong", "West Ham United": "Strong", "Aston Villa": "Strong",
  "Leicester City": "Strong", "Crystal Palace": "Strong", "Middlesbrough FC": "Strong",
  "Newcastle United": "Average", "Nottingham Forest": "Average", "Norwich City": "Average",
  "Fulham FC": "Average", "Blackburn Rovers": "Average", "Bolton Wanderers": "Average",
  "Charlton Athletic": "Average", "Coventry City": "Average", "Derby County": "Average",
  "Ipswich Town": "Average", "Reading FC": "Average", "Sunderland AFC": "Average",
  "Wolverhampton Wanderers": "Average", "Brighton and Hove Albion": "Average",
  "Brentford FC": "Average", "Watford FC": "Average", "Stoke City": "Average",
  "West Bromwich Albion": "Average", "Birmingham City": "Average", "Cardiff City": "Average",
  "Swansea City": "Average", "Hull City": "Average", "Wigan Athletic": "Average",
  "Portsmouth FC": "Average", "Queens Park Rangers": "Average", "AFC Bournemouth": "Average",
  "Sheffield United": "Average", "Sheffield Wednesday": "Average",
  "Barnsley FC": "Weak", "Blackpool FC": "Weak", "Bradford City": "Weak",
  "Burnley FC": "Weak", "Huddersfield Town": "Weak", "Luton Town": "Weak",
  "Oldham Athletic": "Weak", "Swindon Town": "Weak", "Wimbledon FC": "Weak",
};
const clubList = Array.from(clubs).sort();
const CLUB_ACADEMY = {};
for (const c of clubList) CLUB_ACADEMY[c] = ACADEMY_TIER_BY_CLUB[c] || "Average";

/* ------------------------------------------------------------------ *
 * SERIALIZE the whole data.js
 * ------------------------------------------------------------------ */
function esc(s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

const MENTALITY_META = (() => {
  const m = {};
  for (const n of NEUTRAL_TRAITS) m[n] = { special: false, tag: "neutral" };
  for (const [n, , , tag] of SPECIAL_TRAITS) m[n] = { special: true, tag };
  return m;
})();

const HEADER = `/* ============================================================================
 * FOOTBALL DNA SIMULATOR — DATA FILE  (auto-generated by build_data.js)
 * Alpha 1.1: peak ratings, hidden-rating mentalities, club->academy mapping.
 *
 * Player fields (via p()):
 *   name, pos, heading, fitness, strength, height, weight,
 *   leftFoot, rightFoot, speed, mentality (trait), mentalityRating (HIDDEN),
 *   overall (peak), tier (legend tier or "")
 * ========================================================================== */

/* Mentality traits — the numeric rating is HIDDEN from the player in-game;
 * only the descriptive trait is shown. \`special\` traits are rarer & impactful. */
const MENTALITY_TRAITS = ${JSON.stringify(MENTALITY_META, null, 2)};

/* Academy tiers -> development flavour. */
const ACADEMY_TIERS = {
  "World Class": { flavor: "Elite production line — 'wonderkid' expectations." },
  "Strong": { flavor: "Respected pathway with a real conveyor belt of talent." },
  "Average": { flavor: "Standard grounding — solid but unspectacular." },
  "Weak": { flavor: "Unfashionable setup — the ultimate underdog story." },
};

/* Every club present in the data, mapped to its academy tier.
 * The academy club-roll draws from these. */
const CLUB_ACADEMY = ${JSON.stringify(CLUB_ACADEMY, null, 2)};

/* Helper to keep squads compact.
 * Order: name, pos, heading, fitness, strength, height, weight, LF, RF, speed, mentality, mentalityRating, overall, tier */
function p(name, pos, heading, fitness, strength, height, weight, leftFoot, rightFoot, speed, mentality, mentalityRating, overall, tier) {
  return { name, pos, heading, fitness, strength, height, weight, leftFoot, rightFoot, speed, mentality, mentalityRating, overall, tier: tier || "" };
}

`;

function playerLine(p) {
  return `    p("${esc(p.name)}","${p.pos}",${p.heading},${p.fitness},${p.strength},${p.height},${p.weight},${p.leftFoot},${p.rightFoot},${p.speed},"${esc(p.mentality)}",${p.mentalityRating},${p.overall}${p.tier ? `,"${p.tier}"` : ""}),`;
}
const keys = Object.keys(DB).sort();
let dbOut = "const PLAYER_DATABASE = {\n";
for (const k of keys) {
  dbOut += `  "${esc(k)}": [\n`;
  for (const pl of DB[k]) dbOut += playerLine(pl) + "\n";
  dbOut += "  ],\n";
}
dbOut += "};\n\n";

const FOOTER = `/* ============================ TEAM DATABASE ============================
 * Clubs the career simulation places the player at & builds league tables from.
 * ====================================================================== */
const TEAM_DATABASE = {
  "Manchester City": { attack: 92, midfield: 90, defence: 86, manager: 95, tacticalStyle: "Possession", homeAdvantage: 8, league: "Elite" },
  "Liverpool": { attack: 90, midfield: 86, defence: 85, manager: 92, tacticalStyle: "High Press", homeAdvantage: 9, league: "Elite" },
  "Arsenal": { attack: 86, midfield: 85, defence: 84, manager: 86, tacticalStyle: "Possession", homeAdvantage: 8, league: "Elite" },
  "Manchester United": { attack: 84, midfield: 80, defence: 80, manager: 82, tacticalStyle: "Direct", homeAdvantage: 8, league: "Elite" },
  "Chelsea": { attack: 84, midfield: 82, defence: 82, manager: 84, tacticalStyle: "Counter", homeAdvantage: 7, league: "Elite" },
  "Tottenham": { attack: 83, midfield: 79, defence: 78, manager: 80, tacticalStyle: "High Press", homeAdvantage: 7, league: "Europe" },
  "Newcastle United": { attack: 80, midfield: 78, defence: 80, manager: 80, tacticalStyle: "Counter", homeAdvantage: 8, league: "Europe" },
  "Aston Villa": { attack: 80, midfield: 77, defence: 76, manager: 82, tacticalStyle: "Direct", homeAdvantage: 7, league: "Europe" },
  "Brighton": { attack: 78, midfield: 80, defence: 74, manager: 84, tacticalStyle: "Possession", homeAdvantage: 6, league: "Europe" },
  "West Ham": { attack: 76, midfield: 74, defence: 75, manager: 76, tacticalStyle: "Counter", homeAdvantage: 7, league: "Mid" },
  "Crystal Palace": { attack: 74, midfield: 73, defence: 74, manager: 76, tacticalStyle: "Counter", homeAdvantage: 7, league: "Mid" },
  "Brentford": { attack: 75, midfield: 73, defence: 73, manager: 78, tacticalStyle: "Route One", homeAdvantage: 7, league: "Mid" },
  "Fulham": { attack: 73, midfield: 72, defence: 72, manager: 76, tacticalStyle: "Possession", homeAdvantage: 6, league: "Mid" },
  "Everton": { attack: 70, midfield: 70, defence: 72, manager: 72, tacticalStyle: "Park the Bus", homeAdvantage: 8, league: "Mid" },
  "Wolves": { attack: 72, midfield: 71, defence: 72, manager: 74, tacticalStyle: "Counter", homeAdvantage: 6, league: "Mid" },
  "Nottingham Forest": { attack: 70, midfield: 68, defence: 69, manager: 72, tacticalStyle: "Park the Bus", homeAdvantage: 8, league: "Lower" },
  "Bournemouth": { attack: 71, midfield: 69, defence: 67, manager: 74, tacticalStyle: "High Press", homeAdvantage: 6, league: "Lower" },
  "Burnley": { attack: 66, midfield: 66, defence: 68, manager: 70, tacticalStyle: "Route One", homeAdvantage: 7, league: "Lower" },
  "Sheffield United": { attack: 64, midfield: 65, defence: 66, manager: 68, tacticalStyle: "Park the Bus", homeAdvantage: 7, league: "Lower" },
  "Luton Town": { attack: 63, midfield: 64, defence: 64, manager: 70, tacticalStyle: "Route One", homeAdvantage: 8, league: "Lower" },
};

/* Academy tier -> pool of realistic starting clubs (by league band). */
const ACADEMY_STARTING_POOL = {
  "World Class": ["Manchester City", "Liverpool", "Arsenal", "Manchester United", "Chelsea"],
  "Strong": ["Tottenham", "Newcastle United", "Aston Villa", "Brighton"],
  "Average": ["West Ham", "Crystal Palace", "Brentford", "Fulham", "Wolves"],
  "Weak": ["Everton", "Nottingham Forest", "Bournemouth", "Burnley", "Sheffield United", "Luton Town"],
};

/* National team for the international track. */
const NATIONAL_TEAM = { name: "England", attack: 84, midfield: 82, defence: 82, manager: 82, tacticalStyle: "Possession", homeAdvantage: 6 };

/* Expose to game.js. */
if (typeof window !== "undefined") {
  window.GAME_DATA = {
    MENTALITY_TRAITS,
    ACADEMY_TIERS,
    CLUB_ACADEMY,
    PLAYER_DATABASE,
    TEAM_DATABASE,
    ACADEMY_STARTING_POOL,
    NATIONAL_TEAM,
  };
}
`;

fs.writeFileSync(OUT, HEADER + dbOut + FOOTER);
console.log("squads:", keys.length, "players:", totalPlayers);
console.log("clubs:", clubList.length);
console.log("legend appearances:", legendCount, "unique legends matched:", legendSeen.size);
console.log("wrote", OUT);
