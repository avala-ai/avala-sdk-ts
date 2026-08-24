import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "../client.js";
import { definePageOutputSchema, defineReadCatalogTool, registerReadCatalogTool } from "../catalog.js";
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
    predefinedLabels: z.array(z.record(z.unknown())).nullable(),
    frames: z.array(z.record(z.unknown())).nullable(),
    metrics: z.record(z.unknown()).nullable(),
    datasetUid: z.string().nullable(),
    deviceId: z.string().nullable().optional(),
    allowLidarCalibration: z.boolean().nullable(),
    lidarCalibrationEnabled: z.boolean().nullable(),
    cameraCalibrationEnabled: z.boolean().nullable(),
    cameraCalibration: z.array(z.record(z.unknown())).nullable().optional(),
    cropData: z.record(z.unknown()).nullable(),
    cocTimeline: z.array(z.record(z.unknown())).nullable().optional(),
    isWorkflowTerminal: z.boolean().nullable().optional(),
    sequenceStatusWorkflow: z.record(z.unknown()).nullable().optional(),
    sequenceDeliverableWorkflow: z.record(z.unknown()).nullable().optional(),
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

const datasetPageOutputSchema = definePageOutputSchema(datasetOutputSchema);
const sequencePageOutputSchema = definePageOutputSchema(sequenceListOutputSchema);

const paginationInputSchema = {
  limit: z.number().int().positive().optional().describe("Maximum number of results to return"),
  cursor: z.string().optional().describe("Pagination cursor from a previous request"),
};

const datasetListFiltersSchema = {
  dataType: z.string().optional().describe("Filter by data type: 'image', 'video', 'lidar', 'mcap', or 'splat'"),
  name: z.string().optional().describe("Filter by name (case-insensitive substring match)"),
  status: z.string().optional().describe("Filter by status: 'creating' or 'created'"),
  visibility: z.string().optional().describe("Filter by visibility: 'private' or 'public'"),
};

const listDatasetsInputSchema = z.object({
  ...datasetListFiltersSchema,
  ...paginationInputSchema,
});

const datasetLocatorSchema = {
  owner: z.string().describe("Dataset owner username, handle, or organization slug"),
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
  description: "Get detailed information about a specific dataset including its data type and item count.",
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
  description: "List sequences for a dataset (paginated). Each sequence includes uid, key, status, and frame count.",
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
  description: "Get a dataset sequence including its frames array (LiDAR JSON metadata for every frame).",
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

export const DATASET_READ_CATALOG_TOOLS = [
  listDatasetsTool,
  getDatasetTool,
  listSequencesTool,
  getSequenceTool,
  getDatasetHealthTool,
] as const;

export function registerDatasetTools(server: McpServer, getClient: GetClient, allowMutations = false): void {
  registerReadCatalogTool(server, getClient, listDatasetsTool);
  registerReadCatalogTool(server, getClient, getDatasetTool);
  registerReadCatalogTool(server, getClient, listSequencesTool);
  registerReadCatalogTool(server, getClient, getSequenceTool);

  server.tool(
    "get_frame",
    "Get a single frame's LiDAR JSON metadata (camera model, intrinsics, device pose, per-camera rig). Intended for post-ingest validation — diff what you uploaded against what the server sees.",
    {
      owner: z.string().describe("Dataset owner username, handle, or organization slug"),
      slug: z.string().describe("Dataset slug"),
      sequenceUid: z.string().describe("Sequence UUID"),
      frameIdx: z.number().int().min(0).describe("Zero-based frame index within the sequence"),
    },
    async ({ owner, slug, sequenceUid, frameIdx }) => {
      const avala = getClient();
      const frame = await avala.datasets.getFrame(owner, slug, sequenceUid, frameIdx);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(frame, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_calibration",
    "Get a sequence's canonicalized per-camera rig (position, heading, intrinsics, projection model) derived from frame[0].",
    {
      owner: z.string().describe("Dataset owner username, handle, or organization slug"),
      slug: z.string().describe("Dataset slug"),
      sequenceUid: z.string().describe("Sequence UUID"),
    },
    async ({ owner, slug, sequenceUid }) => {
      const avala = getClient();
      const calibration = await avala.datasets.getCalibration(owner, slug, sequenceUid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(calibration, null, 2),
          },
        ],
      };
    }
  );

  registerReadCatalogTool(server, getClient, getDatasetHealthTool);

  if (allowMutations) {
    server.tool(
      "create_dataset",
      "Create a new dataset for annotation. Supports image, video, lidar, and mcap data types.",
      {
        name: z.string().describe("Display name for the dataset"),
        slug: z.string().describe("URL-friendly identifier for the dataset"),
        dataType: z.string().describe("Type of data: 'image', 'video', 'lidar', or 'mcap'"),
        visibility: z.string().optional().describe("Dataset visibility: 'private' or 'public' (default: 'private')"),
        createMetadata: z.boolean().optional().describe("Whether to create dataset metadata (default: true)"),
        providerConfig: z
          .record(z.unknown())
          .optional()
          .describe("Cloud storage provider configuration (S3 bucket, region, prefix, credentials)"),
        ownerName: z.string().optional().describe("Dataset owner username or email"),
      },
      async ({ name, slug, dataType, visibility, createMetadata, providerConfig, ownerName }) => {
        const avala = getClient();
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
      }
    );
  }
}
