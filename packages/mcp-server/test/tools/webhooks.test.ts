import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerWebhookTools } from "../../src/tools/webhooks.js";

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
    webhooks: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
  };
}

describe("webhook tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerWebhookTools(server as never, avala as never, true);
  });

  it("list_webhooks calls avala.webhooks.list and returns JSON", async () => {
    const mockPage = {
      items: [{ uid: "wh-1", targetUrl: "https://example.com/hook", events: ["task.completed"] }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.webhooks.list.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_webhooks")!;
    const result = await handler({});

    expect(avala.webhooks.list).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].targetUrl).toBe("https://example.com/hook");
  });

  it("list_webhooks passes limit and cursor", async () => {
    avala.webhooks.list.mockResolvedValue({ items: [], nextCursor: null, previousCursor: null, hasMore: false });

    const handler = server.getHandler("list_webhooks")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.webhooks.list).toHaveBeenCalledWith({ limit: 5, cursor: "abc" });
  });

  it("create_webhook calls avala.webhooks.create with targetUrl and events", async () => {
    const mockWebhook = { uid: "wh-2", targetUrl: "https://example.com/new", events: ["task.created", "task.completed"] };
    avala.webhooks.create.mockResolvedValue(mockWebhook);

    const handler = server.getHandler("create_webhook")!;
    const result = await handler({ targetUrl: "https://example.com/new", events: ["task.created", "task.completed"] });

    expect(avala.webhooks.create).toHaveBeenCalledWith({ targetUrl: "https://example.com/new", events: ["task.created", "task.completed"] });
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
    expect(server.tool).toHaveBeenCalledTimes(3);
    expect(server.getHandler("list_webhooks")).toBeDefined();
    expect(server.getHandler("create_webhook")).toBeDefined();
    expect(server.getHandler("delete_webhook")).toBeDefined();
  });
});
