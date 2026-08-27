/**
 * Central simulation constants for EndlessQuest.
 * Contains calendar parameters, terrain thresholds, noise generation settings,
 * and entity stat change rates.
 */

// Calendar and Time
export const HOURS_PER_DAY = 24;
export const DAYS_PER_SEASON = 90;
export const SEASONS_PER_YEAR = 4;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS_PER_YEAR; // 360 days
export const HOURS_PER_YEAR = DAYS_PER_YEAR * HOURS_PER_DAY; // 8640 hours
export const INITIAL_HOUR = 6;
export const INITIAL_DAY = 1;
export const INITIAL_YEAR = 1;

// World & Map Dimensions
export const DEFAULT_MAP_WIDTH = 240;
export const DEFAULT_MAP_HEIGHT = 240;
export const DEFAULT_TILE_SIZE = 32;
export const DEFAULT_VIEWPORT_WIDTH = 20;
export const DEFAULT_VIEWPORT_HEIGHT = 15;

// Fog of War / Exploration
export const DEFAULT_REVEAL_RADIUS = 1;
export const SEARCH_REVEAL_RADIUS = 2;

// Sight - how far the character can see, and therefore how much they remember.
// These live in the core rather than in the renderer because what a character can see
// is a fact about the world: it decides what the map remembers, not just what is drawn.
/** How far the character sees in full daylight, in tiles. */
export const DAYLIGHT_SIGHT_RADIUS = 9;
/** How far at dawn and dusk. */
export const TWILIGHT_SIGHT_RADIUS = 6;
/** How far in full dark. */
export const NIGHT_SIGHT_RADIUS = 3;
export const INITIAL_SPAWN_REVEAL_RADIUS = 2;

// Map Generation - Noise parameters
export const ELEVATION_OCTAVE_1_FREQ = 2.5;
export const ELEVATION_OCTAVE_1_WEIGHT = 0.6;
export const ELEVATION_OCTAVE_2_FREQ = 5.0;
export const ELEVATION_OCTAVE_2_WEIGHT = 0.3;
export const ELEVATION_OCTAVE_3_FREQ = 10.0;
export const ELEVATION_OCTAVE_3_WEIGHT = 0.1;
export const ELEVATION_EXPONENT = 1.1;

export const MOISTURE_OCTAVE_1_FREQ = 3.0;
export const MOISTURE_OCTAVE_1_WEIGHT = 0.7;
export const MOISTURE_OCTAVE_2_FREQ = 6.0;
export const MOISTURE_OCTAVE_2_WEIGHT = 0.3;

// Map Generation - Terrain thresholds
export const WATER_ELEVATION_THRESHOLD = 0.2;
export const SWAMP_MOISTURE_THRESHOLD_LOW = 0.6;
export const SWAMP_MOISTURE_THRESHOLD_MID = 0.75;
export const PLAINS_ELEVATION_THRESHOLD = 0.4;
export const FOREST_HILLS_ELEVATION_THRESHOLD = 0.65;
export const FOREST_MOISTURE_THRESHOLD = 0.55;

// Settlement Placement
/**
 * How much country there is per inhabited place.
 *
 * The march used to carry two to four single-tile villages in ten thousand squares,
 * which is why a playtest could walk eleven days without meeting anybody: the odds of
 * stumbling onto one by accident were roughly nil. One holding per nine hundred squares
 * puts a village within a day or two of wherever you are standing, which is what a
 * borderland with people still living in it should feel like.
 */
export const TILES_PER_SETTLEMENT = 900;
/** Never fewer than this many, whatever the map size. */
export const MIN_SETTLEMENT_COUNT = 8;
/** Nor more than this, so the country is inhabited rather than suburban. */
export const MAX_SETTLEMENT_COUNT = 90;
/** Villages this close together would read as one place. */
export const SETTLEMENT_MIN_SEPARATION = 9;
export const SETTLEMENT_MARGIN = 6;
export const MAX_SETTLEMENT_ATTEMPTS = 8000;

/**
 * How far outside a village the run begins.
 *
 * Close enough that the smoke is visible and the walk in is short; far enough that the
 * character wakes under the tree they were hanged on rather than in somebody's doorway.
 */
export const START_DISTANCE_FROM_VILLAGE = 3;

/**
 * The level a need has to reach before a journey stops for it.
 *
 * High enough that a leg is not interrupted every hour, low enough that the character
 * never walks blithely into the state an early playtest died in.
 */
export const TRAVEL_STOP_NEED = 70;

/**
 * The most miles one journey will resolve before it gives up.
 *
 * Purely a guard against a bearing walked into a corner; the hours asked for are what
 * actually ends a leg.
 */
export const MAX_JOURNEY_STEPS = 200;

/** Hours in a day's march before the body wants talking into more. */
export const TRAVEL_DAY_HOURS = 8;

/**
 * How much hunger a day's foraging on the march relieves.
 *
 * Enough to keep a walker walking, not enough to make a pack of food pointless: a good
 * day off the country is most of a meal, and a bad one is nothing at all.
 */
export const FORAGE_YIELD = 30;

/**
 * How much thirst a day's foraging relieves, before the country's own dryness is applied.
 *
 * Deliberately less than a spring or a stream, which slake it entirely: what you scrape
 * out of dew and roots keeps you walking toward water, it is not water.
 */
export const FORAGE_WATER_YIELD = 45;

/** How many times a duplicate name is redrawn before it is qualified instead. */
export const NAME_REDRAWS = 24;

/**
 * How many rooms an instance is laid out in.
 *
 * Short enough to be one sitting, long enough to have a shape: a way in, a decision or
 * two about which way, and an end.
 */
/**
 * The number a thing inside an instance has to beat to land a blow.
 *
 * The instance skirmish is deliberately its own, simpler ledger: what matters in a
 * dungeon is the shape of the fight, not another armour calculation.
 */
export const DM_GUARD_CLASS = 12;

/** How many of the player's actions the Dungeon Master keeps in mind. */
export const BLACKBOARD_MEMORY = 24;

/**
 * How good a plan has to look before the Dungeon Master bothers.
 *
 * A DM that plays every card it holds every turn is exhausting. Most turns should be
 * the things in the room simply fighting, with the table's attention spent sparingly.
 */
export const PLAN_DRAMA_FLOOR = 4;

/** How far word of a place being cleared travels. */
export const RELIEF_RANGE = 30;

/** How much a parish's opinion moves when somebody does something about their problem. */
export const REPUTATION_STEP = 22;

/** How long whoever got out of a place stays interested, in hours. */
export const GRUDGE_RANGE = 72;

/** How long a room takes to cross or turn over, in hours of the overworld clock. */
export const DELVE_HOURS_PER_ROOM = 1;

/** How low a thing's nerve check has to come in before it leaves. */
export const DM_MORALE_FLOOR = 12;

/** Below this share of hit points the DM eases off rather than pressing. */
export const DM_PRESSURE_EASE = 0.35;

/** How many turns into a place before the DM will spend its reinforcement. */
export const DM_REINFORCE_TURN = 4;

export const INSTANCE_ROOMS = { min: 5, max: 9 } as const;

/** How many ordinary caches an instance carries beyond the lair and the secret room. */
export const INSTANCE_PRIZE_ROOMS = 3;

/**
 * How much bigger the thing at the end is than the same creature met on the road.
 *
 * A boss is a fight with a shape to it, and a shape needs rounds to happen in.
 */
export const INSTANCE_BOSS_MULTIPLIER = 2.2;

/**
 * How close a spring has to be to drink from it.
 *
 * Standing on it, or the tile beside it. Springs are the country's answer to thirst and
 * the whole reason they are placed in the hills and the deep wood.
 */
export const WATER_FROM_SPRING_RANGE = 1;

/** How many known places the interface lists before it stops. */
export const KNOWN_PLACES_SHOWN = 6;

/** How far off a village's smoke can be seen and named. */
export const SETTLEMENT_SIGHT = 6;

/**
 * How far the talk in a village carries.
 *
 * People know their neighbours. Standing in one place and asking is the main way the
 * country becomes navigable at all.
 */
export const VILLAGE_TALK_RANGE = 34;

/** How far a finger-post at a crossroads names places. */
export const SIGNPOST_RANGE = 26;

/** One site per this many squares of country. */
export const SITE_DENSITY = 150;
/** Sites closer than this read as one cluttered place. */
export const SITE_MIN_SEPARATION = 4;
/** Placement tries per site before giving up on the target count. */
export const SITE_PLACEMENT_ATTEMPTS = 40;
/** Sites are not placed within this of the map edge. */
export const SITE_MARGIN = 4;

// Player & Stat Dynamics
export const DEFAULT_MAX_HP = 100;
export const DEFAULT_INITIAL_HP = 100;
export const MIN_STAT_VALUE = 0;
export const MAX_STAT_VALUE = 100;

export const FATIGUE_PER_MOVE_COST = 0.5;
export const FATIGUE_REST_RECOVERY_PER_HOUR = 5.0;

// Actions
/** Difficulty Class of a foraging check. */
export const FORAGE_DC = 12;
export const SEARCH_TIME_COST_HOURS = 1;
/** Chance that a travel message carries a line of time-of-day ambience. */
export const AMBIENCE_PROBABILITY = 0.3;
export const MIN_REST_HOURS = 1;
export const MAX_REST_HOURS = 24;

// Day/Night Cycle boundaries (hour of day at which each phase begins)
export const DAWN_HOUR = 5;
export const DAY_HOUR = 8;
export const DUSK_HOUR = 18;
export const NIGHT_HOUR = 21;

// Needs - baseline hourly accrual (NeedsSystem is the sole source of need accrual)
export const HUNGER_PER_HOUR = 0.55;
export const THIRST_PER_HOUR = 1.1;
export const FATIGUE_PER_HOUR_AWAKE = 1.0;

// Water - what there is to drink, and what it costs to drink it
/** Thirst taken off by drinking clean water. */
export const CLEAN_WATER_RELIEF = 100;
/** Thirst taken off by drinking foul water and regretting it. */
export const FOUL_WATER_RELIEF = 40;
/** Difficulty Class of the Constitution save against standing water. */
export const FOUL_WATER_DC = 11;
/** What it costs when that save fails. */
export const FOUL_WATER_DICE = '1d4';
/** Moisture at or above which a tile holds water worth drinking. */
export const DRINKABLE_MOISTURE = 0.72;

// Needs - consequences of neglect
export const NEED_WARNING_THRESHOLD = 75;
/** Days a character endures without food before deprivation costs exhaustion, before the Constitution modifier. */
export const DAYS_WITHOUT_FOOD_BASE = 3;
/** Difficulty Class of the daily Constitution save when short of water. */
export const WATER_SAVE_DC = 15;

// Needs - passive recovery while all needs are comfortably met
export const HP_REGEN_PER_HOUR = 0.6;
/** Hours of unbroken rest that count as a night's sleep. */
export const LONG_REST_HOURS = 8;
/** Fraction of the hit point maximum a night's sleep gives back, fed and watered. */
export const LONG_REST_HEAL_FRACTION = 0.5;
export const HP_REGEN_NEED_CEILING = 50;

// The Gallowsmark - intensity bounds and hourly drift
export const MARK_MIN = 0;
export const MARK_MAX = 100;
export const MARK_NIGHT_RISE_PER_HOUR = 1.6;
export const MARK_DUSK_RISE_PER_HOUR = 0.8;
export const MARK_DAWN_FALL_PER_HOUR = 0.5;
export const MARK_DAY_FALL_PER_HOUR = 0.9;

/** Additional rise per unit of missing health, as a fraction of the base night rise. */
export const MARK_WOUND_COEFFICIENT = 1.0;

/** Hourly fall while standing within MARK_SANCTUARY_RADIUS of a settlement. */
export const MARK_SANCTUARY_FALL_PER_HOUR = 4.0;
export const MARK_SANCTUARY_RADIUS = 2;

/** Lower bounds of each Mark intensity band; parallel to MARK_BAND_LABELS in lore/Flavor. */
export const MARK_BAND_THRESHOLDS: readonly number[] = [0, 20, 40, 65, 85];

// Encounters - non-homogeneous Poisson process parameters (design doc 2.4)
/** Baseline hourly encounter rate at zero Mark intensity. */
export const ENCOUNTER_BASE_RATE = 0.006;
/** Exponential coefficient applied to Mark intensity in the rate function. */
export const ENCOUNTER_MARK_BETA = 0.032;
export const ENCOUNTER_NIGHT_MULTIPLIER = 2.2;
export const ENCOUNTER_DUSK_MULTIPLIER = 1.5;
export const ENCOUNTER_SANCTUARY_MULTIPLIER = 0.05;
/** Upper bound on per-hour encounter probability, so no hour is ever a certainty. */
export const ENCOUNTER_MAX_HOURLY_PROBABILITY = 0.18;
/** Opening grace period in ticks during which nothing hunts the player. */
export const ENCOUNTER_GRACE_TICKS = 24;

// Combat - d20 attack rolls against Armour Class
/** Damage dealt bare-handed, in dice notation. */
export const UNARMED_DAMAGE = '1d2';
/** Armour Class bonus while guarding. */
export const DEFEND_AC_BONUS = 3;
// Morale - when a creature decides it wants no more of this
/** The saving throw a creature makes when it is first cut below half. */
export const MORALE_DC = 10;
/** How much a creature's tenacity stiffens that save. */
export const MORALE_RESOLVE_SCALE = 10;

/** Base Difficulty Class of breaking off an engagement. */
export const FLEE_BASE_DC = 10;
/** How much a threat's tenacity adds to the difficulty of getting away from it. */
export const FLEE_TENACITY_SCALE = 6;
/** Taken off the difficulty of flight for each round already spent breaking contact. */
export const FLEE_ROUND_RELIEF = 2;
/** Floor on the difficulty of flight, so nothing is ever escaped for free. */
export const FLEE_MIN_DC = 8;
/** Weight at or below which a weapon counts as finesse, using Dexterity if better. */
export const FINESSE_WEAPON_MAX_WEIGHT = 0.5;
export const COMBAT_BASE_HIT_PROBABILITY = 0.75;
/** Ceiling on total armour from a loadout, so no equipment makes a character immune. */
export const MAX_EQUIPPED_ARMOR = 0.6;
/** Pareto shape parameter for the critical-hit power law; lower values fatten the tail. */
export const COMBAT_CRIT_ALPHA = 2.2;
/** Damage multiple at or above which a blow is narrated as a critical hit. */
export const COMBAT_CRIT_THRESHOLD = 2.0;
/** Hard cap on the damage multiplier so the power law cannot produce absurd outliers. */
export const COMBAT_DAMAGE_MULTIPLIER_CAP = 6.0;
export const COMBAT_MAX_STAMINA = 100;
/** Hit points a character starts with, standing in for a first-level hit die plus Constitution. */
export const STARTING_HIT_POINTS = 24;
/** Exponential decay rate of stamina per combat round. */
export const COMBAT_STAMINA_DECAY = 0.12;
/** Stamina scale in the effectiveness curve 1 - exp(-S / threshold). */
export const COMBAT_STAMINA_THRESHOLD = 40;
export const COMBAT_DEFEND_ARMOR_BONUS = 0.35;
export const COMBAT_DEFEND_STAMINA_RECOVERY = 12;
/** Time cost in hours charged once a combat concludes, however it concludes. */
export const COMBAT_RESOLUTION_HOURS = 1;

// Progression - what surviving buys
/**
 * Experience needed for levels one through five, on the source's own ladder.
 *
 * Kept in the same currency as what a creature is worth, so that the numbers the player
 * sees when they survive something mean what they mean in the handbook.
 */
export const XP_THRESHOLDS: readonly number[] = [0, 300, 900, 2700, 6500];
/** The ladder stops here: enough to walk out, not enough to be a hero. */
export const MAX_CHARACTER_LEVEL = 5;
/** Hit die rolled on gaining a level. */
export const HIT_DIE = '1d8';
/** Fraction of a threat's experience awarded for surviving it without killing it. */
export const XP_SURVIVED_FRACTION = 0.5;

// The Reckoning - the objective, and the only ending that is not a death
/** How far from the character's waking place the gallows-tree is put, in tiles. */
export const RECKONING_TREE_MIN_DISTANCE = 26;
/**
 * And no further.
 *
 * The endgame is a fixed length of run rather than a share of the map, so that making
 * the country bigger adds places to go rather than lengthening the one walk the whole
 * run is about.
 */
export const RECKONING_TREE_MAX_DISTANCE = 42;
/** How many vigils a world carries. */
export const VIGIL_COUNT = 3;
/** Minimum distance between the tree, the vigils, and the character's start. */
export const VIGIL_MIN_SEPARATION = 8;
/** How far off the road from the start to the tree a vigil may sit. */
export const VIGIL_WANDER = 7;
/** Placement draws allowed per site before taking the best candidate so far. */
export const VIGIL_PLACEMENT_ATTEMPTS = 400;
/** Hours a vigil takes to keep. */
export const VIGIL_RITE_HOURS = 4;
/** Difficulty Class of the rite kept at a vigil. */
export const VIGIL_DC = 13;
/** Gallowsmark intensity taken off permanently by keeping a vigil. */
export const VIGIL_MARK_RELIEF = 20;
/** Difficulty Class of the reckoning at the tree before any relief. */
export const RECKONING_BASE_DC = 18;
/** Taken off the reckoning's DC for each vigil kept. */
export const RECKONING_VIGIL_RELIEF = 3;
/** Added to the reckoning's DC for each band the Gallowsmark is burning at. */
export const RECKONING_BAND_PENALTY = 2;
/** Saving throws made at the tree. */
export const RECKONING_SAVES = 3;
/** Floor on the reckoning's DC, so preparation can never make it a formality. */
export const MIN_RECKONING_DC = 10;
/** Successes needed among them to cut the debt loose. */
export const RECKONING_SUCCESSES = 2;

/** Need level at or above which a forager uses what they find on the spot. */
export const FORAGE_CONSUME_THRESHOLD = 50;

/**
 * How many events the live log keeps.
 *
 * The interface shows a window of the most recent entries and a save stores its own
 * window, so an unbounded in-memory log is pure accumulation: a long run would carry
 * tens of thousands of dead event objects around for no reader.
 */
export const LIVE_LOG_LIMIT = 2000;

// Narrative threads - how long the world waits before returning to something
/** Hours before something following the character makes up its mind. */
export const THREAD_FOLLOW_HOURS = 10;
/** Hours before an untreated wound is checked again. */
export const THREAD_WOUND_HOURS = 12;
/** Hours before something lost turns up again. */
export const THREAD_LOST_HOURS = 20;
/** Difficulty Class of the Constitution save against a wound going bad. */
export const THREAD_FESTER_DC = 12;
/** Damage taken when a wound festers. */
export const THREAD_WOUND_DICE = '1d4';
/** Gallowsmark intensity added when a thread closes against the character. */
export const THREAD_MARK_SPIKE = 10;

// Improvisation - ruling on what the player tried that nothing planned for
/** Hours an improvised attempt costs. */
export const IMPROVISE_HOURS = 1;
/**
 * Baseline difficulty of an improvised attempt.
 *
 * Deliberately below the handbook's medium: the point of letting a player try anything
 * is that trying things works often enough to be worth doing. Circumstance pushes it up
 * from here.
 */
export const IMPROVISE_BASE_DC = 12;
/** Chance an ordinary failure also draws a twist; a fumble always does. */
export const IMPROVISE_TWIST_CHANCE = 0.4;
/** Added to the difficulty for attempts of the sort that tend to be hard. */
export const IMPROVISE_HARD_STEP = 3;
/** Added to the difficulty for each band the Gallowsmark is burning at. */
export const IMPROVISE_MARK_STEP = 1;
/** Tiles revealed by successfully studying the country. */
export const IMPROVISE_REVEAL_BONUS = 3;
/** Gallowsmark intensity taken off by successfully going to ground. */
export const IMPROVISE_MARK_RELIEF = 6;

/**
 * Hunger and thirst relieved by a successful piece of woodcraft.
 *
 * Deliberately less than a meal out of the pack: what you scrape out of the country in
 * an hour keeps you going, it does not set you up.
 */
export const IMPROVISE_FORAGE_RELIEF = 10;

// The narrator - how loudly the thing watching speaks, by Mark band
/** Chance the narrator interjects, indexed by register. */
export const NARRATOR_INTRUSION_CHANCE: readonly number[] = [0, 0.12, 0.28, 0.45, 0.6];
/** Register at or above which the narrator may fabricate an account outright. */
export const NARRATOR_LIE_BAND = 4;
/** Chance a line is fabricated once the narrator is lying at all. */
export const NARRATOR_LIE_CHANCE = 0.3;
/** Hours that must pass between fabrications, so a lie still lands as one. */
export const NARRATOR_LIE_COOLDOWN_HOURS = 6;
/** Chance a talkative narrator uses what it knows about this character specifically. */
export const NARRATOR_PERSONAL_CHANCE = 0.35;

// Oracle twists - what a bad roll actually costs
/** Gallowsmark intensity added when a twist draws notice. */
export const TWIST_MARK_RISE = 6;
/** Damage taken from a twist that opens the character up. */
export const TWIST_WOUND_DICE = '1d4';
/** Hours burned by a twist that costs the character the afternoon. */
export const TWIST_DELAY_DICE = '1d4';
/** How long a character stays followed after something takes an interest. */
export const STALKED_DURATION_HOURS = 12;
/** Multiplier on the encounter rate while something is following the character. */
export const ENCOUNTER_STALKED_MULTIPLIER = 2.5;

// Inventory - capacity is measured in the catalog's weight units
export const CARRY_CAPACITY = 25;

// Errands - what people ask for, and what it costs when nobody comes
// Social interaction - where somebody stands with you, and what can move it
/** Standing at or below which somebody is hostile. */
export const SOCIAL_HOSTILE_AT = -25;
/** Standing at or above which somebody is friendly. */
export const SOCIAL_FRIENDLY_AT = 25;
/** Difficulty of taking somebody's measure. */
export const READ_DC = 13;
/** Hours it takes to watch somebody long enough to read them. */
export const READ_HOURS = 1;
/** Difficulty of an appeal to what somebody holds to. */
export const APPEAL_DC = 12;
/** Hours an appeal costs. */
export const APPEAL_HOURS = 1;
/** Standing lost by holding somebody's secret over them; it works, and they remember. */
export const PRESS_DISPOSITION = -45;
/** Standing gained by an appeal that lands. */
export const APPEAL_DISPOSITION = 30;

// Asking questions - what people will tell you, and what it takes
/** Hours a question costs. */
export const ASK_HOURS = 1;
/** Baseline difficulty of getting a straight answer out of somebody. */
export const ASK_BASE_DC = 11;
/** How much ground a clean answer puts on the chart. */
export const ASK_REVEAL_RADIUS = 2;

/** Hours a conversation costs. */
export const TALK_HOURS = 1;
/** Penalty to the reaction roll for each band the Gallowsmark is burning at. */
export const TALK_MARK_PENALTY = 2;
/** How much disposition is worth on the reaction roll; 100 goodwill is worth five. */
export const TALK_DISPOSITION_SCALE = 20;

/** How near a place an errand is about the character has to get for it to count. */
export const ERRAND_SITE_RADIUS = 1;
/** How often somebody who has been measured asks for what holds them, not what they do. */
export const BOND_ERRAND_CHANCE = 0.65;
/** Slack added to every deadline, so an errand raised at dusk is not owed by dawn. */
export const ERRAND_DEADLINE_HOURS = 6;
/** Disposition gained for doing somebody a service. */
export const ERRAND_DISPOSITION_DONE = 35;
/** Disposition lost when an errand runs out of time. */
export const ERRAND_DISPOSITION_FAILED = -25;

// People - who lives in the settlements, and what they want
/** How many people a settlement holds. */
export const PEOPLE_PER_SETTLEMENT = { min: 2, max: 4 } as const;

// Settlements - what a coin buys from people who would rather you moved on
/** Catalog item used as currency for barter. */
/** What a village adds to an item's worth to sell it to you. */
export const MARKET_BUY_MARKUP = 1.35;

/** What a village will give you for a thing, as a share of its worth. */
export const MARKET_SELL_RATE = 0.55;

/**
 * How much worse trade gets per band of the Gallowsmark.
 *
 * Nobody wants to be seen dealing with somebody the dark is looking for, and being
 * unwelcome is expensive.
 */
export const MARKET_MARK_SURCHARGE = 0.14;

/** How many things beyond the staples a village happens to have in. */
export const MARKET_STOCK_MIN = 4;
export const MARKET_STOCK_MAX = 9;

/**
 * How far from a village a place has to be for anybody there to care about it.
 *
 * Near enough that the parish has been living with it, and near enough to be worth the
 * walk: a problem forty miles off is somebody else's problem.
 */
export const CHARGE_RANGE = 16;

/** How long a village will wait for somebody to do something about it, in days. */
export const CHARGE_DAYS = 12;

/** How many of a village's offers the interface shows at once. */
export const MARKET_SHOWN = 8;

/** How often a village's stock turns over, in days. */
export const MARKET_RESTOCK_DAYS = 6;

/** What a run starts with in its purse, in copper. */
export const STARTING_COPPER = 24;

export const TRADE_CURRENCY_ITEM = 'copper_coins';
export const TRADE_COIN_COST = 1;
export const TRADE_FORAGE_YIELD = 2;
export const TRADE_WATER_YIELD = 1;
export const TRADE_LINEN_YIELD = 1;
