/**
 * Entry point for the hosted Streamable HTTP deployment (ECS/ALB):
 *
 *   node dist/http.js
 *
 * Environment:
 *  - PORT                        — listen port (default 8080)
 *  - AVALA_BASE_URL              — override the Avala REST base URL
 *  - AVALA_MCP_INTERNAL_CLIENT_SECRET — service credential used to mark
 *                                  verified hosted-MCP REST requests
 *  - AVALA_MCP_OAUTH_RESOURCE      — exact public resource URL (`.../mcp`)
 *  - AVALA_MCP_OAUTH_ISSUER        — Auth0 issuer URL
 *  - AVALA_MCP_OAUTH_API_AUDIENCE  — downstream Avala API audience
 *  - AVALA_MCP_OAUTH_CLIENT_ID     — confidential OBO client ID
 *  - AVALA_MCP_OAUTH_CLIENT_SECRET — confidential OBO client secret
 *  - AVALA_MCP_OAUTH_SCOPES        — space-separated resource scopes
 *  - ALLOWED_ORIGINS             — comma-separated browser origins allowed to
 *                                  reach the server. Default empty: only
 *                                  requests without an Origin header pass
 *                                  (the MCP spec's DNS-rebinding defense).
 *
 * Unlike the stdio entry, no AVALA_API_KEY is read here: every request brings
 * its own credential, which is forwarded on that request's REST calls only.
 */
import {
  createAvalaMcpHttpServer,
  HEALTH_PATH,
  MCP_PATH,
} from "./httpServer.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for the hosted MCP transport.`);
  }
  return value;
}

const port = Number(process.env.PORT ?? "8080");
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`Error: invalid PORT ${JSON.stringify(process.env.PORT)}.`);
  process.exit(1);
}

// The hosted entry deliberately does NOT read AVALA_MCP_ENABLE_MUTATIONS:
// hosted v1 serves the read-only catalog unconditionally (decision record
// §5.5-4 — see the registerTools call in httpServer.ts). The flag remains a
// stdio-only convenience.
console.warn(
  "Avala MCP hosted transport serves the read-only tool catalog (mutations are stdio-only for now).",
);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const server = createAvalaMcpHttpServer({
  baseUrl: process.env.AVALA_BASE_URL,
  allowedOrigins,
  internalClientSecret: process.env.AVALA_MCP_INTERNAL_CLIENT_SECRET,
  oauth: {
    resource: requiredEnvironment("AVALA_MCP_OAUTH_RESOURCE"),
    authorizationServer: requiredEnvironment("AVALA_MCP_OAUTH_ISSUER"),
    apiAudience: requiredEnvironment("AVALA_MCP_OAUTH_API_AUDIENCE"),
    clientId: requiredEnvironment("AVALA_MCP_OAUTH_CLIENT_ID"),
    clientSecret: requiredEnvironment("AVALA_MCP_OAUTH_CLIENT_SECRET"),
    scopesSupported: requiredEnvironment("AVALA_MCP_OAUTH_SCOPES").split(" "),
  },
});

server.listen(port, () => {
  console.error(
    `Avala MCP Streamable HTTP server listening on :${port} ` +
      `(MCP: POST ${MCP_PATH}, OAuth metadata: GET /.well-known/oauth-protected-resource/mcp, health: GET ${HEALTH_PATH})`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // ECS sends SIGTERM then SIGKILL after the stop timeout; don't hang on
    // stuck sockets longer than that.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
