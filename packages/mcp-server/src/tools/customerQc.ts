import { z } from "zod";
import { defineReadCatalogTool } from "../catalog.js";

// Match the SDK's canonical identifiers, including rejection of trailing newlines.
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/,
  );
const sha256 = z.string().regex(/^[0-9a-f]{64}(?![\s\S])/);
const targetSchema = z
  .object({
    organizationUid: uuid.describe(
      "Canonical organization UUID; enrollment remains server-controlled",
    ),
    datasetUid: uuid.describe(
      "Canonical UUID of the dataset in that organization",
    ),
    sequenceUid: uuid.describe(
      "Canonical UUID of the sequence in that dataset",
    ),
    deliverableId: z
      .literal("cuboids")
      .describe("Pilot deliverable identifier; only 'cuboids' is supported"),
  })
  .strict();

const contextSchema = z
  .object({
    ...targetSchema.shape,
    schemaVersion: z.literal(1),
    evidenceKind: z.literal("workflow_metadata_only"),
    annotationScope: z.literal("cuboid_3d"),
    workflowRevisionUid: uuid,
    workflowDefinitionSha256: sha256,
    stateCreatedAt: z.string(),
    stateUpdatedAt: z.string(),
    workflowState: z.string(),
    approvalState: z.string(),
    approvalOutcome: z.string(),
    availableDecisions: z.array(
      z
        .object({
          state: z.string(),
          outcome: z.enum(["approved", "rejected"]),
        })
        .strip(),
    ),
    decisionReady: z.literal(false),
    blockers: z.array(z.string().min(1)).min(1),
    contextSha256: sha256,
  })
  .strip();

export const inspectCustomerQcContextTool = defineReadCatalogTool({
  name: "inspect_customer_qc_context",
  title: "Inspect customer QC context",
  description:
    "Inspect workflow metadata for an enrolled nonstaff customer organization editor's exact cuboid deliverable. " +
    "Requires datasets.read AND qc.read; pilot enrollment is default-off, and enrollment, current role, and tenant authorization remain server-enforced. " +
    "Always returns decisionReady=false and all blockers. Available decisions are workflow transitions, not approval authority. " +
    "Hashes describe workflow metadata only: no annotation revision fence, annotation bytes, media, proposal, approval receipt, or QC mutation. " +
    "Unavailable targets fail without a legacy-route fallback.",
  inputSchema: targetSchema,
  outputSchema: contextSchema,
  failureMessage:
    "Customer QC context unavailable. Verify enrollment, access, and the exact target; no decision is authorized.",
  supportsDetail: false,
  route: {
    name: "customer-qc-context",
    method: "GET",
    path: "/customer-qc/organizations/{organizationUid}/datasets/{datasetUid}/sequences/{sequenceUid}/deliverables/{deliverableId}/context/",
    response: "single",
    scope: "datasets.read",
    additionalScopes: ["qc.read"],
    toolset: "quality",
  },
  project(value, _detail, args) {
    const context = contextSchema.parse(value);
    if (
      context.organizationUid !== args.organizationUid ||
      context.datasetUid !== args.datasetUid ||
      context.sequenceUid !== args.sequenceUid ||
      context.deliverableId !== args.deliverableId
    ) {
      throw new Error(
        "Customer QC context does not match the requested target.",
      );
    }
    // Fixed-shape metadata: never project away blockers or derive readiness.
    return context;
  },
});
