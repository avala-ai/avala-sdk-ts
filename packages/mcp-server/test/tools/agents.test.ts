import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerAgentTools } from "../../src/tools/agents.js";

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
    transport: { requestPage: vi.fn(), requestSingle: vi.fn() },
    agents: { create: vi.fn(), delete: vi.fn() },
  };
}

const MOCK_AGENT = {
  uid: "agent-1",
  name: "My Agent",
  description: "Processes completed tasks",
  events: ["task.completed"],
  callbackUrl: "https://example.com/hook",
  isActive: true,
  project: null,
  taskTypes: ["annotation"],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-02T00:00:00Z",
};

describe("agent tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerAgentTools(server as never, (() => avala) as never, true);
  });

  it("list_agents dispatches its declared route and returns structured JSON", async () => {
    const mockPage = {
      items: [MOCK_AGENT],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_agents")!;
    const result = await handler({});

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/agents/", {
      limit: "25",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0]).toMatchObject({
      uid: "agent-1",
      name: "My Agent",
      isActive: true,
      project: null,
      updatedAt: "2025-01-02T00:00:00Z",
    });
    expect(parsed.items[0]).not.toHaveProperty("callbackUrl");
    expect(parsed.items[0]).not.toHaveProperty("description");
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_cursor).toBeNull();
    expect(result.structuredContent).toEqual(parsed);
  });

  it("list_agents passes limit and cursor", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_agents")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/agents/", {
      limit: "5",
      cursor: "abc",
    });
  });

  it("get_agent dispatches its declared detail route", async () => {
    const mockAgent = { ...MOCK_AGENT, executionStats: { completed: 2 } };
    avala.transport.requestSingle.mockResolvedValue(mockAgent);

    const handler = server.getHandler("get_agent")!;
    const result = await handler({ uid: "agent-1" });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/agents/agent-1/",
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({
      uid: "agent-1",
      name: "My Agent",
      isActive: true,
      project: null,
      updatedAt: "2025-01-02T00:00:00Z",
    });
    expect(parsed).not.toHaveProperty("callbackUrl");
    expect(parsed).not.toHaveProperty("executionStats");

    const full = await handler({ uid: "agent-1", detail: "full" });
    const fullParsed = JSON.parse(full.content[0].text);
    expect(fullParsed.callbackUrl).toBe("https://example.com/hook");
    expect(fullParsed.executionStats).toEqual({ completed: 2 });
  });

  it("create_agent calls avala.agents.create with all params and returns JSON", async () => {
    const mockAgent = {
      uid: "agent-2",
      name: "New Agent",
      events: ["task.created"],
      callbackUrl: "https://example.com/cb",
    };
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
    expect(server.registerTool).toHaveBeenCalledTimes(4);
    expect(server.getHandler("list_agents")).toBeDefined();
    expect(server.getHandler("get_agent")).toBeDefined();
    expect(server.getHandler("create_agent")).toBeDefined();
    expect(server.getHandler("delete_agent")).toBeDefined();
  });
});
