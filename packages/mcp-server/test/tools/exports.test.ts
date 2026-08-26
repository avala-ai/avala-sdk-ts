import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerExportTools } from "../../src/tools/exports.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn(
      (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    ),
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    ),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    transport: { requestPage: vi.fn(), requestSingle: vi.fn() },
    exports: {
      create: vi.fn(),
    },
  };
}

const EXPORT = {
  uid: "exp-1",
  name: "Warehouse labels",
  format: "avala-json-external",
  filterQueryString: null,
  totalTaskCount: 20,
  exportedTaskCount: 20,
  downloadUrl: "https://downloads.example.com/export.json",
  status: "exported",
  datasets: ["ds-1"],
  slices: [],
  projects: ["proj-1"],
  createdAt: "2026-08-24T00:00:00Z",
};

describe("export tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    avala.transport.requestPage.mockResolvedValue({
      items: [EXPORT],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });
    avala.transport.requestSingle.mockResolvedValue(EXPORT);
    registerExportTools(server as never, (() => avala) as never, true);
  });

  it("create_export with project calls avala.exports.create", async () => {
    const mockExport = { uid: "exp-1", status: "pending", downloadUrl: null };
    avala.exports.create.mockResolvedValue(mockExport);

    const handler = server.getHandler("create_export")!;
    const result = await handler({ project: "proj-1" });

    expect(avala.exports.create).toHaveBeenCalledWith({
      project: "proj-1",
      dataset: undefined,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("pending");
  });

  it("create_export with dataset calls avala.exports.create", async () => {
    const mockExport = { uid: "exp-2", status: "pending", downloadUrl: null };
    avala.exports.create.mockResolvedValue(mockExport);

    const handler = server.getHandler("create_export")!;
    const result = await handler({ dataset: "ds-1" });

    expect(avala.exports.create).toHaveBeenCalledWith({
      project: undefined,
      dataset: "ds-1",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe("exp-2");
  });

  it("list_exports dispatches its exact route and filters", async () => {
    const handler = server.getHandler("list_exports")!;
    const result = await handler({ limit: 10, cursor: "next-page" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/exports/", {
      limit: "10",
      cursor: "next-page",
    });
    expect(result.structuredContent).toEqual({
      items: [EXPORT],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual(
      result.structuredContent,
    );
  });

  it("get_export_status dispatches its exact route and returns structured output", async () => {
    const handler = server.getHandler("get_export_status")!;
    const result = await handler({ uid: "exp-1" });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/exports/exp-1/",
    );
    expect(result.structuredContent).toEqual(EXPORT);
    expect(JSON.parse(result.content[0]!.text)).toEqual(EXPORT);
  });

  it("get_export_status strips unknown fields and redacts nested organization credentials", async () => {
    avala.transport.requestSingle.mockResolvedValueOnce({
      ...EXPORT,
      organization: {
        uid: "org-1",
        apiKey: "FAKE-status-api-key",
      },
      unexpected: "must be stripped",
    });

    const result = await server.getHandler("get_export_status")!({
      uid: "exp-1",
    });

    expect(result.structuredContent).not.toHaveProperty("unexpected");
    expect(result.structuredContent?.organization).toEqual({
      uid: "org-1",
      apiKey: "[redacted]",
    });
    expect(result.content[0]!.text).not.toContain("FAKE-status-api-key");
  });

  it("preserves session organization metadata without leaking nested credentials", async () => {
    avala.transport.requestPage.mockResolvedValueOnce({
      items: [
        {
          ...EXPORT,
          organization: {
            uid: "org-1",
            name: "Robotics",
            apiKey: "FAKE-not-a-real-api-key",
          },
          unexpected: "must be stripped",
        },
      ],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const result = await server.getHandler("list_exports")!({});
    const item = (
      result.structuredContent as { items: Record<string, unknown>[] }
    ).items[0]!;

    expect(item).not.toHaveProperty("unexpected");
    expect(item.organization).toEqual({
      uid: "org-1",
      name: "Robotics",
      apiKey: "[redacted]",
    });
    expect(result.content[0]!.text).not.toContain("FAKE-not-a-real-api-key");
  });

  it("registers create_export, list_exports, and get_export_status tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(3);
    expect(server.getHandler("create_export")).toBeDefined();
    expect(server.getHandler("list_exports")).toBeDefined();
    expect(server.getHandler("get_export_status")).toBeDefined();
  });

  it("does not register export creation in read-only mode", () => {
    const readOnlyServer = createMockServer();
    registerExportTools(readOnlyServer as never, (() => avala) as never, false);

    expect(readOnlyServer.registerTool).toHaveBeenCalledTimes(2);
    expect(readOnlyServer.getHandler("create_export")).toBeUndefined();
    expect(readOnlyServer.getHandler("list_exports")).toBeDefined();
    expect(readOnlyServer.getHandler("get_export_status")).toBeDefined();
  });
});
