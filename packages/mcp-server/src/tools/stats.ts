import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";

export function registerStatsTools(server: McpServer, avala: Avala): void {
  server.tool(
    "get_workspace_stats",
    "Get a summary of workspace usage including dataset count and project count.",
    {},
    async () => {
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
    }
  );
}
