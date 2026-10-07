/**
 * Accepted hosting contract: API-key and OAuth dataset reads must carry the
 * same resolved caller identity into the real SDK, without changing grants.
 * Local HTTP fixtures model the observed ALB topology. Auth0 exchange and the
 * Django response are fixtures; backend verification and live ALB are NOT tested.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAvalaMcpHttpServer } from "../src/httpServer.js";
import { nodeClientIpResolver } from "../src/cloudflareAlbClientIp.js";

const KEY = "ab".repeat(20);
const SECRET = "local-fixture-only-".repeat(3);
const EDGE = "173.245.48.1";
const VISITOR = "203.0.113.42";
const servers: Server[] = [];

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeIdleConnections();
        }),
    ),
  );
});

async function fixture(mode?: string) {
  // Exercise the SDK's existing localhost-only development transport.
  vi.stubEnv("AVALA_ALLOW_INSECURE_BASE_URL", "true");
  const observed: {
    path: string;
    ip: string | string[] | undefined;
    internal: string | string[] | undefined;
    key: string | string[] | undefined;
    token: string | string[] | undefined;
    iat: string | string[] | undefined;
  }[] = [];
  const api = await listen(
    createServer((req, res) => {
      const path = new URL(req.url!, "http://localhost").pathname;
      observed.push({
        path,
        ip: req.headers["x-avala-forwarded-client-ip"],
        internal: req.headers["x-avala-internal-client"],
        key: req.headers["x-avala-api-key"],
        token: req.headers.authorization,
        iat: req.headers["x-avala-oauth-subject-iat"],
      });
      res.setHeader("Content-Type", "application/json");
      if (path === "/users/me/permissions/") {
        res.end(
          JSON.stringify({
            type: "customer",
            is_staff_privileged: false,
            scopes: ["datasets.read"],
            capabilities: [],
            toolsets: ["datasets"],
          }),
        );
      } else if (path === "/datasets/") {
        res.end(
          JSON.stringify({
            results: [
              {
                uid: "dataset-fixture",
                name: "Local dataset",
                slug: "local-dataset",
                item_count: 1,
                data_type: "image",
              },
            ],
            next: null,
            previous: null,
          }),
        );
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    }),
  );
  const exchange = vi.fn(async () => ({
    accessToken: "local.api.token",
    subject: "auth0|fixture",
    subjectIssuedAt: 1_788_000_000,
    scopes: ["datasets.read"],
    expiresAt: Date.now() + 60_000,
  }));
  const base = await listen(
    createAvalaMcpHttpServer({
      baseUrl: api,
      internalClientSecret: SECRET,
      resolveClientIp: nodeClientIpResolver(mode),
      oauth: {
        resource: "https://mcp.avala.ai/mcp",
        authorizationServer: "https://identity.example.com/",
        apiAudience: "https://api.avala.ai/",
        clientId: "fixture-client",
        clientSecret: "fixture-secret-value",
        scopesSupported: ["datasets.read"],
      },
      oauthBroker: { exchange },
    }),
  );
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const post = (headers: Record<string, string>) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_datasets", arguments: {} },
      }),
      signal: AbortSignal.timeout(5000),
    });
  return { observed, exchange, post };
}

describe.each(["api-key", "oauth"] as const)(
  "%s dataset read through Node and the SDK",
  (kind) => {
    const credential: Record<string, string> =
      kind === "api-key"
        ? { "X-Avala-Api-Key": KEY }
        : { Authorization: "Bearer local.subject.token" };
    it.each([
      [undefined, EDGE, EDGE],
      ["cloudflare-alb", EDGE, VISITOR],
      ["cloudflare-alb", "198.51.100.8", "198.51.100.8"],
    ])(
      "mode %j preserves the expected identity for peer %s",
      async (mode, peer, expected) => {
        const { observed, exchange, post } = await fixture(mode);
        const response = await post({
          ...credential,
          "X-Forwarded-For": `forged, ${peer}`,
          "CF-Connecting-IP": VISITOR,
        });
        expect(response.status).toBe(200);
        const messages = (await response.text())
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => JSON.parse(line.slice(6)));
        const body = messages.find((message) => message.id === 1);
        expect(body).toBeDefined();
        expect(body.result.isError).not.toBe(true);
        expect(JSON.stringify(body.result)).toContain("dataset-fixture");
        expect(observed.map((entry) => entry.path)).toEqual([
          "/users/me/permissions/",
          "/datasets/",
        ]);
        for (const entry of observed) {
          expect(entry.ip).toBe(expected);
          expect(entry.internal).toBe(SECRET);
          expect(entry.key).toBe(kind === "api-key" ? KEY : undefined);
          expect(entry.token).toBe(
            kind === "oauth" ? "Bearer local.api.token" : undefined,
          );
          expect(entry.iat).toBe(kind === "oauth" ? "1788000000" : undefined);
        }
        expect(exchange).toHaveBeenCalledTimes(kind === "oauth" ? 1 : 0);
      },
    );

    it.each([
      "203.0.113.1, 203.0.113.2",
      "2001:db8::1]/suffix",
      "2a06:98c0:3600::\t103",
    ])(
      "refuses malformed trusted context %j before Auth0 exchange or any REST request",
      async (malformed) => {
        const { observed, exchange, post } = await fixture("cloudflare-alb");
        const response = await post({
          ...credential,
          "X-Forwarded-For": EDGE,
          "CF-Connecting-IP": malformed,
        });
        expect(response.status).toBe(400);
        expect((await response.json()).error.message).toBe(
          "Unable to establish client network context.",
        );
        expect(observed).toEqual([]);
        expect(exchange).not.toHaveBeenCalled();
      },
    );
  },
);
