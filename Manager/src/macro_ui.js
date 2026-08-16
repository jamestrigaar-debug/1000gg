/* ============================================================================
 * FOOTBALL MANAGER — MACRO SLIDERS UI
 *
 * Renders the pre-season macro configuration screen:
 *   - Three slider controls (rotation, selling, youth)
 *   - Competition focus buttons (League, Cup, Europe)
 *   - Integrated into the briefing/tactics flow
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});

  /** Generate HTML for the macro sliders + competition focus panel.
   *  Called from ui.js during the pre-season briefing. */
  function macroConfigHtml(club) {
    if (!MG.macroSliders || !MG.competitionFocus) return "";

    const rotation = MG.macroSliders.get(club, "rotation");
    const selling = MG.macroSliders.get(club, "selling");
    const youth = MG.macroSliders.get(club, "youth");

    const leagueEffort = MG.competitionFocus.getEffort(club, "league");
    const cupEffort = MG.competitionFocus.getEffort(club, "cup");
    const europeEffort = MG.competitionFocus.getEffort(club, "europe");

    const sliderHtml = (key, value) => {
      const slider = MG.macroSliders.SLIDERS[key];
      const pct = value;
      return `
        <div class="macro-slider">
          <div class="slider-header">
            <span class="slider-label">${slider.label}</span>
            <span class="slider-value">${value}</span>
          </div>
          <div class="slider-track">
            <input type="range" min="${slider.min}" max="${slider.max}" 
                   value="${value}" class="slider-input" 
                   data-slider="${key}" 
                   style="width:100%" />
          </div>
          <div class="slider-labels">
            <span class="slider-low">${slider.low}</span>
            <span class="slider-high">${slider.high}</span>
          </div>
        </div>`;
    };

    const competitionButtonHtml = (comp, effort) => {
      return MG.competitionFocus.EFFORT_KEYS.map(level => {
        const effortDef = MG.competitionFocus.EFFORT_LEVELS[level];
        const isActive = effort === level ? "on" : "";
        return `<button class="btn tiny ${isActive}" data-competition="${comp}" data-effort="${level}">
          ${effortDef.label}
        </button>`;
      }).join("");
    };

    return `
      <div class="panel">
        <h3 class="muted">STRATEGIC MACROS</h3>
        <p class="muted" style="font-size:12px;margin-bottom:12px">
          Set your season priorities before you kick off. These dials persist through the entire campaign and affect 
          how your squad is managed, rotated, and developed.
        </p>
        ${sliderHtml("rotation", rotation)}
        ${sliderHtml("selling", selling)}
        ${sliderHtml("youth", youth)}
      </div>

      <div class="panel">
        <h3 class="muted">COMPETITION FOCUS</h3>
        <p class="muted" style="font-size:12px;margin-bottom:12px">
          How much effort in each competition? Full Strength = your best eleven. Minimal = B-team and youth.
        </p>
        <div class="competition-focus">
          <div class="comp-row">
            <span class="comp-label">LEAGUE</span>
            <div class="comp-buttons">${competitionButtonHtml("league", leagueEffort)}</div>
          </div>
          <div class="comp-row">
            <span class="comp-label">CUP</span>
            <div class="comp-buttons">${competitionButtonHtml("cup", cupEffort)}</div>
          </div>
          <div class="comp-row">
            <span class="comp-label">EUROPE</span>
            <div class="comp-buttons">${competitionButtonHtml("europe", europeEffort)}</div>
          </div>
        </div>
      </div>`;
  }

  /** Wire up slider and competition button events. Called after macroConfigHtml renders. */
  function wireEvents(club) {
    // Slider inputs
    for (const input of document.querySelectorAll(".slider-input")) {
      input.addEventListener("input", (e) => {
        const key = e.target.dataset.slider;
        const value = parseInt(e.target.value);
        MG.macroSliders.set(club, key, value);
        // Update the displayed value
        const header = e.target.closest(".macro-slider").querySelector(".slider-value");
        if (header) header.textContent = value;
      });
    }

    // Competition effort buttons
    for (const btn of document.querySelectorAll("[data-competition][data-effort]")) {
      btn.addEventListener("click", (e) => {
        const comp = e.target.dataset.competition;
        const effort = e.target.dataset.effort;
        MG.competitionFocus.setEffort(club, comp, effort);
        // Update button states
        const siblings = btn.parentElement.querySelectorAll("button");
        for (const sibling of siblings) {
          sibling.classList.toggle("on", sibling.dataset.effort === effort);
        }
      });
    }
  }

  MG.macroUI = {
    macroConfigHtml,
    wireEvents
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
