# Bug Fixes Plan

## Bug 1: International Tournament Winners

**Issue:** International winners should be based on the provided list. Modern teams (less known nations) should have lower chance to win. Higher reputation nations who win get more fame and are more likely to be transferred by bigger clubs.

**Current Code:** Lines 3139-3152 in game.js
- TOURNAMENT_WINNERS list exists but doesn't account for nation reputation
- No fame boost for winning with lesser-known nations
- No transfer protocol based on international success

**Fix:**
1. Add nation reputation/strength to TOURNAMENT_WINNERS logic
2. Boost fame more for lesser-known nations winning tournaments
3. Implement transfer protocol: bigger clubs offer transfers if player had good season + high fame + agent impact

**Files to Modify:**
- `src/game.js` (TOURNAMENT_WINNERS, canWinTournament, simulateInternational, transfer logic)

---

## Bug 2: Injury Season Tag

**Issue:** Injury season tag displays even if player wasn't actually injured in the season. Should check if there was already an injury in the logs before displaying.

**Current Code:** Line 4710 in game.js
```javascript
const isInjurySeason = state.injuryProneSeasons > 0 && sd.gamesMissed >= 15;
```

**Problem:** This checks `injuryProneSeasons > 0` (a flag) but doesn't verify actual injuries occurred in the careerLog.

**Fix:**
Check careerLog for actual injury events before displaying the badge.

**Files to Modify:**
- `src/game.js` (renderSeasonSummary, isInjurySeason logic)

---

## Bug 3: Contract Role Not Enforced (Age 37+)

**Issue:** After age 37, 38, 39+, teams offer "STAR player" but only play them as Bench or Rotation. Contract agreement should be hard-coded unless end-of-season events (refuse and stay) change it.

**Current Code:** Line 2231-2238 in game.js
```javascript
function determineRole() {
  let role = determineNaturalRole(state.club);
  if (state.contractRole && roleRank(role) < roleRank(state.contractRole)) {
    role = state.contractRole;
  }
  return role;
}
```

**Problem:** 
- `determineNaturalRole()` recalculates role every season based on agedRating()
- For older players, agedRating() drops significantly, so natural role becomes Bench/Rotation
- Contract role is only used as a floor if natural role is lower, but natural role can override it downward
- This happens at line 2353: `state.role = determineRole();` which recalculates every season

**Fix:**
- Once a contract is signed with a specific role, that role should be enforced for the contract duration
- Only allow role changes through explicit end-of-season events (refuse, stay, etc.)
- Add `contractRoleEnforced` flag to ensure contract role is respected

**Files to Modify:**
- `src/game.js` (determineRole, simulateSeason, contract signing logic)

---

## Implementation Order

1. **Bug 3 (Contract Role)** - Most critical, affects gameplay
2. **Bug 2 (Injury Season Tag)** - Visual/display issue, quick fix
3. **Bug 1 (International Winners)** - Gameplay enhancement, more complex

---

## Testing Plan

### Bug 1: International Winners
- Play career with lesser-known nation
- Win international tournament
- Verify fame boost is higher than with strong nation
- Verify transfer offers come from bigger clubs

### Bug 2: Injury Season Tag
- Play season with no injuries
- Verify "Injury Season" badge doesn't appear
- Play season with injuries
- Verify badge appears only if actual injuries in log

### Bug 3: Contract Role
- Sign Star contract at age 37
- Verify player plays as Star (not Bench/Rotation)
- Refuse contract offer and stay
- Verify role can drop to Rotation/Bench after refusal

---

## Files to Modify

1. `src/game.js` — Main game engine
   - determineRole() function
   - simulateSeason() function
   - renderSeasonSummary() function
   - simulateInternational() function
   - canWinTournament() function
   - Transfer protocol logic

---

## Estimated Complexity

- Bug 3: Medium (requires careful state management)
- Bug 2: Low (simple careerLog check)
- Bug 1: Medium (requires transfer protocol implementation)

Total: ~200 lines of code changes
