import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "../client.js";
import { definePageOutputSchema, defineReadCatalogTool, registerReadCatalogTool } from "../catalog.js";
import { z } from "zod";

const qualityTargetOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    metric: z.string(),
    operator: z.string(),
    threshold: z.number(),
    severity: z.string().nullable(),
    isActive: z.boolean(),
    notifyWebhook: z.boolean(),
    notifyEmails: z.array(z.string()),
    lastEvaluatedAt: z.string().nullable(),
    lastValue: z.number().nullable(),
    isBreached: z.boolean(),
    breachCount: z.number(),
    lastBreachedAt: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough();

const acceptanceRateBreakdownOutputSchema = z
  .object({
    key: z.string(),
    total: z.number(),
    accepted: z.number(),
    quarantined: z.number(),
    rejected: z.number(),
    acceptanceRate: z.number().nullable(),
  })
  .passthrough();

const agreementOutputSchema = z
  .object({
    compared: z.number(),
    agreed: z.number(),
    agreementRate: z.number().nullable(),
    machineAbstained: z.number(),
    notReviewed: z.number(),
    confusion: z.record(z.record(z.number())),
    machineRejectedHumanAccepted: z.number(),
    machineAcceptedHumanRejected: z.number(),
  })
  .passthrough();

const acceptanceSummaryOutputSchema = z
  .object({
    total: z.number(),
    byMachineVerdict: z.record(z.number()),
    machineAcceptanceRate: z.number().nullable(),
    reviewed: z.number(),
    actualAcceptanceRate: z.number().nullable(),
    agreementRate: z.number().nullable(),
    agreement: agreementOutputSchema,
    byDeviceTier: z.array(acceptanceRateBreakdownOutputSchema),
    byOperator: z.array(acceptanceRateBreakdownOutputSchema),
    topRejectReasons: z.array(
      z.object({
        reason: z.string(),
        count: z.number(),
      }),
    ),
  })
  .passthrough();

const acceptanceCoverageOutputSchema = z
  .object({
    totalAccepted: z.number(),
    axes: z.array(
      z
        .object({
          axis: z.string(),
          cells: z.array(
            z.object({
              value: z.string(),
              count: z.number(),
            }),
          ),
          distinctValues: z.number(),
          unfilled: z.number(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const acceptanceCriterionOutputSchema = z
  .object({
    key: z.string(),
    version: z.number(),
    status: z.string(),
    reason: z.string().nullable(),
    detail: z.record(z.unknown()),
  })
  .passthrough();

const episodeSignalsOutputSchema = z
  .object({
    status: z.string(),
    extractorVersion: z.number(),
    captureKind: z.string(),
    durationS: z.number().nullable(),
    campaignDurationS: z.number().nullable(),
    handGuardrailRequired: z.boolean().nullable(),
    handGuardrailMinHands: z.number().nullable(),
    handObservedS: z.number().nullable(),
    handMissingS: z.number().nullable(),
    handLongestGapS: z.number().nullable(),
    handGapCount: z.number().nullable(),
    mcapValid: z.boolean().nullable(),
    channels: z.array(z.string()),
    hasAudio: z.boolean().nullable(),
    hasIntrinsics: z.boolean().nullable(),
    hasDepth: z.boolean().nullable(),
    deviceTier: z.string(),
    dedupSearched: z.boolean(),
    duplicateOf: z.string(),
    axisValues: z.record(z.unknown()),
    narrationScores: z.unknown().nullable(),
  })
  .partial()
  .passthrough();

const resultAcceptanceOutputSchema = z
  .object({
    resultUid: z.string(),
    machineVerdict: z.string(),
    criteria: z.array(acceptanceCriterionOutputSchema),
    blockingReasons: z.array(z.string()),
    unmeasured: z.array(z.string()),
    engineVersion: z.number(),
    policyRevision: z.number(),
    signalsExtractorVersion: z.number(),
    evaluatedAt: z.string().nullable(),
    signals: episodeSignalsOutputSchema,
  })
  .passthrough();

const listQualityTargetsTool = defineReadCatalogTool({
  name: "list_quality_targets",
  title: "List quality targets",
  description: "List quality targets configured for a specific project.",
  inputSchema: z.object({
    projectUid: z.string().describe("The unique identifier (UUID) of the project"),
    limit: z.number().int().positive().optional().describe("Maximum number of quality targets to return"),
    cursor: z.string().optional().describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(qualityTargetOutputSchema),
  route: {
    name: "quality-targets-list",
    method: "GET",
    path: "/projects/{projectUid}/quality-targets/",
    query: { limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "qc.read",
    toolset: "quality",
  },
});

const getCampaignAcceptanceSummaryTool = defineReadCatalogTool({
  name: "get_campaign_acceptance_summary",
  title: "Get campaign acceptance summary",
  description:
    "Get a capture campaign's machine and reviewer acceptance rates, agreement, device-tier and operator breakdowns, and top rejection reasons.",
  inputSchema: z.object({
    projectUid: z.string().describe("The unique identifier (UUID) of the campaign project"),
  }),
  outputSchema: acceptanceSummaryOutputSchema,
  route: {
    name: "campaign-acceptance-summary",
    method: "GET",
    path: "/projects/{projectUid}/acceptance/summary/",
    response: "single",
    scope: "datasets.read",
    toolset: "quality",
  },
});

const getResultAcceptanceTool = defineReadCatalogTool({
  name: "get_result_acceptance",
  title: "Get capture acceptance verdict",
  description:
    "Get the machine acceptance verdict for one capture submission, including criterion outcomes, blocking reasons, unmeasured checks, and the measured signals behind the decision.",
  inputSchema: z.object({
    resultUid: z.string().describe("The unique identifier (UUID) of the capture result"),
  }),
  outputSchema: resultAcceptanceOutputSchema,
  route: {
    name: "result-acceptance",
    method: "GET",
    path: "/results/{resultUid}/acceptance/",
    response: "single",
    scope: "datasets.read",
    toolset: "quality",
  },
});

const getCampaignAcceptanceCoverageTool = defineReadCatalogTool({
  name: "get_campaign_acceptance_coverage",
  title: "Get campaign acceptance coverage",
  description:
    "Get under-covered values and unfilled counts for each axis across reviewer-accepted captures in a campaign.",
  inputSchema: z.object({
    projectUid: z.string().describe("The unique identifier (UUID) of the campaign project"),
    axes: z
      .string()
      .optional()
      .describe("Optional comma-separated coverage axes, for example 'subject,environment,device_tier'"),
  }),
  outputSchema: acceptanceCoverageOutputSchema,
  route: {
    name: "campaign-acceptance-coverage",
    method: "GET",
    path: "/projects/{projectUid}/acceptance/coverage/",
    query: { axes: "axes" },
    response: "single",
    scope: "datasets.read",
    toolset: "quality",
  },
});

export const QUALITY_READ_CATALOG_TOOLS = [
  listQualityTargetsTool,
  getResultAcceptanceTool,
  getCampaignAcceptanceSummaryTool,
  getCampaignAcceptanceCoverageTool,
] as const;

export function registerQualityTools(server: McpServer, getClient: GetClient, allowMutations = false): void {
  registerReadCatalogTool(server, getClient, listQualityTargetsTool);
  registerReadCatalogTool(server, getClient, getResultAcceptanceTool);
  registerReadCatalogTool(server, getClient, getCampaignAcceptanceSummaryTool);
  registerReadCatalogTool(server, getClient, getCampaignAcceptanceCoverageTool);

  if (allowMutations) {
    server.tool(
      "evaluate_quality",
      "Evaluate all quality targets for a project and return their current status.",
      {
        projectUid: z.string().describe("The unique identifier (UUID) of the project to evaluate"),
      },
      async ({ projectUid }) => {
        const avala = getClient("evaluate_quality");
        const evaluations = await avala.qualityTargets.evaluate(projectUid);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(evaluations, null, 2),
            },
          ],
        };
      }
    );
  }
}
