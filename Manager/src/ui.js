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

  const state = {
    world: null, draft: null, manager: null, clubId: null, seed: null,
    stage: "tactics",   // tactics | preseason | ready | result | endseason | endseason-done | ending
    cards: [], cardIndex: 0, outcomes: [],
    recent: [], career: [], lastRow: null, lastReport: null, lastBrief: null,
    lastCup: null, lastWindow: null, sackReason: null,
    endingEntry: null, endingView: null, endingOutcome: null,
    tab: "squad", pendingSlot: null, marketPos: "",
    squadSort: "rating", chooserSort: "rating",
    signCount: 0, signPositions: [], transfersSeason: null, boardRecs: null,
  };
  root.MG_STATE = state;

  /* The 1000goals position-colour language, reused so a striker reads red and a
   * centre-half reads blue in both games. */
  function posClass(pos) {
    if (pos === "GK") return "keeper";
    if (pos === "FW" || pos === "WG" || pos === "AM") return "attack";
    if (pos === "CB" || pos === "FB") return "defence";
    return "midfield";
  }
  const ATTR_ROWS = [
    { k: "heading", label: "HDR" }, { k: "fitness", label: "FIT" }, { k: "strength", label: "STR" },
    { k: "leftFoot", label: "LF" }, { k: "rightFoot", label: "RF" }, { k: "speed", label: "SPD" },
    { k: "height", label: "HGT", suffix: "cm" }, { k: "weight", label: "WGT", suffix: "kg" },
  ];
  function attrGrid(p) {
    return `<div class="pattrs">${ATTR_ROWS.map((r) =>
      `<div class="pattr"><span>${r.label}</span><b>${p.attrs[r.k]}${r.suffix || ""}</b></div>`).join("")
      }<div class="pattr"><span>MEN</span><b>${esc(p.mentality)}</b></div></div>`;
  }
  const SORTS = {
    rating: (a, b) => b.overall - a.overall,
    name: (a, b) => a.name.localeCompare(b.name),
    pos: (a, b) => MG.players.POSITION_KEYS.indexOf(a.pos) - MG.players.POSITION_KEYS.indexOf(b.pos) || b.overall - a.overall,
  };

  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.classList.remove("active");
    $(id).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const club = () => state.world.clubById(state.clubId);

  /* ================================ DRAFT ================================= */
  function startDraft() {
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
    archetype: "WHAT KIND OF MANAGER ARE YOU?",
    reputation: "WHAT IS YOUR NAME WORTH?",
    nationality: "WHERE ARE YOU FROM?",
  };

  function renderDraft() {
    const d = state.draft, step = d.currentStep();
    $("draft-step-title").textContent = STEP_TITLES[step] || "";
    $("draft-progress").textContent = `ROLL ${MG.draft.DRAFT_STEPS.indexOf(step) + 1} / ${MG.draft.DRAFT_STEPS.length}`;
    $("draft-rerolls").innerHTML = `<span class="accent">${d.rerolls}</span> REROLL${d.rerolls === 1 ? "" : "S"}`;
    $("draft-reroll").disabled = d.rerolls <= 0;

    const reel = $("draft-reel");
    let cls = "reel", html = "";
    if (step === "archetype") {
      const a = MG.managers.ARCHETYPES[d.landed.archetype];
      cls += ` ${a.rarity.toLowerCase()}`;
      html = `
        <div class="reel-rarity">${esc(a.rarity)}</div>
        <div class="reel-headline">${esc(a.name)}</div>
        <div class="reel-sub">in the mould of ${esc(a.basedOn)}</div>
        <p class="reel-blurb">${esc(a.blurb)}</p>
        <div class="reel-grid">
          <div><span>System</span><b>${esc(MG.managers.TACTICS[a.tactic].label)}</b></div>
          <div><span>Traits</span><b>${a.traits.map(esc).join(", ")}</b></div>
          <div><span>Temperament</span><b>${esc(a.personality)}</b></div>
        </div>
        <div class="attr-bars">${attrBars(a.attrs)}</div>`;
    } else if (step === "reputation") {
      const t = d.landed.tier;
      if (t.key === "elite") cls += " legendary"; else if (t.key === "established") cls += " rare";
      html = `<div class="reel-rarity">${esc(t.label)}</div>
        <div class="reel-headline">Reputation ${d.landed.reputation}</div>
        <p class="reel-blurb">${esc(t.blurb)}</p>`;
    } else {
      html = `<div class="reel-headline">${esc(d.landed.nationality)}</div>
        <p class="reel-blurb">Where you learned the game — and where you will always be able to find work.</p>`;
    }
    reel.className = cls;
    reel.innerHTML = html;
  }

  function attrBars(attrs) {
    const labels = { attacking: "Attacking", defending: "Defending", development: "Development",
      manManagement: "Man-management", transferAcumen: "Transfer acumen", adaptability: "Adaptability", discipline: "Discipline" };
    return Object.entries(attrs).map(([k, v]) => `
      <div class="bar-row"><span class="muted">${esc(labels[k] || k)}</span>
        <div class="bar"><i style="width:${clamp(v, 0, 99)}%"></i></div><b>${Math.round(v)}</b></div>`).join("");
  }

  function draftAccept() {
    if (state.draft.accept()) { state.draft.spin(); renderDraft(); return; }
    state.manager = state.draft.build(($("manager-name").value || "").trim() || null);
    show("screen-loading");
    setTimeout(() => {
      state.world = MG.world.createWorld({ seed: state.seed, startYear: 2026 });
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
    MG.clubs.setSeasonTargets(c, world.clubsInLeague(c.leagueId), world.rng);
    state.lastReport = null; state.lastRow = null; state.outcomes = [];
    state.transfersSeason = null; state.signCount = 0; state.signPositions = [];
    // Setting up the team is mandatory before anything else happens.
    state.stage = "tactics";
    state.tab = "tactics";
    render();
    show("screen-career");
  }

  /* ============================ THE SEASON LOOP =========================== */
  function drawCards(pool) {
    const c = club();
    const ctx = MG.decisions.buildContext(state.world, c, state.manager, state.lastRow);
    const picked = MG.decisions.pick(pool, ctx, state.world.rng, 2, state.recent);
    state.cards = picked.map((d) => ({ def: d, view: MG.decisions.present(d, ctx), ctx }));
    state.cardIndex = 0;
    state.outcomes = [];
    for (const p of picked) state.recent.push(p.id);
    while (state.recent.length > 6) state.recent.shift();
  }

  /* Pre-season now opens with the board's transfer brief — how many to sign,
   * where, and who is up for sale — before the narrative cards. This is the
   * "everything runs through decisions" principle: the market is a decision,
   * not a separate tab you have to remember to visit. */
  function beginPreSeason() {
    const c = club();
    state.signCount = 0;
    state.signPositions = [];
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
  function confirmTransfers() {
    const world = state.world, c = club();
    for (const pos of state.signPositions) {
      const s = MG.transfers.findAndSign(world, c, { pos, quality: "solid" });
      const name = (MG.players.POSITIONS[pos] || {}).name || pos;
      if (s) world.report(`IN — ${s.player.name} (${s.player.pos}, ${Math.round(s.player.overall)}) signs from ${s.from} for ${money(s.fee)}.`, "transfer", c.id);
      else world.report(`NO DEAL — the board could not land a ${name} within budget and reach.`, "sack", c.id);
    }
    for (const id of (c.transferList || []).slice()) {
      const res = MG.transfers.sellListed(world, c, id);
      if (res.ok) {
        world.report(`OUT — ${res.player.name} joins ${res.to} for ${money(res.fee)}.`, "transfer", c.id);
        c.transferList = c.transferList.filter((x) => x !== id);
      } else if (res.player) {
        world.report(`NO SALE — ${res.player.name}: ${res.reason}. He stays listed.`, "sack", c.id);
      }
    }
    MG.clubs.refreshRatings(c);
    state.stage = "preseason";
    drawCards(MG.decisions.PRESEASON);
    if (!state.cards.length) state.stage = "ready";
    render();
  }

  function chooseOption(i) {
    const card = state.cards[state.cardIndex];
    if (!card) return;
    const choice = card.view.choices[i];
    const outcome = MG.decisions.apply(state.world, club(), state.manager, card.ctx, choice);
    state.outcomes.push({ label: choice.label, outcome });
    state.cardIndex++;
    if (state.cardIndex >= state.cards.length) {
      state.stage = state.stage === "preseason" ? "ready" : "endseason-done";
    }
    render();
  }

  function playSeason() {
    const world = state.world, c = club();
    const brief = JSON.parse(JSON.stringify(c.board.targets || {}));
    const leagueId = c.leagueId;
    $("stage").innerHTML = `<div class="panel simming">SIMULATING ${world.year}/${String(world.year + 1).slice(2)} — every division in the world…</div>`;

    setTimeout(() => {
      const summary = world.advanceSeason();
      const league = summary.leagues[leagueId];
      const row = league ? league.table.find((r) => r.clubId === c.id) : null;
      const report = c.board.report;
      const stillHere = state.manager.clubId === c.id;

      state.lastWindow = summary.managerWindow;
      state.lastCup = report ? report.metrics.cup.actual : null;
      state.lastRow = row ? {
        position: row.position, pts: row.pts, won: row.won, drawn: row.drawn, lost: row.lost,
        gf: row.gf, ga: row.ga, fieldSize: league.fieldSize,
        promoted: summary.moves.some((m) => m.club === c.name && m.type === "promoted"),
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
        const entry = MG.endings.check(world, state.manager, null, { justSacked: true });
        if (entry) { openEnding(entry, "sacked"); return; }
        renderSacked(); show("screen-sacked"); return;
      }
      MG.clubs.setSeasonTargets(c, world.clubsInLeague(c.leagueId), world.rng);
      state.stage = "result";
      render();
    }, 50);
  }

  function toEndSeason() {
    state.stage = "endseason";
    drawCards(MG.decisions.ENDSEASON);
    if (!state.cards.length) { toNextSeason(); return; }
    render();
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
    state.endingOutcome = res.text;
    // Talked his way out of it — carry on into the next pre-season.
    if (state.endingFallback === "sacked") { renderSacked(); show("screen-sacked"); return; }
    beginPreSeason();
  }

  /* ============================== RENDERING =============================== */
  function render() {
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

    $("lastseason").innerHTML = lastSeasonHtml();
    $("stage").innerHTML = stageHtml();
    $("logfeed").innerHTML = logFeedHtml();
    wireStage();
    renderTab();
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
  function stageHtml() {
    if (state.stage === "tactics") return tacticsSetupHtml();
    if (state.stage === "transfers") return transfersWizardHtml();
    if (state.stage === "preseason" || state.stage === "endseason") return cardHtml();
    if (state.stage === "endseason-done") {
      return outcomesHtml() + windowReportHtml()
        + `<button class="btn primary big" id="to-preseason" style="margin-top:12px">PRE-SEASON ▶</button>`;
    }
    if (state.stage === "ready") return readyHtml();
    if (state.stage === "ending") return endingHtml();
    return resultHtml();
  }

  const outcomesHtml = () => state.outcomes.map((o) => `<div class="outcome">${esc(o.outcome)}</div>`).join("");

  function tacticsSetupHtml() {
    const c = club();
    const report = MG.tactics.xiReport(c);
    return `
      <div class="decision boardroom">
        <div class="decision-tag">TEAM SET-UP</div>
        <div class="decision-text">Before anything else: how does ${esc(c.name)} line up, and what is this season for?</div>
        <p class="muted" style="font-size:13px">Set your formation, your starting eleven and the season's focus in the
        <b>TACTICS</b> tab below. It stays as you leave it until you change it again.</p>
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num">${esc(c.formation)}</div><div class="sb-lab">Formation</div></div>
          <div class="stat-box"><div class="sb-num ${report.problems ? "bad" : ""}">${report.averageFamiliarity}%</div><div class="sb-lab">In position</div></div>
          <div class="stat-box"><div class="sb-num ${c.focus ? "" : "bad"}" style="font-size:15px">${c.focus ? esc(MG.clubs.FOCUS[c.focus].label) : "NOT SET"}</div><div class="sb-lab">Focus</div></div>
        </div>
        ${report.problems ? `<div class="outcome" style="border-left-color:var(--gold)">${report.problems} player${report.problems === 1 ? " is" : "s are"} out of position. That costs you.</div>` : ""}
        <div class="decision-choices" style="margin-top:12px">
          <button class="btn primary" id="confirm-tactics">CONFIRM TEAM AND CONTINUE</button>
        </div>
      </div>`;
  }

  /* The pre-season transfer wizard: count -> positions -> who is for sale.
   * Deliberately three short questions rather than a spreadsheet — the board
   * does the actual dealing, you just point it. */
  function transfersWizardHtml() {
    const c = club();
    const wageRoom = c.finances.wageBudget - MG.clubs.wageBill(c);
    const reach = MG.network ? MG.network.reachLabel(c) : null;
    const listed = c.transferList || [];
    const maxPos = state.signCount >= 3 ? 4 : state.signCount;
    const saleList = c.squad.slice().sort(SORTS.rating);
    return `
      <div class="decision boardroom">
        <div class="decision-tag">PRE-SEASON · THE WINDOW</div>
        <div class="decision-text">The board are ready to back you in the market. Tell them how many to sign and where — they do the deals and report back in the log.</div>
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
        </div>` : ""}

        <div class="wizard-block">
          <h4>Up for sale <span class="muted">(${listed.length} listed)</span></h4>
          <div class="muted" style="font-size:12px;margin-bottom:8px">The board's suggestions are tagged <span class="accent2" style="color:var(--accent2)">◆ board</span> — only players you actually <span class="bad">LIST</span> are sold. The board sells whoever it finds a buyer for and reports the rest.</div>
          <div class="table-scroll" style="max-height:240px">${saleList.map((p) => {
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

  function cardHtml() {
    const card = state.cards[state.cardIndex];
    const done = outcomesHtml();
    if (!card) return done;
    const isBoard = card.view.category === "BOARDROOM";
    const label = state.stage === "preseason" ? "PRE-SEASON" : "END OF SEASON";
    return `${done}
      <div class="stage-step">${label} · decision ${state.cardIndex + 1} of ${state.cards.length}</div>
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
      <button class="btn primary big" id="play-season">▶ PLAY SEASON</button>`;
  }

  function windowReportHtml() {
    const w = state.lastWindow;
    if (!w || (!w.sold.length && !w.bought.length && !w.refused.length)) return "";
    const line = (t) => `<div class="log-entry transfer">${esc(t)}</div>`;
    return `<div class="panel"><h3 class="muted">THE BOARD'S TRANSFER REPORT</h3>
      ${w.bought.map((b) => line(`IN — ${b.player.name} (${b.player.pos}, ${Math.round(b.player.overall)}) from ${b.from} for ${money(b.fee)}.`)).join("")}
      ${w.sold.map((b) => line(`OUT — ${b.player.name} to ${b.to} for ${money(b.fee)}.`)).join("")}
      ${w.refused.map((b) => `<div class="log-entry sack">NO DEAL — ${esc(b.player.name)}: ${esc(b.reason)}.</div>`).join("")}
    </div>`;
  }

  function resultHtml() {
    const row = state.lastRow, r = state.lastReport, c = club();
    if (!row) return `<div class="panel">The season was played, but your club was not in a simulated division.</div>
      <button class="btn primary big" id="to-endseason">CONTINUE</button>`;
    const tone = row.champion || row.promoted ? "great" : row.relegated ? "awful"
      : r && r.total >= 0.15 ? "good" : r && r.total <= -0.3 ? "bad" : "ok";
    const headline = row.champion ? `🏆 CHAMPIONS. ${c.name} win the ${row.leagueName}.`
      : row.promoted ? `📈 PROMOTED. ${c.name} go up.`
        : row.relegated ? `📉 RELEGATED. ${c.name} go down.`
          : `${c.name} finish ${ordinal(row.position)} in the ${row.leagueName}.`;

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

    const scorer = c.squad.slice().sort((a, b) => b.season.goals - a.season.goals)[0];
    return `
      <div class="panel">
        <div class="result-banner ${tone}">${esc(headline)}</div>
        <div class="muted" style="font-size:13px">Cup run: <b>${esc(cupLabel(row.cupRound))}</b>${scorer && scorer.season.goals ? ` · Top scorer: <b class="accent">${esc(scorer.name)}</b> with ${scorer.season.goals}` : ""}</div>
      </div>
      ${r ? `<div class="panel">
        <div class="stage-step">The boardroom · ${esc(c.board.style)}${c.focus ? ` · focus: ${esc(MG.clubs.FOCUS[c.focus].label)}` : ""}</div>
        <div class="muted" style="font-size:13px;margin-bottom:8px">The brief was: ${esc(state.lastBrief.summary || "—")}</div>
        ${metrics}
        <div class="result-banner ${r.total >= 0.15 ? "great" : r.total <= -0.3 ? "awful" : "ok"}" style="margin-top:12px">
          ${esc(r.verdict)} — confidence ${r.swing >= 0 ? "+" : ""}${r.swing}, now ${Math.round(r.confidence)}/100
        </div>
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
    bind("confirm-tactics", () => {
      const c = club();
      if (!c.focus) c.focus = "league";
      beginPreSeason();
    });
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
    for (const b of document.querySelectorAll("[data-wlist]")) b.addEventListener("click", () => { toggleList(club(), Number(b.dataset.wlist)); render(); });
    bind("confirm-transfers", confirmTransfers);
  }

  /* ------------------------ TIER 3: CLUB AND WORLD ------------------------ */
  function renderTab() {
    for (const b of document.querySelectorAll(".tab")) b.classList.toggle("on", b.dataset.tab === state.tab);
    const el = $("tab-body");
    const views = { squad: squadHtml, tactics: tacticsHtml, contracts: contractsHtml, table: tableHtml, career: careerHtml, world: worldHtml };
    el.innerHTML = (views[state.tab] || squadHtml)();
    wireTab();
  }

  function squadHtml() {
    const c = club();
    const m = state.manager;
    const squad = c.squad.slice().sort(SORTS[state.squadSort] || SORTS.rating);
    const xi = new Set(MG.tactics.effectiveXI(c).map((p) => p && p.id));
    const listed = c.transferList || [], mentoring = c.mentoring || [];
    const mentorCap = MG.managers.mentorCapacity(m);

    return `<div class="panel">
      <h3 class="muted">SQUAD (${squad.length}) · wage bill ${money(MG.clubs.wageBill(c))} / ${money(c.finances.wageBudget)}</h3>
      <div class="sortbar">
        <span class="muted">Sort</span>
        ${["rating", "pos", "name"].map((k) => `<button class="btn tiny ${state.squadSort === k ? "on-mentor" : ""}" data-squadsort="${k}">${k === "pos" ? "POSITION" : k.toUpperCase()}</button>`).join("")}
        <span class="muted" style="margin-left:auto">Mentoring ${mentoring.length}/${mentorCap} · <span class="accent">green</span> mentored · <span class="bad">red</span> listed</span>
      </div>
      ${squad.map((p) => pcard(p, {
        inXI: xi.has(p.id), listed: listed.includes(p.id), mentored: mentoring.includes(p.id),
        canMentor: mentoring.length < mentorCap || mentoring.includes(p.id),
      })).join("")}
    </div>`;
  }

  /** One donor-style player card, coloured by position, with mentor + list
   *  actions on the right. Clicking the body opens the full profile. */
  function pcard(p, opt) {
    const o = opt || {};
    const pc = posClass(p.pos);
    const flags = `${o.inXI ? '<span class="ppos midfield" style="background:rgba(0,208,108,.14)">XI</span>' : ""}`;
    return `<div class="pcard ${o.mentored ? "mentored" : o.listed ? "listed" : o.inXI ? "in-xi" : ""}">
      <div class="prating ${pc}" data-player="${p.id}" style="cursor:pointer">${Math.round(p.overall)}</div>
      <div class="pbody" data-player="${p.id}" style="cursor:pointer">
        <div class="pname">${flags}${esc(p.name)}${p.homegrown ? ' <span class="hg">HG</span>' : ""}</div>
        <div class="pmeta"><span class="ppos ${pc}">${esc(p.pos)}</span>${p.age}y · pot ${Math.round(p.potential)} · ${money(p.value)} · £${p.contract.wage}k
          ${p.season.injured > 0 ? ` · <span class="inj">out ${Math.round(p.season.injured * 100)}%</span>` : ""}</div>
      </div>
      ${o.mentored != null ? `<div class="pactions">
        <button class="pbtn ${o.listed ? "on-list" : ""}" data-list="${p.id}">${o.listed ? "◤ LISTED" : "LIST"}</button>
        <button class="pbtn ${o.mentored ? "on-mentor" : ""}" data-mentor="${p.id}" ${!o.canMentor && !o.mentored ? "disabled style=opacity:.4" : ""}>${o.mentored ? "◤ MENTOR" : "MENTOR"}</button>
      </div>` : `<div class="pactions"><span class="muted" style="font-size:11px">${esc(p.pos)}</span></div>`}
    </div>`;
  }

  function moraleDot(m) {
    const v = m == null ? 60 : m;
    const cls = v >= 70 ? "accent" : v >= 45 ? "gold" : "bad";
    return `<span class="${cls}">${Math.round(v)}</span>`;
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
      </div>
      <div class="panel">
        <h3 class="muted">SEASON FOCUS</h3>
        <div class="seg">${MG.clubs.FOCUS_KEYS.map((k) => `
          <button class="${k === c.focus ? "on" : ""}" data-focus="${k}">${esc(MG.clubs.FOCUS[k].label)}</button>`).join("")}</div>
        <div class="muted" style="font-size:12px;margin-top:6px">${c.focus ? esc(MG.clubs.FOCUS[c.focus].blurb) : "Pick what this season is actually for."}</div>
      </div>
      <div class="panel">
        <h3 class="muted">STARTING XI · ${report.averageFamiliarity}% in position${report.problems ? ` · <span class="bad">${report.problems} misplaced</span>` : ""}</h3>
        <div class="pitch"><div class="pitch-rows">
          ${rows.map((line) => line.length ? `<div class="pitch-row">${line.map(({ r, i }) => slotHtml(r, i)).join("")}</div>` : "").join("")}
        </div></div>
        <div class="row" style="margin-top:10px">
          <button class="btn tiny" id="auto-pick">AUTO-PICK BEST XI</button>
          <span class="muted" style="font-size:12px">Click a shirt to change who plays there.</span>
        </div>
      </div>
      <div class="panel muted" style="font-size:12px">Signings and sales are handled in the pre-season <b>window</b> (top of the Decisions panel), and contract renewals in the <b>CONTRACTS</b> tab — the board does the dealing, you just point it.</div>`;
  }

  /* -------------------------- CONTRACTS (tab) -----------------------------
   * The other place the board acts on your preference rather than your command:
   * you ask to extend or release, the board decides what it can afford, and it
   * reports back in the log each summer. Sorted shortest-contract first so the
   * ones that need attention are at the top. */
  function contractsHtml() {
    const c = club();
    const reqs = c.contractRequests || {};
    const squad = c.squad.slice().sort((a, b) => a.contract.years - b.contract.years || b.overall - a.overall);
    return `<div class="panel">
      <h3 class="muted">CONTRACTS · wages ${money(MG.clubs.wageBill(c))} / ${money(c.finances.wageBudget)}</h3>
      <div class="muted" style="font-size:12px;margin-bottom:10px">
        Years remaining, shortest first — the ones near <b>OUT</b> are the ones that need a call.
        <span class="accent">EXTEND</span> asks the board to tie a player down (it backs you unless the wage bill is out of control);
        <span class="bad">RELEASE</span> lets his deal run down and leaves on a free when it expires. The board still decides,
        and reports what it did in the log each summer.
      </div>
      ${squad.map((p) => {
        const req = reqs[p.id], yrs = p.contract.years;
        const yrsCls = yrs <= 0 ? "expiring" : yrs === 1 ? "soon" : "";
        return `<div class="crow ${req === "extend" ? "extend" : req === "release" ? "release" : ""}">
          <div class="crow-yrs ${yrsCls}">${yrs <= 0 ? "OUT" : yrs + "y"}</div>
          <div class="crow-body">
            <div class="nm" data-player="${p.id}" style="cursor:pointer">${esc(p.name)} <span class="ppos ${posClass(p.pos)}">${p.pos}</span> <span class="muted" style="font-weight:400">${Math.round(p.overall)} · ${p.age}y</span></div>
            <div class="muted" style="font-size:12px">£${p.contract.wage}k/wk · ${money(p.value)}</div>
          </div>
          <div class="crow-actions">
            <button class="btn tiny ${req === "extend" ? "primary" : ""}" data-contract="extend:${p.id}">EXTEND</button>
            <button class="btn tiny ${req === "release" ? "danger" : ""}" data-contract="release:${p.id}">RELEASE</button>
          </div>
        </div>`;
      }).join("")}
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

  function tableHtml() {
    const world = state.world, c = club();
    const last = world.history[world.history.length - 1];
    const res = last && last.leagues[c.leagueId];
    if (!res) return `<div class="panel muted">No table yet — play your first season.</div>`;
    return `<div class="panel"><h3 class="muted">${esc(res.leagueName)}</h3>
      <table><thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th><th>Manager</th></tr></thead>
      <tbody>${res.table.map((r) => {
        const cl = world.clubById(r.clubId), mgr = world.managerById(cl.managerId);
        return `<tr class="${r.clubId === c.id ? "you" : ""}"><td>${r.position}</td><td>${esc(r.name)}</td>
          <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gd}</td><td><b>${r.pts}</b></td>
          <td class="muted">${esc(mgr ? mgr.name : "—")}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  function logHtml() {
    const world = state.world;
    const mine = world.newsFor(state.clubId, 40);
    return `<div class="panel"><h3 class="muted">CLUB LOG</h3>
      ${mine.length ? mine.map((n) => `<div class="log-entry ${esc(n.type)}"><span class="muted">${n.year}</span> ${esc(n.text)}</div>`).join("")
        : `<div class="muted">Nothing has happened at this club yet.</div>`}</div>`;
  }

  function worldHtml() {
    const world = state.world;
    const last = world.history[world.history.length - 1];
    if (!last) return `<div class="panel muted">The world has not played a season yet.</div>`;
    const of = (type) => world.news.filter((n) => n.season === last.season && n.type === type && n.clubId !== state.clubId);
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
    return browser + feed;
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
    modal(`
      <h3 class="muted">${esc(c.name)} · ${esc(MG.clubs.LEAGUES[c.leagueId].name)}</h3>
      <div class="stat-grid" style="margin-bottom:10px">
        <div class="stat-box"><div class="sb-num">${Math.round(c.ratings.attack)}</div><div class="sb-lab">Attack</div></div>
        <div class="stat-box"><div class="sb-num">${Math.round(c.ratings.midfield)}</div><div class="sb-lab">Midfield</div></div>
        <div class="stat-box"><div class="sb-num">${Math.round(c.ratings.defence)}</div><div class="sb-lab">Defence</div></div>
        <div class="stat-box"><div class="sb-num">${c.reputation}</div><div class="sb-lab">Reputation</div></div>
      </div>
      <div class="muted" style="font-size:13px;margin-bottom:8px">Manager: <b>${esc(m ? m.name : "—")}</b>${m ? ` · ${esc(m.archetypeName)} · ${esc(m.tactic)} · ${esc(c.formation)}` : ""}</div>
      <div class="chooser-list">${squad.slice(0, 24).map((p) => pcard(p, {})).join("")}</div>`);
    for (const el of document.querySelectorAll("[data-player]")) {
      el.addEventListener("click", (e) => { e.stopPropagation(); openPlayer(Number(el.dataset.player)); });
    }
  }

  function wireTab() {
    const c = club();
    for (const b of document.querySelectorAll("[data-formation]")) {
      b.addEventListener("click", () => { MG.tactics.setFormation(c, b.dataset.formation); render(); });
    }
    for (const b of document.querySelectorAll("[data-focus]")) {
      b.addEventListener("click", () => { c.focus = b.dataset.focus; render(); });
    }
    for (const b of document.querySelectorAll("[data-slot]")) {
      b.addEventListener("click", () => openSlotChooser(Number(b.dataset.slot)));
    }
    for (const b of document.querySelectorAll("[data-squadsort]")) {
      b.addEventListener("click", () => { state.squadSort = b.dataset.squadsort; renderTab(); });
    }
    for (const b of document.querySelectorAll("[data-list]")) {
      b.addEventListener("click", (e) => { e.stopPropagation(); toggleList(c, Number(b.dataset.list)); renderTab(); });
    }
    for (const b of document.querySelectorAll("[data-mentor]")) {
      b.addEventListener("click", (e) => { e.stopPropagation(); toggleMentor(c, Number(b.dataset.mentor)); renderTab(); });
    }
    for (const b of document.querySelectorAll("[data-contract]")) {
      b.addEventListener("click", () => {
        const [action, id] = b.dataset.contract.split(":");
        const pid = Number(id);
        c.contractRequests = c.contractRequests || {};
        // A second click on the same directive clears it — one tap on, one off.
        if (c.contractRequests[pid] === action) delete c.contractRequests[pid];
        else c.contractRequests[pid] = action;
        renderTab();
      });
    }
    for (const b of document.querySelectorAll("[data-league]")) {
      b.addEventListener("click", () => openLeague(b.dataset.league));
    }
    for (const el of document.querySelectorAll("[data-player]")) {
      el.addEventListener("click", (e) => { e.stopPropagation(); openPlayer(Number(el.dataset.player)); });
    }
    const auto = $("auto-pick");
    if (auto) auto.addEventListener("click", () => { MG.tactics.setXI(c, null); render(); });
  }

  /** Toggle a player on the transfer list (sell directive). */
  function toggleList(c, id) {
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
      <div class="chooser-list">${options.map((p) => {
        const fam = MG.tactics.familiarity(p.pos, slot);
        const inXI = currentIds.indexOf(p.id);
        const pc = posClass(p.pos);
        const famCls = fam >= 0.9 ? "accent" : fam >= 0.7 ? "gold" : "bad";
        return `<button class="pcard" data-pick="${p.id}" style="cursor:pointer">
          <div class="prating ${pc}">${Math.round(MG.tactics.effectiveOverall(p, slot))}</div>
          <div class="pbody">
            <div class="pname">${esc(p.name)}${inXI >= 0 && inXI !== slotIndex ? ` <span class="muted" style="font-weight:400;font-size:11px">(now ${esc(formation.slots[inXI])})</span>` : ""}</div>
            <div class="pmeta"><span class="ppos ${pc}">${esc(p.pos)}</span>${p.age}y · <span class="${famCls}">${Math.round(fam * 100)}% suited</span>${p.season.injured > 0 ? ` · <span class="inj">injured</span>` : ""}</div>
          </div>
          <div class="pactions"><span class="muted" style="font-size:11px">${Math.round(p.overall)} ovr</span></div>
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

  /** Player mini-profile: radar, traits, mentality, contract. */
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

    const a = player.attrs;
    const technique = Math.round((a.rightFoot + a.leftFoot) / 2);
    const stats = [
      { label: "Pace", value: a.speed },
      { label: "Physical", value: a.strength },
      { label: "Aerial", value: a.heading },
      { label: "Stamina", value: a.fitness },
      { label: "Technique", value: technique },
      { label: "Mentality", value: player.mentalityRating },
    ];
    const listed = (c.transferList || []).includes(player.id);
    const mentored = (c.mentoring || []).includes(player.id);
    const mine = player.clubId === c.id;
    const pc = posClass(player.pos);
    const intl = player.intl;

    modal(`
      <div class="profile-head">
        <div class="profile-radar">
          <div class="prating ${pc}" style="width:64px;height:64px;font-size:24px;margin:0 auto 8px">${Math.round(player.overall)}</div>
          <canvas id="radar" width="200" height="200"></canvas>
        </div>
        <div class="profile-meta">
          <div style="font-size:20px;font-weight:800">${esc(player.name)}</div>
          <div class="muted"><span class="ppos ${pc}">${esc(player.pos)}</span>${esc(MG.players.POSITIONS[player.pos].name)} · ${player.age} · ${esc(player.nationality)} · ${esc(from)}</div>
          <div style="margin:8px 0">
            <span class="trait-chip">pot ${Math.round(player.potential)}</span>
            <span class="trait-chip">${esc(player.mentality)}</span>
            ${player.homegrown ? '<span class="trait-chip">Homegrown</span>' : ""}
            ${intl && intl.caps ? `<span class="trait-chip gold">${esc(intl.nation)} · ${intl.caps} caps${intl.goals ? ` · ${intl.goals} gls` : ""}</span>` : ""}
            ${mentored ? '<span class="trait-chip" style="color:var(--accent);border-color:var(--accent)">Mentored</span>' : ""}
            ${listed ? '<span class="trait-chip" style="color:var(--bad);border-color:var(--bad)">Transfer listed</span>' : ""}
            ${player.season.injured > 0 ? `<span class="trait-chip" style="color:var(--bad);border-color:var(--bad)">Out ${Math.round(player.season.injured * 100)}%</span>` : ""}
          </div>
          ${stats.map((s) => `<div class="mini-bar"><span class="muted">${esc(s.label)}</span>
            <div class="bar"><i style="width:${clamp(s.value, 0, 99)}%"></i></div><b>${Math.round(s.value)}</b></div>`).join("")}
        </div>
      </div>
      ${attrGrid(player)}
      <div class="stat-grid" style="margin-top:12px">
        <div class="stat-box"><div class="sb-num">${moraleDot(player.morale)}</div><div class="sb-lab">Morale</div></div>
        <div class="stat-box"><div class="sb-num gold">${money(player.value)}</div><div class="sb-lab">Value</div></div>
        <div class="stat-box"><div class="sb-num">£${player.contract.wage}k</div><div class="sb-lab">Wage/wk</div></div>
        <div class="stat-box"><div class="sb-num">${player.contract.years}y</div><div class="sb-lab">Contract</div></div>
        <div class="stat-box"><div class="sb-num">${player.career.goals}</div><div class="sb-lab">Career goals</div></div>
        <div class="stat-box"><div class="sb-num">${player.career.apps}</div><div class="sb-lab">Career apps</div></div>
      </div>
      ${player.season.apps ? `<div class="muted" style="font-size:12px;margin-top:8px">This season: ${player.season.apps} apps, ${player.season.goals} goals, ${player.season.assists} assists.</div>` : ""}
      ${mine ? `<div class="row" style="margin-top:12px">
        <button class="btn tiny ${listed ? "danger" : ""}" id="profile-list">${listed ? "REMOVE FROM LIST" : "TRANSFER LIST"}</button>
        <button class="btn tiny ${mentored ? "primary" : ""}" id="profile-mentor">${mentored ? "STOP MENTORING" : "MENTOR"}</button>
      </div>` : ""}
    `);

    drawRadar($("radar"), stats);
    const lb = $("profile-list");
    if (lb) lb.addEventListener("click", () => { toggleList(c, player.id); closeModal(); renderTab(); });
    const mb = $("profile-mentor");
    if (mb) mb.addEventListener("click", () => { toggleMentor(c, player.id); closeModal(); renderTab(); });
  }

  /** Six-axis radar, drawn the same way 1000goals draws its card radar. */
  function drawRadar(canvas, stats) {
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const cx = canvas.width / 2, cy = canvas.height / 2, radius = 72;
    const n = stats.length;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Web
    ctx.strokeStyle = "#1e4d35";
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
        const r = (radius * ring) / 4;
        const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Shape
    ctx.beginPath();
    stats.forEach((s, i) => {
      const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = radius * clamp(s.value, 0, 99) / 99;
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(0,208,108,.28)";
    ctx.strokeStyle = "#00d06c";
    ctx.lineWidth = 2;
    ctx.fill(); ctx.stroke();
    // Labels
    ctx.fillStyle = "#7b9b8b";
    ctx.font = "9px system-ui, sans-serif";
    ctx.textAlign = "center";
    stats.forEach((s, i) => {
      const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
      ctx.fillText(s.label, cx + Math.cos(ang) * (radius + 14), cy + Math.sin(ang) * (radius + 14) + 3);
    });
  }

  /* ---------------------------- CAREER ENDINGS ---------------------------- */
  function renderSacked() {
    const last = state.career[state.career.length - 1] || { club: "your club" };
    const m = state.manager;
    $("sacked-body").innerHTML = `
      <div class="panel">
        <div class="result-banner awful">${esc(m.name)} dismissed by ${esc(last.club)} after ${state.career.length} season${state.career.length === 1 ? "" : "s"}.</div>
        ${state.sackReason ? `<div class="log-entry sack">${esc(state.sackReason)}</div>` : ""}
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
      b.addEventListener("click", () => { state.tab = b.dataset.tab; renderTab(); });
    }
    $("seed-input").value = `mg-${Math.random().toString(36).slice(2, 8)}`;
  }

  MG.ui = { init, state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof globalThis !== "undefined" ? globalThis : this);
