/**
 * Canonical, database-agnostic result of a single executed verification
 * query. This interface is the **single source of truth** for the DB result
 * shape across APIWright: it MUST NOT be re-declared anywhere else. Every §5
 * Database Connector (PostgreSQL, MySQL, MongoDB, Neo4j) normalizes its native
 * driver output into this exact shape and returns it from
 * `DbConnector.execute()`. The §4 declarative-assertion evaluator stores one
 * `NormalizedResult` per named query in its `db.<connection>.<query>` context
 * slot and evaluates `db.*` targets and `expect` modes against it. Defined
 * here in `src/core` (near zero-dependency) so both layers depend on the
 * abstraction, never on each other.
 */
export interface NormalizedResult {
  /**
   * Result records as plain JSON-shaped objects, in driver result order.
   * Each entry is one row (SQL), document (Mongo), or node/record (Neo4j),
   * keyed by column/field name with values of unknown type (narrow at the
   * assertion site). Empty array means zero records — never `undefined`.
   * `match`/`exact` `expect` modes compare declared fields against entries
   * here; `exists` checks this is non-empty.
   */
  rows: Record<string, unknown>[];

  /**
   * Count of records the connector resolved for this query. For row-returning
   * queries this equals `rows.length`; connectors MAY set it from a driver
   * affected-rows count for non-row statements where `rows` is `[]`. The
   * `count_equals` family of `db.*` assertions reads this value.
   */
  rowCount: number;

  /**
   * Opaque, connector-specific raw driver payload, preserved for escape-hatch
   * assertions and debugging. Intentionally typed `unknown`: consumers MUST
   * narrow before use and MUST NOT rely on its structure across connectors or
   * driver versions. Not serialization-guaranteed (may be non-JSON, e.g. a
   * driver result object). Prefer `rows`/`rowCount`; treat `raw` as last
   * resort.
   */
  raw: unknown;
}
