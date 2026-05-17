import { describe, it, expect } from "vitest";

import {
  EnvironmentSchemaValidator,
  ENVIRONMENT_SCHEMA,
  formatEnvErrors,
} from "../../../src/env/index.js";
import type { ResolvedEnvironment } from "../../../src/env/index.js";

/**
 * A valid environment object matching the V1_BUILD_SPEC qa.yaml example shape,
 * with unresolved ${secret.*} strings still present (validate happens before
 * secret resolution in the pipeline).
 * @returns A fresh, mutable valid environment object.
 */
function validEnv(): Record<string, unknown> {
  return {
    name: "qa",
    prod: false,
    base_url: "https://api-qa.example.com",
    default_sla_ms: 1000,
    databases: {
      primary_postgres: {
        type: "postgres",
        host: "db-qa.example.com",
        port: 5432,
        database: "app_qa",
        user: "${secret.QA_DB_USER}",
        password: "${secret.QA_DB_PASSWORD}",
      },
    },
    auth_strategies: {
      user_token: {
        type: "token_endpoint",
        url: "https://api-qa.example.com/auth/login",
        credentials: {
          username: "${secret.QA_USER}",
          password: "${secret.QA_PASSWORD}",
        },
        token_path: "$.access_token",
        header: "Authorization",
        header_value: "Bearer ${token}",
      },
    },
  };
}

describe("ENVIRONMENT_SCHEMA", () => {
  it("is an object schema requiring name, base_url, and prod", () => {
    expect(ENVIRONMENT_SCHEMA).toBeTypeOf("object");
    expect(ENVIRONMENT_SCHEMA.type).toBe("object");
    expect(ENVIRONMENT_SCHEMA.required).toEqual(
      expect.arrayContaining(["name", "base_url", "prod"]),
    );
  });
});

describe("formatEnvErrors", () => {
  it("returns an empty array when given undefined", () => {
    expect(formatEnvErrors(undefined)).toEqual([]);
  });

  it("returns an empty array when given an empty list", () => {
    expect(formatEnvErrors([])).toEqual([]);
  });

  it("uses 'root' when instancePath is empty", () => {
    expect(formatEnvErrors([{ instancePath: "", message: "boom" }])).toEqual([
      "root boom",
    ]);
  });

  it("uses the instancePath when present", () => {
    expect(
      formatEnvErrors([{ instancePath: "/name", message: "is bad" }]),
    ).toEqual(["/name is bad"]);
  });

  it("falls back to 'is invalid' when message is absent", () => {
    expect(formatEnvErrors([{ instancePath: "/prod" }])).toEqual([
      "/prod is invalid",
    ]);
  });
});

describe("EnvironmentSchemaValidator", () => {
  const validator = new EnvironmentSchemaValidator();

  it("accepts a valid qa.yaml-shaped config with zero errors", () => {
    const result = validator.validate(validEnv());
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("accepts config that still contains unresolved ${secret.*} strings", () => {
    const env = validEnv();
    const result = validator.validate(env);
    expect(result.valid).toBe(true);
  });

  it("accepts config with custom top-level ${env.*} keys", () => {
    const env = validEnv();
    env.run_id = "${env.run_id}";
    env.tenant = "acme";
    const result = validator.validate(env);
    expect(result.valid).toBe(true);
  });

  it("accepts empty databases and auth_strategies objects", () => {
    const env = validEnv();
    env.databases = {};
    env.auth_strategies = {};
    expect(validator.validate(env).valid).toBe(true);
  });

  it("accepts config without optional databases/auth_strategies/sla", () => {
    const result = validator.validate({
      name: "minimal",
      prod: false,
      base_url: "https://x.example.com",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects config missing required name, naming the field", () => {
    const env = validEnv();
    delete env.name;
    const result = validator.validate(env);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.join(" ")).toContain("name");
  });

  it("rejects config missing required base_url, naming the field", () => {
    const env = validEnv();
    delete env.base_url;
    const result = validator.validate(env);
    expect(result.valid).toBe(false);
    expect(result.errors?.join(" ")).toContain("base_url");
  });

  it("rejects config missing required prod, naming the field", () => {
    const env = validEnv();
    delete env.prod;
    const result = validator.validate(env);
    expect(result.valid).toBe(false);
    expect(result.errors?.join(" ")).toContain("prod");
  });

  it("rejects prod that is not a boolean, naming the field", () => {
    const env = validEnv();
    env.prod = "yes";
    const result = validator.validate(env);
    expect(result.valid).toBe(false);
    expect(result.errors?.join(" ")).toContain("prod");
  });

  it("emits the curated errorMessage, not the raw AJV message", () => {
    // Regression guard for ajv-errors registration: without the plugin AJV
    // reports the raw 'must be boolean' text and drops the curated message.
    const env = validEnv();
    env.prod = "yes";
    const result = validator.validate(env);
    expect(result.valid).toBe(false);
    const joined = result.errors?.join(" ") ?? "";
    expect(joined).toContain("prod must be a boolean (true or false)");
  });

  it("rejects an unknown database type with an enum-violation message", () => {
    const env = validEnv();
    (
      env.databases as Record<string, Record<string, unknown>>
    ).primary_postgres.type = "redis";
    const result = validator.validate(env);
    expect(result.valid).toBe(false);
    const text = result.errors?.join(" ") ?? "";
    expect(text.toLowerCase()).toMatch(/type|enum|postgres/);
  });

  it("rejects an unknown auth strategy type with a clear message", () => {
    const env = validEnv();
    (
      env.auth_strategies as Record<string, Record<string, unknown>>
    ).user_token.type = "oauth3";
    const result = validator.validate(env);
    expect(result.valid).toBe(false);
    const text = result.errors?.join(" ") ?? "";
    expect(text.toLowerCase()).toMatch(/type|enum|token_endpoint/);
  });

  it("rejects a non-object input (null) without throwing", () => {
    const result = validator.validate(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it("rejects a non-object input (string) without throwing", () => {
    const result = validator.validate("not-an-object");
    expect(result.valid).toBe(false);
  });

  it("rejects default_sla_ms when negative", () => {
    const env = validEnv();
    env.default_sla_ms = -5;
    const result = validator.validate(env);
    expect(result.valid).toBe(false);
    expect(result.errors?.join(" ")).toContain("default_sla_ms");
  });

  it("accepts a mongodb database using a uri instead of host/port", () => {
    const env = validEnv();
    env.databases = {
      mongo_main: { type: "mongodb", uri: "${secret.MONGO_URI}" },
    };
    expect(validator.validate(env).valid).toBe(true);
  });

  it("accepts a static_token auth strategy", () => {
    const env = validEnv();
    env.auth_strategies = {
      svc: { type: "static_token", token: "${secret.SVC_TOKEN}" },
    };
    expect(validator.validate(env).valid).toBe(true);
  });

  it("returns multiple errors when several fields are invalid", () => {
    const result = validator.validate({ base_url: 123 });
    expect(result.valid).toBe(false);
    expect((result.errors ?? []).length).toBeGreaterThan(1);
  });

  it("exposes the resolved type for downstream consumers", () => {
    // Compile-time + runtime smoke: a typed object is assignable and validates.
    const typed: ResolvedEnvironment = {
      name: "dev",
      prod: false,
      base_url: "https://dev.example.com",
    };
    expect(validator.validate(typed).valid).toBe(true);
  });
});
