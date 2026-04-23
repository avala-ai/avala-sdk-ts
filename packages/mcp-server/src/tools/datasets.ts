import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerDatasetTools(server: McpServer, avala: Avala, allowMutations = false): void {
  server.tool(
    "list_datasets",
    "List all datasets in your workspace with their IDs, names, and asset counts. Supports filtering by data type, name, status, and visibility.",
    {
      dataType: z.string().optional().describe("Filter by data type: 'image', 'video', 'lidar', 'mcap', or 'splat'"),
      name: z.string().optional().describe("Filter by name (case-insensitive substring match)"),
      status: z.string().optional().describe("Filter by status: 'creating' or 'created'"),
      visibility: z.string().optional().describe("Filter by visibility: 'private' or 'public'"),
      limit: z.number().optional().describe("Maximum number of datasets to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ dataType, name, status, visibility, limit, cursor }) => {
      const page = await avala.datasets.list({ dataType, name, status, visibility, limit, cursor });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(page, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_dataset",
    "Get detailed information about a specific dataset including its data type and item count.",
    {
      uid: z.string().describe("The unique identifier (UUID) of the dataset"),
    },
    async ({ uid }) => {
      const dataset = await avala.datasets.get(uid);
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

  server.tool(
    "list_sequences",
    "List sequences for a dataset (paginated). Each sequence includes uid, key, status, and frame count.",
    {
      owner: z.string().describe("Dataset owner username, handle, or organization slug"),
      slug: z.string().describe("Dataset slug"),
      limit: z.number().optional().describe("Maximum number of sequences to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ owner, slug, limit, cursor }) => {
      const page = await avala.datasets.listSequences(owner, slug, { limit, cursor });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(page, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_sequence",
    "Get a dataset sequence including its frames array (LiDAR JSON metadata for every frame).",
    {
      owner: z.string().describe("Dataset owner username, handle, or organization slug"),
      slug: z.string().describe("Dataset slug"),
      sequenceUid: z.string().describe("Sequence UUID"),
    },
    async ({ owner, slug, sequenceUid }) => {
      const sequence = await avala.datasets.getSequence(owner, slug, sequenceUid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(sequence, null, 2),
          },
        ],
      };
    }
  );

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

  server.tool(
    "get_dataset_health",
    "Get a read-only ingest/health snapshot for a dataset: frame totals, per-sequence counts, S3 prefix, ingest_ok flag, and any issues detected. Useful for validating a dataset after upload without opening Mission Control.",
    {
      owner: z.string().describe("Dataset owner username, handle, or organization slug"),
      slug: z.string().describe("Dataset slug"),
    },
    async ({ owner, slug }) => {
      const health = await avala.datasets.getHealth(owner, slug);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(health, null, 2),
          },
        ],
      };
    }
  );

  if (allowMutations) {
    server.tool(
      "create_dataset",
      "Create a new dataset for annotation. Supports image, video, lidar, and mcap data types.",
      {
        name: z.string().describe("Display name for the dataset"),
        slug: z.string().describe("URL-friendly identifier for the dataset"),
        dataType: z.string().describe("Type of data: 'image', 'video', 'lidar', or 'mcap'"),
        isSequence: z.boolean().optional().describe("Whether the dataset contains sequences (default: false)"),
        visibility: z.string().optional().describe("Dataset visibility: 'private' or 'public' (default: 'private')"),
        createMetadata: z.boolean().optional().describe("Whether to create dataset metadata (default: true)"),
        providerConfig: z
          .record(z.unknown())
          .optional()
          .describe("Cloud storage provider configuration (S3 bucket, region, prefix, credentials)"),
        ownerName: z.string().optional().describe("Dataset owner username or email"),
      },
      async ({ name, slug, dataType, isSequence, visibility, createMetadata, providerConfig, ownerName }) => {
        const dataset = await avala.datasets.create({
          name,
          slug,
          dataType,
          isSequence,
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
