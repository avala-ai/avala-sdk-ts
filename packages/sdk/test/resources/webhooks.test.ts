import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("webhooks resource", () => {
  const mockWebhook = {
    uid: "wh-uid-001",
    target_url: "https://example.com/webhook",
    events: ["task.completed", "export.ready"],
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };

  const mockListResponse = {
    results: [mockWebhook],
    next: null,
    previous: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists webhooks", async () => {
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
    const page = await avala.webhooks.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].targetUrl).toBe("https://example.com/webhook");
    expect(page.items[0].events).toEqual(["task.completed", "export.ready"]);
    expect(page.items[0].isActive).toBe(true);
    expect(page.hasMore).toBe(false);
  });

  it("gets a single webhook", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockWebhook),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const webhook = await avala.webhooks.get("wh-uid-001");

    expect(webhook.uid).toBe("wh-uid-001");
    expect(webhook.targetUrl).toBe("https://example.com/webhook");
    expect(webhook.isActive).toBe(true);
    expect(webhook.createdAt).toBe("2026-01-01T00:00:00Z");
  });

  it("creates a webhook with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockWebhook),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const webhook = await avala.webhooks.create({
      targetUrl: "https://example.com/webhook",
      events: ["task.completed", "export.ready"],
      isActive: true,
    });

    expect(webhook.targetUrl).toBe("https://example.com/webhook");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.target_url).toBe("https://example.com/webhook");
    expect(body.events).toEqual(["task.completed", "export.ready"]);
    expect(body.is_active).toBe(true);
  });

  it("updates a webhook with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ ...mockWebhook, is_active: false }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const webhook = await avala.webhooks.update("wh-uid-001", {
      isActive: false,
      targetUrl: "https://example.com/new-webhook",
    });

    expect(webhook.isActive).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("PATCH");
    const body = JSON.parse(callArgs[1].body);
    expect(body.is_active).toBe(false);
    expect(body.target_url).toBe("https://example.com/new-webhook");
  });

  it("deletes a webhook", async () => {
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
    await avala.webhooks.delete("wh-uid-001");

    expect(fetch).toHaveBeenCalledTimes(1);
    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("DELETE");
    expect(callArgs[0]).toContain("/webhooks/wh-uid-001/");
  });

  it("tests a webhook", async () => {
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
    const result = await avala.webhooks.test("wh-uid-001");

    expect(result.success).toBe(true);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[0]).toContain("/webhooks/wh-uid-001/test/");
  });
});
