import { z } from "zod";

export const READ_DETAIL_VALUES = ["concise", "full"] as const;
export type ReadDetail = (typeof READ_DETAIL_VALUES)[number];

/** Default list page size when the caller omits `limit` and the route maps it. */
export const DEFAULT_PAGE_LIMIT = 25;

/**
 * Identity, status, owner, timestamps, and the unit-bearing count fields.
 * Labels, nested projects, media URLs, frame blobs, and instruction text
 * stay out of concise responses — they belong on `detail: "full"` or a
 * dedicated get tool.
 */
export const DEFAULT_CONCISE_KEYS = [
  "uid",
  "name",
  "slug",
  "handle",
  "dataType",
  "isSequence",
  "sequenceCount",
  "frameCount",
  "assetCount",
  "itemCount",
  "numberOfFrames",
  "customUuid",
  "key",
  "status",
  "owner",
  "ownerName",
  "updatedAt",
  "createdAt",
  "datasetUid",
  "datasetSlug",
  "datasetStatus",
  "project",
  "projectUid",
  "totalFrames",
  "ingestOk",
  "issues",
  "lastUpdatedAt",
  "type",
  "format",
  "visibility",
  "isActive",
  "resultUid",
  "itemUid",
  "submittedAt",
  "rejectReason",
  "metric",
  "operator",
  "threshold",
  "isBreached",
  "lastValue",
  "severity",
  "machineVerdict",
  "total",
  "reviewed",
  "meanScore",
  "medianScore",
  "totalItems",
  "itemsWithConsensus",
  "memberCount",
  "plan",
  "role",
  "events",
  "provider",
  "isVerified",
  "exportedTaskCount",
  "totalTaskCount",
  "progress",
  "firmwareVersion",
  "lastSeenAt",
  "device",
  "enabled",
  "label",
  "message",
  "triggeredAt",
] as const;

export const detailInputField = z
  .enum(READ_DETAIL_VALUES)
  .optional()
  .describe(
    'Response detail. Defaults to "concise": identity, status, owner, timestamps, and unit-bearing counts only. Use "full" for labels, nested projects, media URLs, and frame payloads.',
  );

export function resolveReadDetail(args: Record<string, unknown>): ReadDetail {
  return args.detail === "full" ? "full" : "concise";
}

function hasPaginationMarker(value: object): boolean {
  return (
    "nextCursor" in value ||
    "hasMore" in value ||
    "next_cursor" in value ||
    "has_more" in value ||
    "previousCursor" in value ||
    "totalCount" in value ||
    "total_count" in value
  );
}

export function isListEnvelope(
  value: unknown,
): value is { items: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export function isPageEnvelope(value: unknown): value is {
  items: unknown[];
  nextCursor?: unknown;
  previousCursor?: unknown;
  hasMore?: unknown;
  totalCount?: unknown;
  next_cursor?: unknown;
  has_more?: unknown;
  total_count?: unknown;
} {
  return isListEnvelope(value) && hasPaginationMarker(value);
}

function firstNumber(
  ...values: unknown[]
): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Cursor pagination contract. CamelCase is canonical (existing clients).
 * Snake_case aliases are filled from the same values so an agent following
 * the standing-brief names (`has_more`, `next_cursor`, `total_count`) does
 * not have to guess.
 *
 * `totalCount` is only emitted when the upstream page already carried it —
 * we do not walk the rest of the collection to invent it.
 */
export function withPaginationAliases<T extends Record<string, unknown>>(
  page: T,
): T & {
  next_cursor: string | null;
  has_more: boolean;
  totalCount?: number | null;
  total_count?: number | null;
} {
  const nextCursor =
    typeof page.nextCursor === "string"
      ? page.nextCursor
      : typeof page.next_cursor === "string"
        ? page.next_cursor
        : null;
  const hasMore =
    typeof page.hasMore === "boolean"
      ? page.hasMore
      : typeof page.has_more === "boolean"
        ? page.has_more
        : false;
  const totalCount = firstNumber(page.totalCount, page.total_count);
  const aliased = {
    ...page,
    nextCursor: nextCursor,
    previousCursor:
      typeof page.previousCursor === "string" || page.previousCursor === null
        ? page.previousCursor
        : null,
    hasMore,
    next_cursor: nextCursor,
    has_more: hasMore,
  };
  if (totalCount !== null) {
    return { ...aliased, totalCount, total_count: totalCount };
  }
  return aliased;
}

function pickKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      out[key] = value[key];
    }
  }
  return out;
}

export function projectConcise(
  value: unknown,
  conciseKeys: readonly string[] = DEFAULT_CONCISE_KEYS,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => projectConcise(item, conciseKeys));
  }
  if (isPageEnvelope(value)) {
    const projectedItems = value.items.map((item) =>
      projectConcise(item, conciseKeys),
    );
    return withPaginationAliases({
      ...(value as Record<string, unknown>),
      items: projectedItems,
    });
  }
  if (isListEnvelope(value)) {
    return {
      items: value.items.map((item) => projectConcise(item, conciseKeys)),
    };
  }
  if (typeof value === "object" && value !== null) {
    return pickKeys(value as Record<string, unknown>, conciseKeys);
  }
  return value;
}

export function presentReadDetail(
  value: unknown,
  args: Record<string, unknown>,
  conciseKeys?: readonly string[],
): unknown {
  const detail = resolveReadDetail(args);
  const normalized = Array.isArray(value)
    ? value
    : isPageEnvelope(value)
      ? withPaginationAliases(value as Record<string, unknown>)
      : value;
  if (detail === "full") return normalized;
  if (!conciseKeys) return normalized;
  return projectConcise(normalized, conciseKeys);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function walkItems(
  value: unknown,
  each: (item: Record<string, unknown>) => void,
): unknown {
  if (isListEnvelope(value)) {
    for (const item of value.items) {
      const record = asRecord(item);
      if (record) each(record);
    }
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const record = asRecord(item);
      if (record) each(record);
    }
    return value;
  }
  const record = asRecord(value);
  if (record) each(record);
  return value;
}

/**
 * Dataset list/detail `itemCount` is not one unit. Verified in
 * `server/server/apps/dataset/serializers.py`:
 *
 * - `DatasetListSerializer.get_item_count` / `DatasetSerializer.get_item_count`
 *   return `sequence_count` (or `dataset.sequences.count()`) when
 *   `dataset.is_sequence` is true — sequences (recording runs).
 * - Otherwise they return accepted-capture count or the denormalized
 *   `dataset.item_count` — assets (images, captures, other items).
 *
 * `itemCount` is kept as a deprecated alias of whichever unit applies.
 */
export function aliasDatasetCounts(value: unknown): unknown {
  return walkItems(value, (item) => {
    if (typeof item.itemCount !== "number") return;
    if (item.isSequence === true) {
      if (typeof item.sequenceCount !== "number") {
        item.sequenceCount = item.itemCount;
      }
      return;
    }
    if (typeof item.assetCount !== "number") {
      item.assetCount = item.itemCount;
    }
  });
}

/**
 * Dataset health `itemCount` is `dataset.item_count` sitting next to
 * `sequenceCount`. Verified in `DatasetHealthView` (`api_datasets.py`):
 * `"item_count": dataset.item_count`. Its unit depends on dataset shape:
 * sequence datasets store frames, while non-sequence datasets store assets.
 * Add the matching unit-bearing alias; keep `itemCount` for compatibility.
 */
export function aliasDatasetHealthCounts(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  if (typeof record.itemCount === "number") {
    if (
      typeof record.sequenceCount === "number" &&
      record.sequenceCount === 0
    ) {
      if (typeof record.assetCount !== "number") {
        record.assetCount = record.itemCount;
      }
    } else if (typeof record.frameCount !== "number") {
      record.frameCount = record.itemCount;
    }
  }
  if (Array.isArray(record.sequences)) {
    for (const sequence of record.sequences) {
      const seq = asRecord(sequence);
      if (!seq) continue;
      if (
        typeof seq.frameCount !== "number" &&
        typeof seq.numberOfFrames === "number"
      ) {
        seq.frameCount = seq.numberOfFrames;
      }
    }
  }
  return record;
}

/**
 * Sequence list rows already expose `numberOfFrames`. Mirror it to
 * `frameCount` so the same unit-bearing name works across tools.
 */
export function aliasSequenceCounts(value: unknown): unknown {
  return walkItems(value, (item) => {
    if (
      typeof item.frameCount !== "number" &&
      typeof item.numberOfFrames === "number"
    ) {
      item.frameCount = item.numberOfFrames;
    }
  });
}

/**
 * Slice `itemCount` is a count of slice assets (dataset items in the slice),
 * not sequences or frames. Rename to `assetCount`.
 */
export function aliasSliceCounts(value: unknown): unknown {
  return walkItems(value, (item) => {
    if (typeof item.itemCount === "number" && typeof item.assetCount !== "number") {
      item.assetCount = item.itemCount;
    }
  });
}

export const SEQUENCE_COUNT_DESCRIPTION =
  "Number of sequences (recording runs) in this dataset.";
export const FRAME_COUNT_DESCRIPTION =
  "Number of frames (per-timestep captures) in this dataset or sequence.";
export const ASSET_COUNT_DESCRIPTION =
  "Number of assets (images, accepted captures, or other non-sequence items) in this dataset.";
export const DEPRECATED_ITEM_COUNT_ON_DATASET =
  "Deprecated alias of sequenceCount when isSequence is true, otherwise of assetCount. Prefer the unit-bearing name. Kept for one release so existing clients keep working.";
export const DEPRECATED_ITEM_COUNT_ON_HEALTH =
  "Deprecated shape-dependent count. It aliases frameCount when sequenceCount is positive and assetCount when sequenceCount is zero. Prefer totalFrames for live sequence frames or assetCount for non-sequence media. Kept for one release so existing clients keep working.";
export const DEPRECATED_ITEM_COUNT_ON_SLICE =
  "Deprecated alias of assetCount. Number of assets (dataset items) in this slice. Prefer assetCount. Kept for one release so existing clients keep working.";
