import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, it, expect } from "vitest";

import { EnvironmentLoader } from "../../../src/env/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "apiwright-loader-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes a file (creating parent dirs) within the temp dir.
 * @param relPath - Path relative to the temp dir.
 * @param contents - File contents.
 */
function write(relPath: string, contents: string): void {
  const p = join(dir, relPath);
  const parent = p.slice(0, p.lastIndexOf("/"));
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(p, contents, "utf8");
}

/**
 * Builds a loader rooted at the temp dir with an injected env source.
 * @param env - The environment-variable source for secret resolution.
 * @returns A configured EnvironmentLoader.
 */
function loader(env: NodeJS.ProcessEnv = {}): EnvironmentLoader {
  return new EnvironmentLoader({ rootDir: dir, env });
}

const MINIMAL = `
name: qa
prod: false
base_url: https://api-qa.example.com
`;

describe("EnvironmentLoader — file resolution", () => {
  it("loads .env.<name>.yaml", () => {
    write(".env.qa.yaml", MINIMAL);
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.name).toBe("qa");
  });

  it("falls back to environments/<name>.yaml", () => {
    write("environments/qa.yaml", MINIMAL);
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.base_url).toBe("https://api-qa.example.com");
  });

  it("prefers .env.<name>.yaml over environments/<name>.yaml", () => {
    write(".env.qa.yaml", "name: qa\nprod: false\nbase_url: from-dotfile");
    write(
      "environments/qa.yaml",
      "name: qa\nprod: false\nbase_url: from-environments",
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.base_url).toBe("from-dotfile");
  });

  it("returns valid=false listing both attempted paths when neither exists", () => {
    const result = loader().load("nope");
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.join("\n")).toContain(".env.nope.yaml");
    expect(result.errors?.join("\n")).toContain("environments/nope.yaml");
  });

  it("does not throw and returns an error for an empty-string name", () => {
    const result = loader().load("");
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("defaults rootDir to process.cwd() when no options are given", () => {
    // No file in cwd named .env.__apiwright_nonexistent__.yaml.
    const result = new EnvironmentLoader().load("__apiwright_nonexistent__");
    expect(result.valid).toBe(false);
  });

  it("always returns a secretRegistry, even on failure", () => {
    const result = loader().load("missing");
    expect(result.valid).toBe(false);
    expect(result.secretRegistry).toBeDefined();
    expect(result.secretRegistry.size).toBe(0);
  });
});

describe("EnvironmentLoader — reader failures", () => {
  it("surfaces a malformed-YAML error without throwing", () => {
    write(".env.qa.yaml", "name: qa\n  bad: : indentation");
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it("surfaces an empty-file error", () => {
    write(".env.qa.yaml", "");
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n").toLowerCase()).toContain("empty");
  });

  it("surfaces an environments/<name>.yaml error when the dotfile is absent", () => {
    // No .env.qa.yaml: dotfile read is not_found, so locate() falls through
    // to environments/qa.yaml, which exists but errors (empty). That error
    // must surface rather than the generic "not found" message.
    write("environments/qa.yaml", "");
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n").toLowerCase()).toContain("empty");
  });
});

describe("EnvironmentLoader — per-environment overrides (deep merge)", () => {
  it("deep-merges environments[name] over base values (override wins)", () => {
    write(
      ".env.qa.yaml",
      `
name: base
prod: false
base_url: https://base.example.com
default_sla_ms: 1000
environments:
  qa:
    name: qa
    base_url: https://api-qa.example.com
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.name).toBe("qa");
    expect(result.environment?.base_url).toBe("https://api-qa.example.com");
    // Non-overridden base value preserved.
    expect(result.environment?.default_sla_ms).toBe(1000);
  });

  it("strips the environments key from the resolved result", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
environments:
  qa:
    base_url: https://api-qa.example.com
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment).toBeDefined();
    expect("environments" in (result.environment ?? {})).toBe(false);
  });

  it("deep-merges nested objects, keeping non-overridden nested keys", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  pg:
    type: postgres
    host: base-host
    port: 5432
environments:
  qa:
    databases:
      pg:
        host: qa-host
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    const pg = result.environment?.databases?.pg;
    expect(pg?.host).toBe("qa-host");
    expect(pg?.port).toBe(5432);
    expect(pg?.type).toBe("postgres");
  });

  it("adds override-only keys absent from the base", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
environments:
  qa:
    databases:
      pg:
        type: postgres
        host: only-in-override
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.databases?.pg.host).toBe("only-in-override");
  });

  it("replaces arrays wholesale rather than element-merging", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
tags:
  - a
  - b
  - c
environments:
  qa:
    tags:
      - x
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.tags).toEqual(["x"]);
  });

  it("replaces an object base value when the override is a scalar", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
meta:
  nested: 1
environments:
  qa:
    meta: replaced
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.meta).toBe("replaced");
  });

  it("passes the base through unchanged when there is no environments key", () => {
    write(".env.qa.yaml", MINIMAL);
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.name).toBe("qa");
  });

  it("passes the base through when environments[name] is absent", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
environments:
  dev:
    base_url: https://dev.example.com
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.base_url).toBe("https://api-qa.example.com");
  });

  it("ignores a non-object environments value", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
environments: not-a-map
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.name).toBe("qa");
  });
});

describe("EnvironmentLoader — template (${env.*}) stage", () => {
  it("resolves ${env.*} references against the merged document", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
host_name: api-qa.example.com
base_url: https://\${env.host_name}/v1
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.base_url).toBe("https://api-qa.example.com/v1");
  });

  it("preserves a typed value via a whole-token ${env.*} substitution", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
sla: 2500
default_sla_ms: \${env.sla}
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.default_sla_ms).toBe(2500);
  });

  it("fails before secret resolution when ${env.*} is unresolved", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: \${env.does_not_exist}
`,
    );
    const result = loader({}).load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n")).toContain("env.does_not_exist");
    // No secrets were touched.
    expect(result.secretRegistry.size).toBe(0);
  });
});

describe("EnvironmentLoader — secret (${secret.*}) stage", () => {
  it("resolves ${secret.*} from the injected env source (no prefix)", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  pg:
    type: postgres
    password: \${secret.QA_DB_PASSWORD}
`,
    );
    const result = loader({ QA_DB_PASSWORD: "hunter2" }).load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.databases?.pg.password).toBe("hunter2");
    expect(result.secretRegistry.values().has("hunter2")).toBe(true);
  });

  it("fails when a referenced secret is missing, naming only the var", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  pg:
    type: postgres
    password: \${secret.MISSING_PW}
`,
    );
    const result = loader({}).load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n")).toContain("MISSING_PW");
  });

  it("never leaks a resolved secret value into errors when another is missing", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  pg:
    type: postgres
    user: \${secret.SET_USER}
    password: \${secret.UNSET_PW}
`,
    );
    const result = loader({ SET_USER: "TOPSECRETUSER" }).load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n")).not.toContain("TOPSECRETUSER");
  });

  it("leaves ${response.*}, ${token}, ${db.*} intact for the runner", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
auth_strategies:
  user_token:
    type: token_endpoint
    header_value: "Bearer \${token}"
    captured: "\${response.body.id}"
    db_ref: "\${db.pg.q.col}"
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
    const strat = result.environment?.auth_strategies?.user_token;
    expect(strat?.header_value).toBe("Bearer ${token}");
    expect(strat?.captured).toBe("${response.body.id}");
    expect(strat?.db_ref).toBe("${db.pg.q.col}");
  });
});

describe("EnvironmentLoader — schema stage", () => {
  it("returns valid=false with schema errors when a required field is absent", () => {
    write(".env.qa.yaml", "name: qa\nbase_url: https://api-qa.example.com");
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n").toLowerCase()).toContain("prod");
  });

  it("returns valid=false when a field has the wrong type after resolution", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: maybe
base_url: https://api-qa.example.com
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });
});

describe("EnvironmentLoader — connection-name consistency", () => {
  it("accepts well-formed database and auth-strategy names", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  primary_postgres:
    type: postgres
auth_strategies:
  user_token:
    type: static_token
    token: t
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
  });

  it("rejects an empty database connection name", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  "":
    type: postgres
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n").toLowerCase()).toContain("non-empty");
  });

  it("rejects a whitespace-only connection name", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  "   ":
    type: postgres
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n").toLowerCase()).toContain("non-empty");
  });

  it("rejects an invalid-character connection name", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  "bad-name":
    type: postgres
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n")).toContain("bad-name");
  });

  it("reports a name used by both databases and auth_strategies", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  shared:
    type: postgres
auth_strategies:
  shared:
    type: static_token
    token: t
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n")).toContain("shared");
    expect(result.errors?.join("\n").toLowerCase()).toContain("both");
  });

  it("aggregates multiple connection-name violations", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  "bad-one":
    type: postgres
auth_strategies:
  "bad two":
    type: static_token
    token: t
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    const joined = result.errors?.join("\n") ?? "";
    expect(joined).toContain("bad-one");
    expect(joined).toContain("bad two");
  });

  it("validates auth_strategies names when databases is absent", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
auth_strategies:
  "bad-strat":
    type: static_token
    token: t
`,
    );
    const result = loader().load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n")).toContain("bad-strat");
  });

  it("skips the check cleanly when neither section is present", () => {
    write(".env.qa.yaml", MINIMAL);
    const result = loader().load("qa");
    expect(result.valid).toBe(true);
  });
});

describe("EnvironmentLoader — successful full load", () => {
  it("returns a fully resolved ResolvedEnvironment mirroring the §7 example", () => {
    write(
      "environments/qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
default_sla_ms: 1000
databases:
  primary_postgres:
    type: postgres
    host: db-qa.example.com
    port: 5432
    database: app_qa
    user: \${secret.QA_DB_USER}
    password: \${secret.QA_DB_PASSWORD}
auth_strategies:
  user_token:
    type: token_endpoint
    url: https://api-qa.example.com/auth/login
    credentials:
      username: \${secret.QA_USER}
      password: \${secret.QA_PASSWORD}
    token_path: $.access_token
    header: Authorization
    header_value: "Bearer \${token}"
`,
    );
    const result = loader({
      QA_DB_USER: "dbuser",
      QA_DB_PASSWORD: "dbpass",
      QA_USER: "apiuser",
      QA_PASSWORD: "apipass",
    }).load("qa");

    expect(result.valid).toBe(true);
    const env = result.environment;
    expect(env?.name).toBe("qa");
    expect(env?.prod).toBe(false);
    expect(env?.databases?.primary_postgres.user).toBe("dbuser");
    expect(env?.databases?.primary_postgres.password).toBe("dbpass");
    const strat = env?.auth_strategies?.user_token;
    expect((strat?.credentials as Record<string, string>).username).toBe(
      "apiuser",
    );
    // ${token} left intact for the runner.
    expect(strat?.header_value).toBe("Bearer ${token}");
    // Registry holds the four resolved secret values.
    expect(result.secretRegistry.size).toBe(4);
    expect(result.errors).toBeUndefined();
  });
});

describe("EnvironmentLoader — never throws (catch-all boundary)", () => {
  it("surfaces an unexpected internal error as a structured result", () => {
    write(".env.qa.yaml", MINIMAL);
    const boom = new EnvironmentLoader({
      rootDir: dir,
      env: {},
      // Internal test seam: a reader that throws unexpectedly.
      reader: () => {
        throw new Error("boom-from-reader");
      },
    } as unknown as ConstructorParameters<typeof EnvironmentLoader>[0]);
    const result = boom.load("qa");
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n")).toContain("boom-from-reader");
    expect(result.secretRegistry).toBeDefined();
  });
});

describe("EnvironmentLoader — security hardening", () => {
  it.each([
    "../../etc/passwd",
    "../escape",
    "a/../../secret",
    "foo/bar",
    "..",
    "with space",
    "",
  ])("rejects a path-traversal/unsafe env name %j", (bad) => {
    // SEC-1: name must not be able to escape rootDir via the file path.
    write("environments/passwd.yaml", MINIMAL); // a file that MUST NOT load
    const result = loader().load(bad);
    expect(result.valid).toBe(false);
    expect(result.errors?.join("\n")).toContain("Invalid environment name");
  });

  it("accepts a well-formed hyphen/underscore env name", () => {
    write(".env.qa-1_test.yaml", MINIMAL);
    const result = loader().load("qa-1_test");
    expect(result.valid).toBe(true);
    expect(result.environment?.name).toBe("qa");
  });

  it("does not pollute Object.prototype from a __proto__ config key", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
__proto__:
  polluted: yes
`,
    );
    const result = loader().load("qa");
    // No global prototype pollution regardless of validity.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call({}, "polluted")).toBe(false);
    if (result.valid) {
      expect(Object.getPrototypeOf(result.environment)).toBe(Object.prototype);
    }
  });

  // Accepted, same-file/same-trust behavior: an ${env.*} value that resolves
  // to a literal ${secret.*} token IS then secret-resolved. Pinned so the
  // cross-namespace chain stays intentional rather than accidental.
  it("pins: an env value resolving to a secret token gets secret-resolved", () => {
    write(
      ".env.qa.yaml",
      `
name: qa
prod: false
base_url: https://api-qa.example.com
databases:
  pg:
    type: postgres
    injected: "\${secret.PG_PW}"
    password: "\${env.databases.pg.injected}"
`,
    );
    const result = loader({ PG_PW: "s3cr3t" }).load("qa");
    expect(result.valid).toBe(true);
    expect(result.environment?.databases?.pg.password).toBe("s3cr3t");
  });
});
