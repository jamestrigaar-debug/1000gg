import * as PIXI from 'pixi.js';
import type { GameState } from '../../core/state/GameState';
import type { MarkComponent, PositionComponent, ThreatComponent } from '../../core/ecs/Component';
import { TILE_SIZE } from '../../core/world/Tile';
import { getArchetype } from '../../core/lore/Bestiary';
import {
  GLYPH_CHARSET,
  PLAYER_GLYPH,
  PLAYER_INK,
  SETTLEMENT_GLYPH,
  SETTLEMENT_INK,
  THREAT_INK,
  INK,
  TERRAIN_FIELD,
  TREE_TOKEN,
  VIGIL_TOKEN,
  VIGIL_KEPT_TOKEN,
  fieldGrain,
  shade,
} from './Glyphs';
import { lightTile, sightRadiusAtHour, voidColor } from './Lighting';
import { atTree, vigilAt } from '../../core/world/Reckoning';

/** Name the runtime bitmap font is registered under. */
const FONT_NAME = 'ThornmarchGlyph';
/** Point size the font is rasterised at; cells are scaled from this. */
const FONT_SIZE = 28;
/** Closest and furthest the view may be drawn. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
/**
 * The camera is locked to the character.
 *
 * An earlier build let the player drag the view around, which made the map feel like a
 * document being inspected rather than a place being walked, and made it easy to get
 * lost staring at unexplored black. The only way to change what you are looking at is
 * now to walk there.
 */

/**
 * Rounds a colour to the nearest step per channel.
 *
 * Washes differ by tiny amounts of light falloff from cell to cell, which would put
 * every cell in a batch of its own and defeat the point of batching. Quantising to
 * sixteen levels per channel collapses them to a handful of batches and is not
 * distinguishable on screen.
 *
 * @param color Colour to round
 * @returns The rounded colour
 */
function quantise(color: number): number {
  const r = ((color >> 16) & 0xff) & 0xf8;
  const g = ((color >> 8) & 0xff) & 0xf8;
  const b = (color & 0xff) & 0xf8;
  return (r << 16) | (g << 8) | b;
}

/**
 * Glyph-grid map renderer.
 *
 * The art direction follows the deep-simulation roguelikes in structure -- a grid of
 * marks, dense texture, background washes, light falling off with distance -- while
 * taking its palette from ink rather than from a DOS terminal. See Glyphs.ts for the
 * rules that give the grid its texture and Lighting.ts for the light model.
 *
 * Performance comes from pooling: the font is rasterised once into a bitmap font, and
 * one BitmapText per cell is allocated on first use and then reused, its text and tint
 * reassigned each frame. Nothing is created or destroyed during a redraw, so panning
 * across a large map does not churn WebGL objects.
 */
export class MapRenderer {
  private app: PIXI.Application;
  private container: HTMLElement;
  private rootContainer: PIXI.Container;

  /** Background washes, drawn beneath the glyphs */
  private washLayer: PIXI.Graphics;
  /** Container holding the pooled glyph cells */
  private glyphLayer: PIXI.Container;
  /** Pooled cells, indexed by their position in the draw order */
  private cellPool: PIXI.BitmapText[] = [];

  private tileSize: number = TILE_SIZE;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private zoom: number = 1;
  private initialized: boolean = false;
  /** Last state drawn, so a resize can repaint without waiting for a turn */
  private lastState: GameState | null = null;
  /** Settlement coordinates, rebuilt once per frame */
  private settlementTiles: Set<string> = new Set();
  private fontReady: boolean = false;
  private resizeListener: () => void;

  /**
   * @param container DOM element hosting the PixiJS canvas
   * @param mapWidth Map width in tiles
   * @param mapHeight Map height in tiles
   */
  constructor(container: HTMLElement, mapWidth: number, mapHeight: number) {
    this.container = container;
    this.rootContainer = new PIXI.Container();
    this.washLayer = new PIXI.Graphics();
    this.glyphLayer = new PIXI.Container();

    this.app = new PIXI.Application({
      width: container.clientWidth || 800,
      height: container.clientHeight || 600,
      backgroundColor: voidColor(0),
      antialias: false,
      resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      autoDensity: true,
      // The world only changes when the player does something, so there is nothing to
      // animate between turns. Left to itself Pixi would clear and redraw the whole grid
      // sixty times a second forever, which on a laptop is a fan spinning up over a
      // static picture, and in a page embedded on someone's site is worse manners still.
      autoStart: false,
      sharedTicker: false,
    });

    this.resizeListener = () => this.handleResize();

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeListener);
    }

    this.offsetX = Math.floor(mapWidth / 2);
    this.offsetY = Math.floor(mapHeight / 2);
  }

  /**
   * Mounts the canvas, rasterises the glyph font, and wires mouse interaction.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.app.view && 'style' in this.app.view) {
      this.container.appendChild(this.app.view as HTMLCanvasElement);
    }

    this.installFont();

    this.rootContainer.addChild(this.washLayer);
    this.rootContainer.addChild(this.glyphLayer);
    this.app.stage.addChild(this.rootContainer);

    this.setupInteraction();
    this.initialized = true;
  }

  /**
   * Rasterises the glyph charset into a bitmap font once.
   *
   * Guarded because a headless or software-rendered context can refuse font
   * rasterisation; the renderer degrades to drawing washes only rather than throwing
   * and taking the whole page down with it.
   */
  private installFont(): void {
    try {
      PIXI.BitmapFont.from(
        FONT_NAME,
        {
          fontFamily: 'Consolas, "DejaVu Sans Mono", "Courier New", monospace',
          fontSize: FONT_SIZE,
          fill: 0xffffff,
          fontWeight: 'bold',
        },
        { chars: GLYPH_CHARSET.split('') }
      );
      this.fontReady = true;
    } catch (e) {
      console.error('Glyph font could not be rasterised; drawing washes only.', e);
      this.fontReady = false;
    }
  }

  /**
   * Returns the pooled cell at a draw index, allocating on first use.
   * @param index Position in the draw order
   * @returns A reusable BitmapText
   */
  private cell(index: number): PIXI.BitmapText {
    let text = this.cellPool[index];
    if (!text) {
      text = new PIXI.BitmapText('', { fontName: FONT_NAME, fontSize: FONT_SIZE });
      text.anchor.set(0.5);
      this.cellPool[index] = text;
      this.glyphLayer.addChild(text);
    }
    return text;
  }

  /**
   * Resizes the renderer on container size changes.
   */
  private handleResize(): void {
    if (!this.app || !this.container) return;
    this.app.renderer.resize(this.container.clientWidth, this.container.clientHeight);
    if (this.lastState) this.render(this.lastState);
  }

  /**
   * Attaches the one interaction the canvas still has: the wheel changes how close the
   * view is drawn, which is not the same as moving the camera off the character.
   */
  private setupInteraction(): void {
    const canvas = this.app.view as HTMLCanvasElement;
    if (!canvas || !canvas.addEventListener) return;

    canvas.style.cursor = 'default';

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    });
  }

  /**
   * Draws the current state.
   *
   * Only the tiles inside the viewport are considered, and every drawn cell comes from
   * the pool. Cells left over from a previous, larger frame are hidden rather than
   * destroyed.
   *
   * @param state Current GameState
   */
  render(state: GameState): void {
    if (!this.initialized) return;
    this.lastState = state;

    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    if (!pos) return;

    const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
    const markIntensity = mark?.intensity ?? 0;

    this.followPlayer(pos);
    this.app.renderer.background.color = voidColor(markIntensity);
    this.washLayer.clear();

    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;
    const cellSize = this.tileSize * this.zoom;

    const tilesX = Math.ceil(screenWidth / cellSize) + 2;
    const tilesY = Math.ceil(screenHeight / cellSize) + 2;
    const halfX = Math.floor(tilesX / 2);
    const halfY = Math.floor(tilesY / 2);

    const radius = sightRadiusAtHour(state.hour);
    let index = 0;

    // One pass over the settlements per frame rather than a linear scan per tile.
    this.settlementTiles = new Set(state.settlements.map((s) => `${s.x},${s.y}`));

    // Background washes are collected by colour and filled in one batch each. Issuing a
    // beginFill/endFill pair per cell rebuilt a thousand-odd tiny geometries every
    // redraw; the colours are quantised so that the number of batches stays small
    // without any visible change to the wash.
    const washes = new Map<number, number[]>();

    for (let y = this.offsetY - halfY; y <= this.offsetY + halfY; y++) {
      for (let x = this.offsetX - halfX; x <= this.offsetX + halfX; x++) {
        if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) continue;

        const tile = state.map[y][x];
        if (!tile.explored) continue;

        const screenX = (x - this.offsetX) * cellSize + screenWidth / 2;
        const screenY = (y - this.offsetY) * cellSize + screenHeight / 2;
        const distance = Math.max(Math.abs(x - pos.x), Math.abs(y - pos.y));

        // The ground is stated as colour. Light and memory act on the field itself, so
        // the board still reads as a lit area inside a remembered one.
        const field = shade(TERRAIN_FIELD[tile.terrain], fieldGrain(x, y));
        const lit = lightTile(field, field, distance, radius, markIntensity);
        if (!lit) continue;

        const key = quantise(lit.background ?? field);
        const batch = washes.get(key);
        if (batch) batch.push(screenX, screenY);
        else washes.set(key, [screenX, screenY]);

        // A token is drawn only where something occupies the space.
        const token = this.tokenAt(state, x, y);
        if (token) {
          index = this.drawCell(
            index,
            token.glyph,
            shade(token.color, lit.visible ? 1 : 0.5),
            screenX,
            screenY,
            cellSize
          );
        }
      }
    }

    for (const [color, points] of washes) {
      this.washLayer.beginFill(color);
      for (let i = 0; i < points.length; i += 2) {
        this.washLayer.drawRect(points[i], points[i + 1], cellSize + 1, cellSize + 1);
      }
      this.washLayer.endFill();
    }

    index = this.drawThreats(state, index, cellSize, screenWidth, screenHeight, radius);
    index = this.drawPlayer(state, pos, index, cellSize, screenWidth, screenHeight);

    // Hide any cells this frame did not need.
    for (let i = index; i < this.cellPool.length; i++) {
      this.cellPool[i].visible = false;
    }

    // Nothing draws unless we ask, so ask.
    this.app.renderer.render(this.app.stage);
  }

  /**
   * Puts the character at the centre of the view, every frame.
   * @param pos Character position
   */
  private followPlayer(pos: PositionComponent): void {
    this.offsetX = pos.x;
    this.offsetY = pos.y;
  }

  /**
   * What, if anything, stands on a tile.
   *
   * Only places worth walking to get a mark. Everything else about the tile -- what is
   * growing on it, what the ground is like, what can be heard from it -- is the log's
   * business.
   *
   * @param state Current state
   * @param x Tile X
   * @param y Tile Y
   * @returns The token to draw, or null for open ground
   */
  private tokenAt(
    state: GameState,
    x: number,
    y: number
  ): { glyph: string; color: number } | null {
    if (this.settlementTiles.has(`${x},${y}`)) {
      return { glyph: SETTLEMENT_GLYPH, color: SETTLEMENT_INK };
    }

    if (atTree(state.reckoning, x, y)) {
      return { glyph: TREE_TOKEN, color: INK.blood };
    }

    const vigil = vigilAt(state.reckoning, x, y);
    if (vigil) {
      return {
        glyph: vigil.kept ? VIGIL_KEPT_TOKEN : VIGIL_TOKEN,
        color: vigil.kept ? INK.bone : INK.pale,
      };
    }

    return null;
  }

  /**
   * Places one pooled glyph cell.
   * @returns The next free draw index
   */
  private drawCell(
    index: number,
    glyph: string,
    color: number,
    screenX: number,
    screenY: number,
    cellSize: number
  ): number {
    if (!this.fontReady || glyph === ' ') return index;

    const cell = this.cell(index);
    cell.text = glyph;
    cell.tint = color;
    cell.visible = true;
    cell.x = screenX + cellSize / 2;
    cell.y = screenY + cellSize / 2;
    cell.scale.set(cellSize / FONT_SIZE);
    return index + 1;
  }

  /**
   * Draws any hostile currently engaged, on the tile it occupies.
   * @returns The next free draw index
   */
  private drawThreats(
    state: GameState,
    index: number,
    cellSize: number,
    screenWidth: number,
    screenHeight: number,
    radius: number
  ): number {
    let next = index;

    for (const id of state.entities.query('threat', 'position')) {
      const threatPos = state.entities.getComponent<PositionComponent>(id, 'position');
      const threat = state.entities.getComponent<ThreatComponent>(id, 'threat');
      if (!threatPos || !threat) continue;

      const archetype = getArchetype(threat.archetypeId);
      if (!archetype) continue;

      const screenX = (threatPos.x - this.offsetX) * cellSize + screenWidth / 2;
      const screenY = (threatPos.y - this.offsetY) * cellSize + screenHeight / 2;

      // Threats sit on a blood wash so they read instantly against the terrain.
      this.washLayer.beginFill(0x2a0b0b);
      this.washLayer.drawRect(screenX, screenY, cellSize + 1, cellSize + 1);
      this.washLayer.endFill();

      next = this.drawCell(
        next,
        archetype.glyph,
        THREAT_INK[archetype.kind],
        screenX,
        screenY,
        cellSize
      );
    }

    // radius is accepted for symmetry with the tile pass; an engaged threat is always
    // drawn, because it is by definition close enough to be hitting you.
    void radius;
    return next;
  }

  /**
   * Draws the player, with a hearth-coloured wash so the eye finds them immediately.
   * @returns The next free draw index
   */
  private drawPlayer(
    state: GameState,
    pos: PositionComponent,
    index: number,
    cellSize: number,
    screenWidth: number,
    screenHeight: number
  ): number {
    const screenX = (pos.x - this.offsetX) * cellSize + screenWidth / 2;
    const screenY = (pos.y - this.offsetY) * cellSize + screenHeight / 2;

    this.washLayer.beginFill(state.encounterId !== null ? 0x3a1010 : 0x171a20);
    this.washLayer.drawRect(screenX, screenY, cellSize + 1, cellSize + 1);
    this.washLayer.endFill();

    this.washLayer.lineStyle(1, state.encounterId !== null ? INK.blood : INK.iron, 0.9);
    this.washLayer.drawRect(screenX, screenY, cellSize, cellSize);
    this.washLayer.lineStyle(0);

    return this.drawCell(index, PLAYER_GLYPH, PLAYER_INK, screenX, screenY, cellSize);
  }

  /**
   * Centers the camera on tile coordinates.
   * @param x Tile X coordinate
   * @param y Tile Y coordinate
   */
  centerOn(x: number, y: number): void {
    this.offsetX = x;
    this.offsetY = y;
  }

  /**
   * Destroys the application, pooled cells, and window listeners.
   */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeListener);
    }
    this.cellPool = [];
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
    }
    this.initialized = false;
  }
}
