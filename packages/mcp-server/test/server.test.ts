import { describe, it, expect, vi } from "vitest";
import { registerTools } from "../src/server.js";

/**
 * The full catalog size with mutations enabled. The hosted (HTTP) transport
 * registers tools through the same `registerTools`, so this count is the
 * stdio/HTTP parity baseline: if it moves, both transports moved together.
 */
const FULL_TOOL_COUNT = 61;

function createMockServer() {
  const names: string[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const register = (name: string, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
    names.push(name);
    handlers.set(name, handler);
  };
  return {
    names,
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      register(name, handler);
    }),
    registerTool: vi.fn((name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      register(name, handler);
    }),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

describe("MCP server", () => {
  it("registers the full catalog (61 tools) when mutations are enabled", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, { allowMutations: true });
    expect(server.names).toHaveLength(FULL_TOOL_COUNT);
    expect(new Set(server.names).size).toBe(FULL_TOOL_COUNT);
  });

  it("registers a strict subset in read-only mode (default)", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never);
    expect(server.names.length).toBeGreaterThan(0);
    expect(server.names.length).toBeLessThan(FULL_TOOL_COUNT);
  });

  it("does not call getClient at registration time", () => {
    const server = createMockServer();
    const getClient = vi.fn(() => ({}));
    registerTools(server as never, getClient as never, { allowMutations: true });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("resolves the client per invocation, not per registration", async () => {
    const server = createMockServer();
    const page = (uid: string) => ({
      items: [{ uid, name: uid, slug: uid, itemCount: 0, dataType: "image" }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });
    const clientA = { transport: { requestPage: vi.fn().mockResolvedValue(page("from-a")) } };
    const clientB = { transport: { requestPage: vi.fn().mockResolvedValue(page("from-b")) } };
    let current: unknown = clientA;
    const getClient = vi.fn(() => current);
    registerTools(server as never, getClient as never, { allowMutations: false });

    const handler = server.getHandler("list_datasets")!;

    const first = (await handler({})) as { content: { text: string }[] };
    expect(first.content[0]!.text).toContain("from-a");

    // Swap the client between calls — the tool must pick up the new one,
    // proving it never captured a client at registration time.
    current = clientB;
    const second = (await handler({})) as { content: { text: string }[] };
    expect(second.content[0]!.text).toContain("from-b");

    expect(clientA.transport.requestPage).toHaveBeenCalledTimes(1);
    expect(clientB.transport.requestPage).toHaveBeenCalledTimes(1);
    expect(getClient).toHaveBeenCalledTimes(2);
    expect(getClient).toHaveBeenNthCalledWith(1, "list_datasets");
    expect(getClient).toHaveBeenNthCalledWith(2, "list_datasets");
  });
});
