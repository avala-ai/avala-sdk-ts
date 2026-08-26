import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import { z } from "zod";

export function registerStatsTools(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_workspace_stats",
    {
      description:
        "Get a summary of workspace usage including dataset count and project count.",
      inputSchema: z.object({}),
      _meta: {
        "avala.ai/required-scopes": [
          "datasets.read",
          "projects.read",
          "exports.read",
        ],
        "avala.ai/toolset": "workspace",
      },
    },
    async () => {
      const avala = getClient("get_workspace_stats");
      const [datasets, projects, exports] = await Promise.all([
        avala.datasets.list({ limit: 1 }),
        avala.projects.list({ limit: 1 }),
        avala.exports.list({ limit: 1 }),
      ]);

      const stats = {
        datasets: { count: datasets.items.length, hasMore: datasets.hasMore },
        projects: { count: projects.items.length, hasMore: projects.hasMore },
        exports: { count: exports.items.length, hasMore: exports.hasMore },
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );
}
