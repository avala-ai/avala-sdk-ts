import {
  registerOperationProposalTools,
  OPERATION_PROPOSAL_COMMAND_NAMES,
} from "./tools/operationProposals.js";
import { McpServer } from "@modelcontextprotocol/server";
import packageJson from "../package.json" with { type: "json" };
import type { GetClient } from "./client.js";
import {
  createAssetHandleService,
  registerAssetResolverTool,
  type AssetHandleService,
} from "./assetHandles.js";
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
import { registerBillingTools } from "./tools/billing.js";
import { registerWorkforceTools } from "./tools/workforce.js";
import { registerWorkforceSessionMonitoringTools } from "./tools/workforceSessionMonitoring.js";
import { enforceEgressScrubbing } from "./egress.js";
import {
  observeHostedInvocations,
  type HostedInvocationOptions,
} from "./readAudit.js";
import {
  createMutationConfirmationService,
  type MutationConfirmationService,
} from "./mutations.js";
import {
  scopeServerForCredential,
  type CredentialToolGrant,
} from "./visibility.js";

export interface McpServerOptions {
  allowMutations: boolean;
  /** Request-local metadata only; absent for local stdio. */
  hostedInvocation?: HostedInvocationOptions;
  /** Exact reviewed mutation names for credential-scoped hosted MCP. */
  allowedMutationTools?: ReadonlySet<string>;
  /** Omit for local stdio; hosted HTTP always supplies the discovered grant. */
  credentialGrant?: CredentialToolGrant;
  /** Non-secret keyed digest of the current API key or OAuth subject. */
  credentialBinding?: string;
  /** Stable secret material for stateless handles; never included in a handle. */
  assetHandleKeyMaterial?: string | Uint8Array;
  /** Internal injection point used to share one codec across all registrars. */
  assetHandles?: AssetHandleService;
  /** Internal injection point for deterministic confirmation tests. */
  mutationConfirmation?: MutationConfirmationService;
}

export const REVIEWED_HOSTED_MUTATION_TOOLS: ReadonlySet<string> = new Set([
  ...OPERATION_PROPOSAL_COMMAND_NAMES,
  "change_workforce_batch_allocation",
  "change_workforce_group_membership",
  "create_workforce_batch",
  "set_workforce_batch_priority",
  "set_workforce_batch_status",
  "set_workforce_sequence_status",
]);

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
  "Dispatch uses durable operation proposals: select an exact unit and candidate, create and evaluate, then request independent human approval through approval.reviewPath on the configured API origin. MCP cannot approve and elicitation is not approval. Preserve proposal UID/version. execute_approved_operation queues work; verify_operation must confirm current observations before claiming success. Historical verified state may coexist with current changed verification. reverse_operation only records a BLOCKED child; it does not cancel work.",
  "After a legacy workforce action, preserve operationEventUid and call get_workforce_operation_event; report the effect as verified only when its explicit verification status supports that claim. Use list_workforce_operation_events only when a receipt UID must be discovered, preserve every filter across pages, and never treat an empty result as proof that no change occurred.",
  "Media and export reads return opaque asset handles instead of bearer URLs; resolve_asset_handle uses protocol elicitation and releases a URL only after confirmation.",
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
    category: "billing",
    register: (server, getClient): void =>
      registerBillingTools(server, getClient),
  },
  {
    category: "workforceSessionMonitoring",
    register: (server, getClient): void => registerWorkforceSessionMonitoringTools(server, getClient),
  },
  {
    category: "datasets",
    register: (server, getClient, options): void =>
      registerDatasetTools(
        server,
        getClient,
        options.allowMutations,
        options.assetHandles,
      ),
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
      registerExportTools(
        server,
        getClient,
        options.allowMutations,
        options.assetHandles,
      ),
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
    register: (server, getClient, options): void =>
      registerOrganizationTools(server, getClient, options.assetHandles),
  },
  {
    category: "slices",
    register: (server, getClient, options): void =>
      registerSliceTools(server, getClient, options.assetHandles),
  },
  {
    category: "assets",
    register: (server, getClient, options): void =>
      registerAssetResolverTool(
        server,
        getClient,
        options.assetHandles ?? createAssetHandleService(),
        options.credentialGrant,
      ),
  },
  {
    category: "workflows",
    register: (server, getClient, options): void =>
      registerWorkflowTools(server, getClient, options.allowMutations),
  },
  {
    category: "workforce",
    register: (server, getClient, options): void => {
      const enabled =
        options.allowMutations ||
        options.allowedMutationTools?.has(
          "change_workforce_batch_allocation",
        ) === true ||
        options.allowedMutationTools?.has(
          "change_workforce_group_membership",
        ) === true ||
        options.allowedMutationTools?.has("create_workforce_batch") === true ||
        options.allowedMutationTools?.has("set_workforce_batch_priority") ===
          true ||
        options.allowedMutationTools?.has("set_workforce_batch_status") ===
          true ||
        options.allowedMutationTools?.has("set_workforce_sequence_status") ===
          true;
      registerWorkforceTools(
        server,
        getClient,
        enabled
          ? {
              confirmation:
                options.mutationConfirmation ??
                createMutationConfirmationService(
                  options.assetHandleKeyMaterial,
                ),
              credentialBinding: options.credentialBinding ?? "local-stdio",
            }
          : undefined,
        options.allowMutations ? undefined : options.allowedMutationTools,
      );
    },
  },
  {
    category: "operationProposals",
    register: (server, getClient, options): void =>
      registerOperationProposalTools(
        server,
        getClient,
        options.allowMutations || options.allowedMutationTools || false,
      ),
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
  if (options.hostedInvocation && !options.credentialGrant) {
    throw new Error(
      "Hosted invocation telemetry requires credential-scoped registration.",
    );
  }
  if (options.allowMutations && options.credentialGrant) {
    throw new Error(
      "Credential-scoped MCP registration must use the reviewed mutation allowlist.",
    );
  }
  for (const toolName of options.allowedMutationTools ?? []) {
    if (!REVIEWED_HOSTED_MUTATION_TOOLS.has(toolName)) {
      throw new Error(
        `Credential-scoped MCP mutation '${toolName}' is not reviewed.`,
      );
    }
  }
  if (
    options.credentialGrant &&
    (options.allowedMutationTools?.size ?? 0) > 0 &&
    !options.credentialBinding
  ) {
    throw new Error(
      "Credential-scoped MCP mutations require a caller binding.",
    );
  }
  // Every registrar passes through scrubbing. Invocation telemetry is beneath
  // that registration facade so it observes the scrubbed handler's result.
  const assetHandles =
    options.assetHandles ??
    createAssetHandleService(options.assetHandleKeyMaterial);
  const runtimeOptions: McpServerOptions = {
    allowMutations: options.allowMutations,
    ...(options.credentialGrant
      ? { credentialGrant: options.credentialGrant }
      : {}),
    ...(options.allowedMutationTools
      ? { allowedMutationTools: options.allowedMutationTools }
      : {}),
    ...(options.credentialBinding
      ? { credentialBinding: options.credentialBinding }
      : {}),
    assetHandles,
    mutationConfirmation:
      options.mutationConfirmation ??
      createMutationConfirmationService(options.assetHandleKeyMaterial),
  };
  const observedServer = options.hostedInvocation
    ? observeHostedInvocations(
        server,
        options.hostedInvocation,
        REVIEWED_HOSTED_MUTATION_TOOLS,
      )
    : server;
  const scrubbedServer = enforceEgressScrubbing(observedServer);
  const registrationServer = options.credentialGrant
    ? scopeServerForCredential(scrubbedServer, options.credentialGrant)
    : scrubbedServer;
  for (const registrar of TOOL_REGISTRARS) {
    registrar.register(registrationServer, getClient, runtimeOptions);
  }
}
