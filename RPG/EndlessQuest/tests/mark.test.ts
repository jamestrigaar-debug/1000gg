import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../src/core/simulation/SimulationLoop';
import { markBand } from '../src/core/simulation/systems/MarkSystem';
import { hourlyEncounterProbability } from '../src/core/simulation/systems/EncounterSystem';
import { DayPhase, getDayPhase, getSeason, isDaylight } from '../src/core/world/TimeOfDay';
import type { MarkComponent } from '../src/core/ecs/Component';
import {
  MARK_BAND_THRESHOLDS,
  MARK_MAX,
  ENCOUNTER_MAX_HOURLY_PROBABILITY,
} from '../src/core/SimulationConstants';

describe('Day/night classification', () => {
  it('assigns each hour to the expected phase', () => {
    expect(getDayPhase(0)).toBe(DayPhase.NIGHT);
    expect(getDayPhase(6)).toBe(DayPhase.DAWN);
    expect(getDayPhase(12)).toBe(DayPhase.DAY);
    expect(getDayPhase(19)).toBe(DayPhase.DUSK);
    expect(getDayPhase(23)).toBe(DayPhase.NIGHT);
  });

  it('treats dawn and day as daylight and dusk and night as dark', () => {
    expect(isDaylight(DayPhase.DAWN)).toBe(true);
    expect(isDaylight(DayPhase.DAY)).toBe(true);
    expect(isDaylight(DayPhase.DUSK)).toBe(false);
    expect(isDaylight(DayPhase.NIGHT)).toBe(false);
  });

  it('maps days onto the four Thornmarch seasons', () => {
    expect(getSeason(1)).toBe('Thaw');
    expect(getSeason(91)).toBe('High Sun');
    expect(getSeason(181)).toBe('Rot');
    expect(getSeason(271)).toBe('Hard Dark');
  });
});

describe('MarkSystem', () => {
  it('the Mark rises once darkness falls', () => {
    const sim = new SimulationLoop('mark-rise');
    const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;
    expect(mark.intensity).toBe(0);

    // Start hour is 6; resting 16 hours carries the player through dusk into night.
    sim.submitCommand({ type: 'REST', hours: 16 });

    expect(sim.state.hour).toBe(22);
    expect(mark.intensity).toBeGreaterThan(0);
  });

  it('the Mark cools across a window of pure daylight', () => {
    const sim = new SimulationLoop('mark-fall');
    const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;

    // Start the Mark hot so there is room to fall, then spend hours 7 through 16 --
    // dawn and full day, no dusk or night -- inside the opening grace period, so no
    // encounter can interrupt the rest and confound the measurement.
    mark.intensity = 60;
    sim.submitCommand({ type: 'REST', hours: 10 });

    expect(sim.state.hour).toBe(16);
    expect(sim.state.encounterId).toBeNull();
    expect(mark.intensity).toBeLessThan(60);
  });

  it('a full day/night cycle nets upward, so standing still is not safety', () => {
    const sim = new SimulationLoop('mark-escalation');
    const mark = sim.state.entities.getComponent<MarkComponent>(sim.state.playerId, 'mark')!;

    sim.submitCommand({ type: 'REST', hours: 12 });
    const afterFirstEvening = mark.intensity;

    sim.submitCommand({ type: 'REST', hours: 24 });

    expect(mark.intensity).toBeGreaterThan(afterFirstEvening);
  });

  it('bands are ordered and cover the full intensity range', () => {
    expect(markBand(0)).toBe(0);
    expect(markBand(MARK_MAX)).toBe(MARK_BAND_THRESHOLDS.length - 1);

    for (let i = 1; i < MARK_BAND_THRESHOLDS.length; i++) {
      expect(markBand(MARK_BAND_THRESHOLDS[i])).toBe(i);
      expect(markBand(MARK_BAND_THRESHOLDS[i] - 0.001)).toBe(i - 1);
    }
  });
});

describe('Encounter rate function', () => {
  it('never decreases as the Mark intensifies', () => {
    let previous = -1;
    for (let intensity = 0; intensity <= MARK_MAX; intensity += 5) {
      const p = hourlyEncounterProbability(intensity, DayPhase.NIGHT, false);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });

  it('increases strictly while below the hourly cap', () => {
    // Above the cap the curve deliberately plateaus so that no hour is ever a
    // certainty; below it, more Mark must always mean more danger.
    let previous = -1;
    for (let intensity = 0; intensity <= MARK_MAX; intensity += 5) {
      const p = hourlyEncounterProbability(intensity, DayPhase.NIGHT, false);
      if (p >= ENCOUNTER_MAX_HOURLY_PROBABILITY) break;
      expect(p).toBeGreaterThan(previous);
      previous = p;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it('is capped so that no single hour is a certainty', () => {
    const p = hourlyEncounterProbability(MARK_MAX, DayPhase.NIGHT, false);
    expect(p).toBeLessThanOrEqual(ENCOUNTER_MAX_HOURLY_PROBABILITY);
    expect(p).toBeLessThan(1);
  });

  it('stays a valid probability across the whole domain', () => {
    for (const phase of Object.values(DayPhase)) {
      for (const sanctuary of [true, false]) {
        for (let intensity = 0; intensity <= MARK_MAX; intensity += 10) {
          const p = hourlyEncounterProbability(intensity, phase, sanctuary);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('night is more dangerous than day, and sanctuary is safer than open ground', () => {
    const night = hourlyEncounterProbability(50, DayPhase.NIGHT, false);
    const day = hourlyEncounterProbability(50, DayPhase.DAY, false);
    const sanctuary = hourlyEncounterProbability(50, DayPhase.NIGHT, true);

    expect(night).toBeGreaterThan(day);
    expect(sanctuary).toBeLessThan(night);
  });
});
