import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  assetIdentityForUrl,
  assetReferenceFor,
  assetReferenceSchema,
  createAssetHandleService,
  type AssetHandleService,
} from "../assetHandles.js";
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
    featuredSliceItemAssets: z.array(assetReferenceSchema).nullable(),
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

function assetizeSlice(
  value: unknown,
  owner: string,
  handles: AssetHandleService,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const { featuredSliceItemUrls, ...rest } = record;
  if (typeof record.slug !== "string") return rest;
  const featuredSliceItemAssets = Array.isArray(featuredSliceItemUrls)
    ? featuredSliceItemUrls.map((url) => {
        const asset = assetReferenceFor(
          url,
          {
            kind: "slice_featured_asset",
            owner,
            slug: record.slug as string,
            identity: assetIdentityForUrl(url),
          },
          handles,
        );
        if (!asset) throw new Error("Slice asset URL is unavailable.");
        return asset;
      })
    : null;
  return { ...rest, featuredSliceItemAssets };
}

function assetizeSliceResult(
  value: unknown,
  args: Readonly<Record<string, unknown>>,
  handles: AssetHandleService,
): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof args.owner !== "string"
  ) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.items)
    ? {
        ...record,
        items: record.items.map((item) =>
          assetizeSlice(item, args.owner as string, handles),
        ),
      }
    : assetizeSlice(record, args.owner, handles);
}

const listSlicesTool = defineReadCatalogTool({
  name: "list_slices",
  title: "List slices",
  description:
    "List slices for an owner (user or organization). Default detail is identity, status, and asset count. Nested sub-slices and opaque featured-media handles require detail=full.",
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
  assetize: assetizeSliceResult,
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
    "Get a slice. Default detail is identity, status, and asset count. Use detail=full for nested sub-slices, source data, and opaque featured-media handles.",
  inputSchema: z.object({
    owner: z.string().describe("Owner name (user or organization slug)"),
    slug: z.string().describe("The slug of the slice"),
  }),
  outputSchema: sliceOutputSchema,
  assetize: assetizeSliceResult,
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
  assetHandles: AssetHandleService = createAssetHandleService(),
): void {
  registerReadCatalogTool(server, getClient, listSlicesTool, assetHandles);
  registerReadCatalogTool(server, getClient, getSliceTool, assetHandles);
}
