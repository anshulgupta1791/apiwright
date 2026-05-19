/**
 * Compile and safety-validate the `matches` operand at parse time.
 * Produces a Layer-A RegexOperand from a `/pattern/flags` literal or a bare
 * pattern. NEVER throws; faults are returned in an aggregated Result.
 */

import type { RegexFlag, RegexOperand } from "./types.js";

/**
 * Maximum length, in UTF-16 code units, of a string a compiled `matches`
 * regex may be tested against AT EVALUATION TIME (~64 KB). THIS TASK OWNS AND
 * EXPORTS THE CONSTANT BUT DOES NOT ENFORCE IT. The pattern-evaluator task
 * imports this `const` and rejects any target whose `.length` exceeds it.
 */
export const MAX_REGEX_TARGET_LENGTH = 65536;

/** Whitelisted flag characters (the canonical set). Frozen; one edit point. */
const WHITELISTED_FLAGS: readonly RegexFlag[] = Object.freeze(["i", "m", "s", "u"]);
const WHITELIST_SET = new Set<string>(WHITELISTED_FLAGS);
/** Canonical sort order: i, m, s, u. */
const FLAG_ORDER: Record<string, number> = { i: 0, m: 1, s: 2, u: 3 };
/** Fallback sort weight for an unrecognised flag character (unreachable path). */
const UNKNOWN_FLAG_SORT_WEIGHT = 99;

/**
 * No-throw result of compiling ONE `matches` operand lexeme. The failure side
 * AGGREGATES every fault found while compiling this single operand.
 */
export type RegexCompileResult =
  | { readonly ok: true; readonly operand: RegexOperand }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Compiles + safety-validates a single `matches` operand lexeme into a
 * Layer-A RegexOperand. Pure, deterministic, and TOTAL: it NEVER throws.
 * One concrete compiler, no variant behaviour.
 */
export class RegexOperandCompiler {
  /**
   * Validates the flag whitelist and compiles the pattern with native RegExp
   * AT PARSE TIME. NEVER throws.
   * @param lexeme - The verbatim `matches` operand text.
   * @returns A RegexCompileResult.
   */
  compile(lexeme: string): RegexCompileResult {
    const { source, rawFlags } = this.#splitLexeme(lexeme);

    const { flags, errors: flagErrors } = this.#validateFlags(rawFlags);

    const allErrors: string[] = [...flagErrors];

    // Attempt compile-to-validate using the valid flags subset
    const joinedFlags = flags.join("");
    const compileResult = this.#tryCompile(source, joinedFlags);

    if (compileResult.ok) {
      if (allErrors.length > 0) {
        return { ok: false, errors: allErrors };
      }
      const operand: RegexOperand = {
        kind: "regex",
        source,
        rawFlags,
        flags,
        compiled: compileResult.re,
      };
      return { ok: true, operand };
    } else {
      allErrors.push(compileResult.error);
      return { ok: false, errors: allErrors };
    }
  }

  /**
   * Detect form (literal vs bare) and derive source + rawFlags.
   * Uses the same bounded, escape- and class-aware scan as Layer-B.
   * @param lexeme - The verbatim operand text to split.
   * @returns The `source` pattern body and `rawFlags` string.
   */
  #splitLexeme(lexeme: string): { source: string; rawFlags: string } {
    if (lexeme.length >= 2 && lexeme[0] === "/") {
      const closingIdx = this.#findClosingDelimiter(lexeme);
      if (closingIdx !== -1) {
        const source = lexeme.slice(1, closingIdx);
        const rawFlags = lexeme.slice(closingIdx + 1);
        return { source, rawFlags };
      }
    }
    // Bare form
    return { source: lexeme, rawFlags: "" };
  }

  /**
   * Find the index of the closing `/` delimiter in a literal-form lexeme,
   * using the escape- and class-aware bounded hand loop.
   * @param lexeme - A lexeme starting with `/`.
   * @returns The 0-based index of the closing `/`, or -1 if not found.
   */
  #findClosingDelimiter(lexeme: string): number {
    let i = 1; // skip opening `/`
    let inClass = false;
    while (i < lexeme.length) {
      const c = lexeme[i];
      if (c === undefined) break;
      if (c === "\\") {
        i += 2; // consume escape pair
        continue;
      }
      if (c === "[" && !inClass) {
        inClass = true;
        i++;
        continue;
      }
      if (c === "]" && inClass) {
        inClass = false;
        i++;
        continue;
      }
      if (c === "/" && !inClass) {
        return i;
      }
      i++;
    }
    return -1;
  }

  /**
   * Validate rawFlags against the whitelist. Returns the deduped, sorted
   * canonical `flags` array and any aggregated error messages.
   * @param rawFlags - The verbatim flag characters from the lexeme.
   * @returns The canonical `flags` array and any accumulated `errors`.
   */
  #validateFlags(rawFlags: string): { flags: readonly RegexFlag[]; errors: string[] } {
    const errors: string[] = [];
    const seen = new Set<string>();
    const validSeen = new Set<string>();

    for (let i = 0; i < rawFlags.length; i++) {
      const ch = rawFlags[i];
      if (ch === undefined) continue;
      if (!WHITELIST_SET.has(ch)) {
        errors.push(`Bad regex flag '${ch}'`);
      } else if (seen.has(ch)) {
        errors.push(`Duplicate regex flag '${ch}'`);
      } else {
        seen.add(ch);
        validSeen.add(ch);
      }
    }

    // Build sorted canonical flags
    const flags: RegexFlag[] = [...validSeen]
      .filter((f): f is RegexFlag => WHITELIST_SET.has(f))
      .sort(
        (a, b) => (FLAG_ORDER[a] ?? UNKNOWN_FLAG_SORT_WEIGHT) -
          (FLAG_ORDER[b] ?? UNKNOWN_FLAG_SORT_WEIGHT),
      );

    return { flags, errors };
  }

  /**
   * No-throw wrapper around `new RegExp`. Returns ok:true with the compiled
   * RegExp on success, or ok:false with the error message on failure.
   * The non-Error catch arm is justified: `RegExp` only throws `SyntaxError`,
   * which is always an `Error`. The `String(err)` fallback is a provably-
   * unreachable defensive guard, identical to the approved `safe-json.ts`
   * precedent.
   * @param source - The regex pattern body.
   * @param joinedFlags - The canonical-ordered flags string (no invalid flags).
   * @returns Ok with the compiled RegExp, or failure with the error message.
   */
  #tryCompile(
    source: string,
    joinedFlags: string,
  ): { ok: true; re: RegExp } | { ok: false; error: string } {
    try {
      const re = new RegExp(source, joinedFlags);
      return { ok: true, re };
    } catch (err: unknown) {
      // istanbul ignore next — RegExp only throws SyntaxError (an Error); the non-Error arm is
      // a provably-unreachable defensive guard, identical to the safe-json.ts precedent.
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Invalid regex pattern in \`matches\` operand: ${msg}` };
    }
  }
}
