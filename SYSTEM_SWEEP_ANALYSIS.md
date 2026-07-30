# System Sweep Analysis: Game Time & Ballon d'Or Issues

## Issue 1: Game Time Capping at 37+ (CRITICAL)

### Root Cause Analysis

**Problem:** Players age 37+ get 0 games despite having Star contracts.

**Multiple Compounding Factors:**

1. **Age Modifier Collapse (Line 2071)**
   ```javascript
   else base = Math.max(0.45, 0.84 - (age - 32) * 0.045);
   // At age 37: 0.84 - (37-32)*0.045 = 0.84 - 0.225 = 0.615
   // At age 38: 0.84 - (38-32)*0.045 = 0.84 - 0.27 = 0.57
   // At age 39: 0.84 - (39-32)*0.045 = 0.84 - 0.315 = 0.525
   // At age 40: 0.84 - (40-32)*0.045 = 0.84 - 0.36 = 0.48
   // At age 41: 0.84 - (41-32)*0.045 = 0.84 - 0.405 = 0.435 (hits floor)
   ```
   This affects `agedRating()` which is used in `determineNaturalRole()`.

2. **Appearance Chance Multipliers (Lines 2365-2368)**
   ```javascript
   if (state.age >= 32) appearanceChance *= 0.85;  // -15%
   if (state.age >= 34) appearanceChance *= 0.75;  // -25%
   if (state.age >= 36) appearanceChance *= 0.60;  // -40%
   if (state.age >= 38) appearanceChance *= 0.40;  // -60%
   ```
   **Cumulative Effect at Age 38:**
   - Base Star: 0.97
   - After 32: 0.97 × 0.85 = 0.8245
   - After 34: 0.8245 × 0.75 = 0.618
   - After 36: 0.618 × 0.60 = 0.371
   - After 38: 0.371 × 0.40 = 0.148 (14.8% chance to play!)

3. **Role Downgrade Due to Rating Decline**
   - `agedRating()` drops significantly
   - `determineNaturalRole()` uses agedRating to calculate role
   - Even with Star contract, if `contractYears = 0`, natural role becomes Bench/Rotation
   - Bench role has 0.3 base appearance chance, then multiplied by 0.40 = 0.12 (12%)

### Why It's Broken

The system treats age as a primary factor for game time, but:
- **Fitness, Speed, Strength** should be the real drivers
- **Age is just a modifier**, not a hard cap
- **Contract role should be enforced** (already fixed in previous bug fix)
- **Appearance chance multipliers are too aggressive** for ages 37+

### Solution

1. **Reduce age-based appearance multipliers** for 37+
2. **Make fitness/speed/strength the primary factors** for game time
3. **Ensure contract role is enforced** (already done)
4. **Add durability pillar bonus** to offset age decline

---

## Issue 2: Ballon d'Or Too Easy (CRITICAL)

### Current Logic (Lines 2564-2568)

```javascript
const ballonDorScore = seasonRating * 12 + 
                      (champion === club ? 20 : 0) + 
                      (honoursThisSeason.includes("European Cup") ? 15 : 0) + 
                      (isTopScorer ? 20 : 0) + 
                      state.reputation * 0.15;
if (ballonDorScore >= 145 && (perfTier === "Sensational" || perfTier === "Overperformed")) {
  state.honours.ballonDors++; awards.push("Ballon d'Or");
}
```

### Problems

1. **No league tier requirement**
   - Players in Championship/League1 can win Ballon d'Or
   - Should require Elite league (Premier League, La Liga, Serie A, Bundesliga)

2. **Threshold too low (145 points)**
   - seasonRating ranges 5.3-9.9
   - At 9.9: 9.9 × 12 = 118.8
   - Add reputation (70) × 0.15 = 10.5
   - Total: 129.3 (close to threshold)
   - Easy to hit with Sensational season

3. **Missing international success requirement**
   - Should require either:
     - Top tier league + high rating + goals, OR
     - International trophy win + high reputation

4. **Missing award requirement**
   - Should require at least one major award (Golden Boot, Player of Season, etc.)

### Solution

Ballon d'Or should require:
1. **Elite league** (Premier League, La Liga, Serie A, Bundesliga, Ligue 1)
2. **High rating** (8.0+) OR **International trophy win**
3. **High goals** (25+) OR **Major award** (Golden Boot, Player of Season)
4. **High reputation** (70+)
5. **Sensational/Overperformed** performance

---

## Files to Modify

1. `src/game.js`
   - `getAgeModifier()` — Keep age modifier but reduce decline
   - `simulateSeason()` — Fix appearance chance multipliers
   - `applySeasonalAttributeChanges()` — Enhance Ballon d'Or logic
   - `determineNaturalRole()` — Already fixed, but verify

---

## Testing Plan

### Game Time Issue
1. Create Star contract at age 37
2. Verify games played >= 25 (not 0)
3. Test with low fitness/speed (should reduce games)
4. Test with high durability pillar (should increase games)

### Ballon d'Or Issue
1. Play Sensational season in Championship
2. Verify NO Ballon d'Or (should require Elite league)
3. Play Sensational season in Premier League with 30 goals
4. Verify Ballon d'Or only if reputation >= 70 AND major award

---

## Expected Impact

### Game Time Fix
- Players 37-40 can reach 1000 goals if:
  - High fitness/speed/strength
  - Star contract
  - Elite league
  - Good mentality

### Ballon d'Or Fix
- Much rarer award
- Requires multiple conditions
- More prestigious
- Better reflects real-world difficulty

---

## Implementation Priority

1. **HIGH:** Fix appearance chance multipliers (age 37+)
2. **HIGH:** Fix Ballon d'Or requirements
3. **MEDIUM:** Adjust age modifier decline rate
4. **MEDIUM:** Add fitness/speed/strength factors to game time

---

## Code Changes Summary

**Lines to Modify:**
- Line 2071: `getAgeModifier()` — Adjust decline rate
- Lines 2365-2368: `simulateSeason()` — Reduce age multipliers
- Lines 2363: `simulateSeason()` — Add fitness/speed factors
- Lines 2564-2568: `applySeasonalAttributeChanges()` — Rewrite Ballon d'Or logic

**Total Lines:** ~30-40 lines modified

---

**Status:** Analysis Complete - Ready for Implementation
