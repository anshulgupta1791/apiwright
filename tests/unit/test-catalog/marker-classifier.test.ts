import { describe, it, expect } from "vitest";

import {
  MarkerClassifier,
  expandMarkerSelection,
} from "../../../src/test-catalog/marker-classifier.js";

/**
 * Unit tests for MarkerClassifier and expandMarkerSelection.
 *
 * Covers: exact §3 type→marker mapping for all 16 types + "assertion",
 * prod-safety-independent mapping, expandMarkerSelection all→smoke+regression,
 * dedup, e2e passthrough, unknown-selector drop, empty selection handling.
 */
describe("MarkerClassifier", () => {
  describe("constructor", () => {
    it("constructs with no arguments", () => {
      expect(() => new MarkerClassifier()).not.toThrow();
    });
  });

  describe("markerFor() — universal (smoke) types", () => {
    const classifier = new MarkerClassifier();

    it("returns smoke for status_code_conformance", () => {
      expect(classifier.markerFor("status_code_conformance")).toBe("smoke");
    });

    it("returns smoke for content_type_alignment", () => {
      expect(classifier.markerFor("content_type_alignment")).toBe("smoke");
    });

    it("returns smoke for response_time_sla", () => {
      expect(classifier.markerFor("response_time_sla")).toBe("smoke");
    });

    it("returns smoke for response_schema_validation", () => {
      expect(classifier.markerFor("response_schema_validation")).toBe("smoke");
    });

    it("returns smoke for auth_happy_path", () => {
      expect(classifier.markerFor("auth_happy_path")).toBe("smoke");
    });
  });

  describe("markerFor() — auth-negative (regression) types", () => {
    const classifier = new MarkerClassifier();

    it("returns regression for no_auth_returns_401", () => {
      expect(classifier.markerFor("no_auth_returns_401")).toBe("regression");
    });

    it("returns regression for garbage_token_returns_401", () => {
      expect(classifier.markerFor("garbage_token_returns_401")).toBe("regression");
    });

    it("returns regression for method_not_allowed", () => {
      expect(classifier.markerFor("method_not_allowed")).toBe("regression");
    });
  });

  describe("markerFor() — body-negative (regression) types", () => {
    const classifier = new MarkerClassifier();

    it("returns regression for malformed_json_returns_400", () => {
      expect(classifier.markerFor("malformed_json_returns_400")).toBe("regression");
    });

    it("returns regression for required_field_omission_returns_400", () => {
      expect(classifier.markerFor("required_field_omission_returns_400")).toBe("regression");
    });

    it("returns regression for type_violation_returns_400", () => {
      expect(classifier.markerFor("type_violation_returns_400")).toBe("regression");
    });

    it("returns regression for boundary_battery", () => {
      expect(classifier.markerFor("boundary_battery")).toBe("regression");
    });
  });

  describe("markerFor() — method-specific (regression) types", () => {
    const classifier = new MarkerClassifier();

    it("returns regression for get_idempotency", () => {
      expect(classifier.markerFor("get_idempotency")).toBe("regression");
    });

    it("returns regression for delete_idempotency", () => {
      expect(classifier.markerFor("delete_idempotency")).toBe("regression");
    });
  });

  describe("markerFor() — DB-state (regression) type", () => {
    const classifier = new MarkerClassifier();

    it("returns regression for db_state_matches_expectation", () => {
      expect(classifier.markerFor("db_state_matches_expectation")).toBe("regression");
    });
  });

  describe("markerFor() — assertion sentinel (issue #67)", () => {
    const classifier = new MarkerClassifier();

    it("returns SMOKE for the assertion sentinel — matches docs/test-catalog.md and docs/markers-and-lifecycle.md", () => {
      // Declarative assertions are CORRECTNESS checks (business rules);
      // they belong with the happy-path smoke catalog so that the most
      // common CI pattern (`apiwright run --markers smoke`) actually
      // executes user-declared assertions instead of silently skipping
      // them. See issue #67.
      expect(classifier.markerFor("assertion")).toBe("smoke");
    });
  });
});

describe("expandMarkerSelection", () => {
  describe("all → smoke + regression", () => {
    it("expands all to include smoke and regression but not e2e", () => {
      const result = expandMarkerSelection(["all"]);
      expect(result).toContain("smoke");
      expect(result).toContain("regression");
      expect(result).not.toContain("e2e");
    });

    it("expands all to exactly smoke and regression (no extras)", () => {
      const result = expandMarkerSelection(["all"]);
      expect(result).toHaveLength(2);
    });
  });

  describe("explicit markers are passed through", () => {
    it("returns smoke for [smoke] selection", () => {
      const result = expandMarkerSelection(["smoke"]);
      expect(result).toContain("smoke");
      expect(result).not.toContain("regression");
    });

    it("returns regression for [regression] selection", () => {
      const result = expandMarkerSelection(["regression"]);
      expect(result).toContain("regression");
      expect(result).not.toContain("smoke");
    });

    it("returns e2e for [e2e] selection (reserved in v1.0; no cases generated)", () => {
      const result = expandMarkerSelection(["e2e"]);
      expect(result).toContain("e2e");
    });
  });

  describe("deduplication", () => {
    it("deduplicates smoke when smoke appears twice", () => {
      const result = expandMarkerSelection(["smoke", "smoke"]);
      const smokeCount = result.filter((m) => m === "smoke").length;
      expect(smokeCount).toBe(1);
    });

    it("deduplicates smoke that appears directly and via all", () => {
      const result = expandMarkerSelection(["smoke", "all"]);
      const smokeCount = result.filter((m) => m === "smoke").length;
      expect(smokeCount).toBe(1);
    });
  });

  describe("unknown selectors are dropped", () => {
    it("drops unknown/bogus selectors silently", () => {
      const result = expandMarkerSelection(["bogus" as never]);
      expect(result).not.toContain("bogus");
    });

    it("returns empty array for all-unknown selection", () => {
      const result = expandMarkerSelection(["bogus" as never, "invalid" as never]);
      expect(result).toHaveLength(0);
    });
  });

  describe("empty selection", () => {
    it("returns empty array for empty input", () => {
      const result = expandMarkerSelection([]);
      expect(result).toHaveLength(0);
    });
  });

  describe("stable output order", () => {
    it("returns markers in a stable order (smoke before regression)", () => {
      const result = expandMarkerSelection(["all"]);
      const smokeIdx = result.indexOf("smoke");
      const regressionIdx = result.indexOf("regression");
      expect(smokeIdx).toBeLessThan(regressionIdx);
    });
  });
});
