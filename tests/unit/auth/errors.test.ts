import { describe, it, expect } from "vitest";

import {
  AUTH_ERROR_CODES,
  AuthStrategyError,
  isAuthStrategyError,
} from "../../../src/auth/errors.js";
import type {
  AuthPhase,
  AuthErrorCode,
  AuthStrategyErrorInit,
} from "../../../src/auth/errors.js";

/**
 * Unit tests for the §6 auth strategy error taxonomy (src/auth/errors.ts).
 *
 * Mirrors the precedent at tests/unit/db/connector-errors.test.ts.
 * src/auth/errors.ts carries runtime exports and is NOT coverage-excluded.
 * These tests drive it to ~100% branch coverage (the module has no real
 * branches; constructor is straight-line and the guard is a single instanceof).
 *
 * RED PHASE: src/auth/errors.ts does not exist. This file fails with
 * "Cannot find module" until the implementation-engineer creates it.
 *
 * Categories:
 *   9.1 Construction — every code × 6 assertions via it.each
 *   9.2 Frozen const — key===value for all 8 codes; isFrozen; key count;
 *       immutability attempt
 *   9.3 Type guard   — true path; false paths; duck-typed POJO; narrowing
 *   9.4 Secret-safety — legal message; marker-secret passthrough; fixed fields
 *   9.5 Cause chain  — Error; non-Error; absent; null; string causes
 */

// ---------------------------------------------------------------------------
// 9.1 Construction — eight codes × six assertions (it.each)
// ---------------------------------------------------------------------------

/**
 * All eight D10 error codes paired with a representative phase from the
 * design §2.1 lifecycle mapping.
 */
const CODE_PHASE_PAIRS: ReadonlyArray<[AuthErrorCode, AuthPhase]> = [
  ["AUTH_CONFIG_INVALID", "config"],
  ["AUTH_EXPIRES_IN_INVALID", "extract"],
  ["AUTH_HEADER_TEMPLATE_INVALID", "config"],
  ["AUTH_STRATEGY_UNKNOWN", "config"],
  ["AUTH_TOKEN_FETCH_FAILED", "fetch"],
  ["AUTH_TOKEN_FETCH_NON_2XX", "fetch"],
  ["AUTH_TOKEN_NOT_FOUND", "extract"],
  ["AUTH_TOKEN_NOT_STRING", "extract"],
];

const FIXED_MESSAGE = "test error message";

describe("AuthStrategyError — construction", () => {
  it.each(CODE_PHASE_PAIRS)(
    "is an instance of Error for %s / %s",
    (code, phase) => {
      const err = new AuthStrategyError({ code, phase, message: FIXED_MESSAGE });
      expect(err).toBeInstanceOf(Error);
    },
  );

  it.each(CODE_PHASE_PAIRS)(
    "is an instance of AuthStrategyError for %s / %s",
    (code, phase) => {
      const err = new AuthStrategyError({ code, phase, message: FIXED_MESSAGE });
      expect(err).toBeInstanceOf(AuthStrategyError);
    },
  );

  it.each(CODE_PHASE_PAIRS)(
    "carries code %s correctly",
    (code, phase) => {
      const err = new AuthStrategyError({ code, phase, message: FIXED_MESSAGE });
      const recorded: AuthErrorCode = err.code;
      expect(recorded).toBe(code);
    },
  );

  it.each(CODE_PHASE_PAIRS)(
    "carries phase %s correctly for %s",
    (code, phase) => {
      const err = new AuthStrategyError({ code, phase, message: FIXED_MESSAGE });
      const recorded: AuthPhase = err.phase;
      expect(recorded).toBe(phase);
    },
  );

  it.each(CODE_PHASE_PAIRS)(
    "has name === 'AuthStrategyError' for %s",
    (code, phase) => {
      const err = new AuthStrategyError({ code, phase, message: FIXED_MESSAGE });
      expect(err.name).toBe("AuthStrategyError");
    },
  );

  it.each(CODE_PHASE_PAIRS)(
    "carries the exact message for %s",
    (code, phase) => {
      const msg = `message for ${code}`;
      const err = new AuthStrategyError({ code, phase, message: msg });
      expect(err.message).toBe(msg);
    },
  );

  it("accepts 'attach' phase (covers the fourth AuthPhase member)", () => {
    const err = new AuthStrategyError({
      code: "AUTH_HEADER_TEMPLATE_INVALID",
      phase: "attach",
      message: "header templating failed at apply time",
    });
    const phase: AuthPhase = err.phase;
    expect(phase).toBe("attach");
  });

  it("AuthStrategyErrorInit accepts all four fields at compile time", () => {
    const init: AuthStrategyErrorInit = {
      code: "AUTH_TOKEN_FETCH_FAILED",
      phase: "fetch",
      message: "token endpoint unreachable",
      cause: new Error("network error"),
    };
    expect(init.code).toBe("AUTH_TOKEN_FETCH_FAILED");
    expect(init.phase).toBe("fetch");
    expect(init.message).toBe("token endpoint unreachable");
    expect(init.cause).toBeInstanceOf(Error);
  });

  it("CODE_PHASE_PAIRS covers all eight distinct D10 codes", () => {
    const codes = CODE_PHASE_PAIRS.map(([c]) => c);
    expect(codes).toHaveLength(8);
    expect(new Set<AuthErrorCode>(codes).size).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// 9.2 Frozen const — AUTH_ERROR_CODES
// ---------------------------------------------------------------------------

describe("AUTH_ERROR_CODES — frozen const", () => {
  it("is frozen (Object.isFrozen returns true)", () => {
    expect(Object.isFrozen(AUTH_ERROR_CODES)).toBe(true);
  });

  it("contains exactly eight keys", () => {
    expect(Object.keys(AUTH_ERROR_CODES)).toHaveLength(8);
  });

  it("contains the eight D10 codes as own keys in alphabetical order", () => {
    expect(Object.keys(AUTH_ERROR_CODES).sort()).toEqual([
      "AUTH_CONFIG_INVALID",
      "AUTH_EXPIRES_IN_INVALID",
      "AUTH_HEADER_TEMPLATE_INVALID",
      "AUTH_STRATEGY_UNKNOWN",
      "AUTH_TOKEN_FETCH_FAILED",
      "AUTH_TOKEN_FETCH_NON_2XX",
      "AUTH_TOKEN_NOT_FOUND",
      "AUTH_TOKEN_NOT_STRING",
    ]);
  });

  it("has key === value for AUTH_CONFIG_INVALID", () => {
    expect(AUTH_ERROR_CODES.AUTH_CONFIG_INVALID).toBe("AUTH_CONFIG_INVALID");
  });

  it("has key === value for AUTH_EXPIRES_IN_INVALID", () => {
    expect(AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID).toBe("AUTH_EXPIRES_IN_INVALID");
  });

  it("has key === value for AUTH_HEADER_TEMPLATE_INVALID", () => {
    expect(AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID).toBe(
      "AUTH_HEADER_TEMPLATE_INVALID",
    );
  });

  it("has key === value for AUTH_STRATEGY_UNKNOWN", () => {
    expect(AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN).toBe("AUTH_STRATEGY_UNKNOWN");
  });

  it("has key === value for AUTH_TOKEN_FETCH_FAILED", () => {
    expect(AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED).toBe("AUTH_TOKEN_FETCH_FAILED");
  });

  it("has key === value for AUTH_TOKEN_FETCH_NON_2XX", () => {
    expect(AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX).toBe("AUTH_TOKEN_FETCH_NON_2XX");
  });

  it("has key === value for AUTH_TOKEN_NOT_FOUND", () => {
    expect(AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND).toBe("AUTH_TOKEN_NOT_FOUND");
  });

  it("has key === value for AUTH_TOKEN_NOT_STRING", () => {
    expect(AUTH_ERROR_CODES.AUTH_TOKEN_NOT_STRING).toBe("AUTH_TOKEN_NOT_STRING");
  });

  it("all eight code values are mutually distinct strings", () => {
    expect(new Set<string>(Object.values(AUTH_ERROR_CODES)).size).toBe(8);
  });

  it("does not mutate when an assignment is attempted on the frozen object", () => {
    // ESM strict mode causes a write to a frozen object to throw TypeError.
    // Non-strict mode silently ignores it. Either way the value must be unchanged.
    try {
      (AUTH_ERROR_CODES as Record<string, string>)["AUTH_CONFIG_INVALID"] = "MUTATED";
    } catch {
      // Expected in strict mode — TypeError: Cannot assign to read only property
    }
    expect(AUTH_ERROR_CODES.AUTH_CONFIG_INVALID).toBe("AUTH_CONFIG_INVALID");
    expect(Object.keys(AUTH_ERROR_CODES)).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// 9.3 Type guard — isAuthStrategyError
// ---------------------------------------------------------------------------

describe("isAuthStrategyError — type guard", () => {
  it("returns true for an AuthStrategyError instance", () => {
    const err = new AuthStrategyError({
      code: "AUTH_CONFIG_INVALID",
      phase: "config",
      message: "x",
    });
    expect(isAuthStrategyError(err)).toBe(true);
  });

  it("returns false for a plain Error (not an AuthStrategyError)", () => {
    expect(isAuthStrategyError(new Error("plain"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAuthStrategyError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAuthStrategyError(undefined)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isAuthStrategyError("AUTH_CONFIG_INVALID")).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isAuthStrategyError(42)).toBe(false);
  });

  it("returns false for a TypeError (different Error subclass)", () => {
    expect(isAuthStrategyError(new TypeError("type mismatch"))).toBe(false);
  });

  it("returns false for a duck-typed POJO with matching fields (security property)", () => {
    // A structural lookalike MUST fail — the guard is instanceof, not duck-typed.
    // Design §7: callers cannot fabricate a fake AuthStrategyError by object literal.
    const lookalike = {
      code: "AUTH_CONFIG_INVALID" as AuthErrorCode,
      phase: "config" as AuthPhase,
      message: "x",
      name: "AuthStrategyError",
    };
    expect(isAuthStrategyError(lookalike)).toBe(false);
  });

  it("narrows the type to AuthStrategyError inside the true branch", () => {
    const value: unknown = new AuthStrategyError({
      code: "AUTH_TOKEN_FETCH_NON_2XX",
      phase: "fetch",
      message: "token endpoint returned 401",
    });

    if (isAuthStrategyError(value)) {
      // TypeScript narrows value to AuthStrategyError here; accessing typed
      // fields without a cast proves the narrowing compiles correctly.
      const code: AuthErrorCode = value.code;
      const phase: AuthPhase = value.phase;
      expect(code).toBe("AUTH_TOKEN_FETCH_NON_2XX");
      expect(phase).toBe("fetch");
    } else {
      expect.fail("isAuthStrategyError should have returned true");
    }
  });
});

// ---------------------------------------------------------------------------
// 9.4 Secret-safety contract pin
// ---------------------------------------------------------------------------

describe("AuthStrategyError — secret-safety contract", () => {
  it("a legal message (HTTP status + strategy name) has no credential markers on any public field", () => {
    const legalMessage = "got 401 from sso.example.com";
    const err = new AuthStrategyError({
      code: "AUTH_TOKEN_FETCH_NON_2XX",
      phase: "fetch",
      message: legalMessage,
    });

    // None of the public fields should contain typical credential markers.
    for (const field of [err.message, err.code, err.phase, err.name]) {
      expect(field).not.toContain("Bearer ");
      expect(field).not.toContain("access_token");
      expect(field).not.toContain("password");
    }
    expect(err.message).toBe(legalMessage);
  });

  it("passes a marker-secret-value through to .message unchanged (class is opaque)", () => {
    // The test-side caller intentionally violates the secret-safety contract to
    // confirm the class performs NO sanitization or redaction. Design §6 pins the
    // decision: "defense in depth, not reliance on transformation" — init.message
    // is stored verbatim.
    const markerSecret = "MARKER_SECRET_VALUE_xyz";
    const err = new AuthStrategyError({
      code: "AUTH_TOKEN_FETCH_FAILED",
      phase: "fetch",
      message: markerSecret,
    });
    expect(err.message).toBe(markerSecret);
  });

  it("code and phase are fixed D10 literals — never contain free-form caller content", () => {
    const err = new AuthStrategyError({
      code: "AUTH_TOKEN_NOT_FOUND",
      phase: "extract",
      message: "$.access_token path missing from token response",
    });
    expect(err.code).toBe("AUTH_TOKEN_NOT_FOUND");
    expect(err.phase).toBe("extract");
    expect(err.name).toBe("AuthStrategyError");
    expect(err.code).not.toContain("$.");
    expect(err.phase).not.toContain("$.");
  });
});

// ---------------------------------------------------------------------------
// 9.5 Cause chain preservation
// ---------------------------------------------------------------------------

describe("AuthStrategyError — cause chain", () => {
  it("attaches an Error cause via native Error.cause when provided", () => {
    const upstream = new Error("upstream fetch error");
    const err = new AuthStrategyError({
      code: "AUTH_TOKEN_FETCH_FAILED",
      phase: "fetch",
      message: "token endpoint unreachable",
      cause: upstream,
    });
    expect(err.cause).toBeInstanceOf(Error);
    expect((err.cause as Error).message).toBe("upstream fetch error");
  });

  it("cause is a reference to the exact same object passed in (no wrapping)", () => {
    const upstream = new Error("upstream");
    const err = new AuthStrategyError({
      code: "AUTH_TOKEN_FETCH_FAILED",
      phase: "fetch",
      message: "failed",
      cause: upstream,
    });
    expect(err.cause).toBe(upstream);
  });

  it("accepts a non-Error object cause (unknown shape per ECMAScript 2022)", () => {
    const nonErrorCause = { vendorCode: 42, detail: "raw driver object" };
    const err = new AuthStrategyError({
      code: "AUTH_TOKEN_NOT_STRING",
      phase: "extract",
      message: "token value is not a string",
      cause: nonErrorCause,
    });
    expect(err.cause).toEqual({ vendorCode: 42, detail: "raw driver object" });
  });

  it("cause is undefined when omitted from the init object", () => {
    const err = new AuthStrategyError({
      code: "AUTH_STRATEGY_UNKNOWN",
      phase: "config",
      message: "unrecognised strategy name",
    });
    expect(err.cause).toBeUndefined();
  });

  it("accepts null as cause (pathological driver shapes; cause?: unknown)", () => {
    const err = new AuthStrategyError({
      code: "AUTH_TOKEN_FETCH_FAILED",
      phase: "fetch",
      message: "driver threw null",
      cause: null,
    });
    expect(err.cause).toBeNull();
  });

  it("accepts a plain string as cause", () => {
    const err = new AuthStrategyError({
      code: "AUTH_CONFIG_INVALID",
      phase: "config",
      message: "config parse error",
      cause: "raw string thrown by config parser",
    });
    expect(err.cause).toBe("raw string thrown by config parser");
  });
});
