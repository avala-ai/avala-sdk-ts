import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerQualityTools } from "../../src/tools/quality.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    transport: { requestPage: vi.fn(), requestSingle: vi.fn() },
    qualityTargets: { evaluate: vi.fn() },
  };
}

const MOCK_QUALITY_TARGET = {
  uid: "qt-1",
  name: "Accuracy Target",
  metric: "acceptance_rate",
  operator: "gte",
  threshold: 0.95,
  severity: "warning",
  isActive: true,
  notifyWebhook: true,
  notifyEmails: ["quality@example.com"],
  lastEvaluatedAt: "2025-01-01T00:00:00Z",
  lastValue: 0.97,
  isBreached: false,
  breachCount: 0,
  lastBreachedAt: null,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-02T00:00:00Z",
};

describe("quality tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerQualityTools(server as never, (() => avala) as never, true);
  });

  it("list_quality_targets dispatches its declared route and returns structured JSON", async () => {
    const mockPage = {
      items: [MOCK_QUALITY_TARGET],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_quality_targets")!;
    const result = await handler({ projectUid: "proj-1" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/projects/proj-1/quality-targets/", undefined);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].name).toBe("Accuracy Target");
    expect(result.structuredContent).toEqual(mockPage);
  });

  it("list_quality_targets passes limit and cursor", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_quality_targets")!;
    await handler({ projectUid: "proj-1", limit: 10, cursor: "abc" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/projects/proj-1/quality-targets/", {
      limit: "10",
      cursor: "abc",
    });
  });

  it("get_campaign_acceptance_summary returns yield and reviewer agreement", async () => {
    const summary = {
      total: 12,
      byMachineVerdict: { accept: 8, reject: 3, quarantine: 1 },
      machineAcceptanceRate: 8 / 12,
      reviewed: 10,
      actualAcceptanceRate: 0.7,
      agreementRate: 0.8,
      agreement: {
        compared: 10,
        agreed: 8,
        agreementRate: 0.8,
        machineAbstained: 1,
        notReviewed: 1,
        confusion: { accept: { accept: 7, reject: 1 }, reject: { accept: 1, reject: 1 } },
        machineRejectedHumanAccepted: 1,
        machineAcceptedHumanRejected: 1,
      },
      byDeviceTier: [
        {
          key: "lidar",
          total: 8,
          accepted: 6,
          quarantined: 1,
          rejected: 1,
          acceptanceRate: 0.75,
        },
      ],
      byOperator: [
        {
          key: "operator-1",
          total: 12,
          accepted: 8,
          quarantined: 1,
          rejected: 3,
          acceptanceRate: 8 / 12,
        },
      ],
      topRejectReasons: [{ reason: "hands_not_visible", count: 3 }],
    };
    avala.transport.requestSingle.mockResolvedValue(summary);

    const handler = server.getHandler("get_campaign_acceptance_summary")!;
    const result = await handler({ projectUid: "campaign-1" });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/projects/campaign-1/acceptance/summary/",
    );
    expect(result.structuredContent).toEqual(summary);
    expect(JSON.parse(result.content[0].text).agreement.agreementRate).toBe(0.8);
  });

  it("get_result_acceptance returns the verdict and measured evidence", async () => {
    const acceptance = {
      resultUid: "00000000-0000-0000-0000-000000000019",
      machineVerdict: "reject",
      criteria: [
        {
          key: "framing",
          version: 2,
          status: "fail",
          reason: "hands_not_visible",
          detail: { missingFraction: 0.4 },
        },
      ],
      blockingReasons: ["hands_not_visible"],
      unmeasured: [],
      engineVersion: 3,
      policyRevision: 7,
      signalsExtractorVersion: 4,
      evaluatedAt: "2026-08-24T00:00:00Z",
      signals: {
        status: "extracted",
        extractorVersion: 4,
        captureKind: "mcap",
        durationS: 180,
        campaignDurationS: 180,
        handGuardrailRequired: true,
        handGuardrailMinHands: 2,
        handObservedS: 170,
        handMissingS: 68,
        handLongestGapS: 12,
        handGapCount: 3,
        mcapValid: true,
        channels: ["/camera/video"],
        hasAudio: true,
        hasIntrinsics: true,
        hasDepth: true,
        deviceTier: "lidar_current",
        dedupSearched: true,
        duplicateOf: "",
        axisValues: { subject: { value: "fold laundry", source: "declared" } },
        narrationScores: null,
      },
    };
    avala.transport.requestSingle.mockResolvedValue(acceptance);

    const handler = server.getHandler("get_result_acceptance")!;
    const result = await handler({ resultUid: acceptance.resultUid });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      `/results/${acceptance.resultUid}/acceptance/`,
    );
    expect(result.structuredContent).toEqual(acceptance);
    expect(JSON.parse(result.content[0].text).criteria[0].reason).toBe("hands_not_visible");
  });

  it("get_campaign_acceptance_coverage forwards requested axes", async () => {
    const coverage = {
      totalAccepted: 7,
      axes: [
        {
          axis: "subject",
          cells: [
            { value: "fold laundry", count: 2 },
            { value: "make a sandwich", count: 5 },
          ],
          distinctValues: 2,
          unfilled: 0,
        },
      ],
    };
    avala.transport.requestSingle.mockResolvedValue(coverage);

    const handler = server.getHandler("get_campaign_acceptance_coverage")!;
    const result = await handler({ projectUid: "campaign-1", axes: "subject,device_tier" });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/projects/campaign-1/acceptance/coverage/",
      { axes: "subject,device_tier" },
    );
    expect(result.structuredContent).toEqual(coverage);
    expect(JSON.parse(result.content[0].text).axes[0].cells[0].count).toBe(2);
  });

  it("evaluate_quality calls avala.qualityTargets.evaluate with projectUid and returns JSON", async () => {
    const mockEvaluations = [
      { uid: "qt-1", name: "Accuracy Target", status: "passing", score: 0.97 },
      { uid: "qt-2", name: "Recall Target", status: "failing", score: 0.82 },
    ];
    avala.qualityTargets.evaluate.mockResolvedValue(mockEvaluations);

    const handler = server.getHandler("evaluate_quality")!;
    const result = await handler({ projectUid: "proj-1" });

    expect(avala.qualityTargets.evaluate).toHaveBeenCalledWith("proj-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].status).toBe("passing");
    expect(parsed[1].status).toBe("failing");
  });

  it("registers the quality target and acceptance tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(4);
    expect(server.tool).toHaveBeenCalledTimes(1);
    expect(server.getHandler("list_quality_targets")).toBeDefined();
    expect(server.getHandler("get_result_acceptance")).toBeDefined();
    expect(server.getHandler("get_campaign_acceptance_summary")).toBeDefined();
    expect(server.getHandler("get_campaign_acceptance_coverage")).toBeDefined();
    expect(server.getHandler("evaluate_quality")).toBeDefined();
  });
});
