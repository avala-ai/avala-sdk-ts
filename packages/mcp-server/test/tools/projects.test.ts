import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerProjectTools } from "../../src/tools/projects.js";

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: { type: string; text: string }[] }>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
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
    datasets: { list: vi.fn(), get: vi.fn() },
    projects: {
      list: vi.fn(),
      get: vi.fn(),
      listMine: vi.fn(),
      getMine: vi.fn(),
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
    registerProjectTools(server as never, (() => avala) as never);
  });

  it("list_projects reads the caller's own projects and returns JSON", async () => {
    const mockPage = {
      items: [
        {
          uid: "proj-1",
          name: "Project 1",
          status: "active",
          ownerName: "acme",
          updatedAt: "2025-01-02T00:00:00Z",
          config: { hidden: true },
        },
      ],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.projects.listMine.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_projects")!;
    const result = await handler({});

    expect(avala.projects.listMine).toHaveBeenCalledWith({
      limit: 25,
      cursor: undefined,
    });
    expect(avala.projects.list).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0]).toMatchObject({
      uid: "proj-1",
      name: "Project 1",
      status: "active",
    });
    expect(parsed.items[0]).not.toHaveProperty("config");
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_cursor).toBeNull();
  });

  it("list_projects passes limit and cursor", async () => {
    avala.projects.listMine.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_projects")!;
    await handler({ limit: 10, cursor: "xyz" });

    expect(avala.projects.listMine).toHaveBeenCalledWith({
      limit: 10,
      cursor: "xyz",
    });
    expect(avala.projects.list).not.toHaveBeenCalled();
  });

  it("get_project reads a caller-scoped project and returns JSON", async () => {
    const mockProject = {
      uid: "proj-1",
      name: "Project 1",
      status: "active",
      createdAt: "2025-01-01",
      config: { hidden: true },
    };
    avala.projects.getMine.mockResolvedValue(mockProject);

    const handler = server.getHandler("get_project")!;
    const result = await handler({ uid: "proj-1" });

    expect(avala.projects.getMine).toHaveBeenCalledWith("proj-1");
    expect(avala.projects.get).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({
      uid: "proj-1",
      name: "Project 1",
      status: "active",
    });
    expect(parsed).not.toHaveProperty("config");
  });

  it("registers both list_projects and get_project tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_projects")).toBeDefined();
    expect(server.getHandler("get_project")).toBeDefined();
  });
});
