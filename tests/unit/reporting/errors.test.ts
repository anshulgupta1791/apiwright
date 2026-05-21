import { describe, it, expect } from "vitest";

import {
  REPORT_ERROR_CODES,
  ReportError,
  isReportError,
  type ReportErrorCode,
} from "../../../src/reporting/index.js";

describe("ReportError", () => {
  it("preserves code/phase/message/cause", () => {
    const cause = new Error("inner");
    const e = new ReportError({
      code: "REPORT_HTML_RENDER_FAILED",
      phase: "render",
      message: "boom",
      cause,
    });
    expect(e.code).toBe("REPORT_HTML_RENDER_FAILED");
    expect(e.phase).toBe("render");
    expect(e.message).toBe("boom");
    expect(e.cause).toBe(cause);
    expect(e.name).toBe("ReportError");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("REPORT_ERROR_CODES", () => {
  it("is frozen with key === value", () => {
    expect(Object.isFrozen(REPORT_ERROR_CODES)).toBe(true);
    for (const k of Object.keys(REPORT_ERROR_CODES) as ReportErrorCode[]) {
      expect(REPORT_ERROR_CODES[k]).toBe(k);
    }
  });

  it("exports all 4 documented codes", () => {
    expect(REPORT_ERROR_CODES.REPORT_HTML_RENDER_FAILED).toBe("REPORT_HTML_RENDER_FAILED");
    expect(REPORT_ERROR_CODES.REPORT_JSON_WRITE_FAILED).toBe("REPORT_JSON_WRITE_FAILED");
    expect(REPORT_ERROR_CODES.REPORT_JUNIT_RENDER_FAILED).toBe("REPORT_JUNIT_RENDER_FAILED");
    expect(REPORT_ERROR_CODES.REPORT_WRITE_FAILED).toBe("REPORT_WRITE_FAILED");
  });
});

describe("isReportError", () => {
  it("true for ReportError instances", () => {
    const e = new ReportError({ code: "REPORT_WRITE_FAILED", phase: "write", message: "x" });
    expect(isReportError(e)).toBe(true);
  });

  it("false for plain Error and POJO", () => {
    expect(isReportError(new Error("x"))).toBe(false);
    expect(isReportError({ code: "REPORT_WRITE_FAILED", phase: "write", message: "x" })).toBe(false);
    expect(isReportError(null)).toBe(false);
    expect(isReportError("string")).toBe(false);
  });
});
