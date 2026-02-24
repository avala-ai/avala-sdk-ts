import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerQualityTools } from "../../src/tools/quality.js";

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
    qualityTargets: { list: vi.fn(), evaluate: vi.fn() },
  };
}

describe("quality tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerQualityTools(server as never, avala as never);
  });

  it("list_quality_targets calls avala.qualityTargets.list with projectUid and returns JSON", async () => {
    const mockPage = {
      items: [{ uid: "qt-1", name: "Accuracy Target", threshold: 0.95 }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.qualityTargets.list.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_quality_targets")!;
    const result = await handler({ projectUid: "proj-1" });

    expect(avala.qualityTargets.list).toHaveBeenCalledWith("proj-1", { limit: undefined, cursor: undefined });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].name).toBe("Accuracy Target");
  });

  it("list_quality_targets passes limit and cursor", async () => {
    avala.qualityTargets.list.mockResolvedValue({ items: [], nextCursor: null, previousCursor: null, hasMore: false });

    const handler = server.getHandler("list_quality_targets")!;
    await handler({ projectUid: "proj-1", limit: 10, cursor: "abc" });

    expect(avala.qualityTargets.list).toHaveBeenCalledWith("proj-1", { limit: 10, cursor: "abc" });
  });

  it("evaluate_quality calls avala.qualityTargets.evaluate with projectUid and returns JSON", async () => {
    const mockEvaluations = [
      { uid: "qt-1", name: "Accuracy Target", status: "passing", score: 0.97 },
      { uid: "qt-2", name: "Recall Target", status: "failing", score: 0.82 },
    ];
    avala.qualityTargets.evaluate.mockResolvedValue(mockEvaluations);

    const handler = server.getHandler("evaluate_quality")!;
    const result = await handler({ projectUid: "proj-1" });

    expect(avala.qualityTargets.evaluate).toHaveBeenCalledWith("proj-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].status).toBe("passing");
    expect(parsed[1].status).toBe("failing");
  });

  it("registers both list_quality_targets and evaluate_quality tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_quality_targets")).toBeDefined();
    expect(server.getHandler("evaluate_quality")).toBeDefined();
  });
});
