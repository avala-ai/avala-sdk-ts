import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerStorageTools } from "../../src/tools/storage.js";

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
    storageConfigs: { list: vi.fn(), create: vi.fn(), test: vi.fn(), delete: vi.fn() },
  };
}

describe("storage tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerStorageTools(server as never, avala as never);
  });

  it("list_storage_configs calls avala.storageConfigs.list and returns JSON", async () => {
    const mockPage = {
      items: [{ uid: "sc-1", name: "Production S3", provider: "s3" }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.storageConfigs.list.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_storage_configs")!;
    const result = await handler({});

    expect(avala.storageConfigs.list).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].name).toBe("Production S3");
  });

  it("list_storage_configs passes limit and cursor", async () => {
    avala.storageConfigs.list.mockResolvedValue({ items: [], nextCursor: null, previousCursor: null, hasMore: false });

    const handler = server.getHandler("list_storage_configs")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.storageConfigs.list).toHaveBeenCalledWith({ limit: 5, cursor: "abc" });
  });

  it("create_storage_config calls avala.storageConfigs.create with all params and returns JSON", async () => {
    const mockConfig = { uid: "sc-2", name: "New S3 Config", provider: "s3", s3BucketName: "my-bucket" };
    avala.storageConfigs.create.mockResolvedValue(mockConfig);

    const handler = server.getHandler("create_storage_config")!;
    const result = await handler({
      name: "New S3 Config",
      provider: "s3",
      s3BucketName: "my-bucket",
      s3BucketRegion: "us-west-2",
      s3BucketPrefix: "data/",
      s3AccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      s3SecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });

    expect(avala.storageConfigs.create).toHaveBeenCalledWith({
      name: "New S3 Config",
      provider: "s3",
      s3BucketName: "my-bucket",
      s3BucketRegion: "us-west-2",
      s3BucketPrefix: "data/",
      s3AccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      s3SecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      gcStorageBucketName: undefined,
      gcStoragePrefix: undefined,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe("sc-2");
    expect(parsed.provider).toBe("s3");
  });

  it("create_storage_config works with GCS params", async () => {
    const mockConfig = { uid: "sc-3", name: "GCS Config", provider: "gcs", gcStorageBucketName: "my-gcs-bucket" };
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
      s3AccessKeyId: undefined,
      s3SecretAccessKey: undefined,
      gcStorageBucketName: "my-gcs-bucket",
      gcStoragePrefix: "datasets/",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.provider).toBe("gcs");
  });

  it("test_storage_config calls avala.storageConfigs.test and returns JSON", async () => {
    const mockResult = { success: true, latencyMs: 120, message: "Connection successful" };
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
    expect(server.tool).toHaveBeenCalledTimes(4);
    expect(server.getHandler("list_storage_configs")).toBeDefined();
    expect(server.getHandler("create_storage_config")).toBeDefined();
    expect(server.getHandler("test_storage_config")).toBeDefined();
    expect(server.getHandler("delete_storage_config")).toBeDefined();
  });
});
