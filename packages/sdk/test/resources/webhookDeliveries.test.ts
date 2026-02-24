import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("webhookDeliveries resource", () => {
  const mockDelivery = {
    uid: "del-uid-001",
    subscription: "wh-uid-001",
    event_type: "task.completed",
    payload: { task_uid: "task-001", status: "completed" },
    response_status: 200,
    response_body: '{"received": true}',
    attempts: 1,
    next_retry_at: null,
    status: "delivered",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:01Z",
  };

  const mockListResponse = {
    results: [mockDelivery],
    next: "https://api.avala.ai/api/v1/webhook-deliveries/?cursor=del-cursor",
    previous: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists webhook deliveries", async () => {
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
    const page = await avala.webhookDeliveries.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].subscription).toBe("wh-uid-001");
    expect(page.items[0].eventType).toBe("task.completed");
    expect(page.items[0].responseStatus).toBe(200);
    expect(page.items[0].responseBody).toBe('{"received": true}');
    expect(page.items[0].attempts).toBe(1);
    expect(page.items[0].status).toBe("delivered");
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("del-cursor");
  });

  it("lists webhook deliveries with empty results", async () => {
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
    const page = await avala.webhookDeliveries.list();

    expect(page.items).toHaveLength(0);
    expect(page.hasMore).toBe(false);
  });

  it("gets a single webhook delivery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockDelivery),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const delivery = await avala.webhookDeliveries.get("del-uid-001");

    expect(delivery.uid).toBe("del-uid-001");
    expect(delivery.subscription).toBe("wh-uid-001");
    expect(delivery.eventType).toBe("task.completed");
    expect(delivery.payload).toEqual({ task_uid: "task-001", status: "completed" });
    expect(delivery.responseStatus).toBe(200);
    expect(delivery.nextRetryAt).toBeNull();
    expect(delivery.createdAt).toBe("2026-01-01T00:00:00Z");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/webhook-deliveries/del-uid-001/");
  });
});
