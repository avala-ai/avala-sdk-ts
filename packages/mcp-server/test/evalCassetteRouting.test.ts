import { Agent, createServer, get, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cassetteKey, keyString, startCassetteServer } from "../eval/cassette-server.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing local address");
  return `http://127.0.0.1:${address.port}/api/v1`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    // Match the recorder's graceful teardown on Node 18 as well as 20+.
    server.closeIdleConnections();
  });
}

describe("cassette query identity", () => {
  it("normalizes parameter order and equivalent encodings", () => {
    expect(cassetteKey("get", "/api/v1/items/?z=last&q=two%20words")).toEqual(
      cassetteKey("GET", "/api/v1/items/?q=two+words&z=last"),
    );
    expect(cassetteKey("get", "/api/v1/items/?z=last&a=first")).toEqual({
      method: "GET", path: "/items/", query: "a=first&z=last",
    });
  });

  it.each([
    ["value separator", "a=x%26b%3Dy", "a=x&b=y"],
    ["name separator", "a%3Db=c", "a=b%3Dc"],
    ["literal plus", "q=a%2Bb", "q=a+b"],
    ["fragment character", "q=a%23b", "q=a"],
    ["literal percent escape", "q=%2526", "q=%26"],
    ["empty parameter name", "=a%26b%3Dc", "=a&b=c"],
  ])("preserves %s without aliasing another request", (_name, query, other) => {
    const key = cassetteKey("GET", `/api/v1/items/?${query}`);
    const forwarded = new URL(`http://local.invalid${key.path}?${key.query}`);
    expect([...forwarded.searchParams]).toEqual([...new URLSearchParams(query)]);
    expect(keyString(key)).not.toBe(keyString(cassetteKey("GET", `/api/v1/items/?${other}`)));
  });

  it("retains repeated values, empty values, Unicode and duplicate ordering", () => {
    const query = "z=&q=caf%C3%A9&q=x%26y&q=";
    const key = cassetteKey("GET", `/api/v1/items/?${query}`);
    expect([...new URLSearchParams(key.query)]).toEqual([
      ["q", "café"], ["q", "x&y"], ["q", ""], ["z", ""],
    ]);
    expect(keyString(key)).not.toBe(
      keyString(cassetteKey("GET", "/api/v1/items/?q=x%26y&q=caf%C3%A9&q=&z=")),
    );
  });

  it("forwards decoded query names and values unchanged to a local recording upstream", async () => {
    const dir = await mkdtemp(join(tmpdir(), "avala-cassette-query-"));
    const observed: [string, string][][] = [];
    const upstream = createServer((request, response) => {
      observed.push([...new URL(request.url ?? "/", "http://local.invalid").searchParams]);
      response.writeHead(200, { "Content-Type": "application/json" }).end('{"count":1}');
    });
    let recorder: Awaited<ReturnType<typeof startCassetteServer>> | undefined;
    try {
      recorder = await startCassetteServer({
        cassetteDir: dir, record: true, upstreamBaseUrl: await listen(upstream),
      });
      const query = "a%3Db=c%26d%3De&q=a%2Bb%23c%25%20caf%C3%A9&q=";
      const response = await fetch(`${recorder.baseUrl}/items/?${query}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ count: 1 });
      expect(observed).toEqual([[...new URLSearchParams(query)]]);
    } finally {
      await recorder?.close();
      if (upstream.listening) await close(upstream);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records and replays distinct requests independently across a disk reload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "avala-cassette-query-"));
    let upstreamCalls = 0;
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ordinal: ++upstreamCalls }));
    });
    let server: Awaited<ReturnType<typeof startCassetteServer>> | undefined;
    const queries = ["a=x%26b%3Dy", "a=x&b=y"];
    try {
      server = await startCassetteServer({
        cassetteDir: dir, record: true, upstreamBaseUrl: await listen(upstream),
      });
      for (const [index, query] of queries.entries()) {
        const response = await fetch(`${server.baseUrl}/items/?${query}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ordinal: index + 1 });
      }
      expect(upstreamCalls).toBe(2);
      expect(server.cassettes.size).toBe(2);
      await server.close();
      server = undefined;
      await close(upstream);
      // No upstream is running: replay must load the exact request identities
      // from disk and cannot silently satisfy the second query with the first.
      server = await startCassetteServer({ cassetteDir: dir });
      for (const [index, query] of queries.entries()) {
        const response = await fetch(`${server.baseUrl}/items/?${query}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ordinal: index + 1 });
      }
      expect(server.cassettes.size).toBe(2);
      expect(server.misses).toEqual([]);
    } finally {
      await server?.close();
      if (upstream.listening) await close(upstream);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("cassette HTTP lifecycle", () => {
  it("closes with an idle keep-alive client without waiting for its timeout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "avala-cassette-close-"));
    const agent = new Agent({ keepAlive: true });
    let server: Awaited<ReturnType<typeof startCassetteServer>> | undefined;
    try {
      await writeFile(join(dir, "items.json"), JSON.stringify({
        key: { method: "GET", path: "/items/", query: "" }, status: 200, body: { count: 1 },
      }));
      server = await startCassetteServer({ cassetteDir: dir });
      const idle = new Promise<void>((resolve) => agent.once("free", () => resolve()));
      const url = `${server.baseUrl}/items/`;
      const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        get(url, { agent }, (incoming) => {
          let body = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => { body += chunk; });
          incoming.on("error", reject);
          incoming.on("end", () => resolve({ status: incoming.statusCode, body }));
        }).on("error", reject);
      });
      expect(response).toEqual({ status: 200, body: '{"count":1}' });
      await idle;
      expect(Object.values(agent.freeSockets).flat()).toHaveLength(1);
      // Leave the client alive. Server shutdown must drain its idle socket;
      // destroying the client first would hide the Node 18 teardown regression.
      await server.close();
      server = undefined;
    } finally {
      agent.destroy();
      await server?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
