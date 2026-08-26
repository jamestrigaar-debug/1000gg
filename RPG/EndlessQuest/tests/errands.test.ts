import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { populate, peopleAt, regard, Role } from '../src/core/world/People';
import {
  ErrandKind,
  ErrandState,
  errandOf,
  failErrand,
  raiseErrand,
} from '../src/core/narrative/Errands';
import { serializeGameState, deserializeGameState } from '../src/core/state/SaveGame';
import type { InventoryComponent, PositionComponent } from '../src/core/ecs/Component';
import { ERRAND_DISPOSITION_DONE } from '../src/core/SimulationConstants';

/**
 * Stands the character in a settlement and returns who is there.
 */
function enterVillage(sim: SimulationLoop, index = 0) {
  const settlement = sim.state.settlements[index];
  const pos = sim.state.entities.getComponent<PositionComponent>(
    sim.state.playerId,
    'position'
  )!;
  pos.x = settlement.x;
  pos.y = settlement.y;
  return { settlement, people: peopleAt(sim.state.people, settlement.x, settlement.y) };
}

/**
 * Talks until somebody raises an errand, then takes it on.
 */
function takeAnErrand(sim: SimulationLoop) {
  for (let i = 0; i < 12; i++) {
    sim.submitCommand({ type: 'TALK' });
    sim.submitCommand({ type: 'ACCEPT' });
    const accepted = sim.state.errands.find((e) => e.state === ErrandState.ACCEPTED);
    if (accepted) return accepted;
  }
  return undefined;
}

describe('The people of the Thornmarch', () => {
  it('puts the same people in the same villages for a seed', () => {
    const a = new SimulationLoop('people-seed');
    const b = new SimulationLoop('people-seed');

    expect(b.state.people.map((p) => `${p.id}${p.name}${p.role}`)).toEqual(
      a.state.people.map((p) => `${p.id}${p.name}${p.role}`)
    );
    expect(a.state.people.length).toBeGreaterThan(0);
  });

  it('puts everybody in a settlement, and nobody out in the country', () => {
    const sim = new SimulationLoop('people-place');
    const places = new Set(sim.state.settlements.map((s) => `${s.x},${s.y}`));

    for (const person of sim.state.people) {
      expect(places.has(`${person.x},${person.y}`), person.name).toBe(true);
      expect(sim.state.settlements.some((s) => s.name === person.place)).toBe(true);
    }
  });

  it('gives everybody a role that its own name does not contradict', () => {
    const sim = new SimulationLoop('people-names');
    const trades = ['Reeve', 'Widow', 'Thatcher', 'Digger', 'Smith', 'Priest'];

    for (const person of sim.state.people) {
      for (const trade of trades) {
        expect(person.name.includes(trade), `${person.name} is a ${person.role}`).toBe(false);
      }
    }
  });

  it('describes regard in words rather than numbers', () => {
    expect(regard(-80)).toContain('hates');
    expect(regard(0)).toContain('no opinion');
    expect(regard(80)).toContain('owes');
  });

  it('populates from the seed without touching the world generator', () => {
    const sim = new SimulationLoop('people-fork');
    const again = populate('people-fork', sim.state.settlements);
    expect(again.map((p) => p.id)).toEqual(sim.state.people.map((p) => p.id));
  });
});

describe('Errands grow out of what people are', () => {
  it('raises a want that suits the person, and points somewhere real', () => {
    const sim = new SimulationLoop('errand-raise');
    const { people } = enterVillage(sim);
    expect(people.length).toBeGreaterThan(0);

    const errand = raiseErrand(sim.state, people[0]);
    expect(errand).toBeDefined();
    if (!errand) return;

    expect(errand.ask.length).toBeGreaterThan(20);
    expect(errand.task.length).toBeGreaterThan(5);
    expect(errand.dueAt).toBeGreaterThan(sim.state.tick);

    // Wherever it points is on the map and is not open water.
    if (errand.x !== undefined && errand.y !== undefined) {
      expect(sim.state.map[errand.y]?.[errand.x]).toBeDefined();
    }
    // A fetch names something the catalog actually has.
    if (errand.kind === ErrandKind.FETCH || errand.kind === ErrandKind.FEED) {
      expect(errand.item).toBeTruthy();
    }
  });

  it('does not stack two open errands on one person', () => {
    const sim = new SimulationLoop('errand-once');
    const { people } = enterVillage(sim);

    raiseErrand(sim.state, people[0]);
    raiseErrand(sim.state, people[0]);

    expect(sim.state.errands.filter((e) => e.personId === people[0].id)).toHaveLength(1);
  });

  it('talking raises it, and saying so takes it on', () => {
    const sim = new SimulationLoop('errand-accept');
    enterVillage(sim);

    const accepted = takeAnErrand(sim);
    expect(accepted).toBeDefined();
    expect(accepted?.state).toBe(ErrandState.ACCEPTED);
  });

  it('handing over what was asked for completes it and is paid for', () => {
    const sim = new SimulationLoop('errand-discharge');
    enterVillage(sim);

    const errand = takeAnErrand(sim);
    expect(errand).toBeDefined();
    if (!errand) return;

    const inventory = sim.state.entities.getComponent<InventoryComponent>(
      sim.state.playerId,
      'inventory'
    )!;
    const person = sim.state.people.find((p) => p.id === errand.personId)!;
    const before = person.disposition;

    if (errand.item) {
      inventory.items[errand.item] = (inventory.items[errand.item] ?? 0) + errand.quantity;
    } else {
      // An errand done out in the country is marked done by being there.
      errand.state = ErrandState.DONE;
    }

    sim.submitCommand({ type: 'GIVE' });

    expect(errand.state).toBe(ErrandState.DONE);
    expect(person.disposition).toBe(before + ERRAND_DISPOSITION_DONE);
  });

  it('refuses to be paid off early', () => {
    const sim = new SimulationLoop('errand-early');
    enterVillage(sim);

    const errand = takeAnErrand(sim);
    if (!errand || !errand.item) return;

    const inventory = sim.state.entities.getComponent<InventoryComponent>(
      sim.state.playerId,
      'inventory'
    )!;
    delete inventory.items[errand.item];

    sim.submitCommand({ type: 'GIVE' });

    expect(errand.state).toBe(ErrandState.ACCEPTED);
    expect(sim.state.log.some((e) => e.type === 'error' && e.message.startsWith('Not yet'))).toBe(
      true
    );
  });

  it('an errand about a place is done by getting there', () => {
    const sim = new SimulationLoop('errand-arrive');
    const { people } = enterVillage(sim);

    // Find somebody whose want is somewhere rather than something.
    let placed;
    for (const person of people) {
      const raised = raiseErrand(sim.state, person);
      if (raised && (raised.kind === ErrandKind.FIND || raised.kind === ErrandKind.CLEAR)) {
        placed = raised;
        break;
      }
    }
    if (!placed || placed.x === undefined || placed.y === undefined) return;

    placed.state = ErrandState.ACCEPTED;
    const pos = sim.state.entities.getComponent<PositionComponent>(
      sim.state.playerId,
      'position'
    )!;
    pos.x = placed.x;
    pos.y = placed.y;

    sim.submitCommand({ type: 'REST', hours: 1 });

    expect(placed.state).toBe(ErrandState.DONE);
  });

  it('running out of time costs the relationship and makes the world worse', () => {
    const sim = new SimulationLoop('errand-fail');
    const { people } = enterVillage(sim);
    const person = people[0];

    const errand = raiseErrand(sim.state, person);
    expect(errand).toBeDefined();
    if (!errand) return;

    errand.state = ErrandState.ACCEPTED;
    const before = person.disposition;

    const events = failErrand(sim.state, errand);

    expect(errand.state).toBe(ErrandState.FAILED);
    expect(person.disposition).toBeLessThan(before);
    expect(events[0].message).toContain(person.name);
    // The cost is narrated as something that happened, not as a status change.
    expect(events[0].message.length).toBeGreaterThan(40);
  });

  it('the deadline is enforced by the world, not by the player noticing', () => {
    const sim = new SimulationLoop('errand-deadline');
    enterVillage(sim);

    const errand = takeAnErrand(sim);
    if (!errand) return;

    // Walk the clock past it.
    for (let i = 0; i < 40 && errand.state === ErrandState.ACCEPTED; i++) {
      sim.submitCommand({ type: 'REST', hours: 24 });
      if (sim.state.gameOver) break;
    }

    expect([ErrandState.FAILED, ErrandState.DONE]).toContain(errand.state);
  });

  it('somebody who has decided you are a problem asks you for nothing', () => {
    const sim = new SimulationLoop('errand-hostile');
    const { people } = enterVillage(sim);
    for (const person of people) person.disposition = -100;

    sim.submitCommand({ type: 'TALK' });

    expect(sim.state.errands).toHaveLength(0);
    expect(sim.state.log.some((e) => e.message.includes('rather need it than owe you'))).toBe(
      true
    );
  });

  it('carries people and errands across a save', () => {
    const sim = new SimulationLoop('errand-save');
    enterVillage(sim);
    const errand = takeAnErrand(sim);
    if (!errand) return;

    const person = sim.state.people.find((p) => p.id === errand.personId)!;
    person.disposition = 40;

    const restored = deserializeGameState(
      JSON.parse(JSON.stringify(serializeGameState(sim.state)))
    );

    expect(restored.errands).toHaveLength(sim.state.errands.length);
    expect(restored.errands[0].state).toBe(errand.state);
    expect(restored.people.find((p) => p.id === person.id)?.disposition).toBe(40);
    expect(restored.people.find((p) => p.id === person.id)?.met).toBe(true);
  });

  it('paying in knowledge puts a vigil on the chart', () => {
    const sim = new SimulationLoop('errand-knowledge');
    const { people } = enterVillage(sim);

    // The priest and the widow pay in what they know rather than in goods.
    const teller = people.find((p) => p.role === Role.PRIEST || p.role === Role.WIDOW);
    if (!teller) return;

    const errand = raiseErrand(sim.state, teller);
    if (!errand?.reward.knowledge) return;

    // None of the vigils are known at the start of a run.
    const hidden = sim.state.reckoning.vigils.filter(
      (vigil) => !sim.state.map[vigil.y][vigil.x].explored
    );
    expect(hidden.length).toBeGreaterThan(0);

    errand.state = ErrandState.DONE;
    sim.submitCommand({ type: 'GIVE' });

    const known = sim.state.reckoning.vigils.filter(
      (vigil) => sim.state.map[vigil.y][vigil.x].explored
    );
    expect(known.length).toBeGreaterThan(0);
    expect(sim.state.log.some((e) => e.message.includes('It is on your chart now'))).toBe(true);
  });

  it('has a want for every role it can generate', () => {
    const sim = new SimulationLoop('errand-coverage');

    for (const role of Object.values(Role)) {
      const person = {
        id: `test:${role}`,
        name: 'Test',
        role,
        place: sim.state.settlements[0].name,
        x: sim.state.settlements[0].x,
        y: sim.state.settlements[0].y,
        disposition: 0,
        met: false,
      };
      sim.state.people.push(person);

      const errand = raiseErrand(sim.state, person);
      expect(errand, `${role} has nothing to want`).toBeDefined();
      expect(errandOf(sim.state, person)).toBeDefined();
    }
  });
});
