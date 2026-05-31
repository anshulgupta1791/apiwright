/**
 * Integration regression guard for issue #C — Postman imports without
 * example responses must NOT produce silent false-positive PASSes on
 * `response_schema_validation`.
 *
 * Before this fix:
 *   - Importer emitted `schema: {}` (matches anything).
 *   - Planner generated a `response_schema_validation` case.
 *   - Runner validated any 2xx body against `{}` → PASS, regardless of
 *     whether the body had anything to do with the endpoint.
 *
 * After this fix (the chain is what we verify here):
 *   - Importer emits `schema: { _pending_review: true }` + warning.
 *   - Planner detects the sentinel (and bare `{}`) as effectively-empty
 *     and SKIPS the `response_schema_validation` case + emits a warning.
 *   - Runner therefore never gets the chance to false-pass.
 *
 * Discovered by the Library Postman walkthrough on 2026-05-31: getbook
 * was hitting `rahulshettyacademy.com`'s marketing homepage (200/HTML)
 * but reporting PASS because the imported `{}` schema matched anything.
 */

import { describe, expect, it } from "vitest";

import { PostmanResponseSeeder } from "../../../src/importers/postman/response-seeder.js";
import { TestPlanGenerator } from "../../../src/test-catalog/index.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { FlattenedRequest } from "../../../src/importers/types.js";

describe("empty-schema skip-with-WARN end-to-end (issue #C)", () => {
  /** Build a flattened request like the Postman parser would. */
  function makeRequest(
    name: string,
    responses: { code: number; body: string }[],
  ): FlattenedRequest {
    return {
      name,
      method: "GET",
      url: { raw: "https://api.example.com/users" },
      header: [],
      body: undefined,
      responses,
    } as unknown as FlattenedRequest;
  }

  it("seeder → planner: no example response produces sentinel + planner SKIPS schema case + emits warning", () => {
    // STEP 1: Seeder emits the sentinel schema.
    const seeder = new PostmanResponseSeeder();
    const seeded = seeder.seed(makeRequest("FetchUsers", []));
    expect(seeded.response.schema).toEqual({ _pending_review: true });
    expect(seeded.warnings.some((w) =>
      w.includes("response_schema_validation will be skipped"),
    )).toBe(true);

    // STEP 2: An endpoint built from the seeded response goes into the planner.
    const endpoint: CanonicalEndpoint = {
      id: "fetch_users",
      name: "FetchUsers",
      method: "GET",
      url: "/users",
      request: {},
      response: seeded.response,
    };
    const plan = new TestPlanGenerator().generate([endpoint]);

    // STEP 3: The planner did NOT generate the response_schema_validation case
    // for this endpoint — that's the silent-failure avenue we closed.
    const schemaCases = plan.cases.filter(
      (c) => c.endpoint_id === "fetch_users" && c.type === "response_schema_validation",
    );
    expect(schemaCases).toHaveLength(0);

    // STEP 4: The planner emitted a warning naming the skip and the reason.
    expect(plan.warnings.some((w) =>
      w.includes("fetch_users") && w.includes("response_schema_validation skipped"),
    )).toBe(true);
  });

  it("seeder → planner: empty-body example also produces the sentinel + skip + warn", () => {
    const seeder = new PostmanResponseSeeder();
    const seeded = seeder.seed(makeRequest("DeleteUser", [{ code: 204, body: "" }]));
    expect(seeded.response.schema).toEqual({ _pending_review: true });

    const endpoint: CanonicalEndpoint = {
      id: "delete_user",
      name: "DeleteUser",
      method: "DELETE",
      url: "/users/1",
      request: {},
      response: seeded.response,
    };
    const plan = new TestPlanGenerator().generate([endpoint]);

    const schemaCases = plan.cases.filter(
      (c) => c.endpoint_id === "delete_user" && c.type === "response_schema_validation",
    );
    expect(schemaCases).toHaveLength(0);
    expect(plan.warnings.some((w) =>
      w.includes("delete_user") && w.includes("response_schema_validation skipped"),
    )).toBe(true);
  });

  it("a real schema (with body) DOES generate the response_schema_validation case (no false skip)", () => {
    // Body present → JsonSchemaInferrer produces a real schema, planner
    // generates the case. This guards against an over-eager skip.
    const seeder = new PostmanResponseSeeder();
    const seeded = seeder.seed(
      makeRequest("CreateUser", [
        { code: 201, body: JSON.stringify({ id: "u1", email: "a@b.c" }) },
      ]),
    );
    expect(seeded.response.schema).not.toEqual({ _pending_review: true });
    expect(Object.keys(seeded.response.schema).length).toBeGreaterThan(0);

    const endpoint: CanonicalEndpoint = {
      id: "create_user",
      name: "CreateUser",
      method: "POST",
      url: "/users",
      request: {},
      response: seeded.response,
    };
    const plan = new TestPlanGenerator().generate([endpoint]);

    const schemaCases = plan.cases.filter(
      (c) => c.endpoint_id === "create_user" && c.type === "response_schema_validation",
    );
    expect(schemaCases.length).toBeGreaterThan(0);
  });
});
