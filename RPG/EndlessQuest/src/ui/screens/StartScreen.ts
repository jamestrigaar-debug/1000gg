import { Difficulty, DIFFICULTIES } from '../../core/rules/Difficulty';
import { PLAYABLE_CLASSES, getOrigin } from '../../core/narrative/Background';
import type { Origin } from '../../core/narrative/Background';
import { getItem } from '../../core/lore/Items';
import { SKILL_NAME } from '../../core/rules/Skills';
import { STARTING_HIT_POINTS } from '../../core/SimulationConstants';
import { MARK_NAME, WORLD_NAME, CHURCH_NAME, INQUISITION_NAME } from '../../core/lore/Lore';
import { capitalize } from '../../core/lore/Flavor';
import {
  ABILITY_LABEL,
  ABILITY_NAME,
  ABILITY_ORDER,
  abilityModifier,
  assignAbilityScoresFor,
} from './abilities';
import { escapeHtml, renderCard } from './cards';

/**
 * What the player settled on before the run begins.
 */
export interface Embark {
  readonly difficulty: Difficulty;
  readonly originId: string;
  readonly seed?: string;
}

/** The pages of the front door, in the order they are walked through. */
type Page = 'title' | 'how' | 'who';

/**
 * The front door.
 *
 * The game used to begin by dropping the player onto a glyph grid with no statement of
 * where they were, what had happened to them, what the burning number in the status bar
 * meant, or what they were supposed to do about any of it. This is the missing half:
 * the premise, the rules of the thing said plainly, and a character chosen rather than
 * dealt -- how hard the country is, which of the three ways through it you are taking,
 * and the kit that comes with it, shown as the cards it always was.
 *
 * It owns the DOM only until the player embarks; then it removes itself entirely and
 * hands back what was chosen.
 */
export class StartScreen {
  private root: HTMLElement;
  private page: Page = 'title';
  private difficulty: Difficulty = Difficulty.MARKED;
  private originId: string = PLAYABLE_CLASSES[0].originId;
  private seed: string;
  private resolve: ((embark: Embark) => void) | null = null;

  /**
   * @param host Element the screen mounts inside, usually the document body
   * @param seed Seed the run will use unless the player changes it
   */
  constructor(host: HTMLElement, seed: string) {
    this.seed = seed;
    this.root = document.createElement('div');
    this.root.id = 'start-screen';
    host.appendChild(this.root);
  }

  /**
   * Shows the screen and waits for the player to embark.
   * @returns What they chose
   */
  show(): Promise<Embark> {
    return new Promise<Embark>((resolve) => {
      this.resolve = resolve;
      this.render();
    });
  }

  /**
   * Draws the current page and binds it.
   */
  private render(): void {
    this.root.innerHTML =
      this.page === 'title'
        ? this.renderTitle()
        : this.page === 'how'
          ? this.renderHow()
          : this.renderWho();

    this.root.scrollTop = 0;
    this.bind();
  }

  /**
   * The premise. Everything a player needs before they agree to any of it.
   */
  private renderTitle(): string {
    return `
      <div class="screen-inner">
        <h1 class="game-title">EndlessQuest</h1>
        <p class="game-sub">A hanging, and what came after</p>

        <div class="premise">
          <p>
            They hanged you at a crossroads oak in ${escapeHtml(WORLD_NAME)}, and the rope
            did not finish it. You came down alive with a weal around your throat that has
            not faded, and will not.
          </p>
          <p>
            That weal is ${escapeHtml(MARK_NAME)}. It burns at dusk and through the night,
            hotter in old and thin places, hotter still when you are bleeding, and cool
            only in daylight and within reach of a village's fires. What it does while it
            burns is <em>draw things toward you</em> — the hungry things ${escapeHtml(
              ERA_LINE
            )}, and the men of ${escapeHtml(INQUISITION_NAME)}, who know exactly what a
            mark like yours means. ${escapeHtml(opening(CHURCH_NAME))} has a word for people the
            rope refuses, and the word is not a kind one.
          </p>
          <p>
            Something was owed at that tree and the debt was not paid. You can walk south
            and out of the Thornmarch, but not until it is settled — and it is settled
            back at the oak you were hanged on, against everything you did on the way
            there.
          </p>
        </div>

        <div class="screen-actions">
          <button data-page="how" class="major">How this is played</button>
          <button data-page="who" class="major primary">Choose who you were</button>
        </div>
      </div>
    `;
  }

  /**
   * The rules, said plainly. Six things, because there are six things.
   */
  private renderHow(): string {
    const sections: readonly (readonly [string, string])[] = [
      [
        'You say what you do',
        'There is a line at the bottom of the screen and you type into it in plain words — ' +
          '"climb the ridge", "go quiet", "bind the wound", "ask the smith about the rites". ' +
          'The buttons are shortcuts for the handful of things done constantly; the line is ' +
          'for everything else. If the world does not understand you it will say so, and ' +
          'offer the nearest things it does know.',
      ],
      [
        'Everything is a roll against a number',
        'Twenty-sided die, plus what you are good at, against a difficulty the situation ' +
          'sets. Being trained in a skill adds your proficiency; a good position rolls twice ' +
          'and takes the better; a bad one takes the worse. Nothing is decided in secret.',
      ],
      [
        'Time is the real currency',
        'Every step, every search, every hour of rest is an hour of the clock. Hunger, ' +
          'thirst and fatigue climb the whole time, and running out of any of them kills as ' +
          'surely as a blade. Sleeping is how you recover, and sleeping is when the mark is ' +
          'at its worst.',
      ],
      [
        'The mark is the pressure',
        `${opening(MARK_NAME)} rises at dusk and through the night and falls ` +
          'in daylight. The higher it stands, the more often the country sends something at ' +
          'you, and the worse what it sends is. Villages cool it. Haste heats it. Every ' +
          'shortcut you take is paid for in exposure.',
      ],
      [
        'People are people, not shops',
        'Everyone you meet holds to something, owes somebody, and is hiding one thing. Speak ' +
          'to them, take their measure, appeal to what they hold to, or use what they are ' +
          'hiding — and live with which of those you chose. They will ask you for things. ' +
          'Doing what you promised is most of what argues your debt down.',
      ],
      [
        'A run ends, and the ending is earned',
        'Keep the rites at the wayside shrines, settle what you owe people, then go back to ' +
          'the gallows-tree and settle the debt. What you did on the way is the whole of the ' +
          'case you make. Die and the run is over; walk south and it is over differently.',
      ],
    ];

    const body = sections
      .map(
        ([heading, text]) => `
        <div class="how-item">
          <h3>${escapeHtml(heading)}</h3>
          <p>${escapeHtml(text)}</p>
        </div>`
      )
      .join('');

    return `
      <div class="screen-inner">
        <h2 class="screen-heading">How this is played</h2>
        <div class="how-grid">${body}</div>
        <div class="screen-actions">
          <button data-page="title">Back</button>
          <button data-page="who" class="major primary">Choose who you were</button>
        </div>
      </div>
    `;
  }

  /**
   * Difficulty, calling, and the kit that comes with it.
   */
  private renderWho(): string {
    const origin = getOrigin(this.originId);

    return `
      <div class="screen-inner">
        <h2 class="screen-heading">Who you were</h2>

        <h3 class="pick-heading">How hard the country is</h3>
        <div class="pick-row">
          ${Object.values(DIFFICULTIES).map((setting) => `
            <button class="pick difficulty${setting.id === this.difficulty ? ' chosen' : ''}"
              data-difficulty="${setting.id}">
              <span class="pick-name">${escapeHtml(setting.name)}</span>
              <span class="pick-line">${escapeHtml(setting.line)}</span>
              <ul class="pick-terms">
                ${setting.terms.map((term) => `<li>${escapeHtml(term)}</li>`).join('')}
              </ul>
            </button>
          `).join('')}
        </div>

        <h3 class="pick-heading">What you did before the rope</h3>
        <div class="pick-row">
          ${PLAYABLE_CLASSES.map((playable) => {
            const candidate = getOrigin(playable.originId);
            if (!candidate) return '';
            return `
              <button class="pick calling${playable.originId === this.originId ? ' chosen' : ''}"
                data-origin="${escapeHtml(playable.originId)}">
                <span class="pick-name">${escapeHtml(playable.calling)}</span>
                <span class="pick-role">${escapeHtml(candidate.name)}</span>
                <span class="pick-line">${escapeHtml(playable.plays)}</span>
                ${this.renderScores(candidate)}
              </button>
            `;
          }).join('')}
        </div>

        ${origin ? this.renderLoadout(origin) : ''}

        <div class="screen-actions">
          <button data-page="title">Back</button>
          <label class="seed-field">Seed
            <input id="start-seed" type="text" spellcheck="false" value="${escapeHtml(this.seed)}" />
          </label>
          <button data-action="embark" class="major primary">Cut yourself down</button>
        </div>
      </div>
    `;
  }

  /**
   * The six numbers an origin will be dealt, worked out without starting anything.
   */
  private renderScores(origin: Origin): string {
    const scores = assignAbilityScoresFor(origin);
    const cells = ABILITY_ORDER.map((ability) => {
      const score = scores[ability];
      const modifier = abilityModifier(score);
      const best = origin.abilityPriority[0] === ability;
      return `<span class="score${best ? ' best' : ''}">${escapeHtml(
        ABILITY_LABEL[ability]
      )} <b>${score}</b> ${modifier >= 0 ? '+' : ''}${modifier}</span>`;
    }).join('');

    return `<span class="pick-scores">${cells}</span>`;
  }

  /**
   * What the chosen calling walks away from the tree carrying, and what it knows.
   */
  private renderLoadout(origin: Origin): string {
    const cards = origin.startingItems
      .map((key) => {
        const item = getItem(key);
        return item ? renderCard(item) : '';
      })
      .join('');

    const bonus = DIFFICULTIES[this.difficulty].bonusHitPoints;
    const hp = STARTING_HIT_POINTS + bonus;

    return `
      <h3 class="pick-heading">What you carry down from the tree</h3>
      <div class="card-row">${cards}</div>
      <div class="loadout-note">
        <span><b>${hp}</b> hit points${bonus !== 0 ? ` (${bonus > 0 ? '+' : ''}${bonus} for ${escapeHtml(DIFFICULTIES[this.difficulty].name)})` : ''}</span>
        <span>Trained in ${escapeHtml(origin.skills.map((skill) => SKILL_NAME[skill]).join(', '))}</span>
        <span>Steady saves in ${escapeHtml(origin.saves.map((ability) => ABILITY_NAME[ability]).join(' and '))}</span>
      </div>
      <p class="loadout-dealt">
        The rest of who you were — what you are walking towards, who you are walking
        towards, and the thing that will eventually cost you — is dealt from the seed.
      </p>
    `;
  }

  /**
   * Wires the current page.
   */
  private bind(): void {
    this.root.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
      el.addEventListener('click', () => {
        this.rememberSeed();
        this.page = el.getAttribute('data-page') as Page;
        this.render();
      });
    });

    this.root.querySelectorAll<HTMLElement>('[data-difficulty]').forEach((el) => {
      el.addEventListener('click', () => {
        this.rememberSeed();
        this.difficulty = el.getAttribute('data-difficulty') as Difficulty;
        this.render();
      });
    });

    this.root.querySelectorAll<HTMLElement>('[data-origin]').forEach((el) => {
      el.addEventListener('click', () => {
        this.rememberSeed();
        this.originId = el.getAttribute('data-origin')!;
        this.render();
      });
    });

    this.root
      .querySelector<HTMLElement>('[data-action="embark"]')
      ?.addEventListener('click', () => {
        this.rememberSeed();
        this.embark();
      });
  }

  /**
   * Keeps an edited seed across a redraw, so choosing a class does not discard it.
   */
  private rememberSeed(): void {
    const input = this.root.querySelector<HTMLInputElement>('#start-seed');
    const typed = input?.value.trim();
    if (typed) this.seed = typed;
  }

  /**
   * Tears the screen down and hands back the choices.
   */
  private embark(): void {
    const chosen: Embark = {
      difficulty: this.difficulty,
      originId: this.originId,
      seed: this.seed || undefined,
    };

    this.root.remove();
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.(chosen);
  }
}

/** Named here rather than inline so the premise reads as one sentence. */
const ERA_LINE = 'that came into the world with the Long Dusk';

/**
 * A lore name at the head of a sentence.
 *
 * Most of them begin with a lower-case article -- "the Church of the Sealed Wound" --
 * which reads as a typo when it opens a sentence.
 *
 * @param name Lore name
 * @returns The same name, capitalised
 */
function opening(name: string): string {
  return capitalize(name);
}
