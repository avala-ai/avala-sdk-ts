import { AvalaError, RateLimitError } from "@avala-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerStaffTools } from "../../src/tools/staff.js";
import type { McpServerOptions } from "../../src/server.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  const configs = new Map<string, Record<string, unknown>>();
  return {
    handlers,
    configs,
    registerTool: vi.fn(
      (name: string, config: Record<string, unknown>, handler: ToolHandler) => {
        handlers.set(name, handler);
        configs.set(name, config);
        return { remove: vi.fn() };
      },
    ),
  };
}

function createMockAvala(response: unknown | (() => unknown)) {
  const request = vi.fn(async (..._args: unknown[]) =>
    typeof response === "function" ? (response as () => unknown)() : response,
  );
  return { avala: { transport: { request } }, request };
}

const SANDBOX_OK = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    content: [{ type: "text", text: '{"rows": []}' }],
  },
};

function register(
  server: ReturnType<typeof createMockServer>,
  avala: unknown,
  options: McpServerOptions = { allowMutations: false },
): void {
  registerStaffTools(server as never, (() => avala) as never, options);
}

describe("staff sandbox proxies", () => {
  it("registers the three proxies with staff toolset metadata and read-only annotations", () => {
    const server = createMockServer();
    register(server, createMockAvala(SANDBOX_OK).avala);

    expect([...server.handlers.keys()].sort()).toEqual([
      "staff_aggregate",
      "staff_describe_table",
      "staff_query",
    ]);
    for (const [name, config] of server.configs) {
      const meta = config._meta as Record<string, unknown>;
      expect(meta["avala.ai/toolset"], name).toBe("staff");
      expect(meta["avala.ai/required-scopes"], name).toEqual(["mcp.query"]);
      const annotations = config.annotations as Record<string, unknown>;
      expect(annotations.readOnlyHint, name).toBe(true);
      expect(annotations.destructiveHint, name).toBe(false);
    }
  });

  it("forwards a query as a JSON-RPC tools/call envelope to POST /mcp/", async () => {
    const server = createMockServer();
    const { avala, request } = createMockAvala(SANDBOX_OK);
    register(server, avala);

    const result = await server.handlers.get("staff_query")!({
      sql: "SELECT id FROM dataset_dataset WHERE visibility = %s",
      params: ["public"],
      limit: 5,
    });

    expect(request).toHaveBeenCalledWith("POST", "/mcp/", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "query",
          arguments: {
            sql: "SELECT id FROM dataset_dataset WHERE visibility = %s",
            params: ["public"],
            limit: 5,
          },
        },
      },
    });
    expect(result).toEqual({
      content: [{ type: "text", text: '{"rows": []}' }],
    });
  });

  it("maps proxy names onto the sandbox tool names", async () => {
    const server = createMockServer();
    const { avala, request } = createMockAvala(SANDBOX_OK);
    register(server, avala);

    await server.handlers.get("staff_describe_table")!({
      table_name: "task_task",
    });
    await server.handlers.get("staff_aggregate")!({
      table_name: "task_task",
      aggregation: "count",
    });

    const forwardedNames = request.mock.calls.map(
      (call) =>
        (call[2] as { json: { params: { name: string } } }).json.params.name,
    );
    expect(forwardedNames).toEqual(["describe_table", "aggregate"]);
  });

  it("passes through a sandbox tool failure as an isError result", async () => {
    const server = createMockServer();
    const { avala } = createMockAvala({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "Error: table not allowed" }],
        isError: true,
      },
    });
    register(server, avala);

    const result = await server.handlers.get("staff_describe_table")!({
      table_name: "django_session",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("table not allowed");
  });

  it("turns a JSON-RPC protocol error into an isError result", async () => {
    const server = createMockServer();
    const { avala } = createMockAvala({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
    register(server, avala);

    const result = await server.handlers.get("staff_query")!({
      sql: "SELECT 1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Method not found");
  });

  it("fails closed on a response that is not the documented envelope", async () => {
    const server = createMockServer();
    const { avala } = createMockAvala({ unexpected: true });
    register(server, avala);

    const result = await server.handlers.get("staff_query")!({
      sql: "SELECT 1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("invalid response");
  });

  it("accepts the sandbox's own filter shapes, including value-less IS NULL", () => {
    const server = createMockServer();
    register(server, createMockAvala(SANDBOX_OK).avala);
    const shape = server.configs.get("staff_aggregate")!
      .inputSchema as z.ZodRawShape;
    const parsed = z.object(shape).safeParse({
      table_name: "dataset_dataset",
      aggregation: "count",
      filters: [{ column: "organization_id", operator: "IS NULL" }],
    });
    expect(parsed.success).toBe(true);
    for (const [name, config] of server.configs) {
      for (const [field, schema] of Object.entries(
        config.inputSchema as z.ZodRawShape,
      )) {
        expect(schema.description, `${name}.${field}`).toBeTruthy();
      }
    }
  });

  it("treats `error: null` beside a result as success, not a rejection", async () => {
    const server = createMockServer();
    const { avala } = createMockAvala({ ...SANDBOX_OK, error: null });
    register(server, avala);

    const result = await server.handlers.get("staff_query")!({
      sql: "SELECT 1",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe('{"rows": []}');
  });

  it("surfaces the sandbox's own throttle message and Retry-After", async () => {
    const server = createMockServer();
    const { avala } = createMockAvala(() => {
      throw new RateLimitError(
        "HTTP 429",
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Query rate limit exceeded. Please wait 12.3 seconds.",
          },
          id: 1,
        },
        13,
      );
    });
    register(server, avala);

    const result = await server.handlers.get("staff_query")!({
      sql: "SELECT 1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Please wait 12.3 seconds");
    expect(result.content[0]!.text).toContain("retry after 13s");
  });

  it("does not repeat a SDK error whose body carries no sandbox message", async () => {
    const server = createMockServer();
    const { avala } = createMockAvala(() => {
      throw new AvalaError("HTTP 403", 403, { detail: "Forbidden" });
    });
    register(server, avala);

    const result = await server.handlers.get("staff_query")!({
      sql: "SELECT 1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      "Error: staff sandbox call failed: HTTP 403",
    );
  });

  it("returns an isError result when the transport itself fails", async () => {
    const server = createMockServer();
    const { avala } = createMockAvala(() => {
      throw new Error("HTTP 429");
    });
    register(server, avala);

    const result = await server.handlers.get("staff_query")!({
      sql: "SELECT 1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("HTTP 429");
  });

  it("refuses to forward for a hosted grant without staff privilege", async () => {
    const server = createMockServer();
    const { avala, request } = createMockAvala(SANDBOX_OK);
    register(server, avala, {
      allowMutations: false,
      credentialGrant: {
        scopes: new Set(["mcp.query"]),
        toolsets: new Set(["staff"]),
        isStaffPrivileged: false,
      },
    });

    const result = await server.handlers.get("staff_query")!({
      sql: "SELECT 1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not staff-privileged");
    expect(request).not.toHaveBeenCalled();
  });

  it("forwards for a staff-privileged hosted grant and for stdio (no grant)", async () => {
    for (const options of [
      { allowMutations: false },
      {
        allowMutations: false,
        credentialGrant: {
          scopes: new Set(["mcp.query"]),
          toolsets: new Set(["staff"]),
          isStaffPrivileged: true,
        },
      },
    ] satisfies McpServerOptions[]) {
      const server = createMockServer();
      const { avala, request } = createMockAvala(SANDBOX_OK);
      register(server, avala, options);

      const result = await server.handlers.get("staff_query")!({
        sql: "SELECT 1",
      });
      expect(result.isError).toBeUndefined();
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
});
