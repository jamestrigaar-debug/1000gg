# Deployment Quick Start

## Your Setup
✅ **GitHub Pages** is already configured and working
✅ **src/data.js** is ready to upload directly
✅ **No build scripts** needed
✅ **Simple upload workflow**

---

## How to Update Data

### Option A: GitHub Web Interface (Easiest)

1. **Go to your repo**: https://github.com/yourusername/football-dna-simulator
2. **Navigate to `src/` folder**
3. **Click "Add file" → "Upload files"**
4. **Select `data.js` from your computer**
5. **Add commit message**: "Update: Player data"
6. **Click "Commit changes"**
7. **Done!** 🎉 GitHub Pages deploys automatically

### Option B: Git Command Line

```bash
# 1. Edit src/data.js locally
nano src/data.js

# 2. Upload to GitHub
git add src/data.js
git commit -m "Update: [description]"
git push origin main

# 3. GitHub Pages auto-deploys
```

---

## Verify Deployment

1. **Local test**: Open `index.html` in browser
2. **GitHub Pages**: Visit your deployed URL
3. **Clear cache** if changes don't appear: `Ctrl+Shift+Delete`

---

## Data File Info

| Property | Value |
|----------|-------|
| **Location** | `src/data.js` |
| **Size** | ~1.8MB |
| **Format** | JavaScript object |
| **Deployed** | ✅ Yes |
| **Auto-loaded** | ✅ Yes (in index.html) |
| **Build step** | ❌ Not needed |

---

## Files to Upload to GitHub

✅ **Upload these directly:**
- `index.html` (main page)
- `src/data.js` (player data)
- `src/game.js` (game engine)
- `src/career_event_data.js` (events)
- `docs/` (documentation)
- Any other files you want deployed

❌ **Don't upload these:**
- `build_data.js` (utility, not needed)
- `node_modules/` (already in .gitignore)
- Local development files

---

## Common Tasks

### Update Player Stats
1. Edit `src/data.js` locally
2. Upload to GitHub
3. Done!

### Add New Players
1. Add new `p(...)` entries to `src/data.js`
2. Upload to GitHub
3. Done!

### Update Mentality Traits
1. Edit `MENTALITY_TRAITS` object in `src/data.js`
2. Upload to GitHub
3. Done!

---

## That's It!

Your deployment is simple:
1. Edit `src/data.js` locally
2. Upload to GitHub (web or git)
3. GitHub Pages auto-deploys

No build scripts needed! 🚀
