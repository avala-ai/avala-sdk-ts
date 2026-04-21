import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerStorageTools(server: McpServer, avala: Avala, allowMutations = false): void {
  server.tool(
    "list_storage_configs",
    "List all storage configurations in your workspace.",
    {
      limit: z.number().optional().describe("Maximum number of storage configs to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ limit, cursor }) => {
      const page = await avala.storageConfigs.list({ limit, cursor });
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

  if (allowMutations) {
    server.tool(
      "create_storage_config",
      "Create a new storage configuration (S3 or Google Cloud Storage) with non-sensitive settings only (bucket, region, prefix). Credentials must be provisioned separately through the Avala web console — this tool will NOT accept access keys or service-account JSON, because any value passed here is stored in the LLM's conversation context and logs.",
      {
        name: z.string().describe("Name for the storage configuration"),
        provider: z.string().describe("Storage provider type (e.g. 's3', 'gcs')"),
        s3BucketName: z.string().optional().describe("S3 bucket name"),
        s3BucketRegion: z.string().optional().describe("S3 bucket region"),
        s3BucketPrefix: z.string().optional().describe("S3 key prefix"),
        s3IsAccelerated: z.boolean().optional().describe("Enable S3 Transfer Acceleration"),
        gcStorageBucketName: z.string().optional().describe("Google Cloud Storage bucket name"),
        gcStoragePrefix: z.string().optional().describe("Google Cloud Storage prefix"),
      },
      async ({
        name,
        provider,
        s3BucketName,
        s3BucketRegion,
        s3BucketPrefix,
        s3IsAccelerated,
        gcStorageBucketName,
        gcStoragePrefix,
      }) => {
        const config = await avala.storageConfigs.create({
          name,
          provider,
          s3BucketName,
          s3BucketRegion,
          s3BucketPrefix,
          s3IsAccelerated,
          gcStorageBucketName,
          gcStoragePrefix,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                JSON.stringify(config, null, 2) +
                "\n\nNOTE: This storage config has no credentials attached. " +
                "Add credentials via the Avala web console (Settings → Storage) before attaching datasets.",
            },
          ],
        };
      }
    );
  }

  server.tool(
    "test_storage_config",
    "Test connectivity for a storage configuration.",
    {
      uid: z.string().describe("The unique identifier (UUID) of the storage config to test"),
    },
    async ({ uid }) => {
      const result = await avala.storageConfigs.test(uid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  if (allowMutations) {
    server.tool(
      "delete_storage_config",
      "Delete a storage configuration by its UID.",
      {
        uid: z.string().describe("The unique identifier (UUID) of the storage config to delete"),
      },
      async ({ uid }) => {
        await avala.storageConfigs.delete(uid);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, message: `Storage config ${uid} deleted.` }),
            },
          ],
        };
      }
    );
  }
}
