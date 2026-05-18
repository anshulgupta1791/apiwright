import { describe, it, expect } from "vitest";

import {
  makeTestCaseId,
  TestCaseIdFactory,
} from "../../../src/test-catalog/test-case-id.js";

/**
 * Unit tests for the TestCaseId module.
 *
 * Covers: deterministic id derivation, regex character class enforcement,
 * ordinal disambiguation, uppercase/illegal-char sanitization, and the
 * stateless TestCaseIdFactory OOP wrapper.
 */
describe("makeTestCaseId", () => {
  describe("determinism", () => {
    it("returns the same id for the same arguments on consecutive calls", () => {
      const a = makeTestCaseId("users.create", "status_code_conformance", 0);
      const b = makeTestCaseId("users.create", "status_code_conformance", 0);
      expect(a).toBe(b);
    });

    it("produces different ids for different ordinals", () => {
      const a = makeTestCaseId("ep.id", "required_field_omission_returns_400", 0);
      const b = makeTestCaseId("ep.id", "required_field_omission_returns_400", 1);
      expect(a).not.toBe(b);
    });

    it("produces different ids for different test types", () => {
      const a = makeTestCaseId("ep.id", "status_code_conformance", 0);
      const b = makeTestCaseId("ep.id", "content_type_alignment", 0);
      expect(a).not.toBe(b);
    });

    it("produces different ids for different endpoint ids", () => {
      const a = makeTestCaseId("ep.one", "auth_happy_path", 0);
      const b = makeTestCaseId("ep.two", "auth_happy_path", 0);
      expect(a).not.toBe(b);
    });
  });

  describe("character class enforcement — matches ^[a-z0-9._-]+$", () => {
    it("produces an id matching the allowed character regex", () => {
      const id = makeTestCaseId("users.create", "status_code_conformance", 0);
      expect(id).toMatch(/^[a-z0-9._-]+$/);
    });

    it("replaces uppercase letters with lowercase via sanitization", () => {
      // If an endpointId contained uppercase (shouldn't happen post-validation
      // but the function is defensive) it should still produce a valid id
      const id = makeTestCaseId("users.Create", "status_code_conformance", 0);
      expect(id).toMatch(/^[a-z0-9._-]+$/);
    });

    it("replaces illegal characters with dashes", () => {
      const id = makeTestCaseId("ep@id", "status_code_conformance", 0);
      expect(id).toMatch(/^[a-z0-9._-]+$/);
    });

    it("handles the assertion sentinel type", () => {
      const id = makeTestCaseId("ep.id", "assertion", 0);
      expect(id).toMatch(/^[a-z0-9._-]+$/);
    });
  });

  describe("id structure", () => {
    it("includes the endpointId, type, and ordinal in the output", () => {
      const id = makeTestCaseId("users.create", "auth_happy_path", 3);
      expect(id).toContain("users.create");
      expect(id).toContain("auth-happy-path");
      expect(id).toContain("3");
    });

    it("formats as <endpointId>.<type>.<ordinal> after sanitization", () => {
      const id = makeTestCaseId("ep.id", "get_idempotency", 0);
      // underscores in type name → sanitized to hyphens; dots join segments
      expect(id).toBe("ep.id.get-idempotency.0");
    });

    it("uses ordinal 0 for single-instance test types", () => {
      const id = makeTestCaseId("ep.id", "delete_idempotency", 0);
      expect(id.endsWith(".0")).toBe(true);
    });
  });
});

describe("TestCaseIdFactory", () => {
  describe("constructor", () => {
    it("constructs with no arguments", () => {
      expect(() => new TestCaseIdFactory()).not.toThrow();
    });
  });

  describe("make()", () => {
    it("delegates to makeTestCaseId and returns the same value", () => {
      const factory = new TestCaseIdFactory();
      const direct = makeTestCaseId("ep.id", "status_code_conformance", 0);
      const viaFactory = factory.make("ep.id", "status_code_conformance", 0);
      expect(viaFactory).toBe(direct);
    });

    it("is deterministic across calls on the same instance", () => {
      const factory = new TestCaseIdFactory();
      const a = factory.make("ep.id", "boundary_battery", 5);
      const b = factory.make("ep.id", "boundary_battery", 5);
      expect(a).toBe(b);
    });

    it("produces regex-valid ids", () => {
      const factory = new TestCaseIdFactory();
      const id = factory.make("test.endpoint", "db_state_matches_expectation", 2);
      expect(id).toMatch(/^[a-z0-9._-]+$/);
    });
  });
});
