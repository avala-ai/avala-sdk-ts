import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerProjectTools } from "../../src/tools/projects.js";

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
    projects: {
      list: vi.fn(),
      get: vi.fn(),
    },
    exports: { list: vi.fn(), get: vi.fn(), create: vi.fn() },
    tasks: { list: vi.fn(), get: vi.fn() },
  };
}

describe("project tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerProjectTools(server as never, avala as never);
  });

  it("list_projects calls avala.projects.list and returns JSON", async () => {
    const mockPage = {
      items: [{ uid: "proj-1", name: "Project 1", status: "active" }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.projects.list.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_projects")!;
    const result = await handler({});

    expect(avala.projects.list).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].name).toBe("Project 1");
  });

  it("list_projects passes limit and cursor", async () => {
    avala.projects.list.mockResolvedValue({ items: [], nextCursor: null, previousCursor: null, hasMore: false });

    const handler = server.getHandler("list_projects")!;
    await handler({ limit: 10, cursor: "xyz" });

    expect(avala.projects.list).toHaveBeenCalledWith({ limit: 10, cursor: "xyz" });
  });

  it("get_project calls avala.projects.get and returns JSON", async () => {
    const mockProject = { uid: "proj-1", name: "Project 1", status: "active", createdAt: "2025-01-01" };
    avala.projects.get.mockResolvedValue(mockProject);

    const handler = server.getHandler("get_project")!;
    const result = await handler({ uid: "proj-1" });

    expect(avala.projects.get).toHaveBeenCalledWith("proj-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("active");
  });

  it("registers both list_projects and get_project tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_projects")).toBeDefined();
    expect(server.getHandler("get_project")).toBeDefined();
  });
});
