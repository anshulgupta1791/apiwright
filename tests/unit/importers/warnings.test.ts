import { describe, expect, it } from "vitest";

import { Warnings } from "../../../src/importers/warnings.js";

/**
 * Unit tests for the Warnings accumulator.
 *
 * Covers: add, addAll, addAllWithContext, list (defensive copy), size,
 * and all documented edge cases (empty lists, no-ops, insertion order,
 * context prefix format).
 */
describe("Warnings", () => {
  describe("add()", () => {
    it("appends a single message", () => {
      const w = new Warnings();
      w.add("first warning");
      expect(w.list()).toEqual(["first warning"]);
    });

    it("appends multiple messages in insertion order", () => {
      const w = new Warnings();
      w.add("alpha");
      w.add("beta");
      w.add("gamma");
      expect(w.list()).toEqual(["alpha", "beta", "gamma"]);
    });

    it("accepts and stores an empty string", () => {
      const w = new Warnings();
      w.add("");
      expect(w.list()).toEqual([""]);
    });

    it("never throws regardless of input", () => {
      const w = new Warnings();
      expect(() => w.add("any message")).not.toThrow();
    });
  });

  describe("addAll()", () => {
    it("appends every message in order", () => {
      const w = new Warnings();
      w.addAll(["x", "y", "z"]);
      expect(w.list()).toEqual(["x", "y", "z"]);
    });

    it("is a no-op when given an empty array", () => {
      const w = new Warnings();
      w.addAll([]);
      expect(w.list()).toEqual([]);
      expect(w.size).toBe(0);
    });

    it("appends after previously added messages", () => {
      const w = new Warnings();
      w.add("first");
      w.addAll(["second", "third"]);
      expect(w.list()).toEqual(["first", "second", "third"]);
    });

    it("accepts a readonly array (readonly string[])", () => {
      const w = new Warnings();
      const msgs: readonly string[] = ["a", "b"] as const;
      w.addAll(msgs);
      expect(w.list()).toEqual(["a", "b"]);
    });
  });

  describe("addAllWithContext()", () => {
    it("prefixes each message with [context] tag", () => {
      const w = new Warnings();
      w.addAllWithContext("MyRequest", ["body not JSON", "url empty"]);
      expect(w.list()).toEqual([
        "[MyRequest] body not JSON",
        "[MyRequest] url empty",
      ]);
    });

    it("is a no-op when the messages array is empty", () => {
      const w = new Warnings();
      w.addAllWithContext("RequestName", []);
      expect(w.list()).toEqual([]);
      expect(w.size).toBe(0);
    });

    it("preserves insertion order across multiple addAllWithContext calls", () => {
      const w = new Warnings();
      w.addAllWithContext("A", ["a1"]);
      w.addAllWithContext("B", ["b1", "b2"]);
      expect(w.list()).toEqual(["[A] a1", "[B] b1", "[B] b2"]);
    });

    it("interleaves correctly with add() and addAll()", () => {
      const w = new Warnings();
      w.add("standalone");
      w.addAllWithContext("Req", ["ctx warning"]);
      expect(w.list()).toEqual(["standalone", "[Req] ctx warning"]);
    });
  });

  describe("list()", () => {
    it("returns an empty array when no messages have been added", () => {
      const w = new Warnings();
      expect(w.list()).toEqual([]);
    });

    it("returns a defensive copy — mutating the return value does not affect internal state", () => {
      const w = new Warnings();
      w.add("persistent");
      const result = w.list();
      result.push("injected");
      expect(w.list()).toEqual(["persistent"]);
    });

    it("is callable multiple times returning the same content", () => {
      const w = new Warnings();
      w.add("msg");
      expect(w.list()).toEqual(w.list());
    });
  });

  describe("size", () => {
    it("returns 0 initially", () => {
      const w = new Warnings();
      expect(w.size).toBe(0);
    });

    it("increments with each add()", () => {
      const w = new Warnings();
      w.add("a");
      expect(w.size).toBe(1);
      w.add("b");
      expect(w.size).toBe(2);
    });

    it("increments by the count of messages in addAll()", () => {
      const w = new Warnings();
      w.addAll(["x", "y", "z"]);
      expect(w.size).toBe(3);
    });

    it("stays 0 after addAll([]) no-op", () => {
      const w = new Warnings();
      w.addAll([]);
      expect(w.size).toBe(0);
    });

    it("stays 0 after addAllWithContext with empty list", () => {
      const w = new Warnings();
      w.addAllWithContext("ctx", []);
      expect(w.size).toBe(0);
    });

    it("increments by count of messages in addAllWithContext()", () => {
      const w = new Warnings();
      w.addAllWithContext("X", ["p", "q"]);
      expect(w.size).toBe(2);
    });
  });
});
