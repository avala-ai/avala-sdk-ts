import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerStatsTools } from "../../src/tools/stats.js";

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
    exports: { list: vi.fn(), get: vi.fn(), create: vi.fn() },
    tasks: { list: vi.fn(), get: vi.fn() },
  };
}

describe("stats tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerStatsTools(server as never, avala as never);
  });

  it("get_workspace_stats calls datasets.list, projects.list, and exports.list", async () => {
    avala.datasets.list.mockResolvedValue({ items: [{ uid: "ds-1" }], hasMore: true });
    avala.projects.list.mockResolvedValue({ items: [{ uid: "proj-1" }], hasMore: false });
    avala.exports.list.mockResolvedValue({ items: [{ uid: "exp-1" }], hasMore: false });

    const handler = server.getHandler("get_workspace_stats")!;
    const result = await handler({});

    expect(avala.datasets.list).toHaveBeenCalledWith({ limit: 1 });
    expect(avala.projects.list).toHaveBeenCalledWith({ limit: 1 });
    expect(avala.exports.list).toHaveBeenCalledWith({ limit: 1 });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.datasets.count).toBe(1);
    expect(parsed.datasets.hasMore).toBe(true);
    expect(parsed.projects.count).toBe(1);
    expect(parsed.exports.count).toBe(1);
  });

  it("returns aggregated stats structure", async () => {
    avala.datasets.list.mockResolvedValue({ items: [{ uid: "ds-1" }], hasMore: true });
    avala.projects.list.mockResolvedValue({ items: [{ uid: "proj-1" }], hasMore: true });
    avala.exports.list.mockResolvedValue({ items: [{ uid: "exp-1" }], hasMore: true });

    const handler = server.getHandler("get_workspace_stats")!;
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveProperty("datasets");
    expect(parsed).toHaveProperty("projects");
    expect(parsed).toHaveProperty("exports");
    expect(parsed.datasets).toHaveProperty("count");
    expect(parsed.datasets).toHaveProperty("hasMore");
  });

  it("handles empty workspace", async () => {
    avala.datasets.list.mockResolvedValue({ items: [], hasMore: false });
    avala.projects.list.mockResolvedValue({ items: [], hasMore: false });
    avala.exports.list.mockResolvedValue({ items: [], hasMore: false });

    const handler = server.getHandler("get_workspace_stats")!;
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.datasets.count).toBe(0);
    expect(parsed.datasets.hasMore).toBe(false);
    expect(parsed.projects.count).toBe(0);
    expect(parsed.exports.count).toBe(0);
  });
});
