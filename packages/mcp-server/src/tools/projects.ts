import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import { z } from "zod";

export function registerProjectTools(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_projects",
    {
      description:
        "List all annotation projects with their status and progress.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .describe("Maximum number of projects to return"),
        cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from a previous request"),
      }),
      _meta: {
        "avala.ai/required-scope": "projects.read",
        "avala.ai/toolset": "projects",
      },
    },
    async ({ limit, cursor }) => {
      const avala = getClient("list_projects");
      const page = await avala.projects.list({ limit, cursor });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(page, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_project",
    {
      description:
        "Get full project details including configuration and current status.",
      inputSchema: z.object({
        uid: z.string().describe("The unique identifier (UUID) of the project"),
      }),
      _meta: {
        "avala.ai/required-scope": "projects.read",
        "avala.ai/toolset": "projects",
      },
    },
    async ({ uid }) => {
      const avala = getClient("get_project");
      const project = await avala.projects.get(uid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(project, null, 2),
          },
        ],
      };
    },
  );
}
