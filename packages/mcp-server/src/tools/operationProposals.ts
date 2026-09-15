import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GetClient } from "../client.js";
import { parseSafeStructuredContent } from "../catalog.js";

export const OPERATION_PROPOSAL_SCOPES = [
  "operations.proposal.read",
  "operations.proposal.create",
  "operations.approval.request",
  "operations.execution.request",
  "operations.verification.read",
] as const;
const uid = z
  .string()
  .regex(
    /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i,
  );
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const code = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9_]*$/);
const decision = z.enum(["PASS", "BLOCK"]);
const ruleVersion = z.literal("dispatch_assignment_v1");
const ruleCodes = [
  "rule_version_current",
  "snapshot_integrity",
  "request_integrity",
  "proposal_unexpired",
  "snapshot_unchanged",
  "organization_known",
  "batch_available",
  "unit_backlog_unassigned",
  "coworker_active_approved",
  "group_qualified",
  "batch_allocated",
  "coworker_available",
  "supported_operation",
  "progress_observability_unavailable",
] as const;
const rule = z.object({ code: z.enum(ruleCodes), result: decision });
const evaluation = z
  .object({
    decision,
    rules: z.array(rule).min(1).max(13),
    snapshotHash: hash,
    ruleVersion,
  })
  .superRefine((value, ctx) => {
    const codes = new Set(value.rules.map((item) => item.code));
    if (
      codes.size !== value.rules.length ||
      (value.decision === "PASS") !==
        value.rules.every((item) => item.result === "PASS") ||
      (value.decision === "PASS" &&
        (codes.size !== 13 || codes.has("progress_observability_unavailable")))
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent evaluation evidence",
      });
  });
const verification = z
  .object({
    status: z.enum(["verified", "changed"]),
    assignedWorkVisible: z.boolean(),
    assignmentRevisionMatches: z.boolean(),
    scopeUnchanged: z.boolean(),
    dispatchEligibilityCurrent: z.boolean(),
    productionActivity: z.literal("not_measured"),
  })
  .superRefine((value, ctx) => {
    if (
      (value.status === "verified") !==
      (value.assignedWorkVisible &&
        value.assignmentRevisionMatches &&
        value.scopeUnchanged &&
        value.dispatchEligibilityCurrent)
    )
      ctx.addIssue({
        code: "custom",
        message: "Verification status contradicts current observations",
      });
  });
const sameUid = (a: string, b: string): boolean =>
  a.replaceAll("-", "").toLowerCase() === b.replaceAll("-", "").toLowerCase();
const assignmentSnapshot = z.object({
  workUnitUid: uid,
  coworkerUid: uid,
  batchUid: uid,
  groupUid: uid,
  lineContext: z.object({
    organizationUid: uid.nullable(),
    projectUid: uid.nullable(),
    datasetUid: uid.nullable(),
    sequenceUid: uid.nullable(),
  }),
  unitStatus: code,
  unitUpdatedAt: timestamp,
  batchStatus: code,
  batchUpdatedAt: timestamp,
  staffingMode: z.enum(["group_pool", "allocated"]),
  assigned: z.boolean(),
  coworkerActive: z.boolean(),
  coworkerType: code,
  approvedForWork: z.boolean(),
  groupMember: z.boolean(),
  allocated: z.boolean(),
  hasActiveWork: z.boolean(),
  expectedResult: z.object({
    assigneeUid: uid,
    status: z.literal("in_progress"),
  }),
  impactLimits: z.object({
    workUnits: z.literal(1),
    coworkers: z.literal(1),
    paymentMutation: z.literal(false),
    capacityEstimate: z.literal("unknown"),
  }),
  verificationConditions: z.tuple([
    z.literal("assigned_work_visible"),
    z.literal("assignment_revision_matches"),
    z.literal("scope_unchanged"),
    z.literal("dispatch_eligibility_current"),
  ]),
  recovery: z.object({
    previousStatus: code,
    previousAssigneeUid: uid.nullable(),
    automaticReversal: z.literal("blocked_without_progress_observability"),
  }),
});
const executionReceipt = z.object({
  unitUpdatedAt: timestamp,
  operationEventUid: uid,
});
/** Convert only known typed snapshot field names; never normalize evidence values. */
function snapshotWireProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshotWireProjection);
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value).map(
      ([key, item]) =>
        [
          key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
          snapshotWireProjection(item),
        ] as const,
    );
    fields.sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return Object.fromEntries(fields);
  }
  return value;
}

export const operationProposalSchema = z
  .object({
    uid,
    version: z.literal(1),
    operation: z.enum(["assign_work_unit", "reverse_assignment"]),
    state: z.enum([
      "created",
      "evaluated",
      "blocked",
      "approval_requested",
      "approved",
      "queued",
      "verified",
      "execution_blocked",
      "execution_failed",
    ]),
    stateSemantics: z.literal(
      "historical_lifecycle_current_verification_separate",
    ),
    requesterUid: uid,
    requestId: uid,
    requestHash: hash,
    reversalOfUid: uid.nullable(),
    createdAt: timestamp,
    expiresAt: timestamp,
    reason: z.string().min(1).max(500),
    ruleVersion,
    snapshotHash: hash,
    snapshotCanonicalJson: z.string().min(2).max(32768),
    snapshot: assignmentSnapshot.extend({
      originalProposalUid: uid.optional(),
      originalSnapshot: assignmentSnapshot.optional(),
      originalExecution: executionReceipt.nullable().optional(),
    }),
    evaluation: evaluation.nullable(),
    approval: z.object({
      requestedAt: timestamp.nullable(),
      approvedAt: timestamp.nullable(),
      expiresAt: timestamp.nullable(),
      approverUid: uid.nullable(),
      digest: hash.nullable(),
      reviewPath: z.string().max(150),
    }),
    dispatchStatus: z.enum([
      "not_requested",
      "pending",
      "publish_failed",
      "consumed",
    ]),
    executedAt: timestamp.nullable(),
    execution: executionReceipt.nullable(),
    verifiedAt: timestamp.nullable(),
    verification: verification.nullable(),
  })
  .superRefine((value, ctx) => {
    const invalid = (message: string): void => {
      ctx.addIssue({ code: "custom", message });
    };
    const canonical = value.snapshotCanonicalJson;
    if (
      createHash("sha256").update(canonical, "utf8").digest("hex") !==
      value.snapshotHash
    )
      invalid("Canonical snapshot bytes do not match their digest");
    try {
      const projected = snapshotWireProjection(value.snapshot);
      if (!isDeepStrictEqual(JSON.parse(canonical), projected))
        invalid("Canonical snapshot does not match the exact typed evidence");
      // The finite snapshot contains only ASCII identifiers, codes and timestamps.
      // Reject noncanonical encodings (including duplicate keys with hidden text).
      // This comparison never supplies or changes the bytes used for hashing.
      if (JSON.stringify(projected) !== canonical)
        invalid("Snapshot canonical JSON contains noncanonical encoding");
    } catch {
      invalid("Canonical snapshot is not valid JSON");
    }
    const reviewUid =
      /^\/admin\/work_batch\/operationproposal\/([a-f0-9-]+)\/review\/$/i.exec(
        value.approval.reviewPath,
      )?.[1];
    if (!reviewUid || !sameUid(reviewUid, value.uid))
      invalid("Review path must identify this proposal on the API origin");
    if (
      value.approval.approverUid &&
      sameUid(value.approval.approverUid, value.requesterUid)
    )
      invalid("Requester cannot approve their proposal");
    if (
      value.evaluation &&
      value.evaluation.snapshotHash !== value.snapshotHash
    )
      invalid("Evaluation must bind the frozen snapshot");
    if (
      !sameUid(
        value.snapshot.expectedResult.assigneeUid,
        value.snapshot.coworkerUid,
      )
    )
      invalid("Expected assignee must match the target");
    if (
      (value.operation === "reverse_assignment") !==
      (value.reversalOfUid !== null)
    )
      invalid("Reversal lineage is required");
    if (value.operation === "reverse_assignment") {
      const original = value.snapshot.originalSnapshot;
      if (
        !value.snapshot.originalProposalUid ||
        !original ||
        !value.snapshot.originalExecution ||
        !value.reversalOfUid ||
        !sameUid(value.snapshot.originalProposalUid, value.reversalOfUid) ||
        !sameUid(original.workUnitUid, value.snapshot.workUnitUid) ||
        !sameUid(original.coworkerUid, value.snapshot.coworkerUid) ||
        !sameUid(original.expectedResult.assigneeUid, original.coworkerUid)
      )
        invalid(
          "Reversal requires its exact frozen original snapshot and execution evidence",
        );
    }

    if (
      (value.executedAt !== null) !== (value.execution !== null) ||
      (value.verifiedAt !== null) !== (value.verification !== null)
    )
      invalid("Lifecycle timestamps require corresponding evidence");
    if (value.state !== "created" && value.evaluation === null)
      invalid("Lifecycle state requires persisted evaluation");
    const approvedStates = [
      "approved",
      "queued",
      "verified",
      "execution_blocked",
      "execution_failed",
    ];
    if (
      approvedStates.includes(value.state) &&
      (value.approval.approvedAt === null ||
        value.evaluation?.decision !== "PASS")
    )
      invalid(
        "Approved lifecycle state requires independent approval and PASS evaluation",
      );
    if (
      value.state === "approval_requested" &&
      (value.approval.requestedAt === null ||
        value.evaluation?.decision !== "PASS")
    )
      invalid("Approval request requires PASS evaluation and request evidence");
    if (
      value.state === "verified" &&
      (!value.execution ||
        !value.verification ||
        value.dispatchStatus !== "consumed")
    )
      invalid(
        "Verified lifecycle requires execution and current verification evidence",
      );
    if (
      value.approval.approvedAt !== null &&
      (!value.approval.approverUid ||
        !value.approval.digest ||
        !value.approval.expiresAt ||
        !value.approval.requestedAt)
    )
      invalid("Approval evidence is incomplete");
  });
const eventRule = z.object({
  code: z.enum([
    ...ruleCodes,
    "independent_approval_current",
    "requester_active_staff",
  ]),
  result: decision,
});
const evidence = z.object({
  snapshotHash: hash.optional(),
  approvalDigest: hash.optional(),
  decision: decision.optional(),
  rules: z.array(eventRule).max(15).optional(),
  ruleVersion: ruleVersion.optional(),
  code: code.optional(),
  status: z.enum(["verified", "changed"]).optional(),
  assignedWorkVisible: z.boolean().optional(),
  assignmentRevisionMatches: z.boolean().optional(),
  scopeUnchanged: z.boolean().optional(),
  dispatchEligibilityCurrent: z.boolean().optional(),
  productionActivity: z.literal("not_measured").optional(),
  operationEventUid: uid.optional(),
  unitUpdatedAt: timestamp.optional(),
});
export const operationEventsSchema = z.object({
  proposalUid: uid,
  version: z.literal(1),
  events: z
    .array(
      z
        .object({
          uid,
          sequence: z.number().int().positive(),
          kind: z.enum([
            "created",
            "evaluated",
            "approval_requested",
            "approval_blocked",
            "approved",
            "queue_publish_failed",
            "execution_requested",
            "execution_retry_requested",
            "execution_blocked",
            "execution_failed",
            "executed",
            "verified",
            "verification_observed",
          ]),
          version: z.literal(1),
          actorUid: uid.nullable(),
          actorSource: z.enum(["authenticated_user", "system"]),
          createdAt: timestamp,
          evidence,
        })
        .superRefine((value, ctx) => {
          if ((value.actorSource === "system") !== (value.actorUid === null))
            ctx.addIssue({
              code: "custom",
              message: "Event actor source mismatch",
            });
        }),
    )
    .max(100),
  hasMore: z.boolean(),
  nextAfter: z.number().int().positive().nullable(),
});
const readInput = z.object({ proposalUid: uid }).strict();
const transitionInput = readInput.extend({ expectedVersion: z.literal(1) });
const createInput = z
  .object({
    requestId: uid,
    workUnitUid: uid,
    coworkerUid: uid,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const reverseInput = transitionInput.extend({
  requestId: uid,
  reason: z.string().trim().min(1).max(500),
});
const eventsInput = readInput.extend({
  limit: z.number().int().min(1).max(100).default(50),
  after: z.number().int().nonnegative().default(0),
});
const base = "/admin/workforce/operation-proposals/";
export const OPERATION_PROPOSAL_TOOLS = [
  {
    name: "create_operation_proposal",
    route: "operation-proposal-create",
    method: "POST",
    suffix: "",
    scope: "operations.proposal.create",
    inputSchema: createInput,
    description:
      "Freeze an exact work-unit/coworker dispatch proposal. Select the work unit with assignment candidates first. Creation does not assign work; retain the returned UID and version.",
  },
  {
    name: "evaluate_operation_proposal",
    route: "operation-proposal-evaluate",
    method: "POST",
    suffix: "evaluate/",
    scope: "operations.proposal.create",
    inputSchema: transitionInput,
    description:
      "Evaluate the frozen dispatch proposal against deterministic server rules. PASS is evidence for human review, not approval.",
  },
  {
    name: "get_operation_proposal",
    route: "operation-proposal-read",
    method: "GET",
    suffix: "",
    scope: "operations.proposal.read",
    inputSchema: readInput,
    description:
      "Read a proposal and its immutable snapshot, approval evidence, and historical lifecycle. Current verification is reported separately.",
  },
  {
    name: "request_operation_approval",
    route: "operation-proposal-request-approval",
    method: "POST",
    suffix: "request-approval/",
    scope: "operations.approval.request",
    inputSchema: transitionInput,
    description:
      "Request independent human approval through the returned Django admin reviewPath on the configured API origin. MCP cannot approve; requester self-approval is forbidden.",
  },
  {
    name: "execute_approved_operation",
    route: "operation-proposal-execute",
    method: "POST",
    suffix: "execute/",
    scope: "operations.execution.request",
    inputSchema: transitionInput,
    description:
      "Queue execution of an independently approved exact proposal. Queued does not mean executed. The backend periodically recovers lost delivery and bounds transient retries. Re-read the same proposal and events; retry only the same UID/version while approval remains valid. Call verify_operation before reporting the assignment verified.",
  },
  {
    name: "verify_operation",
    route: "operation-proposal-verify",
    method: "GET",
    suffix: "verification/",
    scope: "operations.verification.read",
    inputSchema: readInput,
    description:
      "Read current assigned-work visibility, assignment revision, scope and dispatch eligibility without rewriting the execution receipt or audit history. Historical verified state may now have changed observations. Unexecuted proposals return a conflict. Production activity is not measured.",
  },
  {
    name: "reverse_operation",
    route: "operation-proposal-reverse",
    method: "POST",
    suffix: "reverse/",
    scope: "operations.proposal.create",
    inputSchema: reverseInput,
    description:
      "Record an immutable BLOCKED reversal child for a proposal. Progress observability is unavailable, so this does not cancel or reverse an assignment.",
  },
  {
    name: "list_operation_events",
    route: "operation-proposal-events",
    method: "GET",
    suffix: "events/",
    scope: "operations.proposal.read",
    inputSchema: eventsInput,
    description:
      "Read bounded proposal audit events in increasing sequence order. Continue using nextAfter while hasMore; preserve the proposal UID.",
  },
] as const;
export const OPERATION_PROPOSAL_COMMAND_NAMES = new Set(
  OPERATION_PROPOSAL_TOOLS.filter((tool) => tool.method === "POST").map(
    (tool) => tool.name as string,
  ),
);

export function registerOperationProposalTools(
  server: McpServer,
  getClient: GetClient,
  allowCommands: boolean | ReadonlySet<string> = false,
): void {
  for (const definition of OPERATION_PROPOSAL_TOOLS) {
    if (
      definition.method === "POST" &&
      allowCommands !== true &&
      !(allowCommands && allowCommands.has(definition.name))
    )
      continue;
    const outputSchema =
      definition.name === "list_operation_events"
        ? operationEventsSchema
        : operationProposalSchema;
    const execute = async (input: Record<string, unknown>) => {
      const args = definition.inputSchema.parse(input) as Record<
        string,
        string | number
      >;
      const path =
        base +
        (definition.name === "create_operation_proposal"
          ? ""
          : `${encodeURIComponent((args.proposalUid as string).toLowerCase())}/${definition.suffix}`);
      const transport = getClient(definition.name).transport;
      const body =
        definition.name === "create_operation_proposal"
          ? {
              request_id: args.requestId,
              work_unit_uid: args.workUnitUid,
              coworker_uid: args.coworkerUid,
              reason: args.reason,
            }
          : definition.name === "reverse_operation"
            ? {
                expected_version: args.expectedVersion,
                request_id: args.requestId,
                reason: args.reason,
              }
            : { expected_version: args.expectedVersion };
      const raw =
        definition.method === "POST"
          ? await transport.requestCreate(path, body)
          : await transport.requestSingle(
              path,
              definition.name === "list_operation_events"
                ? { limit: String(args.limit), after: String(args.after) }
                : undefined,
            );
      const structuredContent = outputSchema.parse(raw);
      if ("events" in structuredContent) {
        let previous = args.after as number;
        const seen = new Set<string>();
        if (
          !sameUid(structuredContent.proposalUid, args.proposalUid as string) ||
          structuredContent.events.length > (args.limit as number)
        )
          throw new Error("Event page does not match request");
        for (const event of structuredContent.events) {
          const normalizedUid = event.uid.replaceAll("-", "").toLowerCase();
          if (event.sequence <= previous || seen.has(normalizedUid))
            throw new Error("Event page must advance without duplicates");
          previous = event.sequence;
          seen.add(normalizedUid);
        }
        if (
          structuredContent.hasMore
            ? !structuredContent.events.length ||
              structuredContent.nextAfter !== previous
            : structuredContent.nextAfter !== null
        )
          throw new Error("Invalid event continuation");
      } else {
        const proposal = structuredContent;
        if (definition.name === "reverse_operation") {
          if (
            !proposal.reversalOfUid ||
            !sameUid(proposal.reversalOfUid, args.proposalUid as string) ||
            proposal.operation !== "reverse_assignment" ||
            proposal.evaluation?.decision !== "BLOCK" ||
            proposal.state !== "blocked"
          )
            throw new Error("Invalid blocked reversal lineage");
        } else if (
          args.proposalUid &&
          !sameUid(proposal.uid, args.proposalUid as string)
        )
          throw new Error("Response substituted a different proposal");
        if (
          args.requestId &&
          (!sameUid(proposal.requestId, args.requestId as string) ||
            proposal.reason !== args.reason)
        )
          throw new Error("Response does not match durable request identity");
        if (
          args.workUnitUid &&
          (!sameUid(
            proposal.snapshot.workUnitUid,
            args.workUnitUid as string,
          ) ||
            !sameUid(
              proposal.snapshot.coworkerUid,
              args.coworkerUid as string,
            ) ||
            proposal.operation !== "assign_work_unit")
        )
          throw new Error("Response substituted dispatch targets");
      }
      const safeContent = parseSafeStructuredContent(
        outputSchema,
        structuredContent,
      );
      return {
        structuredContent: safeContent,
        content: [
          { type: "text" as const, text: JSON.stringify(safeContent, null, 2) },
        ],
      };
    };
    const handler = async (input: Record<string, unknown>) => {
      try {
        return await execute(input);
      } catch {
        throw new Error(
          "Operation proposal request failed validation or was refused by the provider. Re-read the proposal; no successful transition is confirmed.",
        );
      }
    };
    server.registerTool(
      definition.name,
      {
        title: definition.name.replaceAll("_", " "),
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema,
        annotations: {
          readOnlyHint: definition.method === "GET",
          destructiveHint: definition.name === "execute_approved_operation",
          idempotentHint: true,
          openWorldHint: true,
        },
        _meta: {
          "avala.ai/rest-route": definition.route,
          "avala.ai/rest-method": definition.method,
          "avala.ai/required-scope": definition.scope,
          "avala.ai/toolset": "staff",
          "avala.ai/approval-authority": "django-admin-session",
          "avala.ai/requires-confirmation": false,
          "avala.ai/operation-proposal": true,
        },
      },
      handler as unknown as ToolCallback<typeof definition.inputSchema>,
    );
  }
}
