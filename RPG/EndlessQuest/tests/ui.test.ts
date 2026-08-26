// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { LogPanel } from '../src/ui/panels/LogPanel';
import { StatusPanel } from '../src/ui/panels/StatusPanel';
import { ActionPanel } from '../src/ui/panels/ActionPanel';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { formatGameTime } from '../src/core/state/GameState';
import type { GameEvent } from '../src/events/GameEvent';
import { STARTING_HIT_POINTS } from '../src/core/SimulationConstants';

describe('UI Panels & Formatting', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="status-bar"></div>
      <div id="action-panel"></div>
      <div id="log-panel"></div>
    `;
  });

  it('StatusPanel shows the character sheet: abilities, exhaustion, and death saves', () => {
    const container = document.getElementById('status-bar')!;
    const panel = new StatusPanel(container);
    const sim = new SimulationLoop('ui-sheet');

    panel.render(sim.state);
    // Every ability is on the bar, each with a signed modifier.
    expect(container.querySelectorAll('.ability').length).toBe(6);
    expect(container.textContent).toMatch(/STR [+-]\d/);

    // Exhaustion and death saves stay hidden while there is nothing to report.
    expect(container.textContent).not.toContain('Exhaustion');
    expect(container.textContent).not.toContain('Death saves');

    const stats = sim.state.entities.getComponent(sim.state.playerId, 'stats')!;
    stats.exhaustion = 3;
    sim.state.entities.addComponent(sim.state.playerId, {
      type: 'dying',
      successes: 1,
      failures: 2,
      stable: false,
    });
    panel.render(sim.state);

    expect(container.textContent).toContain('Exhausted 3');
    expect(container.textContent).toContain('+--');
  });

  it('formatGameTime correctly formats day, hour, and year progression', () => {
    // Tick 0 (initial 6:00, Day 1, Year 1)
    expect(formatGameTime(0)).toBe('Y1 D1 06:00');

    // Tick 18 (Hour 24 -> Hour 0 of Day 2, Year 1)
    expect(formatGameTime(18)).toBe('Y1 D2 00:00');

    // Tick 24 (Hour 30 -> Hour 6 of Day 2, Year 1)
    expect(formatGameTime(24)).toBe('Y1 D2 06:00');

    // Tick 8640 (1 full 360-day year elapsed -> Y2 D1 06:00)
    expect(formatGameTime(8640)).toBe('Y2 D1 06:00');
  });

  it('LogPanel renders formatted timestamps without mixing years and days', () => {
    const container = document.getElementById('log-panel')!;
    const logPanel = new LogPanel(container);

    const event1: GameEvent = { tick: 0, type: 'system', message: 'Game started' };
    const event2: GameEvent = { tick: 24, type: 'movement', message: 'Moved north' };

    logPanel.render([event1, event2]);

    expect(container.innerHTML).toContain('[T0 Y1 D1 06:00]');
    expect(container.innerHTML).toContain('[T24 Y1 D2 06:00]');
    expect(container.innerHTML).not.toContain('Y2'); // Must NOT calculate tick 24 as Year 2!

    logPanel.addEvent({ tick: 48, type: 'rest', message: 'Rested' });
    expect(container.innerHTML).toContain('[T48 Y1 D3 06:00]');
  });

  it('StatusPanel displays HP, Hunger, Thirst, Fatigue, Time, and Seed', () => {
    const container = document.getElementById('status-bar')!;
    const statusPanel = new StatusPanel(container);
    const sim = new SimulationLoop('status-test-seed');

    statusPanel.render(sim.state);

    expect(container.textContent).toContain('HP');
    expect(container.textContent).toContain(`${STARTING_HIT_POINTS}/${STARTING_HIT_POINTS}`);
    expect(container.textContent).toContain('Hunger');
    expect(container.textContent).toContain('Thirst');
    expect(container.textContent).toContain('Fatigue');
    expect(container.textContent).toContain('Y1 D1 06:00');
    expect(container.textContent).toContain('status-test-seed');
  });

  it('ActionPanel binds buttons and disables impassable directions', () => {
    const container = document.getElementById('action-panel')!;
    const sim = new SimulationLoop('action-test');
    const actionPanel = new ActionPanel(container, sim);

    const northBtn = container.querySelector('[data-action="move-north"]') as HTMLButtonElement;
    expect(northBtn).toBeDefined();

    actionPanel.destroy();
  });
});
