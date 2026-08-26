import type { OracleTable } from './Oracle';

/**
 * The Thornmarch oracle tables.
 *
 * Tone follows LORE.md section IV: understate the supernatural, keep the vocabulary
 * plain, and let cruelty have a reason even when it is a bad one.
 */

/**
 * How a stranger takes your approach.
 *
 * Consulted with a penalty scaled to the Gallowsmark, so a man carrying hot has a
 * harder time being taken for an ordinary traveller.
 */
export const NPC_REACTION_TABLE: OracleTable = {
  id: 'npc_reaction',
  type: 'npc_reaction',
  die: 20,
  entries: [
    {
      roll: [1, 3],
      result: 'hostile',
      description:
        'They see the weal at your throat before they see your face, and their hand goes to what they are carrying.',
      variants: [
        'No one says anything. One of them steps wide of the others, and that is the whole conversation.',
        'They have had a bad year and you are the first thing they have met that they might be able to beat.',
      ],
      consequence: 'violence_likely',
    },
    {
      roll: [4, 8],
      result: 'afraid',
      description:
        'They put the cart between you and them, and keep it there while they talk.',
      variants: [
        'A woman pulls a child in behind her skirts by the hair, and does not apologise for it.',
        'They answer everything you ask, quickly, wrongly, wanting you gone.',
      ],
      consequence: 'no_hospitality',
    },
    {
      roll: [9, 14],
      result: 'wary',
      description:
        'They give you the road and a short answer, and watch you until you are past.',
      variants: [
        'A shrug, a direction, and no name given on either side.',
        'They ask where you have come from before they ask anything else, and weigh the answer.',
      ],
    },
    {
      roll: [15, 18],
      result: 'civil',
      description:
        'They nod, the way people do when they have decided you are not tonight’s problem.',
      variants: [
        'They share the fire without sharing much else, and that is a fair trade.',
        'Talk of the roads, the weather, and who has died. Nothing about you.',
      ],
    },
    {
      roll: [19, 20],
      result: 'kind',
      description:
        'They offer you bread without being asked, and do not comment on the mark. Some people are simply like that, and it never stops being surprising.',
      variants: [
        'An old man refills your skin and waves off the coin, saying he has been on the road himself.',
        'They set a second bowl down before you have asked, and look away while you eat.',
      ],
      consequence: 'hospitality',
    },
  ],
};

/**
 * What the ground gives up when you go over it properly.
 */
export const DISCOVERY_TABLE: OracleTable = {
  id: 'discovery',
  type: 'discovery',
  die: 20,
  entries: [
    {
      roll: [1, 6],
      result: 'nothing',
      description: 'Others came through here already, and were thorough.',
      variants: [
        'Turned earth and nothing under it. Somebody had the same idea, earlier.',
        'You go over it twice and come up with cold hands.',
      ],
    },
    {
      roll: [7, 11],
      result: 'traces',
      description:
        'A cold firepit, and boot prints going the way you are going.',
      variants: [
        'A snare, sprung and emptied, the line still good.',
        'Cart ruts filling with water. Whoever it was, was in a hurry and heavy-laden.',
      ],
    },
    {
      roll: [12, 15],
      result: 'remains',
      description:
        'Somebody stopped here and did not start again. What the weather left is not much.',
      variants: [
        'A hand, mostly, still wearing a ring that nobody thought worth the trouble.',
        'Bones picked clean and laid out too neatly to have fallen that way.',
      ],
    },
    {
      roll: [16, 18],
      result: 'shelter',
      description:
        'A byre with half a roof. Not warm, but out of the wind, and it has a door.',
      variants: [
        'A charcoal-burner’s hut, long cold, with dry kindling still stacked inside.',
        'A drystone fold on the lee side of a rise. Sheep smell, no sheep, no wind.',
      ],
      consequence: 'safe_rest',
    },
    {
      roll: [19, 20],
      result: 'old_place',
      description:
        'Cut stone under the turf, laid in a pattern, going down. Older than the Church and not built by anyone who worshipped in one.',
      variants: [
        'A well with no village round it, and the rope still on the winch.',
        'Standing stones with the faces worn off, and no birds anywhere near them.',
      ],
      consequence: 'thin_place',
    },
  ],
};

/**
 * What goes wrong now. Consulted when a check comes apart badly.
 */
export const TWIST_TABLE: OracleTable = {
  id: 'twist',
  type: 'twist',
  die: 20,
  entries: [
    {
      roll: [1, 2],
      result: 'noise',
      description:
        'You make more noise than you meant to, and the dark takes note of it.',
      variants: [
        'Your foot goes through a crust of ice and the sound carries further than it has any right to.',
        'You swear, out loud, before you can stop it.',
      ],
      consequence: 'mark_rises',
    },
    {
      roll: [3, 4],
      result: 'noise',
      description:
        'Something goes over with a crash you feel in your teeth. The quiet afterwards is worse.',
      variants: [
        'A bird goes up screaming from under your feet, and takes the whole treeline with it.',
        'Something you dislodged keeps falling long after you expected it to stop.',
      ],
      consequence: 'mark_rises',
    },
    {
      roll: [5, 6],
      result: 'injury',
      description: 'You put your weight somewhere it should not have gone.',
      variants: [
        'Your ankle turns on wet stone and you go down hard on the same shoulder as last time.',
        'You catch yourself on a broken haft and the splinter goes in deep.',
      ],
      consequence: 'wound',
    },
    {
      roll: [7, 8],
      result: 'injury',
      description:
        'Thorn goes through the meat of your hand and breaks off in there.',
      variants: [
        'Rust and old iron open the back of your forearm. It is not the cut that worries you.',
        'You take the weight wrong and something in your back lets go.',
      ],
      consequence: 'wound',
    },
    {
      roll: [9, 10],
      result: 'delay',
      description:
        'The way you meant to take is gone, and going round costs you the light.',
      variants: [
        'The water is up over the ford and you spend the afternoon finding out how far.',
        'You lose the track twice and find it once.',
      ],
      consequence: 'time_lost',
    },
    {
      roll: [11, 12],
      result: 'delay',
      description:
        'You work at it far longer than it was worth, and know it the whole time.',
      variants: [
        'The ground turns to sucking mire and gives back one boot for every two steps.',
        'You backtrack to a mark you left and find you have been walking a circle.',
      ],
      consequence: 'time_lost',
    },
    {
      roll: [13, 14],
      result: 'loss',
      description: 'Something you were carrying is not on you any more.',
      variants: [
        'The strap has parted somewhere behind you, and going back for it is not worth what going back costs.',
        'You set something down to work with both hands and cannot now say where.',
      ],
      consequence: 'item_lost',
    },
    {
      roll: [15, 16],
      result: 'foul',
      description:
        'What you turn up has been dead a while, and you have your hands in it before you understand that.',
      variants: [
        'The smell reaches you a moment after your hands do.',
        'It comes apart when you lift it, and you carry the stink for days.',
      ],
    },
    {
      roll: [17, 18],
      result: 'witness',
      description:
        'You are not alone, and have not been for a while. Whatever it is has been letting you work.',
      variants: [
        'Something on the treeline has your shape and will not resolve into anything else.',
        'The dogs, if they are dogs, have stopped moving and started waiting.',
      ],
      consequence: 'observed',
    },
    {
      roll: [19, 20],
      result: 'witness',
      description:
        'Boot prints over your own, going the same way, pressed since you came through.',
      variants: [
        'A cairn you did not build, on ground you crossed an hour ago.',
        'Somebody has been through your leavings and put them back almost right.',
      ],
      consequence: 'observed',
    },
  ],
};

/**
 * Signs and portents, read into ordinary things by people with reason to.
 */
export const OMEN_TABLE: OracleTable = {
  id: 'omen',
  type: 'omen',
  die: 20,
  entries: [
    {
      roll: [1, 4],
      result: 'ill',
      description:
        'Crows going the wrong way for the season, and none of them calling.',
      variants: [
        'A hare dead in the road with nothing taken from it.',
        'The milk has turned in every pail in the last steading, and it was not warm enough for that.',
      ],
    },
    {
      roll: [5, 9],
      result: 'ill',
      description:
        'The dogs in the last village would not settle, and nobody would say why.',
      variants: [
        'Three graves cut and only two filled, and no one working the third.',
        'The bell in the last chapel is gone, and the rope is still there.',
      ],
    },
    {
      roll: [10, 14],
      result: 'neutral',
      description: 'Weather coming in off the high ground. Only weather.',
      variants: [
        'Ravens on the gallows-frame, doing what ravens do.',
        'Frost early, thick on the north faces. The season is turning and that is all it is.',
      ],
    },
    {
      roll: [15, 18],
      result: 'fair',
      description:
        'Woodsmoke on the wind, which means a hearth, which means people.',
      variants: [
        'A wayshrine kept swept, with fresh cut flowers going brown on it.',
        'A dog barks a long way off and is answered, which means two households at least.',
      ],
    },
    {
      roll: [19, 20],
      result: 'fair',
      description:
        'A milestone, cut with a road-name still legible. Somebody maintained this once, and might again.',
      variants: [
        'Charcoal on a gatepost in a mark you know: safe water, this way.',
        'Beehives, tended, with somebody’s ladder still against the wall.',
      ],
    },
  ],
};

/**
 * Every table the Thornmarch registers at startup.
 */
export const ORACLE_TABLES: readonly OracleTable[] = [
  NPC_REACTION_TABLE,
  DISCOVERY_TABLE,
  TWIST_TABLE,
  OMEN_TABLE,
];
