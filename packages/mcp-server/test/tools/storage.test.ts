import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerStorageTools } from "../../src/tools/storage.js";

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
    storageConfigs: { create: vi.fn(), test: vi.fn(), delete: vi.fn() },
  };
}

const MOCK_STORAGE_CONFIG = {
  uid: "sc-1",
  name: "Production S3",
  provider: "aws_s3",
  s3BucketName: "robotics-data",
  s3BucketRegion: "us-west-2",
  s3BucketPrefix: "datasets/",
  s3IsAccelerated: false,
  s3AuthMethod: "iam_role",
  gcStorageBucketName: null,
  gcStoragePrefix: null,
  r2AccountId: null,
  r2PublicBaseUrl: null,
  isVerified: true,
  lastVerifiedAt: "2025-01-01T00:00:00Z",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-02T00:00:00Z",
};

describe("storage tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerStorageTools(server as never, (() => avala) as never, true);
  });

  it("list_storage_configs dispatches its declared route and returns structured JSON", async () => {
    const mockPage = {
      items: [MOCK_STORAGE_CONFIG],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_storage_configs")!;
    const result = await handler({});

    expect(avala.transport.requestPage).toHaveBeenCalledWith(
      "/storage-configs/",
      { limit: "25" },
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0]).toMatchObject({
      uid: "sc-1",
      name: "Production S3",
      provider: "aws_s3",
      isVerified: true,
      updatedAt: "2025-01-02T00:00:00Z",
    });
    expect(parsed.items[0]).not.toHaveProperty("s3BucketName");
    expect(parsed.items[0]).not.toHaveProperty("s3BucketPrefix");
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_cursor).toBeNull();
    expect(result.structuredContent).toEqual(parsed);
  });

  it("list_storage_configs passes limit and cursor", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_storage_configs")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith(
      "/storage-configs/",
      { limit: "5", cursor: "abc" },
    );
  });

  it("create_storage_config calls avala.storageConfigs.create with all params and returns JSON", async () => {
    const mockConfig = {
      uid: "sc-2",
      name: "New S3 Config",
      provider: "s3",
      s3BucketName: "my-bucket",
    };
    avala.storageConfigs.create.mockResolvedValue(mockConfig);

    const handler = server.getHandler("create_storage_config")!;
    const result = await handler({
      name: "New S3 Config",
      provider: "s3",
      s3BucketName: "my-bucket",
      s3BucketRegion: "us-west-2",
      s3BucketPrefix: "data/",
      s3IsAccelerated: true,
    });

    expect(avala.storageConfigs.create).toHaveBeenCalledWith({
      name: "New S3 Config",
      provider: "s3",
      s3BucketName: "my-bucket",
      s3BucketRegion: "us-west-2",
      s3BucketPrefix: "data/",
      s3IsAccelerated: true,
      gcStorageBucketName: undefined,
      gcStoragePrefix: undefined,
    });
    const [jsonPart] = result.content[0].text.split("\n\nNOTE:");
    const parsed = JSON.parse(jsonPart);
    expect(parsed.uid).toBe("sc-2");
    expect(parsed.provider).toBe("s3");
    expect(result.content[0].text).toContain(
      "Add credentials via the Avala web console",
    );
  });

  it("create_storage_config works with GCS params", async () => {
    const mockConfig = {
      uid: "sc-3",
      name: "GCS Config",
      provider: "gcs",
      gcStorageBucketName: "my-gcs-bucket",
    };
    avala.storageConfigs.create.mockResolvedValue(mockConfig);

    const handler = server.getHandler("create_storage_config")!;
    const result = await handler({
      name: "GCS Config",
      provider: "gcs",
      gcStorageBucketName: "my-gcs-bucket",
      gcStoragePrefix: "datasets/",
    });

    expect(avala.storageConfigs.create).toHaveBeenCalledWith({
      name: "GCS Config",
      provider: "gcs",
      s3BucketName: undefined,
      s3BucketRegion: undefined,
      s3BucketPrefix: undefined,
      s3IsAccelerated: undefined,
      gcStorageBucketName: "my-gcs-bucket",
      gcStoragePrefix: "datasets/",
    });
    const [jsonPart] = result.content[0].text.split("\n\nNOTE:");
    const parsed = JSON.parse(jsonPart);
    expect(parsed.provider).toBe("gcs");
  });

  it("test_storage_config calls avala.storageConfigs.test and returns JSON", async () => {
    const mockResult = {
      success: true,
      latencyMs: 120,
      message: "Connection successful",
    };
    avala.storageConfigs.test.mockResolvedValue(mockResult);

    const handler = server.getHandler("test_storage_config")!;
    const result = await handler({ uid: "sc-1" });

    expect(avala.storageConfigs.test).toHaveBeenCalledWith("sc-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.latencyMs).toBe(120);
  });

  it("delete_storage_config calls avala.storageConfigs.delete and returns success", async () => {
    avala.storageConfigs.delete.mockResolvedValue(undefined);

    const handler = server.getHandler("delete_storage_config")!;
    const result = await handler({ uid: "sc-1" });

    expect(avala.storageConfigs.delete).toHaveBeenCalledWith("sc-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe("Storage config sc-1 deleted.");
  });

  it("registers all four storage tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(4);
    expect(server.getHandler("list_storage_configs")).toBeDefined();
    expect(server.getHandler("create_storage_config")).toBeDefined();
    expect(server.getHandler("test_storage_config")).toBeDefined();
    expect(server.getHandler("delete_storage_config")).toBeDefined();
  });
});

describe("storage tools — read-only mode (allowMutations=false)", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerStorageTools(server as never, (() => avala) as never, false);
  });

  it("registers only the read-only list tool", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(1);
    expect(server.getHandler("list_storage_configs")).toBeDefined();
  });

  // AVALA-SEC-2026-0010: test_storage_config triggers a state-changing POST
  // (storageConfigs.test), so it must NOT be exposed in read-only mode.
  it("does not expose test_storage_config or any mutation tool", () => {
    expect(server.getHandler("test_storage_config")).toBeUndefined();
    expect(server.getHandler("create_storage_config")).toBeUndefined();
    expect(server.getHandler("delete_storage_config")).toBeUndefined();
  });
});
