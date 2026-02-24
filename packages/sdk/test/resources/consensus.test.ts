import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("consensus resource", () => {
  const projectUid = "proj-uid-001";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gets consensus summary", async () => {
    const mockSummary = {
      mean_score: 0.85,
      median_score: 0.88,
      min_score: 0.45,
      max_score: 0.99,
      total_items: 500,
      items_with_consensus: 450,
      score_distribution: { "0.8-0.9": 200, "0.9-1.0": 150 },
      by_task_name: [{ name: "annotation", mean: 0.87 }],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockSummary),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const summary = await avala.consensus.getSummary(projectUid);

    expect(summary.meanScore).toBe(0.85);
    expect(summary.medianScore).toBe(0.88);
    expect(summary.minScore).toBe(0.45);
    expect(summary.maxScore).toBe(0.99);
    expect(summary.totalItems).toBe(500);
    expect(summary.itemsWithConsensus).toBe(450);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain(`/projects/${projectUid}/consensus/`);
  });

  it("lists consensus scores", async () => {
    const mockScore = {
      uid: "score-uid-001",
      dataset_item_uid: "item-uid-001",
      task_name: "annotation",
      score_type: "iou",
      score: 0.92,
      annotator_count: 3,
      details: { agreements: 2, disagreements: 1 },
      created_at: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            results: [mockScore],
            next: "https://api.avala.ai/api/v1/projects/proj-uid-001/consensus/scores/?cursor=next123",
            previous: null,
          }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.consensus.listScores(projectUid);

    expect(page.items).toHaveLength(1);
    expect(page.items[0].datasetItemUid).toBe("item-uid-001");
    expect(page.items[0].taskName).toBe("annotation");
    expect(page.items[0].scoreType).toBe("iou");
    expect(page.items[0].score).toBe(0.92);
    expect(page.items[0].annotatorCount).toBe(3);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("next123");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain(`/projects/${projectUid}/consensus/scores/`);
  });

  it("computes consensus", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve({ status: "started", message: "Consensus computation started" }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const result = await avala.consensus.compute(projectUid);

    expect(result.status).toBe("started");
    expect(result.message).toBe("Consensus computation started");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[0]).toContain(`/projects/${projectUid}/consensus/compute/`);
  });

  it("gets consensus config", async () => {
    const mockConfig = {
      uid: "config-uid-001",
      iou_threshold: 0.5,
      min_agreement_ratio: 0.6,
      min_annotations: 2,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockConfig),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const config = await avala.consensus.getConfig(projectUid);

    expect(config.iouThreshold).toBe(0.5);
    expect(config.minAgreementRatio).toBe(0.6);
    expect(config.minAnnotations).toBe(2);
    expect(config.uid).toBe("config-uid-001");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain(`/projects/${projectUid}/consensus/config/`);
  });

  it("updates consensus config with PUT and snake_case body", async () => {
    const mockUpdatedConfig = {
      uid: "config-uid-001",
      iou_threshold: 0.7,
      min_agreement_ratio: 0.8,
      min_annotations: 3,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-15T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockUpdatedConfig),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const config = await avala.consensus.updateConfig(projectUid, {
      iouThreshold: 0.7,
      minAgreementRatio: 0.8,
      minAnnotations: 3,
    });

    expect(config.iouThreshold).toBe(0.7);
    expect(config.minAgreementRatio).toBe(0.8);
    expect(config.minAnnotations).toBe(3);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("PUT");
    expect(callArgs[0]).toContain(`/projects/${projectUid}/consensus/config/`);

    const body = JSON.parse(callArgs[1].body);
    expect(body.iou_threshold).toBe(0.7);
    expect(body.min_agreement_ratio).toBe(0.8);
    expect(body.min_annotations).toBe(3);
  });
});
