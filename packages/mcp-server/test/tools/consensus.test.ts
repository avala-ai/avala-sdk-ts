import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerConsensusTools } from "../../src/tools/consensus.js";

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
    transport: { requestSingle: vi.fn() },
    consensus: { compute: vi.fn() },
  };
}

describe("consensus tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerConsensusTools(server as never, (() => avala) as never, true);
  });

  it("get_consensus_summary dispatches its declared route and returns structured JSON", async () => {
    const mockSummary = {
      meanScore: 0.89,
      medianScore: 0.91,
      minScore: 0.7,
      maxScore: 1,
      totalItems: 10,
      itemsWithConsensus: 8,
      scoreDistribution: { "0.8-1.0": 8 },
      byTaskName: [{ taskName: "label", meanScore: 0.89, count: 8 }],
    };
    avala.transport.requestSingle.mockResolvedValue(mockSummary);

    const handler = server.getHandler("get_consensus_summary")!;
    const result = await handler({ projectUid: "proj-1" });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/projects/proj-1/consensus/",
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      meanScore: 0.89,
      medianScore: 0.91,
      totalItems: 10,
      itemsWithConsensus: 8,
    });
    expect(parsed).not.toHaveProperty("scoreDistribution");
    expect(parsed).not.toHaveProperty("byTaskName");
    expect(result.structuredContent).toEqual(parsed);
  });

  it("compute_consensus calls avala.consensus.compute with projectUid and returns JSON", async () => {
    const mockResult = {
      projectUid: "proj-1",
      status: "completed",
      tasksProcessed: 42,
    };
    avala.consensus.compute.mockResolvedValue(mockResult);

    const handler = server.getHandler("compute_consensus")!;
    const result = await handler({ projectUid: "proj-1" });

    expect(avala.consensus.compute).toHaveBeenCalledWith("proj-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("completed");
    expect(parsed.tasksProcessed).toBe(42);
  });

  it("registers both get_consensus_summary and compute_consensus tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("get_consensus_summary")).toBeDefined();
    expect(server.getHandler("compute_consensus")).toBeDefined();
  });
});
