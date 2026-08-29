import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerWebhookTools } from "../../src/tools/webhooks.js";

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
    transport: { requestPage: vi.fn() },
    webhooks: { create: vi.fn(), delete: vi.fn() },
  };
}

const MOCK_WEBHOOK = {
  uid: "wh-1",
  targetUrl: "https://example.com/hook",
  events: ["task.completed"],
  isActive: true,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-02T00:00:00Z",
};

describe("webhook tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerWebhookTools(server as never, (() => avala) as never, true);
  });

  it("list_webhooks dispatches its declared route and returns structured JSON", async () => {
    const mockPage = {
      items: [MOCK_WEBHOOK],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_webhooks")!;
    const result = await handler({});

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/webhooks/", {
      limit: "25",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0]).toMatchObject({
      uid: "wh-1",
      isActive: true,
      updatedAt: "2025-01-02T00:00:00Z",
    });
    expect(parsed.items[0]).not.toHaveProperty("targetUrl");
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_cursor).toBeNull();
    expect(result.structuredContent).toEqual(parsed);
  });

  it("list_webhooks passes limit and cursor", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_webhooks")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/webhooks/", {
      limit: "5",
      cursor: "abc",
    });
  });

  it("create_webhook calls avala.webhooks.create with targetUrl and events", async () => {
    const mockWebhook = {
      uid: "wh-2",
      targetUrl: "https://example.com/new",
      events: ["task.created", "task.completed"],
    };
    avala.webhooks.create.mockResolvedValue(mockWebhook);

    const handler = server.getHandler("create_webhook")!;
    const result = await handler({
      targetUrl: "https://example.com/new",
      events: ["task.created", "task.completed"],
    });

    expect(avala.webhooks.create).toHaveBeenCalledWith({
      targetUrl: "https://example.com/new",
      events: ["task.created", "task.completed"],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe("wh-2");
    expect(parsed.events).toEqual(["task.created", "task.completed"]);
  });

  it("delete_webhook calls avala.webhooks.delete and returns success", async () => {
    avala.webhooks.delete.mockResolvedValue(undefined);

    const handler = server.getHandler("delete_webhook")!;
    const result = await handler({ uid: "wh-1" });

    expect(avala.webhooks.delete).toHaveBeenCalledWith("wh-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe("Webhook wh-1 deleted.");
  });

  it("registers all three webhook tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(3);
    expect(server.getHandler("list_webhooks")).toBeDefined();
    expect(server.getHandler("create_webhook")).toBeDefined();
    expect(server.getHandler("delete_webhook")).toBeDefined();
  });
});
