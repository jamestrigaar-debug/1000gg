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
  /* 2025/26 Premier League squads, ~530 real players. Anything not covered
   * here (foreign leagues, lower divisions, historical seasons) still falls
   * back to the league-weighted roll below — this table only replaces the
   * roll where we actually know the answer. */
  const REAL_NATIONALITY = {
    "Aaron Cresswell": "England", "Aaron Hickey": "Scotland", "Aaron Wan-Bissaka": "England",
    "Abdoulaye Doucouré": "Mali", "Abdukodir Khusanov": "Uzbekistan", "Abdul Fatawu Issahaku": "Ghana",
    "Adam Armstrong": "England", "Adam Lallana": "England", "Adam Smith": "England",
    "Adam Webster": "England", "Adam Wharton": "England", "Adama Traoré": "Spain",
    "Alejandro Garnacho": "Argentina", "Alex Iwobi": "Nigeria", "Alex McCarthy": "England",
    "Alex Moreno": "Spain", "Alex Scott": "England", "Alexander Isak": "Sweden",
    "Alexis Mac Allister": "Argentina", "Alfie Devine": "England", "Alfie Whiteman": "England",
    "Ali Al-Hamadi": "Iraq", "Alisson": "Brazil", "Alphonse Areola": "France",
    "Altay Bayındır": "Turkey", "Amad Diallo": "Ivory Coast", "Amadou Onana": "Belgium",
    "Andreas Pereira": "Brazil", "Andrew Omobamidele": "Ireland", "Andrew Robertson": "Scotland",
    "André Almeida": "Portugal", "André Gomes": "Portugal", "André Onana": "Cameroon",
    "Anthony Elanga": "Sweden", "Anthony Gordon": "England", "Antoine Semenyo": "Ghana",
    "Antonee Robinson": "USA", "Antony": "Brazil", "Archie Gray": "England",
    "Arijanet Muric": "Kosovo", "Armel Bella-Kotchap": "Germany", "Arnaut Danjuma": "Netherlands",
    "Asher Agbinone": "England", "Ashley Young": "England", "Asmir Begović": "Bosnia and Herzegovina",
    "Axel Disasi": "France", "Axel Tuanzebe": "DR Congo", "Ayden Heaven": "England",
    "Bart Verbruggen": "Netherlands", "Bastien Meupiyou": "France", "Ben Brereton Díaz": "Chile",
    "Ben Chilwell": "England", "Ben Davies": "Wales", "Ben Doak": "Scotland",
    "Ben Godfrey": "England", "Ben Johnson": "England", "Ben Mee": "England",
    "Ben Nelson": "England", "Ben White": "England", "Benoît Badiashile": "France",
    "Bernardo Silva": "Portugal", "Bernd Leno": "Germany", "Beto": "Portugal",
    "Bilal El Khannouss": "Morocco", "Billy Crellin": "England", "Boubacar Kamara": "France",
    "Boubacar Traoré": "Mali", "Boubakary Soumaré": "France", "Brajan Gruda": "Germany",
    "Brandon Austin": "England", "Brennan Johnson": "Wales", "Bruno Fernandes": "Portugal",
    "Bruno Guimarães": "Brazil", "Bryan Mbeumo": "Cameroon", "Bukayo Saka": "England",
    "Callum Hudson-Odoi": "England", "Callum Wilson": "England", "Calvin Bassey": "Nigeria",
    "Cameron Archer": "England", "Cameron Burgess": "Australia", "Caoimhin Kelleher": "Ireland",
    "Carl Rushworth": "England", "Carlos Alcaraz": "Argentina", "Carlos Baleba": "Cameroon",
    "Carlos Forbs": "Portugal", "Carlos Miguel": "Brazil", "Carlos Soler": "Spain",
    "Carlos Vinícius": "Brazil", "Carney Chukwuemeka": "England", "Casemiro": "Brazil",
    "Cesare Casadei": "Italy", "Chadi Riad": "Morocco", "Charlie Taylor": "England",
    "Che Adams": "Scotland", "Cheick Doucouré": "Mali", "Chiquinho": "Portugal",
    "Chris Richards": "USA", "Chris Wood": "New Zealand", "Christian Eriksen": "Denmark",
    "Christian Nørgaard": "Denmark", "Christian Walton": "England", "Christopher Nkunku": "France",
    "Cieran Slicker": "Scotland", "Claudio Echeverri": "Argentina", "Cody Gakpo": "Netherlands",
    "Cole Palmer": "England", "Conor Bradley": "Northern Ireland", "Conor Chaplin": "England",
    "Conor Coady": "England", "Craig Dawson": "England", "Cristian Romero": "Argentina",
    "Crysencio Summerville": "Netherlands", "Curtis Jones": "England", "Daichi Kamada": "Japan",
    "Dan Burn": "England", "Dango Ouattara": "Burkina Faso", "Daniel Iversen": "Denmark",
    "Daniel Jebbison": "England", "Daniel Muñoz": "Colombia", "Danilo": "Brazil",
    "Danny Ings": "England", "Danny Ward": "Wales", "Danny Welbeck": "England",
    "Darwin Núñez": "Uruguay", "David Brooks": "Wales", "David Raya": "Spain",
    "Dean Henderson": "England", "Dean Huijsen": "Spain", "Declan Rice": "England",
    "Deivid Washington": "Brazil", "Dejan Kulusevski": "Sweden", "Dermot Mee": "England",
    "Destiny Udogie": "Italy", "Diego Carlos": "Brazil", "Diogo Dalot": "Portugal",
    "Diogo Jota": "Portugal", "Djed Spence": "England", "Djordje Petrovic": "Serbia",
    "Dominic Calvert-Lewin": "England", "Dominic Solanke": "England", "Dominik Szoboszlai": "Hungary",
    "Dwight McNeil": "England", "Eberechi Eze": "England", "Eddie Nketiah": "England",
    "Ederson": "Brazil", "Edson Álvarez": "Mexico", "Elliot Anderson": "Scotland",
    "Emerson Palmieri": "Italy", "Emil Krafth": "Sweden", "Emile Smith Rowe": "England",
    "Emiliano Buendía": "Argentina", "Emiliano Martínez": "Argentina", "Emmanuel Agbadou": "Ivory Coast",
    "Enes Ünal": "Turkey", "Enso González": "Paraguay", "Enzo Barrenechea": "Argentina",
    "Enzo Fernández": "Argentina", "Eric da Silva Moreira": "Germany", "Erling Haaland": "Norway",
    "Ethan Nwaneri": "England", "Ethan Pinnock": "Jamaica", "Ethan Wheatley": "England",
    "Evan Ferguson": "Ireland", "Evanilson": "Brazil", "Ezri Konsa": "England",
    "Fabian Schär": "Switzerland", "Fabio Carvalho": "Portugal", "Fabio Vieira": "Portugal",
    "Facundo Buonanotte": "Argentina", "Federico Chiesa": "Italy", "Filip Jörgensen": "Denmark",
    "Flynn Downes": "England", "Fraser Forster": "England", "Freddie Ladapo": "England",
    "Fábio Silva": "Portugal", "Gabriel Jesus": "Brazil", "Gabriel Magalhães": "Brazil",
    "Gabriel Martinelli": "Brazil", "Garang Kuol": "Australia", "Gavin Bazunu": "Ireland",
    "George Edmundson": "England", "George Hirst": "England", "Georginio Rutter": "France",
    "Gonçalo Guedes": "Portugal", "Guglielmo Vicario": "Italy", "Guido Rodríguez": "Argentina",
    "Gustavo Nunes": "Brazil", "Hamza Choudhury": "England", "Harrison Reed": "England",
    "Harry Clarke": "England", "Harry Maguire": "England", "Harry Souttar": "Australia",
    "Harry Toffolo": "England", "Harry Wilson": "Wales", "Harry Winks": "England",
    "Harvey Barnes": "England", "Harvey Davies": "England", "Harvey Elliott": "England",
    "Hugo Bueno": "Spain", "Hwang Hee-chan": "South Korea", "Hákon Valdimarsson": "Iceland",
    "Ian Maatsen": "Netherlands", "Ibrahim Osman": "Ghana", "Ibrahim Sangaré": "Ivory Coast",
    "Ibrahima Konate": "France", "Idrissa Gueye": "Senegal", "Igor Julio": "Brazil",
    "Igor Thiago": "Brazil", "Illia Zabarnyi": "Ukraine", "Ismaïla Sarr": "Senegal",
    "Issa Diop": "France", "Jack Grealish": "England", "Jack Harrison": "England",
    "Jack Hinshelwood": "England", "Jack Stephens": "England", "Jack Taylor": "Ireland",
    "Jacob Greaves": "England", "Jacob Murphy": "England", "Jacob Ramsey": "England",
    "Jaden Philogene": "England", "Jadon Sancho": "England", "Jakub Kiwior": "Poland",
    "Jakub Stolarczyk": "Poland", "Jamaal Lascelles": "England", "James Bree": "England",
    "James Garner": "England", "James Hill": "England", "James Justin": "England",
    "James Maddison": "England", "James McAtee": "England", "James McConnell": "England",
    "James Tarkowski": "England", "James Ward-Prowse": "England", "Jamie Vardy": "England",
    "Jan Bednarek": "Poland", "Jan Paul van Hecke": "Netherlands", "Jannik Vestergaard": "Denmark",
    "Janoi Donacien": "Saint Lucia", "Jarell Quansah": "England", "Jarrad Branthwaite": "England",
    "Jarrod Bowen": "England", "Jason Steele": "England", "Jay Stansfield": "England",
    "Jayden Meghoma": "England", "Jean-Philippe Mateta": "France", "Jean-Ricner Bellegarde": "France",
    "Jefferson Lerma": "Colombia", "Jeremy Sarmiento": "Ecuador", "Jhon Durán": "Colombia",
    "Joachim Andersen": "Denmark", "Joe Aribo": "Nigeria", "Joe Gauci": "Australia",
    "Joe Gomez": "England", "Joe Lumley": "England", "Joe Whitworth": "England",
    "Joe Willock": "England", "Joel Ward": "England", "Joelinton": "Brazil",
    "John McGinn": "Scotland", "John Stones": "England", "Jordan Ayew": "Ghana",
    "Jordan Pickford": "England", "Jorginho": "Italy", "Joshua Zirkzee": "Netherlands",
    "Josko Gvardiol": "Croatia", "José Sá": "Portugal", "Jota Silva": "Portugal",
    "João Félix": "Portugal", "João Gomes": "Brazil", "João Pedro": "Brazil",
    "João Virgínia": "Portugal", "Joël Veltman": "Netherlands", "Julian Araujo": "Mexico",
    "Julio Enciso": "Paraguay", "Jurrien Timber": "Netherlands", "Justin Devenny": "Northern Ireland",
    "Justin Kluivert": "Netherlands", "Jérémy Doku": "Belgium", "Jørgen Strand Larsen": "Norway",
    "Kai Havertz": "Germany", "Kamaldeen Sulemana": "Ghana", "Kaoru Mitoma": "Japan",
    "Karl Hein": "Estonia", "Kasey McAteer": "England", "Kayden Jackson": "England",
    "Keane Lewis-Potter": "England", "Kenny Tete": "Netherlands", "Kevin De Bruyne": "Belgium",
    "Kevin Schade": "Germany", "Kieran Tierney": "Scotland", "Kieran Trippier": "England",
    "Kiernan Dewsbury-Hall": "England", "Kobbie Mainoo": "England", "Konstantinos Mavropanos": "Greece",
    "Kosta Nedeljkovic": "Serbia", "Kostas Tsimikas": "Greece", "Kristoffer Ajer": "Norway",
    "Kurt Zouma": "France", "Kyle Walker-Peters": "England", "Lamare Bogarde": "Netherlands",
    "Leandro Trossard": "Belgium", "Leif Davis": "England", "Leny Yoro": "France",
    "Leon Bailey": "Jamaica", "Lesley Ugochukwu": "France", "Levi Colwill": "England",
    "Lewis Cook": "England", "Lewis Dunk": "England", "Lewis Hall": "England",
    "Lewis Miley": "England", "Liam Delap": "England", "Lisandro Martínez": "Argentina",
    "Lloyd Kelly": "England", "Lucas Bergström": "Finland", "Lucas Bergvall": "Sweden",
    "Lucas Digne": "France", "Lucas Paquetá": "Brazil", "Luis Díaz": "Colombia",
    "Luis Guilherme": "Brazil", "Luis Sinisterra": "Colombia", "Lukasz Fabianski": "Poland",
    "Luke Cundle": "England", "Luke Harris": "Wales", "Luke Shaw": "England",
    "Luke Thomas": "England", "Luke Woolfenden": "England", "Mads Hermansen": "Denmark",
    "Mads Roerslev": "Denmark", "Malo Gusto": "France", "Manuel Akanji": "Switzerland",
    "Manuel Ugarte": "Uruguay", "Marc Cucurella": "Spain", "Marc Guiu": "Spain",
    "Marc Guéhi": "England", "Marcos Senesi": "Argentina", "Marcus Harness": "England",
    "Marcus Rashford": "England", "Marcus Tavernier": "England", "Marek Rodák": "Slovakia",
    "Mario Lemina": "Gabon", "Mark Flekken": "Netherlands", "Mark Gillespie": "England",
    "Mark Travers": "Ireland", "Martin Dúbravka": "Slovakia", "Martin Ødegaard": "Norway",
    "Mason Holgate": "England", "Mason Mount": "England", "Massimo Luongo": "Australia",
    "Mateo Kovacic": "Croatia", "Matheus Cunha": "Brazil", "Matheus França": "Brazil",
    "Matheus Nunes": "Portugal", "Mathias Jensen": "Denmark", "Mats Wieffer": "Netherlands",
    "Matt Doherty": "Ireland", "Matt O'Riley": "Denmark", "Matt Targett": "England",
    "Matthew Cox": "England", "Matthijs de Ligt": "Netherlands", "Matty Cash": "Poland",
    "Matz Sels": "Belgium", "Max Aarons": "England", "Max Kilman": "England",
    "Maxence Lacroix": "France", "Michael Keane": "England", "Michail Antonio": "Jamaica",
    "Micky van de Ven": "Netherlands", "Miguel Almirón": "Paraguay", "Mikel Merino": "Spain",
    "Mikey Moore": "England", "Mikkel Damsgaard": "Denmark", "Milos Kerkez": "Hungary",
    "Mohamed Salah": "Egypt", "Mohammed Kudus": "Ghana", "Moisés Caicedo": "Ecuador",
    "Morato": "Brazil", "Morgan Gibbs-White": "England", "Morgan Rogers": "England",
    "Murillo": "Brazil", "Mykhailo Mudryk": "Ukraine", "Myles Lewis-Skelly": "England",
    "Naouirou Ahamada": "France", "Nathan Aké": "Netherlands", "Nathan Broadhead": "Wales",
    "Nathan Collins": "Ireland", "Nathan Patterson": "Scotland", "Nathaniel Clyne": "England",
    "Nayef Aguerd": "Morocco", "Neal Maupay": "France", "Neco Williams": "Wales",
    "Nelson Semedo": "Portugal", "Neto": "Brazil", "Nick Pope": "England",
    "Niclas Füllkrug": "Germany", "Nico González": "Spain", "Nicolas Jackson": "Senegal",
    "Nicolás Domínguez": "Argentina", "Nikola Milenkovic": "Serbia", "Noni Madueke": "England",
    "Noussair Mazraoui": "Morocco", "Odsonne Edouard": "France", "Ola Aina": "Nigeria",
    "Oleksandr Zinchenko": "Ukraine", "Oliver Skipp": "England", "Ollie Watkins": "England",
    "Omari Hutchinson": "England", "Oscar Bobb": "Norway", "Pablo Sarabia": "Spain",
    "Pape Matar Sarr": "Senegal", "Paris Maghoma": "England", "Patson Daka": "Zambia",
    "Pau Torres": "Spain", "Pedro Lima": "Brazil", "Pedro Neto": "Portugal",
    "Pedro Porro": "Spain", "Pervis Estupiñán": "Ecuador", "Phil Foden": "England",
    "Philip Billing": "Denmark", "Radu Dragusin": "Romania", "Ramón Sosa": "Paraguay",
    "Rasmus Højlund": "Denmark", "Rayan Aït-Nouri": "Algeria", "Raúl Jiménez": "Mexico",
    "Reece James": "England", "Reiss Nelson": "England", "Remi Matthews": "England",
    "Renato Veiga": "Portugal", "Ricardo Pereira": "Portugal", "Riccardo Calafiori": "Italy",
    "Richarlison": "Brazil", "Rico Henry": "England", "Rico Lewis": "England",
    "Robert Sánchez": "Spain", "Robin Olsen": "Sweden", "Rodri": "Spain",
    "Rodrigo Bentancur": "Uruguay", "Rodrigo Gomes": "Portugal", "Rodrigo Muniz": "Brazil",
    "Roméo Lavia": "Belgium", "Ronnie Edwards": "England", "Ross Barkley": "England",
    "Ross Stewart": "Scotland", "Ryan Christie": "Scotland", "Ryan Fraser": "Scotland",
    "Ryan Gravenberch": "Netherlands", "Ryan Manning": "Ireland", "Ryan Sessegnon": "England",
    "Ryan Yates": "England", "Rúben Dias": "Portugal", "Sam Johnstone": "England",
    "Sam Morsy": "Egypt", "Samuel Amo-Ameyaw": "England", "Samuel Iling-Junior": "England",
    "Sander Berge": "Norway", "Sandro Tonali": "Italy", "Santiago Bueno": "Uruguay",
    "Sasa Kalajdzic": "Austria", "Sasa Lukic": "Serbia", "Savinho": "Brazil",
    "Scott Carson": "England", "Sean Longstaff": "England", "Sekou Mara": "France",
    "Sepp van den Berg": "Netherlands", "Sergio Reguilón": "Spain", "Shea Charles": "Northern Ireland",
    "Simon Adingra": "Ivory Coast", "Solly March": "England", "Son Heung-min": "South Korea",
    "Stefan Ortega": "Germany", "Stephy Mavididi": "England", "Steven Benda": "Germany",
    "Sven Botman": "Netherlands", "Séamus Coleman": "Ireland", "Taiwo Awoniyi": "Nigeria",
    "Takehiro Tomiyasu": "Japan", "Tariq Lamptey": "Ghana", "Taylor Harwood-Bellis": "England",
    "Thomas Partey": "Ghana", "Tim Iroegbunam": "England", "Timo Werner": "Germany",
    "Timothy Castagne": "Belgium", "Tino Livramento": "England", "Toby Collyer": "England",
    "Tom Cairney": "Scotland", "Tom Heaton": "England", "Tom King": "Wales",
    "Tommy Doyle": "England", "Tomás Soucek": "Czech Republic", "Tosin Adarabioyo": "England",
    "Toti Gomes": "Portugal", "Trent Alexander-Arnold": "England", "Trevoh Chalobah": "England",
    "Tyler Adams": "USA", "Tyler Morton": "England", "Tyrell Malacia": "Netherlands",
    "Tyrick Mitchell": "England", "Tyrone Mings": "England", "Victor Kristiansen": "Denmark",
    "Victor Lindelöf": "Sweden", "Virgil van Dijk": "Netherlands", "Vitaliy Mykolenko": "Ukraine",
    "Vitaly Janelt": "Germany", "Vitezslav Jaros": "Czech Republic", "Vitor Reis": "Brazil",
    "Vladimir Coufal": "Czech Republic", "Wataru Endo": "Japan", "Wayne Hennessey": "Wales",
    "Wes Burns": "Wales", "Wes Foderingham": "England", "Wesley Fofana": "France",
    "Wilfred Ndidi": "Nigeria", "Will Dennis": "England", "Will Hughes": "England",
    "Will Lankshear": "England", "Will Smallbone": "England", "William Osula": "Denmark",
    "William Saliba": "France", "Willy Boly": "Ivory Coast", "Wilson Odobert": "France",
    "Wout Faes": "Belgium", "Yankuba Minteh": "Gambia", "Yasin Ayari": "Sweden",
    "Yehor Yarmoliuk": "Ukraine", "Yerson Mosquera": "Colombia", "Yoane Wissa": "DR Congo",
    "Youri Tielemans": "Belgium", "Youssef Chermiti": "Portugal", "Yukinari Sugawara": "Japan",
    "Yunus Akgün": "Turkey", "Yves Bissouma": "Mali",
  };

  const PLAYER_NATIONALITY = {};
  function setNationalities(map) {
    if (!map) return 0;
    let n = 0;
    for (const [name, nation] of Object.entries(map)) {
      if (typeof name === "string" && typeof nation === "string" && nation) {
        PLAYER_NATIONALITY[name] = nation; n++;
      }
    }
    _normIndex = null;   // stale after any change; rebuilt lazily on next lookup
    return n;
  }
  /* Diacritics dropped and case folded, so "Ibrahima Konate" (as supplied)
   * still matches "Ibrahima Konaté" (as the database spells it) without
   * requiring the source data to be byte-perfect. Built once, lazily, since
   * the table only grows via setNationalities after load. */
  let _normIndex = null;
  function normName(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function normIndex() {
    if (_normIndex) return _normIndex;
    _normIndex = new Map();
    for (const [name, nation] of Object.entries(PLAYER_NATIONALITY)) _normIndex.set(normName(name), nation);
    return _normIndex;
  }
  /** A real player's nationality if we know it, otherwise null. */
  function knownNationality(name) {
    if (PLAYER_NATIONALITY[name]) return PLAYER_NATIONALITY[name];
    return normIndex().get(normName(name)) || null;
  }

  /* -------------------------------- FLAGS -----------------------------------
   * Vibrancy on the squad screen: a flag next to every name makes the
   * international clusters and cultural mix in a dressing room visible at a
   * glance rather than something you infer from reading thirty names. England,
   * Scotland and Wales use the home-nation flag emoji rather than the Union
   * Flag, since the game already treats them as separate nations everywhere
   * else; Northern Ireland has no widely-supported flag emoji of its own and
   * falls back to the Union Flag. */
  const FLAGS = {
    "Algeria": "🇩🇿",
    "Argentina": "🇦🇷",
    "Australia": "🇦🇺",
    "Austria": "🇦🇹",
    "Belgium": "🇧🇪",
    "Bosnia and Herzegovina": "🇧🇦",
    "Brazil": "🇧🇷",
    "Burkina Faso": "🇧🇫",
    "Cameroon": "🇨🇲",
    "Canada": "🇨🇦",
    "Chile": "🇨🇱",
    "Colombia": "🇨🇴",
    "Croatia": "🇭🇷",
    "Czech Republic": "🇨🇿",
    "DR Congo": "🇨🇩",
    "Denmark": "🇩🇰",
    "Ecuador": "🇪🇨",
    "Egypt": "🇪🇬",
    "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "Estonia": "🇪🇪",
    "Finland": "🇫🇮",
    "France": "🇫🇷",
    "Gabon": "🇬🇦",
    "Gambia": "🇬🇲",
    "Germany": "🇩🇪",
    "Ghana": "🇬🇭",
    "Greece": "🇬🇷",
    "Hungary": "🇭🇺",
    "Iceland": "🇮🇸",
    "Iraq": "🇮🇶",
    "Ireland": "🇮🇪",
    "Italy": "🇮🇹",
    "Ivory Coast": "🇨🇮",
    "Jamaica": "🇯🇲",
    "Japan": "🇯🇵",
    "Kosovo": "🇽🇰",
    "Mali": "🇲🇱",
    "Mexico": "🇲🇽",
    "Morocco": "🇲🇦",
    "Netherlands": "🇳🇱",
    "New Zealand": "🇳🇿",
    "Nigeria": "🇳🇬",
    "Northern Ireland": "🇬🇧",
    "Norway": "🇳🇴",
    "Paraguay": "🇵🇾",
    "Poland": "🇵🇱",
    "Portugal": "🇵🇹",
    "Romania": "🇷🇴",
    "Saint Lucia": "🇱🇨",
    "Saudi Arabia": "🇸🇦",
    "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    "Senegal": "🇸🇳",
    "Serbia": "🇷🇸",
    "Slovakia": "🇸🇰",
    "South Korea": "🇰🇷",
    "Spain": "🇪🇸",
    "Sweden": "🇸🇪",
    "Switzerland": "🇨🇭",
    "Turkey": "🇹🇷",
    "USA": "🇺🇸",
    "Ukraine": "🇺🇦",
    "Uruguay": "🇺🇾",
    "Uzbekistan": "🇺🇿",
    "Wales": "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
    "Zambia": "🇿🇲",
  };
  function flagFor(nation) { return FLAGS[nation] || "🏳️"; }

  setNationalities(REAL_NATIONALITY);

  MG.names = { NATIONS, NATION_KEYS, personName, managerName, randomNation, nationForLeague,
    PLAYER_NATIONALITY, REAL_NATIONALITY, setNationalities, knownNationality, FLAGS, flagFor };
})(typeof globalThis !== "undefined" ? globalThis : this);
