/**
 * Integration regression guard — Lens 0 blocker B10.
 *
 * The assertion DSL lexer treats `-` as arithmetic. Before this fix, any
 * target path containing a hyphen (the universal shape of HTTP header
 * names — Content-Type, X-Request-ID, Cache-Control, ...) failed at parse
 * time with `Unknown operator '-'`. The pitched 5-minute working-example
 * aborted on first run.
 *
 * The fix introduces bracket-notation segments: `response.headers["X-Y"]`.
 * The tokenizer extends the target token to include `[...]` segments; the
 * target-path parser splits the lexeme on both `.` and `[...]`. This
 * test goes through the FULL assertion engine (lex → parse → evaluate)
 * with a real response body, pinning the contract end-to-end.
 */

import { describe, expect, it } from "vitest";

import { AssertionEngine } from "../../../src/assertions/assertion-engine.js";
import type { EvaluationContext } from "../../../src/assertions/types.js";

const ENGINE = new AssertionEngine();

function evalOne(
  assertion: string,
  ctx: EvaluationContext,
): { pass: boolean; reason?: string; parsed: boolean } {
  const { parse, results } = ENGINE.parseAndEvaluate([assertion], ctx);
  // The crucial bit for B10: the assertion must PARSE. Pre-fix it errored
  // at lex time with "Unknown operator '-'".
  const parsed = parse.entries[0]?.result.ok === true;
  if (!parsed) {
    return { pass: false, parsed: false, reason: "parse failed" };
  }
  const result = results[0];
  if (!result) throw new Error("no result");
  return result.pass
    ? { pass: true, parsed: true }
    : { pass: false, parsed: true, reason: result.failureCode ?? result.reason };
}

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    request: { headers: {}, body: undefined, url: { full: "/", path: "/", query: {} } },
    response: {
      status: 200,
      headers: {},
      body: undefined,
      time_ms: 0,
    },
    ...overrides,
  } as EvaluationContext;
}

describe("B10 — bracket-notation target paths end-to-end (lex+parse+evaluate)", () => {
  it('response.headers["X-Request-ID"] exists — PASSES when the header is present', () => {
    const ctx = makeCtx({
      response: {
        status: 200,
        headers: { "X-Request-ID": "abc-123" },
        body: undefined,
        time_ms: 0,
      },
    });
    const r = evalOne('response.headers["X-Request-ID"] exists', ctx);
    expect(r.pass).toBe(true);
  });

  it('response.headers["X-Request-ID"] equals "abc-123" — value match works through brackets', () => {
    const ctx = makeCtx({
      response: {
        status: 200,
        headers: { "X-Request-ID": "abc-123" },
        body: undefined,
        time_ms: 0,
      },
    });
    const r = evalOne('response.headers["X-Request-ID"] equals "abc-123"', ctx);
    expect(r.pass).toBe(true);
  });

  it("Content-Type assertion — the canonical use case from the working example", () => {
    const ctx = makeCtx({
      response: {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: undefined,
        time_ms: 0,
      },
    });
    const r = evalOne(
      'response.headers["Content-Type"] equals "application/json"',
      ctx,
    );
    expect(r.pass).toBe(true);
  });

  it('body field with hyphen: response.body["user-name"] equals "alice"', () => {
    const ctx = makeCtx({
      response: {
        status: 200,
        headers: {},
        body: { "user-name": "alice" },
        time_ms: 0,
      },
    });
    const r = evalOne('response.body["user-name"] equals "alice"', ctx);
    expect(r.pass).toBe(true);
  });

  it("nested bracket access: response.body['items'][0]['name'] equals \"first\"", () => {
    const ctx = makeCtx({
      response: {
        status: 200,
        headers: {},
        body: { items: [{ name: "first" }, { name: "second" }] },
        time_ms: 0,
      },
    });
    const r = evalOne(
      "response.body['items'][0]['name'] equals \"first\"",
      ctx,
    );
    expect(r.pass).toBe(true);
  });

  it("works on request.headers too — assert request shape with hyphenated header", () => {
    const ctx = makeCtx({
      request: {
        headers: { "X-Custom-Header": "sent-value" },
        body: undefined,
        url: { full: "/", path: "/", query: {} },
      },
    });
    const r = evalOne(
      'request.headers["X-Custom-Header"] equals "sent-value"',
      ctx,
    );
    expect(r.pass).toBe(true);
  });

  it("FAILS cleanly when bracketed key is absent (no parse error)", () => {
    const ctx = makeCtx({
      response: {
        status: 200,
        headers: { "X-Other": "x" },
        body: undefined,
        time_ms: 0,
      },
    });
    const r = evalOne('response.headers["X-Request-ID"] exists', ctx);
    expect(r.pass).toBe(false);
    // Crucially, the failure is a runtime "not found", NOT a parse error.
    // Pre-fix, this assertion would have failed at parse time with
    // "Unknown operator '-'" — proving B10 has actually closed.
  });

  it("regression guard: the working-example assertion no longer parse-fails", () => {
    // This is the EXACT assertion from examples/working-example/tests/
    // headers-echo.endpoint.json after the B10 fix. The previous form
    // (without brackets) parsed as `response.body.headers.X` MINUS
    // `Apiwright` MINUS `Hello`, which the lexer reported as "Unknown
    // operator '-'". The bracket form must produce zero parse errors.
    const ctx = makeCtx({
      response: {
        status: 200,
        headers: {},
        body: {
          headers: { "X-Apiwright-Hello": "apiwright-working-example" },
        },
        time_ms: 0,
      },
    });
    const r = evalOne(
      'response.body.headers["X-Apiwright-Hello"] equals "apiwright-working-example"',
      ctx,
    );
    expect(r.pass).toBe(true);
  });

  it("does not break legacy dot syntax: response.body.no_hyphens.field still works", () => {
    const ctx = makeCtx({
      response: {
        status: 200,
        headers: {},
        body: { no_hyphens: { field: "ok" } },
        time_ms: 0,
      },
    });
    const r = evalOne('response.body.no_hyphens.field equals "ok"', ctx);
    expect(r.pass).toBe(true);
  });
});
