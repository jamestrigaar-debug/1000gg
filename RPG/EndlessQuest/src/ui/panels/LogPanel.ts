import type { GameEvent } from '../../events/GameEvent';
import { formatGameTime } from '../../core/state/GameState';

/**
 * UI panel displaying scrollable chronological log of game events with timestamps.
 */
export class LogPanel {
  private container: HTMLElement;
  private maxEntries: number = 50;

  /**
   * @param container DOM element hosting the log entries
   */
  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Renders the complete history of recent game events into the container.
   * @param events Full list of GameEvents
   */
  render(events: GameEvent[]): void {
    const recent = events.slice(-this.maxEntries);
    this.container.innerHTML = recent
      .map((e) => {
        const time = formatGameTime(e.tick);
        return `<div class="log-entry ${this.escapeHtml(e.type)}">[T${e.tick} ${time}] ${this.escapeHtml(e.message)}</div>`;
      })
      .join('');
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Appends a single new event to the log without full rebuild.
   * @param event Incoming GameEvent
   */
  addEvent(event: GameEvent): void {
    const time = formatGameTime(event.tick);
    const div = document.createElement('div');
    div.className = `log-entry ${this.escapeHtml(event.type)}`;
    div.textContent = `[T${event.tick} ${time}] ${event.message}`;

    this.container.appendChild(div);

    while (this.container.children.length > this.maxEntries) {
      this.container.removeChild(this.container.firstChild!);
    }

    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Safely escapes HTML special characters.
   */
  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Clears all log entries from the DOM.
   */
  clear(): void {
    this.container.innerHTML = '';
  }

  /**
   * Cleans up panel DOM contents.
   */
  destroy(): void {
    this.clear();
  }
}
