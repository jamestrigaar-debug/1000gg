# Attribute → mechanic map

Every FM attribute the engine ships must drive at least one mechanic; an
attribute nothing reads is a lie told to the user on the player profile screen.
This table is the contract. Two attributes are still carried without being
read; they are marked, and they are the checklist for the next milestone rather
than decoration. Everything else on a player profile changes something on the
pitch.

Scale is 1–20 throughout, normalised by `attr01()` in `core/math.ts`. Nothing in
the engine reads a raw attribute without going through that function or
`attrMul()`.

## Technical

| Attribute | Mechanic | Where |
|---|---|---|
| passing | Accuracy of a pass through the kick solver's skill term | `match.strike` → `kick.applyError` |
| technique | Half of the player's strike-pace ceiling; execution error on difficult techniques | `match.strike` |
| firstTouch | Touch distance on control (0.4–1.5 m) and the chance a fizzed ball squirts loose | `match.stepBall`, `match.resolvePossession` |
| dribbling | Speed retained while carrying (74%–94% of top speed); resistance in the carrier duel | `match.maxSpeedFor`, `match.contestCarrier` |
| finishing | Skill term for shots | `match.strike` |
| crossing | Whether a wide player crosses at all, and how much the delivery scatters; corner delivery quality | `match.crossTarget`, `match.takeCorner` |
| heading | The largest term in the aerial duel, and the finishing attribute for a header | `match.resolveAerial`, `match.takeShot` |
| tackling | Chance of winning the ball off a carrier | `match.contestCarrier` |
| marking | How tightly a defender sits on the man he has picked up | `match.defendBrain` |
| longShots | Shot skill beyond 18 m | `shot.resolveShot` |

## Mental

| Attribute | Mechanic | Where |
|---|---|---|
| vision | How many pass options the brain evaluates per beat, and pass completion | `match.carrierBrain`, `match.passCompletion` |
| decisions | Noise applied to option scores; awareness of the offside line | `match.carrierBrain`, `match.wouldPlayOffside` |
| anticipation | How far ahead a pursuing player projects the quarry | `player.pursue` |
| composure | Shrinks shooting error under pressure; who takes the penalty; how cleanly a defender tackles | `shot.resolveShot`, `match.takePenalty`, `match.contestCarrier` |
| offTheBall | How often a forward gambles on a run in behind, and whether he times it onside | `match.runBrain`, `match.wouldPlayOffside` |
| positioning | Aerial duel contribution; the keeper's save model | `match.resolveAerial`, `shot.saveFailChance` |
| concentration | *M6* — late-match lapses. Carried, not yet read | |
| teamwork | *M6* — how strictly a player holds the shape. Carried, not yet read | |
| aggression | How often a challenge becomes a foul, and how often a foul is booked | `match.contestCarrier`, `match.judgeCard` |
| bravery | Willingness to go in where it hurts: a term in the aerial duel | `match.resolveAerial` |
| workRate | Stamina spend: high work rate players spend more, willingly | `player.drainStamina` |

## Physical

| Attribute | Mechanic | Where |
|---|---|---|
| pace | Top speed: 5.8 + 0.18 × pace m/s | `player.refreshCeilings` |
| acceleration | Acceleration ceiling: 3 + 0.15 × acceleration m/s² | `player.refreshCeilings` |
| agility | Turn-rate ceiling — a low-agility player arcs instead of pivoting | `player.refreshCeilings`, `player.stepPlayer` |
| stamina | Rate of stamina drain and the late-game 1–3% speed decay | `player.drainStamina`, `player.refreshCeilings` |
| strength | Half the strike-pace ceiling; carrier duel resistance | `match.strike`, `match.contestCarrier` |
| jumpReach | How high he can get his head, which decides what he can contest at all, plus the duel itself and the free-kick wall | `match.aerialReach`, `match.takeFreeKick` |
| balance | Turn rate under load | `player.refreshCeilings` |

## Roles

Attributes say what a player *can* do. Roles (`core/intent.ts`) say what he is
*asked* to do, as a multiplier on each intent — a Poacher values a shot more
than an Anchor Man does, a Ball-Winning Midfielder values a press. Roles are
data: adding one is an entry in the `ROLES` table, not a branch. The default
role has no opinions at all, so a side that has chosen nothing plays exactly as
the engine's own judgement suggests.

## Goalkeeping

| Attribute | Mechanic | Where |
|---|---|---|
| reflexes | The save model | `shot.saveFailChance` |
| handling | Held or parried, and how a keeper deals with a stray ball | `shot.resolveShot`, `match.faceStrayBall` |
| commandOfArea | How far he comes for a loose ball, when he smothers at a carrier's feet | `match.keeperClaim`, `match.contestCarrier` |
| kicking | Distribution range from the keeper, and clearance quality | `match.keeperDistribution`, `match.strike` |
