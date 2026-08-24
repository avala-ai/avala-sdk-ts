import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, Server } from "node:http";
import type { Avala } from "@avala-ai/sdk";
import { createAvalaMcpHttpServer, extractCredential, HEALTH_PATH, MAX_BODY_BYTES, MCP_PATH } from "../src/httpServer.js";

const KEY_A = "ab".repeat(20); // 40 lowercase hex chars — the Avala API key shape
const KEY_B = "cd".repeat(20);
// Header-shaped like a JWT: must be refused (this server never verifies JWTs).
const JWT_LOOKALIKE = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln";

interface MockAvala {
  apiKey: string;
  transport: { requestPage: ReturnType<typeof vi.fn> };
}

function makeMockAvala(apiKey: string, listDelayMs = 0): MockAvala {
  return {
    apiKey,
    transport: {
      requestPage: vi.fn(async () => {
        if (listDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, listDelayMs));
        return {
          items: [
            {
              uid: `dataset-for-${apiKey}`,
              name: "Credential-isolated dataset",
              slug: "credential-isolated-dataset",
              itemCount: 1,
              dataType: "image",
            },
          ],
          nextCursor: null,
          previousCursor: null,
          hasMore: false,
        };
      }),
    },
  };
}

function fakeReq(headers: Record<string, string | string[]>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

/**
 * A request as Node actually delivers it (>=18.3): `headersDistinct` keeps one
 * array entry per received header LINE. Plain `headers` joins duplicate custom
 * headers with ", " and drops duplicate Authorization lines entirely, so
 * duplicate detection must go through headersDistinct.
 */
function fakeReqDistinct(headersDistinct: Record<string, string[]>): IncomingMessage {
  const headers: Record<string, string> = {};
  for (const [name, values] of Object.entries(headersDistinct)) {
    // Mirror Node's lossy join: Authorization keeps the FIRST line only,
    // other headers are comma-joined.
    headers[name] = name === "authorization" ? values[0]! : values.join(", ");
  }
  return { headers, headersDistinct } as unknown as IncomingMessage;
}

/**
 * Close a test server without waiting for fetch's idle keep-alive sockets.
 * Node 19+ does this as part of server.close(); Node 18 requires the explicit
 * closeIdleConnections() call after shutdown starts.
 */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeIdleConnections();
  });
}

describe("extractCredential", () => {
  it("accepts X-Avala-Api-Key verbatim (Django decides validity)", () => {
    expect(extractCredential(fakeReq({ "x-avala-api-key": " some-key " }))).toEqual({ ok: true, apiKey: "some-key" });
  });

  it("rejects duplicate X-Avala-Api-Key header lines with 400 (via headersDistinct)", () => {
    const result = extractCredential(fakeReqDistinct({ "x-avala-api-key": [KEY_A, KEY_B] }));
    expect(result).toEqual({ ok: false, status: 400, message: expect.stringContaining("Multiple X-Avala-Api-Key") });
  });

  it("rejects duplicate Authorization header lines with 400, even though req.headers hides them", () => {
    // Node's plain `headers` drops the second Authorization line entirely —
    // this is exactly the case a naive headers-based check can never see.
    const req = fakeReqDistinct({ authorization: [`Bearer ${KEY_A}`, `Bearer ${KEY_B}`] });
    expect(req.headers.authorization).toBe(`Bearer ${KEY_A}`);
    const result = extractCredential(req);
    expect(result).toEqual({ ok: false, status: 400, message: expect.stringContaining("Multiple Authorization") });
  });

  it("accepts a single credential presented through headersDistinct", () => {
    expect(extractCredential(fakeReqDistinct({ "x-avala-api-key": [KEY_A] }))).toEqual({ ok: true, apiKey: KEY_A });
  });

  it("distinguishes 401 (missing/invalid) from 400 (ambiguous duplicates)", () => {
    const missing = extractCredential(fakeReq({}));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(401);
    const jwt = extractCredential(fakeReq({ authorization: `Bearer ${JWT_LOOKALIKE}` }));
    expect(jwt.ok).toBe(false);
    if (!jwt.ok) expect(jwt.status).toBe(401);
  });

  it("accepts Authorization: Bearer with a 40-hex API key", () => {
    expect(extractCredential(fakeReq({ authorization: `Bearer ${KEY_A}` }))).toEqual({ ok: true, apiKey: KEY_A });
  });

  it("prefers X-Avala-Api-Key over Authorization when both are present", () => {
    const result = extractCredential(fakeReq({ "x-avala-api-key": KEY_A, authorization: `Bearer ${KEY_B}` }));
    expect(result).toEqual({ ok: true, apiKey: KEY_A });
  });

  it.each([
    ["a JWT", `Bearer ${JWT_LOOKALIKE}`],
    ["uppercase hex", `Bearer ${"AB".repeat(20)}`],
    ["39 hex chars", `Bearer ${"a".repeat(39)}`],
    ["41 hex chars", `Bearer ${"a".repeat(41)}`],
    ["a non-Bearer scheme", `Basic ${KEY_A}`],
    ["an empty Bearer", "Bearer "],
  ])("rejects %s", (_label, authorization) => {
    expect(extractCredential(fakeReq({ authorization })).ok).toBe(false);
  });

  it("rejects a request with no credential at all", () => {
    expect(extractCredential(fakeReq({})).ok).toBe(false);
  });
});

describe("Streamable HTTP transport", () => {
  let server: Server;
  let base: string;
  let createdClients: MockAvala[];
  let listDelayMs = 0;

  beforeAll(async () => {
    createdClients = [];
    server = createAvalaMcpHttpServer({
      createClient: (apiKey: string) => {
        const client = makeMockAvala(apiKey, listDelayMs);
        createdClients.push(client);
        return client as unknown as Avala;
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  beforeEach(() => {
    createdClients.length = 0;
    listDelayMs = 0;
  });

  function mcpPost(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${base}${MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  function rpc(id: number, method: string, params: Record<string, unknown> = {}) {
    return { jsonrpc: "2.0", id, method, params };
  }

  const INITIALIZE = rpc(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  });

  it("GET /healthz returns 200 without credentials", async () => {
    const res = await fetch(`${base}${HEALTH_PATH}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("unknown paths return 404", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  it.each(["GET", "DELETE"])("%s on the MCP endpoint returns 405 (stateless: no session to resume)", async (method) => {
    const res = await fetch(`${base}${MCP_PATH}`, {
      method,
      headers: { "X-Avala-Api-Key": KEY_A, Accept: "application/json, text/event-stream" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("POST without a credential returns a JSON-RPC-shaped 401 with a Bearer challenge", async () => {
    const res = await mcpPost(INITIALIZE);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    const body = (await res.json()) as { jsonrpc: string; error: { code: number; message: string }; id: null };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32001);
    expect(body.id).toBeNull();
    expect(createdClients).toHaveLength(0);
  });

  it("POST with a JWT-shaped bearer returns 401 (JWT verification is Django's job, not ours)", async () => {
    const res = await mcpPost(INITIALIZE, { Authorization: `Bearer ${JWT_LOOKALIKE}` });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(createdClients).toHaveLength(0);
  });

  it("POST with a malformed JSON body returns 400", async () => {
    const res = await mcpPost("{this is not json", { "X-Avala-Api-Key": KEY_A });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("initialize → tools/list → tools/call round trip with a mocked Avala client", async () => {
    const initRes = await mcpPost(INITIALIZE, { "X-Avala-Api-Key": KEY_A });
    expect(initRes.status).toBe(200);
    const init = (await initRes.json()) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("avala");
    // initialize runs no tool, so no Avala client may be constructed for it.
    expect(createdClients).toHaveLength(0);

    const listRes = await mcpPost(rpc(2, "tools/list"), { "X-Avala-Api-Key": KEY_A });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { result: { tools: { name: string }[] } };
    // The hosted transport serves the read-only subset of the stdio catalog
    // (38 of 55) — mutations are stdio-only for now (§5.5-4); full-catalog
    // parity via the shared registerTools is pinned in server.test.ts.
    expect(list.result.tools).toHaveLength(38);
    expect(list.result.tools.map((t) => t.name)).toContain("list_datasets");
    expect(createdClients).toHaveLength(0);

    const callRes = await mcpPost(rpc(3, "tools/call", { name: "list_datasets", arguments: {} }), {
      "X-Avala-Api-Key": KEY_A,
    });
    expect(callRes.status).toBe(200);
    const call = (await callRes.json()) as { result: { content: { type: string; text: string }[] } };
    expect(call.result.content[0]!.text).toContain(`dataset-for-${KEY_A}`);

    expect(createdClients).toHaveLength(1);
    expect(createdClients[0]!.apiKey).toBe(KEY_A);
    expect(createdClients[0]!.transport.requestPage).toHaveBeenCalledWith("/datasets/", undefined);
  });

  it("two concurrent requests with different keys never leak clients between them", async () => {
    listDelayMs = 30; // keep both requests in flight simultaneously

    const [resA, resB] = await Promise.all([
      mcpPost(rpc(10, "tools/call", { name: "list_datasets", arguments: {} }), { "X-Avala-Api-Key": KEY_A }),
      mcpPost(rpc(11, "tools/call", { name: "list_datasets", arguments: {} }), { Authorization: `Bearer ${KEY_B}` }),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const textA = ((await resA.json()) as { result: { content: { text: string }[] } }).result.content[0]!.text;
    const textB = ((await resB.json()) as { result: { content: { text: string }[] } }).result.content[0]!.text;

    // Each response reflects exactly its own credential's client.
    expect(textA).toContain(`dataset-for-${KEY_A}`);
    expect(textA).not.toContain(`dataset-for-${KEY_B}`);
    expect(textB).toContain(`dataset-for-${KEY_B}`);
    expect(textB).not.toContain(`dataset-for-${KEY_A}`);

    // One client per request, keyed by that request's credential, used once.
    expect(createdClients).toHaveLength(2);
    expect(new Set(createdClients.map((c) => c.apiKey))).toEqual(new Set([KEY_A, KEY_B]));
    for (const client of createdClients) {
      expect(client.transport.requestPage).toHaveBeenCalledWith("/datasets/", undefined);
    }
  });

  /**
   * Send raw bytes so we control the exact request line and header framing —
   * fetch/undici normalize away the malformed inputs these tests exist for.
   */
  function rawRequest(payload: string): Promise<string> {
    const port = (server.address() as AddressInfo).port;
    return new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => socket.write(payload));
      let data = "";
      socket.on("data", (chunk) => {
        data += chunk.toString("utf8");
      });
      socket.on("end", () => resolve(data));
      socket.on("close", () => resolve(data));
      socket.on("error", reject);
      socket.setTimeout(2000, () => {
        socket.destroy();
        resolve(data);
      });
    });
  }

  it("a malformed request target (//) gets 400, and the process survives it", async () => {
    const response = await rawRequest("GET // HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
    expect(response).toMatch(/^HTTP\/1\.1 400 /);
    // The listener did not crash: the server still answers.
    const health = await fetch(`${base}${HEALTH_PATH}`);
    expect(health.status).toBe(200);
  });

  it("duplicate X-Avala-Api-Key header lines on the wire get 400", async () => {
    const response = await rawRequest(
      "POST /mcp HTTP/1.1\r\nHost: h\r\nContent-Type: application/json\r\n" +
        "Accept: application/json, text/event-stream\r\n" +
        `X-Avala-Api-Key: ${KEY_A}\r\nX-Avala-Api-Key: ${KEY_B}\r\n` +
        "Content-Length: 2\r\nConnection: close\r\n\r\n{}",
    );
    expect(response).toMatch(/^HTTP\/1\.1 400 /);
    expect(response).toContain("Multiple X-Avala-Api-Key");
    expect(createdClients).toHaveLength(0);
  });

  it("duplicate Authorization header lines on the wire get 400", async () => {
    const response = await rawRequest(
      "POST /mcp HTTP/1.1\r\nHost: h\r\nContent-Type: application/json\r\n" +
        "Accept: application/json, text/event-stream\r\n" +
        `Authorization: Bearer ${KEY_A}\r\nAuthorization: Bearer ${KEY_B}\r\n` +
        "Content-Length: 2\r\nConnection: close\r\n\r\n{}",
    );
    expect(response).toMatch(/^HTTP\/1\.1 400 /);
    expect(response).toContain("Multiple Authorization");
    expect(createdClients).toHaveLength(0);
  });

  it("a body over MAX_BODY_BYTES receives an actual 413 response, not a reset", async () => {
    const oversized = `{"pad":"${"x".repeat(MAX_BODY_BYTES + 1024)}"}`;
    const res = await mcpPost(oversized, { "X-Avala-Api-Key": KEY_A });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toContain("exceeds");
  });

  it("a request carrying a non-allowlisted Origin is refused 403 before credential handling", async () => {
    // No credential on purpose: 403 (not 401) proves the Origin check runs first.
    const res = await mcpPost(rpc(30, "tools/list"), { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    const health = await fetch(`${base}${HEALTH_PATH}`, { headers: { Origin: "https://evil.example" } });
    expect(health.status).toBe(403);
  });

  it("an allowlisted Origin is served", async () => {
    const originServer = createAvalaMcpHttpServer({
      allowedOrigins: ["https://app.avala.ai"],
      createClient: (apiKey: string) => makeMockAvala(apiKey) as unknown as Avala,
    });
    await new Promise<void>((resolve) => originServer.listen(0, "127.0.0.1", resolve));
    try {
      const originBase = `http://127.0.0.1:${(originServer.address() as AddressInfo).port}`;
      const ok = await fetch(`${originBase}${MCP_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "X-Avala-Api-Key": KEY_A,
          Origin: "https://app.avala.ai",
        },
        body: JSON.stringify(rpc(31, "tools/list")),
      });
      expect(ok.status).toBe(200);
      // Without this header the browser refuses to hand the response to the
      // page, even though the server processed the call.
      expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.avala.ai");
      const forbidden = await fetch(`${originBase}${HEALTH_PATH}`, { headers: { Origin: "https://other.example" } });
      expect(forbidden.status).toBe(403);
    } finally {
      await closeServer(originServer);
    }
  });

  it("a CORS preflight from an allowlisted origin gets 204 with the CORS headers", async () => {
    const originServer = createAvalaMcpHttpServer({
      allowedOrigins: ["https://app.avala.ai"],
      createClient: (apiKey: string) => makeMockAvala(apiKey) as unknown as Avala,
    });
    await new Promise<void>((resolve) => originServer.listen(0, "127.0.0.1", resolve));
    try {
      const originBase = `http://127.0.0.1:${(originServer.address() as AddressInfo).port}`;
      // What a browser actually sends before the cross-origin POST: no
      // credential header, just the announcement of what it intends to send.
      const res = await fetch(`${originBase}${MCP_PATH}`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.avala.ai",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,x-avala-api-key",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("https://app.avala.ai");
      expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
      expect(res.headers.get("access-control-allow-headers")).toBe(
        "Content-Type, Authorization, X-Avala-Api-Key, Mcp-Protocol-Version",
      );
      expect(res.headers.get("access-control-max-age")).toBe("7200");
    } finally {
      await closeServer(originServer);
    }
  });

  it("a CORS preflight from a non-allowlisted origin is refused 403", async () => {
    const res = await fetch(`${base}${MCP_PATH}`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-avala-api-key",
      },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("OPTIONS without an Origin stays a plain 405 for non-browser clients", async () => {
    const res = await fetch(`${base}${MCP_PATH}`, { method: "OPTIONS" });
    expect(res.status).toBe(405);
  });

  it("the hosted catalog is read-only even with AVALA_MCP_ENABLE_MUTATIONS=true in the environment", async () => {
    // §5.5-4: hosted v1 has NO destructive tools — the factory has no
    // mutations option and the entry reads no env var, so there is no
    // configuration under which these tools become remotely reachable.
    const previous = process.env.AVALA_MCP_ENABLE_MUTATIONS;
    process.env.AVALA_MCP_ENABLE_MUTATIONS = "true";
    const roServer = createAvalaMcpHttpServer({
      createClient: (apiKey: string) => makeMockAvala(apiKey) as unknown as Avala,
    });
    await new Promise<void>((resolve) => roServer.listen(0, "127.0.0.1", resolve));
    try {
      const roBase = `http://127.0.0.1:${(roServer.address() as AddressInfo).port}`;
      const res = await fetch(`${roBase}${MCP_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "X-Avala-Api-Key": KEY_A,
        },
        body: JSON.stringify(rpc(20, "tools/list")),
      });
      expect(res.status).toBe(200);
      const names = ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
      expect(names).toHaveLength(38);
      // The full mutation-gated set, esp. the four destructive delete-by-id
      // tools the finding named.
      const gated = [
        "create_agent",
        "delete_agent",
        "create_annotation_issue",
        "update_annotation_issue",
        "delete_annotation_issue",
        "compute_consensus",
        "create_dataset",
        "create_export",
        "fleet_register_device",
        "fleet_acknowledge_alert",
        "evaluate_quality",
        "create_storage_config",
        "test_storage_config",
        "delete_storage_config",
        "create_webhook",
        "delete_webhook",
        "create_annotation_pipeline",
      ];
      for (const tool of gated) {
        expect(names).not.toContain(tool);
      }
      expect(names.filter((n) => n.startsWith("create_") || n.startsWith("delete_"))).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.AVALA_MCP_ENABLE_MUTATIONS;
      else process.env.AVALA_MCP_ENABLE_MUTATIONS = previous;
      await closeServer(roServer);
    }
  });
});
