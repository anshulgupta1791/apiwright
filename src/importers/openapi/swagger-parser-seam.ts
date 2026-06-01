/**
 * DefaultSwaggerParserSeam: thin adapter over @apidevtools/swagger-parser.
 *
 * Wraps the CJS swagger-parser library behind the injectable SwaggerParserSeam
 * interface so that every loader branch is unit-testable with no real disk or
 * network. Uses the same require() + eslint-disable convention as
 * src/core/schema-validator.ts lines 3-14.
 */

import { createRequire } from "node:module";

import type { SwaggerParserSeam } from "./types.js";

// `@apidevtools/swagger-parser` is a CJS module without clean ESM types.
// Use `createRequire` so the seam loads under Node 26's strict ESM mode
// (bare `require()` is undefined there; Node 22 had a permissive shim).
 
const requireCjs = createRequire(import.meta.url);

/**
 * A minimal interface for the swagger-parser-like library object. Only the
 * two static methods we need are typed — everything else is ignored. Using
 * `unknown` returns, narrowed by the loader.
 */
interface ParserLib {
  /** Validates + fully dereferences a spec from a file path or URL. */
  dereference(source: string): Promise<unknown>;
  /** Validates + bundles a spec (internal $refs kept as local pointers). */
  bundle(source: string): Promise<unknown>;
}

/** Options for DefaultSwaggerParserSeam. */
export interface DefaultSwaggerParserSeamOptions {
  /**
   * Injectable parser library object. Defaults to the real
   * `@apidevtools/swagger-parser` module (loaded via `require`). Inject a
   * fake in tests to avoid real disk/network and cover the adapter's
   * forwarding methods deterministically.
   */
  parserLib?: ParserLib;
}

/**
 * Production implementation of {@link SwaggerParserSeam}.
 *
 * A thin forwarding adapter over `@apidevtools/swagger-parser`. The real
 * library is `require()`d by default (CJS — no ESM types available, same
 * pattern as `src/core/schema-validator.ts`). Inject `parserLib` in tests
 * to avoid real network/disk and cover every branch deterministically.
 */
export class DefaultSwaggerParserSeam implements SwaggerParserSeam {
  readonly #parserLib: ParserLib;

  /**
   * Constructs the seam adapter.
   * @param options - Optional configuration.
   * @param options.parserLib - Injectable parser lib; defaults to the real
   *   `@apidevtools/swagger-parser` (loaded via CJS require on first use).
   */
  constructor(options?: DefaultSwaggerParserSeamOptions) {
    if (options?.parserLib !== undefined) {
      this.#parserLib = options.parserLib;
    } else {
       
      this.#parserLib = requireCjs("@apidevtools/swagger-parser") as ParserLib;
    }
  }

  /**
   * Validates + fully dereferences a spec from a file path or URL.
   * Resolves the dereferenced root document; rejects on invalid/unreachable input.
   * @param source - File path or http(s) URL to the spec.
   * @returns The dereferenced spec root document.
   */
  dereference(source: string): Promise<unknown> {
    return this.#parserLib.dereference(source);
  }

  /**
   * Validates + bundles a spec (internal $refs kept as local pointers so
   * circular refs do not infinitely inline).
   * @param source - File path or http(s) URL to the spec.
   * @returns The bundled spec root document.
   */
  bundle(source: string): Promise<unknown> {
    return this.#parserLib.bundle(source);
  }
}
