/**
 * Binds a neutral Mongo document. Pure, deterministic, total, NEVER throws.
 * NO query-string rewrite: deep-clones the neutral document via env `mapTree`
 * (prototype-safe) and replaces each sentinel VALUE leaf with its resolved
 * value. Object KEYS are NEVER touched (env `mapTree` visits values only).
 *
 * D3 proof (structural — strongest of the four engines): there is no
 * query-language string. Values are placed into document VALUE leaves; keys
 * are never derived from values. An injection-style value (`{$where:…}`,
 * `$ne`, `'; DROP …`) is a value leaf the driver treats as data — it can
 * never become an operator key or query-language syntax.
 */

import { mapTree } from "../../env/tree-walk.js";

import { buildValueMap, checkContract, makeBindError } from "./binder-shared.js";
import type { MongoBoundQuery, BindResult } from "./engine-binding-types.js";
import { NEUTRAL_PLACEHOLDER_PREFIX } from "./ref-extractor.js";
import type { NeutralQuery, BoundValue } from "./types.js";


// ---------------------------------------------------------------------------
// Whole-token sentinel detection
// ---------------------------------------------------------------------------

/**
 * Regex to test whether a string leaf is EXACTLY one whole-token sentinel
 * (and nothing else). A whole-token leaf like ` APIWRIGHT_PARAM_0 ` is
 * type-preservingly replaced by the raw resolved value (number, object,
 * null, …). An embedded sentinel is string-substituted.
 *
 * The prefix itself starts with a space; the test helper may prepend an
 * additional space (via `` ` ${P}${i} ` ``), so the regex uses `\s*` at
 * both ends to absorb surrounding whitespace around the core prefix content.
 * Built from the imported prefix const (trimmed for the anchored match so
 * the surrounding-space convention does not break the whole-token test).
 */
const ESCAPED_PREFIX_CORE = NEUTRAL_PLACEHOLDER_PREFIX.trim().replace(
  /[.*+?^${}()|[\]\\]/g,
  "\\$&",
);

const WHOLE_TOKEN_RE: RegExp = new RegExp(
  `^\\s*${ESCAPED_PREFIX_CORE}(\\d+)\\s*$`,
);

/**
 * Regex to find embedded sentinel substrings for global string replacement.
 * Used on string leaves that are NOT a whole-token sentinel. Uses `\s+`
 * before the core prefix to absorb any surrounding spaces produced by the
 * upstream extractor's space-bounded sentinel convention (the test helper
 * may prepend extra whitespace via `` ` ${P}${i} ` ``).
 */
const EMBEDDED_SENTINEL_RE: RegExp = new RegExp(
  `\\s*${ESCAPED_PREFIX_CORE}(\\d+)\\s*`,
  "g",
);

// ---------------------------------------------------------------------------
// bindMongo
// ---------------------------------------------------------------------------

/**
 * Binds a neutral Mongo document.
 *
 * Deep-clones the neutral document via env `mapTree` (prototype-safe,
 * `Object.defineProperty`, own-property only — input never mutated) and
 * replaces each sentinel VALUE leaf with its resolved value:
 * - Whole-token leaf → raw resolved value (type-preserving; number/object/null
 * stay their type).
 * - Embedded sentinel → `String(value)` substitution (`null`/`undefined` → `""`),
 * matching the env resolver's embedded-token stringification semantics.
 *
 * Keys are NEVER touched; the `occurrences` array is not consumed (the
 * document structure is the occurrence map for Mongo).
 * @param neutral - The upstream {@link NeutralQuery} (object/array-shaped for
 *   Mongo).
 * @param values - The upstream ordered {@link BoundValue}s (one per distinct
 *   ref, index-aligned to `neutral.refs`).
 * @returns `ok:true` with a {@link MongoBoundQuery}, or a defensive
 *   `DB_PARAM_NOT_BINDABLE` error on a contract violation (incl. a string
 *   `neutralQuery`, which is invalid for the Mongo binder).
 */
export function bindMongo(
  neutral: NeutralQuery,
  values: readonly BoundValue[],
): BindResult {
  // Guard: Mongo neutral must be an object or array, never a string.
  if (typeof neutral.neutralQuery === "string") {
    return makeBindError(
      "Binding contract violation: expected an object/array neutralQuery for " +
        "the MongoDB binder but received a string.",
    );
  }

  const contractError = checkContract(neutral, values);
  if (contractError !== null) return contractError;

  const valueMap = buildValueMap(values);

  /**
   * String-leaf mapper for `mapTree`. Handles the whole-token vs embedded
   * sentinel distinction.
   * @param str - The string leaf value from the document tree.
   * @returns The mapped value: raw resolved value for whole-token sentinels,
   *   string-substituted result for embedded sentinels, or the original string.
   */
  function mapLeaf(str: string): unknown {
    // Check for a whole-token sentinel first.
    const wholeMatch = WHOLE_TOKEN_RE.exec(str);
    if (wholeMatch !== null) {
      /* istanbul ignore next — WHOLE_TOKEN_RE capture group 1 is \d+ (always
         defined when the regex matches); ?? "0" is an unreachable noUncheckedIndexedAccess
         defensive fallback that TypeScript requires for the nullable group accessor. */
      const refIndex = parseInt(wholeMatch[1] ?? "0", 10);
      // Type-preserving: return the raw resolved value (could be number, object,
      // null, boolean, etc.). valueMap.get returns the value or undefined; we
      // use `undefined` as a safe passthrough (upstream contract: found values
      // are never undefined; a missing entry is a defensive backstop).
      /* istanbul ignore next — valueMap is always populated from the contract-validated
         resolved BoundValues; a missing refIndex is an upstream-contract violation that
         the checkContract call above guarantees cannot reach here. */
      return valueMap.has(refIndex) ? valueMap.get(refIndex) : str;
    }

    // Embedded sentinel: replace sentinel substrings with String(value).
    // Resets lastIndex before use (global regex is stateful).
    EMBEDDED_SENTINEL_RE.lastIndex = 0;
    if (!EMBEDDED_SENTINEL_RE.test(str)) {
      // No sentinel in this leaf; pass through unchanged.
      return str;
    }

    // Reset and perform the global replace.
    EMBEDDED_SENTINEL_RE.lastIndex = 0;
    return str.replace(EMBEDDED_SENTINEL_RE, (_match, capturedRefIndex: string) => {
      const refIndex = parseInt(capturedRefIndex, 10);
      const value = valueMap.get(refIndex);
      // null/undefined → "" (env parity for embedded-token stringification)
      if (value === null || value === undefined) return "";
      // Objects/arrays: use JSON.stringify for embedded context.
      if (typeof value === "object") return JSON.stringify(value);
      // Primitives: string, number, boolean are the only DB scalar types in practice.
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      // boolean is the only remaining DB-possible primitive; return its string form.
      // If somehow a non-boolean reaches here (bigint/symbol/function), return empty string.
      return typeof value === "boolean"
        ? String(value)
        : /* istanbul ignore next — bigint/symbol/function are not DB value types;
             this arm exists only for TypeScript unknown-narrowing exhaustiveness. */ "";
    });
  }

  // Deep-clone via mapTree (prototype-safe; env precedent).
  const document = mapTree(neutral.neutralQuery, mapLeaf) as
    | Readonly<Record<string, unknown>>
    | readonly unknown[];

  const bound: MongoBoundQuery = { document };
  return { ok: true, query: { engine: "mongodb", bound } };
}
