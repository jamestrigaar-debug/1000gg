# Attribute → mechanic map

Every FM attribute the engine ships must drive at least one mechanic; an
attribute nothing reads is a lie told to the user on the player profile screen.
This table is the contract. Where a row says *M3*/*M4*/*M5*, the attribute is
defined and carried but its mechanic lands with that milestone — those rows are
the checklist for those milestones, not decoration.

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
| crossing | *M5* — skill term for crosses and corner delivery | |
| heading | *M5* — aerial duel outcome and header shot quality | |
| tackling | Chance of winning the ball off a carrier | `match.contestCarrier` |
| marking | *M2* — how tightly a defender tracks their assigned runner | |
| longShots | *M3* — shot skill beyond 18 m, and the utility bias towards taking one | |

## Mental

| Attribute | Mechanic | Where |
|---|---|---|
| vision | *M3* — how many pass lanes the brain evaluates per beat | |
| decisions | *M3* — noise applied to option scores | |
| anticipation | How far ahead a pursuing player projects the quarry | `player.pursue` |
| composure | *M4* — shrinks execution error under pressure; penalty placement | |
| offTheBall | *M3* — quality of support and run-behind positions | |
| positioning | *M2* — defensive anchor discipline | |
| concentration | *M5* — late-match error rate, lapses at set pieces | |
| teamwork | *M2* — how strictly a player holds the team's shape | |
| aggression | *M5* — tackle commitment, and therefore foul and card risk | |
| bravery | *M5* — willingness to contest a 50/50 or a high ball | |
| workRate | Stamina spend: high work rate players spend more, willingly | `player.drainStamina` |

## Physical

| Attribute | Mechanic | Where |
|---|---|---|
| pace | Top speed: 5.8 + 0.18 × pace m/s | `player.refreshCeilings` |
| acceleration | Acceleration ceiling: 3 + 0.15 × acceleration m/s² | `player.refreshCeilings` |
| agility | Turn-rate ceiling — a low-agility player arcs instead of pivoting | `player.refreshCeilings`, `player.stepPlayer` |
| stamina | Rate of stamina drain and the late-game 1–3% speed decay | `player.drainStamina`, `player.refreshCeilings` |
| strength | Half the strike-pace ceiling; carrier duel resistance | `match.strike`, `match.contestCarrier` |
| jumpReach | *M5* — aerial duel reach | |
| balance | Turn rate under load | `player.refreshCeilings` |

## Goalkeeping

| Attribute | Mechanic | Where |
|---|---|---|
| reflexes | *M4* — p(save) in the save model | |
| handling | *M4* — held vs parried, and where a parry goes | |
| commandOfArea | Claim radius on a loose ball in the six-yard box (M4: crosses) | `match.keeperClaim` |
| kicking | *M4* — distribution range and accuracy | |
