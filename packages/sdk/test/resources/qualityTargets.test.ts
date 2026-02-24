import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("qualityTargets resource", () => {
  const projectUid = "proj-uid-001";

  const mockTarget = {
    uid: "qt-uid-001",
    name: "Accuracy Target",
    metric: "accuracy",
    operator: "gte",
    threshold: 0.95,
    severity: "critical",
    is_active: true,
    notify_webhook: true,
    notify_emails: ["alerts@example.com"],
    last_evaluated_at: "2026-01-15T00:00:00Z",
    last_value: 0.97,
    is_breached: false,
    breach_count: 2,
    last_breached_at: "2026-01-10T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-15T00:00:00Z",
  };

  const mockListResponse = {
    results: [mockTarget],
    next: null,
    previous: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists quality targets for a project", async () => {
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
    const page = await avala.qualityTargets.list(projectUid);

    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("Accuracy Target");
    expect(page.items[0].isActive).toBe(true);
    expect(page.items[0].notifyWebhook).toBe(true);
    expect(page.items[0].notifyEmails).toEqual(["alerts@example.com"]);
    expect(page.items[0].breachCount).toBe(2);
    expect(page.hasMore).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain(`/projects/${projectUid}/quality-targets/`);
  });

  it("gets a single quality target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockTarget),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const target = await avala.qualityTargets.get(projectUid, "qt-uid-001");

    expect(target.uid).toBe("qt-uid-001");
    expect(target.metric).toBe("accuracy");
    expect(target.operator).toBe("gte");
    expect(target.threshold).toBe(0.95);
    expect(target.lastValue).toBe(0.97);
    expect(target.isBreached).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain(`/projects/${projectUid}/quality-targets/qt-uid-001/`);
  });

  it("creates a quality target with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockTarget),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const target = await avala.qualityTargets.create(projectUid, {
      name: "Accuracy Target",
      metric: "accuracy",
      operator: "gte",
      threshold: 0.95,
      severity: "critical",
      isActive: true,
      notifyWebhook: true,
      notifyEmails: ["alerts@example.com"],
    });

    expect(target.name).toBe("Accuracy Target");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = callArgs[0] as string;
    expect(url).toContain(`/projects/${projectUid}/quality-targets/`);

    const body = JSON.parse(callArgs[1].body);
    expect(body.notify_webhook).toBe(true);
    expect(body.notify_emails).toEqual(["alerts@example.com"]);
    expect(body.is_active).toBe(true);
  });

  it("updates a quality target with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ ...mockTarget, threshold: 0.9 }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const target = await avala.qualityTargets.update(projectUid, "qt-uid-001", {
      threshold: 0.9,
      notifyWebhook: false,
    });

    expect(target.threshold).toBe(0.9);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("PATCH");
    expect(callArgs[0]).toContain(`/projects/${projectUid}/quality-targets/qt-uid-001/`);

    const body = JSON.parse(callArgs[1].body);
    expect(body.threshold).toBe(0.9);
    expect(body.notify_webhook).toBe(false);
  });

  it("deletes a quality target", async () => {
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
    await avala.qualityTargets.delete(projectUid, "qt-uid-001");

    expect(fetch).toHaveBeenCalledTimes(1);
    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("DELETE");
    expect(callArgs[0]).toContain(`/projects/${projectUid}/quality-targets/qt-uid-001/`);
  });

  it("evaluates quality targets", async () => {
    const mockEvaluations = [
      {
        uid: "qt-uid-001",
        name: "Accuracy Target",
        metric: "accuracy",
        threshold: 0.95,
        operator: "gte",
        current_value: 0.97,
        is_breached: false,
        severity: "critical",
      },
      {
        uid: "qt-uid-002",
        name: "Speed Target",
        metric: "latency",
        threshold: 100,
        operator: "lte",
        current_value: 150,
        is_breached: true,
        severity: "warning",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockEvaluations),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const evaluations = await avala.qualityTargets.evaluate(projectUid);

    expect(evaluations).toHaveLength(2);

    // Verify snake_case → camelCase conversion
    expect(evaluations[0].currentValue).toBe(0.97);
    expect(evaluations[0].isBreached).toBe(false);
    expect(evaluations[0].uid).toBe("qt-uid-001");
    expect(evaluations[0].metric).toBe("accuracy");

    expect(evaluations[1].currentValue).toBe(150);
    expect(evaluations[1].isBreached).toBe(true);
    expect(evaluations[1].severity).toBe("warning");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[0]).toContain(`/projects/${projectUid}/quality-targets/evaluate/`);
  });
});
