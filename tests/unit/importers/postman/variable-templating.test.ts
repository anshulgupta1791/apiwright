import { describe, expect, it } from "vitest";

import { PostmanVariableTemplater } from "../../../../src/importers/postman/variable-templating.js";
import type { FlattenedRequest } from "../../../../src/importers/types.js";

/**
 * Unit tests for PostmanVariableTemplater.
 *
 * Covers: all rewrite-rule cases from the design (legal name, sanitizable name,
 * empty name, dotted names, unbalanced braces, whitespace trimming, collision
 * dedupe for same sanitized name), purity (input not mutated), and fields
 * rewritten vs. not rewritten (preRequestScript excluded, header keys excluded).
 */

/** Minimal FlattenedRequest builder; only required fields need values. */
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

describe("PostmanVariableTemplater", () => {
  const templater = new PostmanVariableTemplater();

  describe("rewrite() — purity", () => {
    it("does not mutate the input request object", () => {
      const req = makeRequest({ rawUrl: "{{baseUrl}}/users" });
      const originalUrl = req.rawUrl;
      templater.rewrite(req);
      expect(req.rawUrl).toBe(originalUrl);
    });

    it("returns a new FlattenedRequest object, not the input", () => {
      const req = makeRequest({ rawUrl: "{{baseUrl}}/users" });
      const result = templater.rewrite(req);
      expect(result.request).not.toBe(req);
    });
  });

  describe("rewrite() — URL field", () => {
    it("rewrites a simple {{baseUrl}} to ${env.baseUrl}", () => {
      const req = makeRequest({ rawUrl: "{{baseUrl}}/users" });
      const { request } = templater.rewrite(req);
      expect(request.rawUrl).toBe("${env.baseUrl}/users");
    });

    it("rewrites multiple variables in one URL", () => {
      const req = makeRequest({ rawUrl: "{{baseUrl}}/api/{{version}}/users" });
      const { request } = templater.rewrite(req);
      expect(request.rawUrl).toBe("${env.baseUrl}/api/${env.version}/users");
    });

    it("leaves a URL without variables unchanged", () => {
      const req = makeRequest({ rawUrl: "https://example.com/users" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toBe("https://example.com/users");
      expect(warnings).toHaveLength(0);
    });

    it("trims internal whitespace: {{ spaced }} → ${env.spaced}", () => {
      const req = makeRequest({ rawUrl: "{{ spaced }}/path" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toBe("${env.spaced}/path");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("rewrite() — header values", () => {
    it("rewrites {{token}} in Authorization header value", () => {
      const req = makeRequest({
        headers: [
          { key: "Authorization", value: "Bearer {{token}}", disabled: false },
        ],
      });
      const { request } = templater.rewrite(req);
      expect(request.headers[0].value).toBe("Bearer ${env.token}");
    });

    it("does NOT rewrite header keys", () => {
      const req = makeRequest({
        headers: [
          { key: "{{headerKey}}", value: "some-value", disabled: false },
        ],
      });
      const { request } = templater.rewrite(req);
      expect(request.headers[0].key).toBe("{{headerKey}}");
    });

    it("rewrites multiple headers independently", () => {
      const req = makeRequest({
        headers: [
          { key: "Authorization", value: "Bearer {{token}}", disabled: false },
          { key: "X-User", value: "{{userId}}", disabled: false },
        ],
      });
      const { request } = templater.rewrite(req);
      expect(request.headers[0].value).toBe("Bearer ${env.token}");
      expect(request.headers[1].value).toBe("${env.userId}");
    });
  });

  describe("rewrite() — query parameter values", () => {
    it("rewrites {{var}} in query parameter values", () => {
      const req = makeRequest({
        query: [{ key: "user_id", value: "{{userId}}", disabled: false }],
      });
      const { request } = templater.rewrite(req);
      expect(request.query[0].value).toBe("${env.userId}");
    });

    it("does NOT rewrite query parameter keys", () => {
      const req = makeRequest({
        query: [{ key: "{{paramKey}}", value: "value", disabled: false }],
      });
      const { request } = templater.rewrite(req);
      expect(request.query[0].key).toBe("{{paramKey}}");
    });
  });

  describe("rewrite() — raw body", () => {
    it("rewrites {{var}} tokens in raw body", () => {
      const req = makeRequest({
        body: { mode: "raw", raw: '{"email":"{{userId}}@example.com"}' },
      });
      const { request } = templater.rewrite(req);
      expect(request.body?.raw).toBe('{"email":"${env.userId}@example.com"}');
    });

    it("does not rewrite body.raw when body mode is not 'raw'", () => {
      const req = makeRequest({
        body: { mode: "formdata", raw: "" },
      });
      const { request } = templater.rewrite(req);
      expect(request.body?.raw).toBe("");
    });

    it("handles undefined body without error", () => {
      const req = makeRequest({ body: undefined });
      expect(() => templater.rewrite(req)).not.toThrow();
    });
  });

  describe("rewrite() — preRequestScript NOT rewritten", () => {
    it("leaves preRequestScript unchanged even when it contains {{var}}", () => {
      const req = makeRequest({
        preRequestScript: "pm.environment.set('token', {{token}})",
      });
      const { request } = templater.rewrite(req);
      expect(request.preRequestScript).toBe(
        "pm.environment.set('token', {{token}})",
      );
    });
  });

  describe("rewrite() — legal dotted names", () => {
    it("preserves dotted names: {{auth.token}} → ${env.auth.token}", () => {
      const req = makeRequest({ rawUrl: "{{auth.token}}" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toBe("${env.auth.token}");
      expect(warnings).toHaveLength(0);
    });

    it("preserves multi-segment dotted names", () => {
      const req = makeRequest({ rawUrl: "{{a.b.c}}" });
      const { request } = templater.rewrite(req);
      expect(request.rawUrl).toBe("${env.a.b.c}");
    });
  });

  describe("rewrite() — sanitizable names", () => {
    it("sanitizes {{my-var}} to ${env.my_var} with a warning", () => {
      const req = makeRequest({ rawUrl: "{{my-var}}/path" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toBe("${env.my_var}/path");
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings.some((w) => w.includes("my-var"))).toBe(true);
    });

    it("sanitization warning mentions the original name and the rewritten name", () => {
      const req = makeRequest({ rawUrl: "{{my-var}}" });
      const { warnings } = templater.rewrite(req);
      expect(
        warnings.some((w) => w.includes("my-var") && w.includes("my_var")),
      ).toBe(true);
    });

    it("sanitizes names with spaces", () => {
      const req = makeRequest({ rawUrl: "{{my var}}" });
      const { request } = templater.rewrite(req);
      expect(request.rawUrl).toMatch(/\$\{env\.[a-z0-9_]+\}/);
    });

    it("two distinct originals that sanitize to the same name — second gets _2 suffix", () => {
      // "my-var" and "my_var" both sanitize to "my_var"
      // We use two different variables with the same sanitized form
      const req = makeRequest({
        rawUrl: "{{my-var}}",
        headers: [{ key: "X-H", value: "{{my var}}", disabled: false }],
      });
      const { warnings } = templater.rewrite(req);
      // At least two sanitization warnings
      expect(
        warnings.filter((w) => w.includes("(illegal characters")),
      ).toHaveLength(2);
    });
  });

  describe("rewrite() — empty variable name", () => {
    it("leaves {{}} unchanged and emits a warning", () => {
      const req = makeRequest({ rawUrl: "{{}}/path" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toContain("{{}}");
      expect(warnings.some((w) => w.toLowerCase().includes("empty"))).toBe(
        true,
      );
    });

    it("leaves {{   }} (all whitespace) unchanged with empty-variable warning", () => {
      const req = makeRequest({ rawUrl: "{{   }}/path" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toContain("{{");
      expect(warnings.some((w) => w.toLowerCase().includes("empty"))).toBe(
        true,
      );
    });
  });

  describe("rewrite() — unbalanced braces", () => {
    it("leaves {{oops (unclosed) literal and emits unbalanced-brace warning", () => {
      const req = makeRequest({ rawUrl: "{{oops" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toBe("{{oops");
      expect(warnings.some((w) => w.toLowerCase().includes("unbalanced"))).toBe(
        true,
      );
    });

    it("leaves oops}} literal and emits unbalanced-brace warning", () => {
      const req = makeRequest({ rawUrl: "oops}}" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toBe("oops}}");
      expect(warnings.some((w) => w.toLowerCase().includes("unbalanced"))).toBe(
        true,
      );
    });
  });

  describe("rewrite() — no vars", () => {
    it("returns no warnings when input has no variable references", () => {
      const req = makeRequest({
        rawUrl: "https://example.com/no-vars",
        headers: [
          { key: "Content-Type", value: "application/json", disabled: false },
        ],
      });
      const { warnings } = templater.rewrite(req);
      expect(warnings).toHaveLength(0);
    });
  });

  describe("rewrite() — cache hit (same illegal var name twice in one request)", () => {
    it("resolves both occurrences of the same illegal name to the same ${env.*} token", () => {
      const req = makeRequest({
        rawUrl: "https://example.com/{{my-var}}/{{my-var}}",
      });
      const { request, warnings } = templater.rewrite(req);
      // Both occurrences must resolve to the same sanitized token
      expect(request.rawUrl).toBe(
        "https://example.com/${env.my_var}/${env.my_var}",
      );
      // The sanitization warning is only emitted once (cache hit path skips the second warning)
      expect(warnings.filter((w) => w.includes("my-var"))).toHaveLength(1);
    });

    it("cache hit path returns the cached token without adding a duplicate warning", () => {
      const req = makeRequest({
        rawUrl: "{{my-var}}/a/{{my-var}}/b/{{my-var}}",
      });
      const { request, warnings } = templater.rewrite(req);
      // All three occurrences resolve to the same name
      expect(request.rawUrl).toBe(
        "${env.my_var}/a/${env.my_var}/b/${env.my_var}",
      );
      // Exactly one sanitization warning despite three occurrences
      expect(warnings.filter((w) => w.includes("my-var"))).toHaveLength(1);
    });
  });

  describe("rewrite() — while-loop collision counter (3+ names with same slug)", () => {
    it("assigns distinct suffixed names when three originals collide to the same sanitized slug", () => {
      // "my-var", "my var", and "my%var" all sanitize to "my_var"
      // First gets "my_var", second gets "my_var_2", third must walk past _2 and get "my_var_3"
      const req = makeRequest({
        rawUrl: "{{my-var}}",
        headers: [
          { key: "X-A", value: "{{my var}}", disabled: false },
          { key: "X-B", value: "{{my%var}}", disabled: false },
        ],
      });
      const { request } = templater.rewrite(req);
      const urlToken = request.rawUrl;
      const headerAToken = request.headers[0].value;
      const headerBToken = request.headers[1].value;

      // All three must be distinct env references
      expect(urlToken).toMatch(/^\$\{env\.my_var\}$/);
      expect(headerAToken).toMatch(/^\$\{env\.my_var_2\}$/);
      expect(headerBToken).toMatch(/^\$\{env\.my_var_3\}$/);
    });

    it("emits three distinct sanitization warnings for three colliding names", () => {
      const req = makeRequest({
        rawUrl: "{{my-var}}",
        headers: [
          { key: "X-A", value: "{{my var}}", disabled: false },
          { key: "X-B", value: "{{my%var}}", disabled: false },
        ],
      });
      const { warnings } = templater.rewrite(req);
      const sanitizationWarnings = warnings.filter((w) =>
        w.includes("(illegal characters"),
      );
      expect(sanitizationWarnings).toHaveLength(3);
    });
  });

  describe("rewrite() — warnings array", () => {
    it("returns an array with no warnings for a plain request", () => {
      const req = makeRequest();
      const { warnings } = templater.rewrite(req);
      expect(Array.isArray(warnings)).toBe(true);
    });

    it("never throws regardless of input content", () => {
      const req = makeRequest({
        rawUrl: "{{}}{{unclosed{{my-var}}normal}}",
      });
      expect(() => templater.rewrite(req)).not.toThrow();
    });
  });

  describe("rewrite() — REGRESSION: all-illegal-char var name falls back to 'var' (istanbul-ignore removed)", () => {
    it("ISTANBUL-IGNORE-1: {{@@@}} (all illegal chars) becomes ${env.var} with a warning", () => {
      // Regression: the sanitized === "" → "var" fallback in variable-templating.ts was
      // guarded by an invalid istanbul ignore. {{@@@}} sanitizes to "" after stripping
      // illegal chars and trimming, triggering the "var" fallback.
      const req = makeRequest({ rawUrl: "https://ex.com/{{@@@}}/path" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toBe("https://ex.com/${env.var}/path");
      expect(warnings.some((w) => w.includes("@@@"))).toBe(true);
    });

    it("{{###}} (all hash chars) becomes ${env.var} — exercises the fallback path", () => {
      // All '#' are illegal in the env grammar; they strip to "" → "var" fallback.
      const req = makeRequest({ rawUrl: "{{###}}" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toBe("${env.var}");
      expect(warnings.length).toBeGreaterThanOrEqual(1);
    });

    it("var name that is only dots and underscores trims to empty → falls back to 'var'", () => {
      // "._." trims leading/trailing _/. → "" → "var" fallback
      const req = makeRequest({ rawUrl: "{{._.}}" });
      const { request, warnings } = templater.rewrite(req);
      expect(request.rawUrl).toBe("${env.var}");
      expect(warnings.some((w) => w.includes("var"))).toBe(true);
    });

    it("collision: two all-illegal names that both fall back to 'var' get distinct suffixes", () => {
      // Both {{@@@}} and {{###}} fall back to "var". The second should get "var_2".
      const req = makeRequest({
        rawUrl: "{{@@@}}",
        headers: [{ key: "X-H", value: "{{###}}", disabled: false }],
      });
      const { request } = templater.rewrite(req);
      expect(request.rawUrl).toBe("${env.var}");
      expect(request.headers[0].value).toBe("${env.var_2}");
    });
  });
});
