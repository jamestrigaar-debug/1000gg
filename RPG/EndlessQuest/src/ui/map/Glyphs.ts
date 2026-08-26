import { TerrainType } from '../../core/world/TerrainType';
import { ThreatKind } from '../../core/lore/Bestiary';

/**
 * The Thornmarch glyph set.
 *
 * The art direction takes its structure from the deep-simulation roguelikes -- a grid
 * of glyphs rather than sprites, dense organic texture, background tints, and light
 * that falls off with distance -- but deliberately not their palette. Those games use
 * the sixteen DOS colours; this uses ink: bone, ash, iron, rust, and blood on
 * near-black, after the woodcut register of the source material.
 *
 * Three rules give the grid its texture:
 *
 * - Terrain is a set of glyphs, not one glyph, chosen per tile so a field reads as a
 *   field rather than as rows of the same character.
 * - The choice is hashed from the tile's coordinates, never from the simulation's RNG.
 *   Drawing must never consume simulation randomness or a redraw would change the
 *   world.
 * - Colour is jittered per tile within a narrow band, so a wood has depth in it.
 */

/** Near-black the grid is drawn on. */
export const VOID = 0x05060a;

/**
 * The ink palette. Deliberately desaturated and high-contrast rather than the
 * saturated primaries of a DOS terminal.
 */
export const INK = {
  bone: 0xd8d0c0,
  pale: 0xb6c2c9,
  ash: 0x8a857c,
  iron: 0x5f6670,
  moss: 0x4a5d3a,
  briar: 0x6b7a4a,
  bile: 0x7a7040,
  rust: 0x8a5a3c,
  ember: 0xc8752c,
  blood: 0x8c2f2f,
  deep: 0x2b3340,
  slate: 0x3f4650,
} as const;

/**
 * A terrain's visual treatment: the marks it is drawn with and the inks they take.
 */
export interface TerrainGlyphSet {
  /** Candidate glyphs, sampled per tile */
  readonly glyphs: readonly string[];
  /** Candidate inks, sampled per tile */
  readonly colors: readonly number[];
  /** Optional background wash drawn behind the glyph */
  readonly background?: number;
}

/**
 * How each terrain is drawn.
 */
export const TERRAIN_GLYPHS: Record<TerrainType, TerrainGlyphSet> = {
  [TerrainType.PLAINS]: {
    glyphs: ['"', "'", ',', '.', '"', '`'],
    colors: [INK.moss, INK.briar, INK.bile],
  },
  [TerrainType.FOREST]: {
    glyphs: ['♣', '♠', 'T', 'î', '♣', 'Y'],
    colors: [INK.moss, INK.briar, 0x3c4a2e],
    background: 0x0b1008,
  },
  [TerrainType.HILLS]: {
    glyphs: ['∩', 'n', '^', '~', '∩'],
    colors: [INK.rust, INK.bile, INK.ash],
  },
  [TerrainType.MOUNTAIN]: {
    glyphs: ['▲', '^', 'Λ', '▲'],
    colors: [INK.iron, INK.slate, INK.ash],
    background: 0x101216,
  },
  [TerrainType.SWAMP]: {
    glyphs: ['~', '≈', '§', '%', ',', '~'],
    colors: [0x4a4a30, INK.bile, 0x55603c],
    background: 0x0a0d09,
  },
  [TerrainType.WATER]: {
    glyphs: ['≈', '~', '≈'],
    colors: [INK.deep, 0x35455c, 0x243044],
    background: 0x080c14,
  },
};

/** Glyph and ink for the player character. */
export const PLAYER_GLYPH = '@';
export const PLAYER_INK = INK.bone;

/** Glyph drawn for an inhabited place. */
export const SETTLEMENT_GLYPH = '⌂';
export const SETTLEMENT_INK = INK.ember;

/** Glyph used for an unexplored tile: nothing, rendered as nothing. */
export const UNEXPLORED_GLYPH = ' ';

/**
 * Inks for threats, by what kind of thing they are.
 */
export const THREAT_INK: Record<ThreatKind, number> = {
  [ThreatKind.DEAD]: 0x9aa6ad,
  [ThreatKind.BEAST]: INK.rust,
  [ThreatKind.MAN]: INK.bone,
  [ThreatKind.SATED]: INK.blood,
};

/**
 * Every character the bitmap font must contain.
 *
 * Declared explicitly because the font is rasterised once at startup; a glyph missing
 * from this string renders as nothing at all.
 */
export const GLYPH_CHARSET =
  ' .,\'"`^~%§@#$&*+-=|/\\<>()[]{}!?:;abcdefghijklmnopqrstuvwxyz' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' +
  '♣♠♥♦▲△▼∩≈îΛ⌂†‡·°';

/**
 * Hashes tile coordinates into a stable 32-bit value.
 *
 * This is what keeps the texture organic without touching the simulation's RNG: the
 * same tile always draws the same way, and drawing has no side effects on the world.
 *
 * @param x Tile X
 * @param y Tile Y
 * @returns Unsigned 32-bit hash
 */
export function tileHash(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * Chooses the glyph and ink for a terrain tile.
 * @param terrain Terrain being drawn
 * @param x Tile X
 * @param y Tile Y
 * @returns The mark to draw and the ink to draw it in
 */
export function terrainGlyphFor(
  terrain: TerrainType,
  x: number,
  y: number
): { glyph: string; color: number; background?: number } {
  const set = TERRAIN_GLYPHS[terrain];
  const hash = tileHash(x, y);

  return {
    glyph: set.glyphs[hash % set.glyphs.length],
    color: set.colors[(hash >>> 8) % set.colors.length],
    background: set.background,
  };
}

/**
 * Blends two colours.
 * @param from Colour at t = 0
 * @param to Colour at t = 1
 * @param t Blend factor, clamped to [0, 1]
 * @returns Blended 24-bit colour
 */
export function mix(from: number, to: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;

  const r = Math.round(fr + (tr - fr) * k);
  const g = Math.round(fg + (tg - fg) * k);
  const b = Math.round(fb + (tb - fb) * k);
  return (r << 16) | (g << 8) | b;
}

/**
 * Scales a colour's brightness.
 * @param color Colour to scale
 * @param factor Multiplier, clamped at 0
 * @returns Scaled colour
 */
export function shade(color: number, factor: number): number {
  const f = Math.max(0, factor);
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}


/**
 * The colour a terrain is drawn as when the board carries no characters.
 *
 * The viewport is a board, not a page. Terrain is stated as a quiet field of colour and
 * nothing else, so that the only marks on the board are the things a player needs to
 * find at a glance: where they are, what is on them, and where the places worth walking
 * to lie. What the country actually looks like belongs in the log, where there is room
 * to say it properly.
 */
export const TERRAIN_FIELD: Record<TerrainType, number> = {
  [TerrainType.PLAINS]: 0x37432a,
  [TerrainType.FOREST]: 0x1d3020,
  [TerrainType.HILLS]: 0x4a3c2b,
  [TerrainType.MOUNTAIN]: 0x3d434b,
  [TerrainType.SWAMP]: 0x2b3122,
  [TerrainType.WATER]: 0x16243a,
};

/**
 * A per-tile brightness jitter, so a field of one colour still has a grain to it.
 *
 * Flat fills across a hundred tiles read as a rendering error rather than as ground.
 * The variation is deterministic in the coordinates, so the same tile always looks the
 * same, and small enough that it registers as texture rather than as information.
 *
 * @param x Tile X
 * @param y Tile Y
 * @returns A multiplier close to one
 */
export function fieldGrain(x: number, y: number): number {
  return 0.96 + (tileHash(x, y) % 9) / 100;
}

/** The mark drawn where the character is standing. */
export const PLAYER_TOKEN = '@';
/** The mark for a vigil that has not been kept, and for one that has. */
export const VIGIL_TOKEN = '†';
export const VIGIL_KEPT_TOKEN = '‡';
/** The mark for the gallows-tree. */
export const TREE_TOKEN = 'Ϯ';
