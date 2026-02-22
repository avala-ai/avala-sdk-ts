import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala/sdk";
import { z } from "zod";

export function registerProjectTools(server: McpServer, avala: Avala): void {
  server.tool(
    "list_projects",
    "List all annotation projects with their status and progress.",
    {
      limit: z.number().optional().describe("Maximum number of projects to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ limit, cursor }) => {
      const page = await avala.projects.list({ limit, cursor });
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
    "get_project",
    "Get full project details including configuration and current status.",
    {
      uid: z.string().describe("The unique identifier (UUID) of the project"),
    },
    async ({ uid }) => {
      const project = await avala.projects.get(uid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(project, null, 2),
          },
        ],
      };
    }
  );
}
