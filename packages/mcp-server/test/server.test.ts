import { describe, it, expect, vi } from "vitest";
import toolsetScopes from "../toolset-scopes.json";
import { registerTools } from "../src/server.js";
import {
  scopeServerForCredential,
  type CredentialToolGrant,
} from "../src/visibility.js";

/**
 * The full catalog size with mutations enabled. The hosted (HTTP) transport
 * registers tools through the same `registerTools`, so this count is the
 * stdio/HTTP parity baseline: if it moves, both transports moved together.
 */
const FULL_TOOL_COUNT = 61;
const HOSTED_READ_TOOL_COUNT = 44;

function fullCredentialGrant(): CredentialToolGrant {
  return {
    scopes: new Set(Object.values(toolsetScopes).flat()),
    toolsets: new Set(Object.keys(toolsetScopes)),
  };
}

function createMockServer() {
  const names: string[] = [];
  const handlers = new Map<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  >();
  const register = (
    name: string,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ) => {
    names.push(name);
    handlers.set(name, handler);
    return {
      remove: () => {
        const index = names.indexOf(name);
        if (index >= 0) names.splice(index, 1);
        handlers.delete(name);
      },
    };
  };
  return {
    names,
    registerTool: vi.fn(
      (
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        return register(name, handler);
      },
    ),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

describe("MCP server", () => {
  it("registers the full catalog (61 tools) when mutations are enabled", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: true,
    });
    expect(server.names).toHaveLength(FULL_TOOL_COUNT);
    expect(new Set(server.names).size).toBe(FULL_TOOL_COUNT);
  });

  it("registers a strict subset in read-only mode (default)", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never);
    expect(server.names.length).toBeGreaterThan(0);
    expect(server.names.length).toBeLessThan(FULL_TOOL_COUNT);
  });

  it("registers the complete hosted read catalog for a fully eligible credential", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: fullCredentialGrant(),
    });
    expect(server.names).toHaveLength(HOSTED_READ_TOOL_COUNT);
    expect(new Set(server.names).size).toBe(HOSTED_READ_TOOL_COUNT);
  });

  it("filters declarative reads by exact scope and toolset", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: {
        scopes: new Set(["datasets.read"]),
        toolsets: new Set(["datasets", "quality", "sequences"]),
      },
    });

    expect(server.names).toContain("list_datasets");
    expect(server.names).toContain("list_sequences");
    expect(server.names).toContain("get_frame");
    expect(server.names).toContain("get_calibration");
    expect(server.names).toContain("get_result_acceptance");
    expect(server.names).not.toContain("list_projects");
    expect(server.names).not.toContain("list_quality_targets");
    expect(server.names).not.toContain("get_project_quality_summary");
    expect(server.names).not.toContain("get_workspace_overview");
  });

  it("exposes no authenticated tools for an empty credential grant", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: {
        scopes: new Set(),
        toolsets: new Set(["docs", "public"]),
      },
    });
    expect(server.names).toEqual([]);
  });

  it("fails closed when a hosted registration lacks a visibility contract", () => {
    const scoped = scopeServerForCredential(
      createMockServer() as never,
      fullCredentialGrant(),
    );

    expect(() =>
      scoped.registerTool("missing_metadata", {}, async () => ({
        content: [],
      })),
    ).toThrow("missing authorization metadata");
  });

  it("refuses credential-scoped mutations until confirmation support exists", () => {
    const server = createMockServer();
    expect(() =>
      registerTools(server as never, (() => ({})) as never, {
        allowMutations: true,
        credentialGrant: fullCredentialGrant(),
      }),
    ).toThrow("cannot expose mutations before confirmation support exists");
    expect(server.names).toEqual([]);
  });

  it("does not call getClient at registration time", () => {
    const server = createMockServer();
    const getClient = vi.fn(() => ({}));
    registerTools(server as never, getClient as never, {
      allowMutations: true,
    });
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
    const clientA = {
      transport: { requestPage: vi.fn().mockResolvedValue(page("from-a")) },
    };
    const clientB = {
      transport: { requestPage: vi.fn().mockResolvedValue(page("from-b")) },
    };
    let current: unknown = clientA;
    const getClient = vi.fn(() => current);
    registerTools(server as never, getClient as never, {
      allowMutations: false,
    });

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
