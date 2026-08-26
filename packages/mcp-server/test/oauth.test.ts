import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
} from "jose";
import { webcrypto } from "node:crypto";
import {
  Auth0OnBehalfOfBroker,
  HostedOAuthError,
  PROTECTED_RESOURCE_METADATA_PATH,
  bearerChallenge,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  validateHostedOAuthConfig,
  type HostedOAuthConfig,
} from "../src/oauth.js";

// The protected Node 18 compatibility lane predates global Web Crypto.
// Production requires Node 20+, but jose's test key generation still needs
// the standards API when the compatibility lane executes this suite.
if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const NOW_SECONDS = 1_788_000_000;
const NOW_MILLISECONDS = NOW_SECONDS * 1_000;
const SUBJECT = "auth0|user-123";
const DOWNSTREAM_TOKEN = "downstream.api.access_token";

const CONFIG: HostedOAuthConfig = {
  resource: "https://mcp.avala.ai/mcp",
  authorizationServer: "https://identity.example.com/",
  apiAudience: "https://api.avala.ai/",
  clientId: "hosted-mcp-client",
  clientSecret: "hosted-mcp-client-secret",
  scopesSupported: ["datasets.read", "projects.read", "exports.create"],
};

interface TokenOverrides {
  issuer: string;
  audience: string;
  subject: string;
  issuedAt: number;
  expiresAt: number;
  scope: unknown;
  permissions: unknown;
  confirmation?: unknown;
  algorithm: "RS256" | "PS256";
}

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let psPrivateKey: CryptoKey;
let localJwks: JWTVerifyGetKey;

beforeAll(async () => {
  const primary = await generateKeyPair("RS256");
  privateKey = primary.privateKey;
  const publicJwk = await exportJWK(primary.publicKey);
  publicJwk.kid = "primary";
  publicJwk.alg = "RS256";
  localJwks = createLocalJWKSet({ keys: [publicJwk] });

  otherPrivateKey = (await generateKeyPair("RS256")).privateKey;
  psPrivateKey = (await generateKeyPair("PS256")).privateKey;
});

async function subjectToken(
  overrides: Partial<TokenOverrides> = {},
  signingKey = privateKey,
): Promise<string> {
  const claims: TokenOverrides = {
    issuer: CONFIG.authorizationServer,
    audience: CONFIG.resource,
    subject: SUBJECT,
    issuedAt: NOW_SECONDS,
    expiresAt: NOW_SECONDS + 600,
    scope: "datasets.read projects.read unconfigured.read",
    permissions: ["datasets.read", "projects.read", "unconfigured.read"],
    algorithm: "RS256",
    ...overrides,
  };
  return new SignJWT({
    scope: claims.scope,
    permissions: claims.permissions,
    ...(claims.confirmation === undefined ? {} : { cnf: claims.confirmation }),
  })
    .setProtectedHeader({ alg: claims.algorithm, kid: "primary", typ: "JWT" })
    .setIssuer(claims.issuer)
    .setAudience(claims.audience)
    .setSubject(claims.subject)
    .setIssuedAt(claims.issuedAt)
    .setExpirationTime(claims.expiresAt)
    .sign(signingKey);
}

function successfulResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: DOWNSTREAM_TOKEN,
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
      token_type: "Bearer",
      expires_in: 120,
      scope: "datasets.read projects.read",
      ...overrides,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function brokerWith(
  fetchMock: ReturnType<typeof vi.fn>,
  options: {
    now?: () => number;
    jwks?: JWTVerifyGetKey;
    timeoutMs?: number;
    maxInFlightExchanges?: number;
  } = {},
): Auth0OnBehalfOfBroker {
  return new Auth0OnBehalfOfBroker(CONFIG, {
    fetch: fetchMock as unknown as typeof fetch,
    jwks: options.jwks ?? localJwks,
    now: options.now ?? (() => NOW_MILLISECONDS),
    timeoutMs: options.timeoutMs,
    maxInFlightExchanges: options.maxInFlightExchanges,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hosted OAuth configuration and discovery", () => {
  it("normalizes the issuer and emits exact RFC 9728 metadata", () => {
    const withoutSlash = {
      ...CONFIG,
      authorizationServer: "https://identity.example.com",
    };
    const validated = validateHostedOAuthConfig(withoutSlash);
    expect(validated.authorizationServer).toBe("https://identity.example.com/");
    expect(protectedResourceMetadata(withoutSlash)).toEqual({
      resource: CONFIG.resource,
      authorization_servers: ["https://identity.example.com/"],
      bearer_methods_supported: ["header"],
      scopes_supported: CONFIG.scopesSupported,
      resource_name: "Avala Physical AI Data Platform MCP",
    });
    expect(PROTECTED_RESOURCE_METADATA_PATH).toBe(
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(protectedResourceMetadataUrl(CONFIG.resource)).toBe(
      "https://mcp.avala.ai/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("builds discoverable RFC 6750 challenges without reflecting input", () => {
    expect(bearerChallenge(CONFIG.resource)).toBe(
      'Bearer resource_metadata="https://mcp.avala.ai/.well-known/oauth-protected-resource/mcp"',
    );
    expect(
      bearerChallenge(CONFIG.resource, {
        error: "invalid_token",
        scopes: CONFIG.scopesSupported,
      }),
    ).toBe(
      'Bearer resource_metadata="https://mcp.avala.ai/.well-known/oauth-protected-resource/mcp", error="invalid_token", scope="datasets.read projects.read exports.create"',
    );
  });

  it.each([
    ["insecure resource", { resource: "http://mcp.avala.ai/mcp" }],
    ["wrong resource path", { resource: "https://mcp.avala.ai/" }],
    [
      "issuer path",
      { authorizationServer: "https://identity.example.com/tenant" },
    ],
    ["noncanonical API audience", { apiAudience: "https://api.avala.ai" }],
    ["short client ID", { clientId: "short" }],
    ["noncanonical secret", { clientSecret: "secret with space" }],
    [
      "duplicate scopes",
      { scopesSupported: ["datasets.read", "datasets.read"] },
    ],
  ])("fails startup validation for %s", (_label, override) => {
    expect(() =>
      validateHostedOAuthConfig({ ...CONFIG, ...override }),
    ).toThrow();
  });
});

describe("Auth0 on-behalf-of token exchange", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => successfulResponse());
  });

  it("verifies the MCP token and sends a least-privilege RFC 8693 exchange", async () => {
    const token = await subjectToken({
      permissions: ["datasets.read", "unconfigured.read"],
    });
    fetchMock.mockResolvedValueOnce(
      successfulResponse({ scope: "datasets.read" }),
    );
    const result = await brokerWith(fetchMock).exchange(token);

    expect(result).toMatchObject({
      accessToken: DOWNSTREAM_TOKEN,
      subject: SUBJECT,
      subjectIssuedAt: NOW_SECONDS,
      scopes: ["datasets.read"],
      expiresAt: NOW_MILLISECONDS + 90_000,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url.toString()).toBe("https://identity.example.com/oauth/token");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const form = init.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: token,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: CONFIG.apiAudience,
      scope: "datasets.read",
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
    });
  });

  it.each([
    ["wrong issuer", { issuer: "https://attacker.example.com/" }],
    ["wrong audience", { audience: "https://api.avala.ai/" }],
    ["expired", { expiresAt: NOW_SECONDS - 31 }],
    ["nearly expired", { expiresAt: NOW_SECONDS + 30 }],
    ["future issued-at", { issuedAt: NOW_SECONDS + 31 }],
    ["nonpositive issued-at", { issuedAt: 0 }],
    ["malformed scope", { scope: "datasets.read  projects.read" }],
    [
      "duplicate permissions",
      { permissions: ["datasets.read", "datasets.read"] },
    ],
  ])("rejects %s subject tokens before exchange", async (_label, overrides) => {
    const token = await subjectToken(overrides);
    await expect(brokerWith(fetchMock).exchange(token)).rejects.toMatchObject({
      kind: "invalid_token",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["DPoP", { jkt: "sender-key-thumbprint" }],
    ["mTLS", { "x5t#S256": "certificate-thumbprint" }],
  ])(
    "rejects a %s sender-constrained token until proof verification is supported",
    async (_label, confirmation) => {
      const token = await subjectToken({ confirmation });
      await expect(brokerWith(fetchMock).exchange(token)).rejects.toMatchObject(
        { kind: "invalid_token" },
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a correctly signed token using a non-allowlisted algorithm", async () => {
    const token = await subjectToken({ algorithm: "PS256" }, psPrivateKey);
    await expect(brokerWith(fetchMock).exchange(token)).rejects.toMatchObject({
      kind: "invalid_token",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a validly shaped token signed by an untrusted key", async () => {
    const token = await subjectToken({}, otherPrivateKey);
    await expect(brokerWith(fetchMock).exchange(token)).rejects.toMatchObject({
      kind: "invalid_token",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["not-a-jwt", `a.${"b".repeat(16 * 1024)}.c`, "a.b."])(
    "rejects malformed or oversized token %s without network access",
    async (token) => {
      await expect(brokerWith(fetchMock).exchange(token)).rejects.toMatchObject(
        { kind: "invalid_token" },
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("requires the scope to be present in both scope and permissions claims", async () => {
    const token = await subjectToken({
      scope: "datasets.read",
      permissions: ["projects.read"],
    });
    await expect(brokerWith(fetchMock).exchange(token)).rejects.toMatchObject({
      kind: "insufficient_scope",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches by subject-token digest and refreshes before downstream expiry", async () => {
    let now = NOW_MILLISECONDS;
    const token = await subjectToken();
    const broker = brokerWith(fetchMock, { now: () => now });

    const first = await broker.exchange(token);
    const cached = await broker.exchange(token);
    expect(cached).toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();

    now += 91_000;
    await broker.exchange(token);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent exchanges for the same subject token", async () => {
    let resolveResponse!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const token = await subjectToken();
    const broker = brokerWith(fetchMock);

    const first = broker.exchange(token);
    const second = broker.exchange(token);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    resolveResponse(successfulResponse());

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("bounds unique in-flight exchanges while preserving same-token coalescing", async () => {
    const resolvers: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const broker = brokerWith(fetchMock, { maxInFlightExchanges: 2 });
    const firstToken = await subjectToken({ subject: "auth0|first" });
    const secondToken = await subjectToken({ subject: "auth0|second" });
    const thirdToken = await subjectToken({ subject: "auth0|third" });

    const first = broker.exchange(firstToken);
    const firstCoalesced = broker.exchange(firstToken);
    const second = broker.exchange(secondToken);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await expect(broker.exchange(thirdToken)).rejects.toMatchObject({
      kind: "temporarily_unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolvers[0]!(successfulResponse());
    resolvers[1]!(successfulResponse());
    const [firstResult, coalescedResult] = await Promise.all([
      first,
      firstCoalesced,
      second,
    ]);
    expect(firstResult).toBe(coalescedResult);
  });

  it.each([
    [400, "invalid_grant", "invalid_token"],
    [403, "insufficient_scope", "insufficient_scope"],
    [401, "invalid_client", "temporarily_unavailable"],
    [400, "invalid_target", "temporarily_unavailable"],
    [429, "temporarily_unavailable", "temporarily_unavailable"],
    [500, "server_error", "temporarily_unavailable"],
    [302, "unrecognized", "temporarily_unavailable"],
  ] as const)(
    "maps token endpoint HTTP %s / %s to %s",
    async (status, errorCode, kind) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: errorCode,
            error_description: "secret-client-and-token-detail",
          }),
          { status },
        ),
      );
      const token = await subjectToken();
      await expect(brokerWith(fetchMock).exchange(token)).rejects.toMatchObject(
        { kind },
      );
      expect((fetchMock.mock.calls[0]![1] as RequestInit).redirect).toBe(
        "manual",
      );
      expect(consoleError).toHaveBeenCalledWith(
        "avala-mcp-oauth: token exchange rejected",
        {
          status,
          error: errorCode,
        },
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "secret-client-and-token-detail",
      );
    },
  );

  it("maps identity-provider network and JWKS failures to temporary unavailability", async () => {
    const token = await subjectToken();
    fetchMock.mockRejectedValueOnce(
      new TypeError("network failure with secret-like detail"),
    );
    await expect(brokerWith(fetchMock).exchange(token)).rejects.toEqual(
      new HostedOAuthError("temporarily_unavailable"),
    );

    const unavailableJwks = vi.fn(async () => {
      throw new TypeError("JWKS unavailable");
    }) as unknown as JWTVerifyGetKey;
    await expect(
      brokerWith(fetchMock, { jwks: unavailableJwks }).exchange(token),
    ).rejects.toMatchObject({
      kind: "temporarily_unavailable",
    });
  });

  it("bounds the complete token response, including a stalled body", async () => {
    const stalledFetch = vi.fn(
      async (_url: URL, init: RequestInit): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const token = await subjectToken();
    await expect(
      brokerWith(stalledFetch, { timeoutMs: 5 }).exchange(token),
    ).rejects.toMatchObject({
      kind: "temporarily_unavailable",
    });
  });

  it.each([
    ["invalid JSON", new Response("not-json", { status: 200 })],
    ["invalid token type", successfulResponse({ token_type: "DPoP" })],
    [
      "missing issued token type",
      new Response(
        JSON.stringify({
          access_token: DOWNSTREAM_TOKEN,
          token_type: "Bearer",
          expires_in: 120,
        }),
        { status: 200 },
      ),
    ],
    [
      "wrong issued token type",
      successfulResponse({
        issued_token_type: "urn:ietf:params:oauth:token-type:id_token",
      }),
    ],
    ["invalid access token", successfulResponse({ access_token: "has space" })],
    ["invalid expiry", successfulResponse({ expires_in: 0 })],
    [
      "scope escalation",
      successfulResponse({ scope: "datasets.read admin.write" }),
    ],
    [
      "oversized body",
      new Response("x".repeat(64 * 1024 + 1), { status: 200 }),
    ],
  ])("fails closed on %s token responses", async (_label, response) => {
    fetchMock.mockResolvedValueOnce(response);
    const token = await subjectToken();
    await expect(brokerWith(fetchMock).exchange(token)).rejects.toMatchObject({
      kind: "temporarily_unavailable",
    });
  });
});
