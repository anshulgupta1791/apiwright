import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, it, expect } from "vitest";

import { readYamlFile, describeError } from "../../../src/env/index.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "apiwright-yaml-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes a temp file with given contents and returns its absolute path.
 * @param name - File name within the temp dir.
 * @param contents - File contents.
 * @returns Absolute path to the written file.
 */
function writeTmp(name: string, contents: string): string {
  const p = join(dir, name);
  writeFileSync(p, contents, "utf8");
  return p;
}

describe("readYamlFile", () => {
  it("parses a well-formed YAML mapping into an object", () => {
    const p = writeTmp(
      "good.yaml",
      "name: qa\nprod: false\nbase_url: https://api-qa.example.com\n",
    );
    const result = readYamlFile(p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        name: "qa",
        prod: false,
        base_url: "https://api-qa.example.com",
      });
    }
  });

  it("preserves unresolved ${secret.*} strings verbatim", () => {
    const p = writeTmp(
      "secret.yaml",
      "name: qa\nprod: false\nbase_url: x\nuser: ${secret.QA_DB_USER}\n",
    );
    const result = readYamlFile(p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.user).toBe("${secret.QA_DB_USER}");
    }
  });

  it("returns a structured not_found error naming the path", () => {
    const missing = join(dir, "does-not-exist.yaml");
    const result = readYamlFile(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("not_found");
      expect(result.error).toContain(missing);
    }
  });

  it("returns a structured empty error for an empty file", () => {
    const p = writeTmp("empty.yaml", "");
    const result = readYamlFile(p);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("empty");
      expect(result.error).toContain(p);
    }
  });

  it("returns a structured empty error for whitespace-only content", () => {
    const p = writeTmp("ws.yaml", "   \n\n  \n");
    const result = readYamlFile(p);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("empty");
    }
  });

  it("returns a malformed error including the YAML line/column message", () => {
    const p = writeTmp("bad.yaml", "name: qa\n  prod: : false\n\tbad-indent\n");
    const result = readYamlFile(p);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("malformed");
      // js-yaml embeds a (line:column) coordinate in its messages.
      expect(result.error).toMatch(/\(\d+:\d+\)/);
    }
  });

  it("rejects a YAML document with an unsafe custom tag without executing code", () => {
    const p = writeTmp(
      "unsafe.yaml",
      "name: !!js/function 'function(){return 1}'\n",
    );
    const result = readYamlFile(p);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["unsafe", "malformed"]).toContain(result.kind);
    }
  });

  it("rejects a non-mapping scalar top-level document", () => {
    const p = writeTmp("scalar.yaml", "42\n");
    const result = readYamlFile(p);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("malformed");
    }
  });

  it("rejects a list top-level document", () => {
    const p = writeTmp("list.yaml", "- one\n- two\n");
    const result = readYamlFile(p);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("malformed");
    }
  });

  it("returns an unreadable error when the path is a directory", () => {
    const sub = join(dir, "a-directory.yaml");
    mkdirSync(sub);
    const result = readYamlFile(sub);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unreadable");
      expect(result.error).toContain(sub);
    }
  });

  it("supports YAML anchors and aliases (safe feature)", () => {
    const p = writeTmp(
      "anchor.yaml",
      "name: qa\nprod: false\nbase_url: &b https://x\nalias_url: *b\n",
    );
    const result = readYamlFile(p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.alias_url).toBe("https://x");
    }
  });
});

describe("describeError", () => {
  it("returns the message of an Error instance", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error value (covers the fallback branch)", () => {
    expect(describeError("disk gremlin")).toBe("disk gremlin");
    expect(describeError(42)).toBe("42");
    expect(describeError(null)).toBe("null");
  });
});
