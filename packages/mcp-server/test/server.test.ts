import { describe, it, expect, vi } from "vitest";
import toolsetScopes from "../toolset-scopes.json";
import type { HostedInvocationEvent } from "../src/readAudit.js";
import {
  registerTools,
  REVIEWED_HOSTED_MUTATION_TOOLS,
} from "../src/server.js";
import {
  scopeServerForCredential,
  type CredentialToolGrant,
} from "../src/visibility.js";

/**
 * The full catalog size with mutations enabled. The hosted (HTTP) transport
 * registers tools through the same `registerTools`, so this count is the
 * stdio/HTTP parity baseline: if it moves, both transports moved together.
 */
const FULL_TOOL_COUNT = 108;
const HOSTED_READ_TOOL_COUNT = 48;
const STAFF_TOOL_COUNT = 27;
const SIGNED_EXPORT_URL =
  "https://bucket.s3.amazonaws.com/export.zip" +
  "?X-Amz-Date=20260829T080000Z&X-Amz-Expires=3600" +
  "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260829%2Fus-west-2%2Fs3%2Faws4_request" +
  "&X-Amz-Signature=abcdef0123456789abcdef0123456789";

function fullCredentialGrant(): CredentialToolGrant {
  return {
    scopes: new Set(Object.values(toolsetScopes).flat()),
    toolsets: new Set(Object.keys(toolsetScopes)),
    isStaffPrivileged: false,
  };
}

// The staff sandbox toolset is deliberately absent from toolset-scopes.json
// (discovery grants it via is_staff_privileged, never via scope intersection),
// so the staff grant is composed here rather than derived from the manifest.
function staffCredentialGrant(): CredentialToolGrant {
  const base = fullCredentialGrant();
  return {
    scopes: new Set([
      ...base.scopes,
      "mcp.query",
      "workforce.read",
      "workforce.write",
    ]),
    toolsets: new Set([...base.toolsets, "staff"]),
    isStaffPrivileged: true,
  };
}

function createMockServer() {
  const names: string[] = [];
  const handlers = new Map<
    string,
    (args: Record<string, unknown>, context?: unknown) => Promise<unknown>
  >();
  const register = (
    name: string,
    handler: (
      args: Record<string, unknown>,
      context?: unknown,
    ) => Promise<unknown>,
  ) => {
    names.push(name);
    handlers.set(name, handler);
    return {
      remove: () => {
        const index = names.indexOf(name);
        if (index >= 0) names.splice(index, 1);
        handlers.delete(name);
      },
    };
  };
  return {
    names,
    registerTool: vi.fn(
      (
        name: string,
        _config: unknown,
        handler: (
          args: Record<string, unknown>,
          context?: unknown,
        ) => Promise<unknown>,
      ) => {
        return register(name, handler);
      },
    ),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

describe("MCP server", () => {
  it.each([
    ["create_agent", { name: "agent", events: ["task.completed"], callbackUrl: "https://example.invalid/hook" }, "agents", "create", "apiKey"],
    ["create_webhook", { name: "hook", url: "https://example.invalid/hook", events: ["task.completed"] }, "webhooks", "create", "secret"],
    ["fleet_register_device", { name: "robot", type: "robot" }, "devices", "register", "deviceToken"],
    ["create_storage_config", { name: "storage", provider: "s3" }, "storageConfigs", "create", "s3SecretAccessKey"],
  ] as const)("scrubs opaque credentials from the registered %s handler", async (tool, args, resource, method, key) => {
    const server = createMockServer();
    const payload = { uid: "synthetic-resource", name: "resource", [key]: "synthetic-one-time-value", metadata: { tokenCount: 12 } };
    const operation = vi.fn().mockResolvedValue(payload);
    const client = resource === "devices"
      ? { fleet: { devices: { [method]: operation } } }
      : { [resource]: { [method]: operation } };
    registerTools(server as never, (() => client) as never, { allowMutations: true });
    const result = await server.getHandler(tool)!(args) as { content: { text: string }[] };
    expect(operation).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("synthetic-one-time-value");
    expect(result.content[0]!.text).toContain('"uid": "synthetic-resource"');
    expect(result.content[0]!.text).toContain('"tokenCount": 12');
    expect(payload[key]).toBe("synthetic-one-time-value");
  });

  it("observes the entire hosted catalog and classifies unannotated and write-scoped reads", async () => {
    const server = createMockServer();
    const events: HostedInvocationEvent[] = [];
    registerTools(
      server as never,
      () => {
        throw new Error("private provider error");
      },
      {
        allowMutations: false,
        credentialGrant: staffCredentialGrant(),
        allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
        credentialBinding: "private-binding",
        hostedInvocation: {
          credentialKind: "api_key",
          observer: (event) => {
            events.push(event);
          },
        },
      },
    );
    await Promise.allSettled(
      server.names.map(async (name) => server.getHandler(name)!({})),
    );
    expect(events.map((event) => event.tool).sort()).toEqual(
      [...server.names].sort(),
    );
    expect(
      events
        .filter((event) => event.operationKind === "mutation")
        .map((event) => event.tool)
        .sort(),
    ).toEqual([
      "change_workforce_batch_allocation",
      "change_workforce_group_membership",
      "create_workforce_batch",
      "set_workforce_batch_priority",
      "set_workforce_batch_status",
      "set_workforce_sequence_status",
    ]);
    for (const tool of [
      "get_workspace_overview",
      "get_project_quality_summary",
      "get_workforce_operation_event",
    ]) {
      expect(events.find((event) => event.tool === tool)?.operationKind).toBe(
        "read",
      );
    }
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("observes a real unannotated customer composite's degraded text return", async () => {
    const server = createMockServer();
    const events: HostedInvocationEvent[] = [];
    const unavailable = async () => {
      throw new Error("private upstream failure");
    };
    registerTools(
      server as never,
      (() => ({
        organizations: { list: unavailable },
        datasets: { list: unavailable },
        projects: { listMine: unavailable },
        exports: { list: unavailable },
      })) as never,
      {
        allowMutations: false,
        credentialGrant: fullCredentialGrant(),
        hostedInvocation: {
          credentialKind: "api_key",
          observer: (event) => {
            events.push(event);
          },
        },
      },
    );
    const result = await server.getHandler("get_workspace_overview")!({});
    expect(result).toHaveProperty("content");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tool: "get_workspace_overview",
      operationKind: "read",
      outcome: "degraded",
    });
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("classifies proposal commands independently from proposal observation reads", async () => {
    const server = createMockServer();
    const events: HostedInvocationEvent[] = [];
    const grant = staffCredentialGrant();
    registerTools(
      server as never,
      () => {
        throw new Error("no writes in this test");
      },
      {
        allowMutations: false,
        credentialGrant: {
          ...grant,
          scopes: new Set([
            ...grant.scopes,
            "operations.proposal.read",
            "operations.proposal.create",
            "operations.approval.request",
            "operations.execution.request",
            "operations.verification.read",
          ]),
        },
        allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
        credentialBinding: "private-binding",
        hostedInvocation: {
          credentialKind: "oauth",
          observer: (event) => {
            events.push(event);
          },
        },
      },
    );
    await Promise.allSettled(
      server.names.map(async (name) => server.getHandler(name)!({})),
    );
    expect(
      events
        .filter((event) => event.operationKind === "mutation")
        .map((event) => event.tool)
        .sort(),
    ).toEqual([
      "create_operation_proposal",
      "evaluate_operation_proposal",
      "execute_approved_operation",
      "request_operation_approval",
      "reverse_operation",
    ]);
    for (const tool of [
      "get_operation_proposal",
      "verify_operation",
      "list_operation_events",
    ]) {
      expect(events.find((event) => event.tool === tool)?.operationKind).toBe(
        "read",
      );
    }
    expect(() =>
      registerTools(
        createMockServer() as never,
        () => {
          throw new Error();
        },
        {
          allowMutations: true,
          hostedInvocation: { credentialKind: "oauth" },
        },
      ),
    ).toThrow("requires credential-scoped registration");
  });

  it("registers the full catalog when mutations are enabled", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: true,
    });
    expect(server.names).toHaveLength(FULL_TOOL_COUNT);
    expect(new Set(server.names).size).toBe(FULL_TOOL_COUNT);
    expect(server.names).toContain("resolve_asset_handle");
  });

  it("lists the full read catalog locally and defers authorization to providers", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never);
    expect(server.names).toHaveLength(
      HOSTED_READ_TOOL_COUNT + STAFF_TOOL_COUNT + 3 + 2, // SQL + billing
    );
    expect(server.names).toContain("staff_query");
    expect(server.names).toContain("staff_aggregate");
    expect(server.names).toContain("staff_describe_table");
    expect(server.names).toContain("get_workforce_operations_overview");
    expect(server.names).toContain("list_coworker_training_candidates");
    expect(server.names).toContain("list_blocked_onboarding_coworkers");
    expect(server.names).toContain(
      "list_workforce_training_cohort_evidence",
    );
    expect(server.names).toContain("get_workforce_coworker_reliability");
    expect(server.names).toContain("get_coworker_journey");
    expect(server.names).toContain("list_workforce_batches");
    expect(server.names).toContain("get_workforce_dispatch_health");
    expect(server.names).toContain("get_workforce_dispatch_observations");
    expect(server.names).toContain("get_workforce_dispatch_outcomes");
    expect(server.names).toContain("list_workforce_operation_events");
    expect(server.names).toContain("get_workforce_operation_event");
    expect(server.names).toContain("list_workforce_groups");
    expect(server.names).toContain("list_workforce_group_members");
    expect(server.names).toContain(
      "preview_workforce_group_membership_impact",
    );
    expect(server.names).toContain("get_workforce_batch_attention");
    expect(server.names).toContain("list_workforce_batch_units");
    expect(server.names).toContain("get_workforce_sequence_status");
    expect(server.names).toContain("get_workforce_session_monitoring");
    expect(server.names).toContain("get_workforce_station_monitoring");
    expect(server.names).toContain("list_workforce_assignment_candidates");
    expect(server.names).toContain(
      "list_workforce_batch_staffing_candidates",
    );
    expect(server.names).toContain("list_workforce_batch_coworker_activity");
    expect(server.names).toContain(
      "preview_workforce_batch_allocation_impact",
    );
  });

  it("registers the complete hosted read catalog for a fully eligible credential", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: fullCredentialGrant(),
    });
    expect(server.names).toHaveLength(HOSTED_READ_TOOL_COUNT);
    expect(new Set(server.names).size).toBe(HOSTED_READ_TOOL_COUNT);
    expect(server.names).toContain("resolve_asset_handle");
    expect(server.names).not.toContain("staff_query");
  });

  it("lists the staff sandbox proxies only for a staff-privileged grant", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: staffCredentialGrant(),
    });
    expect(server.names).toHaveLength(HOSTED_READ_TOOL_COUNT + STAFF_TOOL_COUNT);
    expect(server.names).toContain("staff_query");
    expect(server.names).toContain("staff_aggregate");
    expect(server.names).toContain("staff_describe_table");
    expect(server.names).toContain("get_workforce_operations_overview");
    expect(server.names).toContain("list_coworker_training_candidates");
    expect(server.names).toContain("list_blocked_onboarding_coworkers");
    expect(server.names).toContain(
      "list_workforce_training_cohort_evidence",
    );
    expect(server.names).toContain("get_workforce_coworker_reliability");
    expect(server.names).toContain("get_coworker_journey");
    expect(server.names).toContain("list_workforce_batches");
    expect(server.names).toContain("get_workforce_dispatch_health");
    expect(server.names).toContain("get_workforce_dispatch_observations");
    expect(server.names).toContain("get_workforce_dispatch_outcomes");
    expect(server.names).toContain("list_workforce_operation_events");
    expect(server.names).toContain("get_workforce_operation_event");
    expect(server.names).toContain("list_workforce_groups");
    expect(server.names).toContain("list_workforce_group_members");
    expect(server.names).toContain(
      "preview_workforce_group_membership_impact",
    );
    expect(server.names).toContain("get_workforce_batch_attention");
    expect(server.names).toContain("list_workforce_batch_units");
    expect(server.names).toContain("get_workforce_sequence_status");
    expect(server.names).toContain("get_workforce_session_monitoring");
    expect(server.names).toContain("get_workforce_station_monitoring");
    expect(server.names).toContain("list_workforce_assignment_candidates");
    expect(server.names).toContain(
      "list_workforce_batch_staffing_candidates",
    );
    expect(server.names).toContain("list_workforce_batch_coworker_activity");
    expect(server.names).toContain(
      "preview_workforce_batch_allocation_impact",
    );
  });

  it("hides the staff sandbox proxies when the toolset is granted without the staff privilege", () => {
    const server = createMockServer();
    const base = staffCredentialGrant();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: { ...base, isStaffPrivileged: false },
    });
    expect(server.names).toHaveLength(HOSTED_READ_TOOL_COUNT);
    expect(server.names).not.toContain("staff_query");
    expect(server.names).not.toContain("staff_aggregate");
    expect(server.names).not.toContain("staff_describe_table");
    expect(server.names).not.toContain("get_workforce_operations_overview");
    expect(server.names).not.toContain("list_coworker_training_candidates");
    expect(server.names).not.toContain("list_blocked_onboarding_coworkers");
    expect(server.names).not.toContain(
      "list_workforce_training_cohort_evidence",
    );
    expect(server.names).not.toContain("get_workforce_coworker_reliability");
    expect(server.names).not.toContain("get_coworker_journey");
    expect(server.names).not.toContain("list_workforce_batches");
    expect(server.names).not.toContain("get_workforce_dispatch_health");
    expect(server.names).not.toContain("get_workforce_dispatch_outcomes");
    expect(server.names).not.toContain("list_workforce_operation_events");
    expect(server.names).not.toContain("get_workforce_operation_event");
    expect(server.names).not.toContain("list_workforce_groups");
    expect(server.names).not.toContain("list_workforce_group_members");
    expect(server.names).not.toContain(
      "preview_workforce_group_membership_impact",
    );
    expect(server.names).not.toContain("get_workforce_batch_attention");
    expect(server.names).not.toContain("list_workforce_batch_units");
    expect(server.names).not.toContain("get_workforce_sequence_status");
    expect(server.names).not.toContain("get_workforce_session_monitoring");
    expect(server.names).not.toContain("get_workforce_station_monitoring");
    expect(server.names).not.toContain("list_workforce_assignment_candidates");
    expect(server.names).not.toContain(
      "list_workforce_batch_staffing_candidates",
    );
    expect(server.names).not.toContain(
      "list_workforce_batch_coworker_activity",
    );
    expect(server.names).not.toContain(
      "preview_workforce_batch_allocation_impact",
    );
  });

  it("hides the staff sandbox proxies when the toolset is granted without mcp.query", () => {
    const server = createMockServer();
    const base = staffCredentialGrant();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: {
        scopes: new Set([...base.scopes].filter((s) => s !== "mcp.query")),
        toolsets: base.toolsets,
        isStaffPrivileged: true,
      },
    });
    expect(server.names).not.toContain("staff_query");
    expect(server.names).not.toContain("staff_aggregate");
    expect(server.names).not.toContain("staff_describe_table");
    expect(server.names).toContain("get_workforce_operations_overview");
    expect(server.names).toContain("list_coworker_training_candidates");
    expect(server.names).toContain("list_blocked_onboarding_coworkers");
    expect(server.names).toContain(
      "list_workforce_training_cohort_evidence",
    );
    expect(server.names).toContain("get_workforce_coworker_reliability");
    expect(server.names).toContain("get_coworker_journey");
    expect(server.names).toContain("list_workforce_batches");
    expect(server.names).toContain("get_workforce_dispatch_health");
    expect(server.names).toContain("get_workforce_dispatch_outcomes");
    expect(server.names).toContain("list_workforce_operation_events");
    expect(server.names).toContain("get_workforce_operation_event");
    expect(server.names).toContain("list_workforce_groups");
    expect(server.names).toContain("list_workforce_group_members");
    expect(server.names).toContain(
      "preview_workforce_group_membership_impact",
    );
    expect(server.names).toContain("get_workforce_batch_attention");
    expect(server.names).toContain("list_workforce_batch_units");
    expect(server.names).toContain("get_workforce_sequence_status");
    expect(server.names).toContain("get_workforce_session_monitoring");
    expect(server.names).toContain("get_workforce_station_monitoring");
    expect(server.names).toContain("list_workforce_assignment_candidates");
    expect(server.names).toContain(
      "list_workforce_batch_staffing_candidates",
    );
    expect(server.names).toContain("list_workforce_batch_coworker_activity");
    expect(server.names).toContain(
      "preview_workforce_batch_allocation_impact",
    );
  });

  it("hides workforce reads without the exact workforce scope", () => {
    const server = createMockServer();
    const base = staffCredentialGrant();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: {
        scopes: new Set(
          [...base.scopes].filter((scope) => scope !== "workforce.read"),
        ),
        toolsets: base.toolsets,
        isStaffPrivileged: true,
      },
    });
    expect(server.names).not.toContain("get_workforce_operations_overview");
    expect(server.names).not.toContain("list_coworker_training_candidates");
    expect(server.names).not.toContain("list_blocked_onboarding_coworkers");
    expect(server.names).not.toContain(
      "list_workforce_training_cohort_evidence",
    );
    expect(server.names).toContain("get_workforce_coworker_reliability");
    expect(server.names).not.toContain("get_coworker_journey");
    expect(server.names).not.toContain("list_workforce_batches");
    expect(server.names).not.toContain("get_workforce_dispatch_health");
    expect(server.names).not.toContain("get_workforce_dispatch_outcomes");
    expect(server.names).toContain("list_workforce_operation_events");
    expect(server.names).toContain("get_workforce_operation_event");
    expect(server.names).not.toContain("get_workforce_batch_attention");
    expect(server.names).not.toContain("list_workforce_batch_units");
    expect(server.names).not.toContain("get_workforce_sequence_status");
    expect(server.names).not.toContain("get_workforce_session_monitoring");
    expect(server.names).not.toContain("get_workforce_station_monitoring");
    expect(server.names).toContain("list_workforce_assignment_candidates");
    expect(server.names).toContain(
      "list_workforce_batch_staffing_candidates",
    );
    expect(server.names).toContain("list_workforce_batch_coworker_activity");
    expect(server.names).toContain(
      "preview_workforce_batch_allocation_impact",
    );
    expect(server.names).toContain("list_workforce_groups");
    expect(server.names).toContain("list_workforce_group_members");
    expect(server.names).toContain(
      "preview_workforce_group_membership_impact",
    );
  });

  it("hides write-scoped workforce planning reads without the exact workforce write scope", () => {
    const server = createMockServer();
    const base = staffCredentialGrant();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: {
        scopes: new Set(
          [...base.scopes].filter((scope) => scope !== "workforce.write"),
        ),
        toolsets: base.toolsets,
        isStaffPrivileged: true,
      },
    });
    expect(server.names).toContain("get_workforce_operations_overview");
    expect(server.names).toContain("list_coworker_training_candidates");
    expect(server.names).toContain("list_blocked_onboarding_coworkers");
    expect(server.names).toContain(
      "list_workforce_training_cohort_evidence",
    );
    expect(server.names).not.toContain("get_workforce_coworker_reliability");
    expect(server.names).toContain("get_coworker_journey");
    expect(server.names).toContain("list_workforce_batches");
    expect(server.names).toContain("get_workforce_dispatch_health");
    expect(server.names).toContain("get_workforce_dispatch_outcomes");
    expect(server.names).not.toContain("list_workforce_operation_events");
    expect(server.names).not.toContain("get_workforce_operation_event");
    expect(server.names).toContain("get_workforce_batch_attention");
    expect(server.names).toContain("list_workforce_batch_units");
    expect(server.names).toContain("get_workforce_sequence_status");
    expect(server.names).toContain("get_workforce_session_monitoring");
    expect(server.names).toContain("get_workforce_station_monitoring");
    expect(server.names).not.toContain("list_workforce_groups");
    expect(server.names).not.toContain("list_workforce_group_members");
    expect(server.names).not.toContain(
      "preview_workforce_group_membership_impact",
    );
    expect(server.names).not.toContain("list_workforce_assignment_candidates");
    expect(server.names).not.toContain(
      "list_workforce_batch_staffing_candidates",
    );
    expect(server.names).not.toContain(
      "list_workforce_batch_coworker_activity",
    );
    expect(server.names).not.toContain(
      "preview_workforce_batch_allocation_impact",
    );
  });

  it("filters declarative reads by exact scope and toolset", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: {
        scopes: new Set(["datasets.read"]),
        toolsets: new Set(["datasets", "quality", "sequences"]),
        isStaffPrivileged: false,
      },
    });

    expect(server.names).toContain("list_datasets");
    expect(server.names).toContain("list_sequences");
    expect(server.names).toContain("get_frame");
    expect(server.names).toContain("get_calibration");
    expect(server.names).toContain("resolve_asset_handle");
    expect(server.names).toContain("get_result_acceptance");
    expect(server.names).toContain("preview_curation_candidates");
    expect(server.names).not.toContain("list_projects");
    expect(server.names).not.toContain("list_quality_targets");
    expect(server.names).not.toContain("get_project_quality_summary");
    expect(server.names).not.toContain("get_workspace_overview");
  });

  it("shows the resolver when any one declared asset scope is granted", () => {
    for (const [scope, toolset] of [
      ["datasets.read", "datasets"],
      ["organizations.read", "organizations"],
      ["slices.read", "slices"],
      ["exports.read", "exports"],
    ] as const) {
      const server = createMockServer();
      registerTools(server as never, (() => ({})) as never, {
        allowMutations: false,
        credentialGrant: {
          scopes: new Set([scope]),
          toolsets: new Set([toolset]),
          isStaffPrivileged: false,
        },
      });
      expect(server.names, `${scope} / ${toolset}`).toContain(
        "resolve_asset_handle",
      );
    }
  });

  it("exposes no authenticated tools for an empty credential grant", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      credentialGrant: {
        scopes: new Set(),
        toolsets: new Set(["docs", "public"]),
        isStaffPrivileged: false,
      },
    });
    expect(server.names).toEqual([]);
  });

  it("fails closed when a hosted registration lacks a visibility contract", () => {
    const scoped = scopeServerForCredential(
      createMockServer() as never,
      fullCredentialGrant(),
    );

    expect(() =>
      scoped.registerTool("missing_metadata", {}, async () => ({
        content: [],
      })),
    ).toThrow("missing authorization metadata");
  });

  it("refuses the broad stdio mutation switch for credential-scoped hosted MCP", () => {
    const server = createMockServer();
    expect(() =>
      registerTools(server as never, (() => ({})) as never, {
        allowMutations: true,
        credentialGrant: fullCredentialGrant(),
      }),
    ).toThrow("must use the reviewed mutation allowlist");
    expect(server.names).toEqual([]);
  });

  it("exposes only the reviewed mutations to an eligible staff credential", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
      credentialGrant: staffCredentialGrant(),
      credentialBinding: "staff-credential-binding",
      assetHandleKeyMaterial: "hosted-server-key",
    });

    expect(server.names).toHaveLength(
      HOSTED_READ_TOOL_COUNT + STAFF_TOOL_COUNT + 6,
    );
    expect(server.names).not.toContain("assign_workforce_work_unit");
    expect(server.names).toContain("change_workforce_batch_allocation");
    expect(server.names).toContain("change_workforce_group_membership");
    expect(server.names).toContain("create_workforce_batch");
    expect(server.names).not.toContain("deassign_workforce_work_unit");
    expect(server.names).toContain("set_workforce_batch_priority");
    expect(server.names).toContain("set_workforce_batch_status");
    expect(server.names).toContain("set_workforce_sequence_status");
  });

  it("exposes only an explicitly requested reviewed mutation subset", () => {
    const server = createMockServer();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      allowedMutationTools: new Set(["set_workforce_batch_priority"]),
      credentialGrant: staffCredentialGrant(),
      credentialBinding: "staff-credential-binding",
      assetHandleKeyMaterial: "hosted-server-key",
    });

    expect(server.names).toHaveLength(
      HOSTED_READ_TOOL_COUNT + STAFF_TOOL_COUNT + 1,
    );
    expect(server.names).toContain("set_workforce_batch_priority");
    expect(server.names).not.toContain("assign_workforce_work_unit");
    expect(server.names).not.toContain("change_workforce_batch_allocation");
    expect(server.names).not.toContain("change_workforce_group_membership");
    expect(server.names).not.toContain("create_workforce_batch");
    expect(server.names).not.toContain("deassign_workforce_work_unit");
    expect(server.names).not.toContain("set_workforce_batch_status");
    expect(server.names).not.toContain("set_workforce_sequence_status");
  });

  it("hides the reviewed mutations without the exact write scope", () => {
    const server = createMockServer();
    const grant = staffCredentialGrant();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
      credentialGrant: {
        ...grant,
        scopes: new Set(
          [...grant.scopes].filter((scope) => scope !== "workforce.write"),
        ),
      },
      credentialBinding: "staff-credential-binding",
      assetHandleKeyMaterial: "hosted-server-key",
    });

    expect(server.names).not.toContain("set_workforce_batch_priority");
    expect(server.names).not.toContain("set_workforce_batch_status");
    expect(server.names).not.toContain("set_workforce_sequence_status");
    expect(server.names).not.toContain("assign_workforce_work_unit");
    expect(server.names).not.toContain("change_workforce_batch_allocation");
    expect(server.names).not.toContain("change_workforce_group_membership");
    expect(server.names).not.toContain("create_workforce_batch");
    expect(server.names).not.toContain("deassign_workforce_work_unit");
  });

  it("fails closed for an unreviewed tool or missing credential binding", () => {
    const server = createMockServer();
    expect(() =>
      registerTools(server as never, (() => ({})) as never, {
        allowMutations: false,
        allowedMutationTools: new Set(["delete_everything"]),
        credentialGrant: staffCredentialGrant(),
        credentialBinding: "staff-credential-binding",
      }),
    ).toThrow("is not reviewed");
    expect(() =>
      registerTools(server as never, (() => ({})) as never, {
        allowMutations: false,
        allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
        credentialGrant: staffCredentialGrant(),
      }),
    ).toThrow("require a caller binding");
  });

  it("does not call getClient at registration time", () => {
    const server = createMockServer();
    const getClient = vi.fn(() => ({}));
    registerTools(server as never, getClient as never, {
      allowMutations: true,
    });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("resolves the client per invocation, not per registration", async () => {
    const server = createMockServer();
    const page = (uid: string) => ({
      items: [{ uid, name: uid, slug: uid, itemCount: 0, dataType: "image" }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });
    const clientA = {
      transport: { requestPage: vi.fn().mockResolvedValue(page("from-a")) },
    };
    const clientB = {
      transport: { requestPage: vi.fn().mockResolvedValue(page("from-b")) },
    };
    let current: unknown = clientA;
    const getClient = vi.fn(() => current);
    registerTools(server as never, getClient as never, {
      allowMutations: false,
    });

    const handler = server.getHandler("list_datasets")!;

    const first = (await handler({})) as { content: { text: string }[] };
    expect(first.content[0]!.text).toContain("from-a");

    // Swap the client between calls — the tool must pick up the new one,
    // proving it never captured a client at registration time.
    current = clientB;
    const second = (await handler({})) as { content: { text: string }[] };
    expect(second.content[0]!.text).toContain("from-b");

    expect(clientA.transport.requestPage).toHaveBeenCalledTimes(1);
    expect(clientB.transport.requestPage).toHaveBeenCalledTimes(1);
    expect(getClient).toHaveBeenCalledTimes(2);
    expect(getClient).toHaveBeenNthCalledWith(1, "list_datasets");
    expect(getClient).toHaveBeenNthCalledWith(2, "list_datasets");
  });

  it("shares one stateless handle codec between asset-producing tools and the resolver", async () => {
    const server = createMockServer();
    const exportRecord = {
      uid: "export-1",
      name: "training-export",
      format: "json",
      filterQueryString: null,
      totalTaskCount: 1,
      exportedTaskCount: 1,
      downloadUrl: SIGNED_EXPORT_URL,
      status: "completed",
      datasets: ["dataset-1"],
      slices: [],
      projects: [],
      createdAt: "2026-08-29T08:00:00Z",
    };
    const requestPage = vi.fn().mockResolvedValue({
      items: [exportRecord],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });
    const requestSingle = vi.fn().mockResolvedValue(exportRecord);
    const getPermissions = vi.fn().mockResolvedValue({
      scopes: ["exports.read"],
    });
    registerTools(
      server as never,
      (() => ({
        transport: { requestPage, requestSingle },
        permissions: { get: getPermissions },
      })) as never,
      {
        allowMutations: false,
        assetHandleKeyMaterial: "shared-server-test-key",
      },
    );

    const listed = (await server.getHandler("list_exports")!({
      detail: "full",
    })) as {
      structuredContent: {
        items: { downloadAsset: { handle: string } }[];
      };
      content: { text: string }[];
    };
    const handle = listed.structuredContent.items[0]!.downloadAsset.handle;
    expect(handle).toMatch(/^ah_/);
    expect(listed.content[0]!.text).not.toContain("X-Amz-Credential");

    const resolved = (await server.getHandler("resolve_asset_handle")!(
      { handle },
      {
        mcpReq: {
          envelope: undefined,
          inputResponses: undefined,
          requestState: () => undefined,
          elicitInput: vi.fn().mockResolvedValue({
            action: "accept",
            content: { confirm: true },
          }),
        },
      },
    )) as { structuredContent: { url: string; expiresAt: string } };
    expect(resolved.structuredContent).toEqual({
      url: SIGNED_EXPORT_URL,
      expiresAt: "2026-08-29T09:00:00.000Z",
    });
    expect(requestSingle).toHaveBeenCalledWith("/exports/export-1/");
    expect(getPermissions).toHaveBeenCalledTimes(2);
  });
});
