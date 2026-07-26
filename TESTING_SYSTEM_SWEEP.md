# Testing Guide: System Sweep Fixes

## Quick Test Scenarios

### Test 1: Game Time at 37+ (CRITICAL)

**Objective:** Verify that players 37+ can play 25+ games with high fitness/speed.

**Setup:**
1. Start new career
2. Play until age 37
3. Sign Star contract
4. Check player stats (fitness, speed, strength)

**Test Case A: High Fitness Veteran**
- Fitness: 85+
- Speed: 80+
- Strength: 75+
- Expected games: 30-34
- ✅ PASS if games >= 25
- ❌ FAIL if games < 15

**Test Case B: Low Fitness Veteran**
- Fitness: 40
- Speed: 40
- Strength: 40
- Expected games: 10-15
- ✅ PASS if games <= 20
- ❌ FAIL if games >= 25

**Test Case C: Mid-Range Veteran**
- Fitness: 65
- Speed: 65
- Strength: 65
- Expected games: 20-25
- ✅ PASS if 18 <= games <= 28

**Verification:**
1. Check season summary: "Apps" field
2. Verify games played matches expectations
3. Check if player can accumulate goals (not stuck at 0)

---

### Test 2: Ballon d'Or Difficulty (HIGH PRIORITY)

**Objective:** Verify Ballon d'Or is much harder to win.

**Test Case A: Championship Success (Should FAIL)**
- League: Championship
- Goals: 30
- Rating: 8.5
- Reputation: 70
- Performance: Sensational
- Golden Boot: Yes
- Expected: ❌ NO Ballon d'Or
- ✅ PASS if no award
- ❌ FAIL if award given

**Test Case B: Premier League Success (Should PASS)**
- League: Premier League (Elite)
- Goals: 30
- Rating: 8.5
- Reputation: 70
- Performance: Sensational
- Golden Boot: Yes
- Expected: ✅ YES Ballon d'Or
- ✅ PASS if award given
- ❌ FAIL if no award

**Test Case C: Low Reputation (Should FAIL)**
- League: Premier League
- Goals: 30
- Rating: 8.5
- Reputation: 60 (< 70)
- Performance: Sensational
- Golden Boot: Yes
- Expected: ❌ NO Ballon d'Or
- ✅ PASS if no award
- ❌ FAIL if award given

**Test Case D: International Path (Should PASS)**
- League: Premier League
- Goals: 20
- Rating: 7.8
- Reputation: 70
- Performance: Sensational
- Won International Trophy: Yes
- Golden Boot: Yes
- Expected: ✅ YES Ballon d'Or
- ✅ PASS if award given
- ❌ FAIL if no award

**Test Case E: No Major Award (Should FAIL)**
- League: Premier League
- Goals: 30
- Rating: 8.5
- Reputation: 70
- Performance: Sensational
- Golden Boot: No
- European Cup: No
- Expected: ❌ NO Ballon d'Or
- ✅ PASS if no award
- ❌ FAIL if award given

**Verification:**
1. Check season summary: "Awards" section
2. Look for "Ballon d'Or" badge
3. Check career legacy screen for award count

---

## Detailed Test Checklist

### Game Time (Priority: CRITICAL)

- [ ] Age 37, high fitness (85+) → 30+ games
- [ ] Age 38, high fitness (85+) → 28+ games
- [ ] Age 39, high fitness (85+) → 25+ games
- [ ] Age 40, high fitness (85+) → 20+ games
- [ ] Age 38, low fitness (40) → 10-15 games
- [ ] Age 38, mid fitness (65) → 18-25 games
- [ ] High durability pillar → +5-10% games
- [ ] Low durability pillar → -5-10% games
- [ ] Star contract enforced → plays as Star
- [ ] Can accumulate goals at 37+

### Ballon d'Or (Priority: HIGH)

- [ ] Championship league → NO award
- [ ] Premier League + all conditions → YES award
- [ ] Premier League + low reputation → NO award
- [ ] Premier League + low rating → NO award
- [ ] Premier League + low goals → NO award
- [ ] Premier League + no major award → NO award
- [ ] International trophy path → YES award
- [ ] La Liga elite performance → YES award
- [ ] Serie A elite performance → YES award
- [ ] Bundesliga elite performance → YES award
- [ ] Ligue 1 elite performance → YES award
- [ ] Lower league (even Sensational) → NO award

### Regression Tests

- [ ] Young players still develop normally
- [ ] Prime players (25-29) still peak
- [ ] Golden Boot still awarded correctly
- [ ] Player of Season still awarded correctly
- [ ] International tournaments still work
- [ ] Contract enforcement still works
- [ ] Injury system still works
- [ ] Transfer offers still appear

---

## Console Logging for Verification

Add these temporary logs to verify fixes:

```javascript
// For game time
console.log("Age:", state.age, "Fitness:", fitness, "Speed:", speed, "Strength:", strength);
console.log("Fitness Mult:", fitnessMult, "Athletic Mult:", athleticMult, "Durability Mult:", durabilityMult, "Age Mult:", ageMult);
console.log("Appearance Chance:", appearanceChance, "Games Played:", sd.apps);

// For Ballon d'Or
console.log("Elite League:", isEliteLeague, "High Rating:", hasHighRating, "High Goals:", hasHighGoals);
console.log("High Rep:", hasHighReputation, "Sensational:", isSensational, "Intl Trophy:", wonIntlTrophy);
console.log("Top Scorer:", isTopScorer, "European Cup:", honoursThisSeason.includes("European Cup"));
console.log("Qualifies Elite:", qualifiesViaElitePerformance, "Qualifies Intl:", qualifiesViaIntlSuccess);
```

---

## Expected Behavior After Fixes

### Game Time
- Star at 37 with high fitness: 30-34 games
- Star at 38 with high fitness: 28-32 games
- Star at 39 with high fitness: 25-30 games
- Star at 40 with high fitness: 20-28 games
- Fitness/speed/strength are primary factors
- Age is gentle modifier only

### Ballon d'Or
- Requires Elite league (5 leagues only)
- Requires 8.0+ rating OR international trophy
- Requires 25+ goals (20+ if intl trophy)
- Requires 70+ reputation
- Requires Sensational/Overperformed
- Requires Golden Boot OR European Cup
- Extremely rare (maybe 1 per 10 careers)

---

## Known Limitations

1. **Game Time:** Still affected by injuries and role
2. **Ballon d'Or:** Still requires Sensational performance (can't win with Overperformed alone if rating < 8.0)

---

## Reporting Issues

If tests fail:

1. Note exact age, fitness, speed, strength
2. Note league and performance tier
3. Note all awards and honours
4. Include season summary screenshot
5. Include console logs if available

---

## Test Execution Order

1. **First:** Test game time at 37+ (most critical)
2. **Second:** Test Ballon d'Or requirements
3. **Third:** Run regression tests
4. **Fourth:** Test edge cases

---

## Success Criteria

### Game Time Fix
- ✅ Players 37+ with high fitness can play 25+ games
- ✅ Players 37+ with low fitness play 10-15 games
- ✅ Can reach 1000 goals by age 40-41 with good stats
- ✅ Fitness/speed/strength are primary factors

### Ballon d'Or Fix
- ✅ Championship players never win Ballon d'Or
- ✅ Premier League players need 8.0+ rating + 25+ goals + 70+ rep
- ✅ International trophy winners need 20+ goals + 70+ rep
- ✅ All winners need Golden Boot or European Cup
- ✅ Award is rare (< 10% of careers)

---

**Last Updated:** July 26, 2026
