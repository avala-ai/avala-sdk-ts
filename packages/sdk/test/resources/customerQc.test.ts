import { afterEach, describe, expect, it, vi } from "vitest";
import { Avala, AvalaError, AuthenticationError, NotFoundError } from "../../src/index.js";

const target = {
  organizationUid: "11111111-1111-4111-8111-111111111111",
  datasetUid: "22222222-2222-4222-8222-222222222222",
  sequenceUid: "33333333-3333-4333-8333-333333333333",
  deliverableId: "cuboids" as const,
};
const context = {
  schema_version: 1,
  evidence_kind: "workflow_metadata_only",
  organization_uid: target.organizationUid,
  dataset_uid: target.datasetUid,
  sequence_uid: target.sequenceUid,
  deliverable_id: target.deliverableId,
  annotation_scope: "cuboid_3d",
  workflow_revision_uid: "44444444-4444-4444-8444-444444444444",
  workflow_definition_sha256: "a".repeat(64),
  state_created_at: "2026-09-14T00:00:00+00:00",
  state_updated_at: "2026-09-14T01:00:00+00:00",
  workflow_state: "finished",
  approval_state: "awaiting_review",
  approval_outcome: "pending",
  available_decisions: [
    { state: "customer_accept", outcome: "approved" },
    { state: "customer_reject", outcome: "rejected" },
  ],
  decision_ready: false,
  blockers: ["annotation_revision_fence_missing", "independent_proposal_approval_missing"],
  context_sha256: "b".repeat(64),
};

function respond(body: unknown = context, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("customerQc inspection-only resource", () => {
  it.each([
    { apiKey: "synthetic-qc-key" },
    { accessToken: "synthetic-qc-access-token" },
  ])("uses the shared GET transport with the supplied credential: %j", async (credential) => {
    const fetchMock = respond();
    const result = await new Avala(credential).customerQc.inspectContext(target);

    expect(result).toEqual({
      schemaVersion: 1,
      evidenceKind: "workflow_metadata_only",
      ...target,
      annotationScope: "cuboid_3d",
      workflowRevisionUid: context.workflow_revision_uid,
      workflowDefinitionSha256: context.workflow_definition_sha256,
      stateCreatedAt: context.state_created_at,
      stateUpdatedAt: context.state_updated_at,
      workflowState: "finished",
      approvalState: "awaiting_review",
      approvalOutcome: "pending",
      availableDecisions: context.available_decisions,
      decisionReady: false,
      blockers: context.blockers,
      contextSha256: context.context_sha256,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://api.avala.ai/api/v1/customer-qc/organizations/${target.organizationUid}` +
      `/datasets/${target.datasetUid}/sequences/${target.sequenceUid}/deliverables/cuboids/context/`,
    );
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("manual");
    const headers = new Headers(init.headers);
    expect(headers.get("X-Avala-Api-Key")).toBe(credential.apiKey ?? null);
    expect(headers.get("Authorization")).toBe(
      credential.accessToken ? `Bearer ${credential.accessToken}` : null,
    );
  });

  it("preserves additional blockers and omits unrecognized response fields", async () => {
    respond({ ...context, blockers: [...context.blockers, "future_blocker"], private_payload: "do-not-return" });
    const result = await new Avala({ apiKey: "synthetic-key" }).customerQc.inspectContext(target);
    expect(result.blockers).toEqual([...context.blockers, "future_blocker"]);
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });

  it.each(["organizationUid", "datasetUid", "sequenceUid", "deliverableId"] as const)(
    "rejects malformed %s before sending a request", async (field) => {
      const fetchMock = respond();
      const client = new Avala({ apiKey: "synthetic-key" });
      for (const value of ["", "../admin", "%2fadmin", "uid?override=1", "uid#fragment", `${target[field]}\n`, null]) {
        await expect(client.customerQc.inspectContext({ ...target, [field]: value } as typeof target))
          .rejects.toThrow("Invalid customer QC target");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["schema_version", 2], ["schema_version", "1"],
    ["evidence_kind", "annotation_snapshot"],
    ["decision_ready", true], ["decision_ready", "false"],
    ["organization_uid", target.datasetUid],
    ["dataset_uid", target.sequenceUid],
    ["sequence_uid", target.organizationUid],
    ["deliverable_id", "segmentation"], ["annotation_scope", "segmentation_3d"],
    ["workflow_revision_uid", "not-a-uuid"], ["workflow_revision_uid", `${context.workflow_revision_uid}\n`],
    ["workflow_definition_sha256", "invalid"], ["context_sha256", "invalid"],
    ["context_sha256", `${context.context_sha256}\n`],
    ["state_created_at", null], ["state_updated_at", 42],
    ["workflow_state", {}], ["approval_state", false], ["approval_outcome", []],
    ["available_decisions", [{ state: "ready", outcome: "changes_requested" }]],
    ["available_decisions", [{ state: null, outcome: "approved" }]],
    ["available_decisions", {}], ["available_decisions", [null]],
    ["blockers", []], ["blockers", [42]],
  ])("fails closed on an unsupported %s response", async (field, value) => {
    respond({ ...context, [field as string]: value });
    const promise = new Avala({ apiKey: "synthetic-key" }).customerQc.inspectContext(target);
    await expect(promise).rejects.toThrow("Invalid customer QC context response");
  });

  it.each([null, [], "private-response-text", {}])("rejects non-context responses: %j", async (value) => {
    respond(value);
    const promise = new Avala({ apiKey: "synthetic-key" }).customerQc.inspectContext(target);
    await expect(promise).rejects.toMatchObject({
      name: "AvalaError", message: "Invalid customer QC context response.", body: undefined,
    });
  });

  it.each(Object.keys(context))("rejects a missing required field: %s", async (field) => {
    const incomplete: Record<string, unknown> = { ...context };
    delete incomplete[field];
    respond(incomplete);
    await expect(new Avala({ apiKey: "synthetic-key" }).customerQc.inspectContext(target))
      .rejects.toThrow("Invalid customer QC context response");
  });

  it("keeps the original target bound while a request is in flight", async () => {
    const mutableTarget = { ...target };
    respond();
    const promise = new Avala({ apiKey: "synthetic-key" }).customerQc.inspectContext(mutableTarget);
    mutableTarget.sequenceUid = target.datasetUid;
    expect((await promise).sequenceUid).toBe(target.sequenceUid);
  });

  it("preserves an empty set of configured transitions without implying readiness", async () => {
    respond({ ...context, available_decisions: [] });
    const result = await new Avala({ apiKey: "synthetic-key" }).customerQc.inspectContext(target);
    expect(result.availableDecisions).toEqual([]);
    expect(result.decisionReady).toBe(false);
  });

  it.each([401, 403, 404])("propagates HTTP %i without a fallback or write", async (status) => {
    const fetchMock = respond({ detail: "Not available." }, status);
    const promise = new Avala({ apiKey: "synthetic-key" }).customerQc.inspectContext(target);
    await expect(promise).rejects.toBeInstanceOf(
      status === 401 ? AuthenticationError : status === 404 ? NotFoundError : AvalaError,
    );
    await expect(promise).rejects.toMatchObject({ statusCode: status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("retains the transport error for invalid JSON rather than claiming a parsed contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new Avala({ apiKey: "synthetic-key" }).customerQc.inspectContext(target))
      .rejects.toBeInstanceOf(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not claim successful-context projection sanitizes upstream HTTP errors", async () => {
    const errorBody = { detail: "Not available.", private_payload: "synthetic-upstream-detail" };
    respond(errorBody, 403);
    await expect(new Avala({ apiKey: "synthetic-key" }).customerQc.inspectContext(target))
      .rejects.toMatchObject({ statusCode: 403, body: errorBody });
  });
});
