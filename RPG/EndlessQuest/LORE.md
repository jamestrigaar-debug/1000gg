# The Thornmarch — World Bible

> *"They hanged me and I did not die. That was the mercy. Everything after has been the sentence."*
> — attributed to the first Marked

This document is the creative spine of EndlessQuest. It exists so that every system we
build has something to *mean*. Mechanics referenced here are implemented under
`src/core/lore/` and the systems in `src/core/simulation/systems/`.

Tonal reference: Kentaro Miura's *Berserk* — a late-medieval world of mud, iron, and
institutional cruelty, where the supernatural is not wondrous but predatory, and where
the worst monsters were people who chose it.

---

## I. The Setting

**The Thornmarch** is a borderland. Once it was the southern march of a kingdom whose
name is no longer said aloud; now it is a stretch of forest, mire, and broken hill
country between two powers that have both stopped caring who holds it. There is no
capital. There are villages, and there is the road between them, and the road is
mostly a rumour.

The present age is called **the Long Dusk**. Nobody can say when it began. The
calendar still turns — four seasons, ninety days each — but the seasons have gone
wrong in small, deniable ways: winters that arrive in the wrong month, summers with no
heat in them. People blame the weather. People have to blame something.

### What people believe

- The **Church of the Sealed Wound** holds the Thornmarch nominally. Its doctrine is
  that the world was wounded at its making and that suffering is the wound draining.
  To suffer well is to heal creation. This is used to justify a great deal.
- Its enforcement arm is the **Iron Chain** — inquisitors, mostly. They travel in
  threes, carry ledgers, and are more feared than any beast in the wood, for good
  reason. A beast wants meat. The Chain wants a confession, and will wait.
- The peasantry keeps older habits: iron over the door, salt at the threshold, a coin
  in the mouth of the dead so they do not come back hungry.

---

## II. The Gallowsmark

**The player character has been hanged, and did not die.**

Somewhere behind them is a gallows tree and a rope that did not finish its work. What
they carry away from it is a mark — a black weal around the throat that never faded,
called the **Gallowsmark**.

The Mark is not a curse in the storybook sense. It is a *debt*. Something was owed at
that tree and was not collected, and the things that collect such debts have not
stopped looking.

### How it behaves — the core loop

The Mark has an intensity, and intensity is the game's central pressure gauge:

| Condition | Effect on the Mark |
|---|---|
| Night (dusk through dawn) | **rises** — the Mark bleeds in the dark |
| Deep wood, mire, high stone | rises faster — old places, thin places |
| Open plain under daylight | falls slowly |
| Within a settlement | falls sharply — hearthfire, salt, other people's noise |
| Being wounded | rises — blood carries further than light |

When the Mark burns hot enough, **things come**. Not always at once. Not always
visibly. But the rate at which the dark takes an interest in you is a direct function
of how hot you are carrying, and that rate is what the encounter system samples.

This is the answer to "why not just rest until healed?" — because time in the dark is
the most expensive thing you own.

### Design intent

The Mark does three jobs at once, which is why it earns its place:

1. **It makes the clock matter.** Every hour spent is an hour of exposure.
2. **It makes the map matter.** Terrain and settlements become a pressure landscape,
   not just movement costs.
3. **It is a difficulty curve with no experience points.** The longer you survive, the
   more attention you have accumulated. The world escalates because *you* escalated it
   by continuing to exist.

---

## III. The Sated

Not every monster in the Thornmarch is a beast. The worst of them were people.

A **Widow's Coin** is a small corroded disc, thin as a fingernail, that turns up in
grave-dirt and riverbeds and the pockets of dead men. Most are worthless. A few are
not. A true Coin does nothing at all until its bearer is brought to the absolute floor
of themselves — total despair, the moment where a person would trade anything.

At that moment the Coin opens, and something answers. Five voices, always five. The
peasantry calls them **the Choir**, when they call them anything.

The Choir makes one offer, and it is always the same offer: *give us the thing you
love most, and you will never be weak again.*

Those who accept are called the **Sated** — they ate what they loved, and were filled.
They keep a human shape when it suits them. Every one of them has, somewhere in their
history, a specific person they handed over, and they all remember exactly who.

A Sated is not a random encounter. When one appears, it should be an event.

### The lesser dead

Between the Sated and the ordinary dangers of a bad road:

- **Gaunts** — the hungry dead, drawn by the Mark like moths. Weak alone. Rarely alone.
- **Grave-wicks** — corpse-candles. They do not attack; they *lead*, and where they
  lead is worse than where you were.
- **Mire-things** — whatever the swamp has kept. Slow, patient, extremely strong.
- **Hollow hounds** — something is wearing a dog. Fast, and they hunt in threes.

### And ordinary men

- **Free companies** — mercenaries between contracts, which is to say bandits with
  paperwork.
- **The Iron Chain** — see above. Being Marked is, doctrinally, proof of guilt.

---

## IV. Tone Rules (for anyone writing content)

These keep the world coherent as it grows:

1. **Understate the supernatural.** Nobody says "a demon." They say "something got
   into the Aldry boy." The horror is in what people have normalised.
2. **The world is indifferent, not malicious.** It is not out to get the player
   personally. It simply has an appetite and the player is standing in it.
3. **No high-fantasy vocabulary.** No mana, no levels, no elves. Wounds, iron, rot,
   debt, weather, hunger.
4. **Cruelty must have a reason, even a bad one.** Everyone who does something
   monstrous believes they are balancing a ledger.
5. **Small mercies land harder than large ones.** A stranger sharing bread should feel
   more significant than a treasure.
6. **Second person, past-tense-adjacent, plain.** "You come out of the trees into a
   field someone stopped tending." Not "Thou dost enter a mystical glade."

---

## V. Roadmap of Lore Hooks

Systems already planned in the design document, and what they mean in-world:

| System | In-world meaning |
|---|---|
| Poisson world events | The dark's attention, sampled |
| Population dynamics | Villages that empty out between visits |
| Social graph / rumour | Word of a Marked traveller arriving before you do |
| Bayesian NPC belief | Whether the village decides you are a guest or a problem |
| Lotka–Volterra | Wolves, deer, and what happens when the wolves stop being wolves |
| Genetics / heritability | Bloodlines, and what runs in them |
| Settlement PID control | A headman trying to keep the grain stores level as things get worse |
