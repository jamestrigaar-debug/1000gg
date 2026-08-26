import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { interpret, nearlyTheSame } from '../src/core/narrative/Interpreter';
import { ACTIONS, availableActions } from '../src/core/narrative/Actions';
import { Skill } from '../src/core/rules/Skills';
import type { InventoryComponent, MarkComponent, StatsComponent } from '../src/core/ecs/Component';

/**
 * Reads a line against a fresh world.
 */
function read(sim: SimulationLoop, said: string) {
  return interpret(said, sim.state);
}

describe('Reading what the player meant', () => {
  it('takes the many ways people say a direction', () => {
    const sim = new SimulationLoop('interpret-move');

    for (const said of ['north', 'go north', 'head north', 'walk north', 'n', 'travel north']) {
      const reading = read(sim, said);
      expect(reading.kind, said).toBe('command');
      if (reading.kind === 'command') {
        expect(reading.command).toEqual({ type: 'MOVE', direction: 'north' });
      }
    }
  });

  it('hears how long the player means to rest', () => {
    const sim = new SimulationLoop('interpret-rest');

    const short = read(sim, 'rest');
    expect(short.kind === 'command' && short.command).toEqual({ type: 'REST', hours: 1 });

    const night = read(sim, 'sleep until morning');
    expect(night.kind === 'command' && night.command).toEqual({ type: 'REST', hours: 8 });

    const counted = read(sim, 'wait 6 hours');
    expect(counted.kind === 'command' && counted.command).toEqual({ type: 'REST', hours: 6 });

    // Longer than a day is not a thing that happens.
    const silly = read(sim, 'sleep for 400 hours');
    expect(silly.kind === 'command' && silly.command).toEqual({ type: 'REST', hours: 24 });
  });

  it('matches what the player calls a thing against what they are carrying', () => {
    const sim = new SimulationLoop('interpret-items');
    const inventory = sim.state.entities.getComponent<InventoryComponent>(
      sim.state.playerId,
      'inventory'
    )!;
    inventory.items = { stale_bread: 1, waterskin: 1 };

    const bread = read(sim, 'eat the bread');
    expect(bread.kind === 'command' && bread.command).toEqual({
      type: 'CONSUME',
      item: 'stale_bread',
    });

    const drink = read(sim, 'drink from the waterskin');
    expect(drink.kind === 'command' && drink.command).toEqual({
      type: 'CONSUME',
      item: 'waterskin',
    });
  });

  it('says so plainly when the thing asked for is not carried', () => {
    const sim = new SimulationLoop('interpret-missing');
    const inventory = sim.state.entities.getComponent<InventoryComponent>(
      sim.state.playerId,
      'inventory'
    )!;
    inventory.items = {};

    expect(read(sim, 'eat the venison').kind).toBe('unclear');
  });

  it('reads the words differently once something is on you', () => {
    const sim = new SimulationLoop('interpret-combat');

    // Striking is always read as striking; with nothing to fight the world says so
    // itself rather than pretending not to have understood.
    const idle = read(sim, 'strike at it');
    expect(idle.kind === 'command' && idle.command).toEqual({ type: 'ATTACK' });

    sim.state.encounterId = 999;
    const strike = read(sim, 'strike at it');
    expect(strike.kind === 'command' && strike.command).toEqual({ type: 'ATTACK' });

    const run = read(sim, 'run for it');
    expect(run.kind === 'command' && run.command).toEqual({ type: 'FLEE' });
  });

  it('reads an attempt onto the skill it actually calls for', () => {
    const sim = new SimulationLoop('interpret-intent');

    const cases: [string, Skill][] = [
      ['climb the wall', Skill.ATHLETICS],
      ['sneak past them', Skill.STEALTH],
      ['listen at the door', Skill.PERCEPTION],
      ['bind my leg', Skill.MEDICINE],
      ['pray for it to stop', Skill.RELIGION],
      ['beg them for bread', Skill.PERSUASION],
      ['lie about where I came from', Skill.DECEPTION],
      ['set a snare', Skill.SURVIVAL],
    ];

    for (const [said, skill] of cases) {
      const reading = read(sim, said);
      expect(reading.kind, said).toBe('improvise');
      if (reading.kind === 'improvise') expect(reading.skill, said).toBe(skill);
    }
  });

  it('asks rather than corrects when it cannot read the line', () => {
    const sim = new SimulationLoop('interpret-unclear');

    const reading = read(sim, 'asdfgh qwerty');
    expect(reading.kind).toBe('unclear');
    if (reading.kind === 'unclear') expect(reading.message.length).toBeGreaterThan(0);
  });

  it('does nothing, harmlessly, with an empty line', () => {
    const sim = new SimulationLoop('interpret-empty');
    expect(read(sim, '   ').kind).toBe('unclear');
  });
});

describe('The declared vocabulary', () => {
  it('can read back every phrasing it advertises', () => {
    const sim = new SimulationLoop('vocabulary');
    // The palette hands the player these exact lines. If the ear cannot hear one of
    // them, the interface is advertising something the world does not understand.
    const inventory = sim.state.entities.getComponent<InventoryComponent>(
      sim.state.playerId,
      'inventory'
    )!;
    inventory.items = { stale_bread: 1, hunting_knife: 1 };

    for (const action of ACTIONS) {
      const example = action.example ?? action.verbs[0];
      const reading = interpret(example, sim.state);

      expect(reading.kind, `${action.id}: "${example}"`).not.toBe('unclear');
      if (reading.kind !== 'unclear') {
        expect(reading.action.id, `"${example}" should mean ${action.id}`).toBe(action.id);
      }
    }
  });

  it('has a way to answer every action it declares', () => {
    for (const action of ACTIONS) {
      const answerable =
        action.command !== undefined ||
        action.skill !== undefined ||
        action.uiEvent !== undefined;
      expect(answerable, `${action.id} has no way to resolve`).toBe(true);
      expect(action.verbs.length, action.id).toBeGreaterThan(0);
      expect(action.summary.length, action.id).toBeGreaterThan(0);
    }
  });

  it('offers only what the moment allows', () => {
    const sim = new SimulationLoop('vocabulary-context');

    const idle = availableActions(sim.state).map((a) => a.id);
    expect(idle).toContain('go');
    expect(idle).not.toContain('attack');
    expect(idle).not.toContain('vigil');
    expect(idle).not.toContain('reckon');

    sim.state.encounterId = 42;
    const fighting = availableActions(sim.state).map((a) => a.id);
    expect(fighting).toContain('attack');
    expect(fighting).toContain('flee');
    expect(fighting).not.toContain('go');

    sim.state.encounterId = null;
    const pos = sim.state.entities.getComponent(sim.state.playerId, 'position')!;
    pos.x = sim.state.reckoning.treeX;
    pos.y = sim.state.reckoning.treeY;
    expect(availableActions(sim.state).map((a) => a.id)).toContain('reckon');
  });

  it('reads a whole phrasing before it reads its first word', () => {
    const sim = new SimulationLoop('vocabulary-phrases');

    // Both of these lead with a verb that belongs to a different action entirely.
    const quiet = interpret('go quiet and keep low', sim.state);
    expect(quiet.kind === 'improvise' && quiet.skill).toBe(Skill.STEALTH);

    const camp = interpret('make camp', sim.state);
    expect(camp.kind === 'command' && camp.command.type).toBe('REST');

    const wound = interpret('see to the wound', sim.state);
    expect(wound.kind === 'improvise' && wound.skill).toBe(Skill.MEDICINE);
  });

  it('finds what was meant through a typo', () => {
    const sim = new SimulationLoop('vocabulary-typos');

    for (const [typed, wanted] of [
      ['clmib the ridge', 'climb'],
      ['sneek past them', 'sneak'],
      ['exmaine the cairn', 'examine'],
    ] as const) {
      const reading = interpret(typed, sim.state);
      if (reading.kind === 'unclear') {
        expect(
          reading.suggestions.some((a) => a.verbs.includes(wanted)),
          `${typed} should suggest ${wanted}`
        ).toBe(true);
      } else {
        expect(reading.action.verbs, typed).toContain(wanted);
      }
    }
  });

  it('never refuses without offering something', () => {
    const sim = new SimulationLoop('vocabulary-refusal');

    const reading = interpret('xyzzy plugh', sim.state);
    expect(reading.kind).toBe('unclear');
    if (reading.kind === 'unclear') {
      expect(reading.suggestions.length).toBeGreaterThan(0);
    }
  });

  it('knows a transposition from two different letters', () => {
    expect(nearlyTheSame('climb', 'clmib')).toBe(true);
    expect(nearlyTheSame('climb', 'climb')).toBe(true);
    expect(nearlyTheSame('climb', 'climbs')).toBe(true);
    expect(nearlyTheSame('climb', 'blimp')).toBe(false);
    expect(nearlyTheSame('go', 'do')).toBe(false);
  });
});

describe('Adjudicating what nobody planned for', () => {
  it('costs an hour and resolves as a check of the skill it called for', () => {
    const sim = new SimulationLoop('improvise-basic');
    const before = sim.state.tick;

    sim.submitCommand({
      type: 'IMPROVISE',
      text: 'climb the ridge',
      skill: Skill.ATHLETICS,
      hard: false,
    });

    expect(sim.state.tick).toBeGreaterThan(before);
    const entry = sim.state.log.find((e) => (e.data as { improvised?: string })?.improvised);
    expect(entry?.message).toMatch(/Strength \(Athletics\)/);
  });

  it('spends a success on the world rather than only narrating it', () => {
    // Going to ground successfully should cool the Mark, so try it until it lands.
    let cooled = false;

    for (let i = 0; i < 40 && !cooled; i++) {
      const sim = new SimulationLoop(`improvise-stealth-${i}`);
      const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;
      mark.intensity = 50;

      sim.submitCommand({
        type: 'IMPROVISE',
        text: 'go to ground',
        skill: Skill.STEALTH,
        hard: false,
      });

      if (mark.intensity < 50) cooled = true;
    }

    expect(cooled).toBe(true);
  });

  it('gets harder as the Mark burns', () => {
    const dcFor = (intensity: number): number => {
      const sim = new SimulationLoop('improvise-dc');
      const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;
      mark.intensity = intensity;

      sim.submitCommand({
        type: 'IMPROVISE',
        text: 'try it',
        skill: Skill.ATHLETICS,
        hard: false,
      });

      const entry = sim.state.log.find((e) => (e.data as { dc?: number })?.dc !== undefined);
      return (entry?.data as { dc: number }).dc;
    };

    expect(dcFor(95)).toBeGreaterThan(dcFor(0));
  });

  it('lets the character try something mid-fight, and the thing answers', () => {
    const sim = new SimulationLoop('improvise-combat');
    const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;

    // Wait until something comes.
    for (let i = 0; i < 500 && sim.state.encounterId === null && !sim.state.gameOver; i++) {
      stats.hunger = 0;
      stats.thirst = 0;
      stats.hp = stats.maxHp;
      sim.submitCommand({ type: 'REST', hours: 2 });
    }
    expect(sim.state.encounterId).not.toBeNull();

    const roundBefore = sim.state.encounterRound;
    const tickBefore = sim.state.tick;

    sim.submitCommand({
      type: 'IMPROVISE',
      text: 'throw grit in its eyes',
      skill: Skill.DECEPTION,
      hard: false,
    });

    // The round is the cost, not the hour.
    expect(sim.state.tick).toBe(tickBefore);
    expect(sim.state.encounterRound).toBeGreaterThan(roundBefore);
  });
});
