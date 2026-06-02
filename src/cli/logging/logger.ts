/**
 * Logger interface and PinoLogger implementation for the APIWright CLI.
 *
 * Command handlers and seams depend on the `Logger` interface, never on
 * pino directly. The injectable `stream` option enables synchronous
 * capture in unit tests without writing to real stdout.
 */

import { createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import type { Writable } from "node:stream";

import type { LogLevel } from "../config/types.js";
import { ConfigError } from "../errors.js";

// pino + pino-pretty are CJS modules; use `createRequire` so the modules
// load under Node 26's strict ESM mode (bare `require()` is undefined in
// that scope; only Node 22's permissive shim made the unscoped form work).
 
const requireCjs = createRequire(import.meta.url);
 
const pino = requireCjs("pino") as (
  opts: Record<string, unknown>,
  stream?: unknown,
) => PinoInstance;
 
const pinoPretty = requireCjs("pino-pretty") as (
  opts: Record<string, unknown>,
) => unknown;

/** Valid log levels set — used for defensive validation. */
const VALID_LOG_LEVELS: ReadonlySet<string> = new Set<LogLevel>([
  "error",
  "warn",
  "info",
  "debug",
]);

/** Minimal pino instance shape. */
interface PinoInstance {
  level: string;
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
}

/**
 * Stable console-output contract consumed by command handlers and seams.
 * Decouples callers from pino so the logger can be swapped or faked in tests.
 */
export interface Logger {
  /** Logs an error-level message. */
  error(message: string): void;
  /** Logs a warn-level message. */
  warn(message: string): void;
  /** Logs an info-level message. */
  info(message: string): void;
  /** Logs a debug-level message. */
  debug(message: string): void;
  /**
   * Emits a message that ALWAYS shows, at every configured level.
   * Reserved for the per-run summary line: the spec promises that even at
   * `--log error` the user sees a final summary. Previously this used
   * `error()` which slapped a misleading `ERROR:` prefix on every
   * successful run; `summary()` writes the message unprefixed so a
   * `passed=N failed=0` run no longer reads as a failure in CI logs.
   */
  summary(message: string): void;
  /** The level this logger was created at (for stack-suppression logic). */
  readonly level: LogLevel;
}

/** Options accepted by {@link createLogger}. */
export interface LoggerOptions {
  /**
   * Output stream for emitted lines. Default process.stdout. Injectable
   * so tests assert lines without writing real stdout.
   */
  stream?: NodeJS.WritableStream | Writable;
}

/**
 * Pino-backed Logger implementation.
 *
 * Created via {@link createLogger}; not exported directly to consumers
 * (they depend on the Logger interface).
 */
class PinoLogger implements Logger {
  readonly #pino: PinoInstance;
  readonly #level: LogLevel;
  readonly #stream: NodeJS.WritableStream | Writable;

  /**
   * Creates a PinoLogger wrapping the given pino instance.
   * @param level - The minimum log level.
   * @param pinoInstance - The configured pino instance.
   * @param stream - The destination stream. Used by `summary()` to write
   *   bypassing pino's level filter and prefix.
   */
  constructor(
    level: LogLevel,
    pinoInstance: PinoInstance,
    stream: NodeJS.WritableStream | Writable,
  ) {
    this.#level = level;
    this.#pino = pinoInstance;
    this.#stream = stream;
  }

  /** @inheritdoc */
  get level(): LogLevel {
    return this.#level;
  }

  /** @inheritdoc */
  error(message: string): void {
    this.#pino.error(message);
  }

  /** @inheritdoc */
  warn(message: string): void {
    this.#pino.warn(message);
  }

  /** @inheritdoc */
  info(message: string): void {
    this.#pino.info(message);
  }

  /** @inheritdoc */
  debug(message: string): void {
    this.#pino.debug(message);
  }

  /** @inheritdoc */
  summary(message: string): void {
    // Direct stream write bypasses pino's level filter and pino-pretty's
    // level prefix. This is intentional: the summary must surface at
    // `--log error` (per spec) without that level's `ERROR:` prefix making
    // a passed run look like a failure.
    this.#stream.write(`${message}\n`);
  }
}

/**
 * Builds a pino-backed Logger filtered to `level`.
 *
 * Invalid level string → throws ConfigError naming accepted values. This is a
 * defensive guard; upstream resolvers normally gate the level before calling
 * this factory.
 * @param level - The minimum log level to emit.
 * @param opts - Optional stream override for test capture.
 * @returns A Logger instance writing to the injected (or default) stream.
 * @throws ConfigError when level is not a valid LogLevel.
 */
export function createLogger(level: LogLevel, opts?: LoggerOptions): Logger {
  if (!VALID_LOG_LEVELS.has(level)) {
    throw new ConfigError(
      `--log must be one of error, warn, info, debug (got '${level}')`,
    );
  }

  const dest = opts?.stream ?? process.stdout;
  const prettyStream = pinoPretty({ destination: dest, sync: true });

  const pinoInstance = pino(
    { level, base: null, timestamp: false },
    prettyStream,
  );

  return new PinoLogger(level, pinoInstance, dest);
}

// Suppress unused import warning — createWriteStream is a valid re-export seam
void createWriteStream;
