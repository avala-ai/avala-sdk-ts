import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  applyReadListDefaults,
  defineReadCatalogTool,
  registerReadCatalogTool,
  withReadDetailInput,
} from "../src/catalog.js";
import { DEFAULT_PAGE_LIMIT } from "../src/readDetail.js";
import { DATASET_READ_CATALOG_TOOLS } from "../src/tools/datasets.js";

describe("catalog detail plumbing", () => {
  it("adds detail by default and preserves fixed-shape catalog inputs", () => {
    for (const tool of DATASET_READ_CATALOG_TOOLS) {
      const supportsDetail =
        "supportsDetail" in tool ? tool.supportsDetail : undefined;
      const input = withReadDetailInput(tool.inputSchema, supportsDetail);
      const shape = input.shape as Record<string, z.ZodType>;
      if (tool.name === "preview_curation_candidates") {
        expect(supportsDetail).toBe(false);
        expect(shape.detail).toBeUndefined();
      } else {
        expect(shape.detail).toBeDefined();
      }
    }
  });

  it("preserves fixed-shape catalog inputs without a no-op detail field", () => {
    const input = withReadDetailInput(z.object({ limit: z.number() }), false);

    expect(input.shape.detail).toBeUndefined();
  });

  it("defaults limit to 25 only when the route maps limit", () => {
    expect(
      applyReadListDefaults({}, { query: { limit: "limit" } }).limit,
    ).toBe(DEFAULT_PAGE_LIMIT);
    expect(applyReadListDefaults({}, {}).limit).toBeUndefined();
    expect(
      applyReadListDefaults({ limit: 5 }, { query: { limit: "limit" } }).limit,
    ).toBe(5);
  });

  it("does not send detail to the upstream query string", async () => {
    const definition = defineReadCatalogTool({
      name: "list_example_items",
      title: "List example items",
      description: "List example items.",
      inputSchema: z.object({
        limit: z.number().optional(),
      }),
      outputSchema: z
        .object({
          items: z.array(z.object({ uid: z.string() })),
          nextCursor: z.string().nullable(),
          previousCursor: z.string().nullable(),
          hasMore: z.boolean(),
        })
        .passthrough(),
      conciseKeys: ["uid"],
      route: {
        name: "example-items",
        method: "GET",
        path: "/example-items/",
        query: { limit: "limit" },
        response: "page",
        scope: "datasets.read",
        toolset: "datasets",
      },
    });
    const requestPage = vi.fn(async () => ({
      items: [{ uid: "item-1", extra: "drop-me" }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    }));
    let handler:
      | ((args: Record<string, unknown>) => Promise<{
          structuredContent?: Record<string, unknown>;
        }>)
      | undefined;
    registerReadCatalogTool(
      {
        registerTool: (
          _name: string,
          _config: unknown,
          callback: typeof handler,
        ) => {
          handler = callback;
        },
      } as never,
      (() => ({ transport: { requestPage } })) as never,
      definition,
    );

    const result = await handler!({ detail: "concise" });
    expect(requestPage).toHaveBeenCalledWith("/example-items/", {
      limit: "25",
    });
    expect(result.structuredContent).toMatchObject({
      items: [{ uid: "item-1" }],
      has_more: false,
    });
  });
});
