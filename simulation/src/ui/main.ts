/* ============================================================================
 * MATCH DAY — pre-match, the match, and the result.
 *
 * The flow, and the order matters:
 *
 *   1. PRE-MATCH   the two team sheets read against each other: formations,
 *                  playstyles, unit ratings, key men, the talking points.
 *                  Everything on this screen comes from the same objects the
 *                  simulation is about to be handed.
 *   2. THE MATCH   press Kick off and it PLAYS. The match is simulated
 *                  headlessly first — it has to be, the reel is cut from the
 *                  finished event stream — but nothing about it is shown. The
 *                  reel then plays passage after passage on the pitch, the
 *                  clock runs, and each line of commentary appears at the
 *                  moment the match reaches it. Skip cuts to the next passage;
 *                  Skip to result abandons the reel.
 *   3. THE RESULT  the score, the stats and the ratings arrive at full time,
 *                  not before. From then on any line can be clicked to watch
 *                  that passage again.
 *
 * The result is deliberately withheld until the reel has been through it. A
 * scoreline in the corner while you watch the build-up is not a match, it is
 * a summary with pictures.
 *
 * Everything here reads the event stream (via the worker's report) and never
 * the renderer.
 * ========================================================================== */

import { MatchView } from "../render/match-view";
import { buildMatchSetup } from "../manager/bridge";
import { fixtureFrom, teamList } from "../data/teams";
import { loadFormations } from "../data";
import { STYLE_NAMES } from "../manager/styles";
import type { Highlight, HighlightMode } from "../core/highlights";
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
const MODES: HighlightMode[] = ["key", "extended", "comprehensive", "full"];

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
let viewReady = false;

/* --- what the screen is doing right now ---------------------------------- */

type Phase = "prematch" | "simulating" | "watching" | "result";
let phase: Phase = "prematch";
/** Passage currently on the pitch. */
let current: number | null = null;
/** Passages whose commentary line has already been revealed. */
const revealed = new Set<number>();
/** True once the reel has run: lines become clickable, the result is shown. */
let resultOut = false;
let paused = false;
/** Speed the user last chose; kept across passages. */
let speed = 1;

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
      onReport(msg.report);
      break;
    case "snapshot":
      if (viewReady) view.push(msg.snapshot, msg.cut, msg.timeScale);
      onFrame(msg.snapshot.matchSecond, msg.snapshot.score);
      break;
    case "reelEnter":
      onReelEnter(msg.index);
      break;
    case "highlightEnded":
      revealLine(msg.index);
      break;
    case "reelEnded":
      onReelEnded();
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
          `${esc(t.club)} ${t.season}${t.note ? ` — ${esc(t.note)}` : ""} (${t.rating})</option>`,
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
  phase = "prematch";
  current = null;
  revealed.clear();
  resultOut = false;
  paused = false;
  viewReady = false;
  view.reset();
  el("stage-wrap").classList.add("hidden");
  el("prematch").classList.remove("collapsed");
  el("feed").innerHTML = "";
  el("stats").innerHTML = "";
  el("stats").classList.add("hidden");
  el("watch-again").classList.add("hidden");
  concealScore();
  el("clock").textContent = "";
  el("reel-summary").textContent = "Kick off to watch the match.";
  el("kickoff").removeAttribute("disabled");
  el("kickoff").textContent = "Kick off";
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

/* --- kick off ------------------------------------------------------------ */

el("kickoff").addEventListener("click", () => {
  if (phase === "result" || resultOut) {
    // Already watched. The button becomes "watch it again".
    startReel(0);
    return;
  }
  phase = "simulating";
  el("kickoff").setAttribute("disabled", "true");
  el("status").textContent = "Building the match…";
  el("sim-bar").classList.remove("hidden");
  send({ type: "simulate", mode });
});

for (const option of MODES) {
  el(`mode-${option}`).addEventListener("click", () => {
    if (mode === option) return;
    mode = option;
    for (const other of MODES) el(`mode-${other}`).classList.toggle("on", other === option);
    if (!report) return;

    /* Re-cutting mid-match is allowed, because picking the level of detail is
     * the whole point of the four modes. The reel is rebuilt and playback
     * resumes at the first passage that has not already gone by, so changing
     * your mind at half time does not send you back to the kick-off. */
    resumeAfterRecut = phase === "watching" ? currentMatchSecond : null;
    send({ type: "recut", mode });
  });
}

/** Where to pick the reel back up after a mid-match re-cut. */
let resumeAfterRecut: number | null = null;
let currentMatchSecond = 0;

function onReport(r: MatchReport): void {
  el("sim-bar").classList.add("hidden");
  el("prematch").classList.add("collapsed");
  el("status").textContent = "";
  el("reel-summary").textContent = summaryLine(r.highlights);

  if (resumeAfterRecut !== null) {
    const at = resumeAfterRecut;
    resumeAfterRecut = null;
    rebuildFeed(r, true);
    const next = r.highlights.findIndex((h) => h.to > at);
    if (next >= 0) startReel(next);
    else finishReel();
    return;
  }

  if (resultOut) {
    // Re-cut after full time: just redraw the list, all of it visible.
    rebuildFeed(r, false);
    revealResult(r);
    return;
  }

  rebuildFeed(r, true);
  startReel(0);
}

function summaryLine(highlights: readonly Highlight[]): string {
  const watch = Math.round(highlights.reduce((t, h) => t + (h.to - h.from), 0));
  const mm = Math.floor(watch / 60);
  const ss = watch % 60;
  const length = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
  return `${highlights.length} highlights · ${length} of football`;
}

/* --- watching the match -------------------------------------------------- */

async function startReel(from: number): Promise<void> {
  if (!report) return;
  phase = "watching";
  paused = false;
  current = null;

  el("stage-wrap").classList.remove("hidden");
  if (!viewReady) {
    await view.init(el("stage"), [setup.home.kit, setup.away.kit], names);
    viewReady = true;
  }
  el("kickoff").setAttribute("disabled", "true");
  el("watch-again").classList.add("hidden");
  el("pause").textContent = "Pause";
  el("pause").classList.add("primary");
  setReelControls(true);
  send({ type: "speed", scale: speed });
  send({ type: "playReel", from });
}

function onReelEnter(index: number): void {
  current = index;
  const highlight = report?.highlights[index];
  if (!highlight) return;
  // The line itself is NOT shown yet: it is revealed when the match reaches
  // the moment it describes, so the reel does not spoil its own goals.
  el("watch-caption").textContent = resultOut ? highlight.text : "";
  el("reel-pos").textContent = `${index + 1} / ${report?.highlights.length ?? 0}`;
  markPlaying(index);
  if (resultOut) revealLine(index);
}

/** A frame arrived: keep the clock, the score and the commentary honest. */
function onFrame(matchSecond: number, score: [number, number]): void {
  currentMatchSecond = matchSecond;
  el("watch-clock").textContent = formatClock(matchSecond);
  // Once full time has been shown, the header clock stays at FT even while a
  // passage is being watched back: it belongs to the match, not the replay.
  if (!resultOut) el("clock").textContent = `${Math.floor(matchSecond / 60)}'`;
  // The score comes off the snapshot, so it changes the instant the ball
  // crosses the line rather than when the passage ends.
  if (phase === "watching") el("score").textContent = `${score[0]} - ${score[1]}`;
  el("score").classList.remove("concealed");

  if (current === null || revealed.has(current)) return;
  const highlight = report?.highlights[current];
  if (highlight && matchSecond >= highlight.at) revealLine(current);
}

/** Show a passage's commentary line, once the match has reached it. */
function revealLine(index: number): void {
  if (revealed.has(index)) return;
  const highlight = report?.highlights[index];
  if (!highlight) return;
  revealed.add(index);
  const node = el("feed").querySelector<HTMLElement>(`[data-index="${index}"]`);
  if (!node) return;
  node.classList.remove("hidden");
  node.classList.add("fresh");
  el("watch-caption").textContent = `${highlight.minute}' ${highlight.text}`;
  node.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function markPlaying(index: number | null): void {
  for (const node of Array.from(el("feed").querySelectorAll(".hl"))) {
    node.classList.toggle("playing", node.getAttribute("data-index") === String(index));
  }
}

function onReelEnded(): void {
  finishReel();
}

function finishReel(): void {
  phase = "result";
  resultOut = true;
  current = null;
  markPlaying(null);
  setReelControls(false);
  el("watch-caption").textContent = "Full time.";
  el("reel-pos").textContent = "";
  /* The reel can be skipped from anywhere, so the clock is showing whatever
   * minute it was abandoned at. Leaving "44'" beside a full-time score reads
   * as a match that stopped early. */
  el("clock").textContent = "FT";
  el("kickoff").removeAttribute("disabled");
  el("kickoff").textContent = "Kick off";
  el("watch-again").classList.remove("hidden");
  if (report) {
    // Everything the reel had not reached yet appears now, and the whole list
    // becomes clickable.
    rebuildFeed(report, false);
    revealResult(report);
  }
}

function revealResult(r: MatchReport): void {
  el("score").textContent = `${r.score[0]} - ${r.score[1]}`;
  el("score").classList.remove("concealed");
  el("reel-summary").textContent = summaryLine(r.highlights);
  el("stats").innerHTML = statsTable(r);
  el("stats").classList.remove("hidden");
}

function concealScore(): void {
  el("score").textContent = "v";
  el("score").classList.add("concealed");
}
concealScore();

/** Draw the reel list. While the match is being watched the lines start
 *  hidden and appear as it reaches them; afterwards they are all there and
 *  every one of them can be clicked to watch that passage again. */
function rebuildFeed(r: MatchReport, progressive: boolean): void {
  if (progressive) revealed.clear();
  el("feed").innerHTML = r.highlights
    .map((h, i) => {
      const weight = h.importance >= 3 ? "big" : h.importance >= 2 ? "mid" : "";
      const hide = progressive && !revealed.has(i) ? " hidden" : "";
      const lock = progressive ? " disabled" : "";
      return `<button class="hl ${weight}${hide}" data-index="${i}"${lock}>
           <span class="hl-min">${h.minute}'</span>
           <span class="hl-text">${esc(h.text)}</span>
           <span class="hl-score">${h.score[0]}-${h.score[1]}</span>
         </button>`;
    })
    .join("");
  if (progressive) return;
  for (const node of Array.from(el("feed").querySelectorAll<HTMLButtonElement>("button.hl"))) {
    node.addEventListener("click", () => watchOne(Number(node.dataset.index)));
  }
}

/** Click a line after full time: play that passage on its own. */
async function watchOne(index: number): Promise<void> {
  if (!report?.highlights[index]) return;
  el("stage-wrap").classList.remove("hidden");
  if (!viewReady) {
    await view.init(el("stage"), [setup.home.kit, setup.away.kit], names);
    viewReady = true;
  }
  paused = false;
  current = index;
  el("pause").textContent = "Pause";
  el("pause").classList.add("primary");
  setReelControls(true, true);
  markPlaying(index);
  el("watch-caption").textContent =
    `${report.highlights[index]!.minute}' ${report.highlights[index]!.text}`;
  send({ type: "speed", scale: speed });
  send({ type: "watch", index });
}

/** Show or hide the controls that only make sense while something is playing. */
function setReelControls(playing: boolean, single = false): void {
  el("pause").classList.toggle("hidden", !playing);
  el("skip").classList.toggle("hidden", !playing || single);
  el("skip-all").classList.toggle("hidden", !playing || single);
}
setReelControls(false);

el("pause").addEventListener("click", () => {
  paused = !paused;
  el("pause").textContent = paused ? "Play" : "Pause";
  el("pause").classList.toggle("primary", !paused);
  send({ type: paused ? "pause" : "resume" });
});

el("skip").addEventListener("click", () => {
  if (paused) {
    paused = false;
    el("pause").textContent = "Pause";
    el("pause").classList.add("primary");
  }
  send({ type: "skip" });
});

el("skip-all").addEventListener("click", () => {
  send({ type: "skipAll" });
});

el("watch-again").addEventListener("click", () => startReel(0));

/* --- the result panel ---------------------------------------------------- */

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

/* --- view controls ------------------------------------------------------- */

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
  el(`speed-${scale}`).addEventListener("click", () => {
    speed = scale;
    for (const other of [1, 2, 4]) el(`speed-${other}`).classList.toggle("on", other === scale);
    send({ type: "speed", scale });
  });
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
