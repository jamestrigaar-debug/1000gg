/* ============================================================================
 * FOOTBALL MANAGER — THE BLOCK PLAN
 *
 * A season is played in five two-month blocks (see world.js). This file is
 * what the manager actually DECIDES at the start of each one, and what those
 * decisions cost him by the end of it.
 *
 * TWO LEVERS, NOT THREE. The temptation was a card for shape, a card for
 * mentality and a card for training. They are the same decision wearing three
 * labels — "how do we set up for the next two months" — and asking it three
 * times turns the start of every block into a form. So:
 *
 *   1. THE APPROACH   shape + mentality + training focus, folded into one
 *                     choice. Push on, keep to what you drilled, sit in, or
 *                     change shape entirely.
 *   2. THE SQUAD      strongest eleven, rotate, or blood the kids. This is
 *                     the people-management lever: who plays, who rests, and
 *                     who is being built for next year rather than Saturday.
 *
 * Every option states its expected effect in plain football before it is
 * chosen ("+chances created, −fitness"), because a toggle whose consequences
 * are invisible is not a decision, it is a guess.
 *
 * WHAT MAKES THEM COST SOMETHING. Both levers are priced in FATIGUE, which is
 * why this file also owns the per-block wear and tear:
 *
 *   - fatigue accrues from minutes played, multiplied by how hard the side is
 *     being asked to go, and absorbed by natural stamina;
 *   - it recovers in the minutes a player does NOT play, which is the entire
 *     argument for rotating;
 *   - it feeds injury risk, so a side flogged through the winter starts
 *     losing people in February.
 *
 * Before this existed, "rest your players" was advice with no mechanism
 * behind it: injuries were rolled once, in pre-season, and nothing a manager
 * did between August and May could make a squad more or less likely to break.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /* ------------------------------ THE APPROACH ----------------------------
   * `attack`/`defence` shift the side's profile for this block only. `press`
   * is how hard they are being asked to run, which is what fatigue is priced
   * off. `focus` is the training focus the approach implies — folded in here
   * rather than asked separately, because "we are going at them" and "we are
   * drilling attacking patterns" are the same instruction.
   *
   * Each option trades attack for defence EXACTLY, and aiPlan reaches for push
   * and contain at about the same rate across the world. Both matter: when
   * contain gave +3 defence for only -2 attack and the AI picked it half again
   * as often as pushing on, the division quietly gained fifty-odd points of
   * defending it had not paid for, and games in which both sides scored fell
   * three points below where the engine had been calibrated. */
  const APPROACH = {
    push: {
      label: "PUSH ON", tag: "AGGRESSIVE",
      blurb: "Higher line, more bodies forward, chase the game from the first whistle.",
      effect: "+chances created  −defensive cover  −fitness",
      attack: 3, defence: -3, press: 1.30, focus: "matchSharpness",
    },
    drilled: {
      label: "AS DRILLED", tag: "STEADY",
      blurb: "The shape and the patterns you worked on in pre-season, unchanged.",
      effect: "no swing either way  ·  familiarity keeps building",
      attack: 0, defence: 0, press: 1.00, focus: null,
    },
    contain: {
      label: "SIT IN", tag: "CAUTIOUS",
      blurb: "Drop the line, keep the shape compact, take what the game gives you.",
      effect: "+defensive solidity  −chances created  +fitness",
      attack: -3, defence: 3, press: 0.80, focus: "setPieces",
    },
    reshape: {
      label: "CHANGE SHAPE", tag: "REBUILD",
      blurb: "Tear up the system and set up differently for the next two months.",
      effect: "counters what is beating you  −familiarity (the side must relearn it)",
      attack: 0, defence: 0, press: 1.10, focus: "matchSharpness",
    },
  };
  const APPROACH_KEYS = ["push", "drilled", "contain", "reshape"];

  /* -------------------------------- THE SQUAD -----------------------------
   * `rotation` reshapes how minutes are spread: 0 concentrates them on the
   * eleven, 1 spreads them across the squad. It is read by match.buildSelection.
   * `load` scales the fatigue that spreading (or not spreading) produces. */
  const SQUAD_PLAN = {
    strongest: {
      label: "STRONGEST XI", tag: "WIN NOW",
      blurb: "Best available every week. The eleven who got you here play until they drop.",
      effect: "+results now  −fitness  −squad morale  −youth minutes",
      rotation: 0.15, youthBias: -0.05, load: 1.22,
    },
    rotate: {
      label: "ROTATE", tag: "MANAGE IT",
      blurb: "Share the minutes around. Nobody is carried, nobody is flogged.",
      effect: "+fitness  +squad morale  −a little sharpness",
      rotation: 0.62, youthBias: 0.02, load: 0.80,
    },
    youth: {
      label: "BLOOD THE KIDS", tag: "BUILD",
      blurb: "Games for the academy. It will cost you points and it will pay you back.",
      effect: "++youth development  +fitness  −results now",
      rotation: 0.80, youthBias: 0.20, load: 0.72,
    },
  };
  const SQUAD_KEYS = ["strongest", "rotate", "youth"];

  const DEFAULT_PLAN = { approach: "drilled", squad: "rotate", shape: null };

  function planFor(club) {
    if (!club.blockPlan) club.blockPlan = { ...DEFAULT_PLAN };
    const p = club.blockPlan;
    if (!APPROACH[p.approach]) p.approach = DEFAULT_PLAN.approach;
    if (!SQUAD_PLAN[p.squad]) p.squad = DEFAULT_PLAN.squad;
    return p;
  }

  /* SHARPNESS — what rotating actually costs you on a Saturday.
   *
   * A club's ratings are computed from its best eleven, not from who actually
   * played, so without this term ROTATE was a free lunch: the same rating on
   * the pitch, plus freshness, plus morale, plus minutes for the kids, at no
   * price at all. The clubs with the deepest squads took it every block and ran
   * away with the league — measured over twenty seasons, champions were
   * finishing four points above where the benchmark had them.
   *
   * A rotated side is a fraction less sharp than a settled one, because it is
   * a fraction less familiar with itself. Centred on 0.5, so the world's
   * average plan is worth nothing either way and only the deviation counts. */
  const SHARPNESS = 4.2;

  /** How the block plan moves the side's profile: approach, then sharpness. */
  function shiftFor(club) {
    const p = planFor(club);
    const a = APPROACH[p.approach];
    const sharp = (0.5 - SQUAD_PLAN[p.squad].rotation) * SHARPNESS * T.shift;
    return {
      attack: a.attack * T.shift + sharp,
      defence: a.defence * T.shift + sharp,
      midfield: sharp,
    };
  }

  /** How hard this side is being asked to run — approach times squad plan. */
  function loadFactor(club) {
    const p = planFor(club);
    return APPROACH[p.approach].press * SQUAD_PLAN[p.squad].load;
  }

  function rotationOf(club) {
    return SQUAD_PLAN[planFor(club).squad].rotation;
  }
  function youthBiasOf(club) {
    return SQUAD_PLAN[planFor(club).squad].youthBias;
  }

  /* ---------------------------- CHANGING SHAPE ----------------------------
   * The reshape option names ONE alternative rather than opening a formation
   * picker. A picker is a second screen and a second decision; naming the
   * shape that actually answers the problem is one tap, and it is what a coach
   * would say out loud. Picked as the formation with the best matchup edge
   * against the rest of the division, ignoring the one already in use. */
  function suggestShape(world, club) {
    const current = club.formation || "4-4-2";
    const rivals = world.clubsInLeague(club.leagueId).filter((c) => c.id !== club.id);
    if (!rivals.length) return null;
    let best = null, bestScore = -Infinity;
    for (const key of MG.tactics.FORMATION_KEYS) {
      if (key === current) continue;
      let score = 0;
      for (const r of rivals) score += MG.tactics.formationEdge(key, r.formation || "4-4-2");
      // A shape the squad is actually built for beats a clever counter it
      // cannot field — a back three needs three centre-halves.
      score += MG.tactics.formationFit(world.managerById(club.managerId) ? world.managerById(club.managerId).tactic : null, key) * 2;
      if (score > bestScore) { bestScore = score; best = key; }
    }
    return best;
  }

  /* ------------------------------ THE AI's PLAN ---------------------------
   * Every other club in the world picks a plan too, or the manager's lever is
   * the only one being pulled and the division is a set of statues. Read off
   * the same things a real manager reads: where they are against their brief,
   * how deep the squad is, and how tired it already is. */
  function aiPlan(world, club, rng, standing) {
    const targets = club.board.targets;
    const size = world.clubsInLeague(club.leagueId).length || 20;
    const pos = standing || (targets ? targets.position : Math.round(size / 2));
    const behind = targets ? pos - targets.position : 0;
    const tired = squadFatigue(club);
    // depthScore is 0-100, not 0-1. Read raw it swamped every other term here
    // and every club in the world rotated, whatever its situation.
    const depth = clamp((MG.tactics.depthScore ? MG.tactics.depthScore(club) : 50) / 100, 0, 1);
    /* Where they actually are in the division, 0 at the top and 1 at the
     * bottom. This is the term that stops "behind the brief" being read as
     * "go for it": a mid-table side told to finish sixth chases the game, and
     * a side in the relegation places does the opposite, because being behind
     * your brief at the bottom means you are being beaten, not unlucky. */
    const lowly = clamp((pos - 1) / Math.max(1, size - 1), 0, 1);
    const safe = targets && pos < targets.position - 2;

    const approach = [
      // Only a side with something to chase and the players to chase it pushes on.
      { item: "push", weight: 1.4 + Math.max(0, behind) * 0.30 * (1 - lowly) + (1 - lowly) * 0.4 },
            /* Weighted heavily, on purpose. Any defensive option concentrates goals
       * — a game where both sides score fewer is far more likely to end with a
       * blank than a game where both score more is to end with two scorers —
       * so a world where half the clubs sit in every block quietly drags the
       * engine's "both teams scored" rate below where it was calibrated. Most
       * managers, most of the time, play the way they set up in pre-season.
       * The lever stays full strength for the club the player is running; what
       * is damped is how often the other two hundred reach for it. */
      { item: "drilled", weight: 4.6 },
      // Comfortable sides protect a lead; struggling ones dig in.
      { item: "contain", weight: 1.4 + Math.max(0, -behind) * 0.18 + lowly * 0.4 },
      // Only a side genuinely adrift tears the system up mid-season.
      { item: "reshape", weight: behind >= 5 ? 0.9 : 0.08 },
    ];

    const squad = [
      // A relegation fight is played with your best eleven, every week, until
      // they are safe or they are down.
      { item: "strongest", weight: 1.3 + Math.max(0, behind) * 0.5 + lowly * 1.6 - tired * 1.6 },
      { item: "rotate", weight: 1.1 + tired * 2.2 + depth * 1.4 },
      // Nothing to play for and a good academy: give the kids a run.
      { item: "youth", weight: (safe ? 0.7 : 0.1) + (club.facilities.youth / 220) },
    ];

    const plan = planFor(club);
    plan.approach = rng.weighted(approach.map((x) => ({ item: x.item, weight: Math.max(0.02, x.weight) })));
    plan.squad = rng.weighted(squad.map((x) => ({ item: x.item, weight: Math.max(0.02, x.weight) })));
    plan.shape = plan.approach === "reshape" ? suggestShape(world, club) : null;
    return plan;
  }

  /* -------------------------------- FATIGUE -------------------------------
   * 0 is fresh, 1 is cooked. It costs a player a slice of his level, and it
   * multiplies his chance of breaking down. */
  /* The tunables live in one mutable object rather than as consts so a
   * calibration harness can turn each mechanic off and measure what it was
   * actually contributing. Ablating by reassigning the exported functions does
   * not work — the code below calls them through closure, not through MG. */
  /* CALIBRATION NOTE. Fatigue and per-block injuries are the two mechanics
   * that make rotation a real decision, and they are also the two that most
   * easily wreck the league table, because both punish a thin squad far harder
   * than a deep one and the effect compounds over five blocks. Measured by
   * ablation over eight seasons: at their first-draft strengths they widened
   * the Premier League's champion-to-bottom spread from 66 points to 81. Half
   * that strength keeps the lever legible to a manager watching his own squad
   * while leaving the division close to where the match engine was calibrated.
   * Re-measure with tests/realism.js before touching any of these. */
  const T = {
    fatigueCost: 0.06,        // a fully cooked player is 6% worse
    blockLoad: 0.45,          // wear from a full block of football
    /* 0.33, not 0.46. At 0.46 the recovery a rotated side got back almost
     * exactly cancelled the wear it took, so ROTATE meant a squad that never
     * tired at all and the lever was binary: rotate and be fresh for ever, or
     * play your eleven and be broken by March. It should be the difference
     * between arriving at April at a fifth cooked and arriving fully cooked. */
    blockRecovery: 0.33,      // what resting through a block gives back
    shift: 1,                 // multiplier on every approach's attack/defence swing
    injuries: 1,              // multiplier on per-block injury risk
    morale: 1,                // multiplier on how far a block moves the dressing room
    refresh: 1,               // 0 skips the per-block ratings refresh (calibration only)
  };
  function tune(over) { Object.assign(T, over || {}); return T; }

  function fatigueOf(player) {
    return clamp((player.season && player.season.fatigue) || 0, 0, 1);
  }

  /* RELATIVE, NOT ABSOLUTE — and this is the whole ballgame.
   *
   * Charged absolutely, fatigue is a tax every club in the world pays and
   * nobody escapes: by April every side is tired, every side is worse, and the
   * only thing that has happened is that the league got quieter. match.js has
   * been here before with the predictability mechanic — see the note in
   * simulateMatch — where an absolute charge dropped both-teams-scored to 43.7%
   * against a real 50% and was correctly diagnosed as "a global goal drought
   * dressed up as a tactics mechanic". Fatigue did exactly the same thing here,
   * for exactly the same reason.
   *
   * Measured against the rest of the world it is zero-sum, aggregate scoring is
   * untouched, and the incentive is the one actually intended: what rotation
   * buys is not freshness, it is being FRESHER THAN THE SIDE YOU ARE PLAYING.
   * A division where everyone is tired in April is just April.
   *
   * `fatigueRel` is stamped onto the player at each block boundary rather than
   * looked up, so it travels in a save and stays a pure function of state. */
  function fatigueMultiplier(player) {
    const rel = (player.season && player.season.fatigueRel) || 0;
    return 1 - clamp(rel, -0.6, 0.6) * T.fatigueCost;
  }

  /** Stamp every player's fatigue relative to the world's, once per block. */
  function markFatiguePar(clubs) {
    let total = 0, n = 0;
    for (const c of clubs) {
      for (const p of c.squad) {
        if (!p.season || (p.season.minutesShare || 0) < 0.05) continue;
        total += fatigueOf(p); n++;
      }
    }
    const par = n ? total / n : 0;
    for (const c of clubs) {
      for (const p of c.squad) {
        if (!p.season) continue;
        p.season.fatigueRel = fatigueOf(p) - par;
      }
    }
    return par;
  }
  function fatigueLabel(v) {
    if (v >= 0.72) return "Exhausted";
    if (v >= 0.5) return "Tiring";
    if (v >= 0.28) return "Worked";
    return "Fresh";
  }
  /** Squad fatigue, weighted toward the men who actually play. */
  function squadFatigue(club) {
    let total = 0, weight = 0;
    for (const p of club.squad) {
      const w = 0.2 + ((p.season && p.season.minutesShare) || 0);
      total += fatigueOf(p) * w;
      weight += w;
    }
    return weight ? clamp(total / weight, 0, 1) : 0;
  }

  /* What the manager actually wants to know: how tired the ELEVEN are. The
   * squad-wide average is the wrong number to put on a screen — a twenty-six
   * man squad carries a dozen players who never get on the pitch and whose
   * fatigue is always zero, and averaging them in reported two per cent for a
   * side whose first choice was at forty-six. */
  function xiFatigue(club) {
    const xi = MG.tactics.effectiveXI(club).filter(Boolean);
    if (!xi.length) return squadFatigue(club);
    return clamp(xi.reduce((t, p) => t + fatigueOf(p), 0) / xi.length, 0, 1);
  }

  /* -------------------------------- INJURIES ------------------------------
   * Rolled per block rather than once in pre-season. That single pre-season
   * roll was the reason nothing a manager did between August and May could
   * make his squad more or less likely to break: the treatment room was
   * decided before a ball was kicked. Now it is decided by how hard he has
   * been running people. */
  const BASE_BLOCK_INJURY = 0.032;

  function rollBlockInjury(rng, player, club, load) {
    const share = clamp((player.season && player.season.minutesShare) || 0, 0, 1);
    if (share < 0.05) return 0;                       // he is not playing enough to get hurt
    const age = player.age;
    const fitness = (player.attrs && player.attrs.fitness) || 60;
    let risk = BASE_BLOCK_INJURY * share;
    risk *= 1 + Math.max(0, age - 29) * 0.06 + Math.max(0, 19 - age) * 0.04;
    risk *= 1 - (fitness - 60) / 300;
    risk *= 1 + fatigueOf(player) * 1.4;              // tired players break
    risk *= load;
    risk *= (club.modifiers && club.modifiers.injuryRisk) || 1;
    if (MG.ratings && MG.ratings.hidden) risk *= MG.ratings.hidden(player).injuryProneness;
    risk = clamp(risk * T.injuries, 0.0, 0.42);
    if (!rng.chance(risk)) return 0;
    // Most knocks cost one block. A small tail costs the rest of the season.
    const roll = rng.next();
    return roll > 0.93 ? 3 : roll > 0.7 ? 2 : 1;
  }

  /* ---------------------------- THE BLOCK BOUNDARY ------------------------
   * Called once per club per block, after the football. Everything the block
   * did to the people in the building happens here. */
  function markBlockStart(club, row) {
    club._blockMark = {
      pts: row ? row.pts : 0, played: row ? row.played : 0,
      gf: row ? row.gf : 0, ga: row ? row.ga : 0,
      won: row ? row.won : 0, drawn: row ? row.drawn : 0, lost: row ? row.lost : 0,
      position: row ? row.position : null,
    };
    for (const p of club.squad) {
      p._blockMark = {
        goals: (p.season && p.season.goals) || 0,
        assists: (p.season && p.season.assists) || 0,
        apps: (p.season && p.season.apps) || 0,
      };
    }
  }

  /** Wear, recovery, returns from injury and new ones — for one club. */
  function settleClub(world, club, rng) {
    const load = loadFactor(club);
    const returning = [], hurt = [];
    for (const p of club.squad) {
      if (!p.season) continue;
      const share = clamp(p.season.minutesShare || 0, 0, 1);

      // 1. Men on the treatment table serve their time first.
      if (p.season.outBlocks > 0) {
        p.season.outBlocks--;
        // Resting mends: an injured man recovers faster than a rotated one.
        p.season.fatigue = clamp(fatigueOf(p) - T.blockRecovery * 1.2, 0, 1);
        if (p.season.outBlocks === 0) returning.push(p);
        continue;
      }

      // 2. Wear from the block just played, absorbed by natural stamina.
      const stamina = clamp(((p.attrs && p.attrs.fitness) || 60) / 99, 0.25, 1);
      const workRate = MG.ratings && MG.ratings.hidden ? MG.ratings.hidden(p).workRate : 0.5;
      const wear = share * load * (0.6 + workRate * 0.4) * T.blockLoad * (1.35 - stamina * 0.55);
      const rest = (1 - share) * T.blockRecovery * (0.75 + stamina * 0.45);
      p.season.fatigue = clamp(fatigueOf(p) + wear - rest, 0, 1);

      // 3. And then the treatment room takes its cut.
      const out = rollBlockInjury(rng, p, club, load);
      if (out > 0) {
        p.season.outBlocks = out;
        /* `injured` is the share of the SEASON lost, which is what selection
         * and availability have always read. Blocks are fifths, so that is
         * what a block out costs — accumulated, because a man who breaks down
         * twice has missed twice as much. */
        p.season.injured = clamp((p.season.injured || 0) + out / 5, 0, 1);
        hurt.push({ player: p, blocks: out });
      }
    }
    return { returning, hurt };
  }

  /* Morale moves on results and on minutes. A squad player who has not had a
   * game in two months is unhappy about it whatever the table says, which is
   * the cost of STRONGEST XI that a results-only model never charged. */
  /* Morale REGRESSES as well as moves. Without this it is a random walk with
   * absorbing bounds at 5 and 100: a good club ratchets to permanent euphoria
   * and a bad one to permanent misery, and since morale is worth about 6% of a
   * player's level the two ends of the table drift apart for ever. The old
   * build got away with it because morale settled once a season; settling it
   * five times made it saturate six times faster, and it showed up as a league
   * table that kept widening the longer a save ran — measured over twenty
   * seasons, both-teams-scored fell a further point beyond where it sat at
   * eight. A dressing room drifts back toward normal, and now it does. */
  const MORALE_BASE = 60;
  const MORALE_PULL = 0.12;

  function settleMorale(club, blockResult) {
    const p = planFor(club);
    const played = blockResult.played || 0;
    const ppg = played ? blockResult.pts / played : 1;
    const teamSwing = (ppg - 1.35) * 3.2;
    const rotating = SQUAD_PLAN[p.squad].rotation;
    for (const pl of club.squad) {
      if (!pl.season) continue;
      const share = clamp(pl.season.minutesShare || 0, 0, 1);
      // Results matter most to the men playing; being ignored matters most to
      // the men who are not.
      const resultTerm = teamSwing * (0.45 + share * 0.75);
      const minutesTerm = share < 0.15 ? -2.6 + rotating * 2.2 : share * 1.4;
      const fatigueTerm = -fatigueOf(pl) * 1.6;
      const swing = (resultTerm + minutesTerm + fatigueTerm) * T.morale;
      const now = pl.morale == null ? MORALE_BASE : pl.morale;
      pl.morale = clamp(now + (MORALE_BASE - now) * MORALE_PULL + swing, 5, 100);
    }
  }

  function moraleLabel(v) {
    if (v >= 72) return { label: "High", cls: "accent" };
    if (v >= 56) return { label: "Stable", cls: "gold" };
    if (v >= 40) return { label: "Fragile", cls: "warn" };
    return { label: "Toxic", cls: "bad" };
  }

  /* ---------------------------- BLOCK PERFORMANCE -------------------------
   * A rough mark out of 10 for the two months just gone, so the review can
   * name three players who deserve it rather than listing the whole squad.
   * Goals and assists against what a man in that position is expected to
   * produce, plus a share of the team's results for everybody else. */
  const OUTPUT_EXPECT = { FW: 1.0, WG: 0.75, AM: 0.7, CM: 0.4, DM: 0.22, FB: 0.25, CB: 0.18, GK: 0.05 };

  function blockRating(player, blockPpg) {
    const m = player._blockMark || { goals: 0, assists: 0, apps: 0 };
    const s = player.season || {};
    const apps = Math.max(0, (s.apps || 0) - m.apps);
    if (!apps) return null;
    const goals = Math.max(0, (s.goals || 0) - m.goals);
    const assists = Math.max(0, (s.assists || 0) - m.assists);
    const output = goals + assists * 0.6;
    const expected = (OUTPUT_EXPECT[player.pos] || 0.3) * apps * 0.28;
    const vs = expected > 0 ? (output - expected) / Math.max(0.6, expected) : output;
    const base = 6.1 + (blockPpg - 1.35) * 0.55;
    return {
      rating: Math.round(clamp(base + clamp(vs, -1.6, 2.4) * 0.95, 3.5, 9.8) * 10) / 10,
      apps, goals, assists,
    };
  }

  MG.blocks = {
    APPROACH, APPROACH_KEYS, SQUAD_PLAN, SQUAD_KEYS, DEFAULT_PLAN,
    planFor, shiftFor, loadFactor, rotationOf, youthBiasOf, suggestShape, aiPlan,
    fatigueOf, fatigueMultiplier, fatigueLabel, squadFatigue, xiFatigue, markFatiguePar, T, tune,
    rollBlockInjury, markBlockStart, settleClub, settleMorale, moraleLabel,
    blockRating, OUTPUT_EXPECT,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
