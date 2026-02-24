import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("organizations resource", () => {
  const mockOrganization = {
    uid: "org-uid-001",
    name: "Acme Corp",
    slug: "acme-corp",
    handle: "acme",
    description: "An example organization",
    logo: null,
    website: "https://acme.com",
    industry: "technology",
    email: "info@acme.com",
    phone: null,
    visibility: "private",
    plan: "pro",
    is_verified: true,
    is_active: true,
    member_count: 5,
    team_count: 2,
    dataset_count: 10,
    project_count: 3,
    slice_count: 1,
    role: "owner",
    joined_at: "2026-01-01T00:00:00Z",
    allowed_domains: ["acme.com"],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };

  const mockListResponse = {
    results: [mockOrganization],
    next: "https://api.avala.ai/api/v1/organizations/?cursor=abc123",
    previous: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists organizations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockListResponse),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.organizations.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("Acme Corp");
    expect(page.items[0].slug).toBe("acme-corp");
    expect(page.items[0].isVerified).toBe(true);
    expect(page.items[0].memberCount).toBe(5);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("abc123");
  });

  it("gets a single organization", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockOrganization),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const org = await avala.organizations.get("acme-corp");

    expect(org.uid).toBe("org-uid-001");
    expect(org.name).toBe("Acme Corp");
    expect(org.isActive).toBe(true);
    expect(org.datasetCount).toBe(10);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/organizations/acme-corp/");
  });

  it("creates an organization with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockOrganization),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const org = await avala.organizations.create({
      name: "Acme Corp",
      description: "An example organization",
      website: "https://acme.com",
      industry: "technology",
    });

    expect(org.name).toBe("Acme Corp");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.name).toBe("Acme Corp");
    expect(body.description).toBe("An example organization");
    expect(body.website).toBe("https://acme.com");
    expect(body.industry).toBe("technology");
  });

  it("deletes an organization", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
        json: () => Promise.resolve(undefined),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    await avala.organizations.delete("acme-corp");

    expect(fetch).toHaveBeenCalledTimes(1);
    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].method).toBe("DELETE");
    expect(callArgs[0]).toContain("/organizations/acme-corp/");
  });

  it("lists members with correct field names", async () => {
    const mockMember = {
      user_uid: "user-uid-001",
      username: "alice",
      email: "alice@acme.com",
      full_name: "Alice Smith",
      picture: null,
      role: "admin",
      created_at: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [mockMember], next: null, previous: null }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.organizations.listMembers("acme-corp");

    expect(page.items).toHaveLength(1);
    expect(page.items[0].userUid).toBe("user-uid-001");
    expect(page.items[0].username).toBe("alice");
    expect(page.items[0].fullName).toBe("Alice Smith");
    expect(page.items[0].role).toBe("admin");
    expect(page.hasMore).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/organizations/acme-corp/members/");
  });

  it("lists teams with slug field (non-paginated)", async () => {
    const mockTeam = {
      uid: "team-uid-001",
      name: "Engineering",
      slug: "engineering",
      description: "The engineering team",
      member_count: 3,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([mockTeam]),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const teams = await avala.organizations.listTeams("acme-corp");

    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe("Engineering");
    expect(teams[0].slug).toBe("engineering");
    expect(teams[0].memberCount).toBe(3);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/organizations/acme-corp/teams/");
  });

  it("gets a team using teamSlug in URL path", async () => {
    const mockTeam = {
      uid: "team-uid-001",
      name: "Engineering",
      slug: "engineering",
      description: "The engineering team",
      member_count: 3,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockTeam),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const team = await avala.organizations.getTeam("acme-corp", "engineering");

    expect(team.name).toBe("Engineering");
    expect(team.slug).toBe("engineering");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/organizations/acme-corp/teams/engineering/");
  });

  it("leave uses correct path without /members/ segment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
        json: () => Promise.resolve(undefined),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    await avala.organizations.leave("acme-corp");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/organizations/acme-corp/leave/");
    expect(callArgs[0]).not.toContain("/members/leave/");
  });

  it("transferOwnership uses correct path without /members/ segment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
        json: () => Promise.resolve(undefined),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    await avala.organizations.transferOwnership("acme-corp", { newOwnerUid: "user-uid-001" });

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/organizations/acme-corp/transfer-ownership/");
    expect(callArgs[0]).not.toContain("/members/transfer-ownership/");
  });

  it("creates a team with snake_case body", async () => {
    const mockTeam = {
      uid: "team-uid-001",
      name: "Engineering",
      description: "The engineering team",
      member_count: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockTeam),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const team = await avala.organizations.createTeam("acme-corp", {
      name: "Engineering",
      description: "The engineering team",
    });

    expect(team.name).toBe("Engineering");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.name).toBe("Engineering");
    expect(body.description).toBe("The engineering team");
    expect(callArgs[0]).toContain("/organizations/acme-corp/teams/");
  });

  it("lists invitations with correct field names (non-paginated)", async () => {
    const mockInvitation = {
      uid: "inv-uid-001",
      organization_name: "Acme Corp",
      organization_slug: "acme-corp",
      invited_email: "bob@acme.com",
      invited_by_username: "alice",
      role: "member",
      status: "pending",
      expires_at: "2026-02-01T00:00:00Z",
      is_expired: false,
      accept_url: "https://avala.ai/organizations/invitations/token123/accept",
      copy_link: "https://avala.ai/organizations/invitations/token123/accept",
      created_at: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([mockInvitation]),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const invitations = await avala.organizations.listInvitations("acme-corp");

    expect(invitations).toHaveLength(1);
    expect(invitations[0].invitedEmail).toBe("bob@acme.com");
    expect(invitations[0].organizationName).toBe("Acme Corp");
    expect(invitations[0].invitedByUsername).toBe("alice");
    expect(invitations[0].status).toBe("pending");
    expect(invitations[0].isExpired).toBe(false);
  });
});
