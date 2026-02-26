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

export interface McpServerOptions {
  allowMutations: boolean;
}

export function registerTools(
  server: McpServer,
  avala: Avala,
  options: McpServerOptions = { allowMutations: false },
): void {
  registerDatasetTools(server, avala, options.allowMutations);
  registerProjectTools(server, avala);
  registerStatsTools(server, avala);
  registerTaskTools(server, avala);
  registerAgentTools(server, avala, options.allowMutations);
  registerAnnotationIssueTools(server, avala, options.allowMutations);
  registerWebhookTools(server, avala, options.allowMutations);
  registerStorageTools(server, avala, options.allowMutations);
  registerExportTools(server, avala, options.allowMutations);
  registerQualityTools(server, avala, options.allowMutations);
  registerConsensusTools(server, avala, options.allowMutations);
  registerOrganizationTools(server, avala);
  registerSliceTools(server, avala);
}
