/* ============================================================================
 * GLOBAL LEADERBOARD
 *
 * A shared board of career goal totals, seeded with real-world benchmarks and
 * topped up by players submitting their own finished careers.
 *
 * Loaded as a plain script (no build step, same as the rest of the game) and
 * exposed via window.createLeaderboard(config), matching the pattern used by
 * career_share.js and career_event_data.js.
 *
 * DESIGN NOTES
 *
 * 1. The game must stay playable with no network. Firebase is optional: if the
 *    SDK never loads, or the database is unreachable, every read falls back to
 *    the seed board and every write reports a clean failure. Nothing here is
 *    allowed to throw into the game loop.
 *
 * 2. Entries are append-only by database rule (see LEADERBOARD_RULES below).
 *    The Firebase config is public in the page source — anyone can read it —
 *    so the rules, not the client, are what stop someone rewriting or deleting
 *    the board. The validation in normalizeEntry mirrors those rules so bad
 *    submissions fail fast and locally instead of round-tripping.
 *
 * 3. Names come from strangers. They are length-capped and stripped of control
 *    characters here, and MUST be HTML-escaped at the point of render.
 * ========================================================================== */
(function () {
  "use strict";

  /* The Firebase config lives here rather than in its own file. These values
   * are public identifiers, not secrets — every Firebase web app ships them in
   * page source, and what protects the data is the database rules.
   *
   * It used to be src/firebase-config.js, which broke in production: the
   * hyphen was stripped somewhere in the file's journey to the repo, so
   * index.html requested src/firebase-config.js, the server had
   * src/firebaseconfig.js, the request 404'd and the board silently ran in
   * offline mode. One fewer file is one fewer thing that can arrive misnamed.
   *
   * window.FIREBASE_CONFIG still wins if set, so the values can be swapped
   * without editing this module. */
  const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCeW3uHXfO2ncGy2hjJnIYuxEP_EIN1Fug",
    authDomain: "goals-leaderboard.firebaseapp.com",
    databaseURL: "https://goals-leaderboard-default-rtdb.firebaseio.com",
    projectId: "goals-leaderboard",
    storageBucket: "goals-leaderboard.firebasestorage.app",
    messagingSenderId: "909173853183",
    appId: "1:909173853183:web:6d202418c97b87a42ff5ca",
  };

  /* Real-world benchmarks the board starts from: the recognised list of top
   * goalscorers of all time, ranks 1-18. Totals are career competitive goals
   * across league, cup, continental and international football — the same
   * basis as the game's own totalGoals, so the comparison is like for like.
   *
   * No appearance figures. The source for these totals records goals only, and
   * the earlier numbers here were approximations of my own that fed a
   * goals-per-game column and made invented data look authoritative. Rows with
   * no apps render as "—" in both columns, which is the honest answer.
   *
   * Ranks 1-27, the full published top 27. Everyone above 500 career goals. */
  const SEED_ENTRIES = [
    { name: "Cristiano Ronaldo", goals: 976, seed: true },
    { name: "Lionel Messi", goals: 921, seed: true },
    { name: "Pelé", goals: 762, seed: true },
    { name: "Romário", goals: 756, seed: true },
    { name: "Ferenc Puskás", goals: 725, seed: true },
    { name: "Josef Bican", goals: 722, seed: true },
    { name: "Robert Lewandowski", goals: 699, seed: true },
    { name: "Jimmy Jones", goals: 639, seed: true },
    { name: "Gerd Müller", goals: 634, seed: true },
    { name: "Joe Bambrick", goals: 626, seed: true },
    { name: "Abe Lenstra", goals: 624, seed: true },
    { name: "Luis Suárez", goals: 610, seed: true },
    { name: "Eusébio", goals: 578, seed: true },
    { name: "Glenn Ferguson", goals: 563, seed: true },
    { name: "Zlatan Ibrahimović", goals: 561, seed: true },
    { name: "Imre Schlosser", goals: 553, seed: true },
    { name: "Fernando Peyroteo", goals: 553, seed: true },
    { name: "Uwe Seeler", goals: 552, seed: true },
    { name: "Jimmy McGrory", goals: 550, seed: true },
    { name: "Alfredo Di Stéfano", goals: 537, seed: true },
    { name: "György Sárosi", goals: 530, seed: true },
    { name: "Karim Benzema", goals: 523, seed: true },
    { name: "Roberto Dinamite", goals: 513, seed: true },
    { name: "Harry Kane", goals: 511, seed: true },
    { name: "Hugo Sánchez", goals: 506, seed: true },
    { name: "Franz Binder", goals: 503, seed: true },
    { name: "Zico", goals: 501, seed: true },
  ];

  // Bounds mirrored by the database rules. A career cannot exceed these, so an
  // entry outside them is either corrupt or forged.
  const LIMITS = {
    nameMax: 24,
    goalsMax: 2000,
    appsMax: 2000,
    seasonsMin: 1,
    seasonsMax: 40,
  };

  /* Paste into Firebase Console -> Realtime Database -> Rules.
   * Append-only: an entry can be created but never edited or deleted, and the
   * `players` node itself is not writable, so a single .remove() cannot wipe
   * the board. Exported so the game can print it on demand rather than it
   * living only in a chat message. */
  const LEADERBOARD_RULES = {
    rules: {
      players: {
        ".read": true,
        ".indexOn": ["goals"],
        $entry: {
          // Create only: data must not already exist, and must not be removed.
          ".write": "!data.exists() && newData.exists()",
          ".validate":
            "newData.hasChildren(['name','goals','apps','seasons','createdAt'])" +
            " && newData.child('name').isString()" +
            " && newData.child('name').val().length >= 1" +
            " && newData.child('name').val().length <= " + LIMITS.nameMax +
            " && newData.child('goals').isNumber()" +
            " && newData.child('goals').val() >= 0" +
            " && newData.child('goals').val() <= " + LIMITS.goalsMax +
            " && newData.child('apps').isNumber()" +
            " && newData.child('apps').val() >= 0" +
            " && newData.child('apps').val() <= " + LIMITS.appsMax +
            " && newData.child('seasons').isNumber()" +
            " && newData.child('seasons').val() >= " + LIMITS.seasonsMin +
            " && newData.child('seasons').val() <= " + LIMITS.seasonsMax +
            " && newData.child('createdAt').val() == now",
          $other: { ".validate": true },
        },
      },
    },
  };

  function cleanName(raw) {
    // Strip control characters and collapse whitespace before capping length.
    return String(raw == null ? "" : raw)
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, LIMITS.nameMax);
  }

  function finiteInt(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : null;
  }

  /* Validate and coerce a submission. Returns null when the entry could never
   * be accepted, so the caller can fail without a network round trip. */
  function normalizeEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = cleanName(raw.name);
    const goals = finiteInt(raw.goals);
    const apps = finiteInt(raw.apps);
    const seasons = finiteInt(raw.seasons);
    if (!name) return null;
    if (goals == null || goals < 0 || goals > LIMITS.goalsMax) return null;
    if (apps == null || apps < 0 || apps > LIMITS.appsMax) return null;
    if (seasons == null || seasons < LIMITS.seasonsMin || seasons > LIMITS.seasonsMax) return null;
    const entry = { name, goals, apps, seasons };
    // Optional colour, all bounded. Absent values are simply omitted.
    const optionalInts = ["assists", "trophies", "ballonDors", "intlCaps", "intlGoals"];
    for (const key of optionalInts) {
      const v = finiteInt(raw[key]);
      if (v != null && v >= 0 && v <= LIMITS.goalsMax) entry[key] = v;
    }
    if (raw.era) entry.era = cleanName(raw.era);
    if (raw.difficulty) entry.difficulty = cleanName(raw.difficulty);
    if (raw.country) entry.country = cleanName(raw.country);
    return entry;
  }

  /* Merge live submissions with the seed benchmarks into one ranked board.
   * Sorted by goals, then by fewer appearances (a better strike rate breaks
   * the tie), then by name so the order is stable across reloads. */
  function mergeAndRank(entries, limit) {
    const all = SEED_ENTRIES.map((e) => Object.assign({}, e))
      .concat((entries || []).filter(Boolean).map((e) => Object.assign({}, e)));
    all.sort((a, b) =>
      (b.goals || 0) - (a.goals || 0) ||
      (a.apps || 0) - (b.apps || 0) ||
      String(a.name).localeCompare(String(b.name)));
    const ranked = all.map((e, i) => Object.assign(e, { rank: i + 1 }));
    return limit ? ranked.slice(0, limit) : ranked;
  }

  /* Where a given goal total would place, without inserting it. Used to show
   * the player their standing before they decide to submit. */
  function projectedRank(goals, entries) {
    const board = mergeAndRank(entries);
    let rank = 1;
    for (const e of board) { if ((e.goals || 0) > goals) rank++; else break; }
    return rank;
  }

  window.createLeaderboard = function (configOverride) {
    let db = null;
    let initError = null;
    let initReason = null;
    let listener = null;
    let lastRead = null;
    const config = configOverride || window.FIREBASE_CONFIG || DEFAULT_FIREBASE_CONFIG;

    /* Firebase is optional; the board degrades to the seed rather than breaking.
     * The failure REASON is recorded separately, because a single generic
     * "unavailable" message once sent us hunting for a network problem when the
     * SDK was fine and the config file had 404'd. Each cause now names itself. */
    const sdkPresent = typeof firebase !== "undefined";
    try {
      if (!sdkPresent) {
        initReason = "sdk-missing";
        initError = "Firebase SDK did not load (blocked, offline, or the <script> tag is missing).";
      } else if (!config || !config.databaseURL) {
        initReason = "config-missing";
        initError = "No Firebase config — databaseURL is missing.";
      } else {
        if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(config);
        db = firebase.database();
        initReason = "ok";
      }
    } catch (e) {
      initReason = "init-threw";
      initError = `Firebase failed to initialise: ${(e && e.message) || e}`;
      db = null;
    }

    const available = () => !!db;

    /* One-line health check for the browser console:
     *     window.LEADERBOARD.diagnostics()
     * Reports every link in the chain so a connectivity question can be
     * answered without digging through the Network tab. */
    function diagnostics() {
      const report = {
        sdkLoaded: sdkPresent,
        configPresent: !!(config && config.databaseURL),
        configSource: configOverride ? "argument" : window.FIREBASE_CONFIG ? "window.FIREBASE_CONFIG" : "built-in default",
        databaseURL: (config && config.databaseURL) || null,
        initialised: !!db,
        reason: initReason,
        error: initError,
        lastRead,
      };
      if (!db) {
        report.fix = initReason === "sdk-missing"
          ? "Check the firebase-app-compat.js and firebase-database-compat.js <script> tags load (Network tab)."
          : initReason === "config-missing"
            ? "databaseURL is not set — check DEFAULT_FIREBASE_CONFIG in src/leaderboard.js."
            : "See error above.";
      }
      return report;
    }

    // Reads are bounded so a hanging socket cannot leave the tab spinning.
    function withTimeout(promise, ms, fallback) {
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => { if (!settled) { settled = true; resolve(fallback); } }, ms);
        promise.then((v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } })
          .catch(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback); } });
      });
    }

    /* Top entries, always resolving — never rejecting — so callers can render
     * unconditionally. `live` reports whether the database actually answered. */
    function fetchTop(limit) {
      const n = Math.max(1, Math.min(200, limit || 25));
      if (!db) return Promise.resolve({ entries: mergeAndRank([], n), live: false, error: initError, reason: initReason });
      const query = db.ref("players").orderByChild("goals").limitToLast(n);
      const read = query.once("value").then((snap) => {
        const rows = [];
        snap.forEach((child) => {
          const v = child.val() || {};
          rows.push({
            id: child.key, name: cleanName(v.name), goals: finiteInt(v.goals) || 0,
            apps: finiteInt(v.apps) || 0, seasons: finiteInt(v.seasons) || 0,
            trophies: finiteInt(v.trophies) || 0, ballonDors: finiteInt(v.ballonDors) || 0,
            era: v.era, difficulty: v.difficulty, country: v.country, createdAt: v.createdAt,
          });
        });
        lastRead = { at: new Date().toISOString(), live: true, rows: rows.length, error: null };
        return { entries: mergeAndRank(rows, n), live: true, error: null };
      }).catch((e) => {
        // Most likely a rules problem — surface it rather than blaming the network.
        const msg = (e && (e.code || e.message)) || "read failed";
        lastRead = { at: new Date().toISOString(), live: false, rows: 0, error: msg };
        return { entries: mergeAndRank([], n), live: false, error: msg };
      });
      return withTimeout(read, 6000, { entries: mergeAndRank([], n), live: false, error: "timed out" });
    }

    /* Submit a finished career. Resolves { ok, error } and never rejects. */
    function submit(raw) {
      const entry = normalizeEntry(raw);
      if (!entry) return Promise.resolve({ ok: false, error: "That career could not be validated." });
      if (!db) return Promise.resolve({ ok: false, error: initError || "No connection to the leaderboard.", reason: initReason });
      entry.createdAt = firebase.database.ServerValue.TIMESTAMP;
      const write = db.ref("players").push(entry)
        .then((ref) => ({ ok: true, id: ref.key, error: null }))
        .catch((e) => ({ ok: false, error: (e && e.message) || "Submission was rejected." }));
      return withTimeout(write, 8000, { ok: false, error: "Submission timed out." });
    }

    /* Live updates. Returns an unsubscribe function; safe to call when the
     * database is unavailable. */
    function subscribe(limit, callback) {
      if (!db || typeof callback !== "function") return function () {};
      const n = Math.max(1, Math.min(200, limit || 25));
      const query = db.ref("players").orderByChild("goals").limitToLast(n);
      listener = query.on("value", () => { fetchTop(n).then(callback); });
      return function () { try { query.off("value", listener); } catch (e) {} listener = null; };
    }

    return {
      available, fetchTop, submit, subscribe, diagnostics,
      normalizeEntry, mergeAndRank, projectedRank, cleanName,
      SEED_ENTRIES, LIMITS, LEADERBOARD_RULES, config,
      initError: () => initError,
      initReason: () => initReason,
    };
  };

  // Exposed for the headless harness, which tests the pure ranking/validation
  // logic without a browser or a network.
  window.__LEADERBOARD_PURE__ = {
    normalizeEntry, mergeAndRank, projectedRank, cleanName,
    SEED_ENTRIES, LIMITS, LEADERBOARD_RULES,
  };
})();
