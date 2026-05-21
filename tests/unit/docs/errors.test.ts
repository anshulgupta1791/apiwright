import { describe, it, expect } from "vitest";

import {
  DOCS_ERROR_CODES,
  DocsError,
  isDocsError,
  type DocsErrorCode,
} from "../../../src/docs/index.js";

describe("DocsError", () => {
  it("preserves code/phase/message/cause", () => {
    const cause = new Error("inner");
    const e = new DocsError({
      code: "DOCS_WRITE_FAILED",
      phase: "write",
      message: "boom",
      cause,
    });
    expect(e.code).toBe("DOCS_WRITE_FAILED");
    expect(e.phase).toBe("write");
    expect(e.message).toBe("boom");
    expect(e.cause).toBe(cause);
    expect(e.name).toBe("DocsError");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("DOCS_ERROR_CODES", () => {
  it("is frozen with key === value", () => {
    expect(Object.isFrozen(DOCS_ERROR_CODES)).toBe(true);
    for (const k of Object.keys(DOCS_ERROR_CODES) as DocsErrorCode[]) {
      expect(DOCS_ERROR_CODES[k]).toBe(k);
    }
  });

  it("exports all 4 documented codes", () => {
    expect(DOCS_ERROR_CODES.DOCS_ENDPOINT_LOAD_FAILED).toBe("DOCS_ENDPOINT_LOAD_FAILED");
    expect(DOCS_ERROR_CODES.DOCS_RENDER_FAILED).toBe("DOCS_RENDER_FAILED");
    expect(DOCS_ERROR_CODES.DOCS_SOURCE_DIR_EMPTY).toBe("DOCS_SOURCE_DIR_EMPTY");
    expect(DOCS_ERROR_CODES.DOCS_WRITE_FAILED).toBe("DOCS_WRITE_FAILED");
  });
});

describe("isDocsError", () => {
  it("true for DocsError instances", () => {
    const e = new DocsError({ code: "DOCS_WRITE_FAILED", phase: "write", message: "x" });
    expect(isDocsError(e)).toBe(true);
  });

  it("false for plain Error / POJO / null", () => {
    expect(isDocsError(new Error("x"))).toBe(false);
    expect(isDocsError({ code: "DOCS_WRITE_FAILED", phase: "write", message: "x" })).toBe(false);
    expect(isDocsError(null)).toBe(false);
    expect(isDocsError("string")).toBe(false);
  });
});
