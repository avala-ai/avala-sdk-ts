import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerTaskTools } from "../../src/tools/tasks.js";

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
    tasks: { list: vi.fn(), get: vi.fn() },
  };
}

describe("task tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerTaskTools(server as never, avala as never);
  });

  it("list_tasks calls avala.tasks.list and returns JSON", async () => {
    const mockPage = {
      items: [{ uid: "task-1", status: "pending", projectUid: "proj-1" }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.tasks.list.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_tasks")!;
    const result = await handler({});

    expect(avala.tasks.list).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].uid).toBe("task-1");
  });

  it("list_tasks passes project, status, limit, and cursor", async () => {
    avala.tasks.list.mockResolvedValue({ items: [], nextCursor: null, previousCursor: null, hasMore: false });

    const handler = server.getHandler("list_tasks")!;
    await handler({ project: "proj-1", status: "active", limit: 10, cursor: "xyz" });

    expect(avala.tasks.list).toHaveBeenCalledWith({ project: "proj-1", status: "active", limit: 10, cursor: "xyz" });
  });

  it("get_task calls avala.tasks.get and returns JSON", async () => {
    const mockTask = { uid: "task-1", status: "active", projectUid: "proj-1", createdAt: "2025-01-01" };
    avala.tasks.get.mockResolvedValue(mockTask);

    const handler = server.getHandler("get_task")!;
    const result = await handler({ uid: "task-1" });

    expect(avala.tasks.get).toHaveBeenCalledWith("task-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("active");
    expect(parsed.projectUid).toBe("proj-1");
  });

  it("registers both list_tasks and get_task tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_tasks")).toBeDefined();
    expect(server.getHandler("get_task")).toBeDefined();
  });
});
