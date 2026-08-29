import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DATASET_READ_CATALOG_TOOLS,
} from "../src/tools/datasets.js";
import { SLICE_READ_CATALOG_TOOLS } from "../src/tools/slices.js";
import {
  ASSET_COUNT_DESCRIPTION,
  DEPRECATED_ITEM_COUNT_ON_DATASET,
  DEPRECATED_ITEM_COUNT_ON_HEALTH,
  DEPRECATED_ITEM_COUNT_ON_SLICE,
  FRAME_COUNT_DESCRIPTION,
  SEQUENCE_COUNT_DESCRIPTION,
  aliasDatasetCounts,
  aliasDatasetHealthCounts,
  aliasSequenceCounts,
  aliasSliceCounts,
  presentReadDetail,
  projectConcise,
  withPaginationAliases,
} from "../src/readDetail.js";

function walkZodObject(
  schema: z.ZodType,
  visit: (key: string, description: string | undefined, schema: z.ZodType) => void,
): void {
  const obj = schema as z.ZodObject;
  if (typeof obj.shape !== "object" || obj.shape === null) return;
  for (const [key, field] of Object.entries(obj.shape as Record<string, z.ZodType>)) {
    const description =
      typeof (field as { description?: string }).description === "string"
        ? (field as { description: string }).description
        : undefined;
    visit(key, description, field as z.ZodType);
    const inner =
      field instanceof z.ZodOptional || field instanceof z.ZodNullable
        ? field.unwrap()
        : field;
    if (inner instanceof z.ZodObject) walkZodObject(inner, visit);
    if (inner instanceof z.ZodArray) {
      const element = (inner as z.ZodArray<z.ZodType>).element;
      if (element instanceof z.ZodObject) walkZodObject(element, visit);
    }
  }
}

function fieldDescriptions(schema: z.ZodType): Record<string, string | undefined> {
  const found: Record<string, string | undefined> = {};
  walkZodObject(schema, (key, description) => {
    found[key] = description;
  });
  return found;
}

describe("count-field aliases", () => {
  it("maps sequence-dataset itemCount to sequenceCount and keeps the deprecated alias", () => {
    const page = {
      items: [
        {
          uid: "sf-lidar",
          name: "sf-lidar",
          slug: "sf-lidar",
          isSequence: true,
          itemCount: 39,
          dataType: "lidar",
        },
      ],
    };
    aliasDatasetCounts(page);
    expect(page.items[0]).toMatchObject({
      sequenceCount: 39,
      itemCount: 39,
    });
    expect(page.items[0]).not.toHaveProperty("assetCount");
  });

  it("maps non-sequence itemCount to assetCount and keeps the deprecated alias", () => {
    const dataset = {
      uid: "bags",
      name: "bags",
      slug: "bags",
      isSequence: false,
      itemCount: 120,
      dataType: "image",
    };
    aliasDatasetCounts(dataset);
    expect(dataset).toMatchObject({
      assetCount: 120,
      itemCount: 120,
    });
    expect(dataset).not.toHaveProperty("sequenceCount");
  });

  it("maps health itemCount to frameCount beside the existing sequenceCount", () => {
    const health = {
      datasetUid: "ds-1",
      itemCount: 3120,
      sequenceCount: 39,
      totalFrames: 3120,
      sequences: [{ uid: "seq-1", numberOfFrames: 80 }],
    };
    aliasDatasetHealthCounts(health);
    expect(health).toMatchObject({
      frameCount: 3120,
      itemCount: 3120,
      sequenceCount: 39,
    });
    expect(health.sequences[0]).toMatchObject({
      numberOfFrames: 80,
      frameCount: 80,
    });
  });

  it("maps non-sequence health itemCount to assetCount, not frameCount", () => {
    const health = {
      datasetUid: "ds-video",
      itemCount: 2,
      sequenceCount: 0,
      totalFrames: 0,
      sequences: [],
    };
    aliasDatasetHealthCounts(health);
    expect(health).toMatchObject({
      assetCount: 2,
      itemCount: 2,
      sequenceCount: 0,
      totalFrames: 0,
    });
    expect(health).not.toHaveProperty("frameCount");
  });

  it("mirrors sequence numberOfFrames onto frameCount", () => {
    const page = {
      items: [{ uid: "seq-1", numberOfFrames: 569 }],
    };
    aliasSequenceCounts(page);
    expect(page.items[0].frameCount).toBe(569);
  });

  it("maps slice itemCount to assetCount", () => {
    const slice = { uid: "sl-1", itemCount: 12 };
    aliasSliceCounts(slice);
    expect(slice).toMatchObject({ assetCount: 12, itemCount: 12 });
  });
});

describe("output schema field descriptions (walked, not grepped)", () => {
  it("states the unit and deprecation on dataset count fields", () => {
    const listDatasets = DATASET_READ_CATALOG_TOOLS.find(
      (tool) => tool.name === "list_datasets",
    )!;
    const pageShape = listDatasets.outputSchema.shape as {
      items: z.ZodArray<z.ZodObject>;
    };
    const descriptions = fieldDescriptions(pageShape.items.element);
    expect(descriptions.sequenceCount).toBe(SEQUENCE_COUNT_DESCRIPTION);
    expect(descriptions.itemCount).toBe(DEPRECATED_ITEM_COUNT_ON_DATASET);
    expect(descriptions.itemCount).toMatch(/Deprecated/);
    expect(descriptions.sequenceCount).toMatch(/sequences \(recording runs\)/);
  });

  it("states that health itemCount is a deprecated shape-dependent count", () => {
    const health = DATASET_READ_CATALOG_TOOLS.find(
      (tool) => tool.name === "get_dataset_health",
    )!;
    const descriptions = fieldDescriptions(health.outputSchema);
    expect(descriptions.frameCount).toBe(FRAME_COUNT_DESCRIPTION);
    expect(descriptions.itemCount).toBe(DEPRECATED_ITEM_COUNT_ON_HEALTH);
    expect(descriptions.sequenceCount).toBe(SEQUENCE_COUNT_DESCRIPTION);
    expect(descriptions.assetCount).toBe(ASSET_COUNT_DESCRIPTION);
    expect(descriptions.itemCount).toMatch(/shape-dependent/);
  });

  it("states that slice itemCount is a deprecated assetCount", () => {
    const listSlices = SLICE_READ_CATALOG_TOOLS.find(
      (tool) => tool.name === "list_slices",
    )!;
    const pageShape = listSlices.outputSchema.shape as {
      items: z.ZodArray<z.ZodObject>;
    };
    const descriptions = fieldDescriptions(pageShape.items.element);
    expect(descriptions.itemCount).toBe(DEPRECATED_ITEM_COUNT_ON_SLICE);
    expect(descriptions.assetCount).toBeDefined();
  });
});

describe("detail projection", () => {
  it("keeps identity and counts and drops labels, projects, and media", () => {
    const dataset = {
      uid: "ds-1",
      name: "Warehouse",
      slug: "warehouse",
      dataType: "lidar",
      isSequence: true,
      sequenceCount: 39,
      itemCount: 39,
      status: "created",
      ownerName: "robotics-team",
      updatedAt: "2026-08-24T00:00:00Z",
      predefinedLabels: Array.from({ length: 40 }, (_, i) => ({
        name: `label-${i}`,
      })),
      projects: [{ uid: "p1", name: "Project" }],
      featuredItemsUrl: "https://example.com/featured",
    };
    const concise = presentReadDetail(dataset, {}, [
      "uid",
      "name",
      "slug",
      "dataType",
      "isSequence",
      "sequenceCount",
      "itemCount",
      "status",
      "ownerName",
      "updatedAt",
    ]) as Record<string, unknown>;
    expect(concise).toEqual({
      uid: "ds-1",
      name: "Warehouse",
      slug: "warehouse",
      dataType: "lidar",
      isSequence: true,
      sequenceCount: 39,
      itemCount: 39,
      status: "created",
      ownerName: "robotics-team",
      updatedAt: "2026-08-24T00:00:00Z",
    });
    expect(concise).not.toHaveProperty("predefinedLabels");
    expect(concise).not.toHaveProperty("projects");
    expect(concise).not.toHaveProperty("featuredItemsUrl");
  });

  it("leaves the payload intact when detail is full", () => {
    const dataset = { uid: "ds-1", predefinedLabels: [{ name: "car" }] };
    expect(presentReadDetail(dataset, { detail: "full" })).toEqual(dataset);
  });

  it("adds snake_case pagination aliases without inventing totalCount", () => {
    const page = withPaginationAliases({
      items: [{ uid: "a" }],
      nextCursor: "cursor-2",
      previousCursor: null,
      hasMore: true,
    });
    expect(page).toMatchObject({
      nextCursor: "cursor-2",
      next_cursor: "cursor-2",
      hasMore: true,
      has_more: true,
    });
    expect(page).not.toHaveProperty("totalCount");
    expect(page).not.toHaveProperty("total_count");
  });

  it("forwards totalCount when the upstream page already had it", () => {
    const page = withPaginationAliases({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
      totalCount: 87,
    });
    expect(page.totalCount).toBe(87);
    expect(page.total_count).toBe(87);
  });

  it("does not invent cursors on an unpaginated list envelope", () => {
    const list = { items: [{ uid: "a", name: "A", extra: true }] };
    const projected = projectConcise(list, ["uid", "name"]) as Record<
      string,
      unknown
    >;
    expect(projected).toEqual({ items: [{ uid: "a", name: "A" }] });
    expect(projected).not.toHaveProperty("has_more");
    expect(projected).not.toHaveProperty("next_cursor");
  });

  it("projects page items and keeps the pagination envelope", () => {
    const projected = projectConcise(
      {
        items: [
          {
            uid: "ds-1",
            name: "A",
            predefinedLabels: [{ name: "car" }],
          },
        ],
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      },
      ["uid", "name"],
    ) as Record<string, unknown>;
    expect(projected.items).toEqual([{ uid: "ds-1", name: "A" }]);
    expect(projected.has_more).toBe(false);
    expect(projected.next_cursor).toBeNull();
  });
});
