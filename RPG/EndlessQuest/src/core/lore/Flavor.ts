import { TerrainType } from '../world/TerrainType';
import { DayPhase } from '../world/TimeOfDay';
import type { RNG } from '../rng/SeededRNG';
import { drawWithoutRepeat } from './Sampler';

/**
 * Player-facing descriptive text for the Thornmarch.
 *
 * All selection from these tables must be driven by the simulation's SeededRNG so
 * that narration remains reproducible for a given seed. See LORE.md section IV for
 * the tone rules these tables follow.
 */

/**
 * Selects a deterministic element from a non-empty table.
 * @param table Candidate strings
 * @param rng Seeded generator supplying the choice
 * @returns One element of the table
 */
export function pick<T>(table: readonly T[], rng: RNG): T {
  return table[rng.nextInt(0, table.length - 1)];
}

/**
 * Capitalizes the first character of a string.
 *
 * Bestiary names are written lower-case ("a gaunt") so they read correctly mid-sentence;
 * this is applied where such a name opens one.
 *
 * @param text Text to capitalize
 * @returns Text with its first character upper-cased
 */
export function capitalize(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Short noun phrase naming a terrain type, used inline in movement messages.
 */
export const TERRAIN_NAME: Record<TerrainType, string> = {
  [TerrainType.PLAINS]: 'open grass',
  [TerrainType.FOREST]: 'close wood',
  [TerrainType.HILLS]: 'broken hill country',
  [TerrainType.MOUNTAIN]: 'bare stone',
  [TerrainType.WATER]: 'black water',
  [TerrainType.SWAMP]: 'standing mire',
};

/**
 * Longer arrival descriptions, sampled when the player enters a tile.
 */
export const TERRAIN_ARRIVAL: Record<TerrainType, readonly string[]> = {
  [TerrainType.PLAINS]: [
    'You come out into open grass. Nothing can hide here, which cuts both ways.',
    'Flat country, waist-high and going to seed. Someone stopped cutting it years ago.',
    'Open ground. You can see a long way, and be seen the same distance.',
    'Grass to the horizon, bent all one way by a wind that has not stopped in days.',
    'Old furrows under the turf. Someone ploughed this, and then did not come back to it.',
    'A track through the grass, kept open by feet rather than by anybody’s intention.',
  ],
  [TerrainType.FOREST]: [
    'The wood closes over you. The light goes green and then goes out.',
    'Close timber, root-choked underfoot. You hear your own footfalls and nothing answering them.',
    'Trees grown too near each other. Whatever path there was, the wood has taken back.',
    'Deadfall and rot, and a silence that seems to be listening back.',
    'Bark cut with marks at shoulder height, all the way in. Not a language you know.',
    'The canopy shuts out the sky entirely. It could be any hour in here.',
  ],
  [TerrainType.HILLS]: [
    'Broken hill country, all loose stone and dead thorn.',
    'You work up a rise. Old walls run across the slope, laid by nobody living.',
    'Hills, and the wind coming over them with nothing to break it.',
    'A cairn on the crest, added to by every traveller who passed and had a stone.',
    'Sheep country, without sheep. The folds are still standing and the gates are open.',
  ],
  [TerrainType.MOUNTAIN]: [
    'Bare stone. The cold up here has a mineral taste to it.',
    'You climb. There is nothing growing at this height and nothing has for a long time.',
    'High rock, scoured clean. The world below looks like a map of itself.',
    'Wind off the snowline, hard enough to lean into.',
    'A pass, narrow enough that two men could hold it, and somebody clearly once did.',
  ],
  [TerrainType.SWAMP]: [
    'Standing water the colour of tea. Each step takes something back.',
    'Mire. The ground gives, holds, gives again. Things are trapped in it that you do not look at directly.',
    'The mire stinks of iron and rot in equal measure.',
    'Gas comes up in slow bubbles where you tread, and the smell follows you out.',
    'Dead trees standing in the water, barkless, pale as bone.',
  ],
  [TerrainType.WATER]: ['Black water, and no bottom you would care to find.'],
};

/**
 * Ambient lines keyed by phase of the day, sampled occasionally during travel.
 */
export const PHASE_AMBIENCE: Record<DayPhase, readonly string[]> = {
  [DayPhase.DAWN]: [
    'Grey light. The night lets go of you reluctantly.',
    'First light, thin as watered milk.',
    'Birds start up, late and few, and stop again too soon.',
    'The frost on your bedroll goes to water and finds its way in.',
    'Dawn. Whatever kept pace with you in the night has business elsewhere now.',
    'The east goes the colour of a healing bruise.',
  ],
  [DayPhase.DAY]: [
    'The light holds. It is not warmth, but it is something.',
    'Full day. You make what distance you can while you can see.',
    'Sun through cloud, without conviction. You walk.',
    'Insects over the standing water. The day is the safest part and it is still not safe.',
    'Nothing happens for hours, which is the best thing that can be said of it.',
    'You eat on your feet and keep moving.',
  ],
  [DayPhase.DUSK]: [
    'The light is going. The mark at your throat has begun to itch.',
    'Dusk. Shadows come out from under things and do not go back.',
    'You start looking for somewhere with its back to a wall.',
    'The birds go quiet all at once, the way they do when something moves through.',
    'Last of the light on the high ground. Down here it is already gone.',
    'You count what you are carrying, because after dark it is too late to find out.',
  ],
  [DayPhase.NIGHT]: [
    'Full dark. The weal on your throat is warm, and getting warmer.',
    'Night. You can hear something keeping pace that stops when you stop.',
    'The dark out here is not empty. It is occupied, and it is patient.',
    'No moon. You go by feel and by the sound of your own footing.',
    'Something laughs, a long way off, and it is not a bird.',
    'The cold gets in under everything. There is nothing to do but keep walking.',
    'Your fire is the only light in the world, and it tells everything exactly where you are.',
  ],
};

/**
 * Lines describing the Gallowsmark at escalating intensity bands.
 * Index corresponds to MARK_BAND_LABELS.
 */
export const MARK_BAND_LABELS: readonly string[] = ['Cold', 'Warm', 'Hot', 'Burning', 'Open'];

/**
 * Narration emitted when the Mark crosses into a hotter band.
 */
export const MARK_ESCALATION_LINES: readonly string[] = [
  'The weal at your throat cools. For now.',
  'The mark warms, the way skin warms under a held match.',
  'The mark is hot. You can feel your own pulse in it.',
  'The mark burns. Something out there has your direction now.',
  'The mark splits and weeps. You are lit up like a signal fire to anything that eats.',
];

/**
 * Forage results by terrain, used by the SEARCH command.
 * Each entry pairs narration with the item key it yields.
 */
export interface ForageEntry {
  /** Narration shown to the player */
  readonly message: string;
  /** Item key granted, or null for a find with no material reward */
  readonly item: string | null;
}

/**
 * Terrain-specific forage tables. Water is unreachable and therefore absent of yields.
 */
export const FORAGE_TABLE: Record<TerrainType, readonly ForageEntry[]> = {
  [TerrainType.PLAINS]: [
    { message: 'You turn up a stand of hedgerow berries the birds missed.', item: 'wild_berries' },
    { message: 'A hare, snared badly by someone who never came back for it. Still good.', item: 'raw_meat' },
    { message: 'Rainwater held in a stone trough. You fill what you have.', item: 'waterskin' },
    { message: 'A field gone to seed, and a sickle left in it. The handle is still sound.', item: 'sickle' },
    { message: 'Windfall apples under a tree nobody owns any more.', item: 'apple' },
    { message: 'A crock in the ruin of a steading, sealed, and the seal is good.', item: 'honey' },
    { message: 'Someone’s snare-line, and someone’s knife left beside it.', item: 'hunting_knife' },
    { message: 'Cart-spill in the ruts: a loaf, gone hard, still bread.', item: 'stale_bread' },
    { message: 'You walk the whole field and put up nothing but crows.', item: null },
  ],
  [TerrainType.FOREST]: [
    { message: 'Mushrooms at the foot of a dead ash. You know these ones.', item: 'mushroom' },
    { message: 'A snare-line, old but intact. Something is in the third one.', item: 'raw_meat' },
    { message: 'A seep running off the rocks, thin and cold.', item: 'waterskin' },
    { message: 'A charcoal-burner\u2019s camp, long cold. Someone left in a hurry and left this.', item: 'bandage' },
    { message: 'Firewood, already cut and bundled, and nobody has come back for it.', item: 'firewood' },
    { message: 'A fallen nest, and eggs in it that the cold has kept.', item: 'apple' },
    { message: 'Fungus off the north face of an oak, dry enough to take a spark.', item: 'tinderbox' },
    { message: 'Rope, coiled at the foot of a tree, cut at one end. You do not look up.', item: 'rope' },
    { message: 'Herbs growing where the light gets in, and you know two of the three.', item: 'herbs' },
    { message: 'The wood gives you nothing but the sense of being further in than you were.', item: null },
  ],
  [TerrainType.HILLS]: [
    { message: 'Hard little sloes off a thorn. They set your teeth on edge but they are food.', item: 'wild_berries' },
    { message: 'A spring coming up through the scree.', item: 'waterskin' },
    { message: 'A cairn, opened. Whoever did it left the coin and took everything else.', item: 'ancient_coin' },
    { message: 'A shepherd\u2019s crook, or what is left of one. It takes weight off the road.', item: 'walking_stick' },
    { message: 'A drystone fold with a store dug under it: salt, and not much else.', item: 'salt' },
    { message: 'A ewe dead a day, no more. You take what will keep.', item: 'raw_meat' },
    { message: 'Flint in the scree, the good kind, ready to strike.', item: 'flint_steel' },
    { message: 'Wind, thorn, and stone, and you go over all three for nothing.', item: null },
  ],
  [TerrainType.MOUNTAIN]: [
    { message: 'Snowmelt in a rock hollow.', item: 'waterskin' },
    { message: 'A goat dead of the cold, frozen sound. You take what you can carry.', item: 'raw_meat' },
    { message: 'A knapped flake of stone in a scree field, shaped by somebody, a long time ago.', item: 'stone_knife' },
    { message: 'Nothing grows here. You find only the wind and the taste of stone.', item: null },
    { message: 'A body in the col, sitting up, frozen. His pack still buckled.', item: 'dried_meat' },
    { message: 'A cairn with a cloak folded on top of it, kept dry by the stone.', item: 'wool_cloak' },
    { message: 'Ice in a crevice, cleaner than anything down in the valleys.', item: 'waterskin' },
  ],
  [TerrainType.SWAMP]: [
    { message: 'Reed roots, bitter, edible if you are past caring.', item: 'wild_berries' },
    { message: 'Something is caught in the reeds. You take the satchel and do not look further.', item: 'bandage' },
    { message: 'Feverfew, growing where the ground is sourest. Of course it does.', item: 'feverfew' },
    { message: 'Nightshade, heavy with berries that look like fruit. That is the trouble with it.', item: 'poison_herb' },
    { message: 'The water here is foul. You leave it.', item: null },
    { message: 'Eels in a stopped-up channel, easier to take than they should be.', item: 'raw_meat' },
    { message: 'A punt half sunk, and a rod still lashed inside it.', item: 'fishing_rod' },
    { message: 'Cloth in the reeds, wound round something you leave where it is.', item: 'bandage' },
  ],
  [TerrainType.WATER]: [{ message: 'There is nothing here but water.', item: null }],
};

/**
 * Narration for a search that yields nothing.
 */
export const FORAGE_FAILURE_LINES: readonly string[] = [
  'You work the ground over and come up with nothing.',
  'An hour gone, and nothing to show for it but the hour.',
  'Others have been through here already, and were thorough.',
  'Nothing. The Thornmarch has been picked clean for a generation.',
    'What you find is not food, whatever it used to be.',
    'You spend the hour and the hour spends you.',
    'The ground here has given up all it means to give.',
];

/**
 * Returns a deterministic arrival description for a terrain type.
 * @param terrain Terrain being entered
 * @param rng Seeded generator
 * @returns Descriptive sentence
 */
export function describeArrival(
  terrain: TerrainType,
  rng: RNG,
  memory: Record<string, string> = {}
): string {
  return drawWithoutRepeat(
    TERRAIN_ARRIVAL[terrain],
    rng,
    memory,
    `arrival:${terrain}`,
    (line) => line
  );
}

/**
 * Returns the reason a terrain type cannot be entered.
 * @param terrain Impassable terrain
 * @returns Refusal sentence
 */
export function describeBlocked(terrain: TerrainType): string {
  if (terrain === TerrainType.WATER) {
    return 'Black water. You are not going that way and living.';
  }
  return `${TERRAIN_NAME[terrain]} bars the way.`;
}
