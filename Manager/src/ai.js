/* ============================================================================
 * FOOTBALL MANAGER — THE AI's SUMMER, IN THREE CYCLES
 *
 * Every AI club used to build its squad in a single reflex. It looked at what
 * it was short of, walked the market, bought whatever scored highest, and that
 * was the summer. Nothing about it was a PLAN: a relegated club shopped exactly
 * like a promoted one, a club deep in debt shopped exactly like a rich one, and
 * — the part that showed most — a club that failed to sign the centre-half it
 * desperately needed simply went into the season without one, because nothing
 * ever went back and looked at what had actually happened.
 *
 * So the AI now deliberates in three cycles, and each one reads the one before:
 *
 *   1. ASSESS   Before the market opens, the club reads its own season and
 *               takes a POSTURE — rebuilding, pushing, consolidating,
 *               firefighting, or steady. The posture decides who it is willing
 *               to sell, how many it wants to sign, what age of player it is
 *               looking for and how hard it will stretch for one. It writes
 *               down its priority positions, in order, and remembers them.
 *
 *   2. ACT      The transfer window runs (transfers.js). It is aimed by the
 *               plan: the priority list re-orders what the club chases, and
 *               the posture bends the valuation of every target it looks at.
 *
 *   3. REVIEW   After the window closes, the club compares the plan against
 *               what it actually got. An unmet priority is a problem it now
 *               has to solve a different way — promote a prospect ahead of
 *               schedule, or drop its standards and take a free agent it would
 *               not have looked at in cycle 2. This is the cycle that did not
 *               exist before, and it is the one that stops a club sleepwalking
 *               into a season with a hole in it.
 *
 * The plan is kept on the club (`club.plan`) so it is inspectable — the
 * scouting screen can read a rival's posture, which is exactly the kind of
 * thing a scouting department is for.
 *
 * The human's club is never planned for. Those are his decisions to make.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /* ------------------------------- POSTURES --------------------------------
   * What a club is trying to do this summer. Each one bends the same three
   * levers — who it sells, who it wants, how hard it pushes — in a different
   * direction, so two clubs of identical strength in identical positions but
   * arriving from different seasons no longer shop the same way.
   *
   *   sell        appetite for moving players on (multiplies the listing roll)
   *   signings    modifier on how many the club tries to bring in
   *   spend       modifier on what it will pay
   *   ageBias     + favours youth, - favours ready-made experience
   *   patience    how far below its own level it will accept a signing in
   *               cycle 3 when the plan has already failed once
   */
  const POSTURES = {
    firefight: {
      key: "firefight", label: "Firefighting",
      blurb: "The money has run out. Anything with a price on it is available.",
      sell: 1.7, signings: -1, spend: 0.6, ageBias: -0.2, patience: 9,
    },
    rebuild: {
      key: "rebuild", label: "Rebuilding",
      blurb: "The season said this squad is finished. Clear it out and start again.",
      sell: 1.6, signings: 1, spend: 0.9, ageBias: 1.0, patience: 10,
    },
    push: {
      key: "push", label: "Pushing",
      blurb: "This side is close. One or two of the right players and it is a contender.",
      sell: 0.6, signings: 1, spend: 1.35, ageBias: -0.6, patience: 4,
    },
    consolidate: {
      key: "consolidate", label: "Consolidating",
      blurb: "New division, and the job now is to belong in it.",
      sell: 0.8, signings: 2, spend: 1.15, ageBias: -0.3, patience: 8,
    },
    steady: {
      key: "steady", label: "Steady",
      blurb: "Nothing broken and nothing to prove. Tidy the edges.",
      sell: 1.0, signings: 0, spend: 1.0, ageBias: 0, patience: 7,
    },
  };

  /* --------------------------- CYCLE 1: ASSESS ----------------------------- */

  /** Read the club's own season and decide what kind of summer this is. */
  function readPosture(world, club) {
    const f = club.finances;
    const o = club._outcome;
    const report = club.board.report;
    const verdict = report ? report.total : 0;

    // Money first: a club that cannot pay for the squad it has is not choosing
    // between ambitions, it is choosing what to sell.
    if (club.mustSell || (f.revenue > 0 && f.balance < -f.revenue * 0.3)) return POSTURES.firefight;

    if (o) {
      if (o.relegated) return POSTURES.rebuild;
      if (o.promoted) return POSTURES.consolidate;
    }

    // A squad that has aged out is rebuilding whatever the table said.
    const ages = club.squad.length ? club.squad.reduce((t, p) => t + p.age, 0) / club.squad.length : 26;
    if (ages >= 29.2) return POSTURES.rebuild;
    if (verdict <= -0.4) return POSTURES.rebuild;

    // Close to the top of its own division, with money to act: go for it.
    const nearTop = o && o.fieldSize ? o.position <= Math.max(3, Math.round(o.fieldSize * 0.2)) : false;
    if ((nearTop || verdict >= 0.4) && f.transferBudget > f.revenue * 0.08) return POSTURES.push;

    return POSTURES.steady;
  }

  /* ======================= DELIBERATION ====================================
   * Three things a club now works out for itself before and during the market,
   * in place of reading a rating off a player and calling it judgement.
   *
   *   THE SHAPE IT PLAYS.  A 4-3-3 manager starts three central midfielders
   *   and a 4-4-2 manager starts two. Squad need was measured against one
   *   fixed table of "how many of each position a squad should carry", so
   *   every club in the world wanted the same squad regardless of how it set
   *   up. Now the formation decides, which is why two clubs of identical
   *   strength now shop differently.
   *
   *   WHAT A SIGNING ACTUALLY ADDS.  See marginalValue. This is the real
   *   change: the AI used to score a target on his rating against the current
   *   starters' average, which says a fourth good centre half is nearly as
   *   valuable as a first one. He is worth nothing. A player is worth what he
   *   adds to the eleven that actually takes the field.
   *
   *   WHAT IT FAILED TO FIX LAST TIME.  A club that has gone two summers
   *   without solving the same position stops shopping the same way for it.
   * ====================================================================== */

  /** How many of each position this club's formation actually starts. */
  function slotCounts(club) {
    const F = MG.tactics && MG.tactics.FORMATIONS;
    const shape = F && F[club.formation || "4-4-2"];
    const counts = {};
    if (!shape) return counts;
    for (const pos of shape.slots) counts[pos] = (counts[pos] || 0) + 1;
    return counts;
  }

  /** The mean rating of the best `n` players a club has at `pos`, optionally
   *  with one extra body thrown in. This is the starting line at that
   *  position, which is the only thing a signing can improve. */
  function lineStrength(club, pos, n, extra) {
    const vals = [];
    for (const p of club.squad) if (p.pos === pos && !p.loan) vals.push(p.overall);
    if (extra) vals.push(extra.overall);
    if (!vals.length) return 30;
    vals.sort((a, b) => b - a);
    let total = 0;
    for (let i = 0; i < n; i++) total += vals[i] != null ? vals[i] : 30;
    return total / n;
  }

  /* What this player is worth to THIS club, in rating points added to the side
   * it actually fields. Zero for a good player at a position the club is
   * already strong and deep in, which is the judgement the old heuristic could
   * not make — and the reason AI squads used to accumulate five centre halves
   * and no winger. Scaled by how much the position feeds the three unit
   * ratings the match engine reads, so a centre half and a forward are
   * compared on the same axis. */
  const KEEPER_WEIGHT = 1.15;
  function marginalValue(club, player) {
    const def = MG.players.POSITIONS[player.pos];
    if (!def) return 0;
    const starts = Math.max(1, slotCounts(club)[player.pos] || def.starters);
    const gain = lineStrength(club, player.pos, starts, player) - lineStrength(club, player.pos, starts);
    if (gain <= 0) return 0;
    const w = player.pos === "GK"
      ? KEEPER_WEIGHT
      : def.unit.attack + def.unit.midfield + def.unit.defence;
    return gain * w;
  }

  /* A position whose starters are ageing with nobody coming through is a
   * problem NEXT summer, and a club that only ever reacts to the hole once it
   * opens is a club whose squad falls off a cliff every few seasons. Real
   * recruitment is mostly succession. */
  function successionRisk(club, pos) {
    const starters = [];
    let heir = false;
    for (const p of club.squad) {
      if (p.pos !== pos || p.loan) continue;
      starters.push(p);
      if (p.age <= 23) heir = true;
    }
    if (!starters.length) return 0;
    starters.sort((a, b) => b.overall - a.overall);
    const def = MG.players.POSITIONS[pos];
    const n = Math.max(1, slotCounts(club)[pos] || def.starters);
    const top = starters.slice(0, n);
    const meanAge = top.reduce((t, p) => t + p.age, 0) / top.length;
    if (meanAge < 29) return 0;
    // Worst case: a whole ageing line with no successor anywhere behind it.
    return clamp((meanAge - 29) * 0.5, 0, 1.6) * (heir ? 0.4 : 1);
  }

  /** Positions this club has now failed to fix in consecutive summers. */
  function repeatedFailures(club) {
    const log = club.planLog || [];
    const counts = {};
    for (const entry of log) for (const pos of entry.unmet || []) counts[pos] = (counts[pos] || 0) + 1;
    return counts;
  }

  /** Cycle 1. Returns the plan, and stores it on the club. */
  function planSummer(world, club, opts) {
    const posture = readPosture(world, club);
    const needs = MG.transfers.clubNeeds(club);
    const o = opts || {};
    const rivalGap = rivalryGap(world, club, o.playerClub);
    // Closest rivals push hardest; a side three places away is only mildly
    // bothered about you.
    const rivalPush = rivalGap == null ? 0 : (RIVALRY_RANGE + 1 - rivalGap) / (RIVALRY_RANGE + 1);

    /* The priority list. clubNeeds already ranks by urgency; the posture
     * re-weights it — a pushing club cares about upgrading its weakest
     * STARTING position, a rebuilding one cares about bodies and youth, and a
     * firefighting one is barely shopping at all. */
    const level = club.level != null ? club.level : 55;
    const slots = slotCounts(club);
    const failures = repeatedFailures(club);
    const ranked = needs.map((n) => {
      let weight = n.urgency;
      /* THE SHAPE THE MANAGER ACTUALLY PLAYS. A position his formation does
       * not start is worth covering and no more; one it starts three of is
       * where a thin squad hurts every week. Without this every club in the
       * world wanted the same squad whatever it set up as. */
      const starts = slots[n.pos] || 0;
      weight *= 0.55 + starts * 0.35;
      // Succession: an ageing line with nobody behind it is next year's hole.
      weight += successionRisk(club, n.pos);
      /* And the position it has already failed to fix. A club that went into
       * last season short at centre half and did nothing about it again is not
       * being unlucky, it is being outbid — so it stops treating the problem
       * as ordinary and starts treating it as the summer's business. */
      const missed = failures[n.pos] || 0;
      if (missed) weight += missed * 0.8;
      if (posture.key === "push") weight += Math.max(0, level - n.currentQuality) * 0.10;
      if (posture.key === "rebuild" || posture.key === "consolidate") weight += n.short * 0.6;
      if (posture.key === "firefight") weight -= 0.5;
      /* Where the manager's side is better than ours, that is the gap to close.
       * Only ever a positive term — a rival does not stop wanting a goalkeeper
       * because the human happens to be weak there too. */
      if (rivalPush && o.playerQuality && o.playerQuality[n.pos] != null) {
        weight += Math.max(0, o.playerQuality[n.pos] - n.currentQuality) * 0.13 * rivalPush;
      }
      return { pos: n.pos, short: n.short, currentQuality: n.currentQuality, weight,
        age: successionRisk(club, n.pos), missed };
    }).sort((a, b) => b.weight - a.weight);

    /* A position now earns a place on the list for being an ageing line with
     * no successor, or for having beaten the club two summers running — not
     * only for being thin or weak today. Those are the two reasons a real
     * recruitment department goes into a market it does not strictly need to
     * be in, and they are what stop a squad quietly ageing into a collapse. */
    const priorities = ranked
      .filter((n) => n.short > 0 || n.currentQuality < level - 2 || n.age > 0.5 || n.missed > 0)
      .slice(0, 3);

    const manager = world.managerById(club.managerId);
    const policy = MG.managers.recruitmentPolicy(manager);
    // A rival in the hunt finds one more signing and a little more money.
    const wanted = clamp(Math.round(2 + policy.churn + posture.signings + (rivalPush >= 0.5 ? 1 : 0)), 0, 7);
    /* Escalation. Failing at the same position twice buys the club a bigger
     * chequebook and a lower bar for it, because the alternative — shopping
     * exactly the same way a third time — is how a club stays broken for a
     * decade. Capped so it is a change of gear, not a blank cheque. */
    const stuck = Math.min(2, Math.max(0, ...priorities.map((p) => p.missed || 0)));

    const plan = {
      season: world.season,
      posture: posture.key,
      postureLabel: posture.label,
      // In priority order — cycle 2 chases these first, cycle 3 checks them.
      priorities: priorities.map((p) => p.pos),
      priorityDetail: priorities,
      wanted,
      spend: posture.spend * (1 + rivalPush * 0.18) * (1 + stuck * 0.14),
      stuck,
      // Non-null when this club is treating the managed side as a direct rival;
      // read by the scouting screen so the manager can see it coming.
      rivalGap,
      sell: posture.sell,
      ageBias: posture.ageBias,
      patience: posture.patience + stuck * 1.5,
      // Filled in by cycle 3.
      signed: [], unmet: [], fallbacks: [],
    };
    club.plan = plan;
    return plan;
  }

  /** Cycle 1, for the whole world. The human's club is left alone. */
  function planWorld(world) {
    /* The managed club's own per-position quality, read once. Every rival that
     * finished near him gets to compare itself against it — see planSummer's
     * rivalry term. Computed here rather than inside the loop because it is the
     * same answer for all of them. */
    let playerQuality = null, playerClub = null;
    if (world.playerClubId) {
      playerClub = world.clubById(world.playerClubId);
      if (playerClub) {
        playerQuality = {};
        for (const n of MG.transfers.clubNeeds(playerClub)) playerQuality[n.pos] = n.currentQuality;
      }
    }
    for (const club of world.clubs) {
      if (club.id === world.playerClubId) { club.plan = null; continue; }
      planSummer(world, club, { playerClub, playerQuality });
      refreshSystem(world, club);
    }
  }

  /* ---------------------------- THE RIVALRY TERM ----------------------------
   * The clubs that finished within a few places of the manager take him
   * personally. Until now every AI club planned its summer in a vacuum: it read
   * its own finances, its own squad and its own board, and nothing anywhere in
   * the world knew or cared that a human was competing with it. A league that
   * never reacts to you is scenery, and beating scenery gets old.
   *
   * What a genuine rival does is close the gap: it spends a little harder, signs
   * one more player, and points its recruitment at the positions where YOUR side
   * is better than its own. That is legible on the scouting screen, it is the
   * behaviour a real director of football would recognise, and it costs one
   * comparison per club per summer. */
  const RIVALRY_RANGE = 3;      // places either side of the manager in the table

  function rivalryGap(world, club, playerClub) {
    if (!playerClub || club.id === playerClub.id) return null;
    if (club.leagueId !== playerClub.leagueId) return null;
    const mine = club.lastPosition, theirs = playerClub.lastPosition;
    if (mine == null || theirs == null) return null;
    const gap = Math.abs(mine - theirs);
    return gap <= RIVALRY_RANGE ? gap : null;
  }

  /* A rival who has been running the same shape for years and getting nowhere
   * eventually changes it. Without this the world never refreshed a system at
   * all — only a change of manager did — so every AI club drifted to maximally
   * predictable and stayed there, and a human who rotated his shape every few
   * seasons would have collected a permanent free edge over a league that never
   * responded. It has to be RESULTS-driven rather than random: a side winning
   * things has no reason to tear up what works, and the manager who does is the
   * one whose board is asking questions. */
  function refreshSystem(world, club) {
    if (!MG.tactics || !MG.tactics.setFormation) return;
    const seasons = club.systemSeasons || 1;
    if (seasons < 3) return;
    const report = club.board && club.board.report;
    const struggling = report ? report.total < 0 : false;
    // Ramps from nothing at three seasons to a near-certainty for a side that
    // has been both stale and poor for years.
    const chance = clamp((seasons - 2) * (struggling ? 0.22 : 0.06), 0, 0.8);
    if (!world.rng.chance(chance)) return;
    const keys = MG.tactics.FORMATION_KEYS.filter((k) => k !== club.formation);
    if (!keys.length) return;
    MG.tactics.setFormation(club, world.rng.pick(keys));
    world.invalidateProfile(club.id);
  }

  /* ---------------------------- CYCLE 2 SUPPORT ----------------------------
   * The window itself lives in transfers.js; these are the hooks it reads so
   * that the plan actually aims it rather than just describing it. */

  /** How much this club wants a player, on top of the market's own view.
   *  Returns a multiplier applied to the target score. */
  function targetBias(club, player) {
    const plan = club.plan;
    if (!plan) return 1;
    let bias = 1;
    // The plan's priority positions come first, in order.
    const rank = plan.priorities.indexOf(player.pos);
    if (rank === 0) bias += 0.35;
    else if (rank === 1) bias += 0.20;
    else if (rank === 2) bias += 0.10;
    // Age posture: a rebuilding club pays attention to a 21-year-old a pushing
    // club would not look twice at, and the reverse.
    if (plan.ageBias > 0 && player.age <= 23) bias += plan.ageBias * 0.25;
    if (plan.ageBias > 0 && player.age >= 30) bias -= plan.ageBias * 0.30;
    if (plan.ageBias < 0 && player.age >= 26 && player.age <= 30) bias += -plan.ageBias * 0.20;
    if (plan.ageBias < 0 && player.age <= 21) bias -= -plan.ageBias * 0.25;
    return clamp(bias, 0.4, 1.9);
  }

  /** Appetite for selling, read by buildListings. */
  function sellAppetite(club) {
    return club.plan ? club.plan.sell : 1;
  }
  /** Spending appetite, read by the window's budget maths. */
  function spendAppetite(club) {
    return club.plan ? club.plan.spend : 1;
  }
  /** How many the club is trying to sign this summer. */
  function signingTarget(club, fallback) {
    return club.plan ? club.plan.wanted : fallback;
  }

  /** Record a completed signing against the plan, so cycle 3 can read it. */
  function noteSigning(club, player) {
    if (!club.plan) return;
    club.plan.signed.push({ pos: player.pos, name: player.name, overall: Math.round(player.overall) });
  }

  /* --------------------------- CYCLE 3: REVIEW -----------------------------
   * The cycle that did not exist. The window has closed; the club now compares
   * what it planned against what it got, and solves what is left a different
   * way — because a plan that failed is not the same as no plan at all.
   *
   * Two fallbacks, in the order a real club would reach for them:
   *   1. THE ACADEMY — promote a prospect early rather than field nobody.
   *      A club will not do this lightly; it does it when the alternative is a
   *      hole in the side.
   *   2. THE FREE MARKET — take a player it would have turned its nose up at
   *      in cycle 2. `patience` is how far below its own level it will now go,
   *      and a desperate club goes further than a comfortable one.
   */
  function reviewWindow(world, freeAgents) {
    const news = [];
    const pool = (freeAgents || []).filter((p) => !p.retired);

    for (const club of world.clubs) {
      const plan = club.plan;
      if (!plan) continue;                      // the human's club, or unplanned

      const needs = MG.transfers.clubNeeds(club);
      const byPos = {};
      for (const n of needs) byPos[n.pos] = n;
      const level = club.level != null ? club.level : 55;

      /* What the plan actually FAILED at. This has to be a narrow test, and it
       * was not the first time round: "this position is a bit below our level"
       * matched almost every club in almost every position, so cycle 3 fired
       * 2.8 times a club per summer and stuffed the world's squads with
       * bargain-bin free agents. Measured, it pulled the bottom of the Premier
       * League down to 15 points against a real 26 — the fallback was doing
       * more damage than the hole it was patching.
       *
       * A priority is unmet only when the club TRIED and came away with
       * nothing: it signed nobody in that position during the window, and it
       * is genuinely short there — missing bodies, or a hole deep enough to
       * cost real points. Anything less than that is an imperfect squad, which
       * is the normal condition of every football club and not an emergency. */
      /* SHORT OF THE SHAPE IT PLAYS, not short of a generic 26-man table.
       * `clubNeeds().short` counts bodies against a fixed per-position quota
       * that adds up to more players than any squad actually carries, so most
       * clubs read as short SOMEWHERE permanently — which made "unmet" true
       * about 60% of the time and left 91% of the world carrying a supposedly
       * unsolved position. A signal that fires almost always is not a signal,
       * and the escalation reading it would have been a permanent across-the-
       * board handout rather than an adaptation. Measured against the eleven
       * the manager actually picks, it means something again. */
      const slots = slotCounts(club);
      const signedPos = new Set(plan.signed.map((s) => s.pos));
      const unmet = plan.priorities.filter((pos) => {
        if (signedPos.has(pos)) return false;                 // cycle 2 delivered
        const n = byPos[pos];
        if (!n) return false;
        const want = slots[pos] || 0;
        let have = 0;
        for (const p of club.squad) if (p.pos === pos && !p.loan) have++;
        return (want > 0 && have < want) || n.currentQuality < level - 10;
      });
      plan.unmet = unmet.slice();
      /* THE CLUB'S MEMORY. Cycle 3 has always worked out what this summer
       * failed to fix; nothing ever carried that into the next one, so a club
       * could go a decade shopping for the same centre half in exactly the
       * same way and never once change its approach. Three summers is enough
       * to tell a run of bad luck from a problem the club is not equipped to
       * solve — planSummer reads it back as escalation. */
      if (!club.planLog) club.planLog = [];
      club.planLog.push({ season: world.season, posture: plan.posture, unmet: unmet.slice() });
      if (club.planLog.length > 3) club.planLog.shift();
      if (!unmet.length) continue;

      // At most two rescues a summer. A club that needs more than that has a
      // squad problem no single window was ever going to solve.
      for (const pos of unmet.slice(0, 2)) {
        const need = byPos[pos];

        /* ---- fallback 1: bring a prospect up early ---- */
        const academy = MG.youth ? MG.youth.ensure(club) : null;
        if (academy && academy.players.length) {
          const ready = academy.players
            .filter((p) => p.pos === pos)
            .sort((a, b) => (b.overall + (b.potential - b.overall) * 0.4) - (a.overall + (a.potential - a.overall) * 0.4))[0];
          // He does not have to be the finished article, but he does have to be
          // a real option — promoting a boy who is nowhere near it just moves
          // the hole from the transfer list to the team sheet.
          if (ready && ready.overall >= level - 8) {
            const promoted = MG.youth.promote(club, ready.id, world.season);
            if (promoted) {
              plan.fallbacks.push({ pos, how: "academy", name: promoted.name });
              if (club.id === world.playerClubId) {
                news.push({ type: "youth", text: `ACADEMY — ${promoted.name} (${promoted.pos}, ${promoted.age}) is promoted early: the club could not fill the gap in the market.`, clubId: club.id });
              }
              continue;
            }
          }
        }

        /* ---- fallback 2: a free agent, standards lowered ----
         * Lowered, not abandoned. `patience` widens how far below its own
         * level a club will now look, but the floor stays close enough that
         * the man who comes in is a squad player rather than a passenger. */
        const bar = level - clamp(plan.patience, 4, 9);
        /* Capped against the club's own level as well as the position's, for
         * the same reason transfers.js's free-agent pass is: `currentQuality`
         * is measured off the players a club already has, so one good player
         * at a small club raised its ceiling for the next one and the squad
         * ratcheted upward a signing at a time. This is the third and last
         * door into a squad that was missing that check. */
        const reach = Math.min(need.currentQuality + 10, level + 8);
        const idx = pool.findIndex((p) => p.pos === pos && p.overall >= bar && p.overall <= reach);
        if (idx === -1) continue;
        const p = pool.splice(idx, 1)[0];
        // The parent array is what signFreeAgents reads next, so he has to
        // leave it as well or he will be signed twice.
        const fi = freeAgents.indexOf(p);
        if (fi >= 0) freeAgents.splice(fi, 1);
        p.clubId = club.id;
        p.contract = { years: world.rng.int(1, 3), wage: MG.players.expectedWage(p, club.leagueId) };
        MG.players.recordMove(p, club.name, world.season);
        club.squad.push(p);
        MG.clubs.refreshRatings(club);
        plan.fallbacks.push({ pos, how: "free", name: p.name });
        if (club.id === world.playerClubId) {
          news.push({ type: "transfer", text: `FREE — ${p.name} (${p.pos}, ${p.age}, ${Math.round(p.overall)}) signs on a free after the club missed its targets.`, clubId: club.id });
        }
      }
    }
    return news;
  }

  MG.ai = {
    POSTURES, readPosture, planSummer, planWorld,
    targetBias, sellAppetite, spendAppetite, signingTarget, noteSigning,
    reviewWindow, marginalValue, slotCounts, successionRisk,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
