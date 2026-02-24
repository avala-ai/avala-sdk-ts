import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerConsensusTools(server: McpServer, avala: Avala): void {
  server.tool(
    "get_consensus_summary",
    "Get a consensus summary for a project including mean/median scores and distribution.",
    {
      projectUid: z.string().describe("The unique identifier (UUID) of the project"),
    },
    async ({ projectUid }) => {
      const summary = await avala.consensus.getSummary(projectUid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "compute_consensus",
    "Trigger consensus computation for a project.",
    {
      projectUid: z.string().describe("The unique identifier (UUID) of the project"),
    },
    async ({ projectUid }) => {
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
