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
const workforceStaffingModeSchema = z.enum(["group_pool", "allocated"]);
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
            staffingMode: workforceStaffingModeSchema,
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

const workforceDispatchBlockerCodeSchema = z.enum([
  "no_work_units",
  "no_eligible_group_members",
  "no_eligible_allocated_group_members",
  "eligible_coworkers_busy",
]);
const workforceDispatchStatusSchema = z.enum([
  "empty",
  "drained",
  "blocked",
  "partially_blocked",
  "claimable",
]);
const workforceDispatchBlockerRemediation = {
  no_work_units:
    "Create backlog work units before treating this production line as released.",
  no_eligible_group_members:
    "Add an active, approved coworker to every group that owns blocked backlog work.",
  no_eligible_allocated_group_members:
    "Allocate an active, approved member of each blocked work-unit group to this batch.",
  eligible_coworkers_busy:
    "Inspect active assignments and add ready capacity or restore stalled work before dispatching more work.",
} as const;

const workforceDispatchBatchOutputSchema = z
  .object({
    batchUid: compactUuidOutputSchema,
    priority: z.enum(["medium", "high"]),
    staffingMode: workforceStaffingModeSchema,
    lineContext: workforceLineContextOutputSchema,
    batchUpdatedAt: z.string().datetime({ offset: true }),
    dispatchStatus: workforceDispatchStatusSchema,
    totalWorkUnits: nonnegativeCount,
    releasedBacklogWorkUnits: nonnegativeCount,
    claimableBacklogWorkUnits: nonnegativeCount,
    blockedBacklogWorkUnits: nonnegativeCount,
    eligibleCoworkers: nonnegativeCount,
    readyCoworkers: nonnegativeCount,
    blockers: z
      .array(
        z
          .object({
            code: workforceDispatchBlockerCodeSchema,
            blockedWorkUnits: nonnegativeCount,
            remediation: z.string().min(1),
          })
          .strip(),
      )
      .max(4),
  })
  .strip()
  .superRefine((batch, context) => {
    if (batch.releasedBacklogWorkUnits > batch.totalWorkUnits) {
      context.addIssue({
        code: "custom",
        path: ["releasedBacklogWorkUnits"],
        message: "Released backlog cannot exceed total work units.",
      });
    }
    if (batch.claimableBacklogWorkUnits > batch.releasedBacklogWorkUnits) {
      context.addIssue({
        code: "custom",
        path: ["claimableBacklogWorkUnits"],
        message: "Claimable backlog cannot exceed released backlog.",
      });
    }
    if (
      batch.blockedBacklogWorkUnits !==
      batch.releasedBacklogWorkUnits - batch.claimableBacklogWorkUnits
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockedBacklogWorkUnits"],
        message: "Blocked backlog must equal released minus claimable backlog.",
      });
    }
    if (batch.readyCoworkers > batch.eligibleCoworkers) {
      context.addIssue({
        code: "custom",
        path: ["readyCoworkers"],
        message: "Ready coworkers cannot exceed eligible coworkers.",
      });
    }
    if (
      (batch.claimableBacklogWorkUnits > 0) !== (batch.readyCoworkers > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["readyCoworkers"],
        message:
          "Claimable backlog and ready-coworker presence must agree.",
      });
    }

    const expectedStatus =
      batch.totalWorkUnits === 0
        ? "empty"
        : batch.releasedBacklogWorkUnits === 0
          ? "drained"
          : batch.claimableBacklogWorkUnits === 0
            ? "blocked"
            : batch.claimableBacklogWorkUnits <
                batch.releasedBacklogWorkUnits
              ? "partially_blocked"
              : "claimable";
    if (batch.dispatchStatus !== expectedStatus) {
      context.addIssue({
        code: "custom",
        path: ["dispatchStatus"],
        message: "Dispatch status does not match the work-unit counts.",
      });
    }

    const blockerCodes = batch.blockers.map((blocker) => blocker.code);
    if (new Set(blockerCodes).size !== blockerCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Dispatch blocker codes must be unique within a batch.",
      });
    }
    for (const [index, blocker] of batch.blockers.entries()) {
      if (
        blocker.remediation !== workforceDispatchBlockerRemediation[blocker.code]
      ) {
        context.addIssue({
          code: "custom",
          path: ["blockers", index, "remediation"],
          message: "Blocker remediation does not match its fixed blocker code.",
        });
      }
      if (
        blocker.code === "no_eligible_allocated_group_members" &&
        batch.staffingMode !== "allocated"
      ) {
        context.addIssue({
          code: "custom",
          path: ["blockers", index, "code"],
          message: "Allocation blockers require allocated staffing mode.",
        });
      }
      if (
        blocker.code !== "no_work_units" &&
        blocker.blockedWorkUnits === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["blockers", index, "blockedWorkUnits"],
          message: "A backlog blocker must account for at least one work unit.",
        });
      }
    }

    const isEmpty = batch.dispatchStatus === "empty";
    const hasOnlyEmptyBlocker =
      batch.blockers.length === 1 &&
      batch.blockers[0]?.code === "no_work_units" &&
      batch.blockers[0].blockedWorkUnits === 0;
    if (isEmpty !== hasOnlyEmptyBlocker) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message:
          "Only empty batches may use the single zero-count no_work_units blocker.",
      });
    }
    if (
      !isEmpty &&
      batch.blockers.some((blocker) => blocker.code === "no_work_units")
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Non-empty batches cannot report no_work_units.",
      });
    }

    const blockedByReasons = batch.blockers.reduce(
      (total, blocker) => total + blocker.blockedWorkUnits,
      0,
    );
    if (!isEmpty && blockedByReasons !== batch.blockedBacklogWorkUnits) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Blocker counts must sum to blocked backlog work units.",
      });
    }
    if (
      (batch.dispatchStatus === "drained" ||
        batch.dispatchStatus === "claimable") &&
      batch.blockers.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Drained and fully claimable batches cannot have blockers.",
      });
    }
  });

const workforceDispatchHealthOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    measurement: z
      .object({
        scope: z.literal("current_snapshot"),
        summaryScope: z.literal("page"),
        unit: z.literal("work_unit"),
        releasedDefinition: z.literal(
          "BACKLOG work unit in a currently AVAILABLE batch.",
        ),
        claimableDefinition: z.literal(
          "Released work unit with an active, approved group member who has no IN_PROGRESS work in an AVAILABLE batch and, for allocated batches, has an active allocation.",
        ),
        historicalWindowSupported: z.literal(false),
      })
      .strip(),
    summary: z
      .object({
        availableBatches: nonnegativeCount,
        batchesWithBacklog: nonnegativeCount,
        batchesWithClaimableWork: nonnegativeCount,
        batchesWithBlockedWork: nonnegativeCount,
        emptyBatches: nonnegativeCount,
        releasedBacklogWorkUnits: nonnegativeCount,
        claimableBacklogWorkUnits: nonnegativeCount,
        blockedBacklogWorkUnits: nonnegativeCount,
      })
      .strip(),
    batches: z.array(workforceDispatchBatchOutputSchema).max(50),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
    observationReceipt: z
      .object({
        persistenceStatus: z.enum([
          "recorded_or_deduplicated",
          "not_applicable_empty_page",
          "unavailable",
        ]),
        observationSource: z.literal("staff_dispatch_health"),
        scope: z.literal("returned_page"),
        sampling: z.literal(
          "first_identical_state_per_batch_per_utc_hour",
        ),
        observedAt: z.string().datetime({ offset: true }),
        batchesInPage: nonnegativeCount.max(50),
        definition: z.literal(
          "Immutable state sampled when staff requested a dispatch-health page. Identical state is stored at most once per batch per UTC hour; different states in the same hour remain distinct. This is sampled observation, not continuous history, and gaps between successful reads are unobserved.",
        ),
      })
      .strip(),
  })
  .strip()
  .superRefine((report, context) => {
    const totals = report.batches.reduce(
      (sum, batch) => ({
        released: sum.released + batch.releasedBacklogWorkUnits,
        claimable: sum.claimable + batch.claimableBacklogWorkUnits,
        blocked: sum.blocked + batch.blockedBacklogWorkUnits,
      }),
      { released: 0, claimable: 0, blocked: 0 },
    );
    const expectedSummary = {
      availableBatches: report.batches.length,
      batchesWithBacklog: report.batches.filter(
        (batch) => batch.releasedBacklogWorkUnits > 0,
      ).length,
      batchesWithClaimableWork: report.batches.filter(
        (batch) => batch.claimableBacklogWorkUnits > 0,
      ).length,
      batchesWithBlockedWork: report.batches.filter(
        (batch) => batch.blockedBacklogWorkUnits > 0,
      ).length,
      emptyBatches: report.batches.filter(
        (batch) => batch.dispatchStatus === "empty",
      ).length,
      releasedBacklogWorkUnits: totals.released,
      claimableBacklogWorkUnits: totals.claimable,
      blockedBacklogWorkUnits: totals.blocked,
    };
    for (const [field, expected] of Object.entries(expectedSummary)) {
      if (report.summary[field as keyof typeof expectedSummary] !== expected) {
        context.addIssue({
          code: "custom",
          path: ["summary", field],
          message: "Page summary does not match the returned batches.",
        });
      }
    }

    const batchUids = report.batches.map((batch) => batch.batchUid);
    if (new Set(batchUids).size !== batchUids.length) {
      context.addIssue({
        code: "custom",
        path: ["batches"],
        message: "Dispatch-health pages cannot contain duplicate batch UIDs.",
      });
    }
    if (
      batchUids.some((uid, index) => index > 0 && uid <= batchUids[index - 1]!)
    ) {
      context.addIssue({
        code: "custom",
        path: ["batches"],
        message: "Dispatch-health batches must be sorted by ascending UID.",
      });
    }
    const expectedCursor = report.hasMore
      ? (batchUids[batchUids.length - 1] ?? null)
      : null;
    if (report.nextCursor !== expectedCursor) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message:
          "nextCursor must be the last returned batch UID exactly when hasMore is true.",
      });
    }
    if (
      Date.parse(report.observationReceipt.observedAt) !==
      Date.parse(report.generatedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["observationReceipt", "observedAt"],
        message: "Observation time must match the returned current snapshot.",
      });
    }
    if (report.observationReceipt.batchesInPage !== report.batches.length) {
      context.addIssue({
        code: "custom",
        path: ["observationReceipt", "batchesInPage"],
        message: "Observation receipt must cover exactly the returned page.",
      });
    }
    const expectedEmptyPageStatus = report.batches.length === 0;
    if (
      (report.observationReceipt.persistenceStatus ===
        "not_applicable_empty_page") !==
      expectedEmptyPageStatus
    ) {
      context.addIssue({
        code: "custom",
        path: ["observationReceipt", "persistenceStatus"],
        message:
          "Only an empty dispatch-health page may report observation persistence as not applicable.",
      });
    }
  });

const workforceDispatchObservationDefinition =
  "Immutable state sampled when staff requested a dispatch-health page. Identical state is stored at most once per batch per UTC hour; different states in the same hour remain distinct. This is sampled observation, not continuous history, and gaps between successful reads are unobserved.";
const workforceDispatchObservationAbsenceDefinition =
  "No observation means no staff dispatch-health response recorded that returned batch state in the interval. It does not prove the line was healthy, unchanged, unavailable to coworkers, or continuously monitored.";
const workforceDispatchObservationCurrentContextDefinition =
  "Batch lifecycle, priority, staffing mode, and line context reflect report time, not observation time. Filters on those fields also use current values.";

const workforceDispatchObservationRowOutputSchema = z
  .object({
    observationUid: compactUuidOutputSchema,
    observedAt: z.string().datetime({ offset: true }),
    recordedAt: z.string().datetime({ offset: true }),
    observationHourStartedAt: z.string().datetime({ offset: true }),
    observationEvidenceStatus: z.enum(["observed", "pre_storage_anomaly"]),
    batchUid: compactUuidOutputSchema,
    currentBatchStatus: z.enum(["available", "unavailable", "archived"]),
    currentPriority: z.enum(["medium", "high"]),
    currentStaffingMode: workforceStaffingModeSchema,
    currentLineContext: workforceLineContextOutputSchema,
    dispatchStatus: workforceDispatchStatusSchema,
    totalWorkUnits: nonnegativeCount,
    releasedBacklogWorkUnits: nonnegativeCount,
    claimableBacklogWorkUnits: nonnegativeCount,
    blockedBacklogWorkUnits: nonnegativeCount,
    eligibleCoworkers: nonnegativeCount,
    readyCoworkers: nonnegativeCount,
    blockers: z
      .array(
        z
          .object({
            code: workforceDispatchBlockerCodeSchema,
            blockedWorkUnits: nonnegativeCount,
          })
          .strip(),
      )
      .max(4),
  })
  .strip()
  .superRefine((observation, context) => {
    if (observation.releasedBacklogWorkUnits > observation.totalWorkUnits) {
      context.addIssue({
        code: "custom",
        path: ["releasedBacklogWorkUnits"],
        message: "Observed released backlog cannot exceed total work units.",
      });
    }
    if (
      observation.claimableBacklogWorkUnits >
      observation.releasedBacklogWorkUnits
    ) {
      context.addIssue({
        code: "custom",
        path: ["claimableBacklogWorkUnits"],
        message: "Observed claimable backlog cannot exceed released backlog.",
      });
    }
    if (
      observation.blockedBacklogWorkUnits !==
      observation.releasedBacklogWorkUnits -
        observation.claimableBacklogWorkUnits
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockedBacklogWorkUnits"],
        message: "Observed blocked backlog must equal released minus claimable.",
      });
    }
    if (observation.readyCoworkers > observation.eligibleCoworkers) {
      context.addIssue({
        code: "custom",
        path: ["readyCoworkers"],
        message: "Observed ready coworkers cannot exceed eligible coworkers.",
      });
    }
    if (
      (observation.claimableBacklogWorkUnits > 0) !==
      (observation.readyCoworkers > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["readyCoworkers"],
        message:
          "Observed claimable backlog and ready-coworker presence must agree.",
      });
    }

    const expectedStatus =
      observation.totalWorkUnits === 0
        ? "empty"
        : observation.releasedBacklogWorkUnits === 0
          ? "drained"
          : observation.claimableBacklogWorkUnits === 0
            ? "blocked"
            : observation.claimableBacklogWorkUnits <
                observation.releasedBacklogWorkUnits
              ? "partially_blocked"
              : "claimable";
    if (observation.dispatchStatus !== expectedStatus) {
      context.addIssue({
        code: "custom",
        path: ["dispatchStatus"],
        message: "Observed dispatch status does not match its work-unit counts.",
      });
    }

    const blockerCodes = observation.blockers.map((blocker) => blocker.code);
    if (new Set(blockerCodes).size !== blockerCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Observed blocker codes must be unique within a row.",
      });
    }
    for (const [index, blocker] of observation.blockers.entries()) {
      if (
        blocker.code !== "no_work_units" &&
        blocker.blockedWorkUnits === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["blockers", index, "blockedWorkUnits"],
          message: "An observed backlog blocker must account for work units.",
        });
      }
    }

    const isEmpty = observation.dispatchStatus === "empty";
    const hasOnlyEmptyBlocker =
      observation.blockers.length === 1 &&
      observation.blockers[0]?.code === "no_work_units" &&
      observation.blockers[0].blockedWorkUnits === 0;
    if (isEmpty !== hasOnlyEmptyBlocker) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message:
          "Only empty observed states may use the single zero-count no_work_units blocker.",
      });
    }
    if (
      !isEmpty &&
      observation.blockers.some(
        (blocker) => blocker.code === "no_work_units",
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Non-empty observed states cannot report no_work_units.",
      });
    }

    const blockedByReasons = observation.blockers.reduce(
      (total, blocker) => total + blocker.blockedWorkUnits,
      0,
    );
    if (!isEmpty && blockedByReasons !== observation.blockedBacklogWorkUnits) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Observed blocker counts must explain blocked backlog.",
      });
    }
    if (
      (observation.dispatchStatus === "drained" ||
        observation.dispatchStatus === "claimable") &&
      observation.blockers.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Drained and fully claimable observations cannot have blockers.",
      });
    }
  });

const workforceDispatchObservationHistoryOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    measurement: z
      .object({
        scope: z.literal("sampled_dispatch_observation_history"),
        summaryScope: z.literal("page"),
        observationWindow: z
          .object({
            observedFrom: z.string().datetime({ offset: true }),
            observedBefore: z.string().datetime({ offset: true }),
            boundary: z.literal("half_open"),
          })
          .strip(),
        storageAvailableAt: z.string().datetime({ offset: true }),
        observationSource: z.literal("staff_dispatch_health"),
        sampling: z.literal("first_identical_state_per_batch_per_utc_hour"),
        observationDefinition: z.literal(
          workforceDispatchObservationDefinition,
        ),
        absenceDefinition: z.literal(
          workforceDispatchObservationAbsenceDefinition,
        ),
        currentContextDefinition: z.literal(
          workforceDispatchObservationCurrentContextDefinition,
        ),
        continuousHistorySupported: z.literal(false),
        legacyBackfillPerformed: z.literal(false),
      })
      .strip(),
    coverage: z
      .object({
        evidenceScope: z.literal("page"),
        storageWindowStatus: z.enum(["available", "partial", "unavailable"]),
        returnedObservations: nonnegativeCount.max(50),
        returnedDistinctBatches: nonnegativeCount.max(50),
        observedEvidenceRows: nonnegativeCount.max(50),
        preStorageAnomalyRows: nonnegativeCount.max(50),
      })
      .strip(),
    summary: z
      .object({
        statusObservations: z
          .object({
            empty: nonnegativeCount,
            drained: nonnegativeCount,
            blocked: nonnegativeCount,
            partiallyBlocked: nonnegativeCount,
            claimable: nonnegativeCount,
          })
          .strip(),
        blockerObservations: z
          .object({
            noWorkUnits: nonnegativeCount,
            noEligibleGroupMembers: nonnegativeCount,
            noEligibleAllocatedGroupMembers: nonnegativeCount,
            eligibleCoworkersBusy: nonnegativeCount,
          })
          .strip(),
      })
      .strip(),
    observations: z
      .array(workforceDispatchObservationRowOutputSchema)
      .max(50),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip()
  .superRefine((report, context) => {
    const { observedFrom, observedBefore } =
      report.measurement.observationWindow;
    const windowStart = Date.parse(observedFrom);
    const windowEnd = Date.parse(observedBefore);
    const generatedAt = Date.parse(report.generatedAt);
    const storageAvailableAt = Date.parse(
      report.measurement.storageAvailableAt,
    );
    if (
      windowStart >= windowEnd ||
      windowEnd - windowStart > 31 * 24 * 60 * 60 * 1000 ||
      windowEnd > generatedAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "observationWindow"],
        message:
          "Provider observation window must be past, ordered, and at most 31 days.",
      });
    }
    if (storageAvailableAt > generatedAt) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "storageAvailableAt"],
        message: "Observation storage cannot begin after report generation.",
      });
    }

    const expectedStorageStatus =
      windowEnd <= storageAvailableAt
        ? "unavailable"
        : windowStart < storageAvailableAt
          ? "partial"
          : "available";
    if (report.coverage.storageWindowStatus !== expectedStorageStatus) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "storageWindowStatus"],
        message:
          "Storage-window status must match the observation-storage boundary.",
      });
    }

    const observedRows = report.observations.filter(
      (observation) => observation.observationEvidenceStatus === "observed",
    ).length;
    const anomalyRows = report.observations.length - observedRows;
    const distinctBatches = new Set(
      report.observations.map((observation) => observation.batchUid),
    ).size;
    if (
      report.coverage.returnedObservations !== report.observations.length ||
      report.coverage.returnedDistinctBatches !== distinctBatches ||
      report.coverage.observedEvidenceRows !== observedRows ||
      report.coverage.preStorageAnomalyRows !== anomalyRows
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage"],
        message: "Page coverage must match the returned observations.",
      });
    }

    const expectedStatusCounts = {
      empty: report.observations.filter(
        (observation) => observation.dispatchStatus === "empty",
      ).length,
      drained: report.observations.filter(
        (observation) => observation.dispatchStatus === "drained",
      ).length,
      blocked: report.observations.filter(
        (observation) => observation.dispatchStatus === "blocked",
      ).length,
      partiallyBlocked: report.observations.filter(
        (observation) => observation.dispatchStatus === "partially_blocked",
      ).length,
      claimable: report.observations.filter(
        (observation) => observation.dispatchStatus === "claimable",
      ).length,
    };
    const expectedBlockerCounts = {
      noWorkUnits: 0,
      noEligibleGroupMembers: 0,
      noEligibleAllocatedGroupMembers: 0,
      eligibleCoworkersBusy: 0,
    };
    const blockerCountKey = {
      no_work_units: "noWorkUnits",
      no_eligible_group_members: "noEligibleGroupMembers",
      no_eligible_allocated_group_members:
        "noEligibleAllocatedGroupMembers",
      eligible_coworkers_busy: "eligibleCoworkersBusy",
    } as const;
    for (const observation of report.observations) {
      for (const blocker of observation.blockers) {
        expectedBlockerCounts[blockerCountKey[blocker.code]] += 1;
      }
    }
    for (const [field, expected] of Object.entries(expectedStatusCounts)) {
      if (
        report.summary.statusObservations[
          field as keyof typeof expectedStatusCounts
        ] !== expected
      ) {
        context.addIssue({
          code: "custom",
          path: ["summary", "statusObservations", field],
          message: "Page status-occurrence summary must match returned rows.",
        });
      }
    }
    for (const [field, expected] of Object.entries(expectedBlockerCounts)) {
      if (
        report.summary.blockerObservations[
          field as keyof typeof expectedBlockerCounts
        ] !== expected
      ) {
        context.addIssue({
          code: "custom",
          path: ["summary", "blockerObservations", field],
          message: "Page blocker-occurrence summary must match returned rows.",
        });
      }
    }

    for (const [index, observation] of report.observations.entries()) {
      const observedAt = Date.parse(observation.observedAt);
      const recordedAt = Date.parse(observation.recordedAt);
      const hourStartedAt = Date.parse(observation.observationHourStartedAt);
      if (observedAt < windowStart || observedAt >= windowEnd) {
        context.addIssue({
          code: "custom",
          path: ["observations", index, "observedAt"],
          message: "Returned observation is outside the requested window.",
        });
      }
      if (recordedAt < observedAt || recordedAt > generatedAt) {
        context.addIssue({
          code: "custom",
          path: ["observations", index, "recordedAt"],
          message:
            "Recorded time must be at or after observation and no later than report generation.",
        });
      }
      const expectedHourStartedAt =
        Math.floor(observedAt / (60 * 60 * 1000)) * 60 * 60 * 1000;
      if (hourStartedAt !== expectedHourStartedAt) {
        context.addIssue({
          code: "custom",
          path: ["observations", index, "observationHourStartedAt"],
          message: "Observation hour must be the UTC hour containing observedAt.",
        });
      }
      const expectedEvidenceStatus =
        observedAt >= storageAvailableAt
          ? "observed"
          : "pre_storage_anomaly";
      if (observation.observationEvidenceStatus !== expectedEvidenceStatus) {
        context.addIssue({
          code: "custom",
          path: ["observations", index, "observationEvidenceStatus"],
          message:
            "Observation evidence status must match the storage boundary.",
        });
      }
    }

    const observationUids = report.observations.map(
      (observation) => observation.observationUid,
    );
    if (new Set(observationUids).size !== observationUids.length) {
      context.addIssue({
        code: "custom",
        path: ["observations"],
        message: "Observation UIDs must be unique within a page.",
      });
    }
    if (
      observationUids.some(
        (uid, index) => index > 0 && uid <= observationUids[index - 1]!,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["observations"],
        message: "Observation rows must be sorted by ascending opaque UID.",
      });
    }
    const expectedCursor = report.hasMore
      ? (observationUids[observationUids.length - 1] ?? null)
      : null;
    if (report.nextCursor !== expectedCursor) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message:
          "nextCursor must be the last observation UID exactly when hasMore is true.",
      });
    }
  });

const workforceDispatchOutcomeBatchOutputSchema = z
  .object({
    batchUid: compactUuidOutputSchema,
    currentBatchStatus: z.enum(["available", "unavailable", "archived"]),
    currentPriority: z.enum(["medium", "high"]),
    currentStaffingMode: workforceStaffingModeSchema,
    currentLineContext: workforceLineContextOutputSchema,
    releaseObservedAt: z.string().datetime({ offset: true }),
    claimDeadlineAt: z.string().datetime({ offset: true }),
    firstRecordedQueueVisibilityAt: z
      .string()
      .datetime({ offset: true })
      .nullable(),
    queueVisibilitySource: z
      .enum([
        "available_work_batches",
        "available_work_units",
        "batch_available_work_units",
      ])
      .nullable(),
    releaseToFirstRecordedQueueVisibilitySeconds:
      nonnegativeCount.nullable(),
    queueVisibilityEvidenceStatus: z.enum([
      "observed",
      "observed_after_storage_gap",
      "no_recorded_visibility",
      "visibility_time_unavailable",
    ]),
    preReleaseQueueVisibilityRecorded: z.boolean(),
    queueVisibilityRecordedAfterFirstClaim: z.boolean(),
    firstRecordedClaimAt: z
      .string()
      .datetime({ offset: true })
      .nullable(),
    claimDelaySeconds: nonnegativeCount.nullable(),
    claimEvidenceStatus: z.enum([
      "observed",
      "no_recorded_claim",
      "claim_time_unavailable",
    ]),
    outcome: z.enum([
      "claimed_within_threshold",
      "claimed_after_threshold",
      "no_recorded_claim_overdue",
      "no_recorded_claim_pending",
      "claim_time_unavailable",
    ]),
    preReleaseClaimRecorded: z.boolean(),
    currentActivityWithoutPostReleaseClaimRecord: z.boolean(),
  })
  .strip()
  .superRefine((batch, context) => {
    const release = Date.parse(batch.releaseObservedAt);
    const queueVisibility =
      batch.firstRecordedQueueVisibilityAt === null
        ? null
        : Date.parse(batch.firstRecordedQueueVisibilityAt);
    const queueTimestampAndSourceAgree =
      (batch.firstRecordedQueueVisibilityAt === null) ===
      (batch.queueVisibilitySource === null);
    if (!queueTimestampAndSourceAgree) {
      context.addIssue({
        code: "custom",
        path: ["queueVisibilitySource"],
        message:
          "Queue visibility timestamp and constrained source must be present together.",
      });
    }

    const expectedPreReleaseQueueVisibility =
      queueVisibility !== null && queueVisibility < release;
    if (
      batch.preReleaseQueueVisibilityRecorded !==
      expectedPreReleaseQueueVisibility
    ) {
      context.addIssue({
        code: "custom",
        path: ["preReleaseQueueVisibilityRecorded"],
        message:
          "Pre-release queue visibility must match the recorded timestamp ordering.",
      });
    }

    const queueVisibilityObserved =
      batch.queueVisibilityEvidenceStatus === "observed" ||
      batch.queueVisibilityEvidenceStatus === "observed_after_storage_gap";
    if (
      queueVisibilityObserved &&
      (queueVisibility === null ||
        batch.queueVisibilitySource === null ||
        batch.releaseToFirstRecordedQueueVisibilitySeconds === null ||
        batch.preReleaseQueueVisibilityRecorded)
    ) {
      context.addIssue({
        code: "custom",
        path: ["queueVisibilityEvidenceStatus"],
        message:
          "Observed queue visibility requires a source and non-pre-release timestamp and delay.",
      });
    }
    if (
      batch.queueVisibilityEvidenceStatus === "no_recorded_visibility" &&
      (queueVisibility !== null ||
        batch.queueVisibilitySource !== null ||
        batch.releaseToFirstRecordedQueueVisibilitySeconds !== null ||
        batch.preReleaseQueueVisibilityRecorded)
    ) {
      context.addIssue({
        code: "custom",
        path: ["queueVisibilityEvidenceStatus"],
        message:
          "No-recorded-visibility rows cannot include queue visibility evidence.",
      });
    }
    if (
      batch.queueVisibilityEvidenceStatus === "visibility_time_unavailable" &&
      ((queueVisibility === null &&
        (batch.queueVisibilitySource !== null ||
          batch.releaseToFirstRecordedQueueVisibilitySeconds !== null ||
          batch.preReleaseQueueVisibilityRecorded)) ||
        (queueVisibility !== null &&
          (batch.queueVisibilitySource === null ||
            batch.releaseToFirstRecordedQueueVisibilitySeconds !== null ||
            !batch.preReleaseQueueVisibilityRecorded)))
    ) {
      context.addIssue({
        code: "custom",
        path: ["queueVisibilityEvidenceStatus"],
        message:
          "Unavailable queue time must represent either a storage gap or explicit pre-release evidence.",
      });
    }
    if (
      batch.releaseToFirstRecordedQueueVisibilitySeconds !== null &&
      (queueVisibility === null ||
        batch.releaseToFirstRecordedQueueVisibilitySeconds !==
          Math.ceil((queueVisibility - release) / 1000))
    ) {
      context.addIssue({
        code: "custom",
        path: ["releaseToFirstRecordedQueueVisibilitySeconds"],
        message:
          "Queue visibility delay must equal recorded visibility minus observed release, rounded up.",
      });
    }

    const expectedQueueVisibilityAfterFirstClaim =
      queueVisibility !== null &&
      batch.firstRecordedClaimAt !== null &&
      queueVisibility > Date.parse(batch.firstRecordedClaimAt);
    if (
      batch.queueVisibilityRecordedAfterFirstClaim !==
      expectedQueueVisibilityAfterFirstClaim
    ) {
      context.addIssue({
        code: "custom",
        path: ["queueVisibilityRecordedAfterFirstClaim"],
        message:
          "Queue-after-claim evidence must match the recorded timestamp ordering.",
      });
    }

    const observed =
      batch.firstRecordedClaimAt !== null &&
      batch.claimDelaySeconds !== null;
    if (batch.claimEvidenceStatus === "observed" && !observed) {
      context.addIssue({
        code: "custom",
        path: ["claimEvidenceStatus"],
        message:
          "Observed claim evidence requires both a timestamp and delay.",
      });
    }
    if (batch.claimEvidenceStatus !== "observed" && observed) {
      context.addIssue({
        code: "custom",
        path: ["firstRecordedClaimAt"],
        message:
          "Unavailable or absent claim evidence cannot include an observed timestamp and delay.",
      });
    }
    if (
      (batch.firstRecordedClaimAt === null) !==
      (batch.claimDelaySeconds === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["claimDelaySeconds"],
        message: "Claim timestamp and delay must be present together.",
      });
    }
    if (
      batch.claimEvidenceStatus === "claim_time_unavailable" &&
      !batch.preReleaseClaimRecorded &&
      !batch.currentActivityWithoutPostReleaseClaimRecord
    ) {
      context.addIssue({
        code: "custom",
        path: ["claimEvidenceStatus"],
        message:
          "Unavailable claim time requires pre-release or current-activity evidence.",
      });
    }
    if (
      batch.claimEvidenceStatus === "no_recorded_claim" &&
      (batch.preReleaseClaimRecorded ||
        batch.currentActivityWithoutPostReleaseClaimRecord)
    ) {
      context.addIssue({
        code: "custom",
        path: ["claimEvidenceStatus"],
        message:
          "No-recorded-claim rows cannot hide evidence that makes claim time unavailable.",
      });
    }
    if (
      batch.claimEvidenceStatus === "observed" &&
      batch.currentActivityWithoutPostReleaseClaimRecord
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentActivityWithoutPostReleaseClaimRecord"],
        message:
          "Current activity cannot lack a post-release claim record when one is observed.",
      });
    }

    const deadline = Date.parse(batch.claimDeadlineAt);
    if (deadline < release) {
      context.addIssue({
        code: "custom",
        path: ["claimDeadlineAt"],
        message: "Claim deadline cannot precede observed release.",
      });
    }
    if (
      batch.firstRecordedClaimAt !== null &&
      Date.parse(batch.firstRecordedClaimAt) < release
    ) {
      context.addIssue({
        code: "custom",
        path: ["firstRecordedClaimAt"],
        message:
          "A post-release first recorded claim cannot precede release.",
      });
    }
  });

const workforceDispatchOutcomesOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    measurement: z
      .object({
        scope: z.literal("observed_release_history"),
        summaryScope: z.literal("page"),
        releaseWindow: z
          .object({
            releasedFrom: z.string().datetime({ offset: true }),
            releasedBefore: z.string().datetime({ offset: true }),
            boundary: z.literal("half_open"),
          })
          .strip(),
        thresholdDays: z.number().int().min(1).max(90),
        releaseInstrumentationStartedAt: z
          .string()
          .datetime({ offset: true }),
        queueVisibilityStorageAvailableAt: z
          .string()
          .datetime({ offset: true }),
        releaseDefinition: z.literal(
          "First database-observed transition of the batch into AVAILABLE after release instrumentation.",
        ),
        queueVisibilityDefinition: z.literal(
          "First recorded server-generated queue response for a coworker authorized and approved for work, containing the batch or one of its eligible BACKLOG work units while the coworker had no active work; coworker identity is not stored and client receipt is not proven.",
        ),
        queueVisibilityDelayDefinition: z.literal(
          "Elapsed seconds from observed release to first recorded queue visibility, rounded up. This is recorded exposure evidence, not proof that the batch could not have been visible earlier.",
        ),
        firstClaimDefinition: z.literal(
          "Earliest recorded work-unit transition into IN_PROGRESS at or after the observed batch release.",
        ),
        claimDelayDefinition: z.literal(
          "Elapsed seconds from observed release to first recorded claim, rounded up to preserve threshold classification.",
        ),
        thresholdDefinition: z.literal(
          "A claim at or before release plus threshold_days is within threshold.",
        ),
        currentContextDefinition: z.literal(
          "Batch line context, lifecycle status, priority, and staffing mode reflect report time, not release time. Filters on those fields also use current values.",
        ),
        queueVisibilitySupported: z.literal(true),
        historicalBlockersSupported: z.literal(false),
        legacyBackfillPerformed: z.literal(false),
      })
      .strip(),
    coverage: z
      .object({
        releaseEvidenceScope: z.literal("filtered_population"),
        queueVisibilityEvidenceScope: z.literal("page"),
        claimEvidenceScope: z.literal("page"),
        filterScopeBatchesCreatedBeforeWindowEnd: nonnegativeCount,
        observedReleaseBatchesInWindow: nonnegativeCount,
        batchesWithUnobservableWindowMembership: nonnegativeCount,
        releaseWindowObservationStatus: z.enum([
          "complete",
          "partial",
          "unavailable",
        ]),
        releaseWindowMembershipComplete: z.boolean(),
        returnedBatches: nonnegativeCount,
        queueVisibilityObservedBatches: nonnegativeCount,
        queueVisibilityObservedAfterStorageGapBatches: nonnegativeCount,
        queueVisibilityTimeUnavailableBatches: nonnegativeCount,
        noRecordedQueueVisibilityBatches: nonnegativeCount,
        claimTimeObservedBatches: nonnegativeCount,
        claimTimeUnavailableBatches: nonnegativeCount,
        noRecordedClaimBatches: nonnegativeCount,
      })
      .strip(),
    summary: z
      .object({
        claimedWithinThreshold: nonnegativeCount,
        claimedAfterThreshold: nonnegativeCount,
        noRecordedClaimOverdue: nonnegativeCount,
        noRecordedClaimPending: nonnegativeCount,
        claimTimeUnavailable: nonnegativeCount,
      })
      .strip(),
    batches: z.array(workforceDispatchOutcomeBatchOutputSchema).max(50),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip()
  .superRefine((report, context) => {
    const { releasedFrom, releasedBefore } = report.measurement.releaseWindow;
    const windowStart = Date.parse(releasedFrom);
    const windowEnd = Date.parse(releasedBefore);
    const generatedAt = Date.parse(report.generatedAt);
    const instrumentationStartedAt = Date.parse(
      report.measurement.releaseInstrumentationStartedAt,
    );
    const queueVisibilityStorageAvailableAt = Date.parse(
      report.measurement.queueVisibilityStorageAvailableAt,
    );
    if (
      windowStart >= windowEnd ||
      windowEnd - windowStart > 366 * 24 * 60 * 60 * 1000
    ) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "releaseWindow"],
        message: "Provider release window must be ordered and at most 366 days.",
      });
    }
    if (instrumentationStartedAt > generatedAt) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "releaseInstrumentationStartedAt"],
        message: "Release instrumentation cannot begin after report generation.",
      });
    }
    if (queueVisibilityStorageAvailableAt > generatedAt) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "queueVisibilityStorageAvailableAt"],
        message:
          "Queue visibility storage cannot become available after report generation.",
      });
    }
    if (queueVisibilityStorageAvailableAt < instrumentationStartedAt) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "queueVisibilityStorageAvailableAt"],
        message:
          "Queue visibility storage cannot predate its release-evidence dependency.",
      });
    }

    const expectedObservationStatus =
      windowEnd <= instrumentationStartedAt
        ? "unavailable"
        : windowStart < instrumentationStartedAt
          ? "partial"
          : "complete";
    if (
      report.coverage.releaseWindowObservationStatus !==
      expectedObservationStatus
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "releaseWindowObservationStatus"],
        message:
          "Release-window observation status must match the instrumentation boundary.",
      });
    }

    const observationComplete =
      report.coverage.releaseWindowObservationStatus === "complete";
    if (
      report.coverage.releaseWindowMembershipComplete !== observationComplete
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "releaseWindowMembershipComplete"],
        message:
          "Release-window membership is complete exactly when observation status is complete.",
      });
    }
    if (
      observationComplete &&
      report.coverage.batchesWithUnobservableWindowMembership !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "batchesWithUnobservableWindowMembership"],
        message: "A complete release window cannot contain unobservable membership.",
      });
    }
    if (
      report.coverage.batchesWithUnobservableWindowMembership >
      report.coverage.filterScopeBatchesCreatedBeforeWindowEnd
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "batchesWithUnobservableWindowMembership"],
        message:
          "Unobservable membership cannot exceed the eligible filter-scope population.",
      });
    }
    if (
      report.coverage.observedReleaseBatchesInWindow >
      report.coverage.filterScopeBatchesCreatedBeforeWindowEnd
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "observedReleaseBatchesInWindow"],
        message:
          "Observed releases cannot exceed batches created before the window ended.",
      });
    }
    if (
      report.coverage.observedReleaseBatchesInWindow < report.batches.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "observedReleaseBatchesInWindow"],
        message:
          "Population release coverage cannot be smaller than the returned page.",
      });
    }
    if (report.coverage.returnedBatches !== report.batches.length) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "returnedBatches"],
        message: "Returned-batch coverage must match the page length.",
      });
    }

    const evidenceCounts = {
      observed: report.batches.filter(
        (batch) => batch.claimEvidenceStatus === "observed",
      ).length,
      unavailable: report.batches.filter(
        (batch) => batch.claimEvidenceStatus === "claim_time_unavailable",
      ).length,
      noRecord: report.batches.filter(
        (batch) => batch.claimEvidenceStatus === "no_recorded_claim",
      ).length,
    };
    if (
      report.coverage.claimTimeObservedBatches !== evidenceCounts.observed ||
      report.coverage.claimTimeUnavailableBatches !==
        evidenceCounts.unavailable ||
      report.coverage.noRecordedClaimBatches !== evidenceCounts.noRecord
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage"],
        message: "Page claim-evidence coverage must match returned batches.",
      });
    }

    const queueVisibilityCounts = {
      observed: report.batches.filter(
        (batch) => batch.queueVisibilityEvidenceStatus === "observed",
      ).length,
      observedAfterStorageGap: report.batches.filter(
        (batch) =>
          batch.queueVisibilityEvidenceStatus ===
          "observed_after_storage_gap",
      ).length,
      unavailable: report.batches.filter(
        (batch) =>
          batch.queueVisibilityEvidenceStatus === "visibility_time_unavailable",
      ).length,
      noRecord: report.batches.filter(
        (batch) =>
          batch.queueVisibilityEvidenceStatus === "no_recorded_visibility",
      ).length,
    };
    if (
      report.coverage.queueVisibilityObservedBatches !==
        queueVisibilityCounts.observed ||
      report.coverage.queueVisibilityObservedAfterStorageGapBatches !==
        queueVisibilityCounts.observedAfterStorageGap ||
      report.coverage.queueVisibilityTimeUnavailableBatches !==
        queueVisibilityCounts.unavailable ||
      report.coverage.noRecordedQueueVisibilityBatches !==
        queueVisibilityCounts.noRecord
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage"],
        message:
          "Page queue-visibility coverage must match returned batches.",
      });
    }

    const outcomeCounts = {
      claimedWithinThreshold: report.batches.filter(
        (batch) => batch.outcome === "claimed_within_threshold",
      ).length,
      claimedAfterThreshold: report.batches.filter(
        (batch) => batch.outcome === "claimed_after_threshold",
      ).length,
      noRecordedClaimOverdue: report.batches.filter(
        (batch) => batch.outcome === "no_recorded_claim_overdue",
      ).length,
      noRecordedClaimPending: report.batches.filter(
        (batch) => batch.outcome === "no_recorded_claim_pending",
      ).length,
      claimTimeUnavailable: report.batches.filter(
        (batch) => batch.outcome === "claim_time_unavailable",
      ).length,
    };
    for (const [field, expected] of Object.entries(outcomeCounts)) {
      if (report.summary[field as keyof typeof outcomeCounts] !== expected) {
        context.addIssue({
          code: "custom",
          path: ["summary", field],
          message: "Page outcome summary must match returned batches.",
        });
      }
    }

    const thresholdSeconds =
      report.measurement.thresholdDays * 24 * 60 * 60;
    const expectedDeadlineMilliseconds = thresholdSeconds * 1000;
    for (const [index, batch] of report.batches.entries()) {
      const release = Date.parse(batch.releaseObservedAt);
      const deadline = Date.parse(batch.claimDeadlineAt);
      if (deadline - release !== expectedDeadlineMilliseconds) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "claimDeadlineAt"],
          message:
            "Claim deadline must equal observed release plus thresholdDays.",
        });
      }
      if (release < windowStart || release >= windowEnd) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "releaseObservedAt"],
          message: "Returned releases must fall in the declared window.",
        });
      }

      const queueVisibility =
        batch.firstRecordedQueueVisibilityAt === null
          ? null
          : Date.parse(batch.firstRecordedQueueVisibilityAt);
      if (queueVisibility !== null && queueVisibility > generatedAt) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "firstRecordedQueueVisibilityAt"],
          message:
            "Recorded queue visibility cannot follow report generation.",
        });
      }
      if (
        queueVisibility !== null &&
        queueVisibility < queueVisibilityStorageAvailableAt
      ) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "firstRecordedQueueVisibilityAt"],
          message:
            "Recorded queue visibility cannot predate queue-evidence storage.",
        });
      }
      const releasePredatesQueueStorage =
        release < queueVisibilityStorageAvailableAt;
      if (
        (batch.queueVisibilityEvidenceStatus === "observed" &&
          releasePredatesQueueStorage) ||
        (batch.queueVisibilityEvidenceStatus ===
          "observed_after_storage_gap" &&
          !releasePredatesQueueStorage) ||
        (batch.queueVisibilityEvidenceStatus === "no_recorded_visibility" &&
          releasePredatesQueueStorage) ||
        (batch.queueVisibilityEvidenceStatus ===
          "visibility_time_unavailable" &&
          queueVisibility === null &&
          !releasePredatesQueueStorage)
      ) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "queueVisibilityEvidenceStatus"],
          message:
            "Queue visibility evidence status must match the storage-availability boundary.",
        });
      }

      const within = batch.outcome === "claimed_within_threshold";
      const after = batch.outcome === "claimed_after_threshold";
      const overdue = batch.outcome === "no_recorded_claim_overdue";
      const pending = batch.outcome === "no_recorded_claim_pending";
      if (
        (within || after) &&
        batch.claimEvidenceStatus !== "observed"
      ) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "outcome"],
          message: "Claimed outcomes require observed claim evidence.",
        });
      }
      if (
        within &&
        (batch.claimDelaySeconds === null ||
          batch.claimDelaySeconds > thresholdSeconds)
      ) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "claimDelaySeconds"],
          message: "Within-threshold claims cannot exceed the threshold.",
        });
      }
      if (
        after &&
        (batch.claimDelaySeconds === null ||
          batch.claimDelaySeconds <= thresholdSeconds)
      ) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "claimDelaySeconds"],
          message: "After-threshold claims must exceed the threshold.",
        });
      }
      if (
        (overdue || pending) &&
        batch.claimEvidenceStatus !== "no_recorded_claim"
      ) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "outcome"],
          message:
            "No-recorded-claim outcomes require no-recorded-claim evidence status.",
        });
      }
      if (overdue && generatedAt < deadline) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "outcome"],
          message: "An overdue outcome cannot precede its claim deadline.",
        });
      }
      if (pending && generatedAt > deadline) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "outcome"],
          message: "A pending outcome cannot follow its claim deadline.",
        });
      }
      if (
        batch.outcome === "claim_time_unavailable" &&
        batch.claimEvidenceStatus !== "claim_time_unavailable"
      ) {
        context.addIssue({
          code: "custom",
          path: ["batches", index, "outcome"],
          message:
            "Claim-time-unavailable outcome requires matching evidence status.",
        });
      }
    }

    const batchUids = report.batches.map((batch) => batch.batchUid);
    if (new Set(batchUids).size !== batchUids.length) {
      context.addIssue({
        code: "custom",
        path: ["batches"],
        message: "Dispatch-outcome pages cannot contain duplicate batch UIDs.",
      });
    }
    if (
      batchUids.some((uid, index) => index > 0 && uid <= batchUids[index - 1]!)
    ) {
      context.addIssue({
        code: "custom",
        path: ["batches"],
        message: "Dispatch-outcome batches must be sorted by ascending UID.",
      });
    }
    const expectedCursor = report.hasMore
      ? (batchUids[batchUids.length - 1] ?? null)
      : null;
    if (report.nextCursor !== expectedCursor) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message:
          "nextCursor must be the last returned batch UID exactly when hasMore is true.",
      });
    }
  });


const workforceOperationEventIssueSchema = z.enum([
  "coworker_target_not_recorded",
  "event_effect_contract_unavailable",
  "event_provenance_contract_unavailable",
]);
const workforceOperationEventKinds = [
  "work_batch",
  "sequence",
  "group_membership",
] as const;
const workforceOperationEventOperations = [
  "batch_created",
  "priority_changed",
  "status_changed",
  "work_unit_assigned",
  "work_unit_deassigned",
  "coworker_allocated",
  "coworker_deallocated",
  "member_added",
  "member_removed",
  "unknown",
] as const;
const workforceKnownOperationEventOperations = [
  "batch_created",
  "priority_changed",
  "status_changed",
  "work_unit_assigned",
  "work_unit_deassigned",
  "coworker_allocated",
  "coworker_deallocated",
  "member_added",
  "member_removed",
] as const;
type WorkforceOperationEventKind =
  (typeof workforceOperationEventKinds)[number];
const workforceOperationValuesByKind: Record<
  WorkforceOperationEventKind,
  ReadonlySet<string>
> = {
  work_batch: new Set([
    "batch_created",
    "priority_changed",
    "status_changed",
    "work_unit_assigned",
    "work_unit_deassigned",
    "coworker_allocated",
    "coworker_deallocated",
  ]),
  sequence: new Set(["status_changed"]),
  group_membership: new Set(["member_added", "member_removed"]),
};
const workforceOperationEventTargetSchema = z
  .object({
    batchUid: compactUuidOutputSchema.nullable(),
    sequenceUid: compactUuidOutputSchema.nullable(),
    groupUid: compactUuidOutputSchema.nullable(),
    coworkerUid: compactUuidOutputSchema.nullable(),
    workUnitUid: compactUuidOutputSchema.nullable(),
    allocationUid: compactUuidOutputSchema.nullable(),
  })
  .strip();
const workforceOperationEventEffectSchema = z
  .object({
    previousStatus: z.string().min(1).max(50).nullable(),
    currentStatus: z.string().min(1).max(50).nullable(),
    previousPriority: z.enum(["medium", "high"]).nullable(),
    currentPriority: z.enum(["medium", "high"]).nullable(),
    previousStaffingMode: workforceStaffingModeSchema.nullable(),
    currentStaffingMode: workforceStaffingModeSchema.nullable(),
    previousMembership: z.boolean().nullable(),
    currentMembership: z.boolean().nullable(),
    previousAllocation: z.boolean().nullable(),
    currentAllocation: z.boolean().nullable(),
    previousAssigned: z.boolean().nullable(),
    currentAssigned: z.boolean().nullable(),
    workUnitsCreated: z.number().int().min(1).max(100).nullable(),
  })
  .strip();
const workforceOperationEventOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    eventUid: compactUuidOutputSchema,
    eventKind: z.enum(workforceOperationEventKinds),
    operation: z.enum(workforceOperationEventOperations),
    occurredAt: z.string().datetime({ offset: true }),
    target: workforceOperationEventTargetSchema,
    effect: workforceOperationEventEffectSchema,
    provenance: z
      .object({
        source: z.enum(["admin", "api", "mcp", "system", "unknown"]),
        actorRecorded: z.boolean(),
        clientRecorded: z.boolean(),
        reasonRecorded: z.boolean(),
      })
      .strip(),
    verification: z
      .object({
        status: z.enum(["complete", "partial", "unavailable"]),
        issues: z.array(workforceOperationEventIssueSchema).max(3),
      })
      .strip(),
  })
  .strip()
  .superRefine((event, context) => {
    const issues = event.verification.issues;
    const issueSet = new Set(issues);
    if (issueSet.size !== issues.length || issues.join("\u0000") !== [...issues].sort().join("\u0000")) {
      context.addIssue({
        code: "custom",
        path: ["verification", "issues"],
        message: "Verification issues must be sorted and unique.",
      });
    }

    const effectUnavailable = issueSet.has("event_effect_contract_unavailable");
    if (
      (event.verification.status === "complete" && issues.length !== 0) ||
      (event.verification.status === "partial" && (issues.length === 0 || effectUnavailable)) ||
      (event.verification.status === "unavailable" && !effectUnavailable)
    ) {
      context.addIssue({
        code: "custom",
        path: ["verification"],
        message: "Verification status does not match its explicit issues.",
      });
    }

    const provenanceUnavailable = issueSet.has("event_provenance_contract_unavailable");
    if ((event.provenance.source === "unknown") !== provenanceUnavailable) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "source"],
        message: "Unknown provenance must be explicit in verification issues.",
      });
    }

    const missingCoworkerTarget =
      event.eventKind === "work_batch" &&
      event.operation === "work_unit_deassigned" &&
      event.target.coworkerUid === null;
    if (issueSet.has("coworker_target_not_recorded") !== missingCoworkerTarget) {
      context.addIssue({
        code: "custom",
        path: ["verification", "issues"],
        message: "Missing deassignment coworker evidence must be explicit and operation-bound.",
      });
    }

    const primaryTarget =
      event.eventKind === "work_batch"
        ? event.target.batchUid
        : event.eventKind === "sequence"
          ? event.target.sequenceUid
          : event.target.groupUid;
    if (primaryTarget === null) {
      context.addIssue({
        code: "custom",
        path: ["target"],
        message: "The immutable ledger target must be present.",
      });
    }

    const effectEntries = Object.entries(event.effect);
    if (event.verification.status === "unavailable") {
      if (effectEntries.some(([, value]) => value !== null)) {
        context.addIssue({
          code: "custom",
          path: ["effect"],
          message: "Unavailable verification cannot expose partial effects.",
        });
      }
      return;
    }

    if (event.operation === "unknown") {
      context.addIssue({
        code: "custom",
        path: ["operation"],
        message: "Known verification cannot use an unknown operation.",
      });
      return;
    }

    const expectOnlyTargets = (keys: readonly string[]): void => {
      const expected = new Set(keys);
      for (const [key, value] of Object.entries(event.target)) {
        if ((value !== null) !== expected.has(key)) {
          context.addIssue({
            code: "custom",
            path: ["target", key],
            message: "Target identifiers do not match the operation.",
          });
        }
      }
    };
    const expectOnlyEffects = (keys: readonly string[]): void => {
      const expected = new Set(keys);
      for (const [key, value] of effectEntries) {
        if ((value !== null) !== expected.has(key)) {
          context.addIssue({
            code: "custom",
            path: ["effect", key],
            message: "Effect fields do not match the operation.",
          });
        }
      }
    };
    const requireKind = (expected: "work_batch" | "sequence" | "group_membership"): void => {
      if (event.eventKind !== expected) {
        context.addIssue({
          code: "custom",
          path: ["eventKind"],
          message: "Event kind does not own this operation.",
        });
      }
    };

    switch (event.operation) {
      case "batch_created":
        requireKind("work_batch");
        expectOnlyTargets(["batchUid"]);
        expectOnlyEffects(["currentStatus", "currentPriority", "currentStaffingMode", "workUnitsCreated"]);
        if (event.effect.currentStatus !== "unavailable" || event.effect.currentPriority !== "medium") {
          context.addIssue({
            code: "custom",
            path: ["effect"],
            message: "Created batches must start unavailable at medium priority.",
          });
        }
        break;
      case "priority_changed":
        requireKind("work_batch");
        expectOnlyTargets(["batchUid"]);
        expectOnlyEffects(["previousPriority", "currentPriority"]);
        if (event.effect.previousPriority === event.effect.currentPriority) {
          context.addIssue({
            code: "custom",
            path: ["effect", "currentPriority"],
            message: "A priority change must change priority.",
          });
        }
        break;
      case "status_changed":
        requireKind(event.eventKind === "sequence" ? "sequence" : "work_batch");
        expectOnlyTargets([event.eventKind === "sequence" ? "sequenceUid" : "batchUid"]);
        expectOnlyEffects(["previousStatus", "currentStatus"]);
        if (
          event.effect.previousStatus === event.effect.currentStatus ||
          (event.eventKind === "work_batch" &&
            (!["available", "unavailable", "archived"].includes(event.effect.previousStatus ?? "") ||
              !["available", "unavailable", "archived"].includes(event.effect.currentStatus ?? "")))
        ) {
          context.addIssue({
            code: "custom",
            path: ["effect", "currentStatus"],
            message: "Status evidence does not match its ledger kind.",
          });
        }
        break;
      case "work_unit_assigned":
        requireKind("work_batch");
        expectOnlyTargets(["batchUid", "coworkerUid", "workUnitUid"]);
        expectOnlyEffects(["previousStatus", "currentStatus", "previousAssigned", "currentAssigned"]);
        if (
          event.effect.previousStatus !== "backlog" ||
          event.effect.currentStatus !== "in_progress" ||
          event.effect.previousAssigned !== false ||
          event.effect.currentAssigned !== true
        ) {
          context.addIssue({ code: "custom", path: ["effect"], message: "Assignment evidence is inconsistent." });
        }
        break;
      case "work_unit_deassigned":
        requireKind("work_batch");
        expectOnlyTargets(
          missingCoworkerTarget
            ? ["batchUid", "workUnitUid"]
            : ["batchUid", "coworkerUid", "workUnitUid"],
        );
        expectOnlyEffects(["previousStatus", "currentStatus", "previousAssigned", "currentAssigned"]);
        if (
          event.effect.previousStatus !== "in_progress" ||
          event.effect.currentStatus !== "backlog" ||
          event.effect.previousAssigned !== true ||
          event.effect.currentAssigned !== false
        ) {
          context.addIssue({ code: "custom", path: ["effect"], message: "Deassignment evidence is inconsistent." });
        }
        break;
      case "coworker_allocated":
      case "coworker_deallocated": {
        requireKind("work_batch");
        expectOnlyTargets(["allocationUid", "batchUid", "coworkerUid"]);
        expectOnlyEffects(["previousAllocation", "currentAllocation"]);
        const expected = event.operation === "coworker_allocated" ? [false, true] : [true, false];
        if (
          event.effect.previousAllocation !== expected[0] ||
          event.effect.currentAllocation !== expected[1]
        ) {
          context.addIssue({ code: "custom", path: ["effect"], message: "Allocation evidence is inconsistent." });
        }
        break;
      }
      case "member_added":
      case "member_removed": {
        requireKind("group_membership");
        expectOnlyTargets(["coworkerUid", "groupUid"]);
        expectOnlyEffects(["previousMembership", "currentMembership"]);
        const expected = event.operation === "member_added" ? [false, true] : [true, false];
        if (
          event.effect.previousMembership !== expected[0] ||
          event.effect.currentMembership !== expected[1]
        ) {
          context.addIssue({ code: "custom", path: ["effect"], message: "Membership evidence is inconsistent." });
        }
        break;
      }
    }
  });

const workforceOperationHistoryAbsenceDefinition =
  "No returned event means no immutable operation record matched the requested filters and window. It does not prove that no change occurred before the relevant ledger existed or through an uninstrumented mutation path.";
const workforceOperationHistoryStorageDefinition =
  "A ledger window is available when its database table existed for the full requested interval. This describes storage availability, not proof that every mutation path emitted an event.";
const workforceOperationLedgerKeyByKind = {
  work_batch: "workBatch",
  sequence: "sequence",
  group_membership: "groupMembership",
} as const;
const workforceOperationKindCountKey = {
  work_batch: "workBatch",
  sequence: "sequence",
  group_membership: "groupMembership",
} as const;
const workforceOperationCountKey = {
  batch_created: "batchCreated",
  priority_changed: "priorityChanged",
  status_changed: "statusChanged",
  work_unit_assigned: "workUnitAssigned",
  work_unit_deassigned: "workUnitDeassigned",
  coworker_allocated: "coworkerAllocated",
  coworker_deallocated: "coworkerDeallocated",
  member_added: "memberAdded",
  member_removed: "memberRemoved",
  unknown: "unknown",
} as const;

const workforceOperationEventHistoryRowOutputSchema = z
  .object({
    eventEvidenceStatus: z.enum(["observed", "pre_storage_anomaly"]),
    eventUid: compactUuidOutputSchema,
    eventKind: z.enum(workforceOperationEventKinds),
    operation: z.enum(workforceOperationEventOperations),
    occurredAt: z.string().datetime({ offset: true }),
    target: workforceOperationEventTargetSchema,
    effect: workforceOperationEventEffectSchema,
    provenance: z
      .object({
        source: z.enum(["admin", "api", "mcp", "system", "unknown"]),
        actorRecorded: z.boolean(),
        clientRecorded: z.boolean(),
        reasonRecorded: z.boolean(),
      })
      .strip(),
    verification: z
      .object({
        status: z.enum(["complete", "partial", "unavailable"]),
        issues: z.array(workforceOperationEventIssueSchema).max(3),
      })
      .strip(),
  })
  .strip()
  .superRefine((event, context) => {
    const receipt = workforceOperationEventOutputSchema.safeParse({
      generatedAt: event.occurredAt,
      ...event,
    });
    if (!receipt.success) {
      context.addIssue({
        code: "custom",
        message:
          "Operation-history row does not satisfy the immutable receipt contract.",
      });
    }
  });

const workforceOperationLedgerCoverageOutputSchema = z
  .object({
    queried: z.boolean(),
    storageAvailableAt: z.string().datetime({ offset: true }),
    storageWindowStatus: z.enum(["available", "partial", "unavailable"]),
  })
  .strip();

const workforceOperationEventHistoryOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    measurement: z
      .object({
        scope: z.literal("immutable_workforce_operation_history"),
        summaryScope: z.literal("page"),
        occurrenceWindow: z
          .object({
            occurredFrom: z.string().datetime({ offset: true }),
            occurredBefore: z.string().datetime({ offset: true }),
            boundary: z.literal("half_open"),
          })
          .strip(),
        ordering: z.literal("ascending_opaque_event_uid"),
        absenceDefinition: z.literal(
          workforceOperationHistoryAbsenceDefinition,
        ),
        storageDefinition: z.literal(
          workforceOperationHistoryStorageDefinition,
        ),
        legacyBackfillPerformed: z.literal(false),
      })
      .strip(),
    coverage: z
      .object({
        evidenceScope: z.literal("page"),
        queriedEventKinds: z
          .array(z.enum(workforceOperationEventKinds))
          .min(1)
          .max(3),
        ledgerWindows: z
          .object({
            workBatch: workforceOperationLedgerCoverageOutputSchema,
            sequence: workforceOperationLedgerCoverageOutputSchema,
            groupMembership: workforceOperationLedgerCoverageOutputSchema,
          })
          .strip(),
        returnedEvents: nonnegativeCount.max(50),
        verification: z
          .object({
            complete: nonnegativeCount,
            partial: nonnegativeCount,
            unavailable: nonnegativeCount,
          })
          .strip(),
      })
      .strip(),
    summary: z
      .object({
        eventKinds: z
          .object({
            workBatch: nonnegativeCount,
            sequence: nonnegativeCount,
            groupMembership: nonnegativeCount,
          })
          .strip(),
        operations: z
          .object({
            batchCreated: nonnegativeCount,
            priorityChanged: nonnegativeCount,
            statusChanged: nonnegativeCount,
            workUnitAssigned: nonnegativeCount,
            workUnitDeassigned: nonnegativeCount,
            coworkerAllocated: nonnegativeCount,
            coworkerDeallocated: nonnegativeCount,
            memberAdded: nonnegativeCount,
            memberRemoved: nonnegativeCount,
            unknown: nonnegativeCount,
          })
          .strip(),
      })
      .strip(),
    events: z.array(workforceOperationEventHistoryRowOutputSchema).max(50),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip()
  .superRefine((report, context) => {
    const { occurredFrom, occurredBefore } =
      report.measurement.occurrenceWindow;
    const windowStart = Date.parse(occurredFrom);
    const windowEnd = Date.parse(occurredBefore);
    const generatedAt = Date.parse(report.generatedAt);
    if (
      windowStart >= windowEnd ||
      windowEnd - windowStart > 31 * 24 * 60 * 60 * 1000 ||
      windowEnd > generatedAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "occurrenceWindow"],
        message:
          "Provider operation window must be past, ordered, and at most 31 days.",
      });
    }

    const queriedKinds = report.coverage.queriedEventKinds;
    const expectedKindOrder = workforceOperationEventKinds.filter((kind) =>
      queriedKinds.includes(kind),
    );
    if (
      new Set(queriedKinds).size !== queriedKinds.length ||
      queriedKinds.join("\u0000") !== expectedKindOrder.join("\u0000")
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "queriedEventKinds"],
        message: "Queried event kinds must be unique and canonically ordered.",
      });
    }

    for (const kind of workforceOperationEventKinds) {
      const ledgerKey = workforceOperationLedgerKeyByKind[kind];
      const ledger = report.coverage.ledgerWindows[ledgerKey];
      const storageAvailableAt = Date.parse(ledger.storageAvailableAt);
      if (storageAvailableAt > generatedAt) {
        context.addIssue({
          code: "custom",
          path: ["coverage", "ledgerWindows", ledgerKey, "storageAvailableAt"],
          message: "Ledger storage cannot begin after report generation.",
        });
      }
      if (ledger.queried !== queriedKinds.includes(kind)) {
        context.addIssue({
          code: "custom",
          path: ["coverage", "ledgerWindows", ledgerKey, "queried"],
          message: "Ledger queried state must match queriedEventKinds.",
        });
      }
      const expectedStorageStatus =
        windowEnd <= storageAvailableAt
          ? "unavailable"
          : windowStart < storageAvailableAt
            ? "partial"
            : "available";
      if (ledger.storageWindowStatus !== expectedStorageStatus) {
        context.addIssue({
          code: "custom",
          path: [
            "coverage",
            "ledgerWindows",
            ledgerKey,
            "storageWindowStatus",
          ],
          message:
            "Ledger storage-window status must match its activation boundary.",
        });
      }
    }

    const expectedKindCounts = {
      workBatch: 0,
      sequence: 0,
      groupMembership: 0,
    };
    const expectedOperationCounts = {
      batchCreated: 0,
      priorityChanged: 0,
      statusChanged: 0,
      workUnitAssigned: 0,
      workUnitDeassigned: 0,
      coworkerAllocated: 0,
      coworkerDeallocated: 0,
      memberAdded: 0,
      memberRemoved: 0,
      unknown: 0,
    };
    const expectedVerificationCounts = {
      complete: 0,
      partial: 0,
      unavailable: 0,
    };
    for (const [index, event] of report.events.entries()) {
      const occurredAt = Date.parse(event.occurredAt);
      if (occurredAt < windowStart || occurredAt >= windowEnd) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "occurredAt"],
          message: "Returned operation event is outside the requested window.",
        });
      }
      if (!queriedKinds.includes(event.eventKind)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "eventKind"],
          message: "Returned operation event belongs to an unqueried ledger.",
        });
      }
      const ledgerKey = workforceOperationLedgerKeyByKind[event.eventKind];
      const expectedEvidenceStatus =
        occurredAt >=
        Date.parse(
          report.coverage.ledgerWindows[ledgerKey].storageAvailableAt,
        )
          ? "observed"
          : "pre_storage_anomaly";
      if (event.eventEvidenceStatus !== expectedEvidenceStatus) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "eventEvidenceStatus"],
          message:
            "Event evidence status must match its ledger activation boundary.",
        });
      }
      expectedKindCounts[workforceOperationKindCountKey[event.eventKind]] += 1;
      expectedOperationCounts[workforceOperationCountKey[event.operation]] += 1;
      expectedVerificationCounts[event.verification.status] += 1;
    }

    if (report.coverage.returnedEvents !== report.events.length) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "returnedEvents"],
        message: "Returned-event coverage must match the page rows.",
      });
    }
    for (const [field, expected] of Object.entries(expectedKindCounts)) {
      if (
        report.summary.eventKinds[
          field as keyof typeof expectedKindCounts
        ] !== expected
      ) {
        context.addIssue({
          code: "custom",
          path: ["summary", "eventKinds", field],
          message: "Page event-kind summary must match returned rows.",
        });
      }
    }
    for (const [field, expected] of Object.entries(expectedOperationCounts)) {
      if (
        report.summary.operations[
          field as keyof typeof expectedOperationCounts
        ] !== expected
      ) {
        context.addIssue({
          code: "custom",
          path: ["summary", "operations", field],
          message: "Page operation summary must match returned rows.",
        });
      }
    }
    for (const [field, expected] of Object.entries(
      expectedVerificationCounts,
    )) {
      if (
        report.coverage.verification[
          field as keyof typeof expectedVerificationCounts
        ] !== expected
      ) {
        context.addIssue({
          code: "custom",
          path: ["coverage", "verification", field],
          message: "Page verification summary must match returned rows.",
        });
      }
    }

    const eventUids = report.events.map((event) => event.eventUid);
    if (report.hasMore && eventUids.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["hasMore"],
        message: "A continued operation-history page must return a cursor-bearing event.",
      });
    }
    if (new Set(eventUids).size !== eventUids.length) {
      context.addIssue({
        code: "custom",
        path: ["events"],
        message: "Operation-event UIDs must be unique within a page.",
      });
    }
    if (
      eventUids.some(
        (uid, index) => index > 0 && uid <= eventUids[index - 1]!,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["events"],
        message: "Operation events must be sorted by ascending opaque UID.",
      });
    }
    const expectedCursor = report.hasMore
      ? (eventUids[eventUids.length - 1] ?? null)
      : null;
    if (report.nextCursor !== expectedCursor) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message:
          "nextCursor must be the last event UID exactly when hasMore is true.",
      });
    }
  });

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

const workforceBatchAllocationEffectOutputSchema = z
  .object({
    scope: z.literal("batch"),
    wouldChangeAllocation: z.boolean(),
    qualifiedForBatchWork: z.boolean(),
    currentEligibility: z.boolean(),
    projectedEligibility: z.boolean(),
    activeAssignedBatchWorkUnits: nonnegativeCount,
    removalBlockedByActiveBatchWork: z.boolean(),
    eligibleAllocatedCoworkersAfterChange: nonnegativeCount,
    removalWouldLeaveAvailableBatchUnstaffed: z.boolean(),
  })
  .strip();

const workforceBatchAllocationExpectedEffectInputSchema = z
  .object({
    scope: z.literal("batch"),
    wouldChangeAllocation: z.literal(true),
    qualifiedForBatchWork: z.boolean(),
    currentEligibility: z.boolean(),
    projectedEligibility: z.boolean(),
    activeAssignedBatchWorkUnits: nonnegativeCount,
    removalBlockedByActiveBatchWork: z.literal(false),
    eligibleAllocatedCoworkersAfterChange: nonnegativeCount,
    removalWouldLeaveAvailableBatchUnstaffed: z.literal(false),
  })
  .strict();

const workforceCandidateOperationalSignalsOutputSchema = z
  .object({
    completedWorkUnits: nonnegativeCount,
    abandonedWorkUnits: nonnegativeCount,
    erroredWorkUnits: nonnegativeCount,
    lastCompletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strip();

const workforceBatchStaffingCandidatesOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    batchUid: compactUuidOutputSchema,
    batchStatus: z.enum(["available", "unavailable", "archived"]),
    staffingMode: workforceStaffingModeSchema,
    lineContext: workforceLineContextOutputSchema.extend({
      organizationUid: compactUuidOutputSchema,
    }),
    signalWindow: z
      .object({
        days: z.number().int().min(1).max(90),
        startsAt: z.string().datetime({ offset: true }),
      })
      .strip(),
    signalScope: z
      .object({
        organizationUid: compactUuidOutputSchema,
        batchUid: compactUuidOutputSchema,
      })
      .strip(),
    candidates: z
      .array(
        z
          .object({
            coworkerUid: compactUuidOutputSchema,
            currentAllocation: z.boolean(),
            readiness: workforceGroupMemberReadinessOutputSchema,
            matchingGroupUnitsByStatus: workUnitStatusOutputSchema,
            operationalSignals: workforceCandidateOperationalSignalsOutputSchema,
          })
          .strip(),
      )
      .max(100),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip();

const workforceBatchCoworkerActivityOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    batchUid: compactUuidOutputSchema,
    batchStatus: z.enum(["available", "unavailable", "archived"]),
    staffingMode: workforceStaffingModeSchema,
    lineContext: workforceLineContextOutputSchema,
    activityWindow: z
      .object({
        days: z.number().int().min(1).max(90),
        startsAt: z.string().datetime({ offset: true }),
      })
      .strip(),
    coworkers: z
      .array(
        z
          .object({
            coworkerUid: compactUuidOutputSchema,
            currentAllocation: z.boolean(),
            readiness: workforceGroupMemberReadinessOutputSchema,
            assignedUnitsByStatus: workUnitStatusOutputSchema,
            activity: z
              .object({
                submittedForReviewWorkUnits: nonnegativeCount,
                completedWorkUnits: nonnegativeCount,
                abandonedWorkUnits: nonnegativeCount,
                erroredWorkUnits: nonnegativeCount,
                lastActivityAt: z
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

const workforceBatchAllocationImpactOutputSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    operation: z.enum(["add", "remove"]),
    batchUid: compactUuidOutputSchema,
    coworkerUid: compactUuidOutputSchema,
    batchStatus: z.enum(["available", "unavailable", "archived"]),
    staffingMode: workforceStaffingModeSchema,
    batchUpdatedAt: z.string().datetime({ offset: true }),
    lineContext: workforceLineContextOutputSchema,
    currentAllocation: z.boolean(),
    readiness: workforceGroupMemberReadinessOutputSchema,
    matchingGroupUnitsByStatus: workUnitStatusOutputSchema,
    effect: workforceBatchAllocationEffectOutputSchema,
  })
  .strip();

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

const coworkerJourneyTimestampSchema = z.string().datetime({ offset: true });
const workforceCoworkerReliabilityClassificationSchema = z.enum([
  "output_observed",
  "no_output_task_shortage_observed",
  "no_output_work_available_observed",
  "activity_evidence_unavailable",
]);
const workforceCoworkerReliabilityOutputSchema = z
  .object({
    generatedAt: coworkerJourneyTimestampSchema,
    measurement: z
      .object({
        scope: z.literal("sampled_global_work_queue"),
        summaryScope: z.literal("page"),
        observationWindow: z
          .object({
            observedFrom: coworkerJourneyTimestampSchema,
            observedBefore: coworkerJourneyTimestampSchema,
            boundary: z.literal("half_open"),
          })
          .strip(),
        storageAvailableAt: coworkerJourneyTimestampSchema,
        storageWindowStatus: z.enum(["complete", "partial", "unavailable"]),
        storageWindowComplete: z.boolean(),
        observationDefinition: z.literal(
          "A successful self-service request to the initial page of the coworker's global available-work-batches queue. Continuation pages are excluded because an empty later page does not mean the global queue was empty.",
        ),
        samplingDefinition: z.literal(
          "Only the first response per coworker, UTC day, and outcome is retained. A later different outcome on the same day is retained separately.",
        ),
        visibleQueueCountDefinition: z.literal(
          "Counts describe only the returned response page and are lower bounds when another page exists.",
        ),
        outputDefinition: z.literal(
          "At least one recorded non-practice result creation or work-unit transition from IN_PROGRESS to IN_REVIEW or COMPLETED inside the same window.",
        ),
        classificationDefinition: z.literal(
          "Task shortage requires no output plus only recorded no-eligible-work observations. Any recorded eligible queue or active assignment puts a no-output coworker in work-available; mixed evidence therefore never becomes task shortage. This is an operational follow-up signal, not proof of deliberate idleness.",
        ),
        identityDefinition: z.literal(
          "Rows contain only the coworker's stable public UID; names, contact details, pay, rankings, customer payloads, and group details are excluded.",
        ),
        recordingMode: z.literal("sampled_best_effort"),
        recordingCompletenessProven: z.literal(false),
        legacyBackfillPerformed: z.literal(false),
      })
      .strip(),
    coverage: z
      .object({
        evidenceScope: z.literal("page"),
        returnedCoworkers: nonnegativeCount.max(50),
        recordedObservations: nonnegativeCount,
        recordedObservationDays: nonnegativeCount,
        preStorageObservations: nonnegativeCount,
        coworkersWithActivityEvidenceUnavailable: nonnegativeCount,
      })
      .strip(),
    summary: z
      .object({
        outputObserved: nonnegativeCount,
        noOutputTaskShortageObserved: nonnegativeCount,
        noOutputWorkAvailableObserved: nonnegativeCount,
        activityEvidenceUnavailable: nonnegativeCount,
      })
      .strip(),
    coworkers: z
      .array(
        z
          .object({
            coworkerUid: compactUuidOutputSchema,
            queueEvidence: z
              .object({
                recordedObservations: z.number().int().min(1),
                observedDays: z.number().int().min(1),
                eligibleWorkObservations: nonnegativeCount,
                noEligibleWorkObservations: nonnegativeCount,
                activeAssignmentObservations: nonnegativeCount,
                firstObservedAt: coworkerJourneyTimestampSchema,
                lastObservedAt: coworkerJourneyTimestampSchema,
                preStorageObservations: nonnegativeCount,
              })
              .strip(),
            outputEvidence: z
              .object({
                evidenceStatus: z.enum(["observed", "unavailable"]),
                recordedResultsCreated: nonnegativeCount.nullable(),
                workUnitsSubmittedForReview: nonnegativeCount.nullable(),
                workUnitsCompleted: nonnegativeCount.nullable(),
                producedOutput: z.boolean().nullable(),
              })
              .strip(),
            classification: workforceCoworkerReliabilityClassificationSchema,
          })
          .strip(),
      )
      .max(50),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip()
  .superRefine((report, context) => {
    const observedFrom = Date.parse(
      report.measurement.observationWindow.observedFrom,
    );
    const observedBefore = Date.parse(
      report.measurement.observationWindow.observedBefore,
    );
    const storageAvailableAt = Date.parse(
      report.measurement.storageAvailableAt,
    );
    const expectedStorageStatus =
      observedBefore <= storageAvailableAt
        ? "unavailable"
        : observedFrom < storageAvailableAt
          ? "partial"
          : "complete";
    if (report.measurement.storageWindowStatus !== expectedStorageStatus) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "storageWindowStatus"],
        message: "Storage coverage status does not match the requested window.",
      });
    }
    if (
      report.measurement.storageWindowComplete !==
      (report.measurement.storageWindowStatus === "complete")
    ) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "storageWindowComplete"],
        message: "Storage completeness does not match storageWindowStatus.",
      });
    }

    const seenCoworkers = new Set<string>();
    let previousCoworkerUid: string | undefined;
    for (const [index, coworker] of report.coworkers.entries()) {
      if (seenCoworkers.has(coworker.coworkerUid)) {
        context.addIssue({
          code: "custom",
          path: ["coworkers", index, "coworkerUid"],
          message: "Coworker UIDs must be unique within a page.",
        });
      }
      seenCoworkers.add(coworker.coworkerUid);
      if (
        previousCoworkerUid !== undefined &&
        coworker.coworkerUid <= previousCoworkerUid
      ) {
        context.addIssue({
          code: "custom",
          path: ["coworkers", index, "coworkerUid"],
          message: "Coworker rows must be ordered by ascending UID.",
        });
      }
      previousCoworkerUid = coworker.coworkerUid;

      const queue = coworker.queueEvidence;
      if (
        queue.recordedObservations !==
        queue.eligibleWorkObservations +
          queue.noEligibleWorkObservations +
          queue.activeAssignmentObservations
      ) {
        context.addIssue({
          code: "custom",
          path: ["coworkers", index, "queueEvidence"],
          message: "Queue outcome counts must sum to recorded observations.",
        });
      }
      if (
        queue.observedDays > queue.recordedObservations ||
        queue.preStorageObservations > queue.recordedObservations
      ) {
        context.addIssue({
          code: "custom",
          path: ["coworkers", index, "queueEvidence"],
          message: "Queue evidence subset counts cannot exceed observations.",
        });
      }
      if (
        report.measurement.storageWindowStatus === "complete" &&
        queue.preStorageObservations !== 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["coworkers", index, "queueEvidence", "preStorageObservations"],
          message:
            "A complete storage window cannot contain pre-storage observations.",
        });
      }
      const firstObservedAt = Date.parse(queue.firstObservedAt);
      const lastObservedAt = Date.parse(queue.lastObservedAt);
      if (
        firstObservedAt < observedFrom ||
        lastObservedAt >= observedBefore ||
        firstObservedAt > lastObservedAt
      ) {
        context.addIssue({
          code: "custom",
          path: ["coworkers", index, "queueEvidence"],
          message: "Queue evidence timestamps must be ordered inside the requested window.",
        });
      }

      const output = coworker.outputEvidence;
      const outputCounts = [
        output.recordedResultsCreated,
        output.workUnitsSubmittedForReview,
        output.workUnitsCompleted,
      ];
      let expectedClassification: z.infer<
        typeof workforceCoworkerReliabilityClassificationSchema
      >;
      if (output.evidenceStatus === "unavailable") {
        if (
          outputCounts.some((count) => count !== null) ||
          output.producedOutput !== null
        ) {
          context.addIssue({
            code: "custom",
            path: ["coworkers", index, "outputEvidence"],
            message: "Unavailable activity evidence must use null values.",
          });
        }
        expectedClassification = "activity_evidence_unavailable";
      } else {
        if (
          outputCounts.some((count) => count === null) ||
          output.producedOutput === null
        ) {
          context.addIssue({
            code: "custom",
            path: ["coworkers", index, "outputEvidence"],
            message: "Observed activity evidence cannot use null values.",
          });
        }
        const expectedProducedOutput = outputCounts.some(
          (count) => count !== null && count > 0,
        );
        if (output.producedOutput !== expectedProducedOutput) {
          context.addIssue({
            code: "custom",
            path: ["coworkers", index, "outputEvidence", "producedOutput"],
            message: "Produced-output status does not match the activity counts.",
          });
        }
        expectedClassification = expectedProducedOutput
          ? "output_observed"
          : queue.eligibleWorkObservations > 0 ||
              queue.activeAssignmentObservations > 0
            ? "no_output_work_available_observed"
            : "no_output_task_shortage_observed";
      }
      if (coworker.classification !== expectedClassification) {
        context.addIssue({
          code: "custom",
          path: ["coworkers", index, "classification"],
          message: "Coworker classification does not match its evidence.",
        });
      }
    }

    const classifications = report.coworkers.map(
      (coworker) => coworker.classification,
    );
    const expectedSummary = {
      outputObserved: classifications.filter(
        (value) => value === "output_observed",
      ).length,
      noOutputTaskShortageObserved: classifications.filter(
        (value) => value === "no_output_task_shortage_observed",
      ).length,
      noOutputWorkAvailableObserved: classifications.filter(
        (value) => value === "no_output_work_available_observed",
      ).length,
      activityEvidenceUnavailable: classifications.filter(
        (value) => value === "activity_evidence_unavailable",
      ).length,
    };
    for (const [field, expected] of Object.entries(expectedSummary)) {
      if (report.summary[field as keyof typeof expectedSummary] !== expected) {
        context.addIssue({
          code: "custom",
          path: ["summary", field],
          message: "Page summary does not match the returned coworkers.",
        });
      }
    }

    const expectedCoverage = {
      returnedCoworkers: report.coworkers.length,
      recordedObservations: report.coworkers.reduce(
        (total, coworker) =>
          total + coworker.queueEvidence.recordedObservations,
        0,
      ),
      recordedObservationDays: report.coworkers.reduce(
        (total, coworker) => total + coworker.queueEvidence.observedDays,
        0,
      ),
      preStorageObservations: report.coworkers.reduce(
        (total, coworker) =>
          total + coworker.queueEvidence.preStorageObservations,
        0,
      ),
      coworkersWithActivityEvidenceUnavailable:
        expectedSummary.activityEvidenceUnavailable,
    };
    for (const [field, expected] of Object.entries(expectedCoverage)) {
      if (report.coverage[field as keyof typeof expectedCoverage] !== expected) {
        context.addIssue({
          code: "custom",
          path: ["coverage", field],
          message: "Page coverage does not match the returned coworkers.",
        });
      }
    }

    const expectedCursor = report.hasMore
      ? (report.coworkers.at(-1)?.coworkerUid ?? null)
      : null;
    if (report.hasMore && expectedCursor === null) {
      context.addIssue({
        code: "custom",
        path: ["hasMore"],
        message: "A continuing result must contain a non-empty coworker page.",
      });
    } else if (report.nextCursor !== expectedCursor) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message: "nextCursor must be the last returned coworker UID exactly when hasMore is true.",
      });
    }
  });
const workforceTrainingCandidatesOutputSchema = z
  .object({
    generatedAt: coworkerJourneyTimestampSchema,
    window: z
      .object({
        completedFrom: coworkerJourneyTimestampSchema,
        completedBefore: coworkerJourneyTimestampSchema,
      })
      .strip(),
    coverage: z
      .object({
        scanOrder: z.literal("coworker_uid"),
        candidateOrder: z.literal("earliest_completed_at"),
        scannedCoworkers: z.number().int().min(0).max(10),
        matchedLearningIdentities: z.number().int().min(0).max(10),
        notLinkedLearningIdentities: z.number().int().min(0).max(10),
        completedTrainingCoworkers: z.number().int().min(0).max(10),
        excludedWithPaidOutcomes: z.number().int().min(0).max(10),
        globalEarliestComplete: z.boolean(),
      })
      .strip(),
    candidates: z
      .array(
        z
          .object({
            coworkerUid: compactUuidOutputSchema,
            displayName: z.string().min(1).max(150),
            training: z
              .object({
                completedJourneysInWindow: z.number().int().min(1).max(500),
                earliestCompletedAt: coworkerJourneyTimestampSchema,
              })
              .strip(),
            production: z
              .object({
                scope: z.literal("visible_non_practice"),
                acceptedResults: z.literal(0),
                overlookedResults: z.literal(0),
              })
              .strip(),
          })
          .strip(),
      )
      .max(10),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip()
  .superRefine((value, context) => {
    const { coverage, candidates } = value;
    if (
      coverage.matchedLearningIdentities +
        coverage.notLinkedLearningIdentities !==
      coverage.scannedCoworkers
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "scannedCoworkers"],
        message: "Learning identity coverage does not match the scan count.",
      });
    }
    if (
      coverage.completedTrainingCoworkers >
        coverage.matchedLearningIdentities ||
      coverage.completedTrainingCoworkers !==
        candidates.length + coverage.excludedWithPaidOutcomes
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "completedTrainingCoworkers"],
        message:
          "Training completion coverage does not match candidates and paid exclusions.",
      });
    }
    if (value.hasMore !== (value.nextCursor !== null)) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message: "Pagination continuation does not match hasMore.",
      });
    }
    if (value.hasMore && coverage.scannedCoworkers === 0) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "scannedCoworkers"],
        message: "A continuing page must scan at least one coworker.",
      });
    }
    if (
      coverage.globalEarliestComplete &&
      (value.hasMore || coverage.notLinkedLearningIdentities !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "globalEarliestComplete"],
        message:
          "A global earliest claim cannot have pagination or Learning identity gaps.",
      });
    }

    const completedFrom = Date.parse(value.window.completedFrom);
    const completedBefore = Date.parse(value.window.completedBefore);
    const seenCoworkers = new Set<string>();
    let previous: { completedAt: number; coworkerUid: string } | undefined;
    for (const [index, candidate] of candidates.entries()) {
      const completedAt = Date.parse(candidate.training.earliestCompletedAt);
      if (completedAt < completedFrom || completedAt >= completedBefore) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "training", "earliestCompletedAt"],
          message: "Candidate completion is outside the requested window.",
        });
      }
      if (seenCoworkers.has(candidate.coworkerUid)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "coworkerUid"],
          message: "Candidate coworker UIDs must be unique within a page.",
        });
      }
      seenCoworkers.add(candidate.coworkerUid);
      if (
        previous &&
        (completedAt < previous.completedAt ||
          (completedAt === previous.completedAt &&
            candidate.coworkerUid < previous.coworkerUid))
      ) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index],
          message:
            "Candidates must be ordered by earliest completion and then coworker UID.",
        });
      }
      previous = { completedAt, coworkerUid: candidate.coworkerUid };
    }
  });

const workforceTrainingCohortProgressPointSchema = z.discriminatedUnion(
  "availability",
  [
    z
      .object({
        availability: z.literal("available"),
        module: z
          .object({
            uid: z.string().min(1).max(255),
            slug: z.string().min(1).max(255),
            title: z.string().min(1).max(500),
            currentSortOrder: nonnegativeCount,
            currentlyRequired: z.boolean(),
          })
          .strip(),
        lesson: z
          .object({
            uid: z.string().min(1).max(255),
            slug: z.string().min(1).max(255),
            title: z.string().min(1).max(500),
            currentSortOrder: nonnegativeCount,
          })
          .strip(),
        step: z
          .object({
            uid: z.string().min(1).max(255),
          })
          .strip(),
        completedAt: coworkerJourneyTimestampSchema,
        evidenceComputedAt: coworkerJourneyTimestampSchema,
      })
      .strip(),
    z
      .object({
        availability: z.literal("content_unmapped"),
        moduleUid: z.string().min(1).max(255).nullable(),
        lessonUid: z.string().min(1).max(255).nullable(),
        stepUid: z.string().min(1).max(255).nullable(),
        completedAt: coworkerJourneyTimestampSchema,
        evidenceComputedAt: coworkerJourneyTimestampSchema,
      })
      .strip(),
    z
      .object({
        availability: z.literal("no_matching_completed_step_fact"),
      })
      .strip(),
    z
      .object({
        availability: z.literal("progress_rollup_not_computed"),
      })
      .strip(),
  ],
);

function workforceRateMatches(
  actual: number | null,
  numerator: number,
  denominator: number,
): boolean {
  if (denominator === 0) return actual === null;
  return actual !== null && Math.abs(actual - numerator / denominator) <= 1e-12;
}

const noReturnedMemberPracticeEvidence =
  "not_queried_no_returned_members_without_observed_current_output" as const;

const workforceTrainingPracticeExerciseSchema = z
  .object({
    exercise: z
      .object({
        module: z
          .object({
            uid: z.string().min(1).max(255),
            slug: z.string().min(1).max(255),
            title: z.string().min(1).max(500),
            currentSortOrder: nonnegativeCount,
            currentlyRequired: z.boolean(),
          })
          .strip(),
        lesson: z
          .object({
            uid: z.string().min(1).max(255),
            slug: z.string().min(1).max(255),
            title: z.string().min(1).max(500),
            currentSortOrder: nonnegativeCount,
          })
          .strip(),
        step: z
          .object({
            uid: z.string().min(1).max(255),
          })
          .strip(),
        taskName: z.string().min(1).max(100),
      })
      .strip(),
    members: z
      .object({
        eligible: z.number().int().min(0).max(10),
        attempted: z.number().int().min(0).max(10),
        withRecordedFailure: z.number().int().min(0).max(10),
        withRecordedPass: z.number().int().min(0).max(10),
        withRecordedFailureAndNoPass: z.number().int().min(0).max(10),
        withVerifiedFailureAndNoVerifiedPass: z
          .number()
          .int()
          .min(0)
          .max(10),
      })
      .strip(),
    outcomes: z
      .object({
        recorded: nonnegativeCount,
        passed: nonnegativeCount,
        failed: nonnegativeCount,
        verifiedPassed: nonnegativeCount,
        verifiedFailed: nonnegativeCount,
        unverifiedGraded: nonnegativeCount,
        sandbox: nonnegativeCount,
        unusableCurrentRowEntries: nonnegativeCount,
        invalidCurrentRows: nonnegativeCount,
        excludedPreEnrollment: nonnegativeCount,
      })
      .strip(),
    loadFailures: z
      .object({
        affectedMembers: z.number().int().min(0).max(10),
        recordedEvents: nonnegativeCount,
        failedFrames: nonnegativeCount,
        observedFrames: nonnegativeCount,
        byKind: z
          .object({
            network: nonnegativeCount,
            http: nonnegativeCount,
            processing: nonnegativeCount,
            unsupportedFormat: nonnegativeCount,
            metadata: nonnegativeCount,
          })
          .strip(),
        affectedBrowserFamilyCount: nonnegativeCount,
        affectedPracticeBuildCount: nonnegativeCount,
      })
      .strip(),
  })
  .strip();

const workforceTrainingPracticeEvidenceSchema = z
  .discriminatedUnion("availability", [
    z
      .object({
        availability: z.literal("available"),
        learningGeneratedAt: coworkerJourneyTimestampSchema,
        population: z
          .object({
            scope: z.literal(
              "returned_current_cohort_members_without_observed_currently_qualifying_output",
            ),
            returnedMembersWithoutObservedCurrentlyQualifyingOutput: z
              .number()
              .int()
              .min(0)
              .max(10),
            matchedCurrentLearningMembers: z.number().int().min(0).max(10),
          })
          .strip(),
        outcomeEvidence: z
          .object({
            source: z.literal("user_step_progress.practice_results"),
            coverage: z.enum([
              "current_rows_complete",
              "partial_unusable_current_rows",
            ]),
          })
          .strip(),
        loadFailureEvidence: z
          .object({
            source: z.literal("practice_task_load_failures"),
            conservativeRecordingStartedAt: coworkerJourneyTimestampSchema,
            windowCoverage: z.enum([
              "within_conservative_recording_era",
              "overlaps_pre_recording_era",
            ]),
            delivery: z.literal("best_effort_client_diagnostics"),
          })
          .strip(),
        currentJourneyExerciseCount: z.number().int().min(0).max(200),
        exercises: z.array(workforceTrainingPracticeExerciseSchema).max(200),
      })
      .strip(),
    z
      .object({
        availability: z.literal(noReturnedMemberPracticeEvidence),
        learningGeneratedAt: z.null(),
        population: z
          .object({
            scope: z.literal(
              "returned_current_cohort_members_without_observed_currently_qualifying_output",
            ),
            returnedMembersWithoutObservedCurrentlyQualifyingOutput: z.literal(0),
            matchedCurrentLearningMembers: z.literal(0),
          })
          .strip(),
        outcomeEvidence: z
          .object({
            source: z.literal("user_step_progress.practice_results"),
            coverage: z.literal(noReturnedMemberPracticeEvidence),
          })
          .strip(),
        loadFailureEvidence: z
          .object({
            source: z.literal("practice_task_load_failures"),
            conservativeRecordingStartedAt: z.null(),
            windowCoverage: z.literal(noReturnedMemberPracticeEvidence),
            delivery: z.literal("best_effort_client_diagnostics"),
          })
          .strip(),
        currentJourneyExerciseCount: z.null(),
        exercises: z.array(workforceTrainingPracticeExerciseSchema).max(0),
      })
      .strip(),
  ])
  .superRefine((practice, context) => {
    if (practice.availability !== "available") return;

    const addIssue = (path: (string | number)[], message: string): void => {
      context.addIssue({ code: "custom", path, message });
    };
    const matchedMembers = practice.population.matchedCurrentLearningMembers;
    if (
      matchedMembers === 0 ||
      practice.population.returnedMembersWithoutObservedCurrentlyQualifyingOutput !==
        matchedMembers
    ) {
      addIssue(
        ["population"],
        "Available practice evidence requires the complete returned no-output subset.",
      );
    }
    if (practice.currentJourneyExerciseCount !== practice.exercises.length) {
      addIssue(
        ["currentJourneyExerciseCount"],
        "Practice exercise count does not match the returned exercises.",
      );
    }

    const seenStepUids = new Set<string>();
    let previousOrder:
      | {
          moduleSort: number;
          moduleUid: string;
          lessonSort: number;
          lessonUid: string;
          stepUid: string;
        }
      | undefined;
    let containsUnusableOutcomeRows = false;
    for (const [index, row] of practice.exercises.entries()) {
      const path = ["exercises", index];
      const { exercise, members, outcomes, loadFailures } = row;
      if (
        members.eligible !== matchedMembers ||
        members.attempted > members.eligible ||
        members.withRecordedFailure > members.attempted ||
        members.withRecordedPass > members.attempted ||
        members.withRecordedFailureAndNoPass >
          members.withRecordedFailure ||
        members.withVerifiedFailureAndNoVerifiedPass >
          members.withRecordedFailure
      ) {
        addIssue(
          [...path, "members"],
          "Practice member counts do not reconcile to the eligible cohort subset.",
        );
      }
      if (
        outcomes.recorded < members.attempted ||
        outcomes.recorded !== outcomes.passed + outcomes.failed ||
        outcomes.recorded !==
          outcomes.verifiedPassed +
            outcomes.verifiedFailed +
            outcomes.unverifiedGraded +
            outcomes.sandbox ||
        outcomes.verifiedPassed > outcomes.passed ||
        outcomes.verifiedFailed > outcomes.failed
      ) {
        addIssue(
          [...path, "outcomes"],
          "Practice outcome counts do not reconcile.",
        );
      }
      const failureKindCounts = Object.values(loadFailures.byKind);
      if (
        loadFailures.affectedMembers > members.eligible ||
        loadFailures.affectedMembers > loadFailures.recordedEvents ||
        loadFailures.failedFrames > loadFailures.observedFrames ||
        failureKindCounts.some(
          (count) => count > loadFailures.recordedEvents,
        ) ||
        loadFailures.affectedBrowserFamilyCount >
          loadFailures.recordedEvents ||
        loadFailures.affectedPracticeBuildCount > loadFailures.recordedEvents
      ) {
        addIssue(
          [...path, "loadFailures"],
          "Practice load-failure counts do not reconcile.",
        );
      }

      containsUnusableOutcomeRows =
        containsUnusableOutcomeRows ||
        outcomes.unusableCurrentRowEntries > 0 ||
        outcomes.invalidCurrentRows > 0;
      const stepUid = exercise.step.uid;
      if (seenStepUids.has(stepUid)) {
        addIssue(
          [...path, "exercise", "step", "uid"],
          "Practice exercise step UIDs must be unique.",
        );
      }
      seenStepUids.add(stepUid);
      const order = {
        moduleSort: exercise.module.currentSortOrder,
        moduleUid: exercise.module.uid,
        lessonSort: exercise.lesson.currentSortOrder,
        lessonUid: exercise.lesson.uid,
        stepUid,
      };
      let followsPrevious = previousOrder === undefined;
      if (previousOrder !== undefined) {
        if (order.moduleSort !== previousOrder.moduleSort) {
          followsPrevious = order.moduleSort > previousOrder.moduleSort;
        } else if (order.moduleUid !== previousOrder.moduleUid) {
          followsPrevious = order.moduleUid > previousOrder.moduleUid;
        } else if (order.lessonSort !== previousOrder.lessonSort) {
          followsPrevious = order.lessonSort > previousOrder.lessonSort;
        } else if (order.lessonUid !== previousOrder.lessonUid) {
          followsPrevious = order.lessonUid > previousOrder.lessonUid;
        } else {
          followsPrevious = order.stepUid > previousOrder.stepUid;
        }
      }
      if (!followsPrevious) {
        addIssue(
          [...path, "exercise"],
          "Practice exercises must use deterministic current-curriculum order.",
        );
      }
      previousOrder = order;
    }

    const expectedOutcomeCoverage = containsUnusableOutcomeRows
      ? "partial_unusable_current_rows"
      : "current_rows_complete";
    if (practice.outcomeEvidence.coverage !== expectedOutcomeCoverage) {
      addIssue(
        ["outcomeEvidence", "coverage"],
        "Practice outcome coverage contradicts the returned exercise evidence.",
      );
    }
  });

const workforceTrainingCohortEvidenceOutputSchema = z
  .object({
    generatedAt: coworkerJourneyTimestampSchema,
    learningGeneratedAt: coworkerJourneyTimestampSchema,
    criteria: z
      .object({
        journeyUid: batchUidInputSchema,
        cohortStartedFrom: coworkerJourneyTimestampSchema,
        cohortStartedBefore: coworkerJourneyTimestampSchema,
        boundary: z.literal("half_open"),
      })
      .strip(),
    definitions: z
      .object({
        cohortStart: z.literal("stored_journey_enrollment"),
        cohortHistoryCoverage: z.literal(
          "current_stored_enrollment_rows_only",
        ),
        progressPoint: z.literal(
          "latest_completed_step_fact_in_current_journey_modules",
        ),
        progressPointIsNot: z.literal("page_abandonment_or_actual_stall"),
        productionOutput: z.literal(
          "current_visible_non_practice_nonobsolete_task_results_after_completion",
        ),
        productionHistoryCoverage: z.literal(
          "current_result_rows_and_status_only",
        ),
        sequenceResultCoverage: z.literal("not_included"),
        summaryScope: z.literal("returned_coworker_scan_page"),
        practicePopulation: z.literal(
          "returned_current_cohort_members_without_observed_currently_qualifying_output",
        ),
        practiceOutcomeHistory: z.literal(
          "current_user_step_progress_rows_after_current_enrollment; deleted_rows_and_prior_content_versions_unavailable",
        ),
        practiceFailureWithoutPass: z.literal(
          "unresolved_recorded_evidence_not_causal_dropoff_or_actual_stall",
        ),
        practiceLoadFailureInterpretation: z.literal(
          "positive_rows_are_recorded_product_failure_evidence; absence_does_not_prove_success; no_coworker_skill_inference",
        ),
        practicePageAggregation: z.literal(
          "sum_matching_current_exercise_step_uids_across_every_unchanged_cursor_page; global_claims_require_single_page_global_reconciliation_or_full_scan_sum_matching_repeated_cohort_total",
        ),
      })
      .strip(),
    cohort: z
      .object({
        currentStoredLearningMembers: nonnegativeCount,
        evidenceCoverage: z.literal("current_stored_enrollment_rows_only"),
      })
      .strip(),
    progressEvidence: z
      .object({
        source: z.literal("analytics_step_facts"),
        availability: z.enum([
          "available",
          "not_computed",
          "not_queried_no_matched_cohort_records",
        ]),
        sourceCompletionWatermark:
          coworkerJourneyTimestampSchema.nullable(),
      })
      .strip(),
    coverage: z
      .object({
        scanOrder: z.literal("coworker_uid"),
        scannedCoworkers: z.number().int().min(0).max(10),
        matchedLearningIdentities: z.number().int().min(0).max(10),
        notLinkedLearningIdentities: z.number().int().min(0).max(10),
        inWindowCohortMembers: z.number().int().min(0).max(10),
        outsideWindowEnrollments: z.number().int().min(0).max(10),
        notEnrolledInJourney: z.number().int().min(0).max(10),
        progressPointsAvailable: z.number().int().min(0).max(10),
        progressPointsContentUnmapped: z.number().int().min(0).max(10),
        progressPointsWithoutMatchingCompletedFact: z
          .number()
          .int()
          .min(0)
          .max(10),
        progressPointsRollupNotComputed: z.number().int().min(0).max(10),
        globalReconciliationComplete: z.boolean(),
      })
      .strip(),
    summary: z
      .object({
        started: z.number().int().min(0).max(10),
        completedCurrentEnrollment: z.number().int().min(0).max(10),
        trainingIncomplete: z.number().int().min(0).max(10),
        observedCurrentlyQualifyingOutput: z.number().int().min(0).max(10),
        completedWithoutCurrentlyQualifyingOutput: z
          .number()
          .int()
          .min(0)
          .max(10),
        withoutObservedCurrentlyQualifyingOutput: z
          .number()
          .int()
          .min(0)
          .max(10),
        completionRate: z.number().min(0).max(1).nullable(),
        currentOutputRateFromCompleted: z.number().min(0).max(1).nullable(),
        overallCurrentYield: z.number().min(0).max(1).nullable(),
      })
      .strip(),
    practiceExerciseEvidence: workforceTrainingPracticeEvidenceSchema,
    members: z
      .array(
        z
          .object({
            coworkerUid: compactUuidOutputSchema,
            training: z
              .object({
                enrolledAt: coworkerJourneyTimestampSchema,
                enrollmentStatus: z.enum(["active", "completed", "dropped"]),
                completedAt: coworkerJourneyTimestampSchema.nullable(),
                retainedPriorCompletedAt:
                  coworkerJourneyTimestampSchema.nullable(),
                lastRecordedProgressPoint:
                  workforceTrainingCohortProgressPointSchema,
              })
              .strip(),
            qualifyingProductionOutput: z
              .object({
                state: z.enum([
                  "observed_currently_qualifying",
                  "none_currently_qualifying",
                  "not_evaluated_training_incomplete",
                ]),
                scope: z.literal(
                  "current_visible_non_practice_nonobsolete_task_results_after_completion",
                ),
                acceptedResults: nonnegativeCount.nullable(),
                overlookedResults: nonnegativeCount.nullable(),
                firstResultCreatedAt:
                  coworkerJourneyTimestampSchema.nullable(),
              })
              .strip(),
          })
          .strip(),
      )
      .max(10),
    hasMore: z.boolean(),
    nextCursor: compactUuidOutputSchema.nullable(),
  })
  .strip()
  .superRefine((report, context) => {
    const addIssue = (path: (string | number)[], message: string): void => {
      context.addIssue({ code: "custom", path, message });
    };
    const { coverage, summary, practiceExerciseEvidence, members } = report;
    const cohortFrom = Date.parse(report.criteria.cohortStartedFrom);
    const cohortBefore = Date.parse(report.criteria.cohortStartedBefore);

    if (cohortFrom >= cohortBefore) {
      addIssue(
        ["criteria", "cohortStartedBefore"],
        "Cohort window must end after cohortStartedFrom.",
      );
    } else if (cohortBefore - cohortFrom > 31 * 24 * 60 * 60 * 1000) {
      addIssue(
        ["criteria", "cohortStartedBefore"],
        "Cohort window cannot exceed 31 days.",
      );
    }
    if (Date.parse(report.generatedAt) < Date.parse(report.learningGeneratedAt)) {
      addIssue(
        ["generatedAt"],
        "Report generation cannot precede its Learning evidence.",
      );
    }
    if (
      coverage.matchedLearningIdentities +
        coverage.notLinkedLearningIdentities !==
      coverage.scannedCoworkers
    ) {
      addIssue(
        ["coverage", "scannedCoworkers"],
        "Learning identity coverage does not match the scan count.",
      );
    }
    if (
      coverage.inWindowCohortMembers +
        coverage.outsideWindowEnrollments +
        coverage.notEnrolledInJourney !==
      coverage.matchedLearningIdentities
    ) {
      addIssue(
        ["coverage", "matchedLearningIdentities"],
        "Matched Learning identities do not reconcile to cohort states.",
      );
    }
    if (
      coverage.inWindowCohortMembers !== members.length ||
      summary.started !== members.length
    ) {
      addIssue(
        ["summary", "started"],
        "The page cohort counts do not match the returned members.",
      );
    }
    if (report.cohort.currentStoredLearningMembers < members.length) {
      addIssue(
        ["cohort", "currentStoredLearningMembers"],
        "The global stored cohort cannot be smaller than this page.",
      );
    }

    const expectedProgressPoints =
      coverage.progressPointsAvailable +
      coverage.progressPointsContentUnmapped +
      coverage.progressPointsWithoutMatchingCompletedFact +
      coverage.progressPointsRollupNotComputed;
    if (expectedProgressPoints !== members.length) {
      addIssue(
        ["coverage", "progressPointsAvailable"],
        "Progress-point coverage does not match the returned members.",
      );
    }
    const progressWatermarkAvailable =
      report.progressEvidence.sourceCompletionWatermark !== null;
    if (
      (report.progressEvidence.availability === "available") !==
      progressWatermarkAvailable
    ) {
      addIssue(
        ["progressEvidence", "sourceCompletionWatermark"],
        "Progress availability and its completion watermark disagree.",
      );
    }
    if (
      members.length === 0
        ? report.progressEvidence.availability !==
          "not_queried_no_matched_cohort_records"
        : report.progressEvidence.availability ===
          "not_queried_no_matched_cohort_records"
    ) {
      addIssue(
        ["progressEvidence", "availability"],
        "Progress availability does not match page cohort coverage.",
      );
    }
    if (
      report.progressEvidence.availability === "available" &&
      coverage.progressPointsRollupNotComputed !== 0
    ) {
      addIssue(
        ["coverage", "progressPointsRollupNotComputed"],
        "Available progress evidence cannot include an uncomputed rollup.",
      );
    }
    if (
      report.progressEvidence.availability === "not_computed" &&
      coverage.progressPointsWithoutMatchingCompletedFact !== 0
    ) {
      addIssue(
        ["coverage", "progressPointsWithoutMatchingCompletedFact"],
        "Uncomputed progress evidence cannot claim a completed-fact miss.",
      );
    }

    let completed = 0;
    let observedOutput = 0;
    const progressCounts = new Map<string, number>();
    const seenCoworkers = new Set<string>();
    let previousCoworkerUid: string | undefined;
    for (const [index, member] of members.entries()) {
      const memberPath = ["members", index];
      const training = member.training;
      const output = member.qualifyingProductionOutput;
      const enrolledAt = Date.parse(training.enrolledAt);
      const isCompleted = training.enrollmentStatus === "completed";

      if (seenCoworkers.has(member.coworkerUid)) {
        addIssue(
          [...memberPath, "coworkerUid"],
          "Cohort member UIDs must be unique within a page.",
        );
      }
      seenCoworkers.add(member.coworkerUid);
      if (
        previousCoworkerUid !== undefined &&
        member.coworkerUid <= previousCoworkerUid
      ) {
        addIssue(
          [...memberPath, "coworkerUid"],
          "Cohort members must be ordered by coworker UID.",
        );
      }
      previousCoworkerUid = member.coworkerUid;
      if (enrolledAt < cohortFrom || enrolledAt >= cohortBefore) {
        addIssue(
          [...memberPath, "training", "enrolledAt"],
          "Cohort member enrollment is outside the requested window.",
        );
      }
      if (isCompleted !== (training.completedAt !== null)) {
        addIssue(
          [...memberPath, "training", "completedAt"],
          "Current enrollment completion status and timestamp disagree.",
        );
      }
      if (
        training.completedAt !== null &&
        Date.parse(training.completedAt) < enrolledAt
      ) {
        addIssue(
          [...memberPath, "training", "completedAt"],
          "Current Learning completion precedes enrollment.",
        );
      }
      if (
        (isCompleted && training.retainedPriorCompletedAt !== null) ||
        (training.retainedPriorCompletedAt !== null &&
          Date.parse(training.retainedPriorCompletedAt) >= enrolledAt)
      ) {
        addIssue(
          [...memberPath, "training", "retainedPriorCompletedAt"],
          "Retained prior completion is inconsistent with current enrollment.",
        );
      }
      const progress = training.lastRecordedProgressPoint;
      progressCounts.set(
        progress.availability,
        (progressCounts.get(progress.availability) ?? 0) + 1,
      );
      if (
        (progress.availability === "available" ||
          progress.availability === "content_unmapped") &&
        Date.parse(progress.completedAt) < enrolledAt
      ) {
        addIssue(
          [...memberPath, "training", "lastRecordedProgressPoint", "completedAt"],
          "Learning progress evidence precedes enrollment.",
        );
      }

      if (!isCompleted) {
        if (
          output.state !== "not_evaluated_training_incomplete" ||
          output.acceptedResults !== null ||
          output.overlookedResults !== null ||
          output.firstResultCreatedAt !== null
        ) {
          addIssue(
            [...memberPath, "qualifyingProductionOutput"],
            "Incomplete training cannot carry evaluated production output.",
          );
        }
        continue;
      }

      completed += 1;
      if (
        output.acceptedResults === null ||
        output.overlookedResults === null
      ) {
        addIssue(
          [...memberPath, "qualifyingProductionOutput"],
          "Completed training requires numeric production evidence.",
        );
        continue;
      }
      const qualifyingResults =
        output.acceptedResults + output.overlookedResults;
      if (qualifyingResults > 0) {
        observedOutput += 1;
        if (
          output.state !== "observed_currently_qualifying" ||
          output.firstResultCreatedAt === null
        ) {
          addIssue(
            [...memberPath, "qualifyingProductionOutput"],
            "Observed qualifying results require matching state and first-result time.",
          );
        }
      } else if (
        output.state !== "none_currently_qualifying" ||
        output.firstResultCreatedAt !== null
      ) {
        addIssue(
          [...memberPath, "qualifyingProductionOutput"],
          "Zero qualifying results require an explicit none-currently-qualifying state.",
        );
      }
      if (
        output.firstResultCreatedAt !== null &&
        training.completedAt !== null &&
        Date.parse(output.firstResultCreatedAt) < Date.parse(training.completedAt)
      ) {
        addIssue(
          [...memberPath, "qualifyingProductionOutput", "firstResultCreatedAt"],
          "Qualifying output cannot precede current training completion.",
        );
      }
    }

    const coverageProgressCounts: Record<string, number> = {
      available: coverage.progressPointsAvailable,
      content_unmapped: coverage.progressPointsContentUnmapped,
      no_matching_completed_step_fact:
        coverage.progressPointsWithoutMatchingCompletedFact,
      progress_rollup_not_computed:
        coverage.progressPointsRollupNotComputed,
    };
    for (const [availability, expected] of Object.entries(
      coverageProgressCounts,
    )) {
      if ((progressCounts.get(availability) ?? 0) !== expected) {
        addIssue(
          ["coverage"],
          "Progress-point categories do not match the returned members.",
        );
        break;
      }
    }

    const incomplete = members.length - completed;
    const withoutCurrentOutput = completed - observedOutput;
    const withoutObservedCurrentOutput = members.length - observedOutput;
    if (
      summary.completedCurrentEnrollment !== completed ||
      summary.trainingIncomplete !== incomplete ||
      summary.observedCurrentlyQualifyingOutput !== observedOutput ||
      summary.completedWithoutCurrentlyQualifyingOutput !==
        withoutCurrentOutput ||
      summary.withoutObservedCurrentlyQualifyingOutput !==
        withoutObservedCurrentOutput
    ) {
      addIssue(
        ["summary"],
        "Cohort summary does not match the returned members.",
      );
    }
    if (
      practiceExerciseEvidence.population
        .returnedMembersWithoutObservedCurrentlyQualifyingOutput !==
        withoutObservedCurrentOutput ||
      practiceExerciseEvidence.population.matchedCurrentLearningMembers !==
        withoutObservedCurrentOutput
    ) {
      addIssue(
        ["practiceExerciseEvidence", "population"],
        "Practice population does not match returned members without observed current output.",
      );
    }
    if (
      (withoutObservedCurrentOutput === 0) !==
      (practiceExerciseEvidence.availability ===
        noReturnedMemberPracticeEvidence)
    ) {
      addIssue(
        ["practiceExerciseEvidence", "availability"],
        "Practice availability does not match the returned no-output subset.",
      );
    }
    if (
      practiceExerciseEvidence.availability === "available" &&
      Date.parse(practiceExerciseEvidence.learningGeneratedAt) >
        Date.parse(report.generatedAt)
    ) {
      addIssue(
        ["practiceExerciseEvidence", "learningGeneratedAt"],
        "Report generation cannot precede its practice evidence.",
      );
    }
    if (practiceExerciseEvidence.availability === "available") {
      const expectedLoadFailureCoverage =
        cohortFrom >=
        Date.parse(
          practiceExerciseEvidence.loadFailureEvidence
            .conservativeRecordingStartedAt,
        )
          ? "within_conservative_recording_era"
          : "overlaps_pre_recording_era";
      if (
        practiceExerciseEvidence.loadFailureEvidence.windowCoverage !==
        expectedLoadFailureCoverage
      ) {
        addIssue(
          ["practiceExerciseEvidence", "loadFailureEvidence", "windowCoverage"],
          "Practice load-failure coverage does not match the cohort window.",
        );
      }
    }
    if (
      !workforceRateMatches(summary.completionRate, completed, members.length) ||
      !workforceRateMatches(
        summary.currentOutputRateFromCompleted,
        observedOutput,
        completed,
      ) ||
      !workforceRateMatches(
        summary.overallCurrentYield,
        observedOutput,
        members.length,
      )
    ) {
      addIssue(
        ["summary"],
        "Cohort rates do not match the returned member counts.",
      );
    }
    if (report.hasMore !== (report.nextCursor !== null)) {
      addIssue(
        ["nextCursor"],
        "Pagination continuation does not match hasMore.",
      );
    }
    if (report.hasMore && coverage.scannedCoworkers === 0) {
      addIssue(
        ["coverage", "scannedCoworkers"],
        "A continuing page must scan at least one coworker.",
      );
    }
    if (
      report.hasMore &&
      report.nextCursor !== null &&
      members.some((member) => member.coworkerUid > report.nextCursor!)
    ) {
      addIssue(
        ["nextCursor"],
        "Returned cohort members cannot sort after the scanned-page cursor.",
      );
    }
    if (
      coverage.globalReconciliationComplete &&
      (report.hasMore ||
        summary.started !== report.cohort.currentStoredLearningMembers)
    ) {
      addIssue(
        ["coverage", "globalReconciliationComplete"],
        "Global reconciliation requires a complete scan covering the stored cohort.",
      );
    }
  });

const coworkerJourneyLearningPerformanceSchema = z.discriminatedUnion(
  "availability",
  [
    z.object({ availability: z.literal("not_computed") }).strip(),
    z
      .object({
        availability: z.literal("available"),
        modulesCompleted: nonnegativeCount,
        totalModules: nonnegativeCount,
        stepsCompleted: nonnegativeCount,
        totalSteps: nonnegativeCount,
        progressPercentage: z.number().min(0).max(100),
        quizAttempts: nonnegativeCount,
        quizCorrect: nonnegativeCount,
        quizAccuracy: z.number().min(0).max(100).nullable(),
        practiceAttempts: nonnegativeCount,
        practicePassed: nonnegativeCount,
        practicePassRate: z.number().min(0).max(100).nullable(),
        proficiencyLevel: z.string().min(1).max(100).nullable(),
        performanceStatus: z.string().min(1).max(100).nullable(),
        atRiskIndicators: z.array(z.string().min(1).max(200)).max(50),
        firstActivityAt: coworkerJourneyTimestampSchema.nullable(),
        lastActivityAt: coworkerJourneyTimestampSchema.nullable(),
        completedAt: coworkerJourneyTimestampSchema.nullable(),
        computedAt: coworkerJourneyTimestampSchema,
      })
      .strip(),
  ],
);
const coworkerJourneyLearningAccessSchema = z.discriminatedUnion(
  "availability",
  [
    z
      .object({
        availability: z.literal("available"),
        status: z.string().min(1).max(100),
        joinedAt: coworkerJourneyTimestampSchema,
      })
      .strip(),
    z
      .object({
        availability: z.literal("no_record"),
        status: z.null(),
        joinedAt: z.null(),
      })
      .strip(),
  ],
);
const coworkerJourneyOnboardingSchema = z.discriminatedUnion(
  "availability",
  [
    z
      .object({
        availability: z.literal("available"),
        status: z.enum(["unknown", "not_onboarded", "onboarded"]),
        onboardedAt: coworkerJourneyTimestampSchema.nullable(),
        source: z.string().min(1).max(100),
        decidedAt: coworkerJourneyTimestampSchema.nullable(),
      })
      .strip(),
    z
      .object({
        availability: z.literal("no_record"),
        status: z.null(),
        onboardedAt: z.null(),
        source: z.null(),
        decidedAt: z.null(),
      })
      .strip(),
  ],
);
const coworkerJourneyLearningSchema = z
  .object({
    identity: z
      .object({ status: z.enum(["matched", "not_linked"]) })
      .strip(),
    learningAccess: coworkerJourneyLearningAccessSchema.nullable(),
    onboarding: coworkerJourneyOnboardingSchema.nullable(),
    training: z
      .object({
        summary: z
          .object({
            enrolledJourneys: nonnegativeCount,
            activeJourneys: nonnegativeCount,
            completedJourneys: nonnegativeCount,
            droppedJourneys: nonnegativeCount,
            firstEnrolledAt: coworkerJourneyTimestampSchema.nullable(),
            earliestCompletedAt: coworkerJourneyTimestampSchema.nullable(),
            lastActivityAt: coworkerJourneyTimestampSchema.nullable(),
          })
          .strip(),
        journeys: z
          .array(
            z
              .object({
                uid: batchUidInputSchema,
                slug: z.string().min(1).max(200),
                title: z.string().min(1).max(500),
                status: z.enum(["active", "completed", "dropped"]),
                enrolledAt: coworkerJourneyTimestampSchema,
                completedAt: coworkerJourneyTimestampSchema.nullable(),
                performance: coworkerJourneyLearningPerformanceSchema,
                nextRequiredModule: z
                  .object({
                    uid: batchUidInputSchema,
                    slug: z.string().min(1).max(200),
                    title: z.string().min(1).max(500),
                  })
                  .strip()
                  .nullable(),
              })
              .strip(),
          )
          .max(20),
      })
      .strip()
      .nullable(),
    taskAccess: z
      .array(
        z
          .object({
            taskName: z.string().min(1).max(100),
            isGranted: z.boolean(),
            grantedAt: coworkerJourneyTimestampSchema.nullable(),
            grantedReason: z.string().min(1).max(500).nullable(),
            revokedAt: coworkerJourneyTimestampSchema.nullable(),
            revokedReason: z.string().min(1).max(500).nullable(),
            computedAt: coworkerJourneyTimestampSchema,
          })
          .strip(),
      )
      .max(100)
      .nullable(),
  })
  .strip()
  .superRefine((value, context) => {
    const joinedFields = [
      value.learningAccess,
      value.onboarding,
      value.training,
      value.taskAccess,
    ];
    const shouldBeJoined = value.identity.status === "matched";
    if (joinedFields.some((field) => (field !== null) !== shouldBeJoined)) {
      context.addIssue({
        code: "custom",
        path: ["identity", "status"],
        message:
          "Learning identity state does not match the joined record fields.",
      });
    }
    if (value.training !== null) {
      const { summary, journeys } = value.training;
      if (
        summary.enrolledJourneys !== journeys.length ||
        summary.activeJourneys +
          summary.completedJourneys +
          summary.droppedJourneys !==
          summary.enrolledJourneys ||
        summary.activeJourneys !==
          journeys.filter((journey) => journey.status === "active").length ||
        summary.completedJourneys !==
          journeys.filter((journey) => journey.status === "completed").length ||
        summary.droppedJourneys !==
          journeys.filter((journey) => journey.status === "dropped").length
      ) {
        context.addIssue({
          code: "custom",
          path: ["training", "summary"],
          message: "Learning journey summary does not match journey records.",
        });
      }
    }
  });
const coworkerJourneyDiagnosisStepSchema = z
  .object({
    code: z.enum([
      "account_inactive",
      "reactivate_account",
      "work_approval_required",
      "approve_for_work",
      "learning_identity_not_linked",
      "link_learning_identity",
      "onboarding_status_unavailable",
      "establish_onboarding_status",
      "onboarding_incomplete",
      "complete_onboarding",
      "task_access_not_granted",
      "complete_required_training",
      "grant_qualified_task_access",
      "assign_to_production_work",
      "complete_assigned_work",
    ]),
    evidence: z
      .array(
        z
          .object({
            source: z.enum(["account", "learning", "production"]),
            fact: z.string().min(1).max(100),
            observed: z.string().min(1).max(200),
          })
          .strip(),
      )
      .min(1)
      .max(10),
  })
  .strip();
const workforceCoworkerJourneyOutputSchema = z
  .object({
    generatedAt: coworkerJourneyTimestampSchema,
    coworkerUid: compactUuidOutputSchema,
    displayName: z.string().min(1).max(150),
    account: z
      .object({
        active: z.boolean(),
        approvedForWork: z.boolean(),
        phoneVerified: z.boolean(),
        joinedAt: coworkerJourneyTimestampSchema,
        lastLoginAt: coworkerJourneyTimestampSchema.nullable(),
      })
      .strip(),
    workRoles: z
      .object({
        assignee: z.boolean(),
        reviewer: z.boolean(),
        dataCollection: z.boolean(),
      })
      .strip(),
    learning: coworkerJourneyLearningSchema,
    production: z
      .object({
        results: z
          .object({
            scope: z.literal("visible_non_practice"),
            total: nonnegativeCount,
            byStatus: z
              .object({
                pending: nonnegativeCount,
                accepted: nonnegativeCount,
                rejected: nonnegativeCount,
                overlooked: nonnegativeCount,
              })
              .strip(),
            firstCreatedAt: coworkerJourneyTimestampSchema.nullable(),
            lastCreatedAt: coworkerJourneyTimestampSchema.nullable(),
            firstAcceptedAt: coworkerJourneyTimestampSchema.nullable(),
            lastAcceptedAt: coworkerJourneyTimestampSchema.nullable(),
          })
          .strip(),
        sessions: z
          .object({
            scope: z.literal("non_practice"),
            total: nonnegativeCount,
            byStatus: z
              .object({
                pending: nonnegativeCount,
                ready: nonnegativeCount,
                assigned: nonnegativeCount,
                finished: nonnegativeCount,
                abandoned: nonnegativeCount,
              })
              .strip(),
            firstCreatedAt: coworkerJourneyTimestampSchema.nullable(),
            lastCreatedAt: coworkerJourneyTimestampSchema.nullable(),
          })
          .strip(),
        workUnits: z
          .object({
            scope: z.literal("non_practice_or_unscoped"),
            assignedUnits: z
              .object({
                total: nonnegativeCount,
                byStatus: workUnitStatusOutputSchema,
              })
              .strip(),
            transitions: z
              .object({
                submittedForReview: nonnegativeCount,
                completed: nonnegativeCount,
                abandoned: nonnegativeCount,
                errored: nonnegativeCount,
                firstActivityAt: coworkerJourneyTimestampSchema.nullable(),
                lastActivityAt: coworkerJourneyTimestampSchema.nullable(),
              })
              .strip(),
          })
          .strip(),
      })
      .strip(),
    diagnosis: z
      .object({
        currentStage: z.enum([
          "account",
          "approval",
          "learning_identity",
          "onboarding",
          "training",
          "qualification",
          "ready_for_assignment",
          "entering_production",
          "production_active",
        ]),
        nextRequiredStep: coworkerJourneyDiagnosisStepSchema.nullable(),
        blocker: coworkerJourneyDiagnosisStepSchema.nullable(),
      })
      .strip(),
  })
  .strip()
  .superRefine((value, context) => {
    const resultStatuses = value.production.results.byStatus;
    const sessionStatuses = value.production.sessions.byStatus;
    const unitStatuses = value.production.workUnits.assignedUnits.byStatus;
    const countChecks: Array<[number, number, (string | number)[]]> = [
      [
        value.production.results.total,
        resultStatuses.pending +
          resultStatuses.accepted +
          resultStatuses.rejected +
          resultStatuses.overlooked,
        ["production", "results", "total"],
      ],
      [
        value.production.sessions.total,
        sessionStatuses.pending +
          sessionStatuses.ready +
          sessionStatuses.assigned +
          sessionStatuses.finished +
          sessionStatuses.abandoned,
        ["production", "sessions", "total"],
      ],
      [
        value.production.workUnits.assignedUnits.total,
        unitStatuses.unavailable +
          unitStatuses.backlog +
          unitStatuses.inProgress +
          unitStatuses.inReview +
          unitStatuses.completed +
          unitStatuses.error,
        ["production", "workUnits", "assignedUnits", "total"],
      ],
    ];
    for (const [total, statusTotal, path] of countChecks) {
      if (total !== statusTotal) {
        context.addIssue({
          code: "custom",
          path,
          message: "Total does not match the fixed status counts.",
        });
      }
    }

    const diagnosedBlockerStages = new Set([
      "account",
      "approval",
      "learning_identity",
      "onboarding",
      "training",
      "qualification",
    ]);
    const isProductionActive =
      value.diagnosis.currentStage === "production_active";
    const shouldHaveBlocker = diagnosedBlockerStages.has(
      value.diagnosis.currentStage,
    );
    if (
      (value.diagnosis.nextRequiredStep === null) !== isProductionActive ||
      (value.diagnosis.blocker !== null) !== shouldHaveBlocker
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnosis"],
        message:
          "Diagnosis stage does not match its next-step and blocker evidence.",
      });
    }
  });

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

const getCoworkerJourneyTool = defineReadCatalogTool({
  name: "get_coworker_journey",
  title: "Get coworker journey",
  description:
    "Staff only: retrieve one privacy-bounded coworker journey across account readiness, Learning onboarding and training, task access, and non-practice Physical AI production history. Returns a single evidence-backed current stage, next required step, and blocker; missing or unavailable joined data is explicit and never converted to zeroes. Requires an exact coworker UID and excludes usernames, contact details, family names, provider identities, KYC, pay, customer payloads, work URLs, comments, and arbitrary group or batch labels.",
  inputSchema: z
    .object({
      coworkerUid: batchUidInputSchema.describe(
        "Exact opaque coworker UID supplied by a reviewed staff workflow or another privacy-bounded workforce tool.",
      ),
    })
    .strict(),
  outputSchema: workforceCoworkerJourneyOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const journey = value as { coworkerUid: string };
    const requestedCoworkerUid = String(args.coworkerUid).replaceAll("-", "");
    if (journey.coworkerUid !== requestedCoworkerUid) {
      throw new Error(
        "Coworker journey response did not match the requested coworker.",
      );
    }
    return value;
  },
  route: {
    name: "workforce-coworker-journey",
    method: "GET",
    path: "/admin/workforce/coworkers/{coworkerUid}/journey/",
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
});

const listCoworkerTrainingCandidatesTool = defineReadCatalogTool({
  name: "list_coworker_training_candidates",
  title: "List coworker training candidates",
  description:
    "Staff only: scan one bounded coworker page for people who completed Learning in a required half-open time window but have no visible, non-practice accepted or paid-without-review production result. Start without cursor and follow every nextCursor until hasMore is false; aggregate every page and sort all candidates by earliestCompletedAt then coworkerUid before naming the global earliest. Any notLinkedLearningIdentities count or unscanned page makes a global claim incomplete. After selecting a candidate, call get_coworker_journey with its exact coworkerUid to walk the joined record and report the single evidence-backed blocker. Returns safe first-name/fallback labels and coverage counts; excludes contacts, family names, provider identities, KYC, pay details, customer payloads, work URLs, comments, and arbitrary group or batch labels.",
  inputSchema: z
    .object({
      completedFrom: coworkerJourneyTimestampSchema.describe(
        "Inclusive Learning completion-window start with a UTC offset.",
      ),
      completedBefore: coworkerJourneyTimestampSchema.describe(
        "Exclusive Learning completion-window end with a UTC offset; at most 366 days after completedFrom.",
      ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Maximum coworkers to scan in this page (server default and max 10)."),
      cursor: batchUidInputSchema
        .optional()
        .describe(
          "Opaque nextCursor from the previous scan page. Omit on the first page.",
        ),
    })
    .strict()
    .superRefine((value, context) => {
      const completedFrom = Date.parse(value.completedFrom);
      const completedBefore = Date.parse(value.completedBefore);
      if (completedFrom >= completedBefore) {
        context.addIssue({
          code: "custom",
          path: ["completedBefore"],
          message: "Completion window must end after completedFrom.",
        });
      } else if (completedBefore - completedFrom > 366 * 24 * 60 * 60 * 1000) {
        context.addIssue({
          code: "custom",
          path: ["completedBefore"],
          message: "Completion window cannot exceed 366 days.",
        });
      }
    }),
  outputSchema: workforceTrainingCandidatesOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const page = value as {
      window: { completedFrom: string; completedBefore: string };
      coverage: {
        globalEarliestComplete: boolean;
        notLinkedLearningIdentities: number;
      };
      hasMore: boolean;
      nextCursor: string | null;
    };
    if (
      Date.parse(page.window.completedFrom) !==
        Date.parse(String(args.completedFrom)) ||
      Date.parse(page.window.completedBefore) !==
        Date.parse(String(args.completedBefore))
    ) {
      throw new Error(
        "Coworker training candidate response did not match the requested completion window.",
      );
    }
    const requestedCursor =
      typeof args.cursor === "string"
        ? args.cursor.replaceAll("-", "")
        : undefined;
    const expectedGlobalEarliestComplete =
      requestedCursor === undefined &&
      !page.hasMore &&
      page.coverage.notLinkedLearningIdentities === 0;
    if (
      page.coverage.globalEarliestComplete !== expectedGlobalEarliestComplete
    ) {
      throw new Error(
        "Coworker training candidate global-earliest coverage did not match the scan.",
      );
    }
    if (
      requestedCursor !== undefined &&
      page.nextCursor !== null &&
      page.nextCursor <= requestedCursor
    ) {
      throw new Error(
        "Coworker training candidate pagination did not advance past the requested cursor.",
      );
    }
    return value;
  },
  route: {
    name: "workforce-coworker-training-candidates",
    method: "GET",
    path: "/admin/workforce/coworkers/training-candidates/",
    query: {
      completedFrom: "completed_from",
      completedBefore: "completed_before",
      limit: "limit",
      cursor: "cursor",
    },
    defaultLimit: 10,
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
});

const listWorkforceTrainingCohortEvidenceTool = defineReadCatalogTool({
  name: "list_workforce_training_cohort_evidence",
  title: "List workforce training cohort evidence",
  description:
    "Staff only: inspect one bounded UID-ordered coworker scan page for an exact Learning journey and required half-open enrollment window of at most 31 days. Learning enrollment, progress, and practice evidence is authoritative at learning.avala.ai (Vercel/Supabase); Django only joins it to current production state. The joined evidence distinguishes current stored enrollment and completion, the latest durable completed-step fact in the journey's current modules, and current visible non-practice nonobsolete accepted or paid-without-review results created after current completion. For returned members without observed currently qualifying output, practiceExerciseEvidence adds current-curriculum exercise outcomes plus positive load-failure diagnostics. Failure without pass is unresolved recorded evidence, not causal attribution, actual stall, intent, skill assessment, or a coworker ranking; absence of a load-failure row does not prove success. A latest progress point is not page abandonment or proof of an actual stall, and production evidence is current result-row state rather than historical payout or an ever-qualified claim; sequence results are excluded. Page coverage and rates describe only returned in-window members, while currentStoredLearningMembers is a global current-storage count. Start without cursor and follow every nextCursor with identical journey and window inputs. Aggregate practice counts by stable exercise step UIDs across every unchanged page; make a global claim only after a single page with globalReconciliationComplete=true or a full scan whose repeated cohort total reconciles. Deleted or overwritten enrollment and practice-row history is unavailable. Returns only opaque coworker and curriculum UIDs, current curriculum labels, bounded counts, timestamps, and evidence states; excludes names, contacts, provider identities, prompts, answers, scores, accuracy, raw task or failure payloads, browser/build labels, KYC, pay details, customer payloads, work URLs, comments, and task contents.",
  inputSchema: z
    .object({
      journeyUid: batchUidInputSchema.describe(
        "Exact Learning journey UID for the training cohort.",
      ),
      cohortStartedFrom: coworkerJourneyTimestampSchema.describe(
        "Inclusive stored-enrollment window start with a UTC offset.",
      ),
      cohortStartedBefore: coworkerJourneyTimestampSchema.describe(
        "Exclusive stored-enrollment window end with a UTC offset; at most 31 days after cohortStartedFrom.",
      ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe(
          "Maximum coworkers to scan in this page (server default and max 10).",
        ),
      cursor: batchUidInputSchema
        .optional()
        .describe(
          "Opaque nextCursor from the previous scan page. Omit on the first page.",
        ),
    })
    .strict()
    .superRefine((value, context) => {
      const cohortStartedFrom = Date.parse(value.cohortStartedFrom);
      const cohortStartedBefore = Date.parse(value.cohortStartedBefore);
      if (cohortStartedFrom >= cohortStartedBefore) {
        context.addIssue({
          code: "custom",
          path: ["cohortStartedBefore"],
          message: "Cohort window must end after cohortStartedFrom.",
        });
      } else if (
        cohortStartedBefore - cohortStartedFrom >
        31 * 24 * 60 * 60 * 1000
      ) {
        context.addIssue({
          code: "custom",
          path: ["cohortStartedBefore"],
          message: "Cohort window cannot exceed 31 days.",
        });
      }
    }),
  outputSchema: workforceTrainingCohortEvidenceOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const page = value as z.infer<
      typeof workforceTrainingCohortEvidenceOutputSchema
    >;
    const requestedJourneyUid = String(args.journeyUid).replaceAll("-", "");
    if (
      page.criteria.journeyUid.replaceAll("-", "") !== requestedJourneyUid ||
      Date.parse(page.criteria.cohortStartedFrom) !==
        Date.parse(String(args.cohortStartedFrom)) ||
      Date.parse(page.criteria.cohortStartedBefore) !==
        Date.parse(String(args.cohortStartedBefore))
    ) {
      throw new Error(
        "Workforce training cohort response did not match the requested journey and cohort window.",
      );
    }
    const requestedCursor =
      typeof args.cursor === "string"
        ? args.cursor.replaceAll("-", "")
        : undefined;
    const expectedGlobalReconciliationComplete =
      requestedCursor === undefined &&
      !page.hasMore &&
      page.summary.started === page.cohort.currentStoredLearningMembers;
    if (
      page.coverage.globalReconciliationComplete !==
      expectedGlobalReconciliationComplete
    ) {
      throw new Error(
        "Workforce training cohort global reconciliation did not match the scan.",
      );
    }
    if (
      requestedCursor !== undefined &&
      (page.members.some(
        (member) => member.coworkerUid <= requestedCursor,
      ) ||
        (page.nextCursor !== null && page.nextCursor <= requestedCursor))
    ) {
      throw new Error(
        "Workforce training cohort pagination did not advance past the requested cursor.",
      );
    }
    if (
      typeof args.limit === "number" &&
      page.coverage.scannedCoworkers > args.limit
    ) {
      throw new Error(
        "Workforce training cohort response exceeded the requested scan limit.",
      );
    }
    return value;
  },
  route: {
    name: "workforce-coworker-training-cohort-evidence",
    method: "GET",
    path: "/admin/workforce/coworkers/training-cohort-evidence/",
    query: {
      journeyUid: "journey_uid",
      cohortStartedFrom: "cohort_started_from",
      cohortStartedBefore: "cohort_started_before",
      limit: "limit",
      cursor: "cursor",
    },
    defaultLimit: 10,
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
});

const getWorkforceCoworkerReliabilityTool = defineReadCatalogTool({
  name: "get_workforce_coworker_reliability",
  title: "Get coworker queue-output evidence",
  description:
    "Staff only: compare successful coworker reads of the initial global Physical AI work-queue page with recorded non-practice output during one required half-open window of at most 31 days. Requires workforce.write because the response contains pseudonymous person-level operational evidence. It separates no-output rows with recorded no-eligible-work evidence from rows with recorded eligible work or an active assignment; mixed queue evidence is always treated as work available. This is sampled, best-effort, non-retroactive telemetry: it does not prove complete attendance, scheduled availability, intent, or deliberate idleness. The tool refuses partial or unavailable storage windows. An empty complete page means only that no qualifying queue observations were recorded, never that no coworkers or activity existed. Summaries cover only the returned page; start without cursor and follow every nextCursor with the same window to cover all recorded coworkers. Returns only stable public coworker UIDs, bounded counts, timestamps, classifications, and explicit coverage; excludes names, contacts, pay, rankings, customer payloads, group details, and task contents.",
  inputSchema: z
    .object({
      observedFrom: coworkerJourneyTimestampSchema.describe(
        "Inclusive observation-window start with a UTC offset.",
      ),
      observedBefore: coworkerJourneyTimestampSchema.describe(
        "Exclusive observation-window end with a UTC offset; at most 31 days after observedFrom.",
      ),
      coworkerUid: batchUidInputSchema
        .optional()
        .describe(
          "Optional exact opaque coworker UID from a reviewed staff workflow. Cannot be combined with cursor.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum recorded coworkers in this page (server default 25, max 50)."),
      cursor: batchUidInputSchema
        .optional()
        .describe(
          "Opaque nextCursor from the previous page. Keep the observation window unchanged and omit coworkerUid.",
        ),
    })
    .strict()
    .superRefine((value, context) => {
      const observedFrom = Date.parse(value.observedFrom);
      const observedBefore = Date.parse(value.observedBefore);
      if (observedFrom >= observedBefore) {
        context.addIssue({
          code: "custom",
          path: ["observedBefore"],
          message: "Observation window must end after observedFrom.",
        });
      } else if (observedBefore - observedFrom > 31 * 24 * 60 * 60 * 1000) {
        context.addIssue({
          code: "custom",
          path: ["observedBefore"],
          message: "Observation window cannot exceed 31 days.",
        });
      }
      if (value.coworkerUid !== undefined && value.cursor !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["cursor"],
          message: "Cursor cannot be combined with an exact coworker filter.",
        });
      }
    }),
  outputSchema: workforceCoworkerReliabilityOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const report = value as z.infer<
      typeof workforceCoworkerReliabilityOutputSchema
    >;
    if (
      Date.parse(report.measurement.observationWindow.observedFrom) !==
        Date.parse(String(args.observedFrom)) ||
      Date.parse(report.measurement.observationWindow.observedBefore) !==
        Date.parse(String(args.observedBefore))
    ) {
      throw new Error(
        "Coworker queue-output response did not match the requested observation window.",
      );
    }
    if (report.measurement.storageWindowStatus !== "complete") {
      throw new Error(
        `Coworker queue-output evidence is ${report.measurement.storageWindowStatus} for the requested window; choose a window beginning at or after ${report.measurement.storageAvailableAt}. No reliability classification was returned.`,
      );
    }
    const requestedLimit =
      typeof args.limit === "number" ? args.limit : 25;
    if (report.coworkers.length > requestedLimit) {
      throw new Error(
        "Coworker queue-output response exceeded the requested page limit.",
      );
    }

    const requestedCoworkerUid =
      typeof args.coworkerUid === "string"
        ? args.coworkerUid.replaceAll("-", "")
        : undefined;
    if (
      requestedCoworkerUid !== undefined &&
      (report.coworkers.some(
        (coworker) => coworker.coworkerUid !== requestedCoworkerUid,
      ) ||
        report.hasMore ||
        report.nextCursor !== null)
    ) {
      throw new Error(
        "Exact coworker queue-output response did not match the requested coworker.",
      );
    }
    const requestedCursor =
      typeof args.cursor === "string"
        ? args.cursor.replaceAll("-", "")
        : undefined;
    if (
      requestedCursor !== undefined &&
      report.nextCursor !== null &&
      report.nextCursor <= requestedCursor
    ) {
      throw new Error(
        "Coworker queue-output pagination did not advance past the requested cursor.",
      );
    }
    return value;
  },
  route: {
    name: "workforce-coworker-reliability",
    method: "GET",
    path: "/admin/workforce/coworkers/reliability/",
    query: {
      observedFrom: "observed_from",
      observedBefore: "observed_before",
      coworkerUid: "coworker_uid",
      limit: "limit",
      cursor: "cursor",
    },
    defaultLimit: 25,
    response: "single",
    scope: "workforce.write",
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

const getWorkforceDispatchHealthTool = defineReadCatalogTool({
  name: "get_workforce_dispatch_health",
  title: "Get workforce dispatch health",
  description:
    "Staff only: measure the current released-to-claimable state of available Physical AI labeling production lines in consistent work-unit counts, with exact blockers and pseudonymous line context. Inspect observationReceipt on every call: unavailable means the live snapshot is usable but was not durably recorded; not_applicable_empty_page is valid only for an empty page. Recorded observations are deduplicated by identical batch state within a UTC hour, are not continuous telemetry, and leave unobserved gaps. This is not a historical report: do not infer past release or eligibility state. Summaries and observation receipts cover only the returned page; follow every nextCursor with unchanged filters and add page summaries for a complete filtered snapshot. Use blocker codes to drive inspection with list_workforce_batches, list_workforce_batch_units, and the relevant group or staffing-candidate tools.",
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
      priority: z
        .enum(["medium", "high"])
        .optional()
        .describe("Optional exact batch priority."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum available batches to return (server default 25, max 50)."),
      cursor: batchUidInputSchema
        .optional()
        .describe(
          "Opaque nextCursor from the previous dispatch-health page. Keep every other filter unchanged.",
        ),
    })
    .strict(),
  outputSchema: workforceDispatchHealthOutputSchema,
  supportsDetail: false,
  route: {
    name: "workforce-dispatch-health",
    method: "GET",
    path: "/admin/workforce/dispatch-health/",
    query: {
      organizationUid: "organization_uid",
      projectUid: "project_uid",
      datasetUid: "dataset_uid",
      sequenceUid: "sequence_uid",
      priority: "priority",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
});

const listWorkforceOperationEventsTool = defineReadCatalogTool({
  name: "list_workforce_operation_events",
  title: "List workforce operation events",
  description:
    "Staff only: search bounded immutable receipts for reviewed workforce operations during a required past half-open window of at most 31 days. Requires workforce.write because rows can contain opaque coworker and action-target identifiers. This is receipt history, not continuous state history: an empty result does not prove no change occurred before a ledger existed or through an uninstrumented path. Storage coverage is explicit per ledger and summaries cover only the returned page. Follow every nextCursor with unchanged filters, then sort collected rows by occurredAt for chronology because pagination uses opaque UUID order. Returns only fixed effects, coarse provenance-presence signals, and explicit verification status; never actor identity, reason/client text, raw changes, names, URLs, customer payloads, pay, rankings, or composite performance scores.",
  inputSchema: z
    .object({
      occurredFrom: z
        .string()
        .datetime({ offset: true })
        .describe(
          "Required inclusive start of the operation window, with UTC offset.",
        ),
      occurredBefore: z
        .string()
        .datetime({ offset: true })
        .describe(
          "Required exclusive past end of the operation window, with UTC offset; the window may span at most 31 days.",
        ),
      eventKind: z
        .enum(workforceOperationEventKinds)
        .optional()
        .describe("Optional exact immutable ledger kind."),
      operation: z
        .enum(workforceKnownOperationEventOperations)
        .optional()
        .describe("Optional exact reviewed workforce operation."),
      source: z
        .enum(["admin", "api", "mcp", "system"])
        .optional()
        .describe("Optional exact recorded operation source."),
      batchUid: batchUidInputSchema
        .optional()
        .describe("Optional exact work-batch target UID."),
      sequenceUid: batchUidInputSchema
        .optional()
        .describe("Optional exact sequence target UID."),
      groupUid: batchUidInputSchema
        .optional()
        .describe("Optional exact global group target UID."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum operation receipts to return (server default 25, max 50)."),
      cursor: batchUidInputSchema
        .optional()
        .describe(
          "Opaque nextCursor from the previous operation-history page. Keep every other filter unchanged; this is not chronological order.",
        ),
    })
    .strict()
    .superRefine((input, context) => {
      const start = Date.parse(input.occurredFrom);
      const end = Date.parse(input.occurredBefore);
      if (start >= end) {
        context.addIssue({
          code: "custom",
          path: ["occurredBefore"],
          message: "Operation window must end after occurredFrom.",
        });
      } else if (end - start > 31 * 24 * 60 * 60 * 1000) {
        context.addIssue({
          code: "custom",
          path: ["occurredBefore"],
          message: "Operation window cannot exceed 31 days.",
        });
      }
      if (end > Date.now()) {
        context.addIssue({
          code: "custom",
          path: ["occurredBefore"],
          message: "Operation window cannot end in the future.",
        });
      }

      const targetKinds = [
        input.batchUid === undefined ? undefined : "work_batch",
        input.sequenceUid === undefined ? undefined : "sequence",
        input.groupUid === undefined ? undefined : "group_membership",
      ].filter(
        (kind): kind is WorkforceOperationEventKind => kind !== undefined,
      );
      if (targetKinds.length > 1) {
        context.addIssue({
          code: "custom",
          path: ["eventKind"],
          message:
            "Batch, sequence, and group target filters cannot be combined.",
        });
      }
      const targetKind = targetKinds[0];
      if (
        targetKind !== undefined &&
        input.eventKind !== undefined &&
        input.eventKind !== targetKind
      ) {
        context.addIssue({
          code: "custom",
          path: ["eventKind"],
          message: "Event kind does not match the requested target filter.",
        });
      }
      const effectiveKind = input.eventKind ?? targetKind;
      if (
        effectiveKind !== undefined &&
        input.operation !== undefined &&
        !workforceOperationValuesByKind[effectiveKind].has(input.operation)
      ) {
        context.addIssue({
          code: "custom",
          path: ["operation"],
          message: "Operation is not valid for the requested event kind.",
        });
      }
    }),
  outputSchema: workforceOperationEventHistoryOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const report = value as {
      measurement: {
        occurrenceWindow: {
          occurredFrom: string;
          occurredBefore: string;
        };
      };
      coverage: { queriedEventKinds: WorkforceOperationEventKind[] };
      events: Array<{
        eventUid: string;
        eventKind: WorkforceOperationEventKind;
        operation: string;
        provenance: { source: string };
        target: {
          batchUid: string | null;
          sequenceUid: string | null;
          groupUid: string | null;
        };
      }>;
      nextCursor: string | null;
    };
    if (
      Date.parse(report.measurement.occurrenceWindow.occurredFrom) !==
        Date.parse(String(args.occurredFrom)) ||
      Date.parse(report.measurement.occurrenceWindow.occurredBefore) !==
        Date.parse(String(args.occurredBefore))
    ) {
      throw new Error(
        "Workforce operation-history response did not match the requested occurrence window.",
      );
    }

    const targetKind =
      typeof args.batchUid === "string"
        ? "work_batch"
        : typeof args.sequenceUid === "string"
          ? "sequence"
          : typeof args.groupUid === "string"
            ? "group_membership"
            : undefined;
    const requestedKind =
      typeof args.eventKind === "string"
        ? (args.eventKind as WorkforceOperationEventKind)
        : targetKind;
    const expectedQueriedKinds = requestedKind
      ? [requestedKind]
      : [...workforceOperationEventKinds];
    if (
      report.coverage.queriedEventKinds.join("\u0000") !==
      expectedQueriedKinds.join("\u0000")
    ) {
      throw new Error(
        "Workforce operation-history response did not match the requested ledger scope.",
      );
    }

    if (
      typeof args.eventKind === "string" &&
      report.events.some((event) => event.eventKind !== args.eventKind)
    ) {
      throw new Error(
        "Workforce operation-history response did not match the requested event kind.",
      );
    }
    if (
      typeof args.operation === "string" &&
      report.events.some((event) => event.operation !== args.operation)
    ) {
      throw new Error(
        "Workforce operation-history response did not match the requested operation.",
      );
    }
    if (
      typeof args.source === "string" &&
      report.events.some((event) => event.provenance.source !== args.source)
    ) {
      throw new Error(
        "Workforce operation-history response did not match the requested source.",
      );
    }

    const targetFilters = [
      ["batchUid", args.batchUid],
      ["sequenceUid", args.sequenceUid],
      ["groupUid", args.groupUid],
    ] as const;
    for (const [field, requested] of targetFilters) {
      if (typeof requested !== "string") continue;
      const expected = requested.replaceAll("-", "");
      if (
        report.events.some((event) => event.target[field] !== expected)
      ) {
        throw new Error(
          `Workforce operation-history response did not match the requested ${field}.`,
        );
      }
    }

    const limit = typeof args.limit === "number" ? args.limit : 25;
    if (report.events.length > limit) {
      throw new Error(
        "Workforce operation-history response exceeded the requested page limit.",
      );
    }
    if (typeof args.cursor === "string") {
      const requestedCursor = args.cursor.replaceAll("-", "");
      if (
        report.events.some((event) => event.eventUid <= requestedCursor) ||
        report.nextCursor === requestedCursor
      ) {
        throw new Error(
          "Workforce operation-history pagination did not advance beyond the requested cursor.",
        );
      }
    }
    return value;
  },
  route: {
    name: "workforce-operation-events",
    method: "GET",
    path: "/admin/workforce/operation-events/",
    query: {
      occurredFrom: "occurred_from",
      occurredBefore: "occurred_before",
      eventKind: "event_kind",
      operation: "operation",
      source: "source",
      batchUid: "batch_uid",
      sequenceUid: "sequence_uid",
      groupUid: "group_uid",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.write",
    toolset: "staff",
  },
});

const getWorkforceOperationEventTool = defineReadCatalogTool({
  name: "get_workforce_operation_event",
  title: "Get workforce operation event",
  description:
    "Staff only: verify the exact immutable operation receipt returned by a workforce mutation. Requires workforce.write because the receipt can contain opaque coworker and action-target identifiers. Returns only fixed effect fields, coarse provenance-presence signals, and an explicit complete, partial, or unavailable verification status. It is not searchable history and never returns actor identity, reason or client text, raw changes, names, URLs, customer payloads, pay, or rankings. Preserve every operationEventUid and use this tool after a mutation before reporting its effect as verified.",
  inputSchema: z
    .object({
      operationEventUid: batchUidInputSchema.describe(
        "Exact immutable event UID returned by a workforce mutation.",
      ),
    })
    .strict(),
  outputSchema: workforceOperationEventOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const event = value as { eventUid: string };
    const requestedEventUid = String(args.operationEventUid).replaceAll("-", "");
    if (event.eventUid !== requestedEventUid) {
      throw new Error("Workforce operation event response did not match the requested receipt.");
    }
    return value;
  },
  route: {
    name: "workforce-operation-event",
    method: "GET",
    path: "/admin/workforce/operation-events/{operationEventUid}/",
    response: "single",
    scope: "workforce.write",
    toolset: "staff",
  },
});

const getWorkforceDispatchObservationsTool = defineReadCatalogTool({
  name: "get_workforce_dispatch_observations",
  title: "Get workforce dispatch observations",
  description:
    "Staff only: read privacy-safe dispatch states sampled by successful staff dispatch-health requests during a required past half-open window of at most 31 days. This is sparse observation evidence, not continuous telemetry: an absent row does not prove healthy, unchanged, or unavailable, and storageWindowStatus only says whether the evidence table existed. Lifecycle, priority, staffing mode, line context, and their filters are current rather than historical. Coverage and status/blocker occurrence counts cover only the returned page. Follow every nextCursor with unchanged filters, collect all pages, then sort by observedAt for chronology because cursor order is opaque UUID order. Never sum repeated snapshot backlog counts as throughput or work completed.",
  inputSchema: z
    .object({
      observedFrom: z
        .string()
        .datetime({ offset: true })
        .describe(
          "Required inclusive start of the sampled-observation window, with UTC offset.",
        ),
      observedBefore: z
        .string()
        .datetime({ offset: true })
        .describe(
          "Required exclusive past end of the sampled-observation window, with UTC offset; the window may span at most 31 days.",
        ),
      batchUid: batchUidInputSchema
        .optional()
        .describe("Optional exact batch UID."),
      organizationUid: batchUidInputSchema
        .optional()
        .describe("Optional exact current organization UID for the production line."),
      projectUid: batchUidInputSchema
        .optional()
        .describe("Optional exact current project UID for the production line."),
      datasetUid: batchUidInputSchema
        .optional()
        .describe("Optional exact current dataset UID for the production line."),
      sequenceUid: batchUidInputSchema
        .optional()
        .describe("Optional exact current sequence UID for the production line."),
      currentStatus: z
        .enum(["available", "unavailable", "archived"])
        .optional()
        .describe("Optional exact current batch lifecycle status."),
      currentPriority: z
        .enum(["medium", "high"])
        .optional()
        .describe("Optional exact current batch priority."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum observations to return (server default 25, max 50)."),
      cursor: batchUidInputSchema
        .optional()
        .describe(
          "Opaque nextCursor from the previous observation page. Keep every other filter unchanged; this is not chronological order.",
        ),
    })
    .strict()
    .superRefine((input, context) => {
      const start = Date.parse(input.observedFrom);
      const end = Date.parse(input.observedBefore);
      if (start >= end) {
        context.addIssue({
          code: "custom",
          path: ["observedBefore"],
          message: "Observation window must end after observedFrom.",
        });
      } else if (end - start > 31 * 24 * 60 * 60 * 1000) {
        context.addIssue({
          code: "custom",
          path: ["observedBefore"],
          message: "Observation window cannot exceed 31 days.",
        });
      }
      if (end > Date.now()) {
        context.addIssue({
          code: "custom",
          path: ["observedBefore"],
          message: "Observation window cannot end in the future.",
        });
      }
    }),
  outputSchema: workforceDispatchObservationHistoryOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const report = value as {
      measurement: {
        observationWindow: { observedFrom: string; observedBefore: string };
      };
      observations: Array<{
        observationUid: string;
        batchUid: string;
        currentBatchStatus: "available" | "unavailable" | "archived";
        currentPriority: "medium" | "high";
        currentLineContext: {
          organizationUid: string | null;
          projectUid: string | null;
          datasetUid: string | null;
          sequenceUid: string | null;
        };
      }>;
      nextCursor: string | null;
    };
    if (
      Date.parse(report.measurement.observationWindow.observedFrom) !==
        Date.parse(String(args.observedFrom)) ||
      Date.parse(report.measurement.observationWindow.observedBefore) !==
        Date.parse(String(args.observedBefore))
    ) {
      throw new Error(
        "Workforce dispatch-observations response did not match the requested observation window.",
      );
    }

    const requestedBatchUid =
      typeof args.batchUid === "string"
        ? args.batchUid.replaceAll("-", "")
        : undefined;
    if (
      requestedBatchUid !== undefined &&
      report.observations.some(
        (observation) => observation.batchUid !== requestedBatchUid,
      )
    ) {
      throw new Error(
        "Workforce dispatch-observations response did not match the requested batch UID.",
      );
    }

    const contextFilters = [
      ["organizationUid", args.organizationUid],
      ["projectUid", args.projectUid],
      ["datasetUid", args.datasetUid],
      ["sequenceUid", args.sequenceUid],
    ] as const;
    for (const [field, requested] of contextFilters) {
      if (typeof requested !== "string") continue;
      const expected = requested.replaceAll("-", "");
      if (
        report.observations.some(
          (observation) => observation.currentLineContext[field] !== expected,
        )
      ) {
        throw new Error(
          `Workforce dispatch-observations response did not match the requested ${field}.`,
        );
      }
    }
    if (
      typeof args.currentStatus === "string" &&
      report.observations.some(
        (observation) => observation.currentBatchStatus !== args.currentStatus,
      )
    ) {
      throw new Error(
        "Workforce dispatch-observations response did not match the requested current status.",
      );
    }
    if (
      typeof args.currentPriority === "string" &&
      report.observations.some(
        (observation) => observation.currentPriority !== args.currentPriority,
      )
    ) {
      throw new Error(
        "Workforce dispatch-observations response did not match the requested current priority.",
      );
    }

    if (typeof args.cursor === "string") {
      const requestedCursor = args.cursor.replaceAll("-", "");
      if (
        report.observations.some(
          (observation) => observation.observationUid <= requestedCursor,
        ) ||
        report.nextCursor === requestedCursor
      ) {
        throw new Error(
          "Workforce dispatch-observations pagination did not advance beyond the requested cursor.",
        );
      }
    }
    return value;
  },
  route: {
    name: "workforce-dispatch-observations",
    method: "GET",
    path: "/admin/workforce/dispatch-observations/",
    query: {
      observedFrom: "observed_from",
      observedBefore: "observed_before",
      batchUid: "batch_uid",
      organizationUid: "organization_uid",
      projectUid: "project_uid",
      datasetUid: "dataset_uid",
      sequenceUid: "sequence_uid",
      currentStatus: "current_status",
      currentPriority: "current_priority",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
});

const getWorkforceDispatchOutcomesTool = defineReadCatalogTool({
  name: "get_workforce_dispatch_outcomes",
  title: "Get workforce dispatch outcomes",
  description:
    "Staff only: report bounded first-observed batch releases, first recorded server-generated queue visibility, and earliest recorded post-release work-unit claims for Physical AI labeling production lines. Queue evidence is anonymous and proves neither client receipt nor earliest possible visibility; no-recorded-visibility and no-recorded-claim never mean never. Check releaseWindowObservationStatus and each queueVisibilityEvidenceStatus before using counts or delays. Historical eligibility, allocation, and group blockers remain unsupported because those states were not snapshotted. Summaries and queue/claim coverage describe only the returned page; release coverage describes the filtered population. Follow every nextCursor with unchanged filters.",
  inputSchema: z
    .object({
      releasedFrom: z
        .string()
        .datetime({ offset: true })
        .describe(
          "Required inclusive start of the observed-release window, with UTC offset.",
        ),
      releasedBefore: z
        .string()
        .datetime({ offset: true })
        .describe(
          "Required exclusive end of the observed-release window, with UTC offset; the window may span at most 366 days.",
        ),
      thresholdDays: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe(
          "Days after observed release considered within threshold (server default 7, max 90). Exact-deadline claims are within threshold.",
        ),
      organizationUid: batchUidInputSchema
        .optional()
        .describe("Optional exact current organization UID for the production line."),
      projectUid: batchUidInputSchema
        .optional()
        .describe("Optional exact current project UID for the production line."),
      datasetUid: batchUidInputSchema
        .optional()
        .describe("Optional exact current dataset UID for the production line."),
      sequenceUid: batchUidInputSchema
        .optional()
        .describe("Optional exact current sequence UID for the production line."),
      currentPriority: z
        .enum(["medium", "high"])
        .optional()
        .describe("Optional exact current batch priority."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum observed releases to return (server default 25, max 50)."),
      cursor: batchUidInputSchema
        .optional()
        .describe(
          "Opaque nextCursor from the previous dispatch-outcomes page. Keep every other filter unchanged.",
        ),
    })
    .strict()
    .superRefine((input, context) => {
      const start = Date.parse(input.releasedFrom);
      const end = Date.parse(input.releasedBefore);
      if (start >= end) {
        context.addIssue({
          code: "custom",
          path: ["releasedBefore"],
          message: "Release window must end after releasedFrom.",
        });
      } else if (end - start > 366 * 24 * 60 * 60 * 1000) {
        context.addIssue({
          code: "custom",
          path: ["releasedBefore"],
          message: "Release window cannot exceed 366 days.",
        });
      }
    }),
  outputSchema: workforceDispatchOutcomesOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const report = value as {
      measurement: {
        releaseWindow: { releasedFrom: string; releasedBefore: string };
        thresholdDays: number;
      };
      batches: Array<{
        batchUid: string;
        currentPriority: "medium" | "high";
        currentLineContext: {
          organizationUid: string | null;
          projectUid: string | null;
          datasetUid: string | null;
          sequenceUid: string | null;
        };
      }>;
      nextCursor: string | null;
    };
    if (
      Date.parse(report.measurement.releaseWindow.releasedFrom) !==
        Date.parse(String(args.releasedFrom)) ||
      Date.parse(report.measurement.releaseWindow.releasedBefore) !==
        Date.parse(String(args.releasedBefore))
    ) {
      throw new Error(
        "Workforce dispatch-outcomes response did not match the requested release window.",
      );
    }

    const requestedThresholdDays =
      typeof args.thresholdDays === "number" ? args.thresholdDays : 7;
    if (report.measurement.thresholdDays !== requestedThresholdDays) {
      throw new Error(
        "Workforce dispatch-outcomes response did not match the requested threshold.",
      );
    }

    const contextFilters = [
      ["organizationUid", args.organizationUid],
      ["projectUid", args.projectUid],
      ["datasetUid", args.datasetUid],
      ["sequenceUid", args.sequenceUid],
    ] as const;
    for (const [field, requested] of contextFilters) {
      if (typeof requested !== "string") continue;
      const expected = requested.replaceAll("-", "");
      if (
        report.batches.some(
          (batch) => batch.currentLineContext[field] !== expected,
        )
      ) {
        throw new Error(
          `Workforce dispatch-outcomes response did not match the requested ${field}.`,
        );
      }
    }
    if (
      typeof args.currentPriority === "string" &&
      report.batches.some(
        (batch) => batch.currentPriority !== args.currentPriority,
      )
    ) {
      throw new Error(
        "Workforce dispatch-outcomes response did not match the requested current priority.",
      );
    }

    if (typeof args.cursor === "string") {
      const requestedCursor = args.cursor.replaceAll("-", "");
      if (
        report.batches.some((batch) => batch.batchUid <= requestedCursor) ||
        report.nextCursor === requestedCursor
      ) {
        throw new Error(
          "Workforce dispatch-outcomes pagination did not advance beyond the requested cursor.",
        );
      }
    }
    return value;
  },
  route: {
    name: "workforce-dispatch-outcomes",
    method: "GET",
    path: "/admin/workforce/dispatch-outcomes/",
    query: {
      releasedFrom: "released_from",
      releasedBefore: "released_before",
      thresholdDays: "threshold_days",
      organizationUid: "organization_uid",
      projectUid: "project_uid",
      datasetUid: "dataset_uid",
      sequenceUid: "sequence_uid",
      currentPriority: "current_priority",
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

const listWorkforceBatchStaffingCandidatesTool = defineReadCatalogTool({
  name: "list_workforce_batch_staffing_candidates",
  title: "List workforce batch staffing candidates",
  description:
    "Staff only: inspect a bounded, pseudonymous roster for staffing one exact Physical AI labeling production line. Requires workforce.write and returns opaque coworker UIDs, batch allocation state, readiness booleans, matching unit counts, and raw recent organization-scoped outcomes. It excludes names, contacts, profiles, group labels, pay, customer payloads, work details, rankings, and composite scores.",
  inputSchema: z
    .object({
      batchUid: batchUidInputSchema.describe(
        "Opaque batch UID returned by list_workforce_batches.",
      ),
      allocated: z
        .boolean()
        .optional()
        .describe("Optional exact current-allocation filter."),
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
        .describe("Opaque nextCursor from the previous staffing page."),
    })
    .strict(),
  outputSchema: workforceBatchStaffingCandidatesOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const roster = value as { batchUid: string };
    const requestedBatchUid = String(args.batchUid).replaceAll("-", "");
    if (roster.batchUid !== requestedBatchUid) {
      throw new Error(
        "Workforce batch staffing response did not match the requested batch.",
      );
    }
    return value;
  },
  route: {
    name: "workforce-batch-staffing-candidates",
    method: "GET",
    path: "/admin/workforce/batches/{batchUid}/staffing-candidates/",
    query: {
      allocated: "allocated",
      windowDays: "window_days",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.write",
    toolset: "staff",
  },
});

const listWorkforceBatchCoworkerActivityTool = defineReadCatalogTool({
  name: "list_workforce_batch_coworker_activity",
  title: "List workforce batch coworker activity",
  description:
    "Staff only: monitor a bounded, pseudonymous coworker roster for one exact Physical AI labeling production line. Requires workforce.write and returns opaque coworker UIDs, current batch allocation/readiness, fixed assigned-unit state counts, and raw recent batch-local activity. It excludes names, contacts, profiles, group labels, pay, customer payloads, work details, rankings, rates, and composite performance scores.",
  inputSchema: z
    .object({
      batchUid: batchUidInputSchema.describe(
        "Opaque batch UID returned by list_workforce_batches or list_workforce_batch_staffing_candidates.",
      ),
      allocated: z
        .boolean()
        .optional()
        .describe("Optional exact current-allocation filter."),
      windowDays: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe(
          "Recent batch-activity window in days (server default 30, max 90).",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum coworkers to return (server default 50, max 100)."),
      cursor: batchUidInputSchema
        .optional()
        .describe("Opaque nextCursor from the previous activity page."),
    })
    .strict(),
  outputSchema: workforceBatchCoworkerActivityOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const activity = value as { batchUid: string };
    const requestedBatchUid = String(args.batchUid).replaceAll("-", "");
    if (activity.batchUid !== requestedBatchUid) {
      throw new Error(
        "Workforce batch coworker activity response did not match the requested batch.",
      );
    }
    return value;
  },
  route: {
    name: "workforce-batch-coworker-activity",
    method: "GET",
    path: "/admin/workforce/batches/{batchUid}/coworker-activity/",
    query: {
      allocated: "allocated",
      windowDays: "window_days",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.write",
    toolset: "staff",
  },
});

const previewWorkforceBatchAllocationImpactTool = defineReadCatalogTool({
  name: "preview_workforce_batch_allocation_impact",
  title: "Preview workforce batch allocation impact",
  description:
    "Staff only: preview adding or removing one coworker from one exact allocated Physical AI labeling batch before any staffing mutation. Requires workforce.write and returns only opaque line/coworker IDs, readiness, raw fixed status counts, and guardrail booleans. This changes batch scheduling only: it never changes global group qualification or platform capabilities and exposes no names, contacts, profiles, pay, customer payloads, work details, rankings, or composite scores.",
  inputSchema: z
    .object({
      batchUid: batchUidInputSchema.describe(
        "Opaque batch UID returned by list_workforce_batches or list_workforce_batch_staffing_candidates.",
      ),
      coworkerUid: batchUidInputSchema.describe(
        "Opaque coworker UID returned by list_workforce_batch_staffing_candidates.",
      ),
      operation: z
        .enum(["add", "remove"])
        .describe("Explicit batch allocation change to preview; no change is applied."),
    })
    .strict(),
  outputSchema: workforceBatchAllocationImpactOutputSchema,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const impact = value as {
      operation: string;
      batchUid: string;
      coworkerUid: string;
    };
    const requestedBatchUid = String(args.batchUid).replaceAll("-", "");
    const requestedCoworkerUid = String(args.coworkerUid).replaceAll("-", "");
    if (
      impact.operation !== args.operation ||
      impact.batchUid !== requestedBatchUid ||
      impact.coworkerUid !== requestedCoworkerUid
    ) {
      throw new Error(
        "Workforce batch allocation impact response did not match the requested batch, coworker, and operation.",
      );
    }
    return value;
  },
  route: {
    name: "workforce-batch-allocation-impact",
    method: "GET",
    path: "/admin/workforce/batches/{batchUid}/coworkers/{coworkerUid}/allocation-impact/",
    query: { operation: "operation" },
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

const changeWorkforceBatchAllocationTool = defineMutationCatalogTool({
  name: "change_workforce_batch_allocation",
  title: "Change workforce batch allocation",
  description:
    "Staff only: add or remove one coworker from one exact allocated Physical AI labeling production line after an exact impact preview and explicit human approval. Requires workforce.write, every expected-state field returned by preview_workforce_batch_allocation_impact, and a batch-scope acknowledgement. This changes batch scheduling only and never changes global group qualification or platform capabilities. Known no-ops, unqualified additions, removals with active batch work, and removals that would leave an available batch unstaffed are refused before approval.",
  inputSchema: z
    .object({
      batchUid: batchUidInputSchema.describe(
        "Exact opaque batch UID from preview_workforce_batch_allocation_impact.",
      ),
      coworkerUid: batchUidInputSchema.describe(
        "Exact opaque coworker UID from preview_workforce_batch_allocation_impact.",
      ),
      operation: z
        .enum(["add", "remove"])
        .describe("Exact operation used for the reviewed impact preview."),
      expectedBatchStatus: z
        .enum(["available", "unavailable", "archived"])
        .describe("Exact batchStatus returned by the impact preview."),
      expectedStaffingMode: z
        .literal("allocated")
        .describe(
          "Exact staffingMode returned by the actionable impact preview; this tool only changes allocated batches.",
        ),
      expectedBatchUpdatedAt: z
        .string()
        .datetime({ offset: true })
        .describe("Exact batchUpdatedAt returned by the impact preview."),
      expectedLineContext: actionableWorkforceLineContextInputSchema.describe(
        "Exact organization/project/dataset/sequence UID context returned by the impact preview.",
      ),
      expectedCurrentAllocation: z
        .boolean()
        .describe("Exact currentAllocation returned by the impact preview."),
      expectedReadiness: workforceGroupMembershipExpectedReadinessInputSchema.describe(
        "Exact active, approved, and hasActiveWork state returned by the impact preview.",
      ),
      expectedMatchingGroupUnitsByStatus:
        workforceGroupMembershipExpectedUnitStatusInputSchema.describe(
          "Exact matchingGroupUnitsByStatus counts returned by the impact preview.",
        ),
      expectedEffect: workforceBatchAllocationExpectedEffectInputSchema.describe(
        "Exact actionable batch-only effect returned by the impact preview; blocked removals and no-ops are not accepted.",
      ),
      acknowledgeBatchScope: z
        .literal(true)
        .describe(
          "Must be true: this changes allocation within one exact batch and does not change global group qualification.",
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
      if (value.expectedCurrentAllocation !== (value.operation === "remove")) {
        context.addIssue({
          code: "custom",
          path: ["expectedCurrentAllocation"],
          message:
            "Add requires an observed unallocated coworker; remove requires an observed allocation.",
        });
      }
      const matchingUnitCount = Object.values(
        value.expectedMatchingGroupUnitsByStatus,
      ).reduce((total, count) => total + count, 0);
      const qualified = matchingUnitCount > 0;
      if (value.expectedEffect.qualifiedForBatchWork !== qualified) {
        context.addIssue({
          code: "custom",
          path: ["expectedEffect", "qualifiedForBatchWork"],
          message:
            "Qualification and matching unit counts must come from one exact preview.",
        });
      }
      const baseEligibility =
        value.expectedReadiness.active &&
        value.expectedReadiness.approved &&
        qualified;
      if (
        value.expectedEffect.currentEligibility !==
        (baseEligibility && value.expectedCurrentAllocation)
      ) {
        context.addIssue({
          code: "custom",
          path: ["expectedEffect", "currentEligibility"],
          message:
            "Current eligibility and allocation state must come from one exact preview.",
        });
      }
      if (
        value.expectedEffect.projectedEligibility !==
        (baseEligibility && value.operation === "add")
      ) {
        context.addIssue({
          code: "custom",
          path: ["expectedEffect", "projectedEligibility"],
          message:
            "Projected eligibility and operation must come from one exact preview.",
        });
      }
      if (value.operation === "add" && !baseEligibility) {
        context.addIssue({
          code: "custom",
          path: ["expectedReadiness"],
          message:
            "Allocation additions require an active, approved coworker qualified for this batch.",
        });
      }
      if (
        value.operation === "remove" &&
        value.expectedEffect.activeAssignedBatchWorkUnits !== 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["expectedEffect", "activeAssignedBatchWorkUnits"],
          message:
            "Deassign active work in this batch before removing allocation.",
        });
      }
      if (
        value.operation === "remove" &&
        value.expectedBatchStatus === "available" &&
        value.expectedEffect.eligibleAllocatedCoworkersAfterChange === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["expectedEffect", "eligibleAllocatedCoworkersAfterChange"],
          message:
            "Make the batch unavailable before removing its last eligible allocated coworker.",
        });
      }
    }),
  outputSchema: z
    .object({
      operationEventUid: compactUuidOutputSchema,
      allocationUid: compactUuidOutputSchema,
      operation: z.enum(["add", "remove"]),
      batchUid: compactUuidOutputSchema,
      coworkerUid: compactUuidOutputSchema,
      previousAllocation: z.boolean(),
      currentAllocation: z.boolean(),
      effect: z
        .object({
          scope: z.literal("batch"),
          globalGroupMembershipChanged: z.literal(false),
          allocationChanged: z.literal(true),
        })
        .strip(),
      reason: z.string().min(1).max(500),
      reversalGuidance: z.string().min(1).max(1000),
    })
    .strip(),
  route: {
    name: "workforce-batch-allocation",
    method: "POST",
    path: "/admin/workforce/batches/{batchUid}/coworkers/{coworkerUid}/allocation/",
    scope: "workforce.write",
    toolset: "staff",
    body: ({
      operation,
      expectedBatchStatus,
      expectedStaffingMode,
      expectedBatchUpdatedAt,
      expectedLineContext,
      expectedCurrentAllocation,
      expectedReadiness,
      expectedMatchingGroupUnitsByStatus,
      expectedEffect,
      acknowledgeBatchScope,
      reason,
    }) => ({
      operation,
      expected_batch_status: expectedBatchStatus,
      expected_staffing_mode: expectedStaffingMode,
      expected_batch_updated_at: expectedBatchUpdatedAt,
      expected_line_context: {
        organization_uid: expectedLineContext.organizationUid,
        project_uid: expectedLineContext.projectUid,
        dataset_uid: expectedLineContext.datasetUid,
        sequence_uid: expectedLineContext.sequenceUid,
      },
      expected_current_allocation: expectedCurrentAllocation,
      expected_readiness: {
        active: expectedReadiness.active,
        approved: expectedReadiness.approved,
        has_active_work: expectedReadiness.hasActiveWork,
      },
      expected_matching_group_units_by_status: {
        unavailable: expectedMatchingGroupUnitsByStatus.unavailable,
        backlog: expectedMatchingGroupUnitsByStatus.backlog,
        in_progress: expectedMatchingGroupUnitsByStatus.inProgress,
        in_review: expectedMatchingGroupUnitsByStatus.inReview,
        completed: expectedMatchingGroupUnitsByStatus.completed,
        error: expectedMatchingGroupUnitsByStatus.error,
      },
      expected_effect: {
        scope: expectedEffect.scope,
        would_change_allocation: expectedEffect.wouldChangeAllocation,
        qualified_for_batch_work: expectedEffect.qualifiedForBatchWork,
        current_eligibility: expectedEffect.currentEligibility,
        projected_eligibility: expectedEffect.projectedEligibility,
        active_assigned_batch_work_units:
          expectedEffect.activeAssignedBatchWorkUnits,
        removal_blocked_by_active_batch_work:
          expectedEffect.removalBlockedByActiveBatchWork,
        eligible_allocated_coworkers_after_change:
          expectedEffect.eligibleAllocatedCoworkersAfterChange,
        removal_would_leave_available_batch_unstaffed:
          expectedEffect.removalWouldLeaveAvailableBatchUnstaffed,
      },
      acknowledge_batch_scope: acknowledgeBatchScope,
      reason,
    }),
  },
  project: (value, args) => {
    const expectedBatchUid = args.batchUid.replaceAll("-", "");
    const expectedCoworkerUid = args.coworkerUid.replaceAll("-", "");
    const expectedNewAllocation = args.operation === "add";
    if (
      value.operation !== args.operation ||
      value.batchUid !== expectedBatchUid ||
      value.coworkerUid !== expectedCoworkerUid ||
      value.previousAllocation !== args.expectedCurrentAllocation ||
      value.currentAllocation !== expectedNewAllocation ||
      value.reason !== args.reason
    ) {
      throw new Error(
        "Workforce batch allocation mutation response did not match the approved operation.",
      );
    }
    return value;
  },
  preview: ({
    batchUid,
    coworkerUid,
    operation,
    expectedBatchStatus,
    expectedBatchUpdatedAt,
    expectedLineContext,
    expectedReadiness,
    expectedEffect,
    reason,
  }) => ({
    message:
      `${operation === "add" ? "Allocate" : "Deallocate"} coworker ${coworkerUid} ${operation === "add" ? "to" : "from"} batch ${batchUid}? ` +
      `This changes scheduling for this exact batch only; global group qualification and platform capabilities will not change. ` +
      `Reviewed batch status=${expectedBatchStatus}, updatedAt=${expectedBatchUpdatedAt}; line context: ${describeWorkforceLineContext(expectedLineContext)}. ` +
      `Readiness active=${expectedReadiness.active}, approved=${expectedReadiness.approved}, hasActiveWork=${expectedReadiness.hasActiveWork}; ` +
      `qualified=${expectedEffect.qualifiedForBatchWork}, currentEligibility=${expectedEffect.currentEligibility}, projectedEligibility=${expectedEffect.projectedEligibility}, activeBatchUnits=${expectedEffect.activeAssignedBatchWorkUnits}, eligibleAllocatedAfter=${expectedEffect.eligibleAllocatedCoworkersAfterChange}. ` +
      `Batch-only scope is acknowledged. Reason: ${reason}`,
  }),
  reversalGuidance: ({ batchUid, coworkerUid, operation }) => {
    const reverseOperation = operation === "add" ? "remove" : "add";
    return `Run preview_workforce_batch_allocation_impact again for batch ${batchUid}, coworker ${coworkerUid}, operation=${reverseOperation}. If the fresh preview is actionable, call change_workforce_batch_allocation with every newly observed field and obtain separate human approval. Reversal changes batch scheduling only; it does not undo work performed meanwhile.`;
  },
});

const createWorkforceBatchTool = defineMutationCatalogTool({
  name: "create_workforce_batch",
  title: "Create workforce batch",
  description:
    "Staff only: create one unavailable, sequence-scoped Physical AI labeling production line with 1–100 backlog work units after explicit human approval. New MCP-created lines default to allocated staffing so Operations explicitly schedules qualified coworkers before release; group_pool remains available for deliberate legacy pooled operation. Requires the exact sequence status, update timestamp, and workflow revision returned by get_workforce_sequence_status; the server derives all coworker routes and refuses arbitrary URLs or configuration.",
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
      staffingMode: workforceStaffingModeSchema
        .optional()
        .describe(
          "Staffing boundary for the new line. Omit for allocated, which requires explicit batch allocation in addition to global qualification; choose group_pool only for deliberate legacy pooled operation.",
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
      operationEventUid: compactUuidOutputSchema,
      batchUid: compactUuidOutputSchema,
      batchStatus: z.literal("unavailable"),
      priority: z.literal("medium"),
      staffingMode: workforceStaffingModeSchema,
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
      staffingMode,
      workUnits,
      reason,
    }) => ({
      name,
      project_uid: projectUid,
      sequence_uid: sequenceUid,
      expected_sequence_status: expectedSequenceStatus,
      expected_sequence_updated_at: expectedSequenceUpdatedAt,
      expected_workflow_revision_uid: expectedWorkflowRevisionUid,
      staffing_mode: staffingMode ?? "allocated",
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
  project: (value, args) => {
    const expectedSequenceUid = args.sequenceUid.replaceAll("-", "");
    const expectedStaffingMode = args.staffingMode ?? "allocated";
    const lineContext = value.lineContext as { sequenceUid: string };
    if (
      value.staffingMode !== expectedStaffingMode ||
      lineContext.sequenceUid !== expectedSequenceUid ||
      value.workUnitsCreated !== args.workUnits.length ||
      value.reason !== args.reason
    ) {
      throw new Error(
        "Workforce batch creation response did not match the approved production-line plan.",
      );
    }
    return value;
  },
  preview: ({
    name,
    projectUid,
    sequenceUid,
    expectedSequenceStatus,
    expectedSequenceUpdatedAt,
    expectedWorkflowRevisionUid,
    staffingMode,
    workUnits,
    reason,
  }) => {
    const effectiveStaffingMode = staffingMode ?? "allocated";
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
        `Staffing mode: ${effectiveStaffingMode}${effectiveStaffingMode === "allocated" ? " (qualified coworkers must be explicitly allocated before release)" : " (every qualified global-group member may claim work)"}. ` +
        `Plan: ${planSummary}. Reason: ${reason} The server derives exact coworker routes. Creation does not release work; staffing and making the batch available require separate human approval.`,
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
      operationEventUid: compactUuidOutputSchema,
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
      operationEventUid: compactUuidOutputSchema,
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
      operationEventUid: compactUuidOutputSchema,
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
      operationEventUid: compactUuidOutputSchema,
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
      operationEventUid: compactUuidOutputSchema,
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
  listCoworkerTrainingCandidatesTool,
  listWorkforceTrainingCohortEvidenceTool,
  getWorkforceCoworkerReliabilityTool,
  getCoworkerJourneyTool,
  listWorkforceBatchesTool,
  getWorkforceDispatchHealthTool,
  getWorkforceDispatchObservationsTool,
  getWorkforceDispatchOutcomesTool,
  listWorkforceOperationEventsTool,
  getWorkforceOperationEventTool,
  listWorkforceGroupsTool,
  listWorkforceGroupMembersTool,
  previewWorkforceGroupMembershipImpactTool,
  getWorkforceBatchAttentionTool,
  listWorkforceBatchUnitsTool,
  getWorkforceSequenceStatusTool,
  listWorkforceAssignmentCandidatesTool,
  listWorkforceBatchStaffingCandidatesTool,
  listWorkforceBatchCoworkerActivityTool,
  previewWorkforceBatchAllocationImpactTool,
] as const;

export const WORKFORCE_MUTATION_CATALOG_TOOLS = [
  changeWorkforceGroupMembershipTool,
  changeWorkforceBatchAllocationTool,
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
  registerReadCatalogTool(server, getClient, listCoworkerTrainingCandidatesTool);
  registerReadCatalogTool(
    server,
    getClient,
    listWorkforceTrainingCohortEvidenceTool,
  );
  registerReadCatalogTool(
    server,
    getClient,
    getWorkforceCoworkerReliabilityTool,
  );
  registerReadCatalogTool(server, getClient, getCoworkerJourneyTool);
  registerReadCatalogTool(server, getClient, listWorkforceBatchesTool);
  registerReadCatalogTool(server, getClient, getWorkforceDispatchHealthTool);
  registerReadCatalogTool(
    server,
    getClient,
    getWorkforceDispatchObservationsTool,
  );
  registerReadCatalogTool(server, getClient, getWorkforceDispatchOutcomesTool);
  registerReadCatalogTool(server, getClient, listWorkforceOperationEventsTool);
  registerReadCatalogTool(server, getClient, getWorkforceOperationEventTool);
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
  registerReadCatalogTool(
    server,
    getClient,
    listWorkforceBatchStaffingCandidatesTool,
  );
  registerReadCatalogTool(
    server,
    getClient,
    listWorkforceBatchCoworkerActivityTool,
  );
  registerReadCatalogTool(
    server,
    getClient,
    previewWorkforceBatchAllocationImpactTool,
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
      allowedMutationTools.has(changeWorkforceBatchAllocationTool.name)
    ) {
      registerMutationCatalogTool(
        server,
        getClient,
        changeWorkforceBatchAllocationTool,
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
