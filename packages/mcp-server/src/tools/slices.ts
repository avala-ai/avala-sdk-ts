import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "../client.js";
import { definePageOutputSchema, defineReadCatalogTool, registerReadCatalogTool } from "../catalog.js";
import { z } from "zod";

const sliceOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    slug: z.string().nullable(),
    ownerName: z.string().nullable(),
    organization: z.record(z.unknown()).nullable(),
    visibility: z.string().nullable(),
    status: z.string().nullable(),
    itemCount: z.number().nullable(),
    subSlices: z.array(z.record(z.unknown())).nullable(),
    sourceData: z.unknown().nullable(),
    featuredSliceItemUrls: z.array(z.string()).nullable(),
  })
  .passthrough();

const listSlicesTool = defineReadCatalogTool({
  name: "list_slices",
  title: "List slices",
  description: "List slices for an owner (user or organization).",
  inputSchema: z.object({
    owner: z.string().describe("Owner name (user or organization slug)"),
    limit: z.number().int().positive().optional().describe("Maximum number of slices to return"),
    cursor: z.string().optional().describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(sliceOutputSchema),
  route: {
    name: "slices-by-owner-list",
    method: "GET",
    path: "/slices/{owner}/list/",
    query: { limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "slices.read",
    toolset: "slices",
  },
});

const getSliceTool = defineReadCatalogTool({
  name: "get_slice",
  title: "Get slice",
  description: "Get detailed information about a specific slice.",
  inputSchema: z.object({
    owner: z.string().describe("Owner name (user or organization slug)"),
    slug: z.string().describe("The slug of the slice"),
  }),
  outputSchema: sliceOutputSchema,
  route: {
    name: "slice-by-owner-and-name",
    method: "GET",
    path: "/slices/{owner}/{slug}/",
    response: "single",
    scope: "slices.read",
    toolset: "slices",
  },
});

export const SLICE_READ_CATALOG_TOOLS = [listSlicesTool, getSliceTool] as const;

export function registerSliceTools(server: McpServer, getClient: GetClient): void {
  registerReadCatalogTool(server, getClient, listSlicesTool);
  registerReadCatalogTool(server, getClient, getSliceTool);
}
