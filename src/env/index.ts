/**
 * Environment module public exports: canonical environment types and the
 * JSON-Schema-backed validator.
 */

export type {
  DatabaseType,
  AuthStrategyType,
  DatabaseConfig,
  AuthStrategyConfig,
  ResolvedEnvironment,
  EnvValidationResult,
} from "./types.js";
export type {
  YamlReadSuccess,
  YamlReadFailure,
  YamlReadFailureKind,
  YamlReadResult,
} from "./yaml-reader.js";
export type { SecretResolutionResult } from "./secrets.js";
export type { TemplateResolutionResult } from "./template-resolver.js";
export type {
  EnvironmentLoadResult,
  EnvironmentLoaderOptions,
} from "./loader.js";
export {
  EnvironmentSchemaValidator,
  ENVIRONMENT_SCHEMA,
  formatEnvErrors,
} from "./schema.js";
export { readYamlFile, describeError } from "./yaml-reader.js";
export { SecretRegistry, resolveSecrets } from "./secrets.js";
export { redactSecrets, REDACTION_PLACEHOLDER } from "./redactor.js";
export { resolveTemplates } from "./template-resolver.js";
export { EnvironmentLoader } from "./loader.js";
