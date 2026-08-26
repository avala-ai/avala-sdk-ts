import { describe, it, expect, vi, beforeEach } from "vitest";
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
  featuredSliceItemUrls: [],
};

describe("slice tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerSliceTools(server as never, (() => avala) as never);
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
    expect(parsed.items[0].slug).toBe("training-set");
    expect(result.structuredContent).toEqual(mockPage);
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
      undefined,
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
    expect(parsed.slug).toBe("training-set");
    expect(parsed.itemCount).toBe(100);
  });

  it("registers both list_slices and get_slice tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_slices")).toBeDefined();
    expect(server.getHandler("get_slice")).toBeDefined();
  });
});
