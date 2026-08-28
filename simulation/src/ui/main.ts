/* ============================================================================
 * MATCH DAY — pre-match, the text match, and watching it back.
 *
 * The flow is the one the Manager asked for, and the order matters:
 *
 *   1. PRE-MATCH   the two team sheets read against each other: formations,
 *                  playstyles, unit ratings, key men, the talking points.
 *                  Everything on this screen comes from the same objects the
 *                  simulation is about to be handed.
 *   2. THE TEXT    the match is simulated headlessly, start to finish, and
 *                  comes back as a list of highlights — the text version.
 *   3. THE PITCH   click any line and that passage is played in 2D. Same seed,
 *                  same events, same match: the text is not a summary of a
 *                  different simulation, it is an index into this one.
 *
 * Everything here reads the event stream (via the worker's report) and never
 * the renderer.
 * ========================================================================== */

import { MatchView } from "../render/match-view";
import { buildMatchSetup } from "../manager/bridge";
import { fixtureFrom, teamList } from "../data/teams";
import { loadFormations } from "../data";
import { STYLE_NAMES } from "../manager/styles";
import type { HighlightMode } from "../core/highlights";
import type { PreMatch, TeamPreview } from "../core/prematch";
import type { MatchSetup } from "../core/types";
import type { FromWorker, MatchReport, ToWorker } from "../worker/protocol";

const el = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from index.html`);
  return node;
};

const params = new URLSearchParams(location.search);
const formations = loadFormations();
const teams = teamList();

/** The fixture the screen is currently set to. Changing any picker rebuilds
 *  it and restarts the worker, because a match is its inputs. */
const choice = {
  homeId: params.get("homeTeam") ?? (teams[1]?.id ?? ""),
  awayId: params.get("awayTeam") ?? (teams[0]?.id ?? ""),
  homeFormation: params.get("home") ?? "4-2-3-1",
  awayFormation: params.get("away") ?? "4-4-2",
  homeStyle: params.get("homeStyle") ?? "",
  awayStyle: params.get("awayStyle") ?? "",
  seed: params.get("seed") ?? "match-1",
};

let setup: MatchSetup = buildSetup();
const names = new Map<number, string>();

function buildSetup(): MatchSetup {
  const fixture = fixtureFrom({
    homeId: choice.homeId,
    awayId: choice.awayId,
    homeFormation: formations[choice.homeFormation] ?? (formations["4-4-2"] as never),
    awayFormation: formations[choice.awayFormation] ?? (formations["4-4-2"] as never),
    ...(choice.homeStyle ? { homeStyle: choice.homeStyle } : {}),
    ...(choice.awayStyle ? { awayStyle: choice.awayStyle } : {}),
    seed: choice.seed,
  });
  return buildMatchSetup(fixture);
}

function refreshNames(): void {
  names.clear();
  for (const team of [setup.home, setup.away]) {
    for (const p of team.players) names.set(p.id, p.name);
  }
}
refreshNames();

const view = new MatchView();
let worker = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
const send = (msg: ToWorker): void => worker.postMessage(msg);

let report: MatchReport | null = null;
let mode: HighlightMode = "extended";
let watching: number | null = null;
let viewReady = false;

function attach(): void {
  worker.onmessage = onMessage;
}

const onMessage = (ev: MessageEvent<FromWorker>): void => {
  const msg = ev.data;
  switch (msg.type) {
    case "ready":
      renderPreMatch(msg.preMatch);
      break;
    case "progress":
      el("sim-progress").style.width = `${Math.round(msg.fraction * 100)}%`;
      break;
    case "report":
      report = msg.report;
      renderReport(msg.report);
      break;
    case "snapshot":
      if (viewReady) view.push(msg.snapshot);
      el("watch-clock").textContent = formatClock(msg.snapshot.matchSecond);
      break;
    case "highlightEnded":
      onHighlightEnded(msg.index);
      break;
    case "error":
      el("status").textContent = `Simulation error: ${msg.message}`;
      break;
  }
};

attach();
send({ type: "init", setup });

/* --- the fixture picker -------------------------------------------------- */

function buildPickers(): void {
  const teamOptions = (selected: string): string =>
    teams
      .map(
        (t) =>
          `<option value="${t.id}"${t.id === selected ? " selected" : ""}>` +
          `${esc(t.club)} ${t.season}${t.note ? ` \u2014 ${esc(t.note)}` : ""} (${t.rating})</option>`,
      )
      .join("");
  const formationOptions = (selected: string): string =>
    Object.values(formations)
      .map((f) => `<option value="${f.id}"${f.id === selected ? " selected" : ""}>${f.name}</option>`)
      .join("");
  const styleOptions = (selected: string): string =>
    ['<option value="">Club default</option>']
      .concat(
        STYLE_NAMES.map(
          (s) => `<option value="${s}"${s === selected ? " selected" : ""}>${s}</option>`,
        ),
      )
      .join("");

  (el("home-team") as HTMLSelectElement).innerHTML = teamOptions(choice.homeId);
  (el("away-team") as HTMLSelectElement).innerHTML = teamOptions(choice.awayId);
  (el("home-formation") as HTMLSelectElement).innerHTML = formationOptions(choice.homeFormation);
  (el("away-formation") as HTMLSelectElement).innerHTML = formationOptions(choice.awayFormation);
  (el("home-style") as HTMLSelectElement).innerHTML = styleOptions(choice.homeStyle);
  (el("away-style") as HTMLSelectElement).innerHTML = styleOptions(choice.awayStyle);
  (el("seed") as HTMLInputElement).value = choice.seed;
}

buildPickers();

for (const [id, key] of [
  ["home-team", "homeId"],
  ["away-team", "awayId"],
  ["home-formation", "homeFormation"],
  ["away-formation", "awayFormation"],
  ["home-style", "homeStyle"],
  ["away-style", "awayStyle"],
] as const) {
  el(id).addEventListener("change", (ev) => {
    (choice as unknown as Record<string, string>)[key] = (ev.target as HTMLSelectElement).value;
    resetFixture();
  });
}
el("seed").addEventListener("change", (ev) => {
  choice.seed = (ev.target as HTMLInputElement).value || "match-1";
  resetFixture();
});
el("shuffle").addEventListener("click", () => {
  choice.seed = `match-${Date.now().toString(36).slice(-5)}`;
  (el("seed") as HTMLInputElement).value = choice.seed;
  resetFixture();
});

/** A new fixture is a new match: the old worker is discarded rather than
 *  reconfigured, so nothing from the previous match can leak into it. */
function resetFixture(): void {
  worker.terminate();
  worker = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
  attach();
  setup = buildSetup();
  refreshNames();
  report = null;
  watching = null;
  viewReady = false;
  view.reset();
  el("stage-wrap").classList.add("hidden");
  el("prematch").classList.remove("collapsed");
  el("feed").innerHTML = "";
  el("stats").innerHTML = "";
  el("score").textContent = "v";
  el("reel-summary").textContent = "Simulate the match to see the highlights.";
  el("kickoff").removeAttribute("disabled");
  el("status").textContent = "";

  const url = new URL(location.href);
  for (const [key, value] of Object.entries({
    homeTeam: choice.homeId,
    awayTeam: choice.awayId,
    home: choice.homeFormation,
    away: choice.awayFormation,
    homeStyle: choice.homeStyle,
    awayStyle: choice.awayStyle,
    seed: choice.seed,
  })) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);

  send({ type: "init", setup });
}

/* --- pre-match ----------------------------------------------------------- */

function renderPreMatch(pre: PreMatch): void {
  el("home-name").textContent = pre.home.shortName;
  el("away-name").textContent = pre.away.shortName;
  el("prematch").innerHTML = `
    <div class="pm-grid">
      ${teamColumn(pre.home, "home")}
      <div class="pm-middle">
        ${bar("Attack", pre.home.ratings.attack, pre.away.ratings.attack)}
        ${bar("Midfield", pre.home.ratings.midfield, pre.away.ratings.midfield)}
        ${bar("Defence", pre.home.ratings.defence, pre.away.ratings.defence)}
        ${bar("Keeper", pre.home.ratings.keeper, pre.away.ratings.keeper)}
        <div class="pm-odds">
          <span>${pct(pre.odds.home)}</span><span class="muted">draw ${pct(pre.odds.draw)}</span><span>${pct(pre.odds.away)}</span>
        </div>
      </div>
      ${teamColumn(pre.away, "away")}
    </div>
    <ul class="pm-points">${pre.talkingPoints.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
  `;
}

function teamColumn(team: TeamPreview, side: "home" | "away"): string {
  return `
    <div class="pm-team ${side}">
      <h2>${esc(team.name)}</h2>
      <div class="pm-shape">${esc(team.formationName)} · ${esc(team.style)}</div>
      <div class="muted pm-blurb">${esc(team.formationBlurb)}</div>
      <div class="muted pm-blurb">${esc(team.styleBlurb)}</div>
      <ol class="pm-lineup">
        ${team.lineup
          .map(
            (p) =>
              `<li><span class="num">${p.squadNumber}</span><span class="pos">${p.position}</span>` +
              `<span class="nm">${esc(p.name)}</span><span class="rt">${p.rating}</span></li>`,
          )
          .join("")}
      </ol>
      <div class="pm-keys">
        ${team.keyPlayers.map((k) => `<div><b>${esc(k.name)}</b> <span class="muted">${esc(k.quality)}</span></div>`).join("")}
      </div>
      <div class="pm-traits">${team.traits.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    </div>`;
}

function bar(label: string, home: number, away: number): string {
  const total = Math.max(home + away, 1);
  const share = Math.round((home / total) * 100);
  return `
    <div class="pm-bar">
      <div class="pm-bar-label"><span>${home}</span><span class="muted">${label}</span><span>${away}</span></div>
      <div class="pm-bar-track"><div class="pm-bar-fill" style="width:${share}%"></div></div>
    </div>`;
}

/* --- the text match ------------------------------------------------------ */

el("kickoff").addEventListener("click", () => {
  el("kickoff").setAttribute("disabled", "true");
  el("status").textContent = "Simulating…";
  el("sim-bar").classList.remove("hidden");
  send({ type: "simulate", mode });
});

for (const option of ["key", "extended", "comprehensive", "full"] as HighlightMode[]) {
  el(`mode-${option}`).addEventListener("click", () => {
    mode = option;
    for (const other of ["key", "extended", "comprehensive", "full"]) {
      el(`mode-${other}`).classList.toggle("on", other === option);
    }
    if (report) send({ type: "recut", mode });
  });
}

function renderReport(r: MatchReport): void {
  el("sim-bar").classList.add("hidden");
  el("prematch").classList.add("collapsed");
  el("score").textContent = `${r.score[0]} - ${r.score[1]}`;
  el("status").textContent = "";
  const totalWatch = r.highlights.reduce((t, h) => t + (h.to - h.from), 0);
  el("reel-summary").textContent =
    `${r.highlights.length} highlights · ${Math.round(totalWatch)}s of football`;

  el("feed").innerHTML = r.highlights
    .map(
      (h, i) =>
        `<button class="hl ${h.importance >= 3 ? "big" : h.importance >= 2 ? "mid" : ""}" data-index="${i}">
           <span class="hl-min">${h.minute}'</span>
           <span class="hl-text">${esc(h.text)}</span>
           <span class="hl-score">${h.score[0]}-${h.score[1]}</span>
         </button>`,
    )
    .join("");
  for (const node of Array.from(el("feed").querySelectorAll<HTMLButtonElement>("button.hl"))) {
    node.addEventListener("click", () => watchHighlight(Number(node.dataset.index)));
  }

  el("stats").innerHTML = statsTable(r);
}

function statsTable(r: MatchReport): string {
  const rows: [string, string, string][] = [
    ["Possession", pct(r.possession[0]), pct(r.possession[1])],
    ["Shots", String(r.team[0].shots), String(r.team[1].shots)],
    ["On target", String(r.team[0].onTarget), String(r.team[1].onTarget)],
    ["xG", r.team[0].xg.toFixed(2), r.team[1].xg.toFixed(2)],
    ["Corners", String(r.team[0].corners), String(r.team[1].corners)],
    ["Offsides", String(r.team[0].offsides), String(r.team[1].offsides)],
    ["Saves", String(r.team[0].saves), String(r.team[1].saves)],
    [
      "Pass accuracy",
      passPct(r.team[0].passesCompleted, r.team[0].passes),
      passPct(r.team[1].passesCompleted, r.team[1].passes),
    ],
  ];
  const best = r.ratings
    .slice(0, 5)
    .map(
      (p) =>
        `<li><span>${esc(names.get(p.id) ?? `#${p.id}`)}</span><b>${p.rating.toFixed(1)}</b></li>`,
    )
    .join("");
  return `
    <table class="stat-table">
      ${rows.map(([label, home, away]) => `<tr><td>${home}</td><th>${label}</th><td>${away}</td></tr>`).join("")}
    </table>
    <h3>Best on the pitch</h3>
    <ol class="ratings">${best}</ol>`;
}

/* --- watching a highlight ------------------------------------------------ */

async function watchHighlight(index: number): Promise<void> {
  if (!report) return;
  const highlight = report.highlights[index];
  if (!highlight) return;
  watching = index;

  // Unhide before initialising: PixiJS sizes itself to the element, and an
  // element that is still display:none measures zero.
  el("stage-wrap").classList.remove("hidden");
  if (!viewReady) {
    await view.init(el("stage"), [setup.home.kit, setup.away.kit], names);
    viewReady = true;
  }
  el("watch-caption").textContent = `${highlight.minute}' ${highlight.text}`;
  for (const node of Array.from(el("feed").querySelectorAll(".hl"))) {
    node.classList.toggle("playing", node.getAttribute("data-index") === String(index));
  }
  send({ type: "watch", index });
}

function onHighlightEnded(index: number): void {
  if (watching !== index) return;
  const next = index + 1;
  el("watch-caption").textContent = report && report.highlights[next]
    ? "End of passage — click the next line to keep watching."
    : "That's the lot.";
  for (const node of Array.from(el("feed").querySelectorAll(".hl"))) {
    node.classList.remove("playing");
  }
}

el("camera").addEventListener("click", () => {
  const follow = el("camera").dataset.mode !== "follow";
  el("camera").dataset.mode = follow ? "follow" : "fit";
  el("camera").textContent = follow ? "Camera: follow" : "Camera: pitch";
  view.setMode(follow ? "follow" : "fit");
});

el("names").addEventListener("click", () => {
  const show = el("names").dataset.on !== "true";
  el("names").dataset.on = show ? "true" : "false";
  el("names").classList.toggle("on", show);
  view.setNames(show);
});

el("flip").addEventListener("click", () => {
  const vertical = el("flip").dataset.o !== "vertical";
  el("flip").dataset.o = vertical ? "vertical" : "horizontal";
  view.setOrientation(vertical ? "vertical" : "horizontal");
});

for (const scale of [1, 2, 4] as const) {
  el(`speed-${scale}`).addEventListener("click", () => send({ type: "speed", scale }));
}

/* --- helpers ------------------------------------------------------------- */

function formatClock(second: number): string {
  const mm = Math.floor(second / 60);
  const ss = Math.floor(second % 60);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const passPct = (done: number, total: number): string =>
  total === 0 ? "—" : `${Math.round((done / total) * 100)}%`;

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
