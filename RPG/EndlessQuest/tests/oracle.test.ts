import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import {
  Register,
  narrate,
  registerFor,
  registerLabel,
} from '../src/core/narrative/Narrator';
import {
  ThreadKind,
  openThread,
  closeThread,
  hasThread,
  settleThreads,
} from '../src/core/narrative/Threads';
import { serializeGameState, deserializeGameState } from '../src/core/state/SaveGame';
import type { InventoryComponent, MarkComponent, StatsComponent } from '../src/core/ecs/Component';
import { THREAD_FOLLOW_HOURS, THREAD_WOUND_HOURS } from '../src/core/SimulationConstants';

/**
 * Sets the Mark, which is what the narrator's register is keyed to.
 */
function setMark(sim: SimulationLoop, intensity: number): void {
  const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;
  mark.intensity = intensity;
}

describe('The narrator', () => {
  it('is silent while the Mark is cold, and speaks as it heats', () => {
    const sim = new SimulationLoop('voice-ladder');
    setMark(sim, 0);
    expect(registerFor(sim.state)).toBe(Register.COLD);

    setMark(sim, 50);
    expect(registerFor(sim.state)).toBeGreaterThan(Register.COLD);

    setMark(sim, 100);
    expect(registerFor(sim.state)).toBe(Register.OPEN);
  });

  it('lends the character one more register when they are badly hurt', () => {
    const sim = new SimulationLoop('voice-wounded');
    setMark(sim, 30);
    const before = registerFor(sim.state);

    const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;
    stats.hp = Math.floor(stats.maxHp * 0.2);

    expect(registerFor(sim.state)).toBe(before + 1);
  });

  it('never touches the account while the Mark is cold', () => {
    const sim = new SimulationLoop('voice-cold');
    setMark(sim, 0);

    for (let i = 0; i < 50; i++) {
      const told = narrate(sim.state, 'You cross the ford.');
      expect(told.text).toBe('You cross the ford.');
      expect(told.unreliable).toBe(false);
    }
  });

  it('lies only at the top of the ladder, and admits it in the data', () => {
    const cold = new SimulationLoop('lie-cold');
    setMark(cold, 20);
    let coldLies = 0;
    for (let i = 0; i < 200; i++) {
      cold.state.tick += 12;
      if (narrate(cold.state, 'The road bends north.').unreliable) coldLies++;
    }
    expect(coldLies).toBe(0);

    const open = new SimulationLoop('lie-open');
    setMark(open, 100);
    let openLies = 0;
    for (let i = 0; i < 200; i++) {
      open.state.tick += 12;
      if (narrate(open.state, 'The road bends north.').unreliable) openLies++;
    }
    expect(openLies).toBeGreaterThan(0);
  });

  it('never lies about the numbers, however far gone it is', () => {
    const sim = new SimulationLoop('lie-mechanics');
    setMark(sim, 100);

    // The one guarantee the whole device rests on: a mechanical readout survives intact,
    // so a player reading the dice can always catch the narrator out.
    for (let i = 0; i < 300; i++) {
      sim.state.tick += 7;
      const told = narrate(sim.state, 'Nothing found.', { mechanical: '(d20 4+1 = 5 vs DC 12)' });
      expect(told.text).toContain('(d20 4+1 = 5 vs DC 12)');
    }
  });

  it('leaves room between lies rather than stacking them', () => {
    const sim = new SimulationLoop('lie-spacing');
    setMark(sim, 100);

    const lieTicks: number[] = [];
    for (let i = 0; i < 300; i++) {
      sim.state.tick += 1;
      if (narrate(sim.state, 'You walk.').unreliable) lieTicks.push(sim.state.tick);
    }

    expect(lieTicks.length).toBeGreaterThan(2);
    for (let i = 1; i < lieTicks.length; i++) {
      expect(lieTicks[i] - lieTicks[i - 1]).toBeGreaterThanOrEqual(6);
    }
  });

  it('names its registers', () => {
    expect(registerLabel(Register.COLD)).toBe('Silent');
    expect(registerLabel(Register.OPEN)).toBe('Lying');
  });
});

describe('Narrative threads', () => {
  it('opens a thread once rather than stacking duplicates', () => {
    const sim = new SimulationLoop('thread-once');
    openThread(sim.state, ThreadKind.FOLLOWED);
    openThread(sim.state, ThreadKind.FOLLOWED);

    expect(sim.state.threads).toHaveLength(1);
    expect(hasThread(sim.state, ThreadKind.FOLLOWED)).toBe(true);
  });

  it('pushes the reckoning back when the same thing happens again', () => {
    const sim = new SimulationLoop('thread-postpone');
    const first = openThread(sim.state, ThreadKind.FOLLOWED);
    const due = first.dueAt;

    sim.state.tick += 5;
    openThread(sim.state, ThreadKind.FOLLOWED);

    expect(sim.state.threads[0].dueAt).toBeGreaterThan(due);
  });

  it('does not settle a thread before it is due', () => {
    const sim = new SimulationLoop('thread-early');
    openThread(sim.state, ThreadKind.FOLLOWED);

    expect(settleThreads(sim.state)).toHaveLength(0);
    expect(sim.state.threads).toHaveLength(1);
  });

  it('settles what is following, one way or the other', () => {
    const sim = new SimulationLoop('thread-followed');
    openThread(sim.state, ThreadKind.FOLLOWED);
    sim.state.tick += THREAD_FOLLOW_HOURS;

    const events = settleThreads(sim.state);

    expect(events.length).toBeGreaterThan(0);
    expect(hasThread(sim.state, ThreadKind.FOLLOWED)).toBe(false);
  });

  it('a wound left alone either knits or goes bad, and going bad costs blood', () => {
    let festered = 0;
    let knit = 0;

    for (let i = 0; i < 40; i++) {
      const sim = new SimulationLoop(`thread-wound-${i}`);
      const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;
      const before = stats.hp;

      openThread(sim.state, ThreadKind.WOUND);
      sim.state.tick += THREAD_WOUND_HOURS;
      const events = settleThreads(sim.state);

      const outcome = events[0]?.data as { resolved?: string } | undefined;
      if (outcome?.resolved === 'festers') {
        festered++;
        expect(stats.hp).toBeLessThan(before);
        // It has not finished with the character yet.
        expect(hasThread(sim.state, ThreadKind.WOUND)).toBe(true);
      } else {
        knit++;
        expect(stats.hp).toBe(before);
        expect(hasThread(sim.state, ThreadKind.WOUND)).toBe(false);
      }
    }

    expect(festered).toBeGreaterThan(0);
    expect(knit).toBeGreaterThan(0);
  });

  it('something lost comes back, carried or recovered', () => {
    let recovered = 0;
    let taken = 0;

    for (let i = 0; i < 30; i++) {
      const sim = new SimulationLoop(`thread-lost-${i}`);
      const inventory = sim.state.entities.getComponent<InventoryComponent>(
        sim.state.playerId,
        'inventory'
      )!;
      inventory.items = {};

      openThread(sim.state, ThreadKind.LOST, 'waterskin');
      sim.state.tick += 100;
      const events = settleThreads(sim.state);
      const outcome = (events[0]?.data as { resolved?: string })?.resolved;

      if (outcome === 'recovered') {
        recovered++;
        expect(inventory.items.waterskin).toBe(1);
      } else {
        taken++;
        // Whatever has it is now following.
        expect(hasThread(sim.state, ThreadKind.FOLLOWED)).toBe(true);
      }
    }

    expect(recovered).toBeGreaterThan(0);
    expect(taken).toBeGreaterThan(0);
  });

  it('closing a thread that is not there is harmless', () => {
    const sim = new SimulationLoop('thread-missing');
    closeThread(sim.state, 'nothing:0:0');
    expect(sim.state.threads).toHaveLength(0);
  });

  it('carries open threads across a save, so a reload does not forget the story', () => {
    const sim = new SimulationLoop('thread-save');
    openThread(sim.state, ThreadKind.LOST, 'waterskin');
    openThread(sim.state, ThreadKind.FOLLOWED);

    const restored = deserializeGameState(
      JSON.parse(JSON.stringify(serializeGameState(sim.state)))
    );

    expect(restored.threads).toHaveLength(2);
    expect(restored.threads.map((t) => t.kind).sort()).toEqual(
      [ThreadKind.FOLLOWED, ThreadKind.LOST].sort()
    );
    expect(restored.threads.find((t) => t.kind === ThreadKind.LOST)?.subject).toBe('waterskin');
  });

  it('a dead character is owed nothing further', () => {
    const sim = new SimulationLoop('thread-dead');
    openThread(sim.state, ThreadKind.WOUND);
    sim.state.tick += 100;
    sim.state.gameOver = true;

    expect(settleThreads(sim.state)).toHaveLength(0);
  });

  it('the twists that raise questions open threads for them', () => {
    const sim = new SimulationLoop('thread-from-twist');
    const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;

    // Forage until a twist lands, which is what opens threads in play.
    for (let i = 0; i < 200 && sim.state.threads.length === 0; i++) {
      stats.hunger = 0;
      stats.thirst = 0;
      stats.hp = stats.maxHp;
      if (sim.state.encounterId !== null) sim.state.encounterId = null;
      sim.submitCommand({ type: 'SEARCH' });
    }

    expect(sim.state.threads.length).toBeGreaterThan(0);
  });
});
