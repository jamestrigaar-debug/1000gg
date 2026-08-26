import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/core/rng/SeededRNG';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import {
  rollCheck,
  classifyTotal,
  isAnySuccess,
  hasComplication,
  CheckOutcome,
  OUTCOME_ORDER,
} from '../src/core/narrative/SkillCheck';
import { OracleEngine } from '../src/core/narrative/Oracle';
import { ORACLE_TABLES } from '../src/core/narrative/OracleTables';
import {
  rollBackground,
  describeBackground,
  ORIGINS,
  GOALS,
  BONDS,
  FLAWS,
  FlawTrigger,
} from '../src/core/narrative/Background';
import { flawModifier } from '../src/core/state/GameState';
import { getItem } from '../src/core/lore/Items';
import type { MarkComponent, StatsComponent } from '../src/core/ecs/Component';

describe('Skill checks', () => {
  it('classifies every total into exactly one band', () => {
    expect(classifyTotal(2)).toBe(CheckOutcome.CRITICAL_FAILURE);
    expect(classifyTotal(3)).toBe(CheckOutcome.FAILURE);
    expect(classifyTotal(5)).toBe(CheckOutcome.FAILURE);
    expect(classifyTotal(6)).toBe(CheckOutcome.PARTIAL);
    expect(classifyTotal(8)).toBe(CheckOutcome.PARTIAL);
    expect(classifyTotal(9)).toBe(CheckOutcome.SUCCESS);
    expect(classifyTotal(11)).toBe(CheckOutcome.SUCCESS);
    expect(classifyTotal(12)).toBe(CheckOutcome.CRITICAL_SUCCESS);
    expect(classifyTotal(99)).toBe(CheckOutcome.CRITICAL_SUCCESS);
  });

  it('rolls two six-sided dice and reports them honestly', () => {
    const rng = new SeededRNG('check-dice');
    for (let i = 0; i < 2000; i++) {
      const result = rollCheck(rng, 0);
      expect(result.dice[0]).toBeGreaterThanOrEqual(1);
      expect(result.dice[0]).toBeLessThanOrEqual(6);
      expect(result.dice[1]).toBeGreaterThanOrEqual(1);
      expect(result.dice[1]).toBeLessThanOrEqual(6);
      expect(result.total).toBe(result.dice[0] + result.dice[1]);
    }
  });

  it('applies the modifier to the total', () => {
    const a = new SeededRNG('check-modifier');
    const b = new SeededRNG('check-modifier');
    const plain = rollCheck(a, 0);
    const boosted = rollCheck(b, 3);
    expect(boosted.total).toBe(plain.total + 3);
  });

  it('is bell-shaped: middling, complicated results are the common case', () => {
    const rng = new SeededRNG('check-distribution');
    const counts = new Map<CheckOutcome, number>();
    const samples = 20000;

    for (let i = 0; i < samples; i++) {
      const { outcome } = rollCheck(rng, 0);
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    }

    // 2d6: partial (6-8) is the modal band, and the criticals are the rare tails.
    const partial = (counts.get(CheckOutcome.PARTIAL) ?? 0) / samples;
    const critFail = (counts.get(CheckOutcome.CRITICAL_FAILURE) ?? 0) / samples;

    expect(partial).toBeGreaterThan(0.35);
    expect(critFail).toBeLessThan(0.05);
    for (const outcome of OUTCOME_ORDER) {
      expect(counts.get(outcome) ?? 0).toBeGreaterThan(0);
    }
  });

  it('reports success and complication consistently', () => {
    expect(isAnySuccess(CheckOutcome.PARTIAL)).toBe(true);
    expect(isAnySuccess(CheckOutcome.FAILURE)).toBe(false);
    // A partial success is still a success that costs you something.
    expect(hasComplication(CheckOutcome.PARTIAL)).toBe(true);
    expect(hasComplication(CheckOutcome.SUCCESS)).toBe(false);
  });

  it('is deterministic for a given seed', () => {
    const a = new SeededRNG('check-determinism');
    const b = new SeededRNG('check-determinism');
    for (let i = 0; i < 100; i++) {
      expect(rollCheck(a, 1)).toEqual(rollCheck(b, 1));
    }
  });
});

describe('Oracle', () => {
  const oracle = new OracleEngine(ORACLE_TABLES);

  it('registers every Thornmarch table', () => {
    for (const table of ORACLE_TABLES) {
      expect(oracle.has(table.id)).toBe(true);
    }
  });

  it('every table covers its die with no gaps', () => {
    for (const table of ORACLE_TABLES) {
      for (let roll = 1; roll <= table.die; roll++) {
        const covering = table.entries.filter((e) => roll >= e.roll[0] && roll <= e.roll[1]);
        expect(covering.length, `${table.id} roll ${roll}`).toBe(1);
      }
    }
  });

  it('every entry carries narration', () => {
    for (const table of ORACLE_TABLES) {
      for (const entry of table.entries) {
        expect(entry.result.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeGreaterThan(0);
        expect(entry.roll[0]).toBeLessThanOrEqual(entry.roll[1]);
      }
    }
  });

  it('every entry offers more than one wording, and draws among them', () => {
    for (const table of ORACLE_TABLES) {
      for (const entry of table.entries) {
        expect(entry.variants?.length ?? 0).toBeGreaterThan(0);
      }
    }

    // A repeatedly rolled answer should not tell the same sentence every time.
    const engine = new OracleEngine(ORACLE_TABLES);
    const wordings = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const answer = engine.ask('twist', new SeededRNG(`twist-${i}`));
      wordings.add(answer!.narration);
    }
    expect(wordings.size).toBeGreaterThan(20);
  });

  it('narration is always one of the rolled entry\'s own wordings', () => {
    const engine = new OracleEngine(ORACLE_TABLES);
    for (let i = 0; i < 100; i++) {
      const answer = engine.ask('omen', new SeededRNG(`omen-${i}`))!;
      const allowed = [answer.entry.description, ...(answer.entry.variants ?? [])];
      expect(allowed).toContain(answer.narration);
    }
  });

  it('always answers a known table and never a missing one', () => {
    const rng = new SeededRNG('oracle-ask');
    for (let i = 0; i < 200; i++) {
      expect(oracle.ask('npc_reaction', rng)).not.toBeNull();
    }
    expect(oracle.ask('no_such_table', rng)).toBeNull();
  });

  it('clamps a modified roll back inside the table', () => {
    const rng = new SeededRNG('oracle-clamp');
    for (let i = 0; i < 200; i++) {
      const low = oracle.ask('npc_reaction', rng, -50)!;
      const high = oracle.ask('npc_reaction', rng, 50)!;
      expect(low.roll).toBeGreaterThanOrEqual(1);
      expect(high.roll).toBeLessThanOrEqual(20);
      expect(low.entry).toBeDefined();
      expect(high.entry).toBeDefined();
    }
  });

  it('is deterministic for a given seed', () => {
    const a = new SeededRNG('oracle-determinism');
    const b = new SeededRNG('oracle-determinism');
    for (let i = 0; i < 50; i++) {
      expect(oracle.ask('twist', a)).toEqual(oracle.ask('twist', b));
    }
  });
});

describe('Character background', () => {
  it('deals one of each and renders four lines', () => {
    const rng = new SeededRNG('background');
    const background = rollBackground(rng);

    expect(ORIGINS).toContain(background.origin);
    expect(GOALS).toContain(background.goal);
    expect(BONDS).toContain(background.bond);
    expect(FLAWS).toContain(background.flaw);
    expect(describeBackground(background)).toHaveLength(4);
  });

  it('every origin grants items that exist in the catalog', () => {
    for (const origin of ORIGINS) {
      expect(origin.startingItems.length).toBeGreaterThan(0);
      for (const itemId of origin.startingItems) {
        expect(getItem(itemId), `${origin.id} grants missing item ${itemId}`).toBeDefined();
      }
    }
  });

  it('every flaw is a penalty, not a bonus', () => {
    for (const flaw of FLAWS) {
      expect(flaw.modifier).toBeLessThan(0);
      expect(Object.values(FlawTrigger)).toContain(flaw.trigger);
    }
  });

  it('is dealt at embark and narrated in the opening', () => {
    const sim = new SimulationLoop('background-embark');
    expect(sim.state.background).not.toBeNull();

    const opening = sim.state.log.map((e) => e.message).join(' ');
    expect(opening).toContain(sim.state.background!.origin.line);
    expect(opening).toContain(sim.state.background!.flaw.line);
  });

  it('the same seed deals the same character', () => {
    const a = new SimulationLoop('background-determinism');
    const b = new SimulationLoop('background-determinism');
    expect(a.state.background).toEqual(b.state.background);
  });
});

describe('Flaws bite only under their trigger', () => {
  it('costs nothing on an empty road and something once engaged', () => {
    const sim = new SimulationLoop('flaw-engaged');
    sim.state.background = {
      ...sim.state.background!,
      flaw: FLAWS.find((f) => f.trigger === FlawTrigger.ENGAGED)!,
    };

    expect(sim.state.encounterId).toBeNull();
    expect(flawModifier(sim.state)).toBe(0);

    sim.state.encounterId = 999;
    expect(flawModifier(sim.state)).toBeLessThan(0);
  });

  it('bites when wounded below half', () => {
    const sim = new SimulationLoop('flaw-wounded');
    sim.state.background = {
      ...sim.state.background!,
      flaw: FLAWS.find((f) => f.trigger === FlawTrigger.WOUNDED)!,
    };

    const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;
    stats.hp = stats.maxHp;
    expect(flawModifier(sim.state)).toBe(0);

    stats.hp = stats.maxHp / 4;
    expect(flawModifier(sim.state)).toBeLessThan(0);
  });

  it('bites when the Mark is burning', () => {
    const sim = new SimulationLoop('flaw-mark');
    sim.state.background = {
      ...sim.state.background!,
      flaw: FLAWS.find((f) => f.trigger === FlawTrigger.MARK_BURNING)!,
    };

    const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;
    mark.intensity = 0;
    expect(flawModifier(sim.state)).toBe(0);

    mark.intensity = 90;
    expect(flawModifier(sim.state)).toBeLessThan(0);
  });

  it('a state with no background owes nothing', () => {
    const sim = new SimulationLoop('flaw-none');
    sim.state.background = null;
    expect(flawModifier(sim.state)).toBe(0);
  });
});

describe('Narrative combat stances', () => {
  /**
   * Waits in the open until something engages, topping up needs so the character
   * cannot starve while waiting.
   */
  function provoke(seed: string): SimulationLoop | null {
    const sim = new SimulationLoop(seed);
    for (let i = 0; i < 500 && sim.state.encounterId === null; i++) {
      const stats = sim.state.entities.getComponent<StatsComponent>(sim.state.playerId, 'stats')!;
      stats.hunger = 0;
      stats.thirst = 0;
      stats.fatigue = 0;
      sim.submitCommand({ type: 'REST', hours: 4 });
    }
    return sim.state.encounterId !== null ? sim : null;
  }

  it('feinting resolves and produces narration', () => {
    const sim = provoke('stance-feint');
    expect(sim).not.toBeNull();

    const before = sim!.state.log.length;
    sim!.submitCommand({ type: 'FEINT' });
    const emitted = sim!.state.log.slice(before);

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.some((e) => e.data?.stance === 'feint')).toBe(true);
  });

  it('the dead cannot be frightened off', () => {
    const sim = provoke('stance-intimidate');
    expect(sim).not.toBeNull();

    const before = sim!.state.log.length;
    sim!.submitCommand({ type: 'INTIMIDATE' });
    const emitted = sim!.state.log.slice(before);
    const attempt = emitted.find((e) => e.data?.stance === 'intimidate');

    expect(attempt).toBeDefined();
    // Either it was immune, or it was a living thing that could be threatened.
    if (attempt!.data?.immune === true) {
      expect(sim!.state.encounterId).not.toBeNull();
    }
  });

  it('combat commands are still refused with nothing to fight', () => {
    const sim = new SimulationLoop('stance-idle');
    const before = sim.state.log.length;
    sim.submitCommand({ type: 'FEINT' });
    sim.submitCommand({ type: 'INTIMIDATE' });

    const emitted = sim.state.log.slice(before);
    expect(emitted.every((e) => e.type === 'error')).toBe(true);
  });
});
