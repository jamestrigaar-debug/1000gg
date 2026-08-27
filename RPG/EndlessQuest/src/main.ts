import { SimulationLoop } from './core/simulation/SimulationLoop';
import { UI } from './ui/UI';
import { StartScreen } from './ui/screens/StartScreen';
import type { Embark } from './ui/screens/StartScreen';

/**
 * Extracts initial seed from URL parameter (?seed=...) or defaults to current timestamp.
 */
function getInitialSeed(): string {
  const params = new URLSearchParams(window.location.search);
  const seedParam = params.get('seed');
  if (seedParam) return seedParam;
  return Date.now().toString();
}

/**
 * Application bootstrap entry point.
 */
async function main(): Promise<void> {
  const globalObj = window as unknown as Record<string, unknown>;

  // Tells the boot guard in index.html that the game is actually running, so it knows
  // not to step in. Set before the front door, because the front door is the game
  // running: the guard's only job is to catch a page that never executed any script.
  globalObj.__ENDLESSQUEST_BOOTED = true;

  // Nobody is dropped onto the board cold. The premise, the rules and the character are
  // settled first, and the run does not exist until they are.
  const screen = new StartScreen(document.body, getInitialSeed());
  const embark: Embark = await screen.show();

  const seed = embark.seed ?? getInitialSeed();
  console.log(`Starting EndlessQuest with seed: ${seed}`);

  const simulation = new SimulationLoop(seed, undefined, {
    difficulty: embark.difficulty,
    originId: embark.originId,
  });
  const appContainer = document.body;

  const ui = new UI(appContainer, simulation);
  await ui.initialize();

  // Expose global debug handles on window object
  globalObj.simulation = simulation;
  globalObj.ui = ui;

  console.log('EndlessQuest initialized');
}

main().catch((e) => {
  console.error('Failed to start EndlessQuest', e);
  const el = document.createElement('div');
  el.style.color = 'red';
  el.style.padding = '20px';
  el.textContent = `Failed to start: ${e}`;
  document.body.appendChild(el);
});
