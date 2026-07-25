# 1000-Goal Challenge — Implementation Guide

**Date:** July 25, 2026 | **Status:** Ready for Implementation | **Difficulty:** Medium

---

## Overview

This guide provides step-by-step instructions to implement the tweaks needed to make the 1000-goal challenge a true legendary achievement.

---

## Phase 1: Core Multiplier Fixes

### Step 1.1: Reduce Conversion Multiplier

**File:** `game.js`
**Location:** Line ~188 (LEVERS object)

```javascript
// BEFORE
const LEVERS = {
  startRerolls: 3,
  goalTarget: 1000,
  conversionMultiplier: 1.085,  // ← CHANGE THIS
  primeWindow: [25, 29],
  // ...
};

// AFTER
const LEVERS = {
  startRerolls: 3,
  goalTarget: 1000,
  conversionMultiplier: 0.98,   // ← REDUCED
  primeWindow: [25, 29],
  // ...
};
```

**Impact:** Reduces goal inflation by ~7%, makes finishing attribute more important

### Step 1.2: Update Foreign League Multipliers

**File:** `game.js`
**Location:** Line ~206 (LEAGUE_WEIGHTS object)

```javascript
// BEFORE
const LEAGUE_WEIGHTS = {
  Elite:         { goals: 1.0,  ... },
  Europe:        { goals: 1.0,  ... },
  LaLiga:        { goals: 1.08, ... },  // ← CHANGE
  Bundesliga:    { goals: 1.10, ... },  // ← CHANGE
  MLS:           { goals: 1.12, ... },  // ← CHANGE
  Saudi:         { goals: 1.15, ... },  // ← CHANGE
  // ...
};

// AFTER
const LEAGUE_WEIGHTS = {
  Elite:         { goals: 1.0,  ... },
  Europe:        { goals: 1.0,  ... },
  LaLiga:        { goals: 1.04, ... },  // ← REDUCED
  Bundesliga:    { goals: 1.05, ... },  // ← REDUCED
  MLS:           { goals: 1.06, ... },  // ← REDUCED
  Saudi:         { goals: 1.07, ... },  // ← REDUCED
  // ...
};
```

**Impact:** Foreign league advantage becomes realistic (+4-7% vs +8-15%)

---

## Phase 2: Attribute & Prime Window Tweaks

### Step 2.1: Reduce Finishing Modifier

**File:** `game.js`
**Location:** Line ~2430 (in `playSeason` function, goal calculation)

```javascript
// BEFORE
const finishingMod = (scenario.config.finishing - 70) / 30;
let seasonGoals = Math.round(baseGoals * (1 + finishingMod * 0.5) * ...);
//                                                         ↑ 0.5 = 50% boost

// AFTER
const finishingMod = (scenario.config.finishing - 70) / 30;
let seasonGoals = Math.round(baseGoals * (1 + finishingMod * 0.3) * ...);
//                                                         ↑ 0.3 = 30% boost
```

**Impact:** Finishing attribute less dominant, requires balanced attributes

### Step 2.2: Update Prime Window Bonus

**File:** `game.js`
**Location:** Line ~2430 (in `playSeason` function, after base goals)

```javascript
// BEFORE
if (age >= 25 && age <= 29) {
  baseGoals += 10;
  if (leagueWeight.goals > 1.0) baseGoals += 5;
}

// AFTER
if (age >= 25 && age <= 29) {
  baseGoals += 5;  // Base prime bonus
  if (mentality === "Talisman") baseGoals += 3;
  if (mentality === "Big Game Player") baseGoals += 2;
  if (hasTrait("Clinical Finisher")) baseGoals += 2;
  if (leagueWeight.goals > 1.0) baseGoals += 2;  // Reduced from 5
}
```

**Impact:** Prime window bonus becomes conditional on mentality/traits

### Step 2.3: Add Age-Based Apps Scaling

**File:** `game.js`
**Location:** Line ~2350 (in `playSeason` function, apps calculation)

```javascript
// BEFORE
let apps = 30 + randInt(0, 8);
if (state.age >= 32) apps = Math.max(20, apps - randInt(2, 5));
if (state.age >= 35) apps = Math.max(15, apps - randInt(3, 8));

// AFTER
let apps = 30 + randInt(0, 8);
// More aggressive age-based reduction
if (state.age >= 32) apps = Math.round(apps * 0.85);  // 25-32 apps
if (state.age >= 34) apps = Math.round(apps * 0.75);  // 22-28 apps
if (state.age >= 36) apps = Math.round(apps * 0.60);  // 18-23 apps
if (state.age >= 38) apps = Math.round(apps * 0.40);  // 12-15 apps
```

**Impact:** Realistic decline in playing time with age

---

## Phase 3: Final Season Logic

### Step 3.1: Implement Conditional Final Season Event

**File:** `game.js`
**Location:** Line ~2430 (in `playSeason` function, final season bonus)

```javascript
// BEFORE
if (s === 20 && state.totalGoals >= 950) {
  seasonGoals += randInt(30, 60);
  state.events.push(`Season ${s}: Final season surge!`);
}

// AFTER
if (s === finalSeason && state.totalGoals >= 950) {
  // Only trigger if conditions are met
  const mentalityRating = state.mentalityRating || 50;
  const longevity = state.longevity || 50;
  
  if (mentalityRating >= 85 && longevity >= 80) {
    // "Golden Twilight" event
    const bonus = randInt(50, 100);
    seasonGoals += bonus;
    state.events.push(`Season ${s}: Golden Twilight! +${bonus} goals in final season`);
  } else if (mentalityRating >= 75 && longevity >= 70) {
    // "Record Chase" event (smaller bonus)
    const bonus = randInt(30, 60);
    seasonGoals += bonus;
    state.events.push(`Season ${s}: Record Chase! +${bonus} goals`);
  }
}
```

**Impact:** Final season bonus becomes conditional, requires high mentality + longevity

---

## Phase 4: Testing

### Step 4.1: Run 1000-Goal Test

```bash
node test_1000_goal_run.js
```

**Expected output:**
- Perfect roll: 950-1,050 goals
- Elite roll: 750-850 goals
- Very good roll: 500-600 goals

### Step 4.2: Run Regression Tests

```bash
node test_core_regressions.js
node test_stress.js
node stress_balance.js
```

**Expected:** All tests pass with no regressions

### Step 4.3: Verify Syntax

```bash
node --check game.js
```

**Expected:** No syntax errors

---

## Detailed Implementation Example

Here's a complete example of how the tweaks work together:

### Perfect Roll Career Path

```
SETUP:
- Finishing: 99
- Speed: 99
- Strength: 95
- Academy: World Class (growth 1.12)
- Nation: Argentina (growth 1.07)
- Agent: World Class
- Mentality: Talisman (mentalityRating 94)
- Longevity: 85

SEASON PROGRESSION:
Age 18-21: Development phase
  - 4 seasons × 60 goals = 240 goals
  - Building reputation
  - World Class agent negotiates move

Age 22-24: Transition phase
  - Move to La Liga (Real Madrid)
  - 3 seasons × 75 goals = 225 goals
  - Total: 465 goals

Age 25-29: Prime phase (CRITICAL)
  - Peak attributes + foreign league multiplier
  - Base: 35 goals/season
  - Finishing mod: (99-70)/30 = 0.97 → +29% = 45 goals
  - Prime bonus: 5 + 3 (Talisman) + 2 (Clinical Finisher) + 2 (foreign) = 12 goals
  - Total: 57 goals/season
  - 5 seasons × 57 goals = 285 goals
  - Total: 750 goals

Age 30-34: Sustained phase
  - Still elite but declining
  - 5 seasons × 40 goals = 200 goals
  - Total: 950 goals

Age 35-36: Final phase
  - Move to Saudi Arabia (Al-Nassr)
  - 2 seasons × 20 goals = 40 goals
  - Total: 990 goals

Age 37: Final season
  - Golden Twilight event triggered
  - Mentality 94 ≥ 85 ✓, Longevity 85 ≥ 80 ✓
  - Bonus: +50-100 goals
  - Final: 1,040-1,090 goals ✅

RESULT: 1,000+ goals achieved with perfect execution
```

---

## Rollback Plan

If tweaks cause issues, rollback is simple:

```bash
# Revert to previous commit
git revert HEAD

# Or manually restore LEVERS and LEAGUE_WEIGHTS to original values
```

---

## Validation Checklist

After implementation, verify:

- [ ] `conversionMultiplier` changed to 0.98
- [ ] Foreign league multipliers reduced (1.04-1.07)
- [ ] Age-based apps scaling implemented
- [ ] Finishing modifier reduced to 0.3
- [ ] Prime window bonus conditional on mentality/traits
- [ ] Final season event conditional on mentalityRating + longevity
- [ ] test_1000_goal_run.js shows expected results
- [ ] All regression tests pass
- [ ] No syntax errors in game.js

---

## Success Metrics

After implementation, the 1000-goal challenge should:

| Metric | Target | Success Criteria |
|--------|--------|------------------|
| Perfect roll success rate | 5-10% | Achieves 950-1,050 goals |
| Elite roll success rate | 20-30% | Achieves 750-850 goals |
| Very good roll success rate | 50-60% | Achieves 500-600 goals |
| Goals/game ratio | 1.2-1.5 | Realistic vs real players |
| Prime window importance | High | Mentality/traits matter |
| Final season impact | 5-10% | Conditional bonus |
| Overall difficulty | Hard | Feels legendary |

---

## Timeline

| Phase | Task | Time | Status |
|-------|------|------|--------|
| 1 | Multiplier fixes | 15 min | Ready |
| 2 | Attribute tweaks | 20 min | Ready |
| 3 | Final season logic | 15 min | Ready |
| 4 | Testing | 30 min | Ready |
| **Total** | **Implementation** | **~80 min** | **Ready** |

---

## Questions & Answers

**Q: Why reduce conversionMultiplier?**
A: It was inflating goals artificially. Reducing to 0.98 makes finishing attribute more important and goal conversion more realistic.

**Q: Why reduce foreign league multipliers?**
A: Real-world data shows foreign leagues provide 4-7% advantage, not 8-15%. This makes the advantage meaningful but not game-breaking.

**Q: Why make final season event conditional?**
A: Ensures only truly elite players (high mentality + longevity) get the bonus, making 1000 goals feel legendary.

**Q: Will this break existing saves?**
A: No. These changes only affect new careers. Existing saves will continue with their current state.

**Q: Can I test before committing?**
A: Yes. Make changes, run test_1000_goal_run.js, verify results, then commit.

---

## Support

If you encounter issues:

1. Check syntax: `node --check game.js`
2. Run tests: `node test_1000_goal_run.js`
3. Check git diff: `git diff game.js`
4. Revert if needed: `git checkout game.js`

---

*Implementation Guide | July 25, 2026*
*Ready for development*
