import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { isRunnerError } from "../../../src/runner/index.js";
import {
  createDefaultHttpClient,
  type HttpClientSeam,
} from "../../../src/runner/execute/http-client.js";
import type { RequestRecord } from "../../../src/runner/types.js";

/** Builds a fake fetch Response shape sufficient for the client. */
function fakeResponse(status: number, body: string, headers: Record<string, string> = {}): unknown {
  const h = new Headers(headers);
  return { status, headers: h, text: async () => body };
}

describe("createDefaultHttpClient", () => {
  let client: HttpClientSeam;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = createDefaultHttpClient();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns a status + parsed JSON body for 2xx with JSON content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(200, '{"a":1}', { "content-type": "application/json" })));
    const req: RequestRecord = { method: "GET", url: "https://example.com/x", headers: {} };
    const res = await client.send(req);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ a: 1 });
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.time_ms).toBeGreaterThanOrEqual(0);
  });

  it("falls back to raw text for non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(200, "not json")));
    const req: RequestRecord = { method: "GET", url: "https://example.com/x", headers: {} };
    const res = await client.send(req);
    expect(res.body).toBe("not json");
  });

  it("returns null body for empty response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(204, "")));
    const req: RequestRecord = { method: "DELETE", url: "https://example.com/x", headers: {} };
    const res = await client.send(req);
    expect(res.body).toBeNull();
  });

  it("serializes object body as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);
    const req: RequestRecord = {
      method: "POST",
      url: "https://example.com/x",
      headers: { "content-type": "application/json" },
      body: { foo: "bar" },
    };
    await client.send(req);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: string };
    expect(init.body).toBe('{"foo":"bar"}');
  });

  it("passes string body through unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);
    const req: RequestRecord = {
      method: "POST",
      url: "https://example.com/x",
      headers: {},
      body: "raw string",
    };
    await client.send(req);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: string };
    expect(init.body).toBe("raw string");
  });

  it("omits body for null or undefined", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);
    const req: RequestRecord = { method: "GET", url: "https://example.com/x", headers: {} };
    await client.send(req);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: string };
    expect(init.body).toBeUndefined();
  });

  it("throws RunnerError on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const req: RequestRecord = { method: "GET", url: "https://example.com/x", headers: {} };
    try {
      await client.send(req);
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isRunnerError(e)).toBe(true);
    }
  });
});
