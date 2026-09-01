/**
 * Stateless Streamable HTTP transport for the Avala MCP server.
 *
 * Hosted-deployment counterpart of the stdio entry (`src/index.ts`), per
 * `security/docs/plans/mcp-platform-auth-model.md` §4/§5: the hosted server is
 * the same tool catalog behind a second transport. Every request carries its
 * own Avala credential. API keys remain request-local; OAuth subject tokens
 * are verified for this exact protected resource and exchanged on behalf of
 * the caller before any downstream REST call. Django remains the final
 * authorization layer for every operation.
 *
 * Stateless mode (`sessionIdGenerator: undefined`): a fresh MCP server +
 * transport pair is built per request and torn down with the response, so no
 * session — and, critically, no credential — outlives its request or is
 * shared between concurrent requests.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createHmac } from "node:crypto";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  Avala,
  AvalaError,
  validateForwardedClientIp,
  validateInternalClientSecret,
  type CredentialPermissions,
} from "@avala-ai/sdk";
import {
  Auth0OnBehalfOfBroker,
  HostedOAuthError,
  PROTECTED_RESOURCE_METADATA_PATH,
  PROTECTED_RESOURCE_METADATA_ROOT_PATH,
  bearerChallenge,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  validateHostedOAuthConfig,
  type HostedOAuthConfig,
  type OAuthTokenBroker,
} from "./oauth.js";
import {
  createAvalaMcpServer,
  REVIEWED_HOSTED_MUTATION_TOOLS,
} from "./server.js";
import type { CredentialToolGrant } from "./visibility.js";

/** Path serving the MCP Streamable HTTP endpoint. */
export const MCP_PATH = "/mcp";
/** Liveness endpoint for the ALB target-group health check. */
export const HEALTH_PATH = "/healthz";

/**
 * Maximum accepted request-body size. MCP tool-call arguments are small; this
 * exists so an unauthenticated caller cannot buffer arbitrary amounts of
 * memory before Django ever sees the request.
 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Shape of an Avala API key: `secrets.token_hex(20)` on the Django side
 * (`server/apps/apikey/models.py`), i.e. exactly 40 lowercase hex characters.
 *
 * Used ONLY to distinguish the API-key compatibility form of
 * `Authorization: Bearer` from an OAuth subject token. API keys go directly
 * to Django; OAuth tokens go only to the local verification/exchange broker.
 */
const API_KEY_SHAPE = /^[0-9a-f]{40}$/;

const API_KEY_HEADER = "x-avala-api-key";

export interface AvalaMcpHttpOptions {
  /** Fail-closed OAuth resource and Auth0 OBO configuration. */
  oauth: HostedOAuthConfig;
  /** Injectable token broker for deterministic transport tests. */
  oauthBroker?: OAuthTokenBroker;
  /**
   * Build the per-request Avala client from the request's credential.
   * Injectable for tests; defaults to the real SDK client.
   */
  createClient?: (
    apiKey: string,
    clientName: string,
    forwardedClientIp: string,
  ) => Avala;
  /** Build a per-request Avala client from an exchanged API access token. */
  createAccessTokenClient?: (
    accessToken: string,
    clientName: string,
    forwardedClientIp: string,
    subjectIssuedAt: number,
  ) => Avala;
  /** Override the Avala REST base URL (e.g. a staging API). */
  baseUrl?: string;
  /** Shared secret proving REST requests originated from the hosted MCP service. */
  internalClientSecret?: string;
  /** Public, non-secret identity of the image serving this process. */
  buildInfo?: HostedBuildInfo;
  /**
   * Browser origins allowed to reach this server. Default empty: only
   * requests WITHOUT an Origin header (non-browser clients — Claude, Cursor,
   * CI) are accepted. See the Origin check below.
   */
  allowedOrigins?: string[];
}

export interface HostedBuildInfo {
  /** Published package version. */
  version: string;
  /** Exact source commit embedded into the image, or `unknown` for local development. */
  buildSha: string;
  /** Immutable image release tag, or `local` for local development. */
  releaseTag: string;
}

const LOCAL_BUILD_INFO: HostedBuildInfo = {
  version: "development",
  buildSha: "unknown",
  releaseTag: "local",
};

function validateBuildInfo(info: HostedBuildInfo): HostedBuildInfo {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(info.version))
    throw new Error("buildInfo.version is not a canonical public version.");
  if (info.buildSha !== "unknown" && !/^[0-9a-f]{40}$/.test(info.buildSha))
    throw new Error("buildInfo.buildSha must be a full lowercase Git SHA.");
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/.test(info.releaseTag))
    throw new Error("buildInfo.releaseTag is not a canonical image tag.");
  return info;
}

type Credential =
  | { ok: true; kind: "api_key"; apiKey: string }
  | { ok: true; kind: "oauth"; subjectToken: string }
  | { ok: false; status: 400 | 401; message: string };

type ClientIp =
  | { ok: true; forwardedClientIp: string }
  | { ok: false; status: 400; message: string };

function mutationCredentialBinding(
  internalClientSecret: string,
  credential:
    | { kind: "api_key"; value: string }
    | { kind: "oauth"; subjectToken: string },
): string {
  return createHmac("sha256", internalClientSecret)
    .update("avala-mcp:mutation-credential:v1", "utf8")
    .update("\0", "utf8")
    .update(credential.kind, "utf8")
    .update("\0", "utf8")
    .update(
      credential.kind === "api_key"
        ? credential.value
        : credential.subjectToken,
      "utf8",
    )
    .digest("base64url");
}

/**
 * The header fields extractCredential reads. `rawHeaders` preserves every
 * received header line across Node-compatible runtimes. `headersDistinct`
 * (Node ≥18.3) is the next-best source; plain `headers` is the final fallback
 * for synthetic/exotic callers and is lossy because runtimes may join or drop
 * duplicate credential lines.
 */
type CredentialHeaders = Pick<IncomingMessage, "headers"> &
  Partial<Pick<IncomingMessage, "headersDistinct" | "rawHeaders">>;

function headerValues(req: CredentialHeaders, name: string): string[] {
  if (req.rawHeaders !== undefined) {
    const rawValues: string[] = [];
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (req.rawHeaders[index]?.toLowerCase() === name) {
        rawValues.push(req.rawHeaders[index + 1] ?? "");
      }
    }
    if (rawValues.length > 0) return rawValues;
  }

  const distinct = req.headersDistinct?.[name];
  if (distinct !== undefined) return distinct;
  const joined = req.headers[name];
  if (joined === undefined) return [];
  return Array.isArray(joined) ? joined : [joined];
}

/**
 * Resolve the connection peer asserted by the infrastructure trust boundary.
 *
 * The production ALB is pinned to XFF append mode and the MCP task security
 * group accepts traffic only from that ALB. The final X-Forwarded-For token is
 * therefore the peer observed by infrastructure; every prefix remains caller
 * controlled and is ignored. Direct local development falls back to the TCP
 * peer. A present-but-invalid XFF fails closed instead of collapsing callers
 * onto the load balancer's private address.
 */
export function extractForwardedClientIp(req: IncomingMessage): ClientIp {
  const forwardedValues = headerValues(req, "x-forwarded-for");
  const candidate =
    forwardedValues.length > 0
      ? forwardedValues[forwardedValues.length - 1]!.split(",").at(-1)?.trim()
      : req.socket.remoteAddress;

  try {
    validateForwardedClientIp(candidate, { required: true });
  } catch {
    return {
      ok: false,
      status: 400,
      message: "Unable to establish client network context.",
    };
  }
  return { ok: true, forwardedClientIp: candidate! };
}

/**
 * Extract one unambiguous caller credential from the request.
 *
 * `X-Avala-Api-Key` is forwarded verbatim for Django to validate. A 40-hex
 * Bearer value is the API-key compatibility form; every other non-empty
 * Bearer value is treated as an OAuth subject token and must pass the broker's
 * exact issuer, audience, signature, lifetime, and scope validation.
 *
 * A request repeating either credential header is refused outright (400):
 * which copy wins would otherwise be ambiguous, and ambiguity in a credential
 * channel is how request-smuggling bugs start.
 */
export function extractCredential(req: CredentialHeaders): Credential {
  const apiKeyHeaders = headerValues(req, API_KEY_HEADER);
  if (apiKeyHeaders.length > 1) {
    return {
      ok: false,
      status: 400,
      message: "Multiple X-Avala-Api-Key headers provided.",
    };
  }
  const authorizationHeaders = headerValues(req, "authorization");
  if (authorizationHeaders.length > 1) {
    return {
      ok: false,
      status: 400,
      message: "Multiple Authorization headers provided.",
    };
  }

  if (apiKeyHeaders.length === 1 && authorizationHeaders.length === 1) {
    return {
      ok: false,
      status: 400,
      message: "Provide exactly one credential header.",
    };
  }

  const headerKey = apiKeyHeaders[0];
  if (typeof headerKey === "string" && headerKey.trim() !== "") {
    return { ok: true, kind: "api_key", apiKey: headerKey.trim() };
  }

  const authorization = authorizationHeaders[0];
  if (typeof authorization === "string" && authorization.trim() !== "") {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    const bearer = match?.[1]?.trim();
    if (bearer && API_KEY_SHAPE.test(bearer)) {
      return { ok: true, kind: "api_key", apiKey: bearer };
    }
    if (bearer) {
      return { ok: true, kind: "oauth", subjectToken: bearer };
    }
    return {
      ok: false,
      status: 401,
      message: "Invalid Authorization header: expected Bearer token.",
    };
  }

  return {
    ok: false,
    status: 401,
    message:
      "Missing credentials: provide X-Avala-Api-Key or Authorization: Bearer <token>.",
  };
}

/** Lowercase and strip trailing slashes so allowlist entries match loosely-typed config. */
function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, "");
}

function sendJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...extraHeaders,
  });
  res.end(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
  );
}

class BodyTooLargeError extends Error {}

function validatedStringSet(
  value: unknown,
  field: string,
): ReadonlySet<string> {
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) =>
        typeof entry === "string" &&
        entry.trim() !== "" &&
        entry === entry.trim(),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`Permission discovery returned an invalid ${field} grant.`);
  }
  return new Set(value);
}

function credentialGrantFrom(
  permissions: CredentialPermissions,
): CredentialToolGrant {
  // Strict boolean, fail closed: a missing or malformed staff flag must read
  // as a malformed grant (503), never as quietly-not-staff — the same
  // contract `validatedStringSet` applies to the scope and toolset arrays.
  if (typeof permissions.isStaffPrivileged !== "boolean") {
    throw new Error(
      "Permission discovery returned an invalid staff-privilege grant.",
    );
  }
  return {
    scopes: validatedStringSet(permissions.scopes, "scope"),
    toolsets: validatedStringSet(permissions.toolsets, "toolset"),
    isStaffPrivileged: permissions.isStaffPrivileged,
  };
}

function sendPermissionDiscoveryError(
  res: ServerResponse,
  error: unknown,
  oauthResource: string,
  oauthScopes: readonly string[],
): void {
  const upstreamStatus =
    error instanceof AvalaError ? error.statusCode : undefined;
  // Never log the SDK error object: its body may contain caller-controlled or
  // credential-adjacent data. A status class is enough for operations.
  console.error(
    `avala-mcp-http: credential permission discovery failed${upstreamStatus ? ` (HTTP ${upstreamStatus})` : ""}.`,
  );
  if (upstreamStatus === 401) {
    sendJsonRpcError(res, 401, -32001, "Invalid or expired Avala credential.", {
      "WWW-Authenticate": bearerChallenge(oauthResource, {
        error: "invalid_token",
        scopes: oauthScopes,
      }),
    });
  } else if (upstreamStatus === 403) {
    sendJsonRpcError(
      res,
      403,
      -32001,
      "Credential permission discovery was denied.",
    );
  } else if (upstreamStatus === 429) {
    sendJsonRpcError(
      res,
      429,
      -32002,
      "Credential permission discovery is temporarily rate limited.",
    );
  } else {
    sendJsonRpcError(
      res,
      503,
      -32002,
      "Credential permission discovery is unavailable.",
    );
  }
}

function sendOAuthError(
  res: ServerResponse,
  error: unknown,
  oauthResource: string,
  oauthScopes: readonly string[],
): void {
  if (!(error instanceof HostedOAuthError)) {
    console.error(
      "avala-mcp-http: OAuth broker failed with an unclassified error.",
    );
    sendJsonRpcError(
      res,
      503,
      -32002,
      "OAuth identity service is unavailable.",
    );
    return;
  }
  if (error.kind === "invalid_token") {
    sendJsonRpcError(
      res,
      401,
      -32001,
      "Invalid or expired OAuth access token.",
      {
        "WWW-Authenticate": bearerChallenge(oauthResource, {
          error: "invalid_token",
          scopes: oauthScopes,
        }),
      },
    );
  } else if (error.kind === "insufficient_scope") {
    sendJsonRpcError(
      res,
      403,
      -32001,
      "OAuth token has insufficient scope for Avala MCP.",
      {
        "WWW-Authenticate": bearerChallenge(oauthResource, {
          error: "insufficient_scope",
          scopes: oauthScopes,
        }),
      },
    );
  } else {
    sendJsonRpcError(
      res,
      503,
      -32002,
      "OAuth identity service is unavailable.",
    );
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    const onData = (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        // Stop consuming, but do NOT destroy the request here: destroying the
        // message tears down the socket, so the client would see a connection
        // reset instead of the 413 the caller is about to send.
        req.pause();
        req.removeListener("data", onData);
        reject(
          new BodyTooLargeError(
            `Request body exceeds ${MAX_BODY_BYTES} bytes.`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Create (but do not start) the HTTP server hosting the MCP endpoint.
 *
 * Routes:
 *  - `POST /mcp`     — the MCP Streamable HTTP endpoint (stateless).
 *  - `GET|DELETE /mcp` — 405: stateless mode has no SSE stream to resume and
 *     no session to delete.
 *  - `GET /healthz`  — 200, for the ALB health check. Unauthenticated.
 */
export function createAvalaMcpHttpServer(options: AvalaMcpHttpOptions): Server {
  // Validate at process startup, not lazily on the first tool call. Otherwise
  // /healthz stays green while every authenticated call fails in Fetch header
  // construction because the injected secret is not a canonical ByteString.
  validateInternalClientSecret(options.internalClientSecret, {
    required: true,
  });
  const internalClientSecret = options.internalClientSecret as string;
  const buildInfo = validateBuildInfo(options.buildInfo ?? LOCAL_BUILD_INFO);
  const oauthConfig = validateHostedOAuthConfig(options.oauth);
  const oauthMetadata = protectedResourceMetadata(oauthConfig);
  const oauthMetadataUrl = protectedResourceMetadataUrl(oauthConfig.resource);
  const oauthBroker =
    options.oauthBroker ?? new Auth0OnBehalfOfBroker(oauthConfig);
  const createClient =
    options.createClient ??
    ((apiKey: string, clientName: string, forwardedClientIp: string) =>
      new Avala({
        apiKey,
        baseUrl: options.baseUrl,
        clientName,
        internalClientSecret: options.internalClientSecret,
        forwardedClientIp,
      }));
  const createAccessTokenClient =
    options.createAccessTokenClient ??
    ((
      accessToken: string,
      clientName: string,
      forwardedClientIp: string,
      subjectIssuedAt: number,
    ) =>
      new Avala({
        accessToken,
        baseUrl: options.baseUrl,
        clientName,
        internalClientSecret: options.internalClientSecret,
        forwardedClientIp,
        mcpSubjectTokenIssuedAt: subjectIssuedAt,
      }));
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? []).map(normalizeOrigin),
  );

  async function handleMcpPost(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const credential = extractCredential(req);
    if (!credential.ok) {
      // RFC 6750 §3.1 lets a server omit `error` when no credential was
      // presented, but the canonical MCP challenge every major client is
      // tested against (Claude's connector docs, the SDK reference server)
      // carries `error="invalid_token"` in this case too. Include it so a
      // client that keys on the parameter starts its OAuth flow instead of
      // reporting a generic connection failure.
      const headers: Record<string, string> =
        credential.status === 401
          ? {
              "WWW-Authenticate": bearerChallenge(oauthConfig.resource, {
                error: "invalid_token",
                scopes: oauthConfig.scopesSupported,
              }),
            }
          : {};
      sendJsonRpcError(
        res,
        credential.status,
        -32001,
        credential.message,
        headers,
      );
      return;
    }

    const clientIp = extractForwardedClientIp(req);
    if (!clientIp.ok) {
      sendJsonRpcError(res, clientIp.status, -32000, clientIp.message);
      return;
    }

    // Parse the body here so a malformed payload is a clean 400 before any
    // MCP machinery runs.
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(await readBody(req));
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        // The request body was not fully consumed, so this connection cannot
        // be reused: tell the client, flush the 413, and only then drop the
        // socket. Destroying earlier would turn the 413 into a reset.
        res.writeHead(413, {
          "Content-Type": "application/json",
          Connection: "close",
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: error.message },
            id: null,
          }),
          // Half-close (FIN) only after the 413 is flushed: req.destroy()
          // would RST the socket and the client would see a reset instead of
          // the status. The paused request body backpressures until the
          // client reads the response and closes; Node's requestTimeout
          // reaps a client that never does.
          () => res.socket?.end(),
        );
      } else {
        sendJsonRpcError(
          res,
          400,
          -32700,
          "Parse error: request body is not valid JSON.",
        );
      }
      return;
    }

    let downstreamCredential:
      | { kind: "api_key"; value: string }
      | {
          kind: "oauth";
          value: string;
          subjectToken: string;
          subjectIssuedAt: number;
        };
    if (credential.kind === "api_key") {
      downstreamCredential = { kind: "api_key", value: credential.apiKey };
    } else {
      try {
        const exchange = await oauthBroker.exchange(credential.subjectToken);
        downstreamCredential = {
          kind: "oauth",
          value: exchange.accessToken,
          subjectToken: credential.subjectToken,
          subjectIssuedAt: exchange.subjectIssuedAt,
        };
      } catch (error) {
        sendOAuthError(
          res,
          error,
          oauthConfig.resource,
          oauthConfig.scopesSupported,
        );
        return;
      }
    }

    // Fresh server per request (stateless mode), and per-request
    // clients keyed by exact MCP operation/tool name. Permission discovery
    // eagerly creates one client; tool clients remain lazy. Every client is
    // built from THIS request's credential, so concurrent callers with
    // different keys cannot observe each other's clients.
    const clients = new Map<string, Avala>();
    const getClient = (clientName: string): Avala => {
      const existing = clients.get(clientName);
      if (existing) return existing;
      const client =
        downstreamCredential.kind === "api_key"
          ? createClient(
              downstreamCredential.value,
              clientName,
              clientIp.forwardedClientIp,
            )
          : createAccessTokenClient(
              downstreamCredential.value,
              clientName,
              clientIp.forwardedClientIp,
              downstreamCredential.subjectIssuedAt,
            );
      clients.set(clientName, client);
      return client;
    };

    let credentialGrant: CredentialToolGrant;
    try {
      const permissions = await getClient(
        "mcp_permissions_discovery",
      ).permissions.get();
      credentialGrant = credentialGrantFrom(permissions);
    } catch (error) {
      sendPermissionDiscoveryError(
        res,
        error,
        oauthConfig.resource,
        oauthConfig.scopesSupported,
      );
      return;
    }

    // Hosted mutations are an exact reviewed allowlist, never the stdio-wide
    // AVALA_MCP_ENABLE_MUTATIONS switch. Visibility still requires the current
    // credential's staff privilege + exact write scope; Django then repeats
    // both checks and enforces expected state, audit provenance and exactly-once
    // execution. The request-local credential binding prevents a confirmation
    // issued for one operator/key from being replayed by another.
    const handler = createMcpHandler(
      () =>
        createAvalaMcpServer(getClient, {
          allowMutations: false,
          allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
          credentialGrant,
          credentialBinding: mutationCredentialBinding(
            internalClientSecret,
            downstreamCredential.kind === "api_key"
              ? downstreamCredential
              : {
                  kind: "oauth",
                  subjectToken: downstreamCredential.subjectToken,
                },
          ),
          // Hosted transport is stateless and may be load-balanced across
          // replicas. HKDF domain-separates this existing secret inside the
          // handle codec so an opaque locator issued by one request can be
          // opened by the next without storing a signed URL anywhere.
          assetHandleKeyMaterial: internalClientSecret,
        }),
      {
        // One factory serves the current stateless protocol and the 2025-era
        // stateless fallback, so catalogs and authorization cannot drift.
        legacy: "stateless",
        onerror: () =>
          console.error("avala-mcp-http: protocol request rejected."),
      },
    );
    const nodeHandler = toNodeHandler(handler, {
      onerror: () => console.error("avala-mcp-http: protocol adapter failed."),
    });

    res.on("close", () => {
      void handler.close();
    });

    await nodeHandler(req, res, parsedBody);
  }

  return createServer((req, res) => {
    // `req.url` is attacker-controlled and `new URL()` throws on targets like
    // "//" — an uncaught throw here would crash the whole process, pre-auth.
    const requestTarget = req.url ?? "/";
    let pathname: string;
    try {
      if (!requestTarget.startsWith("/") || requestTarget.startsWith("//"))
        throw new Error("not origin-form");
      pathname = new URL(requestTarget, "http://placeholder").pathname;
    } catch {
      sendJsonRpcError(res, 400, -32600, "Invalid request target.");
      return;
    }

    // RFC 9728 binds authorization to the exact canonical resource URL.
    // URL parsing normalizes query-bearing and dot-segment aliases to /mcp;
    // reject those aliases before any credential is read or broker invoked.
    if (pathname === MCP_PATH && requestTarget !== MCP_PATH) {
      sendJsonRpcError(res, 404, -32000, "Not found.");
      return;
    }

    if (pathname === HEALTH_PATH) {
      if (req.method === "GET" || req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          req.method === "HEAD" ? undefined : JSON.stringify({ status: "ok" }),
        );
      } else {
        sendJsonRpcError(res, 405, -32000, "Method not allowed.", {
          Allow: "GET, HEAD",
        });
      }
      return;
    }

    if (
      pathname === PROTECTED_RESOURCE_METADATA_PATH ||
      pathname === PROTECTED_RESOURCE_METADATA_ROOT_PATH
    ) {
      if (req.method === "GET" || req.method === "HEAD") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(
          req.method === "HEAD" ? undefined : JSON.stringify(oauthMetadata),
        );
      } else {
        sendJsonRpcError(res, 405, -32000, "Method not allowed.", {
          Allow: "GET, HEAD",
        });
      }
      return;
    }

    if (pathname === "/") {
      if (req.method === "GET" || req.method === "HEAD") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
        });
        res.end(
          req.method === "HEAD"
            ? undefined
            : JSON.stringify({
                name: "avala-mcp",
                status: "ok",
                transport: "streamable-http",
                version: buildInfo.version,
                build_sha: buildInfo.buildSha,
                release_tag: buildInfo.releaseTag,
                mcp_endpoint: oauthConfig.resource,
                protected_resource_metadata: oauthMetadataUrl,
              }),
        );
      } else {
        sendJsonRpcError(res, 405, -32000, "Method not allowed.", {
          Allow: "GET, HEAD",
        });
      }
      return;
    }

    if (pathname !== MCP_PATH) {
      sendJsonRpcError(res, 404, -32000, "Not found.");
      return;
    }

    // The Streamable HTTP spec requires Origin validation on the protected
    // MCP endpoint as its DNS-rebinding defense. Public liveness and RFC 9728
    // discovery routes above intentionally remain discoverable from any
    // origin; no credential is accepted on those routes.
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!allowedOrigins.has(normalizeOrigin(origin))) {
        sendJsonRpcError(res, 403, -32000, "Origin not allowed.");
        return;
      }

      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Avala-Api-Key, Mcp-Protocol-Version, Mcp-Method, Mcp-Name",
          "Access-Control-Max-Age": "7200",
        });
        res.end();
        return;
      }
    }

    if (req.method !== "POST") {
      // Stateless mode: no SSE stream to resume (GET) and no session to
      // terminate (DELETE).
      sendJsonRpcError(
        res,
        405,
        -32000,
        "Method not allowed: this MCP endpoint is stateless — POST only.",
        {
          Allow: "POST",
        },
      );
      return;
    }

    handleMcpPost(req, res).catch((error: unknown) => {
      // Never leak internals to the wire; the message may embed request data.
      console.error(
        `avala-mcp-http: request failed (${error instanceof Error ? error.name : "unknown"}).`,
      );
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal server error.");
      } else {
        res.end();
      }
    });
  });
}
