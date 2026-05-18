import { describe, it, expect } from "vitest";

import { PlanWarnings } from "../../../src/test-catalog/plan-warnings.js";

/**
 * Unit tests for PlanWarnings (re-export alias of src/importers/warnings.ts Warnings).
 *
 * plan-warnings.ts is a pure re-export with no logic of its own; coverage is
 * transitively exercised by the existing Warnings tests. These tests verify the
 * alias exports correctly and the accumulator contract holds for the test-catalog
 * consumer (non-throwing, insertion-order, addAll, list).
 */
describe("PlanWarnings", () => {
  describe("constructor", () => {
    it("constructs with no arguments", () => {
      expect(() => new PlanWarnings()).not.toThrow();
    });

    it("starts with an empty list", () => {
      const pw = new PlanWarnings();
      expect(pw.list()).toHaveLength(0);
    });
  });

  describe("add()", () => {
    it("appends a message without throwing", () => {
      const pw = new PlanWarnings();
      expect(() => pw.add("test warning")).not.toThrow();
    });

    it("returns messages in insertion order", () => {
      const pw = new PlanWarnings();
      pw.add("first");
      pw.add("second");
      expect(pw.list()).toEqual(["first", "second"]);
    });
  });

  describe("addAll()", () => {
    it("appends all messages from an array", () => {
      const pw = new PlanWarnings();
      pw.addAll(["a", "b", "c"]);
      expect(pw.list()).toHaveLength(3);
    });

    it("preserves order within the added array", () => {
      const pw = new PlanWarnings();
      pw.addAll(["x", "y"]);
      expect(pw.list()).toEqual(["x", "y"]);
    });
  });

  describe("list()", () => {
    it("returns a defensive copy (mutations do not affect the accumulator)", () => {
      const pw = new PlanWarnings();
      pw.add("original");
      const copy = pw.list();
      copy.push("mutated");
      expect(pw.list()).toHaveLength(1);
    });
  });

  describe("size", () => {
    it("reflects the number of accumulated messages", () => {
      const pw = new PlanWarnings();
      expect(pw.size).toBe(0);
      pw.add("one");
      expect(pw.size).toBe(1);
    });
  });
});
