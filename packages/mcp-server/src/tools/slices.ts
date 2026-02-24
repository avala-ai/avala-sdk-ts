import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerSliceTools(server: McpServer, avala: Avala): void {
  server.tool(
    "list_slices",
    "List slices for an owner (user or organization).",
    {
      owner: z.string().describe("Owner name (user or organization slug)"),
      limit: z.number().optional().describe("Maximum number of slices to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ owner, limit, cursor }) => {
      const page = await avala.slices.list(owner, { limit, cursor });
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
    "get_slice",
    "Get detailed information about a specific slice.",
    {
      owner: z.string().describe("Owner name (user or organization slug)"),
      slug: z.string().describe("The slug of the slice"),
    },
    async ({ owner, slug }) => {
      const slice = await avala.slices.get(owner, slug);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(slice, null, 2),
          },
        ],
      };
    }
  );
}
