import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  assetIdentityForUrl,
  assetizeCredentialUrls,
  assetReferenceFor,
  assetReferenceSchema,
  createAssetHandleService,
  frameUidForValue,
  identityBoundAssetReferenceFor,
  type AssetHandleService,
} from "../assetHandles.js";
import {
  defineCompositeReadCatalogTool,
  definePageOutputSchema,
  defineReadCatalogTool,
  registerCompositeReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import {
  CALIBRATION_KINDS,
  assessDatasetReadiness,
} from "../datasetReadiness.js";
import {
  ASSET_COUNT_DESCRIPTION,
  DEPRECATED_ITEM_COUNT_ON_DATASET,
  DEPRECATED_ITEM_COUNT_ON_HEALTH,
  FRAME_COUNT_DESCRIPTION,
  SEQUENCE_COUNT_DESCRIPTION,
  aliasDatasetCounts,
  aliasDatasetHealthCounts,
  aliasSequenceCounts,
  detailInputField,
  presentReadDetail,
  resolveReadDetail,
} from "../readDetail.js";
import { z } from "zod";

const datasetOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    slug: z.string(),
    isSequence: z.boolean().optional(),
    sequenceCount: z.number().optional().describe(SEQUENCE_COUNT_DESCRIPTION),
    assetCount: z.number().optional().describe(ASSET_COUNT_DESCRIPTION),
    itemCount: z.number().describe(DEPRECATED_ITEM_COUNT_ON_DATASET),
    dataType: z.string().nullable(),
    status: z.string().nullable().optional(),
    owner: z.unknown().optional(),
    ownerName: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();

const sequenceListOutputSchema = z
  .object({
    uid: z.string(),
    customUuid: z.string().nullable(),
    key: z.string().nullable(),
    status: z.string().nullable(),
    featuredImageAsset: assetReferenceSchema.nullable(),
    numberOfFrames: z.number().nullable(),
    frameCount: z.number().optional().describe(FRAME_COUNT_DESCRIPTION),
  })
  .passthrough();

const sequenceDetailOutputSchema = z
  .object({
    uid: z.string(),
    key: z.string().nullable(),
    status: z.string().nullable(),
    predefinedLabels: z.array(z.record(z.string(), z.unknown())).nullable(),
    frames: z.array(z.record(z.string(), z.unknown())).nullable(),
    metrics: z.record(z.string(), z.unknown()).nullable(),
    datasetUid: z.string().nullable(),
    deviceId: z.string().nullable().optional(),
    allowLidarCalibration: z.boolean().nullable(),
    lidarCalibrationEnabled: z.boolean().nullable(),
    cameraCalibrationEnabled: z.boolean().nullable(),
    cameraCalibration: z
      .array(z.record(z.string(), z.unknown()))
      .nullable()
      .optional(),
    cropData: z.record(z.string(), z.unknown()).nullable(),
    cocTimeline: z
      .array(z.record(z.string(), z.unknown()))
      .nullable()
      .optional(),
    isWorkflowTerminal: z.boolean().nullable().optional(),
    sequenceStatusWorkflow: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional(),
    sequenceDeliverableWorkflow: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional(),
  })
  .passthrough();

const sequenceHealthOutputSchema = z
  .object({
    uid: z.string(),
    key: z.string().nullable(),
    status: z.string().nullable(),
    frameCount: z.number().describe(FRAME_COUNT_DESCRIPTION),
    hasLidarCalibration: z.boolean(),
    hasCameraCalibration: z.boolean(),
  })
  .passthrough();

const datasetHealthOutputSchema = z
  .object({
    datasetUid: z.string(),
    datasetSlug: z.string(),
    datasetStatus: z.string().nullable(),
    frameCount: z.number().optional().describe(FRAME_COUNT_DESCRIPTION),
    assetCount: z.number().optional().describe(ASSET_COUNT_DESCRIPTION),
    itemCount: z.number().describe(DEPRECATED_ITEM_COUNT_ON_HEALTH),
    sequenceCount: z.number().describe(SEQUENCE_COUNT_DESCRIPTION),
    totalFrames: z.number().describe(FRAME_COUNT_DESCRIPTION),
    s3Prefix: z.string().nullable(),
    gcStoragePrefix: z.string().nullable(),
    lastUpdatedAt: z.string().nullable(),
    sequences: z.array(sequenceHealthOutputSchema),
    ingestOk: z.boolean(),
    issues: z.array(z.string()),
  })
  .passthrough();

const captureActorOutputSchema = z
  .object({
    uid: z.string(),
    username: z.string(),
  })
  .strip();

const includeAttributionInputField = z
  .boolean()
  .optional()
  .describe(
    "Include submitter, annotator, or reviewer identity. Defaults to false because attribution is personal data. Available only on single-record tools.",
  );

const captureConfigOutputSchema = z
  .object({
    captureKind: z.string().nullable(),
    captureTier: z.string().nullable(),
    camera: z.string().nullable(),
    durationS: z.number().int().nullable(),
    audio: z.boolean().nullable(),
    orientation: z.string().nullable(),
    clipsPerSession: z.number().int().nullable(),
    handGuardrail: z.boolean(),
    handGuardrailMinHands: z.number().int().nullable(),
    subject: z.string(),
    subjectByLocale: z.record(z.string(), z.string()),
    instructions: z.string(),
    instructionsByLocale: z.record(z.string(), z.string()),
  })
  .passthrough();

const captureTaskDescriptionOutputSchema = z
  .object({
    spec: z.string(),
    name: z.string(),
    config: captureConfigOutputSchema,
  })
  .passthrough();

const captureProgressOutputSchema = z
  .object({
    totalSlots: z.number().int().nonnegative(),
    notRecorded: z.number().int().nonnegative(),
    awaitingReview: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    recaptureRequested: z.number().int().nonnegative(),
  })
  .passthrough();

const captureCampaignOutputSchema = z
  .object({
    projectUid: z.string(),
    name: z.string(),
    status: z.string(),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
    config: captureConfigOutputSchema,
    progress: captureProgressOutputSchema,
    canManage: z.boolean(),
    taskDescriptions: z.array(
      captureTaskDescriptionOutputSchema.extend({
        progress: captureProgressOutputSchema,
      }),
    ),
  })
  .passthrough();

const captureCampaignsOutputSchema = z
  .object({
    campaigns: z.array(captureCampaignOutputSchema),
    progress: captureProgressOutputSchema,
  })
  .passthrough();

const captureSubmissionOutputSchema = z
  .object({
    resultUid: z.string(),
    itemUid: z.string().nullable(),
    status: z.string(),
    mediaWidth: z.number().int().nullable(),
    mediaHeight: z.number().int().nullable(),
    durationS: z.number().nullable(),
    audio: z.boolean().nullable(),
    playbackAsset: assetReferenceSchema.nullable(),
    thumbnailAsset: assetReferenceSchema.nullable(),
    submittedAt: z.string(),
    rejectReason: z.string().nullable(),
    rejectNote: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    episodeUid: z.string().nullable(),
    extractionStatus: z.string().nullable(),
    channels: z.array(z.string()).nullable(),
    acceptance: z
      .object({
        machineVerdict: z.string(),
        blockingReasons: z.array(z.string()),
        unmeasured: z.array(z.string()),
        evaluatedAt: z.string().nullable(),
      })
      .passthrough()
      .nullable(),
    campaign: z
      .object({
        uid: z.string(),
        name: z.string(),
        taskDescription: captureTaskDescriptionOutputSchema.nullable(),
      })
      .passthrough()
      .nullable(),
  })
  // The assetizer replaces provider-signed playback and thumbnail URLs with
  // opaque handles before this public schema validates the result. Strip any
  // future undeclared top-level fields before MCP content can leave the server.
  .strip();

const captureSubmissionDetailOutputSchema = captureSubmissionOutputSchema
  .extend({
    // Attribution is intentionally absent from the list item schema above.
    // A conditional JSON schema is not available here, so keep these fields
    // optional and enforce the explicit opt-in in the detail projector below.
    submitter: captureActorOutputSchema.optional(),
    reviewedBy: captureActorOutputSchema.nullable().optional(),
  })
  .strip();

const datasetPageOutputSchema = definePageOutputSchema(datasetOutputSchema);
const sequencePageOutputSchema = definePageOutputSchema(
  sequenceListOutputSchema,
);
const captureSubmissionPageOutputSchema = definePageOutputSchema(
  captureSubmissionOutputSchema,
);

const paginationInputSchema = {
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Maximum number of results to return. Defaults to 25 when omitted.",
    ),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor from a previous request"),
};

const datasetListFiltersSchema = {
  dataType: z
    .string()
    .optional()
    .describe(
      "Filter by data type: 'image', 'video', 'lidar', 'mcap', or 'splat'",
    ),
  name: z
    .string()
    .optional()
    .describe("Filter by name (case-insensitive substring match)"),
  status: z
    .string()
    .optional()
    .describe("Filter by status: 'creating' or 'created'"),
  visibility: z
    .string()
    .optional()
    .describe("Filter by visibility: 'private' or 'public'"),
};

const listDatasetsInputSchema = z.object({
  ...datasetListFiltersSchema,
  ...paginationInputSchema,
});

const datasetLocatorSchema = {
  owner: z
    .string()
    .describe("Dataset owner username, handle, or organization slug"),
  slug: z.string().describe("Dataset slug"),
};

const sequenceLocatorSchema = {
  ...datasetLocatorSchema,
  sequenceUid: z.string().describe("Sequence UUID"),
};

const listSequencesInputSchema = z.object({
  ...datasetLocatorSchema,
  ...paginationInputSchema,
});

const getDatasetInputSchema = z.object({
  uid: z.string().describe("The unique identifier (UUID) of the dataset"),
});

const listCaptureSubmissionsInputSchema = z.object({
  datasetUid: z.string().describe("Dataset UUID"),
  status: z
    .enum(["pending", "accepted", "rejected", "overlooked"])
    .optional()
    .describe(
      "Filter by result status: 'pending', 'accepted', 'rejected', or 'overlooked'",
    ),
  ...paginationInputSchema,
});

const getCaptureSubmissionInputSchema = z.object({
  resultUid: z.string().describe("Capture result UUID"),
  include_attribution: includeAttributionInputField,
});

const listCaptureCampaignsInputSchema = z.object({
  datasetUid: z.string().describe("Dataset UUID"),
});

const getSequenceInputSchema = z.object(sequenceLocatorSchema);
const getDatasetHealthInputSchema = z.object(datasetLocatorSchema);
const getDatasetReadinessInputSchema = z.object({
  ...datasetLocatorSchema,
  requiredCalibrations: z
    .array(z.enum(CALIBRATION_KINDS))
    .max(CALIBRATION_KINDS.length)
    .describe(
      "Stored calibration artifacts required by the selected reconstruction recipe. Use ['camera', 'lidar'] for a calibrated multisensor rebuild, ['camera'] for a camera-only calibrated rig, or [] only when the recipe estimates calibration from its input. Recipes requiring stored calibration also require sequence-shaped input; [] allows non-sequence media assets. Required because DatasetHealthView cannot distinguish an absent sensor from a present but uncalibrated sensor.",
    ),
});

const curationUnitSchema = z.enum(["dataset_item", "sequence"]);
const curationDimensionSchema = z.enum([
  "sequence_workflow",
  "deliverable",
  "result_status",
  "object_qc_status",
  "consensus",
]);
const deliverableStateFieldSchema = z.enum([
  "workflow_state",
  "approval_state",
  "approval_outcome",
]);
const compactUuidOutputSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/, "Expected a compact UUID");

const previewCurationCandidatesInputSchema = z.object({
  datasetUid: z.string().min(1).describe("Dataset UUID"),
  unit: curationUnitSchema.describe(
    "Select individual sensor frames/items or indivisible recording sequences",
  ),
  qcDimension: curationDimensionSchema.describe(
    "One explicit QC or workflow dimension used to classify every dataset unit",
  ),
  requiredState: z
    .string()
    .min(1)
    .max(50)
    .optional()
    .describe(
      "Required state for every dimension except consensus; the server validates workflow-local identifiers",
    ),
  minimumConsensus: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Required only for the consensus dimension"),
  projectUid: z
    .string()
    .min(1)
    .optional()
    .describe("Required for project-scoped result or consensus evidence"),
  taskName: z
    .string()
    .min(1)
    .max(50)
    .optional()
    .describe("Required for task-scoped result, object-QC, or consensus evidence"),
  deliverableId: z
    .string()
    .min(1)
    .max(50)
    .optional()
    .describe("Active workflow deliverable ID; valid only for deliverable QC"),
  deliverableStateField: deliverableStateFieldSchema
    .optional()
    .describe("Deliverable state field to compare against requiredState"),
  excludeSliceUid: z
    .string()
    .min(1)
    .optional()
    .describe("Completed Slice whose current membership must be excluded"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum candidates to return; defaults to 25"),
  cursor: z
    .string()
    .max(2048)
    .optional()
    .describe("Opaque cursor from the same dataset and curation criterion"),
});

const curationPreviewOutputSchema = z
  .object({
    datasetUid: compactUuidOutputSchema,
    unit: curationUnitSchema,
    criterion: z
      .object({
        dimension: curationDimensionSchema,
        requiredState: z.string().nullable(),
        minimumConsensus: z.number().min(0).max(1).nullable(),
        projectUid: compactUuidOutputSchema.nullable(),
        taskName: z.string().nullable(),
        deliverableId: z.string().nullable(),
        deliverableStateField: deliverableStateFieldSchema.nullable(),
        evidenceStatus: z.enum(["available", "insufficient_evidence"]),
      })
      .strip(),
    candidateUids: z.array(compactUuidOutputSchema).max(100),
    counts: z
      .object({
        selected: z.number().int().nonnegative(),
        excludedByMembership: z.number().int().nonnegative(),
        missingQcEvidence: z.number().int().nonnegative(),
        rejectedByThreshold: z.number().int().nonnegative(),
      })
      .strip(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    limitations: z.array(z.string()),
  })
  // This boundary is intentionally narrower than general dataset reads: a
  // curation preview must never grow implicit actor attribution or raw QC rows.
  .strip();

const DATASET_CONCISE_KEYS = [
  "uid",
  "name",
  "slug",
  "dataType",
  "isSequence",
  "sequenceCount",
  "assetCount",
  "itemCount",
  "status",
  "owner",
  "ownerName",
  "updatedAt",
] as const;

const SEQUENCE_LIST_CONCISE_KEYS = [
  "uid",
  "customUuid",
  "key",
  "status",
  "numberOfFrames",
  "frameCount",
] as const;

const SEQUENCE_DETAIL_CONCISE_KEYS = [
  "uid",
  "key",
  "status",
  "datasetUid",
  "deviceId",
] as const;

const DATASET_HEALTH_CONCISE_KEYS = [
  "datasetUid",
  "datasetSlug",
  "datasetStatus",
  "frameCount",
  "assetCount",
  "itemCount",
  "sequenceCount",
  "totalFrames",
  "ingestOk",
  "issues",
  "lastUpdatedAt",
] as const;

const CAPTURE_SUBMISSION_CONCISE_KEYS = [
  "resultUid",
  "itemUid",
  "status",
  "submittedAt",
  "rejectReason",
] as const;

function assetizeDatasetRecord(
  value: unknown,
  handles: AssetHandleService,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const uid = (value as Record<string, unknown>).uid;
  if (typeof uid !== "string") return value;
  const record = value as Record<string, unknown>;
  const { featuredItemsUrl, ...withoutFeaturedItems } = record;
  const featuredFields = Array.isArray(featuredItemsUrl)
    ? {
        featuredItemsAsset: featuredItemsUrl.map((url) => {
          const asset = assetReferenceFor(
            url,
            {
              kind: "dataset_featured_asset",
              uid,
              identity: assetIdentityForUrl(url),
            },
            handles,
          );
          if (!asset)
            throw new Error("Dataset featured asset is unavailable.");
          return asset;
        }),
      }
    : Object.prototype.hasOwnProperty.call(record, "featuredItemsUrl")
      ? { featuredItemsUrl }
      : {};
  return assetizeCredentialUrls(
    { ...withoutFeaturedItems, ...featuredFields },
    (path, url) => ({
      kind: "dataset_asset",
      uid,
      identity: assetIdentityForUrl(url),
      path: [...path],
    }),
    handles,
  );
}

function assetizeDatasets(
  value: unknown,
  _args: Readonly<Record<string, unknown>>,
  handles: AssetHandleService,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.items)
    ? {
        ...record,
        items: record.items.map((item) => assetizeDatasetRecord(item, handles)),
      }
    : assetizeDatasetRecord(record, handles);
}

function assetizeSequenceRecord(
  value: unknown,
  owner: string,
  slug: string,
  handles: AssetHandleService,
  page?: { limit: number; cursor?: string },
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.uid !== "string") return value;
  const sequenceUid = record.uid;
  const { featuredImage, frames, ...withoutFeaturedImageAndFrames } = record;
  const assetizedFrames = Array.isArray(frames)
    ? frames.map((frame) => {
        const frameUid = frameUidForValue(frame);
        return assetizeCredentialUrls(
          frame,
          (path, url) => {
            if (!frameUid) {
              throw new Error(
                "Frame identity is unavailable for asset handles.",
              );
            }
            return {
              kind: "sequence_frame_asset",
              owner,
              slug,
              sequenceUid,
              frameUid,
              identity: assetIdentityForUrl(url),
              path: [...path],
            };
          },
          handles,
        );
      })
    : frames;
  const frameFields = Object.prototype.hasOwnProperty.call(record, "frames")
    ? { frames: assetizedFrames }
    : {};
  return assetizeCredentialUrls(
    {
      ...withoutFeaturedImageAndFrames,
      ...frameFields,
      featuredImageAsset: identityBoundAssetReferenceFor(
        featuredImage,
        (identity) => ({
          ...(page === undefined
            ? {
                kind: "sequence_asset" as const,
                owner,
                slug,
                sequenceUid,
                identity,
                path: ["featuredImage"],
              }
            : {
                kind: "sequence_featured_asset" as const,
                owner,
                slug,
                sequenceUid,
                limit: page.limit,
                identity,
                ...(page.cursor === undefined
                  ? {}
                  : { cursor: page.cursor }),
              }),
        }),
        handles,
      ),
    },
    (path, url) => ({
      kind: "sequence_asset",
      owner,
      slug,
      sequenceUid,
      identity: assetIdentityForUrl(url),
      path: [...path],
    }),
    handles,
  );
}

function assetizeSequences(
  value: unknown,
  args: Readonly<Record<string, unknown>>,
  handles: AssetHandleService,
): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof args.owner !== "string" ||
    typeof args.slug !== "string"
  ) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items)) {
    return assetizeSequenceRecord(record, args.owner, args.slug, handles);
  }
  if (typeof args.limit !== "number") {
    throw new Error("Sequence page limit is unavailable for asset handles.");
  }
  const page = {
    limit: args.limit,
    ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
  };
  return {
    ...record,
    items: record.items.map((item) =>
      assetizeSequenceRecord(
        item,
        args.owner as string,
        args.slug as string,
        handles,
        page,
      ),
    ),
  };
}

function assetizeCaptureSubmission(
  value: unknown,
  handles: AssetHandleService,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const { playbackUrl, thumbnailUrl, ...rest } = record;
  if (typeof record.resultUid !== "string") return rest;
  const resultUid = record.resultUid;
  return {
    ...rest,
    playbackAsset: identityBoundAssetReferenceFor(
      playbackUrl,
      (identity) => ({
        kind: "capture_asset",
        resultUid,
        identity,
        path: ["playbackUrl"],
      }),
      handles,
    ),
    thumbnailAsset: identityBoundAssetReferenceFor(
      thumbnailUrl,
      (identity) => ({
        kind: "capture_asset",
        resultUid,
        identity,
        path: ["thumbnailUrl"],
      }),
      handles,
    ),
  };
}

function assetizeCaptureSubmissions(
  value: unknown,
  _args: Readonly<Record<string, unknown>>,
  handles: AssetHandleService,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.items)
    ? {
        ...record,
        items: record.items.map((item) =>
          assetizeCaptureSubmission(item, handles),
        ),
      }
    : assetizeCaptureSubmission(record, handles);
}

function omitCaptureAttribution(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const {
    submitter: _submitter,
    reviewedBy: _reviewedBy,
    ...withoutAttribution
  } = value as Record<string, unknown>;
  return withoutAttribution;
}

function projectCaptureSubmissionDetail(
  value: unknown,
  detail: "concise" | "full",
  args: Readonly<Record<string, unknown>>,
): unknown {
  const projected = presentReadDetail(
    value,
    { detail },
    CAPTURE_SUBMISSION_CONCISE_KEYS,
  );
  if (args.include_attribution !== true) {
    return omitCaptureAttribution(projected);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof projected !== "object" ||
    projected === null ||
    Array.isArray(projected)
  ) {
    return projected;
  }

  const source = value as Record<string, unknown>;
  const withAttribution = { ...(projected as Record<string, unknown>) };
  if (Object.prototype.hasOwnProperty.call(source, "submitter")) {
    withAttribution.submitter = source.submitter;
  }
  if (Object.prototype.hasOwnProperty.call(source, "reviewedBy")) {
    withAttribution.reviewedBy = source.reviewedBy;
  }
  return withAttribution;
}

const EXPORT_SNIPPET_KEYS = new Set([
  "exportsnippet",
  "exportsnippetinternal",
]);
// Django's reserved `_annotator` / `_reviewer` keys become `Annotator` /
// `Reviewer` after the SDK's deep snake-to-camel conversion. Match those
// exact metadata keys at nested levels so an annotation's own `data.annotator`
// field is preserved.
const NESTED_EXPORT_ATTRIBUTION_KEYS = new Set([
  "_annotator",
  "_reviewer",
  "_reviewed_by",
  "Annotator",
  "Reviewer",
  "ReviewedBy",
]);
const ROOT_EXPORT_ATTRIBUTION_KEYS = new Set([
  "annotator",
  "annotatoremail",
  "reviewer",
  "revieweremail",
  "reviewedby",
  "submitter",
]);

function normalizeAttributionKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stripExportSnippetAttribution(
  value: unknown,
  isSnippetRoot = true,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripExportSnippetAttribution(item, false));
  }
  if (typeof value !== "object" || value === null) return value;

  const withoutAttribution: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const normalizedKey = normalizeAttributionKey(key);
    if (
      NESTED_EXPORT_ATTRIBUTION_KEYS.has(key) ||
      (isSnippetRoot &&
        (ROOT_EXPORT_ATTRIBUTION_KEYS.has(normalizedKey) ||
          normalizedKey === "username"))
    ) {
      continue;
    }
    // `data` is arbitrary customer-authored annotation JSON. Never interpret
    // keys inside it as Avala metadata, even if a label happens to be named
    // `Annotator` or `Reviewer`.
    withoutAttribution[key] =
      normalizedKey === "data"
        ? child
        : stripExportSnippetAttribution(child, false);
  }
  return withoutAttribution;
}

function omitFrameAttribution(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitFrameAttribution);
  if (typeof value !== "object" || value === null) return value;

  const withoutAttribution: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    withoutAttribution[key] = EXPORT_SNIPPET_KEYS.has(
      normalizeAttributionKey(key),
    )
      ? stripExportSnippetAttribution(child)
      : omitFrameAttribution(child);
  }
  return withoutAttribution;
}

function projectSequenceDetail(
  value: unknown,
  detail: "concise" | "full",
): unknown {
  const projected = presentReadDetail(
    value,
    { detail },
    SEQUENCE_DETAIL_CONCISE_KEYS,
  );
  // `frames` is a list shape even though the enclosing sequence is one record.
  // Keep export-snippet attribution out of it under every detail level.
  return omitFrameAttribution(projected);
}

function projectCaptureCampaigns(
  value: unknown,
  detail: "concise" | "full",
): unknown {
  if (detail === "full" || typeof value !== "object" || value === null) {
    return value;
  }
  const record = value as {
    campaigns?: Record<string, unknown>[];
    progress?: unknown;
  };
  return {
    campaigns: (record.campaigns ?? []).map((campaign) => ({
      projectUid: campaign.projectUid,
      name: campaign.name,
      status: campaign.status,
      progress: campaign.progress,
    })),
    progress: record.progress,
  };
}

const listDatasetsTool = defineReadCatalogTool({
  name: "list_datasets",
  title: "List datasets",
  description:
    "List datasets in your workspace. Default detail is concise (uid, name, slug, dataType, unit-bearing counts, status, owner, updatedAt). Labels, nested projects, and opaque handles for credential-bearing media require detail=full. Supports server-side filters: data type, name, status, visibility.",
  inputSchema: listDatasetsInputSchema,
  outputSchema: datasetPageOutputSchema,
  assetize: assetizeDatasets,
  normalize: aliasDatasetCounts,
  conciseKeys: DATASET_CONCISE_KEYS,
  route: {
    name: "dataset-list",
    method: "GET",
    path: "/datasets/",
    query: {
      dataType: "data_type",
      name: "name",
      status: "status",
      visibility: "visibility",
      limit: "limit",
      cursor: "cursor",
    },
    response: "page",
    scope: "datasets.read",
    toolset: "datasets",
  },
});

const getDatasetTool = defineReadCatalogTool({
  name: "get_dataset",
  title: "Get dataset",
  description:
    "Get a dataset. Default detail is concise (identity, unit-bearing counts, status, owner, updatedAt). Use detail=full for labels, nested projects, and media.",
  inputSchema: getDatasetInputSchema,
  outputSchema: datasetOutputSchema,
  assetize: assetizeDatasets,
  normalize: aliasDatasetCounts,
  conciseKeys: DATASET_CONCISE_KEYS,
  route: {
    name: "dataset-detail",
    method: "GET",
    path: "/datasets/{uid}/",
    response: "single",
    scope: "datasets.read",
    toolset: "datasets",
  },
});

const listSequencesTool = defineReadCatalogTool({
  name: "list_sequences",
  title: "List dataset sequences",
  description:
    "List sequences for a dataset (paginated). Each sequence includes uid, key, status, and frame count. Opaque featured-image handles require detail=full.",
  inputSchema: listSequencesInputSchema,
  outputSchema: sequencePageOutputSchema,
  assetize: assetizeSequences,
  normalize: aliasSequenceCounts,
  conciseKeys: SEQUENCE_LIST_CONCISE_KEYS,
  route: {
    name: "dataset-sequence-item-list-by-owner-and-dataset-name",
    method: "GET",
    path: "/datasets/{owner}/{slug}/sequences/",
    query: { limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "datasets.read",
    toolset: "sequences",
  },
});

const getSequenceTool = defineReadCatalogTool({
  name: "get_sequence",
  title: "Get dataset sequence",
  description:
    "Get a dataset sequence. Default detail is identity and status. Use detail=full for the frames array (LiDAR JSON metadata for every frame), opaque media handles, and predefined labels. Export-snippet attribution is never returned in the frame list; use get_frame with detail=full and include_attribution=true for one frame when identity is required.",
  inputSchema: getSequenceInputSchema,
  outputSchema: sequenceDetailOutputSchema,
  assetize: assetizeSequences,
  project: projectSequenceDetail,
  route: {
    name: "dataset-sequence-item-detail-by-owner-and-dataset-name",
    method: "GET",
    path: "/datasets/{owner}/{slug}/sequences/{sequenceUid}/",
    response: "single",
    scope: "datasets.read",
    toolset: "sequences",
  },
});

const DATASET_HEALTH_ROUTE = {
  name: "dataset-health-by-owner-and-name",
  method: "GET" as const,
  path: "/datasets/{owner}/{slug}/health/",
  response: "single" as const,
  scope: "datasets.read" as const,
  toolset: "datasets" as const,
};

const getDatasetHealthTool = defineReadCatalogTool({
  name: "get_dataset_health",
  title: "Get dataset health",
  description:
    "Get a read-only ingest/health snapshot for a dataset: live frame totals for sequence data or asset counts for non-sequence media, sequence count, ingest_ok flag, and any issues detected. Default detail omits the per-sequence array. Useful for validating a dataset after upload without opening Mission Control. For the reconstruction question ('is this ready to rebuild?') use get_dataset_readiness — ingestOk does not see missing calibration.",
  inputSchema: getDatasetHealthInputSchema,
  outputSchema: datasetHealthOutputSchema,
  normalize: aliasDatasetHealthCounts,
  conciseKeys: DATASET_HEALTH_CONCISE_KEYS,
  route: DATASET_HEALTH_ROUTE,
});

const previewCurationCandidatesTool = defineReadCatalogTool({
  name: "preview_curation_candidates",
  title: "Preview dataset curation candidates",
  description:
    "Preview a bounded, read-only set of Physical AI training candidates under one explicit workflow or QC criterion. Returns disjoint selected, excluded-membership, missing-evidence, and rejected counts plus opaque pagination. It never creates a Slice, recomputes QC, or changes workflow state. datasets.read is always required; the provider conditionally enforces projects.read, tasks.read, qc.read, and slices.read for criteria that use those resources. Consensus currently fails closed as insufficient evidence until scores carry immutable run provenance.",
  inputSchema: previewCurationCandidatesInputSchema,
  outputSchema: curationPreviewOutputSchema,
  supportsDetail: false,
  route: {
    name: "dataset-curation-preview",
    method: "GET",
    path: "/datasets/{datasetUid}/curation-preview/",
    query: {
      unit: "unit",
      qcDimension: "qc_dimension",
      requiredState: "required_state",
      minimumConsensus: "minimum_consensus",
      projectUid: "project_uid",
      taskName: "task_name",
      deliverableId: "deliverable_id",
      deliverableStateField: "deliverable_state_field",
      excludeSliceUid: "exclude_slice_uid",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "datasets.read",
    toolset: "datasets",
  },
});

const readinessCheckOutputSchema = z
  .object({
    key: z.string(),
    status: z.enum([
      "pass",
      "fail",
      "insufficient_evidence",
      "skipped",
    ]),
    severity: z.enum(["blocking"]).nullable(),
    reason: z.string(),
    remediation: z.string().nullable(),
    evidence: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const datasetReadinessOutputSchema = z
  .object({
    datasetUid: z.string().nullable(),
    datasetSlug: z.string().nullable(),
    datasetStatus: z.string().nullable(),
    purpose: z.literal("reconstruction"),
    sequenceCount: z.number().nullable(),
    frameCount: z.number().nullable(),
    assetCount: z.number().nullable(),
    requiredCalibrations: z.array(z.enum(CALIBRATION_KINDS)),
    summary: z.string(),
    checks: z.array(readinessCheckOutputSchema),
    blockingReasons: z.array(z.string()),
    unmeasured: z.array(z.string()),
  })
  .passthrough();

const getDatasetReadinessTool = defineCompositeReadCatalogTool({
  name: "get_dataset_readiness",
  title: "Get dataset reconstruction readiness",
  description:
    "Check whether a dataset can enter a selected photoreal-reconstruction recipe. The caller must declare that recipe's required calibration artifacts because the health endpoint cannot distinguish an absent sensor from an uncalibrated one. Required stored calibration also requires sequence-shaped input; recipes with no stored calibration requirement may use non-sequence media assets. Required missing artifacts are blocking; non-required calibration checks are skipped. Results use named pass/fail/insufficient_evidence/skipped checks — never a ready boolean or opaque score. Reads the customer-reachable DatasetHealthView route. Default detail keeps counts; missing sequence UIDs and ingest issue strings require detail=full.",
  inputSchema: getDatasetReadinessInputSchema,
  outputSchema: datasetReadinessOutputSchema,
  routes: [DATASET_HEALTH_ROUTE],
  execute: async (args, read) => {
    const health = aliasDatasetHealthCounts(
      await read(DATASET_HEALTH_ROUTE.name),
    );
    return assessDatasetReadiness(
      health,
      args.requiredCalibrations,
      resolveReadDetail(args),
    );
  },
});

const listCaptureSubmissionsTool = defineReadCatalogTool({
  name: "list_capture_submissions",
  title: "List capture submissions",
  description:
    "List a dataset's Physical AI capture submissions. Default detail is result identity and review status. Use detail=full for opaque playback/thumbnail handles, media metadata, machine acceptance, and campaign task context. Submitter and reviewer identity are never returned by this list tool.",
  inputSchema: listCaptureSubmissionsInputSchema,
  outputSchema: captureSubmissionPageOutputSchema,
  assetize: assetizeCaptureSubmissions,
  conciseKeys: CAPTURE_SUBMISSION_CONCISE_KEYS,
  route: {
    name: "dataset-capture-submissions",
    method: "GET",
    path: "/datasets/{datasetUid}/capture-submissions/",
    query: { status: "status", limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "datasets.read",
    toolset: "datasets",
  },
});

const getCaptureSubmissionTool = defineReadCatalogTool({
  name: "get_capture_submission",
  title: "Get capture submission",
  description:
    "Get one Physical AI capture submission by result ID. Default detail is identity and review status. Use detail=full for opaque playback/thumbnail handles, media metadata, reviewer decision, machine acceptance, and campaign task context. Submitter and reviewer identity require include_attribution=true because attribution is personal data.",
  inputSchema: getCaptureSubmissionInputSchema,
  outputSchema: captureSubmissionDetailOutputSchema,
  assetize: assetizeCaptureSubmissions,
  project: projectCaptureSubmissionDetail,
  route: {
    name: "capture-submission-detail",
    method: "GET",
    path: "/results/{resultUid}/capture-submission/",
    response: "single",
    scope: "datasets.read",
    toolset: "datasets",
  },
});

const listCaptureCampaignsTool = defineReadCatalogTool({
  name: "list_capture_campaigns",
  title: "List capture campaigns",
  description:
    "List every Physical AI capture campaign feeding a dataset. Default detail keeps campaign identity and progress roll-up. Use detail=full for capture config and per-task-description instructions. Upstream returns the full campaign set in one payload — it has no cursor; we do not emulate pagination client-side.",
  inputSchema: listCaptureCampaignsInputSchema,
  outputSchema: captureCampaignsOutputSchema,
  project: projectCaptureCampaigns,
  route: {
    name: "dataset-capture-campaigns",
    method: "GET",
    path: "/datasets/{datasetUid}/capture-campaigns/",
    response: "single",
    scope: "datasets.read",
    toolset: "datasets",
  },
});

export const DATASET_READ_CATALOG_TOOLS = [
  listDatasetsTool,
  getDatasetTool,
  listSequencesTool,
  getSequenceTool,
  getDatasetHealthTool,
  previewCurationCandidatesTool,
  listCaptureSubmissionsTool,
  getCaptureSubmissionTool,
  listCaptureCampaignsTool,
] as const;

export const DATASET_COMPOSITE_READ_CATALOG_TOOLS = [
  getDatasetReadinessTool,
] as const;

const FRAME_CONCISE_KEYS = ["frameIndex", "model", "key"] as const;
const CALIBRATION_CONCISE_KEYS = ["sequenceUid"] as const;

export function registerDatasetTools(
  server: McpServer,
  getClient: GetClient,
  allowMutations = false,
  assetHandles: AssetHandleService = createAssetHandleService(),
): void {
  registerReadCatalogTool(server, getClient, listDatasetsTool, assetHandles);
  registerReadCatalogTool(server, getClient, getDatasetTool, assetHandles);
  registerReadCatalogTool(server, getClient, listSequencesTool, assetHandles);
  registerReadCatalogTool(server, getClient, getSequenceTool, assetHandles);
  registerReadCatalogTool(
    server,
    getClient,
    previewCurationCandidatesTool,
    assetHandles,
  );

  server.registerTool(
    "get_frame",
    {
      description:
        "Get a single frame's LiDAR JSON metadata (camera model, intrinsics, device pose, per-camera rig). Default detail is frameIndex, model, and key. Use detail=full for the complete rig payload and opaque media handles; within that payload, annotator and reviewer identity nested in export snippets is omitted unless include_attribution=true because attribution is personal data. Intended for post-ingest validation — diff what you uploaded against what the server sees.",
      inputSchema: z.object({
        owner: z
          .string()
          .describe("Dataset owner username, handle, or organization slug"),
        slug: z.string().describe("Dataset slug"),
        sequenceUid: z.string().describe("Sequence UUID"),
        frameIdx: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based frame index within the sequence"),
        include_attribution: includeAttributionInputField,
        detail: detailInputField,
      }),
      _meta: {
        "avala.ai/required-scope": "datasets.read",
        "avala.ai/toolset": "sequences",
      },
    },
    async ({
      owner,
      slug,
      sequenceUid,
      frameIdx,
      include_attribution,
      detail,
    }) => {
      const avala = getClient("get_frame");
      const frame = await avala.datasets.getFrame(
        owner,
        slug,
        sequenceUid,
        frameIdx,
      );
      const detailed = presentReadDetail(
        frame,
        { detail: resolveReadDetail({ detail }) },
        FRAME_CONCISE_KEYS,
      );
      const attributed =
        include_attribution === true
          ? detailed
          : omitFrameAttribution(detailed);
      const frameUid = frameUidForValue(frame);
      const presented = assetizeCredentialUrls(
        attributed,
        (path, url) => {
          if (!frameUid) {
            throw new Error("Frame identity is unavailable for asset handles.");
          }
          return {
            kind: "frame_asset",
            owner,
            slug,
            sequenceUid,
            frameUid,
            identity: assetIdentityForUrl(url),
            path: [...path],
          };
        },
        assetHandles,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(presented, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_calibration",
    {
      description:
        "Get a sequence's canonicalized per-camera rig (position, heading, intrinsics, projection model) derived from frame[0]. Default detail is sequenceUid. Use detail=full for the camera array.",
      inputSchema: z.object({
        owner: z
          .string()
          .describe("Dataset owner username, handle, or organization slug"),
        slug: z.string().describe("Dataset slug"),
        sequenceUid: z.string().describe("Sequence UUID"),
        detail: detailInputField,
      }),
      _meta: {
        "avala.ai/required-scope": "datasets.read",
        "avala.ai/toolset": "sequences",
      },
    },
    async ({ owner, slug, sequenceUid, detail }) => {
      const avala = getClient("get_calibration");
      const calibration = await avala.datasets.getCalibration(
        owner,
        slug,
        sequenceUid,
      );
      const presented = presentReadDetail(
        calibration,
        { detail: resolveReadDetail({ detail }) },
        CALIBRATION_CONCISE_KEYS,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(presented, null, 2),
          },
        ],
      };
    },
  );

  registerReadCatalogTool(server, getClient, getDatasetHealthTool, assetHandles);
  registerCompositeReadCatalogTool(
    server,
    getClient,
    getDatasetReadinessTool,
    assetHandles,
  );
  registerReadCatalogTool(
    server,
    getClient,
    listCaptureSubmissionsTool,
    assetHandles,
  );
  registerReadCatalogTool(
    server,
    getClient,
    getCaptureSubmissionTool,
    assetHandles,
  );
  registerReadCatalogTool(
    server,
    getClient,
    listCaptureCampaignsTool,
    assetHandles,
  );

  if (allowMutations) {
    server.registerTool(
      "create_dataset",
      {
        description:
          "Create a new dataset for annotation. Supports image, video, lidar, and mcap data types.",
        inputSchema: z.object({
          name: z.string().describe("Display name for the dataset"),
          slug: z.string().describe("URL-friendly identifier for the dataset"),
          dataType: z
            .string()
            .describe("Type of data: 'image', 'video', 'lidar', or 'mcap'"),
          visibility: z
            .string()
            .optional()
            .describe(
              "Dataset visibility: 'private' or 'public' (default: 'private')",
            ),
          createMetadata: z
            .boolean()
            .optional()
            .describe("Whether to create dataset metadata (default: true)"),
          providerConfig: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "Cloud storage provider configuration (S3 bucket, region, prefix, credentials)",
            ),
          ownerName: z
            .string()
            .optional()
            .describe("Dataset owner username or email"),
        }),
      },
      async ({
        name,
        slug,
        dataType,
        visibility,
        createMetadata,
        providerConfig,
        ownerName,
      }) => {
        const avala = getClient("create_dataset");
        const dataset = await avala.datasets.create({
          name,
          slug,
          dataType,
          visibility,
          createMetadata,
          providerConfig,
          ownerName,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(dataset, null, 2),
            },
          ],
        };
      },
    );
  }
}
