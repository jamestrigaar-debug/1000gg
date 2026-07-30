# Event System Extraction Guide

## Overview

This guide explains how to extract the Football DNA Simulator's event system and integrate it into a new game engine.

**Extraction Complexity:** Low  
**Integration Complexity:** Medium  
**Time to Integrate:** 2-4 hours  

---

## Architecture Overview

The event system consists of three layers:

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Event Data (career_event_data.js)              │
│ - Pure data structures                                  │
│ - No game logic dependencies                            │
│ - Dependency injection pattern                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Event Logic (game.js)                          │
│ - Requirement checking                                  │
│ - Weighted random selection                             │
│ - Effect application                                    │
│ - State management                                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Layer 3: UI Rendering (index.html)                      │
│ - DOM manipulation                                      │
│ - Event presentation                                    │
│ - User interaction handling                             │
└─────────────────────────────────────────────────────────┘
```

---

## Step 1: Extract Event Data

### Copy the Event Data File

```bash
cp src/career_event_data.js new_engine/events/career_event_data.js
```

### Verify No Dependencies

The file should have **zero imports** of game.js or other engine code:

```javascript
// ✅ GOOD - Only uses dependency injection
const eventData = window.createCareerEventData({
  getState: () => gameState,
  rand: () => Math.random(),
  randInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
});

// ❌ BAD - Would require game.js
// import { simulateSeason } from "game.js";
```

---

## Step 2: Implement Core Functions

You must implement these functions in your engine:

### 2.1 Requirement Checking

```javascript
function meetsRequirement(event, context) {
  const req = event.req || {};
  
  // All checks must pass (AND logic)
  if (req.roleIn && !req.roleIn.includes(context.role)) return false;
  if (req.ageMin != null && context.age < req.ageMin) return false;
  if (req.ageMax != null && context.age > req.ageMax) return false;
  if (req.yearsMin != null && context.yearsAtClub < req.yearsMin) return false;
  if (req.repMin != null && context.reputation < req.repMin) return false;
  if (req.repMax != null && context.reputation > req.repMax) return false;
  if (req.contractMin != null && context.contractYears < req.contractMin) return false;
  if (req.contractMax != null && context.contractYears > req.contractMax) return false;
  if (req.gamesMissedMin != null && context.gamesMissed < req.gamesMissedMin) return false;
  if (req.perf && !req.perf.includes(context.performance)) return false;
  if (req.intlCaps != null && context.intlCaps < req.intlCaps) return false;
  if (req.intlRetired != null && req.intlRetired && !context.intlRetired) return false;
  if (req.honourThisSeason != null && req.honourThisSeason && !context.wonHonour) return false;
  if (req.seasonMin != null && context.season < req.seasonMin) return false;
  if (req.traj && !req.traj.includes(context.trajectory)) return false;
  
  return true;
}
```

### 2.2 Weighted Random Selection

```javascript
function weightedRandomPick(items) {
  if (!items?.length) return null;
  
  const totalWeight = items.reduce((sum, i) => sum + (i.weight || 0), 0);
  if (totalWeight <= 0) return null;
  
  let roll = Math.random() * totalWeight;
  for (const item of items) {
    roll -= (item.weight || 0);
    if (roll <= 0) return item.item;
  }
  
  return items[items.length - 1].item;
}
```

### 2.3 Effect Application

```javascript
function applyEffects(playerState, effects, multiplier = 1) {
  if (!effects) return;
  
  // Numeric effects
  if (effects.rep) playerState.reputation += effects.rep * multiplier;
  if (effects.fame) playerState.fame += effects.fame * multiplier;
  if (effects.wealth) playerState.wealth += effects.wealth * multiplier;
  
  // Attributes
  if (effects.attrChange) {
    const attr = effects.attrChange;
    playerState.attributes[attr.key] = clamp(
      playerState.attributes[attr.key] + attr.delta,
      0, 99
    );
  }
  
  // Pillars (character traits)
  if (effects.pillars) {
    for (const [pillar, delta] of Object.entries(effects.pillars)) {
      playerState.pillars[pillar] = clamp(
        playerState.pillars[pillar] + delta,
        0, 100
      );
    }
  }
  
  // Flags
  if (effects.flag) playerState.flags[effects.flag] = true;
  
  // Contract
  if (effects.contract) {
    playerState.contractYears = Math.max(0, playerState.contractYears + effects.contract);
  }
  
  // International
  if (effects.intlCaps) playerState.intlCaps += effects.intlCaps;
  if (effects.intlGoals) playerState.intlGoals += effects.intlGoals;
  if (effects.setIntlRetired) playerState.intlRetired = true;
  
  // Career end
  if (effects.retireNow) playerState.retireNow = true;
  if (effects.finalSeason) playerState.finalSeason = effects.finalSeason;
  if (effects.epilogue) playerState.epilogue = effects.epilogue;
  
  // Transfer
  if (effects.forceTransfer) playerState.forceTransfer = true;
  
  // Role
  if (effects.role === "up") {
    const roles = ["Bench", "Rotation", "Starter", "Star"];
    const idx = roles.indexOf(playerState.role);
    if (idx < roles.length - 1) playerState.role = roles[idx + 1];
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
```

### 2.4 Context Building

```javascript
function buildContext(playerState, seasonData) {
  return {
    age: playerState.age,
    role: playerState.role,
    yearsAtClub: playerState.yearsAtClub,
    reputation: playerState.reputation,
    performance: seasonData?.performanceTier || "Met Expectation",
    contractYears: playerState.contractYears,
    gamesMissed: seasonData?.gamesMissed || 0,
    trajectory: seasonData?.trajectory || "Mid-table",
    intlCaps: playerState.intlCaps,
    intlRetired: playerState.intlRetired,
    wonHonour: seasonData?.wonHonour || false,
    season: playerState.season,
  };
}
```

---

## Step 3: Implement Event Selection

### 3.1 Season Decision Selection

```javascript
function pickSeasonDecision(playerState, seasonData, eventData) {
  const context = buildContext(playerState, seasonData);
  
  // Filter eligible events
  const eligible = eventData.SEASON_DECISIONS
    .map(event => ({
      item: event,
      weight: meetsRequirement(event, context) ? event.weight : 0
    }))
    .filter(e => e.weight > 0);
  
  if (!eligible.length) return null;
  
  return weightedRandomPick(eligible);
}
```

### 3.2 Career Milestone Selection

```javascript
function pickCareerMilestone(playerState, eventData) {
  for (const milestone of eventData.CAREER_MILESTONES) {
    // Check if already triggered
    if (playerState.milestonesTriggered?.[milestone.id]) continue;
    
    // Check age range
    if (playerState.age < milestone.ageRange[0] || playerState.age > milestone.ageRange[1]) continue;
    
    // Check requirements
    const context = buildContext(playerState, {});
    if (milestone.req && !meetsRequirement(milestone, context)) continue;
    
    // Probability check
    if (Math.random() < milestone.weight / 10) {
      // Mark as triggered
      if (!playerState.milestonesTriggered) playerState.milestonesTriggered = {};
      playerState.milestonesTriggered[milestone.id] = true;
      
      return milestone;
    }
  }
  
  return null;
}
```

### 3.3 Career Ending Selection

```javascript
function pickCareerEnding(playerState, eventData) {
  // Filter eligible endings
  const eligible = eventData.CAREER_ENDINGS
    .filter(ending => !ending.req || ending.req(playerState))
    .map(ending => ({
      item: ending,
      weight: getCareerOutcomeScore(playerState, ending)
    }));
  
  if (!eligible.length) {
    // Fallback to normal retirement
    return eventData.CAREER_ENDINGS.find(e => e.id === "normal_retirement");
  }
  
  return weightedRandomPick(eligible);
}

function getCareerOutcomeScore(playerState, ending) {
  let score = ending.base;
  if (ending.score) score += ending.score(playerState);
  return Math.max(0, score);
}
```

---

## Step 4: Implement UI Layer

### 4.1 Render Season Decision

```javascript
function presentSeasonDecision(event, playerState, eventData, onChoice) {
  const context = buildContext(playerState, {});
  const name = playerState.name;
  
  // Generate text
  const text = typeof event.text === "function" 
    ? event.text(name, context) 
    : event.text;
  
  // Generate choices
  const choices = typeof event.choices === "function"
    ? event.choices(context)
    : event.choices;
  
  // Render UI
  const html = `
    <div class="event-decision">
      <h3>${event.category}</h3>
      <p>${text}</p>
      <div class="choices">
        ${choices.map((choice, i) => `
          <button data-choice="${i}">${choice.label}</button>
        `).join("")}
      </div>
    </div>
  `;
  
  // Attach handlers
  document.querySelectorAll("[data-choice]").forEach(btn => {
    btn.addEventListener("click", () => {
      const choiceIndex = parseInt(btn.dataset.choice);
      const choice = choices[choiceIndex];
      
      // Apply effects
      applyEffects(playerState, choice.fx, 1);
      
      // Callback
      onChoice(choice);
    });
  });
  
  return html;
}
```

### 4.2 Render Career Ending

```javascript
function presentCareerEnding(event, playerState, onChoice) {
  const name = playerState.name;
  
  // Generate text
  const text = typeof event.text === "function"
    ? event.text(name, playerState)
    : event.text;
  
  // Render UI
  const html = `
    <div class="career-ending">
      <h2>END OF CAREER</h2>
      <p>${text}</p>
      <div class="choices">
        ${event.choices.map((choice, i) => `
          <button data-choice="${i}">${choice.label}</button>
        `).join("")}
      </div>
    </div>
  `;
  
  // Attach handlers
  document.querySelectorAll("[data-choice]").forEach(btn => {
    btn.addEventListener("click", () => {
      const choiceIndex = parseInt(btn.dataset.choice);
      const choice = event.choices[choiceIndex];
      
      // Apply effects
      applyEffects(playerState, choice.fx, 1);
      
      // Callback
      onChoice(choice);
    });
  });
  
  return html;
}
```

---

## Step 5: Define State Schema

Your engine must maintain a player state object with these fields:

```javascript
const playerState = {
  // Identity
  name: string,
  age: number,
  season: number,
  
  // Career
  club: string,
  role: "Star" | "Starter" | "Rotation" | "Bench",
  yearsAtClub: number,
  
  // Attributes
  attributes: {
    speed: number,      // 0-99
    strength: number,   // 0-99
    heading: number,    // 0-99
    leftFoot: number,   // 0-99
    rightFoot: number,  // 0-99
    fitness: number,    // 0-99
  },
  
  // Pillars (character traits)
  pillars: {
    Ambition: number,           // 0-100
    Loyalty: number,            // 0-100
    Professionalism: number,    // 0-100
    Adaptability: number,       // 0-100
    Ego: number,                // 0-100
    KillerInstinct: number,     // 0-100
    Consistency: number,        // 0-100
    Leadership: number,         // 0-100
    Durability: number,         // 0-100
    Longevity: number,          // 0-100
  },
  
  // Stats
  reputation: number,
  fame: number,
  wealth: number,
  totalGoals: number,
  intlCaps: number,
  intlGoals: number,
  intlRetired: boolean,
  
  // Contract
  contractYears: number,
  
  // Tracking
  milestonesTriggered: { [eventId]: boolean },
  earlyDevEvents: { [eventId]: boolean },
  endOfCareerTriggered: boolean,
  
  // Flags
  flags: { [flagName]: boolean },
  
  // Career end
  retireNow: boolean,
  finalSeason: { destination: string, note: string },
  epilogue: string,
  forceTransfer: boolean,
};
```

---

## Step 6: Integration Example

Here's a complete example of integrating the event system:

```javascript
// 1. Load event data
const eventData = window.createCareerEventData({
  getState: () => playerState,
  rand: () => Math.random(),
  randInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
});

// 2. Handle season end
function handleSeasonEnd(playerState, seasonData) {
  // Check for career milestone first
  const milestone = pickCareerMilestone(playerState, eventData);
  if (milestone) {
    presentCareerMilestone(milestone, playerState, (choice) => {
      applyEffects(playerState, choice.fx, 1);
      handleSeasonDecision(playerState, seasonData);
    });
    return;
  }
  
  // Then check for season decision
  handleSeasonDecision(playerState, seasonData);
}

function handleSeasonDecision(playerState, seasonData) {
  const decision = pickSeasonDecision(playerState, seasonData, eventData);
  if (!decision) {
    handleTransferPhase(playerState);
    return;
  }
  
  presentSeasonDecision(decision, playerState, eventData, (choice) => {
    applyEffects(playerState, choice.fx, 1);
    handleTransferPhase(playerState);
  });
}

// 3. Handle career end
function handleCareerEnd(playerState) {
  if (playerState.endOfCareerTriggered) {
    endCareer(playerState);
    return;
  }
  
  playerState.endOfCareerTriggered = true;
  const ending = pickCareerEnding(playerState, eventData);
  
  presentCareerEnding(ending, playerState, (choice) => {
    applyEffects(playerState, choice.fx, 1);
    endCareer(playerState);
  });
}
```

---

## Testing the Integration

### Unit Tests

```javascript
// Test requirement checking
const event = eventData.SEASON_DECISIONS[0];
const context = { age: 25, reputation: 50, role: "Starter" };
assert(meetsRequirement(event, context) === true);

// Test weighted selection
const items = [
  { item: "A", weight: 10 },
  { item: "B", weight: 1 },
];
const result = weightedRandomPick(items);
assert(result === "A" || result === "B");

// Test effect application
const state = { reputation: 50, pillars: { Ambition: 50 } };
applyEffects(state, { rep: 5, pillars: { Ambition: 10 } });
assert(state.reputation === 55);
assert(state.pillars.Ambition === 60);
```

### Integration Tests

```javascript
// Test season decision flow
const playerState = { age: 25, reputation: 50, role: "Starter", season: 5 };
const seasonData = { performanceTier: "Sensational", gamesMissed: 0 };

const decision = pickSeasonDecision(playerState, seasonData, eventData);
assert(decision !== null);
assert(decision.choices !== undefined);

// Test career ending flow
playerState.age = 35;
const ending = pickCareerEnding(playerState, eventData);
assert(ending !== null);
assert(ending.id !== undefined);
```

---

## Troubleshooting

### Issue: Events not firing

**Check:**
1. Requirements are being checked correctly
2. Context object has all required fields
3. Weights are > 0
4. Eligible events list is not empty

### Issue: Effects not applying

**Check:**
1. Effect object structure is correct
2. Player state fields exist
3. Values are being clamped to valid ranges
4. Multiplier is applied correctly

### Issue: Weighted selection is biased

**Check:**
1. Total weight is > 0
2. Random number generation is fair
3. No events have weight 0
4. Distribution matches expectations

---

## Performance Considerations

### Memory
- Event data: ~50KB (all 76 events)
- Player state: ~2KB per player
- Minimal overhead for requirement checking

### CPU
- Event selection: O(n) where n = number of events (~76)
- Requirement checking: O(1) per event
- Weighted selection: O(n) where n = eligible events (~10-20)

**Recommendation:** Cache eligible events if selecting multiple times per frame.

---

## Next Steps

1. **Extract** `career_event_data.js` to your project
2. **Implement** core functions (requirement checking, effect application, etc.)
3. **Build** UI layer for your engine
4. **Test** with unit and integration tests
5. **Integrate** into season/career flow
6. **Iterate** by adding new events to the data file

---

## Support

For questions about the event system:
1. Read `AUDIT_EVENT_SYSTEM.md` for architecture details
2. Check `EVENT_SYSTEM_AUDIT_RESULTS.md` for validation results
3. Review `career_event_data.js` for event definitions
4. Examine `game.js` for implementation examples

---

**Last Updated:** July 30, 2026  
**Status:** Ready for extraction and integration
