/* ============================================================================
 * FOOTBALL MANAGER — MACRO SLIDERS SYSTEM
 *
 * Three pre-season strategic dials that affect squad management over the
 * entire season without requiring per-match decisions:
 *   - Rotation: Balance player fatigue against squad chemistry
 *   - Selling: Cash generation vs squad morale
 *   - Youth: Short-term results vs long-term development
 *
 * Sliders are set once per pre-season and persist through the entire campaign.
 * Each slider ranges 0–100 and feeds into the match engine and AI calculations.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});

  const SLIDERS = {
    rotation: {
      min: 0, max: 100, default: 50,
      label: "Rotation Strategy",
      low: "Frequent rest — fresh squad, lower intensity",
      high: "Press hard — maximum intensity, injury risk"
    },
    selling: {
      min: 0, max: 100, default: 50,
      label: "Selling Strategy",
      low: "Keep the squad — morale intact, wages rise",
      high: "Move aging assets — cash in, squad turnover"
    },
    youth: {
      min: 0, max: 100, default: 30,
      label: "Youth Integration",
      low: "Seniors first — immediate results",
      high: "Academy focus — growth over this season"
    }
  };

  /** Get or create the macro settings object for a club. */
  function ensure(club) {
    if (!club.macroSettings) {
      club.macroSettings = {
        rotation: SLIDERS.rotation.default,
        selling: SLIDERS.selling.default,
        youth: SLIDERS.youth.default
      };
    }
    return club.macroSettings;
  }

  /** Get a slider value (0–100). */
  function get(club, key) {
    const s = ensure(club);
    return s[key] != null ? s[key] : SLIDERS[key].default;
  }

  /** Set a slider value, clamped to [0, 100]. */
  function set(club, key, value) {
    const s = ensure(club);
    const slider = SLIDERS[key];
    if (slider) s[key] = Math.max(slider.min, Math.min(slider.max, value));
  }

  /** Reset sliders to defaults. Called at the start of each pre-season. */
  function reset(club) {
    club.macroSettings = {
      rotation: SLIDERS.rotation.default,
      selling: SLIDERS.selling.default,
      youth: SLIDERS.youth.default
    };
  }

  /** Return a multiplier (0.7–1.3) for match engine effects based on a slider.
   *  - Low (0) → 0.7 (conservative penalty)
   *  - Default (50) → 1.0 (no effect)
   *  - High (100) → 1.3 (aggressive bonus)
   */
  function multiplier(value) {
    if (value == null) value = 50;
    // Linear interpolation: 0→0.7, 50→1.0, 100→1.3
    if (value < 50) return 0.7 + (value / 50) * 0.3;
    return 1.0 + ((value - 50) / 50) * 0.3;
  }

  MG.macroSliders = {
    SLIDERS,
    ensure, get, set, reset, multiplier
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
