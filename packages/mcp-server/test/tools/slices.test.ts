import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerSliceTools } from "../../src/tools/slices.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    slices: { list: vi.fn(), get: vi.fn() },
  };
}

describe("slice tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerSliceTools(server as never, avala as never);
  });

  it("list_slices calls avala.slices.list with owner and options", async () => {
    const mockPage = {
      items: [{ slug: "training-set", name: "Training Set", itemCount: 100 }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.slices.list.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_slices")!;
    const result = await handler({ owner: "acme", limit: 10, cursor: "xyz" });

    expect(avala.slices.list).toHaveBeenCalledWith("acme", { limit: 10, cursor: "xyz" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].slug).toBe("training-set");
  });

  it("list_slices passes owner without optional params", async () => {
    avala.slices.list.mockResolvedValue({ items: [], nextCursor: null, previousCursor: null, hasMore: false });

    const handler = server.getHandler("list_slices")!;
    await handler({ owner: "acme" });

    expect(avala.slices.list).toHaveBeenCalledWith("acme", { limit: undefined, cursor: undefined });
  });

  it("get_slice calls avala.slices.get with owner and slug", async () => {
    const mockSlice = { slug: "training-set", name: "Training Set", itemCount: 100, createdAt: "2025-01-01" };
    avala.slices.get.mockResolvedValue(mockSlice);

    const handler = server.getHandler("get_slice")!;
    const result = await handler({ owner: "acme", slug: "training-set" });

    expect(avala.slices.get).toHaveBeenCalledWith("acme", "training-set");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.slug).toBe("training-set");
    expect(parsed.itemCount).toBe(100);
  });

  it("registers both list_slices and get_slice tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_slices")).toBeDefined();
    expect(server.getHandler("get_slice")).toBeDefined();
  });
});
