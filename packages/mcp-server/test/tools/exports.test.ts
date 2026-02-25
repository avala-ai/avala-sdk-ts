import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerExportTools } from "../../src/tools/exports.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    datasets: { list: vi.fn(), get: vi.fn() },
    projects: { list: vi.fn(), get: vi.fn() },
    exports: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
    },
    tasks: { list: vi.fn(), get: vi.fn() },
  };
}

describe("export tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerExportTools(server as never, avala as never, true);
  });

  it("create_export with project calls avala.exports.create", async () => {
    const mockExport = { uid: "exp-1", status: "pending", downloadUrl: null };
    avala.exports.create.mockResolvedValue(mockExport);

    const handler = server.getHandler("create_export")!;
    const result = await handler({ project: "proj-1" });

    expect(avala.exports.create).toHaveBeenCalledWith({ project: "proj-1", dataset: undefined });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("pending");
  });

  it("create_export with dataset calls avala.exports.create", async () => {
    const mockExport = { uid: "exp-2", status: "pending", downloadUrl: null };
    avala.exports.create.mockResolvedValue(mockExport);

    const handler = server.getHandler("create_export")!;
    const result = await handler({ dataset: "ds-1" });

    expect(avala.exports.create).toHaveBeenCalledWith({ project: undefined, dataset: "ds-1" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe("exp-2");
  });

  it("list_exports calls avala.exports.list and returns JSON", async () => {
    const mockPage = {
      items: [{ uid: "exp-1", status: "completed", downloadUrl: "https://example.com/dl" }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.exports.list.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_exports")!;
    const result = await handler({});

    expect(avala.exports.list).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].status).toBe("completed");
  });

  it("get_export_status calls avala.exports.get and returns JSON", async () => {
    const mockExport = { uid: "exp-1", status: "processing", downloadUrl: null };
    avala.exports.get.mockResolvedValue(mockExport);

    const handler = server.getHandler("get_export_status")!;
    const result = await handler({ uid: "exp-1" });

    expect(avala.exports.get).toHaveBeenCalledWith("exp-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("processing");
  });

  it("registers create_export, list_exports, and get_export_status tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(3);
    expect(server.getHandler("create_export")).toBeDefined();
    expect(server.getHandler("list_exports")).toBeDefined();
    expect(server.getHandler("get_export_status")).toBeDefined();
  });
});
