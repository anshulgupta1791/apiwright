import { describe, it, expect } from "vitest";

import { SecretRegistry } from "../../../src/env/index.js";
import {
  createDefaultReportWriter,
  emitJsonSidecar,
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
  mkdirs: string[];
  files: { path: string; contents: string }[];
}

function capture(): CapturingSeam {
  const c: CapturingSeam = {
    mkdirs: [], files: [],
    async mkdir(d: string): Promise<void> { c.mkdirs.push(d); },
    async writeFile(p: string, c2: string): Promise<void> { c.files.push({ path: p, contents: c2 }); },
  };
  return c;
}

describe("emitJsonSidecar", () => {
  it("writes a JSON file with the basename + .json suffix", async () => {
    const seam = capture();
    const path = await emitJsonSidecar(SAMPLE, "reports", "myrun", new SecretRegistry(), seam);
    expect(path).toBe("reports/myrun.json");
    expect(seam.mkdirs).toEqual(["reports"]);
    expect(seam.files).toHaveLength(1);
  });

  it("redacts registered secrets in the serialized output", async () => {
    const seam = capture();
    const reg = new SecretRegistry();
    reg.add("supersecret");
    await emitJsonSidecar({ ...SAMPLE, env: "supersecret" }, "r", "x", reg, seam);
    const file = seam.files[0];
    expect(file?.contents).not.toContain("supersecret");
    expect(file?.contents).toContain("[REDACTED]");
  });

  it("throws REPORT_JSON_WRITE_FAILED when writeFile fails", async () => {
    const seam: ReportWriterSeam = {
      async mkdir(): Promise<void> {},
      async writeFile(): Promise<void> { throw new Error("ENOSPC"); },
    };
    try {
      await emitJsonSidecar(SAMPLE, "r", "x", new SecretRegistry(), seam);
      expect.fail("should throw");
    } catch (e: unknown) {
      expect(isReportError(e)).toBe(true);
      if (isReportError(e)) expect(e.code).toBe("REPORT_JSON_WRITE_FAILED");
    }
  });

  it("throws REPORT_JSON_WRITE_FAILED when mkdir fails", async () => {
    const seam: ReportWriterSeam = {
      async mkdir(): Promise<void> { throw new Error("EACCES"); },
      async writeFile(): Promise<void> {},
    };
    try {
      await emitJsonSidecar(SAMPLE, "r", "x", new SecretRegistry(), seam);
      expect.fail("should throw");
    } catch (e: unknown) {
      expect(isReportError(e)).toBe(true);
    }
  });

  it("createDefaultReportWriter has mkdir + writeFile methods", () => {
    const seam = createDefaultReportWriter();
    expect(typeof seam.mkdir).toBe("function");
    expect(typeof seam.writeFile).toBe("function");
  });
});
