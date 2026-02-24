import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("datasets resource", () => {
  const mockResponse = {
    results: [
      {
        uid: "550e8400-e29b-41d4-a716-446655440000",
        name: "Test Dataset",
        slug: "test-dataset",
        item_count: 100,
        data_type: "image",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      },
    ],
    next: null,
    previous: null,
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists datasets", async () => {
    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.datasets.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("Test Dataset");
    expect(page.items[0].itemCount).toBe(100);
    expect(page.hasMore).toBe(false);
  });

  it("gets a single dataset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            uid: "550e8400-e29b-41d4-a716-446655440000",
            name: "Test Dataset",
            slug: "test-dataset",
            item_count: 100,
            data_type: "image",
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-02T00:00:00Z",
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const dataset = await avala.datasets.get("550e8400-e29b-41d4-a716-446655440000");

    expect(dataset.name).toBe("Test Dataset");
    expect(dataset.itemCount).toBe(100);
    expect(dataset.dataType).toBe("image");
  });

  it("handles pagination cursor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [{ uid: "aaa", name: "DS 1", slug: "ds-1", item_count: 10 }],
            next: "https://api.avala.ai/api/v1/datasets/?cursor=abc123",
            previous: null,
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.datasets.list();

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("abc123");
  });
});
