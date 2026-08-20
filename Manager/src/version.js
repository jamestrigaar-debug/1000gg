/* ============================================================================
 * BUILD STAMP
 *
 * One place that says which build this is. The welcome screen prints it, and
 * it is the first thing to ask for in a bug report — "it did X" is a very
 * different report against beta.1 than against beta.4, and without a stamp on
 * the page there is no way for anyone to tell which one they were playing.
 *
 * CHANNEL is the maturity of the build, not a decoration:
 *   alpha   feature work in flight, save format still moving
 *   beta    feature-complete for this release, saves stable within the
 *           channel, known gaps listed in RELEASE_NOTES.md
 *   release no known blocking faults
 *
 * Bump VERSION on anything a player would notice. If the SHAPE of a save
 * changes, bump saves.js's SCHEMA_VERSION too — that is a separate number on
 * purpose, because most releases do not touch it and a save should not be
 * thrown away for a build that only changed some wording.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});

  MG.build = {
    VERSION: "0.9.14",
    CHANNEL: "beta",
    NAME: "Football DNA Simulator — Manager",
    /** "0.9.3 beta" — what goes on screen. */
    label() { return `${this.VERSION} ${this.CHANNEL}`; },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
