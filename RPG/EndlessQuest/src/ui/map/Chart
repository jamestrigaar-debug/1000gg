import type { GameState } from '../../core/state/GameState';
import type { PositionComponent } from '../../core/ecs/Component';
import { TerrainType } from '../../core/world/TerrainType';
import { atTree, bearingTo, describeDistance } from '../../core/world/Reckoning';
import { INK, mix } from './Glyphs';

/** Pixels per tile in the chart. */
const CELL = 6;
/** Colour of country that has been walked but is not otherwise marked. */
const TERRAIN_TINT: Record<TerrainType, number> = {
  [TerrainType.PLAINS]: 0x3d4a30,
  [TerrainType.FOREST]: 0x24331f,
  [TerrainType.HILLS]: 0x4a3a2a,
  [TerrainType.MOUNTAIN]: 0x3a3f47,
  [TerrainType.SWAMP]: 0x2f3524,
  [TerrainType.WATER]: 0x1b2434,
};

/**
 * The chart: everything the character has seen, drawn small.
 *
 * The main view is deliberately myopic -- it shows what can be seen from where the
 * character is standing and nothing else, which is most of what makes the country feel
 * dangerous. The cost of that is having no way to hold the shape of the journey in your
 * head, so the chart is the counterweight: not a live map, but a record of ground
 * already covered, with the places worth remembering named on it.
 *
 * It draws only explored tiles. Unwalked country is simply absent, so the chart fills in
 * as the run goes on, and its shape is a record of where this particular character went.
 */
export class Chart {
  private overlay: HTMLElement;
  private canvas: HTMLCanvasElement;
  private legend: HTMLElement;
  private open: boolean = false;

  /**
   * @param host Element the overlay is appended to
   */
  constructor(host: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'chart-overlay';
    this.overlay.hidden = true;

    this.canvas = document.createElement('canvas');
    this.legend = document.createElement('div');
    this.legend.className = 'chart-legend';

    const title = document.createElement('h3');
    title.textContent = 'Ground covered';

    const hint = document.createElement('p');
    hint.className = 'panel-note';
    hint.textContent = 'Only what you have seen with your own eyes. M or Escape to close.';

    this.overlay.append(title, this.canvas, this.legend, hint);
    host.appendChild(this.overlay);

    this.overlay.addEventListener('click', () => this.close());
  }

  /**
   * Reports whether the chart is currently up.
   */
  isOpen(): boolean {
    return this.open;
  }

  /**
   * Shows or hides the chart.
   * @param state Current game state, needed to draw it
   */
  toggle(state: GameState): void {
    if (this.open) this.close();
    else this.show(state);
  }

  /**
   * Draws and shows the chart.
   * @param state Current game state
   */
  show(state: GameState): void {
    this.draw(state);
    this.overlay.hidden = false;
    this.open = true;
  }

  /**
   * Hides the chart.
   */
  close(): void {
    this.overlay.hidden = true;
    this.open = false;
  }

  /**
   * Renders the explored map and the roll of named places.
   * @param state Current game state
   */
  private draw(state: GameState): void {
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    this.canvas.width = state.mapWidth * CELL;
    this.canvas.height = state.mapHeight * CELL;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let y = 0; y < state.mapHeight; y++) {
      for (let x = 0; x < state.mapWidth; x++) {
        if (!state.map[y][x].explored) continue;
        ctx.fillStyle = hex(TERRAIN_TINT[state.map[y][x].terrain]);
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }

    // Only places actually walked to are on the chart. A rumour is not a map.
    const found: string[] = [];

    for (const settlement of state.settlements) {
      if (!this.seen(state, settlement.x, settlement.y)) continue;
      this.mark(ctx, settlement.x, settlement.y, hex(INK.ember));
      found.push(`⌂ ${settlement.name}`);
    }

    for (const vigil of state.reckoning.vigils) {
      if (!this.seen(state, vigil.x, vigil.y)) continue;
      this.mark(ctx, vigil.x, vigil.y, hex(vigil.kept ? INK.bone : INK.pale));
      found.push(`${vigil.kept ? '†' : '‡'} ${vigil.name}${vigil.kept ? ' (kept)' : ''}`);
    }

    if (pos && this.seen(state, state.reckoning.treeX, state.reckoning.treeY)) {
      this.mark(ctx, state.reckoning.treeX, state.reckoning.treeY, hex(INK.blood));
      found.push('Ϯ the gallows-tree');
    }

    if (pos) {
      this.mark(ctx, pos.x, pos.y, '#ffffff');
      const distance = Math.max(
        Math.abs(state.reckoning.treeX - pos.x),
        Math.abs(state.reckoning.treeY - pos.y)
      );
      found.push(
        atTree(state.reckoning, pos.x, pos.y)
          ? '@ you, under the tree'
          : `@ you — the tree lies ${bearingTo(pos.x, pos.y, state.reckoning.treeX, state.reckoning.treeY)}, ${describeDistance(distance)}`
      );
    }

    const walked = this.walkedCount(state);
    const share = ((walked / (state.mapWidth * state.mapHeight)) * 100).toFixed(1);

    this.legend.innerHTML =
      `<p class="panel-note">${walked} tiles seen, ${share}% of the Thornmarch.</p>` +
      found.map((line) => `<p class="chart-place">${escapeHtml(line)}</p>`).join('');
  }

  /**
   * Reports whether a coordinate has been seen.
   */
  private seen(state: GameState, x: number, y: number): boolean {
    return state.map[y]?.[x]?.explored === true;
  }

  /**
   * Counts the tiles walked, for the chart's header.
   */
  private walkedCount(state: GameState): number {
    let count = 0;
    for (let y = 0; y < state.mapHeight; y++) {
      for (let x = 0; x < state.mapWidth; x++) {
        if (state.map[y][x].explored) count++;
      }
    }
    return count;
  }

  /**
   * Draws a marker for a named place, slightly larger than a tile so it reads.
   */
  private mark(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(x * CELL - 1, y * CELL - 1, CELL + 2, CELL + 2);
    ctx.strokeStyle = hex(mix(0x000000, INK.bone, 0.35));
    ctx.lineWidth = 1;
    ctx.strokeRect(x * CELL - 1.5, y * CELL - 1.5, CELL + 3, CELL + 3);
  }

  /**
   * Removes the overlay from the document.
   */
  destroy(): void {
    this.overlay.remove();
  }
}

/**
 * Formats a numeric colour as CSS.
 */
function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * Escapes text for insertion into the legend.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
