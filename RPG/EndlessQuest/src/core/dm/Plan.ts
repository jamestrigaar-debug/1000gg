import type { Instance } from './Instance';
import { Intent, Tide } from './Blackboard';
import type { Blackboard } from './Blackboard';
import { PLAN_DRAMA_FLOOR } from '../SimulationConstants';

/**
 * The Dungeon Master's own plans.
 *
 * A planner in the goal-oriented sense: each plan says what has to be true before it can
 * be run, what it does, and what it is worth. The difference from the usual game-AI use
 * of this is what "worth" means. A planner that wanted to win would always pick the
 * thing that hurts the character most. This one scores for drama -- a plan is good when
 * it makes the next few minutes worth having played -- so it will hold back a
 * reinforcement it could spend, and spring an ambush it has been saving, and go quiet
 * for a stretch after a hard fight because the alternative is noise.
 *
 * Preconditions are read off the blackboard, so a plan can react to anything any other
 * part of the DM noticed without being wired to it.
 */

/** A plan the DM can decide to run. */
export interface Plan {
  readonly id: string;
  /** Whether the situation allows it at all */
  readonly when: (context: PlanContext) => boolean;
  /** What it is worth right now, as drama rather than as damage */
  readonly drama: (context: PlanContext) => number;
  /** What it does, said in the DM's voice */
  readonly line: (context: PlanContext) => string;
  /** Whether it can only be run once in a place */
  readonly once: boolean;
}

/** Everything a plan is allowed to look at. */
export interface PlanContext {
  readonly instance: Instance;
  readonly board: Blackboard;
  readonly tide: Tide;
  readonly intent: Intent;
  /** What the character is likely to do next, and how sure that is */
  readonly expects: { readonly action: string; readonly confidence: number };
  /** Turns since anything of consequence happened */
  readonly quiet: number;
  /** Which plans have already been run here */
  readonly spent: ReadonlySet<string>;
}

/**
 * The plans, in no particular order: the scoring decides.
 */
export const PLANS: readonly Plan[] = [
  {
    id: 'ambush',
    once: true,
    // Something has been waiting for them to have their hands full. Held until the DM
    // is fairly sure they are about to turn the room over, which is the whole point of
    // keeping the count of what they usually do next.
    when: (context) =>
      context.expects.action === 'ransack' &&
      context.expects.confidence > 0.5 &&
      context.instance.occupants.some((occupant) => !occupant.alerted && occupant.hp > 0),
    drama: (context) => 8 + context.expects.confidence * 4,
    line: () =>
      'It has been in the room the whole time, and it waits until your hands are full before it moves.',
  },
  {
    id: 'reinforce',
    once: true,
    when: (context) =>
      context.tide !== Tide.DESPERATE &&
      context.tide !== Tide.LOSING &&
      context.instance.turn >= 4 &&
      context.instance.occupants.some((occupant) => occupant.boss && occupant.hp > 0),
    drama: (context) => (context.tide === Tide.WINNING ? 9 : 5),
    line: () => 'It does not look at you when it calls, and what comes is already in the room.',
  },
  {
    id: 'taunt',
    once: false,
    when: (context) =>
      context.tide === Tide.LOSING &&
      context.instance.occupants.some(
        (occupant) => occupant.boss && occupant.hp > occupant.maxHp * 0.5
      ),
    drama: () => 6,
    line: () =>
      'It says something to you, unhurried, in a language you half know, and does not press the advantage while it says it.',
  },
  {
    id: 'opening',
    once: true,
    // The mercy. A game master who finishes a struggling player has misunderstood the
    // job, and this is scored above almost everything else for that reason.
    when: (context) => context.tide === Tide.DESPERATE,
    drama: () => 12,
    line: () =>
      'It takes its time over you, and in taking its time leaves you a way out of the corner.',
  },
  {
    id: 'foreshadow',
    once: true,
    when: (context) =>
      context.quiet >= 3 &&
      context.instance.occupants.some(
        (occupant) => occupant.boss && occupant.room !== context.instance.current
      ),
    drama: () => 7,
    line: () =>
      'Something further in shifts its weight, and the sound of it carries better than it should.',
  },
  {
    id: 'settle',
    once: false,
    // Pacing: after a hard stretch, the DM deliberately does nothing and says so. Quiet
    // is a beat, not an absence of one.
    when: (context) => context.tide === Tide.WINNING && context.quiet === 0,
    drama: () => 3,
    line: () => 'The room goes quiet. Somewhere behind you, water is getting in.',
  },
];

/**
 * Picks the plan worth running, if any.
 *
 * @param context What the DM can see
 * @returns The plan, or null when the moment does not want one
 */
export function choosePlan(context: PlanContext): Plan | null {
  let best: Plan | null = null;
  let bestDrama = PLAN_DRAMA_FLOOR;

  for (const plan of PLANS) {
    if (plan.once && context.spent.has(plan.id)) continue;
    if (!plan.when(context)) continue;

    const drama = plan.drama(context);
    if (drama > bestDrama) {
      bestDrama = drama;
      best = plan;
    }
  }

  return best;
}
