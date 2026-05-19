/**
 * Type/format-group corpus cases (5 operators: is_uuid_v4, is_iso_timestamp,
 * is_recent_timestamp, is_email, is_url). Covers PASS/FAIL/TYPE_MISMATCH +
 * the deterministic injected-`now` is_recent_timestamp cases + invalid-syntax.
 *
 * Named export `FORMAT_CASES: readonly CorpusCase[]`.
 */

import { okCase, errCase } from "./corpus-types.js";
import type { CorpusCase } from "./corpus-types.js";

export const FORMAT_CASES: readonly CorpusCase[] = [
  // ---- is_uuid_v4 ----
  // base ctx: response.body.id = "550e8400-e29b-41d4-a716-446655440000" (valid v4)
  okCase("fmt.uuid.pass", "format",
    "response.body.id is_uuid_v4",
    "base",
    { pass: true, target: "response.body.id", operator: "is_uuid_v4" }),

  // base ctx: response.body.notUuid = "not-a-uuid"
  okCase("fmt.uuid.fail.invalid", "format",
    "response.body.notUuid is_uuid_v4",
    "base",
    { pass: false, failureCode: "FORMAT_INVALID",
      target: "response.body.notUuid", operator: "is_uuid_v4" }),

  // non-string actual (response.status is number) → TYPE_MISMATCH
  okCase("fmt.uuid.fail.type-mismatch", "format",
    "response.status is_uuid_v4",
    "base",
    { pass: false, failureCode: "TYPE_MISMATCH",
      target: "response.status", operator: "is_uuid_v4" }),

  // ---- is_iso_timestamp ----
  // base ctx: response.body.created_at = FIXED_NOW_ISO (valid ISO 8601)
  okCase("fmt.iso-ts.pass", "format",
    "response.body.created_at is_iso_timestamp",
    "base",
    { pass: true, target: "response.body.created_at",
      operator: "is_iso_timestamp" }),

  // base ctx: response.body.notTs = "not-a-timestamp"
  okCase("fmt.iso-ts.fail", "format",
    "response.body.notTs is_iso_timestamp",
    "base",
    { pass: false, failureCode: "FORMAT_INVALID",
      target: "response.body.notTs", operator: "is_iso_timestamp" }),

  // ---- is_recent_timestamp — deterministic via injected now ----
  // base ctx: created_at = FIXED_NOW_ISO; now = FIXED_NOW → delta = 0 → PASS
  okCase("fmt.recent-ts.pass.in-window", "format",
    "response.body.created_at is_recent_timestamp",
    "base",
    { pass: true, target: "response.body.created_at",
      operator: "is_recent_timestamp" }),

  // edge ctx: old_at = FIXED_NOW - 10min ISO → 10min > 5min window → FAIL
  okCase("fmt.recent-ts.fail.out-of-window", "format",
    "response.body.old_at is_recent_timestamp",
    "edge",
    { pass: false, failureCode: "FORMAT_INVALID",
      target: "response.body.old_at", operator: "is_recent_timestamp" }),

  // non-string actual → TYPE_MISMATCH
  okCase("fmt.recent-ts.fail.type-mismatch", "format",
    "response.status is_recent_timestamp",
    "base",
    { pass: false, failureCode: "TYPE_MISMATCH",
      target: "response.status", operator: "is_recent_timestamp" }),

  // ---- is_email ----
  // base ctx: response.body.email = "user@example.com"
  okCase("fmt.email.pass", "format",
    "response.body.email is_email",
    "base",
    { pass: true, target: "response.body.email", operator: "is_email" }),

  // base ctx: response.body.notEmail = "not-an-email"
  okCase("fmt.email.fail", "format",
    "response.body.notEmail is_email",
    "base",
    { pass: false, failureCode: "FORMAT_INVALID",
      target: "response.body.notEmail", operator: "is_email" }),

  // ---- is_url ----
  // base ctx: response.body.link = "https://example.com/x"
  okCase("fmt.url.pass", "format",
    "response.body.link is_url",
    "base",
    { pass: true, target: "response.body.link", operator: "is_url" }),

  // base ctx: response.body.notUrl = "not a url"
  okCase("fmt.url.fail", "format",
    "response.body.notUrl is_url",
    "base",
    { pass: false, failureCode: "FORMAT_INVALID",
      target: "response.body.notUrl", operator: "is_url" }),

  // ---- invalid syntax ----
  errCase("fmt.invalid.nullary-with-operand", "format",
    "response.body.id is_uuid_v4 extra",
    ["operand", "arity"]),
];
