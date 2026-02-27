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
