import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerDatasetTools } from "../../src/tools/datasets.js";
import { AuthenticationError, NotFoundError, AvalaError } from "@avala-ai/sdk";

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
    datasets: {
      list: vi.fn(),
      get: vi.fn(),
    },
    projects: { list: vi.fn(), get: vi.fn() },
    exports: { list: vi.fn(), get: vi.fn(), create: vi.fn() },
    tasks: { list: vi.fn(), get: vi.fn() },
  };
}

describe("MCP tool error handling", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerDatasetTools(server as never, avala as never);
  });

  it("propagates AuthenticationError from SDK", async () => {
    avala.datasets.list.mockRejectedValue(new AuthenticationError("Invalid API key"));

    const handler = server.getHandler("list_datasets")!;
    await expect(handler({})).rejects.toThrow(AuthenticationError);
  });

  it("propagates NotFoundError from SDK", async () => {
    avala.datasets.get.mockRejectedValue(new NotFoundError("Dataset not found"));

    const handler = server.getHandler("get_dataset")!;
    await expect(handler({ uid: "nonexistent" })).rejects.toThrow(NotFoundError);
  });

  it("propagates generic AvalaError from SDK", async () => {
    avala.datasets.list.mockRejectedValue(new AvalaError("Something went wrong", 500));

    const handler = server.getHandler("list_datasets")!;
    await expect(handler({})).rejects.toThrow(AvalaError);
  });
});
