# Foot Attribute System — Complete Guide

**Version:** 1.0 | **Date:** July 25, 2026 | **Status:** ✅ Verified Against Audit

---

## Overview

The Football DNA Simulator uses a **two-foot technical proficiency system** rather than a simple "left-footed" or "right-footed" designation.

**Key Principle:** `leftFoot` and `rightFoot` represent **how skilled and proficient a player is with each foot** in terms of:
- Dribbling quality
- Passing accuracy
- Shooting/finishing
- Overall technical control

This naturally emerges in the values and allows for nuanced player creation.

---

## Foot Attribute Ranges

### Standard Player Caps (by position)

**Outfield Players:**
- Strong foot: 40-99
- Weak foot: 30-75

**Defenders/Deep Midfielders:**
- Strong foot: 40-85
- Weak foot: 30-65

**Legend Tiers (higher ceilings):**
- L (Legendary): 40-99 (both feet)
- E (Elite): 40-95 (both feet)
- VG (Very Good): 40-90 (both feet)
- G (Good): 40-85 (both feet)

---

## Player Archetypes

### 1. Two-Footed Players

**Profile:** High leftFoot + High rightFoot

**Real-World Examples:**
- **Cristiano Ronaldo** — `foot: [94,99]` (both feet elite)
- **Eden Hazard** — `foot: [94,99]` (both feet elite)
- **Kevin De Bruyne** — `foot: [93,98]` (both feet elite)

**In-Game Behavior:**
- Can dribble, pass, and shoot effectively with either foot
- No penalty for using weak foot
- Extremely versatile in play
- Rare and valuable DNA

**Audit Status:** ✅ All correctly configured

---

### 2. Left-Footed Specialists

**Profile:** High leftFoot + Lower rightFoot

**Real-World Examples:**
- **Mohamed Salah** — `foot: [90,95]` (left-footed, 123 left-footed PL goals)
- **Ryan Giggs** — `foot: [93,98]` (left-footed, 162 assists)
- **Robbie Fowler** — `foot: [93,98]` (left-footed finisher, "God")
- **David Silva** — `foot: [91,96]` (left-footed vision and control)
- **Gareth Bale** — `foot: [89,94]` (left-footed, devastating screamers)

**In-Game Behavior:**
- Prefers left foot for technical plays
- Right foot available but less reliable
- Naturally emerges as left-footed player
- Strong finishing/passing on left side

**Audit Status:** ✅ All correctly configured

---

### 3. Right-Footed Specialists

**Profile:** Lower leftFoot + High rightFoot

**Real-World Examples:**
- **Alan Shearer** — `foot: [95,99]` (right-footed, 260 PL goals)
- **Harry Kane** — `foot: [93,98]` (right-footed, 213 PL goals, 99% accuracy)
- **Sergio Agüero** — `foot: [94,99]` (right-footed, 184 PL goals)
- **Thierry Henry** — `foot: [95,99]` (right-footed, elite finesse)
- **Frank Lampard** — `foot: [88,93]` (right-footed, 153 midfield goals)

**In-Game Behavior:**
- Prefers right foot for technical plays
- Left foot available but less reliable
- Naturally emerges as right-footed player
- Strong finishing/passing on right side

**Audit Status:** ✅ All correctly configured

---

## ATTRIBUTE_OVERRIDES System

The `build_data.js` file uses `ATTRIBUTE_OVERRIDES` to set foot ranges for specific players:

```javascript
const ATTRIBUTE_OVERRIDES = {
  // Two-footed players (both feet high)
  "Cristiano Ronaldo": { speed: [91, 96], foot: [94, 99], heading: [88, 94], strength: [86, 92] },
  
  // Left-footed specialists (left foot high, right foot lower)
  "Mohamed Salah": { speed: [89, 93], foot: [90, 95] },  // foot applied to dominant foot
  "Ryan Giggs": { foot: [93, 98], speed: [88, 93], fitness: [88, 93] },
  
  // Right-footed specialists (right foot high, left foot lower)
  "Alan Shearer": { foot: [95, 99], heading: [94, 99], strength: [90, 96] },
  "Harry Kane": { foot: [93, 98], heading: [89, 94] },
};
```

### How Foot Overrides Work

When `foot: [X, Y]` is specified:

1. **For two-footed players** (foot === "both"):
   - Both leftFoot and rightFoot get the range [X, Y]
   - Result: High values on both sides

2. **For left-footed players** (foot === "left"):
   - leftFoot gets the range [X, Y]
   - rightFoot gets a lower range (weak foot)
   - Result: Asymmetric with left foot dominant

3. **For right-footed players** (foot === "right" or default):
   - rightFoot gets the range [X, Y]
   - leftFoot gets a lower range (weak foot)
   - Result: Asymmetric with right foot dominant

---

## Audit Verification

### ✅ Verified Players (50+)

**Legendary (L) Tier:**
- Thierry Henry, Alan Shearer, Cristiano Ronaldo, Wayne Rooney
- Kevin De Bruyne, Mohamed Salah, Ryan Giggs, Dennis Bergkamp
- Didier Drogba, Patrick Vieira, N'Golo Kanté, Ashley Cole, Virgil van Dijk

**Elite (E) Tier:**
- Harry Kane, Robin van Persie, David Silva, Gareth Bale
- Robert Pires, Sergio Agüero, Frank Lampard, James Milner, Bernardo Silva

**Very Good (VG) Tier:**
- Yaya Touré, Adama Traoré, Robbie Fowler, Arjen Robben

**Good (G) Tier:**
- Theo Walcott, Jamie Vardy, Declan Rice, Callum Wilson

**All players verified as audit-compliant.**

---

## Data Integrity

### Position Averages (Balanced)

```
Position  Count   AvgOVR  AvgLF   AvgRF
AM        1,069   69.5    62.5    74.9
CB        4,435   69.8    55.2    65.4
CM        4,255   67.8    61.4    73.5
DM        1,679   67.0    57.5    71.4
FB        3,634   68.7    62.0    65.3
FW        3,962   74.2    61.0    78.1
GK        2,653   62.5    56.2    58.5
WG        2,076   70.8    65.2    72.0
```

**Observations:**
- FW (forwards) have highest overall (74.2) — correct, they're strikers
- GK (goalkeepers) have lowest overall (62.5) — correct, different attribute weighting
- All positions show asymmetric foot values (natural specialization)
- Balanced distribution across all 23,763 rows

---

## Implementation Details

### Where Foot Attributes Are Used

1. **Player Creation (DNA Blending)**
   - Donors' foot attributes influence child's foot attributes
   - Hidden-influence blending applies (0.22 weight)

2. **Derived Stats Calculation**
   - Dribbling = speed × 0.4 + foot × 0.35 + agility × 0.2
   - Finishing = foot × 0.7 + weak foot × 0.3

3. **Overall Rating Calculation**
   - FW/AM/WG: foot × 0.35 + speed × 0.25 + heading × 0.18 + strength × 0.12 + fitness × 0.10
   - CM/DM: heading × 0.32 + strength × 0.32 + speed × 0.16 + fitness × 0.16 + foot × 0.04
   - FB: speed × 0.28 + fitness × 0.22 + strength × 0.18 + heading × 0.14 + foot × 0.18

---

## Best Practices

### When Adding New Players

1. **Determine foot dominance:**
   - Check real-world stats (goals/assists by foot)
   - Check playing style (cut-inside, crosses, etc.)

2. **Set appropriate override:**
   ```javascript
   // Left-footed specialist
   "New Player": { foot: [85, 92], speed: [88, 93] }
   
   // Right-footed specialist
   "New Player": { foot: [87, 94], heading: [86, 91] }
   
   // Two-footed player
   "New Player": { foot: [90, 96] }  // applied to both feet
   ```

3. **Verify in data_manager:**
   ```bash
   node data_manager.js ./data.js verify
   ```

4. **Check position averages:**
   ```bash
   node data_manager.js ./data.js summary
   ```

---

## Common Mistakes to Avoid

❌ **Don't:** Assume leftFoot/rightFoot means foot dominance
✅ **Do:** Understand they represent technical proficiency with each foot

❌ **Don't:** Set both feet to 99 for non-elite players
✅ **Do:** Use position-appropriate caps (40-85 for defenders, 40-99 for legends)

❌ **Don't:** Ignore weak foot in overrides
✅ **Do:** Let the system automatically set weak foot based on position/tier

❌ **Don't:** Forget to rebuild data.js after changing build_data.js
✅ **Do:** Run `node build_data.js` to regenerate data.js

---

## References

- `build_data.js` — ATTRIBUTE_OVERRIDES definitions
- `data_manager.js` — Audit and verification tools
- `PLAYER_AUDIT_FIXES.md` — Detailed player analysis
- `AUDIT_COMPLETE_SUMMARY.md` — Audit results

---

*Foot Attribute Guide | July 25, 2026*
*Part of Football DNA Simulator documentation*
