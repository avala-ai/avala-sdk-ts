import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  definePageOutputSchema,
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import { z } from "zod";

const datasetOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    slug: z.string(),
    itemCount: z.number(),
    dataType: z.string().nullable(),
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
    frameCount: z.number(),
    hasLidarCalibration: z.boolean(),
    hasCameraCalibration: z.boolean(),
  })
  .passthrough();

const datasetHealthOutputSchema = z
  .object({
    datasetUid: z.string(),
    datasetSlug: z.string(),
    datasetStatus: z.string().nullable(),
    itemCount: z.number(),
    sequenceCount: z.number(),
    totalFrames: z.number(),
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
    .describe("Maximum number of results to return"),
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

const listDatasetsTool = defineReadCatalogTool({
  name: "list_datasets",
  title: "List datasets",
  description:
    "List all datasets in your workspace with their IDs, names, and asset counts. Supports filtering by data type, name, status, and visibility.",
  inputSchema: listDatasetsInputSchema,
  outputSchema: datasetPageOutputSchema,
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
    "Get detailed information about a specific dataset including its data type and item count.",
  inputSchema: getDatasetInputSchema,
  outputSchema: datasetOutputSchema,
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
    "List sequences for a dataset (paginated). Each sequence includes uid, key, status, and frame count.",
  inputSchema: listSequencesInputSchema,
  outputSchema: sequencePageOutputSchema,
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
    "Get a dataset sequence including its frames array (LiDAR JSON metadata for every frame).",
  inputSchema: getSequenceInputSchema,
  outputSchema: sequenceDetailOutputSchema,
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
    "Get a read-only ingest/health snapshot for a dataset: frame totals, per-sequence counts, S3 prefix, ingest_ok flag, and any issues detected. Useful for validating a dataset after upload without opening Mission Control.",
  inputSchema: getDatasetHealthInputSchema,
  outputSchema: datasetHealthOutputSchema,
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
    "List a dataset's Physical AI capture submissions with media metadata, human review state, machine acceptance summary, and campaign task context.",
  inputSchema: listCaptureSubmissionsInputSchema,
  outputSchema: captureSubmissionPageOutputSchema,
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
    "Get one Physical AI capture submission by result ID, including media metadata, reviewer decision, machine acceptance summary, and campaign task context.",
  inputSchema: getCaptureSubmissionInputSchema,
  outputSchema: captureSubmissionOutputSchema,
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
    "List every Physical AI capture campaign feeding a dataset, including each task description's capture config and progress plus the dataset-level progress roll-up.",
  inputSchema: listCaptureCampaignsInputSchema,
  outputSchema: captureCampaignsOutputSchema,
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
        "Get a single frame's LiDAR JSON metadata (camera model, intrinsics, device pose, per-camera rig). Intended for post-ingest validation — diff what you uploaded against what the server sees.",
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
      }),
      _meta: {
        "avala.ai/required-scope": "datasets.read",
        "avala.ai/toolset": "sequences",
      },
    },
    async ({ owner, slug, sequenceUid, frameIdx }) => {
      const avala = getClient("get_frame");
      const frame = await avala.datasets.getFrame(
        owner,
        slug,
        sequenceUid,
        frameIdx,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(frame, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_calibration",
    {
      description:
        "Get a sequence's canonicalized per-camera rig (position, heading, intrinsics, projection model) derived from frame[0].",
      inputSchema: z.object({
        owner: z
          .string()
          .describe("Dataset owner username, handle, or organization slug"),
        slug: z.string().describe("Dataset slug"),
        sequenceUid: z.string().describe("Sequence UUID"),
      }),
      _meta: {
        "avala.ai/required-scope": "datasets.read",
        "avala.ai/toolset": "sequences",
      },
    },
    async ({ owner, slug, sequenceUid }) => {
      const avala = getClient("get_calibration");
      const calibration = await avala.datasets.getCalibration(
        owner,
        slug,
        sequenceUid,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(calibration, null, 2),
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
