import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Avala } from "@avala-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerTools,
  REVIEWED_HOSTED_MUTATION_TOOLS,
} from "../../src/server.js";
import {
  OPERATION_PROPOSAL_SCOPES,
  OPERATION_PROPOSAL_TOOLS,
  registerOperationProposalTools,
} from "../../src/tools/operationProposals.js";

function fixtures(): Record<string, any> {
  return JSON.parse(
    readFileSync(
      new URL("../fixtures/operation-proposals.json", import.meta.url),
      "utf8",
    ),
  );
}
function serverMock() {
  const entries = new Map<
    string,
    { config: any; handler: (...args: any[]) => Promise<any> }
  >();
  return {
    entries,
    registerTool(name: string, config: any, handler: any) {
      entries.set(name, { config, handler });
      return { remove: () => entries.delete(name) };
    },
  };
}
function setup(payload: unknown) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const server = serverMock();
  const client = new Avala({ accessToken: "synthetic-proposal-bearer" });
  registerOperationProposalTools(server as never, () => client, true);
  return { ...server, fetch };
}
afterEach(() => vi.unstubAllGlobals());

describe("Django-owned operation proposal lifecycle", () => {
  const f = fixtures();
  const uid = f.created.uid;
  const version = { proposalUid: uid, expectedVersion: 1 };
  const create = {
    requestId: f.created.request_id,
    workUnitUid: f.created.snapshot.work_unit_uid,
    coworkerUid: f.created.snapshot.coworker_uid,
    reason: f.created.reason,
  };
  const cases = [
    [
      "create_operation_proposal",
      "POST",
      "",
      create,
      "created",
      "operations.proposal.create",
    ],
    [
      "evaluate_operation_proposal",
      "POST",
      `${uid}/evaluate/`,
      version,
      "evaluate",
      "operations.proposal.create",
    ],
    [
      "get_operation_proposal",
      "GET",
      `${uid}/`,
      { proposalUid: uid },
      "approved",
      "operations.proposal.read",
    ],
    [
      "request_operation_approval",
      "POST",
      `${uid}/request-approval/`,
      version,
      "request-approval",
      "operations.approval.request",
    ],
    [
      "execute_approved_operation",
      "POST",
      `${uid}/execute/`,
      version,
      "queued",
      "operations.execution.request",
    ],
    [
      "verify_operation",
      "GET",
      `${uid}/verification/`,
      { proposalUid: uid },
      "verified",
      "operations.verification.read",
    ],
    [
      "reverse_operation",
      "POST",
      `${uid}/reverse/`,
      {
        ...version,
        requestId: f.reversal_blocked.request_id,
        reason: f.reversal_blocked.reason,
      },
      "reversal_blocked",
      "operations.proposal.create",
    ],
    [
      "list_operation_events",
      "GET",
      `${uid}/events/?limit=2&after=0`,
      { proposalUid: uid, limit: 2, after: 0 },
      "events",
      "operations.proposal.read",
    ],
  ] as const;

  it.each(cases.filter(([name]) => name !== "create_operation_proposal"))(
    "%s normalizes accepted UUID casing for Django routing",
    async (name, _method, suffix, input, phase) => {
      const { entries, fetch } = setup(f[phase]);
      const result = await entries.get(name)!.handler({
        ...input,
        proposalUid: uid.toUpperCase(),
      });
      expect(result.isError).not.toBe(true);
      expect(fetch.mock.calls[0]![0]).toBe(
        `https://api.avala.ai/api/v1/admin/workforce/operation-proposals/${suffix}`,
      );
    },
  );

  it.each(cases)(
    "%s uses its exact route/scope and never elicits approval",
    async (name, method, suffix, input, phase, scope) => {
      const { entries, fetch } = setup(f[phase]);
      const { handler, config } = entries.get(name)!;
      const elicitInput = vi.fn();
      const result = await handler(input, { mcpReq: { elicitInput } });
      expect(elicitInput).not.toHaveBeenCalled();
      expect(fetch.mock.calls[0]![0]).toBe(
        `https://api.avala.ai/api/v1/admin/workforce/operation-proposals/${suffix}`,
      );
      expect(fetch.mock.calls[0]![1].method).toBe(method);
      expect(fetch.mock.calls[0]![1].headers.Authorization).toBe(
        "Bearer synthetic-proposal-bearer",
      );
      expect(config._meta).toMatchObject({
        "avala.ai/required-scope": scope,
        "avala.ai/rest-method": method,
        "avala.ai/toolset": "staff",
        "avala.ai/approval-authority": "django-admin-session",
        "avala.ai/requires-confirmation": false,
      });
      expect(config.annotations.readOnlyHint).toBe(method === "GET");
      expect(JSON.parse(result.content[0].text)).toEqual(
        result.structuredContent,
      );
      expect(result.resultType).toBeUndefined();
      if (name === "create_operation_proposal")
        expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
          request_id: create.requestId,
          work_unit_uid: create.workUnitUid,
          coworker_uid: create.coworkerUid,
          reason: create.reason,
        });
      if (name === "execute_approved_operation")
        expect(result.structuredContent.state).toBe("queued");
      if (name === "reverse_operation")
        expect(result.structuredContent.evaluation.decision).toBe("BLOCK");
    },
  );

  it.skipIf(
    !existsSync(new URL("../../../../../../DOCTRINE.md", import.meta.url)),
  )(
    "binds every lifecycle route, method, and scope to the committed Django manifest",
    () => {
      const manifest = JSON.parse(
        readFileSync(
          new URL(
            "../../../../../../server/api_route_manifest.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ) as Record<string, any>[];
      for (const definition of OPERATION_PROPOSAL_TOOLS) {
        const route = manifest.find((row) => row.name === definition.route)!;
        expect(route, definition.name).toBeDefined();
        expect(route.declares_scope).toEqual([definition.scope]);
        expect(route.http_methods ?? route.methods).toContain(
          definition.method.toLowerCase(),
        );
      }
      const candidate = manifest.find(
        (row) => row.name === "workforce-work-unit-assignment-candidates",
      )!;
      expect(candidate.permission_classes).toContain(
        "(HasScope_workforce.write | HasScope_operations.proposal.read)",
      );
    },
  );

  it.each(["created", "reversal_blocked"])(
    "preserves exact canonical hash input for %s",
    async (phase) => {
      const payload = fixtures()[phase];
      const result = await setup(payload)
        .entries.get("get_operation_proposal")!
        .handler({ proposalUid: payload.uid });
      expect(result.structuredContent.snapshotCanonicalJson).toBe(
        payload.snapshot_canonical_json,
      );
      expect(
        createHash("sha256")
          .update(result.structuredContent.snapshotCanonicalJson, "utf8")
          .digest("hex"),
      ).toBe(result.structuredContent.snapshotHash);
    },
  );

  it("rejects altered canonical bytes, hidden canonical fields, duplicate keys and projection drift", async () => {
    for (const corrupt of [
      (p: any) => delete p.snapshot_canonical_json,
      (p: any) => (p.snapshot_canonical_json += " "),
      (p: any) => {
        p.snapshot_canonical_json =
          "{" +
          '\"email\":\"private@pii.invalid\",' +
          p.snapshot_canonical_json.slice(1);
      },
      (p: any) => {
        p.snapshot_canonical_json =
          "{" +
          '\"unit_status\":\"private@pii.invalid\",' +
          p.snapshot_canonical_json.slice(1);
      },
      (p: any) => {
        p.snapshot.unit_status = "changed";
      },
    ]) {
      const payload = fixtures().created;
      corrupt(payload);
      // Updating the hash must not allow hidden canonical text to bypass minimization.
      if (payload.snapshot_canonical_json?.includes("private@pii.invalid")) {
        payload.snapshot_hash = createHash("sha256")
          .update(payload.snapshot_canonical_json, "utf8")
          .digest("hex");
      }
      await expect(
        setup(payload)
          .entries.get("get_operation_proposal")!
          .handler({ proposalUid: payload.uid }),
      ).rejects.toThrow("failed validation");
    }
  });

  it("retains the exact frozen original evidence of a blocked reversal", async () => {
    const payload = fixtures().reversal_blocked;
    const result = await setup(payload)
      .entries.get("reverse_operation")!
      .handler({
        proposalUid: payload.reversal_of_uid,
        expectedVersion: 1,
        requestId: payload.request_id,
        reason: payload.reason,
      });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.snapshot.originalProposalUid).toBe(
      payload.snapshot.original_proposal_uid,
    );
    expect(result.structuredContent.snapshot.originalSnapshot.workUnitUid).toBe(
      payload.snapshot.original_snapshot.work_unit_uid,
    );
    expect(
      result.structuredContent.snapshot.originalExecution.operationEventUid,
    ).toBe(payload.snapshot.original_execution.operation_event_uid);
  });

  it("rejects missing or substituted original reversal evidence", async () => {
    for (const corrupt of [
      (p: any) => delete p.snapshot.original_snapshot,
      (p: any) => {
        p.snapshot.original_proposal_uid = p.uid;
      },
      (p: any) => {
        p.snapshot.original_snapshot.work_unit_uid = p.uid;
      },
    ]) {
      const payload = fixtures().reversal_blocked;
      corrupt(payload);
      await expect(
        setup(payload).entries.get("reverse_operation")!.handler({
          proposalUid: payload.reversal_of_uid,
          expectedVersion: 1,
          requestId: payload.request_id,
          reason: payload.reason,
        }),
      ).rejects.toThrow("failed validation");
    }
  });

  it("reads durable transient retry events and rejects unknown event kinds", async () => {
    const payload = fixtures().retry_events;
    const result = await setup(payload)
      .entries.get("list_operation_events")!
      .handler({ proposalUid: payload.proposal_uid, limit: 100 });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "execution_retry_requested",
          evidence: { code: "transient_database_error" },
        }),
      ]),
    );
    payload.events[0].kind = "unknown_event";
    await expect(
      setup(payload)
        .entries.get("list_operation_events")!
        .handler({ proposalUid: payload.proposal_uid, limit: 100 }),
    ).rejects.toThrow("failed validation");
  });

  it("reads current changed evidence without inventing a new persisted receipt time", async () => {
    const payload = fixtures().verification_current_changed;
    const result = await setup(payload)
      .entries.get("verify_operation")!
      .handler({ proposalUid: payload.uid });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.verifiedAt).toBe(
      fixtures().verified.verified_at,
    );
    expect(result.structuredContent.state).toBe("verified");
    expect(result.structuredContent.verification.status).toBe("changed");
  });

  it("reads authorization-blocked execution events with all 15 rules", async () => {
    const payload = fixtures().events;
    const event = payload.events[1];
    event.kind = "execution_blocked";
    event.actor_uid = null;
    event.actor_source = "system";
    event.evidence.decision = "BLOCK";
    event.evidence.rules.push(
      { code: "independent_approval_current", result: "BLOCK" },
      { code: "requester_active_staff", result: "BLOCK" },
    );
    const result = await setup(payload)
      .entries.get("list_operation_events")!
      .handler({ proposalUid: uid, limit: 2 });
    expect(result.structuredContent.events[1].evidence.rules).toHaveLength(15);
  });

  it("binds a successful create before the central egress scrub changes its reason", async () => {
    const payload = fixtures().created;
    payload.reason =
      "Investigate https://example.invalid/file?X-Amz-Signature=" +
      "a".repeat(64);
    const { fetch } = setup(payload);
    const server = serverMock();
    registerTools(
      server as never,
      () => new Avala({ accessToken: "synthetic-proposal-bearer" }),
      { allowMutations: true },
    );
    const result = await server.entries
      .get("create_operation_proposal")!
      .handler({ ...create, reason: payload.reason });
    expect(JSON.parse(fetch.mock.calls[0]![1].body).reason).toBe(
      payload.reason,
    );
    expect(result.structuredContent.uid).toBe(uid);
    expect(result.structuredContent.reason).not.toBe(payload.reason);
    expect(JSON.stringify(result)).not.toContain("a".repeat(64));
  });

  it("never reflects provider secrets or schema-tainted values in tool errors", async () => {
    const { entries, fetch } = setup(f.queued);
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "private@pii.invalid auth0|private" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(
      entries.get("execute_approved_operation")!.handler(version),
    ).rejects.toThrow("no successful transition is confirmed");
    const payload = fixtures().verified;
    payload.verification.status = "private@pii.invalid";
    await expect(
      setup(payload)
        .entries.get("verify_operation")!
        .handler({ proposalUid: uid }),
    ).rejects.not.toThrow("@pii.invalid");
  });

  it("does not expose an approval tool or removed direct assignment/cancellation in any mode", () => {
    for (const allowMutations of [false, true]) {
      const server = serverMock();
      registerTools(server as never, (() => ({})) as never, { allowMutations });
      for (const name of [
        "approve_operation_proposal",
        "assign_workforce_work_unit",
        "deassign_workforce_work_unit",
      ])
        expect(server.entries.has(name)).toBe(false);
    }
  });

  it("proposal-only credentials discover exact scoped tools and cannot regain legacy writes", () => {
    for (const scope of OPERATION_PROPOSAL_SCOPES) {
      const server = serverMock();
      registerTools(server as never, (() => ({})) as never, {
        allowMutations: false,
        allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
        credentialBinding: "test-binding",
        credentialGrant: {
          scopes: new Set([scope, "workforce.write", "datasets.write"]),
          toolsets: new Set(["staff", "datasets"]),
          isStaffPrivileged: true,
        },
      });
      expect(server.entries.has("set_workforce_batch_priority")).toBe(false);
      expect(server.entries.has("create_dataset")).toBe(false);
      for (const [name, , , , , required] of cases)
        expect(server.entries.has(name), `${scope}: ${name}`).toBe(
          scope === required,
        );
    }
    const server = serverMock();
    registerTools(server as never, (() => ({})) as never, {
      allowMutations: false,
      allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
      credentialBinding: "test-binding",
      credentialGrant: {
        scopes: new Set(OPERATION_PROPOSAL_SCOPES),
        toolsets: new Set(["staff"]),
        isStaffPrivileged: true,
      },
    });
    expect(server.entries.has("list_workforce_assignment_candidates")).toBe(
      true,
    );
    expect(server.entries.size).toBe(9);
  });

  it.each([false, true])(
    "ordinary customer cannot use proposal scopes even if staff toolset drifts: %s",
    (hasToolset) => {
      const server = serverMock();
      registerTools(server as never, (() => ({})) as never, {
        allowMutations: false,
        allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
        credentialBinding: "test-binding",
        credentialGrant: {
          scopes: new Set(OPERATION_PROPOSAL_SCOPES),
          toolsets: new Set(hasToolset ? ["staff"] : []),
          isStaffPrivileged: false,
        },
      });
      expect(server.entries.size).toBe(0);
    },
  );

  it("rejects changed targets, request identity/version, and substituted proposals", async () => {
    for (const [name, input, phase, mutate] of [
      [
        "create_operation_proposal",
        create,
        "created",
        (p: any) => (p.request_id = "a".repeat(32)),
      ],
      [
        "create_operation_proposal",
        create,
        "created",
        (p: any) => (p.snapshot.work_unit_uid = "a".repeat(32)),
      ],
      [
        "get_operation_proposal",
        { proposalUid: uid },
        "created",
        (p: any) => (p.uid = "a".repeat(32)),
      ],
      [
        "evaluate_operation_proposal",
        version,
        "evaluate",
        (p: any) => (p.version = 2),
      ],
      [
        "reverse_operation",
        {
          ...version,
          requestId: f.reversal_blocked.request_id,
          reason: f.reversal_blocked.reason,
        },
        "reversal_blocked",
        (p: any) => (p.reversal_of_uid = "a".repeat(32)),
      ],
    ] as const) {
      const payload = fixtures()[phase];
      mutate(payload);
      await expect(
        setup(payload).entries.get(name)!.handler(input),
      ).rejects.toThrow();
    }
  });

  it("rejects self approval, arbitrary review links, incomplete PASS evidence, and invented verification", async () => {
    for (const mutate of [
      (p: any) => (p.approval.approver_uid = p.requester_uid),
      (p: any) => (p.approval.review_path = "https://attacker.invalid/approve"),
      (p: any) => (p.evaluation.rules = []),
      (p: any) => (p.evaluation.rules[0].result = "BLOCK"),
      (p: any) => (p.evaluation.snapshot_hash = "a".repeat(64)),
      (p: any) => (p.verification.assigned_work_visible = false),
      (p: any) => (p.verification.production_activity = "productive"),
    ]) {
      const payload = fixtures().verified;
      mutate(payload);
      await expect(
        setup(payload)
          .entries.get("verify_operation")!
          .handler({ proposalUid: uid }),
      ).rejects.toThrow();
    }
  });

  it.each(["approved", "queued", "verified"])(
    "rejects %s historical lifecycle without approval and execution evidence",
    async (state) => {
      const payload = fixtures().created;
      payload.state = state;
      await expect(
        setup(payload)
          .entries.get("get_operation_proposal")!
          .handler({ proposalUid: uid }),
      ).rejects.toThrow();
    },
  );

  it("historical verified state can coexist with changed eligibility and still-visible assigned work", async () => {
    const payload = fixtures().verified;
    payload.verification.status = "changed";
    payload.verification.dispatch_eligibility_current = false;
    const result = await setup(payload)
      .entries.get("verify_operation")!
      .handler({ proposalUid: uid });
    expect(result.structuredContent).toMatchObject({
      state: "verified",
      verification: {
        status: "changed",
        assignedWorkVisible: true,
        dispatchEligibilityCurrent: false,
      },
    });
  });

  it("strips nested undeclared identity/contact fields and preserves only the canonical review path", async () => {
    const payload = fixtures().approved;
    function taint(value: any): void {
      if (Array.isArray(value)) value.forEach(taint);
      else if (value && typeof value === "object") {
        Object.values(value).forEach(taint);
        Object.assign(value, {
          email: "private@pii.invalid",
          full_name: "PrivateFamily",
          provider_subject: "auth0|private",
        });
      }
    }
    taint(payload);
    const result = await setup(payload)
      .entries.get("get_operation_proposal")!
      .handler({ proposalUid: uid });
    expect(result.structuredContent.approval.reviewPath).toBe(
      payload.approval.review_path,
    );
    for (const value of ["@pii.invalid", "PrivateFamily", "auth0|"])
      expect(JSON.stringify(result)).not.toContain(value);
  });

  it("binds event pages to the proposal, advancing sequence, and requested limit", async () => {
    for (const mutate of [
      (p: any) => (p.proposal_uid = "a".repeat(32)),
      (p: any) => p.events.reverse(),
      (p: any) => (p.next_after = 0),
      (p: any) => (p.events[1].uid = p.events[0].uid),
      (p: any) => (p.events[0].actor_source = "system"),
    ]) {
      const payload = fixtures().events;
      mutate(payload);
      await expect(
        setup(payload)
          .entries.get("list_operation_events")!
          .handler({ proposalUid: uid, limit: 2 }),
      ).rejects.toThrow();
    }
    await expect(
      setup(fixtures().events)
        .entries.get("list_operation_events")!
        .handler({ proposalUid: uid, limit: 1 }),
    ).rejects.toThrow();
  });

  it("rejects unknown approval/target fields and unsupported versions before network IO", async () => {
    const { entries, fetch } = setup(f.queued);
    for (const input of [
      { ...version, approved: true },
      { ...version, expectedVersion: 2 },
      { ...version, coworkerUid: create.coworkerUid },
    ])
      await expect(
        entries.get("execute_approved_operation")!.handler(input),
      ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves a provider refusal instead of claiming execution", async () => {
    const { entries, fetch } = setup({
      code: "approval_expired",
      detail: "The proposal cannot perform this transition.",
    });
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "approval_expired",
          detail: "The proposal cannot perform this transition.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(
      entries.get("execute_approved_operation")!.handler(version),
    ).rejects.toThrow();
  });
});
