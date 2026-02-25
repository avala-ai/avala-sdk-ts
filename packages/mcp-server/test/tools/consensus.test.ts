import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerConsensusTools } from "../../src/tools/consensus.js";

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
    consensus: { getSummary: vi.fn(), compute: vi.fn() },
  };
}

describe("consensus tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerConsensusTools(server as never, avala as never, true);
  });

  it("get_consensus_summary calls avala.consensus.getSummary with projectUid and returns JSON", async () => {
    const mockSummary = {
      projectUid: "proj-1",
      meanScore: 0.89,
      medianScore: 0.91,
      distribution: { high: 50, medium: 30, low: 20 },
    };
    avala.consensus.getSummary.mockResolvedValue(mockSummary);

    const handler = server.getHandler("get_consensus_summary")!;
    const result = await handler({ projectUid: "proj-1" });

    expect(avala.consensus.getSummary).toHaveBeenCalledWith("proj-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.meanScore).toBe(0.89);
    expect(parsed.medianScore).toBe(0.91);
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
    expect(server.tool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("get_consensus_summary")).toBeDefined();
    expect(server.getHandler("compute_consensus")).toBeDefined();
  });
});
