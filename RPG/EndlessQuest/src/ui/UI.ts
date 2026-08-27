import { MapRenderer } from './map/MapRenderer';
import { Chart } from './map/Chart';
import { StatusPanel } from './panels/StatusPanel';
import { ActionPanel } from './panels/ActionPanel';
import { LogPanel } from './panels/LogPanel';
import type { SimulationLoop } from '../core/simulation/SimulationLoop';
import type { GameState } from '../core/state/GameState';
import type { GameEvent } from '../events/GameEvent';
import type { PositionComponent } from '../core/ecs/Component';
import { deserializeGameState, serializeGameState } from '../core/state/SaveGame';
import { loadFromSlot, saveToSlot } from '../core/state/SaveStore';

/**
 * High-level UI coordinator binding simulation events to MapRenderer and DOM panels.
 */
export class UI {
  private mapRenderer: MapRenderer;
  /** The board's own element, so it can give its space back when there is no board */
  private mapContainer: HTMLElement;
  private chart: Chart;
  private statusPanel: StatusPanel;
  private actionPanel: ActionPanel;
  private logPanel: LogPanel;
  private simulation: SimulationLoop;
  private centerMapListener: () => void;
  private saveListener: () => void;
  private loadListener: () => void;
  private eventListener: (event: GameEvent) => void;
  private chartKeyListener: (e: KeyboardEvent) => void;
  private chartToggleListener: () => void;
  private redrawPending: boolean = false;

  /**
   * @param container Root DOM container element
   * @param simulation SimulationLoop instance
   */
  constructor(_container: HTMLElement, simulation: SimulationLoop) {
    this.simulation = simulation;

    const statusBar = document.getElementById('status-bar')!;
    const mapContainer = document.getElementById('map-container')!;
    const actionPanelEl = document.getElementById('action-panel')!;
    const logPanelEl = document.getElementById('log-panel')!;

    // The controls are spread across the layout rather than stacked in one column, so
    // that nothing the player needs to see is below a fold. Any of these missing simply
    // falls back to the action panel.
    const slots = {
      here: document.getElementById('here-panel') ?? undefined,
      movement: document.getElementById('movement-panel') ?? undefined,
      speak: document.getElementById('speak-bar') ?? undefined,
      character: document.getElementById('character-panel') ?? undefined,
    };

    this.mapContainer = mapContainer;
    this.mapRenderer = new MapRenderer(
      mapContainer,
      simulation.state.mapWidth,
      simulation.state.mapHeight
    );
    this.statusPanel = new StatusPanel(statusBar);
    this.actionPanel = new ActionPanel(actionPanelEl, simulation, slots);
    this.logPanel = new LogPanel(logPanelEl);
    // The chart is a full-window overlay: the map column is a keyhole, and the whole
    // point of the chart is to be the opposite of that.
    this.chart = new Chart(document.body);

    this.centerMapListener = () => {
      const pos = this.simulation.state.entities.getComponent<PositionComponent>(
        this.simulation.state.playerId,
        'position'
      );
      if (pos) {
        this.mapRenderer.centerOn(pos.x, pos.y);
        this.mapRenderer.render(this.simulation.state);
      }
    };

    this.saveListener = () => {
      void this.saveGame();
    };

    this.loadListener = () => {
      void this.loadGame();
    };

    // The chart is a view of the run rather than an action in it, so it lives with the
    // UI and not with the commands.
    this.chartKeyListener = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this.chart.toggle(this.simulation.state);
      } else if (e.key === 'Escape' && this.chart.isOpen()) {
        e.preventDefault();
        this.chart.close();
      }
    };

    this.chartToggleListener = () => this.chart.toggle(this.simulation.state);

    this.eventListener = (event: GameEvent) => {
      if (event.type === 'system' && event.message.includes('New game started')) {
        this.logPanel.clear();
      }

      // The log is rendered from the chronicle rather than appended to as events
      // arrive. Emission order is not the order things happened: a command reports
      // itself at the hour it finishes and the systems then report the hours in
      // between, which are earlier. The chronicle is kept in order; this shows it.

      // Everything else is a view of the state as it now stands, and a single command
      // can emit half a dozen events -- a move, its ambience, the turn of the day, the
      // Mark shifting. Rebuilding the panels and redrawing the grid once per event meant
      // doing the same work five times over and throwing four of the results away.
      this.scheduleRedraw();
    };
  }

  /**
   * Requests a redraw of everything that shows the current state, at most once a frame.
   *
   * Coalescing here rather than in each panel keeps the panels simple: they still render
   * from scratch, they are just asked to do it once per turn instead of once per event.
   */
  private scheduleRedraw(): void {
    if (this.redrawPending) return;
    this.redrawPending = true;

    const draw = (): void => {
      this.redrawPending = false;
      // The board shows the country, and the country is outside. While the character is
      // under a hill it is a black rectangle, so it gives its space back to the column.
      const underground = this.simulation.state.instance !== null;
      if (this.mapContainer) {
        this.mapContainer.style.height = underground ? '0' : '';
        this.mapContainer.style.borderBottom = underground ? 'none' : '';
      }

      this.logPanel.render(this.simulation.state.log);
      this.statusPanel.render(this.simulation.state);
      this.actionPanel.render();
      this.mapRenderer.render(this.simulation.state);
      if (this.chart.isOpen()) this.chart.show(this.simulation.state);
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(draw);
    else draw();
  }

  /**
   * Initializes renderer, subscribes to simulation events, and draws initial frame.
   */
  async initialize(): Promise<void> {
    await this.mapRenderer.initialize();

    // Subscribe to all simulation events
    this.simulation.onEvent(this.eventListener);

    // Initial render
    this.update(this.simulation.state);

    // Initial camera position centered on player
    const pos = this.simulation.state.entities.getComponent<PositionComponent>(
      this.simulation.state.playerId,
      'position'
    );
    if (pos) {
      this.mapRenderer.centerOn(pos.x, pos.y);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.chartKeyListener);
      window.addEventListener('chart-toggle', this.chartToggleListener);
      window.addEventListener('center-map', this.centerMapListener);
      window.addEventListener('save-game', this.saveListener);
      window.addEventListener('load-game', this.loadListener);
    }
  }

  /**
   * Writes the current run to persistent storage and reports the outcome in the log.
   */
  private async saveGame(): Promise<void> {
    try {
      await saveToSlot(serializeGameState(this.simulation.state));
      this.logNotice('The chronicle is written.');
    } catch (e) {
      this.logNotice(`The chronicle could not be written: ${e}`, 'error');
    }
  }

  /**
   * Restores the stored run, replacing the live simulation state and redrawing.
   */
  private async loadGame(): Promise<void> {
    try {
      const payload = await loadFromSlot();
      if (!payload) {
        this.logNotice('There is no chronicle to take up.', 'error');
        return;
      }

      this.simulation.restoreState(deserializeGameState(payload));
      this.logPanel.clear();
      // The board shows the country, and the country is outside. While the character is
      // under a hill it is a black rectangle, so it gives its space back to the column.
      const underground = this.simulation.state.instance !== null;
      if (this.mapContainer) {
        this.mapContainer.style.height = underground ? '0' : '';
        this.mapContainer.style.borderBottom = underground ? 'none' : '';
      }

      this.logPanel.render(this.simulation.state.log);
      this.update(this.simulation.state);
      this.centerMapListener();
      this.logNotice('You take up the chronicle where it was left.');
    } catch (e) {
      this.logNotice(`The chronicle could not be read: ${e}`, 'error');
    }
  }

  /**
   * Appends a UI-level notice to the log without routing it through the simulation.
   *
   * Save and load are player actions rather than world events, so they are recorded
   * for feedback but deliberately kept out of the simulation's event history.
   *
   * @param message Text to display
   * @param type Log entry class, defaulting to a system notice
   */
  private logNotice(message: string, type: string = 'system'): void {
    this.logPanel.addEvent({ tick: this.simulation.state.tick, type, message });
  }

  /**
   * Performs full UI update across all panels and renderer.
   * @param state Current GameState
   */
  update(state: GameState): void {
    this.statusPanel.render(state);
    this.actionPanel.render();
    this.mapRenderer.render(state);
    this.logPanel.render(state.log);
  }

  /**
   * Cleans up all sub-panels, renderer, and global event listeners.
   */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.chartKeyListener);
      window.removeEventListener('chart-toggle', this.chartToggleListener);
      window.removeEventListener('center-map', this.centerMapListener);
      window.removeEventListener('save-game', this.saveListener);
      window.removeEventListener('load-game', this.loadListener);
    }
    this.simulation.offEvent(this.eventListener);
    this.mapRenderer.destroy();
    this.statusPanel.destroy();
    this.actionPanel.destroy();
    this.logPanel.destroy();
    this.chart.destroy();
  }
}
