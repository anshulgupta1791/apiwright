/**
 * Postman variable templater: rewrites {{var}} references to ${env.*} tokens.
 *
 * The target grammar for env references is defined in src/env/template-resolver.ts:
 * ${env.NAME} where NAME = [A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*
 *
 * Pure: returns a deep-copied rewritten request; the input is never mutated.
 * Never throws. Emits warnings for empty names, sanitized names, and
 * unbalanced braces.
 */

import type { FlattenedRequest } from "../types.js";

/** Result of rewriting one FlattenedRequest's variable references. */
export interface VariableRewriteResult {
  /** A new FlattenedRequest with all rewrites applied (input not mutated). */
  request: FlattenedRequest;
  /** Warnings (sanitizations, unbalanced braces). */
  warnings: string[];
}

/**
 * Token recognition regex: matches {{anything}} non-greedily, no nested braces.
 * Named capture group 1 = inner content (will be trimmed).
 */
const POSTMAN_VAR_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/**
 * Legal env NAME grammar: [A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*
 * Allows dotted names (e.g. auth.token).
 */
const LEGAL_NAME_RE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

/** Maximum characters to include in unbalanced-braces warning snippets. */
const SNIPPET_MAX_LEN = 60;

/**
 * Rewrites every Postman {{var}} reference to ${env.<name>} across url,
 * header values, query values, and a raw body string. Pure.
 */
export class PostmanVariableTemplater {
  /**
   * Rewrites every Postman {{var}} reference to ${env.<name>} across url,
   * header values, query values, and a raw body string. Pure: returns a
   * deep-copied rewritten request; the input is never mutated.
   * @param request - The flattened request to rewrite.
   * @returns The rewritten request plus warnings.
   */
  rewrite(request: FlattenedRequest): VariableRewriteResult {
    const warnings: string[] = [];
    // Per-request sanitization map: original→sanitized, to detect collisions
    const sanitizeMap = new Map<string, string>();
    const usedSanitized = new Map<string, string>(); // sanitized→first original

    const rewriteString = (text: string, fieldLabel: string): string => {
      const result = text.replace(POSTMAN_VAR_RE, (match, inner: string) => {
        const trimmed = inner.trim();

        // Case 1: Empty name
        if (trimmed === "") {
          warnings.push(`Empty variable reference left as-is in ${fieldLabel}`);
          return match; // leave literal {{...}}
        }

        // Case 2: Legal name (already valid)
        if (LEGAL_NAME_RE.test(trimmed)) {
          return `\${env.${trimmed}}`;
        }

        // Case 3: Sanitizable name
        // Check cache first: same illegal name appearing multiple times in one request
        if (sanitizeMap.has(trimmed)) {
          return `\${env.${sanitizeMap.get(trimmed)}}`;
        }

        let sanitized = trimmed
          .replace(/[^A-Za-z0-9_.]/g, "_") // replace illegal chars with _
          .replace(/_+/g, "_") // collapse repeated _
          .replace(/^[_.]+|[_.]+$/g, ""); // trim leading/trailing _-.

        // Handle dotted names with leading/trailing/doubled dots
        // Dots in illegal positions become _ — so replace ..+ with _ and trim
        sanitized = sanitized
          .replace(/\.{2,}/g, "_") // doubled dots → _
          .replace(/^[_.]+|[_.]+$/g, ""); // trim again

        if (sanitized === "") {
          sanitized = "var";
        }

        // Collision detection: if another original already mapped to this sanitized name
        if (
          usedSanitized.has(sanitized) &&
          usedSanitized.get(sanitized) !== trimmed
        ) {
          // Find next available suffix
          let n = 2;
          while (usedSanitized.has(`${sanitized}_${n}`)) {
            n++;
          }
          sanitized = `${sanitized}_${n}`;
        }

        usedSanitized.set(sanitized, trimmed);
        sanitizeMap.set(trimmed, sanitized);

        warnings.push(
          `Variable '${trimmed}' rewritten to '${sanitized}'` +
            ` (illegal characters in \${env.*} grammar)`,
        );
        return `\${env.${sanitized}}`;
      });

      // Check for unbalanced braces in the RESULT
      const remainingOpen = result.includes("{{");
      const remainingClose = result.includes("}}");
      if (remainingOpen || remainingClose) {
        // Build a snippet from the original text (before replacement)
        const snippet =
          text.length > SNIPPET_MAX_LEN ? text.slice(0, SNIPPET_MAX_LEN) : text;
        warnings.push(
          `Unbalanced braces left literal in ${fieldLabel}: "${snippet}"`,
        );
      }

      return result;
    };

    // Deep copy the request (body is conditionally included due to exactOptionalPropertyTypes)
    const rewrittenBody =
      request.body !== undefined
        ? {
            ...request.body,
            raw:
              request.body.mode === "raw"
                ? rewriteString(request.body.raw, "body")
                : request.body.raw,
          }
        : undefined;

    const newRequest: FlattenedRequest = {
      ...request,
      rawUrl: rewriteString(request.rawUrl, "url"),
      headers: request.headers.map((h) => ({
        ...h,
        value: rewriteString(h.value, `header '${h.key}'`),
        // keys are NOT rewritten
      })),
      query: request.query.map((q) => ({
        ...q,
        value: rewriteString(q.value, `query '${q.key}'`),
        // keys are NOT rewritten
      })),
      ...(rewrittenBody !== undefined ? { body: rewrittenBody } : {}),
      // preRequestScript is NOT rewritten (consumed verbatim by auth extractor)
    };

    return { request: newRequest, warnings };
  }
}
