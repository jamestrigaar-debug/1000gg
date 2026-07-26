/**
 * Career Share System
 * Generates unique career IDs, manages shareable career data, and creates Open Graph metadata
 */

window.createCareerShareSystem = function(deps) {
  const { getState, rand, randInt } = deps;

  /**
   * Generate a unique career ID
   * Format: base36(timestamp) + base36(random)
   * Example: "abc123xyz"
   */
  function generateCareerID() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}${random}`;
  }

  /**
   * Extract career summary from game state
   * Returns minimal data needed for share cards and leaderboards
   */
  function extractCareerSummary(state) {
    return {
      playerName: state.player.name || "Unknown Player",
      goals: state.totalGoals || 0,
      assists: state.totalAssists || 0,
      apps: state.totalApps || 0,
      age: state.age || 0,
      retirementAge: state.retirementAge || 40,
      season: state.season || 0,
      era: state.era || "all",
      difficulty: state.difficulty || "medium",
      ratingMode: state.ratingMode || "peak",
      country: state.player.origin || "Unknown",
      position: state.position || "ST",
      
      // Club history (last 3 clubs)
      clubs: Array.from(state.clubsPlayed || []).slice(-3),
      currentClub: state.club || null,
      yearsAtClub: state.yearsAtClub || 0,
      
      // Trophies
      leagueTitles: state.honours?.leagueTitles || 0,
      domesticCups: state.honours?.domesticCups || 0,
      europeanCups: state.honours?.europeanCups || 0,
      intlTrophies: state.honours?.intlTrophies || 0,
      goldenBoots: state.honours?.goldenBoots || 0,
      ballonDors: state.honours?.ballonDors || 0,
      
      // Stats
      intlCaps: state.intlCaps || 0,
      intlGoals: state.intlGoals || 0,
      leagueGoals: state.leagueGoals || 0,
      cupGoals: state.cupGoals || 0,
      europeGoals: state.europeGoals || 0,
      
      // Metadata
      timestamp: Date.now(),
      reachedGoal: (state.totalGoals || 0) >= 1000,
      endCareerReason: state.endCareerReason || null,
    };
  }

  /**
   * Save career to localStorage with unique ID
   * Returns the career ID
   */
  function saveCareerShare(state) {
    const careerId = generateCareerID();
    const summary = extractCareerSummary(state);
    
    try {
      localStorage.setItem(`career_${careerId}`, JSON.stringify(summary));
      localStorage.setItem(`career_${careerId}_timestamp`, Date.now().toString());
      return careerId;
    } catch (e) {
      console.error("Failed to save career share:", e);
      return null;
    }
  }

  /**
   * Load career summary from localStorage
   */
  function loadCareerShare(careerId) {
    try {
      const data = localStorage.getItem(`career_${careerId}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error("Failed to load career share:", e);
      return null;
    }
  }

  /**
   * Delete career share from localStorage
   */
  function deleteCareerShare(careerId) {
    try {
      localStorage.removeItem(`career_${careerId}`);
      localStorage.removeItem(`career_${careerId}_timestamp`);
      return true;
    } catch (e) {
      console.error("Failed to delete career share:", e);
      return false;
    }
  }

  /**
   * Get all saved careers from localStorage
   * Returns array of { careerId, summary }
   */
  function getAllCareerShares() {
    const careers = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("career_") && !key.endsWith("_timestamp")) {
          const careerId = key.replace("career_", "");
          const summary = loadCareerShare(careerId);
          if (summary) {
            careers.push({ careerId, summary });
          }
        }
      }
    } catch (e) {
      console.error("Failed to get all career shares:", e);
    }
    return careers.sort((a, b) => b.summary.timestamp - a.summary.timestamp);
  }

  /**
   * Determine if a career should be indexed (not noindex)
   * Rules:
   * - Reached 1000 goals
   * - 10+ trophies
   * - Impossible mode
   */
  function shouldIndexCareer(summary) {
    const totalTrophies = (summary.leagueTitles || 0) + 
                         (summary.domesticCups || 0) + 
                         (summary.europeanCups || 0) + 
                         (summary.intlTrophies || 0);
    
    return (
      (summary.goals >= 1000) ||
      (totalTrophies >= 10) ||
      (summary.difficulty === "impossible")
    );
  }

  /**
   * Generate Open Graph metadata for a career
   * Returns object with og:title, og:description, og:image, etc.
   */
  function generateOGMetadata(careerId, summary) {
    const totalTrophies = (summary.leagueTitles || 0) + 
                         (summary.domesticCups || 0) + 
                         (summary.europeanCups || 0) + 
                         (summary.intlTrophies || 0);
    
    const title = `I scored ${summary.goals} goals in Football DNA Simulator`;
    const description = `${summary.playerName} (${summary.country}) • ${summary.goals} goals • ${totalTrophies} trophies • ${summary.difficulty} mode. Can you beat this career?`;
    const url = `https://1000goals.co.uk/career/${careerId}`;
    const imageUrl = `https://1000goals.co.uk/og/career/${careerId}.jpg`;
    
    return {
      title,
      description,
      url,
      imageUrl,
      twitterCard: "summary_large_image",
    };
  }

  /**
   * Generate HTML for a career share page
   * This is a server-side template; in practice, you'd render this on-demand
   */
  function generateCareerPageHTML(careerId, summary) {
    const og = generateOGMetadata(careerId, summary);
    const shouldIndex = shouldIndexCareer(summary);
    const robotsTag = shouldIndex ? "" : '<meta name="robots" content="noindex, follow">';
    
    const totalTrophies = (summary.leagueTitles || 0) + 
                         (summary.domesticCups || 0) + 
                         (summary.europeanCups || 0) + 
                         (summary.intlTrophies || 0);
    
    const trophyBreakdown = [
      summary.leagueTitles > 0 ? `${summary.leagueTitles} League Title${summary.leagueTitles > 1 ? 's' : ''}` : null,
      summary.domesticCups > 0 ? `${summary.domesticCups} Domestic Cup${summary.domesticCups > 1 ? 's' : ''}` : null,
      summary.europeanCups > 0 ? `${summary.europeanCups} European Cup${summary.europeanCups > 1 ? 's' : ''}` : null,
      summary.intlTrophies > 0 ? `${summary.intlTrophies} International Trophy${summary.intlTrophies > 1 ? 'ies' : ''}` : null,
    ].filter(Boolean).join(" • ");
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${og.title}</title>
  <meta name="description" content="${og.description}" />
  <link rel="canonical" href="${og.url}" />
  ${robotsTag}
  
  <meta property="og:title" content="${og.title}" />
  <meta property="og:description" content="${og.description}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${og.url}" />
  <meta property="og:image" content="${og.imageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  
  <meta name="twitter:card" content="${og.twitterCard}" />
  <meta name="twitter:title" content="${og.title}" />
  <meta name="twitter:description" content="${og.description}" />
  <meta name="twitter:image" content="${og.imageUrl}" />
  
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "name": "${og.title}",
    "description": "${og.description}",
    "url": "${og.url}",
    "image": "${og.imageUrl}",
    "author": {
      "@type": "Person",
      "name": "${summary.playerName}"
    },
    "datePublished": "${new Date(summary.timestamp).toISOString()}"
  }
  </script>
  
  <style>
    :root {
      --bg: #04120b;
      --bg2: #0a1f15;
      --card: #0f2b1d;
      --card2: #163a27;
      --line: #1e4d35;
      --txt: #f4fff8;
      --muted: #7b9b8b;
      --accent: #00d06c;
      --accent2: #38b6ff;
      --gold: #f5e050;
      --radius: 12px;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
      background: repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 4px),
        radial-gradient(1200px 600px at 50% -10%, #0d3d25 0%, var(--bg) 60%);
      color: var(--txt);
      line-height: 1.6;
    }
    .wrap { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 2.5em; margin-bottom: 0.5em; color: var(--txt); }
    h2 { font-size: 1.8em; margin-top: 1.2em; margin-bottom: 0.5em; color: var(--accent2); }
    p { margin: 0.8em 0; }
    .career-card { background: var(--card); border: 2px solid var(--line); border-radius: var(--radius); padding: 30px; margin: 2em 0; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 2em 0; }
    .stat-box { background: var(--card2); border: 1px solid var(--line); border-radius: 10px; padding: 15px; text-align: center; }
    .stat-num { font-size: 2em; font-weight: 900; color: var(--accent); }
    .stat-label { font-size: 0.9em; color: var(--muted); margin-top: 5px; text-transform: uppercase; }
    .btn { display: inline-block; background: var(--card2); border: 1px solid var(--line); color: var(--txt); padding: 10px 16px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 5px; }
    .btn:hover { border-color: var(--accent2); }
    .btn.primary { background: var(--accent); color: #052211; border-color: transparent; }
    .footer { margin-top: 3em; padding-top: 2em; border-top: 1px solid var(--line); text-align: center; color: var(--muted); font-size: 0.9em; }
  </style>
</head>
<body>
<div class="wrap">
  <a href="/" style="color: var(--accent2); text-decoration: none; font-weight: 600;">← Back to Game</a>
  
  <h1>${og.title}</h1>
  
  <div class="career-card">
    <h2>${summary.playerName}</h2>
    <p><strong>Country:</strong> ${summary.country} | <strong>Position:</strong> ${summary.position} | <strong>Era:</strong> ${summary.era.toUpperCase()} | <strong>Difficulty:</strong> ${summary.difficulty.toUpperCase()}</p>
    
    <h2>Career Stats</h2>
    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-num">${summary.goals}</div>
        <div class="stat-label">Career Goals</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">${summary.apps}</div>
        <div class="stat-label">Appearances</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">${summary.assists}</div>
        <div class="stat-label">Assists</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">${summary.intlCaps}</div>
        <div class="stat-label">International Caps</div>
      </div>
    </div>
    
    <h2>Honours</h2>
    ${totalTrophies > 0 ? `<p>${trophyBreakdown}</p>` : '<p style="color: var(--muted);">No major honours won</p>'}
    
    <h2>Career Duration</h2>
    <p>Age ${summary.age} (${summary.season} seasons played)</p>
    
    <div style="margin-top: 2em;">
      <a href="/" class="btn primary">Play Football DNA Simulator</a>
      <a href="/hall-of-fame/" class="btn">View Hall of Fame</a>
    </div>
  </div>
  
  <div class="footer">
    <p>This career was completed in Football DNA Simulator, a free browser-based football career game.</p>
    <p><a href="/" style="color: var(--accent2);">1000goals.co.uk</a></p>
  </div>
</div>
</body>
</html>`;
  }

  return {
    generateCareerID,
    extractCareerSummary,
    saveCareerShare,
    loadCareerShare,
    deleteCareerShare,
    getAllCareerShares,
    shouldIndexCareer,
    generateOGMetadata,
    generateCareerPageHTML,
  };
};
