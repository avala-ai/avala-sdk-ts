import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala/sdk";
import { z } from "zod";

export function registerExportTools(server: McpServer, avala: Avala): void {
  server.tool(
    "create_export",
    "Trigger a new export for a dataset or project.",
    {
      project: z.string().optional().describe("Project UID to export"),
      dataset: z.string().optional().describe("Dataset UID to export"),
    },
    async ({ project, dataset }) => {
      const exportJob = await avala.exports.create({ project, dataset });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(exportJob, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "list_exports",
    "List all exports with their formats, creation dates, and download URLs.",
    {
      limit: z.number().optional().describe("Maximum number of exports to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ limit, cursor }) => {
      const page = await avala.exports.list({ limit, cursor });
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
    "get_export_status",
    "Check whether an export is still processing, completed, or failed.",
    {
      uid: z.string().describe("The unique identifier (UUID) of the export"),
    },
    async ({ uid }) => {
      const exportJob = await avala.exports.get(uid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(exportJob, null, 2),
          },
        ],
      };
    }
  );
}
