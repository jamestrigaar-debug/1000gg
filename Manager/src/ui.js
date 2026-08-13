/* ============================================================================
 * FOOTBALL MANAGER — BROWSER SHELL
 *
 * The loop, in the same rhythm as 1000goals: you are handed a decision, the
 * simulation runs a whole season in one pass, and you are shown what it did.
 *
 *   draft -> job offers -> [ PRE-SEASON cards -> PLAY SEASON -> season result
 *                            + board report -> END-OF-SEASON cards ] -> sacked
 *
 * The cards themselves live in decisions.js; this file is only staging and
 * presentation. The one rule worth keeping: a choice's outcome text is the
 * string the effect returned, never a string written here — so what the player
 * reads is always what the engine actually did.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp, round1 } = MG.util;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  /* Lower-league football happens below £1m. Rounding everything to whole
   * millions printed "£0m" against half a League Two squad. */
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
    stage: "preseason",     // preseason | ready | result | endseason
    cards: [], cardIndex: 0, outcomes: [],
    recent: [],             // decision ids seen lately, to avoid repeats
    career: [], lastSummary: null, lastRow: null, lastReport: null, lastBrief: null,
    sackReason: null, tab: "squad",
  };
  root.MG_STATE = state;

  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.classList.remove("active");
    $(id).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const club = () => state.world.clubById(state.clubId);

  /* -------------------------------- DRAFT --------------------------------- */
  function startDraft() {
    state.seed = ($("seed-input").value || "").trim() || `mg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    state.draft = MG.draft.createDraft(state.seed, { rerolls: 3 });
    Object.assign(state, { manager: null, clubId: null, career: [], outcomes: [], recent: [], cards: [], cardIndex: 0 });
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
    const d = state.draft;
    const step = d.currentStep();
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
      if (t.key === "elite") cls += " legendary";
      else if (t.key === "established") cls += " rare";
      html = `
        <div class="reel-rarity">${esc(t.label)}</div>
        <div class="reel-headline">Reputation ${d.landed.reputation}</div>
        <p class="reel-blurb">${esc(t.blurb)}</p>`;
    } else {
      html = `
        <div class="reel-headline">${esc(d.landed.nationality)}</div>
        <p class="reel-blurb">Where you learned the game — and where you will always be able to find work.</p>`;
    }
    reel.className = cls;
    reel.innerHTML = html;
  }

  function attrBars(attrs) {
    const labels = {
      attacking: "Attacking", defending: "Defending", development: "Development",
      manManagement: "Man-management", transferAcumen: "Transfer acumen",
      adaptability: "Adaptability", discipline: "Discipline",
    };
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

  /* ------------------------------- OFFERS --------------------------------- */
  function renderOffers() {
    const m = state.manager;
    $("offers-manager").innerHTML = `
      <div style="font-size:18px;font-weight:800">${esc(m.name)}</div>
      <div class="muted">${esc(m.archetypeName)} · ${esc(m.nationality)} · ${esc(m.tactic)} · reputation <b class="accent">${m.reputation}</b> (${esc(m.reputationTier)})</div>
      <div class="muted" style="font-size:13px;margin-top:4px">${m.traits.map(esc).join(" · ")} · ${esc(m.personality)}</div>`;

    const offers = MG.draft.jobOffers(state.world, m, 4);
    if (!offers.length) {
      $("offers-list").innerHTML = `<p class="muted">Nobody will touch you. Start a new career with a different roll.</p>`;
      return;
    }
    $("offers-list").innerHTML = offers.map((o) => `
      <button class="offer" data-club="${o.club.id}">
        <div class="offer-head">
          <span class="offer-club">${esc(o.club.name)}</span>
          <span class="pill">${esc(o.leagueName)}</span>
        </div>
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
    const world = state.world;
    const c = world.clubById(clubId);
    MG.world.removeManager(world, c, "replaced");
    MG.world.appointManager(world, c, state.manager, { quiet: true });
    state.clubId = clubId;
    MG.clubs.setSeasonTargets(c, world.clubsInLeague(c.leagueId), world.rng);
    state.lastReport = null;
    beginPreSeason();
    show("screen-career");
  }

  /* --------------------------- THE SEASON LOOP ---------------------------- */
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
    if (!state.cards.length) { state.stage = "ready"; }
    render();
  }

  function chooseOption(i) {
    const card = state.cards[state.cardIndex];
    if (!card) return;
    const choice = card.view.choices[i];
    const outcome = MG.decisions.apply(state.world, club(), state.manager, card.ctx, choice);
    state.outcomes.push({ label: choice.label, outcome, category: card.view.category });
    state.cardIndex++;
    if (state.cardIndex >= state.cards.length) {
      /* Pre-season cards lead straight into the match button. End-of-season
       * cards lead into NEXT season's pre-season cards — without this the loop
       * ran preseason once and then alternated season/endseason forever, and
       * half the decision pool was never seen again. */
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

      state.lastSummary = summary;
      state.lastRow = row ? {
        position: row.position, pts: row.pts, won: row.won, drawn: row.drawn, lost: row.lost,
        gf: row.gf, ga: row.ga, fieldSize: league.fieldSize,
        promoted: summary.moves.some((m) => m.club === c.name && m.type === "promoted"),
        relegated: summary.moves.some((m) => m.club === c.name && m.type === "relegated"),
        champion: row.position === 1,
        leagueName: MG.clubs.LEAGUES[leagueId].name,
      } : null;
      state.lastBrief = brief;
      state.lastReport = report;
      state.career.push({
        season: summary.season, year: summary.year, club: c.name,
        leagueName: MG.clubs.LEAGUES[leagueId].name,
        position: row ? row.position : null, pts: row ? row.pts : null,
        brief, verdict: report ? report.verdict : null, sacked: !stillHere,
      });

      const sackNews = summary.news.find((n) => n.clubId === c.id && n.type === "sack");
      state.sackReason = sackNews ? sackNews.text : null;

      if (!stillHere) { renderSacked(); show("screen-sacked"); return; }
      MG.clubs.setSeasonTargets(c, world.clubsInLeague(c.leagueId), world.rng);
      state.stage = "result";
      render();
    }, 50);
  }

  function toEndSeason() {
    state.stage = "endseason";
    drawCards(MG.decisions.ENDSEASON);
    if (!state.cards.length) { beginPreSeason(); return; }
    render();
  }

  /* ------------------------------ RENDERING ------------------------------- */
  function render() {
    const world = state.world, c = club(), m = state.manager, board = c.board;
    $("career-club").textContent = c.name;
    $("career-league").textContent = MG.clubs.LEAGUES[c.leagueId].name;
    $("career-season").textContent = `Season ${world.season} · ${world.year}/${String(world.year + 1).slice(2)}`;
    $("career-manager").innerHTML = `${esc(m.name)} · ${esc(m.archetypeName)} · ${esc(m.tactic)} · rep ${m.reputation}`;

    const conf = Math.round(board.confidence);
    $("confidence-bar").style.width = `${conf}%`;
    $("confidence-bar").className = `conf ${conf >= 55 ? "" : conf >= 35 ? "warn" : "bad"}`;
    $("confidence-value").textContent = conf;
    $("board-style").textContent = board.style.toUpperCase();
    $("board-style").className = `board-${board.style.toLowerCase()}`;
    $("board-brief").textContent = board.targets ? board.targets.summary : "";

    $("stage").innerHTML = stageHtml();
    wireStage();
    renderTab();
  }

  function stageHtml() {
    if (state.stage === "preseason" || state.stage === "endseason") return cardHtml();
    if (state.stage === "endseason-done") {
      return state.outcomes.map((o) => `<div class="outcome">${esc(o.outcome)}</div>`).join("")
        + `<button class="btn primary big" id="to-preseason" style="margin-top:12px">PRE-SEASON ▶</button>`;
    }
    if (state.stage === "ready") return readyHtml();
    return resultHtml();
  }

  function cardHtml() {
    const card = state.cards[state.cardIndex];
    const done = state.outcomes.map((o) => `<div class="outcome">${esc(o.outcome)}</div>`).join("");
    if (!card) return done;
    const isBoard = card.view.category === "BOARDROOM";
    const label = state.stage === "preseason" ? "PRE-SEASON" : "END OF SEASON";
    return `
      ${done}
      <div class="stage-step">${label} · decision ${state.cardIndex + 1} of ${state.cards.length}</div>
      <div class="decision ${isBoard ? "boardroom" : ""}">
        <div class="decision-tag">${esc(card.view.category)}</div>
        <div class="decision-text">${esc(card.view.text)}</div>
        <div class="decision-choices">
          ${card.view.choices.map((ch, i) => `
            <button class="btn choice" data-choice="${i}">
              <b>${esc(ch.label)}</b>
              ${ch.detail ? `<span>${esc(ch.detail)}</span>` : ""}
            </button>`).join("")}
        </div>
      </div>`;
  }

  function readyHtml() {
    const c = club();
    const t = c.board.targets;
    const outcomes = state.outcomes.map((o) => `<div class="outcome">${esc(o.outcome)}</div>`).join("");
    const r = c.ratings;
    const injured = c.squad.filter((p) => (p.season.injured || 0) > 0);
    return `
      ${outcomes}
      <div class="panel">
        <div class="stage-step">The season ahead</div>
        <div class="result-banner ok">${esc(t ? t.summary : "No brief")}</div>
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num">${Math.round(r.attack)}</div><div class="sb-lab">Attack</div></div>
          <div class="stat-box"><div class="sb-num">${Math.round(r.midfield)}</div><div class="sb-lab">Midfield</div></div>
          <div class="stat-box"><div class="sb-num">${Math.round(r.defence)}</div><div class="sb-lab">Defence</div></div>
          <div class="stat-box"><div class="sb-num">${Math.round(r.keeper)}</div><div class="sb-lab">Keeper</div></div>
          <div class="stat-box"><div class="sb-num gold">${money(c.finances.transferBudget)}</div><div class="sb-lab">Budget</div></div>
          <div class="stat-box"><div class="sb-num ${injured.length > 3 ? "bad" : ""}">${injured.length}</div><div class="sb-lab">Injured</div></div>
        </div>
        ${injured.length ? `<div class="muted" style="font-size:12px">Treatment room: ${injured.sort((a, b) => b.season.injured - a.season.injured).slice(0, 4).map((p) => `${esc(p.name)} (${Math.round(p.season.injured * 100)}% of the season)`).join(", ")}</div>` : ""}
      </div>
      <button class="btn primary big" id="play-season">▶ PLAY SEASON</button>`;
  }

  function resultHtml() {
    const row = state.lastRow, r = state.lastReport, c = club();
    if (!row) return `<div class="panel">The season was played, but your club was not in a simulated division.</div>
      <button class="btn primary big" id="to-endseason">CONTINUE</button>`;
    const tone = row.champion || row.promoted ? "great"
      : row.relegated ? "awful"
        : r && r.total >= 0.15 ? "good"
          : r && r.total <= -0.3 ? "bad" : "ok";
    const headline = row.champion ? `🏆 CHAMPIONS. ${c.name} win the ${row.leagueName}.`
      : row.promoted ? `📈 PROMOTED. ${c.name} go up.`
        : row.relegated ? `📉 RELEGATED. ${c.name} go down.`
          : `${c.name} finish ${ordinal(row.position)} in the ${row.leagueName}.`;

    const metrics = r ? Object.values(r.metrics).map((mt) => {
      const pct = clamp((mt.score + 1) / 2 * 100, 0, 100);
      const cls = mt.score > 0.15 ? "good" : mt.score < -0.15 ? "bad" : "warn";
      const left = Math.min(pct, 50), width = Math.max(2, Math.abs(pct - 50));
      return `<div class="metric">
        <div><div class="metric-label">${esc(mt.label)}</div><div class="metric-detail">asked ${esc(mt.target)} · got ${esc(mt.actual)}</div></div>
        <div class="muted" style="font-size:11px">${Math.round((r.weights[Object.keys(r.metrics).find((k) => r.metrics[k] === mt)] || 0) * 100)}%</div>
        <div class="metric-bar"><span class="metric-mid"></span><i class="${cls}" style="left:${left}%;width:${width}%"></i></div>
        <div class="${cls === "good" ? "accent" : cls === "bad" ? "bad" : "gold"}" style="font-weight:700">${mt.score > 0 ? "+" : ""}${mt.score}</div>
      </div>`;
    }).join("") : "";

    const scorer = c.squad.slice().sort((a, b) => b.season.goals - a.season.goals)[0];
    return `
      <div class="panel">
        <div class="result-banner ${tone}">${esc(headline)}</div>
        <div class="stat-grid">
          <div class="stat-box"><div class="sb-num">${row.pts}</div><div class="sb-lab">Points</div></div>
          <div class="stat-box"><div class="sb-num">${row.won}</div><div class="sb-lab">Won</div></div>
          <div class="stat-box"><div class="sb-num">${row.drawn}</div><div class="sb-lab">Drawn</div></div>
          <div class="stat-box"><div class="sb-num bad">${row.lost}</div><div class="sb-lab">Lost</div></div>
          <div class="stat-box"><div class="sb-num">${row.gf}</div><div class="sb-lab">Scored</div></div>
          <div class="stat-box"><div class="sb-num">${row.ga}</div><div class="sb-lab">Conceded</div></div>
        </div>
        ${scorer && scorer.season.goals ? `<div class="muted" style="font-size:13px">Top scorer: <b class="accent">${esc(scorer.name)}</b> with ${scorer.season.goals}.</div>` : ""}
      </div>
      ${r ? `<div class="panel">
        <div class="stage-step">The boardroom · ${esc(c.board.style)}</div>
        <div class="muted" style="font-size:13px;margin-bottom:8px">The brief was: ${esc(state.lastBrief.summary || "—")}</div>
        ${metrics}
        <div class="result-banner ${r.total >= 0.15 ? "great" : r.total <= -0.3 ? "awful" : "ok"}" style="margin-top:12px">
          ${esc(r.verdict)} — confidence ${r.swing >= 0 ? "+" : ""}${r.swing}, now ${Math.round(r.confidence)}/100
        </div>
      </div>` : ""}
      <button class="btn primary big" id="to-endseason">CONTINUE ▶</button>`;
  }

  function wireStage() {
    for (const b of document.querySelectorAll("[data-choice]")) {
      b.addEventListener("click", () => chooseOption(Number(b.dataset.choice)));
    }
    const play = $("play-season");
    if (play) play.addEventListener("click", playSeason);
    const cont = $("to-endseason");
    if (cont) cont.addEventListener("click", toEndSeason);
    const pre = $("to-preseason");
    if (pre) pre.addEventListener("click", beginPreSeason);
  }

  /* --------------------------------- TABS --------------------------------- */
  function renderTab() {
    for (const b of document.querySelectorAll(".tab")) b.classList.toggle("on", b.dataset.tab === state.tab);
    const el = $("tab-body");
    if (state.tab === "squad") el.innerHTML = squadHtml();
    else if (state.tab === "table") el.innerHTML = tableHtml();
    else if (state.tab === "world") el.innerHTML = worldHtml();
    else el.innerHTML = historyHtml();
  }

  function squadHtml() {
    const c = club();
    const squad = c.squad.slice().sort((a, b) => b.overall - a.overall);
    return `<div class="panel"><h3 class="muted">SQUAD (${squad.length}) · wage bill ${money(MG.clubs.wageBill(c))} of ${money(c.finances.wageBudget)}</h3>
      <table><thead><tr><th>Name</th><th>Pos</th><th>Age</th><th>Ovr</th><th>Pot</th><th>Value</th><th>Wage</th><th>Deal</th><th>Status</th></tr></thead>
      <tbody>${squad.map((p) => `<tr>
        <td>${esc(p.name)}${p.homegrown ? ' <span class="hg">HG</span>' : ""}</td>
        <td>${esc(p.pos)}</td><td>${p.age}</td>
        <td><b class="accent">${Math.round(p.overall)}</b></td>
        <td class="muted">${Math.round(p.potential)}</td>
        <td>${money(p.value)}</td><td>£${p.contract.wage}k</td><td>${p.contract.years}y</td>
        <td>${p.season.injured > 0 ? `<span class="inj">out ${Math.round(p.season.injured * 100)}%</span>` : `<span class="muted">fit</span>`}</td>
      </tr>`).join("")}</tbody></table></div>`;
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
        return `<tr class="${r.clubId === c.id ? "you" : ""}">
          <td>${r.position}</td><td>${esc(r.name)}</td><td>${r.played}</td><td>${r.won}</td>
          <td>${r.drawn}</td><td>${r.lost}</td><td>${r.gd}</td><td><b>${r.pts}</b></td>
          <td class="muted">${esc(mgr ? mgr.name : "—")}</td></tr>`;
      }).join("")}</tbody></table></div>`;
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

  function historyHtml() {
    const m = state.manager;
    if (!state.career.length) return `<div class="panel muted">Your first season has not been played yet.</div>`;
    return `<div class="panel">
      <div class="stat-grid">
        <div class="stat-box"><div class="sb-num">${state.career.length}</div><div class="sb-lab">Seasons</div></div>
        <div class="stat-box"><div class="sb-num">${m.reputation}</div><div class="sb-lab">Reputation</div></div>
        <div class="stat-box"><div class="sb-num gold">${m.honours.titles}</div><div class="sb-lab">Titles</div></div>
        <div class="stat-box"><div class="sb-num">${m.honours.promotions}</div><div class="sb-lab">Promotions</div></div>
        <div class="stat-box"><div class="sb-num">${m.record.won}</div><div class="sb-lab">Won</div></div>
        <div class="stat-box"><div class="sb-num bad">${m.record.lost}</div><div class="sb-lab">Lost</div></div>
      </div>
      <table><thead><tr><th>Season</th><th>Club</th><th>League</th><th>Finish</th><th>Brief</th><th>Verdict</th></tr></thead>
      <tbody>${state.career.slice().reverse().map((s) => `<tr>
        <td>${s.year}/${String(s.year + 1).slice(2)}</td><td>${esc(s.club)}</td>
        <td class="muted">${esc(s.leagueName)}</td>
        <td>${s.position ? ordinal(s.position) : "—"}</td>
        <td class="muted">${esc(s.brief.summary || "—")}</td>
        <td>${esc(s.verdict || "—")}</td></tr>`).join("")}</tbody></table></div>`;
  }

  /* ------------------------------ CAREER END ------------------------------ */
  function renderSacked() {
    const last = state.career[state.career.length - 1];
    const m = state.manager;
    $("sacked-body").innerHTML = `
      <div class="panel">
        <div class="result-banner awful">${esc(m.name)} dismissed by ${esc(last.club)} after ${state.career.length} season${state.career.length === 1 ? "" : "s"}.</div>
        ${state.sackReason ? `<div class="log-entry sack">${esc(state.sackReason)}</div>` : ""}
        <div class="stat-grid" style="margin-top:12px">
          <div class="stat-box"><div class="sb-num">${state.career.length}</div><div class="sb-lab">Seasons</div></div>
          <div class="stat-box"><div class="sb-num">${m.reputation}</div><div class="sb-lab">Reputation</div></div>
          <div class="stat-box"><div class="sb-num gold">${m.honours.titles}</div><div class="sb-lab">Titles</div></div>
          <div class="stat-box"><div class="sb-num">${m.honours.promotions}</div><div class="sb-lab">Promotions</div></div>
          <div class="stat-box"><div class="sb-num">${m.record.won}</div><div class="sb-lab">Won</div></div>
          <div class="stat-box"><div class="sb-num bad">${m.record.lost}</div><div class="sb-lab">Lost</div></div>
        </div>
      </div>
      <div class="panel"><h3 class="muted">THE RECORD</h3>
        <table><thead><tr><th>Season</th><th>Club</th><th>Finish</th><th>Brief</th><th>Verdict</th></tr></thead>
        <tbody>${state.career.map((s) => `<tr>
          <td>${s.year}/${String(s.year + 1).slice(2)}</td><td>${esc(s.club)}</td>
          <td>${s.position ? ordinal(s.position) : "—"}</td>
          <td class="muted">${esc(s.brief.summary || "—")}</td>
          <td>${esc(s.verdict || "—")}</td></tr>`).join("")}</tbody></table></div>`;
  }

  /* --------------------------------- BOOT --------------------------------- */
  function init() {
    $("begin").addEventListener("click", startDraft);
    $("draft-accept").addEventListener("click", draftAccept);
    $("draft-reroll").addEventListener("click", () => { state.draft.reroll(); renderDraft(); });
    $("sacked-continue").addEventListener("click", () => { renderOffers(); show("screen-offers"); });
    $("sacked-restart").addEventListener("click", () => show("screen-welcome"));
    for (const b of document.querySelectorAll(".tab")) {
      b.addEventListener("click", () => { state.tab = b.dataset.tab; renderTab(); });
    }
    $("seed-input").value = `mg-${Math.random().toString(36).slice(2, 8)}`;
  }

  MG.ui = { init, state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof globalThis !== "undefined" ? globalThis : this);
