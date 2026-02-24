import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("autoLabelJobs resource", () => {
  const mockJob = {
    uid: "job-uid-001",
    status: "running",
    model_type: "object_detection",
    confidence_threshold: 0.85,
    labels: ["car", "truck"],
    dry_run: false,
    total_items: 1000,
    processed_items: 500,
    successful_items: 480,
    failed_items: 20,
    skipped_items: 0,
    progress_pct: 50.0,
    error_message: null,
    summary: null,
    started_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };

  const mockListResponse = {
    results: [mockJob],
    next: null,
    previous: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists auto-label jobs", async () => {
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
    const page = await avala.autoLabelJobs.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].modelType).toBe("object_detection");
    expect(page.items[0].confidenceThreshold).toBe(0.85);
    expect(page.items[0].totalItems).toBe(1000);
    expect(page.items[0].processedItems).toBe(500);
    expect(page.items[0].progressPct).toBe(50.0);
    expect(page.hasMore).toBe(false);
  });

  it("lists auto-label jobs with filters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [], next: null, previous: null }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    await avala.autoLabelJobs.list({ project: "proj-uid-001", status: "completed" });

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = callArgs[0] as string;
    expect(url).toContain("project=proj-uid-001");
    expect(url).toContain("status=completed");
  });

  it("gets a single auto-label job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockJob),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const job = await avala.autoLabelJobs.get("job-uid-001");

    expect(job.uid).toBe("job-uid-001");
    expect(job.modelType).toBe("object_detection");
    expect(job.confidenceThreshold).toBe(0.85);
    expect(job.dryRun).toBe(false);
    expect(job.successfulItems).toBe(480);
    expect(job.failedItems).toBe(20);
  });

  it("creates an auto-label job with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockJob),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const job = await avala.autoLabelJobs.create("proj-uid-001", {
      modelType: "object_detection",
      confidenceThreshold: 0.85,
      labels: ["car", "truck"],
      dryRun: false,
    });

    expect(job.uid).toBe("job-uid-001");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = callArgs[0] as string;
    expect(url).toContain("/projects/proj-uid-001/auto-label/");

    const body = JSON.parse(callArgs[1].body);
    expect(body.model_type).toBe("object_detection");
    expect(body.confidence_threshold).toBe(0.85);
    expect(body.dry_run).toBe(false);
    expect(body.labels).toEqual(["car", "truck"]);
  });

  it("cancels an auto-label job", async () => {
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
    await avala.autoLabelJobs.cancel("job-uid-001");

    expect(fetch).toHaveBeenCalledTimes(1);
    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("DELETE");
    expect(callArgs[0]).toContain("/auto-label-jobs/job-uid-001/");
  });
});
