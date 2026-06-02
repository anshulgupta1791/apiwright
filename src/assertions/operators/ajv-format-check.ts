/**
 * Thin wrapper around `ajv-formats` for format validation in the §4 assertions
 * engine. Constructs a single Ajv instance with full format checking and
 * exposes a `isValid(format, value)` method.
 *
 * Both `ajv` and `ajv-formats` are CJS packages without ESM entry points.
 * TypeScript resolves their CommonJS default exports via `import * as …`
 * under NodeNext + esModuleInterop. The `default` property holds the
 * constructor / function.
 */

import * as AjvLib from "ajv";
import type { ValidateFunction } from "ajv";
import * as FormatsLib from "ajv-formats";

/** The ajv format names this module validates. */
export type AjvFormatName = "uuid" | "email" | "uri" | "date-time";

/** Minimal Ajv instance shape used in this file. */
interface AjvInstance {
  compile(schema: object): ValidateFunction;
}

/**
 * Resolve the Ajv constructor from the CJS namespace import. Under NodeNext
 * esModuleInterop the default export of a CJS module is available as
 * `Module.default` when the module sets `module.exports = …`.
 * @returns The Ajv constructor function.
 */
function resolveAjvClass(): new (opts: object) => AjvInstance {
  // CJS interop: AjvLib may be the class directly or { default: class }
  /* istanbul ignore next — CJS/ESM interop: under NodeNext esModuleInterop the `default`
     property is always populated when importing a CJS module that sets module.exports = Class;
     the `?? AjvLib` fallback arm is unreachable in the Node runtime used by this project. */
  const candidate = (AjvLib as unknown as { default?: unknown }).default ?? AjvLib;
  return candidate as new (opts: object) => AjvInstance;
}

/**
 * Resolve the `addFormats` function from the CJS namespace import.
 * @returns The addFormats function from the ajv-formats package.
 */
function resolveAddFormats(): (ajv: AjvInstance, opts: object) => void {
  /* istanbul ignore next — CJS/ESM interop: under NodeNext esModuleInterop the `default`
     property is always populated when importing a CJS module that sets module.exports = fn;
     the `?? FormatsLib` fallback arm is unreachable in the Node runtime used by this project. */
  const candidate = (FormatsLib as unknown as { default?: unknown }).default ?? FormatsLib;
  return candidate as (ajv: AjvInstance, opts: object) => void;
}

/**
 * Validates strings against JSON Schema formats using Ajv full format checking.
 * One instance per evaluator (constructed once at evaluator init time).
 * NEVER throws from `isValid`; construction may throw if Ajv misconfigures
 * (won't happen with the fixed config below).
 */
export class AjvFormatCheck {
  readonly #ajv: AjvInstance;

  /**
   * Constructs the Ajv instance with full format checking and registers
   * `ajv-formats` in strict (non-fast) mode.
   */
  constructor() {
    const AjvClass = resolveAjvClass();
    this.#ajv = new AjvClass({ strict: false });
    const addFormats = resolveAddFormats();
     
    addFormats(this.#ajv, { mode: "full" });
  }

  /**
   * Test whether `value` satisfies the named JSON Schema format.
   * @param format - The format to validate against (`uuid`, `email`, etc.).
   * @param value - The string to test.
   * @returns `true` if the string satisfies the format; `false` otherwise.
   */
  isValid(format: AjvFormatName, value: string): boolean {
    const schema = { type: "string", format };
    const validate = this.#ajv.compile(schema);
    return validate(value);
  }
}
