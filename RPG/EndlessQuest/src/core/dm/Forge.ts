import type { RNG } from '../rng/SeededRNG';
import { SeededRNG } from '../rng/SeededRNG';
import { BESTIARY, ThreatKind } from '../lore/Bestiary';
import type { CreatureArchetype } from '../lore/Bestiary';
import { Difficulty, budgetFor } from '../rules/Encounters';
import { ITEMS } from '../lore/items/Catalog';
import { Rarity } from '../lore/items/ItemTypes';
import {
  InstanceKind,
  RoomKind,
  Temper,
  weightedPick,
} from './Instance';
import type { Instance, Occupant, Prize, Room } from './Instance';
import {
  INSTANCE_ROOMS,
  INSTANCE_PRIZE_ROOMS,
  INSTANCE_BOSS_MULTIPLIER,
} from '../SimulationConstants';

/**
 * Laying a place out before anybody walks into it.
 *
 * This is the DM's preparation, and it happens in one pass, before the door opens: the
 * rooms are drawn, the occupants are placed against a budget worked out from the
 * character who is about to arrive, the loot is hidden, the boss is set at the end, and
 * the reason anybody would come is written down. Nothing here is decided later, which is
 * what makes the place feel like somewhere that was already there.
 */

/** What each kind of place is made of, and what lives in it. */
const SIGNATURE: Record<
  InstanceKind,
  {
    readonly title: readonly string[];
    readonly hooks: readonly string[];
    readonly kinds: readonly ThreatKind[];
    readonly rooms: readonly string[];
    readonly telling: readonly string[];
  }
> = {
  [InstanceKind.DUNGEON]: {
    title: ['the Undercroft', 'the Deep Vault', 'the Stair'],
    hooks: [
      'Something was sealed under here, and the seal is off.',
      'The parish buried its dead down here for two hundred years, and lately some of them have not stayed.',
    ],
    kinds: [ThreatKind.DEAD, ThreatKind.MAN],
    rooms: ['a low vault', 'a pillared hall', 'a flooded stair', 'a bone-stacked niche', 'a collapsed passage'],
    telling: [
      'Scratches on the inside of the door, at the height of a man’s hands.',
      'A lamp, burned out, set down carefully where somebody meant to come back for it.',
      'Bones swept into the corners, the way you sweep a floor.',
    ],
  },
  [InstanceKind.BANDIT_CAMP]: {
    title: ['the Camp in the Cut', 'Hangman’s Ground', 'the Palisade'],
    hooks: [
      'They have been taking the road for a season, and the road is the only way through.',
      'A carter’s daughter went this way and did not come out the other side.',
    ],
    kinds: [ThreatKind.MAN],
    rooms: ['a ring of tents', 'the cook fire', 'a stockade of green wood', 'the picket line', 'a spoil heap'],
    telling: [
      'Boots in a row outside a tent, and more pairs than there are men.',
      'A cart broken up for firewood, its owner’s name still on the board.',
      'Tally marks cut into a post, in fives, and a lot of fives.',
    ],
  },
  [InstanceKind.RUIN]: {
    title: ['the Broken Course', 'the Old Keep', 'Stonefall'],
    hooks: [
      'Whoever built this wrote on the walls, and somebody has been answering.',
      'A thing has moved into the shell of it, and the parish has stopped using the road past.',
    ],
    kinds: [ThreatKind.DEAD, ThreatKind.SATED],
    rooms: ['a roofless hall', 'a stair to nothing', 'a cistern', 'a chapel with the roof gone', 'a gate arch'],
    telling: [
      'Glyphs cut deep and then cut across, later and more crudely.',
      'A hearth swept clean, in a building with no roof and no owner.',
      'Coins laid out in a line on a sill, all of them face down.',
    ],
  },
  [InstanceKind.CAVE]: {
    title: ['the Swallow', 'Blackthroat', 'the Sink'],
    hooks: [
      'The sheep go in and the sheep do not come out.',
      'There is water down there, and the village has stopped drinking from the stream it feeds.',
    ],
    kinds: [ThreatKind.BEAST, ThreatKind.DEAD],
    rooms: ['a squeeze', 'a chamber that opens out', 'a shelf over running water', 'a dead end that smells wrong', 'a rockfall'],
    telling: [
      'Bones cracked lengthways, which is done for the marrow.',
      'A rope, old, tied off at the lip and cut through at the bottom.',
      'Handprints going in. None coming back.',
    ],
  },
  [InstanceKind.DEEP_WOOD]: {
    title: ['the Close Timber', 'the Turning Wood', 'Thornhollow'],
    hooks: [
      'People walk in on a straight path and come out somewhere they did not aim for.',
      'Something in there has been leaving things on doorsteps.',
    ],
    kinds: [ThreatKind.BEAST, ThreatKind.SATED],
    rooms: ['a clearing that should not be there', 'a deer path', 'a stand of marked trees', 'a hollow full of standing water', 'a windfall'],
    telling: [
      'Bark cut at shoulder height, all the way in, in a hand that is not a language you know.',
      'A child’s shoe, set upright on a stump, dry.',
      'The birds stop, in a circle, and start again behind you.',
    ],
  },
  [InstanceKind.HOLDFAST]: {
    title: ['the Chained Hall', 'Irongate', 'the Keep'],
    hooks: [
      'The Iron Chain keeps a house here, and they keep people in it.',
      'Whoever holds this holds the road, and they are minded to keep both.',
    ],
    kinds: [ThreatKind.MAN, ThreatKind.SATED],
    rooms: ['a guardroom', 'a hall with a long table', 'a cell block', 'a stair turret', 'an armoury'],
    telling: [
      'A ledger open on the table, with names in it and a column for what each one confessed.',
      'Straw in the cells, changed recently, which is worse than if it had not been.',
      'A brazier still warm, and irons in it.',
    ],
  },
};

/**
 * Forms an instance in full, before the player enters.
 *
 * @param kind What sort of place it is
 * @param name What it is called out in the country
 * @param x Where its mouth is on the overworld
 * @param y Where its mouth is on the overworld
 * @param level The character's level, which sets the budget
 * @param seed Seed for this particular place, so it is the same place every time
 * @returns The formed instance
 */
export function formInstance(
  kind: InstanceKind,
  name: string,
  x: number,
  y: number,
  level: number,
  seed: string
): Instance {
  const rng = new SeededRNG(`${seed}:${kind}:${x},${y}`);
  const signature = SIGNATURE[kind];

  const rooms = layOut(kind, rng);
  const occupants = stock(kind, rooms, level, rng);
  const prizes = hide(kind, rooms, level, rng);

  return {
    id: `${kind}@${x},${y}`,
    kind,
    name,
    hook: signature.hooks[rng.nextInt(0, signature.hooks.length - 1)],
    x,
    y,
    level,
    rooms,
    occupants,
    prizes,
    current: 0,
    turn: 0,
    resolved: false,
  };
}

/**
 * Draws the rooms and the ways between them.
 *
 * A spine with a couple of branches off it, rather than a maze. The point of the layout
 * is that there is a way in, a way on, a decision or two about which way, and an end --
 * not that it is hard to navigate.
 */
function layOut(kind: InstanceKind, rng: RNG): Room[] {
  const signature = SIGNATURE[kind];
  const count = rng.nextInt(INSTANCE_ROOMS.min, INSTANCE_ROOMS.max);
  const rooms: Room[] = [];

  // Two rooms with one name makes "on to a stockade of green wood" read as a loop when
  // you are standing in a stockade of green wood. Each room gets a name of its own, and
  // the pool is qualified once it runs out rather than repeating.
  const used = new Set<string>();
  const nameRoom = (): string => {
    for (let attempt = 0; attempt < signature.rooms.length * 2; attempt++) {
      const name = signature.rooms[rng.nextInt(0, signature.rooms.length - 1)];
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
    const base = signature.rooms[rng.nextInt(0, signature.rooms.length - 1)];
    for (const qualifier of ['further in', 'off to one side', 'below', 'at the back']) {
      const qualified = `${base}, ${qualifier}`;
      if (!used.has(qualified)) {
        used.add(qualified);
        return qualified;
      }
    }
    return base;
  };

  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    const roomKind = last
      ? RoomKind.LAIR
      : i === 0
        ? RoomKind.ENTRANCE
        : weightedPick(
            [RoomKind.PASSAGE, RoomKind.GUARDED, RoomKind.CACHE, RoomKind.HAZARD],
            (candidate) =>
              candidate === RoomKind.GUARDED ? 4 : candidate === RoomKind.PASSAGE ? 3 : 2,
            rng
          );

    rooms.push({
      id: i,
      kind: roomKind,
      name: nameRoom(),
      description: '',
      telling: signature.telling[rng.nextInt(0, signature.telling.length - 1)],
      exits: [],
      entered: false,
      cleared: false,
    });
  }

  // The spine: every room leads on to the next, and back the way you came.
  for (let i = 0; i < rooms.length - 1; i++) {
    rooms[i].exits.push(i + 1);
    rooms[i + 1].exits.push(i);
  }

  // One room off to the side, not on the way to anywhere, holding something worth the
  // detour. This is the only real decision the layout asks, and it is a good one:
  // spend the time or take the boss with what you already have.
  if (rooms.length >= 4) {
    const from = rng.nextInt(1, rooms.length - 2);
    const secret: Room = {
      id: rooms.length,
      kind: RoomKind.SECRET,
      name: nameRoom(),
      description: '',
      telling: signature.telling[rng.nextInt(0, signature.telling.length - 1)],
      exits: [from],
      entered: false,
      cleared: false,
    };
    rooms[from].exits.push(secret.id);
    rooms.push(secret);
  }

  return rooms;
}

/**
 * Places what is standing in the rooms, against a budget.
 *
 * The budget is the Guide's: a place built for a character of this level, using their
 * experience thresholds, so a first-level character meets a bandit camp they can fight
 * and not a keep full of knights.
 */
function stock(kind: InstanceKind, rooms: readonly Room[], level: number, rng: RNG): Occupant[] {
  const signature = SIGNATURE[kind];
  const eligible = BESTIARY.filter((archetype) => signature.kinds.includes(archetype.kind));
  const pool = eligible.length > 0 ? eligible : BESTIARY;

  const occupants: Occupant[] = [];
  let placed = 0;

  for (const room of rooms) {
    if (room.kind !== RoomKind.GUARDED && room.kind !== RoomKind.LAIR) continue;

    const boss = room.kind === RoomKind.LAIR;
    // The lair gets the hardest thing the place can afford; the rest get what fits in a
    // single medium encounter apiece.
    const budget = budgetFor(level, boss ? Difficulty.HARD : Difficulty.MEDIUM);

    const affordable = pool.filter((archetype) => archetype.xp <= budget);
    const choices = affordable.length > 0 ? affordable : [weakest(pool)];

    const count = boss ? 1 : rng.nextInt(1, Math.max(1, Math.floor(budget / choices[0].xp)) > 2 ? 2 : 1);

    for (let i = 0; i < count; i++) {
      const archetype = boss
        ? strongest(choices)
        : weightedPick(choices, (candidate) => candidate.weight, rng);

      const hp = boss ? Math.round(archetype.hp * INSTANCE_BOSS_MULTIPLIER) : archetype.hp;

      occupants.push({
        id: `${room.id}:${placed++}`,
        archetypeId: archetype.id,
        room: room.id,
        hp,
        maxHp: hp,
        morale: boss ? 100 : rng.nextInt(45, 80),
        alerted: false,
        fled: false,
        hurts: [],
        boss,
        temper: temperFor(archetype, boss, rng),
      });
    }
  }

  return occupants;
}

/**
 * Decides how a thing fights.
 */
function temperFor(archetype: CreatureArchetype, boss: boolean, rng: RNG): Temper {
  if (boss) return rng.nextFloat() < 0.5 ? Temper.PROUD : Temper.DISCIPLINED;
  switch (archetype.kind) {
    case ThreatKind.BEAST:
      return rng.nextFloat() < 0.6 ? Temper.SAVAGE : Temper.CAUTIOUS;
    case ThreatKind.DEAD:
      return Temper.SAVAGE;
    case ThreatKind.MAN:
      return rng.nextFloat() < 0.5 ? Temper.CAUTIOUS : Temper.DISCIPLINED;
    case ThreatKind.SATED:
    default:
      return Temper.PROUD;
  }
}

/**
 * Hides what is worth carrying out.
 *
 * Guaranteed at the lair, because a boss with nothing on it is a boss nobody fights, and
 * scattered elsewhere in caches, with the good things put where they take finding.
 */
function hide(kind: InstanceKind, rooms: readonly Room[], level: number, rng: RNG): Prize[] {
  const catalog = Object.values(ITEMS);
  const prizes: Prize[] = [];

  const worthHaving = catalog.filter(
    (item) => item.rarity !== Rarity.COMMON && item.value > 0 && item.weight < 20
  );
  const ordinary = catalog.filter((item) => item.rarity === Rarity.COMMON && item.value > 0);

  // Coin, because a boss with nothing on it is a boss nobody fights, and because the
  // whole point of carrying something out is having somewhere to spend it.
  const purse = rooms.find((room) => room.kind === RoomKind.LAIR);
  if (purse) {
    prizes.push({
      itemId: 'copper_coins',
      count: rng.nextInt(2, 4 + level),
      room: purse.id,
      hidden: false,
      taken: false,
    });
  }

  const lair = rooms.find((room) => room.kind === RoomKind.LAIR);
  if (lair) {
    const best = weightedPick(
      worthHaving,
      (item) => (item.rarity === Rarity.RARE ? 3 : item.rarity === Rarity.ARTIFACT ? level : 6),
      rng
    );
    prizes.push({ itemId: best.id, count: 1, room: lair.id, hidden: false, taken: false });
  }

  const secret = rooms.find((room) => room.kind === RoomKind.SECRET);
  if (secret) {
    const kept = weightedPick(worthHaving, (item) => (item.rarity === Rarity.RARE ? 4 : 5), rng);
    prizes.push({ itemId: kept.id, count: 1, room: secret.id, hidden: true, taken: false });
  }

  const caches = rooms.filter((room) => room.kind === RoomKind.CACHE);
  for (const room of caches.slice(0, INSTANCE_PRIZE_ROOMS)) {
    const item = rng.nextFloat() < 0.4
      ? weightedPick(worthHaving, (candidate) => candidate.weight ?? 1, rng)
      : ordinary[rng.nextInt(0, ordinary.length - 1)];
    prizes.push({
      itemId: item.id,
      count: item.consumable ? rng.nextInt(1, 3) : 1,
      room: room.id,
      hidden: rng.nextFloat() < 0.5,
      taken: false,
    });
  }

  return prizes;
}

/** The hardest thing in a list, by what it is worth. */
function strongest(pool: readonly CreatureArchetype[]): CreatureArchetype {
  return [...pool].sort((a, b) => b.xp - a.xp)[0];
}

/** The easiest thing in a list, for when nothing fits the budget. */
function weakest(pool: readonly CreatureArchetype[]): CreatureArchetype {
  return [...pool].sort((a, b) => a.xp - b.xp)[0];
}
