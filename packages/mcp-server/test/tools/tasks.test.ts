import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerTaskTools } from "../../src/tools/tasks.js";

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
  };
}

const MOCK_TASK = {
  uid: "task-1",
  type: "image_classification",
  name: "Review frame",
  status: "active",
  project: "proj-1",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-02T00:00:00Z",
};

describe("task tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerTaskTools(server as never, (() => avala) as never);
  });

  it("list_tasks dispatches its declared route and returns structured JSON", async () => {
    const mockPage = {
      items: [MOCK_TASK],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_tasks")!;
    const result = await handler({});

    expect(avala.transport.requestPage).toHaveBeenCalledWith(
      "/tasks/",
      undefined,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].uid).toBe("task-1");
    expect(result.structuredContent).toEqual(mockPage);
  });

  it("list_tasks passes project, status, limit, and cursor", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_tasks")!;
    await handler({
      project: "proj-1",
      status: "active",
      limit: 10,
      cursor: "xyz",
    });

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/tasks/", {
      project: "proj-1",
      status: "active",
      limit: "10",
      cursor: "xyz",
    });
  });

  it("get_task dispatches its declared detail route", async () => {
    avala.transport.requestSingle.mockResolvedValue(MOCK_TASK);

    const handler = server.getHandler("get_task")!;
    const result = await handler({ uid: "task-1" });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/tasks/task-1/",
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("active");
    expect(parsed.project).toBe("proj-1");
  });

  it("registers both list_tasks and get_task tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_tasks")).toBeDefined();
    expect(server.getHandler("get_task")).toBeDefined();
  });
});
