import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerTaskTools(server: McpServer, avala: Avala): void {
  server.tool(
    "list_tasks",
    "List tasks with optional filtering by project or status.",
    {
      project: z.string().optional().describe("Filter by project UID"),
      status: z.string().optional().describe("Filter by task status"),
      limit: z.number().optional().describe("Maximum number of tasks to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ project, status, limit, cursor }) => {
      const page = await avala.tasks.list({ project, status, limit, cursor });
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
    "get_task",
    "Get detailed information about a specific task.",
    {
      uid: z.string().describe("The unique identifier (UUID) of the task"),
    },
    async ({ uid }) => {
      const task = await avala.tasks.get(uid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(task, null, 2),
          },
        ],
      };
    }
  );
}
