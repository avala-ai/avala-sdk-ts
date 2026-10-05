import { z } from "zod";
import { definePageOutputSchema, defineReadCatalogTool } from "../catalog.js";

// MCAP episodes have their own identity and need not have a DatasetSequence.
// These projections intentionally exclude storage keys, media URLs, free-form
// diagnostics/tags and epoch nanoseconds, which the JSON transport cannot
// represent exactly. Raw-file URL issuance has separate side effects and ACLs.
const episodeMetadataSchema = z.object({
  uid: z.string(),
  isHidden: z.boolean(),
  fileSizeBytes: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  extractionStatus: z.string(),
  itemUid: z.string().nullable().optional(),
  sequenceUid: z.string().nullable().optional(),
  createdAt: z.string().optional(),
}).strip();

const episodeListSchema = episodeMetadataSchema.extend({
  topicCount: z.number().int().nonnegative(),
});

const episodeDetailSchema = episodeMetadataSchema.extend({
  updatedAt: z.string().optional(),
  library: z.string().optional(),
  profile: z.string().optional(),
  topics: z.array(z.object({
    topicName: z.string(),
    schemaName: z.string().nullable(),
    messageEncoding: z.string(),
    messageCount: z.number().int().nonnegative(),
    panelType: z.string(),
  }).strip()).optional(),
});

// Durations are floating-point seconds, never a claim of exact 64-bit
// nanoseconds. Absolute epoch nanoseconds are not exposed by these tools.
function normalizeEpisodeMetadata(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.items)) {
    return { ...record, items: record.items.map(normalizeEpisodeMetadata) };
  }
  const { durationNs, ...rest } = record;
  return { ...rest, durationSeconds: typeof durationNs === "number" ? durationNs / 1e9 : durationNs };
}

const locator = {
  owner: z.string().min(1).describe("Dataset owner username, handle, or organization slug"),
  slug: z.string().min(1).describe("Dataset slug"),
};
const conciseKeys = ["uid", "isHidden", "fileSizeBytes", "durationSeconds", "messageCount", "extractionStatus", "topicCount"];

export const MCAP_READ_CATALOG_TOOLS = [
  defineReadCatalogTool({
    name: "list_mcap_episodes",
    title: "List MCAP episodes",
    description: "List one page of MCAP episode metadata using the dataset's existing access rules. Returns episode identities, extraction status, hidden state, byte sizes, durations in seconds, message counts and topic counts. Use detail=full for linked item/sequence identities and creation dates. Use get_mcap_episode for topic metadata. Episode IDs are distinct from dataset sequence IDs.",
    inputSchema: z.object({
      ...locator,
      limit: z.number().int().positive().max(1000).optional().describe("Page size, at most 1000. Defaults to 25."),
      cursor: z.string().optional().describe("Opaque cursor from a previous page"),
    }),
    outputSchema: definePageOutputSchema(episodeListSchema).strip(),
    conciseKeys,
    normalizeProviderResponse: normalizeEpisodeMetadata,
    failureMessage: "Unable to read MCAP episode metadata. Check the dataset locator and your access.",
    route: {
      name: "mcap-episode-list", method: "GET",
      path: "/datasets/{owner}/{slug}/mcap-episodes/",
      query: { limit: "limit", cursor: "cursor" },
      response: "page", scope: "datasets.read", toolset: "datasets",
    },
  }),
  defineReadCatalogTool({
    name: "get_mcap_episode",
    title: "Get MCAP episode metadata",
    description: "Read an MCAP episode by its episode UUID using the dataset's existing access rules. Default detail returns identity, extraction status, hidden state, byte size, duration in seconds and message count. Use detail=full for linked item/sequence identities, dates, library/profile and topic names, schemas, encodings and counts. Metadata only: storage keys, signed media URLs, free-form tags/errors and absolute nanosecond timestamps are omitted. Use get_sequence only with a dataset sequence ID.",
    inputSchema: z.object({
      ...locator,
      episodeUid: z.string().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/).describe("MCAP episode UUID, compact or hyphenated"),
    }),
    outputSchema: episodeDetailSchema,
    conciseKeys,
    normalizeProviderResponse: normalizeEpisodeMetadata,
    failureMessage: "Unable to read MCAP episode metadata. Check the dataset/episode locator and your access.",
    route: {
      name: "mcap-episode-detail", method: "GET",
      path: "/datasets/{owner}/{slug}/mcap-episodes/{episodeUid}/",
      response: "single", scope: "datasets.read", toolset: "datasets",
    },
  }),
] as const;
