import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerQualityTools(server: McpServer, avala: Avala, allowMutations = false): void {
  server.tool(
    "list_quality_targets",
    "List quality targets configured for a specific project.",
    {
      projectUid: z.string().describe("The unique identifier (UUID) of the project"),
      limit: z.number().optional().describe("Maximum number of quality targets to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ projectUid, limit, cursor }) => {
      const page = await avala.qualityTargets.list(projectUid, { limit, cursor });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(page, null, 2),
          },
        ],
      };
    }
  );

  if (allowMutations) {
    server.tool(
      "evaluate_quality",
      "Evaluate all quality targets for a project and return their current status.",
      {
        projectUid: z.string().describe("The unique identifier (UUID) of the project to evaluate"),
      },
      async ({ projectUid }) => {
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
