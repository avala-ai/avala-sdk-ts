import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("inferenceProviders resource", () => {
  const mockProvider = {
    uid: "prov-uid-001",
    name: "My Provider",
    description: "Test inference provider",
    provider_type: "sagemaker",
    config: { endpoint: "my-endpoint", region: "us-east-1" },
    is_active: true,
    project: "proj-uid-001",
    last_test_at: "2026-01-01T00:00:00Z",
    last_test_success: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };

  const mockListResponse = {
    results: [mockProvider],
    next: null,
    previous: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists inference providers", async () => {
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
    const page = await avala.inferenceProviders.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("My Provider");
    expect(page.items[0].providerType).toBe("sagemaker");
    expect(page.items[0].isActive).toBe(true);
    expect(page.items[0].lastTestSuccess).toBe(true);
    expect(page.hasMore).toBe(false);
  });

  it("gets a single inference provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockProvider),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const provider = await avala.inferenceProviders.get("prov-uid-001");

    expect(provider.uid).toBe("prov-uid-001");
    expect(provider.providerType).toBe("sagemaker");
    expect(provider.config).toEqual({ endpoint: "my-endpoint", region: "us-east-1" });
    expect(provider.lastTestAt).toBe("2026-01-01T00:00:00Z");
  });

  it("creates an inference provider with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockProvider),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const provider = await avala.inferenceProviders.create({
      name: "My Provider",
      description: "Test inference provider",
      providerType: "sagemaker",
      config: { endpoint: "my-endpoint", region: "us-east-1" },
      project: "proj-uid-001",
    });

    expect(provider.name).toBe("My Provider");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.provider_type).toBe("sagemaker");
    expect(body.config).toEqual({ endpoint: "my-endpoint", region: "us-east-1" });
    expect(body.name).toBe("My Provider");
  });

  it("updates an inference provider with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ ...mockProvider, is_active: false }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const provider = await avala.inferenceProviders.update("prov-uid-001", {
      isActive: false,
      providerType: "openai",
    });

    expect(provider.isActive).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("PATCH");
    const body = JSON.parse(callArgs[1].body);
    expect(body.is_active).toBe(false);
    expect(body.provider_type).toBe("openai");
  });

  it("deletes an inference provider", async () => {
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
    await avala.inferenceProviders.delete("prov-uid-001");

    expect(fetch).toHaveBeenCalledTimes(1);
    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("DELETE");
    expect(callArgs[0]).toContain("/inference-providers/prov-uid-001/");
  });

  it("tests an inference provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            success: true,
            message: "Connection successful",
            tested_at: "2026-01-15T00:00:00Z",
          }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const result = await avala.inferenceProviders.test("prov-uid-001");

    expect(result.success).toBe(true);
    expect(result.message).toBe("Connection successful");
    expect(result.testedAt).toBe("2026-01-15T00:00:00Z");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[0]).toContain("/inference-providers/prov-uid-001/test/");
  });
});
