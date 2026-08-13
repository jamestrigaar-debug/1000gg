/* ============================================================================
 * FOOTBALL MANAGER — THE INTERNATIONAL BACKGROUND
 *
 * A shallow international layer that runs BEHIND the club simulation, in the
 * spirit of 1000goals' caps / traits / tournaments — enough to make caps and
 * goals accumulate, tournaments get won, and the best young players sharpen
 * from playing for their country, without a second full match engine.
 *
 * It is deliberately cheap. Each season every major nation fields a squad of
 * its best eligible players (by nationality, from anywhere in the world), those
 * players bank a season's worth of caps, the forwards bank goals, and on the
 * tournament cycle a champion is crowned by a strength-weighted draw. None of
 * it is simulated match by match — the club game is where the ~5,000 matches a
 * season go, and this rides quietly underneath it.
 *
 * WHY IT EARNS ITS PLACE
 *   caps and goals feed development (players.js reads season caps for a nudge)
 *   and give the world a layer of story — a homegrown kid breaking into the
 *   national side, a striker chasing a scoring record for his country — that
 *   the club game alone does not tell.
 * ========================================================================== */
(function (root) {
  "use strict";
  const MG = (root.MG = root.MG || {});
  const { clamp } = MG.util;

  /* Nation strength and confederation, condensed from 1000goals. Only nations
   * that actually produce players in this world's pool need appear; anyone
   * else falls back to a modest default. `pot` is a 0-100 tournament strength. */
  const NATIONS = {
    Brazil: { conf: "CONMEBOL", pot: 90 }, Argentina: { conf: "CONMEBOL", pot: 90 },
    France: { conf: "UEFA", pot: 92 }, Spain: { conf: "UEFA", pot: 88 }, England: { conf: "UEFA", pot: 86 },
    Germany: { conf: "UEFA", pot: 85 }, Portugal: { conf: "UEFA", pot: 85 }, Italy: { conf: "UEFA", pot: 84 },
    Netherlands: { conf: "UEFA", pot: 83 }, Belgium: { conf: "UEFA", pot: 82 }, Croatia: { conf: "UEFA", pot: 78 },
    Uruguay: { conf: "CONMEBOL", pot: 78 }, Colombia: { conf: "CONMEBOL", pot: 77 },
    Denmark: { conf: "UEFA", pot: 75 }, Serbia: { conf: "UEFA", pot: 74 }, Switzerland: { conf: "UEFA", pot: 74 },
    Morocco: { conf: "CAF", pot: 76 }, Senegal: { conf: "CAF", pot: 75 }, Nigeria: { conf: "CAF", pot: 73 },
    Japan: { conf: "AFC", pot: 74 }, "South Korea": { conf: "AFC", pot: 72 }, USA: { conf: "CONCACAF", pot: 72 },
    Mexico: { conf: "CONCACAF", pot: 71 }, "Saudi Arabia": { conf: "AFC", pot: 66 },
    Scotland: { conf: "UEFA", pot: 68 }, Wales: { conf: "UEFA", pot: 68 }, Ireland: { conf: "UEFA", pot: 68 },
    Sweden: { conf: "UEFA", pot: 72 }, Norway: { conf: "UEFA", pot: 72 }, Poland: { conf: "UEFA", pot: 72 },
    Austria: { conf: "UEFA", pot: 72 }, Turkey: { conf: "UEFA", pot: 71 }, Greece: { conf: "UEFA", pot: 68 },
    Ghana: { conf: "CAF", pot: 70 }, "Ivory Coast": { conf: "CAF", pot: 72 }, Algeria: { conf: "CAF", pot: 71 },
    Canada: { conf: "CONCACAF", pot: 66 }, Australia: { conf: "AFC", pot: 68 },
  };
  function pot(nation) { return (NATIONS[nation] || { pot: 62 }).pot; }
  function conf(nation) { return (NATIONS[nation] || { conf: "UEFA" }).conf; }

  /* Tournaments on their real-ish cadence. `world` = every nation; `conf` = one
   * confederation's championship. A champion is crowned; that is the extent of
   * the "simulation" — a strength-weighted draw among the qualified nations. */
  const TOURNAMENTS = [
    { key: "World Cup", scope: "world", cycle: 4, offset: 0, prestige: 1.0 },
    { key: "Euros", scope: "conf", conf: "UEFA", cycle: 4, offset: 2, prestige: 0.8 },
    { key: "Copa América", scope: "conf", conf: "CONMEBOL", cycle: 4, offset: 1, prestige: 0.75 },
    { key: "Africa Cup", scope: "conf", conf: "CAF", cycle: 2, offset: 1, prestige: 0.6 },
    { key: "Asian Cup", scope: "conf", conf: "AFC", cycle: 4, offset: 3, prestige: 0.55 },
  ];

  /** A nation's squad this season: its ~23 best eligible players, anywhere. */
  function selectSquad(world, nation, pool) {
    const eligible = pool[nation] || [];
    eligible.sort((a, b) => b.overall - a.overall);
    return eligible.slice(0, 23);
  }

  /** Index the whole player population by nationality once per season. */
  function buildPool(world) {
    const pool = {};
    for (const club of world.clubs) {
      for (const p of club.squad) {
        if (p.retired) continue;
        (pool[p.nationality] = pool[p.nationality] || []).push(p);
      }
    }
    return pool;
  }

  /* --------------------------- THE SEASON PASS ---------------------------- */
  function runSeason(world) {
    const rng = world.rng.fork("intl");
    const pool = buildPool(world);
    const news = [];

    // Reset the per-season counters that development reads, then award a
    // year's worth of caps to every nation's squad.
    for (const nations of Object.keys(pool)) {
      const squad = selectSquad(world, nations, pool);
      for (const p of squad) {
        if (!p.intl) p.intl = { nation: p.nationality, caps: 0, goals: 0, seasonCaps: 0, seasonGoals: 0 };
        p.intl.seasonCaps = 0; p.intl.seasonGoals = 0;
      }
      if (squad.length < 11) continue;
      // A settled international plays roughly 8-10 times a season; a fringe one
      // a couple. Goals go mostly to the forwards, weighted by quality.
      const forwards = squad.filter((p) => ["FW", "WG", "AM"].includes(p.pos));
      squad.forEach((p, i) => {
        const games = i < 14 ? rng.int(6, 10) : rng.int(1, 4);
        p.intl.seasonCaps = games;
        p.intl.caps += games;
      });
      const goalPicker = forwards.map((p) => ({ item: p, weight: Math.pow(Math.max(1, p.overall - 50), 1.6) }));
      const totalGoals = rng.int(10, 22);
      for (let g = 0; g < totalGoals && goalPicker.length; g++) {
        const scorer = rng.weighted(goalPicker);
        if (scorer && scorer.intl) { scorer.intl.seasonGoals++; scorer.intl.goals++; }
      }
    }

    // Tournaments due this calendar year.
    for (const t of TOURNAMENTS) {
      if ((world.year - t.offset) % t.cycle !== 0) continue;
      const field = Object.keys(pool).filter((n) => {
        if ((pool[n] || []).length < 11) return false;
        return t.scope === "world" || conf(n) === t.conf;
      });
      if (field.length < 4) continue;
      const champion = rng.weighted(field.map((n) => ({ item: n, weight: Math.pow(pot(n), 3) })));
      if (!champion) continue;
      world._intlHonours = world._intlHonours || {};
      world._intlHonours[champion] = (world._intlHonours[champion] || 0) + 1;
      // The winning squad's players bank the achievement and a little reputation.
      const squad = selectSquad(world, champion, pool);
      for (const p of squad.slice(0, 16)) {
        p.intl.tournaments = (p.intl.tournaments || 0) + 1;
      }
      news.push({ type: "trophy", text: `🌍 ${champion} win the ${t.key}.`, clubId: null });
    }

    return news;
  }

  /** Development nudge from a season of international football, read by
   *  players.js. International minutes sharpen a young player faster than club
   *  football alone; for a senior player they mean little. Returns overall
   *  points to add this season. */
  function developmentBonus(player) {
    if (!player.intl || !player.intl.seasonCaps) return 0;
    if (player.age > 26) return 0;
    const caps = player.intl.seasonCaps;
    const goals = player.intl.seasonGoals || 0;
    return clamp(caps * 0.05 + goals * 0.08, 0, 0.8) * (player.age <= 21 ? 1.3 : 1);
  }

  /** Small market premium for a genuine international. */
  function valuePremium(player) {
    if (!player.intl || !player.intl.caps) return 1;
    return 1 + clamp(player.intl.caps, 0, 80) / 400;   // up to +20% for a 80-cap veteran
  }

  MG.international = {
    NATIONS, TOURNAMENTS, pot, conf, buildPool, selectSquad, runSeason,
    developmentBonus, valuePremium,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
