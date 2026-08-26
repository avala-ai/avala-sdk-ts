/**
 * Stateless Streamable HTTP transport for the Avala MCP server.
 *
 * Hosted-deployment counterpart of the stdio entry (`src/index.ts`), per
 * `security/docs/plans/mcp-platform-auth-model.md` §4/§5: the hosted server is
 * the same tool catalog behind a second transport. Every request carries its
 * own Avala credential, every tool call is a plain REST call made with that
 * credential, and this process performs NO authorization of its own — the
 * Django REST API is the only authorization layer (§4.1). Everything this
 * module checks (credential shape, Origin, body size) is transport plumbing
 * and hardening, never access control.
 *
 * Stateless mode (`sessionIdGenerator: undefined`): a fresh MCP server +
 * transport pair is built per request and torn down with the response, so no
 * session — and, critically, no credential — outlives its request or is
 * shared between concurrent requests.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Avala, validateInternalClientSecret } from "@avala-ai/sdk";
import { registerTools } from "./server.js";

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
 * Used ONLY to decide whether an `Authorization: Bearer` value is an Avala API
 * key we can forward. Anything else (a JWT, an OAuth token) is refused with
 * 401 + `WWW-Authenticate: Bearer`; this process must not attempt to verify
 * JWTs — the Django API is the authority (decision record §4.1; OAuth arrives
 * in a later PR with Auth0 as the authorization server, §5.2).
 */
const API_KEY_SHAPE = /^[0-9a-f]{40}$/;

const API_KEY_HEADER = "x-avala-api-key";

export interface AvalaMcpHttpOptions {
  /**
   * Build the per-request Avala client from the request's credential.
   * Injectable for tests; defaults to the real SDK client.
   */
  createClient?: (apiKey: string, clientName: string) => Avala;
  /** Override the Avala REST base URL (e.g. a staging API). */
  baseUrl?: string;
  /** Shared secret proving REST requests originated from the hosted MCP service. */
  internalClientSecret?: string;
  /**
   * Browser origins allowed to reach this server. Default empty: only
   * requests WITHOUT an Origin header (non-browser clients — Claude, Cursor,
   * CI) are accepted. See the Origin check below.
   */
  allowedOrigins?: string[];
}

type Credential =
  | { ok: true; apiKey: string }
  | { ok: false; status: 400 | 401; message: string };

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
 * Extract the caller's Avala API key from the request.
 *
 * Accepted, in order of precedence:
 *  1. `X-Avala-Api-Key: <key>` — forwarded verbatim; Django decides validity.
 *  2. `Authorization: Bearer <40-hex key>` — accepted only when the value has
 *     the Avala API-key shape (see API_KEY_SHAPE).
 *
 * A request repeating either credential header is refused outright (400):
 * which copy wins would otherwise be ambiguous, and ambiguity in a credential
 * channel is how request-smuggling bugs start.
 */
export function extractCredential(req: CredentialHeaders): Credential {
  const apiKeyHeaders = headerValues(req, API_KEY_HEADER);
  if (apiKeyHeaders.length > 1) {
    return { ok: false, status: 400, message: "Multiple X-Avala-Api-Key headers provided." };
  }
  const authorizationHeaders = headerValues(req, "authorization");
  if (authorizationHeaders.length > 1) {
    return { ok: false, status: 400, message: "Multiple Authorization headers provided." };
  }

  const headerKey = apiKeyHeaders[0];
  if (typeof headerKey === "string" && headerKey.trim() !== "") {
    return { ok: true, apiKey: headerKey.trim() };
  }

  const authorization = authorizationHeaders[0];
  if (typeof authorization === "string" && authorization.trim() !== "") {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    const bearer = match?.[1]?.trim();
    if (bearer && API_KEY_SHAPE.test(bearer)) {
      return { ok: true, apiKey: bearer };
    }
    return {
      ok: false,
      status: 401,
      message:
        "Invalid credential: this endpoint accepts Avala API keys only " +
        "(via X-Avala-Api-Key, or Authorization: Bearer with a 40-hex API key). " +
        "OAuth / JWT bearer tokens are not supported yet.",
    };
  }

  return {
    ok: false,
    status: 401,
    message: "Missing credentials: provide X-Avala-Api-Key or Authorization: Bearer <api key>.",
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
  res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

class BodyTooLargeError extends Error {}

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
        reject(new BodyTooLargeError(`Request body exceeds ${MAX_BODY_BYTES} bytes.`));
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
export function createAvalaMcpHttpServer(options: AvalaMcpHttpOptions = {}): Server {
  // Validate at process startup, not lazily on the first tool call. Otherwise
  // /healthz stays green while every authenticated call fails in Fetch header
  // construction because the injected secret is not a canonical ByteString.
  validateInternalClientSecret(options.internalClientSecret, { required: true });
  const createClient =
    options.createClient ??
    ((apiKey: string, clientName: string) =>
      new Avala({
        apiKey,
        baseUrl: options.baseUrl,
        clientName,
        internalClientSecret: options.internalClientSecret,
      }));
  const allowedOrigins = new Set((options.allowedOrigins ?? []).map(normalizeOrigin));

  async function handleMcpPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const credential = extractCredential(req);
    if (!credential.ok) {
      // On 401, a Bearer challenge (RFC 9110). A later PR extends the
      // challenge with resource_metadata for OAuth discovery (§5.1).
      const headers: Record<string, string> = credential.status === 401 ? { "WWW-Authenticate": "Bearer" } : {};
      sendJsonRpcError(res, credential.status, -32001, credential.message, headers);
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
        res.writeHead(413, { "Content-Type": "application/json", Connection: "close" });
        res.end(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: error.message }, id: null }),
          // Half-close (FIN) only after the 413 is flushed: req.destroy()
          // would RST the socket and the client would see a reset instead of
          // the status. The paused request body backpressures until the
          // client reads the response and closes; Node's requestTimeout
          // reaps a client that never does.
          () => res.socket?.end(),
        );
      } else {
        sendJsonRpcError(res, 400, -32700, "Parse error: request body is not valid JSON.");
      }
      return;
    }

    // Fresh server + transport per request (stateless mode), and lazy
    // per-request clients keyed by exact MCP tool name. Each client is built
    // from THIS request's credential and stamps that tool name onto every REST
    // request. Nothing here is shared across requests, so concurrent callers
    // with different keys cannot observe each other's clients.
    const clients = new Map<string, Avala>();
    const getClient = (clientName: string): Avala => {
      const existing = clients.get(clientName);
      if (existing) return existing;
      const client = createClient(credential.apiKey, clientName);
      clients.set(clientName, client);
      return client;
    };

    const server = new McpServer({ name: "avala", version: "0.6.0" });
    // Hosted v1 is read-only BY CONSTRUCTION — no option, no env var, nothing
    // to misconfigure (decision record §5.5-4 / known gap (d)): a stateless
    // transport cannot run the elicitation/confirm flow destructive tools
    // require, and server-side scope enforcement is not live yet (PR 2 is
    // shadow-only), so a hosted mutation catalog would expose four
    // delete-by-id tools to any leaked key with no confirmation step.
    // AVALA_MCP_ENABLE_MUTATIONS is honored only by the stdio entry, where
    // the user owns the process and the flag is documented as client-side
    // convenience, not a control.
    registerTools(server, getClient, { allowMutations: false });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      // One JSON response per request: our tools emit no notifications or
      // progress, so there is nothing to stream, and plain JSON keeps the
      // ALB/agent-client path simple.
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  }

  return createServer((req, res) => {
    // Origin validation, before any routing — the 2025-06-18 Streamable HTTP
    // spec REQUIRES it as the DNS-rebinding defense. Non-browser clients
    // (Claude, Cursor, CI) send no Origin and pass; a browser page may only
    // reach this server from an explicitly allowlisted origin. This is
    // transport hardening, not REST authorization — the Django API still
    // authorizes every forwarded call.
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!allowedOrigins.has(normalizeOrigin(origin))) {
        sendJsonRpcError(res, 403, -32000, "Origin not allowed.");
        return;
      }

      // Allowlisted browser caller. Echo the origin on EVERY response for
      // this request (a cross-origin fetch whose response lacks
      // Access-Control-Allow-Origin is unreadable to the page even when the
      // server processed it), and answer the automatic CORS preflight: the
      // JSON content type plus a credential header make the browser send
      // OPTIONS first, and without a 204-with-CORS-headers answer it never
      // sends the POST at all. Non-browser clients send no Origin and never
      // reach this branch.
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Avala-Api-Key, Mcp-Protocol-Version",
          // 2h: capped by browsers anyway; long enough to keep preflights
          // off the request path.
          "Access-Control-Max-Age": "7200",
        });
        res.end();
        return;
      }
    }

    // `req.url` is attacker-controlled and `new URL()` throws on targets like
    // "//" — an uncaught throw here would crash the whole process, pre-auth.
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://placeholder").pathname;
    } catch {
      sendJsonRpcError(res, 400, -32600, "Invalid request target.");
      return;
    }

    if (pathname === HEALTH_PATH) {
      if (req.method === "GET" || req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        sendJsonRpcError(res, 405, -32000, "Method not allowed.", { Allow: "GET, HEAD" });
      }
      return;
    }

    if (pathname !== MCP_PATH) {
      sendJsonRpcError(res, 404, -32000, "Not found.");
      return;
    }

    if (req.method !== "POST") {
      // Stateless mode: no SSE stream to resume (GET) and no session to
      // terminate (DELETE).
      sendJsonRpcError(res, 405, -32000, "Method not allowed: this MCP endpoint is stateless — POST only.", {
        Allow: "POST",
      });
      return;
    }

    handleMcpPost(req, res).catch((error: unknown) => {
      // Never leak internals to the wire; the message may embed request data.
      console.error("avala-mcp-http: request failed:", error);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal server error.");
      } else {
        res.end();
      }
    });
  });
}
