import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("agents resource", () => {
  const mockAgent = {
    uid: "agent-uid-001",
    name: "My Agent",
    description: "Test agent",
    events: ["task.completed"],
    callback_url: "https://example.com/callback",
    is_active: true,
    project: "proj-uid-001",
    task_types: ["annotation"],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };

  const mockListResponse = {
    results: [mockAgent],
    next: "https://api.avala.ai/api/v1/agents/?cursor=abc123",
    previous: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists agents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockListResponse),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.agents.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("My Agent");
    expect(page.items[0].callbackUrl).toBe("https://example.com/callback");
    expect(page.items[0].isActive).toBe(true);
    expect(page.items[0].taskTypes).toEqual(["annotation"]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("abc123");
  });

  it("lists agents with empty results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [], next: null, previous: null }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.agents.list();

    expect(page.items).toHaveLength(0);
    expect(page.hasMore).toBe(false);
  });

  it("gets a single agent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockAgent),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const agent = await avala.agents.get("agent-uid-001");

    expect(agent.uid).toBe("agent-uid-001");
    expect(agent.callbackUrl).toBe("https://example.com/callback");
    expect(agent.isActive).toBe(true);
    expect(agent.taskTypes).toEqual(["annotation"]);
    expect(agent.createdAt).toBe("2026-01-01T00:00:00Z");
  });

  it("creates an agent with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockAgent),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const agent = await avala.agents.create({
      name: "My Agent",
      description: "Test agent",
      callbackUrl: "https://example.com/callback",
      events: ["task.completed"],
      project: "proj-uid-001",
      taskTypes: ["annotation"],
    });

    expect(agent.name).toBe("My Agent");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.callback_url).toBe("https://example.com/callback");
    expect(body.task_types).toEqual(["annotation"]);
    expect(body.name).toBe("My Agent");
  });

  it("updates an agent with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ ...mockAgent, is_active: false }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const agent = await avala.agents.update("agent-uid-001", {
      isActive: false,
      callbackUrl: "https://example.com/new-callback",
    });

    expect(agent.isActive).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("PATCH");
    const body = JSON.parse(callArgs[1].body);
    expect(body.is_active).toBe(false);
    expect(body.callback_url).toBe("https://example.com/new-callback");
  });

  it("deletes an agent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
        json: () => Promise.resolve(undefined),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    await avala.agents.delete("agent-uid-001");

    expect(fetch).toHaveBeenCalledTimes(1);
    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("DELETE");
    expect(callArgs[0]).toContain("/agents/agent-uid-001/");
  });

  it("lists agent executions", async () => {
    const mockExecution = {
      uid: "exec-uid-001",
      registration: "agent-uid-001",
      event_type: "task.completed",
      task: "task-uid-001",
      result: null,
      status: "success",
      action: "approve",
      event_payload: { key: "value" },
      response_payload: null,
      error_message: null,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:01Z",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:01Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [mockExecution], next: null, previous: null }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.agents.listExecutions("agent-uid-001");

    expect(page.items).toHaveLength(1);
    expect(page.items[0].eventType).toBe("task.completed");
    expect(page.items[0].status).toBe("success");
    expect(page.items[0].eventPayload).toEqual({ key: "value" });
    expect(page.hasMore).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/agents/agent-uid-001/executions/");
  });

  it("tests an agent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const result = await avala.agents.test("agent-uid-001");

    expect(result.success).toBe(true);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[0]).toContain("/agents/agent-uid-001/test/");
  });
});
