import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("exports resource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists exports", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [
              {
                uid: "exp-001",
                status: "completed",
                download_url: "https://s3.amazonaws.com/export.zip",
                created_at: "2025-04-01T00:00:00Z",
                updated_at: "2025-04-01T01:00:00Z",
              },
            ],
            next: null,
            previous: null,
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.exports.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].status).toBe("completed");
    expect(page.items[0].downloadUrl).toBe("https://s3.amazonaws.com/export.zip");
    expect(page.hasMore).toBe(false);
  });

  it("gets a single export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            uid: "exp-001",
            status: "processing",
            download_url: null,
            created_at: "2025-04-01T00:00:00Z",
            updated_at: "2025-04-01T00:30:00Z",
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const exp = await avala.exports.get("exp-001");

    expect(exp.uid).toBe("exp-001");
    expect(exp.status).toBe("processing");
    expect(exp.downloadUrl).toBeNull();
  });

  it("creates an export with project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            uid: "exp-002",
            status: "pending",
            download_url: null,
            created_at: "2025-04-02T00:00:00Z",
            updated_at: "2025-04-02T00:00:00Z",
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const exp = await avala.exports.create({ project: "proj-001" });

    expect(exp.uid).toBe("exp-002");
    expect(exp.status).toBe("pending");
    expect(exp.downloadUrl).toBeNull();
    expect(exp.createdAt).toBe("2025-04-02T00:00:00Z");

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
    expect(body.project).toBe("proj-001");
  });

  it("creates an export with dataset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            uid: "exp-003",
            status: "pending",
            download_url: null,
            created_at: "2025-04-02T00:00:00Z",
            updated_at: "2025-04-02T00:00:00Z",
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const exp = await avala.exports.create({ dataset: "ds-001" });

    expect(exp.uid).toBe("exp-003");

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
    expect(body.dataset).toBe("ds-001");
  });
});
