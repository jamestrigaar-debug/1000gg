import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/core/rng/SeededRNG';
import {
  parseDice,
  roll,
  rollExpression,
  rollCritical,
  averageOf,
  rangeOf,
  rollD20,
} from '../src/core/rules/Dice';
import {
  Ability,
  ABILITY_ORDER,
  abilityModifier,
  makeAbilityScores,
  modifierFor,
  proficiencyBonus,
  STANDARD_ARRAY,
} from '../src/core/rules/Abilities';
import { Skill, SKILL_ABILITY, describeCheck } from '../src/core/rules/Skills';
import {
  RollMode,
  CheckOutcome,
  DC,
  check,
  combineModes,
  resolveModes,
  gradeCheck,
  rollD20Mode,
  isAnySuccess,
  describeRoll,
  SETBACK_MARGIN,
} from '../src/core/rules/Check';
import {
  MAX_EXHAUSTION,
  checkModeFor,
  attackModeFor,
  hpMaxMultiplier,
  speedMultiplier,
  isFatal,
  clampExhaustion,
  EXHAUSTION_EFFECTS,
  EXHAUSTION_LINES,
} from '../src/core/rules/Exhaustion';
import {
  newDeathSaves,
  rollDeathSave,
  damageAtZero,
  isDead,
  DEATH_SAVE_FAILURES,
} from '../src/core/rules/DeathSaves';

describe('Dice', () => {
  it('parses the notations the catalog actually uses', () => {
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice('1d4+1')).toEqual({ count: 1, sides: 4, modifier: 1 });
    expect(parseDice('2d6')).toEqual({ count: 2, sides: 6, modifier: 0 });
    expect(parseDice('1d10')).toEqual({ count: 1, sides: 10, modifier: 0 });
    expect(parseDice(' 3d8 - 2 ')).toEqual({ count: 3, sides: 8, modifier: -2 });
  });

  it('refuses notation it cannot understand rather than guessing', () => {
    // A silently mis-parsed weapon would be a balance bug that is very hard to trace.
    expect(() => parseDice('sword')).toThrow();
    expect(() => parseDice('2x6')).toThrow();
    expect(() => parseDice('0d6')).toThrow();
  });

  it('rolls within the possible range, always', () => {
    const rng = new SeededRNG('dice-range');
    for (const notation of ['d20', '1d4+1', '2d6', '1d8', '1d10', '2d6+3']) {
      const expression = parseDice(notation);
      const { min, max } = rangeOf(expression);
      for (let i = 0; i < 500; i++) {
        const result = rollExpression(rng, expression);
        expect(result.total).toBeGreaterThanOrEqual(min);
        expect(result.total).toBeLessThanOrEqual(max);
        expect(result.dice).toHaveLength(expression.count);
      }
    }
  });

  it('converges on the expected average', () => {
    const rng = new SeededRNG('dice-average');
    const expression = parseDice('2d6+1');
    let sum = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i++) sum += rollExpression(rng, expression).total;
    expect(sum / samples).toBeCloseTo(averageOf(expression), 1);
  });

  it('a critical doubles the dice but not the modifier', () => {
    const rng = new SeededRNG('dice-crit');
    const expression = parseDice('1d4+3');
    for (let i = 0; i < 400; i++) {
      const result = rollCritical(rng, expression);
      expect(result.dice).toHaveLength(2);
      // 2d4+3, so between 5 and 11 -- not 2 x (1d4+3).
      expect(result.total).toBeGreaterThanOrEqual(5);
      expect(result.total).toBeLessThanOrEqual(11);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = new SeededRNG('dice-determinism');
    const b = new SeededRNG('dice-determinism');
    for (let i = 0; i < 200; i++) {
      expect(roll(a, '2d6+1')).toEqual(roll(b, '2d6+1'));
    }
  });

  it('d20 covers every face', () => {
    const rng = new SeededRNG('d20-coverage');
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) seen.add(rollD20(rng));
    expect(seen.size).toBe(20);
  });
});

describe('Abilities', () => {
  it('derives modifiers by the standard formula', () => {
    expect(abilityModifier(1)).toBe(-5);
    expect(abilityModifier(3)).toBe(-4);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(12)).toBe(1);
    expect(abilityModifier(15)).toBe(2);
    expect(abilityModifier(18)).toBe(4);
    expect(abilityModifier(20)).toBe(5);
    expect(abilityModifier(30)).toBe(10);
  });

  it('the standard array is six scores', () => {
    expect(STANDARD_ARRAY).toHaveLength(ABILITY_ORDER.length);
  });

  it('fills unspecified abilities with the human average', () => {
    const scores = makeAbilityScores({ [Ability.STR]: 16 });
    expect(scores.str).toBe(16);
    expect(scores.cha).toBe(10);
    expect(modifierFor(scores, Ability.STR)).toBe(3);
    expect(modifierFor(scores, Ability.CHA)).toBe(0);
  });

  it('proficiency rises by one every four levels', () => {
    expect(proficiencyBonus(1)).toBe(2);
    expect(proficiencyBonus(4)).toBe(2);
    expect(proficiencyBonus(5)).toBe(3);
    expect(proficiencyBonus(9)).toBe(4);
    expect(proficiencyBonus(17)).toBe(6);
  });
});

describe('Skills', () => {
  it('every skill is governed by an ability', () => {
    for (const skill of Object.values(Skill)) {
      expect(SKILL_ABILITY[skill]).toBeDefined();
    }
  });

  it('names a check the way a table would call for it', () => {
    expect(describeCheck(Skill.SURVIVAL)).toBe('Wisdom (Survival)');
    expect(describeCheck(Skill.INTIMIDATION)).toBe('Charisma (Intimidation)');
    expect(describeCheck(Skill.ATHLETICS)).toBe('Strength (Athletics)');
  });
});

describe('The d20 test', () => {
  it('rolls one die straight and two with advantage or disadvantage', () => {
    const rng = new SeededRNG('mode-dice');
    expect(rollD20Mode(rng, RollMode.NORMAL).dice).toHaveLength(1);
    expect(rollD20Mode(rng, RollMode.ADVANTAGE).dice).toHaveLength(2);
    expect(rollD20Mode(rng, RollMode.DISADVANTAGE).dice).toHaveLength(2);
  });

  it('advantage takes the higher die and disadvantage the lower', () => {
    const rng = new SeededRNG('mode-selection');
    for (let i = 0; i < 400; i++) {
      const adv = rollD20Mode(rng, RollMode.ADVANTAGE);
      expect(adv.natural).toBe(Math.max(...adv.dice));
      const dis = rollD20Mode(rng, RollMode.DISADVANTAGE);
      expect(dis.natural).toBe(Math.min(...dis.dice));
    }
  });

  it('advantage beats a straight roll, which beats disadvantage, on average', () => {
    const mean = (mode: RollMode) => {
      const rng = new SeededRNG(`mean-${mode}`);
      let sum = 0;
      for (let i = 0; i < 20000; i++) sum += rollD20Mode(rng, mode).natural;
      return sum / 20000;
    };
    const advantage = mean(RollMode.ADVANTAGE);
    const normal = mean(RollMode.NORMAL);
    const disadvantage = mean(RollMode.DISADVANTAGE);

    expect(advantage).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(disadvantage);
    // Known values: 13.825 with advantage, 10.5 straight, 7.175 with disadvantage.
    expect(advantage).toBeCloseTo(13.825, 0);
    expect(normal).toBeCloseTo(10.5, 0);
    expect(disadvantage).toBeCloseTo(7.175, 0);
  });

  it('advantage and disadvantage cancel, however many of each apply', () => {
    expect(combineModes(RollMode.ADVANTAGE, RollMode.DISADVANTAGE)).toBe(RollMode.NORMAL);
    expect(combineModes(RollMode.ADVANTAGE, RollMode.ADVANTAGE)).toBe(RollMode.ADVANTAGE);
    expect(combineModes(RollMode.NORMAL, RollMode.DISADVANTAGE)).toBe(RollMode.DISADVANTAGE);

    // Two sources of disadvantage and one of advantage still cancels to a straight roll.
    expect(
      resolveModes([RollMode.DISADVANTAGE, RollMode.DISADVANTAGE, RollMode.ADVANTAGE])
    ).toBe(RollMode.NORMAL);
    expect(resolveModes([RollMode.ADVANTAGE, RollMode.ADVANTAGE])).toBe(RollMode.ADVANTAGE);
    expect(resolveModes([])).toBe(RollMode.NORMAL);
  });

  it('never rolls more than two dice regardless of how many sources apply', () => {
    const rng = new SeededRNG('one-extra-die');
    const mode = resolveModes([RollMode.ADVANTAGE, RollMode.ADVANTAGE, RollMode.ADVANTAGE]);
    expect(rollD20Mode(rng, mode).dice.length).toBeLessThanOrEqual(2);
  });

  it('grades by margin, with the naturals decisive', () => {
    expect(gradeCheck(20, 21, 30)).toBe(CheckOutcome.CRITICAL_SUCCESS);
    expect(gradeCheck(1, 21, 5)).toBe(CheckOutcome.CRITICAL_FAILURE);
    expect(gradeCheck(10, 15, 15)).toBe(CheckOutcome.SUCCESS);
    expect(gradeCheck(10, 14, 15)).toBe(CheckOutcome.SETBACK);
    expect(gradeCheck(10, 15 - SETBACK_MARGIN, 15)).toBe(CheckOutcome.SETBACK);
    expect(gradeCheck(10, 15 - SETBACK_MARGIN - 1, 15)).toBe(CheckOutcome.FAILURE);
  });

  it('meeting the DC succeeds', () => {
    const rng = new SeededRNG('meets-dc');
    for (let i = 0; i < 500; i++) {
      const result = check(rng, 5, DC.MEDIUM);
      expect(result.success).toBe(result.total >= result.dc);
    }
  });

  it('a setback still counts as getting somewhere', () => {
    expect(isAnySuccess(CheckOutcome.SETBACK)).toBe(true);
    expect(isAnySuccess(CheckOutcome.FAILURE)).toBe(false);
  });

  it('describes a roll the way a table reads it aloud', () => {
    const rng = new SeededRNG('describe');
    const result = check(rng, 3, DC.EASY);
    expect(describeRoll(result)).toContain('vs DC 10');
    expect(describeRoll(result)).toContain('+3');
  });

  it('is deterministic for a given seed', () => {
    const a = new SeededRNG('check-determinism');
    const b = new SeededRNG('check-determinism');
    for (let i = 0; i < 200; i++) {
      expect(check(a, 2, DC.MEDIUM, RollMode.ADVANTAGE)).toEqual(
        check(b, 2, DC.MEDIUM, RollMode.ADVANTAGE)
      );
    }
  });
});

describe('Exhaustion', () => {
  it('has an effect and a line for every level', () => {
    expect(EXHAUSTION_EFFECTS).toHaveLength(MAX_EXHAUSTION + 1);
    expect(EXHAUSTION_LINES).toHaveLength(MAX_EXHAUSTION + 1);
  });

  it('bites at the levels the rules specify', () => {
    expect(checkModeFor(0)).toBe(RollMode.NORMAL);
    expect(checkModeFor(1)).toBe(RollMode.DISADVANTAGE);

    expect(speedMultiplier(1)).toBe(1);
    expect(speedMultiplier(2)).toBe(0.5);

    expect(attackModeFor(2)).toBe(RollMode.NORMAL);
    expect(attackModeFor(3)).toBe(RollMode.DISADVANTAGE);

    expect(hpMaxMultiplier(3)).toBe(1);
    expect(hpMaxMultiplier(4)).toBe(0.5);

    expect(speedMultiplier(5)).toBe(0);

    expect(isFatal(5)).toBe(false);
    expect(isFatal(6)).toBe(true);
  });

  it('effects accumulate: a higher level keeps every lower one', () => {
    // Level 4 must still carry the level 1 and level 2 penalties.
    expect(checkModeFor(4)).toBe(RollMode.DISADVANTAGE);
    expect(speedMultiplier(4)).toBe(0.5);
    expect(attackModeFor(4)).toBe(RollMode.DISADVANTAGE);
  });

  it('clamps to the valid range', () => {
    expect(clampExhaustion(-3)).toBe(0);
    expect(clampExhaustion(99)).toBe(MAX_EXHAUSTION);
  });
});

describe('Death saving throws', () => {
  it('three successes stabilise and three failures kill', () => {
    const rng = new SeededRNG('death-saves');
    let stabilised = 0;
    let died = 0;

    for (let run = 0; run < 400; run++) {
      const saves = newDeathSaves();
      for (let i = 0; i < 30; i++) {
        const result = rollDeathSave(rng, saves);
        if (result.outcome === 'stabilised') { stabilised++; break; }
        if (result.outcome === 'died') { died++; break; }
        if (result.outcome === 'revived') break;
      }
    }
    // Both endings must be reachable; neither may dominate absolutely.
    expect(stabilised).toBeGreaterThan(0);
    expect(died).toBeGreaterThan(0);
  });

  it('a natural 20 puts the character back up', () => {
    const saves = newDeathSaves();
    saves.failures = 2;
    // Find a seed whose next d20 is a 20, then confirm the revival clears the tally.
    for (let i = 0; i < 500; i++) {
      const rng = new SeededRNG(`revive-${i}`);
      const probe = new SeededRNG(`revive-${i}`);
      if (rollD20(probe) !== 20) continue;

      const result = rollDeathSave(rng, saves);
      expect(result.outcome).toBe('revived');
      expect(saves.failures).toBe(0);
      expect(saves.successes).toBe(0);
      return;
    }
    throw new Error('no seed produced a natural 20');
  });

  it('a natural 1 counts as two failures', () => {
    for (let i = 0; i < 500; i++) {
      const probe = new SeededRNG(`fumble-${i}`);
      if (rollD20(probe) !== 1) continue;

      const rng = new SeededRNG(`fumble-${i}`);
      const saves = newDeathSaves();
      rollDeathSave(rng, saves);
      expect(saves.failures).toBe(2);
      return;
    }
    throw new Error('no seed produced a natural 1');
  });

  it('damage at zero is a failed save, and a critical is two', () => {
    const saves = newDeathSaves();
    expect(damageAtZero(saves, false)).toBe(false);
    expect(saves.failures).toBe(1);

    expect(damageAtZero(saves, true)).toBe(true);
    expect(saves.failures).toBe(DEATH_SAVE_FAILURES);
    expect(isDead(saves)).toBe(true);
  });

  it('taking damage while stable starts the rolls again', () => {
    const saves = newDeathSaves();
    saves.stable = true;
    damageAtZero(saves, false);
    expect(saves.stable).toBe(false);
  });
});
