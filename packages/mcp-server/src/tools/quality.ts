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

export const QUALITY_READ_CATALOG_TOOLS = [listQualityTargetsTool] as const;

export function registerQualityTools(server: McpServer, getClient: GetClient, allowMutations = false): void {
  registerReadCatalogTool(server, getClient, listQualityTargetsTool);

  if (allowMutations) {
    server.tool(
      "evaluate_quality",
      "Evaluate all quality targets for a project and return their current status.",
      {
        projectUid: z.string().describe("The unique identifier (UUID) of the project to evaluate"),
      },
      async ({ projectUid }) => {
        const avala = getClient();
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
