# EndlessQuest

A board game about walking east.

Six countries lie between you and the far end of the road. You move a piece between
places on a map, and when you arrive somewhere that has something in it, the something
is usually a fight. The fights are Dungeons and Dragons, played on eight squares by
eight, where the question is where to stand.

## Running it

```
npm install
npm run dev
```

## Building it

```
npm run build
```

This writes `EndlessQuest.html`: one self-contained file, around 35 KB, with no external
requests. Upload that single file anywhere and it works, including from a subdirectory.
`dist/` is the build's scratch space and is not tracked.

## Testing it

```
npm test
```

## How it is put together

Nothing here has a runtime dependency. The whole game is TypeScript and the document.

| Directory | What lives there |
| --- | --- |
| `src/rng` | The seeded generator. A seed is a world; two plays of one seed are identical. |
| `src/rules` | Dice, ability scores, checks, death saves, levels. The handbook's maths. |
| `src/content` | The bestiary, the item catalogue, the name tables. |
| `src/world` | Countries, places, roads, and the generator that lays them out. |
| `src/battle` | The grid, the fight, the enemy's tactics, and what turns up. |
| `src/game` | Characters, the run itself, and what arriving somewhere means. |
| `src/ui` | The board, the battlefield, and the shell around them. |

Two rules hold the thing together and are worth knowing before changing anything.

**Determinism.** Every random number comes from a named stream opened on the world's
seed. Systems never share a generator, because sharing one makes the order of unrelated
draws matter: adding a die roll in one place would silently change what happens somewhere
else, and a seed would stop meaning a world.

**No empty space.** Every place a piece can stand on does something when you arrive. The
map is a graph of places rather than a grid of ground, so there is no such thing as a
move that spends a turn and offers nothing.

## Adding a graphical layer

The battlefield is drawn in stacked layers, and one of them is empty and reserved:

| Layer | What goes in it |
| --- | --- |
| `terrain` | The ruled squares, or a painted floor once there is one. |
| `art` | **Reserved.** Scenery, painted ground, a backdrop. Nothing today. |
| `decals` | Marks saying what the player may do: reach, threat. |
| `preview` | What follows the pointer: the route to the square under it. |
| `sprites` | The pieces, as characters today and as images later. |
| `effects` | Blows landing. |
| `chrome` | Anything sitting over the board rather than on it. |

Two seams make art droppable without touching the game.

`src/ui/Stage.ts` owns the geometry. Everything that draws converts squares to pixels
through `corner` and `centre`, so an overlay cannot end up half a square out from the
board it is sitting on. Put art in the `art` layer and it lands registered with the grid.

`src/ui/Skin.ts` owns appearance. A skin answers two questions -- what a square looks like,
and what a piece looks like -- and returns elements. `CHARACTER_SKIN` returns typewriter
characters; a graphical skin returns `<image>` and nothing else in the codebase changes,
because `BattleView` takes the skin as a constructor argument and never asks what kind it
is. A skin deliberately cannot reach position, input, or rules: those belong to the view,
and a skin that could reach them would be a second copy of the game.

`tests/layers.test.ts` holds the stacking order, so art cannot later be buried under the
ground or drawn over the marks that tell the player what they can do.
