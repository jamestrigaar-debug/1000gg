import type { RNG } from '../rng/SeededRNG';

/**
 * The Oracle: random tables that answer narrative questions the simulation cannot.
 *
 * Solo tabletop games use oracles to stand in for a human game master. When the world
 * needs to decide something it has no model for -- how a stranger takes your approach,
 * what the mire has left on the bank, what goes wrong now -- the Oracle is asked, and
 * its answer is treated as fact.
 *
 * Every consultation draws from the simulation's SeededRNG, so a seed reproduces not
 * just the same world but the same story told about it.
 */

/**
 * What kind of question a table answers.
 */
export type OracleTableType =
  | 'npc_reaction'
  | 'discovery'
  | 'twist'
  | 'omen'
  | 'rumor'
  | 'encounter';

/**
 * A single weighted answer within a table.
 */
export interface OracleEntry {
  /** Inclusive die-roll range this entry covers */
  readonly roll: readonly [number, number];
  /** Short machine-readable key, for systems that branch on the answer */
  readonly result: string;
  /** Player-facing narration */
  readonly description: string;
  /**
   * Further ways of saying the same thing.
   *
   * A table with one line per band tells the same story every time it is consulted,
   * which is how a run starts to feel mechanical. Variants are drawn alongside the
   * description, so the answer stays fixed while the telling of it does not.
   */
  readonly variants?: readonly string[];
  /** Optional note on what the answer sets in motion */
  readonly consequence?: string;
}

/**
 * A table of answers to one kind of question.
 */
export interface OracleTable {
  readonly id: string;
  readonly type: OracleTableType;
  /** Size of the die rolled against this table */
  readonly die: number;
  readonly entries: readonly OracleEntry[];
}

/**
 * An answer, with the roll that produced it.
 */
export interface OracleResult {
  readonly tableId: string;
  readonly roll: number;
  readonly entry: OracleEntry;
  /** The wording drawn for this consultation, from the entry's description and variants */
  readonly narration: string;
}

/**
 * Draws one wording for an answer.
 *
 * @param entry Entry that was rolled
 * @param rng Seeded generator
 * @returns The description, or one of its variants
 */
export function narrationOf(entry: OracleEntry, rng: RNG): string {
  if (!entry.variants || entry.variants.length === 0) return entry.description;
  const wordings = [entry.description, ...entry.variants];
  return wordings[rng.nextInt(0, wordings.length - 1)];
}

/**
 * Consults oracle tables.
 *
 * Tables are registered once at construction and are immutable thereafter, so the
 * engine holds no mutable state and needs nothing done to it on save or load.
 */
export class OracleEngine {
  private tables: Map<string, OracleTable> = new Map();

  /**
   * @param tables Tables to register
   */
  constructor(tables: readonly OracleTable[] = []) {
    for (const table of tables) {
      this.register(table);
    }
  }

  /**
   * Registers a table, replacing any table with the same id.
   * @param table Table to register
   */
  register(table: OracleTable): void {
    this.tables.set(table.id, table);
  }

  /**
   * Reports whether a table is known.
   * @param tableId Table identifier
   * @returns true if the table is registered
   */
  has(tableId: string): boolean {
    return this.tables.has(tableId);
  }

  /**
   * Puts a question to a table.
   *
   * @param tableId Table to consult
   * @param rng Seeded generator
   * @param modifier Shifts the roll, so that circumstance can weight the answer;
   *   a hot Gallowsmark makes a wary reaction likelier than a warm welcome
   * @returns The answer, or null if the table is unknown
   */
  ask(tableId: string, rng: RNG, modifier: number = 0): OracleResult | null {
    const table = this.tables.get(tableId);
    if (!table || table.entries.length === 0) return null;

    const raw = rng.nextInt(1, table.die) + modifier;
    const roll = Math.max(1, Math.min(table.die, raw));

    const entry =
      table.entries.find((e) => roll >= e.roll[0] && roll <= e.roll[1]) ??
      table.entries[table.entries.length - 1];

    return { tableId, roll, entry, narration: narrationOf(entry, rng) };
  }

  /**
   * Returns every registered table, for validation and tooling.
   * @returns The registered tables
   */
  allTables(): OracleTable[] {
    return Array.from(this.tables.values());
  }
}
