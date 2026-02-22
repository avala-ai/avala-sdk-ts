import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("storageConfigs resource", () => {
  const mockListResponse = {
    results: [
      {
        uid: "550e8400-e29b-41d4-a716-446655440000",
        name: "My S3 Bucket",
        provider: "aws_s3",
        s3_bucket_name: "my-bucket",
        s3_bucket_region: "us-east-1",
        s3_bucket_prefix: "",
        s3_is_accelerated: false,
        gc_storage_bucket_name: "",
        gc_storage_prefix: "",
        is_verified: true,
        last_verified_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ],
    next: null,
    previous: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists storage configs", async () => {
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
    const page = await avala.storageConfigs.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("My S3 Bucket");
    expect(page.items[0].provider).toBe("aws_s3");
    expect(page.items[0].isVerified).toBe(true);
    expect(page.items[0].s3BucketName).toBe("my-bucket");
    expect(page.hasMore).toBe(false);
  });

  it("creates a storage config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            uid: "550e8400-e29b-41d4-a716-446655440000",
            name: "My S3 Bucket",
            provider: "aws_s3",
            s3_bucket_name: "my-bucket",
            s3_bucket_region: "us-east-1",
            s3_bucket_prefix: "",
            s3_is_accelerated: false,
            is_verified: true,
            last_verified_at: "2026-01-01T00:00:00Z",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const config = await avala.storageConfigs.create({
      name: "My S3 Bucket",
      provider: "aws_s3",
      s3BucketName: "my-bucket",
      s3BucketRegion: "us-east-1",
      s3AccessKeyId: "AKIAEXAMPLE",
      s3SecretAccessKey: "secret",
    });

    expect(config.name).toBe("My S3 Bucket");
    expect(config.uid).toBe("550e8400-e29b-41d4-a716-446655440000");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.s3_access_key_id).toBe("AKIAEXAMPLE");
    expect(body.s3_secret_access_key).toBe("secret");
  });

  it("tests a storage config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ verified: true }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const result = await avala.storageConfigs.test("550e8400-e29b-41d4-a716-446655440000");

    expect(result.verified).toBe(true);
  });

  it("deletes a storage config", async () => {
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
    await avala.storageConfigs.delete("550e8400-e29b-41d4-a716-446655440000");

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("exposes rate limit info", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          "X-RateLimit-Limit": "100",
          "X-RateLimit-Remaining": "99",
          "X-RateLimit-Reset": "1700000000",
        }),
        json: () => Promise.resolve({ results: [], next: null, previous: null }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    await avala.storageConfigs.list();

    const info = avala.rateLimitInfo;
    expect(info.limit).toBe("100");
    expect(info.remaining).toBe("99");
    expect(info.reset).toBe("1700000000");
  });
});
