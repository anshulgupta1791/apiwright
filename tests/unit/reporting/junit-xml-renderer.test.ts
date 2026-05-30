import { describe, it, expect } from "vitest";

import { renderJUnitXml } from "../../../src/reporting/index.js";
import type { RunResult } from "../../../src/reporting/index.js";

const EMPTY_RESULT: RunResult = {
  started_at: "2026-05-21T00:00:00Z",
  ended_at: "2026-05-21T00:01:00Z",
  env: "test",
  filters: {},
  shard: null,
  workers: 1,
  endpoints: [],
  summary: { endpoints_planned: 0, passed: 0, failed: 0, flaky: 0, duration_ms: 60000 },
};

const PASS_RESULT: RunResult = {
  ...EMPTY_RESULT,
  endpoints: [
    {
      endpoint_id: "users.get",
      status: "pass",
      flaky: false,
      attempts: [
        {
          case_id: "test.case", kind: "status_code_conformance", attempt: 1, verdict: "pass",
          started_at: 0,
          ended_at: 100,
          assertions: [],
          db_verify: [],
        },
      ],
    },
  ],
  summary: { endpoints_planned: 1, passed: 1, failed: 0, flaky: 0, duration_ms: 100 },
};

const FAIL_RESULT: RunResult = {
  ...EMPTY_RESULT,
  endpoints: [
    {
      endpoint_id: "x.fail",
      status: "fail",
      flaky: false,
      attempts: [
        {
          case_id: "test.case", kind: "status_code_conformance", attempt: 1, verdict: "fail",
          started_at: 0,
          ended_at: 50,
          assertions: [],
          db_verify: [],
          failure_reason: "expected 200 got 500",
        },
      ],
    },
  ],
  summary: { endpoints_planned: 1, passed: 0, failed: 1, flaky: 0, duration_ms: 50 },
};

const FLAKY_RESULT: RunResult = {
  ...EMPTY_RESULT,
  endpoints: [
    {
      endpoint_id: "flaky.one",
      status: "flaky",
      flaky: true,
      attempts: [
        { case_id: "test.case", kind: "status_code_conformance", attempt: 1, verdict: "fail", started_at: 0, ended_at: 10, assertions: [], db_verify: [] },
        { case_id: "test.case", kind: "status_code_conformance", attempt: 2, verdict: "pass", started_at: 20, ended_at: 30, assertions: [], db_verify: [] },
      ],
    },
  ],
  summary: { endpoints_planned: 1, passed: 0, failed: 0, flaky: 1, duration_ms: 30 },
};

describe("renderJUnitXml", () => {
  it("emits a valid XML declaration + root testsuites", () => {
    const xml = renderJUnitXml(EMPTY_RESULT);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<testsuites name="apiwright"');
    expect(xml).toContain("</testsuites>");
  });

  it("emits one testsuite per endpoint with passing testcase", () => {
    const xml = renderJUnitXml(PASS_RESULT);
    expect(xml).toContain('<testsuite name="users.get"');
    expect(xml).toContain("<testcase ");
    expect(xml).not.toContain("<failure ");
  });

  it("emits <failure> for fail status", () => {
    const xml = renderJUnitXml(FAIL_RESULT);
    expect(xml).toContain("<failure ");
    expect(xml).toContain("expected 200 got 500");
  });

  it("emits <system-out> retry note for flaky endpoint last attempt", () => {
    const xml = renderJUnitXml(FLAKY_RESULT);
    expect(xml).toContain("<system-out>Flaky:");
    expect(xml).toContain("attempt 2 after 1 retry(ies)");
  });

  it("escapes XML-significant characters in dynamic values", () => {
    const r: RunResult = {
      ...EMPTY_RESULT,
      env: '<inj>&"\'',
      endpoints: [
        {
          endpoint_id: "x&y",
          status: "fail",
          flaky: false,
          attempts: [{
            case_id: "test.case", kind: "status_code_conformance", attempt: 1, verdict: "fail", started_at: 0, ended_at: 1,
            assertions: [], db_verify: [], failure_reason: "<bad>",
          }],
        },
      ],
    };
    const xml = renderJUnitXml(r);
    expect(xml).not.toContain('<inj>');
    expect(xml).not.toContain('<bad>');
    expect(xml).toContain("&lt;bad&gt;");
    expect(xml).toContain("x&amp;y");
  });

  it("renders a passing testcase with no system-out (non-flaky)", () => {
    const xml = renderJUnitXml(PASS_RESULT);
    expect(xml).not.toContain("<system-out>");
  });

  it("counts failures correctly in suite header", () => {
    const xml = renderJUnitXml(FAIL_RESULT);
    expect(xml).toContain('failures="1"');
  });

  describe("issue #63: per-case kind + case_id in JUnit output", () => {
    it("classname includes the §3 test kind so CI tooling can group by it", () => {
      const xml = renderJUnitXml(PASS_RESULT);
      // Per JUnit convention, classname is the "package" — we use
      // `<endpoint_id>.<kind>` so Allure / Jenkins / GitHub check-runs
      // can group tests by which §3 catalog kind they belong to.
      expect(xml).toMatch(/classname="[^"]+\.status_code_conformance"/);
    });

    it("testcase name carries the case_id so a user can see which generated case it was", () => {
      const xml = renderJUnitXml(PASS_RESULT);
      expect(xml).toMatch(/name="test\.case\/attempt-1"/);
    });

    it("regression guard: kind survives in the XML for failing testcases too", () => {
      const xml = renderJUnitXml(FAIL_RESULT);
      // Even on failure, the user must see WHICH kind failed (was it
      // get_idempotency? auth_happy_path? without this they only see
      // `<failure>...</failure>` with no test-type context).
      expect(xml).toMatch(/classname="[^"]+\.status_code_conformance"/);
    });
  });
});
