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
      // Training Focus's long-term half (tactics.js): up to 12% faster growth
      // pointed at Youth Development, up to 12% slower at pure Match
      // Sharpness. Every club gets a focus that suits its manager the moment
      // he is appointed (autoTrainingFocus), so this varies across the world
      // exactly as much as manager tactics and traits already do — a club
      // that never touches the lever again just keeps its manager's default.
      const coaching = MG.managers.coachingQuality(manager, club)
        * (MG.tactics && MG.tactics.developmentMultiplier ? MG.tactics.developmentMultiplier(club) : 1);
      const mentored = new Set(club.mentoring || []);
      const boost = mentored.size ? MG.managers.mentorBoost(manager) : 0;
      for (const p of club.squad) {
        p.age++;
        const minutes = p.season.minutesShare || 0.2;
        let delta = MG.players.developmentDelta(rng, p, coaching, minutes);
        // A mentored player gets a real leg up — this is the payoff for the
        // manager spending one of his limited mentoring slots on him, and it is
        // biggest for the young players who still have headroom to grow into.
        if (mentored.has(p.id) && p.overall < p.potential) delta += boost;
        // A season of international football sharpens a young player on top of
        // his club development — caps and goals feeding growth, as asked.
        if (MG.international && p.overall < p.potential) delta += MG.international.developmentBonus(p);
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
        /* Retirement (brief §22): age is a modifier, not the whole story — a
         * flat age-bracket curve is exactly what produced the reported bug
         * ("Grealish retires at 36 after one season"): the game had no way
         * to tell a first-team regular from a man who barely played, so both
         * retired off the same roll. Two more factors now feed the same
         * chance: how much football he actually got this season (a bit-part
         * veteran winds down for real reasons the age curve alone misses),
         * and whether he is still clearly better than his level (the
         * "ageing legend" case — Modrić at 40 stays a year longer than a
         * bang-average 40-year-old would). Rates themselves are also a
         * notch softer through the mid-30s than the old curve, since real
         * top-flight careers routinely run to 35-37. */
        const league = MG.clubs.LEAGUES[club.leagueId];
        const belowLevel = p.overall < 35 + league.prestige * 25;
        const playingTime = p.season.minutesShare || 0;
        const eliteForAge = p.overall >= (club.level != null ? club.level : 60) + 6;
        let retireChance = p.age >= 41 ? 1 : p.age >= 38 ? 0.5 : p.age >= 36 ? 0.2
          : p.age >= 34 ? 0.09 : p.age >= 32 ? 0.03 : 0;
        if (p.age >= 32 && playingTime < 0.25) retireChance += 0.18;
        if (eliteForAge) retireChance *= 0.55;
        if (belowLevel && p.age >= 31) retireChance += 0.2;
        retireChance = clamp(retireChance, 0, 1);
        if (retireChance > 0 && rng.chance(retireChance)) {
          p.retired = true;
          /* Anyone leaving the managed club is reported, not just the famous —
           * a squad player quietly retiring used to remove him from the squad
           * with no explanation anywhere. Elsewhere in the world only the
           * notable retirements are worth a line. */
          if (club.id === world.playerClubId) {
            news.push({ type: "retirement", text: `RETIRED — ${p.name} (${p.pos}, ${p.age}) hangs up his boots after ${p.career.seasons} season${p.career.seasons === 1 ? "" : "s"}${p.career.goals ? ` and ${p.career.goals} career goals` : ""}.`, clubId: club.id });
          } else if (p.career.goals >= 150 || p.overall >= 82) {
            news.push({ type: "retirement", text: `${p.name} retires at ${p.age} after ${p.career.seasons} seasons and ${p.career.goals} career goals.`, clubId: club.id });
          }
          continue;
        }
        keep.push(p);
      }
      club.squad = keep;

      // Contract renewals and releases. A club renews the players it rates and
      // can afford; everyone else runs down and walks. On the managed club the
      // manager's own extend/release requests steer this, but the board still
      // has the final word — it will not fund a renewal it cannot afford, and
      // it says so, which is what turns up in the log.
      const manager = world.managerById(club.managerId);
      const policy = MG.managers.recruitmentPolicy(manager);
      const requests = club.contractRequests || {};
      const isPlayerClub = club.id === world.playerClubId;
      const affordableNow = () => club.finances.wageBill < club.finances.wageBudget * 1.05;
      // The board backs a renewal the manager explicitly asks for — keeping a
      // player you already have is cheap next to signing one. Clubs structurally
      // run over their notional wage budget (an elite side sits well above it),
      // so the only thing that stops an extension is genuine crisis: a club
      // forced into a fire-sale, or one deep enough in the red that it cannot
      // add a single pound of wage. That rare refusal is the interesting case —
      // the skint club that cannot keep everyone.
      const canExtend = () => !club.mustSell && club.finances.balance > -club.finances.revenue * 0.5;

      // Early renewals: a player the manager asked to tie down who is NOT yet
      // expiring gets a fresh term now if the board can carry it.
      for (const p of club.squad) {
        if (requests[p.id] !== "extend" || p.contract.years <= 0) continue;
        if (canExtend()) {
          p.contract.years = Math.max(p.contract.years, rng.int(2, 4));
          if (isPlayerClub) news.push({ type: "contract", text: `Contract — ${p.name} signs a new deal to ${p.contract.years} years. The board backed your call.`, clubId: club.id });
        } else if (isPlayerClub) {
          news.push({ type: "contract", text: `Contract — the board would not fund a new deal for ${p.name}; the wage bill is already stretched.`, clubId: club.id });
        }
      }

      const stillHere = [];
      for (const p of club.squad) {
        if (p.contract.years > 0) { stillHere.push(p); continue; }
        const req = requests[p.id];
        const squadRank = club.squad.filter((q) => q.pos === p.pos && q.overall > p.overall).length;
        const wanted = squadRank < MG.players.POSITIONS[p.pos].need && p.age <= policy.maxAge + 3;
        const affordable = affordableNow();
        // The manager's request overrides the board's default inclination, but
        // affordability still gates an extend, and a release is always honoured.
        let renew;
        if (req === "release") renew = false;
        else if (req === "extend") renew = canExtend();
        else renew = wanted && affordable && rng.chance(0.8);
        if (renew) {
          p.contract.years = rng.int(2, 4);
          p.contract.wage = round1(MG.players.expectedWage(p, club.leagueId) * rng.between(1.0, 1.15));
          stillHere.push(p);
          if (isPlayerClub && req === "extend") news.push({ type: "contract", text: `Contract — ${p.name} renews for ${p.contract.years} years, as you asked.`, clubId: club.id });
        } else {
          p.clubId = null;
          freeAgents.push(p);
          if (isPlayerClub) {
            const why = req === "release" ? "released on your instruction"
              : req === "extend" ? "let go — the board would not fund the extension you wanted"
                : "runs down his contract and leaves on a free";
            news.push({ type: "contract", text: `Contract — ${p.name} ${why}.`, clubId: club.id });
          }
        }
      }
      club.squad = stillHere;
      club.contractRequests = {};
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
        const byValue = club.squad.filter((p) => !p.loan).sort((a, b) => b.value - a.value);
        for (const p of byValue.slice(0, 3)) listed.push({ player: p, club, forced: true, fireSale: true });
      }

      // How many bodies the club has in each position, counted once. This used
      // to be a fresh filter over the whole squad for every player in it —
      // quadratic in squad size, for every club in the world, every summer.
      const posDepth = {};
      for (const p of club.squad) posDepth[p.pos] = (posDepth[p.pos] || 0) + 1;

      /* Cycle 1's verdict on how much this club wants to move players on. A
       * rebuilding side clears the decks; a side pushing for the title keeps
       * what it has. See ai.js — without a plan this is 1 and the roll below
       * behaves exactly as it always did. */
      const appetite = MG.ai ? MG.ai.sellAppetite(club) : 1;

      for (let i = 0; i < ranked.length; i++) {
        const p = ranked[i];
        if (p.loan) continue;                      // on loan here: not ours to sell
        if (club.squad.length <= MIN_SQUAD + 2) break;
        const depth = posDepth[p.pos];
        const need = MG.players.POSITIONS[p.pos].need;

        let chance = 0;
        if (depth > need) chance += 0.25;                       // surplus to requirements
        if (p.age > policy.maxAge) chance += 0.30;              // does not fit the manager
        if (i >= MG.players.SQUAD_TARGET - 4) chance += 0.15;   // fringe
        if (overWages) chance += 0.20;
        if (inDebt) chance += 0.30;
        chance *= policy.churn * appetite;
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
    // a big club barely notices the money at all. Counted with an early exit
    // rather than a full filter — the question is only ever "are there fewer
    // than three better than him", and this runs for every candidate a club
    // evaluates in every round of the window.
    let better = 0;
    for (const q of club.squad) { if (q.overall > player.overall && ++better >= 3) break; }
    if (better < 3) multiple += 0.55;
    const repGap = club.reputation - buyer.reputation;
    if (repGap > 0) multiple += repGap / 55;          // selling down the ladder costs more
    if (club.finances.balance < 0) multiple -= 0.25;  // needs must
    /* Contract length is leverage, and it used to count for nothing — a man
     * six weeks from a free and one who signed a five-year deal last month
     * commanded the exact same fee, which is why the market read as players
     * moving every single season regardless of what they had just put pen to.
     * A fresh long contract is the seller's whole bargaining position; a
     * contract running down is the buyer's. Two years is left as the
     * neutral point the rest of the game's fee curve was already tuned to. */
    const yearsLeft = (player.contract && player.contract.years != null) ? player.contract.years : 2;
    multiple += clamp((yearsLeft - 2) * 0.12, -0.3, 0.5);
    return round1(player.value * clamp(multiple, 0.5, 2.7));
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
    /* One pass over the squad instead of one per position: this is called once
     * per club per window round (and again in the clearing pass), and it used
     * to walk the whole squad nine times over — eight filters plus a squad-wide
     * average recomputed identically inside every one of them. */
    const byPos = {};
    let squadTotal = 0;
    for (const p of club.squad) {
      (byPos[p.pos] = byPos[p.pos] || []).push(p);
      squadTotal += p.overall;
    }
    const squadLevel = club.squad.length ? squadTotal / club.squad.length : 50;

    for (const pos of MG.players.POSITION_KEYS) {
      const def = MG.players.POSITIONS[pos];
      const players = (byPos[pos] || []).sort((a, b) => b.overall - a.overall);
      const short = Math.max(0, def.need - players.length);
      const starters = players.slice(0, def.starters);
      const currentQuality = starters.length
        ? starters.reduce((t, p) => t + p.overall, 0) / starters.length
        : 30;
      // Urgency: missing bodies first, then the weakest position relative to
      // the rest of the squad.
      const gap = squadLevel - currentQuality;
      const urgency = 1 + short * 0.9 + clamp(gap, 0, 12) * 0.12 + (counts[pos] < def.starters ? 1.2 : 0);
      needs.push({ pos, short, currentQuality, urgency });
    }
    return needs.sort((a, b) => b.urgency - a.urgency);
  }

  /* --------------------------- PLAYER AGENCY -------------------------------
   * A transfer needs three parties to agree, and until now the player was not
   * one of them: any deal the two clubs could afford simply happened. So a
   * first-choice forward at a Champions League club would move to a mid-table
   * side without a murmur, because nobody ever asked him.
   *
   * What he weighs is the step: the standing of the club coming for him against
   * the one he is at, whether he is actually playing where he is, and the money.
   * A fringe player will drop a division to play. A starter at a big club will
   * not, however good the offer. */
  function willJoin(rng, player, seller, buyer, wage) {
    const sellerLeague = MG.clubs.LEAGUES[seller.leagueId];
    const buyerLeague = MG.clubs.LEAGUES[buyer.leagueId];
    const step = buyerLeague.prestige - sellerLeague.prestige;   // + = moving up

    // Where he stands in the pecking order now. A man who is not getting on the
    // pitch is a great deal more interested in a move than a first-choice one.
    // Only the 11 and 4 thresholds matter, so the count stops at 11.
    let better = 0;
    for (const q of seller.squad) { if (q.overall > player.overall && ++better >= 11) break; }
    const fringe = better >= 11;
    const starter = better <= 4;

    let accept = 0.88 + step * 0.7;
    if (step < -0.05 && starter) accept -= 0.42;   // dropping down while first choice
    if (fringe) accept += 0.3;                     // anything for a game
    // Standing within the same division still counts: a bigger name persuades.
    accept += (buyer.reputation - seller.reputation) / 180;
    // Money talks, and for the ordinary professional it talks loudest.
    const now = player.contract.wage || 1;
    if (wage > now * 1.4) accept += 0.22;
    else if (wage < now * 0.9) accept -= 0.2;
    // A young player with a career in front of him wants to play, not to sit in
    // a bigger dressing room.
    if (player.age <= 22 && player.potential - player.overall >= 8 && step > 0.2 && !fringe) accept -= 0.18;
    // The other half of the contract-leverage change: a man watching his deal
    // run out already has one foot out the door, and a man who just signed a
    // long one is settled and does not want to be uprooted again straight
    // away — this is what actually keeps a squad together season to season,
    // not just the fee alone.
    const yearsLeft = (player.contract && player.contract.years != null) ? player.contract.years : 2;
    if (yearsLeft <= 1) accept += 0.16;
    else if (yearsLeft >= 4) accept -= 0.14;
    return rng.chance(clamp(accept, 0.04, 0.97));
  }

  /* --------------------------- MOVEMENT APPROVAL ---------------------------
   * Every transfer touching the managed club — the auction, a free signing,
   * the board's own emergency cover — used to just happen, reported after the
   * fact in the log with nothing to do about it. That is the automatic board
   * the "decisions box" is supposed to replace: SIGN or VETO turns each of
   * these into an actual choice, made the moment the summer window hands
   * control back, before a ball is kicked with the new man in the squad.
   *
   * Reversal only has to be clean, not general — every movement recorded
   * here happens in the close season, before the player who just arrived (or
   * just left) has played a single minute for his new club, so undoing one is
   * a straight reverse of a transaction that has not yet had any other effect
   * on the world worth chasing down. */
  function recordMovement(world, kind, player, otherClub, fee, wage, prevContract, pending) {
    if (!world.playerMovements) world.playerMovements = [];
    world.playerMovements.push({
      id: `${world.season}-${player.id}-${world.playerMovements.length}`,
      kind, playerId: player.id, otherClubId: otherClub ? otherClub.id : null,
      otherClubName: otherClub ? otherClub.name : "a free transfer",
      fee: round1(fee || 0), wage: round1(wage || 0), prevContract, resolved: false,
      // Log line + fan reaction, held back until the card is actually
      // resolved — see the note in transfers.js's completeDeal. Free
      // signings (kind "free") have no seller involved so carry none of
      // this; their own SIGN/VETO outcome text is enough.
      pending: pending || null,
    });
  }

  /** VETO's other half. Puts the money and the man back exactly where the
   *  board found them. Called from the UI the moment a movement card is
   *  declined — see world.playerMovements. */
  function reverseMovement(world, m) {
    const playerClub = world.clubById(world.playerClubId);
    const player = playerClub ? playerClub.squad.find((p) => p.id === m.playerId) || null : null;
    if (m.kind === "in") {
      // He arrived at the managed club from otherClub; send him back.
      if (!playerClub || !player) return false;
      const seller = m.otherClubId != null ? world.clubById(m.otherClubId) : null;
      playerClub.squad = playerClub.squad.filter((p) => p.id !== player.id);
      playerClub.finances.balance = round1(playerClub.finances.balance + m.fee);
      playerClub.finances.spent = round1(Math.max(0, playerClub.finances.spent - m.fee));
      if (seller) {
        seller.squad.push(player);
        seller.finances.balance = round1(seller.finances.balance - m.fee);
        seller.finances.received = round1(Math.max(0, seller.finances.received - m.fee));
        player.clubId = seller.id;
      } else {
        player.retired = true;   // his old club no longer exists to go back to
      }
      player.contract = { years: m.prevContract.years, wage: m.prevContract.wage };
      player.value = MG.players.marketValue(player);
      MG.clubs.refreshRatings(playerClub);
      if (seller) MG.clubs.refreshRatings(seller);
      return true;
    }
    if (m.kind === "out") {
      // He left the managed club for otherClub; bring him home.
      const buyer = m.otherClubId != null ? world.clubById(m.otherClubId) : null;
      if (!playerClub || !buyer) return false;
      const p = buyer.squad.find((x) => x.id === m.playerId);
      if (!p) return false;
      buyer.squad = buyer.squad.filter((x) => x.id !== p.id);
      buyer.finances.balance = round1(buyer.finances.balance + m.fee);
      buyer.finances.spent = round1(Math.max(0, buyer.finances.spent - m.fee));
      playerClub.finances.balance = round1(playerClub.finances.balance - m.fee);
      playerClub.finances.received = round1(Math.max(0, playerClub.finances.received - m.fee));
      p.clubId = playerClub.id;
      p.contract = { years: m.prevContract.years, wage: m.prevContract.wage };
      p.value = MG.players.marketValue(p);
      playerClub.squad.push(p);
      MG.clubs.refreshRatings(playerClub);
      MG.clubs.refreshRatings(buyer);
      return true;
    }
    if (m.kind === "free") {
      // A free signing nobody asked for — send him back onto the market by
      // retiring him, exactly as he would have gone had nobody signed him.
      if (!playerClub || !player) return false;
      playerClub.squad = playerClub.squad.filter((p2) => p2.id !== player.id);
      player.retired = true;
      MG.clubs.refreshRatings(playerClub);
      return true;
    }
    return false;
  }

  /* ------------------------------ THE WINDOW -------------------------------
   * A market, not a queue.
   *
   * The window used to be a single richest-first walk: each club in turn took
   * the best player it could afford at the asking price and moved on. Nobody
   * ever competed for anybody, so no fee was ever driven up, the wealthiest
   * club always got its first choice, and a transfer window read as a list of
   * unopposed transactions.
   *
   * Now every club NOMINATES its top target, and any player wanted by more than
   * one club goes to AUCTION. The winner is whoever values him most and pays
   * just above what the runner-up would have gone to, so a contested signing
   * genuinely costs more than an uncontested one. Clubs that lose an auction
   * keep their money and come back for someone else in the next round, which is
   * how a window actually unfolds.
   */
  const WINDOW_ROUNDS = 6;

  function runWindow(world) {
    const rng = world.rng;
    const news = [];
    let deals = 0, contested = 0, rejections = 0;
    // A fresh list for this window — see recordMovement/reverseMovement above.
    // Last summer's decided cards must not still be sitting here to reopen.
    world.playerMovements = [];
    const listings = buildListings(world);
    const listedSet = new Set(listings.map((l) => l.player.id));
    const index = indexPlayers(world);

    /* Each club's shopping state, carried across rounds so a club that loses a
     * bidding war still has its budget intact when it goes back to the market. */
    const states = new Map();
    for (const club of world.clubs) {
      const manager = world.managerById(club.managerId);
      const policy = MG.managers.recruitmentPolicy(manager);
      /* Cycle 2 is aimed by cycle 1: the summer's posture decides how hard the
       * club stretches and how many it is trying to sign. A club with no plan
       * (the human's, or a world running without ai.js) gets 1 and the old
       * numbers exactly. */
      const spendBias = MG.ai ? MG.ai.spendAppetite(club) : 1;
      states.set(club.id, {
        club, policy,
        acumen: manager ? manager.attrs.transferAcumen : 50,
        // policy.spend lets a chequebook manager stretch and a loyalist hold
        // back, but never past what the club actually has — that overshoot was
        // how clubs ran up nine-figure debts they could never trade out of.
        budget: Math.min(
          club.finances.transferBudget * policy.spend * spendBias,
          Math.max(0, club.finances.balance) + club.finances.revenue * 0.2
        ),
        wageRoom: club.finances.wageBudget - MG.clubs.wageBill(club),
        signings: 0,
        maxSignings: MG.ai
          ? clamp(MG.ai.signingTarget(club, Math.round(2 + policy.churn)), 1, 6)
          : clamp(Math.round(2 + policy.churn), 1, 6),
        passed: new Set(),      // players he has already lost out on or been refused by
      });
    }

    /** The single player this club most wants right now, and the most it would
     *  pay for him. Returns null when it has nothing left to chase. */
    function nominate(st) {
      const { club: buyer, policy, acumen } = st;
      if (st.signings >= st.maxSignings) return null;
      if (st.budget < 0.05 && st.wageRoom <= 0) return null;
      const needs = clubNeeds(buyer);

      /* Reach is a property of the BUYER, so it is resolved once here rather
       * than per candidate. It used to be asked inside the loop below, which
       * measured at 11.8 million calls across six seasons — the single most
       * expensive thing in the whole engine, purely from re-deriving a fact
       * about the buying club for every player in the world. */
      const reach = MG.network ? MG.network.reachLeagues(buyer) : null;
      const ownLeague = buyer.leagueId;

      for (const need of needs) {
        const pool = index[need.pos] || [];
        let evaluated = 0;
        let best = null, bestScore = 0, bestFee = 0, bestWage = 0;
        /* The pool is sorted best-first and every player above the buyer's
         * ceiling is skipped, so the scan used to walk the entire top of the
         * list — hundreds of players a National League club was never going to
         * sign — before reaching anyone it could evaluate. Binary-searching to
         * the first affordable-quality player skips that prefix outright. The
         * skipped entries hit `continue` before any RNG draw or side effect, so
         * starting further down is behaviourally identical. */
        const ceiling = need.currentQuality + 14;
        let lo = 0, hi = pool.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (pool[mid].player.overall > ceiling) lo = mid + 1; else hi = mid;
        }

        for (let pi = lo; pi < pool.length; pi++) {
          if (evaluated > 60) break;
          const entry = pool[pi];
          const { player, club: seller } = entry;
          if (seller.id === buyer.id || player.retired || player.clubId === buyer.id) continue;
          if (st.passed.has(player.id)) continue;
          // Reach: the buyer can only sign out of leagues its agent network can
          // actually touch. A National League side does not have the channels
          // to prise a player out of La Liga, however much it might want to.
          if (reach && seller.leagueId !== ownLeague && !reach.has(seller.leagueId)) continue;
          // The index is a snapshot taken before the window opened. Once a
          // player has moved, his entry in it is stale — without this check the
          // second buyer to reach him would remove him from a club he had
          // already left and add him to a second squad, and the same striker
          // would turn out for five clubs at once.
          if (player.clubId !== seller.id) continue;
          if (player.loan) continue;                                 // not his club's to sell
          if (player.overall > ceiling) continue;                    // out of reach
          evaluated++;
          if (seller.squad.length <= MIN_SQUAD) continue;
          const fee = askingPrice(entry, buyer, listedSet);
          if (fee > st.budget) continue;
          const wage = MG.players.expectedWage(player, buyer.leagueId) * rng.between(1.0, 1.2);
          if (wage * 52 / 1000 > st.wageRoom) continue;
          /* A better negotiator gets more player for the money — and the
           * summer's plan bends what "more player" means: a rebuilding club
           * rates the 21-year-old its rival would not look at, and a club
           * pushing for a title rates the opposite. See ai.js's targetBias. */
          const bias = MG.ai ? MG.ai.targetBias(buyer, player) : 1;
          const score = targetScore(player, buyer, policy, need) * (1 + (acumen - 50) / 250) * bias - fee * 0.35;
          if (score > bestScore) { best = entry; bestScore = score; bestFee = fee; bestWage = wage; }
        }
        if (best) {
          /* The ceiling this club would go to. Urgency and a chequebook manager
           * push it above the asking price; that headroom is what an auction
           * eats into, and what stops every contested player going to whoever
           * happens to be richest. */
          const urgency = clamp(need.urgency - 1, 0, 1.2);
          const willingness = 1 + urgency * 0.3 + (policy.spend - 1) * 0.35;
          const ceiling = Math.min(st.budget, bestFee * clamp(willingness, 1, 1.9));
          return { st, entry: best, base: bestFee, ceiling, wage: bestWage, score: bestScore };
        }
      }
      return null;
    }

    function completeDeal(st, entry, fee, wageRaw, meta) {
      const buyer = st.club;
      const { player, club: seller } = entry;
      const wage = round1(wageRaw);
      const prevContract = { years: player.contract.years, wage: player.contract.wage };

      seller.squad = seller.squad.filter((p) => p.id !== player.id);
      seller.finances.received = round1(seller.finances.received + fee);
      seller.finances.balance = round1(seller.finances.balance + fee);
      buyer.squad.push(player);
      buyer.finances.spent = round1(buyer.finances.spent + fee);
      buyer.finances.balance = round1(buyer.finances.balance - fee);
      player.clubId = buyer.id;
      player.contract = { years: rng.int(2, 5), wage };
      MG.players.recordMove(player, buyer.name, world.season);
      player.value = MG.players.marketValue(player);
      st.budget -= fee;
      st.wageRoom -= wage * 52 / 1000;
      st.signings++;
      deals++;
      listedSet.delete(player.id);
      // Written down against the plan so cycle 3 can tell what the club
      // actually got against what it set out to get.
      if (MG.ai) MG.ai.noteSigning(buyer, player);
      const bestFee = fee;
      const involvesPlayerClub = world.playerClubId && (buyer.id === world.playerClubId || seller.id === world.playerClubId);
      const warTag = meta && meta.contested ? ` — his agent (${meta.agentName}) took it to a bidding war` : "";

      /* A deal involving the managed club goes through SIGN/VETO before the
       * manager sees another screen — but the log feed is drawn on every
       * frame regardless of stage, so if the "IN —"/"OUT —" line went into
       * world.news here it would announce the deal as settled fact while the
       * SIGN/VETO card was still asking whether to keep it. Deferred onto
       * the movement record instead (see recordMovement below) and only
       * reported — with the fan reaction that goes with it — once chooseMove
       * actually resolves the card. A VETO then never happened in the log
       * either, which is the whole point: nothing the manager sees is
       * announced before he has actually decided it. */
      if (involvesPlayerClub) {
        const pendingText = seller.id === world.playerClubId
          ? `OUT — ${player.name} (${player.pos}, ${Math.round(player.overall)}) leaves for ${buyer.name} for £${bestFee}m${warTag}.`
          : `IN — ${player.name} (${player.pos}, ${player.age}, ${Math.round(player.overall)}) signs from ${seller.name} for £${bestFee}m${warTag}.`;
        const keyImpact = seller.id === world.playerClubId
          ? player.overall >= (seller.level || 60) + 2
          : player.overall >= (buyer.level || 60) + 2;
        recordMovement(world, buyer.id === world.playerClubId ? "in" : "out", player, buyer.id === world.playerClubId ? seller : buyer, fee, wage, prevContract,
          { pendingText, fansClubId: seller.id === world.playerClubId ? seller.id : buyer.id, fansDelta: seller.id === world.playerClubId ? (keyImpact ? -5 : -1.5) : (keyImpact ? 5 : 1.5), fansReason: seller.id === world.playerClubId ? (keyImpact ? `${player.name} was sold` : `${player.name} was allowed to leave`) : (keyImpact ? `${player.name} was a statement signing` : `${player.name} came in`) });
      } else if (bestFee >= 12 || player.overall >= 80) {
        news.push({
          type: "transfer",
          text: `${player.name} (${player.pos}, ${player.age}, ${player.overall}) joins ${buyer.name} from ${seller.name} for £${bestFee}m.`,
          clubId: buyer.id, fee: bestFee,
        });
      }
    }

    /* ---- the rounds: nominate, group, auction, repeat ---- */
    for (let round = 0; round < WINDOW_ROUNDS; round++) {
      // Richest first only decides who is READ first; who wins is decided by
      // the auction, which is the point of the rewrite.
      const order = world.clubs.slice().sort((a, b) => b.finances.transferBudget - a.finances.transferBudget);
      const bids = new Map();          // playerId -> [{ st, entry, base, ceiling, wage }]
      for (const club of order) {
        const st = states.get(club.id);
        const nom = nominate(st);
        if (!nom) continue;
        const id = nom.entry.player.id;
        if (!bids.has(id)) bids.set(id, []);
        bids.get(id).push(nom);
      }
      if (!bids.size) break;

      for (const [pid, rawList] of bids) {
        /* His agent decides how many of these interested clubs ever get a
         * seat at the table — a star with a super-agency behind him lets the
         * whole queue through, a lower-league player's local agent is making
         * one phone call and that's the move. See agents.js. */
        const somePlayer = rawList[0].entry.player;
        const { list, agent } = MG.agents ? MG.agents.filterSuitors(somePlayer, rawList) : { list: rawList, agent: null };
        void pid;
        // Highest ceiling wins; ties broken by who wanted him most.
        list.sort((a, b) => b.ceiling - a.ceiling || b.score - a.score);
        const winner = list[0];
        const runnerUp = list[1];
        const { player, club: seller } = winner.entry;
        // The seller may already have gone below the minimum squad in this same
        // round, or the player may have moved — re-check before completing.
        if (player.clubId !== seller.id || seller.squad.length <= MIN_SQUAD) continue;

        /* The price. Uncontested, he goes for the asking price. Contested, the
         * winner pays just past what the runner-up would have gone to — which
         * is what makes a bidding war expensive without letting it run away.
         * The premium itself scales with the agent's own networking: a
         * super-agency plays two boardrooms off each other properly, a local
         * agent barely knows there is a second bidder to leverage. */
        let fee = winner.base;
        if (runnerUp) {
          contested++;
          const premium = agent ? MG.agents.contestPremium(agent) : 1.05;
          fee = round1(clamp(Math.max(winner.base, runnerUp.ceiling * premium), winner.base, winner.ceiling));
        }
        if (fee > winner.st.budget) { winner.st.passed.add(player.id); continue; }

        // And finally the player himself, who until now was never asked.
        let taker = null, takerFee = fee;
        for (const cand of list) {
          const candFee = cand === winner ? fee : cand.base;
          if (candFee > cand.st.budget) continue;
          if (willJoin(rng, player, seller, cand.st.club, cand.wage)) { taker = cand; takerFee = candFee; break; }
          rejections++;
          cand.st.passed.add(player.id);
          if (world.playerClubId === cand.st.club.id) {
            news.push({ type: "sack", text: `NO DEAL — ${player.name} turned down the move; he is not convinced by the step.`, clubId: cand.st.club.id });
          }
        }
        if (!taker) continue;

        // Everyone who did not get him remembers not to chase him again.
        for (const cand of list) if (cand !== taker) cand.st.passed.add(player.id);
        completeDeal(taker.st, taker.entry, takerFee, taker.wage, { contested: !!runnerUp, agentName: agent ? agent.name : "his agent" });
      }
    }

    /* ---- the clearing pass ----
     * A window does not end with the clubs that lost their auctions having done
     * no business at all. Without this the market punished the poor twice over:
     * a small club was outbid on every contested target, ran out of rounds, and
     * went into the season having signed nobody — measured, it left the bottom
     * of the Premier League on 16 points against a real 26, with one club down
     * to nineteen players. So anyone with money and an unfilled squad now takes
     * the best player still available at the asking price, unopposed, exactly as
     * the old window worked. The auction decides who gets the players everybody
     * wants; this decides who gets everybody else. */
    for (const club of world.clubs) {
      const st = states.get(club.id);
      let guard = 0;
      while (st.signings < st.maxSignings && guard++ < 6) {
        const nom = nominate(st);
        if (!nom) break;
        const { player, club: seller } = nom.entry;
        if (player.clubId !== seller.id || seller.squad.length <= MIN_SQUAD) { st.passed.add(player.id); continue; }
        if (nom.base > st.budget) { st.passed.add(player.id); continue; }
        if (!willJoin(rng, player, seller, club, nom.wage)) {
          rejections++;
          st.passed.add(player.id);
          continue;
        }
        completeDeal(st, nom.entry, nom.base, nom.wage);
      }
    }
    return { news, listings: listings.length, deals, contested, rejections };
  }

  /* -------------------------------- LOANS ----------------------------------
   * The answer to a problem the game had no way of solving: a nineteen-year-old
   * with a real future, stuck behind two better players, who therefore never
   * played, and therefore never developed, and was still the same player at
   * twenty-three. Development is driven by minutes — so a prospect who cannot
   * get them has to go and find them somewhere else.
   *
   * A loanee stays the property of his parent club and plays, trains and
   * develops at the club he is lent to. He comes home in the summer, usually
   * better than he left. While he is away nobody can sell him: he is not the
   * loan club's to trade.
   */
  function returnLoans(world) {
    const news = [];
    for (const club of world.clubs) {
      const staying = [];
      for (const p of club.squad) {
        if (!p.loan) { staying.push(p); continue; }
        const parent = world.clubById(p.loan.parentId);
        if (!parent) { p.loan = null; staying.push(p); continue; }   // parent gone: he stays
        const spell = p.loan;
        p.loan = null;
        p.clubId = parent.id;
        parent.squad.push(p);
        if (parent.id === world.playerClubId) {
          const grew = spell.overallAtStart != null ? Math.round(p.overall - spell.overallAtStart) : 0;
          news.push({
            type: "loan",
            text: `LOAN ENDS — ${p.name} (${p.pos}, ${p.age}) is back from ${club.name}: ${p.season.apps || 0} appearances, ${p.season.goals || 0} goals${grew > 0 ? `, and ${grew} better for it` : ""}.`,
            clubId: parent.id,
          });
        }
      }
      club.squad = staying;
    }
    return news;
  }

  /** Send the blocked prospects out to play. */
  function runLoans(world) {
    const news = [];
    let sent = 0;
    /* Destinations, sorted once. The search below wants the LOWEST-level club a
     * prospect would walk into, and used to filter and sort all 221 clubs for
     * every player being sent out — the same sort, hundreds of times a summer.
     * Sorting ascending once here and taking the first match that still fits
     * gives the identical club (Array#sort is stable, so ties keep world order)
     * for a fraction of the work. */
    const byLevelAsc = world.clubs.slice().sort((a, b) => (a.level || 50) - (b.level || 50));
    for (const club of world.clubs) {
      // Who is going nowhere here: young, still improving, and behind enough
      // bodies in his own position that he will not get on the pitch.
      const blocked = club.squad.filter((p) => {
        if (p.loan || p.retired) return false;
        if (p.age > 21) return false;
        if (p.potential - p.overall < 4) return false;
        const ahead = club.squad.filter((q) => q.pos === p.pos && q.overall > p.overall).length;
        return ahead >= MG.players.POSITIONS[p.pos].starters;
      }).sort((a, b) => (b.potential - b.overall) - (a.potential - a.overall));

      let moved = false;
      for (const p of blocked.slice(0, 3)) {
        if (club.squad.length <= MIN_SQUAD + 1) break;
        /* Somewhere he would actually play: a club whose own level he is at or
         * above, so he walks into the side, but not so far below him that the
         * football teaches him nothing. */
        let dest = null;
        for (const c of byLevelAsc) {
          const level = c.level != null ? c.level : 50;
          if (c.id === club.id) continue;
          if (c.squad.length >= MG.players.SQUAD_TARGET + 2) continue;
          if (p.overall < level - 4) continue;
          if (p.overall > level + 12) continue;
          if (MG.network && !MG.network.canRecruit(c, club)) continue;
          dest = c;
          break;
        }
        if (!dest) continue;

        moved = true;
        club.squad = club.squad.filter((x) => x.id !== p.id);
        p.loan = { parentId: club.id, parentName: club.name, overallAtStart: p.overall };
        p.clubId = dest.id;
        dest.squad.push(p);
        sent++;
        if (club.id === world.playerClubId) {
          news.push({ type: "loan", text: `LOAN — ${p.name} (${p.pos}, ${p.age}, potential ${Math.round(p.potential)}) goes to ${dest.name} for the season to get games.`, clubId: club.id });
        }
      }
      // Only the clubs that actually lost someone need their ratings rebuilt.
      // Refreshing all 221 regardless meant picking a starting eleven for every
      // club in the world to discover that most of them had not changed.
      if (moved) MG.clubs.refreshRatings(club);
    }
    return { news, sent };
  }

  /* --------------------- FREE AGENTS AND SQUAD TOP-UPS -------------------- */
  /* Free transfers used to be routine squad-building: any position with any
   * shortfall at all went looking for a free agent, every summer, for every
   * club in the world. A club that lost a handful of players to retirement or
   * expiry — completely normal — came back with five or six free signings to
   * plug the gaps, and the result was a squad that barely resembled itself a
   * year later. Free transfers are now the LAST resort, not the first: a club
   * only pursues one when a position is genuinely short-handed — two or more
   * bodies missing, the "both full-backs are out and there is no cover" case
   * — never just to round a healthy squad up toward a target headcount.
   * topUpSquads is still the real safety net for squad SIZE, using generated
   * journeymen rather than treating the free-agent pool as a shopping list. */
  const FREE_AGENT_SHORT_THRESHOLD = 2;

  function signFreeAgents(world, freeAgents) {
    const rng = world.rng;
    const news = [];
    const pool = freeAgents.filter((p) => !p.retired).sort((a, b) => b.overall - a.overall);
    // Best clubs pick first, but only from players good enough for them.
    const clubs = world.clubs.slice().sort((a, b) => b.reputation - a.reputation);
    for (const club of clubs) {
      const league = MG.clubs.LEAGUES[club.leagueId];
      const bar = 30 + league.prestige * 38;
      const needs = clubNeeds(club);
      for (const need of needs) {
        if (club.squad.length >= MG.players.SQUAD_TARGET) break;
        if (need.short < FREE_AGENT_SHORT_THRESHOLD) continue;
        /* The board's first call, every time: is there anyone in the academy
         * who can do this job before it goes and spends money on a stranger?
         * Free transfers used to be the club's first instinct for a shortage
         * — a teenager who was genuinely ready sat in the academy while the
         * board went to the market anyway. */
        const promoted = MG.youth ? MG.youth.promoteReadyForPos(world, club, need.pos) : null;
        if (promoted) {
          if (club.id === world.playerClubId) {
            news.push({ type: "youth", text: `PROMOTED — ${promoted.name} (${promoted.pos}, ${promoted.age}, ${Math.round(promoted.overall)}) is pulled up from the academy rather than going to the market.`, clubId: club.id });
          }
          continue;
        }
        const idx = pool.findIndex((p) => p.pos === need.pos && p.overall >= bar - 12 && p.overall <= need.currentQuality + 8);
        if (idx === -1) continue;
        const p = pool.splice(idx, 1)[0];
        p.clubId = club.id;
        p.contract = { years: rng.int(1, 3), wage: MG.players.expectedWage(p, club.leagueId) };
        MG.players.recordMove(p, club.name, world.season);
        club.squad.push(p);
        /* Every arrival at the managed club is reported. This pass, the squad
         * top-up and the youth intake all used to add players silently, which
         * is why names appeared in the squad list that had never been mentioned
         * anywhere — the transfer window was reporting itself properly and
         * three other doors into the squad were not. */
        if (club.id === world.playerClubId) {
          // Deferred onto the movement, same as a paid signing — see the
          // note in completeDeal above. Not reported here or it announces
          // itself as done before the SIGN/VETO card ever shows.
          recordMovement(world, "free", p, null, 0, p.contract.wage, { years: 0, wage: p.contract.wage },
            { pendingText: `FREE — ${p.name} (${p.pos}, ${p.age}, ${Math.round(p.overall)}) signs on a free transfer.`, fansClubId: club.id, fansDelta: 1, fansReason: `${p.name} signed on a free transfer` });
        }
      }
    }
    // Anyone left without a club drops out of the game.
    for (const p of pool) p.retired = true;
    return news;
  }

  /* The shape a squad must have whatever its total size.
   *
   * GOALKEEPERS ONLY, deliberately. An outfield gap is not a fault: autoPick
   * fills an empty slot with the best available body at a familiarity penalty,
   * which is a real thing football clubs do and which the engine already
   * models. Plenty of real squads in the shipped database genuinely list no
   * attacking midfielder because they do not play one.
   *
   * A missing GOALKEEPER is different, and is a silent disaster. autoPick will
   * put an outfielder in goal rather than leave the shirt empty, but
   * players.keeperRating has no such fallback — it returns a flat 45 when a
   * squad contains no keeper at all, which quietly guts the club's defensive
   * rating for a whole season with nothing anywhere to explain it. Two, so
   * that losing one to injury or a sale does not recreate the hole. */
  function minimumShape(pos) {
    return pos === "GK" ? 2 : 0;
  }

  /** Nobody fields nine players: fill genuine holes with generated journeymen. */
  function topUpSquads(world) {
    const rng = world.rng;
    const news = [];
    for (const club of world.clubs) {
      const league = MG.clubs.LEAGUES[club.leagueId];
      let guard = 0;

      /* SHAPE FIRST, and independently of size. The loop below tops a squad up
       * to a HEADCOUNT, which quietly assumed a squad of the right size was a
       * squad of the right shape. It is not: a club sitting exactly on the
       * floor with no goalkeeper at all never entered that loop, went into the
       * season with none, and had its keeper rating silently replaced by a flat
       * 45 — a real fault the audit harness caught at San Jose Earthquakes,
       * twenty-two players and not a keeper among them. */
      const shapeLevel = club.level != null ? club.level : MG.clubs.playerLevelFor(club);
      const have = {};
      for (const p of club.squad) have[p.pos] = (have[p.pos] || 0) + 1;
      for (const pos of MG.players.POSITION_KEYS) {
        const want = minimumShape(pos);
        let n = have[pos] || 0;
        let g = 0;
        while (n < want && g++ < 4) {
          // Academy first, same as every other door into the squad now.
          const promoted = MG.youth ? MG.youth.promoteReadyForPos(world, club, pos) : null;
          if (promoted) {
            n++;
            if (club.id === world.playerClubId) {
              news.push({ type: "youth", text: `PROMOTED — ${promoted.name} (${promoted.pos}, ${promoted.age}, ${Math.round(promoted.overall)}) covers the gap from the academy.`, clubId: club.id });
            }
            continue;
          }
          const p = MG.players.generate(rng, {
            league: club.leagueId, pos, target: shapeLevel - rng.between(4, 12),
            spread: 3, age: rng.int(18, 26),
          });
          p.clubId = club.id;
          MG.players.recordMove(p, club.name, world.season);
          club.squad.push(p);
          n++;
          if (club.id === world.playerClubId) {
            news.push({ type: "transfer", text: `COVER — ${p.name} (${p.pos}, ${p.age}, ${Math.round(p.overall)}) is signed: the club had no recognised ${(MG.players.POSITIONS[pos] || {}).name || pos} available.`, clubId: club.id });
          }
        }
      }
      /* Fill to a REAL squad size, not the bare legal minimum. The floor used
       * to be MIN_SQUAD (18), which was fine only because the old youth intake
       * was separately pushing every squad back up toward the mid-twenties.
       * With that pipeline gone the floor became the equilibrium: squads
       * settled at eighteen to twenty-one, the world population fell by a
       * quarter and the average age climbed past 28, because the only players
       * entering were the ones this function makes. */
      const floor = MG.players.SQUAD_TARGET - 4;   // 22
      while (club.squad.length < floor && guard++ < 20) {
        const { needs } = MG.players.squadNeeds(club.squad);
        const pos = needs.length ? needs.sort((a, b) => b.urgency - a.urgency)[0].pos : rng.pick(MG.players.POSITION_KEYS);
        // clubStrength is on the TEAM rating scale and generate() wants the
        // PLAYER overall scale. Passing one straight into the other had a
        // National League club (strength 35) manufacturing 27-rated players
        // every summer, which dragged its own strength down and made it do the
        // same thing harder next year — the whole lower pyramid decayed.
        const level = club.level != null ? club.level : MG.clubs.playerLevelFor(club);
        // Academy first — the board looks at its own kids before it looks at
        // the market, same as everywhere else this function fills a gap.
        const promoted = MG.youth ? MG.youth.promoteReadyForPos(world, club, pos) : null;
        if (promoted) {
          if (club.id === world.playerClubId) {
            news.push({ type: "youth", text: `PROMOTED — ${promoted.name} (${promoted.pos}, ${promoted.age}, ${Math.round(promoted.overall)}) is brought up from the academy to make up the numbers.`, clubId: club.id });
          }
          continue;
        }
        const target = level - rng.between(4, 12);
        // Younger than the old 20-31 band: these are most of the world's new
        // professionals now, so drawing them all from a squad-filler age range
        // was what pushed the average age of the entire population up.
        const p = MG.players.generate(rng, { league: club.leagueId, pos, target, spread: 3, age: rng.int(18, 26) });
        p.clubId = club.id;
        MG.players.recordMove(p, club.name, world.season);
        club.squad.push(p);
        if (club.id === world.playerClubId) {
          news.push({ type: "transfer", text: `SQUAD FILLER — ${p.name} (${p.pos}, ${p.age}, ${Math.round(p.overall)}) is brought in to make up the numbers.`, clubId: club.id });
        }
      }
      /* Squads that ballooned past the target shed their worst players — but
       * never below the shape above. A straight rating sort would happily cut
       * every goalkeeper at a club whose keepers rate below its outfielders,
       * recreating the exact hole this function just filled. The minimum in
       * each position is protected first, and the trim takes the worst of what
       * is left over. */
      if (club.squad.length > MG.players.SQUAD_TARGET + 4) {
        const byPos = {};
        for (const p of club.squad) (byPos[p.pos] = byPos[p.pos] || []).push(p);
        const keep = [];
        const spare = [];
        for (const [pos, list] of Object.entries(byPos)) {
          list.sort((a, b) => b.overall - a.overall);
          const protectedCount = minimumShape(pos);
          keep.push(...list.slice(0, protectedCount));
          spare.push(...list.slice(protectedCount));
        }
        spare.sort((a, b) => b.overall - a.overall);
        const room = Math.max(0, MG.players.SQUAD_TARGET + 4 - keep.length);
        club.squad = keep.concat(spare.slice(0, room));
      }
      void league;
    }
    return news;
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
        MG.players.recordMove(p, club.name, world.season);
        club.squad.push(p);
        if (club.id === world.playerClubId) {
          news.push({ type: "youth", text: `ACADEMY — ${p.name} (${p.pos}, ${p.age}) steps up from the youth team${p.potential >= 86 ? " — the coaches think he can play at the very top" : ` (potential ${Math.round(p.potential)})`}.`, clubId: club.id });
        } else if (p.potential >= 86) {
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

  /** Find a plausible buyer for one specific player and complete the sale now.
   *  The same reach-gated, level-appropriate buyer search the summer window uses,
   *  but aimed at a single player the manager has listed. Returns a result the
   *  UI can put straight into the log, success or refusal. */
  function sellListed(world, club, playerId) {
    const offer = findSaleOffer(world, club, playerId);
    if (!offer.ok) return offer;
    return commitSale(world, club, offer);
  }

  /** Who would buy a listed player, and for how much — nothing committed.
   *  The pre-season window shows this as an offer to accept or reject. */
  function findSaleOffer(world, club, playerId) {
    const player = club.squad.find((p) => p.id === playerId);
    if (!player) return { ok: false, reason: "he is no longer at the club" };
    if (player.loan) return { ok: false, player, reason: "he is only here on loan" };
    if (club.squad.length <= MIN_SQUAD) return { ok: false, player, reason: "the squad is already too thin to sell" };
    const fee = round1(player.value * 0.95);
    const buyer = world.clubs
      .filter((c) => c.id !== club.id
        && c.finances.balance >= fee
        && c.squad.length < MG.players.SQUAD_TARGET + 3
        && (c.level || 50) >= player.overall - 12
        && player.overall >= (c.level || 50) - 13
        && (!MG.network || MG.network.canRecruit(c, club)))
      .sort((a, b) => b.finances.transferBudget - a.finances.transferBudget)[0];
    if (!buyer) return { ok: false, player, reason: "no club in your reach bid for him" };
    return { ok: true, player, buyer, fee };
  }

  /** Accept an offer findSaleOffer produced. */
  function commitSale(world, club, offer) {
    const { player, buyer, fee } = offer;
    if (!club.squad.some((p) => p.id === player.id)) return { ok: false, player, reason: "he has already left" };
    if (club.squad.length <= MIN_SQUAD) return { ok: false, player, reason: "the squad is already too thin to sell" };
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
    MG.players.recordMove(player, buyer.name, world.season);
    MG.clubs.refreshRatings(club);
    MG.clubs.refreshRatings(buyer);
    return { ok: true, player, to: buyer.name, fee };
  }

  /** Which of a club's own players the board would put up for sale unprompted:
   *  surplus in a position, past the manager's age profile, or on wages the club
   *  cannot carry. Returns ids, best-known first, so the UI can show and log the
   *  board's own recommendations without committing to them. */
  function boardListings(world, club) {
    const manager = world.managerById(club.managerId);
    const policy = MG.managers.recruitmentPolicy(manager);
    const overWages = MG.clubs.wageBill(club) > club.finances.wageBudget;
    const level = club.level != null ? club.level : MG.clubs.playerLevelFor(club);
    const out = [];
    const byPos = {};
    for (const p of club.squad) (byPos[p.pos] = byPos[p.pos] || []).push(p);
    /* Worst first: if the board is going to name players it would move on, it
     * should start at the bottom of the squad rather than wherever the array
     * happens to begin. */
    const ranked = club.squad.slice().filter((p) => !p.loan).sort((a, b) => a.overall - b.overall);
    for (const p of ranked) {
      if (club.squad.length - out.length <= MIN_SQUAD + 2) break;
      const depth = (byPos[p.pos] || []).length;
      const need = MG.players.POSITIONS[p.pos].need;
      /* These were strict enough that a balanced squad produced NO
       * recommendations at all — a 26-man squad with sensible cover in every
       * position tripped none of them, so the board never had an opinion and
       * the "apply the board's changes" shortcut had nothing to apply. A
       * boardroom always has a view on who it would cash in on. */
      const surplus = depth > need;
      const tooOld = p.age > policy.maxAge;
      const pricey = overWages && p.contract.wage >= 40;
      // Well short of the standard the division demands, and old enough that
      // he is not going to grow into it.
      const belowLevel = p.overall < level - 6 && p.age >= 24;
      if (surplus || tooOld || pricey || belowLevel) out.push(p.id);
    }
    return out;
  }

  /** Sign the best player the club can afford in a given mould. Kept as
   *  find-then-commit in one call, because a decision card's fx() has to
   *  report an outcome the instant it runs. The pre-season window uses the
   *  two halves separately — see findSigning/commitSigning below — so the
   *  manager sees exactly who the board found BEFORE any money moves. */
  function findAndSign(world, club, opts) {
    const cand = findSigning(world, club, opts);
    if (!cand) return null;
    return commitSigning(world, club, cand);
  }

  /** The search half: who the board would go for, at what price, with the
   *  agent friction already applied — but nothing committed. Returns null
   *  if there is nobody, or if a rival got there first. */
  function findSigning(world, club, opts) {
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
      if (player.loan) continue;                   // not his club's to sell
      if (MG.network && !MG.network.canRecruit(club, seller)) continue;
      if (seller.squad.length <= MIN_SQUAD) continue;
      if (o.quality === "prospect" && player.age > 22) continue;
      if (o.quality === "star" && player.overall < level + 2) continue;
      // "The one player who changes the level of the team" never means a
      // declining 39-year-old — but the score below had no age term at all,
      // so a cheap, ageing free-transfer-priced player who happened to sit
      // near the OVR bar could out-score a genuine prime-age target purely
      // on being cheap. A hard ceiling for the marquee case, a real reported
      // bug (a 39-year-old right-back signed as a "star" marquee buy, then
      // immediately flagged as the squad's obvious veteran to offload —
      // buying and reselling the same man in the same summer).
      if (o.quality === "star" && player.age > 32) continue;
      // Already proposed to this manager earlier in the same window.
      if (o.exclude && o.exclude.has(player.id)) continue;
      const fee = askingPrice({ player, club: seller }, club, new Set());
      if (fee > budget) continue;
      const wage = MG.players.expectedWage(player, club.leagueId);
      // A prime-age curve, not a cliff: penalty grows past 27, harder for a
      // marquee target (a "star" signing should be someone the club builds
      // around) than for ordinary or squad-depth business.
      const agePenalty = o.quality === "prospect" ? 0
        : Math.max(0, player.age - 27) * (o.quality === "star" ? 2.2 : 1.0);
      // Closeness to the calibre asked for, minus what it costs, minus age.
      const score = -Math.abs(player.overall - bar) * 3
        + (o.quality === "prospect" ? (player.potential - player.overall) * 2 : 0)
        - fee * 0.12 - agePenalty;
      if (score > bestScore) { best = { player, seller, wage }; bestScore = score; bestFee = fee; }
    }
    if (!best) return null;

    /* This search always found its man in one pass, with nobody else in the
     * game ever getting a say — a guaranteed side-channel around the exact
     * competition every AI club has to fight through in runWindow, and a real
     * contributor to the game reading as too easy. His agent applies the same
     * friction here it applies there: a premium on the fee scaled to his
     * network, and — for a genuinely sought-after target — a real chance
     * someone else already got there first. A free-agent-priced move (maxFee
     * near 0) is left alone; nobody is fighting over a Bosman signing. */
    if (MG.agents && bestFee > 0.2) {
      const agent = MG.agents.agentFor(best.player);
      const beatenChance = clamp((agent.network - 35) / 130, 0, 0.45);
      if (rng.chance(beatenChance)) return null;
      bestFee = round1(bestFee * MG.agents.contestPremium(agent));
      if (bestFee > budget) return null;
    }

    return { player: best.player, seller: best.seller, fee: bestFee, wage: best.wage, from: best.seller.name };
  }

  /** The commit half: actually do the deal the search above proposed. */
  function commitSigning(world, club, cand) {
    const rng = world.rng;
    const { player, seller, wage } = cand;
    const fee = cand.fee;
    // The world moves between a proposal being made and the manager saying
    // yes to it — the pre-season window shows a card per signing, and a
    // rival can have taken him, or his club can have been stripped bare, in
    // between. Re-checked here rather than trusting the stale proposal.
    if (player.retired || player.clubId !== seller.id || player.loan) return null;
    if (seller.squad.length <= MIN_SQUAD) return null;
    seller.squad = seller.squad.filter((p) => p.id !== player.id);
    seller.finances.balance = round1(seller.finances.balance + fee);
    seller.finances.received = round1(seller.finances.received + fee);
    club.squad.push(player);
    club.finances.balance = round1(club.finances.balance - fee);
    club.finances.spent = round1(club.finances.spent + fee);
    club.finances.transferBudget = round1(Math.max(0, club.finances.transferBudget - fee));
    player.clubId = club.id;
    player.contract = { years: rng.int(3, 5), wage: round1(wage * rng.between(1.0, 1.2)) };
    MG.players.recordMove(player, club.name, world.season);
    player.value = MG.players.marketValue(player);
    // He arrives for pre-season fit. Without this he carries the injury rolled
    // for him at his old club and a marquee signing could lower the very rating
    // he was bought to raise.
    player.season.injured = 0;
    MG.clubs.refreshRatings(club);
    MG.clubs.refreshRatings(seller);
    return { player, fee, from: seller.name };
  }

  /* ------------------------- THE TRANSFER RECORD ---------------------------
   * A structured record of what actually moved, kept alongside the prose in
   * world.news because a summary screen needs fields, not sentences worth
   * of text to parse back apart. Only the managed club's business is
   * recorded — the rest of the world's dealing is already summarised from
   * the news feed by biggestTransfers below, and 221 clubs' worth of rows
   * is not something any screen wants. */
  function noteTransfer(world, rec) {
    if (!world.clubTransferLog) world.clubTransferLog = [];
    world.clubTransferLog.push(Object.assign({ season: world.season }, rec));
    // A career's worth of windows is worth keeping, but not unboundedly.
    if (world.clubTransferLog.length > 400) world.clubTransferLog.splice(0, world.clubTransferLog.length - 400);
  }

  /** The managed club's ins and outs for one season (default: this one). */
  function clubTransfers(world, season) {
    const s = season != null ? season : world.season;
    return (world.clubTransferLog || []).filter((r) => r.season === s);
  }

  /** The biggest deals anywhere in the world this season. runWindow already
   *  files a news entry carrying a numeric fee for anything sizeable, so the
   *  headline business is a sort away rather than needing its own ledger. */
  function biggestTransfers(world, limit) {
    const deals = world.news.filter((n) => n.type === "transfer" && typeof n.fee === "number");
    if (!deals.length) return [];
    /* The most recent window, not world.season — advanceSeason rolls the
     * calendar before any of the screens that show this are drawn, so
     * asking for "this season" reliably came back empty and the headline
     * business silently never appeared. */
    let latest = 0;
    for (const n of deals) if (n.season > latest) latest = n.season;
    return deals.filter((n) => n.season === latest).sort((a, b) => b.fee - a.fee).slice(0, limit || 3);
  }

  /* ---------------------- SPECIFIC TARGET SHORTLIST -------------------------
   * findAndSign above searches the same market blind — it picks a calibre
   * ("star"/"solid"/"prospect") and the engine finds the closest fit with no
   * say from the manager on WHO. club.targets is the other half of that
   * feature: executeManagerRequests (below) already reads it every summer
   * and tries each name in order, exactly like a bid on any other target —
   * it has simply never had a UI populate it, so a manager could never
   * actually point the board at one specific player. This is that UI's
   * data source: a real, rankable shortlist to browse and choose from. */
  function scoutTargets(world, club, pos, opts) {
    const o = opts || {};
    const limit = o.limit || 12;
    const index = indexPlayers(world);
    const level = club.level != null ? club.level : MG.clubs.playerLevelFor(club);
    const out = [];
    for (const entry of (index[pos] || [])) {
      const player = entry.player, seller = entry.club;
      if (seller.id === club.id || player.retired || player.clubId !== seller.id) continue;
      if (player.loan) continue;
      if (MG.network && !MG.network.canRecruit(club, seller)) continue;
      if (seller.squad.length <= MIN_SQUAD) continue;
      // A realistic reach in both directions — a shortlist including every
      // player in the world at the position would just be a database dump.
      if (player.overall < level - 10 || player.overall > level + 18) continue;
      const fee = askingPrice({ player, club: seller }, club, new Set());
      const wage = round1(MG.players.expectedWage(player, club.leagueId) * 1.08);
      out.push({ player, from: seller.name, fee, wage, affordable: fee <= club.finances.transferBudget });
    }
    out.sort((a, b) => b.player.overall - a.player.overall);
    return out.slice(0, limit);
  }

  /** Cash in on someone. `which`: "star" | "veteran" | "fringe". */
  function sellOne(world, club, which) {
    if (club.squad.length <= MIN_SQUAD) return null;
    /* Never the man who arrived THIS summer — a real reported bug was
     * exactly this: a "marquee signing" decision card bought an ageing
     * free-transfer bargain, and a completely separate "cash in on the
     * veteran" card in the same pre-season batch immediately flagged that
     * same player as the obvious oldest-in-the-squad sale, since nothing
     * stopped one card from undoing what another had just done. Each card's
     * fx runs independently with no idea what the rest of the batch did, so
     * the guard belongs here, on the automated pick itself, not on any one
     * card. */
    const own = club.squad.filter((p) => !p.loan && p._arrivedSeason !== world.season);
    const ranked = own.slice().sort((a, b) => b.overall - a.overall);
    let player;
    if (which === "star") player = ranked[0];
    else if (which === "veteran") player = own.slice().sort((a, b) => b.age - a.age)[0];
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
        && player.overall >= (c.level || 50) - 13
        && (!MG.network || MG.network.canRecruit(c, club)))
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
    MG.players.recordMove(player, buyer.name, world.season);
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
      // Only show what the club's network can reach — the shop window is the
      // same one the board would actually be able to buy from.
      if (MG.network && !MG.network.canRecruit(club, seller)) continue;
      for (const p of seller.squad) {
        if (p.retired || p.loan) continue;
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
          && player.overall >= (c.level || 50) - 13
          && (!MG.network || MG.network.canRecruit(c, club)))
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
      MG.players.recordMove(player, buyer.name, world.season);
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
      if (MG.network && !MG.network.canRecruit(club, seller)) {
        refused.push({ player, reason: "he plays beyond your club's reach" });
        continue;
      }
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
      // And the player himself has a view on it, exactly as he does when an AI
      // club comes calling.
      if (!willJoin(rng, player, seller, club, wage)) {
        refused.push({ player, reason: "he turned the move down" });
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
      MG.players.recordMove(player, club.name, world.season);
      player.value = MG.players.marketValue(player);
      MG.clubs.refreshRatings(seller);
      bought.push({ player, fee, from: seller.name });
    }

    /* ---- recruitment directives: "sign a striker, sign a midfielder" ----
     * The manager names positions and the board finds the best player it can
     * afford in each — the report's model, where the player gives high-level
     * directives and the board does the buying. findAndSign already walks the
     * shared pool and pays a real fee, so this is just aiming it. */
    const manager = world.managerById(club.managerId);
    const cap = MG.managers.recruitCapacity(manager);
    for (const pos of (club.recruitment || []).slice(0, cap)) {
      if (club.finances.transferBudget < 0.05) { refused.push({ player: { name: `a ${posLabel(pos)}` }, reason: "the budget is spent" }); continue; }
      const signing = findAndSign(world, club, { pos, quality: "solid" });
      if (signing) bought.push({ player: signing.player, fee: signing.fee, from: signing.from });
      else refused.push({ player: { name: `a ${posLabel(pos)}` }, reason: "none available in budget" });
    }

    club.transferList = [];
    club.targets = [];
    club.recruitment = [];
    MG.clubs.refreshRatings(club);
    return { sold, bought, refused };
  }

  function posLabel(pos) { return (MG.players.POSITIONS[pos] || {}).name || pos; }

  function wageBillOf(club) { return MG.clubs.wageBill(club); }
  function fmtFee(f) { return f >= 10 ? `£${Math.round(f)}m` : `£${round1(f)}m`; }

  MG.transfers = {
    MIN_SQUAD, findAndSign, findSigning, commitSigning, findSaleOffer, commitSale, scoutTargets, sellOne, sellListed, boardListings, market, runLoans, returnLoans, willJoin, executeManagerRequests, developSquads, retirementsAndExpiries, buildListings, indexPlayers,
    askingPrice, targetScore, clubNeeds, runWindow, signFreeAgents, topUpSquads, youthIntake,
    FREE_AGENT_SHORT_THRESHOLD, minimumShape, recordMovement, reverseMovement,
    noteTransfer, clubTransfers, biggestTransfers,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
