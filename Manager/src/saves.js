/* ============================================================================
 * FOOTBALL MANAGER — PERSISTENT CAREER SAVE (brief §3)
 *
 * IndexedDB, two slots: CURRENT and PREVIOUS. Every save first copies
 * whatever CURRENT already held into PREVIOUS (a one-generation recovery —
 * if a write lands mid-corruption or a bug slips into the state just
 * written, there is still a working career one step back, not none at all),
 * then writes the new state into CURRENT. A browser refresh reads CURRENT
 * back on load; PREVIOUS is only ever touched by an explicit recovery.
 *
 * WHAT GETS SAVED, AND WHY IT'S SAFE TO DROP THE REST
 *   world.clubs / managers / freeManagers / news / history / playerClubId /
 *   playerMovements / playerMatches / agentRosters / the early-season
 *   partial-league state / rng.state / seed — everything the simulation
 *   cannot regenerate.
 *   world.clubIndex / managerIndex / _profiles / _selections are NOT saved —
 *   they are pure derived lookups (id -> object, or a cached rating), exactly
 *   the same ones createWorld leaves empty and world.js rebuilds on first
 *   use. Saving them would be redundant at best; at worst, JSON round-tripping
 *   would silently turn a shared object reference (e.g. a jobless manager
 *   who lives in BOTH world.managers and world.freeManagers, on purpose, so
 *   a mutation to one shows up in the other) into two independent copies
 *   that quietly drift apart the next time either one is touched. Rebuilt
 *   fresh after every load instead, the same way the rest of the game
 *   already treats them.
 *
 * MILESTONES — called from ui.js at: career start, taking a job, before/
 * after a season sim, after the transfer window's movements are resolved,
 * after each end-of-season decision card, and season complete. Each call is
 * cheap (an IndexedDB put of one record) and fire-and-forget from the
 * caller's point of view — see saveNow's return value if a caller ever
 * needs to know whether it actually landed.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});

  const DB_NAME = "manager1000gg";
  const DB_VERSION = 1;
  const STORE = "career";
  const SCHEMA_VERSION = 1;
  const KEY_CURRENT = "current";
  const KEY_PREVIOUS = "previous";

  function available() {
    return typeof indexedDB !== "undefined" && indexedDB != null;
  }

  let _dbPromise = null;
  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      if (!available()) { reject(new Error("indexedDB unavailable")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { _dbPromise = null; reject(req.error); };
    });
    return _dbPromise;
  }

  function idbOp(mode, run) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = run(store);
      let result;
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("save transaction aborted"));
    }));
  }
  const idbGet = (key) => idbOp("readonly", (s) => s.get(key));
  const idbPut = (key, val) => idbOp("readwrite", (s) => s.put(val, key));
  const idbDel = (key) => idbOp("readwrite", (s) => s.delete(key));

  /* --------------------------- world <-> plain data ------------------------ */
  const WORLD_FIELDS = [
    "seed", "year", "season", "clubs", "managers", "freeManagers", "news",
    "history", "playerClubId", "playerMovements", "playerMatches",
    "agentRosters", "clubTransferLog",
    "_partialLeague", "_earlySnapshot", "_lastEuroQualification",
  ];

  function packWorld(world) {
    const data = {};
    for (const k of WORLD_FIELDS) if (world[k] !== undefined) data[k] = world[k];
    data.rngState = world.rng.state;
    return data;
  }

  function unpackWorld(data) {
    const world = {};
    for (const k of WORLD_FIELDS) if (data[k] !== undefined) world[k] = data[k];
    world.clubs = world.clubs || [];
    world.managers = world.managers || [];
    world.news = world.news || [];
    world.history = world.history || [];
    world.playerMatches = world.playerMatches || [];

    world.clubIndex = {};
    for (const c of world.clubs) world.clubIndex[c.id] = c;
    world.managerIndex = {};
    for (const m of world.managers) world.managerIndex[m.id] = m;
    // See the file header: rebuild the shared reference rather than trust
    // the two independent copies JSON.stringify just made of it.
    const freeIds = new Set((data.freeManagers || []).map((m) => m.id));
    world.freeManagers = world.managers.filter((m) => freeIds.has(m.id));

    world._profiles = {};
    world._selections = {};

    world.rng = MG.createRng(world.seed, "world");
    if (data.rngState != null) world.rng.state = data.rngState;

    MG.world.attachApi(world);

    // Every id minted anywhere in the world (a signing, an academy graduate,
    // a regen, a newly generated manager) comes off these two counters —
    // fast-forward them past the highest id already alive in this save, or
    // the very next one collides with someone already in the world.
    let maxPlayerId = 0;
    for (const c of world.clubs) {
      for (const p of c.squad) if (p.id > maxPlayerId) maxPlayerId = p.id;
      if (c.academy) for (const p of c.academy.players) if (p.id > maxPlayerId) maxPlayerId = p.id;
    }
    MG.players.setNextId(maxPlayerId + 1);
    let maxManagerId = 0;
    for (const m of world.managers) if (m.id > maxManagerId) maxManagerId = m.id;
    MG.managers.setNextId(maxManagerId + 1);

    return world;
  }

  /* ------------------------------ the record -------------------------------
   * uiState carries what a fresh page load needs to put the manager back
   * where he was: his own record (found by id in the reloaded world, not
   * re-serialized separately, for the same shared-reference reason as
   * freeManagers above), which club, which tab, the season-by-season career
   * table, WHERE IN THE SEASON he had got to, and the plain-data results of
   * the season just gone that the screens between a final whistle and the
   * next pre-season are drawn from.
   *
   * That last part is not decoration. Landing every resume on "start the
   * next season" silently skipped the entire post-season — the board's
   * review, the SIGN/VETO on transfers the board had made, and both
   * end-of-season decision windows — for anyone who closed the tab after a
   * season ended. The pending transfers were still sitting unresolved in
   * world.playerMovements; the manager simply never got asked, which is the
   * exact "the game moved on without you" failure the decision engine is
   * supposed to make impossible. ui.js maps the stored stage onto a safe
   * resume point (see RESUME_STAGE there).
   *
   * Only plain data is stored. lastReport is deliberately absent — it lives
   * on club.board.report, which is already saved with the club, so ui.js
   * reads it back from there rather than keeping a second copy that could
   * drift. In-progress decision cards are still disposable
   * — their contexts hold live object graphs, so a resume re-enters the
   * window and draws fresh cards rather than pretending to restore a
   * half-answered one. */
  function pack(world, uiState) {
    return {
      schema: SCHEMA_VERSION,
      savedAt: Date.now(),
      world: packWorld(world),
      ui: {
        managerId: uiState.manager ? uiState.manager.id : null,
        clubId: uiState.clubId,
        career: uiState.career || [],
        tab: uiState.tab || "squad",
        stage: uiState.stage || null,
        hubTab: uiState.hubTab || "overview",
        lastRow: uiState.lastRow || null,
        lastBrief: uiState.lastBrief || null,
        lastTopScorer: uiState.lastTopScorer || null,
        lastMoveSummary: uiState.lastMoveSummary || null,
        lastApproach: uiState.lastApproach || null,
        sackReason: uiState.sackReason || null,
      },
    };
  }

  function unpack(record) {
    if (!record || record.schema !== SCHEMA_VERSION) return null;
    const world = unpackWorld(record.world);
    if (!world.clubs.length) return null;
    const manager = record.ui.managerId != null ? world.managerIndex[record.ui.managerId] : null;
    const u = record.ui;
    return {
      world,
      uiState: {
        manager,
        clubId: u.clubId,
        career: u.career || [],
        tab: u.tab || "squad",
        stage: u.stage || null,
        hubTab: u.hubTab || "overview",
        lastRow: u.lastRow || null,
        lastBrief: u.lastBrief || null,
        lastTopScorer: u.lastTopScorer || null,
        lastMoveSummary: u.lastMoveSummary || null,
        lastApproach: u.lastApproach || null,
        sackReason: u.sackReason || null,
      },
    };
  }

  /* -------------------------------- public API ------------------------------ */
  /** Write the current career to IndexedDB. Fire-and-forget from a caller's
   *  point of view — resolves true/false, never throws (a save that fails
   *  logs a warning and leaves the last good save exactly as it was). */
  function saveNow(world, uiState) {
    if (!available() || !world || !world.clubs || !world.clubs.length) return Promise.resolve(false);
    let record;
    try { record = pack(world, uiState); }
    catch (err) { console.warn("save: failed to pack career", err); return Promise.resolve(false); }
    return idbGet(KEY_CURRENT)
      .then((prev) => (prev ? idbPut(KEY_PREVIOUS, prev) : null))
      .then(() => idbPut(KEY_CURRENT, record))
      .then(() => true)
      .catch((err) => { console.warn("save failed:", err); return false; });
  }

  function loadCurrent() {
    if (!available()) return Promise.resolve(null);
    return idbGet(KEY_CURRENT)
      .then((record) => { try { return unpack(record); } catch (err) { console.warn("current save failed to load:", err); return null; } })
      .catch(() => null);
  }

  /** The one-generation-back recovery slot — offered when CURRENT is missing
   *  or fails to load, never used automatically. */
  function loadPrevious() {
    if (!available()) return Promise.resolve(null);
    return idbGet(KEY_PREVIOUS)
      .then((record) => { try { return unpack(record); } catch (err) { console.warn("recovery save failed to load:", err); return null; } })
      .catch(() => null);
  }

  function hasSave() {
    if (!available()) return Promise.resolve(false);
    return idbGet(KEY_CURRENT).then((r) => !!r).catch(() => false);
  }

  /** Wipes both slots — "start a brand new career" has to mean it, or the
   *  next milestone save just resurrects the old one underneath it. */
  function clearAll() {
    if (!available()) return Promise.resolve(false);
    return Promise.all([idbDel(KEY_CURRENT), idbDel(KEY_PREVIOUS)]).then(() => true).catch(() => false);
  }

  MG.saves = { available, saveNow, loadCurrent, loadPrevious, hasSave, clearAll };
})(typeof globalThis !== "undefined" ? globalThis : this);
