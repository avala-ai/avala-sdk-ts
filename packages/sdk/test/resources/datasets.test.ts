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

  it("lists datasets with filter params", async () => {
    const avala = new Avala({ apiKey: "test-key" });
    await avala.datasets.list({ dataType: "mcap", name: "highway", status: "created", visibility: "private" });

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = new URL(callArgs[0]);
    expect(url.searchParams.get("data_type")).toBe("mcap");
    expect(url.searchParams.get("name")).toBe("highway");
    expect(url.searchParams.get("status")).toBe("created");
    expect(url.searchParams.get("visibility")).toBe("private");
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

  it("creates a dataset", async () => {
    const mockCreated = {
      uid: "new-dataset-uid",
      name: "New Dataset",
      slug: "new-dataset",
      item_count: 0,
      data_type: "lidar",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockCreated),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const dataset = await avala.datasets.create({
      name: "New Dataset",
      slug: "new-dataset",
      dataType: "lidar",
      isSequence: true,
      visibility: "private",
    });

    expect(dataset.uid).toBe("new-dataset-uid");
    expect(dataset.name).toBe("New Dataset");
    expect(dataset.dataType).toBe("lidar");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/datasets/");
    expect(callArgs[1].method).toBe("POST");
    const body = JSON.parse(callArgs[1].body);
    expect(body.name).toBe("New Dataset");
    expect(body.slug).toBe("new-dataset");
    expect(body.data_type).toBe("lidar");
    expect(body.is_sequence).toBe(true);
    expect(body.visibility).toBe("private");
  });

  it("creates a dataset with provider config", async () => {
    const mockCreated = {
      uid: "new-dataset-uid",
      name: "S3 Dataset",
      slug: "s3-dataset",
      item_count: 0,
      data_type: "image",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockCreated),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const dataset = await avala.datasets.create({
      name: "S3 Dataset",
      slug: "s3-dataset",
      dataType: "image",
      providerConfig: {
        provider: "aws_s3",
        s3_bucket_name: "my-bucket",
        s3_bucket_region: "us-east-1",
      },
      ownerName: "my-org",
    });

    expect(dataset.uid).toBe("new-dataset-uid");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.provider_config.provider).toBe("aws_s3");
    expect(body.owner_name).toBe("my-org");
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
