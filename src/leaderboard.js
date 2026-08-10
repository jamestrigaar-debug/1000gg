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
    // The entry bar. Every real benchmark on the board is above 500, so a
    // smaller career could never rank — submitting one is pure noise. Enforced
    // in the database rules as well as here, because a client-side gate on a
    // public write is a courtesy, not a control.
    goalsMin: 500,
    goalsMax: 2000,
    appsMax: 2000,
    seasonsMin: 1,
    seasonsMax: 40,
    careerIdMax: 64,
    challengeIdMax: 32,
    seedMax: 64,
  };

  /* How many careers a challenge accepts. Two is a duel; six is the most that
   * still reads as a table rather than a leaderboard. Declared up here because
   * LEADERBOARD_RULES below interpolates them. */
  const CHALLENGE_PLAYERS_MIN = 2;
  const CHALLENGE_PLAYERS_MAX = 6;

  /* Paste into Firebase Console -> Realtime Database -> Rules.
   * Append-only: an entry can be created but never edited or deleted, and the
   * `players` node itself is not writable, so a single .remove() cannot wipe
   * the board.
   *
   * The create-only write rule is also what stops a career being submitted
   * twice. Entries are keyed by a stable career id rather than a random push
   * key, so a resubmission targets a path that already exists and the database
   * refuses it — no matter what the client believes, or what has been edited in
   * devtools. A client-side flag cannot guard a public write; this can.
   *
   * Exported so the game can print it on demand rather than it living only in a
   * chat message: window.LEADERBOARD.LEADERBOARD_RULES */
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
            " && newData.child('goals').val() >= " + LIMITS.goalsMin +
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

      /* Challenges: a seed plus a locked ruleset, and one result per career.
       *
       * Deliberately NOT subject to the 500-goal floor above. That bar exists
       * because 27 real benchmarks sit above it on the global board and a
       * smaller career could never rank. A challenge between two friends is its
       * own contest — 180 goals beating 140 is a perfectly good result, and a
       * floor would make most challenges end in nothing.
       *
       * Write rules cascade downward but denials do not, so `$challenge` being
       * create-only (settings can never be edited after the link is shared)
       * does not stop `entries/$careerId` granting its own create-only write. */
      challenges: {
        ".read": true,
        $challenge: {
          ".write": "!data.exists() && newData.exists()",
          ".validate": "newData.hasChildren(['seed','createdAt'])",
          seed: { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= " + LIMITS.seedMax },
          createdAt: { ".validate": "newData.val() == now" },
          /* Bounds the stored value; it cannot bound the number of entries,
           * because rules have no way to count children. The cap is applied
           * when a player tries to join. */
          maxPlayers: { ".validate": "newData.isNumber() && newData.val() >= " + CHALLENGE_PLAYERS_MIN +
                                     " && newData.val() <= " + CHALLENGE_PLAYERS_MAX },
          entries: {
            $careerId: {
              // One result per career, and it can never be edited afterwards.
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

  /* Firebase keys cannot contain . # $ [ ] or / — strip anything else out so a
   * malformed id becomes an invalid submission rather than a broken path. As
   * with challenge ids, a non-string is refused rather than stringified. */
  function cleanCareerId(raw) {
    if (typeof raw !== "string") return "";
    return raw
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, LIMITS.careerIdMax);
  }

  function finiteInt(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : null;
  }

  /* ------------------------------ CHALLENGES ------------------------------ */

  /* The code is typed by hand, read aloud and pasted into chat, so the alphabet
   * drops 0/1/i/l/o and every uppercase letter — nothing in it can be mistaken
   * for something else. Six characters of 31 is ~887 million: short enough to
   * retype from a phone screen, and collisions are handled rather than assumed
   * away (see createChallenge — a create-only write simply refuses the second
   * one, and we generate another). */
  const CHALLENGE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
  const CHALLENGE_CODE_LENGTH = 6;
  function newChallengeId() {
    const n = CHALLENGE_CODE_LENGTH;
    let out = "";
    const cryptoObj = typeof crypto !== "undefined" ? crypto : null;
    if (cryptoObj && cryptoObj.getRandomValues) {
      const buf = new Uint8Array(n);
      cryptoObj.getRandomValues(buf);
      for (let i = 0; i < n; i++) out += CHALLENGE_ALPHABET[buf[i] % CHALLENGE_ALPHABET.length];
    } else {
      for (let i = 0; i < n; i++) out += CHALLENGE_ALPHABET[Math.floor(Math.random() * CHALLENGE_ALPHABET.length)];
    }
    return out;
  }

  /* Stored lowercase because Firebase keys are case-sensitive; shown uppercase
   * because a code being read out loud is easier to transcribe that way. */
  function formatChallengeCode(id) {
    return cleanChallengeId(id).toUpperCase();
  }

  /* Non-strings are rejected rather than coerced: String({}) is
   * "[object Object]", which survives the character filter as "objectobject"
   * and would look like a perfectly good id. */
  function cleanChallengeId(raw) {
    if (typeof raw !== "string") return "";
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, LIMITS.challengeIdMax);
  }

  /* The four settings a challenge locks. All of them change what a career can
   * score, so a challenge that let each side pick its own would not be a
   * contest. They live in the database rather than the link so they cannot be
   * edited on the way to the other player. */
  const CHALLENGE_DIFFICULTIES = ["easy", "medium", "hard", "impossible"];
  const CHALLENGE_ERAS = ["classic", "modern", "recent", "current", "all"];
  const CHALLENGE_RATING_MODES = ["peak", "at-time"];
  function oneOf(raw, allowed, fallback) {
    const v = String(raw == null ? "" : raw).toLowerCase().trim();
    return allowed.indexOf(v) >= 0 ? v : fallback;
  }

  function normalizeChallenge(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = cleanChallengeId(raw.id);
    const seed = String(raw.seed == null ? "" : raw.seed).replace(/[^A-Za-z0-9_-]/g, "").slice(0, LIMITS.seedMax);
    if (!seed) return null;
    const players = finiteInt(raw.maxPlayers);
    const challenge = {
      seed,
      era: oneOf(raw.era, CHALLENGE_ERAS, "all"),
      ratingMode: oneOf(raw.ratingMode, CHALLENGE_RATING_MODES, "peak"),
      difficulty: oneOf(raw.difficulty, CHALLENGE_DIFFICULTIES, "medium"),
      maxPlayers: players == null ? CHALLENGE_PLAYERS_MIN
        : Math.max(CHALLENGE_PLAYERS_MIN, Math.min(CHALLENGE_PLAYERS_MAX, players)),
    };
    if (id) challenge.id = id;
    const by = cleanName(raw.createdBy);
    if (by) challenge.createdBy = by;
    return challenge;
  }

  /* A challenge result. Same shape as a leaderboard entry minus the 500-goal
   * floor, plus the career id so a player recognises their own row. */
  function normalizeChallengeEntry(raw) {
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
    for (const key of ["assists", "trophies", "ballonDors", "intlCaps", "intlGoals", "peakRating"]) {
      const v = finiteInt(raw[key]);
      if (v != null && v >= 0 && v <= LIMITS.goalsMax) entry[key] = v;
    }
    if (raw.club) entry.club = cleanName(raw.club);
    if (raw.country) entry.country = cleanName(raw.country);
    return entry;
  }

  /* Rank a challenge's results. Goals first, then fewer appearances, then more
   * trophies — the same ordering as the global board, so a player who has read
   * one table already knows how to read this one. */
  function challengeStandings(entries, youCareerId) {
    const you = cleanCareerId(youCareerId);
    const rows = (entries || [])
      .map((e) => {
        const clean = normalizeChallengeEntry(e);
        if (!clean) return null;
        clean.careerId = cleanCareerId(e.careerId);
        clean.createdAt = e.createdAt || 0;
        clean.you = !!you && clean.careerId === you;
        return clean;
      })
      .filter(Boolean)
      .sort((a, b) =>
        b.goals - a.goals ||
        a.apps - b.apps ||
        (b.trophies || 0) - (a.trophies || 0) ||
        String(a.name).localeCompare(String(b.name)));
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
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

    /* Submit a finished career. Resolves { ok, error } and never rejects.
     *
     * `careerId` keys the row. Writing to players/<careerId> with set() rather
     * than push() means the create-only rule rejects a second submission of the
     * same career at the database, which is the only place a guard actually
     * holds — the previous client-side flag was one devtools edit from being
     * defeated. */
    function submit(raw, careerId) {
      const entry = normalizeEntry(raw);
      if (!entry) return Promise.resolve({ ok: false, error: "That career could not be validated.", reason: "invalid" });
      if (entry.goals < LIMITS.goalsMin) {
        return Promise.resolve({ ok: false, reason: "below-minimum",
          error: `The leaderboard starts at ${LIMITS.goalsMin} career goals.` });
      }
      const key = cleanCareerId(careerId);
      if (!key) return Promise.resolve({ ok: false, error: "This career has no id.", reason: "no-career-id" });
      if (!db) return Promise.resolve({ ok: false, error: initError || "No connection to the leaderboard.", reason: initReason });
      entry.createdAt = firebase.database.ServerValue.TIMESTAMP;
      const write = db.ref("players/" + key).set(entry)
        .then(() => ({ ok: true, id: key, error: null }))
        .catch((e) => {
          // PERMISSION_DENIED here is the expected outcome for a resubmission:
          // the key exists and the create-only rule refuses to overwrite it.
          const code = (e && (e.code || e.message)) || "";
          if (/PERMISSION_DENIED/i.test(code)) {
            return { ok: false, reason: "already-submitted",
              error: "This career is already on the leaderboard." };
          }
          return { ok: false, error: code || "Submission was rejected.", reason: "rejected" };
        });
      return withTimeout(write, 8000, { ok: false, error: "Submission timed out.", reason: "timeout" });
    }

    /* ---------------------------- CHALLENGES ------------------------------
     * A challenge is one create-only row holding the seed and the locked
     * ruleset, plus one create-only result per career underneath it. Nothing
     * here needs an account or a server: the link is the only thing that
     * controls who can join, and the database refuses every edit after the
     * fact. */

    /* Create a challenge and return its code. Resolves { ok, id, challenge }.
     *
     * Six-character codes collide about once in 887 million, which is rare but
     * not never — and the create-only rule turns a collision into a rejected
     * write rather than a silently stolen challenge. So a rejection is retried
     * with a fresh code a couple of times; if the rules themselves are the
     * problem all three fail and the last error is reported. */
    function createChallenge(spec) {
      if (!db) return Promise.resolve({ ok: false, reason: initReason, error: initError || "No connection to the leaderboard." });

      const attempt = (triesLeft) => {
        const id = cleanChallengeId((spec && spec.id) || newChallengeId());
        if (!id) return Promise.resolve({ ok: false, reason: "bad-id", error: "Could not generate a challenge code." });
        const challenge = normalizeChallenge(Object.assign({ seed: `chal-${id}` }, spec || {}, { id }));
        if (!challenge) return Promise.resolve({ ok: false, reason: "invalid", error: "That challenge could not be validated." });
        const payload = Object.assign({}, challenge, { createdAt: firebase.database.ServerValue.TIMESTAMP });
        delete payload.id;  // the id is the key; storing it twice invites drift
        return db.ref("challenges/" + id).set(payload)
          .then(() => ({ ok: true, id, challenge, error: null }))
          .catch((e) => {
            const code = (e && (e.code || e.message)) || "";
            // A caller-supplied id is a deliberate choice, so never silently
            // swap it for a generated one.
            const canRetry = triesLeft > 0 && !(spec && spec.id) && /PERMISSION_DENIED/i.test(code);
            if (canRetry) return attempt(triesLeft - 1);
            return { ok: false, reason: /PERMISSION_DENIED/i.test(code) ? "rejected" : "failed",
                     error: code || "Could not create the challenge." };
          });
      };

      return withTimeout(attempt(2), 8000, { ok: false, reason: "timeout", error: "Creating the challenge timed out." });
    }

    /* Read a challenge and every result posted to it so far. Always resolves.
     * `found: false` means the link is wrong or the challenge was never
     * created — distinct from `ok: false`, which means we could not look. */
    function fetchChallenge(id, youCareerId) {
      const key = cleanChallengeId(id);
      const miss = (reason, error) => ({ ok: false, found: false, reason, error, challenge: null,
                                         standings: [], full: false, slotsLeft: 0 });
      if (!key) return Promise.resolve(miss("bad-id", "That is not a valid challenge code."));
      if (!db) return Promise.resolve(miss(initReason, initError || "No connection to the leaderboard."));
      const read = db.ref("challenges/" + key).once("value").then((snap) => {
        const v = snap.val();
        if (!v) return Object.assign(miss("not-found", "No challenge found with that code."), { ok: true });
        const challenge = normalizeChallenge(Object.assign({}, v, { id: key }));
        if (!challenge) return Object.assign(miss("corrupt", "That challenge is missing its seed."), { ok: true });
        challenge.createdAt = v.createdAt || 0;
        const rows = [];
        const entries = v.entries || {};
        for (const careerId of Object.keys(entries)) {
          rows.push(Object.assign({}, entries[careerId], { careerId }));
        }
        const standings = challengeStandings(rows, youCareerId);
        /* The player cap is counted here and enforced when someone tries to
         * join. It cannot be a database rule — Realtime Database rules have no
         * way to count a node's children — so it is a lobby size, not a
         * security boundary. Enforcing it at join is also the only humane
         * place: refusing at submit would throw away a finished career. */
        const taken = standings.length;
        return { ok: true, found: true, reason: "ok", challenge, standings,
                 full: taken >= challenge.maxPlayers,
                 slotsLeft: Math.max(0, challenge.maxPlayers - taken), error: null };
      }).catch((e) => miss("read-failed", (e && (e.code || e.message)) || "read failed"));
      return withTimeout(read, 6000, miss("timeout", "The challenge took too long to load."));
    }

    /** Post a finished career to a challenge. One result per career id. */
    function submitChallengeEntry(id, raw, careerId) {
      const key = cleanChallengeId(id);
      const career = cleanCareerId(careerId);
      const entry = normalizeChallengeEntry(raw);
      if (!key) return Promise.resolve({ ok: false, reason: "bad-id", error: "That challenge link is not valid." });
      if (!career) return Promise.resolve({ ok: false, reason: "no-career-id", error: "This career has no id." });
      if (!entry) return Promise.resolve({ ok: false, reason: "invalid", error: "That career could not be validated." });
      if (!db) return Promise.resolve({ ok: false, reason: initReason, error: initError || "No connection to the leaderboard." });
      entry.createdAt = firebase.database.ServerValue.TIMESTAMP;
      const write = db.ref(`challenges/${key}/entries/${career}`).set(entry)
        .then(() => ({ ok: true, id: key, error: null }))
        .catch((e) => {
          // As on the global board, PERMISSION_DENIED is the expected answer to
          // a resubmission — the key exists and create-only refuses to replace it.
          const code = (e && (e.code || e.message)) || "";
          if (/PERMISSION_DENIED/i.test(code)) {
            return { ok: false, reason: "already-submitted", error: "This career is already in the challenge." };
          }
          return { ok: false, reason: "rejected", error: code || "Submission was rejected." };
        });
      return withTimeout(write, 8000, { ok: false, reason: "timeout", error: "Submission timed out." });
    }

    /* Watch a challenge so the head-to-head fills in the moment the other
     * player retires, instead of asking them to refresh. */
    function subscribeChallenge(id, youCareerId, callback) {
      const key = cleanChallengeId(id);
      if (!db || !key || typeof callback !== "function") return function () {};
      const ref = db.ref("challenges/" + key);
      const handler = ref.on("value", () => { fetchChallenge(key, youCareerId).then(callback); });
      return function () { try { ref.off("value", handler); } catch (e) {} };
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
      createChallenge, fetchChallenge, submitChallengeEntry, subscribeChallenge,
      normalizeEntry, mergeAndRank, projectedRank, cleanName, cleanCareerId,
      normalizeChallenge, normalizeChallengeEntry, challengeStandings,
      newChallengeId, cleanChallengeId, formatChallengeCode,
      CHALLENGE_PLAYERS_MIN, CHALLENGE_PLAYERS_MAX,
      SEED_ENTRIES, LIMITS, LEADERBOARD_RULES, config,
      initError: () => initError,
      initReason: () => initReason,
    };
  };

  // Exposed for the headless harness, which tests the pure ranking/validation
  // logic without a browser or a network.
  window.__LEADERBOARD_PURE__ = {
    normalizeEntry, mergeAndRank, projectedRank, cleanName, cleanCareerId,
    normalizeChallenge, normalizeChallengeEntry, challengeStandings,
    newChallengeId, cleanChallengeId, formatChallengeCode,
    CHALLENGE_PLAYERS_MIN, CHALLENGE_PLAYERS_MAX,
    SEED_ENTRIES, LIMITS, LEADERBOARD_RULES,
  };
})();
