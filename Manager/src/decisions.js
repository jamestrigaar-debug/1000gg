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
      },
      rep(n) { manager.reputation = clamp(manager.reputation + n, 1, 99); },
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
  ];

  /* -------------------------- END-OF-SEASON CARDS -------------------------- */
  const ENDSEASON = [
    /* ---- BOARDROOM ---- */
    {
      id: "end_review", category: "BOARDROOM", weight: 10,
      text: (c) => `The end-of-season review. The board's verdict was ${(c.verdict || "mixed").toLowerCase()}, and now they want to hear from you.`,
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
  ];

  /* ------------------------------ SELECTION -------------------------------
   * Weighted draw with hard requirement gates and no repeats inside a set. */
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
      const d = rng.weighted(source.map((x) => ({ item: x, weight: x.weight || 5 })));
      if (!d) break;
      used.add(d.id);
      chosen.push(d);
    }
    return chosen;
  }

  /** Resolve one card into { text, choices } with everything already rendered. */
  function present(decision, ctx) {
    return {
      id: decision.id,
      category: decision.category,
      text: safe(() => decision.text(ctx), "A decision awaits."),
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
