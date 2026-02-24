import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerOrganizationTools } from "../../src/tools/organizations.js";

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
    organizations: { list: vi.fn(), get: vi.fn() },
  };
}

describe("organization tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerOrganizationTools(server as never, avala as never);
  });

  it("list_organizations calls avala.organizations.list and returns JSON", async () => {
    const mockPage = {
      items: [{ slug: "acme", name: "Acme Corp", memberCount: 5 }],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.organizations.list.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_organizations")!;
    const result = await handler({});

    expect(avala.organizations.list).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].name).toBe("Acme Corp");
  });

  it("list_organizations passes limit and cursor", async () => {
    avala.organizations.list.mockResolvedValue({ items: [], nextCursor: null, previousCursor: null, hasMore: false });

    const handler = server.getHandler("list_organizations")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.organizations.list).toHaveBeenCalledWith({ limit: 5, cursor: "abc" });
  });

  it("get_organization calls avala.organizations.get and returns JSON", async () => {
    const mockOrg = { slug: "acme", name: "Acme Corp", memberCount: 5, datasetCount: 12 };
    avala.organizations.get.mockResolvedValue(mockOrg);

    const handler = server.getHandler("get_organization")!;
    const result = await handler({ slug: "acme" });

    expect(avala.organizations.get).toHaveBeenCalledWith("acme");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.slug).toBe("acme");
    expect(parsed.memberCount).toBe(5);
  });

  it("registers both list_organizations and get_organization tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_organizations")).toBeDefined();
    expect(server.getHandler("get_organization")).toBeDefined();
  });
});
