import { httpServerHandler } from "cloudflare:node";
import { validateForwardedClientIp } from "@avala-ai/sdk";
import {
  createAvalaMcpHttpServer,
  normalizeOrigin,
  type ClientIp,
} from "../src/httpServer.js";
import type { IncomingMessage, Server } from "node:http";
import packageJson from "../package.json" with { type: "json" };

/**
 * Cloudflare direct-ingress counterpart of the ALB policy in httpServer.ts.
 * Same-zone Worker subrequests can alter x-real-ip, which changes
 * CF-Connecting-IP. Reject Worker subrequests instead of trusting that value.
 * See https://developers.cloudflare.com/fundamentals/reference/http-headers/.
 * Caller-provided X-Forwarded-For is never used by this transport.
 */
function cloudflareClientIp(request: IncomingMessage): ClientIp {
  let candidate = request.headers["cf-connecting-ip"];
  if (
    request.headers["cf-worker"] !== undefined ||
    typeof candidate !== "string"
  ) {
    return {
      ok: false,
      status: 400,
      message: "Unable to establish client network context.",
    };
  }
  try {
    validateForwardedClientIp(candidate, { required: true });
    // Pseudo IPv4 overwrites CF-Connecting-IP with a Class E address. Only in
    // that case use the platform's preserved original IPv6 value.
    if (!candidate.includes(":") && Number(candidate.split(".")[0]) >= 240) {
      const ipv6 = request.headers["cf-connecting-ipv6"];
      if (typeof ipv6 !== "string" || !ipv6.includes(":"))
        throw new Error("Missing IPv6 context.");
      validateForwardedClientIp(ipv6, { required: true });
      candidate = ipv6;
    }
    return { ok: true, forwardedClientIp: candidate };
  } catch {
    return {
      ok: false,
      status: 400,
      message: "Unable to establish client network context.",
    };
  }
}

// Configuration and bounded OAuth/JWKS caches may be reused. The shared HTTP
// handler creates the SDK clients, credentials and MCP catalog per request.
let cached:
  | { configuration: string; handler: ExportedHandler; server: Server }
  | undefined;

function configuredHandler(env: Env): ExportedHandler {
  // Compare binding values, not Env object identity. Never log this key: it
  // includes the secrets already held by the configured broker.
  const configuration = JSON.stringify(
    Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
  );
  if (cached?.configuration === configuration) return cached.handler;
  const server = createAvalaMcpHttpServer({
    resolveClientIp: cloudflareClientIp,
    baseUrl: env.AVALA_BASE_URL,
    internalClientSecret: env.AVALA_MCP_INTERNAL_CLIENT_SECRET,
    allowedOrigins: env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    buildInfo: {
      version: packageJson.version,
      buildSha: env.AVALA_MCP_BUILD_SHA,
      releaseTag: env.AVALA_MCP_RELEASE_TAG,
    },
    oauth: {
      resource: env.AVALA_MCP_OAUTH_RESOURCE,
      authorizationServer: env.AVALA_MCP_OAUTH_ISSUER,
      apiAudience: env.AVALA_MCP_OAUTH_API_AUDIENCE,
      clientId: env.AVALA_MCP_OAUTH_CLIENT_ID,
      clientSecret: env.AVALA_MCP_OAUTH_CLIENT_SECRET,
      scopesSupported: env.AVALA_MCP_OAUTH_SCOPES.split(" "),
    },
  });
  server.listen(0);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing Worker listener.");
  const handler = httpServerHandler({ port: address.port });
  const previous = cached;
  cached = { configuration, handler, server };
  // close() stops new requests without destroying responses already in flight.
  previous?.server.close();
  return handler;
}

function unavailable(): Response {
  return Response.json(
    { error: "MCP Worker is unavailable." },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export default {
  async fetch(
    request: Request<unknown, IncomingRequestCfProperties>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (env.AVALA_MCP_WORKER_ENABLED !== "true") return unavailable();
    if (!["isolated", "aws-origin-route"].includes(env.AVALA_MCP_ROUTING_MODE))
      return unavailable();

    // The Node bridge drops a bare '?'. Reject retained noncanonical targets
    // before credentials or origin fallback, matching the shared HTTP policy.
    const target = new URL(request.url);
    if (target.pathname === "/mcp" && request.url !== `${target.origin}/mcp`) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: "Not found." },
        },
        { status: 404 },
      );
    }

    // Fetch combines repeated headers. Neither supported credential format
    // contains commas, so reject the ambiguous combined form before the Node
    // bridge can discard duplicate Authorization values.
    if (
      request.method === "POST" &&
      target.pathname === "/mcp" &&
      ((request.headers.has("authorization") &&
        request.headers.has("x-avala-api-key")) ||
        ["authorization", "x-avala-api-key"].some((name) =>
          request.headers.get(name)?.includes(","),
        ))
    ) {
      const origin = request.headers.get("origin");
      const corsHeaders: Record<string, string> = {};
      if (origin !== null) {
        const allowed = env.ALLOWED_ORIGINS.split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .map(normalizeOrigin);
        if (!allowed.includes(normalizeOrigin(origin))) {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32000, message: "Origin not allowed." },
            },
            { status: 403 },
          );
        }
        corsHeaders["Access-Control-Allow-Origin"] = origin;
        corsHeaders.Vary = "Origin";
      }
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32001,
            message: "Multiple credential values provided.",
          },
        },
        { status: 400, headers: corsHeaders },
      );
    }

    // Worker subrequests cannot establish a trustworthy original client IP
    // here. An explicitly verified Route can preserve their existing AWS path.
    // Never enable this mode on a Custom Domain or a workers.dev endpoint.
    if (request.headers.has("CF-Worker")) {
      try {
        const resource = new URL(env.AVALA_MCP_OAUTH_RESOURCE);
        const incoming = new URL(request.url);
        if (
          env.AVALA_MCP_ROUTING_MODE !== "aws-origin-route" ||
          resource.protocol !== "https:" ||
          resource.username ||
          resource.password ||
          resource.pathname !== "/mcp" ||
          resource.search ||
          resource.hash ||
          env.AVALA_MCP_AWS_ORIGIN_ROUTE_URL !== resource.origin ||
          incoming.origin !== resource.origin
        )
          return unavailable();
        return await fetch(request, { redirect: "manual" });
      } catch {
        return unavailable();
      }
    }

    try {
      const handler = configuredHandler(env);
      if (!handler.fetch) return unavailable();
      return await handler.fetch(request, env, ctx);
    } catch {
      // Never expose configuration, headers, tokens or upstream response bodies.
      console.error("avala-mcp-worker: request failed.");
      return unavailable();
    }
  },
} satisfies ExportedHandler<Env>;
