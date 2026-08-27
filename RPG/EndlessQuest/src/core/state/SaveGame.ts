import type { GameState } from './GameState';
import { createInitialGameState } from './GameState';
import { World } from '../ecs/World';
import type { SerializedWorld } from '../ecs/World';
import { SeededRNG } from '../rng/SeededRNG';
import { MapGenerator } from '../world/MapGenerator';
import type { ConditionsComponent } from '../ecs/Component';
import { formInstance } from '../dm/Forge';
import { InstanceKind } from '../dm/Instance';
import type { GameEvent } from '../../events/GameEvent';
import type { CharacterBackground } from '../narrative/Background';
import type { Thread } from '../narrative/Threads';
import type { Errand } from '../narrative/Errands';

/**
 * Save format version. Increment when the payload shape changes so that older saves
 * can be rejected rather than loaded into a mismatched schema.
 */
export const SAVE_VERSION = 1;

/** Number of trailing log entries preserved in a save. */
const SAVED_LOG_ENTRIES = 200;

/**
 * Serialized form of a complete run.
 *
 * The tile map is deliberately absent: it is a pure function of the seed, so it is
 * regenerated on load and only the fog-of-war overlay is stored. That keeps saves
 * small and makes them a direct assertion of the determinism guarantee.
 */
export interface SavePayload {
  version: number;
  seedString: string;
  tick: number;
  year: number;
  day: number;
  hour: number;
  /** RNG internal state, as produced by SeededRNG.getState() */
  rngState: number[];
  /** Base64 bit-packed explored flags in row-major order */
  explored: string;
  world: SerializedWorld;
  playerId: number;
  encounterId: number | null;
  encounterRound: number;
  /** Tick until which something is on the character's trail */
  stalkedUntil: number;
  /** Last entry drawn from each narration table, so anti-repetition survives a load */
  lastDraw: Record<string, string>;
  /** Ids of the vigils whose rite has been kept; the sites themselves come from the seed */
  keptVigils: string[];
  /** Places the character has heard of or seen */
  knownPlaces?: string[];
  /** What the character is carrying in the way of wounds and states */
  conditions?: { id: string; since: number; until: number | null }[];
  /** What the last blow left open, and the hour the calling's trick comes back */
  exposure?: number;
  exposedUntil?: number;
  knackReadyAt?: number;
  /**
   * The place the character was inside when they saved, and how far into it they were.
   *
   * The place itself is a function of its mouth and the seed, exactly as the country is,
   * so only what the character did in it is written down. Without this, saving in a
   * cellar and loading put them outside it with the whole thing forgotten.
   */
  insideInstance?: {
    kind: string;
    name: string;
    x: number;
    y: number;
    level: number;
    current: number;
    turn: number;
    resolved: boolean;
    entered: number[];
    cleared: number[];
    occupants: { id: string; hp: number; room: number; fled: boolean; alerted: boolean }[];
    taken: number[];
  };
  /** Sites the character has stood in */
  visitedSites?: string[];
  /** Sites the character has laid eyes on */
  seenSites?: string[];
  /** Sites that have given up whatever they had */
  spentSites?: string[];
  /** True once the debt was settled at the tree */
  victory: boolean;
  /** Open narrative threads, so the world still owes what it owed before the reload */
  threads: Thread[];
  /** What each person has come to think of the character, by person id */
  dispositions: Record<string, { disposition: number; met: boolean; read: boolean }>;
  /** Every errand raised this run, in whatever state it reached */
  errands: Errand[];
  gameOver: boolean;
  causeOfDeath: string | null;
  /** Who the character was before the rope; dealt at embark, so it must be persisted */
  background: CharacterBackground | null;
  log: GameEvent[];
  /** Wall-clock time the save was written, for display in save listings */
  savedAt: number;
}

/**
 * Packs the map's explored flags into a base64 bitmap.
 * @param state GameState to read from
 * @returns Base64 string, one bit per tile in row-major order
 */
function packExplored(state: GameState): string {
  const total = state.mapWidth * state.mapHeight;
  const bytes = new Uint8Array(Math.ceil(total / 8));

  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      if (!state.map[y][x].explored) continue;
      const index = y * state.mapWidth + x;
      bytes[index >> 3] |= 1 << index % 8;
    }
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Applies a base64 explored bitmap onto a freshly generated map.
 * @param map Regenerated tile map, mutated in place
 * @param width Map width
 * @param height Map height
 * @param packed Base64 bitmap from packExplored
 */
function unpackExplored(
  map: GameState['map'],
  width: number,
  height: number,
  packed: string
): void {
  const binary = atob(packed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const byte = bytes[index >> 3] ?? 0;
      map[y][x].explored = (byte & (1 << index % 8)) !== 0;
    }
  }
}

/**
 * Captures a complete, restorable snapshot of a run.
 * @param state GameState to serialize
 * @returns Save payload suitable for JSON encoding
 */
export function serializeGameState(state: GameState): SavePayload {
  return {
    version: SAVE_VERSION,
    seedString: state.seedString,
    tick: state.tick,
    year: state.year,
    day: state.day,
    hour: state.hour,
    rngState: Array.from(state.rng.getState()),
    explored: packExplored(state),
    world: state.entities.serialize(),
    playerId: state.playerId,
    encounterId: state.encounterId,
    encounterRound: state.encounterRound,
    stalkedUntil: state.stalkedUntil,
    lastDraw: { ...state.lastDraw },
    keptVigils: state.reckoning.vigils.filter((v) => v.kept).map((v) => v.id),
    knownPlaces: state.settlements.filter((s) => s.known).map((s) => s.name),
    conditions: (
      state.entities.getComponent<ConditionsComponent>(state.playerId, 'conditions')?.held ?? []
    ).map((held) => ({ id: held.id, since: held.since, until: held.until })),
    exposure: state.exposure,
    exposedUntil: state.exposedUntil,
    knackReadyAt: state.knackReadyAt,
    insideInstance: state.instance
      ? {
          kind: state.instance.kind,
          name: state.instance.name,
          x: state.instance.x,
          y: state.instance.y,
          level: state.instance.level,
          current: state.instance.current,
          turn: state.instance.turn,
          resolved: state.instance.resolved,
          entered: state.instance.rooms.filter((r) => r.entered).map((r) => r.id),
          cleared: state.instance.rooms.filter((r) => r.cleared).map((r) => r.id),
          occupants: state.instance.occupants.map((o) => ({
            id: o.id,
            hp: o.hp,
            room: o.room,
            fled: o.fled,
            alerted: o.alerted,
          })),
          taken: state.instance.prizes
            .map((prize, index) => (prize.taken ? index : -1))
            .filter((index) => index >= 0),
        }
      : undefined,
    visitedSites: state.sites.filter((s) => s.visited).map((s) => s.id),
    seenSites: state.sites.filter((s) => s.seen).map((s) => s.id),
    spentSites: state.sites.filter((s) => s.spent).map((s) => s.id),
    victory: state.victory,
    threads: state.threads.map((t) => ({ ...t })),
    dispositions: Object.fromEntries(
      state.people.map((person) => [
        person.id,
        { disposition: person.disposition, met: person.met, read: person.read },
      ])
    ),
    errands: state.errands.map((errand) => ({ ...errand })),
    gameOver: state.gameOver,
    causeOfDeath: state.causeOfDeath,
    background: state.background,
    log: state.log.slice(-SAVED_LOG_ENTRIES),
    savedAt: Date.now(),
  };
}

/**
 * Rebuilds a GameState from a save payload.
 *
 * The map is regenerated from the saved seed and the RNG is then wound to its saved
 * state, so a restored run continues the exact sequence it was saved from.
 *
 * @param payload Save payload
 * @returns Fully reconstructed GameState
 * @throws Error if the payload version is not understood
 */
export function deserializeGameState(payload: SavePayload): GameState {
  if (payload.version !== SAVE_VERSION) {
    throw new Error(
      `Unsupported save version ${payload.version}; this build reads version ${SAVE_VERSION}.`
    );
  }

  // Regenerate the map exactly as the original run did, from a fresh seeded generator.
  const generationRng = new SeededRNG(payload.seedString);
  const { map, settlements, sites, startX, startY } = new MapGenerator(generationRng).generate();

  const world = World.deserialize(payload.world);

  // Wind the live RNG to the state the run was saved at.
  const rng = new SeededRNG(payload.seedString);
  rng.setState(Uint32Array.from(payload.rngState));

  const state = createInitialGameState(
    payload.seedString,
    map,
    world,
    payload.playerId,
    rng,
    settlements,
    sites,
    startX,
    startY
  );

  unpackExplored(state.map, state.mapWidth, state.mapHeight, payload.explored);

  state.tick = payload.tick;
  state.year = payload.year;
  state.day = payload.day;
  state.hour = payload.hour;
  state.encounterId = payload.encounterId;
  state.encounterRound = payload.encounterRound;
  // Saves written before anything could follow the character simply have nothing on it.
  state.stalkedUntil = payload.stalkedUntil ?? 0;
  // What the last blow left open, and when the calling's one trick comes back. Saving
  // mid-fight and loading used to hand the character a free reset of both.
  state.exposure = payload.exposure ?? 0;
  state.exposedUntil = payload.exposedUntil ?? 0;
  state.knackReadyAt = payload.knackReadyAt ?? 0;
  state.lastDraw = { ...(payload.lastDraw ?? {}) };
  // The sites are a function of the seed; only which rites were kept is progress.
  const kept = new Set(payload.keptVigils ?? []);
  for (const vigil of state.reckoning.vigils) {
    vigil.kept = kept.has(vigil.id);
  }

  // The country is a function of the seed; where the character has been, and what they
  // emptied when they got there, is not.
  // Wounds are progress in the same sense a kept rite is: they are what happened to
  // this character rather than what the seed decided about the world.
  if (payload.conditions && payload.conditions.length > 0) {
    const restoredConditions: ConditionsComponent = {
      type: 'conditions',
      held: payload.conditions.map((held) => ({ ...held })),
    };
    state.entities.addComponent(state.playerId, restoredConditions);
  }

  const heardOf = new Set(payload.knownPlaces ?? []);
  for (const settlement of state.settlements) {
    settlement.known = heardOf.has(settlement.name);
  }

  const visited = new Set(payload.visitedSites ?? []);
  const spent = new Set(payload.spentSites ?? []);
  // The place the character was inside, rebuilt from its mouth and the seed, with what
  // they did in it laid back over the top.
  if (payload.insideInstance) {
    const saved = payload.insideInstance;
    const instance = formInstance(
      saved.kind as InstanceKind,
      saved.name,
      saved.x,
      saved.y,
      saved.level,
      payload.seedString
    );

    instance.current = Math.min(saved.current, instance.rooms.length - 1);
    instance.turn = saved.turn;
    instance.resolved = saved.resolved;

    const entered = new Set(saved.entered);
    const cleared = new Set(saved.cleared);
    for (const room of instance.rooms) {
      room.entered = entered.has(room.id);
      room.cleared = cleared.has(room.id);
    }

    const condition = new Map(saved.occupants.map((o) => [o.id, o]));
    for (const occupant of instance.occupants) {
      const remembered = condition.get(occupant.id);
      if (!remembered) continue;
      occupant.hp = remembered.hp;
      occupant.room = remembered.room;
      occupant.fled = remembered.fled;
      occupant.alerted = remembered.alerted;
    }

    const taken = new Set(saved.taken);
    instance.prizes.forEach((prize, index) => {
      prize.taken = taken.has(index);
    });

    state.instance = instance;
  }

  const seen = new Set(payload.seenSites ?? []);
  for (const site of state.sites) {
    site.visited = visited.has(site.id);
    site.seen = seen.has(site.id) || site.visited;
    site.spent = spent.has(site.id);
  }
  state.victory = payload.victory ?? false;
  state.threads = (payload.threads ?? []).map((t) => ({ ...t }));

  // The people themselves come from the seed; only what passed between them and the
  // character is restored onto them.
  for (const person of state.people) {
    const remembered = payload.dispositions?.[person.id];
    if (remembered) {
      person.disposition = remembered.disposition;
      person.met = remembered.met;
      person.read = remembered.read ?? false;
    }
  }
  state.errands = (payload.errands ?? []).map((errand) => ({ ...errand }));
  state.gameOver = payload.gameOver;
  state.causeOfDeath = payload.causeOfDeath;
  state.background = payload.background ?? null;
  state.log = payload.log.slice();

  return state;
}
