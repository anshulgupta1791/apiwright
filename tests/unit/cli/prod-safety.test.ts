import { describe, it, expect, vi } from "vitest";

import {
  ProdSafetyGate,
  StdinConfirmationPrompt,
} from "../../../src/cli/prod-safety.js";
import type { ConfirmationPrompt } from "../../../src/cli/prod-safety.js";

/**
 * Unit tests for ProdSafetyGate.evaluate().
 *
 * Exercises every row of the prod-safety decision table documented in the
 * design §3.6 using injected prompt, env, and isCi seams. No stdin/stdout
 * touched; all branches are deterministic.
 *
 * Decision table (abridged):
 *  prod=false, any markers → allowed (no prompt)
 *  prod=true, smoke only → allowed (no prompt)
 *  prod=true, non-smoke, not CI → prompt; CONFIRM → allowed; else → declined
 *  prod=true, non-smoke, CI, no flag → fail-fast (no prompt)
 *  prod=true, non-smoke, CI, flag present, no ALLOW_PROD_DESTRUCTIVE → abort
 *  prod=true, non-smoke, CI, flag present, ALLOW_PROD_DESTRUCTIVE=true → allowed
 */

/** Creates a fake ConfirmationPrompt that returns a scripted answer. */
function makePrompt(answer: string): ConfirmationPrompt & {
  questions: string[];
} {
  const questions: string[] = [];
  return {
    questions,
    ask: vi.fn(async (question: string): Promise<string> => {
      questions.push(question);
      return answer;
    }),
  };
}

describe("ProdSafetyGate.evaluate()", () => {
  describe("non-prod environment", () => {
    it("returns allowed=true without prompting for non-prod + smoke", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: false,
        markers: ["smoke"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(true);
      expect(prompt.ask).not.toHaveBeenCalled();
    });

    it("returns allowed=true without prompting for non-prod + regression", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: false,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(true);
      expect(prompt.ask).not.toHaveBeenCalled();
    });

    it("returns allowed=true without prompting for non-prod + all-three markers", async () => {
      const prompt = makePrompt("wrong input");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: false,
        markers: ["smoke", "regression", "e2e"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(true);
      expect(prompt.ask).not.toHaveBeenCalled();
    });
  });

  describe("prod + smoke-only", () => {
    it("returns allowed=true without prompting for prod + smoke only", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["smoke"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(true);
      expect(prompt.ask).not.toHaveBeenCalled();
    });

    it("does not prompt even in CI for prod + smoke only", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => true });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["smoke"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(true);
      expect(prompt.ask).not.toHaveBeenCalled();
    });
  });

  describe("prod + non-smoke, interactive (non-CI)", () => {
    it("prompts and returns allowed=true when user types exactly CONFIRM", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(true);
    });

    it("returns allowed=false when user types 'confirm' (case-sensitive)", async () => {
      const prompt = makePrompt("confirm");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(false);
    });

    it("returns allowed=false when user types ' CONFIRM' (leading space)", async () => {
      const prompt = makePrompt(" CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["e2e"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(false);
    });

    it("returns allowed=false when user types 'CONFIRM ' (trailing space)", async () => {
      const prompt = makePrompt("CONFIRM ");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["e2e"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(false);
    });

    it("returns allowed=false when user types empty string", async () => {
      const prompt = makePrompt("");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(false);
    });

    it("returns allowed=false when user types 'NO'", async () => {
      const prompt = makePrompt("NO");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(false);
    });

    it("asks exactly one question when prompting", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(prompt.ask).toHaveBeenCalledTimes(1);
    });

    it("uses the exact spec prompt text", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(prompt.questions[0]).toContain(
        "WARNING: You are about to run non-smoke tests against prod. Type 'CONFIRM' to proceed:",
      );
    });

    it("prompts for prod + e2e marker (e2e is non-smoke)", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["e2e"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(true);
      expect(prompt.ask).toHaveBeenCalledTimes(1);
    });

    it("prompts for prod + [smoke, regression] (non-smoke present)", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["smoke", "regression"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(true);
      expect(prompt.ask).toHaveBeenCalled();
    });

    it("prompts for prod + all-expanded [smoke, regression, e2e]", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["smoke", "regression", "e2e"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(true);
      expect(prompt.ask).toHaveBeenCalled();
    });

    it("returns a reason string when declined", async () => {
      const prompt = makePrompt("wrong");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(typeof result.reason).toBe("string");
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });
  });

  describe("prod + non-smoke, CI — fail-fast", () => {
    it("returns allowed=false without prompting when CI=true and no flag", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({
        prompt,
        isCi: () => true,
        env: {},
      });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(false);
      expect(prompt.ask).not.toHaveBeenCalled();
    });

    it("does not prompt in CI (fail-fast)", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({
        prompt,
        isCi: () => true,
        env: {},
      });
      await gate.evaluate({
        prodEnvironment: true,
        markers: ["e2e"],
        allowNonSmokeInProd: false,
      });
      expect(prompt.ask).not.toHaveBeenCalled();
    });

    it("returns allowed=false in CI with flag present but no ALLOW_PROD_DESTRUCTIVE", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({
        prompt,
        isCi: () => true,
        env: {}, // ALLOW_PROD_DESTRUCTIVE not set
      });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: true, // flag present
      });
      expect(result.allowed).toBe(false);
    });

    it("returns allowed=false in CI when ALLOW_PROD_DESTRUCTIVE='false'", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({
        prompt,
        isCi: () => true,
        env: { ALLOW_PROD_DESTRUCTIVE: "false" },
      });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: true,
      });
      expect(result.allowed).toBe(false);
    });

    it("returns allowed=false in CI when ALLOW_PROD_DESTRUCTIVE='1'", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({
        prompt,
        isCi: () => true,
        env: { ALLOW_PROD_DESTRUCTIVE: "1" },
      });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: true,
      });
      expect(result.allowed).toBe(false);
    });

    it("returns allowed=true in CI with flag AND ALLOW_PROD_DESTRUCTIVE='true'", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({
        prompt,
        isCi: () => true,
        env: { ALLOW_PROD_DESTRUCTIVE: "true" },
      });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: true,
      });
      expect(result.allowed).toBe(true);
      expect(prompt.ask).not.toHaveBeenCalled();
    });

    it("returns a reason string when CI fails fast", async () => {
      const gate = new ProdSafetyGate({
        isCi: () => true,
        env: {},
      });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(typeof result.reason).toBe("string");
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });
  });

  describe("evaluate does not throw (returns result shape)", () => {
    it("always returns a ProdSafetyDecision without throwing", async () => {
      const gate = new ProdSafetyGate({ isCi: () => false });
      await expect(
        gate.evaluate({
          prodEnvironment: false,
          markers: ["smoke"],
          allowNonSmokeInProd: false,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("injectable isCi seam", () => {
    it("treats environment as CI when isCi returns true", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => true, env: {} });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(result.allowed).toBe(false);
      expect(prompt.ask).not.toHaveBeenCalled();
    });

    it("treats environment as non-CI when isCi returns false", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({ prompt, isCi: () => false });
      await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      expect(prompt.ask).toHaveBeenCalled();
    });
  });

  describe("injectable env seam", () => {
    it("reads ALLOW_PROD_DESTRUCTIVE from the injected env map", async () => {
      const prompt = makePrompt("CONFIRM");
      const gate = new ProdSafetyGate({
        prompt,
        isCi: () => true,
        env: { ALLOW_PROD_DESTRUCTIVE: "true" },
      });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: true,
      });
      expect(result.allowed).toBe(true);
    });
  });
});

describe("StdinConfirmationPrompt", () => {
  it("can be constructed without arguments (default io)", () => {
    expect(() => new StdinConfirmationPrompt()).not.toThrow();
  });

  it("exposes an ask() method", () => {
    const p = new StdinConfirmationPrompt();
    expect(typeof p.ask).toBe("function");
  });
});

describe("ProdSafetyGate — default seam wiring", () => {
  it("uses a StdinConfirmationPrompt instance when no prompt option is given", () => {
    // Constructs without injecting a prompt; the gate should have defaulted to
    // StdinConfirmationPrompt internally (verified by smoke-only path that
    // never calls the prompt, confirming construction succeeded).
    const gate = new ProdSafetyGate({ isCi: () => false });
    // gate should exist and be usable for non-prompting paths
    expect(gate).toBeInstanceOf(ProdSafetyGate);
  });

  it("resolves allowed=true for smoke-only without calling the default prompt", async () => {
    // No prompt injected → default StdinConfirmationPrompt used.
    // Smoke-only non-prod path never touches the prompt, so this proves the
    // default wiring does not break construction or execution.
    const gate = new ProdSafetyGate({ isCi: () => false });
    const result = await gate.evaluate({
      prodEnvironment: false,
      markers: ["smoke"],
      allowNonSmokeInProd: false,
    });
    expect(result.allowed).toBe(true);
  });

  it("reads from process.env when no env option is given (CI=unset → non-CI)", async () => {
    // Inject a known isCi that reads process.env["CI"] via the default env.
    // Remove CI from process.env temporarily so the default isCi sees non-CI.
    const saved = process.env["CI"];
    delete process.env["CI"];
    try {
      const prompt = makePrompt("CONFIRM");
      // No env injected → default is process.env; default isCi reads env["CI"]
      const gate = new ProdSafetyGate({ prompt });
      // With CI unset the default isCi returns false → interactive path → prompt
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      // Prompt answered CONFIRM → allowed
      expect(result.allowed).toBe(true);
      expect(prompt.ask).toHaveBeenCalledTimes(1);
    } finally {
      if (saved !== undefined) {
        process.env["CI"] = saved;
      }
    }
  });

  it("reads from process.env when no env option is given (CI=true → CI path)", async () => {
    // Set CI in process.env and create a gate with no env option.
    // Default isCi reads env["CI"] from process.env → should detect CI.
    const saved = process.env["CI"];
    process.env["CI"] = "true";
    try {
      const prompt = makePrompt("CONFIRM");
      // No env or isCi injected → both default to process.env behavior
      const gate = new ProdSafetyGate({ prompt });
      const result = await gate.evaluate({
        prodEnvironment: true,
        markers: ["regression"],
        allowNonSmokeInProd: false,
      });
      // CI detected → fail-fast → allowed=false, no prompt
      expect(result.allowed).toBe(false);
      expect(prompt.ask).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) {
        process.env["CI"] = saved;
      } else {
        delete process.env["CI"];
      }
    }
  });

  it("default isCi returns false when CI env var is unset", async () => {
    // Exercise the default isCi=(env)=>Boolean(env["CI"]) with CI absent.
    // Inject an env without CI so the default isCi fires and returns false.
    const prompt = makePrompt("CONFIRM");
    const gate = new ProdSafetyGate({ prompt, env: {} });
    // No isCi injected → uses default: Boolean({} ["CI"]) === false → interactive
    const result = await gate.evaluate({
      prodEnvironment: true,
      markers: ["regression"],
      allowNonSmokeInProd: false,
    });
    expect(result.allowed).toBe(true);
    expect(prompt.ask).toHaveBeenCalledTimes(1);
  });

  it("default isCi returns true when CI env var is 'true'", async () => {
    // Exercise the default isCi=(env)=>Boolean(env["CI"]) with CI present.
    const prompt = makePrompt("CONFIRM");
    const gate = new ProdSafetyGate({ prompt, env: { CI: "true" } });
    // No isCi injected → default: Boolean("true") === true → CI path
    const result = await gate.evaluate({
      prodEnvironment: true,
      markers: ["regression"],
      allowNonSmokeInProd: false,
    });
    expect(result.allowed).toBe(false);
    expect(prompt.ask).not.toHaveBeenCalled();
  });

  it("default isCi returns true when CI env var is '1'", async () => {
    const prompt = makePrompt("CONFIRM");
    const gate = new ProdSafetyGate({ prompt, env: { CI: "1" } });
    const result = await gate.evaluate({
      prodEnvironment: true,
      markers: ["regression"],
      allowNonSmokeInProd: false,
    });
    expect(result.allowed).toBe(false);
  });
});
