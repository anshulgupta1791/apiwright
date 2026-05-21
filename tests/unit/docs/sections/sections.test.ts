import { describe, it, expect } from "vitest";

import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import { renderAuthentication } from "../../../../src/docs/sections/authentication.js";
import { renderDbEffects } from "../../../../src/docs/sections/db-effects.js";
import { renderHeader } from "../../../../src/docs/sections/header.js";
import { renderMarkers } from "../../../../src/docs/sections/markers.js";
import { renderRequest } from "../../../../src/docs/sections/request.js";
import { renderResponse } from "../../../../src/docs/sections/response.js";
import { renderTestCoverage } from "../../../../src/docs/sections/test-coverage.js";

function makeEndpoint(overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id: "users.create",
    name: "Create user",
    method: "POST",
    url: "/v1/users",
    request: { body_schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } },
    response: { expected_status: 201, schema: { type: "object", properties: { id: { type: "string" } } } },
    ...overrides,
  };
}

const ctx = (ep: CanonicalEndpoint) => ({ endpoint: ep, sourcePath: "tests/x.endpoint.json" });

describe("renderHeader", () => {
  it("emits name, id, method, url, source path, env placeholder", () => {
    const out = renderHeader(ctx(makeEndpoint()));
    expect(out).toContain("# Create user");
    expect(out).toContain("**ID:** `users.create`");
    expect(out).toContain("**Method:** `POST`");
    expect(out).toContain("**URL:** `/v1/users`");
    expect(out).toContain("**Source file:** `tests/x.endpoint.json`");
    expect(out).toContain("Environments tested");
  });
});

describe("renderAuthentication", () => {
  it("emits anonymous notice when no auth_strategy", () => {
    const out = renderAuthentication(ctx(makeEndpoint()));
    expect(out).toContain("Anonymous");
  });

  it("emits strategy name + env lookup hint when auth_strategy declared", () => {
    const out = renderAuthentication(ctx(makeEndpoint({ auth_strategy: "user_token" })));
    expect(out).toContain("`user_token`");
    expect(out).toContain("environment YAML");
  });
});

describe("renderRequest", () => {
  it("emits headers table when headers declared", () => {
    const out = renderRequest(ctx(makeEndpoint({
      request: { headers: { "Content-Type": "application/json" } },
    })));
    expect(out).toContain("### Headers");
    expect(out).toContain("`Content-Type`");
    expect(out).toContain("`application/json`");
  });

  it("renders body schema as a table", () => {
    const out = renderRequest(ctx(makeEndpoint()));
    expect(out).toContain("### Body schema");
    expect(out).toContain("`email`");
  });

  it("emits example payload when body_example present", () => {
    const out = renderRequest(ctx(makeEndpoint({
      request: { body_example: { email: "a@b.c" } },
    })));
    expect(out).toContain("### Example payload");
    expect(out).toContain('"email": "a@b.c"');
  });

  it("emits placeholder when no example", () => {
    const out = renderRequest(ctx(makeEndpoint({ request: {} })));
    expect(out).toContain("_(no example declared)_");
  });

  it("sorts header keys alphabetically (deterministic)", () => {
    const out = renderRequest(ctx(makeEndpoint({
      request: { headers: { "x-a": "1", "a-x": "2" } },
    })));
    expect(out.indexOf("`a-x`")).toBeLessThan(out.indexOf("`x-a`"));
  });
});

describe("renderResponse", () => {
  it("emits expected_status + body schema", () => {
    const out = renderResponse(ctx(makeEndpoint()));
    expect(out).toContain("**Expected status:** `201`");
    expect(out).toContain("### Body schema");
  });

  it("emits SLA when sla_ms set", () => {
    const out = renderResponse(ctx(makeEndpoint({
      response: { expected_status: 200, schema: {}, sla_ms: 500 },
    })));
    expect(out).toContain("**SLA:** 500 ms");
  });

  it("emits expected headers table when declared", () => {
    const out = renderResponse(ctx(makeEndpoint({
      response: {
        expected_status: 200, schema: {},
        headers: { "Cache-Control": "no-store" },
      },
    })));
    expect(out).toContain("Expected response headers");
    expect(out).toContain("`Cache-Control`");
  });
});

describe("renderDbEffects", () => {
  it("emits 'none declared' when no db_verify and no cleanup", () => {
    const out = renderDbEffects(ctx(makeEndpoint()));
    expect(out).toContain("_(none declared)_");
  });

  it("emits one block per verification with query block", () => {
    const out = renderDbEffects(ctx(makeEndpoint({
      db_verify: [
        { connection: "primary_postgres", query: "SELECT 1", expect: "exists", query_id: "q1" },
      ],
    })));
    expect(out).toContain("Verification #1");
    expect(out).toContain("`primary_postgres.q1`");
    expect(out).toContain("```sql");
    expect(out).toContain("SELECT 1");
  });

  it("synthesizes (q1) when query_id absent", () => {
    const out = renderDbEffects(ctx(makeEndpoint({
      db_verify: [{ connection: "x", query: "SELECT 2", expect: "exists" }],
    })));
    expect(out).toContain("(q1)");
  });

  it("emits expected-fields list (sorted) when declared", () => {
    const out = renderDbEffects(ctx(makeEndpoint({
      db_verify: [{
        connection: "x", query: "SELECT *", expect: "match",
        fields: { z: 1, a: 2 },
      }],
    })));
    expect(out.indexOf("`a`")).toBeLessThan(out.indexOf("`z`"));
  });

  it("emits cleanup block when declared", () => {
    const out = renderDbEffects(ctx(makeEndpoint({
      cleanup: { connection: "x", query: "DELETE FROM t" },
    })));
    expect(out).toContain("### Cleanup");
    expect(out).toContain("DELETE FROM t");
  });
});

describe("renderTestCoverage", () => {
  it("always emits 5 universal tests + auth_happy_path", () => {
    const out = renderTestCoverage(ctx(makeEndpoint()));
    expect(out).toContain("status_code_conformance");
    expect(out).toContain("content_type_alignment");
    expect(out).toContain("response_time_sla");
    expect(out).toContain("response_schema_validation");
    expect(out).toContain("auth_happy_path");
  });

  it("emits get_idempotency for GET", () => {
    const out = renderTestCoverage(ctx(makeEndpoint({ method: "GET" })));
    expect(out).toContain("get_idempotency");
  });

  it("emits delete_idempotency for DELETE", () => {
    const out = renderTestCoverage(ctx(makeEndpoint({ method: "DELETE" })));
    expect(out).toContain("delete_idempotency");
  });

  it("emits auth-negative trio only when auth_strategy declared", () => {
    const without = renderTestCoverage(ctx(makeEndpoint()));
    expect(without).not.toContain("no_auth_returns_401");
    const withAuth = renderTestCoverage(ctx(makeEndpoint({ auth_strategy: "x" })));
    expect(withAuth).toContain("no_auth_returns_401");
    expect(withAuth).toContain("garbage_token_returns_401");
    expect(withAuth).toContain("method_not_allowed");
  });

  it("emits body-negative quartet for body-carrying method WITH schema", () => {
    const out = renderTestCoverage(ctx(makeEndpoint({
      method: "POST",
      request: { body_schema: { type: "object" } },
    })));
    expect(out).toContain("malformed_json_returns_400");
    expect(out).toContain("required_field_omission_returns_400");
    expect(out).toContain("type_violation_returns_400");
    expect(out).toContain("boundary_battery");
  });

  it("does NOT emit body-negative tests when GET (no body)", () => {
    const out = renderTestCoverage(ctx(makeEndpoint({ method: "GET", request: { body_schema: { type: "object" } } })));
    expect(out).not.toContain("malformed_json_returns_400");
  });

  it("does NOT emit body-negative tests when POST without schema", () => {
    const out = renderTestCoverage(ctx(makeEndpoint({ method: "POST", request: {} })));
    expect(out).not.toContain("malformed_json_returns_400");
  });

  it("emits db_state_matches_expectation when db_verify declared", () => {
    const out = renderTestCoverage(ctx(makeEndpoint({
      db_verify: [{ connection: "x", query: "Q", expect: "exists" }],
    })));
    expect(out).toContain("db_state_matches_expectation");
  });

  it("emits declared assertions verbatim", () => {
    const out = renderTestCoverage(ctx(makeEndpoint({
      assertions: ["response.status equals 201", "response.body.id is_uuid_v4"],
    })));
    expect(out).toContain("`response.status equals 201`");
    expect(out).toContain("`response.body.id is_uuid_v4`");
  });

  it("emits '(none declared)' when no assertions", () => {
    const out = renderTestCoverage(ctx(makeEndpoint()));
    expect(out).toContain("_(none declared)_");
  });

  it("output is deterministic across two runs", () => {
    const ep = makeEndpoint({ auth_strategy: "x", db_verify: [{ connection: "c", query: "Q", expect: "exists" }] });
    expect(renderTestCoverage(ctx(ep))).toBe(renderTestCoverage(ctx(ep)));
  });
});

describe("renderMarkers", () => {
  it("emits 'no explicit declaration' when markers absent", () => {
    const out = renderMarkers(ctx(makeEndpoint()));
    expect(out).toContain("no explicit declaration");
  });

  it("lists declared markers sorted", () => {
    const out = renderMarkers(ctx(makeEndpoint({ markers: ["regression", "smoke"] })));
    expect(out.indexOf("`regression`")).toBeLessThan(out.indexOf("`smoke`"));
  });

  it("lists tags sorted when present", () => {
    const out = renderMarkers(ctx(makeEndpoint({
      markers: ["smoke"], tags: ["z-billing", "a-critical"],
    })));
    expect(out.indexOf("`a-critical`")).toBeLessThan(out.indexOf("`z-billing`"));
  });

  it("notes prod_safe: true when set", () => {
    const out = renderMarkers(ctx(makeEndpoint({ markers: ["smoke"], prod_safe: true })));
    expect(out).toContain("`prod_safe: true`");
  });
});
