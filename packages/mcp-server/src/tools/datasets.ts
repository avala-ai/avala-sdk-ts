import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerDatasetTools(server: McpServer, avala: Avala): void {
  server.tool(
    "list_datasets",
    "List all datasets in your workspace with their IDs, names, and asset counts.",
    {
      limit: z.number().optional().describe("Maximum number of datasets to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ limit, cursor }) => {
      const page = await avala.datasets.list({ limit, cursor });
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

  server.tool(
    "get_dataset",
    "Get detailed information about a specific dataset including its data type and item count.",
    {
      uid: z.string().describe("The unique identifier (UUID) of the dataset"),
    },
    async ({ uid }) => {
      const dataset = await avala.datasets.get(uid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(dataset, null, 2),
          },
        ],
      };
    }
  );
}
