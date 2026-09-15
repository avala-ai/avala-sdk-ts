import { Avala } from "@avala-ai/sdk";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snakeToCamel } from "../../sdk/src/http.js";
import {
  createAvalaMcpServer,
  REVIEWED_HOSTED_MUTATION_TOOLS,
} from "../src/server.js";
import {
  customerQcTarget as target,
  customerQcWireContext as context,
} from "./fixtures/customer-qc-context.js";

const tool = "inspect_customer_qc_context";
const failureContent = [
  {
    type: "text",
    text: "Customer QC context unavailable. Verify enrollment, access, and the exact target; no decision is authorized.",
  },
];
const closeRuns: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closeRuns.splice(0).map((close) => close()));
  vi.unstubAllGlobals();
});

async function setup({
  payload = context as unknown,
  status = 200,
  scopes = ["datasets.read", "qc.read"],
  toolsets = ["quality"],
  raw = false,
} = {}) {
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://fixture.invalid");
      expect(url.pathname).toBe(
        `/api/v1/customer-qc/organizations/${target.organizationUid}/datasets/${target.datasetUid}/sequences/${target.sequenceUid}/deliverables/cuboids/context/`,
      );
      expect(url.search).toBe("");
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer synthetic-qc-context-token",
      );
      return new Response(raw ? String(payload) : JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  vi.stubGlobal("fetch", fetch);
  const api = new Avala({
    accessToken: "synthetic-qc-context-token",
    baseUrl: "https://fixture.invalid/api/v1",
  });
  const getClient = vi.fn(() => api);
  const server = createAvalaMcpServer(getClient, {
    allowMutations: false,
    allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
    credentialBinding: "synthetic-customer",
    credentialGrant: {
      scopes: new Set(scopes),
      toolsets: new Set(toolsets),
      isStaffPrivileged: false,
    },
  });
  const client = new Client({
    name: "customer-qc-context-test",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeRuns.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, fetch, getClient };
}

describe("customer QC metadata inspection over MCP", () => {
  it("advertises both scopes and a fixed read-only schema, forwarding only the requested GET", async () => {
    const { client, fetch, getClient } = await setup();
    const { tools } = await client.listTools();
    const metadata = tools.find(({ name }) => name === tool)!;
    expect(metadata).toBeDefined();
    expect(metadata.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(metadata._meta).toMatchObject({
      "avala.ai/rest-route": "customer-qc-context",
      "avala.ai/rest-method": "GET",
      "avala.ai/required-scopes": ["datasets.read", "qc.read"],
      "avala.ai/toolset": "quality",
    });
    expect(Object.keys(metadata.inputSchema.properties!)).toEqual(
      Object.keys(target),
    );
    expect(
      tools.every(({ annotations }) => annotations?.readOnlyHint === true),
    ).toBe(true);
    const result = await client.callTool({ name: tool, arguments: target });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(snakeToCamel(context));
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(result.structuredContent, null, 2) },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getClient).toHaveBeenCalledWith(tool);
  });

  it.each([
    { scopes: ["datasets.read"] },
    { scopes: ["qc.read"] },
    { scopes: [] },
    { toolsets: ["datasets"] },
  ])(
    "hides the tool and rejects direct calls before I/O for incomplete grants: %j",
    async (grant) => {
      const { client, fetch, getClient } = await setup(grant);
      expect(
        (await client.listTools()).tools.some(({ name }) => name === tool),
      ).toBe(false);
      await expect(
        client.callTool({ name: tool, arguments: target }),
      ).rejects.toThrow("not found");
      expect(fetch).not.toHaveBeenCalled();
      expect(getClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    { organizationUid: "../elsewhere" },
    { datasetUid: "00000000000000000000000000000002" },
    { sequenceUid: target.sequenceUid + "\n" },
    { sequenceUid: target.sequenceUid.toUpperCase().replace("003", "00A") },
    { deliverableId: "polygons" },
    { detail: "full" },
    { cursor: "more" },
  ])(
    "rejects unsupported targets or controls before I/O: %j",
    async (override) => {
      const { client, fetch } = await setup();
      expect(
        (
          await client.callTool({
            name: tool,
            arguments: { ...target, ...override },
          })
        ).isError,
      ).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("strips future fields, preserves every blocker, and never derives readiness from transitions", async () => {
    const payload = {
      ...context,
      approval_receipt: "private-field",
      annotation_bytes: "private-field",
      media_url: "https://fixture.invalid/private-field",
      blockers: [...context.blockers, "future_blocker"],
      available_decisions: [
        { ...context.available_decisions[0], extra: "private-field" },
      ],
    };
    const { client } = await setup({ payload });
    const result = await client.callTool({ name: tool, arguments: target });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(
      snakeToCamel({ ...context, blockers: payload.blockers }),
    );
    expect(JSON.stringify(result)).not.toContain("private-field");
  });

  it.each([
    { schema_version: 2 },
    { evidence_kind: "annotation_snapshot" },
    { decision_ready: true },
    { annotation_scope: "polygon_3d" },
    { deliverable_id: "polygons" },
    { organization_uid: target.datasetUid },
    { dataset_uid: target.sequenceUid },
    { sequence_uid: target.organizationUid },
    { workflow_revision_uid: "bad-uuid" },
    { context_sha256: "a".repeat(64) + "\n" },
    { workflow_definition_sha256: "bad-hash" },
    { state_updated_at: null },
    { available_decisions: [{ state: "ready", outcome: "unknown" }] },
    { blockers: [] },
    { blockers: [""] },
    { blockers: [null] },
  ])(
    "fails closed for unsupported or mismatched metadata: %j",
    async (override) => {
      const { client, fetch } = await setup({
        payload: { ...context, ...override },
      });
      const result = await client.callTool({ name: tool, arguments: target });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual(failureContent);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(Object.keys(context))(
    "rejects a response missing required field %s",
    async (field) => {
      const payload: Record<string, unknown> = { ...context };
      delete payload[field];
      const { client, fetch } = await setup({ payload });
      const result = await client.callTool({ name: tool, arguments: target });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual(failureContent);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([null, [], "unsupported", 1])(
    "rejects a non-object response: %j",
    async (payload) => {
      const { client } = await setup({ payload });
      const result = await client.callTool({ name: tool, arguments: target });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual(failureContent);
    },
  );

  it.each([401, 403, 404])(
    "does not expose denied payloads or fall back after HTTP %i",
    async (status) => {
      const { client, fetch } = await setup({
        status,
        payload: { detail: "denied-source", private_payload: "denied-source" },
      });
      const result = await client.callTool({ name: tool, arguments: target });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("denied-source");
      expect(result.content).toEqual(failureContent);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not leak malformed JSON through transport error messages", async () => {
    const { client, fetch } = await setup({
      raw: true,
      payload: "private-upstream-payload is not JSON",
    });
    const result = await client.callTool({ name: tool, arguments: target });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-upstream");
    expect(result.content).toEqual(failureContent);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
