/**
 * BaseUrlResolver: derives a base URL from a dereferenced OpenAPI/Swagger spec.
 *
 * Kept separate from the loader for independent testability and to keep the
 * loader under the soft line limit (the 3.x vs 2.0 branching is materially
 * different).
 */

import { SpecAccess } from "./spec-access.js";
import type { SpecFlavor } from "./types.js";

/** Default scheme when host is present but schemes is absent (Swagger 2.0). */
const DEFAULT_SCHEME = "https";

/**
 * Derives the effective base URL from a dereferenced OpenAPI 3.x or
 * Swagger 2.0 spec document. Pure; never throws.
 *
 * - openapi-3: first `servers[].url`; "/" when servers absent/empty.
 * - swagger-2: `<schemes[0]>://<host><basePath>`; when host absent →
 *   `<basePath>` (or "/" when basePath also absent); when schemes absent
 *   but host present → default scheme "https".
 *
 * Server-variable templates (`{var}` in the URL) are returned verbatim;
 * substitution is out of v1 scope (documented limitation).
 */
export class BaseUrlResolver {
  readonly #access: SpecAccess;

  /**
   * Constructs the resolver.
   */
  constructor() {
    this.#access = new SpecAccess();
  }

  /**
   * Derives the base URL from the given spec document.
   * @param document - The dereferenced spec root document.
   * @param flavor - The spec flavor ("openapi-3" or "swagger-2").
   * @returns The resolved base URL string; "/" as the fallback.
   */
  resolve(document: Record<string, unknown>, flavor: SpecFlavor): string {
    if (flavor === "openapi-3") {
      return this.#resolveOpenApi3(document);
    }
    return this.#resolveSwagger2(document);
  }

  /**
   * Resolves the base URL for OpenAPI 3.x specs.
   * Returns first server url, or "/" when servers absent/empty.
   * @param doc - The dereferenced spec root document.
   * @returns The resolved base URL string.
   */
  #resolveOpenApi3(doc: Record<string, unknown>): string {
    const servers = this.#access.getServers(doc);
    if (servers.length === 0) return "/";
    const first = servers[0];
    if (!this.#access.isObject(first)) return "/";
    const url = this.#access.asString(first["url"]);
    return url !== undefined && url !== "" ? url : "/";
  }

  /**
   * Resolves the base URL for Swagger 2.0 specs.
   * Returns `<scheme>://<host><basePath>`, or fallback when fields absent.
   * @param doc - The dereferenced spec root document.
   * @returns The resolved base URL string.
   */
  #resolveSwagger2(doc: Record<string, unknown>): string {
    const host = this.#access.asString(doc["host"]);
    const basePath = this.#access.asString(doc["basePath"]) ?? "";
    const schemes = this.#access.asObjectArray(doc["schemes"]);

    if (!host) {
      return basePath !== "" ? basePath : "/";
    }

    const scheme =
      typeof schemes[0] === "string" && schemes[0] !== ""
        ? schemes[0]
        : DEFAULT_SCHEME;

    return `${scheme}://${host}${basePath}`;
  }
}
