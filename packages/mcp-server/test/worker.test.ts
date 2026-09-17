/**
 * Hosting-migration contract: the existing http.test.ts/oauth.test.ts request
 * policy must also hold in workerd, through the real SDK and shared catalog.
 * All outbound traffic terminates in local test fixtures, never Auth0/Django.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfigFileTextToJson } from "typescript";
import type { Miniflare } from "miniflare";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";

import { createMutationConfirmationService } from "../src/mutations.js";
import { createAssetHandleService } from "../src/assetHandles.js";

const ASSET_URL =
  "https://assets.example.com/export.zip?X-Amz-Date=20260917T000000Z&X-Amz-Expires=3600&X-Amz-Signature=local-fixture";
const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const RESOURCE = "https://mcp.example.com/mcp";
const ISSUER = "https://identity.example.com/";
const API = "https://api.example.com";
const KEY_A = "ab".repeat(20);
const KEY_B = "cd".repeat(20);
const INTERNAL_SECRET = "local-test-only-".repeat(3);
const CLIENT_IP = "203.0.113.17";

interface ObservedRequest {
  path: string;
  apiKey: string | null;
  authorization: string | null;
  clientIp: string | null;
  internalClient: string | null;
  clientName: string | null;
  subjectIssuedAt: string | null;
}

// The existing Node SDK matrix still runs its own suites on Node 18/20.
// Wrangler and its matching workerd harness require Node 22 or newer.
describe.skipIf(Number(process.versions.node.split(".")[0]) < 22)(
  "Cloudflare hosted MCP request contract",
  () => {
    let miniflareModule: typeof import("miniflare");
    let buildDirectory: string;
    let worker: Miniflare;
    let signingKey: CryptoKey;
    let jwk: Awaited<ReturnType<typeof exportJWK>>;
    let observations: ObservedRequest[] = [];
    let exchanges: URLSearchParams[] = [];
    let permissionStatus = 200;
    let staffPermissions = false;
    let mutationRequests: { body: unknown; idempotency: string | null }[] = [];
    let requestedUrls: string[] = [];
    let originRequests: {
      url: string;
      body: string;
      method: string;
      authorization: string | null;
    }[] = [];

    async function makeWorker(
      enabled?: string,
      overrides: Record<string, string> = {},
    ): Promise<Miniflare> {
      const parsed = parseConfigFileTextToJson(
        "worker/wrangler.jsonc",
        await readFile(join(PACKAGE, "worker/wrangler.jsonc"), "utf8"),
      );
      if (parsed.error) throw new Error("Invalid Worker configuration.");
      const config = parsed.config;
      return new miniflareModule.Miniflare(
        miniflareModule.convertV4MiniflareOptions({
          modules: [
            { type: "ESModule", path: join(buildDirectory, "test-entry.js") },
            { type: "ESModule", path: join(buildDirectory, "index.js") },
          ],
          modulesRoot: buildDirectory,
          compatibilityDate: config.compatibility_date,
          compatibilityFlags: config.compatibility_flags,
          bindings: {
            ...config.vars,
            ...(enabled === undefined
              ? {}
              : { AVALA_MCP_WORKER_ENABLED: enabled }),
            AVALA_BASE_URL: API,
            AVALA_MCP_INTERNAL_CLIENT_SECRET: INTERNAL_SECRET,
            AVALA_MCP_OAUTH_RESOURCE: RESOURCE,
            AVALA_MCP_OAUTH_ISSUER: ISSUER,
            AVALA_MCP_OAUTH_API_AUDIENCE: `${API}/`,
            AVALA_MCP_OAUTH_CLIENT_ID: "test-client-id",
            AVALA_MCP_OAUTH_CLIENT_SECRET: "local-test-client-secret",
            AVALA_MCP_OAUTH_SCOPES: "datasets.read projects.read",
            AVALA_MCP_BUILD_SHA: "a".repeat(40),
            AVALA_MCP_RELEASE_TAG: "worker-local-test",
            ALLOWED_ORIGINS: "https://allowed.example.com",
            ...overrides,
          },
          outboundService: async (request) => {
            const url = new URL(request.url);
            requestedUrls.push(url.href);
            if (url.href === `${ISSUER}.well-known/jwks.json`) {
              return miniflareModule.Response.json({ keys: [jwk] });
            }
            if (url.href === `${ISSUER}oauth/token`) {
              exchanges.push(new URLSearchParams(await request.text()));
              return miniflareModule.Response.json({
                access_token: `downstream.api.${decodeJwt(exchanges.at(-1)!.get("subject_token")!).sub}`,
                token_type: "Bearer",
                issued_token_type:
                  "urn:ietf:params:oauth:token-type:access_token",
                expires_in: 300,
                scope: "datasets.read",
              });
            }
            if (url.origin === new URL(RESOURCE).origin) {
              originRequests.push({
                url: url.href,
                body: await request.text(),
                method: request.method,
                authorization: request.headers.get("authorization"),
              });
              return new miniflareModule.Response("unchanged-origin-response", {
                status: 307,
                headers: {
                  Location: "https://never-follow.example.com/",
                  "X-Origin-Fixture": "retained",
                },
              });
            }
            if (url.origin !== API)
              throw new Error("Unexpected outbound origin");
            const apiKey = request.headers.get("x-avala-api-key");
            observations.push({
              path: url.pathname,
              apiKey,
              authorization: request.headers.get("authorization"),
              clientIp: request.headers.get("x-avala-forwarded-client-ip"),
              internalClient: request.headers.get("x-avala-internal-client"),
              clientName: request.headers.get("x-avala-client"),
              subjectIssuedAt: request.headers.get("x-avala-oauth-subject-iat"),
            });
            if (url.pathname === "/users/me/permissions/") {
              return miniflareModule.Response.json(
                permissionStatus === 200
                  ? {
                      type: "customer",
                      is_staff_privileged: staffPermissions,
                      scopes: staffPermissions
                        ? ["workforce.read", "workforce.write"]
                        : ["datasets.read", "exports.read"],
                      capabilities: [],
                      toolsets: staffPermissions
                        ? ["staff", "public", "docs"]
                        : ["datasets", "exports", "public", "docs"],
                    }
                  : { detail: "Unavailable" },
                { status: permissionStatus },
              );
            }
            if (url.pathname === "/datasets/") {
              return miniflareModule.Response.json({
                results: [
                  {
                    uid: apiKey === KEY_B ? "dataset-b" : "dataset-a",
                    name: "Worker fixture",
                    slug: "worker-fixture",
                    item_count: 1,
                    data_type: "image",
                  },
                ],
                next: null,
                previous: null,
              });
            }
            if (
              url.pathname ===
              `/admin/workforce/batches/${"12".repeat(16)}/priority/`
            ) {
              mutationRequests.push({
                body: await request.json(),
                idempotency: request.headers.get("Idempotency-Key"),
              });
              return miniflareModule.Response.json({
                operation_event_uid: "34".repeat(16),
                batch_uid: "12".repeat(16),
                batch_status: "available",
                previous_priority: "medium",
                priority: "high",
                reason: "Local runtime contract",
                reversal_guidance: "Request a reviewed reversal.",
              });
            }
            const exported = {
              uid: "export-worker",
              name: "Worker export",
              format: "json",
              filter_query_string: null,
              total_task_count: 1,
              exported_task_count: 1,
              download_url: ASSET_URL,
              status: "completed",
              datasets: ["dataset-a"],
              slices: [],
              projects: [],
              created_at: "2026-09-17T00:00:00Z",
            };
            if (url.pathname === "/exports/")
              return miniflareModule.Response.json({
                results: [exported],
                next: null,
                previous: null,
              });
            if (url.pathname === "/exports/export-worker/")
              return miniflareModule.Response.json(exported);
            throw new Error(`Unexpected outbound path ${url.pathname}`);
          },
        }),
      );
    }

    function post(
      body: string,
      headers: Record<string, string> = {},
      target = worker,
    ) {
      const requestHeaders = new Headers({
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "CF-Connecting-IP": CLIENT_IP,
        "X-Avala-Api-Key": KEY_A,
        ...headers,
      });
      for (const [name, value] of Object.entries(headers)) {
        if (value === "") requestHeaders.delete(name);
      }
      return target.dispatchFetch(RESOURCE, {
        method: "POST",
        redirect: "manual",
        headers: requestHeaders,
        body,
      });
    }

    function rpc(method: string, params: Record<string, unknown> = {}) {
      return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    }

    function modernCall(
      name: string,
      args: Record<string, unknown>,
      extra: Record<string, unknown> = {},
      headers: Record<string, string> = {},
    ) {
      return post(
        rpc("tools/call", {
          name,
          arguments: args,
          ...extra,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "worker-test",
              version: "1",
            },
            "io.modelcontextprotocol/clientCapabilities": {
              elicitation: { form: {} },
            },
          },
        }),
        {
          "Mcp-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/call",
          "Mcp-Name": name,
          ...headers,
        },
      );
    }

    async function responseJson(response: Awaited<ReturnType<typeof post>>) {
      const text = await response.text();
      return JSON.parse(
        text.startsWith("event:") || text.startsWith("data:")
          ? text
              .split("\n")
              .find((line) => line.startsWith("data: "))!
              .slice(6)
          : text,
      );
    }

    beforeAll(async () => {
      miniflareModule = await import("miniflare");
      buildDirectory = await mkdtemp(join(tmpdir(), "avala-mcp-worker-test-"));
      execFileSync(
        "bun",
        [
          "x",
          "--no-install",
          "wrangler",
          "deploy",
          "--dry-run",
          "--config",
          "worker/wrangler.jsonc",
          "--outdir",
          buildDirectory,
        ],
        {
          cwd: PACKAGE,
          env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
          stdio: "pipe",
        },
      );
      // Test-only wrapper varies Env identity and bindings without adding any
      // diagnostic routes or headers to the deployed entry point.
      await writeFile(
        join(buildDirectory, "test-entry.js"),
        `
      import app from "./index.js";
      export default { fetch(request, env, ctx) {
        const nextEnv = { ...env };
        const headers = new Headers(request.headers);
        if (headers.has("X-Test-Remove-IP")) headers.delete("CF-Connecting-IP");
        // The Miniflare HTTP proxy drops empty headers before invoking Fetch.
        if (headers.has("X-Test-Empty-Key")) headers.set("X-Avala-Api-Key", "");
        headers.delete("X-Test-Empty-Key");
        const secret = headers.get("X-Test-Internal-Secret");
        if (secret) nextEnv.AVALA_MCP_INTERNAL_CLIENT_SECRET = secret;
        headers.delete("X-Test-Remove-IP");
        headers.delete("X-Test-Internal-Secret");
        return app.fetch(new Request(request, { headers }), nextEnv, ctx);
      }};
    `,
      );
      const keys = await generateKeyPair("RS256");
      signingKey = keys.privateKey;
      jwk = {
        ...(await exportJWK(keys.publicKey)),
        kid: "worker-test",
        alg: "RS256",
      };
      worker = await makeWorker("true");
      await worker.ready;
    }, 60_000);

    beforeEach(() => {
      observations = [];
      requestedUrls = [];
      originRequests = [];
      exchanges = [];
      permissionStatus = 200;
      staffPermissions = false;
      mutationRequests = [];
    });

    afterAll(async () => {
      await worker?.dispose();
      if (buildDirectory)
        await rm(buildDirectory, { recursive: true, force: true });
    });

    it("stays unavailable by default, without reading credentials or calling Django", async () => {
      const disabled = await makeWorker();
      try {
        const response = await disabled.dispatchFetch(RESOURCE);
        expect(response.status).toBe(503);
        expect(observations).toEqual([]);
      } finally {
        await disabled.dispose();
      }
    }, 15_000);

    it("serves health, build identity and the same OAuth resource metadata", async () => {
      expect(
        (await worker.dispatchFetch("https://mcp.example.com/healthz")).status,
      ).toBe(200);
      const discovery = await worker.dispatchFetch(
        "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      );
      expect(await discovery.json()).toMatchObject({
        resource: RESOURCE,
        scopes_supported: ["datasets.read", "projects.read"],
      });
      const build = await worker.dispatchFetch("https://mcp.example.com/");
      expect(await build.json()).toMatchObject({
        build_sha: "a".repeat(40),
        release_tag: "worker-local-test",
      });
    });

    it("runs initialize, tools/list and tools/call through workerd and the real SDK", async () => {
      const initialized = await post(
        rpc("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "worker-test", version: "1" },
        }),
      );
      expect(initialized.status).toBe(200);
      expect(await responseJson(initialized)).toHaveProperty(
        "result.serverInfo",
      );
      const catalog = await responseJson(await post(rpc("tools/list")));
      expect(
        catalog.result.tools.some(
          (tool: { name: string }) => tool.name === "list_datasets",
        ),
      ).toBe(true);
      expect(
        catalog.result.tools.some(
          (tool: { name: string }) =>
            tool.name === "execute_approved_operation",
        ),
      ).toBe(false);
      const result = await responseJson(
        await post(rpc("tools/call", { name: "list_datasets", arguments: {} })),
      );
      expect(JSON.stringify(result)).toContain("dataset-a");
      expect(
        observations.some(
          (request) =>
            request.path === "/datasets/" &&
            request.clientName === "list_datasets",
        ),
      ).toBe(true);
      expect(
        observations.every(
          (request) =>
            request.clientIp === CLIENT_IP &&
            request.internalClient === INTERNAL_SECRET,
        ),
      ).toBe(true);
    });

    it("keeps concurrent caller credentials and datasets separate", async () => {
      const responses = await Promise.all(
        [KEY_A, KEY_B].map((key) =>
          post(rpc("tools/call", { name: "list_datasets", arguments: {} }), {
            "X-Avala-Api-Key": key,
          }),
        ),
      );
      const results = await Promise.all(responses.map(responseJson));
      expect(JSON.stringify(results[0])).toContain("dataset-a");
      expect(JSON.stringify(results[0])).not.toContain("dataset-b");
      expect(JSON.stringify(results[1])).toContain("dataset-b");
    });

    it("uses Cloudflare ingress IP, refusing spoofed, missing and Worker-subrequest context", async () => {
      expect(
        (await post(rpc("tools/list"), { "X-Forwarded-For": "198.51.100.66" }))
          .status,
      ).toBe(200);
      expect(
        observations.every((request) => request.clientIp === CLIENT_IP),
      ).toBe(true);
      observations = [];
      for (const headers of [
        { "X-Test-Remove-IP": "true" },
        { "CF-Connecting-IP": "not-an-ip" },
        { "CF-Connecting-IP": "203.0.113.1, 203.0.113.2" },
      ]) {
        expect(
          (await post(rpc("tools/list"), headers)).status,
          JSON.stringify(headers),
        ).toBe(400);
      }
      expect(
        (await post(rpc("tools/list"), { "CF-Worker": "other.example.com" }))
          .status,
      ).toBe(503);
      expect(observations).toEqual([]);
    });

    it("preserves credential, Origin, method and canonical-path failures", async () => {
      const noCredential = await post(rpc("tools/list"), {
        "X-Avala-Api-Key": "",
      });
      expect(noCredential.status).toBe(401);
      expect(noCredential.headers.get("WWW-Authenticate")).toContain(
        "oauth-protected-resource/mcp",
      );
      expect(
        (await post(rpc("tools/list"), { Authorization: "Bearer another" }))
          .status,
      ).toBe(400);
      expect(
        (
          await post(rpc("tools/list"), {
            "X-Avala-Api-Key": `${KEY_A}, ${KEY_B}`,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post(rpc("tools/list"), {
            Origin: "https://untrusted.example.com",
          })
        ).status,
      ).toBe(403);
      expect((await worker.dispatchFetch(RESOURCE)).status).toBe(405);
      expect(
        (await worker.dispatchFetch(`${RESOURCE}?alias=true`)).status,
      ).toBe(404);
      expect(observations).toEqual([]);
    });

    it.each([
      { label: "single credential", credentials: { "X-Avala-Api-Key": KEY_A } },
      {
        label: "mixed credentials",
        credentials: {
          "X-Avala-Api-Key": KEY_A,
          Authorization: `Bearer ${KEY_B}`,
        },
      },
      {
        label: "combined duplicates",
        credentials: { "X-Avala-Api-Key": `${KEY_A}, ${KEY_B}` },
      },
    ])(
      "rejects a retained bare query before $label can reach an upstream",
      async ({ credentials }) => {
        const url = `${RESOURCE}?`;
        expect(new Request(url).url).toBe(url);
        const response = await worker.dispatchFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "CF-Connecting-IP": CLIENT_IP,
            ...credentials,
          },
          body: rpc("tools/list"),
        });
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: "Not found." },
        });
        expect(requestedUrls).toEqual([]);
        expect(observations).toEqual([]);
        expect(exchanges).toEqual([]);
        expect(originRequests).toEqual([]);
      },
    );

    it("returns 413 for byte overflow without a socket error or upstream call", async () => {
      const response = await post('"' + "x".repeat(4 * 1024 * 1024) + '"');
      expect(response.status).toBe(413);
      expect(await responseJson(response)).toHaveProperty("error");
      expect(observations).toEqual([]);
      expect((await post("{bad-json")).status).toBe(400);
      expect(
        (await worker.dispatchFetch("https://mcp.example.com/healthz")).status,
      ).toBe(200);
    });

    it("fails closed when Django permission discovery denies the caller", async () => {
      permissionStatus = 403;
      const response = await post(
        rpc("tools/call", { name: "list_datasets", arguments: {} }),
      );
      expect(response.status).toBe(403);
      expect(observations.map((request) => request.path)).toEqual([
        "/users/me/permissions/",
      ]);
    });

    it("verifies JWKS and exchanges only granted allowlisted scopes before calling Django", async () => {
      const subject = await new SignJWT({
        scope: "datasets.read operations.execution.request",
        permissions: ["datasets.read", "operations.execution.request"],
      })
        .setProtectedHeader({ alg: "RS256", kid: "worker-test" })
        .setIssuer(ISSUER)
        .setAudience(RESOURCE)
        .setSubject("worker-test-caller")
        .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
        .setExpirationTime("5m")
        .sign(signingKey);
      const response = await post(rpc("tools/list"), {
        "X-Avala-Api-Key": "",
        Authorization: `Bearer ${subject}`,
      });
      expect(response.status).toBe(200);
      expect(exchanges).toHaveLength(1);
      expect(exchanges[0]!.get("scope")).toBe("datasets.read");
      expect(
        observations.every(
          (request) =>
            request.authorization ===
              "Bearer downstream.api.worker-test-caller" &&
            request.apiKey === null,
        ),
      ).toBe(true);
      expect(
        observations.every(
          (request) =>
            request.subjectIssuedAt === String(decodeJwt(subject).iat),
        ),
      ).toBe(true);
    });

    it("preserves IPv6 and only uses CF-Connecting-IPv6 for Pseudo IPv4", async () => {
      for (const headers of [
        { "CF-Connecting-IP": "2001:db8::17" },
        {
          "CF-Connecting-IP": "240.0.0.17",
          "CF-Connecting-IPv6": "2001:db8::17",
        },
      ]) {
        observations = [];
        expect((await post(rpc("tools/list"), headers)).status).toBe(200);
        expect(
          observations.every((request) => request.clientIp === "2001:db8::17"),
        ).toBe(true);
      }
      expect(
        (await post(rpc("tools/list"), { "CF-Connecting-IP": "240.0.0.17" }))
          .status,
      ).toBe(400);
      observations = [];
      expect(
        (
          await post(rpc("tools/list"), {
            "CF-Connecting-IPv6": "2001:db8::99",
          })
        ).status,
      ).toBe(200);
      expect(
        observations.every((request) => request.clientIp === CLIENT_IP),
      ).toBe(true);
    });

    it("reuses equal binding values across Env objects and rotates configuration safely", async () => {
      const rotated = "rotated-local-only-".repeat(3);
      const responses = await Promise.all(
        [INTERNAL_SECRET, rotated].map((secret) =>
          post(rpc("tools/call", { name: "list_datasets", arguments: {} }), {
            "X-Test-Internal-Secret": secret,
          }),
        ),
      );
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      await Promise.all(responses.map((response) => response.text()));
      expect(
        observations.some((request) => request.internalClient === rotated),
      ).toBe(true);
      expect((await post(rpc("tools/list"))).status).toBe(200);
      expect(observations.at(-1)!.internalClient).toBe(INTERNAL_SECRET);
    });

    it("interoperates with Node asset handles and confirmations on the modern protocol", async () => {
      const nodeHandles = createAssetHandleService(INTERNAL_SECRET);
      const listed = await responseJson(
        await modernCall("list_exports", { detail: "full" }),
      );
      expect(listed.result.resultType).toBe("complete");
      const handle = listed.result.structuredContent.items[0].downloadAsset
        .handle as string;
      expect(JSON.stringify(listed)).not.toContain(ASSET_URL);
      const locator = nodeHandles.open(handle);
      expect(locator).toMatchObject({
        kind: "export_download",
        uid: "export-worker",
      });
      const nodeHandle = nodeHandles.issue(locator).handle;
      const pending = await responseJson(
        await modernCall("resolve_asset_handle", { handle: nodeHandle }),
      );
      expect(pending.result.resultType).toBe("input_required");
      expect(() =>
        nodeHandles.verifyConfirmation(pending.result.requestState, nodeHandle),
      ).not.toThrow();
      expect(
        observations.some(
          (request) => request.path === "/exports/export-worker/",
        ),
      ).toBe(false);
      const confirmed = await responseJson(
        await modernCall(
          "resolve_asset_handle",
          { handle: nodeHandle },
          {
            requestState: nodeHandles.issueConfirmation(nodeHandle),
            inputResponses: {
              confirmAssetUrlRelease: {
                action: "accept",
                content: { confirm: true },
              },
            },
          },
        ),
      );
      expect(confirmed.result.structuredContent.url).toBe(ASSET_URL);
      expect(observations.at(-1)!.clientName).toBe("resolve_asset_handle");
      permissionStatus = 403;
      expect(
        (
          await modernCall(
            "resolve_asset_handle",
            { handle: nodeHandle },
            {
              requestState: pending.result.requestState,
              inputResponses: {
                confirmAssetUrlRelease: {
                  action: "accept",
                  content: { confirm: true },
                },
              },
            },
          )
        ).status,
      ).toBe(403);
    });

    it("preserves the allowed browser CORS contract and denies unknown tools", async () => {
      const preflight = await worker.dispatchFetch(RESOURCE, {
        method: "OPTIONS",
        headers: {
          Origin: "https://allowed.example.com",
          "Access-Control-Request-Method": "POST",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://allowed.example.com",
      );
      const unknown = await responseJson(
        await modernCall("unreviewed_write_tool", {}),
      );
      expect(unknown).toHaveProperty("error");
      expect(
        observations.some(
          (request) => request.path !== "/users/me/permissions/",
        ),
      ).toBe(false);
      const ambiguous = await worker.dispatchFetch(RESOURCE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Test-Empty-Key": "true",
          Authorization: `Bearer ${KEY_A}`,
        },
        body: rpc("tools/list"),
      });
      expect(ambiguous.status).toBe(400);
      const corsAmbiguous = await post(rpc("tools/list"), {
        Origin: "https://allowed.example.com",
        Authorization: `Bearer ${KEY_A}`,
      });
      expect(corsAmbiguous.status).toBe(400);
      expect(corsAmbiguous.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://allowed.example.com",
      );
      expect(
        (
          await post(rpc("tools/list"), {
            Origin: "https://untrusted.example.com",
            Authorization: `Bearer ${KEY_A}`,
          })
        ).status,
      ).toBe(403);
    });

    it("keeps cold same-token OAuth exchange local to its callers under concurrency", async () => {
      const iat = Math.floor(Date.now() / 1000) - 180;
      const subject = await new SignJWT({
        scope: "datasets.read",
        permissions: ["datasets.read"],
      })
        .setProtectedHeader({ alg: "RS256", kid: "worker-test" })
        .setIssuer(ISSUER)
        .setAudience(RESOURCE)
        .setSubject("concurrent-caller")
        .setIssuedAt(iat)
        .setExpirationTime("5m")
        .sign(signingKey);
      const headers = {
        "X-Avala-Api-Key": "",
        Authorization: `Bearer ${subject}`,
        "X-Test-Internal-Secret": "cold-oauth-local-".repeat(3),
      };
      const results = await Promise.all([
        post(rpc("tools/list"), headers),
        post(rpc("tools/list"), headers),
      ]);
      expect(results.map((response) => response.status)).toEqual([200, 200]);
      await Promise.all(results.map((response) => response.text()));
      expect(exchanges).toHaveLength(1);
      expect(
        requestedUrls.filter((url) => url.endsWith("jwks.json")),
      ).toHaveLength(1);
      expect(observations).toHaveLength(2);
      expect(
        observations.every(
          (request) =>
            request.authorization ===
              "Bearer downstream.api.concurrent-caller" &&
            request.subjectIssuedAt === String(iat),
        ),
      ).toBe(true);
    });

    it("isolates concurrent OAuth subjects and rejects invalid audiences and expired tokens", async () => {
      const subjects = await Promise.all(
        ["caller-a", "caller-b"].map((sub) =>
          new SignJWT({
            scope: "datasets.read",
            permissions: ["datasets.read"],
          })
            .setProtectedHeader({ alg: "RS256", kid: "worker-test" })
            .setIssuer(ISSUER)
            .setAudience(RESOURCE)
            .setSubject(sub)
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(signingKey),
        ),
      );
      const results = await Promise.all(
        subjects.map((subject) =>
          post(rpc("tools/list"), {
            "X-Avala-Api-Key": "",
            Authorization: `Bearer ${subject}`,
          }),
        ),
      );
      expect(results.map((response) => response.status)).toEqual([200, 200]);
      await Promise.all(results.map((response) => response.text()));
      expect(
        observations.map((request) => request.authorization).sort(),
      ).toEqual([
        "Bearer downstream.api.caller-a",
        "Bearer downstream.api.caller-b",
      ]);
      observations = [];
      exchanges = [];
      for (const [audience, expiry] of [
        [`${API}/`, "5m"],
        [RESOURCE, "-5m"],
      ]) {
        const subject = await new SignJWT({
          scope: "datasets.read",
          permissions: ["datasets.read"],
        })
          .setProtectedHeader({ alg: "RS256", kid: "worker-test" })
          .setIssuer(ISSUER)
          .setAudience(audience!)
          .setSubject("denied-caller")
          .setIssuedAt()
          .setExpirationTime(expiry!)
          .sign(signingKey);
        expect(
          (
            await post(rpc("tools/list"), {
              "X-Avala-Api-Key": "",
              Authorization: `Bearer ${subject}`,
            })
          ).status,
        ).toBe(401);
      }
      expect(exchanges).toEqual([]);
      expect(observations).toEqual([]);
    });

    it("passes Worker callers to only the explicit same-origin AWS route without following redirects", async () => {
      const fallback = await makeWorker("true", {
        AVALA_MCP_ROUTING_MODE: "aws-origin-route",
        AVALA_MCP_AWS_ORIGIN_ROUTE_URL: new URL(RESOURCE).origin,
      });
      try {
        const body = rpc("tools/list");
        const response = await post(
          body,
          {
            "CF-Worker": "caller.example.com",
            "X-Avala-Api-Key": "",
            Authorization: `Bearer ${KEY_B}`,
          },
          fallback,
        );
        expect(response.status).toBe(307);
        expect(await response.text()).toBe("unchanged-origin-response");
        expect(response.headers.get("Location")).toBe(
          "https://never-follow.example.com/",
        );
        expect(response.headers.get("X-Origin-Fixture")).toBe("retained");
        expect(originRequests).toEqual([
          {
            url: RESOURCE,
            body,
            method: "POST",
            authorization: `Bearer ${KEY_B}`,
          },
        ]);
        expect(observations).toEqual([]);
        expect(exchanges).toEqual([]);
        expect(
          (
            await post(
              body,
              {
                "CF-Worker": "caller.example.com",
                "X-Avala-Api-Key": `${KEY_A}, ${KEY_B}`,
              },
              fallback,
            )
          ).status,
        ).toBe(400);
        expect(originRequests).toHaveLength(1);
        const noncanonical = await fallback.dispatchFetch(`${RESOURCE}?`, {
          method: "POST",
          headers: {
            "CF-Worker": "caller.example.com",
            "X-Avala-Api-Key": KEY_A,
          },
          body,
        });
        expect(noncanonical.status).toBe(404);
        expect(originRequests).toHaveLength(1);
        expect(
          (
            await fallback.dispatchFetch("https://unrelated.example.com/mcp", {
              headers: { "CF-Worker": "caller.example.com" },
            })
          ).status,
        ).toBe(503);
        expect(originRequests).toHaveLength(1);
      } finally {
        await fallback.dispose();
      }
    }, 15_000);

    it.each([
      {
        AVALA_MCP_ROUTING_MODE: "custom-domain",
        AVALA_MCP_AWS_ORIGIN_ROUTE_URL: new URL(RESOURCE).origin,
      },
      {
        AVALA_MCP_ROUTING_MODE: "aws-origin-route",
        AVALA_MCP_AWS_ORIGIN_ROUTE_URL: "https://alternate.example.com",
      },
    ])(
      "fails closed for unverified origin routing configuration %j",
      async (overrides) => {
        const invalid = await makeWorker("true", overrides);
        try {
          expect(
            (
              await post(
                rpc("tools/list"),
                { "CF-Worker": "caller.example.com" },
                invalid,
              )
            ).status,
          ).toBe(503);
          expect(originRequests).toEqual([]);
        } finally {
          await invalid.dispose();
        }
      },
      15_000,
    );

    it("preserves Node/Worker mutation confirmations and rejects cross-credential replay", async () => {
      staffPermissions = true;
      const name = "set_workforce_batch_priority";
      const args = {
        batchUid: "12".repeat(16),
        expectedPriority: "medium",
        priority: "high",
        reason: "Local runtime contract",
      };
      const binding = createHmac("sha256", INTERNAL_SECRET)
        .update("avala-mcp:mutation-credential:v1\0api_key\0" + KEY_A)
        .digest("base64url");
      const nodeConfirmations =
        createMutationConfirmationService(INTERNAL_SECRET);
      const pending = await responseJson(await modernCall(name, args));
      expect(pending.result.resultType).toBe("input_required");
      expect(
        nodeConfirmations.verify(
          pending.result.requestState,
          name,
          args,
          binding,
        ),
      ).toMatch(/^[a-f0-9-]{36}$/);
      expect(mutationRequests).toEqual([]);
      const nodeState = nodeConfirmations.issue(name, args, binding);
      const accepted = {
        requestState: nodeState,
        inputResponses: {
          confirmAvalaMutation: {
            action: "accept",
            content: { confirm: true },
          },
        },
      };
      const replay = await responseJson(
        await modernCall(name, args, accepted, { "X-Avala-Api-Key": KEY_B }),
      );
      expect(replay.result.isError).toBe(true);
      expect(mutationRequests).toEqual([]);
      const completed = await responseJson(
        await modernCall(name, args, accepted),
      );
      expect(completed.result.isError).not.toBe(true);
      expect(completed.result.structuredContent.priority).toBe("high");
      expect(mutationRequests).toEqual([
        {
          body: {
            expected_priority: "medium",
            priority: "high",
            reason: "Local runtime contract",
          },
          idempotency: nodeConfirmations.verify(nodeState, name, args, binding),
        },
      ]);
    });
  },
);
