import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../src/client.js";

describe("Avala client", () => {
  const originalEnv = process.env.AVALA_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv) {
      process.env.AVALA_API_KEY = originalEnv;
    } else {
      delete process.env.AVALA_API_KEY;
    }
  });

  it("throws when no API key is provided", () => {
    delete process.env.AVALA_API_KEY;
    expect(() => new Avala()).toThrowError("No API key");
  });

  it("creates client with explicit API key", () => {
    const avala = new Avala({ apiKey: "test-key" });
    expect(avala.datasets).toBeDefined();
    expect(avala.projects).toBeDefined();
    expect(avala.exports).toBeDefined();
    expect(avala.tasks).toBeDefined();
  });

  it("reads API key from AVALA_API_KEY env var and sends it in requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ results: [], next: null, previous: null }),
      })
    );
    process.env.AVALA_API_KEY = "env-test-key";
    const avala = new Avala();
    await avala.datasets.list();
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Avala-Api-Key"]).toBe("env-test-key");
  });

  it("uses custom base URL in requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ results: [], next: null, previous: null }),
      })
    );
    const avala = new Avala({ apiKey: "test-key", baseUrl: "https://custom.example.com/api/v1" });
    await avala.datasets.list();
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("https://custom.example.com/api/v1");
  });

  it("accepts custom timeout without error", () => {
    const avala = new Avala({ apiKey: "test-key", timeout: 60000 });
    expect(avala.tasks).toBeDefined();
  });
});
