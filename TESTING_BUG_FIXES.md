# Testing Guide: Bug Fixes

## Quick Test Scenarios

### Test 1: Contract Role Enforcement (Bug 3) - CRITICAL

**Objective:** Verify that contract role is strictly enforced during contract period, especially for older players.

**Steps:**
1. Start a new career
2. Play until age 37
3. At end of season, accept a **Star** contract offer
4. Verify in next season:
   - Player role shows as "Star" (not Bench/Rotation)
   - Player gets Star-level playing time (~34 games)
   - Season summary shows Star performance

**Expected Result:** Player plays as Star for entire contract duration, regardless of age-based rating decline.

**Failure Indicator:** Player shows as Bench/Rotation despite Star contract.

---

### Test 2: Injury Season Tag (Bug 2) - QUICK

**Objective:** Verify injury season badge only shows when player actually missed 15+ games.

**Steps:**
1. Play a season with minimal injuries (gamesMissed < 15)
2. Check season summary - "Injury Season" badge should NOT appear
3. Play another season with major injuries (gamesMissed >= 15)
4. Check season summary - "Injury Season" badge SHOULD appear

**Expected Result:** Badge appears only when gamesMissed >= 15.

**Failure Indicator:** Badge appears even with <15 games missed.

---

### Test 3: International Tournament Winners (Bug 1) - ADVANCED

**Objective:** Verify international tournament mechanics with nation reputation tiers.

**Steps:**

#### Part A: Lesser-Known Nation Win
1. Start career with **Greece** (Tier 4 nation)
2. Play until international tournament season
3. Win tournament (may require multiple attempts due to low probability)
4. Check:
   - Fame boost is +12 (not +3)
   - Reputation boost is +8
   - Log shows "elite clubs want to sign the international champion"

#### Part B: Elite Nation Win
1. Start career with **England** (Tier 1 nation)
2. Play until international tournament season
3. Win tournament
4. Check:
   - Fame boost is +3 (not +12)
   - Reputation boost is +8
   - Transfer offers may still come, but less likely

#### Part C: Transfer Protocol
1. Win international tournament with any nation
2. Achieve fame >= 60
3. Play until end of season
4. Check:
   - If at non-Elite club, transfer offers should appear
   - Reason should mention "international champion"
   - With high agent influence, chance increases

**Expected Result:** Lesser-known nations get higher fame boost and more transfer interest.

**Failure Indicator:** All nations get same fame boost, or no transfer offers appear.

---

## Detailed Test Checklist

### Bug 3: Contract Role (Priority: CRITICAL)

- [ ] Sign Star contract at age 37
- [ ] Verify role = "Star" in next season
- [ ] Verify playing time matches Star level (~34 games)
- [ ] Verify season rating reflects Star performance
- [ ] Refuse contract offer and stay
- [ ] Verify role can drop after refusal
- [ ] Sign Starter contract at age 35
- [ ] Verify role = "Starter" for contract duration
- [ ] Test with different agents (high influence should help)

### Bug 2: Injury Season (Priority: HIGH)

- [ ] Play season with 0-14 games missed
- [ ] Verify no "Injury Season" badge
- [ ] Play season with 15+ games missed
- [ ] Verify "Injury Season" badge appears
- [ ] Test with different injury proneness levels
- [ ] Verify badge appears only based on gamesMissed, not injuryProneSeasons flag

### Bug 1: International Winners (Priority: MEDIUM)

- [ ] Win tournament with Tier 1 nation (Brazil, Germany, etc.)
  - [ ] Fame boost = +3
  - [ ] Reputation boost = +8
  
- [ ] Win tournament with Tier 2 nation (Netherlands, Belgium, etc.)
  - [ ] Fame boost = +5
  - [ ] Reputation boost = +8
  
- [ ] Win tournament with Tier 3 nation (Japan, Egypt, etc.)
  - [ ] Fame boost = +8
  - [ ] Reputation boost = +8
  
- [ ] Win tournament with Tier 4 nation (Greece, New Zealand, etc.)
  - [ ] Fame boost = +12
  - [ ] Reputation boost = +8
  - [ ] Transfer offers from Elite clubs
  
- [ ] Test transfer protocol
  - [ ] International trophy winner + high fame = transfer offers
  - [ ] High agent influence increases transfer chance
  - [ ] Only triggers at non-Elite clubs
  - [ ] Only triggers if age <= 32

---

## Console Logging for Verification

You can add temporary console logs to verify fixes:

```javascript
// For Bug 3 (Contract Role)
console.log("Contract Role:", state.contractRole, "Years Left:", state.contractYears, "Determined Role:", determineRole());

// For Bug 2 (Injury Season)
console.log("Games Missed:", sd.gamesMissed, "Is Injury Season:", sd.gamesMissed >= 15);

// For Bug 1 (International Winners)
console.log("Nation Tier:", getNationReputationTier(state.country), "Fame:", state.fame, "Intl Trophies:", state.honours.intlTrophies);
```

---

## Expected Behavior After Fixes

### Contract Role
- Star contract at age 37 → plays as Star
- Starter contract at age 35 → plays as Starter
- Role only changes via explicit end-of-season events

### Injury Season
- 10 games missed → no badge
- 20 games missed → badge appears
- Badge is based on current season only

### International Winners
- Greece wins tournament → +12 fame, transfer offers
- England wins tournament → +3 fame, fewer transfer offers
- Lesser-known nations get rewarded for upsets
- Transfer offers only at non-Elite clubs

---

## Regression Testing

After fixes, verify these still work:

- [ ] Young players still get promoted to bigger clubs
- [ ] Older players still decline naturally (outside contract period)
- [ ] Injury events still trigger properly
- [ ] Transfer offers still appear for good performances
- [ ] International tournaments still award trophies
- [ ] Fame still affects transfer offers
- [ ] Agent influence still helps negotiations

---

## Known Limitations

1. **Contract Role Enforcement:** Only works during active contract period. Once contract expires, natural role calculation applies.

2. **Injury Season Tag:** Only checks gamesMissed >= 15. Doesn't distinguish between different injury types.

3. **International Winners:** Tier 4 nations have 5% chance to win, which means they'll rarely win. This is intentional to maintain realism.

---

## Reporting Issues

If you find issues:

1. Note the exact steps to reproduce
2. Include player age, nation, reputation, fame
3. Include contract details (role, years remaining)
4. Include season details (games missed, performance)
5. Include log output if available

---

**Last Updated:** July 26, 2026
