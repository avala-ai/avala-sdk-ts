import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerDatasetTools } from "../../src/tools/datasets.js";

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
    registerDatasetTools(server as never, avala as never, true);
  });

  it("list_datasets calls avala.datasets.list and returns JSON", async () => {
    const mockPage = {
      items: [{ uid: "ds-1", name: "Dataset 1", itemCount: 100 }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.datasets.list.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_datasets")!;
    const result = await handler({});

    expect(avala.datasets.list).toHaveBeenCalled();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].name).toBe("Dataset 1");
  });

  it("list_datasets passes limit and cursor", async () => {
    avala.datasets.list.mockResolvedValue({ items: [], nextCursor: null, previousCursor: null, hasMore: false });

    const handler = server.getHandler("list_datasets")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.datasets.list).toHaveBeenCalledWith({
      dataType: undefined,
      name: undefined,
      status: undefined,
      visibility: undefined,
      limit: 5,
      cursor: "abc",
    });
  });

  it("get_dataset calls avala.datasets.get and returns JSON", async () => {
    const mockDataset = { uid: "ds-1", name: "Dataset 1", itemCount: 100, dataType: "image" };
    avala.datasets.get.mockResolvedValue(mockDataset);

    const handler = server.getHandler("get_dataset")!;
    const result = await handler({ uid: "ds-1" });

    expect(avala.datasets.get).toHaveBeenCalledWith("ds-1");
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
      isSequence: true,
      visibility: "private",
    });

    expect(avala.datasets.create).toHaveBeenCalledWith({
      name: "New Dataset",
      slug: "new-dataset",
      dataType: "lidar",
      isSequence: true,
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

  it("list_sequences calls avala.datasets.listSequences and returns JSON", async () => {
    const page = {
      items: [{ uid: "seq-1", key: "full-scene-569", status: "completed", numberOfFrames: 569 }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.datasets.listSequences.mockResolvedValue(page);

    const handler = server.getHandler("list_sequences")!;
    const result = await handler({ owner: "thirddimension", slug: "third-dimension-095940-full-scene" });

    expect(avala.datasets.listSequences).toHaveBeenCalledWith("thirddimension", "third-dimension-095940-full-scene", {
      limit: undefined,
      cursor: undefined,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].uid).toBe("seq-1");
  });

  it("get_sequence calls avala.datasets.getSequence and returns JSON", async () => {
    const seq = { uid: "seq-1", key: "full-scene-569", status: "completed", frames: [] };
    avala.datasets.getSequence.mockResolvedValue(seq);

    const handler = server.getHandler("get_sequence")!;
    const result = await handler({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
    });

    expect(avala.datasets.getSequence).toHaveBeenCalledWith(
      "thirddimension",
      "third-dimension-095940-full-scene",
      "seq-1",
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

  it("get_dataset_health calls avala.datasets.getHealth and returns JSON", async () => {
    const health = {
      datasetUid: "ds-1",
      datasetSlug: "third-dimension-095940-full-scene",
      totalFrames: 569,
      ingestOk: true,
      sequences: [],
      issues: [],
    };
    avala.datasets.getHealth.mockResolvedValue(health);

    const handler = server.getHandler("get_dataset_health")!;
    const result = await handler({ owner: "thirddimension", slug: "third-dimension-095940-full-scene" });

    expect(avala.datasets.getHealth).toHaveBeenCalledWith("thirddimension", "third-dimension-095940-full-scene");
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
    expect(server.tool).toHaveBeenCalledTimes(8);
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
