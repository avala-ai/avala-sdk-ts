import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerAnnotationIssueTools } from "../../src/tools/annotationIssues.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    annotationIssues: {
      listBySequence: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      listByDataset: vi.fn(),
      getMetrics: vi.fn(),
      listTools: vi.fn(),
    },
  };
}

describe("annotation issue tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerAnnotationIssueTools(server as never, avala as never, true);
  });

  it("registers all 7 annotation issue tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(7);
    expect(server.getHandler("list_annotation_issues_by_sequence")).toBeDefined();
    expect(server.getHandler("create_annotation_issue")).toBeDefined();
    expect(server.getHandler("update_annotation_issue")).toBeDefined();
    expect(server.getHandler("delete_annotation_issue")).toBeDefined();
    expect(server.getHandler("list_annotation_issues_by_dataset")).toBeDefined();
    expect(server.getHandler("get_annotation_issue_metrics")).toBeDefined();
    expect(server.getHandler("list_qc_tools")).toBeDefined();
  });

  it("list_annotation_issues_by_sequence calls SDK and returns JSON", async () => {
    const mockIssues = [{ uid: "issue-001", status: "open", priority: "high" }];
    avala.annotationIssues.listBySequence.mockResolvedValue(mockIssues);

    const handler = server.getHandler("list_annotation_issues_by_sequence")!;
    const result = await handler({ sequenceUid: "seq-001" });

    expect(avala.annotationIssues.listBySequence).toHaveBeenCalledWith("seq-001", {
      datasetItemUid: undefined,
      projectUid: undefined,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].uid).toBe("issue-001");
  });

  it("create_annotation_issue calls SDK with correct options", async () => {
    const mockIssue = { uid: "issue-001", status: "open", priority: "high" };
    avala.annotationIssues.create.mockResolvedValue(mockIssue);

    const handler = server.getHandler("create_annotation_issue")!;
    const result = await handler({
      sequenceUid: "seq-001",
      toolUid: "tool-001",
      problemUid: "prob-001",
      priority: "high",
      description: "Test issue",
    });

    expect(avala.annotationIssues.create).toHaveBeenCalledWith("seq-001", {
      toolUid: "tool-001",
      problemUid: "prob-001",
      priority: "high",
      description: "Test issue",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe("issue-001");
  });

  it("update_annotation_issue calls SDK with correct options", async () => {
    const mockIssue = { uid: "issue-001", status: "completed", priority: "low" };
    avala.annotationIssues.update.mockResolvedValue(mockIssue);

    const handler = server.getHandler("update_annotation_issue")!;
    const result = await handler({
      sequenceUid: "seq-001",
      issueUid: "issue-001",
      status: "completed",
      priority: "low",
    });

    expect(avala.annotationIssues.update).toHaveBeenCalledWith("seq-001", "issue-001", {
      status: "completed",
      priority: "low",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("completed");
  });

  it("delete_annotation_issue calls SDK and returns success", async () => {
    avala.annotationIssues.delete.mockResolvedValue(undefined);

    const handler = server.getHandler("delete_annotation_issue")!;
    const result = await handler({ sequenceUid: "seq-001", issueUid: "issue-001" });

    expect(avala.annotationIssues.delete).toHaveBeenCalledWith("seq-001", "issue-001");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it("list_annotation_issues_by_dataset calls SDK and returns JSON", async () => {
    const mockIssues = [{ uid: "issue-001", status: "open" }];
    avala.annotationIssues.listByDataset.mockResolvedValue(mockIssues);

    const handler = server.getHandler("list_annotation_issues_by_dataset")!;
    const result = await handler({ owner: "acme", datasetSlug: "my-dataset", sequenceUid: "seq-001" });

    expect(avala.annotationIssues.listByDataset).toHaveBeenCalledWith("acme", "my-dataset", {
      sequenceUid: "seq-001",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
  });

  it("get_annotation_issue_metrics calls SDK and returns JSON", async () => {
    const mockMetrics = { statusCount: { open: 5 }, meanSecondsCloseTimeAll: 3600 };
    avala.annotationIssues.getMetrics.mockResolvedValue(mockMetrics);

    const handler = server.getHandler("get_annotation_issue_metrics")!;
    const result = await handler({ owner: "acme", datasetSlug: "my-dataset" });

    expect(avala.annotationIssues.getMetrics).toHaveBeenCalledWith("acme", "my-dataset", {
      sequenceUid: undefined,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.statusCount.open).toBe(5);
  });

  it("list_qc_tools calls SDK and returns JSON", async () => {
    const mockTools = [{ uid: "tool-001", name: "Bounding Box", datasetType: "image" }];
    avala.annotationIssues.listTools.mockResolvedValue(mockTools);

    const handler = server.getHandler("list_qc_tools")!;
    const result = await handler({ datasetType: "image" });

    expect(avala.annotationIssues.listTools).toHaveBeenCalledWith({ datasetType: "image" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Bounding Box");
  });
});
