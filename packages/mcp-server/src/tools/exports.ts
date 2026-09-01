import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  assetReferenceSchema,
  createAssetHandleService,
  identityBoundAssetReferenceFor,
  type AssetHandleService,
} from "../assetHandles.js";
import {
  definePageOutputSchema,
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import { z } from "zod";

const sanitizedRecordSchema = z.record(z.string(), z.unknown());

const exportOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    format: z.string(),
    filterQueryString: z.string().nullable(),
    totalTaskCount: z.number().int().nonnegative().nullable(),
    exportedTaskCount: z.number().int().nonnegative().nullable(),
    downloadAsset: assetReferenceSchema.nullable(),
    status: z.string(),
    datasets: z.array(z.string()),
    slices: z.array(z.string()),
    projects: z.array(z.string()),
    organization: sanitizedRecordSchema.nullable().optional(),
    createdAt: z.string().nullable(),
  })
  .strip();

const EXPORT_CONCISE_KEYS = [
  "uid",
  "name",
  "format",
  "status",
  "exportedTaskCount",
  "totalTaskCount",
  "createdAt",
] as const;

function assetizeExport(
  value: unknown,
  handles: AssetHandleService,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const { downloadUrl, ...rest } = record;
  if (typeof record.uid !== "string") return rest;
  const uid = record.uid;
  return {
    ...rest,
    downloadAsset: identityBoundAssetReferenceFor(
      downloadUrl,
      (identity) => ({ kind: "export_download", uid, identity }),
      handles,
    ),
  };
}

function assetizeExportResult(
  value: unknown,
  _args: Readonly<Record<string, unknown>>,
  handles: AssetHandleService,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.items)
    ? { ...record, items: record.items.map((item) => assetizeExport(item, handles)) }
    : assetizeExport(record, handles);
}

const listExportsTool = defineReadCatalogTool({
  name: "list_exports",
  title: "List exports",
  description:
    "List exports. Default detail is identity, format, status, and counts. Opaque download-asset handles require detail=full; resolve one explicitly only when the artifact is needed.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Maximum number of exports to return. Defaults to 25 when omitted.",
      ),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(exportOutputSchema),
  assetize: assetizeExportResult,
  conciseKeys: EXPORT_CONCISE_KEYS,
  route: {
    name: "export-list",
    method: "GET",
    path: "/exports/",
    query: { limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "exports.read",
    toolset: "exports",
  },
});

const getExportStatusTool = defineReadCatalogTool({
  name: "get_export_status",
  title: "Get export status",
  description:
    "Check whether an export is still processing, completed, or failed. A completed export's opaque download-asset handle requires detail=full; resolve it explicitly only when the artifact is needed.",
  inputSchema: z.object({
    uid: z.string().describe("The unique identifier (UUID) of the export"),
  }),
  outputSchema: exportOutputSchema,
  assetize: assetizeExportResult,
  conciseKeys: EXPORT_CONCISE_KEYS,
  route: {
    name: "export-detail",
    method: "GET",
    path: "/exports/{uid}/",
    response: "single",
    scope: "exports.read",
    toolset: "exports",
  },
});

export const EXPORT_READ_CATALOG_TOOLS = [
  listExportsTool,
  getExportStatusTool,
] as const;

export function registerExportTools(
  server: McpServer,
  getClient: GetClient,
  allowMutations = false,
  assetHandles: AssetHandleService = createAssetHandleService(),
): void {
  if (allowMutations) {
    server.registerTool(
      "create_export",
      {
        description: "Trigger a new export for a dataset or project.",
        inputSchema: z.object({
          project: z.string().optional().describe("Project UID to export"),
          dataset: z.string().optional().describe("Dataset UID to export"),
        }),
      },
      async ({ project, dataset }) => {
        const avala = getClient("create_export");
        const exportJob = await avala.exports.create({ project, dataset });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(exportJob, null, 2),
            },
          ],
        };
      },
    );
  }

  registerReadCatalogTool(server, getClient, listExportsTool, assetHandles);
  registerReadCatalogTool(server, getClient, getExportStatusTool, assetHandles);
}
