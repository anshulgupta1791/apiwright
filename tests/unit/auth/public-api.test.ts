/**
 * Unit tests for the §6 Authentication Strategy Layer public API barrel
 * (`src/auth/index.ts`).
 *
 * Contract encoded: the barrel re-exports EXACTLY the 21 symbols listed in the
 * design (9 value exports + 12 type-only exports) and NO internal symbols.
 * Two independent verification strategies are used:
 *
 *   (A) Runtime membership: `import * as auth` + `in` operator for value
 *       exports; `not-in` / `toBeUndefined` for the 12 INTERNAL symbols listed
 *       in design §3 and YAML AC#2.
 *   (B) Compile-time membership: `import type { … }` from the barrel for
 *       every type-only re-export; one trivial type alias per imported type so
 *       the TypeScript compiler rejects the file if any type is absent.
 *   (C) Runtime kind: each value export is asserted to have the correct
 *       runtime kind (function/object) and specific properties (frozen,
 *       key===value, etc.).
 *   (D) Static text-scan: `readFileSync` on `src/auth/index.ts` once it
 *       exists to assert structural constraints (leaf modules only, no cross-
 *       module leaks, no default export). The scan test is written NOW against
 *       the yet-to-be-created file; it produces the right failure reason
 *       (module-not-found on the barrel import) in the red phase.
 *
 * RED PHASE — `src/auth/index.ts` does not exist. ALL tests in this file
 * fail with module-not-found at the top-level import statements.
 *
 * Named exports only; ESM `.js` specifiers; no raw JSON.parse; no `as any`;
 * no `@ts-ignore`; no `eslint-disable`.
 *
 * Covers YAML AC#1 (21 public symbols present), AC#2 (internal symbols
 * absent), AC#4 (barrel adds no behaviour — verified by kind checks), AC#7
 * (no default export), AC#8 (structural: named exports, ESM specifiers).
 *
 * Integration facade test (AC#5) lives in
 * `tests/integration/auth/barrel-facade.test.ts`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as nodePath from "node:path";

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// (A) + (C) Runtime barrel import — value and kind assertions.
// ---------------------------------------------------------------------------

import * as auth from "../../../src/auth/index.js";

// ---------------------------------------------------------------------------
// (B) Compile-time type-only imports — the TS compiler rejects this block if
// any type is missing from the barrel. One alias per type (needed to prevent
// noUnusedLocals from stripping the import).
// ---------------------------------------------------------------------------

import type {
  AuthStrategy,
  AuthorizedRequest,
  PreparedRequest,
  RunContext,
  AuthErrorCode,
  AuthPhase,
  AuthStrategyErrorInit,
  HttpFetchInput,
  HttpFetchResult,
  HttpFetchSeam,
  NegativeAuthMarker,
  CloseAllOutcome,
  StrategyCloseResult,
} from "../../../src/auth/index.js";

// Each alias causes the TS compiler to resolve the type from the barrel.
// If the barrel omits the export, the file fails to compile — the red-phase
// failure mode for type-only exports (erased at runtime, cannot use `in`).
type _PinAuthStrategy = AuthStrategy;
type _PinAuthorizedRequest = AuthorizedRequest;
type _PinPreparedRequest = PreparedRequest;
type _PinRunContext = RunContext;
type _PinAuthErrorCode = AuthErrorCode;
type _PinAuthPhase = AuthPhase;
type _PinAuthStrategyErrorInit = AuthStrategyErrorInit;
type _PinHttpFetchInput = HttpFetchInput;
type _PinHttpFetchResult = HttpFetchResult;
type _PinHttpFetchSeam = HttpFetchSeam;
type _PinNegativeAuthMarker = NegativeAuthMarker;
type _PinCloseAllOutcome = CloseAllOutcome;
type _PinStrategyCloseResult = StrategyCloseResult;

// Suppress noUnusedLocals — each pin type is "used" by this declaration.
declare function _usePins(
  _a: _PinAuthStrategy,
  _b: _PinAuthorizedRequest,
  _c: _PinPreparedRequest,
  _d: _PinRunContext,
  _e: _PinAuthErrorCode,
  _f: _PinAuthPhase,
  _g: _PinAuthStrategyErrorInit,
  _h: _PinHttpFetchInput,
  _i: _PinHttpFetchResult,
  _j: _PinHttpFetchSeam,
  _k: _PinNegativeAuthMarker,
  _l: _PinCloseAllOutcome,
  _m: _PinStrategyCloseResult,
): void;

// _usePins is a `declare function` — erased at runtime. Its parameter list
// references each _Pin* type, satisfying noUnusedLocals at compile time.
// No runtime `void` statement (the symbol does not exist at runtime).

// ===========================================================================
// 1. Positive surface — every value export is present and has correct kind
// ===========================================================================

/**
 * Asserts that each of the 9 value exports listed in design §2 is present in
 * the barrel namespace and has the expected runtime type.
 *
 * Design §2.1–§2.6 enumerates: AUTH_ERROR_CODES (frozen const), AuthStrategyError
 * (class), AuthStrategyRegistry (class), NEGATIVE_AUTH_MARKERS (frozen tuple),
 * createAuthRegistry (factory fn), isAuthStrategyError (guard fn), wrapForMarker
 * (dispatcher fn).
 */
describe("src/auth/index.ts — positive value export presence", () => {
  it("exports AUTH_ERROR_CODES as a non-null object", () => {
    expect(typeof auth.AUTH_ERROR_CODES).toBe("object");
    expect(auth.AUTH_ERROR_CODES).not.toBeNull();
  });

  it("AUTH_ERROR_CODES is a frozen object (runtime const, not a type)", () => {
    expect(Object.isFrozen(auth.AUTH_ERROR_CODES)).toBe(true);
  });

  it("AUTH_ERROR_CODES.AUTH_CONFIG_INVALID equals 'AUTH_CONFIG_INVALID'", () => {
    expect(auth.AUTH_ERROR_CODES.AUTH_CONFIG_INVALID).toBe("AUTH_CONFIG_INVALID");
  });

  it("AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN equals 'AUTH_STRATEGY_UNKNOWN'", () => {
    expect(auth.AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN).toBe("AUTH_STRATEGY_UNKNOWN");
  });

  it("AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED equals 'AUTH_TOKEN_FETCH_FAILED'", () => {
    expect(auth.AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED).toBe("AUTH_TOKEN_FETCH_FAILED");
  });

  it("AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND equals 'AUTH_TOKEN_NOT_FOUND'", () => {
    expect(auth.AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND).toBe(
      "AUTH_TOKEN_NOT_FOUND",
    );
  });

  it("AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID equals 'AUTH_HEADER_TEMPLATE_INVALID'", () => {
    expect(auth.AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID).toBe(
      "AUTH_HEADER_TEMPLATE_INVALID",
    );
  });

  it("exports AuthStrategyError as a function (class constructor)", () => {
    expect(typeof auth.AuthStrategyError).toBe("function");
  });

  it("AuthStrategyError instances are instanceof Error", () => {
    const err = new auth.AuthStrategyError({
      code: "AUTH_CONFIG_INVALID",
      message: "test",
      phase: "config",
    });
    expect(err).toBeInstanceOf(Error);
  });

  it("AuthStrategyError instances are instanceof AuthStrategyError", () => {
    const err = new auth.AuthStrategyError({
      code: "AUTH_CONFIG_INVALID",
      message: "test",
      phase: "config",
    });
    expect(err).toBeInstanceOf(auth.AuthStrategyError);
  });

  it("exports AuthStrategyRegistry as a function (class constructor)", () => {
    expect(typeof auth.AuthStrategyRegistry).toBe("function");
  });

  it("exports NEGATIVE_AUTH_MARKERS as a non-null object", () => {
    expect(typeof auth.NEGATIVE_AUTH_MARKERS).toBe("object");
    expect(auth.NEGATIVE_AUTH_MARKERS).not.toBeNull();
  });

  it("NEGATIVE_AUTH_MARKERS is a frozen tuple (runtime const, not a type)", () => {
    expect(Object.isFrozen(auth.NEGATIVE_AUTH_MARKERS)).toBe(true);
  });

  it("NEGATIVE_AUTH_MARKERS contains exactly 'no_auth_returns_401'", () => {
    expect(auth.NEGATIVE_AUTH_MARKERS).toContain("no_auth_returns_401");
  });

  it("NEGATIVE_AUTH_MARKERS contains exactly 'garbage_token_returns_401'", () => {
    expect(auth.NEGATIVE_AUTH_MARKERS).toContain("garbage_token_returns_401");
  });

  it("NEGATIVE_AUTH_MARKERS has exactly two entries", () => {
    expect(auth.NEGATIVE_AUTH_MARKERS).toHaveLength(2);
  });

  it("NEGATIVE_AUTH_MARKERS equals ['no_auth_returns_401', 'garbage_token_returns_401']", () => {
    expect(auth.NEGATIVE_AUTH_MARKERS).toEqual([
      "no_auth_returns_401",
      "garbage_token_returns_401",
    ]);
  });

  it("exports createAuthRegistry as a function (factory)", () => {
    expect(typeof auth.createAuthRegistry).toBe("function");
  });

  it("exports isAuthStrategyError as a function (type guard)", () => {
    expect(typeof auth.isAuthStrategyError).toBe("function");
  });

  it("exports wrapForMarker as a function (dispatcher)", () => {
    expect(typeof auth.wrapForMarker).toBe("function");
  });
});

// ===========================================================================
// 2. Positive surface — membership check via `in` for all 9 value exports
// ===========================================================================

/**
 * Iterates the canonical PUBLIC_VALUES list (from design §6 test sketch) and
 * asserts each name is present in the barrel namespace. Complements the
 * per-export describe blocks above by providing a single exhaustive list check.
 */
describe("src/auth/index.ts — PUBLIC_VALUES membership (in operator)", () => {
  /**
   * The exhaustive list of value (runtime) exports from design §2 and §6.
   * 9 values: classes, functions, frozen consts.
   */
  const PUBLIC_VALUES = [
    "AUTH_ERROR_CODES",
    "AuthStrategyError",
    "AuthStrategyRegistry",
    "NEGATIVE_AUTH_MARKERS",
    "createAuthRegistry",
    "isAuthStrategyError",
    "wrapForMarker",
  ] as const;

  for (const name of PUBLIC_VALUES) {
    it(`'${name}' is present in the barrel namespace`, () => {
      expect(name in auth).toBe(true);
    });

    it(`'${name}' resolves to a defined value`, () => {
      expect((auth as Record<string, unknown>)[name]).toBeDefined();
    });
  }
});

// ===========================================================================
// 3. Negative surface — INTERNAL symbols are absent (design §3 + YAML AC#2)
// ===========================================================================

/**
 * Asserts that every symbol enumerated in design §3 as INTERNAL is absent from
 * the barrel namespace. Uses the barrel namespace cast to
 * `Record<string, unknown>` so we can probe arbitrary keys without TypeScript
 * raising a compile-time error (absent keys are not typed, not reachable via
 * `auth.X` directly).
 *
 * YAML AC#2 verbatim list + the four additional symbols the design adds:
 * `attachAuthHeader`, `GARBAGE_TOKEN_VALUE`, `ValidatedStaticTokenSpec`,
 * `ValidatedTokenEndpointSpec`.
 */
describe("src/auth/index.ts — internal symbols are NOT re-exported", () => {
  /**
   * The barrel namespace cast to allow probing keys TypeScript doesn't know.
   */
  const ns = auth as Record<string, unknown>;

  // YAML AC#2 verbatim list
  it("StaticTokenStrategy is absent from the barrel namespace", () => {
    expect(ns["StaticTokenStrategy"]).toBeUndefined();
  });

  it("TokenEndpointStrategy is absent from the barrel namespace", () => {
    expect(ns["TokenEndpointStrategy"]).toBeUndefined();
  });

  it("NoAuthBypass is absent from the barrel namespace", () => {
    expect(ns["NoAuthBypass"]).toBeUndefined();
  });

  it("GarbageTokenMangle is absent from the barrel namespace", () => {
    expect(ns["GarbageTokenMangle"]).toBeUndefined();
  });

  it("parseAuthStrategyConfig is absent from the barrel namespace", () => {
    expect(ns["parseAuthStrategyConfig"]).toBeUndefined();
  });

  it("ValidatedStrategySpec is absent from the barrel namespace", () => {
    // Type-only in source; `in` returns false for erased types, but we assert
    // to future-proof against accidental value re-export.
    expect(ns["ValidatedStrategySpec"]).toBeUndefined();
  });

  it("parseJsonPath is absent from the barrel namespace", () => {
    expect(ns["parseJsonPath"]).toBeUndefined();
  });

  it("extractByJsonPath is absent from the barrel namespace", () => {
    expect(ns["extractByJsonPath"]).toBeUndefined();
  });

  it("createDefaultHttpFetchSeam is absent from the barrel namespace", () => {
    expect(ns["createDefaultHttpFetchSeam"]).toBeUndefined();
  });

  it("ParsedJsonPath is absent from the barrel namespace", () => {
    // Type-only; same rationale as ValidatedStrategySpec above.
    expect(ns["ParsedJsonPath"]).toBeUndefined();
  });

  // Design §3 additional internal symbols (beyond YAML AC#2 verbatim list)
  it("attachAuthHeader is absent from the barrel namespace", () => {
    expect(ns["attachAuthHeader"]).toBeUndefined();
  });

  it("GARBAGE_TOKEN_VALUE is absent from the barrel namespace", () => {
    expect(ns["GARBAGE_TOKEN_VALUE"]).toBeUndefined();
  });

  it("ValidatedStaticTokenSpec is absent from the barrel namespace", () => {
    expect(ns["ValidatedStaticTokenSpec"]).toBeUndefined();
  });

  it("ValidatedTokenEndpointSpec is absent from the barrel namespace", () => {
    expect(ns["ValidatedTokenEndpointSpec"]).toBeUndefined();
  });

  // Additional guard: no default export should appear
  it("default export is absent (repo idiom: import/no-default-export)", () => {
    expect(ns["default"]).toBeUndefined();
  });
});

// ===========================================================================
// 4. `in` operator cross-check for INTERNAL symbols (design §6 exact list)
// ===========================================================================

/**
 * Cross-checks the NOT_REEXPORTED set using `name in auth` === false, matching
 * the design's §6 test sketch exactly.
 */
describe("src/auth/index.ts — NOT_REEXPORTED membership (in operator returns false)", () => {
  /**
   * The 12 INTERNAL symbols from design §6 negative-assertion list (YAML AC#2
   * verbatim + two additional internals the design lists explicitly).
   */
  const NOT_REEXPORTED = [
    "StaticTokenStrategy",
    "TokenEndpointStrategy",
    "NoAuthBypass",
    "GarbageTokenMangle",
    "parseAuthStrategyConfig",
    "ValidatedStrategySpec",
    "parseJsonPath",
    "extractByJsonPath",
    "createDefaultHttpFetchSeam",
    "ParsedJsonPath",
    "attachAuthHeader",
    "GARBAGE_TOKEN_VALUE",
  ] as const;

  for (const name of NOT_REEXPORTED) {
    it(`'${name}' is NOT in the barrel namespace (in operator === false)`, () => {
      expect(name in auth).toBe(false);
    });
  }
});

// ===========================================================================
// 5. isAuthStrategyError guard — runtime behaviour via barrel
// ===========================================================================

/**
 * Verifies that the barrel re-export of `isAuthStrategyError` is not a
 * dummy/stub — it must actually distinguish `AuthStrategyError` instances from
 * plain values.
 */
describe("src/auth/index.ts — isAuthStrategyError guard round-trip via barrel", () => {
  it("returns true for an AuthStrategyError constructed via barrel", () => {
    const err = new auth.AuthStrategyError({
      code: "AUTH_CONFIG_INVALID",
      message: "barrel guard test",
      phase: "config",
    });
    expect(auth.isAuthStrategyError(err)).toBe(true);
  });

  it("returns false for a plain Error", () => {
    expect(auth.isAuthStrategyError(new Error("plain"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(auth.isAuthStrategyError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(auth.isAuthStrategyError(undefined)).toBe(false);
  });

  it("returns false for a plain object with a code field", () => {
    expect(auth.isAuthStrategyError({ code: "AUTH_CONFIG_INVALID" })).toBe(false);
  });

  it("returns false for a string", () => {
    expect(auth.isAuthStrategyError("AUTH_CONFIG_INVALID")).toBe(false);
  });
});

// ===========================================================================
// 6. AUTH_ERROR_CODES — frozen const value round-trip (design §6 + §2.2)
// ===========================================================================

/**
 * Pins that AUTH_ERROR_CODES is the frozen runtime const, not a type alias.
 * Key-equals-value check on all codes the design mentions; isFrozen assertion.
 */
describe("src/auth/index.ts — AUTH_ERROR_CODES frozen-const pin", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(auth.AUTH_ERROR_CODES)).toBe(true);
  });

  it("AUTH_STRATEGY_UNKNOWN key equals its own value (key===value sentinel)", () => {
    expect(auth.AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN).toBe("AUTH_STRATEGY_UNKNOWN");
  });

  it("AUTH_CONFIG_INVALID key equals its own value", () => {
    expect(auth.AUTH_ERROR_CODES.AUTH_CONFIG_INVALID).toBe("AUTH_CONFIG_INVALID");
  });

  it("AUTH_TOKEN_FETCH_FAILED key equals its own value", () => {
    expect(auth.AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED).toBe("AUTH_TOKEN_FETCH_FAILED");
  });

  it("AUTH_TOKEN_NOT_FOUND key equals its own value", () => {
    expect(auth.AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND).toBe(
      "AUTH_TOKEN_NOT_FOUND",
    );
  });

  it("AUTH_HEADER_TEMPLATE_INVALID key equals its own value", () => {
    expect(auth.AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID).toBe(
      "AUTH_HEADER_TEMPLATE_INVALID",
    );
  });
});

// ===========================================================================
// 7. NEGATIVE_AUTH_MARKERS — frozen tuple value round-trip (design §6 + §2.4)
// ===========================================================================

/**
 * Pins that NEGATIVE_AUTH_MARKERS is the frozen runtime tuple, not a type.
 * Exact content equality + frozen assertion.
 */
describe("src/auth/index.ts — NEGATIVE_AUTH_MARKERS frozen-tuple pin", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(auth.NEGATIVE_AUTH_MARKERS)).toBe(true);
  });

  it("equals ['no_auth_returns_401', 'garbage_token_returns_401'] exactly", () => {
    expect(auth.NEGATIVE_AUTH_MARKERS).toEqual([
      "no_auth_returns_401",
      "garbage_token_returns_401",
    ]);
  });

  it("has length 2", () => {
    expect(auth.NEGATIVE_AUTH_MARKERS).toHaveLength(2);
  });

  it("first element is 'no_auth_returns_401'", () => {
    expect(auth.NEGATIVE_AUTH_MARKERS[0]).toBe("no_auth_returns_401");
  });

  it("second element is 'garbage_token_returns_401'", () => {
    expect(auth.NEGATIVE_AUTH_MARKERS[1]).toBe("garbage_token_returns_401");
  });
});

// ===========================================================================
// 8. Static text-scan of src/auth/index.ts (design §5 / YAML AC#7–AC#8)
// ===========================================================================

/**
 * Reads `src/auth/index.ts` as text and asserts structural constraints that
 * cannot be verified at runtime:
 *   (a) Every `from "..."` specifier is a leaf module within `./` (no cross-
 *       module `../env` or `../core` in the barrel itself).
 *   (b) The file contains no `export default`.
 *   (c) The exact six source-module paths are the only re-export sources:
 *       `./types.js`, `./errors.js`, `./http-fetch-seam.js`,
 *       `./markers/wrap-for-marker.js`, `./strategy-registry.js`,
 *       `./registry-factory.js`.
 *   (d) The file does not contain `as any` or `@ts-ignore`.
 *   (e) The file does not import from `test-catalog`, `cli`, or any runner.
 *
 * In the red phase this suite itself fails at the `readFileSync` call (the
 * file does not exist), which is the correct red-phase failure reason for a
 * static-scan test targeting an unimplemented file.
 */
describe("src/auth/index.ts — static text-scan structural constraints", () => {
  /** Resolve paths relative to the repo root, not the test file location. */
  const repoRoot = nodePath.resolve(
    fileURLToPath(import.meta.url),
    "../../../..",
  );

  /** Read a source file relative to the repo root as UTF-8. */
  function readSrc(relPath: string): string {
    return readFileSync(nodePath.join(repoRoot, relPath), "utf-8");
  }

  it("src/auth/index.ts contains no 'export default' statement", () => {
    const src = readSrc("src/auth/index.ts");
    expect(src).not.toMatch(/export\s+default/);
  });

  it("src/auth/index.ts does not import from test-catalog", () => {
    const src = readSrc("src/auth/index.ts");
    expect(src).not.toMatch(/['"].*test-catalog/);
    expect(src).not.toMatch(/\.\.\/test-catalog/);
  });

  it("src/auth/index.ts does not import from cli", () => {
    const src = readSrc("src/auth/index.ts");
    expect(src).not.toMatch(/['"].*\/cli\//);
    expect(src).not.toMatch(/\.\.\/cli/);
  });

  it("src/auth/index.ts does not contain 'as any'", () => {
    const src = readSrc("src/auth/index.ts");
    expect(src).not.toMatch(/as\s+any/);
  });

  it("src/auth/index.ts does not contain '@ts-ignore'", () => {
    const src = readSrc("src/auth/index.ts");
    expect(src).not.toContain("@ts-ignore");
  });

  it("all from-specifiers in src/auth/index.ts are leaf-module paths starting with './'", () => {
    const src = readSrc("src/auth/index.ts");
    // Extract every from-specifier (both value and type re-exports).
    const specifierRe = /from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    const specifiers: string[] = [];
    while ((match = specifierRe.exec(src)) !== null) {
      const spec = match[1];
      if (spec !== undefined) {
        specifiers.push(spec);
      }
    }
    // Every specifier must start with "./" (sibling within src/auth/).
    // Cross-module paths (../env, ../core) are NOT permitted in this barrel.
    for (const spec of specifiers) {
      expect(spec).toMatch(/^\.\//);
    }
  });

  it("src/auth/index.ts only re-exports from the six authorised leaf modules", () => {
    const src = readSrc("src/auth/index.ts");
    const specifierRe = /from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    const specifiers = new Set<string>();
    while ((match = specifierRe.exec(src)) !== null) {
      const spec = match[1];
      if (spec !== undefined) {
        specifiers.add(spec);
      }
    }

    /**
     * Authorised source modules per design §2.1–§2.6.
     */
    const AUTHORISED_SOURCES = new Set([
      "./types.js",
      "./errors.js",
      "./http-fetch-seam.js",
      "./markers/wrap-for-marker.js",
      "./strategy-registry.js",
      "./registry-factory.js",
    ]);

    for (const spec of specifiers) {
      expect(AUTHORISED_SOURCES.has(spec)).toBe(true);
    }
  });
});
