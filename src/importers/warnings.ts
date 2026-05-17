/**
 * Warnings accumulator for the importer pipeline.
 *
 * Centralizes warning collection, contextual prefixing, and deterministic
 * ordering in one tested place, satisfying DRY for the { endpoint?, warnings }
 * pattern used throughout the pipeline.
 */

/**
 * Thread-safe accumulator for human-readable warning messages.
 *
 * Used by every stage of the importer pipeline to collect warnings that
 * are aggregated into the final ImportOutcome.warnings array.
 */
export class Warnings {
  readonly #messages: string[] = [];

  /**
   * Appends one warning message. Never throws.
   * @param message - The warning text to append.
   */
  add(message: string): void {
    this.#messages.push(message);
  }

  /**
   * Appends every message from an array, in order.
   * @param messages - Array of warning texts to append.
   */
  addAll(messages: readonly string[]): void {
    for (const m of messages) {
      this.#messages.push(m);
    }
  }

  /**
   * Appends every message prefixed with a request-name context tag in the
   * form `[<context>] <message>`.
   * @param context - The context label (e.g. request name).
   * @param messages - Array of warning texts to append with context prefix.
   */
  addAllWithContext(context: string, messages: readonly string[]): void {
    for (const m of messages) {
      this.#messages.push(`[${context}] ${m}`);
    }
  }

  /**
   * Returns a defensive copy of accumulated messages in insertion order.
   * @returns A copy of all accumulated warnings.
   */
  list(): string[] {
    return [...this.#messages];
  }

  /**
   * Count of accumulated messages.
   * @returns Number of warnings accumulated so far.
   */
  get size(): number {
    return this.#messages.length;
  }
}
