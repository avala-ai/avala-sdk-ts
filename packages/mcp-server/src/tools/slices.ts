import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  definePageOutputSchema,
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import {
  ASSET_COUNT_DESCRIPTION,
  DEPRECATED_ITEM_COUNT_ON_SLICE,
  aliasSliceCounts,
} from "../readDetail.js";
import { z } from "zod";

const sliceOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    slug: z.string().nullable(),
    ownerName: z.string().nullable(),
    organization: z.record(z.string(), z.unknown()).nullable(),
    visibility: z.string().nullable(),
    status: z.string().nullable(),
    assetCount: z
      .number()
      .nullable()
      .optional()
      .describe(ASSET_COUNT_DESCRIPTION),
    itemCount: z.number().nullable().describe(DEPRECATED_ITEM_COUNT_ON_SLICE),
    subSlices: z.array(z.record(z.string(), z.unknown())).nullable(),
    sourceData: z.unknown().nullable(),
    featuredSliceItemUrls: z.array(z.string()).nullable(),
  })
  .passthrough();

const SLICE_CONCISE_KEYS = [
  "uid",
  "name",
  "slug",
  "ownerName",
  "visibility",
  "status",
  "assetCount",
  "itemCount",
] as const;

const listSlicesTool = defineReadCatalogTool({
  name: "list_slices",
  title: "List slices",
  description:
    "List slices for an owner (user or organization). Default detail is identity, status, and asset count. Nested sub-slices and featured media require detail=full.",
  inputSchema: z.object({
    owner: z.string().describe("Owner name (user or organization slug)"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Maximum number of slices to return. Defaults to 25 when omitted.",
      ),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(sliceOutputSchema),
  normalize: aliasSliceCounts,
  conciseKeys: SLICE_CONCISE_KEYS,
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
  description:
    "Get a slice. Default detail is identity, status, and asset count. Use detail=full for nested sub-slices, source data, and featured media.",
  inputSchema: z.object({
    owner: z.string().describe("Owner name (user or organization slug)"),
    slug: z.string().describe("The slug of the slice"),
  }),
  outputSchema: sliceOutputSchema,
  normalize: aliasSliceCounts,
  conciseKeys: SLICE_CONCISE_KEYS,
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

export function registerSliceTools(
  server: McpServer,
  getClient: GetClient,
): void {
  registerReadCatalogTool(server, getClient, listSlicesTool);
  registerReadCatalogTool(server, getClient, getSliceTool);
}
