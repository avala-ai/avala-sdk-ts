import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerStatsTools } from "../../src/tools/stats.js";

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{
  structuredContent?: Record<string, unknown>;
  content: { type: string; text: string }[];
}>;

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
    projects: { list: vi.fn(), get: vi.fn(), listMine: vi.fn(), getMine: vi.fn() },
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
    registerStatsTools(server as never, (() => avala) as never);
  });

  it("get_workspace_stats probes datasets.list, projects.listMine, and exports.list", async () => {
    avala.datasets.list.mockResolvedValue({
      items: [{ uid: "ds-1" }],
      hasMore: true,
    });
    avala.projects.listMine.mockResolvedValue({
      items: [{ uid: "proj-1" }],
      hasMore: false,
    });
    avala.exports.list.mockResolvedValue({
      items: [{ uid: "exp-1" }],
      hasMore: false,
    });

    const handler = server.getHandler("get_workspace_stats")!;
    const result = await handler({});

    expect(avala.datasets.list).toHaveBeenCalledWith({ limit: 1 });
    expect(avala.projects.listMine).toHaveBeenCalledWith({ limit: 1 });
    expect(avala.projects.list).not.toHaveBeenCalled();
    expect(avala.exports.list).toHaveBeenCalledWith({ limit: 1 });

    const parsed = JSON.parse(result.content[0].text);
    expect(result.structuredContent).toEqual(parsed);
    expect(parsed.datasets).toEqual({
      count: null,
      minimumCount: 2,
      countStatus: "lower_bound",
      hasMore: true,
    });
    expect(parsed.projects.count).toBe(1);
    expect(parsed.projects.countStatus).toBe("exact");
    expect(parsed.exports.count).toBe(1);
  });

  it("registers get_workspace_stats", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(1);
    expect(server.getHandler("get_workspace_stats")).toBeDefined();
  });

  it("returns aggregated stats structure", async () => {
    avala.datasets.list.mockResolvedValue({
      items: [{ uid: "ds-1" }],
      hasMore: true,
    });
    avala.projects.listMine.mockResolvedValue({
      items: [{ uid: "proj-1" }],
      hasMore: true,
    });
    avala.exports.list.mockResolvedValue({
      items: [{ uid: "exp-1" }],
      hasMore: true,
    });

    const handler = server.getHandler("get_workspace_stats")!;
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveProperty("datasets");
    expect(parsed).toHaveProperty("projects");
    expect(parsed).toHaveProperty("exports");
    expect(parsed.datasets).toHaveProperty("count");
    expect(parsed.datasets).toHaveProperty("minimumCount");
    expect(parsed.datasets).toHaveProperty("countStatus");
    expect(parsed.datasets).toHaveProperty("hasMore");
  });

  it("handles empty workspace", async () => {
    avala.datasets.list.mockResolvedValue({ items: [], hasMore: false });
    avala.projects.listMine.mockResolvedValue({ items: [], hasMore: false });
    avala.exports.list.mockResolvedValue({ items: [], hasMore: false });

    const handler = server.getHandler("get_workspace_stats")!;
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.datasets.count).toBe(0);
    expect(parsed.datasets.minimumCount).toBe(0);
    expect(parsed.datasets.countStatus).toBe("exact");
    expect(parsed.datasets.hasMore).toBe(false);
    expect(parsed.projects.count).toBe(0);
    expect(parsed.exports.count).toBe(0);
  });

  it("never presents a one-row cursor probe as an exact total", async () => {
    const partial = {
      items: [{ uid: "first" }],
      hasMore: true,
    };
    avala.datasets.list.mockResolvedValue(partial);
    avala.projects.listMine.mockResolvedValue(partial);
    avala.exports.list.mockResolvedValue(partial);

    const result = await server.getHandler("get_workspace_stats")!({});
    const parsed = JSON.parse(result.content[0].text);

    for (const resource of ["datasets", "projects", "exports"] as const) {
      expect(parsed[resource].count).toBeNull();
      expect(parsed[resource].minimumCount).toBe(2);
      expect(parsed[resource].countStatus).toBe("lower_bound");
    }
    expect(JSON.stringify(parsed)).not.toContain('"count": 1');
  });
});
