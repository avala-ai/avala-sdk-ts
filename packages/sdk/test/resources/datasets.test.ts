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

  // --- Validation-friendly reads: getFrame / getCalibration / getHealth ---

  const sampleFrame = {
    frame_index: 0,
    key: "frame-0.json",
    model: "pinhole",
    camera_model: "pinhole",
    xi: null,
    alpha: null,
    device_position: { x: 1.0, y: 2.0, z: 3.0 },
    device_heading: { x: 0, y: 0, z: 0, w: 1 },
    images: [
      {
        image_url: "s3://bucket/frame-0/cam_01.jpg",
        position: { x: 0.1, y: 0.2, z: 0.3 },
        heading: { x: 0, y: 0, z: 0, w: 1 },
        width: 1920,
        height: 1080,
        fx: 824.74,
        fy: 834.49,
        cx: 960.0,
        cy: 540.0,
        model: "pinhole",
      },
    ],
  };

  const sequencePayload = {
    uid: "55555555-5555-5555-5555-555555555555",
    key: "full-scene-569",
    status: "completed",
    number_of_frames: 1,
    frames: [sampleFrame],
    dataset_uid: "44444444-4444-4444-4444-444444444444",
    allow_lidar_calibration: true,
    lidar_calibration_enabled: true,
    camera_calibration_enabled: true,
  };

  const healthPayload = {
    dataset_uid: "44444444-4444-4444-4444-444444444444",
    dataset_slug: "third-dimension-095940-full-scene",
    dataset_status: "created",
    item_count: 569,
    sequence_count: 1,
    total_frames: 569,
    s3_prefix: "third-dimension/alf_data/third-dimension-095940-full-scene/full-scene-569",
    gc_storage_prefix: null,
    last_updated_at: "2026-04-21T15:33:02Z",
    sequences: [
      {
        uid: "55555555-5555-5555-5555-555555555555",
        key: "full-scene-569",
        status: "completed",
        frame_count: 569,
        has_lidar_calibration: true,
        has_camera_calibration: true,
      },
    ],
    ingest_ok: true,
    issues: [],
  };

  it("getFrame returns typed frame metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(sequencePayload),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const frame = await avala.datasets.getFrame(
      "thirddimension",
      "third-dimension-095940-full-scene",
      "55555555-5555-5555-5555-555555555555",
      0,
    );

    expect(frame.frameIndex).toBe(0);
    expect(frame.model).toBe("pinhole");
    expect(frame.devicePosition?.x).toBe(1.0);
    expect(frame.images).toHaveLength(1);
    expect(frame.images?.[0].fx).toBe(824.74);
    expect(frame.images?.[0].cy).toBe(540.0);
    expect(frame.raw).toBeDefined();
  });

  it("getFrame throws RangeError for out-of-range index", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(sequencePayload),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    await expect(
      avala.datasets.getFrame(
        "thirddimension",
        "third-dimension-095940-full-scene",
        "55555555-5555-5555-5555-555555555555",
        99,
      ),
    ).rejects.toThrow(RangeError);
  });

  it("getCalibration extracts per-camera rig from frame[0]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(sequencePayload),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const calib = await avala.datasets.getCalibration(
      "thirddimension",
      "third-dimension-095940-full-scene",
      "55555555-5555-5555-5555-555555555555",
    );
    expect(calib.sequenceUid).toBe("55555555-5555-5555-5555-555555555555");
    expect(calib.cameras).toHaveLength(1);
    expect(calib.cameras[0].model).toBe("pinhole");
    expect(calib.cameras[0].fx).toBe(824.74);
  });

  it("getHealth returns typed snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(healthPayload),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const health = await avala.datasets.getHealth("thirddimension", "third-dimension-095940-full-scene");
    expect(health.totalFrames).toBe(569);
    expect(health.ingestOk).toBe(true);
    expect(health.gcStoragePrefix).toBeNull();
    expect(health.sequences).toHaveLength(1);
    expect(health.sequences[0].frameCount).toBe(569);
    expect(health.sequences[0].hasLidarCalibration).toBe(true);
    expect(health.issues).toEqual([]);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/datasets/thirddimension/third-dimension-095940-full-scene/health/");
  });
});
