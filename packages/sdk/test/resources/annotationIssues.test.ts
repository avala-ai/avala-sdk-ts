import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("annotationIssues resource", () => {
  const mockIssue = {
    uid: "issue-uid-001",
    dataset_item_uid: "item-uid-001",
    sequence_uid: "seq-uid-001",
    project: { uid: "proj-uid-001", name: "My Project" },
    reporter: { username: "alice", picture: null, full_name: "Alice Smith", type: "customer", is_staff: false },
    priority: "high",
    severity: "critical",
    description: "Missing label",
    status: "open",
    tool: { uid: "tool-uid-001", name: "Bounding Box", default: true },
    problem: { uid: "prob-uid-001", title: "Wrong class" },
    wrong_class: "car",
    correct_class: "truck",
    should_re_annotate: true,
    should_delete: false,
    frames_affected: "1-5",
    coordinates: { x: 100, y: 200 },
    query_params: null,
    created_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    object_uid: "obj-uid-001",
  };

  const mockMetrics = {
    status_count: { open: 5, resolved: 3 },
    priority_count: { high: 4, low: 4 },
    severity_count: { critical: 3, moderate: 5 },
    mean_seconds_close_time_all: 3600,
    mean_seconds_close_time_customer: 7200,
    mean_unresolved_issue_age_all: 1800,
    mean_unresolved_issue_age_customer: 900,
    object_count_by_annotation_issue_problem_uid: [{ uid: "prob-uid-001", count: 3 }],
  };

  const mockTool = {
    uid: "tool-uid-001",
    name: "Bounding Box",
    dataset_type: "image",
    default: true,
    problems: [{ uid: "prob-uid-001", title: "Wrong class" }],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists annotation issues by sequence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([mockIssue]),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const issues = await avala.annotationIssues.listBySequence("seq-uid-001");

    expect(issues).toHaveLength(1);
    expect(issues[0].uid).toBe("issue-uid-001");
    expect(issues[0].datasetItemUid).toBe("item-uid-001");
    expect(issues[0].shouldReAnnotate).toBe(true);
    expect(issues[0].wrongClass).toBe("car");
    // Verify deep snakeToCamel converts nested object keys
    expect(issues[0].reporter?.fullName).toBe("Alice Smith");
    expect(issues[0].reporter?.isStaff).toBe(false);
    expect(issues[0].tool?.uid).toBe("tool-uid-001");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/sequences/seq-uid-001/annotation-issues/");
  });

  it("lists annotation issues by sequence with filters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([mockIssue]),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    await avala.annotationIssues.listBySequence("seq-uid-001", {
      datasetItemUid: "item-uid-001",
      projectUid: "proj-uid-001",
    });

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("dataset_item_uid=item-uid-001");
    expect(callArgs[0]).toContain("project_uid=proj-uid-001");
  });

  it("creates an annotation issue with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockIssue),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const issue = await avala.annotationIssues.create("seq-uid-001", {
      toolUid: "tool-uid-001",
      problemUid: "prob-uid-001",
      priority: "high",
      severity: "critical",
      description: "Missing label",
      wrongClass: "car",
      correctClass: "truck",
      shouldReAnnotate: true,
    });

    expect(issue.uid).toBe("issue-uid-001");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.tool_uid).toBe("tool-uid-001");
    expect(body.problem_uid).toBe("prob-uid-001");
    expect(body.wrong_class).toBe("car");
    expect(body.correct_class).toBe("truck");
    expect(body.should_re_annotate).toBe(true);
    expect(body.sequence_uid).toBe("seq-uid-001");
    expect(callArgs[0]).toContain("/sequences/seq-uid-001/annotation-issues/");
  });

  it("updates an annotation issue with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ ...mockIssue, status: "resolved" }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const issue = await avala.annotationIssues.update("seq-uid-001", "issue-uid-001", {
      status: "resolved",
      priority: "low",
    });

    expect(issue.status).toBe("resolved");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.status).toBe("resolved");
    expect(body.priority).toBe("low");
    expect(callArgs[1].method).toBe("PATCH");
    expect(callArgs[0]).toContain("/sequences/seq-uid-001/annotation-issues/issue-uid-001/");
  });

  it("deletes an annotation issue", async () => {
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
    await avala.annotationIssues.delete("seq-uid-001", "issue-uid-001");

    expect(fetch).toHaveBeenCalledTimes(1);
    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("DELETE");
    expect(callArgs[0]).toContain("/sequences/seq-uid-001/annotation-issues/issue-uid-001/");
  });

  it("lists annotation issues by dataset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([mockIssue]),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const issues = await avala.annotationIssues.listByDataset("acme", "my-dataset", {
      sequenceUid: "seq-uid-001",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].uid).toBe("issue-uid-001");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/datasets/acme/my-dataset/annotation-issues/");
    expect(callArgs[0]).toContain("sequence_uid=seq-uid-001");
  });

  it("gets annotation issue metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockMetrics),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const metrics = await avala.annotationIssues.getMetrics("acme", "my-dataset");

    expect(metrics.statusCount).toEqual({ open: 5, resolved: 3 });
    expect(metrics.meanSecondsCloseTimeAll).toBe(3600);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/datasets/acme/my-dataset/annotation-issues/metrics/");
  });

  it("lists QC tools", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([mockTool]),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const tools = await avala.annotationIssues.listTools({ datasetType: "image" });

    expect(tools).toHaveLength(1);
    expect(tools[0].uid).toBe("tool-uid-001");
    expect(tools[0].name).toBe("Bounding Box");
    expect(tools[0].datasetType).toBe("image");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/qc-available-tools/");
    expect(callArgs[0]).toContain("dataset_type=image");
  });
});
