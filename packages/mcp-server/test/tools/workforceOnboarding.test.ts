import { readFileSync } from "node:fs";
import { Avala } from "@avala-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerWorkforceTools } from "../../src/tools/workforce.js";

// Synthetic coworkers, serialized by the actual Django response serializer.
function fixture(): Record<string, any> {
  return JSON.parse(
    readFileSync(
      new URL("../fixtures/onboarding-blockers.json", import.meta.url),
      "utf8",
    ),
  );
}

function setup(payload = fixture()) {
  const configs = new Map<string, any>();
  const handlers = new Map<
    string,
    (args: Record<string, unknown>) => Promise<any>
  >();
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new Avala({ apiKey: "synthetic-onboarding-test" });
  registerWorkforceTools(
    {
      registerTool: (name: string, config: any, handler: any) => {
        configs.set(name, config);
        handlers.set(name, handler);
      },
    } as never,
    () => client,
  );
  const name = "list_blocked_onboarding_coworkers";
  return {
    fetch,
    config: configs.get(name),
    call: (args = {}) => handlers.get(name)!(args),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("onboarding blocker scan", () => {
  it.each(["assign_workforce_work_unit", "create_operation_proposal"])(
    "normalizes the %s rollout recommendation to a durable proposal next step",
    async (name) => {
      const payload = fixture();
      payload.coworkers[0].proposed_action.mcp_tool = name;
      const result = await setup(payload).call();
      expect(result.structuredContent.coworkers[0].proposedAction.mcpTool).toBe(
        "create_operation_proposal",
      );
      expect(JSON.stringify(result)).not.toContain(
        "assign_workforce_work_unit",
      );
    },
  );

  it.each([
    [
      "account",
      "reactivate_account",
      "operations",
      "account_inactive",
      null,
      "account",
      "active",
      "false",
    ],
    [
      "approval",
      "approve_for_work",
      "operations",
      "work_approval_required",
      "account.joined_at",
      "account",
      "approved_for_work",
      "false",
    ],
    [
      "learning_identity",
      "link_learning_identity",
      "support",
      "learning_identity_not_linked",
      "account.joined_at",
      "learning",
      "identity.status",
      "not_linked",
    ],
    [
      "onboarding",
      "establish_onboarding_status",
      "operations",
      "onboarding_status_unavailable",
      "account.joined_at",
      "learning",
      "onboarding.availability",
      "no_record",
    ],
    [
      "onboarding",
      "complete_onboarding",
      "coworker",
      "onboarding_incomplete",
      "learning.learning_access.joined_at",
      "learning",
      "onboarding.status",
      "not_onboarded",
    ],
    [
      "training",
      "complete_required_training",
      "coworker",
      "task_access_not_granted",
      "learning.training.journeys.enrolled_at",
      "learning",
      "training.active_journeys",
      "1",
    ],
    [
      "qualification",
      "grant_qualified_task_access",
      "operations",
      "task_access_not_granted",
      "learning.training.summary.earliest_completed_at",
      "learning",
      "task_access.granted_count",
      "0",
    ],
  ])(
    "preserves stage %s and its authority/owner mapping",
    async (
      stage,
      code,
      owner,
      blockerCode,
      enteredSource,
      source,
      fact,
      observed,
    ) => {
      const payload = fixture();
      payload.coverage = {
        ...payload.coverage,
        scanned_coworkers: 1,
        blocked_coworkers: 1,
        identity_conflicts: 0,
        filtered_below_min_hours: 0,
        global_scan_complete: true,
        blocked_by_stage: Object.fromEntries(
          Object.keys(payload.coverage.blocked_by_stage).map((key) => [
            key,
            key === stage ? 1 : 0,
          ]),
        ),
      };
      const row = payload.coworkers[0];
      const evidence = [{ source, fact, observed }];
      Object.assign(row, {
        current_stage: stage,
        stage_entered_source: enteredSource,
        next_required_step: { code, evidence },
        blocker: { code: blockerCode, evidence },
        proposed_action: {
          code,
          owner,
          requires_human_approval: true,
          mcp_tool: null,
        },
        block_kind:
          owner === "coworker"
            ? "coworker_activity_unknown"
            : "system_or_operations",
      });
      if (stage === "account")
        Object.assign(row, {
          stage_entered_at: null,
          hours_in_stage: null,
          stage_duration_unknown: true,
        });
      payload.coworkers = [row];
      const result = await setup(payload).call();
      expect(result.structuredContent.coverage.globalScanComplete).toBe(true);
      expect(result.structuredContent.coworkers[0].proposedAction.owner).toBe(
        owner,
      );
    },
  );

  it("joins the real serialized provider contract through SDK transport", async () => {
    const { call, fetch, config } = setup();
    const result = await call();
    expect(fetch.mock.calls[0]![0]).toContain(
      "/admin/workforce/coworkers/onboarding-blockers/?limit=10",
    );
    expect(config._meta).toMatchObject({
      "avala.ai/rest-route": "workforce-coworker-onboarding-blockers",
      "avala.ai/rest-method": "GET",
      "avala.ai/required-scope": "workforce.read",
      "avala.ai/toolset": "staff",
    });
    expect(config.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(result.structuredContent.coverage).toMatchObject({
      blockedCoworkers: 2,
      filteredBelowMinHours: 1,
      identityConflicts: 1,
      blockedByStage: { readyForAssignment: 1 },
    });
    expect(result.structuredContent.coworkers[0]).toMatchObject({
      activityStatus: "unknown",
      blocker: null,
      nextRequiredStep: { code: "assign_to_production_work" },
      expectedCapacityEffect: { availability: "not_computed" },
    });
    expect(JSON.parse(result.content[0].text)).toEqual(
      result.structuredContent,
    );
  });

  it("maps all bounded query inputs and documents page-local evidence", async () => {
    const payload = fixture();
    payload.criteria = { min_hours_in_stage: 0, inactive_after_hours: 24 };
    const { call, fetch, config } = setup(payload);
    await call({
      minHoursInStage: 0,
      inactiveAfterHours: 24,
      limit: 3,
      cursor: "00000000-0000-0000-0000-000000000000",
    });
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      min_hours_in_stage: "0",
      inactive_after_hours: "24",
      limit: "3",
      cursor: "00000000-0000-0000-0000-000000000000",
    });
    expect(config.description).toContain("every nextCursor");
    expect(config.description).toContain("get_coworker_journey");
    expect(config.description).toContain("not computed");
  });

  it.each([
    { limit: 11 },
    { minHoursInStage: -1 },
    { minHoursInStage: Infinity },
    { inactiveAfterHours: 0 },
    { cursor: "opaque" },
    { detail: "full" },
    { unknown: true },
  ])("rejects invalid input %j", (input) => {
    expect(
      (setup().config.inputSchema as z.ZodType).safeParse(input).success,
    ).toBe(false);
  });

  it.each([
    ["coverage sum", (p: any) => p.coverage.scanned_coworkers++],
    ["stage sum", (p: any) => p.coverage.blocked_by_stage.training++],
    ["filtered count", (p: any) => p.coverage.filtered_below_min_hours++],
    [
      "global completeness",
      (p: any) => (p.coverage.global_scan_complete = true),
    ],
    ["pagination", (p: any) => (p.has_more = true)],
    ["request criteria", (p: any) => (p.criteria.min_hours_in_stage = 0)],
    [
      "duration unknown",
      (p: any) => (p.coworkers[0].stage_duration_unknown = true),
    ],
    [
      "inactivity without evidence",
      (p: any) => (p.coworkers[0].activity_status = "inactive"),
    ],
    [
      "wrong action owner",
      (p: any) => (p.coworkers[0].proposed_action.owner = "coworker"),
    ],
    [
      "invented action",
      (p: any) =>
        (p.coworkers[0].proposed_action.mcp_tool = "approve_for_work"),
    ],
    [
      "invented capacity",
      (p: any) =>
        (p.coworkers[0].expected_capacity_effect.availability = "available"),
    ],
    [
      "wrong evidence step",
      (p: any) =>
        (p.coworkers[0].next_required_step.code = "complete_onboarding"),
    ],
    ["wrong timestamp", (p: any) => (p.coworkers[0].hours_in_stage = 100)],
    [
      "wrong source",
      (p: any) => (p.coworkers[0].stage_entered_source = "account.joined_at"),
    ],
  ])("fails closed on %s", async (_name, mutate) => {
    const payload = fixture();
    mutate(payload);
    await expect(setup(payload).call()).rejects.toThrow();
  });

  it("retains unknown duration above a duration filter without inventing inactivity", async () => {
    const payload = fixture();
    Object.assign(payload.coworkers[0], {
      stage_entered_at: null,
      hours_in_stage: null,
      stage_duration_unknown: true,
    });
    const result = await setup(payload).call();
    expect(result.structuredContent.coworkers[0].stageDurationUnknown).toBe(
      true,
    );
  });

  it("rejects duplicate coworkers and incorrect ranked/conflict order", async () => {
    for (const reverse of [false, true]) {
      const payload = fixture();
      if (reverse) payload.coworkers.reverse();
      else
        payload.coworkers[1].coworker_uid = payload.coworkers[0].coworker_uid;
      await expect(setup(payload).call()).rejects.toThrow();
    }
  });

  it("orders known durations before shorter and unknown durations within a stage", async () => {
    const payload = fixture();
    const first = payload.coworkers[0];
    const second = structuredClone(first);
    Object.assign(second, {
      coworker_uid: "00000000000000000000000000000002",
      stage_entered_at: "2026-09-02T15:00:00+03:00",
      hours_in_stage: 48,
    });
    payload.coworkers = [first, second];
    Object.assign(payload.coverage, {
      scanned_coworkers: 2,
      identity_conflicts: 0,
      filtered_below_min_hours: 0,
      global_scan_complete: true,
    });
    payload.coverage.blocked_by_stage.approval = 0;
    payload.coverage.blocked_by_stage.ready_for_assignment = 2;
    expect(
      (await setup(payload).call()).structuredContent.coworkers,
    ).toHaveLength(2);
    payload.coworkers.reverse();
    await expect(setup(payload).call()).rejects.toThrow();
    Object.assign(second, {
      stage_entered_at: null,
      hours_in_stage: null,
      stage_duration_unknown: true,
    });
    await expect(setup(payload).call()).rejects.toThrow();
    payload.coworkers.reverse();
    expect(
      (await setup(payload).call()).structuredContent.coworkers[1]
        .stageDurationUnknown,
    ).toBe(true);
  });

  it("does not label an empty terminal continuation globally complete", async () => {
    const payload = fixture();
    payload.coworkers = [];
    Object.assign(payload.coverage, {
      scanned_coworkers: 0,
      blocked_coworkers: 0,
      identity_conflicts: 0,
      filtered_below_min_hours: 0,
    });
    for (const key of Object.keys(payload.coverage.blocked_by_stage))
      payload.coverage.blocked_by_stage[key] = 0;
    const input = { cursor: "00000000000000000000000000000001" };
    expect(
      (await setup(payload).call(input)).structuredContent.coverage
        .globalScanComplete,
    ).toBe(false);
    payload.coverage.global_scan_complete = true;
    await expect(setup(payload).call(input)).rejects.toThrow();
    expect(
      (await setup(payload).call()).structuredContent.coverage
        .globalScanComplete,
    ).toBe(true);
  });

  it("rejects stale cursors, rows before cursor, and over-limit scans", async () => {
    for (const input of [
      { cursor: "00000000000000000000000000000001" },
      { limit: 2 },
    ]) {
      await expect(setup().call(input)).rejects.toThrow();
    }
    const payload = fixture();
    payload.has_more = true;
    payload.next_cursor = "00000000000000000000000000000000";
    await expect(
      setup(payload).call({ cursor: "00000000000000000000000000000000" }),
    ).rejects.toThrow();
  });

  it("strips privacy drift at every output object boundary", async () => {
    const payload = fixture();
    const taint = (value: any): void => {
      if (Array.isArray(value)) value.forEach(taint);
      else if (value && typeof value === "object") {
        Object.values(value).forEach(taint);
        Object.assign(value, {
          email: "private@pii.invalid",
          phone: "+15550001234",
          last_name: "PrivateFamily",
          provider_subject: "auth0|private",
        });
      }
    };
    taint(payload);
    const result = await setup(payload).call();
    for (const privateValue of [
      "@pii.invalid",
      "+1555",
      "PrivateFamily",
      "auth0|",
    ])
      expect(JSON.stringify(result)).not.toContain(privateValue);
  });

  it("propagates a provider failure without a partial success", async () => {
    const { call, fetch } = setup();
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "coworker_onboarding_blockers_provider_unavailable",
          detail: "unavailable",
          retryable: true,
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(call()).rejects.toThrow();
  });

  it.each(["observed", "fact", "source"])(
    "rejects sensitive drift inside existing evidence %s",
    async (field) => {
      for (const privateValue of [
        "+15550001234",
        "private@pii.invalid",
        "auth0|private",
        "PrivateFamily",
      ]) {
        const payload = fixture();
        payload.coworkers[0].next_required_step.evidence[0][field] =
          privateValue;
        await expect(setup(payload).call()).rejects.toThrow();
      }
    },
  );

  it("requires the blocker code associated with the exact next action", async () => {
    const payload = fixture();
    payload.coworkers[0].blocker = {
      code: "account_inactive",
      evidence: [{ source: "account", fact: "active", observed: "false" }],
    };
    await expect(setup(payload).call()).rejects.toThrow();
  });

  it("preserves server microsecond activity evidence at the inactivity threshold", async () => {
    const payload = fixture();
    payload.generated_at = "2026-09-04T12:00:00.123456Z";
    payload.coworkers[0].stage_entered_at = "2026-09-01T12:00:00.123456Z";
    payload.coworkers[0].last_activity_at = "2026-09-01T12:00:00.123455Z";
    payload.coworkers[0].activity_status = "inactive";
    expect(
      (await setup(payload).call()).structuredContent.coworkers[0]
        .activityStatus,
    ).toBe("inactive");
  });
});
