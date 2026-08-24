import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "../client.js";
import { definePageOutputSchema, defineReadCatalogTool, registerReadCatalogTool } from "../catalog.js";
import { z } from "zod";

const storageConfigOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    provider: z.string(),
    s3BucketName: z.string().nullable(),
    s3BucketRegion: z.string().nullable(),
    s3BucketPrefix: z.string().nullable(),
    s3IsAccelerated: z.boolean(),
    s3AuthMethod: z.string().nullable(),
    gcStorageBucketName: z.string().nullable(),
    gcStoragePrefix: z.string().nullable(),
    r2AccountId: z.string().nullable(),
    r2PublicBaseUrl: z.string().nullable(),
    isVerified: z.boolean(),
    lastVerifiedAt: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough();

const listStorageConfigsTool = defineReadCatalogTool({
  name: "list_storage_configs",
  title: "List storage configurations",
  description: "List all storage configurations in your workspace.",
  inputSchema: z.object({
    limit: z.number().int().positive().optional().describe("Maximum number of storage configs to return"),
    cursor: z.string().optional().describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(storageConfigOutputSchema),
  route: {
    name: "storage-config-list",
    method: "GET",
    path: "/storage-configs/",
    query: { limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "storage.read",
    toolset: "storage",
  },
});

export const STORAGE_READ_CATALOG_TOOLS = [listStorageConfigsTool] as const;

export function registerStorageTools(server: McpServer, getClient: GetClient, allowMutations = false): void {
  registerReadCatalogTool(server, getClient, listStorageConfigsTool);

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
        const avala = getClient();
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

  // AVALA-SEC-2026-0010: test_storage_config issues a state-changing POST
  // (storageConfigs.test -> POST /storage-configs/{uid}/test/), so it must be
  // gated behind allowMutations like every other write tool. Registering it
  // unconditionally exposed a mutation surface in read-only mode.
  if (allowMutations) {
    server.tool(
      "test_storage_config",
      "Test connectivity for a storage configuration.",
      {
        uid: z.string().describe("The unique identifier (UUID) of the storage config to test"),
      },
      async ({ uid }) => {
        const avala = getClient();
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
  }

  if (allowMutations) {
    server.tool(
      "delete_storage_config",
      "Delete a storage configuration by its UID.",
      {
        uid: z.string().describe("The unique identifier (UUID) of the storage config to delete"),
      },
      async ({ uid }) => {
        const avala = getClient();
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
