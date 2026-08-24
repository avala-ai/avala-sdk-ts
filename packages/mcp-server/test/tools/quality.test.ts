import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerQualityTools } from "../../src/tools/quality.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    transport: { requestPage: vi.fn() },
    qualityTargets: { evaluate: vi.fn() },
  };
}

const MOCK_QUALITY_TARGET = {
  uid: "qt-1",
  name: "Accuracy Target",
  metric: "acceptance_rate",
  operator: "gte",
  threshold: 0.95,
  severity: "warning",
  isActive: true,
  notifyWebhook: true,
  notifyEmails: ["quality@example.com"],
  lastEvaluatedAt: "2025-01-01T00:00:00Z",
  lastValue: 0.97,
  isBreached: false,
  breachCount: 0,
  lastBreachedAt: null,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-02T00:00:00Z",
};

describe("quality tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerQualityTools(server as never, (() => avala) as never, true);
  });

  it("list_quality_targets dispatches its declared route and returns structured JSON", async () => {
    const mockPage = {
      items: [MOCK_QUALITY_TARGET],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_quality_targets")!;
    const result = await handler({ projectUid: "proj-1" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/projects/proj-1/quality-targets/", undefined);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].name).toBe("Accuracy Target");
    expect(result.structuredContent).toEqual(mockPage);
  });

  it("list_quality_targets passes limit and cursor", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_quality_targets")!;
    await handler({ projectUid: "proj-1", limit: 10, cursor: "abc" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/projects/proj-1/quality-targets/", {
      limit: "10",
      cursor: "abc",
    });
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
    expect(server.registerTool).toHaveBeenCalledTimes(1);
    expect(server.tool).toHaveBeenCalledTimes(1);
    expect(server.getHandler("list_quality_targets")).toBeDefined();
    expect(server.getHandler("evaluate_quality")).toBeDefined();
  });
});
