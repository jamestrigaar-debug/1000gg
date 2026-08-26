# EndlessQuest — The Thornmarch

A deterministic, text-based roguelike world simulation set in a dark medieval
borderland, tonally influenced by Kentaro Miura's *Berserk*. You have been hanged, and
you did not die; what you carry away from the tree is a mark that the dark can see.

See [LORE.md](LORE.md) for the world bible, and
`Advanced Simulation Mathematics & Systems Theory` for the mathematical design target.

## The Core Loop

The **Gallowsmark** is the pressure gauge everything else hangs from. It rises through
dusk and night, faster in the mire and the deep wood, faster still when you are
bleeding; it falls in daylight and falls sharply inside a settlement. Its intensity is
the exponent in the encounter process's rate function, so every hour you spend out
there is an hour of exposure, and the world escalates because you kept existing.

Survive by managing four things against each other: **needs** (hunger, thirst, fatigue,
which cost hit points once exhausted), **the Mark**, **daylight**, and **distance to
sanctuary**. Resting is not free. Travelling at night is a decision.

## Features Implemented

- **Deterministic World Generation**: 100x100 tile map from a seed using simplex noise for elevation/moisture.
- **Seeded RNG**: xoshiro256++ (Blackman & Vigna) with fork(), state save/restore, Gaussian.
- **Custom ECS**: Minimal World, Entity, Component, System with query support.
- **GameState**: Central holder for map, entities, RNG, log, time (tick/year/day/hour).
- **Say what you do**: The primary input is a line of English, not a button. What the player types is read onto the simulation's own verbs where it maps ("head north", "sleep until morning", "eat the bread"), and where it does not, it is adjudicated the way a game master would: the attempt is read onto the skill it actually calls for, tested at a difficulty set by the character's circumstances, and the result is spent on the world. The buttons remain as shortcuts for the things done constantly.
- **Command Pattern**: MOVE, REST, SEARCH, CONSUME, ATTACK, DEFEND, FLEE, FEINT, INTIMIDATE, TRADE, EQUIP, UNEQUIP, VIGIL, RECKON, NEW_GAME, with validation, time costs, and gating on death and engagement.
- **Simulation Loop**: Processes commands, then runs systems in the order given by design document section 12.3, emitting events via EventBus.
- **NeedsSystem**: Sole source of hunger/thirst accrual, applied hour by hour. The meters are the hour-to-hour readout; neglect settles at the turn of each day into levels of exhaustion. Food endurance is `3 + CON modifier` days; going short of water calls for a DC 15 Constitution save.
- **MarkSystem**: Integrates Gallowsmark intensity from day phase, terrain affinity, wounds, and settlement proximity.
- **EncounterSystem**: Non-homogeneous Poisson process (section 2.4) whose rate is exponential in Mark intensity.
- **Resolution core (d20)**: `src/core/rules/` implements the handbook's mechanics — ability scores and modifiers, the standard array, proficiency bonus, skills, `d20 + modifier` against a Difficulty Class, advantage/disadvantage, the six-level exhaustion ladder, and death saving throws. `src/core/state/Checks.ts` bridges those rules to the ECS.
- **Graded outcomes**: A check does not merely pass or fail. Missing a DC by four or less is a *setback* — you get what you wanted at a price — and natural 1s and 20s read as critical failure and critical success.
- **Combat**: Round-based duels on `d20 + ability + proficiency` against Armour Class. Natural 20 always hits and doubles the damage dice; natural 1 always misses. Stances are attack, defend (+3 AC), flee (Acrobatics), feint (Deception, granting advantage next round), and intimidate (Intimidation). Dropping to zero hit points starts death saving throws rather than ending the run outright.
- **Lore layer**: The Thornmarch setting, a bestiary, terrain and forage flavour, items, and deterministic place/person name generation.
- **Oracle**: Random tables answer what the simulation has no model for — how a stranger takes your approach, what the ground gives up, what goes wrong now. Every entry carries several wordings and the answer is narrated from a drawn one, so the same roll does not tell the same sentence twice.
- **Item catalog**: 141 items and 29 condition cards adapted from the Complete Item & Card Catalog, carried as typed data. Weight-limited inventory, equipment slots, and weapons and armour that feed combat.
- **The board**: The viewport states terrain as a quiet field of colour and draws a mark
only where something occupies the space -- the character, a threat, a settlement, a
vigil, the tree. Everything else a tile could say belongs in the log, which has room to
say it properly. The camera is locked to the character: the only way to change what you
are looking at is to walk there, with the chart (M) as the counterweight, recording the
ground already covered.

**The narrator**: Narration is spoken by the thing that has not stopped looking, and its
register is keyed to the Gallowsmark -- silent when cold, interjecting when warm,
personal when hot, self-contradicting when burning, and lying outright once it is open.
One rule holds it together: the narrator may lie in prose but never in mechanics. Dice
readouts, damage and costs always survive intact, so a fabrication always sits beside
the numbers that contradict it.

**Threads**: Something taking an interest, an untreated wound, something dropped on the
road -- each opens a question the world returns to on its own clock, and pays off as an
event rather than a line of prose. Threads are saved with the run.

**The Reckoning**: The run has an objective and an ending that is not a death. A gallows-tree stands far from where the character wakes, and three vigils are strung along the road to it. Keeping a rite argues the debt down; arriving at the tree settles it against everything you did on the way, as three Constitution saves whose DC falls with each rite kept and rises with the Gallowsmark. Walking out of the Thornmarch alive is the win condition.
- **Progression**: Surviving a threat earns experience -- all of it for killing, half for getting away -- up to fifth level, each level adding a hit die plus Constitution. A first-level character cannot fight their way across the map; the point is to become just hard enough to kill to walk out.
- **Settlements**: Deterministically named villages that act as sanctuary — the Mark cools sharply and the encounter rate collapses within reach of one. Barter a coin for supplies.
- **Save/Load**: Full run persistence to IndexedDB (localStorage fallback), including RNG state.
- **PixiJS Map Renderer**: WebGL tile rendering, viewport culling, player highlight, settlement markers, pan/zoom.
- **UI Panels**: Status bar (ability scores, HP, hunger, thirst, fatigue, exhaustion, death saves, the Mark, time, location, seed), Action panel (movement grid, rest, search, new game, keyboard shortcuts), Log panel (color-coded, auto-scroll).
- **Testing**: Vitest suites for RNG, ECS, MapGenerator, SimulationLoop/EventBus.

## Deployment

The build uses relative asset URLs, so the contents of `dist/` can be dropped into any
directory on any host and will run from there -- `example.com/RPG/EndlessQuest/` as
readily as the root of a domain. There is no server component and no runtime fetching:
the whole game is the bundle. Saves go to IndexedDB under a namespaced key, with
localStorage as a fallback.

```bash
npm run build      # produces dist/
# copy dist/* to wherever the game is to live
```

## Tech Stack

- TypeScript strict
- Vite
- PixiJS 7 (WebGL)
- simplex-noise
- Vitest
- pnpm

## Project Structure

```
src/
├── core/
│   ├── ecs/ (Entity, Component, System, World)
│   ├── rng/ (SeededRNG)
│   ├── state/ (GameState, Commands, CommandHandler)
│   ├── world/ (Tile, TerrainType, MapGenerator)
│   ├── lore/ (Lore, Flavor, Bestiary, Items, Names,
│   │          items/ItemTypes, items/Catalog, items/Conditions)
│   └── simulation/ (SimulationLoop, CombatMath, CombatResolver,
│                    systems/TimeSystem, NeedsSystem, MarkSystem, EncounterSystem)
├── ui/
│   ├── map/ (MapRenderer)
│   ├── panels/ (StatusPanel, ActionPanel, LogPanel)
│   └── UI.ts
├── events/ (GameEvent, EventBus)
├── utils/ (math)
└── main.ts
tests/
├── rng.test.ts
├── ecs.test.ts
├── mapgen.test.ts
├── simulation.test.ts
├── determinism.test.ts
├── needs.test.ts
├── mark.test.ts
├── combat.test.ts
├── savegame.test.ts
├── settlement.test.ts
├── items.test.ts
└── ui.test.ts
```

## Setup

```bash
# install pnpm if needed
corepack enable
pnpm install

# dev server
pnpm run dev
# open http://localhost:5173

# run tests
pnpm test

# build
pnpm run build
pnpm run preview
```

## How to Change Map Size / Seed

- **Map size**: Edit constants in `src/core/world/Tile.ts`:
  ```ts
  export const MAP_WIDTH = 100;
  export const MAP_HEIGHT = 100;
  ```
  And `VIEWPORT_WIDTH/HEIGHT` and `TILE_SIZE` for renderer.

- **Seed**: 
  - URL query: `http://localhost:5173/?seed=myseed123`
  - Input box in action panel + New Game button
  - Programmatically: `simulation.newGame('myseed')`
  - In code: `new SimulationLoop('myseed')`

Same seed => identical map, same RNG sequence, deterministic.

## Architecture Overview

**Determinism**: All randomness via `SeededRNG` in `GameState`. No `Math.random()` in core simulation. MapGenerator uses forked RNGs for noise.

**ECS**: `World` holds entities as `Map<EntityId, EntityRecord>`. Components are plain data with `type` discriminant. Queries filter by component types. Future systems (combat, AI) will be added as `System` implementations.

**GameState**: Immutable-ish central state. `advanceTime` handles hour/day/year rollover. `revealArea` handles fog of war.

**Commands**: Typed discriminated union. `CommandHandler` validates, updates position, reveals tiles, advances time by terrain cost, logs via EventBus.

**SimulationLoop**: Owns RNG, map, world, player creation, systems. `submitCommand` processes command then runs systems. EventBus pub/sub for UI.

**MapRenderer**: PixiJS Application. Only draws tiles in viewport (screen size / tileSize). Colors per terrain type, dimming for explored but not nearby. Player as white rect with yellow border. Supports mouse drag pan, wheel zoom, center button.

**UI**: Plain HTML/CSS panels. `UI` class wires simulation events to panel renders. The
action panel is modal: while engaged it offers only combat controls, because those are
the only commands the handler will accept. Keyboard: arrow keys move, R rest 1h,
Shift+R rest 8h, S forage; in combat, A strike, D guard, F run.

**The Mark**: `MarkSystem` integrates intensity hour by hour; `markBand()` maps intensity
onto the five bands shown in the status bar. `EncounterSystem.hourlyEncounterProbability`
converts it to an arrival probability via the Poisson zero-arrival complement.

**Items**: The catalog in `src/core/lore/items/Catalog.ts` is adapted from the Complete
Item & Card Catalog. Weapons are rolled on the catalog's own dice, carried in
`sourceDice`, so a hand axe hits for what the catalog says it hits for. Armour points
become a damage-absorbed fraction that is converted into Armour Class, capped so no
loadout is immune. Morale, warmth, light radius, burn hours, and
durability are carried as data for systems that do not exist yet.

**The Reckoning**: `world/Reckoning.ts` places the tree and its vigils from a generator
forked off the world seed rather than from the map's own, so adding an objective to the
game did not move a tile of any world that already existed. The sites are recomputed on
load like settlements; only which rites were kept is saved. The vigils are placed along
the line from the character's waking place to the tree, with a wander, because a rite
that costs two crossings of the Thornmarch is a rite no one will ever keep.

**Balance**: Measured with a headless bot over 30 seeds. A character who walks straight
at the tree reaches it perhaps a third of the time and, arriving owing everything, wins
about 3% of runs; one who keeps the rites on the way wins about 20%. Fleeing is the
first-level answer to almost everything, and gets easier every round contact is held,
so breaking off is a bounded cost rather than a coin flip repeated until death.

**Save/Load**: `SaveGame` serializes a run; the tile map is deliberately *not* stored,
since it is a pure function of the seed and is regenerated on load. Only the fog-of-war
bitmap, the ECS snapshot, and the RNG state are persisted. Systems are seeked to the
restored tick so a loaded game does not replay its own history.

**Terrain** (colour, movement cost in hours, Mark affinity):
- Plains 0x90B77D cost 1
- Forest 0x2D5016 cost 2
- Hills 0x8B7D6B cost 3
- Mountain 0x808080 cost 4
- Swamp 0x5D4E37 cost 3
- Water 0x4A90E2 impassable
- Unexplored 0x000000

## Testing

- **RNG**: determinism, fork, bounds, float range, gaussian mean/std, state save/restore.
- **Needs**: hourly accrual, rest recovery, deprivation costing exhaustion, the water saving throw, death at the sixth level, post-death command refusal, consumables.
- **Mark**: day-phase classification, seasons, rise at night, decay in daylight, band boundaries, encounter rate monotonicity.
- **Rules**: dice parsing and rejection of unrecognised notation, ability modifiers, proficiency bonus, advantage/disadvantage cancellation, DC grading, the exhaustion ladder, death saves.
- **Combat**: natural 20 and natural 1 behaviour, AC derivation, bestiary consistency, engagement gating, fight termination, determinism.
- **Save**: world round-trip, map regeneration from seed, RNG continuation, no history replay, version rejection.
- **Settlements**: naming, determinism, isolation of naming from terrain draws, lookup, save regeneration, trade outcomes.
- **People and errands**: seeded generation, everybody in a settlement, roles their own names do not contradict, wants that suit the person and point somewhere real, no two open errands on one person, accepting and discharging, refusing to be paid off early, an errand about a place completing by getting there, deadlines enforced by the world, a hostile person asking for nothing, knowledge putting a vigil on the chart, and a want for every role the game can generate.
- **Interpretation**: the many ways people phrase a direction, how long a rest was meant to be, matching what the player calls a thing against what they carry, words meaning different things in a fight, attempts read onto the right skill, and asking rather than correcting when a line cannot be read.
- **Adjudication**: an improvised attempt costing time and resolving as a check, a success spent on the world rather than narrated, difficulty rising with the Mark, and improvising mid-fight costing the round rather than the hour.
- **The narrator**: the register ladder, silence while cold, lies only at the top of it, lies never touching a mechanical readout, and lies spaced apart.
- **Threads**: opening without stacking, not settling early, each kind's payoffs, and surviving a save.
- **Soak**: five runs of fifteen hundred commands checking meter bounds, finite numbers, entity cleanup, bounded bookkeeping, save round-trips and determinism.
- **Reckoning**: placement distance and terrain, vigils staying near the road, determinism from the seed, the rite's effect on the Mark, refusal away from the sites, the difference preparation makes to the ending, save round trip.
- **Progression**: the experience ladder and its ceiling, a level always being worth a hit point, experience for surviving without killing.
- **Consequences**: wounds, lost items, lost time, a fanned Mark and being followed all changing state, an empty pack costing nothing, table sampling not repeating itself.
- **Items**: catalog integrity, preservation of the source catalog's weapon and armour ordering, forage-table referential integrity, weight limits, equipment derivation and capping, save round trip.
- **ECS**: create/destroy, add/get/remove, query, removal updates, destroy cleans queries.
- **MapGen**: determinism, dimensions, valid terrain, passable ratio >=50%, start pos valid.
- **Simulation**: MOVE updates, impassable rejected, REST advances tick, SEARCH logs, EventBus pub/sub.

Run `pnpm test` — all 109 tests should pass.

## Future Roadmap

- NPC AI: utility-based, MDP, personality
- Population dynamics: births, deaths, genetics (Gompertz)
- SettlementSystem, ProductionSystem
- Social graph, rumor spread, knowledge
- Dialogue & card systems
- Simulated settlements: population, production, and villages that change between visits
- Pixel-art sprites, animations, fog of war vision
- World events (Poisson), weather (SDE climate)
- Weapon and armour condition, degradation, and repair (durability is already data)
- Crafting from the catalog's recipes; artifact boons and their hidden costs
- Condition cards as entities: wounds, illness, and states of mind
- The seven NPC archetypes, adapted to the Thornmarch: relationships, memory, rumour
- The Widow's Coin and the Choir's bargain (see LORE.md section III)

## Notes

- No global variables except main entry.
- No circular dependencies.
- Constants for costs, colors, dimensions.
- JSDoc on public methods.
- Performance: viewport culling, no per-frame full redraw unless state changes.

## License

MIT
