import { SimulationLoop } from './core/simulation/SimulationLoop';
import { UI } from './ui/UI';

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
  const seed = getInitialSeed();
  console.log(`Starting EndlessQuest with seed: ${seed}`);

  const simulation = new SimulationLoop(seed);
  const appContainer = document.body;

  const ui = new UI(appContainer, simulation);
  await ui.initialize();

  // Expose global debug handles on window object
  const globalObj = window as unknown as Record<string, unknown>;
  globalObj.simulation = simulation;
  globalObj.ui = ui;

  // Tells the boot guard in index.html that the game is actually running, so it knows
  // not to step in. See the guard for what it does when this never gets set.
  globalObj.__ENDLESSQUEST_BOOTED = true;

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
