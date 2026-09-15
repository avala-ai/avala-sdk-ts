import { Avala } from "@avala-ai/sdk";
import { Client } from "@modelcontextprotocol/client";
import {
  InMemoryTransport,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createAvalaMcpServer,
  REVIEWED_HOSTED_MUTATION_TOOLS,
} from "../src/server.js";
import { customerQcWireContext } from "./fixtures/customer-qc-context.js";
import fixture from "./fixtures/customer-qc-journey.json";

// #16353 query/inspect regression only. Real MCP protocol and SDK HTTP parsing,
// synthetic customer grant and upstream responses. This does not test Auth0,
// Django tenant enforcement, a model's reasoning, or an approved QC decision.
const API_BASE = "https://fixture.invalid/api/v1";
const TOKEN = "synthetic-customer-qc-token";
type ContextOutcome = "available" | "denied" | "mismatched" | "decision-ready";

function contextPath(sequenceUid: string, datasetUid: string): string {
  return `/api/v1/customer-qc/organizations/${fixture.organizationUid}/datasets/${datasetUid}/sequences/${sequenceUid}/deliverables/${fixture.deliverableId}/context/`;
}
interface RecordedRequest {
  method: string;
  path: string;
  query: string;
}
const datasetsSchema = z.object({
  items: z.array(
    z.object({ uid: z.string(), slug: z.string(), ownerName: z.string() }),
  ),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
const issuesSchema = z.object({
  items: z.array(
    z.object({
      uid: z.string(),
      status: z.string(),
      severity: z.string(),
      sequenceUid: z.string().nullable(),
      project: z.object({ uid: z.string() }).nullable(),
      datasetItemUid: z.string().nullable(),
      objectUid: z.string().nullable(),
      framesAffected: z.string().nullable(),
      createdAt: z.string(),
      closedAt: z.string().nullable(),
      wrongClass: z.string(),
      correctClass: z.string(),
    }),
  ),
});

afterEach(() => vi.unstubAllGlobals());

async function setup(
  deniedStatus = 404,
  contextOutcome: ContextOutcome = "available",
  issueVariant: "linked" | "nullable" = "linked",
): Promise<{
  client: Client;
  requests: RecordedRequest[];
  close(): Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  const issues = (
    issueVariant === "linked" ? fixture.issues : fixture.nullableIssues
  ).map((issue) => ({
    ...fixture.issueDefaults,
    ...issue,
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      requests.push({ method, path: url.pathname, query: url.search });
      expect(url.origin).toBe("https://fixture.invalid");
      expect(method).toBe("GET");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${TOKEN}`,
      );
      expect(init?.body).toBeUndefined();
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (url.pathname === "/api/v1/datasets/") {
        expect(url.searchParams.get("limit")).toBe("1");
        const cursor = url.searchParams.get("cursor");
        expect([null, "second-page"]).toContain(cursor);
        return json(fixture.datasetPages[cursor === null ? 0 : 1]);
      }
      if (
        url.pathname ===
        `/api/v1/datasets/${fixture.owner}/${fixture.datasetSlug}/annotation-issues/`
      ) {
        expect(url.search).toBe("");
        return json(issues);
      }
      if (
        url.pathname ===
        "/api/v1/datasets/inaccessible-tenant/private-collection/annotation-issues/"
      ) {
        return json(
          {
            detail: "Not available.",
            private_payload: "never-expose-denied-source",
          },
          deniedStatus,
        );
      }
      const sequence =
        /^\/api\/v1\/sequences\/([0-9a-f-]+)\/annotation-issues\/$/.exec(
          url.pathname,
        )?.[1];
      if (sequence) {
        expect(url.searchParams.get("project_uid")).toBe(
          issueVariant === "linked" ? "project-qc" : null,
        );
        expect(url.searchParams.has("cursor")).toBe(false);
        expect(url.searchParams.has("detail")).toBe(false);
        return json(issues.filter((issue) => issue.sequence_uid === sequence));
      }
      const datasetUid = fixture.datasetPages[1]!.results[0]!.uid;
      const context = fixture.workflowContexts.find(
        (row) => url.pathname === contextPath(row.sequence_uid, datasetUid),
      );
      if (context) {
        expect(url.search).toBe("");
        const payload = {
          ...customerQcWireContext,
          organization_uid: fixture.organizationUid,
          dataset_uid: datasetUid,
          deliverable_id: fixture.deliverableId,
          ...context,
        };
        // Fail the second selected target only: one successful context must not
        // disguise a later denial or let cached context A stand in for target B.
        if (
          context.sequence_uid === fixture.workflowContexts[1]!.sequence_uid
        ) {
          if (contextOutcome === "denied")
            return json({ detail: "private-denied-context" }, deniedStatus);
          if (contextOutcome === "mismatched")
            return json({
              ...payload,
              sequence_uid: fixture.workflowContexts[0]!.sequence_uid,
            });
          if (contextOutcome === "decision-ready")
            return json({ ...payload, decision_ready: true, blockers: [] });
        }
        return json(payload);
      }
      throw new Error(
        `Unexpected synthetic fixture request: ${method} ${url.pathname}${url.search}`,
      );
    }),
  );
  const api = new Avala({ accessToken: TOKEN, baseUrl: API_BASE });
  const server = createAvalaMcpServer(() => api, {
    allowMutations: false,
    // Register the hosted mutation candidates too: the customer grant must hide
    // them, rather than this test making their absence true by construction.
    allowedMutationTools: REVIEWED_HOSTED_MUTATION_TOOLS,
    credentialBinding: "synthetic-customer",
    credentialGrant: {
      isStaffPrivileged: false,
      scopes: new Set(["datasets.read", "qc.read"]),
      toolsets: new Set(["datasets", "quality"]),
    },
  });
  const client = new Client({
    name: "synthetic-customer-qc",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    requests,
    close: async (): Promise<void> => {
      await client.close();
      await server.close();
    },
  };
}

async function read(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  return result as CallToolResult;
}

describe("synthetic customer QC query/inspect journey", () => {
  it.each<ContextOutcome>([
    "available",
    "denied",
    "mismatched",
    "decision-ready",
  ])(
    "follows dataset and issue evidence into workflow contexts: %s",
    async (contextOutcome) => {
      const run = await setup(403, contextOutcome);
      try {
        const first = datasetsSchema.parse(
          (await read(run.client, "list_datasets", { limit: 1 }))
            .structuredContent,
        );
        expect(first.hasMore).toBe(true);
        expect(first.nextCursor).toBe("second-page");
        expect(
          first.items.some(
            (dataset) =>
              dataset.slug === fixture.datasetSlug &&
              dataset.ownerName === fixture.owner,
          ),
        ).toBe(false);
        const last = datasetsSchema.parse(
          (
            await read(run.client, "list_datasets", {
              limit: 1,
              cursor: first.nextCursor,
            })
          ).structuredContent,
        );
        expect(last.hasMore).toBe(false);
        expect(last.nextCursor).toBeNull();
        const dataset = last.items.find(
          (item) =>
            item.slug === fixture.datasetSlug &&
            item.ownerName === fixture.owner,
        )!;
        expect(dataset.uid).toBe("00000000-0000-0000-0000-000000000002");
        const listed = await read(
          run.client,
          "list_annotation_issues_by_dataset",
          {
            owner: dataset.ownerName,
            datasetSlug: dataset.slug,
            detail: "full",
          },
        );
        const issues = issuesSchema.parse(listed.structuredContent).items;
        // Issue lists are unpaginated; do not invent continuation or confuse an
        // issue's identity with a mutation-safe annotation revision.
        expect(listed.structuredContent).not.toHaveProperty("nextCursor");
        expect(listed.structuredContent).not.toHaveProperty("hasMore");
        expect(JSON.stringify(listed)).not.toContain(
          "synthetic-reporter-should-be-omitted",
        );
        const asOf = Date.parse(fixture.asOf);
        const selected = issues
          .filter(
            (issue) =>
              issue.status === "open" &&
              issue.severity === "critical" &&
              issue.closedAt === null &&
              Date.parse(issue.createdAt) <= asOf,
          )
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          .slice(0, 2);
        const evidence = [];
        for (const issue of selected) {
          if (issue.sequenceUid === null || issue.project === null) {
            throw new Error(
              "Expected linked fixture; nullable reports are covered separately.",
            );
          }
          const inspected = await read(
            run.client,
            "list_annotation_issues_by_sequence",
            {
              sequenceUid: issue.sequenceUid,
              projectUid: issue.project.uid,
              detail: "full",
            },
          );
          const exact = issuesSchema
            .parse(inspected.structuredContent)
            .items.find((row) => row.uid === issue.uid);
          expect(exact).toEqual(issue);
          expect(exact?.wrongClass).toBe("car");
          expect(exact?.correctClass).toBe("truck");
          expect(inspected.structuredContent).not.toHaveProperty("nextCursor");
          evidence.push({
            uid: issue.uid,
            ageDays: (asOf - Date.parse(issue.createdAt)) / 86_400_000,
            sequenceUid: issue.sequenceUid,
            projectUid: issue.project.uid,
            datasetItemUid: issue.datasetItemUid,
            objectUid: issue.objectUid,
            framesAffected: issue.framesAffected,
          });
        }
        expect(evidence).toEqual(fixture.expected);
        // Explicit synthetic pilot identity: a dataset owner slug is not an organization UUID.
        const observedContexts = [];
        for (const issue of evidence) {
          const context = await run.client.callTool({
            name: "inspect_customer_qc_context",
            arguments: {
              organizationUid: fixture.organizationUid,
              datasetUid: dataset.uid,
              sequenceUid: issue.sequenceUid,
              deliverableId: fixture.deliverableId,
            },
          });
          if (contextOutcome !== "available" && issue.uid === "issue-second") {
            expect(context.isError).toBe(true);
            expect(context.structuredContent).toBeUndefined();
            expect(context.content).toEqual([
              {
                type: "text",
                text: "Customer QC context unavailable. Verify enrollment, access, and the exact target; no decision is authorized.",
              },
            ]);
            expect(JSON.stringify(context)).not.toContain(
              "private-denied-context",
            );
            expect(observedContexts).toHaveLength(1);
            continue;
          }
          expect(context.isError).not.toBe(true);
          const source = fixture.workflowContexts.find(
            (row) => row.sequence_uid === issue.sequenceUid,
          )!;
          expect(context.structuredContent).toMatchObject({
            organizationUid: fixture.organizationUid,
            datasetUid: dataset.uid,
            sequenceUid: issue.sequenceUid,
            deliverableId: fixture.deliverableId,
            evidenceKind: "workflow_metadata_only",
            decisionReady: false,
            workflowRevisionUid: source.workflow_revision_uid,
            workflowState: source.workflow_state,
            contextSha256: source.context_sha256,
            availableDecisions: source.available_decisions,
            blockers: source.blockers,
          });
          expect(context.content).toEqual([
            {
              type: "text",
              text: JSON.stringify(context.structuredContent, null, 2),
            },
          ]);
          expect(context.structuredContent).not.toHaveProperty("objectUid");
          expect(context.structuredContent).not.toHaveProperty("nextCursor");
          observedContexts.push(context.structuredContent);
        }
        expect(observedContexts).toHaveLength(
          contextOutcome === "available" ? 2 : 1,
        );
        expect(run.requests).toEqual([
          { method: "GET", path: "/api/v1/datasets/", query: "?limit=1" },
          {
            method: "GET",
            path: "/api/v1/datasets/",
            query: "?limit=1&cursor=second-page",
          },
          {
            method: "GET",
            path: "/api/v1/datasets/synthetic-tenant/synthetic-warehouse/annotation-issues/",
            query: "",
          },
          {
            method: "GET",
            path: `/api/v1/sequences/${fixture.expected[0]!.sequenceUid}/annotation-issues/`,
            query: "?project_uid=project-qc",
          },
          {
            method: "GET",
            path: `/api/v1/sequences/${fixture.expected[1]!.sequenceUid}/annotation-issues/`,
            query: "?project_uid=project-qc",
          },
          {
            method: "GET",
            path: contextPath(fixture.expected[0]!.sequenceUid, dataset.uid),
            query: "",
          },
          {
            method: "GET",
            path: contextPath(fixture.expected[1]!.sequenceUid, dataset.uid),
            query: "",
          },
        ]);
      } finally {
        await run.close();
      }
    },
  );

  it("retains item-only reports and omits an absent project filter without inventing a sequence", async () => {
    const run = await setup(404, "available", "nullable");
    try {
      const listed = await read(
        run.client,
        "list_annotation_issues_by_dataset",
        {
          owner: fixture.owner,
          datasetSlug: fixture.datasetSlug,
          detail: "full",
        },
      );
      const issues = issuesSchema.parse(listed.structuredContent).items;
      expect(issues.map((issue) => issue.uid)).toEqual([
        "issue-item-only",
        "issue-without-project",
      ]);
      const reported = [];
      for (const issue of issues) {
        if (issue.sequenceUid === null) {
          reported.push({ issue, contextUnavailable: "sequence_uid_missing" });
          continue;
        }
        const inspected = await read(
          run.client,
          "list_annotation_issues_by_sequence",
          {
            sequenceUid: issue.sequenceUid,
            ...(issue.project === null
              ? {}
              : { projectUid: issue.project.uid }),
            detail: "full",
          },
        );
        expect(issuesSchema.parse(inspected.structuredContent).items).toEqual([
          issue,
        ]);
        const context = await read(run.client, "inspect_customer_qc_context", {
          organizationUid: fixture.organizationUid,
          datasetUid: fixture.datasetPages[1]!.results[0]!.uid,
          sequenceUid: issue.sequenceUid,
          deliverableId: fixture.deliverableId,
        });
        expect(context.structuredContent).toMatchObject({
          sequenceUid: issue.sequenceUid,
          decisionReady: false,
        });
        reported.push({ issue, context: context.structuredContent });
      }
      expect(reported).toHaveLength(2);
      expect(reported[0]).toEqual({
        issue: expect.objectContaining({
          uid: "issue-item-only",
          datasetItemUid: "item-without-sequence",
          sequenceUid: null,
          project: null,
          objectUid: null,
          framesAffected: null,
        }),
        contextUnavailable: "sequence_uid_missing",
      });
      expect(reported[1]?.issue).toMatchObject({
        uid: "issue-without-project",
        project: null,
        datasetItemUid: null,
      });
      expect(run.requests).toEqual([
        {
          method: "GET",
          path: `/api/v1/datasets/${fixture.owner}/${fixture.datasetSlug}/annotation-issues/`,
          query: "",
        },
        {
          method: "GET",
          path: `/api/v1/sequences/${fixture.nullableIssues[1]!.sequence_uid}/annotation-issues/`,
          query: "",
        },
        {
          method: "GET",
          path: contextPath(
            fixture.workflowContexts[0]!.sequence_uid,
            fixture.datasetPages[1]!.results[0]!.uid,
          ),
          query: "",
        },
      ]);
    } finally {
      await run.close();
    }
  });

  it.each([403, 404])(
    "surfaces an inaccessible-source HTTP %i as an error, not an empty QC queue",
    async (status) => {
      const run = await setup(status);
      try {
        const result = await run.client.callTool({
          name: "list_annotation_issues_by_dataset",
          arguments: {
            owner: "inaccessible-tenant",
            datasetSlug: "private-collection",
            detail: "full",
          },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain(
          "never-expose-denied-source",
        );
        expect(JSON.stringify(result)).not.toContain(TOKEN);
        expect(run.requests).toHaveLength(1);
      } finally {
        await run.close();
      }
    },
  );

  it("hides staff and mutation tools and refuses direct calls without reaching the API", async () => {
    const run = await setup();
    try {
      const { tools } = await run.client.listTools();
      expect(tools.map((tool) => tool.name)).toContain(
        "list_annotation_issues_by_dataset",
      );
      for (const tool of tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool._meta?.["avala.ai/toolset"]).not.toBe("staff");
        expect(REVIEWED_HOSTED_MUTATION_TOOLS.has(tool.name)).toBe(false);
      }
      for (const name of [
        "staff_query",
        "get_workforce_operations_overview",
        "create_operation_proposal",
        "update_annotation_issue",
      ]) {
        expect(tools.map((tool) => tool.name)).not.toContain(name);
        await expect(
          run.client.callTool({ name, arguments: {} }),
        ).rejects.toThrow(`Tool ${name} not found`);
      }
      expect(run.requests).toEqual([]);
    } finally {
      await run.close();
    }
  });
});
