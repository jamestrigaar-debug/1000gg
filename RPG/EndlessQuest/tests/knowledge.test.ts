import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { Topic, readTopic, ask } from '../src/core/narrative/Knowledge';
import { interpret } from '../src/core/narrative/Interpreter';
import { Role, Trait, peopleAt } from '../src/core/world/People';
import type { MarkComponent, PositionComponent } from '../src/core/ecs/Component';
import { HOURS_PER_DAY } from '../src/core/SimulationConstants';

/**
 * Stands the character in a settlement.
 */
function enterVillage(sim: SimulationLoop, index = 0) {
  const settlement = sim.state.settlements[index];
  const pos = sim.state.entities.getComponent<PositionComponent>(
    sim.state.playerId,
    'position'
  )!;
  pos.x = settlement.x;
  pos.y = settlement.y;
  return peopleAt(sim.state.people, settlement.x, settlement.y);
}

/**
 * Asks until the roll lands, so the test is about the answer rather than the dice.
 */
function askUntilAnswered(sim: SimulationLoop, question: string, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const events = ask(sim.state, question);
    if (events.some((e) => (e.data as { answered?: boolean })?.answered)) return events;
  }
  return [];
}

describe('Reading what is being asked about', () => {
  it('names the topic behind an ordinary question', () => {
    const cases: [string, Topic][] = [
      ['ask about the tree', Topic.TREE],
      ['ask about the gallows', Topic.TREE],
      ['what do you know about the rites', Topic.RITES],
      ['ask about the vigils', Topic.RITES],
      ['ask about the roads', Topic.ROADS],
      ['ask about the villages', Topic.ROADS],
      ['ask about the country', Topic.THREATS],
      ['ask about the mark', Topic.MARK],
      ['ask about the church', Topic.CHURCH],
      ['ask about the choir', Topic.CHOIR],
      ['ask what is wrong here', Topic.THEM],
    ];

    for (const [question, topic] of cases) {
      expect(readTopic(question), question).toBe(topic);
    }
  });

  it('prefers the specific reading when a question could be two things', () => {
    // "the road to the tree" is about the tree; the tree is the rarer, sharper subject.
    expect(readTopic('ask about the road to the tree')).toBe(Topic.TREE);
  });

  it('says so when the question is not about anything the world holds', () => {
    expect(readTopic('ask about the price of fish in Norwich')).toBeNull();
  });

  it('routes a question through the vocabulary to the world', () => {
    const sim = new SimulationLoop('know-route');
    enterVillage(sim);

    const reading = interpret('ask about the tree', sim.state);
    expect(reading.kind).toBe('command');
    if (reading.kind === 'command') {
      expect(reading.command.type).toBe('ASK');
      // The whole line travels, because the topic is the answer's business.
      expect((reading.command as { text: string }).text).toContain('tree');
    }
  });
});

describe('What people will tell you', () => {
  it('has nobody to ask out in the country', () => {
    const sim = new SimulationLoop('know-alone');
    const events = ask(sim.state, 'ask about the tree');
    expect(events[0].type).toBe('error');
    expect(events[0].message).toContain('nobody here');
  });

  it('refuses a question it cannot make out, and says what can be asked', () => {
    const sim = new SimulationLoop('know-unclear');
    enterVillage(sim);

    const events = ask(sim.state, 'ask about the price of fish');
    expect(events[0].type).toBe('error');
    expect(events[0].message).toContain('the tree');
  });

  it('gives the bearing to the tree when it answers', () => {
    const sim = new SimulationLoop('know-tree');
    enterVillage(sim);

    const events = askUntilAnswered(sim, 'ask about the tree');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].message).toMatch(/north|south|east|west/);
  });

  it('puts a village it names onto the chart', () => {
    const sim = new SimulationLoop('know-roads');
    enterVillage(sim);

    const before = sim.state.settlements.filter(
      (s) => sim.state.map[s.y][s.x].explored
    ).length;

    const events = askUntilAnswered(sim, 'ask about the roads');
    if (events.length === 0) return;

    const after = sim.state.settlements.filter(
      (s) => sim.state.map[s.y][s.x].explored
    ).length;

    // Either it named somewhere new, or it said there is nowhere left to name.
    const namedSomewhere = events.some((e) => e.message.includes('on your chart now'));
    expect(namedSomewhere ? after > before : true).toBe(true);
  });

  it('a priest will tell you where a rite is kept, and it goes on the chart', () => {
    // Find a world whose first village has a priest in it.
    for (let i = 0; i < 30; i++) {
      const sim = new SimulationLoop(`know-rites-${i}`);
      const here = enterVillage(sim);
      if (!here.some((p) => p.role === Role.PRIEST)) continue;

      const hidden = sim.state.reckoning.vigils.filter(
        (v) => !sim.state.map[v.y][v.x].explored
      ).length;
      expect(hidden).toBeGreaterThan(0);

      const events = askUntilAnswered(sim, 'ask about the rites');
      if (events.length === 0) return;

      const stillHidden = sim.state.reckoning.vigils.filter(
        (v) => !sim.state.map[v.y][v.x].explored
      ).length;
      expect(stillHidden).toBeLessThan(hidden);
      return;
    }
  });

  it('runs on one social system rather than two', () => {
    // The difficulty of an answer must come from how the person takes you, which is what
    // the attitude system is for. An earlier version ran its own formula beside it.
    const dcFor = (disposition: number, trait: Trait): number => {
      const sim = new SimulationLoop('know-one-system');
      const here = enterVillage(sim);
      for (const person of here) {
        person.disposition = disposition;
        (person as { trait: Trait }).trait = trait;
      }

      const events = ask(sim.state, 'ask about the country');
      const roll = events[0].message.match(/vs DC (\d+)/);
      return roll ? Number(roll[1]) : 0;
    };

    // Somebody who is glad you came is easier work than somebody who wants you gone.
    expect(dcFor(80, Trait.FRIENDLY)).toBeLessThan(dcFor(-80, Trait.SUSPICIOUS));
    // And temperament tells even at the same standing.
    expect(dcFor(0, Trait.FRIENDLY)).toBeLessThan(dcFor(0, Trait.SUSPICIOUS));
  });

  it('answers the person the player actually addressed', () => {
    const sim = new SimulationLoop('know-address');
    const here = enterVillage(sim);
    if (here.length < 2) return;
    const target = here[here.length - 1];
    for (const person of here) person.disposition = 100;

    for (let i = 0; i < 30; i++) {
      const events = ask(sim.state, `ask ${target.name.split(' ')[0]} about the country`);
      if ((events[0].data as { answered?: boolean })?.answered) {
        expect(events[0].message).toContain(target.name);
        return;
      }
    }
  });

  it('speaks in the manner that person speaks in', () => {
    const sim = new SimulationLoop('know-manner');
    const here = enterVillage(sim);
    for (const person of here) person.disposition = 100;

    for (let i = 0; i < 40; i++) {
      const events = ask(sim.state, 'ask about the mark');
      if ((events[0].data as { answered?: boolean })?.answered) {
        const who = here.find((person) => events[0].message.includes(person.name));
        expect(who).toBeDefined();
        expect(events[0].message).toContain(who!.mannerism);
        return;
      }
    }
  });

  it('somebody who owes you their silence does not refuse you', () => {
    const sim = new SimulationLoop('know-owes');
    const here = enterVillage(sim);
    for (const person of here) {
      person.disposition = -90;
      person.owes = true;
    }

    let answered = 0;
    for (let i = 0; i < 40; i++) {
      if ((ask(sim.state, 'ask about the country')[0].data as { answered?: boolean })?.answered) {
        answered++;
      }
    }
    // Advantage on every roll, against people who would otherwise refuse outright.
    expect(answered).toBeGreaterThan(0);
  });

  it('is harder to get an answer out of somebody while the mark is burning', () => {
    const dcFor = (intensity: number): number => {
      const sim = new SimulationLoop('know-dc');
      enterVillage(sim);
      const mark = sim.state.entities.getComponent<MarkComponent>(
        sim.state.playerId,
        'mark'
      )!;
      mark.intensity = intensity;

      const events = ask(sim.state, 'ask about the country');
      const roll = events[0].message.match(/vs DC (\d+)/);
      return roll ? Number(roll[1]) : 0;
    };

    expect(dcFor(95)).toBeGreaterThan(dcFor(0));
  });

  it('costs an hour, and the clock rolls the day over properly', () => {
    const sim = new SimulationLoop('know-clock');
    enterVillage(sim);

    // Wind close to midnight, then ask across it.
    const startDay = sim.state.day;
    while (sim.state.hour !== 23) {
      sim.state.hour = (sim.state.hour + 1) % 24;
      sim.state.tick += 1;
    }

    const tickBefore = sim.state.tick;
    ask(sim.state, 'ask about the mark');

    expect(sim.state.tick).toBe(tickBefore + 1);
    expect(sim.state.hour).toBe(0);
    expect(sim.state.day).toBe(startDay + 1);
  });

  it('never leaves the day out of step with the tick', () => {
    const sim = new SimulationLoop('know-consistency');
    enterVillage(sim);

    for (let i = 0; i < 60; i++) ask(sim.state, 'ask about the mark');

    // The clock is a pure function of elapsed hours from the opening hour.
    const INITIAL_HOUR = 6;
    const elapsed = sim.state.tick;
    expect(sim.state.hour).toBe((INITIAL_HOUR + elapsed) % HOURS_PER_DAY);
    expect(sim.state.day).toBe(1 + Math.floor((INITIAL_HOUR + elapsed) / HOURS_PER_DAY));
  });

  it('never opens any line with a lower-case article', () => {
    const sim = new SimulationLoop('know-openings');
    enterVillage(sim);

    for (let i = 0; i < 80; i++) {
      for (const question of [
        'ask about the tree',
        'ask about the rites',
        'ask about the roads',
        'ask about the mark',
        'ask about the church',
        'ask about the choir',
        'ask about the country',
      ]) {
        for (const event of ask(sim.state, question)) {
          expect(event.message, question).not.toMatch(/^(the|a) [A-Z]/);
          expect(event.message, question).not.toMatch(/[.!?] (the|a) [A-Z]/);
        }
      }
    }
  });

  it('names the world in a way that can open a sentence', () => {
    const sim = new SimulationLoop('know-caps');
    enterVillage(sim);

    for (const question of ['ask about the mark', 'ask about the church', 'ask about the choir']) {
      const events = askUntilAnswered(sim, question);
      if (events.length === 0) continue;
      // No answer should open with a lower-case article inside its quotation.
      expect(events[0].message, question).not.toMatch(/: "the [A-Z]/);
    }
  });
});
