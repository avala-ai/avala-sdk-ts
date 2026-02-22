import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala/sdk";
import { registerDatasetTools } from "./tools/datasets.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerExportTools } from "./tools/exports.js";
import { registerStatsTools } from "./tools/stats.js";

export function registerTools(server: McpServer, avala: Avala): void {
  registerDatasetTools(server, avala);
  registerProjectTools(server, avala);
  registerExportTools(server, avala);
  registerStatsTools(server, avala);
}
