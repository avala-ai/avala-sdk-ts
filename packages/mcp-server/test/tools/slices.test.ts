import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAssetHandleService } from "../../src/assetHandles.js";
import { registerSliceTools } from "../../src/tools/slices.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn(
      (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    ),
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    ),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    transport: { requestPage: vi.fn(), requestSingle: vi.fn() },
  };
}

const MOCK_SLICE = {
  uid: "slice-1",
  slug: "training-set",
  name: "Training Set",
  ownerName: "acme",
  organization: null,
  visibility: "private",
  status: "created",
  itemCount: 100,
  subSlices: [],
  sourceData: [],
  featuredSliceItemUrls: [
    "https://bucket.example/item.jpg?X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=signature-value",
  ],
};

describe("slice tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;
  let assetHandles: ReturnType<typeof createAssetHandleService>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    assetHandles = createAssetHandleService("slice-tools-test-key");
    registerSliceTools(
      server as never,
      (() => avala) as never,
      assetHandles,
    );
  });

  it("list_slices dispatches its declared route with pagination", async () => {
    const mockPage = {
      items: [MOCK_SLICE],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_slices")!;
    const result = await handler({ owner: "acme", limit: 10, cursor: "xyz" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith(
      "/slices/acme/list/",
      {
        limit: "10",
        cursor: "xyz",
      },
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0]).toMatchObject({
      uid: "slice-1",
      slug: "training-set",
      name: "Training Set",
      ownerName: "acme",
      visibility: "private",
      status: "created",
      itemCount: 100,
      assetCount: 100,
    });
    expect(parsed.items[0]).not.toHaveProperty("featuredSliceItemUrls");
    expect(parsed.items[0]).not.toHaveProperty("subSlices");
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_cursor).toBeNull();
    expect(result.structuredContent).toEqual(parsed);
  });

  it("list_slices passes owner without optional params", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_slices")!;
    await handler({ owner: "acme" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith(
      "/slices/acme/list/",
      { limit: "25" },
    );
  });

  it("get_slice dispatches its declared detail route", async () => {
    avala.transport.requestSingle.mockResolvedValue(MOCK_SLICE);

    const handler = server.getHandler("get_slice")!;
    const result = await handler({ owner: "acme", slug: "training-set" });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/slices/acme/training-set/",
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({
      uid: "slice-1",
      slug: "training-set",
      itemCount: 100,
      assetCount: 100,
    });
    expect(parsed).not.toHaveProperty("featuredSliceItemUrls");
    expect(parsed).not.toHaveProperty("sourceData");
  });

  it("detail=full returns opaque featured-item handles instead of URLs", async () => {
    avala.transport.requestSingle.mockResolvedValue(MOCK_SLICE);

    const result = await server.getHandler("get_slice")!({
      owner: "acme",
      slug: "training-set",
      detail: "full",
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).not.toHaveProperty("featuredSliceItemUrls");
    expect(parsed.featuredSliceItemAssets[0].handle).toMatch(/^ah_/);
    expect(
      assetHandles.open(parsed.featuredSliceItemAssets[0].handle),
    ).toMatchObject({
      kind: "slice_featured_asset",
      owner: "acme",
      slug: "training-set",
    });
    expect(result.content[0].text).not.toContain("X-Amz-");
  });

  it("registers both list_slices and get_slice tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_slices")).toBeDefined();
    expect(server.getHandler("get_slice")).toBeDefined();
  });
});
