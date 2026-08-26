import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, Server } from "node:http";
import { AvalaError, type Avala } from "@avala-ai/sdk";
import toolsetScopes from "../toolset-scopes.json";
import {
  createAvalaMcpHttpServer,
  extractCredential,
  extractForwardedClientIp,
  HEALTH_PATH,
  MAX_BODY_BYTES,
  MCP_PATH,
} from "../src/httpServer.js";
import {
  HostedOAuthError,
  PROTECTED_RESOURCE_METADATA_PATH,
  type HostedOAuthConfig,
} from "../src/oauth.js";

const KEY_A = "ab".repeat(20); // 40 lowercase hex chars — the Avala API key shape
const KEY_B = "cd".repeat(20);
const VALID_INTERNAL_CLIENT_SECRET = "s".repeat(32);
const JWT_LOOKALIKE = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln";
const DOWNSTREAM_ACCESS_TOKEN = "downstream.api.token";
const SUBJECT_ISSUED_AT = 1_788_000_000;
const TEST_OAUTH: HostedOAuthConfig = {
  resource: "https://mcp.avala.ai/mcp",
  authorizationServer: "https://identity.example.com/",
  apiAudience: "https://api.avala.ai/",
  clientId: "test-client-id",
  clientSecret: "test-client-secret-value",
  scopesSupported: ["datasets.read", "projects.read"],
};
const RESOURCE_METADATA_URL =
  "https://mcp.avala.ai/.well-known/oauth-protected-resource/mcp";
const BEARER_SCOPE = TEST_OAUTH.scopesSupported.join(" ");
const DEFAULT_SCOPES = [...new Set(Object.values(toolsetScopes).flat())];
const DEFAULT_TOOLSETS = [...Object.keys(toolsetScopes), "docs", "public"];

function defaultPermissions() {
  return {
    type: "customer",
    isStaffPrivileged: false,
    scopes: [...DEFAULT_SCOPES],
    capabilities: [],
    toolsets: [...DEFAULT_TOOLSETS],
  };
}

let permissionsForKey: (apiKey: string) => unknown = () => defaultPermissions();
let permissionFailureForKey: (apiKey: string) => unknown | undefined = () =>
  undefined;

interface MockAvala {
  apiKey: string;
  clientName: string;
  permissions: { get: ReturnType<typeof vi.fn> };
  transport: { requestPage: ReturnType<typeof vi.fn> };
}

function makeMockAvala(
  apiKey: string,
  clientName = "test_tool",
  listDelayMs = 0,
): MockAvala {
  return {
    apiKey,
    clientName,
    permissions: {
      get: vi.fn(async () => {
        const failure = permissionFailureForKey(apiKey);
        if (failure !== undefined) throw failure;
        return permissionsForKey(apiKey);
      }),
    },
    transport: {
      requestPage: vi.fn(async () => {
        if (listDelayMs > 0)
          await new Promise((resolve) => setTimeout(resolve, listDelayMs));
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
 * A synthetic request exposing Node's `headersDistinct` representation.
 * Plain `headers` joins duplicate custom headers with ", " and drops duplicate
 * Authorization lines entirely, so it cannot enforce credential ambiguity.
 */
function fakeReqDistinct(
  headersDistinct: Record<string, string[]>,
): IncomingMessage {
  const headers: Record<string, string> = {};
  for (const [name, values] of Object.entries(headersDistinct)) {
    // Mirror Node's lossy join: Authorization keeps the FIRST line only,
    // other headers are comma-joined.
    headers[name] = name === "authorization" ? values[0]! : values.join(", ");
  }
  return { headers, headersDistinct } as unknown as IncomingMessage;
}

/** A synthetic request exposing the cross-runtime raw header representation. */
function fakeReqRaw(rawHeaders: string[]): IncomingMessage {
  const headers: Record<string, string> = {};
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]!.toLowerCase();
    if (headers[name] === undefined)
      headers[name] = rawHeaders[index + 1] ?? "";
  }
  return { headers, rawHeaders } as unknown as IncomingMessage;
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
    expect(
      extractCredential(fakeReq({ "x-avala-api-key": " some-key " })),
    ).toEqual({
      ok: true,
      kind: "api_key",
      apiKey: "some-key",
    });
  });

  it("rejects duplicate X-Avala-Api-Key header lines with 400 (via headersDistinct)", () => {
    const result = extractCredential(
      fakeReqDistinct({ "x-avala-api-key": [KEY_A, KEY_B] }),
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: expect.stringContaining("Multiple X-Avala-Api-Key"),
    });
  });

  it("rejects duplicate Authorization header lines with 400, even though req.headers hides them", () => {
    // Node's plain `headers` drops the second Authorization line entirely —
    // this is exactly the case a naive headers-based check can never see.
    const req = fakeReqDistinct({
      authorization: [`Bearer ${KEY_A}`, `Bearer ${KEY_B}`],
    });
    expect(req.headers.authorization).toBe(`Bearer ${KEY_A}`);
    const result = extractCredential(req);
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: expect.stringContaining("Multiple Authorization"),
    });
  });

  it("accepts a single credential presented through headersDistinct", () => {
    expect(
      extractCredential(fakeReqDistinct({ "x-avala-api-key": [KEY_A] })),
    ).toEqual({
      ok: true,
      kind: "api_key",
      apiKey: KEY_A,
    });
  });

  it("rejects duplicate credential lines from rawHeaders before normalized headers", () => {
    const req = fakeReqRaw([
      "X-Avala-Api-Key",
      KEY_A,
      "x-avala-api-key",
      KEY_B,
      "Authorization",
      `Bearer ${KEY_A}`,
      "authorization",
      `Bearer ${KEY_B}`,
    ]);
    expect(extractCredential(req)).toEqual({
      ok: false,
      status: 400,
      message: expect.stringContaining("Multiple X-Avala-Api-Key"),
    });
  });

  it("distinguishes 401 (missing/invalid) from 400 (ambiguous duplicates)", () => {
    const missing = extractCredential(fakeReq({}));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(401);
    const invalidScheme = extractCredential(
      fakeReq({ authorization: `Basic ${KEY_A}` }),
    );
    expect(invalidScheme.ok).toBe(false);
    if (!invalidScheme.ok) expect(invalidScheme.status).toBe(401);
  });

  it("accepts Authorization: Bearer with a 40-hex API key", () => {
    expect(
      extractCredential(fakeReq({ authorization: `Bearer ${KEY_A}` })),
    ).toEqual({
      ok: true,
      kind: "api_key",
      apiKey: KEY_A,
    });
  });

  it("rejects mixed API-key and Authorization headers", () => {
    const result = extractCredential(
      fakeReq({ "x-avala-api-key": KEY_A, authorization: `Bearer ${KEY_B}` }),
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: "Provide exactly one credential header.",
    });
  });

  it.each([JWT_LOOKALIKE, "AB".repeat(20), "a".repeat(39), "a".repeat(41)])(
    "routes non-API-key Bearer value %s through OAuth validation",
    (subjectToken) => {
      expect(
        extractCredential(fakeReq({ authorization: `Bearer ${subjectToken}` })),
      ).toEqual({
        ok: true,
        kind: "oauth",
        subjectToken,
      });
    },
  );

  it.each([
    ["a non-Bearer scheme", `Basic ${KEY_A}`],
    ["an empty Bearer", "Bearer "],
  ])("rejects %s", (_label, authorization) => {
    expect(extractCredential(fakeReq({ authorization })).ok).toBe(false);
  });

  it("rejects a request with no credential at all", () => {
    expect(extractCredential(fakeReq({})).ok).toBe(false);
  });
});

describe("extractForwardedClientIp", () => {
  it("uses only the ALB-appended final X-Forwarded-For token", () => {
    const request = fakeReq({
      "x-forwarded-for": "attacker-controlled, 198.51.100.7, 203.0.113.42",
    });
    expect(extractForwardedClientIp(request)).toEqual({
      ok: true,
      forwardedClientIp: "203.0.113.42",
    });
  });

  it("uses the last token across duplicate raw header lines", () => {
    const request = fakeReqRaw([
      "X-Forwarded-For",
      "attacker-controlled",
      "x-forwarded-for",
      "2001:db8::42",
    ]);
    expect(extractForwardedClientIp(request)).toEqual({
      ok: true,
      forwardedClientIp: "2001:db8::42",
    });
  });

  it.each(["not-an-ip", "203.0.113.1, not-an-ip", "fe80::1%eth0"])(
    "rejects malformed infrastructure context %j",
    (forwarded) => {
      const result = extractForwardedClientIp(
        fakeReq({ "x-forwarded-for": forwarded }),
      );
      expect(result).toEqual({
        ok: false,
        status: 400,
        message: "Unable to establish client network context.",
      });
    },
  );

  it("falls back to the direct TCP peer when X-Forwarded-For is absent", () => {
    const request = fakeReq({});
    Object.defineProperty(request, "socket", {
      value: { remoteAddress: "127.0.0.1" },
    });
    expect(extractForwardedClientIp(request)).toEqual({
      ok: true,
      forwardedClientIp: "127.0.0.1",
    });
  });
});

describe("Streamable HTTP transport", () => {
  let server: Server;
  let base: string;
  let createdClients: MockAvala[];
  let createdClientIps: string[];
  let createdCredentialKinds: ("api_key" | "oauth")[];
  let createdSubjectIssuedAts: number[];
  let oauthExchangeFailure: unknown;
  let listDelayMs = 0;
  const oauthExchange = vi.fn(async (subjectToken: string) => {
    if (oauthExchangeFailure !== undefined) throw oauthExchangeFailure;
    return {
      accessToken: DOWNSTREAM_ACCESS_TOKEN,
      subject: `subject-for-${subjectToken}`,
      subjectIssuedAt: SUBJECT_ISSUED_AT,
      scopes: ["datasets.read"],
      expiresAt: Date.now() + 60_000,
    };
  });

  beforeAll(async () => {
    createdClients = [];
    createdClientIps = [];
    createdCredentialKinds = [];
    createdSubjectIssuedAts = [];
    server = createAvalaMcpHttpServer({
      oauth: TEST_OAUTH,
      oauthBroker: { exchange: oauthExchange },
      internalClientSecret: VALID_INTERNAL_CLIENT_SECRET,
      createClient: (
        apiKey: string,
        clientName: string,
        forwardedClientIp: string,
      ) => {
        const client = makeMockAvala(apiKey, clientName, listDelayMs);
        createdClients.push(client);
        createdClientIps.push(forwardedClientIp);
        createdCredentialKinds.push("api_key");
        return client as unknown as Avala;
      },
      createAccessTokenClient: (
        accessToken: string,
        clientName: string,
        forwardedClientIp: string,
        subjectIssuedAt: number,
      ) => {
        const client = makeMockAvala(accessToken, clientName, listDelayMs);
        createdClients.push(client);
        createdClientIps.push(forwardedClientIp);
        createdCredentialKinds.push("oauth");
        createdSubjectIssuedAts.push(subjectIssuedAt);
        return client as unknown as Avala;
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  beforeEach(() => {
    createdClients.length = 0;
    createdClientIps.length = 0;
    createdCredentialKinds.length = 0;
    createdSubjectIssuedAts.length = 0;
    oauthExchangeFailure = undefined;
    oauthExchange.mockClear();
    listDelayMs = 0;
    permissionsForKey = () => defaultPermissions();
    permissionFailureForKey = () => undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    undefined,
    "",
    "too-short",
    ` ${"s".repeat(32)}`,
    "é".repeat(32),
    "s".repeat(513),
  ])(
    "rejects a non-canonical hosted secret at startup",
    (internalClientSecret) => {
      expect(() =>
        createAvalaMcpHttpServer({ internalClientSecret, oauth: TEST_OAUTH }),
      ).toThrowError(
        "internalClientSecret must contain 32-512 URL-safe ASCII characters",
      );
    },
  );

  function mcpPost(
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
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

  function rpc(
    id: number,
    method: string,
    params: Record<string, unknown> = {},
  ) {
    return { jsonrpc: "2.0", id, method, params };
  }

  async function mcpResult<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      return JSON.parse(text) as T;
    }

    const payloads = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length));
    if (payloads.length !== 1) {
      throw new Error(
        `Expected one legacy SSE payload, received ${payloads.length}.`,
      );
    }
    return JSON.parse(payloads[0]!) as T;
  }

  function modernRpc(
    id: number,
    method: string,
    params: Record<string, unknown> = {},
  ) {
    return rpc(id, method, {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          name: "test-client",
          version: "0.0.0",
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    });
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

  it("GET / advertises the MCP endpoint and OAuth discovery URL", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: "avala-mcp",
      status: "ok",
      transport: "streamable-http",
      mcp_endpoint: TEST_OAUTH.resource,
      protected_resource_metadata: RESOURCE_METADATA_URL,
    });
  });

  it("serves canonical RFC 9728 protected-resource metadata publicly", async () => {
    const res = await fetch(`${base}${PROTECTED_RESOURCE_METADATA_PATH}`, {
      headers: { Origin: "https://untrusted.example" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual({
      resource: TEST_OAUTH.resource,
      authorization_servers: [TEST_OAUTH.authorizationServer],
      bearer_methods_supported: ["header"],
      scopes_supported: TEST_OAUTH.scopesSupported,
      resource_name: "Avala Physical AI Data Platform MCP",
    });

    const head = await fetch(`${base}${PROTECTED_RESOURCE_METADATA_PATH}`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("unknown paths return 404", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  it.each(["GET", "DELETE"])(
    "%s on the MCP endpoint returns 405 (stateless: no session to resume)",
    async (method) => {
      const res = await fetch(`${base}${MCP_PATH}`, {
        method,
        headers: {
          "X-Avala-Api-Key": KEY_A,
          Accept: "application/json, text/event-stream",
        },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    },
  );

  it("POST without a credential returns a JSON-RPC-shaped 401 with a Bearer challenge", async () => {
    const res = await mcpPost(INITIALIZE);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${RESOURCE_METADATA_URL}", scope="${BEARER_SCOPE}"`,
    );
    const body = (await res.json()) as {
      jsonrpc: string;
      error: { code: number; message: string };
      id: null;
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32001);
    expect(body.id).toBeNull();
    expect(createdClients).toHaveLength(0);
  });

  it("exchanges an OAuth subject token and uses only the downstream API token", async () => {
    const res = await mcpPost(INITIALIZE, {
      Authorization: `Bearer ${JWT_LOOKALIKE}`,
    });
    expect(res.status).toBe(200);
    expect(oauthExchange).toHaveBeenCalledOnce();
    expect(oauthExchange).toHaveBeenCalledWith(JWT_LOOKALIKE);
    expect(createdCredentialKinds).toEqual(["oauth"]);
    expect(createdClients[0]!.apiKey).toBe(DOWNSTREAM_ACCESS_TOKEN);
    expect(createdClients[0]!.apiKey).not.toBe(JWT_LOOKALIKE);
    expect(createdSubjectIssuedAts).toEqual([SUBJECT_ISSUED_AT]);
  });

  it.each([
    ["invalid_token", 401, "invalid_token"],
    ["insufficient_scope", 403, "insufficient_scope"],
    ["temporarily_unavailable", 503, null],
  ] as const)(
    "maps OAuth %s failures without exposing token details",
    async (kind, status, challengeError) => {
      oauthExchangeFailure = new HostedOAuthError(kind);

      const res = await mcpPost(INITIALIZE, {
        Authorization: `Bearer ${JWT_LOOKALIKE}`,
      });
      const text = await res.text();
      expect(res.status).toBe(status);
      expect(text).not.toContain(JWT_LOOKALIKE);
      if (challengeError === null) {
        expect(res.headers.get("www-authenticate")).toBeNull();
      } else {
        expect(res.headers.get("www-authenticate")).toBe(
          `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="${challengeError}", scope="${BEARER_SCOPE}"`,
        );
      }
      expect(createdClients).toHaveLength(0);
    },
  );

  it("rejects mixed credential channels before OAuth exchange", async () => {
    const res = await mcpPost(INITIALIZE, {
      "X-Avala-Api-Key": KEY_A,
      Authorization: `Bearer ${JWT_LOOKALIKE}`,
    });
    expect(res.status).toBe(400);
    expect(oauthExchange).not.toHaveBeenCalled();
    expect(createdClients).toHaveLength(0);
  });

  it("POST with a malformed JSON body returns 400", async () => {
    const res = await mcpPost("{this is not json", {
      "X-Avala-Api-Key": KEY_A,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("initialize → tools/list → tools/call round trip with a mocked Avala client", async () => {
    const initRes = await mcpPost(INITIALIZE, { "X-Avala-Api-Key": KEY_A });
    expect(initRes.status).toBe(200);
    const init = await mcpResult<{
      result: { serverInfo: { name: string } };
    }>(initRes);
    expect(init.result.serverInfo.name).toBe("avala");
    expect(createdClients).toHaveLength(1);
    expect(createdClients[0]!.clientName).toBe("mcp_permissions_discovery");
    expect(createdClients[0]!.permissions.get).toHaveBeenCalledTimes(1);

    const listRes = await mcpPost(rpc(2, "tools/list"), {
      "X-Avala-Api-Key": KEY_A,
    });
    expect(listRes.status).toBe(200);
    const list = await mcpResult<{
      result: { tools: { name: string }[] };
    }>(listRes);
    // The hosted transport serves the read-only subset of the stdio catalog
    // (44 of 61) — mutations are stdio-only for now (§5.5-4); full-catalog
    // parity via the shared registerTools is pinned in server.test.ts.
    expect(list.result.tools).toHaveLength(44);
    expect(list.result.tools.map((t) => t.name)).toContain("list_datasets");
    expect(createdClients).toHaveLength(2);
    expect(
      createdClients.every(
        (client) => client.clientName === "mcp_permissions_discovery",
      ),
    ).toBe(true);

    const callRes = await mcpPost(
      rpc(3, "tools/call", { name: "list_datasets", arguments: {} }),
      {
        "X-Avala-Api-Key": KEY_A,
      },
    );
    expect(callRes.status).toBe(200);
    const call = await mcpResult<{
      result: { content: { type: string; text: string }[] };
    }>(callRes);
    expect(call.result.content[0]!.text).toContain(`dataset-for-${KEY_A}`);

    expect(createdClients).toHaveLength(4);
    const discoveryClients = createdClients.filter(
      (client) => client.clientName === "mcp_permissions_discovery",
    );
    const datasetClient = createdClients.find(
      (client) => client.clientName === "list_datasets",
    );
    expect(discoveryClients).toHaveLength(3);
    expect(
      discoveryClients.every(
        (client) => client.permissions.get.mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(datasetClient?.apiKey).toBe(KEY_A);
    expect(datasetClient?.transport.requestPage).toHaveBeenCalledWith(
      "/datasets/",
      undefined,
    );
  });

  it("serves the 2026-07-28 stateless discovery and tool catalog as JSON", async () => {
    const discoverRes = await mcpPost(modernRpc(30, "server/discover"), {
      "Mcp-Protocol-Version": "2026-07-28",
      "Mcp-Method": "server/discover",
      "X-Avala-Api-Key": KEY_A,
    });
    expect(discoverRes.status).toBe(200);
    expect(discoverRes.headers.get("content-type")).toContain(
      "application/json",
    );
    const discover = await mcpResult<{
      result: { resultType: string; supportedVersions: string[] };
    }>(discoverRes);
    expect(discover.result.resultType).toBe("complete");
    expect(discover.result.supportedVersions).toContain("2026-07-28");

    const listRes = await mcpPost(modernRpc(31, "tools/list"), {
      "Mcp-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/list",
      "X-Avala-Api-Key": KEY_A,
    });
    expect(listRes.status).toBe(200);
    expect(listRes.headers.get("content-type")).toContain("application/json");
    const list = await mcpResult<{
      result: { resultType: string; tools: { name: string }[] };
    }>(listRes);
    expect(list.result.resultType).toBe("complete");
    expect(list.result.tools).toHaveLength(44);
    expect(list.result.tools.map((tool) => tool.name)).toContain(
      "list_datasets",
    );
  });

  it("discovers once and lists only tools allowed by the credential grant", async () => {
    permissionsForKey = () => ({
      type: "customer",
      isStaffPrivileged: false,
      scopes: ["datasets.read"],
      capabilities: [],
      toolsets: ["datasets", "docs", "public", "quality", "sequences"],
    });

    const res = await mcpPost(rpc(4, "tools/list"), {
      "X-Avala-Api-Key": KEY_A,
    });
    expect(res.status).toBe(200);
    const names = (
      await mcpResult<{ result: { tools: { name: string }[] } }>(res)
    ).result.tools.map((tool) => tool.name);
    expect(names).toContain("list_datasets");
    expect(names).toContain("list_sequences");
    expect(names).toContain("get_frame");
    expect(names).toContain("get_result_acceptance");
    expect(names).not.toContain("list_projects");
    expect(names).not.toContain("list_quality_targets");
    expect(names).not.toContain("get_workspace_overview");
    expect(createdClients).toHaveLength(1);
    expect(createdClients[0]!.apiKey).toBe(KEY_A);
    expect(createdClients[0]!.clientName).toBe("mcp_permissions_discovery");
    expect(createdClientIps).toEqual(["127.0.0.1"]);
    expect(createdClients[0]!.permissions.get).toHaveBeenCalledTimes(1);
  });

  it("returns an empty catalog for a valid credential with no scopes", async () => {
    permissionsForKey = () => ({
      type: "customer",
      isStaffPrivileged: false,
      scopes: [],
      capabilities: [],
      toolsets: ["docs", "public"],
    });

    const res = await mcpPost(rpc(5, "tools/list"), {
      "X-Avala-Api-Key": KEY_A,
    });
    expect(res.status).toBe(200);
    const tools = (await mcpResult<{ result: { tools: unknown[] } }>(res))
      .result.tools;
    expect(tools).toEqual([]);

    const callRes = await mcpPost(
      rpc(8, "tools/call", { name: "list_datasets", arguments: {} }),
      {
        "X-Avala-Api-Key": KEY_A,
      },
    );
    expect(callRes.status).toBe(200);
    const call = await mcpResult<{
      error: { code: number; message: string };
    }>(callRes);
    expect(call.error.code).toBe(-32602);
    expect(call.error.message).toContain("not found");
    expect(call.error.message).not.toContain("disabled");
  });

  it("fails closed without leaking upstream details when permission discovery fails", async () => {
    permissionFailureForKey = () =>
      new AvalaError("upstream echoed secret-value", 401, {
        api_key: "secret-value",
      });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const res = await mcpPost(rpc(6, "tools/list"), {
      "X-Avala-Api-Key": KEY_A,
    });
    const text = await res.text();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="invalid_token", scope="${BEARER_SCOPE}"`,
    );
    expect(text).toContain("Invalid or expired Avala credential");
    expect(text).not.toContain("secret-value");
    expect(createdClients).toHaveLength(1);
    expect(createdClients[0]!.clientName).toBe("mcp_permissions_discovery");
    expect(consoleError).toHaveBeenCalledWith(
      "avala-mcp-http: credential permission discovery failed (HTTP 401).",
    );
  });

  it("fails closed on a malformed permission grant", async () => {
    permissionsForKey = () => ({
      type: "customer",
      isStaffPrivileged: false,
      scopes: ["datasets.read", "datasets.read"],
      capabilities: [],
      toolsets: ["datasets"],
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const res = await mcpPost(rpc(7, "tools/list"), {
      "X-Avala-Api-Key": KEY_A,
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      "Credential permission discovery is unavailable.",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "avala-mcp-http: credential permission discovery failed.",
    );
  });

  it("forwards the ALB-appended client IP into each request-scoped Avala client", async () => {
    const callRes = await mcpPost(
      rpc(4, "tools/call", { name: "list_datasets", arguments: {} }),
      {
        "X-Avala-Api-Key": KEY_A,
        "X-Forwarded-For": "spoofed-prefix, 203.0.113.42",
      },
    );

    expect(callRes.status).toBe(200);
    expect(createdClientIps).toEqual(["203.0.113.42", "203.0.113.42"]);
  });

  it("rejects a malformed final XFF hop before constructing a client", async () => {
    const callRes = await mcpPost(
      rpc(5, "tools/call", { name: "list_datasets", arguments: {} }),
      {
        "X-Avala-Api-Key": KEY_A,
        "X-Forwarded-For": "203.0.113.42, malformed-final-hop",
      },
    );

    expect(callRes.status).toBe(400);
    expect(createdClients).toHaveLength(0);
  });

  it("two concurrent requests with different keys never leak clients between them", async () => {
    listDelayMs = 30; // keep both requests in flight simultaneously

    const [resA, resB] = await Promise.all([
      mcpPost(rpc(10, "tools/call", { name: "list_datasets", arguments: {} }), {
        "X-Avala-Api-Key": KEY_A,
      }),
      mcpPost(rpc(11, "tools/call", { name: "list_datasets", arguments: {} }), {
        Authorization: `Bearer ${KEY_B}`,
      }),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const textA = (
      await mcpResult<{ result: { content: { text: string }[] } }>(resA)
    ).result.content[0]!.text;
    const textB = (
      await mcpResult<{ result: { content: { text: string }[] } }>(resB)
    ).result.content[0]!.text;

    // Each response reflects exactly its own credential's client.
    expect(textA).toContain(`dataset-for-${KEY_A}`);
    expect(textA).not.toContain(`dataset-for-${KEY_B}`);
    expect(textB).toContain(`dataset-for-${KEY_B}`);
    expect(textB).not.toContain(`dataset-for-${KEY_A}`);

    // Each request has one discovery client and one tool client; neither
    // credential or client cache crosses the request boundary.
    expect(createdClients).toHaveLength(4);
    expect(new Set(createdClients.map((c) => c.apiKey))).toEqual(
      new Set([KEY_A, KEY_B]),
    );
    const dataClients = createdClients.filter(
      (client) => client.clientName === "list_datasets",
    );
    const discoveryClients = createdClients.filter(
      (client) => client.clientName === "mcp_permissions_discovery",
    );
    expect(dataClients).toHaveLength(2);
    expect(discoveryClients).toHaveLength(2);
    expect(
      discoveryClients.every(
        (client) => client.permissions.get.mock.calls.length === 1,
      ),
    ).toBe(true);
    for (const client of dataClients) {
      expect(client.transport.requestPage).toHaveBeenCalledWith(
        "/datasets/",
        undefined,
      );
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
    const response = await rawRequest(
      "GET // HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n",
    );
    expect(response).toMatch(/^HTTP\/1\.1 400 /);
    // The listener did not crash: the server still answers.
    const health = await fetch(`${base}${HEALTH_PATH}`);
    expect(health.status).toBe(200);
  });

  it.each([
    ["query alias", "/mcp?resource=other"],
    ["dot-segment alias", "/ignored/../mcp"],
  ])("rejects an MCP %s before credential handling", async (_label, target) => {
    const response = await rawRequest(
      `POST ${target} HTTP/1.1\r\nHost: h\r\nContent-Type: application/json\r\n` +
        `Authorization: Bearer ${JWT_LOOKALIKE}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`,
    );
    expect(response).toMatch(/^HTTP\/1\.1 404 /);
    expect(oauthExchange).not.toHaveBeenCalled();
    expect(createdClients).toHaveLength(0);
  });

  it("rejects an absolute-form MCP target before credential handling", async () => {
    const response = await rawRequest(
      `POST https://mcp.avala.ai/mcp HTTP/1.1\r\nHost: h\r\nAuthorization: Bearer ${JWT_LOOKALIKE}\r\n` +
        "Content-Length: 2\r\nConnection: close\r\n\r\n{}",
    );
    expect(response).toMatch(/^HTTP\/1\.1 400 /);
    expect(oauthExchange).not.toHaveBeenCalled();
    expect(createdClients).toHaveLength(0);
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
    const body = (await res.json()) as {
      error: { code: number; message: string };
    };
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toContain("exceeds");
  });

  it("a request carrying a non-allowlisted Origin is refused 403 before credential handling", async () => {
    // No credential on purpose: 403 (not 401) proves the Origin check runs first.
    const res = await mcpPost(rpc(30, "tools/list"), {
      Origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    const health = await fetch(`${base}${HEALTH_PATH}`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(health.status).toBe(200);
  });

  it("an allowlisted Origin is served", async () => {
    const originServer = createAvalaMcpHttpServer({
      oauth: TEST_OAUTH,
      internalClientSecret: VALID_INTERNAL_CLIENT_SECRET,
      allowedOrigins: ["https://app.avala.ai"],
      createClient: (apiKey: string) =>
        makeMockAvala(apiKey) as unknown as Avala,
    });
    await new Promise<void>((resolve) =>
      originServer.listen(0, "127.0.0.1", resolve),
    );
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
      expect(ok.headers.get("access-control-allow-origin")).toBe(
        "https://app.avala.ai",
      );
      const forbidden = await fetch(`${originBase}${HEALTH_PATH}`, {
        headers: { Origin: "https://other.example" },
      });
      expect(forbidden.status).toBe(200);
    } finally {
      await closeServer(originServer);
    }
  });

  it("a CORS preflight from an allowlisted origin gets 204 with the CORS headers", async () => {
    const originServer = createAvalaMcpHttpServer({
      oauth: TEST_OAUTH,
      internalClientSecret: VALID_INTERNAL_CLIENT_SECRET,
      allowedOrigins: ["https://app.avala.ai"],
      createClient: (apiKey: string) =>
        makeMockAvala(apiKey) as unknown as Avala,
    });
    await new Promise<void>((resolve) =>
      originServer.listen(0, "127.0.0.1", resolve),
    );
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
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "https://app.avala.ai",
      );
      expect(res.headers.get("access-control-allow-methods")).toBe(
        "POST, OPTIONS",
      );
      expect(res.headers.get("access-control-allow-headers")).toBe(
        "Content-Type, Authorization, X-Avala-Api-Key, Mcp-Protocol-Version, Mcp-Method, Mcp-Name",
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
      oauth: TEST_OAUTH,
      internalClientSecret: VALID_INTERNAL_CLIENT_SECRET,
      createClient: (apiKey: string) =>
        makeMockAvala(apiKey) as unknown as Avala,
    });
    await new Promise<void>((resolve) =>
      roServer.listen(0, "127.0.0.1", resolve),
    );
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
      const names = (
        await mcpResult<{ result: { tools: { name: string }[] } }>(res)
      ).result.tools.map((t) => t.name);
      expect(names).toHaveLength(44);
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
      expect(
        names.filter((n) => n.startsWith("create_") || n.startsWith("delete_")),
      ).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.AVALA_MCP_ENABLE_MUTATIONS;
      else process.env.AVALA_MCP_ENABLE_MUTATIONS = previous;
      await closeServer(roServer);
    }
  });
});
