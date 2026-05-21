import { describe, it, expect } from "vitest";

import { SecretRegistry } from "../../../src/env/index.js";
import {
  emitRunReport,
  isReportError,
  type ReportWriterSeam,
} from "../../../src/reporting/index.js";
import type { RunResult } from "../../../src/reporting/index.js";

const SAMPLE: RunResult = {
  started_at: "2026-05-21T00:00:00Z",
  ended_at: "2026-05-21T00:01:00Z",
  env: "test",
  filters: {},
  shard: null,
  workers: 1,
  endpoints: [],
  summary: { endpoints_planned: 0, passed: 0, failed: 0, flaky: 0, duration_ms: 60000 },
};

interface CapturingSeam extends ReportWriterSeam {
  files: { path: string; contents: string }[];
}

function capture(): CapturingSeam {
  const c: CapturingSeam = {
    files: [],
    async mkdir(): Promise<void> {},
    async writeFile(p: string, contents: string): Promise<void> { c.files.push({ path: p, contents }); },
  };
  return c;
}

describe("emitRunReport", () => {
  it("emits all three formats when all targets enabled", async () => {
    const seam = capture();
    const artifacts = await emitRunReport(
      SAMPLE,
      {
        reportsDir: "reports",
        targets: { html: true, json: true, junit_xml: true },
        basename: "run-test",
      },
      new SecretRegistry(),
      seam,
    );
    expect(artifacts.json).toBe("reports/run-test.json");
    expect(artifacts.html).toBe("reports/run-test.html");
    expect(artifacts.junit_xml).toBe("reports/run-test.xml");
    expect(seam.files).toHaveLength(3);
  });

  it("skips formats whose target is false", async () => {
    const seam = capture();
    const artifacts = await emitRunReport(
      SAMPLE,
      {
        reportsDir: "reports",
        targets: { html: false, json: true, junit_xml: false },
        basename: "run-test",
      },
      new SecretRegistry(),
      seam,
    );
    expect(artifacts.json).toBeDefined();
    expect(artifacts.html).toBeUndefined();
    expect(artifacts.junit_xml).toBeUndefined();
    expect(seam.files).toHaveLength(1);
  });

  it("synthesizes a default basename when none supplied", async () => {
    const seam = capture();
    const artifacts = await emitRunReport(
      SAMPLE,
      { reportsDir: "reports", targets: { html: false, json: true, junit_xml: false } },
      new SecretRegistry(),
      seam,
    );
    expect(artifacts.json).toMatch(/reports\/run-\d+\.json/);
  });

  it("propagates REPORT_HTML_RENDER_FAILED when writeFile fails for html", async () => {
    const seam: ReportWriterSeam = {
      async mkdir(): Promise<void> {},
      async writeFile(p: string): Promise<void> {
        if (p.endsWith(".html")) throw new Error("disk full");
      },
    };
    try {
      await emitRunReport(
        SAMPLE,
        { reportsDir: "r", targets: { html: true, json: false, junit_xml: false }, basename: "x" },
        new SecretRegistry(),
        seam,
      );
      expect.fail("should throw");
    } catch (e: unknown) {
      expect(isReportError(e)).toBe(true);
      if (isReportError(e)) expect(e.code).toBe("REPORT_HTML_RENDER_FAILED");
    }
  });

  it("propagates REPORT_JUNIT_RENDER_FAILED when writeFile fails for junit", async () => {
    const seam: ReportWriterSeam = {
      async mkdir(): Promise<void> {},
      async writeFile(p: string): Promise<void> {
        if (p.endsWith(".xml")) throw new Error("disk full");
      },
    };
    try {
      await emitRunReport(
        SAMPLE,
        { reportsDir: "r", targets: { html: false, json: false, junit_xml: true }, basename: "x" },
        new SecretRegistry(),
        seam,
      );
      expect.fail("should throw");
    } catch (e: unknown) {
      expect(isReportError(e)).toBe(true);
      if (isReportError(e)) expect(e.code).toBe("REPORT_JUNIT_RENDER_FAILED");
    }
  });

  it("redacts secrets in HTML output", async () => {
    const seam = capture();
    const reg = new SecretRegistry();
    reg.add("supersecret");
    await emitRunReport(
      { ...SAMPLE, env: "supersecret" },
      { reportsDir: "r", targets: { html: true, json: false, junit_xml: false }, basename: "x" },
      reg,
      seam,
    );
    const file = seam.files.find((f) => f.path.endsWith(".html"));
    expect(file?.contents).not.toContain("supersecret");
  });

  it("redacts secrets in JUnit XML output", async () => {
    const seam = capture();
    const reg = new SecretRegistry();
    reg.add("supersecret");
    await emitRunReport(
      {
        ...SAMPLE,
        endpoints: [{
          endpoint_id: "supersecret-id",
          status: "pass",
          flaky: false,
          attempts: [{ attempt: 1, verdict: "pass", started_at: 0, ended_at: 1, assertions: [], db_verify: [] }],
        }],
      },
      { reportsDir: "r", targets: { html: false, json: false, junit_xml: true }, basename: "x" },
      reg,
      seam,
    );
    const file = seam.files.find((f) => f.path.endsWith(".xml"));
    expect(file?.contents).not.toContain("supersecret");
  });
});
