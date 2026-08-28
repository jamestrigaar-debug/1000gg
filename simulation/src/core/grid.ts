/* ============================================================================
 * SPATIAL GRID — uniform 5 m hash for neighbour, duel and lane queries.
 *
 * 22 players would be fine with brute force, but every brain beat asks
 * "who is near this point / this lane" several times over, so the grid turns
 * an O(n) sweep per query into a handful of cell lookups. It is rebuilt from
 * scratch each tick: with 22 entities that is cheaper than incremental
 * updates and, more importantly, it cannot drift out of sync with the truth.
 * ========================================================================== */

import { GRID_CELL } from "./constants";
import { closestPointOnSegment, type Vec2 } from "./math";
import { SIM_MAX_X, SIM_MAX_Y, SIM_MIN_X, SIM_MIN_Y } from "./pitch";

export interface GridItem {
  pos: Vec2;
}

export class SpatialGrid<T extends GridItem> {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: T[][];

  constructor() {
    this.cols = Math.ceil((SIM_MAX_X - SIM_MIN_X) / GRID_CELL) + 1;
    this.rows = Math.ceil((SIM_MAX_Y - SIM_MIN_Y) / GRID_CELL) + 1;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  private index(x: number, y: number): number {
    const cx = Math.min(
      this.cols - 1,
      Math.max(0, Math.floor((x - SIM_MIN_X) / GRID_CELL)),
    );
    const cy = Math.min(
      this.rows - 1,
      Math.max(0, Math.floor((y - SIM_MIN_Y) / GRID_CELL)),
    );
    return cy * this.cols + cx;
  }

  /** Only the cells that were actually used last time are cleared: with 22
   *  entities in a ~470-cell grid, sweeping every cell each tick costs more
   *  than the whole rest of the rebuild put together. */
  private readonly used: number[] = [];

  rebuild(items: readonly T[]): void {
    for (const i of this.used) {
      const cell = this.cells[i];
      if (cell) cell.length = 0;
    }
    this.used.length = 0;
    for (const item of items) {
      const i = this.index(item.pos.x, item.pos.y);
      const cell = this.cells[i];
      if (!cell) continue;
      if (cell.length === 0) this.used.push(i);
      cell.push(item);
    }
  }

  /** Items within `radius` of p. Order is grid order, which is stable for a
   *  given set of positions — determinism requires callers never rely on
   *  insertion order, so results are sorted by id where it matters. */
  query(p: Vec2, radius: number, out: T[] = []): T[] {
    out.length = 0;
    const r = Math.max(radius, 0);
    const minC = Math.max(0, Math.floor((p.x - r - SIM_MIN_X) / GRID_CELL));
    const maxC = Math.min(this.cols - 1, Math.floor((p.x + r - SIM_MIN_X) / GRID_CELL));
    const minR = Math.max(0, Math.floor((p.y - r - SIM_MIN_Y) / GRID_CELL));
    const maxR = Math.min(this.rows - 1, Math.floor((p.y + r - SIM_MIN_Y) / GRID_CELL));
    const r2 = r * r;
    for (let cy = minR; cy <= maxR; cy++) {
      for (let cx = minC; cx <= maxC; cx++) {
        const cell = this.cells[cy * this.cols + cx];
        if (!cell) continue;
        for (const item of cell) {
          const dx = item.pos.x - p.x;
          const dy = item.pos.y - p.y;
          if (dx * dx + dy * dy <= r2) out.push(item);
        }
      }
    }
    return out;
  }

  /** Items within `radius` of the segment a-b: the pass-lane query. */
  queryLane(a: Vec2, b: Vec2, radius: number, out: T[] = []): T[] {
    out.length = 0;
    const minC = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius - SIM_MIN_X) / GRID_CELL));
    const maxC = Math.min(
      this.cols - 1,
      Math.floor((Math.max(a.x, b.x) + radius - SIM_MIN_X) / GRID_CELL),
    );
    const minR = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius - SIM_MIN_Y) / GRID_CELL));
    const maxR = Math.min(
      this.rows - 1,
      Math.floor((Math.max(a.y, b.y) + radius - SIM_MIN_Y) / GRID_CELL),
    );
    for (let cy = minR; cy <= maxR; cy++) {
      for (let cx = minC; cx <= maxC; cx++) {
        const cell = this.cells[cy * this.cols + cx];
        if (!cell) continue;
        for (const item of cell) {
          const c = closestPointOnSegment(item.pos, a, b);
          const dx = item.pos.x - c.x;
          const dy = item.pos.y - c.y;
          if (dx * dx + dy * dy <= radius * radius) out.push(item);
        }
      }
    }
    return out;
  }
}
