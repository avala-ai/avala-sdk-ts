import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerOrganizationTools } from "../../src/tools/organizations.js";

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

const MOCK_ORGANIZATION_LIST_ITEM = {
  uid: "org-1",
  slug: "acme",
  name: "Acme Corp",
  handle: null,
  logo: null,
  industry: "robotics",
  visibility: "private",
  plan: "enterprise",
  isVerified: true,
  isActive: true,
  memberCount: 5,
  teamCount: 2,
  role: "owner",
  billingStatus: "active",
  createdAt: "2025-01-01T00:00:00Z",
  joinedAt: "2025-01-01T00:00:00Z",
  publicSlug: "acme",
};

const MOCK_ORGANIZATION_DETAIL = {
  ...MOCK_ORGANIZATION_LIST_ITEM,
  description: "Robotics team",
  website: "https://example.com",
  email: null,
  phone: null,
  datasetCount: 12,
  projectCount: 3,
  sliceCount: 4,
  allowedDomains: ["example.com"],
  slugEditsRemaining: 3,
  updatedAt: "2025-01-02T00:00:00Z",
};

describe("organization tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    registerOrganizationTools(server as never, (() => avala) as never);
  });

  it("list_organizations dispatches its declared route and returns structured JSON", async () => {
    const mockPage = {
      items: [MOCK_ORGANIZATION_LIST_ITEM],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_organizations")!;
    const result = await handler({});

    expect(avala.transport.requestPage).toHaveBeenCalledWith(
      "/organizations/",
      undefined,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].name).toBe("Acme Corp");
    expect(result.structuredContent).toEqual(mockPage);
  });

  it("list_organizations passes limit and cursor", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_organizations")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith(
      "/organizations/",
      { limit: "5", cursor: "abc" },
    );
  });

  it("get_organization dispatches its declared detail route", async () => {
    avala.transport.requestSingle.mockResolvedValue(MOCK_ORGANIZATION_DETAIL);

    const handler = server.getHandler("get_organization")!;
    const result = await handler({ slug: "acme" });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/organizations/acme/",
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.slug).toBe("acme");
    expect(parsed.memberCount).toBe(5);
  });

  it("registers both list_organizations and get_organization tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_organizations")).toBeDefined();
    expect(server.getHandler("get_organization")).toBeDefined();
  });
});
