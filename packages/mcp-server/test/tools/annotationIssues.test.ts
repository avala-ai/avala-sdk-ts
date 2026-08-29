import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerAnnotationIssueTools } from "../../src/tools/annotationIssues.js";

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn(
      (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    ),
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    ),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    transport: {
      requestList: vi.fn(),
      requestSingle: vi.fn(),
    },
    annotationIssues: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

const ISSUE = {
  uid: "issue-001",
  datasetItemUid: "item-001",
  sequenceUid: "seq-001",
  project: { uid: "project-001", name: "Warehouse QC" },
  reporter: {
    username: "reviewer",
    picture: null,
    fullName: "Avala Reviewer",
    type: "customer",
    isStaff: false,
  },
  priority: "high",
  severity: "moderate",
  description: "Incorrect class",
  status: "open",
  tool: { uid: "tool-001", name: "Cuboid", default: true },
  problem: { uid: "problem-001", title: "Wrong class" },
  wrongClass: "car",
  correctClass: "truck",
  shouldReAnnotate: true,
  shouldDelete: false,
  framesAffected: "1,2",
  coordinates: { x: 1, y: 2, z: 3 },
  queryParams: { camera: "front" },
  createdAt: "2026-08-24T00:00:00Z",
  closedAt: null,
  objectUid: "object-001",
};

const QC_TOOL = {
  uid: "tool-001",
  name: "Cuboid",
  datasetType: "lidar",
  default: true,
  problems: [{ uid: "problem-001", title: "Wrong class" }],
};

const METRICS = {
  statusCount: { open: 5 },
  priorityCount: { high: 3, medium: 2 },
  severityCount: { critical: 1, moderate: 4 },
  meanSecondsCloseTimeAll: 3600,
  meanSecondsCloseTimeCustomer: 4200,
  meanUnresolvedIssueAgeAll: 7200,
  meanUnresolvedIssueAgeCustomer: 8100,
  objectCountByAnnotationIssueProblemUid: [
    { annotationIssueProblemUid: "problem-001", count: 9 },
  ],
};

describe("annotation issue tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    avala.transport.requestList.mockImplementation(async (path: string) =>
      path === "/qc-available-tools/" ? [QC_TOOL] : [ISSUE],
    );
    avala.transport.requestSingle.mockResolvedValue(METRICS);
    registerAnnotationIssueTools(server as never, (() => avala) as never, true);
  });

  it("registers four declarative reads and three mutation tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(7);
    expect(
      server.getHandler("list_annotation_issues_by_sequence"),
    ).toBeDefined();
    expect(server.getHandler("create_annotation_issue")).toBeDefined();
    expect(server.getHandler("update_annotation_issue")).toBeDefined();
    expect(server.getHandler("delete_annotation_issue")).toBeDefined();
    expect(
      server.getHandler("list_annotation_issues_by_dataset"),
    ).toBeDefined();
    expect(server.getHandler("get_annotation_issue_metrics")).toBeDefined();
    expect(server.getHandler("list_qc_tools")).toBeDefined();
  });

  it("dispatches sequence and dataset issue lists with exact filters", async () => {
    const sequenceResult = await server.getHandler(
      "list_annotation_issues_by_sequence",
    )!({
      sequenceUid: "seq-001",
      datasetItemUid: "item-001",
      projectUid: "project-001",
    });
    const datasetResult = await server.getHandler(
      "list_annotation_issues_by_dataset",
    )!({
      owner: "acme",
      datasetSlug: "warehouse",
      sequenceUid: "seq-001",
    });

    expect(avala.transport.requestList).toHaveBeenNthCalledWith(
      1,
      "/sequences/seq-001/annotation-issues/",
      {
        dataset_item_uid: "item-001",
        project_uid: "project-001",
      },
    );
    expect(avala.transport.requestList).toHaveBeenNthCalledWith(
      2,
      "/datasets/acme/warehouse/annotation-issues/",
      {
        sequence_uid: "seq-001",
      },
    );
    const conciseIssue = {
      uid: "issue-001",
      status: "open",
      priority: "high",
      severity: "moderate",
      sequenceUid: "seq-001",
    };
    expect(sequenceResult.structuredContent).toEqual({ items: [conciseIssue] });
    expect(datasetResult.structuredContent).toEqual({ items: [conciseIssue] });
    expect(sequenceResult.structuredContent).not.toHaveProperty("hasMore");
    expect(sequenceResult.structuredContent).not.toHaveProperty("nextCursor");
    expect(datasetResult.structuredContent).not.toHaveProperty("has_more");
    expect(datasetResult.structuredContent).not.toHaveProperty("next_cursor");
    expect(JSON.parse(sequenceResult.content[0]!.text)).toEqual([conciseIssue]);
    expect(
      (sequenceResult.structuredContent as { items: Record<string, unknown>[] })
        .items[0],
    ).not.toHaveProperty("coordinates");
    expect(
      (sequenceResult.structuredContent as { items: Record<string, unknown>[] })
        .items[0],
    ).not.toHaveProperty("reporter");
  });

  it("dispatches the QC tool list with its dataset type", async () => {
    const result = await server.getHandler("list_qc_tools")!({
      datasetType: "lidar",
    });

    expect(avala.transport.requestList).toHaveBeenCalledWith(
      "/qc-available-tools/",
      { dataset_type: "lidar" },
    );
    const conciseTool = {
      uid: "tool-001",
      name: "Cuboid",
      datasetType: "lidar",
    };
    expect(result.structuredContent).toEqual({ items: [conciseTool] });
    expect(result.structuredContent).not.toHaveProperty("hasMore");
    expect(result.structuredContent).not.toHaveProperty("nextCursor");
    expect(JSON.parse(result.content[0]!.text)).toEqual([conciseTool]);
    expect(
      (result.structuredContent as { items: Record<string, unknown>[] })
        .items[0],
    ).not.toHaveProperty("problems");
  });

  it("strips unknown issue fields and redacts credential-like query parameters", async () => {
    avala.transport.requestList.mockResolvedValueOnce([
      {
        ...ISSUE,
        unexpected: "must be stripped",
        queryParams: {
          api_key: "FAKE-not-a-real-api-key",
          camera: "front",
        },
      },
    ]);

    const result = await server.getHandler(
      "list_annotation_issues_by_sequence",
    )!({ sequenceUid: "seq-001", detail: "full" });
    const item = (
      result.structuredContent as { items: Record<string, unknown>[] }
    ).items[0]!;

    expect(item).not.toHaveProperty("unexpected");
    expect(item.queryParams).toEqual({
      api_key: "[redacted]",
      camera: "front",
    });
    expect(result.content[0]!.text).not.toContain("FAKE-not-a-real-api-key");
  });

  it("dispatches annotation issue metrics with its sequence filter", async () => {
    const result = await server.getHandler("get_annotation_issue_metrics")!({
      owner: "acme",
      datasetSlug: "warehouse",
      sequenceUid: "seq-001",
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/datasets/acme/warehouse/annotation-issues/metrics/",
      {
        sequence_uid: "seq-001",
      },
    );
    const conciseMetrics = {
      statusCount: { open: 5 },
      priorityCount: { high: 3, medium: 2 },
      severityCount: { critical: 1, moderate: 4 },
    };
    expect(result.structuredContent).toEqual(conciseMetrics);
    expect(result.structuredContent).not.toHaveProperty(
      "objectCountByAnnotationIssueProblemUid",
    );
    expect(result.structuredContent).not.toHaveProperty(
      "meanSecondsCloseTimeAll",
    );
    expect(JSON.parse(result.content[0]!.text)).toEqual(conciseMetrics);
  });

  it("redacts credential-like values from metrics aggregation records", async () => {
    avala.transport.requestSingle.mockResolvedValueOnce({
      ...METRICS,
      objectCountByAnnotationIssueProblemUid: [
        {
          annotationIssueProblemUid: "problem-001",
          secret: "FAKE-not-a-real-secret",
          count: 9,
        },
      ],
    });

    const result = await server.getHandler("get_annotation_issue_metrics")!({
      owner: "acme",
      datasetSlug: "warehouse",
      detail: "full",
    });
    const records = (result.structuredContent as typeof METRICS)
      .objectCountByAnnotationIssueProblemUid;

    expect(records[0]).toEqual({
      annotationIssueProblemUid: "problem-001",
      secret: "[redacted]",
      count: 9,
    });
    expect(result.content[0]!.text).not.toContain("FAKE-not-a-real-secret");
  });

  it("keeps annotation issue mutations on their existing SDK methods", async () => {
    avala.annotationIssues.create.mockResolvedValue({
      uid: "issue-001",
      status: "open",
    });
    avala.annotationIssues.update.mockResolvedValue({
      uid: "issue-001",
      status: "completed",
    });
    avala.annotationIssues.delete.mockResolvedValue(undefined);

    await server.getHandler("create_annotation_issue")!({
      sequenceUid: "seq-001",
      toolUid: "tool-001",
      problemUid: "problem-001",
      priority: "high",
    });
    await server.getHandler("update_annotation_issue")!({
      sequenceUid: "seq-001",
      issueUid: "issue-001",
      status: "completed",
    });
    const deleted = await server.getHandler("delete_annotation_issue")!({
      sequenceUid: "seq-001",
      issueUid: "issue-001",
    });

    expect(avala.annotationIssues.create).toHaveBeenCalledWith("seq-001", {
      toolUid: "tool-001",
      problemUid: "problem-001",
      priority: "high",
    });
    expect(avala.annotationIssues.update).toHaveBeenCalledWith(
      "seq-001",
      "issue-001",
      {
        status: "completed",
      },
    );
    expect(avala.annotationIssues.delete).toHaveBeenCalledWith(
      "seq-001",
      "issue-001",
    );
    expect(JSON.parse(deleted.content[0]!.text)).toEqual({ success: true });
  });

  it("does not register annotation issue mutations in read-only mode", () => {
    const readOnlyServer = createMockServer();
    registerAnnotationIssueTools(
      readOnlyServer as never,
      (() => avala) as never,
      false,
    );

    expect(readOnlyServer.registerTool).toHaveBeenCalledTimes(4);
    expect(
      readOnlyServer.getHandler("create_annotation_issue"),
    ).toBeUndefined();
    expect(
      readOnlyServer.getHandler("update_annotation_issue"),
    ).toBeUndefined();
    expect(
      readOnlyServer.getHandler("delete_annotation_issue"),
    ).toBeUndefined();
    expect(
      readOnlyServer.getHandler("get_annotation_issue_metrics"),
    ).toBeDefined();
  });
});
