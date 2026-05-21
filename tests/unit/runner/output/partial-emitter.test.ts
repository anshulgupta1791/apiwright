import { mkdir, readFile, stat, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, it, expect } from "vitest";

import { SecretRegistry } from "../../../../src/env/index.js";
import { createPartialEmitter } from "../../../../src/runner/output/partial-emitter.js";
import type { EndpointResult } from "../../../../src/runner/types.js";

const SAMPLE: EndpointResult = {
  endpoint_id: "users.create",
  status: "pass",
  attempts: [
    {
      attempt: 1,
      verdict: "pass",
      started_at: 1,
      ended_at: 2,
      assertions: [],
      db_verify: [],
    },
  ],
  flaky: false,
};

describe("createPartialEmitter", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `apiwright-partial-${Date.now()}-${Math.random()}`);
    path = join(dir, "run.partial.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the parent directory if missing", async () => {
    const emitter = await createPartialEmitter(path, new SecretRegistry());
    await emitter.append(SAMPLE);
    const s = await stat(dir);
    expect(s.isDirectory()).toBe(true);
    await emitter.finalize();
  });

  it("writes one JSON line per append", async () => {
    const emitter = await createPartialEmitter(path, new SecretRegistry());
    await emitter.append(SAMPLE);
    await emitter.append({ ...SAMPLE, endpoint_id: "users.update" });
    // Read BEFORE finalize — that's the whole point: partial-on-disk survives crash.
    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    const a = JSON.parse(lines[0] as string) as EndpointResult;
    const b = JSON.parse(lines[1] as string) as EndpointResult;
    expect(a.endpoint_id).toBe("users.create");
    expect(b.endpoint_id).toBe("users.update");
    await emitter.finalize();
  });

  it("redacts secrets via SecretRegistry before writing", async () => {
    const secrets = new SecretRegistry();
    secrets.add("supersecret123");
    const emitter = await createPartialEmitter(path, secrets);
    const tainted: EndpointResult = {
      ...SAMPLE,
      attempts: [
        {
          ...(SAMPLE.attempts[0] as EndpointResult["attempts"][number]),
          failure_reason: "Token=supersecret123 expired",
        },
      ],
    };
    await emitter.append(tainted);
    const text = await readFile(path, "utf8");
    expect(text).not.toContain("supersecret123");
    expect(text).toContain("[REDACTED]");
    await emitter.finalize();
  });

  it("finalize deletes the partial file (graceful run end)", async () => {
    const emitter = await createPartialEmitter(path, new SecretRegistry());
    await emitter.append(SAMPLE);
    await emitter.finalize();
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("finalize is idempotent — second call is a no-op", async () => {
    const emitter = await createPartialEmitter(path, new SecretRegistry());
    await emitter.append(SAMPLE);
    await emitter.finalize();
    await expect(emitter.finalize()).resolves.toBeUndefined();
  });

  it("append after finalize is a no-op (does not throw)", async () => {
    const emitter = await createPartialEmitter(path, new SecretRegistry());
    await emitter.finalize();
    await expect(emitter.append(SAMPLE)).resolves.toBeUndefined();
  });

  it("finalize tolerates the file already being gone (ENOENT)", async () => {
    const emitter = await createPartialEmitter(path, new SecretRegistry());
    await emitter.append(SAMPLE);
    // Simulate something else cleaning up — finalize should still succeed.
    await rm(path);
    await expect(emitter.finalize()).resolves.toBeUndefined();
  });

  it("each line is independently parseable JSON (true JSONL format)", async () => {
    const emitter = await createPartialEmitter(path, new SecretRegistry());
    for (let i = 0; i < 5; i++) {
      await emitter.append({ ...SAMPLE, endpoint_id: `e${i}` });
    }
    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
    await emitter.finalize();
  });

  it("overwrites a previously existing file at the same path", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path, "STALE CONTENT", "utf8");
    const emitter = await createPartialEmitter(path, new SecretRegistry());
    await emitter.append(SAMPLE);
    const text = await readFile(path, "utf8");
    expect(text).not.toContain("STALE");
    await emitter.finalize();
  });
});
