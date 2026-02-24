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

  it("lists dataset items", async () => {
    const mockItem = {
      uid: "item-uid-001",
      key: "image_001.jpg",
      dataset: "ds-uid-001",
      url: "https://example.com/image_001.jpg",
      thumbnails: ["https://example.com/thumb_001.jpg"],
      video_thumbnail: null,
      metadata: { width: 1920, height: 1080 },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [mockItem], next: null, previous: null }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.datasets.listItems("acme-corp", "my-dataset");

    expect(page.items).toHaveLength(1);
    expect(page.items[0].key).toBe("image_001.jpg");
    expect(page.items[0].url).toBe("https://example.com/image_001.jpg");
    expect(page.items[0].videoThumbnail).toBeNull();
    expect(page.hasMore).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/datasets/acme-corp/my-dataset/items/");
  });

  it("gets a single dataset item", async () => {
    const mockItem = {
      uid: "item-uid-001",
      key: "image_001.jpg",
      dataset: "ds-uid-001",
      url: "https://example.com/image_001.jpg",
      thumbnails: [],
      video_thumbnail: null,
      metadata: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockItem),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const item = await avala.datasets.getItem("acme-corp", "my-dataset", "item-uid-001");

    expect(item.uid).toBe("item-uid-001");
    expect(item.key).toBe("image_001.jpg");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/datasets/acme-corp/my-dataset/items/item-uid-001/");
  });

  it("lists sequences", async () => {
    const mockSequence = {
      uid: "seq-uid-001",
      key: "sequence_001",
      custom_uuid: "custom-uuid-001",
      status: "new",
      featured_image: "https://example.com/thumb.jpg",
      number_of_frames: 120,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [mockSequence], next: null, previous: null }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.datasets.listSequences("acme-corp", "my-dataset");

    expect(page.items).toHaveLength(1);
    expect(page.items[0].key).toBe("sequence_001");
    expect(page.items[0].numberOfFrames).toBe(120);
    expect(page.items[0].status).toBe("new");
    expect(page.hasMore).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/datasets/acme-corp/my-dataset/sequences/");
  });
});
