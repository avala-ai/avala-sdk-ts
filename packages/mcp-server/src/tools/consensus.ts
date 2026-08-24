import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "../client.js";
import { defineReadCatalogTool, registerReadCatalogTool } from "../catalog.js";
import { z } from "zod";

const consensusSummaryOutputSchema = z
  .object({
    meanScore: z.number(),
    medianScore: z.number(),
    minScore: z.number(),
    maxScore: z.number(),
    totalItems: z.number(),
    itemsWithConsensus: z.number(),
    scoreDistribution: z.record(z.unknown()),
    byTaskName: z.array(z.unknown()),
  })
  .passthrough();

const getConsensusSummaryTool = defineReadCatalogTool({
  name: "get_consensus_summary",
  title: "Get consensus summary",
  description: "Get a consensus summary for a project including mean/median scores and distribution.",
  inputSchema: z.object({
    projectUid: z.string().describe("The unique identifier (UUID) of the project"),
  }),
  outputSchema: consensusSummaryOutputSchema,
  route: {
    name: "consensus-summary",
    method: "GET",
    path: "/projects/{projectUid}/consensus/",
    response: "single",
    scope: "qc.read",
    toolset: "consensus",
  },
});

export const CONSENSUS_READ_CATALOG_TOOLS = [getConsensusSummaryTool] as const;

export function registerConsensusTools(server: McpServer, getClient: GetClient, allowMutations = false): void {
  registerReadCatalogTool(server, getClient, getConsensusSummaryTool);

  if (allowMutations) {
    server.tool(
      "compute_consensus",
      "Trigger consensus computation for a project.",
      {
        projectUid: z.string().describe("The unique identifier (UUID) of the project"),
      },
      async ({ projectUid }) => {
        const avala = getClient();
        const result = await avala.consensus.compute(projectUid);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
    );
  }
}
