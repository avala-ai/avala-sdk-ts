import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GetClient } from "../client.js";
import {
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import {
  defineMutationCatalogTool,
  registerMutationCatalogTool,
  type MutationRegistrationOptions,
} from "../mutations.js";

const nonnegativeCount = z.number().int().nonnegative();
const compactUuidOutputSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/, "Expected a compact UUID");
const batchUidInputSchema = z
  .string()
  .regex(
    /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
    "Expected a compact or canonical UUID",
  );
const workflowStatusIdSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Expected a workflow status identifier",
  );
const workUnitStatusSchema = z.enum([
  "unavailable",
  "backlog",
  "in_progress",
  "in_review",
  "completed",
  "error",
]);
const workflowRoleSchema = z.enum([
  "first_pass",
  "review",
  "escalation",
  "unspecified",
]);
const workUnitTaskNameSchema = z.enum([
  "box",
  "cuboid",
  "polyline 2d",
  "polyline 4d",
  "calibration",
]);
const batchCreationWorkflowRoleSchema = z.enum([
  "first_pass",
  "review",
  "escalation",
]);
const workforceLineContextOutputSchema = z
  .object({
    organizationUid: compactUuidOutputSchema.nullable(),
    projectUid: compactUuidOutputSchema.nullable(),
    datasetUid: compactUuidOutputSchema.nullable(),
    sequenceUid: compactUuidOutputSchema.nullable(),
  })
  .strip();
const workforceLineContextInputSchema = z
  .object({
    organizationUid: batchUidInputSchema.nullable(),
    projectUid: batchUidInputSchema.nullable(),
    datasetUid: batchUidInputSchema.nullable(),
    sequenceUid: batchUidInputSchema.nullable(),
  })
  .strict();
const actionableWorkforceLineContextInputSchema =
  workforceLineContextInputSchema.extend({
    organizationUid: batchUidInputSchema,
  });

function describeWorkforceLineContext(context: {
  organizationUid: string;
  projectUid: string | null;
  datasetUid: string | null;
  sequenceUid: string | null;
}): string {
  return (
    `organization=${context.organizationUid}, ` +
    `project=${context.projectUid ?? "none"}, ` +
    `dataset=${context.datasetUid ?? "none"}, ` +
    `sequence=${context.sequenceUid ?? "none"}`
  );
}

const accountStatusOutputSchema = z
  .object({
    active: nonnegativeCount,
    inactive: nonnegativeCount,
  })
  .strip();

const onboardingOutputSchema = z
  .object({
    joinedInWindow: nonnegativeCount,
    loggedInInWindow: nonnegativeCount,
    neverLoggedIn: nonnegativeCount,
    phoneVerified: nonnegativeCount,
    phoneUnverified: nonnegativeCount,
    missingProfile: nonnegativeCount,
  })
  .strip();

const workRolesOutputSchema = z
  .object({
    assignee: nonnegativeCount,
    reviewer: nonnegativeCount,
    dataCollection: nonnegativeCount,
  })
  .strip();

const coworkersOutputSchema = z
  .object({
    total: nonnegativeCount,
    accountStatus: accountStatusOutputSchema,
    onboarding: onboardingOutputSchema,
    workRoles: workRolesOutputSchema,
  })
  .strip();

const sessionsOutputSchema = z
  .object({
    createdInWindow: nonnegativeCount,
    workersInWindow: nonnegativeCount,
    byStatus: z
      .object({
        pending: nonnegativeCount,
        ready: nonnegativeCount,
        assigned: nonnegativeCount,
        finished: nonnegativeCount,
        abandoned: nonnegativeCount,
      })
      .strip(),
    expiredAssigned: nonnegativeCount,
  })
  .strip();

const workUnitStatusOutputSchema = z
  .object({
    unavailable: nonnegativeCount,
    backlog: nonnegativeCount,
    inProgress: nonnegativeCount,
    inReview: nonnegativeCount,
    completed: nonnegativeCount,
    error: nonnegativeCount,
  })
  .strip();

const workQueuesOutputSchema = z
  .object({
    batchesByStatus: z
      .object({
        available: nonnegativeCount,
        unavailable: nonnegativeCount,
        archived: nonnegativeCount,
      })
      .strip(),
    unitsByStatus: workUnitStatusOutputSchema,
    unassignedBacklog: nonnegativeCount,
    attentionBatches: z
      .array(
        z
          .object({
            batchUid: compactUuidOutputSchema,
            batchStatus: z.literal("available"),
            priority: z.enum(["medium", "high"]),
            errorUnits: nonnegativeCount,
            inReviewUnits: nonnegativeCount,
          })
          .strip(),
      )
      .max(25),
  })
  .strip();

const workforceBatchAttentionOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    batchUid: compactUuidOutputSchema,
    batchStatus: z.enum(["available", "unavailable", "archived"]),
    priority: z.enum(["medium", "high"]),
    unitsByStatus: workUnitStatusOutputSchema,
    unitsByRole: z
      .object({
        firstPass: workUnitStatusOutputSchema,
        review: workUnitStatusOutputSchema,
        escalation: workUnitStatusOutputSchema,
        unspecified: workUnitStatusOutputSchema,
      })
      .strip(),
    queueAge: z
      .object({
        oldestBacklogUpdatedAt: z
          .object({
            firstPass: z.string().datetime({ offset: true }).nullable(),
            review: z.string().datetime({ offset: true }).nullable(),
            escalation: z.string().datetime({ offset: true }).nullable(),
            unspecified: z.string().datetime({ offset: true }).nullable(),
          })
          .strip(),
        oldestErrorUpdatedAt: z.string().datetime({ offset: true }).nullable(),
      })
      .strip(),
    attention: z
      .object({
        errorUnits: nonnegativeCount,
        reviewBacklogUnits: nonnegativeCount,
        escalationBacklogUnits: nonnegativeCount,
      })
      .strip(),
  })
  .strip();

const workforceOperationsOverviewOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    window: z
      .object({
        days: z.number().int().min(1).max(90),
        startsAt: z.string().datetime({ offset: true }),
      })
      .strip(),
    coworkers: coworkersOutputSchema,
    sessions: sessionsOutputSchema,
    workQueues: workQueuesOutputSchema,
    attention: z
      .array(
        z
          .object({
            code: z.enum([
              "errored_work_units",
              "expired_assigned_sessions",
              "in_review_work_units",
            ]),
            severity: z.enum(["blocking", "warning"]),
            count: nonnegativeCount,
            remediation: z.string(),
          })
          .strip(),
      )
      .max(3),
  })
  .strip();

const workforceBatchInventoryOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    batches: z
      .array(
        z
          .object({
            batchUid: compactUuidOutputSchema,
            batchStatus: z.enum(["available", "unavailable", "archived"]),
            priority: z.enum(["medium", "high"]),
            lineContext: workforceLineContextOutputSchema,
            unitsByStatus: workUnitStatusOutputSchema,
            createdAt: z.string().datetime({ offset: true }),
            updatedAt: z.string().datetime({ offset: true }),
          })
          .strip(),
      )
      .max(100),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip();

const workforceGroupCatalogOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    groups: z
      .array(
        z
          .object({
            groupUid: compactUuidOutputSchema,
            name: z.string().min(1).max(150),
            memberCounts: z
              .object({
                coworkers: nonnegativeCount,
                activeCoworkers: nonnegativeCount,
                activeApprovedCoworkers: nonnegativeCount,
              })
              .strip(),
          })
          .strip(),
      )
      .max(100),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip();

const workforceGroupMemberReadinessOutputSchema = z
  .object({
    active: z.boolean(),
    approved: z.boolean(),
    hasActiveWork: z.boolean(),
  })
  .strip();

const workforceGroupMembersOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    groupUid: compactUuidOutputSchema,
    members: z
      .array(
        z
          .object({
            coworkerUid: compactUuidOutputSchema,
            displayName: z.string().min(1).max(150),
            readiness: workforceGroupMemberReadinessOutputSchema,
          })
          .strip(),
      )
      .max(100),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip();

const workforceGroupMembershipImpactOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    operation: z.enum(["add", "remove"]),
    groupUid: compactUuidOutputSchema,
    coworkerUid: compactUuidOutputSchema,
    currentMembership: z.boolean(),
    readiness: workforceGroupMemberReadinessOutputSchema,
    effect: z
      .object({
        scope: z.literal("global_group"),
        mayAffectPlatformCapabilities: z.literal(true),
        wouldChangeMembership: z.boolean(),
        coworkerReadyForNewWork: z.boolean(),
        assignedInProgressGroupWorkUnits: nonnegativeCount,
        removalBlockedByActiveGroupWork: z.boolean(),
      })
      .strip(),
    affectedBatchesByStatus: z
      .object({
        available: nonnegativeCount,
        unavailable: nonnegativeCount,
        archived: nonnegativeCount,
      })
      .strip(),
    affectedGroupUnitsByStatus: workUnitStatusOutputSchema,
    affectedBatches: z
      .array(
        z
          .object({
            batchUid: compactUuidOutputSchema,
            batchStatus: z.enum(["available", "unavailable", "archived"]),
            lineContext: workforceLineContextOutputSchema,
            groupUnitsByStatus: workUnitStatusOutputSchema,
          })
          .strip(),
      )
      .max(100),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip();

const workforceGroupMembershipExpectedReadinessInputSchema = z
  .object({
    active: z.boolean(),
    approved: z.boolean(),
    hasActiveWork: z.boolean(),
  })
  .strict();

const workforceGroupMembershipExpectedEffectInputSchema = z
  .object({
    scope: z.literal("global_group"),
    mayAffectPlatformCapabilities: z.literal(true),
    wouldChangeMembership: z.literal(true),
    coworkerReadyForNewWork: z.boolean(),
    assignedInProgressGroupWorkUnits: nonnegativeCount,
    removalBlockedByActiveGroupWork: z.literal(false),
  })
  .strict();

const workforceGroupMembershipExpectedBatchStatusInputSchema = z
  .object({
    available: nonnegativeCount,
    unavailable: nonnegativeCount,
    archived: nonnegativeCount,
  })
  .strict();

const workforceGroupMembershipExpectedUnitStatusInputSchema = z
  .object({
    unavailable: nonnegativeCount,
    backlog: nonnegativeCount,
    inProgress: nonnegativeCount,
    inReview: nonnegativeCount,
    completed: nonnegativeCount,
    error: nonnegativeCount,
  })
  .strict();

const workforceBatchUnitsOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    batchUid: compactUuidOutputSchema,
    batchStatus: z.enum(["available", "unavailable", "archived"]),
    lineContext: workforceLineContextOutputSchema,
    units: z
      .array(
        z
          .object({
            workUnitUid: compactUuidOutputSchema,
            status: workUnitStatusSchema,
            taskName: workUnitTaskNameSchema,
            workflowRole: workflowRoleSchema,
            assigned: z.boolean(),
            updatedAt: z.string().datetime({ offset: true }),
          })
          .strip(),
      )
      .max(100),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip();

const workforceSequenceTransitionOutputSchema = z
  .object({
    status: workflowStatusIdSchema,
    label: z.string().min(1).max(100),
    isTerminal: z.boolean(),
  })
  .strip();

const workforceSequenceStatusOutputSchema = z
  .object({
    observedAt: z.string().datetime({ offset: true }),
    sequenceUid: compactUuidOutputSchema,
    datasetUid: compactUuidOutputSchema,
    status: workflowStatusIdSchema,
    statusLabel: z.string().min(1).max(100),
    updatedAt: z.string().datetime({ offset: true }),
    workflowRevisionUid: compactUuidOutputSchema.nullable(),
    transitionMode: z.enum(["sequence", "deliverable"]),
    availableTransitions: z
      .array(workforceSequenceTransitionOutputSchema)
      .max(100),
  })
  .strip();

const workforceAssignmentCandidatesOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    batchUid: compactUuidOutputSchema,
    batchStatus: z.literal("available"),
    lineContext: workforceLineContextOutputSchema.extend({
      organizationUid: compactUuidOutputSchema,
    }),
    workUnitUid: compactUuidOutputSchema,
    workUnitStatus: z.literal("backlog"),
    assigned: z.literal(false),
    updatedAt: z.string().datetime({ offset: true }),
    signalWindow: z
      .object({
        days: z.number().int().min(1).max(90),
        startsAt: z.string().datetime({ offset: true }),
      })
      .strip(),
    signalScope: z
      .object({
        taskName: workUnitTaskNameSchema,
        workflowRole: workflowRoleSchema,
      })
      .strip(),
    candidates: z
      .array(
        z
          .object({
            coworkerUid: compactUuidOutputSchema,
            operationalSignals: z
              .object({
                completedWorkUnits: nonnegativeCount,
                abandonedWorkUnits: nonnegativeCount,
                erroredWorkUnits: nonnegativeCount,
                lastCompletedAt: z
                  .string()
                  .datetime({ offset: true })
                  .nullable(),
              })
              .strip(),
          })
          .strip(),
      )
      .max(100),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip();

const getWorkforceOperationsOverviewTool = defineReadCatalogTool({
  name: "get_workforce_operations_overview",
  title: "Get workforce operations overview",
  description:
    "Staff only: get an aggregate, PII-free snapshot of coworker readiness, sessions, and live work-queue attention signals for the Physical AI data loop.",
  inputSchema: z.object({
    windowDays: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe("Lookback window in days (server default 7, max 90)."),
    attentionLimit: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe("Maximum live batches needing attention (server default 10)."),
  }),
  outputSchema: workforceOperationsOverviewOutputSchema,
  supportsDetail: false,
  route: {
    name: "workforce-operations-overview",
    method: "GET",
    path: "/admin/workforce/overview/",
    query: {
      windowDays: "window_days",
      attentionLimit: "attention_limit",
    },
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
});

const getWorkforceBatchAttentionTool = defineReadCatalogTool({
  name: "get_workforce_batch_attention",
  title: "Get workforce batch attention",
  description:
    "Staff only: drill into one batch from the workforce operations overview using fixed, aggregate role-by-status and queue-age signals. Supports Physical AI labeling and review operations without exposing coworker or work-unit rows.",
  inputSchema: z.object({
    batchUid: batchUidInputSchema.describe(
      "Opaque batch UID returned by get_workforce_operations_overview.",
    ),
  }),
  outputSchema: workforceBatchAttentionOutputSchema,
  supportsDetail: false,
  route: {
    name: "workforce-batch-attention",
    method: "GET",
    path: "/admin/workforce/batches/{batchUid}/attention/",
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
});

const listWorkforceBatchesTool = defineReadCatalogTool({
  name: "list_workforce_batches",
  title: "List workforce batches",
  description:
    "Staff only: enumerate a bounded page of Physical AI labeling production lines with exact organization, project, dataset, sequence, lifecycle, and priority filters. Returns opaque context IDs and raw unit-status counts, never customer or batch names, coworker identity, task payloads, URLs, groups, configuration, comments, or pay data.",
  inputSchema: z
    .object({
      organizationUid: batchUidInputSchema
        .optional()
        .describe("Optional exact organization UID for the production line."),
      projectUid: batchUidInputSchema
        .optional()
        .describe("Optional exact project UID for the production line."),
      datasetUid: batchUidInputSchema
        .optional()
        .describe("Optional exact dataset UID for the production line."),
      sequenceUid: batchUidInputSchema
        .optional()
        .describe("Optional exact sequence UID for the production line."),
      status: z
        .enum(["available", "unavailable", "archived"])
        .optional()
        .describe("Optional exact batch lifecycle status."),
      priority: z
        .enum(["medium", "high"])
        .optional()
        .describe("Optional exact batch priority."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum batches to return (server default 50, max 100)."),
      cursor: batchUidInputSchema
        .optional()
        .describe("Opaque nextCursor from the previous batch page."),
    })
    .strict(),
  outputSchema: workforceBatchInventoryOutputSchema,
  supportsDetail: false,
  route: {
    name: "workforce-batches",
    method: "GET",
    path: "/admin/workforce/batches/",
    query: {
      organizationUid: "organization_uid",
      projectUid: "project_uid",
      datasetUid: "dataset_uid",
      sequenceUid: "sequence_uid",
      status: "status",
      priority: "priority",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
});

const listWorkforceGroupsTool = defineReadCatalogTool({
  name: "list_workforce_groups",
  title: "List workforce groups",
  description:
    "Staff only: discover stable coworker-group UIDs and internal operational labels for reviewed Physical AI batch planning. Requires workforce.write and returns aggregate membership readiness only, never member identities, permission topology, pay, performance, or live capacity.",
  inputSchema: z
    .object({
      search: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .describe("Optional case-insensitive internal group-label search."),
      hasActiveApprovedCoworkers: z
        .boolean()
        .optional()
        .describe(
          "Optional membership-readiness filter. True means the group has at least one active coworker approved under the current waitlist policy; it does not mean that coworker is currently available.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum groups to return (server default 50, max 100)."),
      cursor: batchUidInputSchema
        .optional()
        .describe("Opaque nextCursor from the previous group page."),
    })
    .strict(),
  outputSchema: workforceGroupCatalogOutputSchema,
  supportsDetail: false,
  route: {
    name: "workforce-groups",
    method: "GET",
    path: "/admin/workforce/groups/",
    query: {
      search: "search",
      hasActiveApprovedCoworkers: "has_active_approved_coworkers",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.write",
    toolset: "staff",
  },
});

const listWorkforceGroupMembersTool = defineReadCatalogTool({
  name: "list_workforce_group_members",
  title: "List workforce group members",
  description:
    "Staff only: inspect a bounded, privacy-preserving coworker readiness roster for one operational group before reviewed Physical AI production-line staffing changes. Requires workforce.write and returns only stable coworker UIDs, safe first-name/fallback labels, and active, approved, and active-work booleans; it excludes contact/profile data, last names, permissions, pay, performance, customer payloads, and work details.",
  inputSchema: z
    .object({
      groupUid: batchUidInputSchema.describe(
        "Opaque group UID returned by list_workforce_groups.",
      ),
      active: z
        .boolean()
        .optional()
        .describe("Optional exact account-active filter."),
      approved: z
        .boolean()
        .optional()
        .describe(
          "Optional approval filter under the current coworker waitlist policy.",
        ),
      hasActiveWork: z
        .boolean()
        .optional()
        .describe(
          "Optional filter for an in-progress assignment in an available production line; no work details are returned.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum members to return (server default 50, max 100)."),
      cursor: batchUidInputSchema
        .optional()
        .describe("Opaque nextCursor from the previous member page."),
    })
    .strict(),
  outputSchema: workforceGroupMembersOutputSchema,
  supportsDetail: false,
  route: {
    name: "workforce-group-members",
    method: "GET",
    path: "/admin/workforce/groups/{groupUid}/members/",
    query: {
      active: "active",
      approved: "approved",
      hasActiveWork: "has_active_work",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.write",
    toolset: "staff",
  },
});

const previewWorkforceGroupMembershipImpactTool = defineReadCatalogTool({
  name: "preview_workforce_group_membership_impact",
  title: "Preview workforce group membership impact",
  description:
    "Staff only: preview the global production-line blast radius of adding or removing one coworker from one operational group before any reviewed staffing mutation. Requires workforce.write. This is not batch-scoped allocation: the same global group may affect work eligibility across many organizations and projects and may also affect platform capabilities beyond the listed batches. Returns only opaque line-context UIDs, fixed status counts, readiness, and guardrail booleans; never permissions, customer payloads, work details, contacts, pay, or performance.",
  inputSchema: z
    .object({
      groupUid: batchUidInputSchema.describe(
        "Opaque group UID returned by list_workforce_groups.",
      ),
      coworkerUid: batchUidInputSchema.describe(
        "Opaque coworker UID returned by list_workforce_group_members.",
      ),
      operation: z
        .enum(["add", "remove"])
        .describe("Explicit membership change to preview; no change is applied."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "Maximum affected production lines to return (server default 50, max 100); complete status totals remain global.",
        ),
      cursor: batchUidInputSchema
        .optional()
        .describe("Opaque nextCursor from the previous impact page."),
    })
    .strict(),
  outputSchema: workforceGroupMembershipImpactOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const impact = value as {
      operation: string;
      groupUid: string;
      coworkerUid: string;
    };
    const requestedGroupUid = String(args.groupUid).replaceAll("-", "");
    const requestedCoworkerUid = String(args.coworkerUid).replaceAll("-", "");
    if (
      impact.operation !== args.operation ||
      impact.groupUid !== requestedGroupUid ||
      impact.coworkerUid !== requestedCoworkerUid
    ) {
      throw new Error(
        "Workforce group membership impact response did not match the requested group, coworker, and operation.",
      );
    }
    return value;
  },
  route: {
    name: "workforce-group-membership-impact",
    method: "GET",
    path: "/admin/workforce/groups/{groupUid}/members/{coworkerUid}/impact/",
    query: {
      operation: "operation",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.write",
    toolset: "staff",
  },
});

const listWorkforceBatchUnitsTool = defineReadCatalogTool({
  name: "list_workforce_batch_units",
  title: "List workforce batch units",
  description:
    "Staff only: inspect a bounded page of opaque work-unit state for one Physical AI labeling batch before planning a unit-level operation. Returns whether a unit is assigned, but never coworker identity, task payloads, URLs, groups, or pay data.",
  inputSchema: z
    .object({
      batchUid: batchUidInputSchema.describe(
        "Opaque batch UID returned by a workforce monitoring tool.",
      ),
      status: workUnitStatusSchema
        .optional()
        .describe("Optional exact work-unit lifecycle status."),
      assigned: z
        .boolean()
        .optional()
        .describe("Optional assignment-presence filter; no identity is returned."),
      workflowRole: workflowRoleSchema
        .optional()
        .describe("Optional first-pass, review, escalation, or unspecified role."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum units to return (server default 50, max 100)."),
      cursor: batchUidInputSchema
        .optional()
        .describe("Opaque nextCursor from the previous page."),
    })
    .strict(),
  outputSchema: workforceBatchUnitsOutputSchema,
  supportsDetail: false,
  route: {
    name: "workforce-batch-units",
    method: "GET",
    path: "/admin/workforce/batches/{batchUid}/units/",
    query: {
      status: "status",
      assigned: "assigned",
      workflowRole: "workflow_role",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
});

const getWorkforceSequenceStatusTool = defineReadCatalogTool({
  name: "get_workforce_sequence_status",
  title: "Get workforce sequence status",
  description:
    "Staff only: inspect one Physical AI sequence's exact workflow status, update timestamp, workflow revision, and only the currently authorized next transitions before planning a status change. Supports legacy and custom workflows without exposing sequence contents or workflow definitions; deliverable workflows return transitionMode=deliverable and no legacy sequence edges.",
  inputSchema: z
    .object({
      sequenceUid: batchUidInputSchema.describe(
        "Opaque sequence UID returned by list_workforce_batches or another workforce monitoring tool.",
      ),
    })
    .strict(),
  outputSchema: workforceSequenceStatusOutputSchema,
  supportsDetail: false,
  route: {
    name: "workforce-sequence-status",
    method: "GET",
    path: "/admin/workforce/sequences/{sequenceUid}/status/",
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
});

const listWorkforceAssignmentCandidatesTool = defineReadCatalogTool({
  name: "list_workforce_assignment_candidates",
  title: "List workforce assignment candidates",
  description:
    "Staff only: list a bounded page of opaque coworker IDs currently eligible for one unassigned Physical AI labeling unit, with raw recent completion, abandonment, and error counts scoped to its exact organization, task, and workflow role. Requires workforce.write; returns no ranking or composite score and excludes names, contact details, profiles, group names, pay data, and current work details.",
  inputSchema: z
    .object({
      workUnitUid: batchUidInputSchema.describe(
        "Opaque backlog work-unit UID returned by list_workforce_batch_units.",
      ),
      windowDays: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe(
          "Recent operational-signal window in days (server default 30, max 90).",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum candidates to return (server default 50, max 100)."),
      cursor: batchUidInputSchema
        .optional()
        .describe("Opaque nextCursor from the previous candidate page."),
    })
    .strict(),
  outputSchema: workforceAssignmentCandidatesOutputSchema,
  supportsDetail: false,
  route: {
    name: "workforce-work-unit-assignment-candidates",
    method: "GET",
    path: "/admin/workforce/work-units/{workUnitUid}/assignment-candidates/",
    query: {
      windowDays: "window_days",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.write",
    toolset: "staff",
  },
});

const changeWorkforceGroupMembershipTool = defineMutationCatalogTool({
  name: "change_workforce_group_membership",
  title: "Change workforce group membership",
  description:
    "Staff only: add or remove one coworker from one global operational group after an exact impact preview and explicit human approval. Requires workforce.write, both global-scope acknowledgements, and every current-membership, readiness, effect, batch-count, and group-unit-count field returned by preview_workforce_group_membership_impact. This is not batch-scoped allocation and may affect platform capabilities and work eligibility across many organizations and projects. Known no-ops and removals blocked by active target-group work are refused before approval.",
  inputSchema: z
    .object({
      groupUid: batchUidInputSchema.describe(
        "Exact opaque group UID from preview_workforce_group_membership_impact.",
      ),
      coworkerUid: batchUidInputSchema.describe(
        "Exact opaque coworker UID from preview_workforce_group_membership_impact.",
      ),
      operation: z
        .enum(["add", "remove"])
        .describe("Exact operation used for the reviewed impact preview."),
      expectedCurrentMembership: z
        .boolean()
        .describe("Exact currentMembership returned by the impact preview."),
      expectedReadiness: workforceGroupMembershipExpectedReadinessInputSchema.describe(
        "Exact active, approved, and hasActiveWork state returned by the impact preview.",
      ),
      expectedEffect: workforceGroupMembershipExpectedEffectInputSchema.describe(
        "Exact global-scope effect returned by an actionable impact preview; blocked removals and no-ops are not accepted.",
      ),
      expectedAffectedBatchesByStatus:
        workforceGroupMembershipExpectedBatchStatusInputSchema.describe(
          "Exact complete affectedBatchesByStatus totals returned by the impact preview.",
        ),
      expectedAffectedGroupUnitsByStatus:
        workforceGroupMembershipExpectedUnitStatusInputSchema.describe(
          "Exact complete affectedGroupUnitsByStatus totals returned by the impact preview.",
        ),
      acknowledgeGlobalGroupScope: z
        .literal(true)
        .describe(
          "Must be true: this changes global group membership, not allocation within one batch.",
        ),
      acknowledgePlatformCapabilityImpact: z
        .literal(true)
        .describe(
          "Must be true: this group change may alter platform capabilities beyond listed production lines.",
        ),
      reason: z
        .string()
        .trim()
        .min(8)
        .max(500)
        .describe("Operational reason recorded in the immutable audit ledger."),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.expectedCurrentMembership !== (value.operation === "remove")) {
        context.addIssue({
          code: "custom",
          path: ["expectedCurrentMembership"],
          message:
            "Add requires an observed non-member; remove requires an observed member.",
        });
      }
      const expectedReadyForNewWork =
        value.expectedReadiness.active &&
        value.expectedReadiness.approved &&
        !value.expectedReadiness.hasActiveWork;
      if (
        value.expectedEffect.coworkerReadyForNewWork !==
        expectedReadyForNewWork
      ) {
        context.addIssue({
          code: "custom",
          path: ["expectedEffect", "coworkerReadyForNewWork"],
          message: "Readiness and effect fields must come from one exact preview.",
        });
      }
      if (
        value.operation === "remove" &&
        value.expectedEffect.assignedInProgressGroupWorkUnits !== 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["expectedEffect", "assignedInProgressGroupWorkUnits"],
          message:
            "Deassign active target-group work before removing membership.",
        });
      }
    }),
  outputSchema: z
    .object({
      operationEventUid: compactUuidOutputSchema,
      operation: z.enum(["add", "remove"]),
      groupUid: compactUuidOutputSchema,
      coworkerUid: compactUuidOutputSchema,
      previousMembership: z.boolean(),
      currentMembership: z.boolean(),
      effect: z
        .object({
          scope: z.literal("global_group"),
          mayAffectPlatformCapabilities: z.literal(true),
          membershipChanged: z.literal(true),
        })
        .strip(),
      reason: z.string().min(1).max(500),
      reversalGuidance: z.string().min(1).max(1000),
    })
    .strip(),
  route: {
    name: "workforce-group-membership",
    method: "POST",
    path: "/admin/workforce/groups/{groupUid}/members/{coworkerUid}/membership/",
    scope: "workforce.write",
    toolset: "staff",
    body: ({
      operation,
      expectedCurrentMembership,
      expectedReadiness,
      expectedEffect,
      expectedAffectedBatchesByStatus,
      expectedAffectedGroupUnitsByStatus,
      acknowledgeGlobalGroupScope,
      acknowledgePlatformCapabilityImpact,
      reason,
    }) => ({
      operation,
      expected_current_membership: expectedCurrentMembership,
      expected_readiness: {
        active: expectedReadiness.active,
        approved: expectedReadiness.approved,
        has_active_work: expectedReadiness.hasActiveWork,
      },
      expected_effect: {
        scope: expectedEffect.scope,
        may_affect_platform_capabilities:
          expectedEffect.mayAffectPlatformCapabilities,
        would_change_membership: expectedEffect.wouldChangeMembership,
        coworker_ready_for_new_work:
          expectedEffect.coworkerReadyForNewWork,
        assigned_in_progress_group_work_units:
          expectedEffect.assignedInProgressGroupWorkUnits,
        removal_blocked_by_active_group_work:
          expectedEffect.removalBlockedByActiveGroupWork,
      },
      expected_affected_batches_by_status: {
        available: expectedAffectedBatchesByStatus.available,
        unavailable: expectedAffectedBatchesByStatus.unavailable,
        archived: expectedAffectedBatchesByStatus.archived,
      },
      expected_affected_group_units_by_status: {
        unavailable: expectedAffectedGroupUnitsByStatus.unavailable,
        backlog: expectedAffectedGroupUnitsByStatus.backlog,
        in_progress: expectedAffectedGroupUnitsByStatus.inProgress,
        in_review: expectedAffectedGroupUnitsByStatus.inReview,
        completed: expectedAffectedGroupUnitsByStatus.completed,
        error: expectedAffectedGroupUnitsByStatus.error,
      },
      acknowledge_global_group_scope: acknowledgeGlobalGroupScope,
      acknowledge_platform_capability_impact:
        acknowledgePlatformCapabilityImpact,
      reason,
    }),
  },
  project: (value, args) => {
    const expectedGroupUid = args.groupUid.replaceAll("-", "");
    const expectedCoworkerUid = args.coworkerUid.replaceAll("-", "");
    const expectedNewMembership = args.operation === "add";
    if (
      value.operation !== args.operation ||
      value.groupUid !== expectedGroupUid ||
      value.coworkerUid !== expectedCoworkerUid ||
      value.previousMembership !== args.expectedCurrentMembership ||
      value.currentMembership !== expectedNewMembership ||
      value.reason !== args.reason
    ) {
      throw new Error(
        "Workforce group membership mutation response did not match the approved operation.",
      );
    }
    return value;
  },
  preview: ({
    groupUid,
    coworkerUid,
    operation,
    expectedCurrentMembership,
    expectedReadiness,
    expectedEffect,
    expectedAffectedBatchesByStatus,
    expectedAffectedGroupUnitsByStatus,
    reason,
  }) => ({
    message:
      `${operation === "add" ? "Add" : "Remove"} coworker ${coworkerUid} ${operation === "add" ? "to" : "from"} global group ${groupUid}? ` +
      `This is GLOBAL group membership, not batch-scoped allocation, and may change platform capabilities and work eligibility across organizations and projects. ` +
      `Reviewed membership=${expectedCurrentMembership}; readiness active=${expectedReadiness.active}, approved=${expectedReadiness.approved}, hasActiveWork=${expectedReadiness.hasActiveWork}; ` +
      `readyForNewWork=${expectedEffect.coworkerReadyForNewWork}, activeTargetGroupUnits=${expectedEffect.assignedInProgressGroupWorkUnits}. ` +
      `Affected batches: available=${expectedAffectedBatchesByStatus.available}, unavailable=${expectedAffectedBatchesByStatus.unavailable}, archived=${expectedAffectedBatchesByStatus.archived}. ` +
      `Affected group units: unavailable=${expectedAffectedGroupUnitsByStatus.unavailable}, backlog=${expectedAffectedGroupUnitsByStatus.backlog}, in_progress=${expectedAffectedGroupUnitsByStatus.inProgress}, in_review=${expectedAffectedGroupUnitsByStatus.inReview}, completed=${expectedAffectedGroupUnitsByStatus.completed}, error=${expectedAffectedGroupUnitsByStatus.error}. ` +
      `Both global scope and potential platform-capability impact are acknowledged. Reason: ${reason}`,
  }),
  reversalGuidance: ({ groupUid, coworkerUid, operation }) => {
    const reverseOperation = operation === "add" ? "remove" : "add";
    return `Run preview_workforce_group_membership_impact again for group ${groupUid}, coworker ${coworkerUid}, operation=${reverseOperation}. If the fresh preview is actionable, call change_workforce_group_membership with every newly observed field and obtain separate human approval. Reversal changes membership only; it does not undo work or capability use that occurred meanwhile.`;
  },
});

const createWorkforceBatchTool = defineMutationCatalogTool({
  name: "create_workforce_batch",
  title: "Create workforce batch",
  description:
    "Staff only: create one unavailable, sequence-scoped Physical AI labeling production line with 1–100 backlog work units after explicit human approval. Requires the exact sequence status, update timestamp, and workflow revision returned by get_workforce_sequence_status; the server derives all coworker routes and refuses arbitrary URLs or configuration.",
  inputSchema: z
    .object({
      name: z
        .string()
        .trim()
        .min(1)
        .max(255)
        .describe("Unique operational name for the new work batch."),
      projectUid: batchUidInputSchema
        .nullable()
        .describe(
          "Exact project UID for the Physical AI line, or explicit null for dataset-attributed work.",
        ),
      sequenceUid: batchUidInputSchema.describe(
        "Opaque sequence UID inspected with get_workforce_sequence_status.",
      ),
      expectedSequenceStatus: workflowStatusIdSchema.describe(
        "Exact status returned by the sequence inspection.",
      ),
      expectedSequenceUpdatedAt: z
        .string()
        .datetime({ offset: true })
        .describe("Exact updatedAt timestamp returned by the inspection."),
      expectedWorkflowRevisionUid: batchUidInputSchema
        .nullable()
        .describe(
          "Exact workflowRevisionUid returned by the inspection, including null for the legacy workflow.",
        ),
      workUnits: z
        .array(
          z
            .object({
              taskName: workUnitTaskNameSchema.describe(
                "Physical AI labeling task created for this work unit.",
              ),
              groupUid: batchUidInputSchema.describe(
                "Stable coworker-group UID selected during batch planning.",
              ),
              workflowRole: batchCreationWorkflowRoleSchema
                .optional()
                .describe(
                  "Optional first-pass, review, or escalation role; omit when the unit is not role-specific.",
                ),
            })
            .strict(),
        )
        .min(1)
        .max(100)
        .describe("Exact bounded work-unit plan; one entry creates one unit."),
      reason: z
        .string()
        .trim()
        .min(8)
        .max(500)
        .describe("Operational reason recorded in the immutable audit ledger."),
    })
    .strict(),
  outputSchema: z
    .object({
      batchUid: compactUuidOutputSchema,
      batchStatus: z.literal("unavailable"),
      priority: z.literal("medium"),
      createdAt: z.string().datetime({ offset: true }),
      lineContext: workforceLineContextOutputSchema.extend({
        datasetUid: compactUuidOutputSchema,
        sequenceUid: compactUuidOutputSchema,
      }),
      workUnitsCreated: z.number().int().min(1).max(100),
      sequenceStatus: workflowStatusIdSchema,
      sequenceUpdatedAt: z.string().datetime({ offset: true }),
      workflowRevisionUid: compactUuidOutputSchema.nullable(),
      reason: z.string().max(500),
      reversalGuidance: z.string().min(1).max(1000),
    })
    .strip(),
  route: {
    name: "workforce-batch-create",
    method: "POST",
    path: "/admin/workforce/batches/create/",
    scope: "workforce.write",
    toolset: "staff",
    body: ({
      name,
      projectUid,
      sequenceUid,
      expectedSequenceStatus,
      expectedSequenceUpdatedAt,
      expectedWorkflowRevisionUid,
      workUnits,
      reason,
    }) => ({
      name,
      project_uid: projectUid,
      sequence_uid: sequenceUid,
      expected_sequence_status: expectedSequenceStatus,
      expected_sequence_updated_at: expectedSequenceUpdatedAt,
      expected_workflow_revision_uid: expectedWorkflowRevisionUid,
      work_units: workUnits.map(({ taskName, groupUid, workflowRole }) => ({
        task_name: taskName,
        group_uid: groupUid,
        ...(workflowRole === undefined
          ? {}
          : { workflow_role: workflowRole }),
      })),
      reason,
    }),
  },
  preview: ({
    name,
    projectUid,
    sequenceUid,
    expectedSequenceStatus,
    expectedSequenceUpdatedAt,
    expectedWorkflowRevisionUid,
    workUnits,
    reason,
  }) => {
    const planCounts = new Map<string, number>();
    for (const unit of workUnits) {
      const plan = `${unit.taskName}/${unit.workflowRole ?? "unspecified"}/group ${unit.groupUid}`;
      planCounts.set(plan, (planCounts.get(plan) ?? 0) + 1);
    }
    const planSummary = [...planCounts.entries()]
      .map(([plan, count]) => `${count}x ${plan}`)
      .join("; ");
    return {
      message:
        `Create unavailable work batch ${JSON.stringify(name)} for sequence ${sequenceUid} with ${workUnits.length} backlog work units? ` +
        `Project: ${projectUid ?? "none"}. Inspected sequence state: ${expectedSequenceStatus} at ${expectedSequenceUpdatedAt} under workflow revision ${expectedWorkflowRevisionUid ?? "legacy"}. ` +
        `Plan: ${planSummary}. Reason: ${reason} The server derives exact coworker routes. Creation does not release work; making the batch available requires separate human approval.`,
    };
  },
  reversalGuidance: ({ sequenceUid }) =>
    `Creation for sequence ${sequenceUid} cannot be deleted or automatically reversed through MCP. The batch starts unavailable, so no work is released. Verify it with list_workforce_batches; if it is not needed, keep it unavailable and archive it with a separately approved set_workforce_batch_status call.`,
});

const setWorkforceBatchPriorityTool = defineMutationCatalogTool({
  name: "set_workforce_batch_priority",
  title: "Set workforce batch priority",
  description:
    "Staff only: change one Physical AI labeling work batch between medium and high priority after an explicit human approval. Requires the exact priority observed by get_workforce_batch_attention and refuses stale changes.",
  inputSchema: z.object({
    batchUid: batchUidInputSchema.describe(
      "Opaque batch UID returned by a workforce monitoring tool.",
    ),
    expectedPriority: z
      .enum(["medium", "high"])
      .describe("Exact current priority observed before planning this change."),
    priority: z
      .enum(["medium", "high"])
      .describe("New priority; must differ from expectedPriority."),
    reason: z
      .string()
      .trim()
      .min(8)
      .max(500)
      .describe("Operational reason recorded with the idempotent mutation."),
  }).refine((value) => value.expectedPriority !== value.priority, {
    path: ["priority"],
    message: "New priority must differ from expectedPriority.",
  }),
  outputSchema: z
    .object({
      batchUid: compactUuidOutputSchema,
      batchStatus: z.enum(["available", "unavailable", "archived"]),
      previousPriority: z.enum(["medium", "high"]),
      priority: z.enum(["medium", "high"]),
      reason: z.string().max(500),
      reversalGuidance: z.string().min(1).max(1000),
    })
    .strip(),
  route: {
    name: "workforce-batch-priority",
    method: "POST",
    path: "/admin/workforce/batches/{batchUid}/priority/",
    scope: "workforce.write",
    toolset: "staff",
    body: ({ expectedPriority, priority, reason }) => ({
      expected_priority: expectedPriority,
      priority,
      reason,
    }),
  },
  preview: ({ batchUid, expectedPriority, priority, reason }) => ({
    message:
      `Change work batch ${batchUid} priority from ${expectedPriority} to ${priority}? ` +
      `Reason: ${reason} This can change which available labeling batch coworkers receive first.`,
  }),
  reversalGuidance: ({ batchUid, expectedPriority, priority }) =>
    `Re-read batch ${batchUid}. If its priority is still ${priority}, call set_workforce_batch_priority with expectedPriority=${priority} and priority=${expectedPriority}; that reversal also requires human approval.`,
});

const setWorkforceBatchStatusTool = defineMutationCatalogTool({
  name: "set_workforce_batch_status",
  title: "Set workforce batch status",
  description:
    "Staff only: move one Physical AI labeling production line between available, unavailable, and archived after explicit human approval. Requires the exact lifecycle status observed by list_workforce_batches and refuses stale changes.",
  inputSchema: z
    .object({
      batchUid: batchUidInputSchema.describe(
        "Opaque batch UID returned by list_workforce_batches.",
      ),
      expectedStatus: z
        .enum(["available", "unavailable", "archived"])
        .describe("Exact current lifecycle status observed before planning."),
      status: z
        .enum(["available", "unavailable", "archived"])
        .describe("New lifecycle status; must differ from expectedStatus."),
      reason: z
        .string()
        .trim()
        .min(8)
        .max(500)
        .describe("Operational reason recorded in both audit ledgers."),
    })
    .strict()
    .refine((value) => value.expectedStatus !== value.status, {
      path: ["status"],
      message: "New status must differ from expectedStatus.",
    }),
  outputSchema: z
    .object({
      batchUid: compactUuidOutputSchema,
      previousStatus: z.enum(["available", "unavailable", "archived"]),
      status: z.enum(["available", "unavailable", "archived"]),
      priority: z.enum(["medium", "high"]),
      reason: z.string().max(500),
      reversalGuidance: z.string().min(1).max(1000),
    })
    .strip(),
  route: {
    name: "workforce-batch-status",
    method: "POST",
    path: "/admin/workforce/batches/{batchUid}/status/",
    scope: "workforce.write",
    toolset: "staff",
    body: ({ expectedStatus, status, reason }) => ({
      expected_status: expectedStatus,
      status,
      reason,
    }),
  },
  preview: ({ batchUid, expectedStatus, status, reason }) => {
    const effect =
      status === "available"
        ? "This opens the production line and allows coworkers to claim new backlog units."
        : status === "unavailable"
          ? "This pauses new claims while in-progress work continues."
          : "This archives the production line, removes it from active views, and blocks new claims while in-progress work continues.";
    return {
      message:
        `Change work batch ${batchUid} status from ${expectedStatus} to ${status}? ` +
        `Reason: ${reason} ${effect}`,
    };
  },
  reversalGuidance: ({ batchUid, expectedStatus, status }) =>
    `Re-read batch ${batchUid} with list_workforce_batches. If its status is still ${status}, call set_workforce_batch_status with expectedStatus=${status} and status=${expectedStatus}; that reversal also requires human approval.`,
});

const setWorkforceSequenceStatusTool = defineMutationCatalogTool({
  name: "set_workforce_sequence_status",
  title: "Set workforce sequence status",
  description:
    "Staff only: apply one workflow-authorized status transition to a Physical AI sequence after explicit human approval. Requires the exact status, update timestamp, and workflow revision observed by get_workforce_sequence_status; custom status IDs are supported and stale or unavailable edges are refused.",
  inputSchema: z
    .object({
      sequenceUid: batchUidInputSchema.describe(
        "Opaque sequence UID returned by get_workforce_sequence_status.",
      ),
      expectedStatus: workflowStatusIdSchema.describe(
        "Exact current status returned by the sequence inspection.",
      ),
      expectedUpdatedAt: z
        .string()
        .datetime({ offset: true })
        .describe("Exact updatedAt timestamp returned by the inspection."),
      expectedWorkflowRevisionUid: batchUidInputSchema
        .nullable()
        .describe(
          "Exact workflowRevisionUid returned by the inspection, including null for the legacy workflow.",
        ),
      status: workflowStatusIdSchema.describe(
        "One target status listed in availableTransitions; must differ from expectedStatus.",
      ),
      reason: z
        .string()
        .trim()
        .min(8)
        .max(500)
        .describe("Operational reason recorded in the sequence audit ledgers."),
    })
    .strict()
    .refine((value) => value.expectedStatus !== value.status, {
      path: ["status"],
      message: "New status must differ from expectedStatus.",
    }),
  outputSchema: z
    .object({
      sequenceUid: compactUuidOutputSchema,
      datasetUid: compactUuidOutputSchema,
      previousStatus: workflowStatusIdSchema,
      previousStatusLabel: z.string().min(1).max(100),
      status: workflowStatusIdSchema,
      statusLabel: z.string().min(1).max(100),
      updatedAt: z.string().datetime({ offset: true }),
      workflowRevisionUid: compactUuidOutputSchema.nullable(),
      transitionMode: z.enum(["sequence", "deliverable"]),
      availableTransitions: z
        .array(workforceSequenceTransitionOutputSchema)
        .max(100),
      reason: z.string().max(500),
      reversalGuidance: z.string().min(1).max(1000),
    })
    .strip(),
  route: {
    name: "workforce-sequence-status-transition",
    method: "POST",
    path: "/admin/workforce/sequences/{sequenceUid}/status/transition/",
    scope: "workforce.write",
    toolset: "staff",
    body: ({
      expectedStatus,
      expectedUpdatedAt,
      expectedWorkflowRevisionUid,
      status,
      reason,
    }) => ({
      expected_status: expectedStatus,
      expected_updated_at: expectedUpdatedAt,
      expected_workflow_revision_uid: expectedWorkflowRevisionUid,
      status,
      reason,
    }),
  },
  preview: ({
    sequenceUid,
    expectedStatus,
    expectedUpdatedAt,
    expectedWorkflowRevisionUid,
    status,
    reason,
  }) => ({
    message:
      `Change sequence ${sequenceUid} status from ${expectedStatus} to ${status}? ` +
      `The inspected state was last updated at ${expectedUpdatedAt} under workflow revision ${expectedWorkflowRevisionUid ?? "legacy"}. ` +
      `Reason: ${reason} The server will apply configured workflow rules and may change downstream labeling, review, QC, export, or linked-sequence readiness.`,
  }),
  reversalGuidance: ({ sequenceUid, expectedStatus, status }) =>
    `Re-read sequence ${sequenceUid} with get_workforce_sequence_status. Reverse only if ${expectedStatus} is listed in availableTransitions; then call set_workforce_sequence_status with expectedStatus=${status}, the newly observed expectedUpdatedAt and expectedWorkflowRevisionUid, and status=${expectedStatus}. The reversal requires separate human approval, and some workflow edges are terminal or one-way.`,
});

const deassignWorkforceWorkUnitTool = defineMutationCatalogTool({
  name: "deassign_workforce_work_unit",
  title: "Deassign workforce work unit",
  description:
    "Staff only: clear the current coworker assignment from one in-progress Physical AI labeling unit and return it to backlog after explicit human approval. Requires the exact batch, line context, status, and update timestamp observed by list_workforce_batch_units.",
  inputSchema: z
    .object({
      workUnitUid: batchUidInputSchema.describe(
        "Opaque work-unit UID returned by list_workforce_batch_units.",
      ),
      expectedBatchUid: batchUidInputSchema.describe(
        "Exact batch UID returned with the inspected work unit.",
      ),
      expectedLineContext: actionableWorkforceLineContextInputSchema.describe(
        "Exact organization/project/dataset/sequence UID context returned by the inspection.",
      ),
      expectedStatus: z
        .literal("in_progress")
        .describe("Exact inspected status; deassignment only supports in_progress."),
      expectedUpdatedAt: z
        .string()
        .datetime({ offset: true })
        .describe("Exact updatedAt timestamp returned by the inspection."),
      reason: z
        .string()
        .trim()
        .min(8)
        .max(500)
        .describe("Operational reason recorded in both audit ledgers."),
    })
    .strict(),
  outputSchema: z
    .object({
      batchUid: compactUuidOutputSchema,
      lineContext: workforceLineContextOutputSchema.extend({
        organizationUid: compactUuidOutputSchema,
      }),
      workUnitUid: compactUuidOutputSchema,
      previousStatus: z.literal("in_progress"),
      status: z.literal("backlog"),
      assigned: z.literal(false),
      updatedAt: z.string().datetime({ offset: true }),
      reason: z.string().max(500),
      reversalGuidance: z.string().min(1).max(1000),
    })
    .strip(),
  route: {
    name: "workforce-work-unit-deassign",
    method: "POST",
    path: "/admin/workforce/work-units/{workUnitUid}/deassign/",
    scope: "workforce.write",
    toolset: "staff",
    body: ({
      expectedBatchUid,
      expectedLineContext,
      expectedStatus,
      expectedUpdatedAt,
      reason,
    }) => ({
      expected_batch_uid: expectedBatchUid,
      expected_line_context: {
        organization_uid: expectedLineContext.organizationUid,
        project_uid: expectedLineContext.projectUid,
        dataset_uid: expectedLineContext.datasetUid,
        sequence_uid: expectedLineContext.sequenceUid,
      },
      expected_status: expectedStatus,
      expected_updated_at: expectedUpdatedAt,
      reason,
    }),
  },
  preview: ({
    workUnitUid,
    expectedBatchUid,
    expectedStatus,
    expectedUpdatedAt,
    reason,
  }) => ({
    message:
      `Clear the current coworker assignment from work unit ${workUnitUid} in batch ${expectedBatchUid} ` +
      `and move it from ${expectedStatus} to backlog? The inspected state was last updated at ${expectedUpdatedAt}. ` +
      `Reason: ${reason} This interrupts the current assignment and makes the unit claimable again.`,
  }),
  reversalGuidance: ({ workUnitUid, expectedBatchUid }) =>
    `Deassignment cannot automatically restore the previous coworker because this privacy-preserving tool never receives their identity. Re-read work unit ${workUnitUid} in batch ${expectedBatchUid}; if reassignment is required, use a separately approved assignment control or the staff operations UI.`,
});

const assignWorkforceWorkUnitTool = defineMutationCatalogTool({
  name: "assign_workforce_work_unit",
  title: "Assign workforce work unit",
  description:
    "Staff only: assign one eligible coworker to one backlog Physical AI labeling unit after explicit human approval. Requires the exact batch status, line context, unit state, timestamp, and opaque coworker ID returned by the inspection tools.",
  inputSchema: z
    .object({
      workUnitUid: batchUidInputSchema.describe(
        "Opaque work-unit UID returned by list_workforce_batch_units.",
      ),
      coworkerUid: batchUidInputSchema.describe(
        "Opaque coworker UID returned by list_workforce_assignment_candidates for this exact unit.",
      ),
      expectedBatchUid: batchUidInputSchema.describe(
        "Exact batch UID returned with the inspected work unit.",
      ),
      expectedBatchStatus: z
        .literal("available")
        .describe("Exact inspected batch status; assignment requires available."),
      expectedLineContext: actionableWorkforceLineContextInputSchema.describe(
        "Exact organization/project/dataset/sequence UID context returned by the inspection.",
      ),
      expectedStatus: z
        .literal("backlog")
        .describe("Exact inspected unit status; assignment requires backlog."),
      expectedAssigned: z
        .literal(false)
        .describe("Exact inspected assignment state; assignment requires false."),
      expectedUpdatedAt: z
        .string()
        .datetime({ offset: true })
        .describe("Exact updatedAt timestamp returned by the inspection."),
      reason: z
        .string()
        .trim()
        .min(8)
        .max(500)
        .describe("Operational reason recorded in both audit ledgers."),
    })
    .strict(),
  outputSchema: z
    .object({
      batchUid: compactUuidOutputSchema,
      batchStatus: z.literal("available"),
      lineContext: workforceLineContextOutputSchema.extend({
        organizationUid: compactUuidOutputSchema,
      }),
      workUnitUid: compactUuidOutputSchema,
      coworkerUid: compactUuidOutputSchema,
      previousStatus: z.literal("backlog"),
      status: z.literal("in_progress"),
      assigned: z.literal(true),
      updatedAt: z.string().datetime({ offset: true }),
      reason: z.string().max(500),
      reversalGuidance: z.string().min(1).max(1000),
    })
    .strip(),
  route: {
    name: "workforce-work-unit-assign",
    method: "POST",
    path: "/admin/workforce/work-units/{workUnitUid}/assign/",
    scope: "workforce.write",
    toolset: "staff",
    body: ({
      coworkerUid,
      expectedBatchUid,
      expectedBatchStatus,
      expectedLineContext,
      expectedStatus,
      expectedAssigned,
      expectedUpdatedAt,
      reason,
    }) => ({
      coworker_uid: coworkerUid,
      expected_batch_uid: expectedBatchUid,
      expected_batch_status: expectedBatchStatus,
      expected_line_context: {
        organization_uid: expectedLineContext.organizationUid,
        project_uid: expectedLineContext.projectUid,
        dataset_uid: expectedLineContext.datasetUid,
        sequence_uid: expectedLineContext.sequenceUid,
      },
      expected_status: expectedStatus,
      expected_assigned: expectedAssigned,
      expected_updated_at: expectedUpdatedAt,
      reason,
    }),
  },
  preview: ({
    workUnitUid,
    coworkerUid,
    expectedBatchUid,
    expectedLineContext,
    expectedUpdatedAt,
    reason,
  }) => ({
    message:
      `Assign coworker ${coworkerUid} to work unit ${workUnitUid} in batch ${expectedBatchUid} ` +
      `and move it from backlog to in_progress? The inspected state was last updated at ${expectedUpdatedAt}. ` +
      `Line context: ${describeWorkforceLineContext(expectedLineContext)}. ` +
      `Reason: ${reason} This gives the coworker active work and changes the production queue.`,
  }),
  reversalGuidance: ({ workUnitUid, expectedBatchUid, coworkerUid }) =>
    `Re-read work unit ${workUnitUid} in batch ${expectedBatchUid}. If it is still assigned and in_progress, call deassign_workforce_work_unit with the newly observed state; that reversal requires separate human approval and clears coworker ${coworkerUid} from the unit.`,
});

export const WORKFORCE_READ_CATALOG_TOOLS = [
  getWorkforceOperationsOverviewTool,
  listWorkforceBatchesTool,
  listWorkforceGroupsTool,
  listWorkforceGroupMembersTool,
  previewWorkforceGroupMembershipImpactTool,
  getWorkforceBatchAttentionTool,
  listWorkforceBatchUnitsTool,
  getWorkforceSequenceStatusTool,
  listWorkforceAssignmentCandidatesTool,
] as const;

export const WORKFORCE_MUTATION_CATALOG_TOOLS = [
  changeWorkforceGroupMembershipTool,
  createWorkforceBatchTool,
  setWorkforceBatchPriorityTool,
  setWorkforceBatchStatusTool,
  setWorkforceSequenceStatusTool,
  assignWorkforceWorkUnitTool,
  deassignWorkforceWorkUnitTool,
] as const;

export function registerWorkforceTools(
  server: McpServer,
  getClient: GetClient,
  mutationOptions?: MutationRegistrationOptions,
  allowedMutationTools?: ReadonlySet<string>,
): void {
  registerReadCatalogTool(server, getClient, getWorkforceOperationsOverviewTool);
  registerReadCatalogTool(server, getClient, listWorkforceBatchesTool);
  registerReadCatalogTool(server, getClient, listWorkforceGroupsTool);
  registerReadCatalogTool(server, getClient, listWorkforceGroupMembersTool);
  registerReadCatalogTool(
    server,
    getClient,
    previewWorkforceGroupMembershipImpactTool,
  );
  registerReadCatalogTool(server, getClient, getWorkforceBatchAttentionTool);
  registerReadCatalogTool(server, getClient, listWorkforceBatchUnitsTool);
  registerReadCatalogTool(server, getClient, getWorkforceSequenceStatusTool);
  registerReadCatalogTool(
    server,
    getClient,
    listWorkforceAssignmentCandidatesTool,
  );
  if (mutationOptions) {
    if (
      allowedMutationTools === undefined ||
      allowedMutationTools.has(changeWorkforceGroupMembershipTool.name)
    ) {
      registerMutationCatalogTool(
        server,
        getClient,
        changeWorkforceGroupMembershipTool,
        mutationOptions,
      );
    }
    if (
      allowedMutationTools === undefined ||
      allowedMutationTools.has(createWorkforceBatchTool.name)
    ) {
      registerMutationCatalogTool(
        server,
        getClient,
        createWorkforceBatchTool,
        mutationOptions,
      );
    }
    if (
      allowedMutationTools === undefined ||
      allowedMutationTools.has(setWorkforceBatchPriorityTool.name)
    ) {
      registerMutationCatalogTool(
        server,
        getClient,
        setWorkforceBatchPriorityTool,
        mutationOptions,
      );
    }
    if (
      allowedMutationTools === undefined ||
      allowedMutationTools.has(setWorkforceBatchStatusTool.name)
    ) {
      registerMutationCatalogTool(
        server,
        getClient,
        setWorkforceBatchStatusTool,
        mutationOptions,
      );
    }
    if (
      allowedMutationTools === undefined ||
      allowedMutationTools.has(setWorkforceSequenceStatusTool.name)
    ) {
      registerMutationCatalogTool(
        server,
        getClient,
        setWorkforceSequenceStatusTool,
        mutationOptions,
      );
    }
    if (
      allowedMutationTools === undefined ||
      allowedMutationTools.has(assignWorkforceWorkUnitTool.name)
    ) {
      registerMutationCatalogTool(
        server,
        getClient,
        assignWorkforceWorkUnitTool,
        mutationOptions,
      );
    }
    if (
      allowedMutationTools === undefined ||
      allowedMutationTools.has(deassignWorkforceWorkUnitTool.name)
    ) {
      registerMutationCatalogTool(
        server,
        getClient,
        deassignWorkforceWorkUnitTool,
        mutationOptions,
      );
    }
  }
}
