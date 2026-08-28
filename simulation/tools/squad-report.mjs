/* ============================================================================
 * SQUAD REPORT — which teams still pick an eleven that a fan would query.
 *
 *   npx vite-node tools/squad-report.mjs
 *
 * tools/extract-teams.mjs fixes what CAN be fixed from the data: it restores
 * every player who belongs to a squad and was wrongly cut from it. Two kinds
 * of problem survive that, and neither can be fixed by code — both need a
 * human to say what the right answer is.
 *
 *   MISSING FROM THE SOURCE. ../src/data.js simply does not list the player.
 *   Manchester United 1999 has no Peter Schmeichel: the best keeper in the
 *   Treble squad, as the data has it, is Nick Culkin at 70. Nothing can be
 *   derived from that; somebody has to supply him.
 *
 *   A caveat that matters when reading the keeper list: `overall` in the
 *   source is weighted for outfield play, so goalkeepers sit a division lower
 *   on it as a matter of course — across the whole database keepers average
 *   62.8 against forwards' 74.3. A keeper rated 70 is therefore not
 *   necessarily a bad keeper, and none of this reaches the simulation, which
 *   derives shot-stopping from balance, speed, strength and mentality rather
 *   than from `overall`. So a keeper is only flagged here when he is low
 *   AGAINST OTHER KEEPERS (the best in the database is Alisson at 90) while
 *   playing for a squad that ought to have a good one.
 *
 *   NO LEFT AND RIGHT. Positions in the data are GK/CB/FB/DM/CM/AM/WG/FW, so
 *   a left-back and a right-back are the same thing, and the picker fills both
 *   full-back slots with the two best "FB" it can find. That is the whole
 *   Luke Bolton story: City 2018's full-backs are Walker 82, Bolton 66,
 *   Zinchenko 65 — so a reserve gets in ahead of the actual left-back on one
 *   rating point, and there is no field anywhere in the data that could say
 *   otherwise.
 *
 * This lists both, per team, so the corrections can be asked for by name
 * rather than guessed at.
 * ========================================================================== */

import { fixtureFrom, teamList } from "../src/data/teams";
import { loadFormations } from "../src/data";

const formations = loadFormations();
const SHAPE = "4-2-3-1";
const shape = formations[SHAPE];
if (!shape) throw new Error(`no ${SHAPE}`);

/** A starter this far below his own squad's rating is a weak link worth a look. */
const WEAK_LINK_GAP = 12;
/* Keepers are judged on the keeper scale, not the outfield one. The best in
 * the database is 90; a side rated 80+ playing someone under 75 has almost
 * certainly had its first choice left out of the source data. */
const KEEPER_FLOOR = 75;
const KEEPER_FLOOR_APPLIES_ABOVE = 80;

const teams = teamList();
const keeperGaps = [];
const weakLinks = [];

for (const team of teams) {
  const fixture = fixtureFrom({
    homeId: team.id,
    awayId: teams[0].id === team.id ? teams[1].id : teams[0].id,
    homeFormation: shape,
    awayFormation: shape,
    seed: "report",
  });
  const eleven = fixture.home.squad.slice(0, 11);
  const label = `${team.club} ${team.season}${team.note ? ` (${team.note})` : ""}`;

  const keeper = eleven[0];
  if (keeper && keeper.overall < KEEPER_FLOOR && team.rating >= KEEPER_FLOOR_APPLIES_ABOVE) {
    const others = team.squad
      .filter((p) => p.pos === "GK")
      .map((p) => `${p.name} ${p.overall}`)
      .join(", ");
    keeperGaps.push(
      `${label}\n      plays ${keeper.name} (${keeper.overall}); squad rated ${team.rating}\n` +
        `      keepers in the data: ${others}`,
    );
  }

  eleven.forEach((player, i) => {
    const slot = shape.slots[i];
    if (!slot || slot.position === "GK") return;
    const gap = team.rating - player.overall;
    if (gap >= WEAK_LINK_GAP) {
      weakLinks.push(
        `${label}\n      ${slot.position} — ${player.name} (${player.pos} ${player.overall}), ` +
          `${gap} below the squad's ${team.rating}`,
      );
    }
  });
}

console.log(`Every team picked in ${SHAPE}. ${teams.length} teams.\n`);

console.log(
  `FIRST-CHOICE KEEPER LOOKS ABSENT (${keeperGaps.length})\n` +
    `  judged against other keepers, not outfielders — see the header\n`,
);
for (const line of keeperGaps) console.log(`  ! ${line}`);

console.log(`\nWEAK LINK IN THE XI — ${WEAK_LINK_GAP}+ below the squad (${weakLinks.length})`);
for (const line of weakLinks) console.log(`  ? ${line}`);

console.log(`
Both lists need a person, not a formula:

  - a keeper flagged above is missing from the source data. Naming him is the
    only fix; deriving one would be inventing a player.
  - a weak link is usually the left/right problem. The data has no side, so
    naming the actual left-back (or winger) for that side is the only way the
    picker can know.
`);
