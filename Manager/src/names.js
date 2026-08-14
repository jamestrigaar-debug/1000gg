/* ============================================================================
 * FOOTBALL MANAGER — NAME & NATIONALITY POOLS
 *
 * The world needs thousands of people who are not in the real database: youth
 * intakes, lower-league squads, foreign-league squads, and the managers who
 * fill vacancies fifteen seasons from now. They all come from here.
 *
 * Nationality is not decoration. It weights which league a player is generated
 * into, it seeds the manager's own nationality on the draft, and it is what a
 * future international layer will read.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});

  /* Each nation carries a `weight` (how often it produces players in the
   * generated pool) and a `strength` bias applied to generated overalls — a
   * Brazilian regen is a shade more likely to be good than a Latvian one.
   * `leagues` is the domestic pyramid a home-grown player most often starts in. */
  const NATIONS = {
    England:      { weight: 30, strength: 1.5, leagues: ["PL", "Championship", "League1", "League2", "NationalLeague"] },
    Scotland:     { weight: 4,  strength: 0.0, leagues: ["Championship", "League1", "League2"] },
    Wales:        { weight: 3,  strength: 0.0, leagues: ["Championship", "League1", "League2"] },
    Ireland:      { weight: 3,  strength: 0.0, leagues: ["Championship", "League1", "League2"] },
    France:       { weight: 9,  strength: 2.5, leagues: ["PL", "LaLiga", "SerieA"] },
    Spain:        { weight: 9,  strength: 2.0, leagues: ["LaLiga"] },
    Italy:        { weight: 7,  strength: 1.5, leagues: ["SerieA"] },
    Germany:      { weight: 7,  strength: 1.5, leagues: ["Bundesliga"] },
    Netherlands:  { weight: 5,  strength: 1.5, leagues: ["PL", "Bundesliga"] },
    Portugal:     { weight: 5,  strength: 2.0, leagues: ["PL", "LaLiga"] },
    Belgium:      { weight: 4,  strength: 1.5, leagues: ["PL", "Bundesliga"] },
    Brazil:       { weight: 8,  strength: 2.5, leagues: ["LaLiga", "SerieA", "PL"] },
    Argentina:    { weight: 6,  strength: 2.5, leagues: ["LaLiga", "SerieA"] },
    Uruguay:      { weight: 2,  strength: 1.5, leagues: ["LaLiga", "SerieA"] },
    Colombia:     { weight: 2,  strength: 1.0, leagues: ["LaLiga", "SerieA"] },
    Croatia:      { weight: 2,  strength: 1.5, leagues: ["SerieA", "Bundesliga"] },
    Serbia:       { weight: 2,  strength: 1.0, leagues: ["SerieA", "Bundesliga"] },
    Denmark:      { weight: 2,  strength: 1.0, leagues: ["PL", "Bundesliga"] },
    Sweden:       { weight: 2,  strength: 0.5, leagues: ["PL", "SerieA"] },
    Norway:       { weight: 2,  strength: 0.5, leagues: ["PL", "Bundesliga"] },
    Poland:       { weight: 2,  strength: 0.5, leagues: ["Bundesliga", "SerieA"] },
    Austria:      { weight: 2,  strength: 0.5, leagues: ["Bundesliga"] },
    Switzerland:  { weight: 2,  strength: 0.5, leagues: ["Bundesliga", "SerieA"] },
    Turkey:       { weight: 2,  strength: 0.0, leagues: ["SerieA"] },
    Greece:       { weight: 1,  strength: 0.0, leagues: ["SerieA"] },
    Morocco:      { weight: 2,  strength: 1.0, leagues: ["LaLiga", "SerieA"] },
    Senegal:      { weight: 2,  strength: 1.5, leagues: ["PL", "LaLiga"] },
    Nigeria:      { weight: 2,  strength: 1.0, leagues: ["PL", "SerieA"] },
    Ghana:        { weight: 2,  strength: 0.5, leagues: ["SerieA", "LaLiga"] },
    "Ivory Coast":{ weight: 2,  strength: 1.0, leagues: ["PL", "LaLiga"] },
    Algeria:      { weight: 1,  strength: 0.5, leagues: ["LaLiga", "SerieA"] },
    Japan:        { weight: 2,  strength: 0.5, leagues: ["Bundesliga", "MLS"] },
    "South Korea":{ weight: 2,  strength: 0.5, leagues: ["PL", "Bundesliga"] },
    USA:          { weight: 3,  strength: 0.5, leagues: ["MLS", "Bundesliga"] },
    Mexico:       { weight: 2,  strength: 0.0, leagues: ["MLS", "LaLiga"] },
    Canada:       { weight: 1,  strength: 0.0, leagues: ["MLS"] },
    "Saudi Arabia":{ weight: 2, strength: -1.0, leagues: ["Saudi"] },
    Australia:    { weight: 1,  strength: 0.0, leagues: ["PL", "MLS"] },
  };
  const NATION_KEYS = Object.keys(NATIONS);

  /* Given names and surnames per nation family. Deliberately small pools —
   * combined they give tens of thousands of names, which is far more than a
   * career will ever surface, and a short list keeps the file readable. */
  const NAME_POOLS = {
    English: {
      first: ["Jack", "Harry", "Callum", "Reece", "Mason", "Tyler", "Ollie", "Dan", "Kieran", "Lewis", "Josh", "Ethan", "Alfie", "Charlie", "Rhys", "Marcus", "Jude", "Kobbie", "Trent", "Declan", "Bukayo", "Cole", "Levi", "Archie", "Finn", "Ronnie", "Sonny", "Frankie"],
      last: ["Wilson", "Bennett", "Hartley", "Crawford", "Whitmore", "Ashby", "Dalton", "Fletcher", "Greenwood", "Harrow", "Kingsley", "Lockwood", "Marsden", "Norbury", "Pemberton", "Radcliffe", "Sadler", "Thorne", "Underwood", "Vardy", "Walcott", "Ainsworth", "Braithwaite", "Colville", "Draycott", "Ellery", "Fairhurst", "Garrick"],
    },
    French: {
      first: ["Lucas", "Enzo", "Théo", "Mathis", "Rayan", "Noah", "Youssouf", "Ibrahim", "Kylian", "Ousmane", "Warren", "Bradley", "Désiré", "Manu", "Amine", "Sofiane"],
      last: ["Dubois", "Moreau", "Lefèvre", "Girard", "Bonnet", "Rousseau", "Chevalier", "Marchand", "Dupuis", "Cissé", "Diarra", "Konaté", "Traoré", "Bamba", "Ndiaye", "Fofana"],
    },
    Spanish: {
      first: ["Pablo", "Álvaro", "Iker", "Sergio", "Marc", "Nico", "Gavi", "Hugo", "Diego", "Javi", "Adrián", "Rodri", "Bryan", "Ander"],
      last: ["García", "Fernández", "Moreno", "Navarro", "Ruiz", "Iglesias", "Cabrera", "Ortega", "Vidal", "Herrera", "Cazorla", "Peña", "Salazar", "Bermejo"],
    },
    Italian: {
      first: ["Matteo", "Lorenzo", "Giacomo", "Andrea", "Riccardo", "Nicolò", "Samuele", "Federico", "Tommaso", "Davide"],
      last: ["Ricci", "Bernardi", "Fontana", "Gallo", "Moretti", "Ferrari", "Costa", "Barbieri", "Rinaldi", "Sartori"],
    },
    German: {
      first: ["Jonas", "Leon", "Finn", "Nico", "Maximilian", "Luca", "Tim", "Felix", "Jamal", "Florian"],
      last: ["Krüger", "Bauer", "Wagner", "Hoffmann", "Zimmermann", "Brandt", "Neumann", "Vogel", "Kellner", "Reinhardt"],
    },
    Dutch: {
      first: ["Sem", "Daan", "Lars", "Ruben", "Jurriën", "Xavi", "Quinten", "Bram", "Mees"],
      last: ["de Vries", "van Dijk", "Bakker", "Visser", "Jansen", "Hendriks", "Kuipers", "Willems", "Boer"],
    },
    Portuguese: {
      first: ["João", "Rúben", "Gonçalo", "Diogo", "Tiago", "Rafael", "Vitinha", "Nuno", "Bernardo"],
      last: ["Silva", "Costa", "Pereira", "Almeida", "Ferreira", "Carvalho", "Moutinho", "Neves", "Baptista"],
    },
    Brazilian: {
      first: ["Gabriel", "Lucas", "Matheus", "Vinícius", "Rodrygo", "Endrick", "Danilo", "Caio", "Igor", "Wesley"],
      last: ["Santos", "Oliveira", "Souza", "Lima", "Rocha", "Barbosa", "Cardoso", "Nunes", "Teixeira", "Ramos"],
    },
    Scandinavian: {
      first: ["Erling", "Mikkel", "Viktor", "Emil", "Oscar", "Anton", "Kasper", "Sander", "Elias"],
      last: ["Nilsen", "Johansson", "Andersen", "Berg", "Lindqvist", "Holm", "Dahl", "Sørensen", "Karlsson"],
    },
    African: {
      first: ["Mohamed", "Sadio", "Amadou", "Kelechi", "Chidi", "Yacine", "Ismaila", "Bright", "Abdoulaye", "Tariq"],
      last: ["Diallo", "Keita", "Mensah", "Okafor", "Sarr", "Toure", "Boateng", "Kone", "Nwankwo", "Zerrouki"],
    },
    Slavic: {
      first: ["Luka", "Marko", "Nikola", "Filip", "Jakub", "Piotr", "Ivan", "Stefan"],
      last: ["Petrović", "Nowak", "Kovačić", "Horvat", "Marković", "Novak", "Vlahović", "Zieliński"],
    },
    American: {
      first: ["Tyler", "Brandon", "Christian", "Weston", "Gio", "Ricardo", "Diego", "Malik"],
      last: ["Miller", "Turner", "Reyna", "Sanchez", "Robinson", "Delgado", "Pulaski", "Hughes"],
    },
    Asian: {
      first: ["Takumi", "Kaoru", "Daichi", "Min-jae", "Heung-min", "Hidemasa", "Sung-ho", "Ryo"],
      last: ["Tanaka", "Sato", "Kubo", "Ito", "Kim", "Park", "Lee", "Nakamura"],
    },
    Arabic: {
      first: ["Salem", "Faisal", "Abdullah", "Nasser", "Khalid", "Yousef", "Turki"],
      last: ["Al-Harbi", "Al-Dawsari", "Al-Shehri", "Al-Ghannam", "Al-Buraikan", "Al-Otaibi", "Al-Najei"],
    },
  };

  /* Which name pool a nation draws from. */
  const NATION_POOL = {
    England: "English", Scotland: "English", Wales: "English", Ireland: "English", Australia: "English",
    France: "French", Belgium: "French",
    Spain: "Spanish", Argentina: "Spanish", Uruguay: "Spanish", Colombia: "Spanish", Mexico: "Spanish",
    Italy: "Italian", Greece: "Italian",
    Germany: "German", Austria: "German", Switzerland: "German",
    Netherlands: "Dutch",
    Portugal: "Portuguese",
    Brazil: "Brazilian",
    Denmark: "Scandinavian", Sweden: "Scandinavian", Norway: "Scandinavian",
    Morocco: "African", Senegal: "African", Nigeria: "African", Ghana: "African",
    "Ivory Coast": "African", Algeria: "African", Turkey: "African",
    Croatia: "Slavic", Serbia: "Slavic", Poland: "Slavic",
    USA: "American", Canada: "American",
    Japan: "Asian", "South Korea": "Asian",
    "Saudi Arabia": "Arabic",
  };

  function poolFor(nation) { return NAME_POOLS[NATION_POOL[nation] || "English"] || NAME_POOLS.English; }

  /** A generated person's name. Not guaranteed unique — callers that need
   *  uniqueness (players, managers) carry an id and dedupe on that. */
  function personName(rng, nation) {
    const pool = poolFor(nation);
    return `${rng.pick(pool.first)} ${rng.pick(pool.last)}`;
  }

  /** A manager's name, in the "P. Guardiola" style the databases already use. */
  function managerName(rng, nation) {
    const pool = poolFor(nation);
    return `${rng.pick(pool.first).charAt(0)}. ${rng.pick(pool.last)}`;
  }

  /** Weighted nationality draw across the whole world. */
  function randomNation(rng) {
    return rng.weighted(NATION_KEYS.map((k) => ({ item: k, weight: NATIONS[k].weight })));
  }

  /** Nationality draw biased toward the nations that feed a given league. */
  function nationForLeague(rng, league) {
    const local = NATION_KEYS.filter((k) => NATIONS[k].leagues.includes(league));
    // 65% a nation that naturally feeds this league, 35% anyone at all — which
    // is what keeps a National League squad mostly English and a La Liga squad
    // mostly Spanish without ever making either of them a closed shop.
    if (local.length && rng.chance(0.65)) {
      return rng.weighted(local.map((k) => ({ item: k, weight: NATIONS[k].weight })));
    }
    return randomNation(rng);
  }

  /* ---------------------- REAL PLAYER NATIONALITIES ------------------------
   * The shipped database (../src/data.js) carries no nationality field — every
   * record is name / position / attributes / overall. So a real player's
   * nationality was ROLLED from the league he happened to be playing in, which
   * is how Erling Haaland came out Serbian and every Barcelona player came out
   * Spanish. The roll is fine for the thousands of generated players, whose
   * names are built from their nationality in the first place; it is nonsense
   * for the ~500 real ones.
   *
   * This is the override. Anything in here wins; anything not in here still
   * falls back to the league-weighted roll. Populate it as
   *     MG.names.PLAYER_NATIONALITY["Erling Haaland"] = "Norway";
   * or by assigning a whole object to MG.names.setNationalities(map).
   * A nation not listed in NATIONS still works — it is used verbatim — so the
   * table can carry countries the generator has no name pool for. */
  const PLAYER_NATIONALITY = {};
  function setNationalities(map) {
    if (!map) return 0;
    let n = 0;
    for (const [name, nation] of Object.entries(map)) {
      if (typeof name === "string" && typeof nation === "string" && nation) {
        PLAYER_NATIONALITY[name] = nation; n++;
      }
    }
    return n;
  }
  /** A real player's nationality if we know it, otherwise null. */
  function knownNationality(name) {
    return PLAYER_NATIONALITY[name] || null;
  }

  MG.names = { NATIONS, NATION_KEYS, personName, managerName, randomNation, nationForLeague,
    PLAYER_NATIONALITY, setNationalities, knownNationality };
})(typeof globalThis !== "undefined" ? globalThis : this);
