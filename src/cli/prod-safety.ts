/**
 * Production safety gate for the APIWright CLI.
 *
 * Implements the decision table from V1_BUILD_SPEC.md §7 (lines 517–521).
 * Every collaborator (prompt, env, CI detection) is injectable so the full
 * truth table is testable without touching process.env or stdin.
 */

import { createInterface } from "node:readline";

import type { Marker } from "./config/types.js";

/** Exact prompt string specified in V1_BUILD_SPEC.md §7. */
const PROD_PROMPT =
  "WARNING: You are about to run non-smoke tests against prod. Type 'CONFIRM' to proceed:";

/** Env var that must equal "true" (exact string) to override CI fail-fast. */
const ALLOW_ENV_VAR = "ALLOW_PROD_DESTRUCTIVE";

/**
 * Discriminated result of {@link ProdSafetyGate.evaluate}.
 * ok → allowed:true; blocked → allowed:false with a reason string.
 */
export type ProdSafetyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Reads a single confirmation line from the user.
 *
 * Pluggable boundary: tests inject a scripted answer; production uses
 * {@link StdinConfirmationPrompt}.
 */
export interface ConfirmationPrompt {
  /**
   * Writes `question` and resolves with the user's typed line (trimmed of
   * the trailing newline only — NOT surrounding whitespace).
   * @param question - The question string to display.
   * @returns The user's input.
   */
  ask(question: string): Promise<string>;
}

/**
 * Default `ConfirmationPrompt` implementation that reads from stdin via
 * Node's readline interface.
 */
export class StdinConfirmationPrompt implements ConfirmationPrompt {
  readonly #input: NodeJS.ReadableStream;
  readonly #output: NodeJS.WritableStream;

  /**
   * Creates a StdinConfirmationPrompt with injectable I/O streams.
   * @param io - Optional input/output stream overrides.
   * @param io.input - Readable stream for user input (default process.stdin).
   * @param io.output - Writable stream for prompt display (default process.stdout).
   */
  constructor(io?: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
  }) {
    this.#input = io?.input ?? process.stdin;
    this.#output = io?.output ?? process.stdout;
  }

  /* istanbul ignore next — real interactive stdin readline I/O is
     uninstrumentable; gate + prompt logic is tested via injected prompt */
  /**
   * Displays the question on output and reads one line from input.
   * @param question - The prompt text to display.
   * @returns The user's response (trailing newline stripped).
   */
  ask(question: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: this.#input,
        output: this.#output,
      });
      rl.question(`${question} `, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}

/** Options accepted by {@link ProdSafetyGate}. */
export interface ProdSafetyOptions {
  /** Prompt seam. Default new StdinConfirmationPrompt(). */
  prompt?: ConfirmationPrompt;
  /**
   * Env source for CI detection + ALLOW_PROD_DESTRUCTIVE. Default
   * process.env.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * CI detection seam. Default: (env) => Boolean(env.CI). Injectable so
   * both branches are deterministically testable.
   */
  isCi?: (env: NodeJS.ProcessEnv) => boolean;
}

/**
 * Evaluates whether a run may proceed against prod.
 *
 * Decision table (V1_BUILD_SPEC.md §7):
 * - non-prod: always allowed
 * - prod + smoke-only: allowed (no prompt)
 * - prod + non-smoke, interactive: prompt; exact "CONFIRM" → allowed
 * - prod + non-smoke, CI, no flag: fail-fast (no prompt)
 * - prod + non-smoke, CI, flag + ALLOW_PROD_DESTRUCTIVE="true": allowed
 * - prod + non-smoke, CI, flag + ALLOW_PROD_DESTRUCTIVE≠"true": abort
 */
export class ProdSafetyGate {
  readonly #prompt: ConfirmationPrompt;
  readonly #env: NodeJS.ProcessEnv;
  readonly #isCi: (env: NodeJS.ProcessEnv) => boolean;

  /**
   * Creates a ProdSafetyGate with injectable collaborators.
   * @param options - Injectable collaborators (prompt, env, isCi).
   */
  constructor(options: ProdSafetyOptions = {}) {
    this.#prompt = options.prompt ?? new StdinConfirmationPrompt();
    this.#env = options.env ?? process.env;
    this.#isCi = options.isCi ?? ((env) => Boolean(env["CI"]));
  }

  /**
   * Decides whether the run may proceed.
   *
   * Pure decision + at most one prompt; runs NO tests; never throws.
   * @param args - The evaluation arguments.
   * @param args.prodEnvironment - True when the resolved env is prod.
   * @param args.markers - Resolved (de-`all`-expanded) markers.
   * @param args.allowNonSmokeInProd - Whether --allow-non-smoke-in-prod was passed.
   * @returns A {@link ProdSafetyDecision}.
   */
  async evaluate(args: {
    prodEnvironment: boolean;
    markers: Marker[];
    allowNonSmokeInProd: boolean;
  }): Promise<ProdSafetyDecision> {
    const { prodEnvironment, markers, allowNonSmokeInProd } = args;

    if (!prodEnvironment) {
      return { allowed: true };
    }

    const hasNonSmoke = markers.some((m) => m !== "smoke");
    if (!hasNonSmoke) {
      return { allowed: true };
    }

    const ci = this.#isCi(this.#env);

    if (ci) {
      const envVarValue = this.#env[ALLOW_ENV_VAR];
      if (allowNonSmokeInProd && envVarValue === "true") {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason:
          "CI fail-fast: non-smoke markers against prod require " +
          `--allow-non-smoke-in-prod and ${ALLOW_ENV_VAR}=true`,
      };
    }

    // Interactive: prompt
    const answer = await this.#prompt.ask(PROD_PROMPT);
    if (answer === "CONFIRM") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "User did not confirm. Run aborted.",
    };
  }
}
