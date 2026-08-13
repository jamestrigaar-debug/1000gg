/* ============================================================================
 * FOOTBALL MANAGER — THE TRANSFER WINDOW
 *
 * Run once per summer for all 221 clubs. This is the system that makes the
 * world move between seasons: squads age, contracts run out, academies produce,
 * and every manager in the world goes shopping according to his own traits and
 * his own board's money.
 *
 * The order matters and is deliberate:
 *   1. ageing, development and decline          (who got better, who got worse)
 *   2. retirements and expiring contracts       (who left the game entirely)
 *   3. budgets                                  (what each board will fund)
 *   4. listings                                 (who is available, and why)
 *   5. the window itself, richest club first    (who gets first pick)
 *   6. free agents and squad top-ups            (nobody fields nine players)
 *   7. youth intake                             (next season's kids)
 *
 * Fees are real money: they leave one club's balance and arrive at another's.
 * A club that overspends carries the debt into the board's finance metric next
 * season, which is how a chequebook manager eventually gets himself sacked
 * even while the team is winning.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp, round1 } = MG.util;

  const MIN_SQUAD = 18;

  /* ------------------------ AGEING AND DEVELOPMENT ------------------------ */
  function developSquads(world) {
    const rng = world.rng;
    for (const club of world.clubs) {
      const manager = world.managerById(club.managerId);
      const coaching = MG.managers.coachingQuality(manager, club);
      for (const p of club.squad) {
        p.age++;
        const minutes = p.season.minutesShare || 0.2;
        const delta = MG.players.developmentDelta(rng, p, coaching, minutes);
        p.overall = clamp(Math.round((p.overall + delta) * 10) / 10, 25, 96);
        if (p.overall > p.potential) p.potential = p.overall;
        // Physical attributes follow the same curve, a little more slowly.
        const phys = delta * 0.6;
        p.attrs.speed = clamp(Math.round(p.attrs.speed + (p.age > 29 ? phys * 1.4 : phys * 0.5)), 20, 99);
        p.attrs.fitness = clamp(Math.round(p.attrs.fitness + phys * 0.8), 20, 99);
        p.attrs.strength = clamp(Math.round(p.attrs.strength + (p.age < 26 ? 0.6 : phys * 0.4)), 20, 99);
        p.contract.years--;
        p.career.apps += p.season.apps;
        p.career.goals += p.season.goals;
        p.career.assists += p.season.assists;
        p.career.seasons++;
        p.value = MG.players.marketValue(p);
      }
    }
  }

  /** Retirement, then contract expiry. Returns the news-worthy departures. */
  function retirementsAndExpiries(world) {
    const rng = world.rng;
    const news = [];
    const freeAgents = [];
    for (const club of world.clubs) {
      const keep = [];
      for (const p of club.squad) {
        // Retirement: rises steeply from 33, certain at 41, and comes early for
        // players who have dropped below the level of their division.
        const league = MG.clubs.LEAGUES[club.leagueId];
        const belowLevel = p.overall < 35 + league.prestige * 25;
        let retireChance = p.age >= 41 ? 1 : p.age >= 38 ? 0.55 : p.age >= 35 ? 0.28 : p.age >= 33 ? 0.10 : 0;
        if (belowLevel && p.age >= 31) retireChance += 0.25;
        if (retireChance > 0 && rng.chance(retireChance)) {
          p.retired = true;
          if (p.career.goals >= 150 || p.overall >= 82) {
            news.push({ type: "retirement", text: `${p.name} retires at ${p.age} after ${p.career.seasons} seasons and ${p.career.goals} career goals.`, clubId: club.id });
          }
          continue;
        }
        keep.push(p);
      }
      club.squad = keep;

      // Contract renewals and releases. A club renews the players it rates and
      // can afford; everyone else runs down and walks.
      const manager = world.managerById(club.managerId);
      const policy = MG.managers.recruitmentPolicy(manager);
      const stillHere = [];
      for (const p of club.squad) {
        if (p.contract.years > 0) { stillHere.push(p); continue; }
        const squadRank = club.squad.filter((q) => q.pos === p.pos && q.overall > p.overall).length;
        const wanted = squadRank < MG.players.POSITIONS[p.pos].need && p.age <= policy.maxAge + 3;
        const affordable = club.finances.wageBill < club.finances.wageBudget * 1.05;
        if (wanted && affordable && rng.chance(0.8)) {
          p.contract.years = rng.int(2, 4);
          p.contract.wage = round1(MG.players.expectedWage(p, club.leagueId) * rng.between(1.0, 1.15));
          stillHere.push(p);
        } else {
          p.clubId = null;
          freeAgents.push(p);
        }
      }
      club.squad = stillHere;
    }
    return { news, freeAgents };
  }

  /* ------------------------------ LISTINGS -------------------------------- */
  /** Who each club is prepared to move on before anyone even bids. */
  function buildListings(world) {
    const rng = world.rng;
    const listed = [];
    for (const club of world.clubs) {
      const manager = world.managerById(club.managerId);
      const policy = MG.managers.recruitmentPolicy(manager);
      const overWages = club.finances.wageBill > club.finances.wageBudget;
      const inDebt = club.finances.balance < 0;

      const ranked = club.squad.slice().sort((a, b) => b.overall - a.overall);

      // A club in real financial trouble puts its best assets in the window,
      // whatever the manager wants. This is the release valve that stops debt
      // compounding forever, and it is why a badly run big club eventually
      // stops being a big club.
      if (club.mustSell) {
        const byValue = club.squad.slice().sort((a, b) => b.value - a.value);
        for (const p of byValue.slice(0, 3)) listed.push({ player: p, club, forced: true, fireSale: true });
      }

      for (let i = 0; i < ranked.length; i++) {
        const p = ranked[i];
        if (club.squad.length <= MIN_SQUAD + 2) break;
        const depth = club.squad.filter((q) => q.pos === p.pos).length;
        const need = MG.players.POSITIONS[p.pos].need;

        let chance = 0;
        if (depth > need) chance += 0.25;                       // surplus to requirements
        if (p.age > policy.maxAge) chance += 0.30;              // does not fit the manager
        if (i >= MG.players.SQUAD_TARGET - 4) chance += 0.15;   // fringe
        if (overWages) chance += 0.20;
        if (inDebt) chance += 0.30;
        chance *= policy.churn;
        if (chance > 0 && rng.chance(clamp(chance, 0, 0.85))) {
          // Tag it on the player too: an AI manager listing someone is the same
          // act as the human doing it, and the rest of the game should be able
          // to see it the same way.
          p.transferListed = true;
          listed.push({ player: p, club, forced: inDebt || overWages });
        }
      }
    }
    return listed;
  }

  /* ------------------------------ THE WINDOW ------------------------------ */
  /** Index every player in the world by position, best first. Buying clubs walk
   *  this list from their own quality level downward. */
  function indexPlayers(world) {
    const byPos = {};
    for (const club of world.clubs) {
      for (const p of club.squad) {
        (byPos[p.pos] = byPos[p.pos] || []).push({ player: p, club });
      }
    }
    for (const pos of Object.keys(byPos)) byPos[pos].sort((a, b) => b.player.overall - a.player.overall);
    return byPos;
  }

  /** Would the selling club take this money? */
  function askingPrice(entry, buyer, listedSet) {
    const { player, club } = entry;
    let multiple = 1.15;
    if (listedSet.has(player.id)) multiple = 0.9;
    // Reluctance: a club will not sell its best player to a rival cheaply, and
    // a big club barely notices the money at all.
    const isKeyPlayer = club.squad.filter((q) => q.overall > player.overall).length < 3;
    if (isKeyPlayer) multiple += 0.55;
    const repGap = club.reputation - buyer.reputation;
    if (repGap > 0) multiple += repGap / 55;          // selling down the ladder costs more
    if (club.finances.balance < 0) multiple -= 0.25;  // needs must
    return round1(player.value * clamp(multiple, 0.6, 2.4));
  }

  /** How much this club's manager wants this player. */
  function targetScore(player, buyer, policy, need) {
    if (player.age < policy.minAge || player.age > policy.maxAge) return -1;
    const league = MG.clubs.LEAGUES[buyer.leagueId];
    // No point signing someone worse than what is already in the building.
    const bar = need.currentQuality;
    let score = (player.overall - bar) * 3;
    if (score < -12) return -1;
    const headroom = player.potential - player.overall;
    score += headroom * 2.2 * policy.potentialBias;
    if (player.age <= 23) score += 6 * policy.potentialBias;
    if (player.age >= 29) score -= (player.age - 28) * 4;
    score += (player.overall - player.value * 0.4) * 0.15 * policy.valueBias;  // bargain hunting
    score *= need.urgency;
    // Prestige pull: nobody drops four divisions for the football.
    score += (league.prestige - 0.5) * 8;
    return score;
  }

  /** Everything a club is short of, worst first. */
  function clubNeeds(club) {
    const { counts } = MG.players.squadNeeds(club.squad);
    const needs = [];
    for (const pos of MG.players.POSITION_KEYS) {
      const def = MG.players.POSITIONS[pos];
      const players = club.squad.filter((p) => p.pos === pos).sort((a, b) => b.overall - a.overall);
      const short = Math.max(0, def.need - players.length);
      const starters = players.slice(0, def.starters);
      const currentQuality = starters.length
        ? starters.reduce((t, p) => t + p.overall, 0) / starters.length
        : 30;
      // Urgency: missing bodies first, then the weakest position relative to
      // the rest of the squad.
      const squadLevel = club.squad.length
        ? club.squad.reduce((t, p) => t + p.overall, 0) / club.squad.length : 50;
      const gap = squadLevel - currentQuality;
      const urgency = 1 + short * 0.9 + clamp(gap, 0, 12) * 0.12 + (counts[pos] < def.starters ? 1.2 : 0);
      needs.push({ pos, short, currentQuality, urgency });
    }
    return needs.sort((a, b) => b.urgency - a.urgency);
  }

  function runWindow(world) {
    const rng = world.rng;
    const news = [];
    let deals = 0;
    const listings = buildListings(world);
    const listedSet = new Set(listings.map((l) => l.player.id));
    const index = indexPlayers(world);

    // Richest first — the pecking order of a real window.
    const buyers = world.clubs.slice().sort((a, b) => b.finances.transferBudget - a.finances.transferBudget);

    for (const buyer of buyers) {
      const manager = world.managerById(buyer.managerId);
      const policy = MG.managers.recruitmentPolicy(manager);
      const acumen = manager ? manager.attrs.transferAcumen : 50;
      // policy.spend lets a chequebook manager stretch and a loyalist hold
      // back, but never past what the club actually has — that overshoot was
      // how clubs ran up nine-figure debts they could never trade out of.
      let budget = Math.min(
        buyer.finances.transferBudget * policy.spend,
        Math.max(0, buyer.finances.balance) + buyer.finances.revenue * 0.2
      );
      let wageRoom = buyer.finances.wageBudget - MG.clubs.wageBill(buyer);

      const needs = clubNeeds(buyer);
      const maxSignings = clamp(Math.round(2 + policy.churn + (budget > 60 ? 2 : 0)), 1, 6);
      let signings = 0;

      for (const need of needs) {
        if (signings >= maxSignings) break;
        if (budget < 0.05 && wageRoom <= 0) break;
        const pool = index[need.pos] || [];

        // Walk candidates around and below the club's own level. Scanning the
        // whole world for every club would be both slow and unrealistic — a
        // League Two side is not evaluating Real Madrid's back four.
        let evaluated = 0;
        let best = null, bestScore = 0, bestFee = 0;
        for (const entry of pool) {
          if (evaluated > 60) break;
          const { player, club: seller } = entry;
          if (seller.id === buyer.id || player.retired || player.clubId === buyer.id) continue;
          // The index is a snapshot taken before the window opened. Once a
          // player has moved, his entry in it is stale — without this check the
          // second buyer to reach him would remove him from a club he had
          // already left and add him to a second squad, and the same striker
          // would turn out for five clubs at once.
          if (player.clubId !== seller.id) continue;
          if (player.overall > need.currentQuality + 14) continue;   // out of reach
          evaluated++;
          if (seller.squad.length <= MIN_SQUAD) continue;
          const fee = askingPrice(entry, buyer, listedSet);
          if (fee > budget) continue;
          const wage = MG.players.expectedWage(player, buyer.leagueId) * rng.between(1.0, 1.2);
          if (wage * 52 / 1000 > wageRoom) continue;
          // A better negotiator gets more player for the money.
          const score = targetScore(player, buyer, policy, need) * (1 + (acumen - 50) / 250) - fee * 0.35;
          if (score > bestScore) { best = entry; bestScore = score; bestFee = fee; }
        }

        if (!best) continue;
        const { player, club: seller } = best;
        const wage = round1(MG.players.expectedWage(player, buyer.leagueId) * rng.between(1.0, 1.2));

        // Complete the deal.
        seller.squad = seller.squad.filter((p) => p.id !== player.id);
        seller.finances.received = round1(seller.finances.received + bestFee);
        seller.finances.balance = round1(seller.finances.balance + bestFee);
        buyer.squad.push(player);
        buyer.finances.spent = round1(buyer.finances.spent + bestFee);
        buyer.finances.balance = round1(buyer.finances.balance - bestFee);
        player.clubId = buyer.id;
        player.contract = { years: rng.int(2, 5), wage };
        player.career.clubs.push(buyer.name);
        player.value = MG.players.marketValue(player);
        budget -= bestFee;
        wageRoom -= wage * 52 / 1000;
        signings++;
        deals++;
        listedSet.delete(player.id);

        if (bestFee >= 12 || player.overall >= 80) {
          news.push({
            type: "transfer",
            text: `${player.name} (${player.pos}, ${player.age}, ${player.overall}) joins ${buyer.name} from ${seller.name} for £${bestFee}m.`,
            clubId: buyer.id, fee: bestFee,
          });
        }
      }
    }
    return { news, listings: listings.length, deals };
  }

  /* --------------------- FREE AGENTS AND SQUAD TOP-UPS -------------------- */
  function signFreeAgents(world, freeAgents) {
    const rng = world.rng;
    const pool = freeAgents.filter((p) => !p.retired).sort((a, b) => b.overall - a.overall);
    // Best clubs pick first, but only from players good enough for them.
    const clubs = world.clubs.slice().sort((a, b) => b.reputation - a.reputation);
    for (const club of clubs) {
      const league = MG.clubs.LEAGUES[club.leagueId];
      const bar = 30 + league.prestige * 38;
      const needs = clubNeeds(club);
      for (const need of needs) {
        if (club.squad.length >= MG.players.SQUAD_TARGET) break;
        if (need.short <= 0 && club.squad.length >= MIN_SQUAD + 2) continue;
        const idx = pool.findIndex((p) => p.pos === need.pos && p.overall >= bar - 12 && p.overall <= need.currentQuality + 8);
        if (idx === -1) continue;
        const p = pool.splice(idx, 1)[0];
        p.clubId = club.id;
        p.contract = { years: rng.int(1, 3), wage: MG.players.expectedWage(p, club.leagueId) };
        p.career.clubs.push(club.name);
        club.squad.push(p);
      }
    }
    // Anyone left without a club drops out of the game.
    for (const p of pool) p.retired = true;
  }

  /** Nobody fields nine players: fill genuine holes with generated journeymen. */
  function topUpSquads(world) {
    const rng = world.rng;
    for (const club of world.clubs) {
      const league = MG.clubs.LEAGUES[club.leagueId];
      let guard = 0;
      while (club.squad.length < MIN_SQUAD && guard++ < 20) {
        const { needs } = MG.players.squadNeeds(club.squad);
        const pos = needs.length ? needs.sort((a, b) => b.urgency - a.urgency)[0].pos : rng.pick(MG.players.POSITION_KEYS);
        // clubStrength is on the TEAM rating scale and generate() wants the
        // PLAYER overall scale. Passing one straight into the other had a
        // National League club (strength 35) manufacturing 27-rated players
        // every summer, which dragged its own strength down and made it do the
        // same thing harder next year — the whole lower pyramid decayed.
        const level = club.level != null ? club.level : MG.clubs.playerLevelFor(club);
        const target = level - rng.between(4, 12);
        const p = MG.players.generate(rng, { league: club.leagueId, pos, target, spread: 3, age: rng.int(20, 31) });
        p.clubId = club.id;
        p.career.clubs.push(club.name);
        club.squad.push(p);
      }
      // Squads that ballooned past the target shed their worst players.
      if (club.squad.length > MG.players.SQUAD_TARGET + 4) {
        club.squad.sort((a, b) => b.overall - a.overall);
        club.squad = club.squad.slice(0, MG.players.SQUAD_TARGET + 4);
      }
      void league;
    }
  }

  /* ----------------------------- YOUTH INTAKE ------------------------------
   * Every club produces players every year. How many and how good depends on
   * the club's youth facilities and on whether its manager cares — which is
   * what makes an academy a strategy rather than a stat. */
  function youthIntake(world) {
    const rng = world.rng;
    const news = [];
    for (const club of world.clubs) {
      const manager = world.managerById(club.managerId);
      const youthRating = club.facilities.youth * (manager ? 1 + (manager.attrs.development - 60) / 300 : 1);
      const count = clamp(Math.round(1 + youthRating / 45 + rng.gauss() * 0.6), 1, 4);
      for (let i = 0; i < count; i++) {
        const pos = rng.pick(MG.players.POSITION_KEYS);
        const age = rng.int(16, 18);
        // A graduate starts well below first-team level; the interesting number
        // is his potential, and only good academies produce a real one. The
        // floor keeps him within reach of the division he was born into.
        const level = club.level != null ? club.level : MG.clubs.playerLevelFor(club);
        const target = Math.max(30 + youthRating * 0.32, level - 18) + rng.gauss() * 4;
        const p = MG.players.generate(rng, {
          league: club.leagueId, pos, age, target, spread: 3, homegrown: true,
          nationality: MG.names.nationForLeague(rng, club.leagueId),
        });
        /* The wonderkid roll, weighted by the academy — and anchored to the
         * club's own level rather than to fixed numbers. A fixed ceiling of
         * 48-69 for the common case meant every academy in the world, Manchester
         * City's included, produced players who topped out below the level of
         * the division they were born into: over twenty seasons the entire
         * player population decayed toward the ceiling of its own youth intake. */
        const eliteRoll = rng.next();
        const ceiling = eliteRoll > 0.985 - youthRating / 2500 ? level + rng.int(6, 16)
          : eliteRoll > 0.88 ? level + rng.int(-4, 6)
            : level - rng.int(4, 20);
        p.potential = clamp(Math.max(p.overall + 3, ceiling), p.overall, 96);
        p.contract = { years: rng.int(2, 4), wage: MG.players.expectedWage(p, club.leagueId) };
        p.clubId = club.id;
        p.career.clubs.push(club.name);
        club.squad.push(p);
        if (p.potential >= 86) {
          news.push({ type: "youth", text: `${club.name}'s academy produces ${p.name} (${p.pos}, ${p.age}) — the coaches think he can play at the very top.`, clubId: club.id });
        }
      }
    }
    return news;
  }

  /* ------------------- DIRECTED DEALS (the decision layer) -----------------
   * The window above is the AI acting on its own. These two are what a DECISION
   * calls when the player says "sign a striker" or "cash in on him" — the same
   * market, the same prices, but a single deal made deliberately rather than a
   * whole window simulated. */

  /** Sign the best player the club can afford in a given mould. */
  function findAndSign(world, club, opts) {
    const rng = world.rng;
    const o = opts || {};
    const index = indexPlayers(world);
    const budget = o.maxFee != null ? o.maxFee : club.finances.transferBudget;
    const level = club.level != null ? club.level : MG.clubs.playerLevelFor(club);

    // Which position: asked for, or whatever the squad is thinnest in.
    let pos = o.pos;
    if (!pos) {
      const needs = clubNeeds(club);
      pos = needs[0] ? needs[0].pos : rng.pick(MG.players.POSITION_KEYS);
    }
    // What calibre: a marquee signing reaches above the club's level, a squad
    // player sits under it, a prospect is young and unfinished.
    const bar = o.quality === "star" ? level + 6
      : o.quality === "prospect" ? level - 6
        : level + 1;

    let best = null, bestFee = 0, bestScore = -Infinity;
    for (const entry of (index[pos] || [])) {
      const { player, seller } = { player: entry.player, seller: entry.club };
      if (seller.id === club.id || player.retired || player.clubId !== seller.id) continue;
      if (seller.squad.length <= MIN_SQUAD) continue;
      if (o.quality === "prospect" && player.age > 22) continue;
      if (o.quality === "star" && player.overall < level + 2) continue;
      const fee = askingPrice({ player, club: seller }, club, new Set());
      if (fee > budget) continue;
      const wage = MG.players.expectedWage(player, club.leagueId);
      // Closeness to the calibre asked for, minus what it costs.
      const score = -Math.abs(player.overall - bar) * 3
        + (o.quality === "prospect" ? (player.potential - player.overall) * 2 : 0)
        - fee * 0.12;
      if (score > bestScore) { best = { player, seller, wage }; bestScore = score; bestFee = fee; }
    }
    if (!best) return null;

    const { player, seller, wage } = best;
    seller.squad = seller.squad.filter((p) => p.id !== player.id);
    seller.finances.balance = round1(seller.finances.balance + bestFee);
    seller.finances.received = round1(seller.finances.received + bestFee);
    club.squad.push(player);
    club.finances.balance = round1(club.finances.balance - bestFee);
    club.finances.spent = round1(club.finances.spent + bestFee);
    club.finances.transferBudget = round1(Math.max(0, club.finances.transferBudget - bestFee));
    player.clubId = club.id;
    player.contract = { years: rng.int(3, 5), wage: round1(wage * rng.between(1.0, 1.2)) };
    player.career.clubs.push(club.name);
    player.value = MG.players.marketValue(player);
    // He arrives for pre-season fit. Without this he carries the injury rolled
    // for him at his old club and a marquee signing could lower the very rating
    // he was bought to raise.
    player.season.injured = 0;
    MG.clubs.refreshRatings(club);
    return { player, fee: bestFee, from: seller.name };
  }

  /** Cash in on someone. `which`: "star" | "veteran" | "fringe". */
  function sellOne(world, club, which) {
    if (club.squad.length <= MIN_SQUAD) return null;
    const ranked = club.squad.slice().sort((a, b) => b.overall - a.overall);
    let player;
    if (which === "star") player = ranked[0];
    else if (which === "veteran") player = club.squad.slice().sort((a, b) => b.age - a.age)[0];
    else player = ranked[ranked.length - 1];
    if (!player) return null;

    const fee = round1(player.value * (which === "star" ? 1.25 : 0.9));

    /* Somebody has to buy him. Handing the selling club the money and deleting
     * the player would leak a footballer out of the world every time a manager
     * cashed in — so the richest club that can afford him and has room takes
     * him, and the fee moves between two real balance sheets. If nobody can
     * afford him, the sale does not happen, which is itself the honest answer. */
    /* The buyer has to be a club that would plausibly want him: good enough
     * that he improves them is not required, but he cannot be twenty rating
     * points below their level or Barcelona ends up buying League Two squad
     * players because they happen to have the most money. */
    const buyer = world.clubs
      .filter((c) => c.id !== club.id
        && c.finances.balance >= fee
        && c.squad.length < MG.players.SQUAD_TARGET + 3
        && (c.level || 50) >= player.overall - 12
        && player.overall >= (c.level || 50) - 13)
      .sort((a, b) => b.finances.transferBudget - a.finances.transferBudget)[0];
    if (!buyer) return null;

    club.squad = club.squad.filter((p) => p.id !== player.id);
    club.finances.balance = round1(club.finances.balance + fee);
    club.finances.received = round1(club.finances.received + fee);
    club.finances.transferBudget = round1(club.finances.transferBudget + fee);

    buyer.squad.push(player);
    buyer.finances.balance = round1(buyer.finances.balance - fee);
    buyer.finances.spent = round1(buyer.finances.spent + fee);
    player.clubId = buyer.id;
    player.contract = { years: 3, wage: MG.players.expectedWage(player, buyer.leagueId) };
    player.career.clubs.push(buyer.name);
    MG.clubs.refreshRatings(club);
    MG.clubs.refreshRatings(buyer);
    return { player, fee, to: buyer.name };
  }

  /* ===================== THE MANAGER'S TRANSFER MARKET =====================
   * The player does not execute transfers himself — he tells the boardroom
   * what he wants and the boardroom does the deal, which is both how a modern
   * club works and how the AI clubs already behave. Two levers:
   *
   *   transferList   players of yours you are willing to lose
   *   targets        players elsewhere you have asked the board to bid for
   *
   * Both are resolved in the summer, before the AI window opens, and the
   * results are reported back on the end-of-season screen. The board can and
   * does refuse: a bid above what it will fund simply does not happen.
   * ====================================================================== */

  /** Everyone a club could plausibly sign, with what it would cost. */
  function market(world, club, opts) {
    const o = opts || {};
    const level = club.level != null ? club.level : MG.clubs.playerLevelFor(club);
    const budget = o.budget != null ? o.budget : club.finances.transferBudget;
    const out = [];
    for (const seller of world.clubs) {
      if (seller.id === club.id) continue;
      for (const p of seller.squad) {
        if (p.retired) continue;
        // Only show players who would realistically consider the move: within
        // reach of the club's level, and not so far below it as to be pointless.
        if (p.overall > level + 12) continue;
        if (p.overall < level - 14) continue;
        if (o.pos && p.pos !== o.pos) continue;
        const fee = askingPrice({ player: p, club: seller }, club, new Set());
        if (o.affordableOnly && fee > budget) continue;
        out.push({
          player: p, club: seller, fee,
          wage: MG.players.expectedWage(p, club.leagueId),
          listed: !!p.transferListed,
        });
      }
    }
    // Listed players first, then quality — the shop window before the rest.
    out.sort((a, b) => (b.listed - a.listed) || (b.player.overall - a.player.overall));
    return out.slice(0, o.limit || 60);
  }

  /** Resolve everything the manager asked the board to do this summer. */
  function executeManagerRequests(world, club) {
    const rng = world.rng;
    const sold = [], bought = [], refused = [];

    /* ---- outgoings first: you sell before you buy ---- */
    for (const id of (club.transferList || []).slice()) {
      const player = club.squad.find((p) => p.id === id);
      if (!player) continue;
      if (club.squad.length <= MIN_SQUAD) { refused.push({ player, reason: "the squad is already too thin" }); continue; }
      const fee = round1(player.value * 0.95);
      const buyer = world.clubs
        .filter((c) => c.id !== club.id
          && c.finances.balance >= fee
          && c.squad.length < MG.players.SQUAD_TARGET + 3
          && (c.level || 50) >= player.overall - 12
          && player.overall >= (c.level || 50) - 13)
        .sort((a, b) => b.finances.transferBudget - a.finances.transferBudget)[0];
      if (!buyer) { refused.push({ player, reason: "nobody bid" }); continue; }

      club.squad = club.squad.filter((p) => p.id !== player.id);
      club.finances.balance = round1(club.finances.balance + fee);
      club.finances.received = round1(club.finances.received + fee);
      club.finances.transferBudget = round1(club.finances.transferBudget + fee);
      buyer.squad.push(player);
      buyer.finances.balance = round1(buyer.finances.balance - fee);
      buyer.finances.spent = round1(buyer.finances.spent + fee);
      player.clubId = buyer.id;
      player.transferListed = false;
      player.contract = { years: 3, wage: MG.players.expectedWage(player, buyer.leagueId) };
      player.career.clubs.push(buyer.name);
      MG.clubs.refreshRatings(buyer);
      sold.push({ player, fee, to: buyer.name });
    }

    /* ---- then the bids, best target first, until the money runs out ---- */
    const targets = (club.targets || []).slice();
    for (const id of targets) {
      let entry = null;
      for (const seller of world.clubs) {
        const p = seller.squad.find((x) => x.id === id);
        if (p) { entry = { player: p, club: seller }; break; }
      }
      if (!entry) { continue; }                      // already moved elsewhere
      const { player, club: seller } = entry;
      const fee = askingPrice(entry, club, new Set());
      const wage = round1(MG.players.expectedWage(player, club.leagueId) * rng.between(1.0, 1.15));
      const wageRoom = club.finances.wageBudget - wageBillOf(club);

      if (fee > club.finances.transferBudget) { refused.push({ player, reason: `the board will not fund ${fmtFee(fee)}` }); continue; }
      if (wage * 52 / 1000 > wageRoom) { refused.push({ player, reason: "his wages break the budget" }); continue; }
      if (seller.squad.length <= MIN_SQUAD) { refused.push({ player, reason: "his club refused to sell" }); continue; }
      // A selling club will not sell to a direct rival in its own division for
      // an ordinary fee — this is where a lot of real bids die.
      if (seller.leagueId === club.leagueId && seller.reputation >= club.reputation && rng.chance(0.5)) {
        refused.push({ player, reason: "his club will not sell to a rival" });
        continue;
      }

      seller.squad = seller.squad.filter((p) => p.id !== player.id);
      seller.finances.balance = round1(seller.finances.balance + fee);
      seller.finances.received = round1(seller.finances.received + fee);
      club.squad.push(player);
      club.finances.balance = round1(club.finances.balance - fee);
      club.finances.spent = round1(club.finances.spent + fee);
      club.finances.transferBudget = round1(Math.max(0, club.finances.transferBudget - fee));
      player.clubId = club.id;
      player.transferListed = false;
      player.season.injured = 0;
      player.contract = { years: rng.int(3, 5), wage };
      player.career.clubs.push(club.name);
      player.value = MG.players.marketValue(player);
      MG.clubs.refreshRatings(seller);
      bought.push({ player, fee, from: seller.name });
    }

    club.transferList = [];
    club.targets = [];
    MG.clubs.refreshRatings(club);
    return { sold, bought, refused };
  }

  function wageBillOf(club) { return MG.clubs.wageBill(club); }
  function fmtFee(f) { return f >= 10 ? `£${Math.round(f)}m` : `£${round1(f)}m`; }

  MG.transfers = {
    MIN_SQUAD, findAndSign, sellOne, market, executeManagerRequests, developSquads, retirementsAndExpiries, buildListings, indexPlayers,
    askingPrice, targetScore, clubNeeds, runWindow, signFreeAgents, topUpSquads, youthIntake,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
