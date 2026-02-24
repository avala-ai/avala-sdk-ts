import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerAgentTools } from "../../src/tools/agents.js";

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
    agents: { list: vi.fn(), get: vi.fn(), create: vi.fn(), delete: vi.fn() },
  };
}

describe("agent tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerAgentTools(server as never, avala as never);
  });

  it("list_agents calls avala.agents.list and returns JSON", async () => {
    const mockPage = {
      items: [{ uid: "agent-1", name: "My Agent", events: ["task.completed"] }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.agents.list.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_agents")!;
    const result = await handler({});

    expect(avala.agents.list).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].name).toBe("My Agent");
  });

  it("list_agents passes limit and cursor", async () => {
    avala.agents.list.mockResolvedValue({ items: [], nextCursor: null, previousCursor: null, hasMore: false });

    const handler = server.getHandler("list_agents")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.agents.list).toHaveBeenCalledWith({ limit: 5, cursor: "abc" });
  });

  it("get_agent calls avala.agents.get and returns JSON", async () => {
    const mockAgent = { uid: "agent-1", name: "My Agent", events: ["task.completed"], callbackUrl: "https://example.com/hook" };
    avala.agents.get.mockResolvedValue(mockAgent);

    const handler = server.getHandler("get_agent")!;
    const result = await handler({ uid: "agent-1" });

    expect(avala.agents.get).toHaveBeenCalledWith("agent-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("My Agent");
    expect(parsed.callbackUrl).toBe("https://example.com/hook");
  });

  it("create_agent calls avala.agents.create with all params and returns JSON", async () => {
    const mockAgent = { uid: "agent-2", name: "New Agent", events: ["task.created"], callbackUrl: "https://example.com/cb" };
    avala.agents.create.mockResolvedValue(mockAgent);

    const handler = server.getHandler("create_agent")!;
    const result = await handler({
      name: "New Agent",
      events: ["task.created"],
      callbackUrl: "https://example.com/cb",
      description: "A test agent",
      project: "proj-1",
      taskTypes: ["annotation"],
    });

    expect(avala.agents.create).toHaveBeenCalledWith({
      name: "New Agent",
      events: ["task.created"],
      callbackUrl: "https://example.com/cb",
      description: "A test agent",
      project: "proj-1",
      taskTypes: ["annotation"],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe("agent-2");
    expect(parsed.name).toBe("New Agent");
  });

  it("delete_agent calls avala.agents.delete and returns success", async () => {
    avala.agents.delete.mockResolvedValue(undefined);

    const handler = server.getHandler("delete_agent")!;
    const result = await handler({ uid: "agent-1" });

    expect(avala.agents.delete).toHaveBeenCalledWith("agent-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe("Agent agent-1 deleted.");
  });

  it("registers all four agent tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(4);
    expect(server.getHandler("list_agents")).toBeDefined();
    expect(server.getHandler("get_agent")).toBeDefined();
    expect(server.getHandler("create_agent")).toBeDefined();
    expect(server.getHandler("delete_agent")).toBeDefined();
  });
});
