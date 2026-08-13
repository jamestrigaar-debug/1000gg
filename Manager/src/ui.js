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
  };
  root.MG_STATE = state;

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

  function beginPreSeason() {
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

    $("dashboard").innerHTML = dashboardHtml();
    $("stage").innerHTML = stageHtml();
    wireStage();
    renderTab();
  }

  /* ---------------------------- TIER 1: CAREER ---------------------------- */
  function dashboardHtml() {
    const m = state.manager, row = state.lastRow;
    const played = m.record.played || 1;
    const career = `
      <div class="panel">
        <h3 class="muted">CAREER</h3>
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num">${m.record.seasons}</div><div class="sb-lab">Seasons</div></div>
          <div class="stat-box"><div class="sb-num gold">${m.honours.titles}</div><div class="sb-lab">Titles</div></div>
          <div class="stat-box"><div class="sb-num">${m.honours.cups}</div><div class="sb-lab">Cups</div></div>
          <div class="stat-box"><div class="sb-num">${m.honours.promotions}</div><div class="sb-lab">Promotions</div></div>
          <div class="stat-box"><div class="sb-num">${Math.round((m.record.won / played) * 100)}%</div><div class="sb-lab">Win rate</div></div>
          <div class="stat-box"><div class="sb-num">${m.reputation}</div><div class="sb-lab">Reputation</div></div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px">
          ${m.record.won}W ${m.record.drawn}D ${m.record.lost}L in ${m.record.played} matches · age ${m.age}
        </div>
      </div>`;

    const last = row ? `
      <div class="panel">
        <h3 class="muted">LAST SEASON — ${esc(row.leagueName)}</h3>
        <div class="result-banner ${row.champion || row.promoted ? "great" : row.relegated ? "awful" : "ok"}">
          ${row.champion ? "🏆 Champions" : row.promoted ? "📈 Promoted" : row.relegated ? "📉 Relegated" : `Finished ${ordinal(row.position)}`}
        </div>
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num">${row.pts}</div><div class="sb-lab">Points</div></div>
          <div class="stat-box"><div class="sb-num">${row.won}</div><div class="sb-lab">Won</div></div>
          <div class="stat-box"><div class="sb-num">${row.drawn}</div><div class="sb-lab">Drawn</div></div>
          <div class="stat-box"><div class="sb-num bad">${row.lost}</div><div class="sb-lab">Lost</div></div>
          <div class="stat-box"><div class="sb-num">${row.gf}</div><div class="sb-lab">For</div></div>
          <div class="stat-box"><div class="sb-num">${row.ga}</div><div class="sb-lab">Against</div></div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px">
          Cup: ${esc(cupLabel(row.cupRound))} · Board's verdict: ${esc(state.lastReport ? state.lastReport.verdict : "—")}
        </div>
      </div>` : `
      <div class="panel">
        <h3 class="muted">LAST SEASON</h3>
        <div class="muted">Your first season has not been played yet.</div>
      </div>`;
    return career + last;
  }

  const CUP_LABELS = { none: "did not enter", R1: "first round", R2: "second round", R3: "third round",
    R4: "fourth round", R5: "fifth round", QF: "quarter-final", SF: "semi-final", F: "final", W: "🏆 WON IT" };
  function cupLabel(k) { return CUP_LABELS[k] || "—"; }

  /* --------------------------- TIER 2: DECISIONS -------------------------- */
  function stageHtml() {
    if (state.stage === "tactics") return tacticsSetupHtml();
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
    const pending = (c.transferList || []).length + (c.targets || []).length;
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
          ${report.problems ? `<span class="bad">${report.problems} out of position</span>` : "eleven in position"} ·
          ${pending ? `${pending} transfer instruction${pending === 1 ? "" : "s"} with the board` : "no transfer instructions"}
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
  }

  /* ------------------------ TIER 3: CLUB AND WORLD ------------------------ */
  function renderTab() {
    for (const b of document.querySelectorAll(".tab")) b.classList.toggle("on", b.dataset.tab === state.tab);
    const el = $("tab-body");
    const views = { squad: squadHtml, tactics: tacticsHtml, transfers: transfersHtml, table: tableHtml, log: logHtml, world: worldHtml };
    el.innerHTML = (views[state.tab] || squadHtml)();
    wireTab();
  }

  function squadHtml() {
    const c = club();
    const squad = c.squad.slice().sort((a, b) => b.overall - a.overall);
    const xi = new Set(MG.tactics.effectiveXI(c).map((p) => p && p.id));
    return `<div class="panel"><h3 class="muted">SQUAD (${squad.length}) · wage bill ${money(MG.clubs.wageBill(c))} of ${money(c.finances.wageBudget)} · click a player</h3>
      <table><thead><tr><th></th><th>Name</th><th>Pos</th><th>Age</th><th>Ovr</th><th>Pot</th><th>Morale</th><th>Value</th><th>Wage</th><th>Status</th></tr></thead>
      <tbody>${squad.map((p) => `<tr class="${xi.has(p.id) ? "you" : ""}" data-player="${p.id}" style="cursor:pointer">
        <td>${xi.has(p.id) ? "▶" : ""}</td>
        <td>${esc(p.name)}${p.homegrown ? ' <span class="hg">HG</span>' : ""}${p.transferListed ? ' <span class="listed-tag">LISTED</span>' : ""}</td>
        <td>${esc(p.pos)}</td><td>${p.age}</td>
        <td><b class="accent">${Math.round(p.overall)}</b></td>
        <td class="muted">${Math.round(p.potential)}</td>
        <td>${moraleDot(p.morale)}</td>
        <td>${money(p.value)}</td><td>£${p.contract.wage}k</td>
        <td>${p.season.injured > 0 ? `<span class="inj">out ${Math.round(p.season.injured * 100)}%</span>` : `<span class="muted">fit</span>`}</td>
      </tr>`).join("")}</tbody></table></div>`;
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

  function transfersHtml() {
    const c = club();
    const listed = c.transferList || [], targets = c.targets || [];
    const wageRoom = c.finances.wageBudget - MG.clubs.wageBill(c);
    const pool = MG.transfers.market(state.world, c, { pos: state.marketPos || undefined, limit: 40 });
    const squad = c.squad.slice().sort((a, b) => b.overall - a.overall);

    return `
      <div class="panel">
        <h3 class="muted">THE BOARD WILL FUND</h3>
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num gold">${money(c.finances.transferBudget)}</div><div class="sb-lab">Transfer budget</div></div>
          <div class="stat-box"><div class="sb-num ${wageRoom < 0 ? "bad" : ""}">${money(wageRoom)}</div><div class="sb-lab">Wage room</div></div>
          <div class="stat-box"><div class="sb-num">${listed.length}</div><div class="sb-lab">Listed</div></div>
          <div class="stat-box"><div class="sb-num">${targets.length}</div><div class="sb-lab">Bids lodged</div></div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px">
          Instructions are executed by the board in the summer, and the results appear on the end-of-season screen.
        </div>
      </div>

      <div class="panel">
        <h3 class="muted">TRANSFER LIST — YOUR SQUAD</h3>
        ${squad.map((p) => `<div class="market-row">
          <div><b data-player="${p.id}" style="cursor:pointer">${esc(p.name)}</b> <span class="muted">${esc(p.pos)} · ${p.age} · ${Math.round(p.overall)} ovr · ${money(p.value)}</span></div>
          <div>${listed.includes(p.id) ? '<span class="listed-tag">LISTED</span>' : ""}</div>
          <div><button class="btn tiny" data-list="${p.id}">${listed.includes(p.id) ? "REMOVE" : "LIST"}</button></div>
        </div>`).join("")}
      </div>

      <div class="panel">
        <h3 class="muted">TRANSFER POOL</h3>
        <div class="seg" style="margin-bottom:8px">
          <button class="${!state.marketPos ? "on" : ""}" data-market="">ALL</button>
          ${MG.players.POSITION_KEYS.map((k) => `<button class="${state.marketPos === k ? "on" : ""}" data-market="${k}">${k}</button>`).join("")}
        </div>
        ${pool.length ? pool.map((m) => `<div class="market-row">
          <div><b data-player="${m.player.id}" style="cursor:pointer">${esc(m.player.name)}</b>
            ${m.listed ? '<span class="listed-tag">LISTED</span>' : ""}
            <span class="muted">${esc(m.player.pos)} · ${m.player.age} · ${Math.round(m.player.overall)} ovr · ${esc(m.club.name)}</span></div>
          <div class="gold">${money(m.fee)}</div>
          <div>${targets.includes(m.player.id)
            ? `<button class="btn tiny" data-bid="${m.player.id}">CANCEL</button>`
            : `<button class="btn tiny" data-bid="${m.player.id}">BID</button>`}</div>
        </div>`).join("") : `<div class="muted">Nobody available in that position at this level.</div>`}
      </div>`;
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
    const of = (type) => world.news.filter((n) => n.season === last.season && n.type === type);
    const section = (title, items, limit) => `
      <div class="panel"><h3 class="muted">${title}</h3>
        ${items.slice(0, limit || 10).map((n) => `<div class="log-entry ${esc(n.type)}">${esc(n.text)}</div>`).join("") || `<div class="muted">Nothing to report.</div>`}
      </div>`;
    return section("🏆 SILVERWARE", of("trophy"))
      + section("🔁 THE CAROUSEL", of("sack").concat(of("hire")).concat(of("retirement")), 12)
      + section("💰 THE WINDOW", of("transfer"), 12)
      + section("🌱 COMING THROUGH", of("youth"), 6);
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
    for (const b of document.querySelectorAll("[data-market]")) {
      b.addEventListener("click", () => { state.marketPos = b.dataset.market; renderTab(); });
    }
    for (const b of document.querySelectorAll("[data-list]")) {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(b.dataset.list);
        c.transferList = c.transferList || [];
        const i = c.transferList.indexOf(id);
        if (i >= 0) c.transferList.splice(i, 1); else c.transferList.push(id);
        const p = c.squad.find((x) => x.id === id);
        if (p) p.transferListed = c.transferList.includes(id);
        renderTab();
      });
    }
    for (const b of document.querySelectorAll("[data-bid]")) {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(b.dataset.bid);
        c.targets = c.targets || [];
        const i = c.targets.indexOf(id);
        if (i >= 0) c.targets.splice(i, 1); else c.targets.push(id);
        renderTab();
      });
    }
    for (const el of document.querySelectorAll("[data-player]")) {
      el.addEventListener("click", (e) => { e.stopPropagation(); openPlayer(Number(el.dataset.player)); });
    }
    const auto = $("auto-pick");
    if (auto) auto.addEventListener("click", () => { MG.tactics.setXI(c, null); render(); });
  }

  /* ------------------------------- MODALS --------------------------------- */
  function closeModal() { $("modal-root").innerHTML = ""; }

  function modal(inner) {
    $("modal-root").innerHTML = `<div class="modal">
      <div class="modal-backdrop" data-close="1"></div>
      <div class="modal-panel"><button class="modal-close" data-close="1">×</button>${inner}</div></div>`;
    for (const el of document.querySelectorAll("[data-close]")) el.addEventListener("click", closeModal);
  }

  /** Swap the player in a given XI slot. */
  function openSlotChooser(slotIndex) {
    const c = club();
    const formation = MG.tactics.FORMATIONS[c.formation];
    const slot = formation.slots[slotIndex];
    const current = MG.tactics.effectiveXI(c);
    const currentIds = current.map((p) => p && p.id);
    const options = c.squad.slice().sort((a, b) =>
      MG.tactics.effectiveOverall(b, slot) - MG.tactics.effectiveOverall(a, slot));

    modal(`<h3 class="muted">WHO PLAYS AT ${esc(slot)}?</h3>
      <div class="chooser">${options.map((p) => {
        const fam = MG.tactics.familiarity(p.pos, slot);
        const inXI = currentIds.indexOf(p.id);
        return `<button data-pick="${p.id}">
          <b>${esc(p.name)}</b><br>
          <span class="muted">${esc(p.pos)} · ${p.age} · ${Math.round(p.overall)} ovr</span><br>
          <span class="${fam >= 0.9 ? "accent" : fam >= 0.7 ? "gold" : "bad"}">${Math.round(fam * 100)}% suited</span>
          ${p.season.injured > 0 ? ` <span class="inj">injured</span>` : ""}
          ${inXI >= 0 && inXI !== slotIndex ? ` <span class="muted">(playing ${esc(formation.slots[inXI])})</span>` : ""}
        </button>`;
      }).join("")}</div>`);

    for (const b of document.querySelectorAll("[data-pick]")) {
      b.addEventListener("click", () => {
        const id = Number(b.dataset.pick);
        const ids = currentIds.slice();
        const existing = ids.indexOf(id);
        // Picking someone already in the side swaps the two shirts rather than
        // leaving a hole where he was.
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
    const mine = player.clubId === c.id;

    modal(`
      <div class="profile-head">
        <div class="profile-radar"><canvas id="radar" width="200" height="200"></canvas></div>
        <div class="profile-meta">
          <div style="font-size:20px;font-weight:800">${esc(player.name)}</div>
          <div class="muted">${esc(MG.players.POSITIONS[player.pos].name)} · ${player.age} · ${esc(player.nationality)} · ${esc(from)}</div>
          <div style="margin:8px 0">
            <span class="trait-chip gold">${Math.round(player.overall)} OVERALL</span>
            <span class="trait-chip">${Math.round(player.potential)} potential</span>
            <span class="trait-chip">${esc(player.mentality)}</span>
            ${player.homegrown ? '<span class="trait-chip">Homegrown</span>' : ""}
            ${player.transferListed ? '<span class="trait-chip gold">Transfer listed</span>' : ""}
            ${player.season.injured > 0 ? `<span class="trait-chip" style="color:var(--bad);border-color:var(--bad)">Out ${Math.round(player.season.injured * 100)}% of the season</span>` : ""}
          </div>
          ${stats.map((s) => `<div class="mini-bar"><span class="muted">${esc(s.label)}</span>
            <div class="bar"><i style="width:${clamp(s.value, 0, 99)}%"></i></div><b>${Math.round(s.value)}</b></div>`).join("")}
        </div>
      </div>
      <div class="stat-grid" style="margin-top:12px">
        <div class="stat-box"><div class="sb-num">${moraleDot(player.morale)}</div><div class="sb-lab">Morale</div></div>
        <div class="stat-box"><div class="sb-num gold">${money(player.value)}</div><div class="sb-lab">Value</div></div>
        <div class="stat-box"><div class="sb-num">£${player.contract.wage}k</div><div class="sb-lab">Wage/wk</div></div>
        <div class="stat-box"><div class="sb-num">${player.contract.years}y</div><div class="sb-lab">Contract</div></div>
        <div class="stat-box"><div class="sb-num">${player.career.goals}</div><div class="sb-lab">Career goals</div></div>
        <div class="stat-box"><div class="sb-num">${player.career.apps}</div><div class="sb-lab">Career apps</div></div>
      </div>
      ${player.season.apps ? `<div class="muted" style="font-size:12px;margin-top:8px">This season: ${player.season.apps} apps, ${player.season.goals} goals, ${player.season.assists} assists.</div>` : ""}
      ${mine ? `<div class="row" style="margin-top:12px"><button class="btn tiny" id="profile-list">${listed ? "REMOVE FROM TRANSFER LIST" : "ADD TO TRANSFER LIST"}</button></div>` : ""}
    `);

    drawRadar($("radar"), stats);
    const lb = $("profile-list");
    if (lb) lb.addEventListener("click", () => {
      c.transferList = c.transferList || [];
      const i = c.transferList.indexOf(player.id);
      if (i >= 0) c.transferList.splice(i, 1); else c.transferList.push(player.id);
      player.transferListed = c.transferList.includes(player.id);
      closeModal(); renderTab();
    });
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
