import { describe, it, expect } from "vitest";

import { SecretRegistry } from "../../../src/env/index.js";
import { isRunnerError } from "../../../src/runner/index.js";
import {
  createDefaultReportWriter,
  emitRunResult,
  type ReportWriterSeam,
} from "../../../src/runner/output/run-result-emitter.js";
import type { RunResult } from "../../../src/runner/types.js";

/** Captures emit calls for assertions. */
interface CapturingSeam extends ReportWriterSeam {
  mkdirs: string[];
  files: { path: string; contents: string }[];
}

/**
 * Builds a capturing seam.
 * @returns Capturing seam.
 */
function capture(): CapturingSeam {
  const c: CapturingSeam = {
    mkdirs: [],
    files: [],
    async mkdir(dir: string): Promise<void> { c.mkdirs.push(dir); },
    async writeFile(path: string, contents: string): Promise<void> {
      c.files.push({ path, contents });
    },
  };
  return c;
}

const SAMPLE_RESULT: RunResult = {
  started_at: "2026-05-21T00:00:00Z",
  ended_at: "2026-05-21T00:01:00Z",
  env: "test",
  filters: {},
  shard: null,
  workers: 1,
  endpoints: [],
  summary: { endpoints_planned: 0, passed: 0, failed: 0, flaky: 0, duration_ms: 60000 },
};

describe("emitRunResult", () => {
  it("writes a JSON file under reportsDir with default name", async () => {
    const seam = capture();
    const reg = new SecretRegistry();
    const out = await emitRunResult(SAMPLE_RESULT, "reports", reg, undefined, seam);
    expect(out).toContain("reports/run-");
    expect(out).toContain(".json");
    expect(seam.mkdirs).toEqual(["reports"]);
    expect(seam.files).toHaveLength(1);
  });

  it("writes to custom filename when supplied", async () => {
    const seam = capture();
    const out = await emitRunResult(SAMPLE_RESULT, "reports", new SecretRegistry(), "custom.json", seam);
    expect(out).toBe("reports/custom.json");
  });

  it("redacts secrets from the serialized output", async () => {
    const seam = capture();
    const reg = new SecretRegistry();
    reg.add("topsecret-token");
    const resultWithSecret: RunResult = {
      ...SAMPLE_RESULT,
      env: "topsecret-token",
    };
    await emitRunResult(resultWithSecret, "reports", reg, "out.json", seam);
    const file = seam.files[0];
    expect(file?.contents).not.toContain("topsecret-token");
    expect(file?.contents).toContain("[REDACTED]");
  });

  it("throws RUNNER_EMIT_FAILED when mkdir fails", async () => {
    const seam: ReportWriterSeam = {
      async mkdir(): Promise<void> { throw new Error("EACCES"); },
      async writeFile(): Promise<void> {},
    };
    try {
      await emitRunResult(SAMPLE_RESULT, "reports", new SecretRegistry(), undefined, seam);
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isRunnerError(e)).toBe(true);
      if (isRunnerError(e)) expect(e.code).toBe("RUNNER_EMIT_FAILED");
    }
  });

  it("throws RUNNER_EMIT_FAILED when writeFile fails", async () => {
    const seam: ReportWriterSeam = {
      async mkdir(): Promise<void> {},
      async writeFile(): Promise<void> { throw new Error("ENOSPC"); },
    };
    try {
      await emitRunResult(SAMPLE_RESULT, "reports", new SecretRegistry(), undefined, seam);
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isRunnerError(e)).toBe(true);
      if (isRunnerError(e)) expect(e.code).toBe("RUNNER_EMIT_FAILED");
    }
  });

  it("createDefaultReportWriter returns a working seam", () => {
    const seam = createDefaultReportWriter();
    expect(typeof seam.mkdir).toBe("function");
    expect(typeof seam.writeFile).toBe("function");
  });
});
