import { Rarity } from '../../core/lore/items/ItemTypes';
import type { ItemDefinition } from '../../core/lore/items/ItemTypes';

/**
 * Items drawn as cards.
 *
 * The catalog this game was built from is a deck: every entry carries its own weight,
 * worth, scarcity and a line of prose saying what holding it is like. A list of nouns
 * throws all of that away. A card keeps it, and a player choosing a kit at embark is
 * choosing between cards, not between three words.
 */

/** The ink each scarcity band is drawn in. */
export const RARITY_INK: Record<Rarity, string> = {
  [Rarity.COMMON]: '#8a857c',
  [Rarity.UNCOMMON]: '#6b7a4a',
  [Rarity.RARE]: '#3d6b8a',
  [Rarity.ARTIFACT]: '#c8752c',
};

/**
 * Escapes text for interpolation into markup.
 * @param text Raw text
 * @returns The same text, safe between tags and inside attributes
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The line of numbers under a card's name: what the item actually does.
 *
 * Only the figures that apply are shown. A card for a loaf of bread should not carry an
 * empty armour field, and a card for a gambeson should not claim to feed anybody.
 *
 * @param item Catalog entry
 * @returns Short labelled figures, in reading order
 */
export function cardStats(item: ItemDefinition): string[] {
  const stats: string[] = [];
  if (item.damage !== undefined) stats.push(`dmg ${item.sourceDice ?? item.damage}`);
  if (item.armor !== undefined) stats.push(`soak ${Math.round(item.armor * 100)}%`);
  if (item.hunger !== undefined) stats.push(`feeds ${item.hunger}`);
  if (item.thirst !== undefined) stats.push(`slakes ${item.thirst}`);
  if (item.hp !== undefined) stats.push(`heals ${item.hp}`);
  if (item.warmth !== undefined) stats.push(`warmth ${item.warmth}`);
  if (item.lightRadius !== undefined) stats.push(`light ${item.lightRadius}`);
  stats.push(`${item.weight.toFixed(1)} wt`);
  return stats;
}

/**
 * How a card is drawn on this particular occasion.
 */
export interface CardOptions {
  /** How many are held; a count of one is not printed */
  readonly count?: number;
  /** Extra classes for the card element */
  readonly extra?: string;
  /** Element to draw the card as, so a carried item can be its own button */
  readonly tag?: 'div' | 'button';
  /** Attributes for that element, already escaped */
  readonly attrs?: string;
  /** A line under the card saying what pressing it would do */
  readonly footer?: string;
}

/**
 * Renders one catalog entry as a card.
 *
 * @param item Catalog entry
 * @param options How to draw it
 * @returns Card markup
 */
export function renderCard(item: ItemDefinition, options: CardOptions = {}): string {
  const { count = 1, extra = '', tag = 'div', attrs = '', footer } = options;
  const ink = RARITY_INK[item.rarity] ?? RARITY_INK[Rarity.COMMON];
  const tally = count > 1 ? `<span class="card-count">×${count}</span>` : '';

  return `
    <${tag} class="item-card ${extra}" style="--card-ink:${ink}" ${attrs}>
      <span class="card-head">
        <span class="card-name">${escapeHtml(item.name)}</span>${tally}
      </span>
      <span class="card-kind">${escapeHtml(item.category)} · ${escapeHtml(item.rarity)}</span>
      <span class="card-line">${escapeHtml(item.description)}</span>
      <span class="card-stats">${cardStats(item).map((s) => `<span>${escapeHtml(s)}</span>`).join('')}</span>
      ${item.boon ? `<span class="card-boon">${escapeHtml(item.boon)}</span>` : ''}
      ${footer ? `<span class="card-footer">${escapeHtml(footer)}</span>` : ''}
    </${tag}>
  `;
}
