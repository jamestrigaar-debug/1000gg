/* ============================================================================
 * FOOTBALL MANAGER — THE MANAGER DRAFT
 *
 * 1000goals opens by drafting a player out of the DNA of real footballers.
 * This opens by drafting a MANAGER, and it keeps the same feel: a reel spins,
 * it lands on something you did not choose, and you decide whether to spend a
 * reroll or live with it.
 *
 * This is the deliberately simple placeholder version — three rolls:
 *
 *   1. ARCHETYPE    which of the eight templates your manager is cut from,
 *                   setting his tactic, traits and attribute shape
 *   2. REPUTATION   how much of a name he already is, which decides what kind
 *                   of club will even talk to him
 *   3. NATIONALITY  where he is from
 *
 * The expansion this is built to grow into: draft individual traits from
 * several archetypes at once (a Guardiola press with a Wilder dressing room),
 * the way 1000goals blends attributes from several donor squads, including the
 * hidden-influence blend from the templates you passed over.
 *
 * Each step reseeds from (seed, step, spin count) exactly as 1000goals'
 * draft stream does, so spending a reroll changes THAT step's offer and
 * nothing else — and two players on the same seed see the same offers.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /* Where you start in the game's pecking order. Most managers start as a
   * nobody, because the climb is the game. */
  const REPUTATION_TIERS = [
    { key: "unknown",     label: "Unknown",     min: 8,  max: 20, weight: 30, blurb: "Nobody has heard of you. The National League is where you prove them wrong." },
    { key: "journeyman",  label: "Journeyman",  min: 20, max: 38, weight: 32, blurb: "A few years in the lower leagues. Somebody will take a chance on you." },
    { key: "respected",   label: "Respected",   min: 38, max: 56, weight: 22, blurb: "You have done a decent job somewhere. Championship clubs are watching." },
    { key: "established", label: "Established", min: 56, max: 72, weight: 12, blurb: "A known quantity. A top-flight club would consider you." },
    { key: "elite",       label: "Elite",       min: 72, max: 88, weight: 4,  blurb: "A serious name. The big jobs are open to you from day one." },
  ];

  const DRAFT_STEPS = ["archetype", "reputation", "nationality"];

  /* Nationality on the draft is weighted toward the football nations that
   * actually produce managers, not the ones that produce players. */
  const MANAGER_NATION_WEIGHTS = {
    England: 26, Scotland: 8, Ireland: 5, Wales: 3,
    Spain: 12, Italy: 11, Germany: 9, Portugal: 8, France: 7, Netherlands: 6,
    Argentina: 5, Brazil: 4, Belgium: 3, Croatia: 2, Serbia: 2, Denmark: 2,
    Norway: 2, Sweden: 2, Austria: 2, Switzerland: 2, Poland: 2, Turkey: 2,
    USA: 2, Japan: 1, Australia: 1, Morocco: 1, Senegal: 1,
  };

  function rollArchetype(rng) {
    const keys = MG.managers.ARCHETYPE_KEYS;
    return rng.weighted(keys.map((k) => ({ item: k, weight: MG.managers.ARCHETYPES[k].weight })));
  }

  function rollReputationTier(rng) {
    return rng.weighted(REPUTATION_TIERS.map((t) => ({ item: t, weight: t.weight })));
  }

  function rollNationality(rng) {
    return rng.weightedKey(MANAGER_NATION_WEIGHTS);
  }

  /** One complete manager, rolled in a single call. Used by the tests and by
   *  "surprise me" on the draft screen. */
  function rollManager(rng, opts) {
    const o = opts || {};
    const archetypeKey = o.archetype || rollArchetype(rng);
    const tier = o.tier || rollReputationTier(rng);
    const reputation = o.reputation != null ? o.reputation : rng.int(tier.min, tier.max);
    const nationality = o.nationality || rollNationality(rng);
    const manager = MG.managers.fromArchetype(rng, archetypeKey, {
      reputation, nationality, isPlayer: true, name: o.name,
      age: o.age != null ? o.age : clamp(Math.round(32 + reputation * 0.22 + rng.gauss() * 4), 28, 62),
    });
    manager.reputationTier = tier.label;
    manager.tierKey = tier.key;
    return manager;
  }

  /* ------------------------------ DRAFT FLOW -------------------------------
   * A three-step reel with rerolls, mirroring 1000goals' genesis screen. */
  function createDraft(seed, opts) {
    const o = opts || {};
    const draft = {
      seed,
      rerolls: o.rerolls != null ? o.rerolls : 3,
      step: 0,
      spins: { archetype: 0, reputation: 0, nationality: 0 },
      landed: { archetype: null, tier: null, reputation: null, nationality: null },
      done: false,
    };

    /* Each step draws from its own stream, keyed by how many times it has been
     * spun — so a reroll re-rolls this step and leaves every other step, and
     * the world's own seed, exactly where they were. */
    function streamFor(step) {
      return MG.createRng(`${draft.seed}|draft|${step}|${draft.spins[step]}`);
    }

    draft.currentStep = () => DRAFT_STEPS[draft.step] || null;

    draft.spin = () => {
      const step = draft.currentStep();
      if (!step) return null;
      const rng = streamFor(step);
      if (step === "archetype") {
        draft.landed.archetype = rollArchetype(rng);
        return MG.managers.ARCHETYPES[draft.landed.archetype];
      }
      if (step === "reputation") {
        const tier = rollReputationTier(rng);
        draft.landed.tier = tier;
        draft.landed.reputation = rng.int(tier.min, tier.max);
        return tier;
      }
      draft.landed.nationality = rollNationality(rng);
      return draft.landed.nationality;
    };

    /** Spend a reroll on the step just landed. */
    draft.reroll = () => {
      const step = draft.currentStep();
      if (!step || draft.rerolls <= 0) return null;
      draft.rerolls--;
      draft.spins[step]++;
      return draft.spin();
    };

    /** Lock the current step in and move on. */
    draft.accept = () => {
      if (draft.step < DRAFT_STEPS.length - 1) { draft.step++; return draft.currentStep(); }
      draft.done = true;
      return null;
    };

    /** The finished manager. Deterministic for a given seed and reroll pattern. */
    draft.build = (name) => {
      const rng = MG.createRng(`${draft.seed}|draft|build|${draft.spins.archetype}${draft.spins.reputation}${draft.spins.nationality}`);
      const manager = rollManager(rng, {
        archetype: draft.landed.archetype,
        tier: draft.landed.tier,
        reputation: draft.landed.reputation,
        nationality: draft.landed.nationality,
        name: name || undefined,
      });
      return manager;
    };

    return draft;
  }

  /* ------------------------- FIRST JOB ON THE BOARD -------------------------
   * Which clubs would actually give this manager a job. The reputation roll is
   * only interesting because it decides the answer to this question. */
  function jobOffers(world, manager, count) {
    const rng = world.rng;
    const offers = [];
    for (const club of world.clubs) {
      // A club will look at someone up to a little above and well below its own
      // standing — the same test the AI carousel uses.
      const gap = manager.reputation - club.reputation;
      if (gap < -14 || gap > 34) continue;
      const board = MG.clubs.BOARD_STYLES[club.board.style];
      const appeal = MG.managers.candidateScore(manager, club, rng);
      offers.push({
        club,
        appeal,
        leagueName: MG.clubs.LEAGUES[club.leagueId].name,
        boardStyle: club.board.style,
        boardBlurb: board.blurb,
        brief: club.board.targets ? club.board.targets.summary : null,
        budget: club.finances.transferBudget,
        squadRating: Math.round(MG.clubs.clubStrength(club)),
      });
    }
    offers.sort((a, b) => b.appeal - a.appeal);
    // Spread the offers across divisions rather than handing over the five
    // clubs with the same reputation.
    const seen = {};
    const spread = [];
    for (const o of offers) {
      seen[o.club.leagueId] = (seen[o.club.leagueId] || 0) + 1;
      if (seen[o.club.leagueId] > 2) continue;
      spread.push(o);
      if (spread.length >= (count || 4)) break;
    }
    return spread;
  }

  MG.draft = {
    REPUTATION_TIERS, DRAFT_STEPS, MANAGER_NATION_WEIGHTS,
    rollArchetype, rollReputationTier, rollNationality, rollManager, createDraft, jobOffers,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
