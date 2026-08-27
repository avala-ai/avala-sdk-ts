import { McpServer } from "@modelcontextprotocol/server";
import packageJson from "../package.json" with { type: "json" };
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
import { registerStaffTools } from "./tools/staff.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerWebhookTools } from "./tools/webhooks.js";
import { registerWorkflowTools } from "./tools/workflows.js";
import {
  scopeServerForCredential,
  type CredentialToolGrant,
} from "./visibility.js";

export interface McpServerOptions {
  allowMutations: boolean;
  /** Omit for local stdio; hosted HTTP always supplies the discovered grant. */
  credentialGrant?: CredentialToolGrant;
}

export interface ToolRegistrar {
  readonly category: string;
  readonly register: (
    server: McpServer,
    getClient: GetClient,
    options: McpServerOptions,
  ) => void;
}

export type { GetClient } from "./client.js";

const SERVER_INSTRUCTIONS = [
  "Manage the Avala Physical AI data loop through tenant-safe REST-backed tools.",
  "Inspect resources before changing them, use the narrowest available tool, and preserve returned identifiers for follow-up calls.",
  "The product MCP at mcp.avala.ai is distinct from the public documentation MCP at avala.ai/docs/mcp.",
].join(" ");

/** Build one transport-neutral server instance for either supported protocol era. */
export function createAvalaMcpServer(
  getClient: GetClient,
  options: McpServerOptions = { allowMutations: false },
): McpServer {
  const server = new McpServer(
    { name: "avala", version: packageJson.version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, getClient, options);
  return server;
}

/**
 * The one ordered registry used by both the server and generated docs.
 *
 * Keeping category metadata beside the executable registrar prevents a new
 * registration style from silently disappearing from generated documentation.
 */
export const TOOL_REGISTRARS: readonly ToolRegistrar[] = [
  {
    category: "datasets",
    register: (server, getClient, options): void =>
      registerDatasetTools(server, getClient, options.allowMutations),
  },
  {
    category: "projects",
    register: (server, getClient): void =>
      registerProjectTools(server, getClient),
  },
  {
    category: "stats",
    register: (server, getClient): void =>
      registerStatsTools(server, getClient),
  },
  {
    category: "tasks",
    register: (server, getClient): void => registerTaskTools(server, getClient),
  },
  {
    category: "agents",
    register: (server, getClient, options): void =>
      registerAgentTools(server, getClient, options.allowMutations),
  },
  {
    category: "annotationIssues",
    register: (server, getClient, options): void =>
      registerAnnotationIssueTools(server, getClient, options.allowMutations),
  },
  {
    category: "webhooks",
    register: (server, getClient, options): void =>
      registerWebhookTools(server, getClient, options.allowMutations),
  },
  {
    category: "storage",
    register: (server, getClient, options): void =>
      registerStorageTools(server, getClient, options.allowMutations),
  },
  {
    category: "exports",
    register: (server, getClient, options): void =>
      registerExportTools(server, getClient, options.allowMutations),
  },
  {
    category: "quality",
    register: (server, getClient, options): void =>
      registerQualityTools(server, getClient, options.allowMutations),
  },
  {
    category: "consensus",
    register: (server, getClient, options): void =>
      registerConsensusTools(server, getClient, options.allowMutations),
  },
  {
    category: "fleet",
    register: (server, getClient, options): void =>
      registerFleetTools(server, getClient, options.allowMutations),
  },
  {
    category: "organizations",
    register: (server, getClient): void =>
      registerOrganizationTools(server, getClient),
  },
  {
    category: "slices",
    register: (server, getClient): void =>
      registerSliceTools(server, getClient),
  },
  {
    category: "workflows",
    register: (server, getClient, options): void =>
      registerWorkflowTools(server, getClient, options.allowMutations),
  },
  {
    category: "staff",
    register: (server, getClient, options): void =>
      registerStaffTools(server, getClient, options),
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
  if (options.allowMutations && options.credentialGrant) {
    throw new Error(
      "Credential-scoped MCP registration cannot expose mutations before confirmation support exists.",
    );
  }
  const registrationServer = options.credentialGrant
    ? scopeServerForCredential(server, options.credentialGrant)
    : server;
  for (const registrar of TOOL_REGISTRARS) {
    registrar.register(registrationServer, getClient, options);
  }
}
