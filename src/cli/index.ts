/**
 * Public exports for the APIWright CLI module.
 *
 * Re-exports all public types, classes, and functions from src/cli/*.
 * No logic in this barrel.
 */

// config/types.ts — type-only; re-exported for consumers
export type {
  LogLevel,
  Marker,
  RetryConfig,
  ReportConfig,
  ApiwrightConfig,
  PartialApiwrightConfig,
  EffectiveSettings,
  CliFlags,
} from "./config/types.js";

// config/schema.ts
export {
  ApiwrightConfigSchemaValidator,
  APIWRIGHT_CONFIG_SCHEMA,
  formatConfigErrors,
} from "./config/schema.js";
export type { ConfigValidationResult } from "./config/schema.js";

// config/defaults.ts
export { DEFAULT_CONFIG, cloneDefaults } from "./config/defaults.js";

// config/loader.ts
export { ConfigLoader } from "./config/loader.js";
export type { ConfigLoadResult, ConfigLoaderOptions } from "./config/loader.js";

// config/resolve-effective.ts
export {
  resolveEffectiveSettings,
  parseMarkers,
} from "./config/resolve-effective.js";
export type { ResolveResult } from "./config/resolve-effective.js";

// logging/logger.ts
export { createLogger } from "./logging/logger.js";
export type { Logger, LoggerOptions } from "./logging/logger.js";

// errors.ts
export {
  CliError,
  ConfigError,
  ValidationFailedError,
  ProdSafetyAbortError,
  NotImplementedError,
} from "./errors.js";

// exit-codes.ts
export { ExitCode, errorToExitCode } from "./exit-codes.js";

// error-handler.ts
export { handleCliError } from "./error-handler.js";
export type { ErrorHandlerOptions } from "./error-handler.js";

// prod-safety.ts
export { ProdSafetyGate, StdinConfirmationPrompt } from "./prod-safety.js";
export type {
  ConfirmationPrompt,
  ProdSafetyOptions,
  ProdSafetyDecision,
} from "./prod-safety.js";

// fs-seam.ts
export { NodeFileSystem } from "./fs-seam.js";
export type { FileSystem, FsError } from "./fs-seam.js";

// seams/test-runner.ts
export { NotImplementedTestRunner } from "./seams/test-runner.js";
export type {
  TestRunner,
  TestRunOutcome,
  TestRunInput,
} from "./seams/test-runner.js";

// seams/importer.ts
export { NotImplementedImporter } from "./seams/importer.js";
export type { Importer, ImportOutcome } from "./seams/importer.js";

// seams/docs-generator.ts
export { NotImplementedDocsGenerator } from "./seams/docs-generator.js";
export type { DocsGenerator, DocsOutcome } from "./seams/docs-generator.js";

// commands/validate.ts
export { ValidateCommand } from "./commands/validate.js";
export type {
  ValidateCommandOptions,
  FileValidationResult,
  ValidateSummary,
} from "./commands/validate.js";

// entry.ts
export { buildProgram, main } from "./entry.js";
export type { EntryDeps } from "./entry.js";
