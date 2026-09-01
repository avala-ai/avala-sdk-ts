import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMutationConfirmationService } from "../../src/mutations.js";
import { registerWorkforceTools } from "../../src/tools/workforce.js";

type ToolHandler = (args: Record<string, unknown>, context?: unknown) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  resultType?: string;
  requestState?: string;
  inputRequests?: Record<string, unknown>;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  const configs = new Map<string, Record<string, unknown>>();
  return {
    registerTool: vi.fn(
      (
        name: string,
        config: Record<string, unknown>,
        handler: ToolHandler,
      ) => {
        configs.set(name, config);
        handlers.set(name, handler);
      },
    ),
    getHandler: (name: string) => handlers.get(name),
    getConfig: (name: string) => configs.get(name),
  };
}

function workforceOverview() {
  return {
    generatedAt: "2026-08-29T20:00:00Z",
    window: {
      days: 7,
      startsAt: "2026-08-22T20:00:00Z",
      internalCutoff: "private",
    },
    coworkers: {
      total: 12,
      accountStatus: { active: 10, inactive: 2, usernames: ["private"] },
      onboarding: {
        joinedInWindow: 3,
        loggedInInWindow: 8,
        neverLoggedIn: 2,
        phoneVerified: 9,
        phoneUnverified: 3,
        missingProfile: 1,
        emails: ["private@example.com"],
      },
      workRoles: { assignee: 8, reviewer: 4, dataCollection: 2 },
      coworkerRows: [{ username: "+15550000000" }],
    },
    sessions: {
      createdInWindow: 20,
      workersInWindow: 8,
      byStatus: {
        pending: 1,
        ready: 2,
        assigned: 3,
        finished: 13,
        abandoned: 1,
      },
      expiredAssigned: 1,
      assigneeUids: ["private"],
    },
    workQueues: {
      batchesByStatus: { available: 4, unavailable: 2, archived: 1 },
      unitsByStatus: {
        unavailable: 0,
        backlog: 10,
        inProgress: 5,
        inReview: 3,
        completed: 100,
        error: 2,
      },
      unassignedBacklog: 6,
      attentionBatches: [
        {
          batchUid: "00000000000000000000000000000001",
          batchStatus: "available",
          priority: "high",
          errorUnits: 2,
          inReviewUnits: 1,
          name: "Private customer batch",
          url: "https://private.example/batch",
        },
      ],
      configuration: { private: true },
    },
    attention: [
      {
        code: "errored_work_units",
        severity: "blocking",
        count: 2,
        remediation: "Inspect the affected batches.",
        coworkerUid: "private",
      },
    ],
    operatorRoster: [{ email: "private@example.com" }],
  };
}

function workforceBatchAttention() {
  const statusCounts = {
    unavailable: 0,
    backlog: 1,
    inProgress: 0,
    inReview: 0,
    completed: 10,
    error: 1,
  };
  return {
    generatedAt: "2026-08-29T20:00:00Z",
    batchUid: "00000000000000000000000000000001",
    batchStatus: "available" as const,
    priority: "high" as const,
    unitsByStatus: { ...statusCounts, privateRows: ["work-unit-1"] },
    unitsByRole: {
      firstPass: { ...statusCounts, backlog: 0, error: 0 },
      review: { ...statusCounts, completed: 0, workUnitUids: ["private"] },
      escalation: { ...statusCounts, backlog: 0, completed: 0 },
      unspecified: { ...statusCounts, backlog: 0, completed: 0, error: 0 },
      coworkerRows: [{ username: "+15550000000" }],
    },
    queueAge: {
      oldestBacklogUpdatedAt: {
        firstPass: null,
        review: "2026-08-29T19:00:00Z",
        escalation: null,
        unspecified: null,
        coworkerUid: "private",
      },
      oldestErrorUpdatedAt: "2026-08-29T18:00:00Z",
      customerName: "private",
    },
    attention: {
      errorUnits: 1,
      reviewBacklogUnits: 1,
      escalationBacklogUnits: 0,
      assigneeUids: ["private"],
    },
    batchName: "Private customer batch",
    url: "https://private.example/batch",
  };
}

function workforceBatchInventory() {
  return {
    generatedAt: "2026-08-29T20:00:00Z",
    batches: [
      {
        batchUid: "00000000000000000000000000000001",
        batchStatus: "available" as const,
        priority: "high" as const,
        lineContext: {
          organizationUid: "00000000000000000000000000000002" as string | null,
          projectUid: "00000000000000000000000000000003" as string | null,
          datasetUid: "00000000000000000000000000000004" as string | null,
          sequenceUid: "00000000000000000000000000000005" as string | null,
          customerName: "must be stripped",
        },
        unitsByStatus: {
          unavailable: 0,
          backlog: 8,
          inProgress: 3,
          inReview: 2,
          completed: 100,
          error: 1,
          workUnitUids: ["private"],
        },
        createdAt: "2026-08-28T20:00:00Z",
        updatedAt: "2026-08-29T19:58:00Z",
        batchName: "Private customer batch",
        ownerName: "private-customer",
        coworkerRows: [{ username: "+15550000000" }],
        groupName: "private-reviewers",
        url: "https://private.example/batch",
        config: { pay: "private" },
        comments: ["private operational comment"],
      },
    ],
    hasMore: true,
    nextCursor: "00000000000000000000000000000001",
    customerRows: [{ name: "private" }],
  };
}

function workforceGroupCatalog() {
  return {
    generatedAt: "2026-08-31T20:00:00Z",
    groups: [
      {
        groupUid: "00000000000000000000000000000006",
        name: "first-pass-lidar",
        memberCounts: {
          coworkers: 12,
          activeCoworkers: 10,
          activeApprovedCoworkers: 8,
          memberUids: ["must be stripped"],
        },
        members: [
          {
            username: "+15550000000",
            email: "private@example.com",
            payRate: "private",
          },
        ],
        permissions: ["private"],
        performance: { score: 0.99 },
        liveCapacity: 4,
      },
    ],
    hasMore: true,
    nextCursor: "00000000000000000000000000000006",
    memberRows: [{ username: "+15550000000" }],
  };
}

function workforceBatchUnits() {
  return {
    generatedAt: "2026-08-29T20:00:00Z",
    batchUid: "00000000000000000000000000000001",
    batchStatus: "available" as const,
    lineContext: {
      organizationUid: "00000000000000000000000000000002",
      projectUid: "00000000000000000000000000000003",
      datasetUid: "00000000000000000000000000000004",
      sequenceUid: "00000000000000000000000000000005",
      customerName: "must be stripped",
    },
    units: [
      {
        workUnitUid: "00000000000000000000000000000006",
        status: "in_progress" as const,
        taskName: "cuboid" as const,
        workflowRole: "review" as const,
        assigned: true,
        updatedAt: "2026-08-29T19:58:00Z",
        assigneeUid: "private-coworker",
        username: "+15550000000",
        url: "https://private.example/work",
        config: { pay: "private" },
      },
    ],
    hasMore: true,
    nextCursor: "00000000000000000000000000000006",
    coworkerRows: [{ email: "private@example.com" }],
  };
}

function workforceSequenceStatus() {
  return {
    observedAt: "2026-08-29T20:00:00Z",
    sequenceUid: "00000000000000000000000000000005",
    datasetUid: "00000000000000000000000000000004",
    status: "labeling",
    statusLabel: "Labeling",
    updatedAt: "2026-08-29T19:58:00Z",
    workflowRevisionUid: "00000000000000000000000000000008" as
      | string
      | null,
    transitionMode: "sequence" as "sequence" | "deliverable",
    availableTransitions: [
      {
        status: "review",
        label: "Review",
        isTerminal: false,
        internalRule: "must be stripped",
      },
      {
        status: "approved",
        label: "Approved",
        isTerminal: true,
      },
    ],
    sequenceKey: "private/sequence/key",
    workflowDefinition: { private: true },
    customerName: "must be stripped",
  };
}

function workforceAssignmentCandidates(windowDays = 30) {
  const startsAt = new Date(
    Date.parse("2026-08-29T20:00:00Z") - windowDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    generatedAt: "2026-08-29T20:00:00Z",
    batchUid: "00000000000000000000000000000001",
    batchStatus: "available" as const,
    lineContext: {
      organizationUid: "00000000000000000000000000000002",
      projectUid: "00000000000000000000000000000003",
      datasetUid: "00000000000000000000000000000004",
      sequenceUid: "00000000000000000000000000000005",
      customerName: "must be stripped",
    },
    workUnitUid: "00000000000000000000000000000006",
    workUnitStatus: "backlog" as const,
    assigned: false as const,
    updatedAt: "2026-08-29T19:58:00Z",
    signalWindow: {
      days: windowDays,
      startsAt,
      internalCutoff: "private",
    },
    signalScope: {
      taskName: "cuboid" as const,
      workflowRole: "review" as const,
      customerName: "must be stripped",
    },
    candidates: [
      {
        coworkerUid: "00000000000000000000000000000007",
        operationalSignals: {
          completedWorkUnits: 12,
          abandonedWorkUnits: 2,
          erroredWorkUnits: 1,
          lastCompletedAt: "2026-08-29T18:00:00Z" as string | null,
          workUnitUids: ["private"],
          comments: ["private operational comment"],
        },
        username: "+15550000000",
        email: "private@example.com",
        hourlyRate: "private",
        activeWork: { uid: "private" },
        qualityScore: 0.95,
        rank: 1,
      },
    ],
    hasMore: true,
    nextCursor: "00000000000000000000000000000007",
    groupName: "private-reviewers",
  };
}

describe("workforce operations tool", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: { transport: { requestSingle: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    server = createMockServer();
    avala = { transport: { requestSingle: vi.fn() } };
    registerWorkforceTools(server as never, (() => avala) as never);
  });

  it("registers the exact-scope staff overview and maps bounded query inputs", async () => {
    avala.transport.requestSingle.mockResolvedValue(workforceOverview());

    const result = await server.getHandler("get_workforce_operations_overview")!({
      windowDays: 14,
      attentionLimit: 5,
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/admin/workforce/overview/",
      { window_days: "14", attention_limit: "5" },
    );
    expect(server.getConfig("get_workforce_operations_overview")?._meta).toMatchObject({
      "avala.ai/rest-route": "workforce-operations-overview",
      "avala.ai/rest-method": "GET",
      "avala.ai/required-scope": "workforce.read",
      "avala.ai/toolset": "staff",
    });
    expect(result.structuredContent).not.toHaveProperty("operatorRoster");
    expect(result.structuredContent?.coworkers).not.toHaveProperty("coworkerRows");
    expect(result.structuredContent?.workQueues).not.toHaveProperty("configuration");
    expect(
      (result.structuredContent?.workQueues as { attentionBatches: unknown[] })
        .attentionBatches[0],
    ).not.toHaveProperty("name");
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it("uses provider defaults when bounded inputs are omitted", async () => {
    avala.transport.requestSingle.mockResolvedValue(workforceOverview());

    await server.getHandler("get_workforce_operations_overview")!({});

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/admin/workforce/overview/",
    );
  });

  it("pins input bounds and rejects invalid aggregate counts", async () => {
    const inputSchema = server.getConfig("get_workforce_operations_overview")
      ?.inputSchema as {
      shape: Record<string, unknown>;
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(inputSchema.shape.detail).toBeUndefined();
    expect(inputSchema.safeParse({ windowDays: 0 }).success).toBe(false);
    expect(inputSchema.safeParse({ windowDays: 91 }).success).toBe(false);
    expect(inputSchema.safeParse({ attentionLimit: 0 }).success).toBe(false);
    expect(inputSchema.safeParse({ attentionLimit: 26 }).success).toBe(false);

    const invalid = workforceOverview();
    invalid.coworkers.total = -1;
    avala.transport.requestSingle.mockResolvedValue(invalid);

    await expect(
      server.getHandler("get_workforce_operations_overview")!({}),
    ).rejects.toThrow();
  });

  it.each([
    [
      "a malformed attention batch identifier",
      (overview: ReturnType<typeof workforceOverview>) => {
        overview.workQueues.attentionBatches[0]!.batchUid = "not-a-uuid";
      },
    ],
    [
      "more than 25 attention batches",
      (overview: ReturnType<typeof workforceOverview>) => {
        overview.workQueues.attentionBatches = Array.from(
          { length: 26 },
          (_, index) => ({
            ...overview.workQueues.attentionBatches[0]!,
            batchUid: index.toString(16).padStart(32, "0"),
          }),
        );
      },
    ],
    [
      "a non-actionable attention batch",
      (overview: ReturnType<typeof workforceOverview>) => {
        overview.workQueues.attentionBatches[0]!.batchStatus = "archived";
      },
    ],
    [
      "more than three attention signals",
      (overview: ReturnType<typeof workforceOverview>) => {
        overview.attention = Array.from(
          { length: 4 },
          () => overview.attention[0]!,
        );
      },
    ],
  ])("rejects %s from the provider", async (_case, mutate) => {
    const overview = workforceOverview();
    mutate(overview);
    avala.transport.requestSingle.mockResolvedValue(overview);

    await expect(
      server.getHandler("get_workforce_operations_overview")!({}),
    ).rejects.toThrow();
  });

  it("lists bounded production lines with exact filters and strips identity and payload drift", async () => {
    avala.transport.requestSingle.mockResolvedValue(workforceBatchInventory());

    const result = await server.getHandler("list_workforce_batches")!({
      organizationUid: "00000000000000000000000000000002",
      projectUid: "00000000000000000000000000000003",
      datasetUid: "00000000000000000000000000000004",
      sequenceUid: "00000000000000000000000000000005",
      status: "available",
      priority: "high",
      limit: 25,
      cursor: "00000000000000000000000000000006",
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/admin/workforce/batches/",
      {
        organization_uid: "00000000000000000000000000000002",
        project_uid: "00000000000000000000000000000003",
        dataset_uid: "00000000000000000000000000000004",
        sequence_uid: "00000000000000000000000000000005",
        status: "available",
        priority: "high",
        limit: "25",
        cursor: "00000000000000000000000000000006",
      },
    );
    expect(server.getConfig("list_workforce_batches")?._meta).toMatchObject({
      "avala.ai/rest-route": "workforce-batches",
      "avala.ai/rest-method": "GET",
      "avala.ai/required-scope": "workforce.read",
      "avala.ai/toolset": "staff",
    });
    expect(result.structuredContent).not.toHaveProperty("customerRows");
    const batch = (
      result.structuredContent?.batches as Record<string, unknown>[]
    )[0]!;
    expect(batch).toEqual({
      batchUid: "00000000000000000000000000000001",
      batchStatus: "available",
      priority: "high",
      lineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: "00000000000000000000000000000003",
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      unitsByStatus: {
        unavailable: 0,
        backlog: 8,
        inProgress: 3,
        inReview: 2,
        completed: 100,
        error: 1,
      },
      createdAt: "2026-08-28T20:00:00Z",
      updatedAt: "2026-08-29T19:58:00Z",
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it("pins batch-list UUIDs, enums, bounds, null context, and response size", async () => {
    const inputSchema = server.getConfig("list_workforce_batches")
      ?.inputSchema as {
      shape: Record<string, unknown>;
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(inputSchema.shape.detail).toBeUndefined();
    expect(
      inputSchema.safeParse({
        organizationUid: "00000000-0000-0000-0000-000000000002",
        status: "archived",
        priority: "medium",
        limit: 100,
      }).success,
    ).toBe(true);
    expect(inputSchema.safeParse({ organizationUid: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(inputSchema.safeParse({ status: "active" }).success).toBe(false);
    expect(inputSchema.safeParse({ priority: "urgent" }).success).toBe(false);
    expect(inputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(inputSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(inputSchema.safeParse({ includeNames: true }).success).toBe(false);

    const contextless = workforceBatchInventory();
    contextless.batches[0]!.lineContext = {
      organizationUid: null,
      projectUid: null,
      datasetUid: null,
      sequenceUid: null,
      customerName: "must be stripped",
    };
    avala.transport.requestSingle.mockResolvedValue(contextless);
    const contextlessResult = await server.getHandler("list_workforce_batches")!({});
    expect(
      (contextlessResult.structuredContent?.batches as Record<string, unknown>[])[0]!
        .lineContext,
    ).toEqual({
      organizationUid: null,
      projectUid: null,
      datasetUid: null,
      sequenceUid: null,
    });

    const oversized = workforceBatchInventory();
    oversized.batches = Array.from({ length: 101 }, (_, index) => ({
      ...oversized.batches[0]!,
      batchUid: index.toString(16).padStart(32, "0"),
    }));
    avala.transport.requestSingle.mockResolvedValue(oversized);
    await expect(
      server.getHandler("list_workforce_batches")!({}),
    ).rejects.toThrow();
  });

  it("lists workforce groups with exact filters and strips member and permission drift", async () => {
    avala.transport.requestSingle.mockResolvedValue(workforceGroupCatalog());

    const result = await server.getHandler("list_workforce_groups")!({
      search: "lidar",
      hasActiveApprovedCoworkers: true,
      limit: 25,
      cursor: "00000000000000000000000000000005",
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/admin/workforce/groups/",
      {
        search: "lidar",
        has_active_approved_coworkers: "true",
        limit: "25",
        cursor: "00000000000000000000000000000005",
      },
    );
    expect(server.getConfig("list_workforce_groups")?._meta).toMatchObject({
      "avala.ai/rest-route": "workforce-groups",
      "avala.ai/rest-method": "GET",
      "avala.ai/required-scope": "workforce.write",
      "avala.ai/toolset": "staff",
    });
    expect(result.structuredContent).not.toHaveProperty("memberRows");
    const group = (
      result.structuredContent?.groups as Record<string, unknown>[]
    )[0]!;
    expect(group).toEqual({
      groupUid: "00000000000000000000000000000006",
      name: "first-pass-lidar",
      memberCounts: {
        coworkers: 12,
        activeCoworkers: 10,
        activeApprovedCoworkers: 8,
      },
    });
    expect(group).not.toHaveProperty("members");
    expect(group).not.toHaveProperty("permissions");
    expect(group).not.toHaveProperty("performance");
    expect(group).not.toHaveProperty("liveCapacity");
    expect(group.memberCounts).not.toHaveProperty("memberUids");
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it("pins workforce-group search, readiness, UUID, and response bounds", async () => {
    const inputSchema = server.getConfig("list_workforce_groups")
      ?.inputSchema as {
      shape: Record<string, unknown>;
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(inputSchema.shape.detail).toBeUndefined();
    expect(
      inputSchema.safeParse({
        search: " lidar ",
        hasActiveApprovedCoworkers: false,
        limit: 100,
        cursor: "00000000-0000-0000-0000-000000000005",
      }).success,
    ).toBe(true);
    expect(inputSchema.safeParse({ search: " " }).success).toBe(false);
    expect(inputSchema.safeParse({ search: "x".repeat(101) }).success).toBe(false);
    expect(
      inputSchema.safeParse({ hasActiveApprovedCoworkers: "false" }).success,
    ).toBe(false);
    expect(inputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(inputSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(inputSchema.safeParse({ cursor: "not-a-uuid" }).success).toBe(false);
    expect(inputSchema.safeParse({ includeMembers: true }).success).toBe(false);

    const invalidCount = workforceGroupCatalog();
    invalidCount.groups[0]!.memberCounts.activeApprovedCoworkers = -1;
    avala.transport.requestSingle.mockResolvedValueOnce(invalidCount);
    await expect(
      server.getHandler("list_workforce_groups")!({}),
    ).rejects.toThrow();

    const oversized = workforceGroupCatalog();
    oversized.groups = Array.from({ length: 101 }, (_, index) => ({
      ...oversized.groups[0]!,
      groupUid: index.toString(16).padStart(32, "0"),
    }));
    avala.transport.requestSingle.mockResolvedValueOnce(oversized);
    await expect(
      server.getHandler("list_workforce_groups")!({}),
    ).rejects.toThrow();
  });

  it("lists a bounded unit page with exact filters and strips all identity and payload drift", async () => {
    avala.transport.requestSingle.mockResolvedValue(workforceBatchUnits());

    const result = await server.getHandler("list_workforce_batch_units")!({
      batchUid: "00000000000000000000000000000001",
      status: "in_progress",
      assigned: true,
      workflowRole: "review",
      limit: 25,
      cursor: "00000000000000000000000000000007",
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/admin/workforce/batches/00000000000000000000000000000001/units/",
      {
        status: "in_progress",
        assigned: "true",
        workflow_role: "review",
        limit: "25",
        cursor: "00000000000000000000000000000007",
      },
    );
    expect(server.getConfig("list_workforce_batch_units")?._meta).toMatchObject({
      "avala.ai/rest-route": "workforce-batch-units",
      "avala.ai/rest-method": "GET",
      "avala.ai/required-scope": "workforce.read",
      "avala.ai/toolset": "staff",
    });
    expect(result.structuredContent).not.toHaveProperty("coworkerRows");
    expect(result.structuredContent?.lineContext).not.toHaveProperty(
      "customerName",
    );
    const unit = (result.structuredContent?.units as Record<string, unknown>[])[0]!;
    expect(unit).toEqual({
      workUnitUid: "00000000000000000000000000000006",
      status: "in_progress",
      taskName: "cuboid",
      workflowRole: "review",
      assigned: true,
      updatedAt: "2026-08-29T19:58:00Z",
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it("pins unit-list bounds, enums, UUIDs, and fixed response size", async () => {
    const inputSchema = server.getConfig("list_workforce_batch_units")
      ?.inputSchema as {
      shape: Record<string, unknown>;
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(inputSchema.shape.detail).toBeUndefined();
    expect(
      inputSchema.safeParse({
        batchUid: "00000000000000000000000000000001",
        assigned: false,
        limit: 100,
      }).success,
    ).toBe(true);
    expect(
      inputSchema.safeParse({
        batchUid: "00000000000000000000000000000001",
        limit: 101,
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        batchUid: "00000000000000000000000000000001",
        status: "claimed",
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        batchUid: "00000000000000000000000000000001",
        unknownFilter: true,
      }).success,
    ).toBe(false);

    const oversized = workforceBatchUnits();
    oversized.units = Array.from({ length: 101 }, (_, index) => ({
      ...oversized.units[0]!,
      workUnitUid: index.toString(16).padStart(32, "0"),
    }));
    avala.transport.requestSingle.mockResolvedValue(oversized);
    await expect(
      server.getHandler("list_workforce_batch_units")!({
        batchUid: "00000000000000000000000000000001",
      }),
    ).rejects.toThrow();
  });

  it("inspects one exact sequence workflow state and strips provider drift", async () => {
    avala.transport.requestSingle.mockResolvedValue(workforceSequenceStatus());

    const result = await server.getHandler("get_workforce_sequence_status")!({
      sequenceUid: "00000000000000000000000000000005",
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/admin/workforce/sequences/00000000000000000000000000000005/status/",
    );
    expect(
      server.getConfig("get_workforce_sequence_status")?._meta,
    ).toMatchObject({
      "avala.ai/rest-route": "workforce-sequence-status",
      "avala.ai/rest-method": "GET",
      "avala.ai/required-scope": "workforce.read",
      "avala.ai/toolset": "staff",
    });
    expect(result.structuredContent).toEqual({
      observedAt: "2026-08-29T20:00:00Z",
      sequenceUid: "00000000000000000000000000000005",
      datasetUid: "00000000000000000000000000000004",
      status: "labeling",
      statusLabel: "Labeling",
      updatedAt: "2026-08-29T19:58:00Z",
      workflowRevisionUid: "00000000000000000000000000000008",
      transitionMode: "sequence",
      availableTransitions: [
        { status: "review", label: "Review", isTerminal: false },
        { status: "approved", label: "Approved", isTerminal: true },
      ],
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it("pins sequence inspection identifiers, status syntax, transition bounds, and deliverable mode", async () => {
    const inputSchema = server.getConfig("get_workforce_sequence_status")
      ?.inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(
      inputSchema.safeParse({
        sequenceUid: "00000000-0000-0000-0000-000000000005",
      }).success,
    ).toBe(true);
    expect(inputSchema.safeParse({ sequenceUid: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(
      inputSchema.safeParse({
        sequenceUid: "00000000000000000000000000000005",
        includeWorkflowDefinition: true,
      }).success,
    ).toBe(false);

    const deliverable = workforceSequenceStatus();
    deliverable.transitionMode = "deliverable";
    deliverable.availableTransitions = [];
    avala.transport.requestSingle.mockResolvedValue(deliverable);
    const result = await server.getHandler("get_workforce_sequence_status")!({
      sequenceUid: "00000000000000000000000000000005",
    });
    expect(result.structuredContent?.transitionMode).toBe("deliverable");
    expect(result.structuredContent?.workflowRevisionUid).toBe(
      "00000000000000000000000000000008",
    );
    expect(result.structuredContent?.availableTransitions).toEqual([]);

    const oversized = workforceSequenceStatus();
    oversized.availableTransitions = Array.from({ length: 101 }, (_, index) => ({
      status: `state_${index}`,
      label: `State ${index}`,
      isTerminal: false,
      internalRule: "must be stripped",
    }));
    avala.transport.requestSingle.mockResolvedValue(oversized);
    await expect(
      server.getHandler("get_workforce_sequence_status")!({
        sequenceUid: "00000000000000000000000000000005",
      }),
    ).rejects.toThrow();

    const malformed = workforceSequenceStatus();
    malformed.status = "Not A Status";
    avala.transport.requestSingle.mockResolvedValue(malformed);
    await expect(
      server.getHandler("get_workforce_sequence_status")!({
        sequenceUid: "00000000000000000000000000000005",
      }),
    ).rejects.toThrow();
  });

  it("lists bounded opaque assignment candidates under the exact write scope", async () => {
    avala.transport.requestSingle.mockResolvedValue(
      workforceAssignmentCandidates(14),
    );

    const result = await server.getHandler(
      "list_workforce_assignment_candidates",
    )!({
      workUnitUid: "00000000000000000000000000000006",
      windowDays: 14,
      limit: 25,
      cursor: "00000000000000000000000000000008",
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/admin/workforce/work-units/00000000000000000000000000000006/assignment-candidates/",
      {
        window_days: "14",
        limit: "25",
        cursor: "00000000000000000000000000000008",
      },
    );
    expect(
      server.getConfig("list_workforce_assignment_candidates")?._meta,
    ).toMatchObject({
      "avala.ai/rest-route": "workforce-work-unit-assignment-candidates",
      "avala.ai/rest-method": "GET",
      "avala.ai/required-scope": "workforce.write",
      "avala.ai/toolset": "staff",
    });
    expect(result.structuredContent).not.toHaveProperty("groupName");
    expect(result.structuredContent?.lineContext).not.toHaveProperty(
      "customerName",
    );
    expect(result.structuredContent?.signalWindow).toEqual({
      days: 14,
      startsAt: "2026-08-15T20:00:00.000Z",
    });
    expect(result.structuredContent?.signalScope).toEqual({
      taskName: "cuboid",
      workflowRole: "review",
    });
    expect(
      (result.structuredContent?.candidates as Record<string, unknown>[])[0],
    ).toEqual({
      coworkerUid: "00000000000000000000000000000007",
      operationalSignals: {
        completedWorkUnits: 12,
        abandonedWorkUnits: 2,
        erroredWorkUnits: 1,
        lastCompletedAt: "2026-08-29T18:00:00Z",
      },
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it("pins candidate bounds, UUIDs, fixed state, and fixed response size", async () => {
    const inputSchema = server.getConfig("list_workforce_assignment_candidates")
      ?.inputSchema as {
      shape: Record<string, unknown>;
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(inputSchema.shape.detail).toBeUndefined();
    expect(
      inputSchema.safeParse({
        workUnitUid: "00000000000000000000000000000006",
        windowDays: 90,
        limit: 100,
      }).success,
    ).toBe(true);
    expect(
      inputSchema.safeParse({
        workUnitUid: "00000000000000000000000000000006",
        windowDays: 0,
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        workUnitUid: "00000000000000000000000000000006",
        windowDays: 91,
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        workUnitUid: "00000000000000000000000000000006",
        limit: 101,
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        workUnitUid: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        workUnitUid: "00000000000000000000000000000006",
        includeProfiles: true,
      }).success,
    ).toBe(false);

    const oversized = workforceAssignmentCandidates();
    oversized.candidates = Array.from({ length: 101 }, (_, index) => ({
      ...oversized.candidates[0]!,
      coworkerUid: index.toString(16).padStart(32, "0"),
    }));
    avala.transport.requestSingle.mockResolvedValue(oversized);
    await expect(
      server.getHandler("list_workforce_assignment_candidates")!({
        workUnitUid: "00000000000000000000000000000006",
      }),
    ).rejects.toThrow();

    const invalidSignals = workforceAssignmentCandidates();
    invalidSignals.candidates[0]!.operationalSignals.completedWorkUnits = -1;
    avala.transport.requestSingle.mockResolvedValue(invalidSignals);
    await expect(
      server.getHandler("list_workforce_assignment_candidates")!({
        workUnitUid: "00000000000000000000000000000006",
      }),
    ).rejects.toThrow();

    const noHistory = workforceAssignmentCandidates();
    noHistory.candidates[0]!.operationalSignals = {
      ...noHistory.candidates[0]!.operationalSignals,
      completedWorkUnits: 0,
      abandonedWorkUnits: 0,
      erroredWorkUnits: 0,
      lastCompletedAt: null,
    };
    avala.transport.requestSingle.mockResolvedValue(noHistory);
    const result = await server.getHandler(
      "list_workforce_assignment_candidates",
    )!({
      workUnitUid: "00000000000000000000000000000006",
    });
    expect(
      (
        (result.structuredContent?.candidates as Record<string, unknown>[])[0]!
          .operationalSignals as Record<string, unknown>
      ).lastCompletedAt,
    ).toBeNull();
  });

  it("drills into an overview batch through one exact staff route and strips response drift", async () => {
    avala.transport.requestSingle.mockResolvedValue(workforceBatchAttention());

    const result = await server.getHandler("get_workforce_batch_attention")!({
      batchUid: "00000000000000000000000000000001",
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/admin/workforce/batches/00000000000000000000000000000001/attention/",
    );
    expect(server.getConfig("get_workforce_batch_attention")?._meta).toMatchObject({
      "avala.ai/rest-route": "workforce-batch-attention",
      "avala.ai/rest-method": "GET",
      "avala.ai/required-scope": "workforce.read",
      "avala.ai/toolset": "staff",
    });
    expect(result.structuredContent).not.toHaveProperty("batchName");
    expect(result.structuredContent).not.toHaveProperty("url");
    expect(result.structuredContent?.unitsByStatus).not.toHaveProperty(
      "privateRows",
    );
    expect(result.structuredContent?.unitsByRole).not.toHaveProperty(
      "coworkerRows",
    );
    expect(
      (result.structuredContent?.unitsByRole as { review: unknown }).review,
    ).not.toHaveProperty("workUnitUids");
    expect(
      (
        result.structuredContent?.queueAge as {
          oldestBacklogUpdatedAt: unknown;
        }
      ).oldestBacklogUpdatedAt,
    ).not.toHaveProperty("coworkerUid");
    expect(result.structuredContent?.attention).not.toHaveProperty(
      "assigneeUids",
    );
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it("accepts overview and canonical batch UIDs but exposes no detail expansion", () => {
    const inputSchema = server.getConfig("get_workforce_batch_attention")
      ?.inputSchema as {
      shape: Record<string, unknown>;
      safeParse: (value: unknown) => { success: boolean };
    };

    expect(inputSchema.shape.detail).toBeUndefined();
    expect(
      inputSchema.safeParse({
        batchUid: "00000000000000000000000000000001",
      }).success,
    ).toBe(true);
    expect(
      inputSchema.safeParse({
        batchUid: "00000000-0000-0000-0000-000000000001",
      }).success,
    ).toBe(true);
    expect(inputSchema.safeParse({ batchUid: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(
      inputSchema.safeParse({
        batchUid: "00000000-0000-0000-0000-00000000000A",
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      "a negative count",
      (value: ReturnType<typeof workforceBatchAttention>) => {
        value.attention.reviewBacklogUnits = -1;
      },
    ],
    [
      "a malformed timestamp",
      (value: ReturnType<typeof workforceBatchAttention>) => {
        value.queueAge.oldestErrorUpdatedAt = "yesterday";
      },
    ],
    [
      "a malformed response identifier",
      (value: ReturnType<typeof workforceBatchAttention>) => {
        value.batchUid = "not-a-compact-uuid";
      },
    ],
  ])("rejects %s in batch attention output", async (_case, mutate) => {
    const value = workforceBatchAttention();
    mutate(value);
    avala.transport.requestSingle.mockResolvedValue(value);

    await expect(
      server.getHandler("get_workforce_batch_attention")!({
        batchUid: "00000000000000000000000000000001",
      }),
    ).rejects.toThrow();
  });

  it("maps confirmed batch creation to the exact unavailable sequence plan", async () => {
    const mutationServer = createMockServer();
    const requestCreate = vi.fn().mockResolvedValue({
      batchUid: "00000000000000000000000000000001",
      batchStatus: "unavailable",
      priority: "medium",
      createdAt: "2026-08-31T20:01:00Z",
      lineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: null,
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      workUnitsCreated: 2,
      sequenceStatus: "labeling",
      sequenceUpdatedAt: "2026-08-31T19:58:00Z",
      workflowRevisionUid: null,
      reason: "Prepare a reviewed Physical AI labeling production line.",
      batchName: "must be stripped",
      groupNames: ["must be stripped"],
      workUnitUrls: ["https://must-be-stripped.example"],
      configuration: { private: true },
    });
    registerWorkforceTools(
      mutationServer as never,
      (() => ({ transport: { requestCreate } })) as never,
      {
        confirmation: createMutationConfirmationService(
          "workforce-create-test-key",
        ),
        credentialBinding: "staff-credential",
      },
    );
    const handler = mutationServer.getHandler("create_workforce_batch")!;
    const mutationArgs = {
      name: "reviewed-sequence-line",
      projectUid: null,
      sequenceUid: "00000000000000000000000000000005",
      expectedSequenceStatus: "labeling",
      expectedSequenceUpdatedAt: "2026-08-31T19:58:00Z",
      expectedWorkflowRevisionUid: null,
      workUnits: [
        {
          taskName: "cuboid",
          groupUid: "00000000000000000000000000000006",
          workflowRole: "first_pass",
        },
        {
          taskName: "box",
          groupUid: "00000000000000000000000000000007",
        },
      ],
      reason: "Prepare a reviewed Physical AI labeling production line.",
    } as const;
    const context = (
      inputResponses?: Record<string, unknown>,
      requestState?: string,
    ) => ({
      mcpReq: {
        envelope: {},
        inputResponses,
        requestState: () => requestState,
        elicitInput: vi.fn(),
      },
    });
    const inputSchema = mutationServer.getConfig("create_workforce_batch")
      ?.inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };

    expect(inputSchema.safeParse(mutationArgs).success).toBe(true);
    const { projectUid: _projectUid, ...withoutProjectIntent } = mutationArgs;
    expect(inputSchema.safeParse(withoutProjectIntent).success).toBe(false);
    const { expectedWorkflowRevisionUid: _revisionUid, ...withoutRevision } =
      mutationArgs;
    expect(inputSchema.safeParse(withoutRevision).success).toBe(false);
    expect(
      inputSchema.safeParse({ ...mutationArgs, status: "available" }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({ ...mutationArgs, workUnits: [] }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        ...mutationArgs,
        workUnits: [
          {
            ...mutationArgs.workUnits[0],
            workflowRole: "unspecified",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        ...mutationArgs,
        workUnits: [
          {
            ...mutationArgs.workUnits[0],
            url: "https://unreviewed.example/task",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        ...mutationArgs,
        workUnits: Array.from({ length: 101 }, () => mutationArgs.workUnits[0]),
      }).success,
    ).toBe(false);

    const pending = await handler(mutationArgs, context());
    expect(requestCreate).not.toHaveBeenCalled();
    expect(pending.resultType).toBe("input_required");
    expect(pending.requestState).toMatch(/^mc_/);
    expect(JSON.stringify(pending)).toContain("does not release work");
    expect(JSON.stringify(pending)).toContain(
      "1x cuboid/first_pass/group 00000000000000000000000000000006",
    );
    expect(JSON.stringify(pending)).toContain(
      "1x box/unspecified/group 00000000000000000000000000000007",
    );
    if (!pending.requestState) throw new Error("Missing confirmation state.");

    const result = await handler(
      mutationArgs,
      context(
        {
          confirmAvalaMutation: {
            action: "accept",
            content: { confirm: true },
          },
        },
        pending.requestState,
      ),
    );

    expect(requestCreate).toHaveBeenCalledWith(
      "/admin/workforce/batches/create/",
      {
        name: "reviewed-sequence-line",
        project_uid: null,
        sequence_uid: "00000000000000000000000000000005",
        expected_sequence_status: "labeling",
        expected_sequence_updated_at: "2026-08-31T19:58:00Z",
        expected_workflow_revision_uid: null,
        work_units: [
          {
            task_name: "cuboid",
            group_uid: "00000000000000000000000000000006",
            workflow_role: "first_pass",
          },
          {
            task_name: "box",
            group_uid: "00000000000000000000000000000007",
          },
        ],
        reason: "Prepare a reviewed Physical AI labeling production line.",
      },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
    expect(mutationServer.getConfig("create_workforce_batch")).toMatchObject({
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      _meta: {
        "avala.ai/rest-route": "workforce-batch-create",
        "avala.ai/rest-method": "POST",
        "avala.ai/required-scope": "workforce.write",
        "avala.ai/toolset": "staff",
        "avala.ai/requires-confirmation": true,
      },
    });
    expect(result.structuredContent).not.toHaveProperty("batchName");
    expect(result.structuredContent).not.toHaveProperty("groupNames");
    expect(result.structuredContent).not.toHaveProperty("workUnitUrls");
    expect(result.structuredContent).not.toHaveProperty("configuration");
    expect(result.structuredContent).toMatchObject({
      batchUid: "00000000000000000000000000000001",
      batchStatus: "unavailable",
      priority: "medium",
      workUnitsCreated: 2,
      sequenceStatus: "labeling",
      workflowRevisionUid: null,
    });
    expect(result.structuredContent?.reversalGuidance).toContain(
      "cannot be deleted or automatically reversed through MCP",
    );
    expect(result.structuredContent?.reversalGuidance).toContain(
      "set_workforce_batch_status",
    );

    requestCreate.mockResolvedValueOnce({
      ...(result.structuredContent ?? {}),
      lineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: null,
        datasetUid: null,
        sequenceUid: "00000000000000000000000000000005",
      },
    });
    await expect(
      handler(
        mutationArgs,
        context(
          {
            confirmAvalaMutation: {
              action: "accept",
              content: { confirm: true },
            },
          },
          pending.requestState,
        ),
      ),
    ).rejects.toThrow();
  });

  it("maps the confirmed priority mutation to the guarded workforce route", async () => {
    const mutationServer = createMockServer();
    const requestCreate = vi.fn().mockResolvedValue({
      batchUid: "00000000000000000000000000000001",
      batchStatus: "available",
      previousPriority: "medium",
      priority: "high",
      reason: "Meet a scheduled customer delivery.",
      privateBatchName: "must be stripped",
    });
    registerWorkforceTools(
      mutationServer as never,
      (() => ({ transport: { requestCreate } })) as never,
      {
        confirmation: createMutationConfirmationService("workforce-test-key"),
        credentialBinding: "staff-credential",
      },
    );
    const handler = mutationServer.getHandler(
      "set_workforce_batch_priority",
    )!;
    const mutationArgs = {
      batchUid: "00000000000000000000000000000001",
      expectedPriority: "medium",
      priority: "high",
      reason: "Meet a scheduled customer delivery.",
    };
    const context = (inputResponses?: Record<string, unknown>, requestState?: string) => ({
      mcpReq: {
        envelope: {},
        inputResponses,
        requestState: () => requestState,
        elicitInput: vi.fn(),
      },
    });

    const pending = await handler(mutationArgs, context());
    expect(requestCreate).not.toHaveBeenCalled();
    expect(pending.resultType).toBe("input_required");
    expect(pending.requestState).toMatch(/^mc_/);
    if (!pending.requestState) throw new Error("Missing confirmation state.");

    const result = await handler(
      mutationArgs,
      context(
        {
          confirmAvalaMutation: {
            action: "accept",
            content: { confirm: true },
          },
        },
        pending.requestState,
      ),
    );

    expect(requestCreate).toHaveBeenCalledWith(
      "/admin/workforce/batches/00000000000000000000000000000001/priority/",
      {
        expected_priority: "medium",
        priority: "high",
        reason: "Meet a scheduled customer delivery.",
      },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
    expect(mutationServer.getConfig("set_workforce_batch_priority")).toMatchObject({
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      _meta: {
        "avala.ai/rest-route": "workforce-batch-priority",
        "avala.ai/rest-method": "POST",
        "avala.ai/required-scope": "workforce.write",
        "avala.ai/toolset": "staff",
        "avala.ai/requires-confirmation": true,
      },
    });
    expect(result.structuredContent).not.toHaveProperty("privateBatchName");
    expect(result.structuredContent).toMatchObject({
      batchUid: "00000000000000000000000000000001",
      previousPriority: "medium",
      priority: "high",
    });
    expect(result.structuredContent?.reversalGuidance).toContain(
      "expectedPriority=high",
    );
  });

  it("maps a confirmed lifecycle mutation to the guarded status route", async () => {
    const mutationServer = createMockServer();
    const requestCreate = vi.fn().mockResolvedValue({
      batchUid: "00000000000000000000000000000001",
      previousStatus: "unavailable",
      status: "available",
      priority: "high",
      reason: "Open the scheduled labeling production line.",
      privateBatchName: "must be stripped",
    });
    registerWorkforceTools(
      mutationServer as never,
      (() => ({ transport: { requestCreate } })) as never,
      {
        confirmation: createMutationConfirmationService(
          "workforce-status-test-key",
        ),
        credentialBinding: "staff-credential",
      },
    );
    const handler = mutationServer.getHandler("set_workforce_batch_status")!;
    const mutationArgs = {
      batchUid: "00000000000000000000000000000001",
      expectedStatus: "unavailable",
      status: "available",
      reason: "Open the scheduled labeling production line.",
    };
    const context = (
      inputResponses?: Record<string, unknown>,
      requestState?: string,
    ) => ({
      mcpReq: {
        envelope: {},
        inputResponses,
        requestState: () => requestState,
        elicitInput: vi.fn(),
      },
    });
    const inputSchema = mutationServer.getConfig("set_workforce_batch_status")
      ?.inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };

    expect(inputSchema.safeParse(mutationArgs).success).toBe(true);
    expect(
      inputSchema.safeParse({ ...mutationArgs, status: "unavailable" })
        .success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({ ...mutationArgs, force: true }).success,
    ).toBe(false);

    const pending = await handler(mutationArgs, context());
    expect(requestCreate).not.toHaveBeenCalled();
    expect(pending.resultType).toBe("input_required");
    expect(JSON.stringify(pending)).toContain(
      "allows coworkers to claim new backlog units",
    );
    if (!pending.requestState) throw new Error("Missing confirmation state.");

    const result = await handler(
      mutationArgs,
      context(
        {
          confirmAvalaMutation: {
            action: "accept",
            content: { confirm: true },
          },
        },
        pending.requestState,
      ),
    );

    expect(requestCreate).toHaveBeenCalledWith(
      "/admin/workforce/batches/00000000000000000000000000000001/status/",
      {
        expected_status: "unavailable",
        status: "available",
        reason: "Open the scheduled labeling production line.",
      },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
    expect(
      mutationServer.getConfig("set_workforce_batch_status"),
    ).toMatchObject({
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      _meta: {
        "avala.ai/rest-route": "workforce-batch-status",
        "avala.ai/rest-method": "POST",
        "avala.ai/required-scope": "workforce.write",
        "avala.ai/toolset": "staff",
        "avala.ai/requires-confirmation": true,
      },
    });
    expect(result.structuredContent).not.toHaveProperty("privateBatchName");
    expect(result.structuredContent).toMatchObject({
      batchUid: "00000000000000000000000000000001",
      previousStatus: "unavailable",
      status: "available",
      priority: "high",
    });
    expect(result.structuredContent?.reversalGuidance).toContain(
      "expectedStatus=available and status=unavailable",
    );
  });

  it.each([
    ["archived", "available", "allows coworkers to claim new backlog units"],
    ["available", "unavailable", "pauses new claims while in-progress work continues"],
    ["available", "archived", "removes it from active views, and blocks new claims"],
  ])(
    "previews the %s to %s lifecycle effect before approval",
    async (expectedStatus, status, effect) => {
      const mutationServer = createMockServer();
      registerWorkforceTools(
        mutationServer as never,
        (() => ({ transport: { requestCreate: vi.fn() } })) as never,
        {
          confirmation: createMutationConfirmationService(
            "workforce-preview-test-key",
          ),
          credentialBinding: "staff-credential",
        },
      );

      const pending = await mutationServer.getHandler(
        "set_workforce_batch_status",
      )!(
        {
          batchUid: "00000000000000000000000000000001",
          expectedStatus,
          status,
          reason: "Operate the scheduled labeling production line.",
        },
        {
          mcpReq: {
            envelope: {},
            inputResponses: undefined,
            requestState: () => undefined,
            elicitInput: vi.fn(),
          },
        },
      );

      expect(pending.resultType).toBe("input_required");
      expect(JSON.stringify(pending)).toContain(effect);
    },
  );

  it("maps a confirmed custom sequence transition to the exact observed-state route", async () => {
    const mutationServer = createMockServer();
    const requestCreate = vi.fn().mockResolvedValue({
      sequenceUid: "00000000000000000000000000000005",
      datasetUid: "00000000000000000000000000000004",
      previousStatus: "labeling",
      previousStatusLabel: "Labeling",
      status: "review",
      statusLabel: "Review",
      updatedAt: "2026-08-29T20:01:00Z",
      workflowRevisionUid: "00000000000000000000000000000008",
      transitionMode: "sequence",
      availableTransitions: [
        { status: "approved", label: "Approved", isTerminal: true },
      ],
      reason: "Send completed labels into the configured review stage.",
      sequenceKey: "must be stripped",
    });
    registerWorkforceTools(
      mutationServer as never,
      (() => ({ transport: { requestCreate } })) as never,
      {
        confirmation: createMutationConfirmationService(
          "workforce-sequence-status-test-key",
        ),
        credentialBinding: "staff-credential",
      },
    );
    const handler = mutationServer.getHandler(
      "set_workforce_sequence_status",
    )!;
    const mutationArgs = {
      sequenceUid: "00000000000000000000000000000005",
      expectedStatus: "labeling",
      expectedUpdatedAt: "2026-08-29T19:58:00Z",
      expectedWorkflowRevisionUid: "00000000000000000000000000000008",
      status: "review",
      reason: "Send completed labels into the configured review stage.",
    };
    const context = (
      inputResponses?: Record<string, unknown>,
      requestState?: string,
    ) => ({
      mcpReq: {
        envelope: {},
        inputResponses,
        requestState: () => requestState,
        elicitInput: vi.fn(),
      },
    });
    const inputSchema = mutationServer.getConfig(
      "set_workforce_sequence_status",
    )?.inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };

    expect(inputSchema.safeParse(mutationArgs).success).toBe(true);
    expect(
      inputSchema.safeParse({
        ...mutationArgs,
        expectedWorkflowRevisionUid: null,
      }).success,
    ).toBe(true);
    expect(
      inputSchema.safeParse({ ...mutationArgs, status: "labeling" }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({ ...mutationArgs, status: "Review Stage" })
        .success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({ ...mutationArgs, force: true }).success,
    ).toBe(false);

    const pending = await handler(mutationArgs, context());
    expect(requestCreate).not.toHaveBeenCalled();
    expect(pending.resultType).toBe("input_required");
    expect(JSON.stringify(pending)).toContain(
      "may change downstream labeling, review, QC, export, or linked-sequence readiness",
    );
    if (!pending.requestState) throw new Error("Missing confirmation state.");

    const result = await handler(
      mutationArgs,
      context(
        {
          confirmAvalaMutation: {
            action: "accept",
            content: { confirm: true },
          },
        },
        pending.requestState,
      ),
    );

    expect(requestCreate).toHaveBeenCalledWith(
      "/admin/workforce/sequences/00000000000000000000000000000005/status/transition/",
      {
        expected_status: "labeling",
        expected_updated_at: "2026-08-29T19:58:00Z",
        expected_workflow_revision_uid:
          "00000000000000000000000000000008",
        status: "review",
        reason: "Send completed labels into the configured review stage.",
      },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
    expect(
      mutationServer.getConfig("set_workforce_sequence_status"),
    ).toMatchObject({
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      _meta: {
        "avala.ai/rest-route": "workforce-sequence-status-transition",
        "avala.ai/rest-method": "POST",
        "avala.ai/required-scope": "workforce.write",
        "avala.ai/toolset": "staff",
        "avala.ai/requires-confirmation": true,
      },
    });
    expect(result.structuredContent).not.toHaveProperty("sequenceKey");
    expect(result.structuredContent).toMatchObject({
      sequenceUid: "00000000000000000000000000000005",
      previousStatus: "labeling",
      status: "review",
      statusLabel: "Review",
    });
    expect(result.structuredContent?.reversalGuidance).toContain(
      "Reverse only if labeling is listed in availableTransitions",
    );
  });

  it("maps a confirmed deassignment to the exact expected-state route without coworker identity", async () => {
    const mutationServer = createMockServer();
    const requestCreate = vi.fn().mockResolvedValue({
      batchUid: "00000000000000000000000000000001",
      lineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: "00000000000000000000000000000003",
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      workUnitUid: "00000000000000000000000000000006",
      previousStatus: "in_progress",
      status: "backlog",
      assigned: false,
      updatedAt: "2026-08-29T20:01:00Z",
      reason: "Release stalled work for reassignment.",
      previousAssigneeUid: "must be stripped",
    });
    registerWorkforceTools(
      mutationServer as never,
      (() => ({ transport: { requestCreate } })) as never,
      {
        confirmation: createMutationConfirmationService("deassign-test-key"),
        credentialBinding: "staff-credential",
      },
    );
    const handler = mutationServer.getHandler(
      "deassign_workforce_work_unit",
    )!;
    const mutationArgs = {
      workUnitUid: "00000000000000000000000000000006",
      expectedBatchUid: "00000000000000000000000000000001",
      expectedLineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: "00000000000000000000000000000003",
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      expectedStatus: "in_progress",
      expectedUpdatedAt: "2026-08-29T19:58:00Z",
      reason: "Release stalled work for reassignment.",
    } as const;
    const context = (
      inputResponses?: Record<string, unknown>,
      requestState?: string,
    ) => ({
      mcpReq: {
        envelope: {},
        inputResponses,
        requestState: () => requestState,
        elicitInput: vi.fn(),
      },
    });

    const pending = await handler(mutationArgs, context());
    expect(requestCreate).not.toHaveBeenCalled();
    expect(pending.resultType).toBe("input_required");
    expect(pending.requestState).toMatch(/^mc_/);
    expect(
      (
        pending.inputRequests?.confirmAvalaMutation as {
          params: { message: string };
        }
      ).params.message,
    ).toContain("interrupts the current assignment");
    if (!pending.requestState) throw new Error("Missing confirmation state.");

    const result = await handler(
      mutationArgs,
      context(
        {
          confirmAvalaMutation: {
            action: "accept",
            content: { confirm: true },
          },
        },
        pending.requestState,
      ),
    );

    expect(requestCreate).toHaveBeenCalledWith(
      "/admin/workforce/work-units/00000000000000000000000000000006/deassign/",
      {
        expected_batch_uid: "00000000000000000000000000000001",
        expected_line_context: {
          organization_uid: "00000000000000000000000000000002",
          project_uid: "00000000000000000000000000000003",
          dataset_uid: "00000000000000000000000000000004",
          sequence_uid: "00000000000000000000000000000005",
        },
        expected_status: "in_progress",
        expected_updated_at: "2026-08-29T19:58:00Z",
        reason: "Release stalled work for reassignment.",
      },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
    expect(
      mutationServer.getConfig("deassign_workforce_work_unit"),
    ).toMatchObject({
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      _meta: {
        "avala.ai/rest-route": "workforce-work-unit-deassign",
        "avala.ai/rest-method": "POST",
        "avala.ai/required-scope": "workforce.write",
        "avala.ai/toolset": "staff",
        "avala.ai/requires-confirmation": true,
      },
    });
    expect(result.structuredContent).not.toHaveProperty(
      "previousAssigneeUid",
    );
    expect(result.structuredContent).toMatchObject({
      workUnitUid: "00000000000000000000000000000006",
      previousStatus: "in_progress",
      status: "backlog",
      assigned: false,
    });
    expect(result.structuredContent?.reversalGuidance).toContain(
      "never receives their identity",
    );
  });

  it("maps a confirmed assignment to the exact candidate and expected state", async () => {
    const mutationServer = createMockServer();
    const requestCreate = vi.fn().mockResolvedValue({
      batchUid: "00000000000000000000000000000001",
      batchStatus: "available",
      lineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: "00000000000000000000000000000003",
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      workUnitUid: "00000000000000000000000000000006",
      coworkerUid: "00000000000000000000000000000007",
      previousStatus: "backlog",
      status: "in_progress",
      assigned: true,
      updatedAt: "2026-08-29T20:01:00Z",
      reason: "Cover the review queue before delivery.",
      coworkerProfile: { email: "must be stripped" },
    });
    registerWorkforceTools(
      mutationServer as never,
      (() => ({ transport: { requestCreate } })) as never,
      {
        confirmation: createMutationConfirmationService("assign-test-key"),
        credentialBinding: "staff-credential",
      },
    );
    const handler = mutationServer.getHandler("assign_workforce_work_unit")!;
    const mutationArgs = {
      workUnitUid: "00000000000000000000000000000006",
      coworkerUid: "00000000000000000000000000000007",
      expectedBatchUid: "00000000000000000000000000000001",
      expectedBatchStatus: "available",
      expectedLineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: "00000000000000000000000000000003",
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      expectedStatus: "backlog",
      expectedAssigned: false,
      expectedUpdatedAt: "2026-08-29T19:58:00Z",
      reason: "Cover the review queue before delivery.",
    } as const;
    const context = (
      inputResponses?: Record<string, unknown>,
      requestState?: string,
    ) => ({
      mcpReq: {
        envelope: {},
        inputResponses,
        requestState: () => requestState,
        elicitInput: vi.fn(),
      },
    });

    const inputSchema = mutationServer.getConfig("assign_workforce_work_unit")
      ?.inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(inputSchema.safeParse(mutationArgs).success).toBe(true);
    expect(
      inputSchema.safeParse({ ...mutationArgs, expectedAssigned: true }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({ ...mutationArgs, expectedBatchStatus: "archived" })
        .success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        ...mutationArgs,
        expectedLineContext: {
          ...mutationArgs.expectedLineContext,
          organizationUid: null,
        },
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        ...mutationArgs,
        expectedLineContext: {
          ...mutationArgs.expectedLineContext,
          customerUid: "00000000000000000000000000000009",
        },
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({ ...mutationArgs, exposeCoworkerProfile: true })
        .success,
    ).toBe(false);

    const pending = await handler(mutationArgs, context());
    expect(requestCreate).not.toHaveBeenCalled();
    expect(pending.resultType).toBe("input_required");
    expect(pending.requestState).toMatch(/^mc_/);
    expect(
      (
        pending.inputRequests?.confirmAvalaMutation as {
          params: { message: string };
        }
      ).params.message,
    ).toContain("changes the production queue");
    expect(
      (
        pending.inputRequests?.confirmAvalaMutation as {
          params: { message: string };
        }
      ).params.message,
    ).toContain("00000000000000000000000000000007");
    expect(
      (
        pending.inputRequests?.confirmAvalaMutation as {
          params: { message: string };
        }
      ).params.message,
    ).toContain("organization=00000000000000000000000000000002");
    if (!pending.requestState) throw new Error("Missing confirmation state.");

    const result = await handler(
      mutationArgs,
      context(
        {
          confirmAvalaMutation: {
            action: "accept",
            content: { confirm: true },
          },
        },
        pending.requestState,
      ),
    );

    expect(requestCreate).toHaveBeenCalledWith(
      "/admin/workforce/work-units/00000000000000000000000000000006/assign/",
      {
        coworker_uid: "00000000000000000000000000000007",
        expected_batch_uid: "00000000000000000000000000000001",
        expected_batch_status: "available",
        expected_line_context: {
          organization_uid: "00000000000000000000000000000002",
          project_uid: "00000000000000000000000000000003",
          dataset_uid: "00000000000000000000000000000004",
          sequence_uid: "00000000000000000000000000000005",
        },
        expected_status: "backlog",
        expected_assigned: false,
        expected_updated_at: "2026-08-29T19:58:00Z",
        reason: "Cover the review queue before delivery.",
      },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
    expect(mutationServer.getConfig("assign_workforce_work_unit")).toMatchObject({
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      _meta: {
        "avala.ai/rest-route": "workforce-work-unit-assign",
        "avala.ai/rest-method": "POST",
        "avala.ai/required-scope": "workforce.write",
        "avala.ai/toolset": "staff",
        "avala.ai/requires-confirmation": true,
      },
    });
    expect(result.structuredContent).not.toHaveProperty("coworkerProfile");
    expect(result.structuredContent).toMatchObject({
      workUnitUid: "00000000000000000000000000000006",
      coworkerUid: "00000000000000000000000000000007",
      previousStatus: "backlog",
      status: "in_progress",
      assigned: true,
    });
    expect(result.structuredContent?.reversalGuidance).toContain(
      "deassign_workforce_work_unit",
    );
  });

  it("registers only the explicitly allowed workforce mutation subset", () => {
    const mutationServer = createMockServer();
    registerWorkforceTools(
      mutationServer as never,
      (() => ({ transport: { requestCreate: vi.fn() } })) as never,
      {
        confirmation: createMutationConfirmationService("subset-test-key"),
        credentialBinding: "staff-credential",
      },
      new Set(["deassign_workforce_work_unit"]),
    );

    expect(
      mutationServer.getHandler("deassign_workforce_work_unit"),
    ).toBeDefined();
    expect(
      mutationServer.getHandler("set_workforce_batch_priority"),
    ).toBeUndefined();
    expect(
      mutationServer.getHandler("set_workforce_batch_status"),
    ).toBeUndefined();
    expect(
      mutationServer.getHandler("set_workforce_sequence_status"),
    ).toBeUndefined();
    expect(
      mutationServer.getHandler("assign_workforce_work_unit"),
    ).toBeUndefined();
    expect(
      mutationServer.getHandler("create_workforce_batch"),
    ).toBeUndefined();
  });
});
