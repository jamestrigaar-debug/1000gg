/* ============================================================================
 * FOOTBALL MANAGER — BROWSER SHELL
 *
 * Three tiers, top to bottom, on one page:
 *
 *   1. MY CAREER      who you are, what you have won, how last season went
 *   2. DECISIONS      the window everything actually happens in
 *   3. CLUB & WORLD   squad, tactics, transfers, table, log, world
 *
 * The decision window is a small state machine:
 *
 *   tactics (mandatory on joining) -> pre-season cards -> PLAY SEASON
 *     -> result + board report -> end-of-season cards -> [ending?] -> repeat
 *
 * The rule worth keeping: a choice's outcome text is the string the engine
 * returned, never a string written here, so what the player reads is always
 * what the simulation actually did.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp, round1 } = MG.util;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = (m) => {
    const a = Math.abs(m);
    if (a >= 1000) return `£${(m / 1000).toFixed(1)}bn`;
    if (a >= 10) return `£${Math.round(m)}m`;
    if (a >= 0.1) return `£${m.toFixed(1)}m`;
    return `£${Math.round(m * 1000)}k`;
  };
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  /* Who is behind the cheque book is public knowledge in real football — this
   * shows the TYPE of owner, never the hidden wealth number behind it. */
  function ownerLabel(c) {
    const t = MG.clubs.OWNER_TYPES && MG.clubs.OWNER_TYPES[c.owner];
    return t ? t.label : "Self-funded";
  }

  const state = {
    world: null, draft: null, manager: null, clubId: null, seed: null,
    stage: "preseason-hub",   // preseason-hub | ready | result | endseason | endseason-done | ending
    cards: [], cardIndex: 0, outcomes: [],
    recent: [], career: [], lastRow: null, lastReport: null, lastBrief: null,
    sackReason: null,
    endingEntry: null, endingView: null, endingOutcome: null,
    tab: "table", tabOpen: false,
    squadSort: "rating", chooserSort: "rating",
    signCount: 0, signPositions: [], signAmbition: "solid", transfersSeason: null, boardRecs: null,
    playerSearch: "", topPos: "ALL",
    hubTab: "overview", hubNewJob: false,
    proposals: [], proposalChoices: [], proposalOutcomes: [],
    moveCards: [], moveChoices: [], moveOutcomes: [], lastMoveSummary: null, lastApproach: null,
    phase: null, earlySnapshot: null, seasonBrief: null,
    lastSeenNewsId: 0, notifOpen: false,
  };
  root.MG_STATE = state;

  /* The 1000goals position-colour language, reused so a striker reads red and a
   * centre-half reads blue in both games. */
  /* Four families, four colours. Eight shades read as clutter rather than
   * information — a subtle blue-vs-blue distinction is not a thing you can
   * act on at a glance across a whole squad list. Back to the simple family
   * colour; the position ITSELF is what tells you FB from CB, and it now sits
   * in a clearer boxed badge (see .ppos) rather than leaning on colour to do
   * that job too. */
  function posClass(pos) {
    if (pos === "GK") return "keeper";
    if (pos === "FW" || pos === "WG" || pos === "AM") return "attack";
    if (pos === "CB" || pos === "FB") return "defence";
    return "midfield";
  }
  /* A quality ring for the rating badge — see the .rtier CSS. Relative to the
   * CLUB's own level rather than a flat world number, because "elite" only
   * ever fires for the Premier League on an absolute scale and a National
   * League manager needs to spot his own standout just as easily as a big
   * club's does. Only the two tails light up; most of a squad reads plain. */
  function ratingTierClass(overall, level) {
    if (level == null) return "";
    const diff = overall - level;
    if (diff >= 8) return "rtier-elite";
    if (diff <= -10) return "rtier-poor";
    return "";
  }
  const ATTR_ROWS = [
    { k: "heading", label: "HDR" }, { k: "fitness", label: "FIT" }, { k: "strength", label: "STR" },
    { k: "leftFoot", label: "LF" }, { k: "rightFoot", label: "RF" }, { k: "speed", label: "SPD" },
    { k: "height", label: "HGT", suffix: "cm" }, { k: "weight", label: "WGT", suffix: "kg" },
  ];
  function attrGrid(p) {
    const defAtr = MG.ratings && MG.ratings.defenceAttribute ? MG.ratings.defenceAttribute(p) : null;
    return `<div class="pattrs">${ATTR_ROWS.map((r) =>
      `<div class="pattr"><span>${r.label}</span><b>${p.attrs[r.k]}${r.suffix || ""}</b></div>`).join("")
      }<div class="pattr"><span>MEN</span><b>${esc(p.mentality)}</b></div>${defAtr != null ? `<div class="pattr"><span>${p.pos === "GK" ? "GK-ATR" : "DEF-ATR"}</span><b>${defAtr}</b></div>` : ""}</div>`;
  }
  const SORTS = {
    rating: (a, b) => b.overall - a.overall,
    name: (a, b) => a.name.localeCompare(b.name),
    pos: (a, b) => MG.players.POSITION_KEYS.indexOf(a.pos) - MG.players.POSITION_KEYS.indexOf(b.pos) || b.overall - a.overall,
    years: (a, b) => a.contract.years - b.contract.years || b.overall - a.overall,
  };

  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.classList.remove("active");
    $(id).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const club = () => state.world.clubById(state.clubId);

  /* ------------------------------ PERSISTENCE ------------------------------
   * brief §3: a browser refresh must not destroy the career. Fired at the
   * milestones the brief names — career start, season start, transfer
   * window, midseason, end season, decision, season complete — from the
   * handful of call sites below, never from render() itself (a save on
   * every render would mean one on every scroll-preserving no-op redraw).
   * Fire-and-forget: MG.saves.saveNow never throws, and nothing here blocks
   * on it — the career keeps moving whether or not the write has landed. */
  function autosave() {
    if (!MG.saves || !state.world || !state.clubId) return;
    // `state` itself is passed rather than a hand-picked subset: saves.js
    // decides what is safe to store, and it is the file that knows why
    // (see its pack()). Picking fields here as well meant adding a field
    // to the save format silently did nothing until BOTH sides were
    // updated — which is exactly how the post-season stage went missing.
    MG.saves.saveNow(state.world, state);
  }

  /** Reopen a career IndexedDB last saw — a browser refresh, not a fresh
   *  start. Everything the save actually carries (world, manager, club,
   *  career table) is restored; everything it deliberately does not (which
   *  screen, an open decision card, a scroll position) lands on "ready" —
   *  the season-overview screen, which reads safely at any point in any
   *  season rather than assuming exactly where play was interrupted. */
  async function resumeSavedCareer() {
    const loaded = await MG.saves.loadCurrent();
    if (!loaded || !loaded.uiState.manager || loaded.uiState.clubId == null) {
      // Corrupt or unreadable current save — fall back to the one-generation
      // recovery slot before giving up on it entirely.
      const recovered = await MG.saves.loadPrevious();
      if (!recovered || !recovered.uiState.manager || recovered.uiState.clubId == null) {
        alert("That save could not be read. Starting a new career instead.");
        return;
      }
      return applyResumedCareer(recovered);
    }
    return applyResumedCareer(loaded);
  }

  /* Where a saved stage resumes. A decision card's own context holds live
   * object graphs that JSON cannot round-trip, so a half-answered window is
   * never restored mid-card — it re-enters at the START of the part of the
   * season it was in, and draws fresh cards.
   *
   *   pre-season anything  -> the hub, and set the window up again
   *   mid-season           -> "ready"; beginSeason() already refuses to
   *                           replay opening weeks it has played (it returns
   *                           the stored snapshot), so KICK OFF resumes into
   *                           the early-season window rather than restarting
   *   post-season anything -> "result", which flows on into the board's
   *                           review, the SIGN/VETO on any movement still
   *                           unresolved in world.playerMovements, and both
   *                           end-of-season windows
   *
   * That last row is the one that matters: every post-season stage used to
   * land on "ready", quietly skipping all of it. */
  /* Screens that open the reference panel automatically — none, now that the
   * strip sits ABOVE the decisions rather than below them. It used to open
   * itself on the season-ahead screen, which was harmless at the bottom of the
   * page and is not harmless at the top: a full league table between the
   * header and the decision pushes the decision off the first screen, which is
   * the one thing this layout exists to prevent.
   *
   * The strip itself is always on screen, so the table, your record, the world
   * and the academy stay one tap away from everywhere in the game — and squad,
   * tactics and contracts are in the pre-season hub, which is why they are no
   * longer duplicated here. */
  const TAB_STAGES = {};

  const RESUME_STAGE = {
    "preseason-hub": "preseason-hub", transfers: "preseason-hub", "transfer-proposals": "preseason-hub",
    preseason1: "preseason-hub", preseason2: "preseason-hub",
    ready: "ready", earlyseason: "ready",
    result: "result", "move-approval": "result", "manager-approach": "result",
    postseason1: "result", postseason2: "result", "endseason-done": "result",
  };

  function applyResumedCareer(loaded) {
    const ui = loaded.uiState;
    if (MG.ratings && MG.ratings.resetHidden) MG.ratings.resetHidden();
    state.world = loaded.world;
    state.manager = ui.manager;
    state.clubId = ui.clubId;
    state.career = ui.career || [];
    state.tab = ui.tab || "table";
    state.hubTab = ui.hubTab || "overview";
    state.hubNewJob = false;
    // In-progress card state is disposable across a refresh — see the
    // RESUME_STAGE note above and saves.js's header.
    state.cards = []; state.cardIndex = 0; state.outcomes = [];
    state.moveCards = []; state.moveChoices = []; state.moveOutcomes = [];
    state.proposals = []; state.proposalChoices = []; state.proposalOutcomes = [];
    state.phase = null; state.earlySnapshot = null; state.seasonBrief = null;
    state.transfersSeason = null; state.signCount = 0; state.signPositions = []; state.boardRecs = null;
    state.recent = [];
    // The season just gone, as the post-season screens need it. lastReport
    // is read back off the club rather than stored twice (it is saved with
    // the club).
    state.lastRow = ui.lastRow || null;
    state.lastBrief = ui.lastBrief || null;
    state.lastTopScorer = ui.lastTopScorer || null;
    state.lastMoveSummary = ui.lastMoveSummary || null;
    state.lastApproach = ui.lastApproach || null;
    state.sackReason = ui.sackReason || null;
    const resumedClub = state.world.clubById(state.clubId);
    state.lastReport = resumedClub && resumedClub.board ? (resumedClub.board.report || null) : null;
    state.lastSeenNewsId = state.world.news.length ? state.world.news[state.world.news.length - 1].id : 0;
    state.stage = RESUME_STAGE[ui.stage] || "preseason-hub";
    render();
    show("screen-career");
  }

  /* ================================ DRAFT ================================= */
  function startDraft() {
    // "START A CAREER" from the welcome screen always means a fresh one —
    // wipe any saved career now rather than leaving it to be silently
    // overwritten at the new career's first autosave, so the CONTINUE
    // button (and the warning beside it) never lies about what it does.
    if (MG.saves && MG.saves.available()) MG.saves.clearAll();
    state.seed = ($("seed-input").value || "").trim() || `mg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    state.draft = MG.draft.createDraft(state.seed, { rerolls: 3 });
    Object.assign(state, {
      manager: null, clubId: null, career: [], outcomes: [], recent: [], cards: [], cardIndex: 0,
      endingEntry: null, endingView: null, endingOutcome: null, lastRow: null, lastReport: null,
    });
    show("screen-draft");
    state.draft.spin();
    renderDraft();
  }

  const STEP_TITLES = {
    tactic: "HOW DO YOU WANT YOUR TEAM TO PLAY?",
    origin: "WHERE ARE YOU FROM?",
    career: "HOW DID YOU GET HERE?",
    personality: "WHO ARE YOU LIKE, IN THE DUGOUT?",
    attributes: "WHOSE COACHING SHAPE DID YOU LEARN?",
  };

  /* Deliberately the LAST place in the game that reads like a stat sheet.
   * The old draft screen showed a rarity tag and a full bar chart of
   * attributes for every roll — which meant you could see exactly what you
   * had before you had played a single season with it. This one shows what
   * a chairman or a fan would actually know about a man before he took the
   * job: his story, not his numbers. Reputation, coaching badge, club
   * affiliation's effect, hidden traits and agent level never appear here at
   * all — see draft.js. */
  function renderDraft() {
    const d = state.draft, step = d.currentStep();
    $("draft-step-title").textContent = STEP_TITLES[step] || "";
    $("draft-progress").textContent = `ROLL ${MG.draft.DRAFT_STEPS.indexOf(step) + 1} / ${MG.draft.DRAFT_STEPS.length}`;
    $("draft-rerolls").innerHTML = `<span class="accent">${d.rerolls}</span> REROLL${d.rerolls === 1 ? "" : "S"}`;
    $("draft-reroll").disabled = d.rerolls <= 0;

    const reel = $("draft-reel");
    let cls = "reel", html = "";
    if (step === "tactic") {
      const t = MG.managers.TACTICS[d.landed.tactic];
      html = `
        <div class="reel-headline">${esc(t.label)}</div>
        <p class="reel-blurb">${esc(t.blurb)}</p>`;
    } else if (step === "origin") {
      const flag = MG.names.flagFor ? MG.names.flagFor(d.landed.nationality) : "";
      html = `
        <div class="reel-headline">${flag} ${esc(d.landed.nationality)}</div>
        <p class="reel-blurb">Where you learned the game.${d.landed.affiliation ? ` A boyhood attachment to <b>${esc(d.landed.affiliation)}</b> that never quite went away.` : ""}</p>`;
    } else if (step === "career") {
      const path = MG.draft.CAREER_PATHS[d.landed.career.key];
      const second = d.landed.career.second ? MG.draft.SECOND_CAREERS[d.landed.career.second] : null;
      html = `
        <div class="reel-headline">${esc(path.label)}</div>
        <p class="reel-blurb">${esc(path.blurb)}${second ? ` And before that, ${esc(second.text)}.` : ""}</p>`;
    } else {
      // personality / attributes — the same ten-name pool, asked two
      // different questions of it.
      const legend = MG.draft.LEGENDS[d.landed[step]];
      const rarityCls = legend.rarity.toLowerCase();
      cls += ` ${rarityCls}`;
      html = `
        <div class="reel-rarity">${esc(legend.rarity)}</div>
        <div class="reel-headline">${esc(legend.name)}</div>
        <div class="reel-sub">in the mould of ${esc(legend.basedOn)}</div>
        <p class="reel-blurb">${esc(legend.blurb)}</p>`;
    }
    reel.className = cls;
    reel.innerHTML = html;
  }

  function draftAccept() {
    if (state.draft.accept()) { state.draft.spin(); renderDraft(); return; }
    state.manager = state.draft.build(($("manager-name").value || "").trim() || null);
    show("screen-loading");
    setTimeout(() => {
      /* Hidden attributes are cached by player id, and a brand-new world hands
       * out the same ids from 1 again — so a second career started in the same
       * tab would inherit the first one's cache entries. They are derived from
       * a per-id seed and so would come back identical anyway, but leaving a
       * dead world's players in the cache is exactly the leak pruneHidden
       * exists to stop. Start clean. */
      if (MG.ratings && MG.ratings.resetHidden) MG.ratings.resetHidden();
      state.world = MG.world.createWorld({ seed: state.seed, startYear: 2026 });
      // The manager was drafted before the world existed, so his id came from a
      // counter createWorld() has since reset and handed out again. Re-issue it
      // here, after the AI managers are minted, or he shares an id with one of
      // them — which double-counted his seasons and broke the carousel.
      state.manager.id = MG.managers.nextId();
      state.world.managers.push(state.manager);
      state.world.managerIndex[state.manager.id] = state.manager;
      renderOffers();
      show("screen-offers");
    }, 30);
  }

  /* ================================ OFFERS ================================ */
  function renderOffers() {
    const m = state.manager;
    $("offers-manager").innerHTML = `
      <div style="font-size:18px;font-weight:800">${esc(m.name)}</div>
      <div class="muted">${esc(m.archetypeName)} · ${esc(m.nationality)} · ${esc(m.tactic)} · reputation <b class="accent">${m.reputation}</b> (${esc(m.reputationTier || "")})</div>
      <div class="muted" style="font-size:13px;margin-top:4px">${m.traits.map(esc).join(" · ")} · ${esc(m.personality)}</div>`;

    const offers = MG.draft.jobOffers(state.world, m, 4);
    if (!offers.length) {
      $("offers-list").innerHTML = `<p class="muted">Nobody will touch you. Start a new career with a different roll.</p>`;
      return;
    }
    $("offers-list").innerHTML = offers.map((o) => `
      <button class="offer" data-club="${o.club.id}">
        <div class="offer-head"><span class="offer-club">${esc(o.club.name)}</span><span class="pill">${esc(o.leagueName)}</span></div>
        <div class="offer-brief">${esc(o.brief || "No brief set")}</div>
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num board-${o.boardStyle.toLowerCase()}" style="font-size:15px">${esc(o.boardStyle)}</div><div class="sb-lab">Boardroom</div></div>
          <div class="stat-box"><div class="sb-num">${o.squadRating}</div><div class="sb-lab">Squad</div></div>
          <div class="stat-box"><div class="sb-num gold">${money(o.budget)}</div><div class="sb-lab">Budget</div></div>
          <div class="stat-box"><div class="sb-num">${o.club.reputation}</div><div class="sb-lab">Club rep</div></div>
        </div>
        <div class="offer-blurb">${esc(o.boardBlurb)}</div>
      </button>`).join("");
    for (const btn of document.querySelectorAll(".offer")) {
      btn.addEventListener("click", () => takeJob(Number(btn.dataset.club)));
    }
  }

  function takeJob(clubId) {
    const world = state.world, c = world.clubById(clubId);
    MG.world.removeManager(world, c, "replaced");
    MG.world.appointManager(world, c, state.manager, { quiet: true });
    state.clubId = clubId;
    world.playerClubId = clubId;
    c.transferList = []; c.targets = [];
    MG.clubs.setSeasonTargets(c, world.clubsInLeague(c.leagueId), world.rng, state.manager);
    state.lastReport = null; state.lastRow = null; state.outcomes = [];
    state.transfersSeason = null; state.signCount = 0; state.signPositions = [];
    // A new job at a new club starts its own notification history — a sacked
    // manager taking his second job does not want ten seasons of a stranger's
    // transfers marked "unread" the moment he sits down.
    state.lastSeenNewsId = world.news.length ? world.news[world.news.length - 1].id : 0;
    // A new job opens with an introduction to the club before anything is
    // asked of the manager — team set-up is still mandatory, it just comes
    // after he has actually met the place.
    state.stage = "preseason-hub";
    state.hubTab = "overview";
    state.hubNewJob = true;
    state.tab = "table";
    render();
    show("screen-career");
    autosave();   // milestone: Career Start
  }

  /* ============================ THE SEASON LOOP ===========================
   * Five decision windows, not two. See decisions.js's PHASES for what each
   * one is FOR; this is the machine that walks them:
   *
   *   briefing -> tactics -> PRE1 -> the window -> PRE2 -> ready
   *     -> [a third of the season is played] -> EARLY
   *     -> [the rest of the season is played] -> result
   *     -> board's transfer dealing -> a job offer, if one came
   *     -> POST1 -> POST2 -> next briefing
   *
   * A window with nothing eligible to ask is skipped silently rather than
   * showing an empty screen — which matters most for EARLY, whose cards all
   * gate on circumstances that may simply not have arisen. */
  const PHASE_AFTER = {
    PRE1: () => beginTransferWindow(),
    PRE2: () => { state.stage = "ready"; render(); autosave(); },     // milestone: Decision (pre-season)
    EARLY: () => finishSeason(),
    POST1: () => runPhase("POST2"),
    POST2: () => { state.stage = "endseason-done"; render(); autosave(); },   // milestone: Decision (post-season)
  };
  // Windows that begin a fresh run of outcomes rather than adding to the one
  // already on screen — so pre-season reads as one list and the post-season
  // reckoning-plus-rebuild reads as another.
  const PHASE_RESETS_OUTCOMES = { PRE1: true, EARLY: true, POST1: true };
  const PHASE_STAGE = { PRE1: "preseason1", PRE2: "preseason2", EARLY: "earlyseason", POST1: "postseason1", POST2: "postseason2" };

  /** Draw and show one decision window. Falls straight through to the next
   *  step if the window has nothing to ask. */
  function runPhase(phaseKey) {
    const n = drawCards(phaseKey);
    if (!n) { PHASE_AFTER[phaseKey](); return; }
    state.stage = PHASE_STAGE[phaseKey];
    render();
  }

  function drawCards(phaseKey) {
    const c = club();
    const ctx = MG.decisions.buildContext(state.world, c, state.manager, state.lastRow, state.earlySnapshot);
    const conf = MG.decisions.PHASES[phaseKey];
    const picked = MG.decisions.pick(MG.decisions.poolFor(phaseKey), ctx, state.world.rng, conf.cards, state.recent);
    state.cards = picked.map((d) => ({ def: d, view: MG.decisions.present(d, ctx, state.world.rng), ctx }));
    state.cardIndex = 0;
    state.phase = phaseKey;
    if (PHASE_RESETS_OUTCOMES[phaseKey]) state.outcomes = [];
    // A longer memory than the old six now that the pools are big enough to
    // support it — the same dilemma coming back two seasons running was the
    // most obvious tell that a career was running out of material.
    for (const p of picked) state.recent.push(p.id);
    while (state.recent.length > 20) state.recent.shift();
    return picked.length;
  }

  /* Every pre-season now opens on the hub — not just the first one at a new
   * club, and not just an overview any more either. A returning season used
   * to skip straight to the transfer wizard, which meant the one screen
   * that actually gathered "who you have, who's coming through, tactics,
   * who's out of contract" only ever showed up once per job, on year one.
   * Everything after this is unchanged once CONTINUE is pressed: the window
   * -> the cards. */
  function beginPreSeason() {
    state.stage = "preseason-hub";
    state.hubTab = "overview";
    state.hubNewJob = false;
    render();
    autosave();   // milestone: Season Start
  }

  /* The board's transfer brief — how many to sign, where, and who is up for
   * sale — before the narrative cards. This is the "everything runs through
   * decisions" principle: the market is a decision, not a separate tab you
   * have to remember to visit. */
  function beginTransferWindow() {
    const c = club();
    state.signCount = 0;
    state.signPositions = [];
    state.signAmbition = "solid";
    // Once per pre-season the board makes its OWN recommendations — surplus,
    // ageing or over-paid players it would move on. They are SUGGESTED (shown
    // and logged), never sold behind your back: you choose what actually goes
    // up for sale. That is the difference between the board advising you and
    // the board overruling you.
    state.boardRecs = new Set(MG.transfers.boardListings(state.world, c));
    if (state.transfersSeason !== state.world.season) {
      state.transfersSeason = state.world.season;
      for (const id of state.boardRecs) {
        const p = c.squad.find((x) => x.id === id);
        if (p) state.world.report(`The board suggest ${p.name} (${p.pos}, ${Math.round(p.overall)}) could be moved on this summer.`, "contract", c.id);
      }
    }
    state.stage = "transfers";
    render();
  }

  /* The board goes to work: it pursues one signing per position you asked for,
   * sells everyone it can find a buyer for, and reports each result — the deals
   * it lands AND the ones it cannot — straight into the log. */
  /* The board goes away and comes back with NAMES.
   *
   * This used to be the one place in the game where a transfer happened to
   * you rather than in front of you: "sign 2, a CM and a FW, be ambitious"
   * and the engine committed both instantly, the manager finding out from a
   * log line afterwards. The SIGN/VETO cards the board's own summer dealing
   * goes through were the proof of the better pattern — you are shown a
   * real player, with what he costs and what it does to the balance, and
   * nothing moves until you say so. So the window now works the same way:
   * the brief above is a SEARCH instruction, and every deal it turns up
   * comes back as a card to approve or pass on. Nothing is committed here.
   *
   * Sales are proposed the same way. Listing a player says "find me a
   * buyer", not "sell him at any price" — the offer that comes back is a
   * number worth seeing before it is accepted. */
  function confirmTransfers() {
    const world = state.world, c = club();
    const ambition = c.mustSell && state.signAmbition === "star" ? "solid" : state.signAmbition;
    const proposals = [];
    // One search per position asked for. A club already proposed to the
    // board is passed to the next search as off-limits, or asking for two
    // centre-halves proposes the same man twice.
    const taken = new Set();
    for (const pos of state.signPositions) {
      const cand = MG.transfers.findSigning(world, c, { pos, quality: ambition, exclude: taken });
      const label = (MG.players.POSITIONS[pos] || {}).name || pos;
      if (cand) { taken.add(cand.player.id); proposals.push({ kind: "in", pos, cand }); }
      else proposals.push({ kind: "none", pos, label });
    }
    for (const id of (c.transferList || []).slice()) {
      const offer = MG.transfers.findSaleOffer(world, c, id);
      if (offer.ok) proposals.push({ kind: "out", offer });
      else if (offer.player) proposals.push({ kind: "nosale", player: offer.player, reason: offer.reason });
    }
    if (!proposals.length) { runPhase("PRE2"); return; }
    state.proposals = proposals;
    state.proposalChoices = proposals.map(() => true);   // everything on by default
    state.proposalOutcomes = [];
    state.stage = "transfer-proposals";
    render();
  }

  /* THE WHOLE WINDOW ON ONE PAGE.
   *
   * These were dealt one card at a time — answer, next, answer, next, every
   * answered card left stacked above the live one. On a phone (two thirds
   * of the people playing this) that is a screen that only ever grows: five
   * deals meant five taps and a page you kept scrolling back down through.
   * The board's business is one decision made five times, not five separate
   * screens, so it reads as one page now: every deal listed, one tap to
   * flip a deal between yes and no, the money updating underneath, one
   * button to commit the lot.
   *
   * Everything arrives set to YES — you asked for these signings and you
   * listed these players — so the common case is read it, check the total,
   * confirm. */
  function toggleProposal(i) {
    state.proposalChoices[i] = !state.proposalChoices[i];
    render();
  }

  /** Commit every deal still set to yes. Nothing moved before this. */
  function confirmProposals() {
    const world = state.world, c = club();
    state.proposalOutcomes = [];
    state.proposals.forEach((p, i) => {
      const yes = !!state.proposalChoices[i];
      if (p.kind === "in") {
        if (!yes) { state.proposalOutcomes.push({ label: "PASSED", outcome: `You pass on ${p.cand.player.name}.` }); return; }
        const done = MG.transfers.commitSigning(world, c, p.cand);
        if (!done) {
          world.report(`NO DEAL — ${p.cand.player.name} was gone before the paperwork cleared.`, "sack", c.id);
          state.proposalOutcomes.push({ label: "MISSED", outcome: `${p.cand.player.name} went elsewhere.` });
          return;
        }
        world.report(`IN — ${done.player.name} (${done.player.pos}, ${Math.round(done.player.overall)}) signs from ${done.from} for ${money(done.fee)}.`, "transfer", c.id);
        MG.clubs.fansReact(c, done.player.overall >= (c.level || 60) + 2 ? 4 : 1.5, `${done.player.name} was signed`);
        MG.transfers.noteTransfer(world, { dir: "in", name: done.player.name, pos: done.player.pos, overall: Math.round(done.player.overall), age: done.player.age, fee: done.fee, other: done.from });
        state.proposalOutcomes.push({ label: "SIGNED", outcome: `${done.player.name} joins for ${money(done.fee)}.` });
      } else if (p.kind === "out") {
        if (!yes) {
          world.report(`REJECTED — the bid for ${p.offer.player.name} is turned down. He stays.`, "contract", c.id);
          state.proposalOutcomes.push({ label: "REJECTED", outcome: `You turn down ${money(p.offer.fee)} for ${p.offer.player.name}.` });
          return;
        }
        const res = MG.transfers.commitSale(world, c, p.offer);
        if (!res.ok) { state.proposalOutcomes.push({ label: "NO SALE", outcome: `${p.offer.player.name}: ${res.reason}.` }); return; }
        world.report(`OUT — ${res.player.name} joins ${res.to} for ${money(res.fee)}.`, "transfer", c.id);
        MG.clubs.fansReact(c, res.player.overall >= (c.level || 60) + 2 ? -4 : -1, `${res.player.name} was sold`);
        MG.transfers.noteTransfer(world, { dir: "out", name: res.player.name, pos: res.player.pos, overall: Math.round(res.player.overall), age: res.player.age, fee: res.fee, other: res.to });
        c.transferList = (c.transferList || []).filter((x) => x !== res.player.id);
        state.proposalOutcomes.push({ label: "SOLD", outcome: `${res.player.name} leaves for ${money(res.fee)}.` });
      }
    });
    MG.clubs.refreshRatings(c);
    autosave();   // milestone: Transfer Window
    runPhase("PRE2");
  }

  /** One compact row per deal — arrow, rating, name, the numbers that
   *  matter, and the yes/no toggle. One line of detail, not a card: this
   *  list has to be scannable on a phone without scrolling. */
  function dealRowHtml(p, i) {
    const yes = !!state.proposalChoices[i];
    if (p.kind === "none" || p.kind === "nosale") {
      const text = p.kind === "none"
        ? `No ${esc(p.label.toLowerCase())} found inside the budget and your reach.`
        : `No bid for ${esc(p.player.name)} — ${esc(p.reason)}.`;
      return `<div class="crow" style="opacity:.6"><div class="tdir muted">—</div>
        <div class="crow-body"><div class="muted" style="font-size:12px">${text}</div></div></div>`;
    }
    const buying = p.kind === "in";
    const player = buying ? p.cand.player : p.offer.player;
    const fee = buying ? p.cand.fee : p.offer.fee;
    const wage = buying ? Math.round(p.cand.wage * 10) / 10 : player.contract.wage;
    const other = buying ? p.cand.from : p.offer.buyer.name;
    const pc = posClass(player.pos);
    return `<div class="crow ${yes ? "" : "release"}">
      <div class="tdir ${buying ? "in" : "out"}">${buying ? "▸" : "◂"}</div>
      <div class="prating ${pc}" style="width:34px;height:34px;font-size:13px;cursor:pointer" data-player="${player.id}">${Math.round(player.overall)}</div>
      <div class="crow-body">
        <div class="nm">${esc(player.name)} <span class="ppos ${pc}">${player.pos}</span></div>
        <div class="muted" style="font-size:11px">${player.age}y · ${buying ? "from" : "to"} ${esc(other)} · <b class="${buying ? "bad" : "accent"}">${buying ? "−" : "+"}${money(fee)}</b> · £${wage}k/wk</div>
      </div>
      <div class="crow-actions"><button class="btn tiny ${yes ? "primary" : ""}" data-deal="${i}">${yes ? (buying ? "◤ SIGN" : "◤ SELL") : "NO"}</button></div>
    </div>`;
  }

  function proposalsHtml() {
    const c = club();
    const live = state.proposals.filter((p) => p.kind === "in" || p.kind === "out");
    let out = 0, inc = 0, yesCount = 0;
    state.proposals.forEach((p, i) => {
      if (!state.proposalChoices[i]) return;
      if (p.kind === "in") { out += p.cand.fee; yesCount++; }
      else if (p.kind === "out") { inc += p.offer.fee; yesCount++; }
    });
    const after = round1(c.finances.balance + inc - out);
    return `
      <div class="decision boardroom">
        <div class="decision-tag">THE WINDOW · THE BOARD'S BUSINESS</div>
        <div class="decision-text">${live.length
          ? "This is everyone the board can actually get, and everyone who has been bid for. Nothing is signed yet — tap a deal to drop it, then confirm."
          : "The board came back with nothing this window."}</div>
        <div class="stat-grid" style="margin:10px 0">
          <div class="stat-box"><div class="sb-num bad">−${money(out)}</div><div class="sb-lab">Spending</div></div>
          <div class="stat-box"><div class="sb-num accent">+${money(inc)}</div><div class="sb-lab">Raising</div></div>
          <div class="stat-box"><div class="sb-num gold">${money(after)}</div><div class="sb-lab">Balance after</div></div>
        </div>
        <div>${state.proposals.map((p, i) => dealRowHtml(p, i)).join("")}</div>
        <div class="muted" style="font-size:11px;margin-top:6px">Tap a rating to see the full profile.</div>
        <div class="decision-choices" style="margin-top:10px">
          <button class="btn primary" id="proposals-confirm">${yesCount ? `CONFIRM ${yesCount} DEAL${yesCount === 1 ? "" : "S"} ▶` : "DO NOTHING THIS WINDOW ▶"}</button>
        </div>
      </div>`;
  }

  function chooseOption(i) {
    const card = state.cards[state.cardIndex];
    if (!card) return;
    const choice = card.view.choices[i];
    const outcome = MG.decisions.apply(state.world, club(), state.manager, card.ctx, choice);
    state.outcomes.push({ label: choice.label, outcome });
    state.cardIndex++;
    if (state.cardIndex >= state.cards.length) {
      const after = PHASE_AFTER[state.phase];
      if (after) { after(); return; }
      state.stage = "endseason-done";
    }
    render();
  }

  /* Kick-off. A third of the season is played here and here only — the rest
   * waits behind the early-season window, so whatever is decided there is
   * decided with real results in hand and lands on the fixtures still to
   * come. See world.beginSeason / competitions.resumeLeague. */
  function playSeason() {
    const world = state.world, c = club();
    state.seasonBrief = JSON.parse(JSON.stringify(c.board.targets || {}));
    $("stage").innerHTML = `<div class="panel simming">THE OPENING WEEKS of ${world.year}/${String(world.year + 1).slice(2)}…</div>`;
    setTimeout(() => {
      state.earlySnapshot = world.beginSeason();
      autosave();   // milestone: Midseason
      runPhase("EARLY");
    }, 50);
  }

  function finishSeason() {
    const world = state.world, c = club();
    const brief = state.seasonBrief || JSON.parse(JSON.stringify(c.board.targets || {}));
    const leagueId = c.leagueId;
    $("stage").innerHTML = `<div class="panel simming">SIMULATING THE REST OF ${world.year}/${String(world.year + 1).slice(2)} — every division in the world…</div>`;

    setTimeout(() => {
      const summary = world.advanceSeason();
      state.earlySnapshot = null;
      const league = summary.leagues[leagueId];
      const row = league ? league.table.find((r) => r.clubId === c.id) : null;
      const report = c.board.report;
      const stillHere = state.manager.clubId === c.id;

      state.lastApproach = summary.playerApproach;
      // Captured inside advanceSeason() BEFORE the summer transfer window
      // could remove him from the squad — see world.js's clubTopScorer. Read
      // it from the summary, never recomputed from the live squad here: by
      // the time this line runs the window has already resolved, so a sale
      // this same close season would silently swap in the second-highest
      // scorer for a season its actual top scorer had just finished.
      state.lastTopScorer = summary.clubTopScorer;
      state.lastRow = row ? {
        position: row.position, pts: row.pts, won: row.won, drawn: row.drawn, lost: row.lost,
        gf: row.gf, ga: row.ga, fieldSize: league.fieldSize,
        promoted: summary.moves.some((m) => m.club === c.name && m.type === "promoted"),
        viaPlayoff: summary.moves.some((m) => m.club === c.name && m.type === "promoted" && m.viaPlayoff),
        relegated: summary.moves.some((m) => m.club === c.name && m.type === "relegated"),
        champion: row.position === 1,
        leagueName: MG.clubs.LEAGUES[leagueId].name,
        cupRound: report ? report.metrics.cup.actual : "none",
      } : null;
      state.lastBrief = brief;
      state.lastReport = report;
      state.career.push({
        season: summary.season, year: summary.year, club: c.name,
        leagueName: MG.clubs.LEAGUES[leagueId].name,
        position: row ? row.position : null, pts: row ? row.pts : null,
        won: row ? row.won : 0, drawn: row ? row.drawn : 0, lost: row ? row.lost : 0,
        brief, verdict: report ? report.verdict : null, sacked: !stillHere,
      });

      const sackNews = summary.news.find((n) => n.clubId === c.id && n.type === "sack");
      state.sackReason = sackNews ? sackNews.text : null;

      if (!stillHere) {
        // Sacked — but the game may still offer a way out of the game entirely.
        autosave();   // milestone: Season Complete (career takes a real turn here too)
        const entry = MG.endings.check(world, state.manager, null, { justSacked: true });
        if (entry) { openEnding(entry, "sacked"); return; }
        renderSacked(); show("screen-sacked"); return;
      }
      MG.clubs.setSeasonTargets(c, world.clubsInLeague(c.leagueId), world.rng, state.manager);
      state.stage = "result";
      render();
      autosave();   // milestone: End Season
    }, 50);
  }

  function toEndSeason() {
    // Every transfer the board made off its own back this summer — the
    // auction, a free signing, emergency cover — goes through SIGN/VETO
    // before anything else. This is the close season that just happened
    // inside advanceSeason(); nobody has played a minute for the club yet,
    // so a VETO is a clean, complete reversal, not an undo of a played game.
    const pending = (state.world.playerMovements || []).filter((m) => !m.resolved);
    state.lastMoveSummary = null;
    if (pending.length) { beginMoveApproval(pending); return; }
    proceedPastMovements();
  }

  /* The player's own manager movements — a rival's approach, if one came in
   * this close season — sit between the board's transfer dealing and the
   * narrative end-of-season cards. Rarer than either, and entirely the
   * manager's own call: nobody vetoes this one but him. */
  function proceedPastMovements() {
    if (state.lastApproach) { state.stage = "manager-approach"; render(); return; }
    proceedToEndSeasonCards();
  }

  function chooseApproach(accept) {
    const approach = state.lastApproach;
    state.lastApproach = null;
    if (accept && approach) { acceptApproach(approach.clubId); return; }
    proceedToEndSeasonCards();
  }

  /** Leave the current club for a new one mid-career — takeJob's sibling,
   *  for when the move was the OTHER club's idea. The post left behind gets
   *  filled the same way any other vacancy does. */
  function acceptApproach(clubId) {
    const world = state.world;
    const oldClub = club();
    const newClub = world.clubById(clubId);
    if (!newClub) { proceedToEndSeasonCards(); return; }
    MG.world.removeManager(world, oldClub, "left for another club");
    world.report(`${state.manager.name} leaves ${oldClub.name} to take charge of ${newClub.name}.`, "hire", newClub.id);
    MG.world.removeManager(world, newClub, "replaced");
    MG.world.appointManager(world, newClub, state.manager, { quiet: true });
    if (MG.world.hireFor) MG.world.hireFor(world, oldClub, {});
    state.clubId = clubId;
    world.playerClubId = clubId;
    newClub.transferList = []; newClub.targets = [];
    MG.clubs.setSeasonTargets(newClub, world.clubsInLeague(newClub.leagueId), world.rng, state.manager);
    state.lastReport = null; state.lastRow = null;
    state.transfersSeason = null; state.signCount = 0; state.signPositions = [];
    state.lastSeenNewsId = world.news.length ? world.news[world.news.length - 1].id : 0;
    state.stage = "preseason-hub";
    state.hubTab = "overview";
    state.hubNewJob = true;
    state.tab = "table";
    render();
    autosave();   // milestone: Career Start (new club, mid-career)
  }

  function approachHtml() {
    const world = state.world;
    const approach = state.lastApproach;
    const newClub = approach ? world.clubById(approach.clubId) : null;
    if (!newClub) { proceedToEndSeasonCards(); return ""; }
    return `<div class="stage-step">MANAGER MOVEMENTS</div>
      <div class="decision boardroom">
        <div class="decision-tag">A JOB OFFER</div>
        <div class="decision-text">${esc(newClub.name)} have made contact. They want you to take charge this summer — nobody at ${esc(club().name)} has any say in whether you go.</div>
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num" style="font-size:14px">${esc(MG.clubs.LEAGUES[newClub.leagueId].name)}</div><div class="sb-lab">League</div></div>
          <div class="stat-box"><div class="sb-num board-${newClub.board.style.toLowerCase()}" style="font-size:14px">${esc(newClub.board.style)}</div><div class="sb-lab">Boardroom</div></div>
          <div class="stat-box"><div class="sb-num">${newClub.reputation}</div><div class="sb-lab">Club rep</div></div>
          <div class="stat-box"><div class="sb-num gold">${money(newClub.finances.transferBudget)}</div><div class="sb-lab">Budget</div></div>
        </div>
        <div class="decision-choices">
          <button class="btn choice" id="approach-accept"><b>TAKE THE JOB</b><span>Leave ${esc(club().name)} for ${esc(newClub.name)}.</span></button>
          <button class="btn choice" id="approach-decline"><b>STAY</b><span>See out your project at ${esc(club().name)}.</span></button>
        </div>
      </div>`;
  }

  function proceedToEndSeasonCards() { runPhase("POST1"); }

  function beginMoveApproval(pending) {
    state.moveCards = pending;
    // Signed off by default: the board has already done these, and the
    // common answer is "fine". A veto is the deliberate act, so a veto is
    // the one that costs a tap.
    state.moveChoices = pending.map(() => true);
    state.moveOutcomes = [];
    state.stage = "move-approval";
    render();
  }

  function toggleMove(i) {
    if (club().board.style === "Chaotic") return;   // told, not asked
    state.moveChoices[i] = !state.moveChoices[i];
    render();
  }

  /** Resolve the board's whole window at once — see confirmProposals for
   *  why these are one page rather than one card at a time. */
  function confirmMoves() {
    const world = state.world, c = club();
    const chaotic = c.board.style === "Chaotic";
    state.moveOutcomes = [];
    state.moveCards.forEach((m, i) => {
      const player = world.clubs.reduce((f, cl) => f || cl.squad.find((p) => p.id === m.playerId), null);
      const name = m.playerName || (player ? player.name : "the player");
      const keep = chaotic || !!state.moveChoices[i];
      m.resolved = true;
      if (!keep && player) {
        MG.transfers.reverseMovement(world, m);
        const label = m.kind === "out" ? "recalled, the fee returned" : "sent back, the deal undone";
        state.moveOutcomes.push({ label: "VETOED", outcome: `The board's move on ${name} is ${label}.` });
        MG.clubs.fansReact(c, -1, "the board's own dealing was overruled");
        return;
      }
      state.moveOutcomes.push({ label: chaotic && !state.moveChoices[i] ? "NOTED" : "SIGNED OFF", outcome: `${name} stays as the board dealt it.` });
      // The deal stands — only NOW does the world hear about it. See
      // completeDeal in transfers.js: the log line and the fan reaction are
      // deliberately held back so nothing announces a deal as done while
      // the manager is still being asked about it.
      if (m.pending) {
        world.report(m.pending.pendingText, "transfer", c.id);
        MG.clubs.fansReact(c, m.pending.fansDelta, m.pending.fansReason);
      }
      if (player) {
        MG.transfers.noteTransfer(world, {
          dir: m.kind === "out" ? "out" : "in",
          name, pos: player.pos, overall: Math.round(player.overall), age: player.age,
          fee: m.fee || 0, other: m.otherClubName,
        });
      }
    });
    // A durable copy, separate from state.outcomes — that array is wiped the
    // instant the end-of-season cards start drawing, and this record has to
    // survive to the summary screen after them.
    state.lastMoveSummary = state.moveOutcomes.slice();
    autosave();   // milestone: Transfer Window resolved
    proceedPastMovements();
  }

  /* ------------------------- THE TRANSFER SUMMARY --------------------------
   * Shown either side of a season: what came in, what went out, and the
   * headline business elsewhere. Green in, red out, one line each — the
   * point is to take a whole window in at a glance rather than read a log
   * back. */
  function transferSummaryHtml(opts) {
    const o = opts || {};
    const world = state.world, c = club();
    const rows = MG.transfers.clubTransfers(world, o.season);
    const ins = rows.filter((r) => r.dir === "in");
    const outs = rows.filter((r) => r.dir === "out");
    const spent = ins.reduce((t, r) => t + (r.fee || 0), 0);
    const raised = outs.reduce((t, r) => t + (r.fee || 0), 0);
    const net = raised - spent;
    const big = MG.transfers.biggestTransfers(world, 3);
    if (!rows.length && !big.length) return "";
    const line = (r) => `<div class="crow" style="padding:5px 8px">
      <div class="tdir ${r.dir}">${r.dir === "in" ? "▸" : "◂"}</div>
      <div class="prating ${posClass(r.pos)}" style="width:28px;height:28px;font-size:12px">${r.overall}</div>
      <div class="crow-body"><div class="nm" style="font-size:13px">${esc(r.name)} <span class="ppos ${posClass(r.pos)}">${esc(r.pos)}</span></div>
        <div class="muted" style="font-size:11px">${r.dir === "in" ? "from" : "to"} ${esc(r.other || "—")}</div></div>
      <div class="crow-actions"><b class="${r.dir === "in" ? "bad" : "accent"}" style="font-size:12px">${r.dir === "in" ? "−" : "+"}${money(r.fee || 0)}</b></div>
    </div>`;
    return `<div class="panel">
      <h3 class="muted">${esc(o.title || "THE WINDOW")} · <span class="accent">${ins.length} in</span> · <span class="bad">${outs.length} out</span></h3>
      ${rows.length ? `<div class="muted" style="font-size:12px;margin-bottom:6px">Spent <b class="bad">${money(spent)}</b> · raised <b class="accent">${money(raised)}</b> · net <b class="${net >= 0 ? "accent" : "bad"}">${net >= 0 ? "+" : "−"}${money(Math.abs(net))}</b></div>
        ${ins.map(line).join("")}${outs.map(line).join("")}`
      : `<div class="muted" style="font-size:12px">No business done at ${esc(c.name)} this window.</div>`}
      ${big.length ? `<div style="margin-top:8px">
        <div class="muted" style="font-size:11px;margin-bottom:4px">BIGGEST DEALS ELSEWHERE</div>
        ${big.map((n) => `<div class="log-entry transfer" style="font-size:12px">${esc(n.text)}</div>`).join("")}
      </div>` : ""}
    </div>`;
  }

  /** A durable "what the board did, and what you did about it" recap —
   *  shown on the end-of-season summary screen, past where the narrative
   *  cards would otherwise have erased it. */
  function moveSummaryHtml() {
    const log = state.lastMoveSummary;
    if (!log || !log.length) return "";
    return `<div class="panel"><h3 class="muted">TRANSFER MOVEMENTS THIS WINDOW</h3>
      ${log.map((o) => `<div class="log-entry ${o.label === "VETOED" ? "sack" : "transfer"}"><b>${esc(o.label)}</b> — ${esc(o.outcome)}</div>`).join("")}
    </div>`;
  }

  /** Every deal the board did, on one page. */
  function moveApprovalHtml() {
    const world = state.world, c = club();
    const chaotic = c.board.style === "Chaotic";
    let net = 0;
    const rows = state.moveCards.map((m, i) => {
      const player = world.clubs.reduce((f, cl) => f || cl.squad.find((p) => p.id === m.playerId), null);
      if (!player) return "";        // gone from the world entirely; nothing to approve
      m.playerName = player.name;
      const keep = chaotic || !!state.moveChoices[i];
      const inbound = m.kind !== "out";
      if (keep) net += inbound ? -(m.fee || 0) : (m.fee || 0);
      const pc = posClass(player.pos);
      const where = m.kind === "free" ? "on a free" : `${inbound ? "from" : "to"} ${esc(m.otherClubName)}`;
      return `<div class="crow ${keep ? "" : "release"}">
        <div class="tdir ${inbound ? "in" : "out"}">${inbound ? "▸" : "◂"}</div>
        <div class="prating ${pc}" style="width:34px;height:34px;font-size:13px;cursor:pointer" data-player="${player.id}">${Math.round(player.overall)}</div>
        <div class="crow-body">
          <div class="nm">${esc(player.name)} <span class="ppos ${pc}">${player.pos}</span></div>
          <div class="muted" style="font-size:11px">${player.age}y · ${where} · <b class="${inbound ? "bad" : "accent"}">${inbound ? "−" : "+"}${money(m.fee || 0)}</b> · £${m.wage}k/wk</div>
        </div>
        ${chaotic ? "" : `<div class="crow-actions"><button class="btn tiny ${keep ? "primary" : "danger"}" data-move="${i}">${keep ? "◤ OK" : "VETO"}</button></div>`}
      </div>`;
    }).join("");
    const after = round1(c.finances.balance + net);
    return `
      <div class="decision boardroom">
        <div class="decision-tag">THE BOARD'S OWN DEALING</div>
        <div class="decision-text">${chaotic
          ? "This board moves the goalposts on its own terms — you are being told, not asked."
          : "Everything the board did without waiting on you. Tap a deal to veto it — a veto is a full, clean reversal: he goes back, the money returns, nothing is half-done."}</div>
        <div class="stat-grid" style="margin:10px 0">
          <div class="stat-box"><div class="sb-num">${money(c.finances.balance)}</div><div class="sb-lab">Balance now</div></div>
          <div class="stat-box"><div class="sb-num ${net >= 0 ? "accent" : "bad"}">${net >= 0 ? "+" : "−"}${money(Math.abs(net))}</div><div class="sb-lab">If you confirm</div></div>
          <div class="stat-box"><div class="sb-num gold">${money(after)}</div><div class="sb-lab">Balance after</div></div>
        </div>
        <div>${rows}</div>
        <div class="muted" style="font-size:11px;margin-top:6px">Tap a rating to see the full profile.</div>
        <div class="decision-choices" style="margin-top:10px">
          <button class="btn primary" id="moves-confirm">CONFIRM ▶</button>
        </div>
      </div>`;
  }

  /** After the end-of-season cards: an ending may fire, otherwise pre-season. */
  function toNextSeason() {
    const won = state.lastRow && (state.lastRow.champion || state.lastRow.promoted);
    const entry = MG.endings.check(state.world, state.manager, club(), { wonSomethingLastSeason: won });
    if (entry) { openEnding(entry); return; }
    beginPreSeason();
  }

  function openEnding(entry, fallback) {
    state.endingEntry = entry;
    state.endingView = MG.endings.present(entry);
    state.endingFallback = fallback || null;
    state.endingOutcome = null;
    state.stage = "ending";
    render();
    show("screen-career");
  }

  function chooseEnding(i) {
    const choice = state.endingView.choices[i];
    /* When the ending fired because you were sacked, you no longer manage the
     * club — so no club is passed, and a choice's side effects cannot land on
     * a boardroom that has already shown you the door. */
    const target = state.endingFallback === "sacked" ? null : (state.clubId ? club() : null);
    const res = MG.endings.apply(state.world, target, state.manager, state.endingEntry.ctx, choice);
    if (res.ending) { renderLegacy(res.ending); show("screen-legacy"); return; }
    /* The outcome of a career-defining choice has to actually land somewhere.
     * It goes into the permanent log (so it is still there ten seasons later,
     * next to the season it happened in) AND is held for one screen as a
     * banner, so the manager sees the consequence of what he just chose
     * instead of being dropped straight into the next pre-season with no
     * acknowledgement that anything happened at all. */
    state.endingOutcome = res.text || null;
    if (state.endingOutcome) state.world.report(state.endingOutcome, "ending", target ? target.id : null);
    // Talked his way out of it — carry on into the next pre-season.
    if (state.endingFallback === "sacked") { renderSacked(); show("screen-sacked"); return; }
    beginPreSeason();
  }

  /* ============================== RENDERING =============================== */
  function render() {
    /* render() rebuilds #stage from scratch on every call, including the
     * ones that are nothing more than "you ticked LIST on a player three
     * screens into a long squad" — a toggle that has no business moving the
     * page at all. Left alone, the browser treats a wholesale innerHTML
     * replacement as new content and resets scroll to the top, so every tap
     * on a rating badge or a LIST button threw the manager back to the top
     * of whatever list he was halfway down. Only an ACTUAL stage or tab
     * change (a genuinely new screen) is allowed to jump; anything else
     * restores exactly where the reader was. */
    const stageChanged = state._lastStage !== state.stage;
    const tabChanged = state._lastTab !== state.tab;
    const scrollY = (stageChanged || tabChanged) ? null : window.scrollY;
    state._lastStage = state.stage;
    state._lastTab = state.tab;

    const world = state.world, c = club(), m = state.manager, board = c.board;
    $("career-club").textContent = c.name;
    $("career-league").textContent = MG.clubs.LEAGUES[c.leagueId].name;
    $("career-season").textContent = `Season ${world.season} of ${MG.endings.SEASON_CAP} · ${world.year}/${String(world.year + 1).slice(2)}`;
    $("career-manager").innerHTML = `${esc(m.name)} · ${esc(m.archetypeName)} · ${esc(m.tactic)} · ${esc(c.formation)} · rep ${m.reputation}`;

    const conf = Math.round(board.confidence);
    $("confidence-bar").style.width = `${conf}%`;
    $("confidence-bar").className = `conf ${conf >= 55 ? "" : conf >= 35 ? "warn" : "bad"}`;
    $("confidence-value").textContent = conf;
    $("board-style").textContent = board.style.toUpperCase();
    $("board-style").className = `board-${board.style.toLowerCase()}`;
    $("board-brief").textContent = board.targets ? board.targets.summary : "";

    // The supporters: the second opinion, and one the board listens to.
    const fans = Math.round(c.fans == null ? 56 : c.fans);
    const mood = MG.clubs.fanMood(fans);
    $("fans-bar").style.width = `${fans}%`;
    $("fans-bar").className = `conf ${fans >= 55 ? "" : fans >= 35 ? "warn" : "bad"}`;
    $("fans-value").textContent = fans;
    $("fans-mood").textContent = mood.label.toUpperCase();
    $("fans-mood").className = fans >= 55 ? "accent" : fans >= 35 ? "gold" : "bad";
    $("fans-blurb").textContent = mood.blurb;

    $("lastseason").innerHTML = lastSeasonHtml();
    $("stage").innerHTML = stageHtml();
    $("logfeed").innerHTML = logFeedHtml();
    renderNotifications();
    wireStage();
    /* WHERE THE REFERENCE TABS BELONG.
     *
     * The squad/tactics/youth/table strip is a reference surface, and it is
     * long — a 26-man squad below every screen put the whole career page at
     * over 4,000px on a phone, so a two-line decision sat on top of five
     * screens of list nobody had asked to see. Two thirds of the people
     * playing this are on a phone, and the game is meant to be played in
     * the decisions and the log.
     *
     * So the tabs appear only where browsing is the point: the season-ahead
     * screen. Everywhere a decision is being asked, the page is the
     * decision and the log, full stop. Nothing is lost — the pre-season hub
     * carries squad, tactics and contracts as its own sub-tabs, and the
     * season-ahead screen carries the strip in full.
     *
     * The body is EMPTIED rather than just hidden, too. Rendering it anyway
     * meant every squad existed twice in the DOM at once (measured: 46
     * player rows on screen, 46 more in the hidden copy), each rebuilt on
     * every render and each carrying its own click handlers. wireTab still
     * runs either way — the hub's own tactics and squad controls are bound
     * by it, since its selectors are document-wide by design. */
    // A new screen always starts with the reference panel closed, so a
    // decision is never buried under a squad list left open three screens
    // ago. Reopening it is one tap, and it stays open until the next screen.
    if (stageChanged) state.tabOpen = !!TAB_STAGES[state.stage];
    if (state.tabOpen) renderTab();
    else { $("tab-body").innerHTML = ""; renderTabStrip(); wireTab(); }
    if (scrollY != null) window.scrollTo(0, scrollY);
  }

  /* ------------------------------ NOTIFICATIONS ----------------------------
   * The log is the full record; this is the bit of it a manager should not
   * have to go looking for. Transfers in and out are the headline case — the
   * squad changing under you is exactly the kind of thing easy to miss in a
   * feed that also carries match reports and boardroom chatter — so those are
   * what the bell counts, with contract news, loans and academy promotions
   * folded into the panel underneath. */
  const NOTIFY_TYPES = new Set(["transfer", "contract", "loan", "retirement"]);
  function renderNotifications() {
    const world = state.world, c = club();
    const mine = world.newsFor(state.clubId, 60);
    const unseen = mine.filter((n) => n.id > state.lastSeenNewsId && NOTIFY_TYPES.has(n.type));
    const badge = $("notif-badge");
    if (unseen.length) { badge.style.display = "flex"; badge.textContent = unseen.length > 9 ? "9+" : unseen.length; }
    else badge.style.display = "none";

    const panel = $("notif-panel");
    if (!state.notifOpen) { panel.innerHTML = ""; return; }
    const items = mine.filter((n) => NOTIFY_TYPES.has(n.type)).slice(0, 20);
    panel.innerHTML = `<div class="notif-panel">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <b style="font-size:12px;letter-spacing:1px;color:var(--muted)">AT ${esc(c.name).toUpperCase()}</b>
        <button class="btn tiny" id="notif-clear">MARK ALL READ</button>
      </div>
      ${items.length ? items.map((n) => `<div class="log-entry ${esc(n.type)} ${n.id > state.lastSeenNewsId ? "unseen" : ""}"><span class="muted">${n.year}</span> ${esc(n.text)}</div>`).join("")
        : `<div class="notif-empty">Nothing to report yet.</div>`}
    </div>`;
    const clr = $("notif-clear");
    if (clr) clr.addEventListener("click", () => { markNotificationsSeen(); renderNotifications(); });
  }
  function markNotificationsSeen() {
    const world = state.world;
    state.lastSeenNewsId = world.news.length ? world.news[world.news.length - 1].id : state.lastSeenNewsId;
  }

  /* --------------------------- LAST SEASON (top) --------------------------- */
  /* A tight, one-panel reminder of where you finished — the full career record
   * lives in its own CAREER tab now, so this stays a glance, not a wall. */
  function lastSeasonHtml() {
    const row = state.lastRow;
    if (!row) return `<div class="panel"><div class="muted">Your first season has not been played yet — set up the team and get going.</div></div>`;
    const tone = row.champion || row.promoted ? "great" : row.relegated ? "awful" : "ok";
    return `<div class="panel">
      <div class="result-banner ${tone}" style="margin-bottom:10px">
        ${row.champion ? "🏆 Champions" : row.promoted ? "📈 Promoted" : row.relegated ? "📉 Relegated" : `Finished ${ordinal(row.position)}`}
        <span class="muted" style="font-weight:400;font-size:13px"> · ${esc(row.leagueName)}</span>
      </div>
      <div class="stat-grid">
        <div class="stat-box"><div class="sb-num">${row.pts}</div><div class="sb-lab">Points</div></div>
        <div class="stat-box"><div class="sb-num">${row.won}</div><div class="sb-lab">W</div></div>
        <div class="stat-box"><div class="sb-num">${row.drawn}</div><div class="sb-lab">D</div></div>
        <div class="stat-box"><div class="sb-num bad">${row.lost}</div><div class="sb-lab">L</div></div>
        <div class="stat-box"><div class="sb-num">${row.gf}</div><div class="sb-lab">GF</div></div>
        <div class="stat-box"><div class="sb-num">${row.ga}</div><div class="sb-lab">GA</div></div>
      </div>
      <div class="muted" style="font-size:12px">
        Cup: ${esc(cupLabel(row.cupRound))} · Board's verdict: <b>${esc(state.lastReport ? state.lastReport.verdict : "—")}</b>
        · <span class="muted">full record in the CAREER tab</span>
      </div>
    </div>`;
  }

  /* ------------------------------ THE LOG (top) ---------------------------- */
  /* Kept open on the main screen: the board reports back here — what it signed,
   * what it tried and could not, who it renewed or let go. The world's own
   * noise stays in the WORLD tab; this is your club only. */
  function logFeedHtml() {
    const world = state.world;
    const mine = world.newsFor(state.clubId, 14);
    if (!mine.length) return `<div class="panel"><div class="muted" style="font-size:13px">Nothing has happened at this club yet. Play a season and the board will report back here.</div></div>`;
    return `<div class="panel"><div class="table-scroll" style="max-height:230px">
      ${mine.map((n) => `<div class="log-entry ${esc(n.type)}"><span class="muted">${n.year}</span> ${esc(n.text)}</div>`).join("")}
    </div></div>`;
  }

  /* ----------------------------- CAREER (tab) ----------------------------- */
  function careerHtml() {
    const m = state.manager;
    const played = m.record.played || 1;
    return `
      <div class="panel">
        <h3 class="muted">CAREER TO DATE</h3>
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num">${m.record.seasons}</div><div class="sb-lab">Seasons</div></div>
          <div class="stat-box"><div class="sb-num gold">${m.honours.titles}</div><div class="sb-lab">Titles</div></div>
          <div class="stat-box"><div class="sb-num">${m.honours.cups}</div><div class="sb-lab">Cups</div></div>
          <div class="stat-box"><div class="sb-num">${m.honours.promotions}</div><div class="sb-lab">Promotions</div></div>
          <div class="stat-box"><div class="sb-num">${Math.round((m.record.won / played) * 100)}%</div><div class="sb-lab">Win rate</div></div>
          <div class="stat-box"><div class="sb-num">${m.reputation}</div><div class="sb-lab">Reputation</div></div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px">
          ${m.record.won}W ${m.record.drawn}D ${m.record.lost}L in ${m.record.played} matches · ${esc(m.name)}, age ${m.age}
        </div>
      </div>
      ${state.career.length ? careerTableHtml() : `<div class="panel muted">No seasons on the record yet.</div>`}`;
  }

  const CUP_LABELS = { none: "did not enter", R1: "first round", R2: "second round", R3: "third round",
    R4: "fourth round", R5: "fifth round", QF: "quarter-final", SF: "semi-final", F: "final", W: "🏆 WON IT" };
  function cupLabel(k) { return CUP_LABELS[k] || "—"; }

  /* --------------------------- TIER 2: DECISIONS -------------------------- */
  const CARD_STAGES = { preseason1: 1, preseason2: 1, earlyseason: 1, postseason1: 1, postseason2: 1 };

  function stageHtml() {
    if (state.stage === "preseason-hub") return preseasonHubHtml();
    if (state.stage === "transfers") return transfersWizardHtml();
    if (state.stage === "transfer-proposals") return proposalsHtml();
    if (CARD_STAGES[state.stage]) return cardHtml();
    if (state.stage === "endseason-done") {
      return outcomesHtml() + transferSummaryHtml({ title: "THE SUMMER JUST GONE" }) + moveSummaryHtml() + contractsUpHtml(club())
        + `<button class="btn primary big" id="to-preseason" style="margin-top:12px">PRE-SEASON ▶</button>`;
    }
    if (state.stage === "ready") return readyHtml();
    if (state.stage === "move-approval") return moveApprovalHtml();
    if (state.stage === "manager-approach") return approachHtml();
    if (state.stage === "ending") return endingHtml();
    return resultHtml();
  }

  const outcomesHtml = () => state.outcomes.map((o) => `<div class="outcome">${esc(o.outcome)}</div>`).join("");

  /* The first thing a new job used to show a manager was a formation picker.
   * No club, no squad, no sense of what he had just walked into — the
   * mechanics started before the introduction did. This is the introduction:
   * who they are, who he answers to, who is actually any good, and who he is
   * about to be judged against, before team set-up asks him to decide anything. */
  /* THE SEASON BRIEFING — the single screen the USP actually rests on.
   * Everything a manager needs to make every decision this window lives
   * here: who you have, who's coming through, who you're up against, who's
   * out of contract, the brief you're judged against. The deeper screens
   * (SQUAD, YOUTH, WORLD, the player profile itself) are one tap away for
   * anyone who wants to go further — this is the surface, not a replacement
   * for it. Runs on EVERY pre-season, not just the first one at a job: a
   * returning season used to skip straight to the transfer wizard, which
   * meant this whole picture only ever appeared once per job. */
  /** The pre-season hub itself — sub-tab nav plus whichever section is
   *  open, all inside #stage so nothing here is ever a scroll away.
   *  hubOverviewHtml/squadHtml/tacticsHtml/contractsUpHtml are reused
   *  verbatim rather than summarised, so every LIST/MENTOR/formation/slot
   *  control here is the same live control it is anywhere else. The
   *  reference strip below still carries table, career and the world (see
   *  render()); this just puts the pre-season half of it where the
   *  decisions are. */
  function preseasonHubHtml() {
    const c = club();
    const expiring = c.squad.filter((p) => !p.loan && p.contract.years <= 1).length;
    const report = MG.tactics.xiReport(c);
    const TABS = [
      { key: "overview", label: "OVERVIEW" },
      { key: "squad", label: "SQUAD" },
      { key: "tactics", label: "TACTICS", badge: report.problems || null },
      { key: "contracts", label: "CONTRACTS", badge: expiring || null },
    ];
    if (!TABS.some((t) => t.key === state.hubTab)) state.hubTab = "overview";
    const nav = `<div class="seg" style="flex-wrap:wrap">${TABS.map((t) =>
      `<button class="${state.hubTab === t.key ? "on" : ""}" data-hubtab="${t.key}">${t.label}${t.badge ? ` <span class="bad">●${t.badge}</span>` : ""}</button>`
    ).join("")}</div>`;
    const body = state.hubTab === "squad" ? squadHtml()
      : state.hubTab === "tactics" ? tacticsHtml()
        : state.hubTab === "contracts" ? (contractsUpHtml(c) || `<div class="panel muted" style="font-size:13px">Nobody is out of contract soon.</div>`)
          : hubOverviewHtml();
    return `
      ${state.endingOutcome ? `<div class="panel"><div class="log-entry season">${esc(state.endingOutcome)}</div></div>` : ""}
      <div class="decision boardroom" style="margin-bottom:10px">${nav}</div>
      <div class="decision-choices" style="margin-bottom:12px">
        <button class="btn primary big" id="hub-continue">CONTINUE TO DECISIONS ▶</button>
      </div>
      ${body}`;
  }

  /* The pre-season briefing — everything that used to mean leaving this
   * screen, or scrolling past the log to the tabs below, to go and check:
   * who you have, who's coming through, who you're up against, the brief
   * you're judged against. Runs on EVERY pre-season, not just the first
   * one at a job. Now the OVERVIEW section of preseasonHubHtml — SQUAD,
   * TACTICS and CONTRACTS are its siblings, not separate screens. */
  function hubOverviewHtml() {
    const o = { newJob: state.hubNewJob };
    const c = club(), m = state.manager;
    const board = MG.clubs.BOARD_STYLES[c.board.style];
    const key = c.squad.slice().sort((a, b) => b.overall - a.overall).slice(0, 5);
    const rivals = state.world.clubsInLeague(c.leagueId)
      .filter((x) => x.id !== c.id)
      .sort((a, b) => MG.clubs.clubStrength(b) - MG.clubs.clubStrength(a))
      .slice(0, 5);
    const r = c.ratings;

    const head = o.newJob
      ? `<div class="decision-tag">WELCOME TO ${esc(c.name.toUpperCase())}</div>
         <div class="decision-text">${esc(m.name)} takes charge of ${esc(c.name)}, ${esc(MG.clubs.LEAGUES[c.leagueId].name)}${c.reputation >= 70 ? " — one of the biggest jobs in the game" : c.reputation <= 25 ? ", a long way down the pyramid" : ""}.</div>`
      : `<div class="decision-tag">SEASON ${state.world.season} · ${esc(c.name.toUpperCase())}</div>
         <div class="decision-text">${esc(state.lastRow ? (state.lastRow.champion ? "Fresh off a title." : state.lastRow.promoted ? "Fresh off promotion." : state.lastRow.relegated ? "Straight back up, after relegation." : `${ordinal(state.lastRow.position)} last time out.`) : "A new season begins.")} Here is everything before the window opens.</div>`;

    /* How well the division has your system read. Shown only once there is
     * something to say — a manager in his first two seasons at a club does not
     * need a line telling him nobody has worked him out yet. */
    const pred = MG.tactics.predictability(c, m);
    const predLab = MG.tactics.predictabilityLabel(pred);
    const predLine = pred < 0.25 ? "" :
      `<div class="board-note" style="margin-top:8px"><b class="${pred >= 0.8 ? "bad" : "gold"}">Your system is ${esc(predLab.label)}</b> — ${esc(predLab.blurb)}. ${c.systemSeasons || 1} season${(c.systemSeasons || 1) === 1 ? "" : "s"} of ${esc(m.tactic)} in a ${esc(c.formation)}.</div>`;

    return `
      <div class="decision boardroom">
        ${head}
        ${predLine}
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num">${Math.round(r.attack)}</div><div class="sb-lab">Attack</div></div>
          <div class="stat-box"><div class="sb-num">${Math.round(r.midfield)}</div><div class="sb-lab">Midfield</div></div>
          <div class="stat-box"><div class="sb-num">${Math.round(r.defence)}</div><div class="sb-lab">Defence</div></div>
          <div class="stat-box"><div class="sb-num">${c.reputation}</div><div class="sb-lab">Club rep</div></div>
        </div>
      </div>

      <div class="panel">
        <h3 class="muted">THE BOARDROOM</h3>
        <div class="muted" style="font-size:13px;margin-bottom:6px"><b>${esc(c.board.style)}</b> — ${esc(board.blurb)} · ${esc(ownerLabel(c))}</div>
        <div class="result-banner ok" style="margin-top:6px">${esc(c.board.targets ? c.board.targets.summary : "No brief set")}</div>
      </div>

      <div class="panel">
        <h3 class="muted">PLAYERS TO BUILD AROUND</h3>
        <div class="muted" style="font-size:12px;margin-bottom:8px">The five best players at the club right now.</div>
        ${key.map((p) => pcard(p, { level: c.level })).join("")}
      </div>

      ${transferSummaryHtml({ title: "THIS SUMMER'S BUSINESS" })}

      ${youthGlanceHtml(c)}

      ${rivals.length ? `<div class="panel">
        <h3 class="muted">WHO YOU ARE UP AGAINST</h3>
        <div class="muted" style="font-size:12px;margin-bottom:8px">The strongest clubs in ${esc(MG.clubs.LEAGUES[c.leagueId].name)} this season — tap one to scout it properly.</div>
        ${rivals.map((x) => `<div class="crow" data-club="${x.id}" style="cursor:pointer">
          <div class="prating ${x.reputation >= c.reputation ? "attack" : "midfield"}" style="width:38px;height:38px;font-size:14px">${Math.round(MG.clubs.clubStrength(x))}</div>
          <div class="crow-body"><div class="nm">${esc(x.name)}</div><div class="muted" style="font-size:12px">reputation ${x.reputation}</div></div>
        </div>`).join("")}
      </div>` : ""}`;
  }

  /* A quick look at the academy — not the full YOUTH tab, just the one or
   * two prospects actually worth knowing about before the window opens. */
  function youthGlanceHtml(c) {
    if (!MG.youth) return "";
    const a = MG.youth.ensure(c);
    if (!a.players.length) return "";
    const level = c.level != null ? c.level : 60;
    const top = a.players.slice().sort((x, y) => (y.potential - y.overall) - (x.potential - x.overall)).slice(0, 2);
    return `<div class="panel">
      <h3 class="muted">COMING THROUGH THE ACADEMY</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">The pick of the youth squad — the full academy, and the PROMOTE button, are on the YOUTH tab.</div>
      ${top.map((p) => {
        const g = MG.youth.grade(p);
        const ready = p.overall >= level - 8;
        return `<div class="crow" data-player="${p.id}" style="cursor:pointer">
          <div class="prating ${posClass(p.pos)}" style="width:36px;height:36px;font-size:14px">${Math.round(p.overall)}</div>
          <div class="crow-body"><div class="nm">${esc(p.name)} <span class="ppos ${posClass(p.pos)}">${p.pos}</span>
            <span class="pmark ${g.cls === "gold" ? "mark-great" : g.cls === "accent" ? "mark-good" : "mark-ok"}">${esc(g.label)}</span></div>
            <div class="muted" style="font-size:12px">${p.age}y${ready ? ` · <span class="accent">ready for the first team</span>` : ""}</div></div>
        </div>`;
      }).join("")}
    </div>`;
  }


  /* The pre-season transfer wizard: count -> positions -> who is for sale.
   * Deliberately three short questions rather than a spreadsheet — the board
   * does the actual dealing, you just point it. */
  /* The board's own condition on HOW you spend, not just how much — the
   * "additional requirements" the transfer window was missing. Ambitious
   * targets carry a real agent premium and a real chance of missing out
   * (see agents.js / findAndSign), so the board only backs a swing for a
   * star when the finances can actually absorb the risk; a club mid
   * fire-sale is locked out of it entirely rather than being quietly
   * allowed to spend its way out of the crisis it is in. */
  function ambitionHtml(c) {
    const starLocked = !!c.mustSell;
    const starTight = !starLocked && c.finances.transferBudget < c.finances.revenue * 0.25;
    const OPTIONS = [
      { key: "prospect", label: "PRUDENT", blurb: "Cheap, young, unfinished — a punt on potential rather than a fix for now." },
      { key: "solid", label: "BALANCED", blurb: "A player who is ready now, priced at what he is actually worth." },
      { key: "star", label: "AMBITIOUS", blurb: starLocked ? "Locked — the board will not fund a marquee move while the club is mid fire-sale."
          : starTight ? "Available, but the budget is thin for it — expect the board to baulk if his agent smells a rival bidder."
            : "A name above the club's own level. His agent will make you pay a premium for the privilege, and there is no guarantee he says yes." },
    ];
    if (starLocked && state.signAmbition === "star") state.signAmbition = "solid";
    return `<div class="wizard-block">
      <h4>How hard do you push it?</h4>
      <div class="seg">${OPTIONS.map((o) => `
        <button class="${state.signAmbition === o.key ? "on" : ""}" ${o.key === "star" && starLocked ? "disabled" : ""} data-signambition="${o.key}">${o.label}</button>`).join("")}</div>
      <div class="muted" style="font-size:12px;margin-top:6px">${esc(OPTIONS.find((o) => o.key === state.signAmbition).blurb)}</div>
    </div>`;
  }

  /* AT A GLANCE — the whole point of the decision layer being the USP: enough
   * on screen, right where a choice gets made, that a manager never HAS to
   * leave the card to go and look something up. Everything here is a
   * one-line summary of a fact that lives in full elsewhere (SQUAD, TACTICS,
   * WORLD) for anyone who wants to dig — this is the surface, not a
   * replacement for the depth underneath it. */
  function glanceHtml(c) {
    const world = state.world;
    const t = c.board.targets;
    const rivals = world.clubsInLeague(c.leagueId);
    const strength = (x) => MG.clubs.clubStrength(x);
    const ranked = rivals.slice().sort((a, b) => strength(b) - strength(a));
    const myRank = ranked.findIndex((x) => x.id === c.id) + 1;
    const above = ranked[myRank - 2], below = ranked[myRank];
    const wageRoom = c.finances.wageBudget - MG.clubs.wageBill(c);
    const confCls = c.board.confidence >= 65 ? "accent" : c.board.confidence >= 40 ? "gold" : "bad";
    return `<div class="panel" style="padding:10px 12px;margin-bottom:10px">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:12px">
        <span><span class="muted">Brief</span> <b>${esc(t ? t.summary : "—")}</b></span>
        <span><span class="muted">Squad rank</span> <b>${myRank}/${ranked.length}</b> in ${esc(MG.clubs.LEAGUES[c.leagueId].name)}${above ? ` · behind ${esc(above.name)}` : ""}${below ? ` · ahead of ${esc(below.name)}` : ""}</span>
        <span><span class="muted">Board</span> <b class="${confCls}">${Math.round(c.board.confidence)}</b>/100</span>
        <span><span class="muted">To spend</span> <b>${money(c.finances.transferBudget)}</b> · wage room ${money(wageRoom)}</span>
        ${c.finances.debt > 0 ? `<span><span class="muted">Debt</span> <b class="bad">${money(c.finances.debt)}</b></span>` : ""}
      </div>
    </div>`;
  }

  function transfersWizardHtml() {
    const c = club();
    const wageRoom = c.finances.wageBudget - MG.clubs.wageBill(c);
    const reach = MG.network ? MG.network.reachLabel(c) : null;
    const listed = c.transferList || [];
    const maxPos = state.signCount >= 3 ? 4 : state.signCount;
    // A player here on loan is not yours to sell.
    const saleList = c.squad.filter((p) => !p.loan).sort(SORTS.rating);
    const row = state.lastRow;
    const kickoff = row
      ? `Season ${state.world.season} begins. Last time out: ${row.champion ? "champions" : row.promoted ? "promoted" : row.relegated ? "relegated" : `${ordinal(row.position)} in the ${row.leagueName}`}.`
      : `Season ${state.world.season} begins.`;
    return `
      ${glanceHtml(c)}
      <div class="decision boardroom">
        <div class="decision-tag">PRE-SEASON · THE WINDOW</div>
        <div class="decision-text">${esc(kickoff)} The board are ready to back you in the market — tell them how many to sign and where, and they do the deals and report back in the log.</div>
        <div class="board-note">To spend: <b>${money(c.finances.transferBudget)}</b> · wage room <b>${money(wageRoom)}</b>${reach ? ` · reach: ${esc(reach)}` : ""}</div>

        <div class="wizard-block">
          <h4>How many players do you want to sign?</h4>
          <div class="seg">${[0, 1, 2, 3].map((n) => `<button class="${state.signCount === n ? "on" : ""}" data-signcount="${n}">${n === 3 ? "3+" : n}</button>`).join("")}</div>
        </div>

        ${state.signCount > 0 ? `<div class="wizard-block">
          <h4>Which positions? <span class="muted">(${state.signPositions.length}/${maxPos})</span></h4>
          <div class="seg">${MG.players.POSITION_KEYS.map((k) => {
            const n = state.signPositions.filter((x) => x === k).length;
            return `<button class="${n ? "on" : ""}" data-signpos="${k}">${k}${n ? ` ×${n}` : ""}</button>`;
          }).join("")}</div>
          <div class="muted" style="font-size:12px;margin-top:6px">${state.signPositions.length ? `The board will chase: ${state.signPositions.map((p) => `<span class="ppos ${posClass(p)}">${p}</span>`).join(" ")}` : "Pick the positions to strengthen — one player per slot."}</div>
        </div>
        ${ambitionHtml(c)}` : ""}

        <div class="wizard-block">
          <div class="row" style="justify-content:space-between;align-items:baseline">
            <h4 style="margin:0">Up for sale <span class="muted">(${listed.length} listed)</span></h4>
            ${state.boardRecs && state.boardRecs.size ? `<button class="btn tiny" id="apply-board-recs">APPLY BOARD CHANGES</button>` : ""}
          </div>
          <div class="muted" style="font-size:12px;margin:8px 0">The board's suggestions are tagged <span class="accent2" style="color:var(--accent2)">◆ board</span> —
          <b>APPLY BOARD CHANGES</b> lists all of them in one go, then untick any you want to keep. Only players you actually
          <span class="bad">LIST</span> are sold; the board sells whoever it finds a buyer for and reports the rest.</div>
          <div class="table-scroll" id="sale-list-scroll" style="max-height:240px">${saleList.map((p) => {
            const on = listed.includes(p.id);
            const rec = state.boardRecs && state.boardRecs.has(p.id);
            return `<div class="crow ${on ? "release" : ""}">
              <div class="prating ${posClass(p.pos)}" style="width:38px;height:38px;font-size:15px;cursor:pointer" data-player="${p.id}">${Math.round(p.overall)}</div>
              <div class="crow-body"><div class="nm">${esc(p.name)} <span class="ppos ${posClass(p.pos)}">${p.pos}</span>${rec ? ` <span class="trait-chip" style="color:var(--accent2);border-color:var(--accent2);padding:0 6px">◆ board</span>` : ""}</div>
                <div class="muted" style="font-size:12px">${p.age}y · ${money(p.value)} · £${p.contract.wage}k/wk</div></div>
              <div class="crow-actions"><button class="btn tiny ${on ? "danger" : ""}" data-wlist="${p.id}">${on ? "◤ LISTED" : "LIST"}</button></div>
            </div>`;
          }).join("")}</div>
        </div>

        <div class="decision-choices" style="margin-top:12px">
          <button class="btn primary" id="confirm-transfers">CONFIRM — THE BOARD GO TO WORK ▶</button>
        </div>
      </div>`;
  }

  /* What the early-season window is decided against: the real table a third
   * of the way in, your own row and the ones either side of it, and the
   * results that got you there. glanceHtml's job in every other window —
   * enough on screen to decide without leaving the card. */
  function earlyTableHtml() {
    const e = state.earlySnapshot;
    if (!e) return glanceHtml(club());
    const c = club();
    const me = e.standing.findIndex((r) => r.clubId === c.id);
    const from = Math.max(0, me - 2), rows = e.standing.slice(from, from + 5);
    const recent = (e.matches || []).slice(-5);
    const posCls = e.vsTarget >= 2 ? "accent" : e.vsTarget <= -3 ? "bad" : "gold";
    return `<div class="panel" style="padding:10px 12px;margin-bottom:10px">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:12px;margin-bottom:8px">
        <span><span class="muted">After ${e.played}</span> <b class="${posCls}">${ordinal(e.position)}</b> · ${e.pts} pts (${e.won}-${e.drawn}-${e.lost})</span>
        <span><span class="muted">Brief</span> <b>${e.target ? ordinal(e.target) : "—"}</b></span>
        <span><span class="muted">Goals</span> <b>${e.gf}</b>:<b>${e.ga}</b></span>
        ${e.injured ? `<span class="bad">${e.injured} injured</span>` : ""}
      </div>
      <table style="width:100%;font-size:12px"><tbody>
        ${rows.map((r) => `<tr class="${r.clubId === c.id ? "you" : ""}">
          <td style="width:24px">${r.position}</td><td>${esc(r.name)}</td>
          <td style="width:28px">${r.played}</td><td style="width:34px"><b>${r.pts}</b></td>
        </tr>`).join("")}
      </tbody></table>
      ${recent.length ? `<div class="muted" style="font-size:11px;margin-top:8px">Last ${recent.length}:
        ${recent.map((m) => {
          const home = m.homeId === c.id;
          const gf = home ? m.hg : m.ag, ga = home ? m.ag : m.hg;
          const cls = gf > ga ? "accent" : gf < ga ? "bad" : "gold";
          return `<span class="${cls}">${gf}-${ga}</span> <span class="muted">${esc((home ? m.awayName : m.homeName).split(" ")[0])}</span>`;
        }).join(" · ")}</div>` : ""}
    </div>`;
  }

  function cardHtml() {
    const card = state.cards[state.cardIndex];
    const done = outcomesHtml();
    if (!card) return done;
    const isBoard = card.view.category === "BOARDROOM";
    const phase = MG.decisions.PHASES[state.phase];
    const label = phase ? phase.label : "DECISION";
    return `${done}
      <div class="stage-step">${label} · decision ${state.cardIndex + 1} of ${state.cards.length}</div>
      ${state.phase === "EARLY" ? earlyTableHtml() : glanceHtml(club())}
      <div class="decision ${isBoard ? "boardroom" : ""}">
        <div class="decision-tag">${esc(card.view.category)}</div>
        <div class="decision-text">${esc(card.view.text)}</div>
        <div class="decision-choices">
          ${card.view.choices.map((ch, i) => `
            <button class="btn choice" data-choice="${i}"><b>${esc(ch.label)}</b>${ch.detail ? `<span>${esc(ch.detail)}</span>` : ""}</button>`).join("")}
        </div>
      </div>`;
  }

  function endingHtml() {
    const v = state.endingView;
    return `<div class="stage-step">THE END OF THE ROAD?</div>
      <div class="decision boardroom">
        <div class="decision-tag">CAREER</div>
        <div class="decision-text">${esc(v.text)}</div>
        <div class="decision-choices">
          ${v.choices.map((ch, i) => `
            <button class="btn choice" data-ending="${i}"><b>${esc(ch.label)}</b>${ch.detail ? `<span>${esc(ch.detail)}</span>` : ""}</button>`).join("")}
        </div>
      </div>`;
  }

  function readyHtml() {
    const c = club(), t = c.board.targets, r = c.ratings;
    const injured = c.squad.filter((p) => (p.season.injured || 0) > 0);
    const report = MG.tactics.xiReport(c);
    const sales = (c.transferList || []).length, mentees = (c.mentoring || []).length;
    return `${outcomesHtml()}
      <div class="panel">
        <div class="stage-step">The season ahead</div>
        <div class="result-banner ok">${esc(t ? t.summary : "No brief")}</div>
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num">${Math.round(r.attack)}</div><div class="sb-lab">Attack</div></div>
          <div class="stat-box"><div class="sb-num">${Math.round(r.midfield)}</div><div class="sb-lab">Midfield</div></div>
          <div class="stat-box"><div class="sb-num">${Math.round(r.defence)}</div><div class="sb-lab">Defence</div></div>
          <div class="stat-box"><div class="sb-num">${Math.round(r.keeper)}</div><div class="sb-lab">Keeper</div></div>
          <div class="stat-box"><div class="sb-num" style="font-size:15px">${esc(c.formation)}</div><div class="sb-lab">Shape</div></div>
          <div class="stat-box"><div class="sb-num ${injured.length > 3 ? "bad" : ""}">${injured.length}</div><div class="sb-lab">Injured</div></div>
        </div>
        <div class="muted" style="font-size:12px">
          Focus: <b>${c.focus ? esc(MG.clubs.FOCUS[c.focus].label) : "none"}</b> ·
          ${report.problems ? `<span class="bad">${report.problems} out of position</span>` : "eleven in position"}${sales ? ` · ${sales} still listed` : ""}${mentees ? ` · ${mentees} mentored` : ""}
        </div>
        ${injured.length ? `<div class="muted" style="font-size:12px;margin-top:6px">Treatment room: ${injured.sort((a, b) => b.season.injured - a.season.injured).slice(0, 4).map((p) => `${esc(p.name)} (${Math.round(p.season.injured * 100)}%)`).join(", ")}</div>` : ""}
      </div>
      <div class="muted" style="font-size:12px;margin-top:10px">The season kicks off. You will be back at your desk after the opening weeks, with a table in front of you.</div>
      <button class="btn primary big" id="play-season">▶ KICK OFF</button>`;
  }

  /* End of season, before the next window opens — exactly when a manager
   * actually thinks about who is running down. Missing this used to mean
   * finding out a squad player left for nothing three windows later, buried
   * in the log with everything else that happened that summer. */
  function contractsUpHtml(c) {
    const expiring = c.squad.filter((p) => !p.loan && p.contract.years <= 1)
      .sort((a, b) => a.contract.years - b.contract.years || b.overall - a.overall);
    if (!expiring.length) return "";
    const reqs = c.contractRequests || {};
    const runOut = expiring.filter((p) => p.contract.years <= 0).length;
    return `<div class="panel">
      <h3 class="muted">CONTRACTS UP · ${expiring.length} player${expiring.length === 1 ? "" : "s"}</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        ${runOut ? `<b class="bad">${runOut} run${runOut === 1 ? "s" : ""} out completely</b> before the window opens — a free
        release if nothing is done. ` : ""}Ask the board to extend or release now; anyone left alone just keeps running down.
      </div>
      <div class="table-scroll" id="contracts-up-scroll" style="max-height:320px">${expiring.map((p) => {
        const req = reqs[p.id];
        const outNow = p.contract.years <= 0;
        return `<div class="crow ${outNow ? "release" : ""}">
          <div class="prating ${posClass(p.pos)}" style="width:38px;height:38px;font-size:15px;cursor:pointer" data-player="${p.id}">${Math.round(p.overall)}</div>
          <div class="crow-body"><div class="nm">${esc(p.name)} <span class="ppos ${posClass(p.pos)}">${p.pos}</span></div>
            <div class="muted" style="font-size:12px">${p.age}y · ${money(p.value)} · £${p.contract.wage}k/wk ·
            <span class="${outNow ? "bad" : "gold"}">${outNow ? "contract runs out" : "1 year left"}</span></div></div>
          <div class="crow-actions" style="display:flex;gap:4px">
            <button class="btn tiny ${req === "extend" ? "primary" : ""}" data-contractup="extend:${p.id}">${req === "extend" ? "◤ EXTEND" : "EXTEND"}</button>
            <button class="btn tiny ${req === "release" ? "danger" : ""}" data-contractup="release:${p.id}">${req === "release" ? "◤ RELEASE" : "RELEASE"}</button>
          </div>
        </div>`;
      }).join("")}</div>
    </div>`;
  }

  function resultHtml() {
    const row = state.lastRow, r = state.lastReport, c = club();
    if (!row) return `<div class="panel">The season was played, but your club was not in a simulated division.</div>
      <button class="btn primary big" id="to-endseason">CONTINUE</button>`;
    const tone = row.champion || row.promoted ? "great" : row.relegated ? "awful"
      : r && r.total >= 0.15 ? "good" : r && r.total <= -0.3 ? "bad" : "ok";
    const headline = row.champion ? `🏆 CHAMPIONS. ${c.name} win the ${row.leagueName}.`
      : row.promoted ? `📈 PROMOTED. ${c.name} go up${row.viaPlayoff ? " through the play-offs" : ""}.`
        : row.relegated ? `📉 RELEGATED. ${c.name} go down.`
          : `${c.name} finish ${ordinal(row.position)} in the ${row.leagueName}.`;

    /* The detail is still here, but it is no longer the headline. Two scores
     * carry the screen — the boardroom and the stands — and the four metrics
     * that produced the board's number are one click away for anyone who wants
     * to know exactly why. */
    const keys = r ? Object.keys(r.metrics) : [];
    const metrics = r ? keys.map((k) => {
      const mt = r.metrics[k];
      const pct = clamp((mt.score + 1) / 2 * 100, 0, 100);
      const cls = mt.score > 0.15 ? "good" : mt.score < -0.15 ? "bad" : "warn";
      return `<div class="metric">
        <div><div class="metric-label">${esc(mt.label)}</div><div class="metric-detail">asked ${esc(mt.target)} · got ${esc(mt.actual)}</div></div>
        <div class="muted" style="font-size:11px">${Math.round((r.weights[k] || 0) * 100)}%</div>
        <div class="metric-bar"><span class="metric-mid"></span><i class="${cls}" style="left:${Math.min(pct, 50)}%;width:${Math.max(2, Math.abs(pct - 50))}%"></i></div>
        <div class="${cls === "good" ? "accent" : cls === "bad" ? "bad" : "gold"}" style="font-weight:700">${mt.score > 0 ? "+" : ""}${mt.score}</div>
      </div>`;
    }).join("") : "";

    // From the summary, not the live squad — see toEndSeason's comment above
    // (or the fuller one on clubTopScorer in world.js): the squad already
    // reflects this close season's transfer window by the time this screen
    // draws, so reading it here could show whoever is left after a sale
    // rather than who actually top-scored the season just gone.
    const scorer = state.lastTopScorer && state.lastTopScorer.goals > 0 ? state.lastTopScorer : null;
    const f = r && r.fans;
    const fansScore = f ? f.score : Math.round(c.fans == null ? 56 : c.fans);
    const fanWhy = f ? (f.notes || []).concat((f.eventNotes || []).map((n) => n.reason)).slice(0, 3) : [];
    const confNow = r ? Math.round(r.confidence) : Math.round(c.board.confidence);

    return `
      <div class="panel">
        <div class="result-banner ${tone}">${esc(headline)}</div>
        <div class="muted" style="font-size:13px">Cup run: <b>${esc(cupLabel(row.cupRound))}</b>${scorer ? ` · Top scorer: <b class="accent">${esc(scorer.name)}</b> with ${scorer.goals}` : ""}</div>
      </div>
      ${r ? `<div class="panel">
        <div class="stage-step">The verdict · ${esc(c.board.style)} board${c.focus ? ` · focus: ${esc(MG.clubs.FOCUS[c.focus].label)}` : ""}</div>
        <div class="muted" style="font-size:13px;margin-bottom:10px">The brief was: ${esc(state.lastBrief.summary || "—")}</div>
        <div class="verdict-pair">
          <div class="verdict-card ${r.total >= 0.15 ? "good" : r.total <= -0.3 ? "bad" : ""}">
            <div class="vc-label">THE BOARDROOM</div>
            <div class="vc-score">${confNow}<span class="muted" style="font-size:14px">/100</span></div>
            <div class="vc-swing ${r.swing >= 0 ? "accent" : "bad"}">${r.swing >= 0 ? "+" : ""}${r.swing} this season</div>
            <div class="vc-verdict">${esc(r.verdict)}</div>
          </div>
          <div class="verdict-card ${fansScore >= 60 ? "good" : fansScore <= 38 ? "bad" : ""}">
            <div class="vc-label">THE SUPPORTERS</div>
            <div class="vc-score">${fansScore}<span class="muted" style="font-size:14px">/100</span></div>
            <div class="vc-swing ${f && f.swing >= 0 ? "accent" : "bad"}">${f ? `${f.swing >= 0 ? "+" : ""}${f.swing} this season` : "—"}</div>
            <div class="vc-verdict">${esc(f ? f.mood.label : MG.clubs.fanMood(fansScore).label)}</div>
          </div>
        </div>
        ${fanWhy.length ? `<div class="muted" style="font-size:12px;margin-top:8px">The stands: ${esc(fanWhy.join("; "))}.</div>` : ""}
        ${r.fanPressure ? `<div class="muted" style="font-size:12px;margin-top:4px">The mood in the ground moved the board's confidence by <b class="${r.fanPressure >= 0 ? "accent" : "bad"}">${r.fanPressure >= 0 ? "+" : ""}${r.fanPressure}</b>.</div>` : ""}
        <details style="margin-top:10px">
          <summary class="muted" style="cursor:pointer;font-size:12px">How the board reached that number</summary>
          <div style="margin-top:8px">${metrics}</div>
        </details>
      </div>` : ""}
      <button class="btn primary big" id="to-endseason">CONTINUE ▶</button>`;
  }

  function wireStage() {
    for (const b of document.querySelectorAll("[data-choice]")) b.addEventListener("click", () => chooseOption(Number(b.dataset.choice)));
    for (const b of document.querySelectorAll("[data-ending]")) b.addEventListener("click", () => chooseEnding(Number(b.dataset.ending)));
    const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
    bind("play-season", playSeason);
    bind("to-endseason", toEndSeason);
    bind("to-preseason", toNextSeason);
    bind("approach-accept", () => chooseApproach(true));
    bind("approach-decline", () => chooseApproach(false));
    bind("hub-continue", () => {
      const c = club();
      if (!c.focus) c.focus = "league";
      state.endingOutcome = null;   // read once, on the screen it belongs to
      runPhase("PRE1");
    });
    for (const b of document.querySelectorAll("[data-hubtab]")) {
      b.addEventListener("click", () => { state.hubTab = b.dataset.hubtab; render(); });
    }
    // Transfer wizard.
    for (const b of document.querySelectorAll("[data-signcount]")) b.addEventListener("click", () => {
      state.signCount = Number(b.dataset.signcount);
      const max = state.signCount >= 3 ? 4 : state.signCount;
      if (state.signPositions.length > max) state.signPositions = state.signPositions.slice(0, max);
      render();
    });
    for (const b of document.querySelectorAll("[data-signpos]")) b.addEventListener("click", () => {
      const max = state.signCount >= 3 ? 4 : state.signCount;
      const k = b.dataset.signpos, idx = state.signPositions.indexOf(k);
      if (idx >= 0) state.signPositions.splice(idx, 1);
      else if (state.signPositions.length < max) state.signPositions.push(k);
      render();
    });
    for (const b of document.querySelectorAll("[data-signambition]")) b.addEventListener("click", () => {
      if (b.disabled) return;
      state.signAmbition = b.dataset.signambition;
      render();
    });
    for (const b of document.querySelectorAll("[data-wlist]")) b.addEventListener("click", () => {
      // The sale list itself is a scrolling sub-panel, rebuilt wholesale by
      // render() like everything else — its own scrollTop resets to 0 along
      // with it unless it is explicitly carried across, which is what threw
      // the manager back to the top of a long squad after listing the one
      // player he had scrolled five names down to reach.
      const panel = $("sale-list-scroll");
      const top = panel ? panel.scrollTop : 0;
      toggleList(club(), Number(b.dataset.wlist));
      render();
      const panel2 = $("sale-list-scroll");
      if (panel2) panel2.scrollTop = top;
    });
    bind("apply-board-recs", () => {
      const c = club();
      if (!state.boardRecs) return;
      c.transferList = c.transferList || [];
      // List every board recommendation that is not already listed. The
      // manager then deselects (LIST toggles off) whichever of them he wants
      // to keep, rather than having to add each one by hand.
      for (const id of state.boardRecs) {
        if (c.transferList.includes(id)) continue;
        c.transferList.push(id);
        const p = c.squad.find((x) => x.id === id);
        if (p) p.transferListed = true;
      }
      render();
    });
    bind("confirm-transfers", confirmTransfers);
    bind("proposals-confirm", confirmProposals);
    for (const b of document.querySelectorAll("[data-deal]")) {
      b.addEventListener("click", () => toggleProposal(Number(b.dataset.deal)));
    }
    bind("moves-confirm", confirmMoves);
    for (const b of document.querySelectorAll("[data-move]")) {
      b.addEventListener("click", () => toggleMove(Number(b.dataset.move)));
    }
    for (const b of document.querySelectorAll("#stage [data-club]")) {
      b.addEventListener("click", () => openClub(Number(b.dataset.club)));
    }
    // Contracts-up panel (end of season) and any other stage-level rating
    // badge that opens a profile.
    for (const b of document.querySelectorAll("[data-contractup]")) {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const [action, id] = b.dataset.contractup.split(":");
        // Same sub-panel scroll-reset as the sale list (#sale-list-scroll,
        // see data-wlist above) — EXTEND/RELEASE calls render(), which
        // rebuilds this whole scrolling panel and threw the manager back to
        // the top of the Contracts Up list every time he actioned a player
        // more than a screen down it.
        const panel = $("contracts-up-scroll");
        const top = panel ? panel.scrollTop : 0;
        toggleContractReq(club(), Number(id), action);
        render();
        const panel2 = $("contracts-up-scroll");
        if (panel2) panel2.scrollTop = top;
      });
    }
    for (const el of document.querySelectorAll("#stage [data-player]")) {
      el.addEventListener("click", (e) => { e.stopPropagation(); openPlayer(Number(el.dataset.player)); });
    }
  }

  /* A list the manager is looking at can now live in either of two places:
   * the lower tab strip (#tab-body) in normal play, or inside the
   * pre-season hub (#stage) during the window. renderTab() only ever
   * rebuilds the former, so every control that called it directly went
   * dead the moment the same list was being viewed through the hub — the
   * squad sort buttons did nothing, and listing a player from his profile
   * updated the engine without the card ever turning red. Both looked
   * exactly like a broken button. Anything that changes what a squad list
   * should now show goes through here instead. */
  function refreshLists() {
    if (state.stage === "preseason-hub") render();
    else renderTab();
  }

  /* ------------------------ TIER 3: CLUB AND WORLD ------------------------ */
  /* The strip on its own — drawn on every screen, whether or not the panel
   * under it is open. */
  function renderTabStrip() {
    for (const b of document.querySelectorAll(".tab")) {
      b.classList.toggle("on", state.tabOpen && b.dataset.tab === state.tab);
    }
    const hint = $("tab-hint");
    if (hint) hint.textContent = state.tabOpen
      ? "Tap the open tab again to close it."
      : "Tap to open — the table, your record, the world, the academy.";
  }

  function renderTab() {
    renderTabStrip();
    const el = $("tab-body");
    const views = { table: tableHtml, career: careerHtml, world: worldHtml, youth: youthHtml };
    el.innerHTML = (views[state.tab] || tableHtml)();
    wireTab();
  }

  function squadHtml() {
    const c = club();
    const m = state.manager;
    const squad = c.squad.slice().sort(SORTS[state.squadSort] || SORTS.rating);
    const xi = new Set(MG.tactics.effectiveXI(c).map((p) => p && p.id));
    const listed = c.transferList || [], mentoring = c.mentoring || [];
    const mentorCap = MG.managers.mentorCapacity(m);
    const reqs = c.contractRequests || {};

    return `<div class="panel">
      <h3 class="muted">SQUAD (${squad.length}) · wage bill ${money(MG.clubs.wageBill(c))} / ${money(c.finances.wageBudget)} · ${esc(ownerLabel(c))}</h3>
      <div class="sortbar">
        <span class="muted">Sort</span>
        ${["rating", "pos", "name", "years"].map((k) => `<button class="btn tiny ${state.squadSort === k ? "on-mentor" : ""}" data-squadsort="${k}">${k === "pos" ? "POSITION" : k === "years" ? "CONTRACT" : k.toUpperCase()}</button>`).join("")}
      </div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        Tap a player to <span class="bad">list</span> him for sale, <span class="accent">mentor</span> him, or ask the board
        to <span class="accent">extend</span> or <span class="bad">release</span> his contract — the board still does every
        deal, you just point it. Mentoring ${mentoring.length}/${mentorCap}.
      </div>
      ${squad.map((p) => pcard(p, {
        inXI: xi.has(p.id), listed: listed.includes(p.id), mentored: mentoring.includes(p.id),
        canMentor: mentoring.length < mentorCap || mentoring.includes(p.id),
        contractReq: reqs[p.id], level: c.level,
      })).join("")}
    </div>
    ${loanedOutHtml(c)}`;
  }

  /* Your own prospects, out getting the games they could not get here. They sit
   * in the loan club's squad, so without their own section they would simply
   * disappear from the game for a season. */
  function loanedOutHtml(c) {
    const out = state.world.loanedOut ? state.world.loanedOut(c.id) : [];
    if (!out.length) return "";
    return `<div class="panel">
      <h3 class="muted">OUT ON LOAN (${out.length})</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        Young players the board sent out to get minutes — development runs on games played, so a season elsewhere is
        worth more than a season in your reserves. They come back in the summer.
      </div>
      ${out.map(({ player, at }) => `<div class="crow">
        <div class="prating ${posClass(player.pos)}" style="width:38px;height:38px;font-size:15px;cursor:pointer" data-player="${player.id}">${Math.round(player.overall)}</div>
        <div class="crow-body">
          <div class="nm">${esc(player.name)} <span class="ppos ${posClass(player.pos)}">${player.pos}</span></div>
          <div class="muted" style="font-size:12px">${player.age}y · potential ${Math.round(player.potential)} · at <b>${esc(at.name)}</b> · ${player.season.apps || 0} apps this season</div>
        </div>
      </div>`).join("")}
    </div>`;
  }

  /** One donor-style player card, coloured by position, with list, mentor and
   *  contract actions on the right. Clicking the body opens the full profile.
   *  Contracts used to be a separate tab; the four actions here (list, mentor,
   *  extend, release) are all the same shape — you state a preference, the
   *  board executes it and reports back — so they belong on the same card. */
  function pcard(p, opt) {
    const o = opt || {};
    const pc = posClass(p.pos);
    const flags = `${o.inXI ? '<span class="ppos midfield" style="background:rgba(0,208,108,.14)">XI</span>' : ""}`;
    const natFlag = MG.names ? MG.names.flagFor(p.nationality) : "";
    const yrs = p.contract.years;
    const yrsCls = yrs <= 0 ? "bad" : yrs === 1 ? "gold" : "muted";
    const yrsLabel = yrs <= 0 ? "OUT" : `${yrs}y left`;
    // Overall is never fuzzed by scouting, a rival's player included — this
    // is not the kind of game that hides a number behind a department's
    // guesswork. See MG.scouting.playerBand, which nothing in the UI calls
    // for a rating badge any more (openClub's scouting report still fuzzes
    // a rival's TEAM shape, which is a different thing — an opinion about
    // how the pieces fit, not a hidden fact about one player).
    const ratingNum = Math.round(p.overall);
    /* LIST/MENTOR/EXTEND/RELEASE used to live here as a 2x2 button grid — a
     * fixed 118px column that, next to the rating badge, left almost nothing
     * for the name on a phone-width screen and made long names unreadable.
     * Those four actions all live on the player's profile now (tap the card
     * to open it); the list card's own job is just to be a legible list, so
     * the coloured border (see .pcard.mentored/.listed above) is the only
     * status a row still carries at a glance. Loan status is the exception —
     * it is not a lever you pull here, so it earns a small tag of its own. */
    const tag = p.loan
      ? `<div class="pactions"><span class="trait-chip" style="color:var(--rare);border-color:var(--rare);padding:0 6px">ON LOAN</span></div>`
      : o.mentored == null
        ? `<div class="pactions"><span class="muted" style="font-size:11px">${esc(p.pos)}</span></div>`
        : "";
    const tierCls = ratingTierClass(p.overall, o.level);
    return `<div class="pcard ${o.mentored ? "mentored" : o.listed ? "listed" : o.inXI ? "in-xi" : ""}">
      <div class="prating ${pc} ${tierCls}" data-player="${p.id}" style="cursor:pointer">${ratingNum}${growthTag(p)}</div>
      <div class="pbody" data-player="${p.id}" style="cursor:pointer">
        <div class="pname">${flags}<span title="${esc(p.nationality)}">${natFlag}</span> ${esc(p.name)}${p.homegrown ? ' <span class="hg">HG</span>' : ""}${markTag(p)}</div>
        <div class="pmeta"><span class="ppos ${pc}">${esc(p.pos)}</span>${p.age}y · pot ${Math.round(p.potential)} · ${money(p.value)} · £${p.contract.wage}k
          · <span class="${yrsCls}">${yrsLabel}</span>
          ${p.lastSeason && p.lastSeason.apps ? ` · <span class="muted">last yr ${p.lastSeason.apps}a ${p.lastSeason.goals}g</span>` : ""}
          ${p.season.injured > 0 ? ` · <span class="inj">out ${Math.round(p.season.injured * 100)}%</span>` : durabilityTag(p)}</div>
      </div>
      ${tag}
    </div>`;
  }

  /* ------------------------------ THE RADAR --------------------------------
   * The same six numbers as the bars beside it, as a shape. The bars answer
   * "how good is he at X"; the shape answers "what KIND of footballer is
   * this" — which is what you actually want when deciding whether he fits,
   * and the question a column of near-identical bar lengths is worst at.
   *
   * THE SCALE IS THE WHOLE TRICK. Plotted raw on 0-99 every senior
   * professional is a rounded blob in the middle: real squads live in a
   * band of roughly 45-90, so a 46 and an 85 — a genuinely enormous
   * difference — sit barely 40% of the radius apart while the inner half of
   * the chart stays permanently empty. The radial axis therefore starts at
   * RADAR_FLOOR rather than zero, spending the whole chart on the range
   * players are actually in and turning that same pair into most of the
   * radius. Nothing is invented or exaggerated: these are the same values
   * printed on the bars, on a zoomed axis — which is exactly why the floor
   * is printed underneath rather than hidden. */
  const RADAR_FLOOR = 38;
  const RADAR_AXES = ["DEF", "PHY", "SPD", "ATT", "AER", "MEN"];
  function radarHtml(stats) {
    if (!stats || stats.length < 3) return "";
    const n = stats.length;
    const cx = 100, cy = 96, R = 62;
    // Floored a little above zero so a genuinely poor axis is still a
    // visible point rather than vanishing into the centre and pinching the
    // whole shape shut.
    const rOf = (v) => R * clamp((v - RADAR_FLOOR) / (99 - RADAR_FLOOR), 0.08, 1);
    const pt = (i, r) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    const poly = (fn) => stats.map((s, i) => pt(i, fn(s, i)).map((v) => Math.round(v * 10) / 10).join(",")).join(" ");
    const spokes = stats.map((_, i) => {
      const [x, y] = pt(i, R);
      return `<line class="spoke" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    }).join("");
    const dots = stats.map((s, i) => {
      const [x, y] = pt(i, rOf(s.value));
      return `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"/>`;
    }).join("");
    const labels = stats.map((s, i) => {
      const [x, y] = pt(i, R + 16);
      const at = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
      const dy = Math.abs(x - cx) < 6 ? (y > cy ? 10 : -4) : 3;
      // A keeper's first axis is Goalkeeping, not Defending — see radarAxes.
      const code = i === 0 && /^Goal/.test(s.label) ? "GK" : (RADAR_AXES[i] || s.label.slice(0, 3).toUpperCase());
      return `<text class="axlabel" x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${at}">${esc(code)}</text>
              <text class="axval" x="${x.toFixed(1)}" y="${(y + dy + 11).toFixed(1)}" text-anchor="${at}">${Math.round(s.value)}</text>`;
    }).join("");
    return `<div class="radar-wrap">
      <svg class="radar" viewBox="0 0 200 200" role="img" aria-label="Attribute radar">
        <polygon class="grid" points="${poly(() => R)}"/>
        <polygon class="grid" points="${poly(() => R * 0.66)}"/>
        <polygon class="grid" points="${poly(() => R * 0.33)}"/>
        ${spokes}
        <polygon class="shape" points="${poly((s) => rOf(s.value))}"/>
        ${dots}
        ${labels}
      </svg>
      <div class="radar-note">Same numbers as the bars — the axis starts at ${RADAR_FLOOR}, so the shape shows the differences.</div>
    </div>`;
  }

  /* Last season's mark out of ten, on the football scale where 6 is unremarkable
   * and 8 wins awards. This is the answer to "why is my star playing poorly" —
   * it is on his card, not buried in a report. */
  function markTag(p) {
    const r = p.lastSeason && p.lastSeason.rating;
    if (r == null) return "";
    const cls = r >= 7.4 ? "mark-great" : r >= 6.7 ? "mark-good" : r >= 6.0 ? "mark-ok" : "mark-poor";
    return ` <span class="pmark ${cls}" title="Average rating last season">${r.toFixed(1)}</span>`;
  }

  /* How far he moved in the last year. The single clearest signal that a young
   * signing is working out — or that a thirty-three-year-old is going. */
  function growthTag(p) {
    if (!p.lastSeason || p.lastSeason.overall == null) return "";
    const d = Math.round(p.overall - p.lastSeason.overall);
    if (d === 0) return "";
    return `<span class="pgrow ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
  }

  /* Only shown when it is actually a concern — a durability rating for every
   * player in a 26-man squad would be noise, not information. */
  function durabilityTag(p) {
    if (!MG.players.durability) return "";
    const d = MG.players.durability(p);
    if (d.score >= 45) return "";
    return ` · <span class="bad">tires early (${d.gamesSurvived}/5)</span>`;
  }

  function moraleDot(m) {
    const v = m == null ? 60 : m;
    const cls = v >= 70 ? "accent" : v >= 45 ? "gold" : "bad";
    return `<span class="${cls}">${Math.round(v)}</span>`;
  }

  /* A visible fitness read: how many games in a row he can be leaned on
   * before dropping off, built from fitness and age alone — nothing hidden,
   * because this is the "you can see it" fitness rating, not a prediction
   * of when he gets injured. */
  function durabilityHtml(player) {
    if (!MG.players.durability) return "";
    const d = MG.players.durability(player);
    const cls = d.score >= 70 ? "accent" : d.score >= 45 ? "gold" : "bad";
    const bars = "●".repeat(d.gamesSurvived) + "○".repeat(5 - d.gamesSurvived);
    return `<div class="board-note" style="margin-top:10px">
      <b class="${cls}">${d.score}/100 durability</b> — survives about
      <span class="${cls}" style="letter-spacing:1px">${bars}</span> ${d.gamesSurvived}/5 matches at full intensity before he needs a rest.
      ${player.age >= 30 ? `<span class="muted"> Age ${player.age}: recovers slower than a player in his twenties.</span>` : ""}
    </div>`;
  }

  /* Where he has actually been — the "so we can see movement" ask. Every
   * signing, sale, loan return, board sale and academy promotion now records
   * a {club, season, age} entry (players.js's recordMove); this just reads
   * that back as a short timeline instead of the flat name list career.clubs
   * always was, which no screen ever showed. Only appears once there is an
   * actual PATH to show — his very first club is not a career yet. */
  function careerPathHtml(player) {
    const hist = (player.career.history || []).slice().reverse();
    if (hist.length < 2) return "";
    const shown = hist.slice(0, 8);
    return `<div class="panel" style="margin:10px 0 0;padding:10px">
      <div class="stage-step" style="margin-bottom:6px">Career path${hist.length > shown.length ? ` <span class="muted" style="font-weight:400">(${hist.length} clubs — most recent shown)</span>` : ""}</div>
      <div style="display:flex;flex-direction:column;gap:4px;font-size:13px">
        ${shown.map((h, i) => `<div>${i === 0 ? '<b class="accent">NOW</b>' : `<span class="muted">${h.season != null ? `S${h.season}` : "—"}</span>`}
          — ${esc(h.club)}${h.age != null ? ` <span class="muted">· ${h.age}y</span>` : ""}</div>`).join("")}
      </div>
    </div>`;
  }

  function tacticsHtml() {
    const c = club();
    const formation = MG.tactics.FORMATIONS[c.formation];
    const report = MG.tactics.xiReport(c);
    // Group the eleven into rows by line so it reads like a team sheet.
    const lineOf = (slot) => slot === "GK" ? 0 : (slot === "CB" || slot === "FB") ? 1
      : (slot === "DM" || slot === "CM") ? 2 : slot === "AM" ? 3 : 4;
    const rows = [[], [], [], [], []];
    report.rows.forEach((r, i) => rows[lineOf(r.slot)].push({ r, i }));

    return `
      <div class="panel">
        <h3 class="muted">FORMATION</h3>
        <div class="seg">${MG.tactics.FORMATION_KEYS.map((k) => `
          <button class="${k === c.formation ? "on" : ""}" data-formation="${k}">${k}</button>`).join("")}</div>
        <div class="muted" style="font-size:12px;margin-top:6px">${esc(formation.blurb)}</div>
        ${(() => {
          const p = MG.tactics.predictability(c, state.manager);
          const l = MG.tactics.predictabilityLabel(p);
          return `<div class="muted" style="font-size:12px;margin-top:6px">Opponents find this side <b class="${p >= 0.8 ? "bad" : p >= 0.5 ? "gold" : "accent"}">${esc(l.label)}</b> — ${esc(l.blurb)}. Changing the shape or the playstyle starts that clock again.</div>`;
        })()}
      </div>
      <div class="panel">
        <h3 class="muted">SEASON FOCUS</h3>
        <div class="seg">${MG.clubs.FOCUS_KEYS.map((k) => `
          <button class="${k === c.focus ? "on" : ""}" data-focus="${k}">${esc(MG.clubs.FOCUS[k].label)}</button>`).join("")}</div>
        <div class="muted" style="font-size:12px;margin-top:6px">${c.focus ? esc(MG.clubs.FOCUS[c.focus].blurb) : "Pick what this season is actually for."}</div>
      </div>
      ${trainingFocusHtml(c)}
      ${synergyHtml(c)}
      ${scoutingHtml(c)}
      <div class="panel">
        <h3 class="muted">STARTING XI · ${report.averageFamiliarity}% in position${report.problems ? ` · <span class="bad">${report.problems} misplaced</span>` : ""}</h3>
        <div class="pitch"><div class="pitch-rows">
          ${rows.map((line) => line.length ? `<div class="pitch-row">${line.map(({ r, i }) => slotHtml(r, i)).join("")}</div>` : "").join("")}
        </div></div>
        <div class="row" style="margin-top:10px">
          <button class="btn tiny" id="auto-pick">AUTO-PICK BEST XI</button>
          <span class="muted" style="font-size:12px">Tap a shirt to change who plays there.</span>
        </div>
      </div>
      ${matchupHtml(c)}
      ${depthHtml(c)}
      <div class="panel muted" style="font-size:12px">Signings and sales are handled in the pre-season <b>window</b> (top of the Decisions panel), and listing, mentoring and contracts are on each player's card in the <b>SQUAD</b> tab — the board does the dealing, you just point it.</div>`;
  }

  /* Training Focus — the report's Performance <-> Improvement bar. What the
   * week is actually spent on, independent of the system you play: it feeds
   * both the synergy read below (does it suit the manager's system?) and
   * development speed all season (tactics.js's developmentMultiplier). */
  function trainingFocusHtml(c) {
    if (!MG.tactics.TRAINING_FOCUS) return "";
    const key = c.trainingFocus && MG.tactics.TRAINING_FOCUS[c.trainingFocus] ? c.trainingFocus : "balanced";
    const focus = MG.tactics.TRAINING_FOCUS[key];
    const pct = Math.round(focus.axis * 100);
    return `<div class="panel">
      <h3 class="muted">TRAINING FOCUS</h3>
      <div class="seg">${MG.tactics.TRAINING_FOCUS_KEYS.map((k) => `
        <button class="${k === key ? "on" : ""}" data-trainfocus="${k}">${esc(MG.tactics.TRAINING_FOCUS[k].label)}</button>`).join("")}</div>
      <div class="muted" style="font-size:12px;margin-top:6px">${esc(focus.blurb)}</div>
      <div class="metric-bar" style="margin-top:8px"><span class="metric-mid"></span><i class="${pct >= 50 ? "warn" : "good"}" style="left:${Math.min(pct, 50)}%;width:${Math.max(2, Math.abs(pct - 50))}%"></i></div>
      <div class="muted" style="font-size:11px;margin-top:2px;display:flex;justify-content:space-between"><span>Improvement (development)</span><span>Performance (this season)</span></div>
    </div>`;
  }

  /* Tactical synergy — whether playstyle, shape, training and the manager
   * himself are all pointing the same way. See tactics.js's synergyScore. */
  function synergyHtml(c) {
    if (!MG.tactics.synergyScore) return "";
    const manager = state.manager;
    const s = MG.tactics.synergyScore(c, manager);
    const pctText = `${s.xgMult >= 1 ? "+" : ""}${Math.round((s.xgMult - 1) * 1000) / 10}%`;
    const cls = s.xgMult > 1.015 ? "accent" : s.xgMult < 0.985 ? "bad" : "gold";
    const verdict = s.aligned ? "Everything about how you set up points the same way."
      : s.clash ? "The system, the shape, the training and the manager are pulling in different directions."
        : s.score >= 55 ? "Mostly aligned, nothing actively fighting itself."
          : "A few things are pulling against each other.";
    const fitCls = (v) => v >= 0.75 ? "accent" : v >= 0.45 ? "gold" : "bad";
    return `<div class="panel">
      <h3 class="muted">TACTICAL SYNERGY · <b class="${cls}">${pctText} xG</b></h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Four things have to agree for a side to click: the manager's system
      (<b>${esc(manager ? manager.tactic : "—")}</b>), the shape you play it in (<b>${esc(c.formation)}</b>), how you train for it, and the
      manager's own natural game. ${esc(verdict)}</div>
      <div class="depth-grid">
        <div class="dcell"><div class="dname" style="white-space:normal">Shape fit</div><div class="${fitCls(s.factors.formation)}" style="font-size:13px;font-weight:700">${Math.round(s.factors.formation * 100)}%</div></div>
        <div class="dcell"><div class="dname" style="white-space:normal">Training fit</div><div class="${fitCls(s.factors.training)}" style="font-size:13px;font-weight:700">${Math.round(s.factors.training * 100)}%</div></div>
        <div class="dcell"><div class="dname" style="white-space:normal">Manager fit</div><div class="${fitCls(s.factors.manager)}" style="font-size:13px;font-weight:700">${Math.round(s.factors.manager * 100)}%</div></div>
      </div>
    </div>`;
  }

  /* The scouting department's own report on itself — what it is built from,
   * and what that buys you when you go and look at a rival (see openClub and
   * scouting.js). Board and team wealth is deliberately never shown as a
   * number, the same way ownerLabel never shows the hidden wealth figure. */
  function scoutingHtml(c) {
    if (!MG.scouting) return "";
    const s = MG.scouting.strength(state.world, c);
    const label = MG.scouting.strengthLabel(s.score);
    const reach = MG.network ? MG.network.reachLabel(c) : null;
    const cls = s.score >= 60 ? "accent" : s.score >= 42 ? "gold" : "bad";
    return `<div class="panel">
      <h3 class="muted">SCOUTING DEPARTMENT · <b class="${cls}">${s.score}</b>/100</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px"><b>${esc(label.label)}</b> — ${esc(label.blurb)}
      Every player's rating is always the true one, yours or a rival's — this only colours the narrative read on a
      rival CLUB's overall shape and intentions, never a number the engine already knows.</div>
      <div class="depth-grid">
        <div class="dcell"><div class="dname">Facilities</div><div style="font-size:13px;font-weight:700">${s.training}</div></div>
        <div class="dcell"><div class="dname">Backing</div><div style="font-size:13px;font-weight:700">${s.wealth >= 74 ? "Strong" : s.wealth >= 45 ? "Fair" : "Thin"}</div></div>
        <div class="dcell"><div class="dname">Mood</div><div style="font-size:13px;font-weight:700">${s.morale >= 60 ? "Settled" : s.morale >= 40 ? "Uneasy" : "Fractious"}</div></div>
        <div class="dcell"><div class="dname">Reach</div><div style="font-size:12px;font-weight:700">${esc(s.tier)}</div></div>
      </div>
      ${reach ? `<div class="muted" style="font-size:11px;margin-top:6px">Network: ${esc(reach)}.</div>` : ""}
    </div>`;
  }

  /* How your shape fares against the shapes you will actually meet this season.
   * The engine reads this same table, so what is shown here is what is applied. */
  function matchupHtml(c) {
    if (!MG.tactics.matchupLabel) return "";
    const rivals = state.world.clubsInLeague(c.leagueId).filter((x) => x.id !== c.id);
    const counts = {};
    for (const r of rivals) counts[r.formation] = (counts[r.formation] || 0) + 1;
    const rows = MG.tactics.FORMATION_KEYS.map((f) => {
      const m = MG.tactics.matchupLabel(c.formation, f);
      const cls = m.value > 0 ? "accent" : m.value < 0 ? "bad" : "muted";
      const sign = m.value > 0 ? "+".repeat(m.value) : m.value < 0 ? "−".repeat(-m.value) : "=";
      return `<div class="mrow"><span class="mf">${esc(f)}</span>
        <span class="muted" style="font-size:11px">${counts[f] || 0} in your league</span>
        <b class="${cls}">${sign}</b><span class="${cls}" style="font-size:11px">${esc(m.text)}</span></div>`;
    }).join("");
    return `<div class="panel">
      <h3 class="muted">${esc(c.formation)} AGAINST THE LEAGUE</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Shape against shape, before players are counted. A midfield three
      beats a flat two; a back five smothers two strikers. Worth up to a fifth of a goal a game — enough to tilt a match, never
      enough to beat a better squad on its own.</div>
      ${rows}
    </div>`;
  }

  /* Every shirt's understudy. Depth is what carries a squad through injuries
   * and a fixture pile-up, and it now feeds the team rating per position rather
   * than as one flat bench average. */
  function depthHtml(c) {
    if (!MG.tactics.backupsFor) return "";
    const rows = MG.tactics.backupsFor(c);
    const score = MG.tactics.depthScore(c);
    const cls = score >= 70 ? "accent" : score >= 45 ? "gold" : "bad";
    /* The fatigue factor world.js computed from last season's minutes and
     * pressing intensity. It is already applied — it moves club form by up to
     * two points across a campaign — but until now it was applied invisibly,
     * so "squad depth is worth paying for" was a claim the manager had no way
     * of checking. Shown as freshness, because that is the direction a reader
     * expects a bigger number to be better in. */
    const fatigue = c.modifiers && c.modifiers.fatigue;
    const fresh = fatigue != null ? Math.round(fatigue * 100) : null;
    // Measured across a simulated world the factor runs 0.92–1.00, median
    // 0.988 — so the bands are cut at 99 and 96, not at round numbers that
    // would put every club in the same colour.
    const fcls = fresh == null ? "muted" : fresh >= 99 ? "accent" : fresh >= 96 ? "gold" : "bad";
    const fnote = fresh == null ? "" : fresh >= 99 ? "rotated well — they finished the season fresh"
      : fresh >= 96 ? "some wear on the first eleven by the run-in"
        : "you leant on the same eleven all year, and it cost you points";
    return `<div class="panel">
      <h3 class="muted">COVER · squad depth <b class="${cls}">${score}</b>/100${fresh != null ? ` · freshness <b class="${fcls}">${fresh}</b>%` : ""}</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Who comes in if the starter cannot play, and how far the side
      drops when he does. Thin cover in one position is what a long season finds out.${fnote ? ` <b class="${fcls}">Last season: ${esc(fnote)}.</b>` : ""}</div>
      <div class="depth-grid">${rows.map((r) => {
        const d = r.dropOff;
        const dc = !r.adequate ? "bad" : d == null ? "bad" : d <= 3 ? "accent" : d <= 8 ? "gold" : "bad";
        // A named man who is nowhere near the standard of the shirt is shown
        // as what he is: who would have to play, and that it is not cover.
        return `<div class="dcell">
          <div class="dslot"><span class="ppos ${posClass(r.slot)}">${esc(r.slot)}</span></div>
          <div class="dname"${r.backup && !r.adequate ? ' style="opacity:.6"' : ""}>${r.backup ? esc(r.backup.name.split(" ").slice(-1)[0]) : "<span class='bad'>none</span>"}</div>
          <div class="${dc}" style="font-size:11px;font-weight:700">${!r.backup ? "no cover"
          : r.adequate ? `${r.rating} (${d >= 0 ? "−" : "+"}${Math.abs(d)})` : `${r.rating} · not cover`}</div>
        </div>`;
      }).join("")}</div>
    </div>`;
  }

  /* ------------------------------ YOUTH TAB -------------------------------
   * The academy in one screen: what the board wants from it, what it is funded
   * to do, who is in it, and the two decisions the manager actually gets —
   * how they are trained, and which of them is ready. */
  function youthHtml() {
    const c = club();
    if (!MG.youth) return `<div class="panel muted">The academy is not loaded.</div>`;
    const a = MG.youth.ensure(c);
    const t = c.board.targets;
    const players = a.players.slice().sort((x, y) => (y.potential - y.overall) - (x.potential - x.overall) || y.overall - x.overall);
    const level = c.level != null ? c.level : 60;
    const focus = MG.youth.FOCUS[a.focus];

    return `<div class="panel">
      <h3 class="muted">THE ACADEMY · ${esc(c.name)}</h3>
      <div class="stat-grid">
        <div class="stat-box"><div class="sb-num" style="font-size:14px">${esc(c.academyTier || "Average")}</div><div class="sb-lab">Academy</div></div>
        <div class="stat-box"><div class="sb-num">${Math.round(c.facilities.youth)}</div><div class="sb-lab">Youth setup</div></div>
        <div class="stat-box"><div class="sb-num">${Math.round(c.facilities.training)}</div><div class="sb-lab">Training</div></div>
        <div class="stat-box"><div class="sb-num gold">${t ? t.youthMinutes + "%" : "—"}</div><div class="sb-lab">Board wants</div></div>
        <div class="stat-box"><div class="sb-num">${players.length}</div><div class="sb-lab">In the academy</div></div>
        <div class="stat-box"><div class="sb-num">${a.lastIntake ? `S${a.lastIntake}` : "—"}</div><div class="sb-lab">Last intake</div></div>
        <div class="stat-box"><div class="sb-num">${money(c.finances.balance)}</div><div class="sb-lab">Club balance</div></div>
        <div class="stat-box"><div class="sb-num" style="font-size:14px">${esc(c.board.style)}</div><div class="sb-lab">Board</div></div>
      </div>
      <div class="muted" style="font-size:12px">
        The board's brief asks for <b>${t ? t.youthMinutes : 0}%</b> of minutes to go to under-21s, and it scores you on it every
        season. Better facilities mean better prospects and a narrower scouting range — you see what your coaches can actually tell.
      </div>
    </div>

    <div class="panel">
      <h3 class="muted">HOW THEY ARE COACHED</h3>
      <div class="seg">${MG.youth.FOCUS_KEYS.map((k) => `
        <button class="${k === a.focus ? "on" : ""}" data-yfocus="${k}">${esc(MG.youth.FOCUS[k].label)}</button>`).join("")}</div>
      <div class="muted" style="font-size:12px;margin-top:6px">${esc(focus.blurb)}</div>
    </div>

    <div class="panel">
      <h3 class="muted">THE YOUTH SQUAD</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        Your coaches' verdict, not a spreadsheet — the range is what they are prepared to commit to.
        <b>PROMOTE</b> puts a boy in the senior squad; leave him and he keeps training, but past ${MG.youth.PROMOTE_AGE} he is released.
      </div>
      ${players.length ? players.map((p) => {
        const g = MG.youth.grade(p);
        const ready = p.overall >= level - 8;
        const s = p.scouted || {};
        return `<div class="crow ${ready ? "extend" : ""}">
          <div class="prating ${posClass(p.pos)}" style="width:38px;height:38px;font-size:15px;cursor:pointer" data-player="${p.id}">${Math.round(p.overall)}</div>
          <div class="crow-body">
            <div class="nm">${esc(p.name)} <span class="ppos ${posClass(p.pos)}">${p.pos}</span>
              <span class="pmark ${g.cls === "gold" ? "mark-great" : g.cls === "accent" ? "mark-good" : "mark-ok"}">${esc(g.label)}</span></div>
            <div class="muted" style="font-size:12px">${p.age}y · coaches see him reaching <b>${s.floor || "?"}–${s.ceiling || "?"}</b>${ready ? ` · <span class="accent">ready for the first team</span>` : ` · needs time`}</div>
          </div>
          <div class="crow-actions">
            <button class="btn tiny ${ready ? "primary" : ""}" data-promote="${p.id}">PROMOTE</button>
            <button class="btn tiny danger" data-release="${p.id}">RELEASE</button>
          </div>
        </div>`;
      }).join("") : `<div class="muted">The academy is empty — a new intake arrives at the end of the season.</div>`}
    </div>`;
  }

  function slotHtml(r, i) {
    const p = r.player;
    const cls = r.fam < 0.7 ? "bad" : r.fam < 0.9 ? "warn" : "";
    return `<button class="slot ${cls}" data-slot="${i}">
      <div class="slot-pos">${esc(r.slot)}</div>
      <div class="slot-name">${p ? esc(p.name.split(" ").slice(-1)[0]) : "—"}</div>
      <div><span class="slot-ovr">${p ? Math.round(p.overall) : "-"}</span> <span class="muted">${p ? esc(p.pos) : ""}</span></div>
      ${r.warning ? `<div class="slot-flag ${r.fam < 0.7 ? "bad" : ""}">${esc(r.warning)}</div>` : ""}
      ${r.injured ? `<div class="slot-flag bad">injured</div>` : ""}
    </button>`;
  }

  /* Which places mean something in a given division. The English pyramid is
   * the interesting one: two automatic promotions (one out of the National
   * League) and then FOUR play-off places, which is a real four-team,
   * two-legged play-off with a neutral final — see competitions.js's
   * runPlayoff. Those places were being simulated and settled every season
   * without the table ever saying which they were, so a club finishing 4th
   * had no way to know from this screen that its season was not over. */
  function leagueZones(leagueId, fieldSize) {
    const pyramid = MG.clubs.ENGLISH_PYRAMID || [];
    const idx = pyramid.indexOf(leagueId);
    const cfg = MG.clubs.LEAGUES[leagueId] || {};
    const zones = {};
    if (idx > 0) {                       // a division to be promoted into
      const autoUp = leagueId === "NationalLeague" ? 1 : 2;
      for (let p = 1; p <= autoUp; p++) zones[p] = "zone-auto";
      for (let p = autoUp + 1; p <= autoUp + 4; p++) zones[p] = "zone-po";
    } else if (cfg.tier === 1) {         // top flight: Europe is the prize
      for (let p = 1; p <= 4; p++) zones[p] = "zone-eur";
    }
    // Relegation only exists where this game actually simulates a division
    // below — the English pyramid. The foreign leagues are standalone.
    if (idx >= 0 && idx < pyramid.length - 1) {
      const down = cfg.down || 3;
      for (let p = fieldSize; p > fieldSize - down && p > 0; p--) zones[p] = "zone-rel";
    }
    return zones;
  }

  function tableHtml() {
    const world = state.world, c = club();
    const last = world.history[world.history.length - 1];
    const res = last && last.leagues[c.leagueId];
    if (!res) return `<div class="panel muted">No table yet — play your first season.</div>`;
    const zones = leagueZones(c.leagueId, res.table.length);
    const used = new Set(Object.values(zones));
    const key = [
      used.has("zone-eur") ? `<span class="zkey zone-eur"></span>Europe` : "",
      used.has("zone-auto") ? `<span class="zkey zone-auto"></span>Promoted` : "",
      used.has("zone-po") ? `<span class="zkey zone-po"></span>Play-offs` : "",
      used.has("zone-rel") ? `<span class="zkey zone-rel"></span>Relegated` : "",
    ].filter(Boolean).join(" &nbsp; ");
    return `<div class="panel"><h3 class="muted">${esc(res.leagueName)}</h3>
      <table><thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th><th>Manager</th></tr></thead>
      <tbody>${res.table.map((r) => {
        const cl = world.clubById(r.clubId), mgr = world.managerById(cl.managerId);
        return `<tr class="${r.clubId === c.id ? "you" : ""}"><td class="${zones[r.position] || ""}">${r.position}</td><td>${esc(r.name)}</td>
          <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gd}</td><td><b>${r.pts}</b></td>
          <td class="muted">${esc(mgr ? mgr.name : "—")}</td></tr>`;
      }).join("")}</tbody></table>
      ${key ? `<div class="muted" style="font-size:11px;margin-top:6px">${key}</div>` : ""}
    </div>`;
  }

  function worldHtml() {
    const world = state.world;
    const last = world.history[world.history.length - 1];
    /* Only the FEED needs a completed season — it is a report on one. The
     * search box, the top-rated list and the league browser are all reads of
     * the world as it stands right now, and they used to be hidden behind the
     * same early return, so the entire World tab said "nothing has happened
     * yet" for the whole of season one. */
    const of = (type) => (last
      ? world.news.filter((n) => n.season === last.season && n.type === type && n.clubId !== state.clubId)
      : []);
    const section = (title, items, limit) => `
      <div class="panel"><h3 class="muted">${title}</h3>
        ${items.slice(0, limit || 10).map((n) => `<div class="log-entry ${esc(n.type)}">${esc(n.text)}</div>`).join("") || `<div class="muted">Nothing to report.</div>`}
      </div>`;

    // The world feed: everything OUT there — the report's global tab. Deliberately
    // deep for players who want to follow the ecosystem, and out of the way for
    // those who do not.
    const feed = section("🏆 SILVERWARE", of("trophy"))
      + section("🔁 MANAGERS ON THE MOVE", of("sack").concat(of("hire")).concat(of("retirement")), 16)
      + section("💰 THE WINDOW", of("transfer"), 16)
      + section("🌱 COMING THROUGH", of("youth"), 8);

    // The reference browser: the leagues that drive the simulation, open to
    // anyone who wants to scout a rival or just look around.
    const browser = `<div class="panel">
      <h3 class="muted">BROWSE THE WORLD</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">The full football pyramid the engine simulates. Click a division to see its table, then a club to see its squad and manager.</div>
      <div class="seg">${MG.clubs.LEAGUE_KEYS.map((k) => `<button data-league="${k}">${esc(MG.clubs.LEAGUES[k].name)}</button>`).join("")}</div>
    </div>`;
    const search = `<div class="panel">
      <h3 class="muted">SEARCH PLAYERS</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Anyone in the world, at any club — find a name and tap through to his full career.</div>
      <input id="player-search" type="text" placeholder="Search by name…" value="${esc(state.playerSearch)}" autocomplete="off"
        style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--txt);font:inherit" />
      <div id="search-results" style="margin-top:8px">${searchResultsHtml()}</div>
    </div>`;
    return search + topRatedHtml() + browser
      + (last ? feed : `<div class="panel muted" style="font-size:12px">The world feed fills up once a season has been played.</div>`);
  }

  /* ------------------------- THE TOP-RATED LIST ----------------------------
   * The best players in the world, filterable by position. Built as a testing
   * instrument rather than a feature: the fastest way to see whether a change
   * to development or to the attribute model has done what it was supposed to
   * is to look at the top of the game and check that the ratings and the
   * attribute means still agree. It shows both, side by side, for exactly that
   * reason — the ATTR column is the mean of the player's six attributes, and
   * it should sit a handful of points under the rating, never tens.
   *
   * Reachable from the WORLD tab, alongside the player search it sits under. */
  const TOP_RATED_LIMIT = 40;
  function topRatedHtml() {
    const world = state.world;
    const pos = state.topPos || "ALL";
    const all = [];
    for (const c of world.clubs) {
      for (const p of c.squad) {
        if (pos !== "ALL" && p.pos !== pos) continue;
        all.push(p);
      }
    }
    all.sort((a, b) => b.overall - a.overall);
    const shown = all.slice(0, TOP_RATED_LIMIT);
    const keys = ["ALL"].concat(MG.players.POSITION_KEYS);
    const nav = `<div class="seg" style="flex-wrap:wrap;margin-bottom:8px">${keys.map((k) =>
      `<button class="${pos === k ? "on" : ""}" data-toppos="${k}">${k}</button>`).join("")}</div>`;
    const rows = shown.map((p, i) => {
      const c = world.clubById(p.clubId);
      const pc = posClass(p.pos);
      const attrs = MG.ratings.radarAxes(p);
      const mean = Math.round(attrs.reduce((t, a) => t + a.value, 0) / attrs.length);
      /* Measured against what his POSITION normally reads at his rating, not
       * against the rating itself — see players.expectedAttrMean. The six
       * attributes cover a winger's game almost completely and a goalkeeper's
       * barely at all, so a raw badge-minus-mean number was always going to
       * put every keeper in the world in the red and tell us nothing. This is
       * a residual: zero is exactly typical, and anything in double figures
       * is a player whose stat pool genuinely does not match his badge. */
      const gap = mean - Math.round(MG.players.expectedAttrMean(p.pos, p.overall));
      const gcls = Math.abs(gap) >= 10 ? "bad" : Math.abs(gap) >= 6 ? "gold" : "accent";
      return `<div class="crow" data-player="${p.id}" style="cursor:pointer">
        <div class="muted" style="width:22px;font-size:11px;text-align:right">${i + 1}</div>
        <div class="prating ${pc}" style="width:36px;height:36px;font-size:14px">${Math.round(p.overall)}</div>
        <div class="crow-body"><div class="nm">${esc(p.name)} <span class="ppos ${pc}">${p.pos}</span></div>
          <div class="muted" style="font-size:12px">${p.age}y · ${esc(c ? c.name : "Free agent")} · pot ${Math.round(p.potential)}</div></div>
        <div style="text-align:right;font-size:11px;line-height:1.3">
          <div class="muted">attr ${mean}</div>
          <div class="${gcls}" style="font-weight:700">${gap >= 0 ? "+" : ""}${gap}</div>
        </div>
      </div>`;
    }).join("");
    return `<div class="panel">
      <h3 class="muted">TOP RATED PLAYERS</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">The best in the world, by position. <b>attr</b> is the mean of his six
      attributes; the number beside it is how far that sits from what his POSITION normally reads at his rating. Zero is typical — a keeper's
      six stats always average well below his badge and a winger's almost match it. Double figures means his stat pool does not match his badge.</div>
      ${nav}
      ${rows || `<div class="muted" style="font-size:12px">Nobody at that position.</div>`}
    </div>`;
  }

  /** Every player in the world whose name matches the current query, best
   *  first. Kept short (25) — this is a way IN to a career, not a database
   *  dump. */
  function searchResultsHtml() {
    const q = (state.playerSearch || "").trim().toLowerCase();
    if (q.length < 2) return `<div class="muted" style="font-size:12px">Type at least two letters.</div>`;
    const world = state.world;
    const hits = [];
    for (const c of world.clubs) {
      for (const p of c.squad) {
        if (p.name.toLowerCase().includes(q)) hits.push(p);
        if (hits.length >= 200) break;   // enough to sort from without walking the whole world
      }
      if (hits.length >= 200) break;
    }
    hits.sort((a, b) => b.overall - a.overall);
    const shown = hits.slice(0, 25);
    if (!shown.length) return `<div class="muted" style="font-size:12px">No one matches "${esc(state.playerSearch)}".</div>`;
    return shown.map((p) => {
      const c = world.clubById(p.clubId);
      const pc = posClass(p.pos);
      return `<div class="crow" data-player="${p.id}" style="cursor:pointer">
        <div class="prating ${pc}" style="width:36px;height:36px;font-size:14px">${Math.round(p.overall)}</div>
        <div class="crow-body"><div class="nm">${esc(p.name)} <span class="ppos ${pc}">${p.pos}</span></div>
          <div class="muted" style="font-size:12px">${p.age}y · ${esc(c ? c.name : "Free agent")}</div></div>
      </div>`;
    }).join("") + (hits.length > shown.length ? `<div class="muted" style="font-size:11px;margin-top:4px">+${hits.length - shown.length} more — narrow the search.</div>` : "");
  }

  /** A league table modal reachable from the World tab. */
  function openLeague(leagueId) {
    const world = state.world;
    const last = world.history[world.history.length - 1];
    const res = last && last.leagues[leagueId];
    const league = MG.clubs.LEAGUES[leagueId];
    if (!res) {
      // Foreign leagues that were not the player's are still browsable via strength.
      const clubs = world.clubsInLeague(leagueId).slice().sort((a, b) => MG.clubs.clubStrength(b) - MG.clubs.clubStrength(a));
      modal(`<h3 class="muted">${esc(league.name)}</h3>
        <table><thead><tr><th>#</th><th>Club</th><th>Squad</th><th>Manager</th></tr></thead><tbody>
        ${clubs.map((cl, i) => { const m = world.managerById(cl.managerId); return `<tr data-club="${cl.id}" style="cursor:pointer"><td>${i + 1}</td><td>${esc(cl.name)}</td><td>${Math.round(MG.clubs.clubStrength(cl))}</td><td class="muted">${esc(m ? m.name : "—")}</td></tr>`; }).join("")}
        </tbody></table>`);
    } else {
      modal(`<h3 class="muted">${esc(res.leagueName)}</h3>
        <table><thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Pts</th><th>Manager</th></tr></thead><tbody>
        ${res.table.map((r) => { const cl = world.clubById(r.clubId), m = world.managerById(cl.managerId); return `<tr data-club="${cl.id}" class="${cl.id === state.clubId ? "you" : ""}" style="cursor:pointer"><td>${r.position}</td><td>${esc(r.name)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td><b>${r.pts}</b></td><td class="muted">${esc(m ? m.name : "—")}</td></tr>`; }).join("")}
        </tbody></table>`);
    }
    for (const row of document.querySelectorAll("[data-club]")) {
      row.addEventListener("click", () => openClub(Number(row.dataset.club)));
    }
  }

  /** A rival club's squad and manager — the scouting view. */
  function openClub(clubId) {
    const world = state.world;
    const c = world.clubById(clubId);
    if (!c) return;
    const m = world.managerById(c.managerId);
    const squad = c.squad.slice().sort(SORTS.rating);
    const mine = club();
    // Every rating here is the true one, your own club or a rival's alike —
    // this is not the kind of game that makes you guess at a number the
    // engine already knows. MG.scouting still colours the NARRATIVE (how
    // confident your department is, what a rival looks like it's trying to
    // do), never the numbers themselves.
    const rival = c.id !== mine.id && MG.scouting;
    const rep = rival ? MG.scouting.clubReport(world, mine, c) : null;
    const statBox = (key, label) =>
      `<div class="stat-box"><div class="sb-num">${Math.round(c.ratings[key])}</div><div class="sb-lab">${label}</div></div>`;
    modal(`
      <h3 class="muted">${esc(c.name)} · ${esc(MG.clubs.LEAGUES[c.leagueId].name)}</h3>
      ${rep ? `<div class="muted" style="font-size:12px;margin-bottom:8px">
        Scouting report — <b>${esc(rep.label.label)}</b>. ${esc(rep.label.blurb)}
      </div>` : ""}
      <div class="stat-grid" style="margin-bottom:10px">
        ${statBox("attack", "Attack")}${statBox("midfield", "Midfield")}${statBox("defence", "Defence")}
        <div class="stat-box"><div class="sb-num">${c.reputation}</div><div class="sb-lab">Reputation</div></div>
      </div>
      <div class="muted" style="font-size:13px;margin-bottom:4px">Manager: <b>${esc(m ? m.name : "—")}</b>${m ? ` · ${esc(m.archetypeName)} · ${esc(m.tactic)} · ${esc(c.formation)}` : ""}</div>
      <div class="muted" style="font-size:13px;margin-bottom:8px">Boardroom: <b>${esc(c.board.style)}</b> · ${esc(ownerLabel(c))}</div>
      ${(() => {
        const p = MG.tactics.predictability(c, m);
        const l = MG.tactics.predictabilityLabel(p);
        return `<div class="muted" style="font-size:13px;margin-bottom:8px">System: <b>${esc(c.formation)}</b> · <b class="${p >= 0.8 ? "accent" : p >= 0.5 ? "gold" : "bad"}">${esc(l.label)}</b> after ${c.systemSeasons || 1} season${(c.systemSeasons || 1) === 1 ? "" : "s"} — a side that has played the same way for years is a side you can prepare for.</div>`;
      })()}
      ${rivalIntentHtml(world, mine, c, rep)}
      <div class="chooser-list">${squad.slice(0, 24).map((p) => pcard(p, { level: c.level })).join("")}</div>`);
    for (const el of document.querySelectorAll("[data-player]")) {
      el.addEventListener("click", (e) => { e.stopPropagation(); openPlayer(Number(el.dataset.player)); });
    }
  }

  /* What a rival is actually trying to do this summer — the posture its AI took
   * in cycle 1 (ai.js), read back as a sentence. This is the payoff for having
   * a scouting department at all: a well-resourced one tells you a rival is
   * rebuilding and which positions it is chasing, which is exactly the sort of
   * thing that decides whether you go for the same player. A poor department
   * only gets the gist, and your own club is not scouted — you already know. */
  function rivalIntentHtml(world, mine, target, rep) {
    if (!rep || !MG.ai) return "";                     // own club, or no plan layer
    const plan = target.plan;
    if (!plan) return "";
    const strength = MG.scouting.strength(world, mine).score;
    const posture = MG.ai.POSTURES[plan.posture];
    if (!posture) return "";
    // Below a real department, you get the mood and not the detail.
    if (strength < 45) {
      return `<div class="board-note" style="margin-bottom:8px"><b class="gold">Summer intent</b> —
        your scouts think they are <b>${esc(posture.label.toLowerCase())}</b>, but cannot tell you much more than that.</div>`;
    }
    const chasing = plan.priorities.length
      ? plan.priorities.map((p) => `<span class="ppos ${posClass(p)}">${esc(p)}</span>`).join(" ")
      : `<span class="muted">nothing obvious</span>`;
    /* The positions their window actually failed to fill (ai.js records them
     * on the plan as `unmet`). This is the single most useful thing a good
     * scouting department can tell you about a rival — not what they wanted,
     * but where they came up short and will still be weak in October. */
    const unmet = (plan.unmet || []).filter((p) => !plan.signed.some((s) => s.pos === p));
    /* A club that finished within a few places of you plans its summer AGAINST
     * you specifically — see ai.js's rivalry term. Worth a line of its own,
     * because it changes what they will bid for and how hard. */
    const rivalry = plan.rivalGap != null
      ? `<div style="margin-top:4px"><b class="bad">They have you in their sights</b> <span class="muted">— they finished ${plan.rivalGap === 0 ? "level with you" : `${plan.rivalGap} place${plan.rivalGap === 1 ? "" : "s"} from you`}, and this window is aimed at closing the gap.</span></div>`
      : "";
    return `<div class="board-note" style="margin-bottom:8px">
      <b class="accent">Summer intent</b> — <b>${esc(posture.label)}</b>. ${esc(posture.blurb)}
      ${rivalry}
      <div style="margin-top:4px">Chasing: ${chasing}${plan.signed.length ? ` · <span class="muted">${plan.signed.length} signed so far</span>` : ""}</div>
      ${unmet.length ? `<div style="margin-top:4px"><span class="bad">Came up short at</span> ${unmet.map((p) => `<span class="ppos ${posClass(p)}">${esc(p)}</span>`).join(" ")} <span class="muted">— still a hole they have to play through.</span></div>` : ""}
    </div>`;
  }

  function wireTab() {
    const c = club();
    for (const b of document.querySelectorAll("[data-formation]")) {
      b.addEventListener("click", () => { MG.tactics.setFormation(c, b.dataset.formation); render(); });
    }
    for (const b of document.querySelectorAll("[data-focus]")) {
      b.addEventListener("click", () => { c.focus = b.dataset.focus; render(); });
    }
    for (const b of document.querySelectorAll("[data-trainfocus]")) {
      b.addEventListener("click", () => { MG.tactics.setTrainingFocus(c, b.dataset.trainfocus); render(); });
    }
    for (const b of document.querySelectorAll("[data-slot]")) {
      b.addEventListener("click", () => openSlotChooser(Number(b.dataset.slot)));
    }
    for (const b of document.querySelectorAll("[data-squadsort]")) {
      b.addEventListener("click", () => { state.squadSort = b.dataset.squadsort; refreshLists(); });
    }
    for (const b of document.querySelectorAll("[data-yfocus]")) {
      b.addEventListener("click", () => { MG.youth.ensure(c).focus = b.dataset.yfocus; refreshLists(); });
    }
    for (const b of document.querySelectorAll("[data-promote]")) {
      b.addEventListener("click", () => {
        const p = MG.youth.promote(c, Number(b.dataset.promote), state.world.season);
        if (p) state.world.report(`ACADEMY — ${p.name} (${p.pos}, ${p.age}) is promoted to the first team.`, "youth", c.id);
        render();
      });
    }
    for (const b of document.querySelectorAll("[data-release]")) {
      b.addEventListener("click", () => {
        const p = MG.youth.release(c, Number(b.dataset.release));
        if (p) state.world.report(`ACADEMY — ${p.name} is released by the club.`, "youth", c.id);
        refreshLists();
      });
    }
    for (const b of document.querySelectorAll("[data-league]")) {
      b.addEventListener("click", () => openLeague(b.dataset.league));
    }
    /* Scoped to the tab body on purpose: wireStage already binds every
     * "#stage [data-player]", so a document-wide selector here bound the
     * hub's player cards a second time and openPlayer fired twice per tap. */
    for (const el of document.querySelectorAll("#tab-body [data-player]")) {
      el.addEventListener("click", (e) => { e.stopPropagation(); openPlayer(Number(el.dataset.player)); });
    }
    const auto = $("auto-pick");
    if (auto) auto.addEventListener("click", () => { MG.tactics.setXI(c, null); render(); });
    // The search box updates its own results div only — a full renderTab()
    // on every keystroke would tear down and rebuild the input itself,
    // dropping focus and the cursor position after every single letter.
    for (const b of document.querySelectorAll("[data-toppos]")) {
      b.addEventListener("click", () => { state.topPos = b.dataset.toppos; renderTab(); });
    }
    const search = $("player-search");
    if (search) {
      search.addEventListener("input", () => {
        state.playerSearch = search.value;
        const results = $("search-results");
        if (!results) return;
        results.innerHTML = searchResultsHtml();
        for (const el of results.querySelectorAll("[data-player]")) {
          el.addEventListener("click", (e) => { e.stopPropagation(); openPlayer(Number(el.dataset.player)); });
        }
      });
    }
  }

  /** Toggle a player on the transfer list (sell directive). */
  function toggleList(c, id) {
    const target = c.squad.find((x) => x.id === id);
    if (target && target.loan) return;               // borrowed, not ours to sell
    c.transferList = c.transferList || [];
    const i = c.transferList.indexOf(id);
    if (i >= 0) c.transferList.splice(i, 1); else c.transferList.push(id);
    const p = c.squad.find((x) => x.id === id);
    if (p) p.transferListed = c.transferList.includes(id);
    // A listed player is not one you also want to develop.
    if (c.mentoring) c.mentoring = c.mentoring.filter((x) => x !== id);
  }

  /** Toggle a player as a mentee, respecting the manager's capacity. */
  function toggleMentor(c, id) {
    c.mentoring = c.mentoring || [];
    const i = c.mentoring.indexOf(id);
    if (i >= 0) { c.mentoring.splice(i, 1); return; }
    if (c.mentoring.length >= MG.managers.mentorCapacity(state.manager)) return;
    c.mentoring.push(id);
    // Mentoring someone you were about to sell makes no sense either.
    if (c.transferList) {
      c.transferList = c.transferList.filter((x) => x !== id);
      const p = c.squad.find((x) => x.id === id);
      if (p) p.transferListed = false;
    }
  }

  /** Ask the board to extend or release. A second call with the same action
   *  clears it — one tap on, one off. Shared by the squad card and the
   *  player-profile modal so the two controls always agree. */
  function toggleContractReq(c, id, action) {
    c.contractRequests = c.contractRequests || {};
    if (c.contractRequests[id] === action) delete c.contractRequests[id];
    else c.contractRequests[id] = action;
  }

  /* ------------------------------- MODALS --------------------------------- */
  function closeModal() { $("modal-root").innerHTML = ""; }

  function modal(inner) {
    $("modal-root").innerHTML = `<div class="modal">
      <div class="modal-backdrop" data-close="1"></div>
      <div class="modal-panel"><button class="modal-close" data-close="1">×</button>${inner}</div></div>`;
    for (const el of document.querySelectorAll("[data-close]")) el.addEventListener("click", closeModal);
  }

  /** Swap the player in a given XI slot. Sortable by rating (for this role),
   *  position or name — the QOL the screenshot asked for. */
  function openSlotChooser(slotIndex) {
    const c = club();
    const formation = MG.tactics.FORMATIONS[c.formation];
    const slot = formation.slots[slotIndex];
    const currentIds = MG.tactics.effectiveXI(c).map((p) => p && p.id);

    // Rating in the chooser means rating IN THIS SLOT — a winger at left-back
    // sorts by what he is worth there, not by his headline number.
    const chooserSorts = {
      rating: (a, b) => MG.tactics.effectiveOverall(b, slot) - MG.tactics.effectiveOverall(a, slot),
      pos: SORTS.pos, name: SORTS.name,
    };
    const options = c.squad.slice().sort(chooserSorts[state.chooserSort] || chooserSorts.rating);

    modal(`<h3 class="muted">WHO PLAYS AT <span class="ppos ${posClass(slot)}">${esc(slot)}</span>?</h3>
      <div class="sortbar"><span class="muted">Sort</span>
        ${["rating", "pos", "name"].map((k) => `<button class="btn tiny ${state.chooserSort === k ? "on-mentor" : ""}" data-csort="${k}">${k === "pos" ? "POSITION" : k.toUpperCase()}</button>`).join("")}
      </div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">The big number is the player's <b>rating</b> — fixed, the same everywhere in the game. <b>IN ROLE</b> is what he is worth <i>specifically in this shirt</i>, and it can land above or below that number: a natural fit, good form, high morale and full fitness push it up, an unfamiliar position or a knock pulls it down. This is about the <b>player</b>, not the manager or the formation — tactics and the manager's own influence affect the <b>team's</b> rating on the pitch, never an individual's number here.</div>
      <div class="chooser-list">${options.map((p) => {
        const fam = MG.tactics.familiarity(p.pos, slot);
        const inXI = currentIds.indexOf(p.id);
        const pc = posClass(p.pos);
        const famCls = fam >= 0.9 ? "accent" : fam >= 0.7 ? "gold" : "bad";
        // The coloured number is ALWAYS the player's own rating, exactly as it
        // reads everywhere else in the game. What changes with the shirt is the
        // in-role figure beside it, shown with the swing that produced it —
        // showing the adjusted number in the big slot made two different values
        // both look like "his rating".
        const eff = Math.round(MG.tactics.effectiveOverall(p, slot));
        const delta = eff - Math.round(p.overall);
        const effCls = delta >= 0 ? "accent" : delta <= -6 ? "bad" : "gold";
        return `<button class="pcard" data-pick="${p.id}" style="cursor:pointer">
          <div class="prating ${pc}">${Math.round(p.overall)}</div>
          <div class="pbody">
            <div class="pname">${esc(p.name)}${inXI >= 0 && inXI !== slotIndex ? ` <span class="muted" style="font-weight:400;font-size:11px">(now ${esc(formation.slots[inXI])})</span>` : ""}</div>
            <div class="pmeta"><span class="ppos ${pc}">${esc(p.pos)}</span>${p.age}y · <span class="${famCls}">${Math.round(fam * 100)}% suited</span>${p.season.injured > 0 ? ` · <span class="inj">injured</span>` : ""}</div>
          </div>
          <div class="pactions" style="text-align:right">
            <span class="${effCls}" style="font-weight:800;font-size:15px">${eff}</span>
            <span class="muted" style="font-size:10px;display:block">IN ROLE ${delta >= 0 ? "+" : ""}${delta}</span>
          </div>
        </button>`;
      }).join("")}</div>`);

    for (const b of document.querySelectorAll("[data-csort]")) {
      b.addEventListener("click", () => { state.chooserSort = b.dataset.csort; openSlotChooser(slotIndex); });
    }
    for (const b of document.querySelectorAll("[data-pick]")) {
      b.addEventListener("click", () => {
        const id = Number(b.dataset.pick);
        const ids = currentIds.slice();
        const existing = ids.indexOf(id);
        // Picking someone already in the side swaps the two shirts.
        if (existing >= 0) { ids[existing] = ids[slotIndex]; }
        ids[slotIndex] = id;
        MG.tactics.setXI(c, ids);
        closeModal();
        render();
      });
    }
  }

  /** "2026/27" from a calendar start year — the label the club and career
   *  screens already use for a completed season. */
  function seasonLabel(year) {
    if (year == null) return "—";
    return `${year}/${String(year + 1).slice(2)}`;
  }

  /** Season-by-season Apps/Goals/Rating, and the trajectory line underneath
   *  it — the record a career screen is actually FOR, not just "how did he
   *  do last year". Built off career.seasonLog (narrative.js's rateSquad),
   *  most recent season first in the table, oldest-to-newest left-to-right
   *  in the chart below it. */
  function careerStatsHtml(player) {
    const log = (player.career && player.career.seasonLog) || [];
    if (!log.length) return `<div class="panel muted" style="font-size:12px">No completed season on record yet.</div>`;
    const rows = log.slice().reverse();
    const table = `<table style="width:100%">
      <thead><tr><th>Season</th><th>Club</th><th>Apps</th><th>Goals</th><th>Rating</th></tr></thead>
      <tbody>${rows.map((s) => `<tr>
        <td>${esc(seasonLabel(s.year))}</td>
        <td class="muted">${esc(s.club || "—")}</td>
        <td>${s.apps}</td>
        <td>${s.goals}</td>
        <td><b class="${s.rating >= 7 ? "accent" : s.rating >= 6 ? "gold" : s.rating ? "bad" : ""}">${s.rating != null ? s.rating.toFixed(1) : "—"}</b></td>
      </tr>`).join("")}</tbody>
    </table>`;
    return `<div class="panel"><h3 class="muted">CAREER, SEASON BY SEASON</h3>${table}${trajectoryChart(log)}</div>`;
  }

  /** A plain inline SVG line chart — no canvas, no library, themes for free
   *  because it is just coloured shapes on the page like everything else
   *  here. Rating (out of 10) across every completed season on record,
   *  oldest to newest, so a career's shape is visible at a glance rather
   *  than read off one row of a table at a time. */
  function trajectoryChart(log) {
    const played = log.filter((s) => s.rating != null);
    if (played.length < 2) return "";
    const W = 300, H = 90, PAD = 10;
    const lo = 4, hi = 10;                              // seasonRating's own range
    const x = (i) => PAD + (i / (played.length - 1)) * (W - PAD * 2);
    const y = (r) => H - PAD - ((clamp(r, lo, hi) - lo) / (hi - lo)) * (H - PAD * 2);
    const pts = played.map((s, i) => `${x(i).toFixed(1)},${y(s.rating).toFixed(1)}`).join(" ");
    const dots = played.map((s, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(s.rating).toFixed(1)}" r="2.6" fill="var(--accent)" />`).join("");
    const first = played[0], last = played[played.length - 1];
    return `<div class="muted" style="font-size:11px;margin-top:10px">Rating by season, ${esc(seasonLabel(first.year))} → ${esc(seasonLabel(last.year))}</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:4px" preserveAspectRatio="none">
        <line x1="${PAD}" y1="${y(6.5).toFixed(1)}" x2="${W - PAD}" y2="${y(6.5).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3,3" stroke-width="1" />
        <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        ${dots}
      </svg>`;
  }

  /** Player mini-profile: attribute bars, traits, mentality, contract. */
  function openPlayer(id) {
    const c = club();
    let player = c.squad.find((p) => p.id === id);
    let from = c.name;
    if (!player) {
      for (const other of state.world.clubs) {
        const p = other.squad.find((x) => x.id === id);
        if (p) { player = p; from = other.name; break; }
      }
    }
    if (!player) return;

    // ratings.js is always in the script order ahead of ui.js — this only
    // ever runs the real axes, never the six-year-stale fallback labels a
    // previous version of this function carried for a module that could
    // never actually be missing.
    const stats = MG.ratings.radarAxes(player);
    const listed = (c.transferList || []).includes(player.id);
    const mentored = (c.mentoring || []).includes(player.id);
    const contractReq = (c.contractRequests || {})[player.id];
    /* agentOf, not agentFor: agentFor is the deterministic "who would
     * represent a player of this standing" read, and it ignores the roster a
     * notable player has actually been signed to. Showing that instead of the
     * real representation made the whole roster system invisible — the agent
     * who genuinely drives his moves, and the cut he takes out of them, is
     * the one worth naming. */
    const rep = MG.agents ? MG.agents.agentOf(state.world, player, "player") : null;
    const agent = rep ? rep.agent : null;
    const mine = player.clubId === c.id;
    const pc = posClass(player.pos);
    const intl = player.intl;

    modal(`
      <button class="btn tiny" id="profile-back" style="margin-bottom:10px">← BACK</button>
      <div class="profile-top">
        <div class="profile-bars">
          <div class="muted" style="font-size:11px;margin-bottom:6px">Read straight off his attributes — not a separate rating.</div>
          ${stats.map((s) => `<div class="attr-bar"><span class="muted">${esc(s.label)}</span>
            <div class="bar"><i style="width:${clamp(s.value, 0, 99)}%"></i></div><b>${Math.round(s.value)}</b></div>`).join("")}
          ${radarHtml(stats)}
        </div>
        <div class="profile-side">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <div class="prating ${pc}" style="width:52px;height:52px;font-size:20px;flex:0 0 52px">${Math.round(player.overall)}</div>
            <div>
              <div style="font-size:17px;font-weight:800;line-height:1.15">${MG.names.flagFor(player.nationality)} ${esc(player.name)}</div>
              <div class="muted" style="font-size:12px"><span class="ppos ${pc}">${esc(player.pos)}</span>${player.age}y · ${esc(from)}</div>
            </div>
          </div>
          <div style="margin-bottom:8px">
            <span class="trait-chip">pot ${Math.round(player.potential)}</span>
            <span class="trait-chip">${esc(player.mentality)}</span>
            ${player.homegrown ? '<span class="trait-chip">Homegrown</span>' : ""}
            ${intl && intl.caps ? `<span class="trait-chip gold">${esc(intl.nation)} · ${intl.caps} caps${intl.goals ? ` · ${intl.goals} gls` : ""}</span>` : ""}
            ${agent ? `<span class="trait-chip${rep.rostered ? " gold" : ""}" title="${esc(agent.blurb)}${rep.rostered ? " — has signed him as a client" : ""}">${esc(agent.name)} · ${esc(agent.tier)} · ${rep.cutPct}%</span>` : ""}
            ${mentored ? '<span class="trait-chip" style="color:var(--accent);border-color:var(--accent)">Mentored</span>' : ""}
            ${listed ? '<span class="trait-chip" style="color:var(--bad);border-color:var(--bad)">Transfer listed</span>' : ""}
            ${player.season.injured > 0 ? `<span class="trait-chip" style="color:var(--bad);border-color:var(--bad)">Out ${Math.round(player.season.injured * 100)}%</span>` : ""}
          </div>
          <div class="stat-grid">
            <div class="stat-box"><div class="sb-num">${moraleDot(player.morale)}</div><div class="sb-lab">Morale</div></div>
            <div class="stat-box"><div class="sb-num gold">${money(player.value)}</div><div class="sb-lab">Value</div></div>
            <div class="stat-box"><div class="sb-num">£${player.contract.wage}k</div><div class="sb-lab">Wage/wk</div></div>
            <div class="stat-box"><div class="sb-num">${player.contract.years}y</div><div class="sb-lab">Contract</div></div>
          </div>
          ${mine ? `<div class="row" style="margin-top:10px;flex-wrap:wrap">
            <button class="btn tiny ${listed ? "danger" : ""}" id="profile-list">${listed ? "REMOVE FROM LIST" : "TRANSFER LIST"}</button>
            <button class="btn tiny ${mentored ? "primary" : ""}" id="profile-mentor">${mentored ? "STOP MENTORING" : "MENTOR"}</button>
            <button class="btn tiny ${contractReq === "extend" ? "primary" : ""}" id="profile-extend">${contractReq === "extend" ? "◤ EXTEND ASKED" : "ASK BOARD TO EXTEND"}</button>
            <button class="btn tiny ${contractReq === "release" ? "danger" : ""}" id="profile-release">${contractReq === "release" ? "◤ RELEASE ASKED" : "ASK BOARD TO RELEASE"}</button>
          </div>` : ""}
        </div>
      </div>

      <div class="muted" style="font-size:12px;margin:14px 0 2px">↓ scroll for raw attributes, durability and his full career</div>
      ${attrGrid(player)}
      ${durabilityHtml(player)}
      ${player.season.apps ? `<div class="muted" style="font-size:12px;margin-top:8px">This season: ${player.season.apps} apps, ${player.season.goals} goals, ${player.season.assists} assists.</div>` : ""}
      <div class="stat-grid" style="margin-top:12px">
        <div class="stat-box"><div class="sb-num">${player.career.goals}</div><div class="sb-lab">Career goals</div></div>
        <div class="stat-box"><div class="sb-num">${player.career.apps}</div><div class="sb-lab">Career apps</div></div>
      </div>
      ${careerStatsHtml(player)}
      ${careerPathHtml(player)}
    `);

    const backBtn = $("profile-back");
    if (backBtn) backBtn.addEventListener("click", closeModal);
    const lb = $("profile-list");
    if (lb) lb.addEventListener("click", () => { toggleList(c, player.id); closeModal(); refreshLists(); });
    const mb = $("profile-mentor");
    if (mb) mb.addEventListener("click", () => { toggleMentor(c, player.id); closeModal(); refreshLists(); });
    const eb = $("profile-extend");
    if (eb) eb.addEventListener("click", () => { toggleContractReq(c, player.id, "extend"); closeModal(); refreshLists(); });
    const rb = $("profile-release");
    if (rb) rb.addEventListener("click", () => { toggleContractReq(c, player.id, "release"); closeModal(); refreshLists(); });
  }

  /* ---------------------------- CAREER ENDINGS ---------------------------- */
  function renderSacked() {
    const last = state.career[state.career.length - 1] || { club: "your club" };
    const m = state.manager;
    $("sacked-body").innerHTML = `
      <div class="panel">
        <div class="result-banner awful">${esc(m.name)} dismissed by ${esc(last.club)} after ${state.career.length} season${state.career.length === 1 ? "" : "s"}.</div>
        ${state.sackReason ? `<div class="log-entry sack">${esc(state.sackReason)}</div>` : ""}
        ${state.endingOutcome ? `<div class="log-entry season">${esc(state.endingOutcome)}</div>` : ""}
        <div class="stat-grid" style="margin-top:12px">
          <div class="stat-box"><div class="sb-num">${m.record.seasons}</div><div class="sb-lab">Seasons</div></div>
          <div class="stat-box"><div class="sb-num">${m.reputation}</div><div class="sb-lab">Reputation</div></div>
          <div class="stat-box"><div class="sb-num gold">${m.honours.titles}</div><div class="sb-lab">Titles</div></div>
          <div class="stat-box"><div class="sb-num">${m.honours.promotions}</div><div class="sb-lab">Promotions</div></div>
        </div>
      </div>
      ${careerTableHtml()}`;
  }

  function careerTableHtml() {
    return `<div class="panel"><h3 class="muted">THE RECORD</h3>
      <table><thead><tr><th>Season</th><th>Club</th><th>League</th><th>Finish</th><th>Brief</th><th>Verdict</th></tr></thead>
      <tbody>${state.career.map((s) => `<tr>
        <td>${s.year}/${String(s.year + 1).slice(2)}</td><td>${esc(s.club)}</td>
        <td class="muted">${esc(s.leagueName)}</td>
        <td>${s.position ? ordinal(s.position) : "—"}</td>
        <td class="muted">${esc(s.brief.summary || "—")}</td>
        <td>${esc(s.verdict || "—")}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderLegacy(endingKey) {
    const l = MG.endings.legacy(state.manager, state.career, endingKey);
    const m = state.manager;
    $("legacy-body").innerHTML = `
      <div class="hero" style="padding:26px 10px">
        <div class="legacy-title">${esc(l.title)}</div>
        <div class="barclays-strip"></div>
        <div style="font-size:20px;font-weight:800">${esc(m.name)}</div>
        <div class="muted">${esc(m.archetypeName)} · ${esc(m.nationality)} · ${esc(l.blurb)}</div>
      </div>
      <div class="panel">
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num">${l.seasons}</div><div class="sb-lab">Seasons</div></div>
          <div class="stat-box"><div class="sb-num gold">${l.titles}</div><div class="sb-lab">Titles</div></div>
          <div class="stat-box"><div class="sb-num">${l.cups}</div><div class="sb-lab">Cups</div></div>
          <div class="stat-box"><div class="sb-num">${l.european}</div><div class="sb-lab">European</div></div>
          <div class="stat-box"><div class="sb-num">${l.promotions}</div><div class="sb-lab">Promotions</div></div>
          <div class="stat-box"><div class="sb-num bad">${l.relegations}</div><div class="sb-lab">Relegations</div></div>
          <div class="stat-box"><div class="sb-num">${l.winRate}%</div><div class="sb-lab">Win rate</div></div>
          <div class="stat-box"><div class="sb-num">${l.reputation}</div><div class="sb-lab">Reputation</div></div>
        </div>
        <div class="muted" style="font-size:13px;margin-top:10px">
          ${l.record.won}W ${l.record.drawn}D ${l.record.lost}L across ${l.record.played} matches ·
          retired at ${l.age} · clubs managed: ${l.clubs.map(esc).join(", ") || "—"}
        </div>
      </div>
      ${careerTableHtml()}`;
  }

  /* --------------------------------- BOOT --------------------------------- */
  function init() {
    $("begin").addEventListener("click", startDraft);
    $("draft-accept").addEventListener("click", draftAccept);
    $("draft-reroll").addEventListener("click", () => { state.draft.reroll(); renderDraft(); });
    $("sacked-continue").addEventListener("click", () => { renderOffers(); show("screen-offers"); });
    $("sacked-restart").addEventListener("click", () => show("screen-welcome"));
    $("legacy-restart").addEventListener("click", () => show("screen-welcome"));
    for (const b of document.querySelectorAll(".tab")) {
      b.addEventListener("click", () => {
        // Tapping the tab that is already open closes the panel — the way
        // back to a short page without hunting for a separate close button.
        if (state.tabOpen && state.tab === b.dataset.tab) state.tabOpen = false;
        else { state.tab = b.dataset.tab; state.tabOpen = true; }
        if (state.tabOpen) renderTab();
        else { $("tab-body").innerHTML = ""; renderTabStrip(); wireTab(); }
      });
    }
    $("notif-bell").addEventListener("click", (e) => {
      e.stopPropagation();
      state.notifOpen = !state.notifOpen;
      renderNotifications();
      // Marked seen a beat after opening, so the panel that just rendered still
      // shows which lines were the new ones before the badge clears them.
      if (state.notifOpen) setTimeout(() => { markNotificationsSeen(); renderNotifications(); }, 1500);
    });
    // Any click outside the panel closes it — the usual dropdown contract.
    document.addEventListener("click", (e) => {
      if (state.notifOpen && !e.target.closest(".notif-wrap")) { state.notifOpen = false; renderNotifications(); }
    });
    $("seed-input").value = `mg-${Math.random().toString(36).slice(2, 8)}`;

    // Which build this is, on the page rather than only in the source — the
    // first thing worth knowing about any report that comes back.
    if (MG.build && $("build-stamp")) {
      $("build-stamp").textContent = `${MG.build.NAME} · v${MG.build.label()}`;
    }

    // A save from a previous visit — offered, never auto-loaded, so
    // "START A CAREER" always still means exactly that.
    if (MG.saves && MG.saves.available()) {
      MG.saves.hasSave().then((yes) => {
        if (!yes) return;
        $("continue-row").style.display = "";
        $("continue-hint").style.display = "";
        $("continue-career").addEventListener("click", () => {
          $("continue-career").disabled = true;
          $("continue-career").textContent = "LOADING…";
          resumeSavedCareer().catch((err) => {
            console.warn("resume failed:", err);
            alert("That save could not be read. Starting a new career instead.");
            $("continue-career").disabled = false;
            $("continue-career").textContent = "CONTINUE CAREER";
          });
        });
      });
    }
  }

  MG.ui = { init, state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof globalThis !== "undefined" ? globalThis : this);
