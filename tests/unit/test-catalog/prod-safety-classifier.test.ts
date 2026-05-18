import { describe, it, expect } from "vitest";

import { ProdSafetyClassifier } from "../../../src/test-catalog/prod-safety-classifier.js";

/**
 * Unit tests for ProdSafetyClassifier.
 *
 * Covers every method × marker × endpointProdSafe combination per §3/§7:
 *   - regression/e2e → always false regardless of method/endpointProdSafe
 *   - smoke + GET/HEAD/OPTIONS → always true regardless of endpointProdSafe
 *   - smoke + POST/PUT/PATCH/DELETE → true iff endpointProdSafe === true
 */
describe("ProdSafetyClassifier", () => {
  describe("constructor", () => {
    it("constructs with no arguments", () => {
      expect(() => new ProdSafetyClassifier()).not.toThrow();
    });
  });

  describe("classifyProdSafe() — regression marker is never prod-safe", () => {
    const classifier = new ProdSafetyClassifier();

    it("returns false for regression + GET", () => {
      expect(classifier.classifyProdSafe({ marker: "regression", method: "GET" })).toBe(false);
    });

    it("returns false for regression + POST", () => {
      expect(classifier.classifyProdSafe({ marker: "regression", method: "POST" })).toBe(false);
    });

    it("returns false for regression + PUT", () => {
      expect(classifier.classifyProdSafe({ marker: "regression", method: "PUT" })).toBe(false);
    });

    it("returns false for regression + PATCH", () => {
      expect(classifier.classifyProdSafe({ marker: "regression", method: "PATCH" })).toBe(false);
    });

    it("returns false for regression + DELETE", () => {
      expect(classifier.classifyProdSafe({ marker: "regression", method: "DELETE" })).toBe(false);
    });

    it("returns false for regression + HEAD", () => {
      expect(classifier.classifyProdSafe({ marker: "regression", method: "HEAD" })).toBe(false);
    });

    it("returns false for regression + OPTIONS", () => {
      expect(classifier.classifyProdSafe({ marker: "regression", method: "OPTIONS" })).toBe(false);
    });

    it("returns false for regression even when endpointProdSafe is true", () => {
      expect(
        classifier.classifyProdSafe({ marker: "regression", method: "GET", endpointProdSafe: true }),
      ).toBe(false);
    });
  });

  describe("classifyProdSafe() — e2e marker is never prod-safe", () => {
    const classifier = new ProdSafetyClassifier();

    it("returns false for e2e + GET", () => {
      expect(classifier.classifyProdSafe({ marker: "e2e", method: "GET" })).toBe(false);
    });

    it("returns false for e2e + POST even with endpointProdSafe=true", () => {
      expect(
        classifier.classifyProdSafe({ marker: "e2e", method: "POST", endpointProdSafe: true }),
      ).toBe(false);
    });
  });

  describe("classifyProdSafe() — smoke + read methods (GET/HEAD/OPTIONS) → always true", () => {
    const classifier = new ProdSafetyClassifier();

    it("returns true for smoke + GET without endpointProdSafe", () => {
      expect(classifier.classifyProdSafe({ marker: "smoke", method: "GET" })).toBe(true);
    });

    it("returns true for smoke + GET when endpointProdSafe is false", () => {
      expect(
        classifier.classifyProdSafe({ marker: "smoke", method: "GET", endpointProdSafe: false }),
      ).toBe(true);
    });

    it("returns true for smoke + GET when endpointProdSafe is undefined", () => {
      expect(
        classifier.classifyProdSafe({ marker: "smoke", method: "GET", endpointProdSafe: undefined }),
      ).toBe(true);
    });

    it("returns true for smoke + HEAD without endpointProdSafe", () => {
      expect(classifier.classifyProdSafe({ marker: "smoke", method: "HEAD" })).toBe(true);
    });

    it("returns true for smoke + OPTIONS without endpointProdSafe", () => {
      expect(classifier.classifyProdSafe({ marker: "smoke", method: "OPTIONS" })).toBe(true);
    });
  });

  describe("classifyProdSafe() — smoke + write methods depend on endpointProdSafe", () => {
    const classifier = new ProdSafetyClassifier();

    it("returns false for smoke + POST when endpointProdSafe is undefined", () => {
      expect(classifier.classifyProdSafe({ marker: "smoke", method: "POST" })).toBe(false);
    });

    it("returns false for smoke + POST when endpointProdSafe is false", () => {
      expect(
        classifier.classifyProdSafe({ marker: "smoke", method: "POST", endpointProdSafe: false }),
      ).toBe(false);
    });

    it("returns true for smoke + POST when endpointProdSafe is true", () => {
      expect(
        classifier.classifyProdSafe({ marker: "smoke", method: "POST", endpointProdSafe: true }),
      ).toBe(true);
    });

    it("returns false for smoke + PUT when endpointProdSafe is undefined", () => {
      expect(classifier.classifyProdSafe({ marker: "smoke", method: "PUT" })).toBe(false);
    });

    it("returns true for smoke + PUT when endpointProdSafe is true", () => {
      expect(
        classifier.classifyProdSafe({ marker: "smoke", method: "PUT", endpointProdSafe: true }),
      ).toBe(true);
    });

    it("returns false for smoke + PATCH when endpointProdSafe is undefined", () => {
      expect(classifier.classifyProdSafe({ marker: "smoke", method: "PATCH" })).toBe(false);
    });

    it("returns true for smoke + PATCH when endpointProdSafe is true", () => {
      expect(
        classifier.classifyProdSafe({ marker: "smoke", method: "PATCH", endpointProdSafe: true }),
      ).toBe(true);
    });

    it("returns false for smoke + DELETE when endpointProdSafe is undefined", () => {
      expect(classifier.classifyProdSafe({ marker: "smoke", method: "DELETE" })).toBe(false);
    });

    it("returns true for smoke + DELETE when endpointProdSafe is true", () => {
      expect(
        classifier.classifyProdSafe({ marker: "smoke", method: "DELETE", endpointProdSafe: true }),
      ).toBe(true);
    });
  });
});
