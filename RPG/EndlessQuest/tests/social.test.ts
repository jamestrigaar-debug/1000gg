import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import {
  addressee,
  pressPerson,
  Attitude,
  ATTITUDE_ORDER,
  attitudeOf,
  conversationDC,
  shiftAttitude,
  readPerson,
  appealTo,
} from '../src/core/narrative/Social';
import { MANNERISMS, Trait, TRAIT_MODIFIER, peopleAt } from '../src/core/world/People';
import { serializeGameState, deserializeGameState } from '../src/core/state/SaveGame';
import type { MarkComponent, PositionComponent } from '../src/core/ecs/Component';

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

describe('People are individuals', () => {
  it('does not put two people of the same name in one village', () => {
    for (let seed = 0; seed < 20; seed++) {
      const sim = new SimulationLoop(`social-names-${seed}`);
      for (const settlement of sim.state.settlements) {
        const here = peopleAt(sim.state.people, settlement.x, settlement.y);
        const names = new Set(here.map((p) => p.name));
        expect(names.size, `${settlement.name} has a repeated name`).toBe(here.length);
      }
    }
  });


  it('gives everybody a manner, a belief, a bond and something to hide', () => {
    const sim = new SimulationLoop('social-people');

    for (const person of sim.state.people) {
      expect(Object.values(Trait), person.name).toContain(person.trait);
      expect(person.mannerism.length).toBeGreaterThan(0);
      expect(person.ideal.length).toBeGreaterThan(0);
      expect(person.bond.length).toBeGreaterThan(0);
      expect(person.secret.length).toBeGreaterThan(0);
      expect(person.read).toBe(false);
    }
  });

  it('writes every mannerism so it fits both sentences it is dropped into', () => {
    // Used as "They talk ___." and as "speaking ___:", so each has to be an adverbial
    // phrase. A clause with a finite verb in it breaks one or the other.
    for (const mannerism of MANNERISMS) {
      expect(mannerism, mannerism).not.toMatch(/^and (then )?\w+s\b/);
      expect(mannerism, mannerism).not.toMatch(/^(speaks|talks|says)\b/);
      expect(mannerism.length).toBeGreaterThan(8);
    }
  });

  it('is the same person in the same village for a given seed', () => {
    const a = new SimulationLoop('social-seed');
    const b = new SimulationLoop('social-seed');
    expect(b.state.people.map((p) => `${p.trait}${p.ideal}${p.secret}`)).toEqual(
      a.state.people.map((p) => `${p.trait}${p.ideal}${p.secret}`)
    );
  });
});

describe('Attitude', () => {
  it('runs hostile, indifferent, friendly, in that order', () => {
    expect(ATTITUDE_ORDER).toEqual([Attitude.HOSTILE, Attitude.INDIFFERENT, Attitude.FRIENDLY]);
  });

  it('shifts a step without falling off either end', () => {
    expect(shiftAttitude(Attitude.INDIFFERENT, 1)).toBe(Attitude.FRIENDLY);
    expect(shiftAttitude(Attitude.INDIFFERENT, -1)).toBe(Attitude.HOSTILE);
    expect(shiftAttitude(Attitude.FRIENDLY, 5)).toBe(Attitude.FRIENDLY);
    expect(shiftAttitude(Attitude.HOSTILE, -5)).toBe(Attitude.HOSTILE);
  });

  it('sets what a request has to beat, the way the source does', () => {
    expect(conversationDC(Attitude.FRIENDLY, 15)).toBeLessThan(conversationDC(Attitude.INDIFFERENT, 15));
    expect(conversationDC(Attitude.HOSTILE, 15)).toBeGreaterThan(conversationDC(Attitude.INDIFFERENT, 15));
  });

  it('costs a step of goodwill to walk in with the mark burning', () => {
    const sim = new SimulationLoop('social-mark');
    const [person] = enterVillage(sim);
    person.disposition = 40;
    person.read = false;

    const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;
    mark.intensity = 0;
    const cold = attitudeOf(sim.state, person);

    mark.intensity = 100;
    const burning = attitudeOf(sim.state, person);

    expect(ATTITUDE_ORDER.indexOf(burning)).toBeLessThan(ATTITUDE_ORDER.indexOf(cold));
  });

  it('a suspicious man is harder work than a friendly one', () => {
    expect(TRAIT_MODIFIER[Trait.SUSPICIOUS]).toBeLessThan(TRAIT_MODIFIER[Trait.FRIENDLY]);
  });
});

describe('Addressing a particular person', () => {
  it('answers to a first name, a byname, a trade, and a possessive', () => {
    const sim = new SimulationLoop('address');
    const here = enterVillage(sim);
    const target = here[here.length - 1];
    const [given, byname] = target.name.split(' ');

    expect(addressee(sim.state, `talk to ${given}`)?.id).toBe(target.id);
    expect(addressee(sim.state, `talk to ${byname}`)?.id).toBe(target.id);
    // A possessive must not hide the name inside it.
    expect(addressee(sim.state, `take ${given}'s measure`)?.id).toBe(target.id);
    // Trades resolve too, when only one person holds that trade here.
    const soleTrade = here.find(
      (person) => here.filter((other) => other.role === person.role).length === 1
    );
    if (soleTrade) {
      expect(addressee(sim.state, `ask the ${soleTrade.role} about the roads`)?.id).toBe(
        soleTrade.id
      );
    }
  });

  it('falls back to the caller\u2019s preference when nobody is named', () => {
    const sim = new SimulationLoop('address-default');
    const here = enterVillage(sim);
    for (const person of here) person.read = true;
    here[here.length - 1].read = false;

    expect(addressee(sim.state, 'take their measure', (p) => !p.read)?.id).toBe(
      here[here.length - 1].id
    );
  });

  it('has nobody to address out in the country', () => {
    const sim = new SimulationLoop('address-empty');
    expect(addressee(sim.state, 'talk to the priest')).toBeUndefined();
  });
});

describe('Pressing somebody with what they are hiding', () => {
  it('cannot be bluffed without having read them', () => {
    const sim = new SimulationLoop('press-bluff');
    const here = enterVillage(sim);
    for (const person of here) person.read = false;

    const events = pressPerson(sim.state);
    expect((events[0].data as { bluffed?: boolean }).bluffed).toBe(true);
    expect(here.some((p) => p.pressed)).toBe(false);
  });

  it('works, costs the relationship, and buys their help', () => {
    const sim = new SimulationLoop('press-works');
    const [person] = enterVillage(sim);
    person.read = true;
    person.disposition = 0;

    const events = pressPerson(sim.state, person.name);

    expect((events[0].data as { pressed?: boolean }).pressed).toBe(true);
    expect(person.disposition).toBeLessThan(0);
    // Fear buys compliance even as it costs goodwill; that is the trade.
    expect(person.owes).toBe(true);
    expect(events[0].message).toContain(person.secret);
  });

  it('only works once on the same person', () => {
    const sim = new SimulationLoop('press-once');
    const [person] = enterVillage(sim);
    person.read = true;

    pressPerson(sim.state, person.name);
    const again = pressPerson(sim.state, person.name);

    expect((again[0].data as { spent?: boolean }).spent).toBe(true);
  });
});

describe('Reading somebody, and using it', () => {
  it('has nobody to read out in the country', () => {
    const sim = new SimulationLoop('social-alone');
    expect(readPerson(sim.state)[0].type).toBe('error');
    expect(appealTo(sim.state)[0].type).toBe('error');
  });

  it('learns what somebody holds to, and remembers it', () => {
    const sim = new SimulationLoop('social-read');
    const [person] = enterVillage(sim);

    for (let i = 0; i < 40 && !person.read; i++) sim.submitCommand({ type: 'READ' });

    expect(person.read).toBe(true);
    expect(sim.state.log.some((e) => e.message.includes(person.ideal))).toBe(true);
  });

  it('appealing blind is worse than not trying', () => {
    const sim = new SimulationLoop('social-blind');
    const here = enterVillage(sim);
    for (const person of here) person.read = false;

    const events = appealTo(sim.state);
    expect(events[0].message).toContain('guess wrong');
    expect((events[0].data as { blind?: boolean }).blind).toBe(true);
  });

  it('appealing to what you have read moves them', () => {
    const sim = new SimulationLoop('social-appeal');
    const [person] = enterVillage(sim);
    person.read = true;
    const before = person.disposition;

    for (let i = 0; i < 40; i++) {
      const events = appealTo(sim.state);
      if ((events[0].data as { appealed?: boolean })?.appealed) {
        expect(person.disposition).toBeGreaterThan(before);
        return;
      }
      person.disposition = before;
    }
  });

  it('carries what was learned across a save', () => {
    const sim = new SimulationLoop('social-save');
    const [person] = enterVillage(sim);
    person.read = true;
    person.disposition = 20;

    const restored = deserializeGameState(
      JSON.parse(JSON.stringify(serializeGameState(sim.state)))
    );

    const same = restored.people.find((p) => p.id === person.id)!;
    expect(same.read).toBe(true);
    expect(same.disposition).toBe(20);
    // The person themselves still comes from the seed.
    expect(same.ideal).toBe(person.ideal);
    expect(same.trait).toBe(person.trait);
  });

  it('never opens a sentence with a lower-case article', () => {
    const sim = new SimulationLoop('social-caps');
    const [person] = enterVillage(sim);
    person.read = true;

    for (let i = 0; i < 30; i++) {
      const events = appealTo(sim.state);
      for (const event of events) {
        expect(event.message).not.toMatch(/\. the [a-z]/);
      }
    }
  });
});
