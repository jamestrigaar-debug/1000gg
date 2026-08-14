/* ============================================================================
 * FOOTBALL MANAGER — THE DECISION LAYER
 *
 * This is the game. Everything else — 221 clubs, five thousand players, the
 * carousel, the transfer window — exists so that these cards have weight.
 *
 * The rhythm is 1000goals': you are handed a decision, you pick, the season is
 * simulated in one pass, and you are shown what your choice did to you.
 *
 *   PRE-SEASON   two cards, before a ball is kicked. Tactics, recruitment,
 *                training, the medical room, promises to the boardroom.
 *   END-OF-SEASON  two cards, after the board's verdict. Reacting to what
 *                just happened — a star wanted by a bigger club, a dressing
 *                room that has stopped listening, an academy kid who is ready.
 *
 * EFFECTS ARE REAL. Nothing here is flavour text with a number attached. A
 * card that says you signed a striker calls the transfer market and puts a
 * striker in your squad at a real price; a card that says you drilled the back
 * four moves the defensive rating the match engine reads; a card that says you
 * ran a brutal pre-season raises the injury multiplier every one of your
 * players is rolled against. Each choice returns the sentence describing what
 * actually happened, so the outcome shown is the outcome applied.
 *
 * THE API (`api` passed to every fx):
 *   sign({pos, quality, maxFee})  buy a player — "star" | "solid" | "prospect"
 *   sell("star"|"veteran"|"fringe")  cash in on one
 *   budget(n) / wage(n)           move the transfer or wage budget, in £m
 *   confidence(n)                 board confidence, the thing that sacks you
 *   form(n)                       season-long form swing for the match engine
 *   injuryRisk(mult)              multiplier on every injury roll this season
 *   unit({attack,midfield,defence}, seasons)   rating shifts, in points
 *   tactic(name)                  change your system
 *   youth(n)                      push minutes toward under-21s (board metric)
 *   train(attr, delta)            squad-wide attribute work
 *   facilities({training, youth}) permanent infrastructure
 *   rep(n)                        your own reputation
 *   flag(name, seasons)           narrative state other cards can require
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp, round1 } = MG.util;

  /* ------------------------------- CONTEXT --------------------------------
   * Everything a card's req() and text() can ask about. Built fresh each time
   * a set of cards is drawn. */
  function buildContext(world, club, manager, lastSeason) {
    const squad = club.squad.slice().sort((a, b) => b.overall - a.overall);
    const league = MG.clubs.LEAGUES[club.leagueId];
    const board = club.board;
    const weakest = MG.players.weakestUnit(club.squad);
    const avgAge = squad.length ? squad.reduce((t, p) => t + p.age, 0) / squad.length : 26;
    const star = squad[0];
    const veteran = club.squad.slice().sort((a, b) => b.age - a.age)[0];
    const prospect = club.squad
      .filter((p) => p.age <= 21)
      .sort((a, b) => (b.potential - b.overall) - (a.potential - a.overall))[0];
    const injuredLast = club.squad.filter((p) => (p.season.injured || 0) >= 0.25).length;
    const scorer = club.squad.slice().sort((a, b) => b.season.goals - a.season.goals)[0];

    return {
      season: world.season, year: world.year,
      clubName: club.name, leagueName: league.name, tier: league.tier,
      boardStyle: board.style,
      confidence: Math.round(board.confidence),
      target: board.targets ? board.targets.position : null,
      targetSummary: board.targets ? board.targets.summary : null,
      verdict: board.report ? board.report.verdict : null,
      reportTotal: board.report ? board.report.total : 0,
      position: lastSeason ? lastSeason.position : null,
      promoted: !!(lastSeason && lastSeason.promoted),
      relegated: !!(lastSeason && lastSeason.relegated),
      champion: !!(lastSeason && lastSeason.champion),
      missedTarget: !!(lastSeason && board.targets && lastSeason.position > board.targets.position + 2),
      beatTarget: !!(lastSeason && board.targets && lastSeason.position < board.targets.position - 1),

      budget: club.finances.transferBudget,
      balance: club.finances.balance,
      inDebt: club.finances.balance < 0,
      wageRoom: round1(club.finances.wageBudget - MG.clubs.wageBill(club)),
      overWages: MG.clubs.wageBill(club) > club.finances.wageBudget,

      squadSize: club.squad.length,
      avgAge: round1(avgAge),
      weakUnit: weakest.unit,
      weakPositions: weakest.positions,
      star, veteran, prospect, scorer,
      injuredLast,
      expiring: club.squad.filter((p) => p.contract.years <= 1).length,
      youthCount: club.squad.filter((p) => p.age <= 21).length,

      tactic: manager.tactic,
      managerRep: manager.reputation,
      tenure: manager.tenure,
      traits: manager.traits,
      flags: club.flags || {},
      facilities: club.facilities,

      // How well the system, the shape, the training week and the manager
      // himself agree with each other — see tactics.js. Cards can read this
      // to react to a side that is fighting itself, or one that has clicked.
      synergy: MG.tactics && MG.tactics.synergyScore ? MG.tactics.synergyScore(club, manager) : null,

      // The supporters, so cards can be written about the mood in the ground.
      fans: Math.round(club.fans == null ? 56 : club.fans),
      fanMood: MG.clubs.fanMood(club.fans == null ? 56 : club.fans).label,

      /* The academy's own shortlist — up to two NAMED prospects the coaches
       * think are ready, not a vague "some youngsters are coming through".
       * The YOUTH tab lets you promote anyone at any time; this is the same
       * decision surfacing on its own, the way a real coaching report would
       * land on a manager's desk, so it is not something you only see if you
       * remember to go looking for it. */
      academyReady: (() => {
        if (!MG.youth) return [];
        const academy = MG.youth.ensure(club);
        const level = club.level != null ? club.level : 55;
        return academy.players
          .filter((p) => p.overall >= level - 10 || p.potential >= level + 2)
          .sort((a, b) => (b.potential - b.overall) - (a.potential - a.overall))
          .slice(0, 2);
      })(),
    };
  }

  /* --------------------------------- API ---------------------------------- */
  function makeApi(world, club, manager, ctx) {
    const rng = world.rng;
    const mod = club.modifiers;
    return {
      world, club, manager, ctx, rng,
      sign(opts) { return MG.transfers.findAndSign(world, club, opts || {}); },
      sell(which) { return MG.transfers.sellOne(world, club, which || "fringe"); },
      budget(n) { club.finances.transferBudget = round1(Math.max(0, club.finances.transferBudget + n)); },
      wage(n) { club.finances.wageBudget = round1(Math.max(0, club.finances.wageBudget + n)); },
      cash(n) { club.finances.balance = round1(club.finances.balance + n); },
      confidence(n) { club.board.confidence = clamp(club.board.confidence + n, 0, 100); },
      form(n) { mod.form += n; },
      injuryRisk(mult) { mod.injuryRisk *= mult; },
      unit(shift, seasons) {
        mod.unit.attack += shift.attack || 0;
        mod.unit.midfield += shift.midfield || 0;
        mod.unit.defence += shift.defence || 0;
        mod.unitSeasons = Math.max(mod.unitSeasons, seasons || 1);
        MG.clubs.refreshRatings(club);
      },
      tactic(name) {
        if (!MG.managers.TACTICS[name]) return;
        manager.tactic = name;
        club.tacticalStyle = name;
        world.invalidateProfile(club.id);
      },
      youth(n) { mod.youthBias += n; },
      train(attr, delta) {
        for (const p of club.squad) {
          p.attrs[attr] = clamp(Math.round((p.attrs[attr] || 55) + delta), 20, 99);
        }
      },
      facilities(f) {
        if (f.training) club.facilities.training = clamp(club.facilities.training + f.training, 10, 99);
        if (f.youth) club.facilities.youth = clamp(club.facilities.youth + f.youth, 10, 99);
        if (f.scouting) club.facilities.scouting = clamp((club.facilities.scouting || 50) + f.scouting, 10, 99);
      },
      // Which of the six weekly training focuses the club runs — the report's
      // Performance/Improvement lever (tactics.js). The tactics screen lets
      // the manager set this directly too; this is the same switch.
      trainingFocus(key) { if (MG.tactics && MG.tactics.setTrainingFocus) MG.tactics.setTrainingFocus(club, key); },
      rep(n) { manager.reputation = clamp(manager.reputation + n, 1, 99); },
      /* The supporters. Separate from board confidence on purpose: pleasing the
       * crowd and pleasing the owner are frequently not the same act, and the
       * mood in the ground feeds back into the boardroom at the end of the
       * season anyway (see clubs.evaluateSeason). */
      fans(n, reason) { MG.clubs.fansReact(club, n, reason); },
      clubRep(n) { MG.clubs.adjustReputation ? MG.clubs.adjustReputation(club, n) : (club.reputation = clamp(club.reputation + n, 1, 99)); },
      flag(name, seasons) { club.flags[name] = seasons || 2; },
      money(n) {
        const a = Math.abs(n);
        if (a >= 10) return `£${Math.round(a)}m`;
        if (a >= 0.1) return `£${a.toFixed(1)}m`;
        return `£${Math.round(a * 1000)}k`;
      },
    };
  }

  /* ---------------------------- PRE-SEASON CARDS --------------------------- */
  const PRESEASON = [
    /* ---- TACTICS ---- */
    {
      id: "pre_system", category: "TACTICS", weight: 10,
      text: (c) => `Pre-season. ${c.clubName} report back, and the first thing they want to know is how you intend to play.`,
      choices: (c) => {
        const alt = Object.keys(MG.managers.TACTICS).filter((t) => t !== c.tactic);
        const a = alt[0], b = alt[1];
        return [
          { label: `Stick with ${c.tactic}`, detail: "The players know it. No upheaval.",
            fx: (api) => { api.form(1.5); return `The squad reports back into a system it already understands.`; } },
          { label: `Switch to ${a}`, detail: "A new identity, and a summer of confusion.",
            fx: (api) => { api.tactic(a); api.form(-2); api.unit({ midfield: 1 }, 2); return `${api.club.name} will play ${a} from now on. It will take time to bed in.`; } },
          { label: `Switch to ${b}`, detail: "A different gamble entirely.",
            fx: (api) => { api.tactic(b); api.form(-2); api.unit({ attack: 1 }, 2); return `${api.club.name} switch to ${b}. The training ground has a lot of work to do.`; } },
        ];
      },
    },
    {
      id: "pre_shape", category: "TACTICS", weight: 8,
      text: (c) => `Your ${c.weakUnit} is the weakest part of this side. You can build the pre-season around fixing it.`,
      choices: (c) => [
        { label: `Drill the ${c.weakUnit} relentlessly`, detail: "Gains where you need them, at the cost of everything else.",
          fx: (api) => {
            const shift = {}; shift[api.ctx.weakUnit === "keeper" ? "defence" : api.ctx.weakUnit] = 3;
            api.unit(shift, 1); api.form(-0.5);
            return `Weeks of work on the ${api.ctx.weakUnit}. It is visibly sharper; the rest of the side is a little stale.`;
          } },
        { label: "Balanced preparation", detail: "No weaknesses fixed, no strengths dulled.",
          fx: (api) => { api.form(1); return `A conventional pre-season. Nothing transformed, nothing broken.`; } },
        { label: "Double down on what you are good at", detail: "Lean into the strength and live with the flaw.",
          fx: (api) => {
            const strong = api.ctx.weakUnit === "attack" ? "defence" : "attack";
            const shift = {}; shift[strong] = 3; shift[api.ctx.weakUnit === "keeper" ? "defence" : api.ctx.weakUnit] = -1;
            api.unit(shift, 1);
            return `You sharpen the ${strong} and accept the ${api.ctx.weakUnit} for what it is.`;
          } },
      ],
    },

    /* ---- RECRUITMENT ---- */
    {
      id: "pre_marquee", category: "TRANSFERS", weight: 10, req: (c) => c.budget >= 8,
      text: (c) => `You have ${c.budget >= 40 ? "serious" : "some"} money to spend — ${fmt(c.budget)} of it. The recruitment meeting is waiting.`,
      choices: (c) => [
        { label: "Break the bank on one marquee signing", detail: "One player who changes the level of the team.",
          fx: (api) => {
            const s = api.sign({ quality: "star" });
            if (!s) return `Nobody of that calibre would come. The money stays in the bank.`;
            api.confidence(3);
            return `${s.player.name} (${s.player.pos}, ${s.player.age}, ${Math.round(s.player.overall)}) signs from ${s.from} for ${api.money(s.fee)}. The fans are delighted.`;
          } },
        { label: "Two solid additions instead", detail: "Depth over headlines.",
          fx: (api) => {
            const a = api.sign({ quality: "solid" });
            const b = api.sign({ quality: "solid" });
            const got = [a, b].filter(Boolean);
            if (!got.length) return `The market moved too fast. You end up with nobody.`;
            return got.map((s) => `${s.player.name} (${s.player.pos}, ${Math.round(s.player.overall)}) arrives from ${s.from} for ${api.money(s.fee)}.`).join(" ");
          } },
        { label: "Sign a prospect and bank the rest", detail: "One for the future, money kept back.",
          fx: (api) => {
            const s = api.sign({ quality: "prospect" });
            api.confidence(-1);
            if (!s) return `No prospect worth the gamble. The budget goes untouched — the board will notice that.`;
            return `${s.player.name} (${s.player.pos}, ${s.player.age}, potential ${Math.round(s.player.potential)}) joins from ${s.from} for ${api.money(s.fee)}. One for two years' time.`;
          } },
      ],
    },
    {
      id: "pre_hole", category: "TRANSFERS", weight: 9, req: (c) => c.budget >= 4,
      text: (c) => `The scouting department is unanimous: the ${c.weakUnit} needs a body, not a training drill.`,
      choices: (c) => [
        { label: `Sign a ${posName(c.weakPositions[0])}`, detail: "Fix the hole with a transfer.",
          fx: (api) => {
            const s = api.sign({ pos: api.ctx.weakPositions[0], quality: "solid" });
            if (!s) return `Nothing available in budget. The hole stays a hole.`;
            return `${s.player.name} (${Math.round(s.player.overall)}) arrives from ${s.from} for ${api.money(s.fee)} to shore up the ${api.ctx.weakUnit}.`;
          } },
        { label: "Promote from the academy instead", detail: "Free, unproven, and the board likes it.",
          fx: (api) => { api.youth(0.12); api.confidence(2); api.form(-1); return `A teenager is thrown in at the deep end. The board approve of the principle, if not the risk.`; } },
        { label: "Trust the players you have", detail: "No signing, no money spent.",
          fx: (api) => { api.budget(0); api.confidence(1); return `No signing. You back the group — and the wage bill stays where the board wants it.`; } },
      ],
    },
    {
      id: "pre_sell_star", category: "TRANSFERS", weight: 7,
      req: (c) => c.star && c.star.value >= 15 && (c.inDebt || c.budget < 10),
      text: (c) => `A bigger club is sniffing around ${c.star.name}. Your board would like the money. You would like the player.`,
      choices: (c) => [
        { label: `Cash in on ${c.star.name}`, detail: `Worth about ${fmt(c.star.value)}. It solves the finances.`,
          fx: (api) => {
            const s = api.sell("star");
            if (!s) return `The bid never came. He stays, for now.`;
            api.confidence(4); api.form(-2);
            return `${s.player.name} joins ${s.to} for ${api.money(s.fee)}. The board are thrilled. The dressing room is quieter.`;
          } },
        { label: "Refuse to sell", detail: "Keep your best player, keep the pressure.",
          fx: (api) => { api.confidence(-4); api.form(1.5); api.rep(1); return `You tell the board he is not for sale. They are not pleased — but the squad noticed you fought for him.`; } },
        { label: "Sell a squad player instead", detail: "Raise something without gutting the team.",
          fx: (api) => {
            const s = api.sell("fringe");
            if (!s) return `Nobody wants the players you are willing to lose.`;
            api.confidence(1);
            return `${s.player.name} moves to ${s.to} for ${api.money(s.fee)}. A compromise nobody objects to.`;
          } },
      ],
    },
    {
      id: "pre_veteran", category: "TRANSFERS", weight: 6, req: (c) => c.veteran && c.veteran.age >= 33,
      text: (c) => `${c.veteran.name} is ${c.veteran.age} now, on good money, and no longer the player he was.`,
      choices: (c) => [
        { label: "Move him on", detail: "Free the wage, lose the voice.",
          fx: (api) => {
            const s = api.sell("veteran");
            if (!s) return `No takers at his age and wage. He stays.`;
            api.wage(2); api.form(-0.5);
            return `${s.player.name} leaves for ${s.to}. ${api.money(s.fee)} in, and his wage off the bill.`;
          } },
        { label: "Keep him as a leader", detail: "He organises the dressing room.",
          fx: (api) => { api.form(1.5); api.unit({ defence: 1 }, 1); return `He stays as the senior voice. The younger players are visibly better for it.`; } },
        { label: "Make him a player-coach", detail: "Fewer minutes, more influence on the kids.",
          fx: (api) => { api.facilities({ training: 2 }); api.youth(0.06); return `He takes on coaching duties. The academy sessions are sharper than they were.`; } },
      ],
    },

    /* ---- MEDICAL ---- */
    {
      id: "pre_fitness", category: "MEDICAL", weight: 9,
      text: (c) => `The head of sports science wants a decision on the pre-season load${c.injuredLast >= 4 ? " — last year's injury list was brutal" : ""}.`,
      choices: (c) => [
        { label: "Brutal running camp", detail: "Fitter, faster, and more likely to break.",
          fx: (api) => { api.train("fitness", 2); api.form(2); api.injuryRisk(1.35); return `Three weeks of hell in the hills. They come back fit — and the physio is already worried.`; } },
        { label: "Measured build-up", detail: "The safe, sensible programme.",
          fx: (api) => { api.train("fitness", 1); return `A conventional build-up. No heroics, no casualties.`; } },
        { label: "Load management from day one", detail: "Protect the bodies, lose a little sharpness.",
          fx: (api) => { api.injuryRisk(0.7); api.form(-1); return `Everything is measured and monitored. They will be available in April, if a little flat in August.`; } },
      ],
    },
    {
      id: "pre_medical_staff", category: "MEDICAL", weight: 6, req: (c) => c.injuredLast >= 3 || c.budget >= 6,
      text: (c) => `The medical department is understaffed and it is showing. Fixing it costs money that could buy a player.`,
      choices: (c) => [
        { label: "Rebuild the medical team", detail: "Spend now, break down less for years.",
          fx: (api) => { api.budget(-6); api.injuryRisk(0.72); api.facilities({ training: 3 }); return `New physios, new equipment, ${api.money(6)} off the transfer budget. The treatment room should be emptier from here.`; } },
        { label: "Patch it up cheaply", detail: "A small improvement, most of the money kept.",
          fx: (api) => { api.budget(-1.5); api.injuryRisk(0.9); return `A modest upgrade. Better than nothing, and the budget survives.`; } },
        { label: "Spend it on the pitch instead", detail: "Players win points; physios do not.",
          fx: (api) => { api.injuryRisk(1.15); api.budget(2); return `The medical room waits another year. You will find out in February whether that was clever.`; } },
      ],
    },

    /* ---- BOARDROOM ---- */
    {
      id: "pre_promise", category: "BOARDROOM", weight: 9,
      text: (c) => `The board want a commitment before the season starts. Their brief: ${c.targetSummary}.`,
      choices: (c) => [
        { label: "Promise to beat it", detail: "Buys goodwill and money now. Costs you everything if you miss.",
          fx: (api) => { api.confidence(8); api.budget(api.club.finances.revenue * 0.08); api.flag("promised", 2); return `You look them in the eye and promise better. They release more money — and they will remember this in May.`; } },
        { label: "Manage expectations down", detail: "Less pressure, less faith.",
          fx: (api) => { api.confidence(-5); api.flag("cautious", 2); return `You spend the meeting explaining how hard this will be. They listen, and they trust you slightly less.`; } },
        { label: "Say nothing and go to work", detail: "No promises either way.",
          fx: (api) => { api.rep(1); return `You decline to make predictions. The board find it either admirable or evasive.`; } },
      ],
    },
    {
      id: "pre_wages", category: "BOARDROOM", weight: 7, req: (c) => c.overWages || c.wageRoom < 5,
      text: (c) => `The wage bill is above what the board budgeted. The finance director wants it addressed before the window shuts.`,
      choices: (c) => [
        { label: "Cut it — move someone on", detail: "The finance metric is a fifth of your review.",
          fx: (api) => {
            const s = api.sell("fringe");
            api.confidence(3);
            return s ? `${s.player.name} goes to ${s.to} for ${api.money(s.fee)} and his wage goes with him.` : `You trim what you can. The board appreciate the effort more than the result.`;
          } },
        { label: "Argue for more room", detail: "Ask them to fund the squad you actually have.",
          fx: (api) => { api.wage(6); api.confidence(-4); return `They grant the extra room, and file it under things you owe them.`; } },
        { label: "Ignore it", detail: "Football first. Accounts later.",
          fx: (api) => { api.confidence(-2); api.flag("overspending", 3); return `You leave the meeting without agreeing to anything. It will come up again in May.`; } },
      ],
    },

    /* ---- DRESSING ROOM / ROLEPLAY ---- */
    {
      id: "pre_captain", category: "DRESSING ROOM", weight: 8,
      text: (c) => `The armband is yours to give. It is a smaller decision than the press think, and a bigger one than the squad admits.`,
      choices: (c) => [
        { label: c.veteran ? `Give it to ${c.veteran.name}` : "Give it to the senior pro", detail: "Experience, authority, one eye on the past.",
          fx: (api) => { api.form(1.5); api.unit({ defence: 1 }, 1); return `The senior man takes the armband. The back line looks better organised for it.`; } },
        { label: c.star ? `Give it to ${c.star.name}` : "Give it to your best player", detail: "Leadership by performance.",
          fx: (api) => { api.form(1); api.unit({ attack: 1 }, 1); return `Your best player takes it and responds by playing like he means it.`; } },
        { label: c.prospect ? `Give it to ${c.prospect.name}` : "Give it to a young player", detail: "A statement about where this club is going.",
          fx: (api) => { api.youth(0.1); api.rep(2); api.form(-0.5); return `A bold call. The academy takes note; a few senior players do not like it.`; } },
      ],
    },
    {
      id: "pre_discipline", category: "DRESSING ROOM", weight: 7,
      text: (c) => `You set the standards on day one, and the squad will test every one of them.`,
      choices: (c) => [
        { label: "Rule with an iron fist", detail: "Fines, curfews, no arguments.",
          fx: (api) => { api.unit({ defence: 2 }, 1); api.form(-0.5); return `Discipline is total. They are organised and slightly joyless.`; } },
        { label: "Player-led culture", detail: "Trust them and let them police themselves.",
          fx: (api) => { api.form(2); api.injuryRisk(1.08); return `The senior players run the dressing room. Morale is excellent; the standards vary.`; } },
        { label: "Ruthless meritocracy", detail: "Nobody is guaranteed anything.",
          fx: (api) => { api.form(1); api.unit({ attack: 1 }, 1); api.confidence(-1); return `Places are earned weekly. It sharpens the good ones and unsettles the rest.`; } },
      ],
    },

    /* ---- YOUTH ---- */
    {
      id: "pre_academy", category: "YOUTH", weight: 8, req: (c) => c.youthCount >= 1,
      text: (c) => `The academy director wants to know how much of the first team is genuinely open to his players.`,
      choices: (c) => [
        { label: "Kids play. Properly.", detail: "Real minutes for under-21s. The board's youth metric loves it.",
          fx: (api) => { api.youth(0.16); api.confidence(2); api.form(-1.5); return `The teenagers are in the side. It will cost points in October and might win you years.`; } },
        { label: "One or two, on merit", detail: "A measured pathway.",
          fx: (api) => { api.youth(0.06); return `A couple of them get a genuine chance. The rest wait.`; } },
        { label: "Not this year — results first", detail: "Seniors only.",
          fx: (api) => { api.youth(-0.04); api.form(1); api.confidence(-2); return `The academy can wait. The board note the youth column will read badly.`; } },
      ],
    },
    {
      id: "pre_academy_promote", category: "YOUTH", weight: 9, req: (c) => c.academyReady && c.academyReady.length > 0,
      text: (c) => {
        const names = c.academyReady.map((p) => `${p.name} (${p.pos}, ${p.age})`).join(" and ");
        return c.academyReady.length > 1
          ? `The academy coaches bring you a shortlist: ${names}. Either is ready for a first-team squad number, they say.`
          : `The academy coaches want a decision on ${names}. He has trained with the seniors all pre-season and, in their words, has nothing left to prove down there.`;
      },
      choices: (c) => {
        const opts = c.academyReady.map((p) => ({
          label: `Promote ${p.name}`,
          detail: `${p.pos}, ${p.age} · coaches see him reaching ${p.scouted ? `${p.scouted.floor}–${p.scouted.ceiling}` : Math.round(p.potential)}`,
          fx: (api) => {
            const promoted = MG.youth.promote(api.club, p.id);
            if (!promoted) return `${p.name} was moved up before this conversation even finished. Already done.`;
            api.confidence(1); api.youth(0.05);
            return `${promoted.name} (${promoted.pos}, ${promoted.age}) is promoted to the first-team squad — the academy staff call it his time.`;
          },
        }));
        opts.push({
          label: "Leave them in the academy", detail: "Another year of academy football rather than the first-team squad.",
          fx: () => `You tell the coaches to be patient. Whoever it was stays in the academy a while longer.`,
        });
        return opts;
      },
    },
    {
      id: "pre_facilities", category: "YOUTH", weight: 5, req: (c) => c.budget >= 10,
      text: (c) => `There is a proposal on the table to rebuild the training ground. It will not help you this season.`,
      choices: (c) => [
        { label: "Fund it out of the transfer budget", detail: "Years of better development, one weaker window.",
          fx: (api) => { api.budget(-10); api.facilities({ training: 6, youth: 5 }); return `${api.money(10)} into concrete and grass. Every player at this club will develop faster from now on.`; } },
        { label: "Half measures", detail: "A partial upgrade.",
          fx: (api) => { api.budget(-4); api.facilities({ training: 2, youth: 2 }); return `A modest refit. Better pitches, at least.`; } },
        { label: "Reject it", detail: "Spend on players who play now.",
          fx: (api) => { api.confidence(-1); return `The plans go back in the drawer. Your successor may find them.`; } },
      ],
    },

    /* ---- FINANCE ---- */
    {
      id: "pre_sponsor", category: "FINANCE", weight: 7,
      text: (c) => `A sponsor has come in with an offer — more money than the club is used to, and more strings than the fans would like.`,
      choices: (c) => [
        { label: "Take the big commercial deal", detail: "Money now, a badge on everything.",
          fx: (api) => { const g = round1(api.club.finances.revenue * 0.09 + 4); api.cash(g); api.budget(g * 0.6); return `The deal is signed. ${api.money(g)} arrives, and some of it reaches the transfer budget. The shirt looks busier.`; } },
        { label: "A modest, cleaner partnership", detail: "Less money, fewer obligations.",
          fx: (api) => { api.cash(3); api.rep(1); return `A smaller, quieter deal. The accountants are content and nobody in the stands complains.`; } },
        { label: "Turn it down on principle", detail: "Keep the club's identity intact.",
          fx: (api) => { api.rep(2); api.confidence(-2); return `You walk away from the money. The supporters notice; the finance director does not thank you.`; } },
      ],
    },
    {
      id: "pre_bargain", category: "TRANSFERS", weight: 7, req: (c) => c.budget >= 0.5 && c.budget < 12,
      text: (c) => `You cannot afford a marquee fix for the ${c.weakUnit}, but the bargain bin is full — cut-price deals and cast-offs for those willing to dig.`,
      choices: (c) => [
        { label: `Find a cut-price ${posName(c.weakPositions[0])}`, detail: "Cheap, serviceable, available now.",
          fx: (api) => { const s = api.sign({ pos: api.ctx.weakPositions[0], quality: "solid", maxFee: 4 }); return s ? `${s.player.name} (${Math.round(s.player.overall)}) arrives from ${s.from} for just ${api.money(s.fee)} — hardly glamorous, but he fills the ${api.ctx.weakUnit}.` : `Even the bargains were beyond you this window. The ${api.ctx.weakUnit} goes uncovered.`; } },
        { label: "Gamble on a cheap young prospect", detail: "Low fee, high upside.",
          fx: (api) => { const s = api.sign({ quality: "prospect", maxFee: 4 }); api.youth(0.05); return s ? `${s.player.name} (${s.player.age}, potential ${Math.round(s.player.potential)}) joins for ${api.money(s.fee)}. A punt worth taking at that price.` : `The prospects you liked cost more than you had. Nothing doing.`; } },
        { label: "Spend nothing — build from within", detail: "Trust the squad and the academy.",
          fx: (api) => { api.youth(0.06); api.form(0.5); return `You keep the money in your pocket. The younger players get the minutes a signing would have taken.`; } },
      ],
    },
    {
      id: "pre_setpiece", category: "TACTICS", weight: 6,
      text: (c) => `A specialist set-piece coach is available. Cheap goals and cheap concessions are decided in these moments, and you have ignored them for too long.`,
      choices: (c) => [
        { label: "Hire him — attack the box", detail: "Goals from dead balls.",
          fx: (api) => { api.unit({ attack: 2 }, 2); api.budget(-1.5); return `Corners and free-kicks become a weapon. It will win you a game or two you had no right to.`; } },
        { label: "Hire him — defend the box", detail: "Stop leaking soft goals.",
          fx: (api) => { api.unit({ defence: 2 }, 2); api.budget(-1.5); return `The back post is manned properly now. The soft goals dry up.`; } },
        { label: "Coach it yourself for free", detail: "Save the money, spread yourself thinner.",
          fx: (api) => { api.unit({ attack: 1, defence: 1 }, 1); return `You take the sessions personally. A marginal gain at both ends, and one more plate spinning.`; } },
      ],
    },
    {
      id: "pre_gametime", category: "DRESSING ROOM", weight: 7, req: (c) => c.star,
      text: (c) => `${c.star.name} has asked, privately, for assurances about his role before he commits to the season.`,
      choices: (c) => [
        { label: "Guarantee him the team", detail: "Keep your best player happy.",
          fx: (api) => { api.form(2); api.unit({ attack: 1 }, 1); api.confidence(-1); return `You promise him the shirt. He is all-in — and the players behind him have heard.`; } },
        { label: "Tell him to earn it like everyone else", detail: "Standards over stars.",
          fx: (api) => { api.form(-1); api.unit({ midfield: 1 }, 1); api.rep(1); return `Nobody is guaranteed anything, you tell him. He bristles, then trains like a man with a point to prove.`; } },
        { label: "Find a compromise on his role", detail: "Manage him, don't fight him.",
          fx: (api) => { api.form(1); return `A quiet conversation and a clear role. He knows where he stands, and so does the group.`; } },
      ],
    },
    {
      id: "pre_owner_vanity", category: "BOARDROOM", weight: 6, req: (c) => c.boardStyle === "Aggressive" || c.boardStyle === "Chaotic",
      text: (c) => `The owner wants a name — someone to sell shirts and make a statement — more than he wants a plan.`,
      choices: (c) => [
        { label: "Indulge him with a marquee signing", detail: "A statement, funded from above.",
          fx: (api) => { api.budget(api.club.finances.revenue * 0.1); const s = api.sign({ quality: "star" }); api.confidence(4); return s ? `${s.player.name} (${Math.round(s.player.overall)}) is unveiled to a packed house. The owner is beaming; the fee was mostly his money.` : `The names you chased all said no. The owner is unimpressed, the budget intact.`; } },
        { label: "Talk him into a smarter buy", detail: "Spend his enthusiasm well.",
          fx: (api) => { const s = api.sign({ quality: "solid" }); api.rep(1); return s ? `You steer him toward ${s.player.name} (${Math.round(s.player.overall)}) from ${s.from} — a better player than the one he wanted, for less.` : `You argue for restraint and end up signing nobody. He wanted a party.`; } },
        { label: "Refuse to sign for the sake of it", detail: "Protect the wage structure.",
          fx: (api) => { api.confidence(-4); api.rep(2); api.wage(3); return `You tell him no. The wage structure survives; his goodwill takes a hit.`; } },
      ],
    },

    /* ---- MEDIA ---- */
    {
      id: "pre_tour", category: "MEDIA", weight: 6,
      text: (c) => `Pre-season is a choice: a lucrative overseas tour, or a quiet, focused camp at home.`,
      choices: (c) => [
        { label: "The commercial tour", detail: "Money and jet lag.",
          fx: (api) => { api.cash(5); api.rep(1); api.form(-1); api.injuryRisk(1.1); return `Three continents in two weeks. ${api.money(5)} banked, and a squad that comes back tired.`; } },
        { label: "A hard training camp", detail: "Fitness over air miles.",
          fx: (api) => { api.train("fitness", 1); api.form(1.5); return `A fortnight of double sessions in the hills. No money made, but they are ready.`; } },
        { label: "A balanced pre-season", detail: "A little of both.",
          fx: (api) => { api.cash(2); api.form(0.5); return `One friendly abroad, the rest at home. Modest money, no disruption.`; } },
      ],
    },
  ];

  /* -------------------------- END-OF-SEASON CARDS -------------------------- */
  const ENDSEASON = [
    /* ---- BOARDROOM ---- */
    {
      id: "end_review", category: "BOARDROOM", weight: 10,
      text: (c) => `The end-of-season review. The board's verdict was ${(c.verdict || "mixed").toLowerCase()}, and now they want to hear from you.`,
      variants: [
        (c) => `The end-of-season review. The board's verdict was ${(c.verdict || "mixed").toLowerCase()}, and now they want to hear from you.`,
        (c) => `A long table, a short agenda, and ${(c.verdict || "a mixed season").toLowerCase()} written at the top of it. The floor is yours.`,
        (c) => `They have read the accounts and watched the season back. "${c.verdict || "Mixed"}", they say, and wait for your answer.`,
        (c) => `Nobody offers you coffee. The verdict on the wall is ${(c.verdict || "mixed").toLowerCase()}, and the room wants to know what you intend to do about it.`,
      ],
      choices: (c) => [
        { label: "Take responsibility", detail: "Own it, whatever it was.",
          fx: (api) => { api.confidence(5); api.rep(-1); return `You take the blame squarely. They respect it, and file it away.`; } },
        { label: "Point at the budget", detail: "Tell them what this squad actually cost.",
          fx: (api) => { api.budget(api.club.finances.revenue * 0.07); api.confidence(-4); return `You make the financial argument. More money next year — and less patience with you.`; } },
        { label: "Demand backing to go further", detail: "Attack the meeting.",
          fx: (api) => { api.budget(api.club.finances.revenue * 0.12); api.confidence(-7); api.flag("promised", 2); return `You ask for real money and get some of it. The expectation that comes with it is entirely yours now.`; } },
      ],
    },
    {
      id: "end_ultimatum", category: "BOARDROOM", weight: 9, req: (c) => c.confidence < 42,
      text: (c) => `You are one bad season from the sack and everyone in the building knows it.`,
      choices: (c) => [
        { label: "Ask for one more year and mean it", detail: "Stake everything on next season.",
          fx: (api) => { api.confidence(9); api.budget(-api.club.finances.transferBudget * 0.3); api.flag("last_chance", 1); return `They give you the season. They also quietly cut what you can spend on it.`; } },
        { label: "Offer to walk if you miss the target", detail: "A public gamble.",
          fx: (api) => { api.confidence(12); api.budget(api.club.finances.revenue * 0.1); api.flag("on_the_line", 1); return `You put your job on the record. The money arrives immediately; so does the pressure.`; } },
        { label: "Say nothing and hope", detail: "Let it lie.",
          fx: (api) => { api.confidence(-2); return `The meeting ends without commitments on either side.`; } },
      ],
    },

    /* ---- TRANSFERS ---- */
    {
      id: "end_bid", category: "TRANSFERS", weight: 10, req: (c) => c.star && c.star.value >= 12,
      text: (c) => `A club above you has made a formal approach for ${c.star.name} (${Math.round(c.star.overall)}). The offer is real money.`,
      variants: [
        (c) => `A club above you has made a formal approach for ${c.star.name} (${Math.round(c.star.overall)}). The offer is real money.`,
        (c) => `${c.star.name}'s agent has been photographed in a hotel lobby three hundred miles from here. The bid arrives the same afternoon.`,
        (c) => `A fax, an offer and a deadline: somebody wants ${c.star.name}, and they want an answer this week.`,
        (c) => `The chairman forwards you an email he was not supposed to forward. They have bid for ${c.star.name}, and it is a serious number.`,
      ],
      choices: (c) => [
        { label: "Accept and reinvest", detail: "Take the fee, rebuild with it.",
          fx: (api) => {
            const s = api.sell("star");
            if (!s) return `The bid evaporated before you could answer it.`;
            const bought = api.sign({ quality: "solid" });
            api.confidence(3);
            return `${s.player.name} joins ${s.to} for ${api.money(s.fee)}.` + (bought ? ` ${bought.player.name} (${Math.round(bought.player.overall)}) comes in from ${bought.from} for ${api.money(bought.fee)}.` : ` The money stays in the bank for now.`);
          } },
        { label: "Reject it flatly", detail: "He is going nowhere.",
          fx: (api) => { api.confidence(-5); api.form(1); api.rep(2); return `You reject it in public. He stays, the squad believes you, and the board have opinions.`; } },
        { label: "Demand a fee nobody would pay", detail: "Say yes without saying yes.",
          fx: (api) => { api.confidence(-1); api.flag("valuation_standoff", 2); return `You name an absurd number. They walk away — this year.`; } },
      ],
    },
    {
      id: "end_rebuild", category: "TRANSFERS", weight: 8, req: (c) => c.relegated || c.missedTarget,
      text: (c) => `${c.relegated ? "Relegation" : "A season below expectations"} demands an answer. The squad you have is the squad that did this.`,
      variants: [
        (c) => `${c.relegated ? "Relegation" : "A season below expectations"} demands an answer. The squad you have is the squad that did this.`,
        (c) => `You watch the last game back twice and reach the same conclusion both times: this group has taken the club as far as it can.`,
        (c) => `${c.relegated ? "Down." : "Short again."} The staff are waiting for you to say what changes, and how much of it.`,
        (c) => `The dressing room after the final whistle told you everything. Some of them have already gone.`,
      ],
      choices: (c) => [
        { label: "Tear it down and start again", detail: "Sell the old, back the young.",
          fx: (api) => {
            const a = api.sell("veteran");
            const b = api.sell("fringe");
            api.youth(0.14); api.form(-2); api.rep(1);
            const gone = [a, b].filter(Boolean);
            return gone.length
              ? `${gone.map((s) => s.player.name).join(" and ")} move on for ${api.money(gone.reduce((t, s) => t + s.fee, 0))}. The rebuild starts now, and it will hurt first.`
              : `You commit to a rebuild, though nobody wanted to buy the players you offered.`;
          } },
        { label: "Keep the group together", detail: "Loyalty, and a chance at redemption.",
          fx: (api) => { api.form(2.5); api.confidence(-2); return `You keep them all. They owe you one, and they know it.`; } },
        { label: "Two experienced signings", detail: "Add know-how, not youth.",
          fx: (api) => {
            const a = api.sign({ quality: "solid" });
            const b = api.sign({ quality: "solid" });
            const got = [a, b].filter(Boolean);
            api.youth(-0.03);
            return got.length ? got.map((s) => `${s.player.name} (${Math.round(s.player.overall)}) in from ${s.from} for ${api.money(s.fee)}.`).join(" ") : `You hunt for experience and find nothing you can afford.`;
          } },
      ],
    },
    {
      id: "end_contract_rebel", category: "TRANSFERS", weight: 7, req: (c) => c.expiring >= 2,
      text: (c) => `${c.expiring} players are into the final year of their contracts. The agents are circling.`,
      choices: (c) => [
        { label: "Renew everyone important", detail: "Security, at a cost to the wage bill.",
          fx: (api) => {
            for (const p of api.club.squad) if (p.contract.years <= 1) p.contract.years = 3;
            api.wage(-4); api.confidence(-2);
            return `The important ones sign again. The wage bill takes the strain.`;
          } },
        { label: "Let them run down and leave", detail: "Free wages, empty squad slots.",
          fx: (api) => { api.wage(5); api.form(-1.5); return `You let the contracts run. The dressing room reads it exactly as it is meant.`; } },
        { label: "Renew the young ones only", detail: "Protect the assets that will grow.",
          fx: (api) => {
            for (const p of api.club.squad) if (p.contract.years <= 1 && p.age <= 24) p.contract.years = 4;
            api.youth(0.05); api.confidence(1);
            return `The kids are tied down long-term. The older ones are told to prove it.`;
          } },
      ],
    },

    /* ---- MEDICAL ---- */
    {
      id: "end_injury_crisis", category: "MEDICAL", weight: 9, req: (c) => c.injuredLast >= 4,
      text: (c) => `${c.injuredLast} of your players spent a serious chunk of the season injured. That is not luck any more, it is a pattern.`,
      choices: (c) => [
        { label: "Overhaul the sports science department", detail: "Money and time into keeping them fit.",
          fx: (api) => { api.budget(-7); api.injuryRisk(0.68); api.facilities({ training: 4 }); return `A wholesale overhaul, ${api.money(7)} of it. The treatment room should look very different.`; } },
        { label: "Sign for depth instead", detail: "Accept the injuries and cover them.",
          fx: (api) => {
            const s = api.sign({ quality: "solid" });
            return s ? `${s.player.name} (${Math.round(s.player.overall)}) arrives from ${s.from} for ${api.money(s.fee)} — insurance rather than a first choice.` : `You look for cover and find none you can afford.`;
          } },
        { label: "Blame the fixture list", detail: "Do nothing, publicly.",
          fx: (api) => { api.injuryRisk(1.1); api.rep(-1); return `You tell the press it was congestion. Nothing changes internally.`; } },
      ],
    },

    /* ---- DRESSING ROOM / ROLEPLAY ---- */
    {
      id: "end_bustup", category: "DRESSING ROOM", weight: 8, req: (c) => c.reportTotal < -0.1 || c.missedTarget,
      text: (c) => `Two senior players had a stand-up row after the last game of the season. It has reached the papers.`,
      choices: (c) => [
        { label: "Sell one of them", detail: "Draw a line, publicly.",
          fx: (api) => {
            const s = api.sell("veteran");
            api.form(1.5); api.rep(1);
            return s ? `${s.player.name} is moved on to ${s.to} for ${api.money(s.fee)}. The message lands.` : `You try to move one on and find no buyer. The row festers.`;
          } },
        { label: "Bang heads together behind closed doors", detail: "Deal with it internally.",
          fx: (api) => { api.form(1); api.unit({ midfield: 1 }, 1); return `An hour in a locked room. Whatever was said, they played like a team afterwards.`; } },
        { label: "Let them fight it out", detail: "Some squads need the edge.",
          fx: (api) => { api.form(-1); api.unit({ attack: 2 }, 1); return `You let it burn. It is a nastier dressing room now, and a sharper one going forward.`; } },
      ],
    },
    {
      id: "end_media", category: "MEDIA", weight: 7,
      text: (c) => `The end-of-season press conference. ${c.beatTarget ? "They want to know how far this can go." : c.missedTarget ? "They want to know why it went wrong." : "They want a headline."}`,
      variants: [
        (c) => `The end-of-season press conference. ${c.beatTarget ? "They want to know how far this can go." : c.missedTarget ? "They want to know why it went wrong." : "They want a headline."}`,
        (c) => `Thirty recorders on the table and one question underneath all of them: what actually happened this year?`,
        (c) => `A local reporter opens with something sharper than usual, and the room leans in.`,
        (c) => `The season is over and the microphones are still on. Whatever you say next gets printed in full.`,
      ],
      choices: (c) => [
        { label: "Talk up the project", detail: "Sell the vision.",
          fx: (api) => { api.rep(3); api.confidence(2); api.flag("hyped", 2); return `You paint a picture of where this club is going. It plays well — and raises the bar.`; } },
        { label: "Defend the players publicly", detail: "Take the bullets for them.",
          fx: (api) => { api.form(2); api.rep(-1); api.confidence(-1); return `You absorb every question yourself. The squad reads every word of it.`; } },
        { label: "Criticise the squad's mentality", detail: "Call it out in the open.",
          fx: (api) => { api.form(-2); api.rep(1); api.confidence(3); return `You say what you actually think. The board nod along; the dressing room does not.`; } },
      ],
    },
    {
      id: "end_offer", category: "MEDIA", weight: 6, req: (c) => c.managerRep >= 45 && (c.beatTarget || c.champion || c.promoted),
      text: (c) => `Word reaches you that a bigger club has been asking about your availability.`,
      choices: (c) => [
        { label: "Let it be known you are listening", detail: "Leverage — and a nervous boardroom.",
          fx: (api) => { api.rep(4); api.confidence(-6); api.budget(api.club.finances.revenue * 0.06); return `The story runs. Your board panic slightly and open the chequebook to keep you.`; } },
        { label: "Publicly commit to this club", detail: "Loyalty, banked.",
          fx: (api) => { api.confidence(10); api.form(1.5); return `You end the speculation in one sentence. The board and the terraces both hear it.`; } },
        { label: "Say nothing at all", detail: "Keep every door open.",
          fx: (api) => { api.rep(2); api.confidence(-2); return `You refuse to engage. The story runs anyway.`; } },
      ],
    },

    /* ---- YOUTH ---- */
    {
      id: "end_prospect", category: "YOUTH", weight: 8, req: (c) => c.prospect && c.prospect.potential - c.prospect.overall >= 8,
      text: (c) => `${c.prospect.name} is ${c.prospect.age} and the coaching staff think he is the real thing. Bigger clubs think so too.`,
      choices: (c) => [
        { label: "Build the team around him", detail: "Minutes now, whatever it costs.",
          fx: (api) => { api.youth(0.15); api.confidence(2); api.form(-1); return `He is in the side from August. He will make mistakes and he will get better for them.`; } },
        { label: "Sell him for a fortune", detail: "Cash in before he is anyone else's.",
          fx: (api) => {
            const p = api.ctx.prospect;
            api.cash(p.value * 2.2); api.budget(p.value * 1.6); api.club.squad = api.club.squad.filter((x) => x.id !== p.id);
            MG.clubs.refreshRatings(api.club);
            api.confidence(5); api.rep(-2);
            return `${p.name} is sold for ${api.money(p.value * 2.2)} before he has played fifty games. The accountants are delighted.`;
          } },
        { label: "Loan him out to toughen him up", detail: "A year in the lower leagues.",
          fx: (api) => { api.youth(-0.02); api.facilities({ youth: 2 }); return `He goes out on loan. He will come back a man, or he will not come back at all.`; } },
      ],
    },

    /* ---- TACTICS ---- */
    {
      id: "end_tactical_review", category: "TACTICS", weight: 7,
      text: (c) => `You watched every minute back. ${c.tactic} got you ${c.position ? ordinal(c.position) : "here"} — the question is whether it can get you further.`,
      choices: (c) => {
        const alt = Object.keys(MG.managers.TACTICS).filter((t) => t !== c.tactic);
        return [
          { label: "Refine it — same system, sharper", detail: "Evolution.",
            fx: (api) => { api.unit({ midfield: 2, attack: 1 }, 2); return `The system stays and gets more detailed. They know it inside out now.`; } },
          { label: `Move to ${alt[0]}`, detail: "A genuine change of identity.",
            fx: (api) => { api.tactic(alt[0]); api.form(-2); api.unit({ attack: 2 }, 2); return `A new way of playing, and a summer of unlearning the old one.`; } },
          { label: "Build a second system", detail: "Flexibility, at the cost of mastery.",
            fx: (api) => { api.unit({ attack: 1, midfield: 1, defence: 1 }, 2); api.form(-1); return `Two shapes, drilled in parallel. Harder to prepare for, harder to perfect.`; } },
        ];
      },
    },
    {
      id: "end_synergy_review", category: "TACTICS", weight: 7, req: (c) => !!c.synergy,
      text: (c) => c.synergy.clash
        ? `The staff's honest verdict on how this club is put together: the system, the shape, the training week and your own instincts are not agreeing with each other, and it shows on the pitch.`
        : c.synergy.aligned
          ? `Everything about how this club is set up points the same way — the staff can see it even on the days the man in the technical area cannot explain why it worked.`
          : `The set-up is coherent enough. Not the smoothest side in the league, not the most chaotic either.`,
      choices: (c) => {
        const best = MG.tactics.TRAINING_FOCUS_KEYS.slice()
          .sort((a, b) => MG.tactics.trainingFit(b, c.tactic) - MG.tactics.trainingFit(a, c.tactic))[0];
        const bestLabel = MG.tactics.TRAINING_FOCUS[best].label;
        const opts = [];
        if (c.synergy.score < 60) {
          opts.push({ label: `Rebuild the training week around ${bestLabel}`, detail: "Training catches up with the system, at a short-term cost.",
            fx: (api) => { api.trainingFocus(best); api.form(-1); return `The week is reorganised around ${bestLabel.toLowerCase()}. It costs a little sharpness while it beds in — the alignment is worth more than the wobble.`; } });
        }
        opts.push({ label: "Trust the staff, leave it alone", detail: "Keep doing what you are doing.",
          fx: (api) => { api.form(0.5); return `Nothing changes. The staff carry on as they were.`; } });
        opts.push({ label: "Trust your own reading over the alignment chart", detail: "Sometimes a contradiction is a feature, not a bug.",
          fx: (api) => { api.confidence(1); api.rep(1); return `You back your own read of the game over what the report says. Either conviction or stubbornness — results will decide which.`; } });
        return opts;
      },
    },
    {
      id: "end_scouting_investment", category: "TACTICS", weight: 6, req: (c) => c.budget >= 2,
      text: (c) => `The chief scout wants a bigger budget — more staff, more games watched in person, better data on the rest of the world. It is a hard thing to show the board a return on.`,
      choices: (c) => [
        { label: "Fund it properly", detail: "A real department, built for years rather than one window.",
          fx: (api) => { api.budget(-3); api.facilities({ scouting: 8 }); return `${api.money(3)} goes into scouts, software and travel. Reports on the rest of the world get sharper from here on.`; } },
        { label: "A modest top-up", detail: "Something, not everything.",
          fx: (api) => { api.budget(-1); api.facilities({ scouting: 3 }); return `A smaller investment. The department is a little better resourced than it was.`; } },
        { label: "Not this year", detail: "The money is needed elsewhere.",
          fx: (api) => { api.confidence(1); return `The scouting budget stays where it is. Somewhere out there, a rival you cannot properly read gets stronger.`; } },
      ],
    },

    /* ---- FINANCE ---- */
    {
      id: "end_windfall", category: "FINANCE", weight: 8, req: (c) => c.champion || c.promoted || c.beatTarget,
      text: (c) => `The season brought money in — prize money, gate receipts, a run that paid. The board want to know where it goes.`,
      choices: (c) => [
        { label: "Straight into the transfer budget", detail: "Push on while it's good.",
          fx: (api) => { api.budget(api.club.finances.revenue * 0.14); api.confidence(2); return `You reinvest the lot. Next summer's window will be your biggest yet.`; } },
        { label: "Into the training ground", detail: "Compound the advantage for years.",
          fx: (api) => { api.facilities({ training: 5, youth: 4 }); api.confidence(1); return `The money goes into concrete and coaching. Every player who comes through here benefits now.`; } },
        { label: "Bank it against a rainy day", detail: "The board's finance metric approves.",
          fx: (api) => { api.cash(api.club.finances.revenue * 0.12); api.confidence(4); return `You put it away. The board sleep easier, and so does the wage bill.`; } },
      ],
    },
    {
      id: "end_debt", category: "FINANCE", weight: 9, req: (c) => c.inDebt,
      text: (c) => `The books are in the red and the board have stopped asking politely. Something has to give.`,
      choices: (c) => [
        { label: "Cash in on your biggest asset", detail: "Solve it in one sale.",
          fx: (api) => { const s = api.sell("star"); api.confidence(3); return s ? `${s.player.name} is sold to ${s.to} for ${api.money(s.fee)}. The hole in the accounts closes; the one in the team opens.` : `You offer your best player and, remarkably, nobody meets the price. The debt remains.`; } },
        { label: "Sell two squad players and trim wages", detail: "Death by a thousand cuts.",
          fx: (api) => { const a = api.sell("fringe"); const b = api.sell("veteran"); api.wage(4); const g = [a, b].filter(Boolean); return g.length ? `${g.map((s) => s.player.name).join(" and ")} move on for ${api.money(g.reduce((t, s) => t + s.fee, 0))}. The wage bill comes down with them.` : `You try to trim the squad and find no takers. The board are not amused.`; } },
        { label: "Refuse to sell and demand patience", detail: "Bet your job on it coming good.",
          fx: (api) => { api.confidence(-8); api.flag("last_chance", 1); return `You tell them the squad stays. It is the bravest thing you have said all year, and possibly the last.`; } },
      ],
    },

    /* ---- DRESSING ROOM ---- */
    {
      id: "end_unsettled", category: "DRESSING ROOM", weight: 8, req: (c) => c.star && c.star.overall >= 78,
      text: (c) => `${c.star.name} has let it be known, through his agent, that he thinks he has outgrown the club.`,
      choices: (c) => [
        { label: "Sell him at the peak of his value", detail: "Take the money while it's there.",
          fx: (api) => { const s = api.sell("star"); api.budget(s ? s.fee * 0.7 : 0); api.confidence(2); return s ? `${s.player.name} gets his move to ${s.to} for ${api.money(s.fee)}, and most of it comes back to you to spend.` : `You put him up for sale and the bids never match his opinion of himself. Awkward.`; } },
        { label: "Talk him round for one more year", detail: "Keep him, manage the mood.",
          fx: (api) => { api.form(1); api.confidence(-2); api.flag("unsettled_star", 1); return `A long conversation and a bigger role. He stays, for now — everyone knows it is temporary.`; } },
        { label: "Freeze him out until he apologises", detail: "Make an example of him.",
          fx: (api) => { api.unit({ attack: -2 }, 1); api.rep(1); api.form(-1); return `He trains with the under-23s. The message is unmistakable, and it costs you his goals in the meantime.`; } },
      ],
    },

    /* ---- YOUTH ---- */
    {
      id: "end_academy_sale", category: "YOUTH", weight: 6, req: (c) => c.prospect && c.prospect.value >= 6 && (c.inDebt || c.budget < 8),
      text: (c) => `The one way to balance the books without weakening the first team is to sell ${c.prospect.name} before he has truly broken through.`,
      choices: (c) => [
        { label: "Sell the academy graduate", detail: "Pure profit, a piece of the future gone.",
          fx: (api) => { const p = api.ctx.prospect; api.cash(p.value * 2); api.budget(p.value * 1.2); api.club.squad = api.club.squad.filter((x) => x.id !== p.id); MG.clubs.refreshRatings(api.club); api.confidence(3); api.rep(-2); return `${p.name} is sold for ${api.money(p.value * 2)} of almost pure profit. The academy staff are furious.`; } },
        { label: "Keep him and find the money elsewhere", detail: "Protect the crown jewel.",
          fx: (api) => { api.wage(-2); api.confidence(-3); api.rep(1); return `You refuse to sell him and cut costs elsewhere instead. The board grumble; the academy adores you.`; } },
        { label: "Sell him but insert a buy-back", detail: "Have it both ways, at a discount.",
          fx: (api) => { const p = api.ctx.prospect; api.cash(p.value * 1.6); api.budget(p.value * 0.9); api.club.squad = api.club.squad.filter((x) => x.id !== p.id); MG.clubs.refreshRatings(api.club); api.flag("buyback", 4); return `${p.name} leaves for ${api.money(p.value * 1.6)} — less than his worth, but you kept the right to bring him home.`; } },
      ],
    },

    /* ---- BOARDROOM ---- */
    {
      id: "end_stadium", category: "BOARDROOM", weight: 5, req: (c) => c.champion || c.promoted || c.managerRep >= 55,
      text: (c) => `The board are weighing a stadium expansion against another summer of investment in the squad. They want your view.`,
      choices: (c) => [
        { label: "Back the stadium — think long-term", detail: "Bigger ground, bigger club.",
          fx: (api) => { api.confidence(3); api.rep(2); api.budget(-api.club.finances.transferBudget * 0.2); return `You side with the bricks and mortar. The budget is trimmed to pay for it, but the club is building something.`; } },
        { label: "Demand it all goes on the squad", detail: "Win now, expand later.",
          fx: (api) => { api.budget(api.club.finances.revenue * 0.1); api.confidence(-3); api.flag("promised", 2); return `You get the money on the pitch instead. The expectation that comes with it is, again, yours.`; } },
        { label: "Let the board decide", detail: "Stay out of the politics.",
          fx: (api) => { api.confidence(1); return `You tell them it is their call. They appreciate a manager who knows his lane.`; } },
      ],
    },

    /* ---- TRANSFERS ---- */
    {
      id: "end_free_agent", category: "TRANSFERS", weight: 7, req: (c) => c.wageRoom >= 4,
      text: (c) => `A well-known name is out of contract and available on a free — no fee, but wages to match his reputation.`,
      choices: (c) => [
        { label: "Sign him — experience for nothing", detail: "No fee, a big wage, a known quantity.",
          fx: (api) => { const s = api.sign({ quality: "solid", maxFee: 0.1 }); api.wage(-4); return s ? `${s.player.name} (${Math.round(s.player.overall)}) signs on a free. Not a penny in fees; the wage bill feels it.` : `The free agents worth having wanted more than you could offer. He signs elsewhere.`; } },
        { label: "Sign a hungry younger free agent instead", detail: "Lower wage, more upside.",
          fx: (api) => { const s = api.sign({ quality: "prospect", maxFee: 0.1 }); return s ? `${s.player.name} (${s.player.age}) comes in on a free — cheaper, younger, and with something to prove.` : `Nothing on the free market fit the brief. You pass.`; } },
        { label: "Keep the wage room clear", detail: "Discipline over a bargain.",
          fx: (api) => { api.confidence(2); return `You resist the free transfer. The wage structure stays clean, and the board notice the restraint.`; } },
      ],
    },

    /* ---- THE SUPPORTERS ----
     * The crowd is a second constituency with its own opinion, and these are the
     * cards where the two pull against each other: the move that calms the
     * stands is often the one the boardroom least wants to pay for. */
    {
      id: "end_fan_revolt", category: "SUPPORTERS", weight: 10, req: (c) => c.fans <= 38,
      text: (c) => `The mood in the ground has turned. Supporter groups have asked for a meeting, and the local press are already there.`,
      variants: [
        (c) => `The mood in the ground has turned. Supporter groups have asked for a meeting, and the local press are already there.`,
        (c) => `A banner went up in the away end on the last day, and it was not aimed at the players.`,
        (c) => `Season-ticket renewals are down and the fan forum has requested you attend in person.`,
      ],
      choices: (c) => [
        { label: "Meet them face to face", detail: "No script, no press officer.",
          fx: (api) => { api.fans(9, "you fronted up to the supporters"); api.rep(1); return `Two hours in a function room taking every question. Nothing is solved, but they can see you are not hiding.`; } },
        { label: "Give them a signing to cheer", detail: "Buy the goodwill back.",
          fx: (api) => {
            const s = api.sign({ quality: "star" });
            if (!s) { api.fans(-3, "the promised signing never arrived"); return `You promise a statement signing and fail to land one. That was worse than saying nothing.`; }
            api.fans(11, `${s.player.name} was signed to win the crowd back`);
            return `${s.player.name} (${Math.round(s.player.overall)}) arrives from ${s.from} for ${api.money(s.fee)}. The forum goes quiet, for now.`;
          } },
        { label: "Tell them results are the only answer", detail: "Refuse to perform contrition.",
          fx: (api) => { api.fans(-5, "you dismissed the supporters' concerns"); api.confidence(2); api.form(1); return `You decline to apologise and say the table is the only conversation worth having. The board rather admire it.`; } },
      ],
    },
    {
      id: "end_fan_darling", category: "SUPPORTERS", weight: 8, req: (c) => c.fans >= 74,
      text: (c) => `They sing your name now. That kind of goodwill is a currency, and it does not last forever.`,
      variants: [
        (c) => `They sing your name now. That kind of goodwill is a currency, and it does not last forever.`,
        (c) => `There is a mural of you on a wall near the ground. The club shop is selling a shirt with your name on the back.`,
        (c) => `The crowd stayed behind to applaud after the final whistle. The board watched them do it.`,
      ],
      choices: (c) => [
        { label: "Spend the goodwill on the boardroom", detail: "Ask for money while they cannot refuse.",
          fx: (api) => { const g = api.club.finances.revenue * 0.11; api.budget(g); api.confidence(-4); api.fans(-2); return `You use the crowd as leverage and walk out with ${api.money(g)}. The owner does not enjoy being outflanked.`; } },
        { label: "Commit yourself publicly to the club", detail: "Bank it as loyalty.",
          fx: (api) => { api.fans(6, "you pledged your future to the club"); api.confidence(7); api.form(1.5); return `You say you are not going anywhere, and mean it. The ground and the boardroom both relax.`; } },
        { label: "Turn the affection on the players", detail: "Deflect it where it helps.",
          fx: (api) => { api.form(2.5); api.fans(3, "you gave the credit to the squad"); return `You insist the credit is theirs. They come back for pre-season playing for you specifically.`; } },
      ],
    },
    {
      id: "end_ticket_prices", category: "FINANCE", weight: 7,
      text: (c) => `The commercial department want to raise ticket prices. The numbers are compelling and the timing is terrible.`,
      variants: [
        (c) => `The commercial department want to raise ticket prices. The numbers are compelling and the timing is terrible.`,
        (c) => `A paper lands on your desk proposing an eight per cent rise on season tickets, with your name listed as a supporter of it.`,
      ],
      choices: (c) => [
        { label: "Back the rise", detail: "Money in, goodwill out.",
          fx: (api) => { const g = api.club.finances.revenue * 0.06; api.cash(g); api.budget(g * 0.5); api.fans(-8, "ticket prices went up"); api.confidence(4); return `Prices go up. ${api.money(g)} arrives and the letters page fills for a fortnight.`; } },
        { label: "Fight it on the supporters' behalf", detail: "Spend boardroom credit on the crowd.",
          fx: (api) => { api.fans(8, "you blocked a ticket price rise"); api.confidence(-5); api.rep(1); return `You argue them out of it. The stands hear about it within a day; the finance director does not forget it.`; } },
        { label: "Trade a rise for a bigger budget", detail: "Let it happen, but be paid for it.",
          fx: (api) => { api.budget(api.club.finances.revenue * 0.09); api.fans(-4, "prices rose, but the team was funded"); return `Prices rise and the increase goes straight into the squad. You can at least defend that one.`; } },
      ],
    },

    /* ---- MORE BOARDROOM AND MEDIA ---- */
    {
      id: "end_pundit_war", category: "MEDIA", weight: 6,
      text: (c) => `A former player turned pundit has spent the season taking you apart on national television, and the players have noticed.`,
      variants: [
        (c) => `A former player turned pundit has spent the season taking you apart on national television, and the players have noticed.`,
        (c) => `A column this morning calls you "out of your depth" under a photograph of you looking exactly that.`,
      ],
      choices: (c) => [
        { label: "Answer him publicly", detail: "A fight the cameras will love.",
          fx: (api) => { api.rep(2); api.fans(5, "you fought the club's corner in public"); api.confidence(-3); api.form(1.5); return `You name him and take him apart in a press conference. It leads the bulletins; the squad love it.`; } },
        { label: "Rise above it entirely", detail: "Say nothing, win instead.",
          fx: (api) => { api.confidence(3); api.rep(1); return `You refuse to engage. The story dies for lack of oxygen and the board note your composure.`; } },
        { label: "Use it in the dressing room", detail: "Pin it to the wall.",
          fx: (api) => { api.form(2.5); api.unit({ midfield: 1 }, 1); return `The article goes up in the changing room. They report back in July with something to prove.`; } },
      ],
    },
    {
      id: "end_owner_change", category: "BOARDROOM", weight: 5, req: (c) => c.season >= 3,
      text: (c) => `There is a takeover in the air. New money, new promises, and no guarantee any of it includes you.`,
      choices: (c) => [
        { label: "Court the new owners", detail: "Make yourself part of the plan.",
          fx: (api) => { api.confidence(9); api.budget(api.club.finances.revenue * 0.09); api.rep(-1); return `You make your case early and well. The incoming regime keep you, and open the chequebook to prove the point.`; } },
        { label: "Stay loyal to the people who hired you", detail: "Principle, at a price.",
          fx: (api) => { api.confidence(-5); api.rep(3); api.fans(4, "you stood by the old regime"); return `You refuse to brief against anyone. It costs you standing with the new board and earns it everywhere else.`; } },
        { label: "Demand assurances in writing", detail: "Protect yourself.",
          fx: (api) => { api.confidence(4); api.flag("protected", 2); return `You get it in writing. It is not affection, but it is a season of safety.`; } },
      ],
    },
    {
      id: "end_europe_prep", category: "BOARDROOM", weight: 8, req: (c) => c.champion || (c.position && c.position <= 4),
      text: (c) => `European football next season. The squad that got you there is not deep enough to survive Thursday-Sunday for nine months.`,
      choices: (c) => [
        { label: "Demand money for depth", detail: "Two or three additions, or it unravels.",
          fx: (api) => { api.budget(api.club.finances.revenue * 0.13); api.confidence(-3); const a = api.sign({ quality: "solid" }); return `The board fund the expansion.` + (a ? ` ${a.player.name} (${Math.round(a.player.overall)}) is the first through the door from ${a.from}.` : ` Now you have to find the players.`); } },
        { label: "Prioritise the league and rotate hard", detail: "Treat Europe as a bonus.",
          fx: (api) => { api.youth(0.1); api.form(1); api.fans(-3, "Europe was treated as an afterthought"); return `You tell everyone the league comes first and the kids will get their European nights. Honest, and unromantic.`; } },
        { label: "Go all in on the European run", detail: "Chase the nights nobody forgets.",
          fx: (api) => { api.unit({ attack: 2 }, 1); api.injuryRisk(1.2); api.fans(7, "you chased the European nights"); api.confidence(-2); return `Everything is pointed at Europe. The ground has not been this excited in years, and the squad will be running on fumes by March.`; } },
      ],
    },

    /* ---- SQUAD AND DRESSING ROOM ---- */
    {
      id: "end_bloated_squad", category: "DRESSING ROOM", weight: 7, req: (c) => c.squadSize >= 26,
      text: (c) => `You are carrying ${c.squadSize} professionals and can name eighteen. The ones who never play have stopped pretending to be happy.`,
      choices: (c) => [
        { label: "Clear out the fringe", detail: "Smaller, sharper, angrier for a while.",
          fx: (api) => { const a = api.sell("fringe"); const b = api.sell("fringe"); api.wage(4); api.form(1); const g = [a, b].filter(Boolean); return g.length ? `${g.map((s) => s.player.name).join(" and ")} are moved on for ${api.money(g.reduce((t, s) => t + s.fee, 0))}. The group that stays knows why it stayed.` : `You try to thin the squad and nobody bites. The mood stays sour.`; } },
        { label: "Promise them a fair chance", detail: "Keep everyone, spread the minutes.",
          fx: (api) => { api.form(-0.5); api.injuryRisk(0.85); api.youth(0.05); return `You commit to rotating properly. The bodies stay fresher and nobody quite gets a settled run.`; } },
        { label: "Let them rot in the reserves", detail: "Ruthless, and cheap.",
          fx: (api) => { api.form(-1.5); api.confidence(2); return `They train apart and travel nowhere. The wage bill is unchanged and so is the atmosphere.`; } },
      ],
    },
    {
      id: "end_captain_crisis", category: "DRESSING ROOM", weight: 7, req: (c) => c.veteran && c.veteran.age >= 32 && (c.missedTarget || c.reportTotal < 0),
      text: (c) => `The captaincy is not working. ${c.veteran.name} has lost the room, and everyone can feel it except him.`,
      choices: (c) => [
        { label: "Strip the armband and give it to a leader", detail: "Brutal, clarifying.",
          fx: (api) => { api.form(2); api.unit({ midfield: 1 }, 1); api.rep(1); return `You take it off him in private and hand it to someone the squad actually follows. The training ground changes within a week.`; } },
        { label: "Sell him and move on entirely", detail: "Remove the problem.",
          fx: (api) => { const s = api.sell("veteran"); api.form(1.5); api.fans(-3, "a club captain was sold"); return s ? `${s.player.name} leaves for ${s.to} for ${api.money(s.fee)}. Some of the crowd will never forgive it.` : `You offer him around and find nothing. He stays, diminished.`; } },
        { label: "Back him one more year", detail: "Loyalty over the evidence.",
          fx: (api) => { api.form(-1); api.fans(2, "you stood by the captain"); api.unit({ defence: 1 }, 1); return `You back him publicly. The senior players appreciate the loyalty; the rest read it as weakness.`; } },
      ],
    },
    {
      id: "end_agent_terms", category: "TRANSFERS", weight: 7, req: (c) => c.star && c.wageRoom < 12,
      text: (c) => `${c.star.name}'s agent wants a new deal at a number the club has never paid anyone.`,
      choices: (c) => [
        { label: "Pay it and break the wage structure", detail: "Keep the player, lose the ceiling.",
          fx: (api) => { api.wage(-7); api.confidence(-4); api.form(1.5); api.fans(4, `${api.ctx.star.name} was kept`); return `He signs. Every other agent at the club now has a new number to point at.`; } },
        { label: "Hold the line and risk losing him", detail: "The structure matters more than the man.",
          fx: (api) => { api.confidence(5); api.form(-1.5); api.flag("valuation_standoff", 2); return `You refuse to move. The wage structure survives intact and he is now a year from leaving for nothing.`; } },
        { label: "Offer performance terms instead", detail: "Pay him if he earns it.",
          fx: (api) => { api.wage(-3); api.form(0.5); api.unit({ attack: 1 }, 1); return `A deal built on appearances and goals. His agent grumbles; he signs it, and plays like a man on commission.`; } },
      ],
    },

    /* ---- INFRASTRUCTURE AND RECRUITMENT ---- */
    {
      id: "end_scouting", category: "TRANSFERS", weight: 7,
      text: (c) => `Your scouting operation is small and local. Widening it costs money now and pays in players you have not heard of yet.`,
      choices: (c) => [
        { label: "Build a proper scouting network", detail: "A wider market for years to come.",
          fx: (api) => { api.budget(-6); api.clubRep(2); api.facilities({ youth: 2 }); return `${api.money(6)} into scouts and data. The club's name travels a little further now, and so does its reach in the market.`; } },
        { label: "Poach a rival's chief scout", detail: "One hire, immediate effect.",
          fx: (api) => { api.budget(-2); api.clubRep(1); return `You hire the man who found three of your rival's best players. He arrives with a notebook and a grudge.`; } },
        { label: "Keep scouting in-house", detail: "Trust what you already know.",
          fx: (api) => { api.budget(1.5); api.youth(0.04); return `No new scouts. The money stays available and the academy gets a longer look.`; } },
      ],
    },
    {
      id: "end_academy_chief", category: "YOUTH", weight: 6,
      text: (c) => `The academy needs a direction. There is a celebrated youth coach available, and a cheaper internal candidate who knows the club.`,
      choices: (c) => [
        { label: "Hire the big name", detail: "Expensive, transformative.",
          fx: (api) => { api.budget(-5); api.facilities({ youth: 8 }); api.youth(0.06); return `${api.money(5)} for a man who has produced internationals elsewhere. The intake will look different within three years.`; } },
        { label: "Promote from within", detail: "Continuity, and cheap.",
          fx: (api) => { api.facilities({ youth: 3 }); api.fans(2, "a club man got the academy job"); return `A club man gets the job. Less transformative, and the supporters like the symbolism.`; } },
        { label: "Fold the academy into the first team", detail: "One programme, one philosophy.",
          fx: (api) => { api.facilities({ training: 3, youth: 2 }); api.youth(0.1); api.form(-1); return `Youth and senior training merge. The kids learn faster and the first team's week is busier than it was.`; } },
      ],
    },
    {
      id: "end_data_department", category: "TACTICS", weight: 6, req: (c) => c.budget >= 3,
      text: (c) => `Everyone else has an analytics department. You have a coach with a laptop and strong opinions.`,
      choices: (c) => [
        { label: "Fund a real analysis team", detail: "Better decisions, quietly, forever.",
          fx: (api) => { api.budget(-4); api.unit({ midfield: 1, defence: 1 }, 3); api.facilities({ training: 2 }); return `${api.money(4)} on analysts and cameras. Nothing visible changes; everything is a fraction better for years.`; } },
        { label: "Use it purely for opposition scouting", detail: "Narrow, and immediately useful.",
          fx: (api) => { api.budget(-1.5); api.unit({ defence: 2 }, 2); return `A small team pointed entirely at the next opponent. You concede fewer goals to things you have already seen.`; } },
        { label: "Trust your eyes", detail: "Football is not a spreadsheet.",
          fx: (api) => { api.rep(1); api.form(0.5); api.confidence(-1); return `You tell them you have watched enough football to know. It is either conviction or arrogance, and results will decide which.`; } },
      ],
    },
    {
      id: "end_loyalty", category: "FINANCE", weight: 6, req: (c) => c.expiring >= 1,
      text: (c) => `The long-servers are due loyalty bonuses the club agreed to years ago and cannot comfortably afford.`,
      choices: (c) => [
        { label: "Pay every penny on time", detail: "Expensive integrity.",
          fx: (api) => { api.cash(-api.club.finances.revenue * 0.05); api.form(2); api.fans(4, "the club honoured its promises"); api.confidence(-2); return `The bonuses are paid in full on the day they are due. Word gets round the dressing room fast.`; } },
        { label: "Renegotiate them downward", detail: "Save money, spend trust.",
          fx: (api) => { api.confidence(5); api.form(-2); api.fans(-3, "the club haggled over loyalty bonuses"); return `Most of them accept less. None of them forget being asked.`; } },
        { label: "Defer them to next season", detail: "Kick it down the road.",
          fx: (api) => { api.confidence(1); api.flag("deferred_wages", 3); api.form(-0.5); return `The payments are pushed back a year. That is now a problem waiting for you in twelve months.`; } },
      ],
    },
    {
      id: "end_stadium_atmosphere", category: "SUPPORTERS", weight: 6, req: (c) => c.fans >= 40 && c.fans <= 72,
      text: (c) => `The ground has gone quiet. A supporters' trust has a proposal: a safe-standing section, cheaper for the people who actually sing.`,
      choices: (c) => [
        { label: "Champion the proposal", detail: "Noise is worth points.",
          fx: (api) => { api.cash(-2); api.fans(8, "the club backed a singing section"); api.unit({ attack: 1 }, 3); return `It gets built behind the goal. Home games sound like they used to, and the players can hear it.`; } },
        { label: "Convert it to corporate boxes instead", detail: "The board's preferred version.",
          fx: (api) => { api.cash(api.club.finances.revenue * 0.07); api.confidence(5); api.fans(-9, "the terrace became corporate boxes"); return `Prawn sandwiches where the drum used to be. The accounts look better and the ground sounds worse.`; } },
        { label: "Leave the ground as it is", detail: "No money, no argument.",
          fx: (api) => { api.fans(-1); return `Nothing changes. Nobody is delighted and nobody is furious.`; } },
      ],
    },
    {
      id: "end_veteran_farewell", category: "DRESSING ROOM", weight: 6, req: (c) => c.veteran && c.veteran.age >= 34,
      text: (c) => `${c.veteran.name} is ${c.veteran.age} and everyone knows this is the last one. How it ends is your call.`,
      choices: (c) => [
        { label: "Give him a testimonial and a send-off", detail: "The romantic option.",
          fx: (api) => { api.cash(1.5); api.fans(7, `${api.ctx.veteran.name} got the send-off he deserved`); api.form(1.5); return `A packed ground, a lap of honour and a genuinely emotional afternoon. It costs nothing and buys a great deal.`; } },
        { label: "Offer him a coaching role", detail: "Keep the knowledge in the building.",
          fx: (api) => { api.facilities({ training: 3 }); api.youth(0.06); api.form(1); return `He swaps the shirt for a tracksuit. The young players now have someone who has done it to ask.`; } },
        { label: "Let the contract lapse quietly", detail: "No ceremony, no cost.",
          fx: (api) => { api.wage(3); api.fans(-5, "a club legend left without a word"); return `He leaves in June without an announcement. The wage comes off the bill and the forums are not kind.`; } },
      ],
    },
    {
      id: "end_gamble_promotion", category: "BOARDROOM", weight: 7, req: (c) => c.tier >= 2 && c.position && c.position <= 6 && !c.promoted,
      text: (c) => `You finished ${c.position ? ordinal(c.position) : "close"} and missed out. The board will fund one serious push — or bank the money and wait.`,
      choices: (c) => [
        { label: "Go for it — spend everything", detail: "Promotion or bust.",
          fx: (api) => { api.budget(api.club.finances.revenue * 0.2); api.flag("on_the_line", 1); api.fans(6, "the club went all in on promotion"); const s = api.sign({ quality: "star" }); return `Every available pound goes on the squad.` + (s ? ` ${s.player.name} (${Math.round(s.player.overall)}) is the statement, in from ${s.from} for ${api.money(s.fee)}.` : ` Now it has to work.`); } },
        { label: "Build steadily for a two-year climb", detail: "Patience, and a plan.",
          fx: (api) => { api.facilities({ training: 4, youth: 3 }); api.confidence(3); api.youth(0.08); return `You argue for the longer road. The board are relieved and the supporters are not thrilled.`; } },
        { label: "Bank the money against relegation", detail: "Defensive, prudent, uninspiring.",
          fx: (api) => { api.cash(api.club.finances.revenue * 0.1); api.confidence(6); api.fans(-6, "the club showed no ambition"); return `The money goes in the bank. The finance director is delighted; the stands read it as surrender.`; } },
      ],
    },
  ];

  /* ------------------------------ SELECTION -------------------------------
   * Weighted draw with hard requirement gates and no repeats inside a set.
   *
   * The weights are JITTERED on every draw. Without it a given situation always
   * surfaced the same two cards in the same order — the heaviest eligible pair
   * won every time — so two careers that hit the same circumstances played out
   * identically. A little noise on each weight means the same season can pose a
   * different question, which is most of what makes one save feel unlike the
   * last. The weights still rank: a weight-10 card remains far likelier than a
   * weight-5 one, it is simply no longer guaranteed. */
  function pick(pool, ctx, rng, count, recentIds) {
    const recent = new Set(recentIds || []);
    const eligible = pool.filter((d) => {
      if (recent.has(d.id)) return false;
      if (d.req && !safe(() => d.req(ctx), false)) return false;
      return true;
    });
    const chosen = [];
    const used = new Set();
    for (let i = 0; i < (count || 2); i++) {
      const field = eligible.filter((d) => !used.has(d.id) && !chosen.some((c) => c.category === d.category));
      const source = field.length ? field : eligible.filter((d) => !used.has(d.id));
      if (!source.length) break;
      const d = rng.weighted(source.map((x) => ({ item: x, weight: (x.weight || 5) * rng.between(0.65, 1.35) })));
      if (!d) break;
      used.add(d.id);
      chosen.push(d);
    }
    return chosen;
  }

  /** Resolve one card into { text, choices } with everything already rendered.
   *
   *  A card may supply `variants`: several ways of putting the same situation.
   *  One is chosen per draw, so a card the player has seen before does not open
   *  with a sentence he can recite. `text` remains the fallback. */
  function present(decision, ctx, rng) {
    let text;
    if (decision.variants && decision.variants.length) {
      const v = rng ? rng.pick(decision.variants) : decision.variants[0];
      text = safe(() => (typeof v === "function" ? v(ctx) : v), null);
    }
    if (!text) text = safe(() => decision.text(ctx), "A decision awaits.");
    return {
      id: decision.id,
      category: decision.category,
      text,
      choices: safe(() => decision.choices(ctx), []).filter(Boolean),
    };
  }

  /** Apply a chosen option. Returns the sentence describing what happened. */
  function apply(world, club, manager, ctx, choice) {
    const api = makeApi(world, club, manager, ctx);
    const out = safe(() => choice.fx(api), null);
    MG.clubs.refreshRatings(club);
    world.invalidateProfile(club.id);
    return out || choice.label;
  }

  /* Helpers. A card that throws must never take the game down with it — a bad
   * requirement should cost you one card, not the save. */
  function safe(fn, fallback) {
    try { return fn(); } catch (err) {
      if (typeof console !== "undefined") console.warn("decision error", err);
      return fallback;
    }
  }
  function fmt(m) { return Math.abs(m) >= 10 ? `£${Math.round(m)}m` : `£${round1(m)}m`; }
  function posName(pos) { return (MG.players.POSITIONS[pos] || {}).name || "player"; }
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  MG.decisions = { PRESEASON, ENDSEASON, buildContext, pick, present, apply, makeApi };
})(typeof globalThis !== "undefined" ? globalThis : this);
