/* ============================================================================
 * FOOTBALL MANAGER — BROWSER SHELL
 *
 * The playable slice around the engine. The loop is deliberately the same
 * shape as 1000goals': you are shown a decision, the simulation runs a whole
 * season in one go, and you are shown what it did to you.
 *
 *   draft  ->  job offers  ->  [ pre-season brief -> PLAY SEASON -> board
 *                                report ] repeat until sacked  ->  career end
 *
 * The pre-season brief and the end-of-season board report are the motif. The
 * decision cards that will sit on either side of the simulation are not built
 * yet — this is the frame they slot into, and the board's metrics are already
 * the numbers those decisions will be written against.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = (m) => (Math.abs(m) >= 1000 ? `£${(m / 1000).toFixed(1)}bn` : `£${Math.round(m)}m`);
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  const state = {
    world: null,
    draft: null,
    manager: null,
    clubId: null,
    seed: null,
    log: [],
    career: [],          // one entry per season managed
    lastReport: null,
    lastBrief: null,
    sackReason: null,
    status: "active",    // active | sacked | retired
    tab: "brief",
  };
  root.MG_STATE = state;

  /* ------------------------------- SCREENS -------------------------------- */
  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.classList.remove("active");
    $(id).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* -------------------------------- START --------------------------------- */
  function startDraft() {
    state.seed = ($("seed-input").value || "").trim() || `mg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    state.draft = MG.draft.createDraft(state.seed, { rerolls: 3 });
    state.manager = null;
    state.clubId = null;
    state.career = [];
    state.log = [];
    state.status = "active";
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
    $("draft-progress").textContent = `Roll ${MG.draft.DRAFT_STEPS.indexOf(step) + 1} of ${MG.draft.DRAFT_STEPS.length}`;
    $("draft-rerolls").textContent = `${d.rerolls} reroll${d.rerolls === 1 ? "" : "s"} left`;
    $("draft-reroll").disabled = d.rerolls <= 0;

    let html = "";
    if (step === "archetype") {
      const a = MG.managers.ARCHETYPES[d.landed.archetype];
      html = `
        <div class="reel-rarity ${a.rarity.toLowerCase()}">${esc(a.rarity)}</div>
        <div class="reel-headline">${esc(a.name)}</div>
        <div class="reel-sub">in the mould of ${esc(a.basedOn)}</div>
        <p class="reel-blurb">${esc(a.blurb)}</p>
        <div class="reel-grid">
          <div><span>System</span><strong>${esc(MG.managers.TACTICS[a.tactic].label)}</strong></div>
          <div><span>Traits</span><strong>${a.traits.map(esc).join(", ")}</strong></div>
          <div><span>Temperament</span><strong>${esc(a.personality)}</strong></div>
        </div>
        <div class="attr-bars">${attrBars(a.attrs)}</div>`;
    } else if (step === "reputation") {
      const t = d.landed.tier;
      html = `
        <div class="reel-rarity ${t.key}">${esc(t.label)}</div>
        <div class="reel-headline">Reputation ${d.landed.reputation}</div>
        <p class="reel-blurb">${esc(t.blurb)}</p>`;
    } else {
      html = `
        <div class="reel-headline">${esc(d.landed.nationality)}</div>
        <p class="reel-blurb">Where you learned the game — and where you will always be able to get a job.</p>`;
    }
    $("draft-reel").innerHTML = html;
  }

  function attrBars(attrs) {
    const labels = {
      attacking: "Attacking", defending: "Defending", development: "Development",
      manManagement: "Man-management", transferAcumen: "Transfer acumen",
      adaptability: "Adaptability", discipline: "Discipline",
    };
    return Object.entries(attrs).map(([k, v]) => `
      <div class="bar-row"><span>${esc(labels[k] || k)}</span>
        <div class="bar"><i style="width:${clamp(v, 0, 99)}%"></i></div><b>${Math.round(v)}</b></div>`).join("");
  }

  function draftReroll() { state.draft.reroll(); renderDraft(); }

  function draftAccept() {
    const next = state.draft.accept();
    if (next) { state.draft.spin(); renderDraft(); return; }
    state.manager = state.draft.build(($("manager-name") && $("manager-name").value.trim()) || null);
    buildWorldAndOffers();
  }

  /* ----------------------------- JOB OFFERS ------------------------------- */
  function buildWorldAndOffers() {
    show("screen-loading");
    // Let the browser paint the loading screen before the world is built.
    setTimeout(() => {
      state.world = MG.world.createWorld({ seed: state.seed, startYear: 2026 });
      // The player's manager joins the world's pool but is never poached by it.
      state.world.managers.push(state.manager);
      state.world.managerIndex[state.manager.id] = state.manager;
      renderOffers();
      show("screen-offers");
    }, 30);
  }

  function renderOffers() {
    const m = state.manager;
    $("offers-manager").innerHTML = `
      <strong>${esc(m.name)}</strong> · ${esc(m.archetypeName)} · ${esc(m.nationality)} ·
      ${esc(m.tactic)} · reputation ${m.reputation} (${esc(m.reputationTier)})
      <div class="muted">${m.traits.map(esc).join(" · ")} · ${esc(m.personality)}</div>`;

    const offers = MG.draft.jobOffers(state.world, m, 4);
    if (!offers.length) {
      $("offers-list").innerHTML = `<p class="muted">Nobody will touch you. Start again with a different roll.</p>`;
      return;
    }
    $("offers-list").innerHTML = offers.map((o) => `
      <button class="offer" data-club="${o.club.id}">
        <div class="offer-head">
          <strong>${esc(o.club.name)}</strong>
          <span class="tag">${esc(o.leagueName)}</span>
        </div>
        <div class="offer-brief">${esc(o.brief || "No brief set")}</div>
        <div class="offer-grid">
          <div><span>Boardroom</span><strong class="board-${o.boardStyle.toLowerCase()}">${esc(o.boardStyle)}</strong></div>
          <div><span>Squad</span><strong>${o.squadRating}</strong></div>
          <div><span>Transfer budget</span><strong>${money(o.budget)}</strong></div>
          <div><span>Club reputation</span><strong>${o.club.reputation}</strong></div>
        </div>
        <div class="offer-blurb">${esc(o.boardBlurb)}</div>
      </button>`).join("");

    for (const btn of document.querySelectorAll(".offer")) {
      btn.addEventListener("click", () => takeJob(Number(btn.dataset.club)));
    }
  }

  function takeJob(clubId) {
    const world = state.world;
    const club = world.clubById(clubId);
    MG.world.removeManager(world, club, "replaced");
    MG.world.appointManager(world, club, state.manager, { quiet: true });
    // Appointing mid-flow leaves the previous incumbent without a club; the
    // world's own carousel will pick him up at the end of the season.
    state.clubId = clubId;
    MG.clubs.setSeasonTargets(club, world.clubsInLeague(club.leagueId), world.rng);
    state.log.unshift(`${state.manager.name} takes charge of ${club.name}.`);
    state.lastReport = null;
    renderCareer();
    show("screen-career");
  }

  /* ------------------------------ THE SEASON ------------------------------ */
  function playSeason() {
    const world = state.world;
    const club = world.clubById(state.clubId);
    // Snapshot the brief before the season wipes it — the report has to be
    // read against what was actually asked at the start of the year.
    const brief = JSON.parse(JSON.stringify(club.board.targets || {}));
    const leagueId = club.leagueId;

    $("play-season").disabled = true;
    $("play-season").textContent = "SIMULATING…";

    setTimeout(() => {
      const summary = world.advanceSeason();
      const league = summary.leagues[leagueId];
      const row = league ? league.table.find((r) => r.clubId === club.id) : null;
      const report = club.board.report;
      const stillHere = state.manager.clubId === club.id;

      state.career.push({
        season: summary.season,
        year: summary.year,
        club: club.name,
        leagueName: MG.clubs.LEAGUES[leagueId].name,
        position: row ? row.position : null,
        pts: row ? row.pts : null,
        brief,
        report,
        sacked: !stillHere,
      });
      state.lastBrief = brief;
      state.lastReport = report;

      for (const n of summary.news.filter((n) => n.clubId === club.id).slice(-6)) state.log.unshift(n.text);
      // The board's own words for why you went, which is not always the same
      // story the end-of-season verdict tells — a mid-season collapse and a
      // chaotic board's whim both end the same way and read very differently.
      const sackNews = summary.news.find((n) => n.clubId === club.id && n.type === "sack");
      state.sackReason = sackNews ? sackNews.text : null;

      $("play-season").disabled = false;
      $("play-season").textContent = "PLAY SEASON";

      if (!stillHere) { state.status = "sacked"; renderSacked(); show("screen-sacked"); return; }
      MG.clubs.setSeasonTargets(club, world.clubsInLeague(club.leagueId), world.rng);
      renderCareer();
      state.tab = "report";
      renderTab();
    }, 40);
  }

  /* ------------------------------ RENDERING ------------------------------- */
  function renderCareer() {
    const world = state.world;
    const club = world.clubById(state.clubId);
    const m = state.manager;
    const board = club.board;

    $("career-club").textContent = club.name;
    $("career-league").textContent = MG.clubs.LEAGUES[club.leagueId].name;
    $("career-season").textContent = `Season ${world.season} · ${world.year}/${String(world.year + 1).slice(2)}`;
    $("career-manager").innerHTML =
      `${esc(m.name)} · ${esc(m.archetypeName)} · ${esc(m.tactic)} · rep ${m.reputation}`;

    const conf = Math.round(board.confidence);
    $("confidence-bar").style.width = `${conf}%`;
    $("confidence-bar").className = `conf ${conf >= 60 ? "good" : conf >= 35 ? "warn" : "bad"}`;
    $("confidence-value").textContent = `${conf}`;
    $("board-style").textContent = board.style;
    $("board-style").className = `tag board-${board.style.toLowerCase()}`;
    renderTab();
  }

  function setTab(tab) { state.tab = tab; renderTab(); }

  function renderTab() {
    for (const b of document.querySelectorAll(".tab")) b.classList.toggle("on", b.dataset.tab === state.tab);
    const el = $("tab-body");
    if (state.tab === "brief") el.innerHTML = briefHtml();
    else if (state.tab === "report") el.innerHTML = reportHtml();
    else if (state.tab === "squad") el.innerHTML = squadHtml();
    else if (state.tab === "table") el.innerHTML = tableHtml();
    else el.innerHTML = worldHtml();
  }

  function briefHtml() {
    const club = state.world.clubById(state.clubId);
    const t = club.board.targets;
    const f = club.finances;
    const cfg = MG.clubs.BOARD_STYLES[club.board.style];
    if (!t) return `<p class="muted">No brief yet.</p>`;
    return `
      <div class="panel">
        <h3>THE BOARD'S BRIEF</h3>
        <p class="brief-line">${esc(t.summary)}</p>
        <p class="muted">${esc(cfg.blurb)} They rate the squad ${ordinal(t.standing)} in this division.</p>
        <div class="metric-grid">
          <div><span>League</span><strong>${ordinal(t.position)}${t.tolerance ? ` ±${t.tolerance}` : ""}</strong></div>
          <div><span>Cup run</span><strong>${esc(t.cup)}</strong></div>
          <div><span>Youth minutes</span><strong>${t.youthMinutes}%</strong></div>
          <div><span>Wage ceiling</span><strong>${money(t.wageCeiling)}</strong></div>
        </div>
      </div>
      <div class="panel">
        <h3>FINANCES</h3>
        <div class="metric-grid">
          <div><span>Balance</span><strong class="${f.balance < 0 ? "bad-text" : ""}">${money(f.balance)}</strong></div>
          <div><span>Transfer budget</span><strong>${money(f.transferBudget)}</strong></div>
          <div><span>Wage budget</span><strong>${money(f.wageBudget)}</strong></div>
          <div><span>Current wage bill</span><strong>${money(MG.clubs.wageBill(club))}</strong></div>
        </div>
      </div>
      <div class="panel">
        <h3>THE CLUB</h3>
        <div class="metric-grid">
          <div><span>Attack</span><strong>${Math.round(club.ratings.attack)}</strong></div>
          <div><span>Midfield</span><strong>${Math.round(club.ratings.midfield)}</strong></div>
          <div><span>Defence</span><strong>${Math.round(club.ratings.defence)}</strong></div>
          <div><span>Goalkeeper</span><strong>${Math.round(club.ratings.keeper)}</strong></div>
          <div><span>Training</span><strong>${club.facilities.training}</strong></div>
          <div><span>Academy</span><strong>${club.facilities.youth} (${esc(club.academyTier)})</strong></div>
        </div>
      </div>`;
  }

  function reportHtml() {
    const r = state.lastReport;
    const last = state.career[state.career.length - 1];
    if (!r || !last) return `<p class="muted">Play a season and the board will tell you how it went.</p>`;
    const rows = Object.values(r.metrics).map((m) => {
      const pct = clamp((m.score + 1) / 2 * 100, 0, 100);
      const cls = m.score > 0.15 ? "good" : m.score < -0.15 ? "bad" : "warn";
      return `<tr>
        <td>${esc(m.label)}</td>
        <td class="muted">${esc(m.target)}</td>
        <td>${esc(m.actual)}</td>
        <td class="score"><div class="score-bar"><i class="${cls}" style="left:${Math.min(pct, 50)}%;width:${Math.abs(pct - 50)}%"></i></div></td>
        <td class="${cls}-text">${m.score > 0 ? "+" : ""}${m.score}</td>
      </tr>`;
    }).join("");
    return `
      <div class="panel">
        <h3>END OF SEASON — ${esc(last.year)}/${String(last.year + 1).slice(2)}</h3>
        <p class="brief-line">${esc(last.club)} finished ${last.position ? ordinal(last.position) : "—"} in the ${esc(last.leagueName)} on ${last.pts} points.</p>
        <p class="muted">The brief was: ${esc(last.brief.summary || "—")}</p>
        <table class="report">
          <thead><tr><th>Metric</th><th>Asked</th><th>Delivered</th><th></th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="verdict ${r.total >= 0 ? "good-text" : "bad-text"}">
          Verdict: ${esc(r.verdict)} — board confidence ${r.swing >= 0 ? "+" : ""}${r.swing}, now ${Math.round(r.confidence)}
        </p>
      </div>
      <div class="panel">
        <h3>YOUR CLUB'S SEASON</h3>
        <ul class="feed">${state.log.slice(0, 10).map((l) => `<li>${esc(l)}</li>`).join("") || "<li class='muted'>Quiet.</li>"}</ul>
      </div>`;
  }

  function squadHtml() {
    const club = state.world.clubById(state.clubId);
    const squad = club.squad.slice().sort((a, b) => b.overall - a.overall);
    return `<div class="panel"><h3>SQUAD (${squad.length})</h3>
      <table class="squad">
        <thead><tr><th>Name</th><th>Pos</th><th>Age</th><th>Ovr</th><th>Pot</th><th>Value</th><th>Wage</th><th>Contract</th></tr></thead>
        <tbody>${squad.map((p) => `<tr>
          <td>${esc(p.name)}${p.homegrown ? ' <span class="hg">HG</span>' : ""}</td>
          <td>${esc(p.pos)}</td><td>${p.age}</td>
          <td><b>${Math.round(p.overall)}</b></td>
          <td class="muted">${Math.round(p.potential)}</td>
          <td>${money(p.value)}</td>
          <td>£${p.contract.wage}k</td>
          <td>${p.contract.years}y</td></tr>`).join("")}</tbody>
      </table></div>`;
  }

  function tableHtml() {
    const world = state.world;
    const club = world.clubById(state.clubId);
    const last = world.history[world.history.length - 1];
    const res = last && last.leagues[club.leagueId];
    if (!res) return `<p class="muted">No table yet — play your first season.</p>`;
    return `<div class="panel"><h3>${esc(res.leagueName)}</h3>
      <table class="league">
        <thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th><th>Manager</th></tr></thead>
        <tbody>${res.table.map((r) => {
          const c = world.clubById(r.clubId);
          const mgr = world.managerById(c.managerId);
          return `<tr class="${r.clubId === club.id ? "you" : ""}">
            <td>${r.position}</td><td>${esc(r.name)}</td><td>${r.played}</td><td>${r.won}</td>
            <td>${r.drawn}</td><td>${r.lost}</td><td>${r.gd}</td><td><b>${r.pts}</b></td>
            <td class="muted">${esc(mgr ? mgr.name : "—")}</td></tr>`;
        }).join("")}</tbody>
      </table></div>`;
  }

  function worldHtml() {
    const world = state.world;
    const last = world.history[world.history.length - 1];
    if (!last) return `<p class="muted">The world has not played a season yet.</p>`;
    const trophies = world.news.filter((n) => n.season === last.season && n.type === "trophy");
    const moves = world.news.filter((n) => n.season === last.season && (n.type === "sack" || n.type === "hire" || n.type === "retirement"));
    const deals = world.news.filter((n) => n.season === last.season && n.type === "transfer");
    const youth = world.news.filter((n) => n.season === last.season && n.type === "youth");
    const section = (title, items, limit) => `
      <div class="panel"><h3>${title}</h3>
        <ul class="feed">${items.slice(0, limit || 12).map((n) => `<li>${esc(n.text)}</li>`).join("") || "<li class='muted'>Nothing to report.</li>"}</ul>
      </div>`;
    return `
      ${section("SILVERWARE", trophies)}
      ${section("THE CAROUSEL", moves, 14)}
      ${section("THE WINDOW", deals, 14)}
      ${section("COMING THROUGH", youth, 8)}`;
  }

  /* ------------------------------ CAREER END ------------------------------ */
  function renderSacked() {
    const last = state.career[state.career.length - 1];
    const m = state.manager;
    const seasons = state.career.length;
    const r = last.report;
    $("sacked-body").innerHTML = `
      <p class="brief-line">${esc(m.name)} has been dismissed by ${esc(last.club)} after ${seasons} season${seasons === 1 ? "" : "s"}.</p>
      ${state.sackReason ? `<p class="muted">${esc(state.sackReason)}</p>` : ""}
      <p class="muted">${r ? `The board's verdict: ${esc(r.verdict.toLowerCase())}. The brief was "${esc(last.brief.summary || "—")}" and ${esc(last.club)} finished ${last.position ? ordinal(last.position) : "—"}.` : ""}</p>
      <div class="metric-grid">
        <div><span>Seasons managed</span><strong>${seasons}</strong></div>
        <div><span>Final reputation</span><strong>${m.reputation}</strong></div>
        <div><span>League titles</span><strong>${m.honours.titles}</strong></div>
        <div><span>Promotions</span><strong>${m.honours.promotions}</strong></div>
        <div><span>Record</span><strong>${m.record.won}W ${m.record.drawn}D ${m.record.lost}L</strong></div>
      </div>
      <table class="report"><thead><tr><th>Season</th><th>Club</th><th>Finish</th><th>Brief</th><th>Verdict</th></tr></thead>
      <tbody>${state.career.map((c) => `<tr>
        <td>${c.year}/${String(c.year + 1).slice(2)}</td><td>${esc(c.club)}</td>
        <td>${c.position ? ordinal(c.position) : "—"}</td>
        <td class="muted">${esc(c.brief.summary || "—")}</td>
        <td>${esc(c.report ? c.report.verdict : "—")}</td></tr>`).join("")}</tbody></table>`;
  }

  function backToMarket() {
    state.status = "active";
    renderOffers();
    show("screen-offers");
  }

  /* --------------------------------- BOOT --------------------------------- */
  function init() {
    $("begin").addEventListener("click", startDraft);
    $("draft-accept").addEventListener("click", draftAccept);
    $("draft-reroll").addEventListener("click", draftReroll);
    $("play-season").addEventListener("click", playSeason);
    $("sacked-continue").addEventListener("click", backToMarket);
    $("sacked-restart").addEventListener("click", () => show("screen-welcome"));
    for (const b of document.querySelectorAll(".tab")) {
      b.addEventListener("click", () => setTab(b.dataset.tab));
    }
    $("seed-input").value = `mg-${Math.random().toString(36).slice(2, 8)}`;
  }

  MG.ui = { init, state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof globalThis !== "undefined" ? globalThis : this);
