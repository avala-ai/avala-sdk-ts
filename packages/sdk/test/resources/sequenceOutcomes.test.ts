import { afterEach, describe, expect, it, vi } from "vitest";
import { Avala } from "../../src/client.js";
import { NotFoundError } from "../../src/errors.js";

// Contract: server/server/apps/dataset/api_sequence_outcomes.py — GET/PUT
// .../sequences/<uid>/outcome/, GET .../outcome/history/ (plain array) and
// GET datasets/<owner>/<slug>/sequence-outcomes/ (cursor page, comma-joined filters).
describe("sequenceOutcomes resource", () => {
  const owner = "acme";
  const slug = "pick-place";
  const sequenceUid = "6f1c2a8e-9a4b-4f0e-8b1d-2f6c1e9d0a11";

  const mockOutcome = {
    uid: "o-1",
    sequence_uid: sequenceUid,
    version: 1,
    is_current: true,
    outcome: "mistake_and_recovery",
    progress: 0.75,
    quality: 4,
    speed: 2,
    subtasks: [{ label: "regrasp", start_ts: 1.5, end_ts: 4.0, outcome: null }],
    mistake_type: "grasp_slip",
    recovery_type: "regrasp",
    failure_stage: "",
    autonomy_level: "teleoperation",
    model_version: "",
    evaluation_membership: "held_out_eval",
    leakage_groups: { location: "kitchen-3", environment_family: "kitchens" },
    source: "human",
    labeled_by: null,
    confidence: null,
    created_at: "2026-09-30T00:00:00Z",
    updated_at: "2026-09-30T00:00:00Z",
  };

  function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
    const fn = vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      headers: new Headers(),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("gets the current label with camelCase fields", async () => {
    const fetchMock = stubFetch(mockOutcome);
    const avala = new Avala({ apiKey: "test-key" });
    const outcome = await avala.sequenceOutcomes.get(owner, slug, sequenceUid);

    expect(outcome.outcome).toBe("mistake_and_recovery");
    expect(outcome.evaluationMembership).toBe("held_out_eval");
    expect(outcome.subtasks[0].startTs).toBe(1.5);
    expect(outcome.leakageGroups.environmentFamily).toBe("kitchens");
    expect(fetchMock.mock.calls[0][0]).toContain(`/datasets/${owner}/${slug}/sequences/${sequenceUid}/outcome/`);
  });

  it("rejects with NotFoundError for an unlabeled sequence", async () => {
    stubFetch({ detail: "This sequence has no outcome label." }, 404);
    const avala = new Avala({ apiKey: "test-key" });
    await expect(avala.sequenceOutcomes.get(owner, slug, sequenceUid)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sets a label with a PUT and a snake_case body", async () => {
    const fetchMock = stubFetch({ ...mockOutcome, version: 2 });
    const avala = new Avala({ apiKey: "test-key" });
    const outcome = await avala.sequenceOutcomes.set(owner, slug, sequenceUid, {
      outcome: "slow_success",
      source: "model",
      confidence: 0.6,
      evaluationMembership: "train",
      subtasks: [{ label: "reach", startTs: 0, endTs: 1 }],
      leakageGroups: { operator: "op-1", environmentFamily: "kitchens" },
    });

    expect(outcome.version).toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/sequences/${sequenceUid}/outcome/`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      outcome: "slow_success",
      source: "model",
      confidence: 0.6,
      evaluation_membership: "train",
      subtasks: [{ label: "reach", start_ts: 0, end_ts: 1, outcome: null }],
      leakage_groups: { operator: "op-1", environment_family: "kitchens" },
    });
  });

  it("lists history as a plain array", async () => {
    stubFetch([{ ...mockOutcome, version: 2, uid: "o-2" }, { ...mockOutcome, is_current: false }]);
    const avala = new Avala({ apiKey: "test-key" });
    const versions = await avala.sequenceOutcomes.history(owner, slug, sequenceUid);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1].isCurrent).toBe(false);
  });

  it("lists current labels with comma-joined filters", async () => {
    const fetchMock = stubFetch({ results: [mockOutcome], next: null, previous: null });
    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.sequenceOutcomes.list(owner, slug, {
      outcome: ["failure", "aborted"],
      evaluationMembership: "held_out_eval",
      limit: 10,
    });

    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toContain(`/datasets/${owner}/${slug}/sequence-outcomes/`);
    expect(url.searchParams.get("outcome")).toBe("failure,aborted");
    expect(url.searchParams.get("evaluation_membership")).toBe("held_out_eval");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.has("source")).toBe(false);
  });
});
