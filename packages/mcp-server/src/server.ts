import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { registerAgentTools } from "./tools/agents.js";
import { registerAnnotationIssueTools } from "./tools/annotationIssues.js";
import { registerConsensusTools } from "./tools/consensus.js";
import { registerDatasetTools } from "./tools/datasets.js";
import { registerExportTools } from "./tools/exports.js";
import { registerOrganizationTools } from "./tools/organizations.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerQualityTools } from "./tools/quality.js";
import { registerSliceTools } from "./tools/slices.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerWebhookTools } from "./tools/webhooks.js";

export function registerTools(server: McpServer, avala: Avala): void {
  registerDatasetTools(server, avala);
  registerProjectTools(server, avala);
  registerExportTools(server, avala);
  registerStatsTools(server, avala);
  registerTaskTools(server, avala);
  registerAgentTools(server, avala);
  registerAnnotationIssueTools(server, avala);
  registerWebhookTools(server, avala);
  registerStorageTools(server, avala);
  registerQualityTools(server, avala);
  registerConsensusTools(server, avala);
  registerOrganizationTools(server, avala);
  registerSliceTools(server, avala);
}
