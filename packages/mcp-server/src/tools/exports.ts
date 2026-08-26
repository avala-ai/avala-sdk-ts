import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  definePageOutputSchema,
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import { z } from "zod";

// Catalog execution sanitizes every validated result before it reaches MCP.
// Keep schemas transform-free so SDK v2 can emit standards-compliant JSON Schema.
const sanitizedRecordSchema = z.record(z.string(), z.unknown());

const exportOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    format: z.string(),
    filterQueryString: z.string().nullable(),
    totalTaskCount: z.number().int().nonnegative().nullable(),
    exportedTaskCount: z.number().int().nonnegative().nullable(),
    downloadUrl: z.string().nullable(),
    status: z.string(),
    datasets: z.array(z.string()),
    slices: z.array(z.string()),
    projects: z.array(z.string()),
    organization: sanitizedRecordSchema.nullable().optional(),
    createdAt: z.string().nullable(),
  })
  .strip();

const listExportsTool = defineReadCatalogTool({
  name: "list_exports",
  title: "List exports",
  description:
    "List all exports with their formats, creation dates, and download URLs.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of exports to return"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(exportOutputSchema),
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
    "Check whether an export is still processing, completed, or failed.",
  inputSchema: z.object({
    uid: z.string().describe("The unique identifier (UUID) of the export"),
  }),
  outputSchema: exportOutputSchema,
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

  registerReadCatalogTool(server, getClient, listExportsTool);
  registerReadCatalogTool(server, getClient, getExportStatusTool);
}
