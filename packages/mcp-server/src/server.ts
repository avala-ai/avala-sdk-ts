import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "./client.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerAnnotationIssueTools } from "./tools/annotationIssues.js";
import { registerConsensusTools } from "./tools/consensus.js";
import { registerDatasetTools } from "./tools/datasets.js";
import { registerExportTools } from "./tools/exports.js";
import { registerFleetTools } from "./tools/fleet.js";
import { registerOrganizationTools } from "./tools/organizations.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerQualityTools } from "./tools/quality.js";
import { registerSliceTools } from "./tools/slices.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerWebhookTools } from "./tools/webhooks.js";
import { registerWorkflowTools } from "./tools/workflows.js";

export interface McpServerOptions {
  allowMutations: boolean;
}

export interface ToolRegistrar {
  readonly category: string;
  readonly register: (server: McpServer, getClient: GetClient, options: McpServerOptions) => void;
}

export type { GetClient } from "./client.js";

/**
 * The one ordered registry used by both the server and generated docs.
 *
 * Keeping category metadata beside the executable registrar prevents a new
 * registration style (for example declarative `registerTool`) from silently
 * disappearing from documentation that only knows how to grep `server.tool`.
 */
export const TOOL_REGISTRARS: readonly ToolRegistrar[] = [
  {
    category: "datasets",
    register: (server, getClient, options): void => registerDatasetTools(server, getClient, options.allowMutations),
  },
  { category: "projects", register: (server, getClient): void => registerProjectTools(server, getClient) },
  { category: "stats", register: (server, getClient): void => registerStatsTools(server, getClient) },
  { category: "tasks", register: (server, getClient): void => registerTaskTools(server, getClient) },
  {
    category: "agents",
    register: (server, getClient, options): void => registerAgentTools(server, getClient, options.allowMutations),
  },
  {
    category: "annotationIssues",
    register: (server, getClient, options): void =>
      registerAnnotationIssueTools(server, getClient, options.allowMutations),
  },
  {
    category: "webhooks",
    register: (server, getClient, options): void => registerWebhookTools(server, getClient, options.allowMutations),
  },
  {
    category: "storage",
    register: (server, getClient, options): void => registerStorageTools(server, getClient, options.allowMutations),
  },
  {
    category: "exports",
    register: (server, getClient, options): void => registerExportTools(server, getClient, options.allowMutations),
  },
  {
    category: "quality",
    register: (server, getClient, options): void => registerQualityTools(server, getClient, options.allowMutations),
  },
  {
    category: "consensus",
    register: (server, getClient, options): void => registerConsensusTools(server, getClient, options.allowMutations),
  },
  {
    category: "fleet",
    register: (server, getClient, options): void => registerFleetTools(server, getClient, options.allowMutations),
  },
  {
    category: "organizations",
    register: (server, getClient): void => registerOrganizationTools(server, getClient),
  },
  { category: "slices", register: (server, getClient): void => registerSliceTools(server, getClient) },
  {
    category: "workflows",
    register: (server, getClient, options): void => registerWorkflowTools(server, getClient, options.allowMutations),
  },
];

/**
 * Register the full tool catalog on `server`.
 *
 * Tools obtain their Avala client per invocation via `getClient` (never at
 * registration time), so the same catalog serves both transports: stdio passes
 * a singleton-returning closure, while the Streamable HTTP entry passes a
 * closure over the incoming request's credential. See `src/client.ts`.
 */
export function registerTools(
  server: McpServer,
  getClient: GetClient,
  options: McpServerOptions = { allowMutations: false },
): void {
  for (const registrar of TOOL_REGISTRARS) {
    registrar.register(server, getClient, options);
  }
}
