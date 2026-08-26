import type { GameState } from './GameState';
import { createInitialGameState } from './GameState';
import { World } from '../ecs/World';
import type { SerializedWorld } from '../ecs/World';
import { SeededRNG } from '../rng/SeededRNG';
import { MapGenerator } from '../world/MapGenerator';
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
  /** True once the debt was settled at the tree */
  victory: boolean;
  /** Open narrative threads, so the world still owes what it owed before the reload */
  threads: Thread[];
  /** What each person has come to think of the character, by person id */
  dispositions: Record<string, { disposition: number; met: boolean }>;
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
    victory: state.victory,
    threads: state.threads.map((t) => ({ ...t })),
    dispositions: Object.fromEntries(
      state.people.map((person) => [
        person.id,
        { disposition: person.disposition, met: person.met },
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
  const { map, settlements, startX, startY } = new MapGenerator(generationRng).generate();

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
  state.lastDraw = { ...(payload.lastDraw ?? {}) };
  // The sites are a function of the seed; only which rites were kept is progress.
  const kept = new Set(payload.keptVigils ?? []);
  for (const vigil of state.reckoning.vigils) {
    vigil.kept = kept.has(vigil.id);
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
    }
  }
  state.errands = (payload.errands ?? []).map((errand) => ({ ...errand }));
  state.gameOver = payload.gameOver;
  state.causeOfDeath = payload.causeOfDeath;
  state.background = payload.background ?? null;
  state.log = payload.log.slice();

  return state;
}
