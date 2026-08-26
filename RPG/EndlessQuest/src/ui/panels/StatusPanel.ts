import type { GameState } from '../../core/state/GameState';
import { getCurrentTile } from '../../core/state/GameState';
import type {
  AbilitiesComponent,
  DyingComponent,
  MarkComponent,
  PositionComponent,
  StatsComponent,
} from '../../core/ecs/Component';
import { DEFAULT_MAX_HP, DEFAULT_INITIAL_HP, MARK_MAX } from '../../core/SimulationConstants';
import { MARK_BAND_LABELS, TERRAIN_NAME } from '../../core/lore/Flavor';
import { markBand } from '../../core/simulation/systems/MarkSystem';
import { getDayPhase, getSeason } from '../../core/world/TimeOfDay';

/** Number of glyph cells in a status bar meter. */
const METER_CELLS = 10;
import { settlementAt } from '../../core/world/Settlement';
import {
  atTree,
  bearingTo,
  describeDistance,
  vigilsKept,
} from '../../core/world/Reckoning';
import { ABILITY_LABEL, ABILITY_ORDER, abilityModifier } from '../../core/rules/Abilities';
import {
  EXHAUSTION_EFFECTS,
  MAX_EXHAUSTION,
  exhaustionLabel,
} from '../../core/rules/Exhaustion';
import {
  DEATH_SAVE_DC,
  DEATH_SAVE_FAILURES,
  DEATH_SAVE_SUCCESSES,
} from '../../core/rules/DeathSaves';

/**
 * UI panel rendering player vital statistics, current calendar time, world coordinates, and seed.
 */
export class StatusPanel {
  private container: HTMLElement;

  /**
   * @param container DOM element hosting the status bar
   */
  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Renders current player stats and world information.
   * @param state GameState
   */
  render(state: GameState): void {
    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    const tile = getCurrentTile(state);

    const hp = stats?.hp ?? DEFAULT_INITIAL_HP;
    const maxHp = stats?.maxHp ?? DEFAULT_MAX_HP;
    const hunger = stats?.hunger ?? 0;
    const thirst = stats?.thirst ?? 0;
    const fatigue = stats?.fatigue ?? 0;

    const mark = state.entities.getComponent<MarkComponent>(state.playerId, 'mark');
    const markIntensity = mark?.intensity ?? 0;
    const markPercent = Math.max(0, Math.min(100, (markIntensity / MARK_MAX) * 100));
    const markLabel = MARK_BAND_LABELS[markBand(markIntensity)];

    const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
    const locationStr = pos ? `${pos.x},${pos.y}` : '';
    const settlement = pos ? settlementAt(state.settlements, pos.x, pos.y) : undefined;
    const terrainLabel = settlement
      ? settlement.name
      : tile
        ? TERRAIN_NAME[tile.terrain]
        : 'nowhere';
    const phase = getDayPhase(state.hour);
    const season = getSeason(state.day);

    const abilities = state.entities.getComponent<AbilitiesComponent>(
      state.playerId,
      'abilities'
    );
    const dying = state.entities.getComponent<DyingComponent>(state.playerId, 'dying');

    this.container.innerHTML = `
      ${this.abilityRow(abilities)}
      ${this.meter('HP', `${Math.round(hp)}/${maxHp}`, hpPercent, 'hp')}
      ${this.meter('Hunger', `${Math.floor(hunger)}`, hunger, 'hunger')}
      ${this.meter('Thirst', `${Math.floor(thirst)}`, thirst, 'thirst')}
      ${this.meter('Fatigue', `${Math.floor(fatigue)}`, fatigue, 'fatigue')}
      ${this.exhaustionRow(stats?.exhaustion ?? 0)}
      ${this.deathSaveRow(dying)}
      ${this.meter(
        'Mark',
        `<span class="mark-value band-${markBand(markIntensity)}">${markLabel}</span>`,
        markPercent,
        'mark'
      )}
      ${this.debtRow(state, pos)}
      <div class="status-item">
        <span class="status-label">Time</span>
        <span class="status-value">Y${state.year} D${state.day} ${String(state.hour).padStart(2, '0')}:00</span>
        <span class="status-sub">${season} &middot; ${phase}</span>
      </div>
      <div class="status-item">
        <span class="status-label">Location</span>
        <span class="status-value">${terrainLabel}${locationStr ? ` (${locationStr})` : ''}</span>
      </div>
      <div class="status-item">
        <span class="status-label">Seed</span>
        <span class="status-value">${state.seedString}</span>
      </div>
    `;
  }

  /**
   * Renders where the debt lies and how much of it has been argued down.
   *
   * This is the only readout on the bar that is about where the run is going rather
   * than how it is going, so it sits between the character and the clock.
   *
   * @param state Current game state
   * @param pos Where the character is standing
   * @returns HTML for the objective readout
   */
  private debtRow(state: GameState, pos: PositionComponent | undefined): string {
    if (!pos) return '';

    const { treeX, treeY, vigils } = state.reckoning;
    const kept = vigilsKept(state.reckoning);
    const here = atTree(state.reckoning, pos.x, pos.y);
    const distance = Math.max(Math.abs(treeX - pos.x), Math.abs(treeY - pos.y));
    const where = here
      ? 'you are under it'
      : `${bearingTo(pos.x, pos.y, treeX, treeY)}, ${describeDistance(distance)}`;

    return `
      <div class="status-item">
        <span class="status-label">The debt</span>
        <span class="status-value">${where}</span>
        <span class="status-sub">${kept}/${vigils.length} rites kept</span>
      </div>
    `;
  }

  /**
   * Renders the six ability scores with their modifiers.
   *
   * The scores are what every check in the game is rolled against, so they belong on
   * the bar rather than only in the opening narration.
   *
   * @param abilities The character's abilities, if they have been dealt yet
   * @returns HTML for the ability row, or an empty string
   */
  private abilityRow(abilities: AbilitiesComponent | undefined): string {
    if (!abilities) return '';

    const cells = ABILITY_ORDER.map((ability) => {
      const score = abilities.scores[ability];
      const modifier = abilityModifier(score);
      const sign = modifier >= 0 ? `+${modifier}` : `${modifier}`;
      return (
        `<span class="ability" title="${ABILITY_LABEL[ability]} ${score}">` +
        `${ABILITY_LABEL[ability]} <b>${sign}</b></span>`
      );
    }).join('');

    return `
      <div class="status-item abilities">
        <span class="status-label">Level ${abilities.level}</span>
        <span class="status-value">${cells}</span>
      </div>
    `;
  }

  /**
   * Renders the exhaustion ladder and the penalty currently in force.
   *
   * Nothing is shown while the character is rested, so the readout only appears once it
   * is telling the player something they need to act on.
   *
   * @param level Current exhaustion level
   * @returns HTML for the exhaustion readout, or an empty string
   */
  private exhaustionRow(level: number): string {
    if (level <= 0) return '';

    const rungs =
      `<span class="full">${'|'.repeat(level)}</span>` +
      `<span class="empty">${'|'.repeat(MAX_EXHAUSTION - level)}</span>`;

    return `
      <div class="status-item">
        <span class="status-label">Exhaustion</span>
        <span class="status-value" title="${EXHAUSTION_EFFECTS[level]}">${exhaustionLabel(level)}</span>
        <span class="meter exhaustion">${rungs}</span>
      </div>
    `;
  }

  /**
   * Renders the death saving throws while the character is down.
   *
   * @param dying The dying component, if the character is at zero hit points
   * @returns HTML for the death save readout, or an empty string
   */
  private deathSaveRow(dying: DyingComponent | undefined): string {
    if (!dying) return '';

    const value = dying.stable
      ? 'Stable'
      : `${'+'.repeat(dying.successes)}${'-'.repeat(dying.failures)}` || 'rolling';

    return `
      <div class="status-item">
        <span class="status-label">Death saves</span>
        <span class="status-value" title="DC ${DEATH_SAVE_DC}: ${DEATH_SAVE_SUCCESSES} to stabilise, ${DEATH_SAVE_FAILURES} to die">${value}</span>
      </div>
    `;
  }

  /**
   * Renders one readout as a label, a value, and a bar drawn from glyphs.
   *
   * The reference roguelikes draw their gauges as runs of characters rather than as
   * filled rectangles, which keeps the whole interface in one visual language.
   *
   * @param label Readout name
   * @param value Value markup, already escaped or intentionally markup
   * @param percent Fill percentage in [0, 100]
   * @param kind Class controlling the bar's colour
   * @returns HTML for the readout
   */
  private meter(label: string, value: string, percent: number, kind: string): string {
    const filled = Math.max(0, Math.min(METER_CELLS, Math.round((percent / 100) * METER_CELLS)));
    const bar =
      `<span class="full">${'|'.repeat(filled)}</span>` +
      `<span class="empty">${'|'.repeat(METER_CELLS - filled)}</span>`;

    return `
      <div class="status-item">
        <span class="status-label">${label}</span>
        <span class="status-value">${value}</span>
        <span class="meter ${kind}">${bar}</span>
      </div>
    `;
  }

  /**
   * Clears panel container contents.
   */
  destroy(): void {
    this.container.innerHTML = '';
  }
}
