import { describe, expect, it } from "vitest";

import { PathNamer } from "../../../../src/importers/postman/path-naming.js";

/**
 * Unit tests for PathNamer.
 *
 * Covers: toIdSlug (charset, lowercase, diacritic stripping, NFKD normalize,
 * fallback "endpoint"), toPathSegment (same rules, fallback "unnamed"),
 * dedupe (unique suffix appending, Set mutation, determinism).
 */
describe("PathNamer", () => {
  const namer = new PathNamer();

  describe("toIdSlug()", () => {
    it("lowercases input text", () => {
      expect(namer.toIdSlug("CreateUser")).toBe("createuser");
    });

    it("replaces spaces with underscore", () => {
      expect(namer.toIdSlug("Create User")).toBe("create_user");
    });

    it("replaces multiple illegal chars with a single underscore", () => {
      expect(namer.toIdSlug("Create  User  Now")).toBe("create_user_now");
    });

    it("preserves dots in output", () => {
      expect(namer.toIdSlug("users.create")).toBe("users.create");
    });

    it("preserves hyphens in output", () => {
      expect(namer.toIdSlug("create-user")).toBe("create-user");
    });

    it("strips diacritics via NFKD: Café → cafe", () => {
      expect(namer.toIdSlug("Café")).toBe("cafe");
    });

    it("strips diacritics for ñ → n", () => {
      const result = namer.toIdSlug("niño");
      expect(result).not.toContain("ñ");
      expect(/^[a-z0-9._-]+$/.test(result)).toBe(true);
    });

    it("trims leading and trailing separators", () => {
      expect(namer.toIdSlug("  create user  ")).toBe("create_user");
    });

    it("trims leading/trailing hyphens and underscores", () => {
      expect(namer.toIdSlug("_create_user_")).toBe("create_user");
    });

    it("returns 'endpoint' for empty string", () => {
      expect(namer.toIdSlug("")).toBe("endpoint");
    });

    it("returns 'endpoint' for all-illegal characters input", () => {
      expect(namer.toIdSlug("!@#$%")).toBe("endpoint");
    });

    it("produces slug matching ^[a-z0-9._-]+$ for a normal name", () => {
      const slug = namer.toIdSlug("Create User");
      expect(/^[a-z0-9._-]+$/.test(slug)).toBe(true);
    });

    it("produces slug matching ^[a-z0-9._-]+$ for non-ASCII input", () => {
      const slug = namer.toIdSlug("Café & Friends");
      expect(/^[a-z0-9._-]+$/.test(slug)).toBe(true);
    });

    it("handles numeric-only names", () => {
      const slug = namer.toIdSlug("123");
      expect(/^[a-z0-9._-]+$/.test(slug)).toBe(true);
    });

    it("collapses consecutive underscores to one", () => {
      const slug = namer.toIdSlug("a!!b");
      expect(slug).toBe("a_b");
    });
  });

  describe("toPathSegment()", () => {
    it("lowercases and slug-ifies a folder name", () => {
      expect(namer.toPathSegment("My Folder")).toBe("my_folder");
    });

    it("returns 'unnamed' for empty input", () => {
      expect(namer.toPathSegment("")).toBe("unnamed");
    });

    it("returns 'unnamed' for all-illegal characters", () => {
      expect(namer.toPathSegment("!!!")).toBe("unnamed");
    });

    it("strips trailing punctuation: 'My Folder!' → 'my_folder'", () => {
      const seg = namer.toPathSegment("My Folder!");
      expect(seg).toBe("my_folder");
    });

    it("produces segment matching ^[a-z0-9._-]+$ for normal folder name", () => {
      const seg = namer.toPathSegment("Users & Admin");
      expect(/^[a-z0-9._-]+$/.test(seg)).toBe(true);
    });

    it("handles numbers in folder names", () => {
      expect(namer.toPathSegment("V2 API")).toBe("v2_api");
    });

    it("is deterministic: same input → same output", () => {
      expect(namer.toPathSegment("Admin Users")).toBe(
        namer.toPathSegment("Admin Users"),
      );
    });
  });

  describe("dedupe()", () => {
    it("returns the candidate unchanged when it is not in the used set", () => {
      const used = new Set<string>();
      const result = namer.dedupe("create_user", used);
      expect(result).toBe("create_user");
    });

    it("records the returned value in the used set", () => {
      const used = new Set<string>();
      namer.dedupe("create_user", used);
      expect(used.has("create_user")).toBe(true);
    });

    it("appends _2 when the candidate is already used", () => {
      const used = new Set<string>(["create_user"]);
      const result = namer.dedupe("create_user", used);
      expect(result).toBe("create_user_2");
    });

    it("appends _3 when both candidate and _2 are already used", () => {
      const used = new Set<string>(["create_user", "create_user_2"]);
      const result = namer.dedupe("create_user", used);
      expect(result).toBe("create_user_3");
    });

    it("records the disambiguated slug in the used set", () => {
      const used = new Set<string>(["create_user"]);
      const result = namer.dedupe("create_user", used);
      expect(used.has(result)).toBe(true);
    });

    it("is deterministic for the same call order on the same set", () => {
      const usedA = new Set<string>(["create_user"]);
      const usedB = new Set<string>(["create_user"]);
      expect(namer.dedupe("create_user", usedA)).toBe(
        namer.dedupe("create_user", usedB),
      );
    });

    it("handles three collisions sequentially: _2 then _3 then _4", () => {
      const used = new Set<string>();
      const r1 = namer.dedupe("x", used);
      const r2 = namer.dedupe("x", used);
      const r3 = namer.dedupe("x", used);
      const r4 = namer.dedupe("x", used);
      expect(r1).toBe("x");
      expect(r2).toBe("x_2");
      expect(r3).toBe("x_3");
      expect(r4).toBe("x_4");
    });
  });
});
