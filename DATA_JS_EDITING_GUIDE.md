# data.js Editing Guide

## Quick Reference

Your `src/data.js` file is ready to upload directly to GitHub. Here's how to edit it.

---

## File Structure

### 1. Mentality Traits (Top of File)
```javascript
const MENTALITY_TRAITS = {
  "Calm": {
    "special": false,
    "tag": "neutral"
  },
  "Composed": {
    "special": false,
    "tag": "neutral"
  },
  // ... more traits
};
```

### 2. Main Game Data
```javascript
window.GAME_DATA = {
  PLAYER_DATABASE: {
    "Arsenal": [ /* players */ ],
    "Manchester United": [ /* players */ ],
    // ... more clubs
  },
  TEAM_DATABASE: {
    // ... team data
  }
};
```

---

## Player Format

### The `p()` Function
Each player is created with the `p()` function:

```javascript
p(name, pos, heading, fitness, strength, height, weight, 
  leftFoot, rightFoot, speed, mentality, mentalityRating, overall, tier)
```

### Parameters Explained

| # | Parameter | Type | Range | Example |
|---|-----------|------|-------|---------|
| 1 | **name** | String | - | "Thierry Henry" |
| 2 | **pos** | String | FW, AM, WG, CM, DM, FB, CB, GK | "FW" |
| 3 | **heading** | Number | 0-99 | 78 |
| 4 | **fitness** | Number | 0-99 | 92 |
| 5 | **strength** | Number | 0-99 | 88 |
| 6 | **height** | Number | cm (160-210) | 183 |
| 7 | **weight** | Number | kg (60-110) | 87 |
| 8 | **leftFoot** | Number | 0-99 | 88 |
| 9 | **rightFoot** | Number | 0-99 | 78 |
| 10 | **speed** | Number | 0-99 | 97 |
| 11 | **mentality** | String | Trait name | "Determined" |
| 12 | **mentalityRating** | Number | 0-99 (HIDDEN) | 92 |
| 13 | **overall** | Number | 0-99 | 92 |
| 14 | **tier** | String | "Legend" or "" | "Legend" |

### Example Player
```javascript
p("Thierry Henry", "FW", 78, 92, 88, 183, 87, 88, 78, 97, "Determined", 92, 92, "Legend"),
```

---

## Common Edits

### Update a Player's Stats
Find the player and modify their numbers:

```javascript
// Before
p("Player Name", "FW", 75, 85, 80, 180, 82, 85, 75, 90, "Determined", 88, 85),

// After (updated stats)
p("Player Name", "FW", 78, 88, 83, 180, 82, 88, 78, 92, "Determined", 88, 87),
```

### Add a New Player
Add a new `p(...)` line to the club's roster:

```javascript
"Arsenal": [
  p("Thierry Henry", "FW", 78, 92, 88, 183, 87, 88, 78, 97, "Determined", 92, 92, "Legend"),
  p("Patrick Vieira", "DM", 88, 89, 94, 193, 95, 76, 74, 86, "Leader", 91, 91, "Legend"),
  p("New Player", "FW", 80, 85, 82, 182, 84, 85, 80, 92, "Composed", 87, 84),  // NEW
],
```

### Change a Player's Position
```javascript
// Before
p("Player Name", "FW", ...),

// After (changed to AM)
p("Player Name", "AM", ...),
```

### Add a Legend Tier
```javascript
// Before (no tier)
p("Player Name", "FW", 78, 92, 88, 183, 87, 88, 78, 97, "Determined", 92, 92),

// After (add "Legend")
p("Player Name", "FW", 78, 92, 88, 183, 87, 88, 78, 97, "Determined", 92, 92, "Legend"),
```

### Add a New Mentality Trait
Add to the `MENTALITY_TRAITS` object at the top:

```javascript
const MENTALITY_TRAITS = {
  // ... existing traits
  "NewTrait": {
    "special": false,
    "tag": "neutral"
  }
};
```

---

## Position Abbreviations

| Pos | Full Name | Role |
|-----|-----------|------|
| **GK** | Goalkeeper | Goalkeeper |
| **CB** | Center Back | Defender |
| **FB** | Full Back | Defender |
| **DM** | Defensive Midfielder | Midfielder |
| **CM** | Central Midfielder | Midfielder |
| **AM** | Attacking Midfielder | Midfielder |
| **WG** | Winger | Forward |
| **FW** | Forward | Forward |

---

## Mentality Traits

Common traits in the game:

**Neutral Traits:**
- Calm, Composed, Professional, Steady, Balanced, Grounded, Level-Headed

**Positive Traits:**
- Determined, Leader, Confident, Ambitious, Focused, Resilient

**Special Traits (Rare):**
- Visionary, Clutch, Mentor, Warrior, Genius

---

## Editing Tips

### 1. Keep Formatting Consistent
```javascript
// Good (consistent spacing)
p("Name", "POS", 75, 85, 80, 180, 82, 85, 75, 90, "Trait", 88, 85),

// Bad (inconsistent spacing)
p("Name","POS",75,85,80,180,82,85,75,90,"Trait",88,85),
```

### 2. Don't Forget Commas
Each player entry needs a comma at the end:
```javascript
p("Player 1", "FW", ..., 85),  // ← comma
p("Player 2", "FW", ..., 84),  // ← comma
```

### 3. Check Closing Brackets
Make sure the file ends properly:
```javascript
  }
};  // ← closing bracket for GAME_DATA
```

### 4. Validate Before Uploading
Open the file in your IDE and check for:
- ✅ No syntax errors (IDE will highlight them)
- ✅ All commas in place
- ✅ All quotes matched
- ✅ All brackets closed

---

## Common Mistakes

### Missing Comma
```javascript
// ❌ Wrong
p("Player 1", "FW", ..., 85)   // Missing comma!
p("Player 2", "FW", ..., 84),

// ✅ Correct
p("Player 1", "FW", ..., 85),  // Has comma
p("Player 2", "FW", ..., 84),
```

### Mismatched Quotes
```javascript
// ❌ Wrong
p('Player Name", "FW", ...),  // Mixed quotes

// ✅ Correct
p("Player Name", "FW", ...),  // Consistent quotes
```

### Wrong Number of Parameters
```javascript
// ❌ Wrong (missing tier parameter)
p("Name", "FW", 75, 85, 80, 180, 82, 85, 75, 90, "Trait", 88),

// ✅ Correct (includes tier)
p("Name", "FW", 75, 85, 80, 180, 82, 85, 75, 90, "Trait", 88, 85, ""),
```

---

## Testing Your Changes

### 1. Local Testing
```bash
# Open index.html in your browser
open index.html

# Or use a local server
python -m http.server 8000
# Visit http://localhost:8000
```

### 2. Check Browser Console
Open DevTools (F12) and check the Console tab:
- ✅ No red error messages
- ✅ Game loads successfully
- ✅ Players appear in game

### 3. Verify Players Appear
- Start a new career
- Check that your updated/new players are available
- Verify their stats are correct

---

## Uploading to GitHub

### Step 1: Edit Locally
Edit `src/data.js` in your IDE

### Step 2: Verify Syntax
Check that there are no errors in your IDE

### Step 3: Upload to GitHub
**Option A: Web Interface**
1. Go to your GitHub repo
2. Navigate to `src/` folder
3. Click "Add file" → "Upload files"
4. Select `data.js`
5. Add commit message
6. Click "Commit changes"

**Option B: Git Command**
```bash
git add src/data.js
git commit -m "Update: [description]"
git push origin main
```

### Step 4: Verify Deployment
1. Visit your GitHub Pages URL
2. Clear browser cache (Ctrl+Shift+Delete)
3. Check that changes appear

---

## Quick Stat Ranges

### Realistic Ranges by Position

**Forwards (FW, WG, AM):**
- Heading: 60-90
- Fitness: 80-95
- Strength: 70-90
- Height: 175-195cm
- Weight: 75-95kg
- Foot Skills: 75-99
- Speed: 75-99

**Midfielders (CM, DM):**
- Heading: 65-85
- Fitness: 80-95
- Strength: 70-90
- Height: 175-190cm
- Weight: 75-90kg
- Foot Skills: 70-95
- Speed: 70-90

**Defenders (CB, FB):**
- Heading: 75-95
- Fitness: 80-95
- Strength: 80-99
- Height: 180-200cm
- Weight: 80-100kg
- Foot Skills: 60-85
- Speed: 65-85

**Goalkeepers (GK):**
- Heading: 70-90
- Fitness: 80-95
- Strength: 75-95
- Height: 185-210cm
- Weight: 85-110kg
- Foot Skills: 40-70
- Speed: 60-80

---

## Summary

1. ✅ Edit `src/data.js` locally
2. ✅ Use the `p(...)` function format
3. ✅ Keep formatting consistent
4. ✅ Don't forget commas
5. ✅ Verify syntax in your IDE
6. ✅ Upload to GitHub
7. ✅ GitHub Pages auto-deploys

That's it! Your data is ready to go. 🚀
