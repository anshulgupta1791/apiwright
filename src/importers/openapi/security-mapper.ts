/**
 * OpenApiSecurityMapper: maps an operation's effective security to a canonical
 * auth_strategy via a CLOSED allowlist.
 *
 * Security objects are DATA, never executed (no scripts anywhere here —
 * unlike Postman pre-request scripts, OpenAPI security scheme definitions are
 * purely declarative JSON). The closed allowlist is exhaustively enumerated
 * in this module TSDoc so a reviewer can audit the security boundary.
 *
 * CLOSED ALLOWLIST (verbatim, exhaustive):
 *
 * MAPPED:
 *   - 3.x: type:"http", scheme:"bearer"    → "user_token"
 *   - 3.x: type:"http", scheme:"basic"     → "basic_auth"
 *   - 3.x: type:"apiKey" (any `in`)        → "api_key"
 *   - 2.0: type:"basic"                    → "basic_auth"
 *   - 2.0: type:"apiKey" (any `in`)        → "api_key"
 *
 * UNMAPPED (authStrategy unset + manual-review warning):
 *   - type:"oauth2"            (any variant)
 *   - type:"openIdConnect"
 *   - type:"mutualTLS"
 *   - type:"http", scheme not in {"bearer","basic"} (e.g. "digest")
 *   - unresolvable scheme name (not in securitySchemes / securityDefinitions)
 *   - multiple combined schemes in one requirement (AND-set length > 1)
 *   - any other unrecognized type
 *
 * NO AUTH (authStrategy unset, NO warning):
 *   - op.security === undefined (no effective requirement)
 *   - op.security === [] (explicitly no auth)
 */

import { SpecAccess } from "./spec-access.js";
import type { FlattenedOperation, LoadedSpec, SecurityMapResult } from "./types.js";

/** Canonical auth strategy for bearer token. */
const USER_TOKEN = "user_token";
/** Canonical auth strategy for basic auth. */
const BASIC_AUTH = "basic_auth";
/** Canonical auth strategy for API key. */
const API_KEY = "api_key";

/**
 * Maps an operation's effective security to a canonical auth_strategy via a
 * CLOSED allowlist. Unmapped → undefined + manual-review warning. Pure;
 * never throws.
 *
 * See module TSDoc for the exhaustive closed allowlist.
 */
export class OpenApiSecurityMapper {
  readonly #access: SpecAccess;

  /**
   * Constructs the security mapper.
   */
  constructor() {
    this.#access = new SpecAccess();
  }

  /**
   * Maps an operation's effective security to a canonical auth_strategy
   * via a CLOSED allowlist. Unmapped → undefined + manual-review warning.
   * Pure; never throws.
   * @param op   - The flattened operation (its `security`).
   * @param spec - The loaded spec (for scheme definitions).
   * @returns SecurityMapResult with optional authStrategy and warnings.
   */
  map(op: FlattenedOperation, spec: LoadedSpec): SecurityMapResult {
    const warnings: string[] = [];
    const ctx = `${op.method.toUpperCase()} ${op.path}`;

    if (op.security === undefined || op.security.length === 0) {
      return { warnings };
    }

    if (op.security.length > 1) {
      warnings.push(
        `Operation ${ctx} has alternative security requirements; mapped the first`,
      );
    }

    const firstReq = op.security[0];
    /* istanbul ignore next — unreachable: op.security.length > 0 guarantees [0] is defined */
    if (firstReq === undefined) {
      return { warnings };
    }

    if (firstReq.schemeNames.length > 1) {
      warnings.push(
        `Operation ${ctx} combines multiple security schemes; set auth_strategy manually`,
      );
      return { warnings };
    }

    if (firstReq.schemeNames.length === 0) {
      return { warnings };
    }

    const schemeName = firstReq.schemeNames[0];
    /* istanbul ignore next — unreachable: length === 0 check above ensures [0] is defined */
    if (schemeName === undefined) {
      return { warnings };
    }

    return this.#mapSchemeName(schemeName, spec, ctx, warnings);
  }

  /**
   * Resolves and maps a single scheme name to a canonical auth strategy.
   * Adds a warning when the scheme is unresolvable or unmapped.
   * @param schemeName - The security scheme reference name.
   * @param spec - The loaded spec (for scheme definitions).
   * @param ctx - The context string for warning messages.
   * @param warnings - Accumulator for produced warning strings.
   * @returns SecurityMapResult with optional authStrategy and warnings.
   */
  #mapSchemeName(
    schemeName: string,
    spec: LoadedSpec,
    ctx: string,
    warnings: string[],
  ): SecurityMapResult {
    const schemeDef = this.#resolveScheme(schemeName, spec);
    if (schemeDef === undefined) {
      warnings.push(
        `Operation ${ctx} uses unmapped security scheme '${schemeName}' (unresolvable); ` +
          `set auth_strategy manually`,
      );
      return { warnings };
    }

    const authStrategy = this.#mapScheme(schemeDef, spec.flavor);
    if (authStrategy !== undefined) {
      return { authStrategy, warnings };
    }

    const schemeType = this.#access.asString(schemeDef["type"]) ?? "unknown";
    warnings.push(
      `Operation ${ctx} uses unmapped security scheme '${schemeName}' (${schemeType}); ` +
        `set auth_strategy manually`,
    );
    return { warnings };
  }

  /**
   * Resolves a scheme name to its definition object.
   * Returns undefined when the scheme name is not in the spec.
   * @param schemeName - The security scheme reference name.
   * @param spec - The loaded spec.
   * @returns The scheme definition object, or undefined.
   */
  #resolveScheme(
    schemeName: string,
    spec: LoadedSpec,
  ): Record<string, unknown> | undefined {
    if (spec.flavor === "openapi-3") {
      const schemes = this.#access.getSecuritySchemes(spec.document);
      const def = schemes[schemeName];
      return this.#access.isObject(def) ? def : undefined;
    }
    const defs = this.#access.getSecurityDefinitions(spec.document);
    const def = defs[schemeName];
    return this.#access.isObject(def) ? def : undefined;
  }

  /**
   * Maps a scheme definition to a canonical auth strategy name using the
   * closed allowlist. Returns undefined for unmapped/unrecognized schemes.
   * @param schemeDef - The scheme definition object.
   * @param flavor - The spec flavor.
   * @returns The canonical auth strategy string, or undefined.
   */
  #mapScheme(
    schemeDef: Record<string, unknown>,
    flavor: LoadedSpec["flavor"],
  ): string | undefined {
    const type = this.#access.asString(schemeDef["type"]);
    if (type === undefined) return undefined;

    if (flavor === "openapi-3") {
      if (type === "http") {
        const scheme = this.#access.asString(schemeDef["scheme"]);
        if (scheme === "bearer") return USER_TOKEN;
        if (scheme === "basic") return BASIC_AUTH;
        return undefined;
      }
      if (type === "apiKey") return API_KEY;
      return undefined;
    }

    if (type === "basic") return BASIC_AUTH;
    if (type === "apiKey") return API_KEY;
    return undefined;
  }
}
