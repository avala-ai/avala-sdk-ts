import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  definePageOutputSchema,
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
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
    featuredImage: z.string().nullable(),
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
  .passthrough();

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
    submitter: captureActorOutputSchema,
    submittedAt: z.string(),
    rejectReason: z.string().nullable(),
    rejectNote: z.string().nullable(),
    reviewedBy: captureActorOutputSchema.nullable(),
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
  // The REST serializer also returns provider-signed playback and thumbnail URLs.
  // Strip those bearer capabilities (and any future undeclared top-level fields)
  // before MCP content can enter model-provider logs or conversation transcripts.
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
});

const listCaptureCampaignsInputSchema = z.object({
  datasetUid: z.string().describe("Dataset UUID"),
});

const getSequenceInputSchema = z.object(sequenceLocatorSchema);
const getDatasetHealthInputSchema = z.object(datasetLocatorSchema);

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
    "List datasets in your workspace. Default detail is concise (uid, name, slug, dataType, unit-bearing counts, status, owner, updatedAt). Labels, nested projects, and media URLs require detail=full. Supports server-side filters: data type, name, status, visibility.",
  inputSchema: listDatasetsInputSchema,
  outputSchema: datasetPageOutputSchema,
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
    "List sequences for a dataset (paginated). Each sequence includes uid, key, status, and frame count. Featured images require detail=full.",
  inputSchema: listSequencesInputSchema,
  outputSchema: sequencePageOutputSchema,
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
    "Get a dataset sequence. Default detail is identity and status. Use detail=full for the frames array (LiDAR JSON metadata for every frame) and predefined labels.",
  inputSchema: getSequenceInputSchema,
  outputSchema: sequenceDetailOutputSchema,
  conciseKeys: SEQUENCE_DETAIL_CONCISE_KEYS,
  route: {
    name: "dataset-sequence-item-detail-by-owner-and-dataset-name",
    method: "GET",
    path: "/datasets/{owner}/{slug}/sequences/{sequenceUid}/",
    response: "single",
    scope: "datasets.read",
    toolset: "sequences",
  },
});

const getDatasetHealthTool = defineReadCatalogTool({
  name: "get_dataset_health",
  title: "Get dataset health",
  description:
    "Get a read-only ingest/health snapshot for a dataset: frame totals, sequence count, ingest_ok flag, and any issues detected. Default detail omits the per-sequence array. Useful for validating a dataset after upload without opening Mission Control.",
  inputSchema: getDatasetHealthInputSchema,
  outputSchema: datasetHealthOutputSchema,
  normalize: aliasDatasetHealthCounts,
  conciseKeys: DATASET_HEALTH_CONCISE_KEYS,
  route: {
    name: "dataset-health-by-owner-and-name",
    method: "GET",
    path: "/datasets/{owner}/{slug}/health/",
    response: "single",
    scope: "datasets.read",
    toolset: "datasets",
  },
});

const listCaptureSubmissionsTool = defineReadCatalogTool({
  name: "list_capture_submissions",
  title: "List capture submissions",
  description:
    "List a dataset's Physical AI capture submissions. Default detail is result identity and review status. Use detail=full for media metadata, machine acceptance, and campaign task context.",
  inputSchema: listCaptureSubmissionsInputSchema,
  outputSchema: captureSubmissionPageOutputSchema,
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
    "Get one Physical AI capture submission by result ID. Default detail is identity and review status. Use detail=full for media metadata, reviewer decision, machine acceptance, and campaign task context.",
  inputSchema: getCaptureSubmissionInputSchema,
  outputSchema: captureSubmissionOutputSchema,
  conciseKeys: CAPTURE_SUBMISSION_CONCISE_KEYS,
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
  listCaptureSubmissionsTool,
  getCaptureSubmissionTool,
  listCaptureCampaignsTool,
] as const;

const FRAME_CONCISE_KEYS = ["frameIndex", "model", "key"] as const;
const CALIBRATION_CONCISE_KEYS = ["sequenceUid"] as const;

export function registerDatasetTools(
  server: McpServer,
  getClient: GetClient,
  allowMutations = false,
): void {
  registerReadCatalogTool(server, getClient, listDatasetsTool);
  registerReadCatalogTool(server, getClient, getDatasetTool);
  registerReadCatalogTool(server, getClient, listSequencesTool);
  registerReadCatalogTool(server, getClient, getSequenceTool);

  server.registerTool(
    "get_frame",
    {
      description:
        "Get a single frame's LiDAR JSON metadata (camera model, intrinsics, device pose, per-camera rig). Default detail is frameIndex, model, and key. Use detail=full for the complete rig payload. Intended for post-ingest validation — diff what you uploaded against what the server sees.",
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
        detail: detailInputField,
      }),
      _meta: {
        "avala.ai/required-scope": "datasets.read",
        "avala.ai/toolset": "sequences",
      },
    },
    async ({ owner, slug, sequenceUid, frameIdx, detail }) => {
      const avala = getClient("get_frame");
      const frame = await avala.datasets.getFrame(
        owner,
        slug,
        sequenceUid,
        frameIdx,
      );
      const presented = presentReadDetail(
        frame,
        { detail: resolveReadDetail({ detail }) },
        FRAME_CONCISE_KEYS,
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

  registerReadCatalogTool(server, getClient, getDatasetHealthTool);
  registerReadCatalogTool(server, getClient, listCaptureSubmissionsTool);
  registerReadCatalogTool(server, getClient, getCaptureSubmissionTool);
  registerReadCatalogTool(server, getClient, listCaptureCampaignsTool);

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
