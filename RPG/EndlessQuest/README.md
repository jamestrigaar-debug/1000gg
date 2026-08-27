# EndlessQuest — The Thornmarch

A deterministic, text-based roguelike world simulation set in a dark medieval
borderland. You have been hanged, and you did not die; what you carry away from the
tree is a mark that the dark can see.

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
- **Encounters built to a budget**: What the country sends is sized against the character who has to face it, by the Guide's own method — experience thresholds by level, four grades of encounter, monsters chosen to fit under the threshold being aimed at. The Gallowsmark no longer picks the monster; it picks the *grade*, from easy in cold country to deadly once the mark is open. Before this, a swordsman of the Iron Chain arrived on schedule around the fifth day and killed a second-level character in two blows, which is not a difficulty curve but a countdown.
- **Morale**: The Guide's optional rule. A creature cut below half its hit points for the first time makes a DC 10 save, stiffened by its own tenacity, and a failure means it has had enough and goes. Fighting is worth choosing over running because some fights end when the other side decides they are over.
- **Water**: There is water in the world and you can drink it. Running water within reach is clean; a mire is standing water and calls for a Constitution save, which a thirsty man makes anyway because there is nothing else. Before this a character could die of thirst on a riverbank, and measured over thirty runs, going without was among the commonest ways to die.
- **Progression**: Surviving a threat earns experience -- all of it for killing, half for getting away -- up to fifth level, each level adding a hit die plus Constitution. A first-level character cannot fight their way across the map; the point is to become just hard enough to kill to walk out.
- **Settlements**: Deterministically named villages that act as sanctuary — the Mark cools sharply and the encounter rate collapses within reach of one. Barter a coin for supplies.
- **Save/Load**: Full run persistence to IndexedDB (localStorage fallback), including RNG state.
- **PixiJS Map Renderer**: WebGL tile rendering, viewport culling, player highlight, settlement markers, pan/zoom.
- **UI Panels**: Status bar (ability scores, HP, hunger, thirst, fatigue, exhaustion, death saves, the Mark, time, location, seed), Action panel (movement grid, rest, search, new game, keyboard shortcuts), Log panel (color-coded, auto-scroll).
- **Testing**: Vitest suites for RNG, ECS, MapGenerator, SimulationLoop/EventBus.

## Deployment

The game is a static bundle. There is no server component and nothing is fetched at
runtime.

**The simplest deployment is one file.** `npm run build` writes `EndlessQuest.html` to
the root of the repository: the whole game, script inlined, no asset folder, no relative
paths to resolve. Upload it wherever the game should live and rename it `index.html`.
That is the entire procedure, and there is nothing in it to get half right.

```bash
npm install
npm run build        # writes dist/ and EndlessQuest.html

# then either:
#   upload EndlessQuest.html and rename it index.html      (one file, nothing else)
#   or upload the CONTENTS of dist/                         (conventional; index.html + assets/)
```

Uploading the repository whole also works. The source `index.html` cannot run — a web
server cannot execute TypeScript, which is what a black screen means — so it looks for a
build beside it, finds `EndlessQuest.html` or `dist/`, and goes there. If it finds
neither it says so in plain words rather than staying black.

This has gone wrong twice, both times because the build did not travel: once because
`dist/` was in `.gitignore`, and once because an upload carried the source and not the
build. The single file exists because a folder is the thing that goes missing. Rebuild
after changing any source, or what ships will be an older game than what is in `src/`.

Saves go to IndexedDB under a namespaced key, with localStorage as a fallback.

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

**Balance**: Held as a test rather than as a note. `tests/balance.test.ts` plays thirty
worlds twice over with a deliberately mechanical player — one who flees everything, eats
when hungry, drinks where there is water, and never uses a single clever thing the game
offers — once rushing the tree and once keeping the rites found on the way, and asserts
the shape of the result. The argument the game makes is that preparation is worth
several times speed; that claim was previously measured by hand every time the rules
moved, which left it one careless change away from quietly stopping being true. A character who walks straight at the tree now reaches it about half the
time and, arriving owing everything, wins about 3% of runs — the debt is collected on
the spot. One who keeps the rites found along the way wins about a third. Preparation
multiplies the odds roughly tenfold, which is the shape the game is arguing for.
Fleeing is cheap by design (two rounds and about three hit points, measured), because
at first level running is the answer to almost everything.

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
- **Addressing people**: names, bynames, trades and possessives all resolving to the right person; falling back to the caller's preference only when nobody was named; pressing needing a read first, working once, costing the relationship and buying compliance.
- **People and society**: everybody getting a manner, a belief, a bond and a secret; mannerisms written to finish the sentence they are dropped into; no two people of one name in a village; the attitude ladder and its conversation difficulties; a burning mark costing a step of goodwill; reading somebody and remembering it across a save; appealing blind being worse than not trying; and a sweep asserting no line ever opens with a lower-case article.
- **Knowledge**: reading the topic out of an ordinary question, preferring the sharper reading when a line could be two things, refusing what the world does not hold, routing through the vocabulary, bearings to the tree, villages and rites landing on the chart, the Mark making answers harder to get, and the clock rolling the day over correctly across a question.
- **People and errands**: seeded generation, everybody in a settlement, roles their own names do not contradict, wants that suit the person and point somewhere real, no two open errands on one person, accepting and discharging, refusing to be paid off early, an errand about a place completing by getting there, deadlines enforced by the world, a hostile person asking for nothing, knowledge putting a vigil on the chart, and a want for every role the game can generate.
- **Interpretation**: the many ways people phrase a direction, how long a rest was meant to be, matching what the player calls a thing against what they carry, words meaning different things in a fight, attempts read onto the right skill, and asking rather than correcting when a line cannot be read.
- **Adjudication**: an improvised attempt costing time and resolving as a check, a success spent on the world rather than narrated, difficulty rising with the Mark, and improvising mid-fight costing the round rather than the hour.
- **The narrator**: the register ladder, silence while cold, lies only at the top of it, lies never touching a mechanical readout, and lies spaced apart.
- **Threads**: opening without stacking, not settling early, each kind's payoffs, and surviving a save.
- **The shipped build**: the single file existing, asking the network for nothing, inlining the bundle exactly once, escaping closing tags inside it, and the source page knowing how to find either build.
- **Balance**: preparation beating haste several times over, a prepared run being winnable often enough to be worth trying, rushing almost never working, most runs reaching the tree, the journey lasting days rather than hours or months, and the character growing on the way.
- **Chronicle order**: a long run's log asserted to run forwards in time, entry by entry.
- **Soak**: five runs of fifteen hundred commands checking meter bounds, finite numbers, entity cleanup, bounded bookkeeping, save round-trips and determinism.
- **Encounters**: budgets climbing with the character, the Mark grading the danger rather than choosing it, the worst of the bestiary staying away from a first-level character, every creature being reachable at some level, and a played-out check that nothing beyond a first-level budget is ever sent to one.
- **Morale**: creatures both breaking off and being killed, and being asked only once in a fight.
- **Water**: dry ground offering nothing, mires reading as foul and running water as clean, drinking slaking thirst and filling the skin, and a refusal where there is nothing to drink.
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
