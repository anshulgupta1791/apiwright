import { describe, it, expect } from "vitest";

import { resolveRefs } from "../../../../src/db/templating/template-resolver.js";
import type {
  Ref,
  ResolveResult,
  ResolutionContext,
} from "../../../../src/db/templating/types.js";

/**
 * Unit tests for resolveRefs (src/db/templating/template-resolver.ts).
 *
 * Covers: env namespace resolution (nested, explicit-null leaf); request.body /
 * response.body resolution via classifyPath + shared core path-walk; array index
 * via classifyPath; explicit null found (not UNRESOLVED_REF); missing context
 * half; descent-through-null mid-path; over-depth path; multiple unresolved
 * aggregated; empty refs → ok:true,values:[]; ordered alignment; de-duplicated
 * ref resolved once; determinism; never-throws; malformed context.
 *
 * RED PHASE: src/db/templating/template-resolver.ts does not exist yet.
 * These tests fail with module-not-found until implementation-engineer creates it.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRef(
  index: number,
  namespace: Ref["namespace"],
  path: string,
  raw?: string,
): Ref {
  return {
    index,
    namespace,
    path,
    raw: raw ?? `\${${namespace}.${path}}`,
  };
}

function isOk(r: ResolveResult): r is { ok: true; values: readonly { index: number; value: unknown }[] } {
  return r.ok === true;
}

function isFail(r: ResolveResult): r is { ok: false; rejections: readonly unknown[] } {
  return r.ok === false;
}

function makeCtx(overrides: Partial<ResolutionContext> = {}): ResolutionContext {
  return {
    env: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Empty refs → ok:true, values:[]
// ---------------------------------------------------------------------------

describe("resolveRefs — empty refs array", () => {
  it("returns ok:true for an empty refs array", () => {
    expect(resolveRefs([], makeCtx()).ok).toBe(true);
  });

  it("returns an empty values array for empty refs", () => {
    const r = resolveRefs([], makeCtx());
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// env namespace resolution
// ---------------------------------------------------------------------------

describe("resolveRefs — env namespace", () => {
  it("resolves ${env.db_host} to the value in context.env", () => {
    const refs = [makeRef(0, "env", "db_host")];
    const ctx = makeCtx({ env: { db_host: "localhost" } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values[0]?.value).toBe("localhost");
  });

  it("resolves a nested env path env.db.host to the correct nested value", () => {
    const refs = [makeRef(0, "env", "db.host")];
    const ctx = makeCtx({ env: { db: { host: "db.example.com" } } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values[0]?.value).toBe("db.example.com");
  });

  it("resolves an explicit null leaf in env to BoundValue.value === null (not UNRESOLVED_REF)", () => {
    const refs = [makeRef(0, "env", "nullable_key")];
    const ctx = makeCtx({ env: { nullable_key: null } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values[0]?.value).toBeNull();
  });

  it("returns UNRESOLVED_REF for an env path that does not exist in context.env", () => {
    const refs = [makeRef(0, "env", "missing_key")];
    const ctx = makeCtx({ env: {} });
    const r = resolveRefs(refs, ctx);
    expect(r.ok).toBe(false);
    if (!isFail(r)) throw new Error("expected ok:false");
    const rej = r.rejections[0] as { code: string };
    expect(rej.code).toBe("UNRESOLVED_REF");
  });

  it("returns UNRESOLVED_REF for an env path that hits a non-object mid-path", () => {
    const refs = [makeRef(0, "env", "scalar.deeper")];
    const ctx = makeCtx({ env: { scalar: "not-an-object" } });
    const r = resolveRefs(refs, ctx);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// request.body namespace
// ---------------------------------------------------------------------------

describe("resolveRefs — request.body namespace", () => {
  it("resolves ${request.body.userId} to the body value", () => {
    const refs = [makeRef(0, "request.body", "userId")];
    const ctx = makeCtx({ requestBody: { userId: 42 } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values[0]?.value).toBe(42);
  });

  it("resolves a nested body path via classifyPath segments", () => {
    const refs = [makeRef(0, "request.body", "data.name")];
    const ctx = makeCtx({ requestBody: { data: { name: "alice" } } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values[0]?.value).toBe("alice");
  });

  it("resolves an array index via classifyPath (digit segment → index)", () => {
    const refs = [makeRef(0, "request.body", "items.0.id")];
    const ctx = makeCtx({ requestBody: { items: [{ id: 99 }] } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values[0]?.value).toBe(99);
  });

  it("resolves explicit null leaf in request body to BoundValue.value === null", () => {
    const refs = [makeRef(0, "request.body", "maybe")];
    const ctx = makeCtx({ requestBody: { maybe: null } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values[0]?.value).toBeNull();
  });

  it("returns UNRESOLVED_REF when requestBody is absent (context half missing)", () => {
    const refs = [makeRef(0, "request.body", "userId")];
    const ctx = makeCtx({ requestBody: undefined });
    const r = resolveRefs(refs, ctx);
    expect(r.ok).toBe(false);
    if (!isFail(r)) throw new Error("expected ok:false");
    const rej = r.rejections[0] as { code: string };
    expect(rej.code).toBe("UNRESOLVED_REF");
  });

  it("returns UNRESOLVED_REF for a path not present in requestBody", () => {
    const refs = [makeRef(0, "request.body", "missing_field")];
    const ctx = makeCtx({ requestBody: { other: 1 } });
    const r = resolveRefs(refs, ctx);
    expect(r.ok).toBe(false);
  });

  it("returns UNRESOLVED_REF for descent-through-null mid-path", () => {
    const refs = [makeRef(0, "request.body", "parent.child")];
    const ctx = makeCtx({ requestBody: { parent: null } });
    const r = resolveRefs(refs, ctx);
    expect(r.ok).toBe(false);
    if (!isFail(r)) throw new Error("expected ok:false");
    const rej = r.rejections[0] as { code: string };
    expect(rej.code).toBe("UNRESOLVED_REF");
  });

  it("returns UNRESOLVED_REF for an out-of-bounds array index", () => {
    const refs = [makeRef(0, "request.body", "items.99")];
    const ctx = makeCtx({ requestBody: { items: [{ id: 1 }] } });
    const r = resolveRefs(refs, ctx);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// response.body namespace
// ---------------------------------------------------------------------------

describe("resolveRefs — response.body namespace", () => {
  it("resolves ${response.body.id} to the body value", () => {
    const refs = [makeRef(0, "response.body", "id")];
    const ctx = makeCtx({ responseBody: { id: "abc-123" } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values[0]?.value).toBe("abc-123");
  });

  it("resolves explicit null leaf in response body to BoundValue.value === null", () => {
    const refs = [makeRef(0, "response.body", "maybe")];
    const ctx = makeCtx({ responseBody: { maybe: null } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values[0]?.value).toBeNull();
  });

  it("returns UNRESOLVED_REF when responseBody is absent", () => {
    const refs = [makeRef(0, "response.body", "id")];
    const ctx = makeCtx({ responseBody: undefined });
    const r = resolveRefs(refs, ctx);
    expect(r.ok).toBe(false);
    if (!isFail(r)) throw new Error("expected ok:false");
    const rej = r.rejections[0] as { code: string };
    expect(rej.code).toBe("UNRESOLVED_REF");
  });
});

// ---------------------------------------------------------------------------
// Multiple unresolved → aggregated rejections
// ---------------------------------------------------------------------------

describe("resolveRefs — multiple unresolved refs (aggregation)", () => {
  it("aggregates all UNRESOLVED_REF rejections in a single result", () => {
    const refs = [
      makeRef(0, "env", "missing_a"),
      makeRef(1, "request.body", "missing_b"),
    ];
    const ctx = makeCtx({ env: {}, requestBody: {} });
    const r = resolveRefs(refs, ctx);
    expect(r.ok).toBe(false);
    if (!isFail(r)) throw new Error("expected ok:false");
    expect(r.rejections.length).toBeGreaterThanOrEqual(2);
  });

  it("rejection includes the raw token ref field for each unresolved ref", () => {
    const refs = [makeRef(0, "env", "gone", "${env.gone}")];
    const ctx = makeCtx({ env: {} });
    const r = resolveRefs(refs, ctx);
    if (!isFail(r)) throw new Error("expected ok:false");
    const rej = r.rejections[0] as { ref: string };
    expect(rej.ref).toBe("${env.gone}");
  });
});

// ---------------------------------------------------------------------------
// Ordered alignment (values[i].index === refs[i].index)
// ---------------------------------------------------------------------------

describe("resolveRefs — ordered alignment", () => {
  it("values are index-aligned to the refs array (values[i].index === refs[i].index)", () => {
    const refs = [
      makeRef(0, "env", "a"),
      makeRef(1, "env", "b"),
    ];
    const ctx = makeCtx({ env: { a: "val_a", b: "val_b" } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values[0]?.index).toBe(0);
    expect(r.values[1]?.index).toBe(1);
    expect(r.values[0]?.value).toBe("val_a");
    expect(r.values[1]?.value).toBe("val_b");
  });

  it("a de-duplicated ref (one Ref, multiple occurrences) resolves once — values has one entry", () => {
    // The extractRefs step de-dups; resolveRefs only receives the unique Refs list.
    const refs = [makeRef(0, "env", "shared_key")];
    const ctx = makeCtx({ env: { shared_key: "shared_value" } });
    const r = resolveRefs(refs, ctx);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.values).toHaveLength(1);
    expect(r.values[0]?.value).toBe("shared_value");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("resolveRefs — determinism", () => {
  it("two calls with identical inputs produce deep-equal results", () => {
    const refs = [makeRef(0, "env", "host")];
    const ctx = makeCtx({ env: { host: "localhost" } });
    const r1 = resolveRefs(refs, ctx);
    const r2 = resolveRefs(refs, ctx);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

// ---------------------------------------------------------------------------
// Never throws
// ---------------------------------------------------------------------------

describe("resolveRefs — never throws (total function)", () => {
  it("does not throw for any well-typed input combination", () => {
    expect(() => resolveRefs([], makeCtx())).not.toThrow();
    expect(() =>
      resolveRefs([makeRef(0, "env", "x")], makeCtx({ env: {} })),
    ).not.toThrow();
    expect(() =>
      resolveRefs([makeRef(0, "request.body", "x")], makeCtx({ requestBody: null })),
    ).not.toThrow();
  });

  it("does not throw for a malformed context (null env)", () => {
    // The function is total; even adversarial inputs return a result
    const refs = [makeRef(0, "env", "x")];
    const ctx = { env: null } as unknown as ResolutionContext;
    expect(() => resolveRefs(refs, ctx)).not.toThrow();
    const r = resolveRefs(refs, ctx);
    // Null env can never resolve `${env.x}` → UNRESOLVED_REF; total/no-throw + ok:false
    expect(r.ok).toBe(false);
  });

  it("deeply nested path missing a mid-segment → UNRESOLVED_REF (total, no throw)", () => {
    const deepPath = "a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z";
    const refs = [makeRef(0, "request.body", deepPath)];
    const ctx = makeCtx({ requestBody: { a: { b: {} } } });
    expect(() => resolveRefs(refs, ctx)).not.toThrow();
    const r = resolveRefs(refs, ctx);
    // Walk hits a missing key at `.c` (b is {}) → not-found → UNRESOLVED_REF
    expect(r.ok).toBe(false);
  });
});
