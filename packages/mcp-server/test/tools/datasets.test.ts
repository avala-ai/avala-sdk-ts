import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerDatasetTools } from "../../src/tools/datasets.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    transport: {
      requestPage: vi.fn(),
      requestSingle: vi.fn(),
    },
    datasets: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      listSequences: vi.fn(),
      getSequence: vi.fn(),
      getFrame: vi.fn(),
      getCalibration: vi.fn(),
      getHealth: vi.fn(),
    },
    projects: { list: vi.fn(), get: vi.fn() },
    exports: { list: vi.fn(), get: vi.fn(), create: vi.fn() },
    tasks: { list: vi.fn(), get: vi.fn() },
  };
}

describe("dataset tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerDatasetTools(server as never, (() => avala) as never, true);
  });

  it("list_datasets dispatches its declared route and returns structured JSON", async () => {
    const mockPage = {
      items: [{ uid: "ds-1", name: "Dataset 1", slug: "dataset-1", itemCount: 100, dataType: "image" }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_datasets")!;
    const result = await handler({});

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/datasets/", undefined);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].name).toBe("Dataset 1");
    expect(result.structuredContent).toEqual(mockPage);
  });

  it("list_datasets passes limit and cursor", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_datasets")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/datasets/", {
      limit: "5",
      cursor: "abc",
    });
  });

  it("get_dataset dispatches its declared detail route and returns JSON", async () => {
    const mockDataset = {
      uid: "ds-1",
      name: "Dataset 1",
      slug: "dataset-1",
      itemCount: 100,
      dataType: "image",
    };
    avala.transport.requestSingle.mockResolvedValue(mockDataset);

    const handler = server.getHandler("get_dataset")!;
    const result = await handler({ uid: "ds-1" });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith("/datasets/ds-1/");
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Dataset 1");
  });

  it("create_dataset calls avala.datasets.create and returns JSON", async () => {
    const mockDataset = { uid: "new-ds", name: "New Dataset", slug: "new-dataset", dataType: "lidar", itemCount: 0 };
    avala.datasets.create.mockResolvedValue(mockDataset);

    const handler = server.getHandler("create_dataset")!;
    const result = await handler({
      name: "New Dataset",
      slug: "new-dataset",
      dataType: "lidar",
      visibility: "private",
    });

    expect(avala.datasets.create).toHaveBeenCalledWith({
      name: "New Dataset",
      slug: "new-dataset",
      dataType: "lidar",
      visibility: "private",
      createMetadata: undefined,
      providerConfig: undefined,
      ownerName: undefined,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe("new-ds");
    expect(parsed.name).toBe("New Dataset");
  });

  it("create_dataset passes provider config and owner", async () => {
    const mockDataset = { uid: "s3-ds", name: "S3 Dataset", slug: "s3-dataset", dataType: "image", itemCount: 0 };
    avala.datasets.create.mockResolvedValue(mockDataset);

    const handler = server.getHandler("create_dataset")!;
    await handler({
      name: "S3 Dataset",
      slug: "s3-dataset",
      dataType: "image",
      providerConfig: { provider: "aws_s3", s3_bucket_name: "my-bucket" },
      ownerName: "my-org",
    });

    expect(avala.datasets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerConfig: { provider: "aws_s3", s3_bucket_name: "my-bucket" },
        ownerName: "my-org",
      }),
    );
  });

  // --- Validation tools ---

  it("list_sequences dispatches its declared route and returns JSON", async () => {
    const page = {
      items: [
        {
          uid: "seq-1",
          customUuid: null,
          key: "full-scene-569",
          status: "completed",
          featuredImage: null,
          numberOfFrames: 569,
        },
      ],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(page);

    const handler = server.getHandler("list_sequences")!;
    const result = await handler({ owner: "thirddimension", slug: "third-dimension-095940-full-scene" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith(
      "/datasets/thirddimension/third-dimension-095940-full-scene/sequences/",
      undefined,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].uid).toBe("seq-1");
  });

  it("get_sequence dispatches its declared route and returns JSON", async () => {
    const seq = {
      uid: "seq-1",
      key: "full-scene-569",
      status: "completed",
      predefinedLabels: [],
      frames: [],
      metrics: null,
      datasetUid: "ds-1",
      allowLidarCalibration: false,
      lidarCalibrationEnabled: false,
      cameraCalibrationEnabled: false,
      cropData: null,
    };
    avala.transport.requestSingle.mockResolvedValue(seq);

    const handler = server.getHandler("get_sequence")!;
    const result = await handler({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/datasets/thirddimension/third-dimension-095940-full-scene/sequences/seq-1/",
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe("seq-1");
  });

  it("get_frame calls avala.datasets.getFrame with frameIdx and returns JSON", async () => {
    const frame = {
      frameIndex: 0,
      model: "pinhole",
      key: "frame-0.json",
      images: [{ fx: 824.74, fy: 834.49 }],
      raw: {},
    };
    avala.datasets.getFrame.mockResolvedValue(frame);

    const handler = server.getHandler("get_frame")!;
    const result = await handler({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
      frameIdx: 0,
    });

    expect(avala.datasets.getFrame).toHaveBeenCalledWith(
      "thirddimension",
      "third-dimension-095940-full-scene",
      "seq-1",
      0,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.model).toBe("pinhole");
    expect(parsed.images[0].fx).toBe(824.74);
  });

  it("get_calibration calls avala.datasets.getCalibration and returns JSON", async () => {
    const calib = { sequenceUid: "seq-1", cameras: [{ cameraId: "cam_01", model: "pinhole" }] };
    avala.datasets.getCalibration.mockResolvedValue(calib);

    const handler = server.getHandler("get_calibration")!;
    const result = await handler({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
    });

    expect(avala.datasets.getCalibration).toHaveBeenCalledWith(
      "thirddimension",
      "third-dimension-095940-full-scene",
      "seq-1",
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cameras[0].cameraId).toBe("cam_01");
  });

  it("get_dataset_health dispatches its declared route and returns JSON", async () => {
    const health = {
      datasetUid: "ds-1",
      datasetSlug: "third-dimension-095940-full-scene",
      datasetStatus: "created",
      itemCount: 569,
      sequenceCount: 1,
      totalFrames: 569,
      s3Prefix: "datasets/thirddimension/third-dimension-095940-full-scene",
      gcStoragePrefix: null,
      lastUpdatedAt: "2026-08-24T00:00:00Z",
      ingestOk: true,
      sequences: [],
      issues: [],
    };
    avala.transport.requestSingle.mockResolvedValue(health);

    const handler = server.getHandler("get_dataset_health")!;
    const result = await handler({ owner: "thirddimension", slug: "third-dimension-095940-full-scene" });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/datasets/thirddimension/third-dimension-095940-full-scene/health/",
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalFrames).toBe(569);
    expect(parsed.ingestOk).toBe(true);
  });

  it("create_dataset is not registered without allowMutations", () => {
    const readOnlyServer = createMockServer();
    registerDatasetTools(readOnlyServer as never, avala as never, false);

    expect(readOnlyServer.getHandler("list_datasets")).toBeDefined();
    expect(readOnlyServer.getHandler("get_dataset")).toBeDefined();
    expect(readOnlyServer.getHandler("create_dataset")).toBeUndefined();
  });

  it("registers read-only + mutation tools when allowMutations is true", () => {
    // 2 pre-existing reads (list_datasets, get_dataset)
    // + 5 validation reads (list_sequences, get_sequence, get_frame, get_calibration, get_dataset_health)
    // + 1 mutation (create_dataset)
    expect(server.registerTool).toHaveBeenCalledTimes(5);
    expect(server.tool).toHaveBeenCalledTimes(3);
    expect(server.getHandler("list_datasets")).toBeDefined();
    expect(server.getHandler("get_dataset")).toBeDefined();
    expect(server.getHandler("list_sequences")).toBeDefined();
    expect(server.getHandler("get_sequence")).toBeDefined();
    expect(server.getHandler("get_frame")).toBeDefined();
    expect(server.getHandler("get_calibration")).toBeDefined();
    expect(server.getHandler("get_dataset_health")).toBeDefined();
    expect(server.getHandler("create_dataset")).toBeDefined();
  });
});
