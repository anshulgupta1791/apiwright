/**
 * Postman auth extractor: derives auth_strategy from request-level auth blocks
 * and pre-request scripts via a CLOSED ALLOWLIST with string/regex matching only.
 *
 * SECURITY BOUNDARY: Scripts are NEVER executed, eval'd, Function-constructed,
 * vm-run, or require'd. Only string/regex matching against a closed allowlist
 * and a closed denylist. The module imports no vm, child_process, or eval;
 * this is enforced by the security-auditor and asserted structurally.
 *
 * CLOSED ALLOWLIST (exhaustive, documented below):
 *
 * A. Request-level auth block (checked first):
 *    - bearer → user_token
 *    - basic  → basic_auth
 *    - apikey → api_key
 *    - other  → fall through to script check (or warn if no script)
 *
 * B. Pre-request script — single effective statement matching one of 4 forms:
 *    Form 1: pm.environment.set('token', ...) → user_token
 *    Form 2: pm.collectionVariables.set('token'|'accessToken'|'access_token', ...) → user_token
 *    Form 3: pm.request.headers.add({key:'Authorization', value:'Bearer '+...}) → user_token
 *    Form 4: pm.request.headers.upsert({key:'Authorization', value:'Bearer '+...}) → user_token
 *
 * C. Empty/whitespace-only script + no auth block → no strategy, no warning.
 *
 * DENYLIST (disqualifies script from allowlist matching):
 *    Control flow: if, for, while, switch, case, ?, &&, ||, =>, function
 *    Network: pm.sendRequest, pm.execution, fetch, require(, XMLHttpRequest
 *    Crypto/signing: crypto, CryptoJS, hmac, sha256, sha1, md5, sign, Buffer
 *    Process/fs/eval: process, eval, Function, child_process, fs., import(,
 *                     globalThis, __proto__
 *    More than one effective statement
 */

import type { FlattenedRequest } from "../types.js";

/** Result of auth strategy extraction. */
export interface AuthExtractionResult {
  /** Detected canonical auth strategy name, or undefined when none/unsure. */
  authStrategy?: string;
  /** Warnings (manual-review prompts naming the request). */
  warnings: string[];
}

/**
 * Regex for removing single-line (//) and multi-line (/* *\/) comments
 * from a script string. Used before effective-statement counting.
 */
const LINE_COMMENT_RE = /\/\/[^\n]*/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

/**
 * Form 1 regex: pm.environment.set('token', <simple RHS>)
 * RHS must not contain ; or () to prevent complex expressions.
 * Allows single/double/backtick quotes.
 */
const FORM1_RE = /^pm\.environment\.set\(\s*['"`]token['"`]\s*,\s*[^;()]+\)$/;

/**
 * Form 2 regex: pm.collectionVariables.set('token'|'accessToken'|'access_token', <simple RHS>)
 */
const FORM2_RE =
  /^pm\.collectionVariables\.set\(\s*['"`](?:token|accessToken|access_token)['"`]\s*,\s*[^;()]+\)$/;

/**
 * Form 3 regex: pm.request.headers.add({key:'Authorization', value:'Bearer '+...})
 * Case-insensitive on key/value; value must start with 'Bearer ' (case-insensitive).
 */
const FORM3_RE =
  /^pm\.request\.headers\.add\(\s*\{[^{}]*key\s*:\s*['"`]authorization['"`][^{}]*value\s*:\s*['"`][Bb]earer\s/i;

/**
 * Form 4 regex: pm.request.headers.upsert({key:'Authorization', value:'Bearer '+...})
 */
const FORM4_RE =
  /^pm\.request\.headers\.upsert\(\s*\{[^{}]*key\s*:\s*['"`]authorization['"`][^{}]*value\s*:\s*['"`][Bb]earer\s/i;

/**
 * Denylist patterns. All patterns are lowercase; matching is case-insensitive
 * (the effective script is lowercased before checking). This prevents bypass
 * via mixed-case variants such as PROCESS.exit or Eval(...).
 */
const DENYLIST_PATTERNS = [
  "if",
  "for",
  "while",
  "switch",
  "case",
  "?",
  "&&",
  "||",
  "=>",
  "function",
  "pm.sendrequest",
  "pm.execution",
  "fetch",
  "require(",
  "xmlhttprequest",
  "crypto",
  "cryptojs",
  "hmac",
  "sha256",
  "sha1",
  "md5",
  "sign",
  "buffer",
  "process",
  "eval",
  "child_process",
  "fs.",
  "import(",
  "globalthis",
  "__proto__",
];

/** Request-level auth type → canonical strategy name mapping. */
const AUTH_TYPE_MAP: Record<string, string> = {
  bearer: "user_token",
  basic: "basic_auth",
  apikey: "api_key",
};

/**
 * Derives auth_strategy ONLY for the closed allowlist. Anything outside it
 * leaves authStrategy unset and emits a manual-review warning naming the
 * request. The script is string-matched only — never executed.
 */
export class PostmanAuthExtractor {
  /**
   * Derives auth_strategy ONLY for the closed allowlist below. Anything
   * outside it leaves authStrategy unset and emits a manual-review warning
   * naming the request. The script is string-matched only — never executed.
   * @param request - The flattened request.
   * @returns Result with optional authStrategy and zero or more warnings.
   */
  extract(request: FlattenedRequest): AuthExtractionResult {
    // Precedence A: Request-level auth block
    const authResult = this.#tryAuthBlock(request);
    if (authResult !== null) return authResult;

    // Precedence B: Pre-request script
    return this.#tryScript(request);
  }

  /**
   * Attempts to derive a strategy from the request-level auth block.
   * @param request - The flattened request to check.
   * @returns A result if the auth block yields a decision, null to fall through.
   */
  #tryAuthBlock(request: FlattenedRequest): AuthExtractionResult | null {
    if (!request.auth) return null;
    const lowerType = request.auth.type.toLowerCase();
    const strategy = AUTH_TYPE_MAP[lowerType];
    if (strategy !== undefined) {
      return { authStrategy: strategy, warnings: [] };
    }
    // Unsupported auth type — fall through to script (but keep auth for later)
    return null;
  }

  /**
   * Attempts to derive a strategy from the pre-request script.
   * @param request - The flattened request to check.
   * @returns Result with optional authStrategy and warnings.
   */
  #tryScript(request: FlattenedRequest): AuthExtractionResult {
    const stripped = this.#stripComments(request.preRequestScript);
    const effective = stripped.trim();

    // Case C: Empty/whitespace script + no auth → no strategy, no warning
    if (effective === "" && !request.auth) {
      return { warnings: [] };
    }

    // Unsupported auth type + empty effective script
    if (effective === "" && request.auth) {
      return {
        warnings: [
          `Request '${request.name}' uses unsupported auth type '${request.auth.type}';` +
            ` set auth_strategy manually`,
        ],
      };
    }

    return this.#matchScript(request.name, effective);
  }

  /**
   * Matches a non-empty effective script against the denylist and allowlist.
   * @param requestName - The request name, for warning messages.
   * @param effective - Comment-stripped, trimmed script text.
   * @returns Result with optional authStrategy and warnings.
   */
  #matchScript(requestName: string, effective: string): AuthExtractionResult {
    const outsideAllowlist: AuthExtractionResult = {
      warnings: [
        `Request '${requestName}' has a pre-request script outside the recognized` +
          ` allowlist; review auth manually`,
      ],
    };

    if (this.#hasDenylistMatch(effective)) return outsideAllowlist;
    if (this.#countEffectiveStatements(effective) !== 1)
      return outsideAllowlist;

    const singleStatement = effective.replace(/;\s*$/, "").trim();
    if (this.#matchesAllowlist(singleStatement)) {
      return { authStrategy: "user_token", warnings: [] };
    }

    return {
      warnings: [
        `Request '${requestName}' pre-request script not in the recognized auth allowlist;` +
          ` review manually`,
      ],
    };
  }

  /**
   * Tests whether a single statement matches one of the four recognized auth forms.
   * @param stmt - The trimmed statement without trailing semicolon.
   * @returns True when the statement is in the closed allowlist.
   */
  #matchesAllowlist(stmt: string): boolean {
    return (
      FORM1_RE.test(stmt) ||
      FORM2_RE.test(stmt) ||
      FORM3_RE.test(stmt) ||
      FORM4_RE.test(stmt)
    );
  }

  /**
   * Strips single-line and block comments from a script string.
   * @param script - The script text to strip comments from.
   * @returns Script text with comments removed.
   */
  #stripComments(script: string): string {
    return script.replace(BLOCK_COMMENT_RE, "").replace(LINE_COMMENT_RE, "");
  }

  /**
   * Checks whether the effective script text contains any denylist pattern.
   * Comparison is case-insensitive: the effective text is lowercased before
   * matching. Denylist patterns are already stored in lowercase.
   * @param effective - Comment-stripped script text.
   * @returns True when any denylist pattern is found.
   */
  #hasDenylistMatch(effective: string): boolean {
    const lowered = effective.toLowerCase();
    for (const pattern of DENYLIST_PATTERNS) {
      if (lowered.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Counts effective (non-empty) statements in a comment-stripped script.
   * Splits on semicolons and newlines, filters empty fragments.
   * @param effective - Comment-stripped script text.
   * @returns Number of non-empty statement fragments.
   */
  #countEffectiveStatements(effective: string): number {
    const fragments = effective
      .split(/[;\n]/)
      .map((f) => f.trim())
      .filter((f) => f !== "");
    return fragments.length;
  }
}
