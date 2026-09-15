import { Avala } from "@avala-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerWorkforceSessionMonitoringTools,
  WORKFORCE_SESSION_MONITORING_TOOLS,
} from "../../src/tools/workforceSessionMonitoring.js";
import sessionFixture from "../fixtures/session-monitoring.json";
import stationFixture from "../fixtures/station-monitoring.json";

// Synthetic source rows rendered by the frozen Django serializers. These are
// transport-contract fixtures, not hosted observations or an agent baseline.
type SessionPayload = Omit<typeof sessionFixture, "next_cursor"> & {
  next_cursor: string | null;
};

const SESSION = "get_workforce_session_monitoring";
const STATION = "get_workforce_station_monitoring";
const window = {
  endedFrom: "2026-09-08T12:00:00Z",
  endedBefore: "2026-09-09T12:00:00Z",
};
const definitionUid = sessionFixture.definitions[0].session_definition_uid;
const stationUid = stationFixture.stations[0].station_uid;
const projectUid = stationFixture.stations[0].project_uid;
const monorepo = new URL("../../../../../../DOCTRINE.md", import.meta.url);
const manifest = new URL(
  "../../../../../../server/api_route_manifest.json",
  import.meta.url,
);
afterEach(() => vi.unstubAllGlobals());

async function setup(payload: unknown = sessionFixture): Promise<{
  client: Client;
  requests: { url: URL; init: RequestInit | undefined }[];
  close(): Promise<void>;
}> {
  const requests: { url: URL; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: new URL(String(url)), init });
      return new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const api = new Avala({
    accessToken: "synthetic-monitoring-token",
    baseUrl: "https://fixture.invalid/api/v1",
  });
  const server = new McpServer({ name: "monitoring-test", version: "1.0.0" });
  registerWorkforceSessionMonitoringTools(server, () => api);
  const client = new Client({
    name: "monitoring-test-client",
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

describe("workforce session and station monitoring", () => {
  it.skipIf(!existsSync(monorepo))(
    "binds tool declarations to the frozen server route manifest",
    () => {
      const routes = JSON.parse(readFileSync(manifest, "utf8")) as {
        name: string;
        methods: string[];
        declares_scope: string[];
      }[];
      for (const tool of WORKFORCE_SESSION_MONITORING_TOOLS) {
        const route = routes.find((row) => row.name === tool.route.name);
        expect(route).toMatchObject({
          methods: ["get"],
          declares_scope: [tool.route.scope],
        });
      }
    },
  );
  it("maps a closed window to Django and preserves definition-level limitations", async () => {
    const run = await setup();
    try {
      const result = await run.client.callTool({
        name: SESSION,
        arguments: { ...window, sessionDefinitionUid: definitionUid },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        measurement: {
          scope: "session_definition_all_projects",
          terminalTimeSource: "ended_at",
          taskCompletionThroughputSupported: false,
          queueVisibilityVerified: false,
        },
        definitions: [
          {
            sessionDefinitionUid: definitionUid,
            currentSessions: { assigned: 3 },
            terminalSessionsWithUnknownEndTime: 1,
          },
        ],
      });
      expect(run.requests).toHaveLength(1);
      expect(run.requests[0].url.pathname).toBe(
        "/api/v1/admin/workforce/session-monitoring/",
      );
      expect(Object.fromEntries(run.requests[0].url.searchParams)).toEqual({
        ended_from: window.endedFrom,
        ended_before: window.endedBefore,
        session_definition_uid: definitionUid,
        limit: "5",
      });
      expect(run.requests[0].init?.method).toBe("GET");
      expect(run.requests[0].init?.body).toBeUndefined();
    } finally {
      await run.close();
    }
  });

  it("maps exact station filters and keeps retained-link evidence nonadditive and incomplete", async () => {
    const run = await setup(stationFixture);
    try {
      const result = await run.client.callTool({
        name: STATION,
        arguments: {
          stationUid,
          projectUid,
          sessionDefinitionUid: definitionUid,
          limit: 1,
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        measurement: {
          historicalStationCoverage: "incomplete",
          historicalThroughputSupported: false,
          missingLinksMeanNoWork: false,
          crossStationCountsAdditive: false,
        },
        stations: [
          {
            stationUid,
            projectUid,
            currentRetainedLinks: {
              ready: { sessionCount: 1, taskLinkCount: 2, itemCount: 1 },
            },
          },
        ],
      });
      expect(run.requests[0].url.pathname).toBe(
        "/api/v1/admin/workforce/station-monitoring/",
      );
      expect(Object.fromEntries(run.requests[0].url.searchParams)).toEqual({
        station_uid: stationUid,
        project_uid: projectUid,
        session_definition_uid: definitionUid,
        limit: "1",
      });
    } finally {
      await run.close();
    }
  });

  it.each([
    { endedFrom: "2026-02-30T00:00:00Z" },
    { endedFrom: "2026-09-08T12:00:00" },
    { endedBefore: window.endedFrom },
    { endedFrom: "2026-01-01T00:00:00Z" },
    { endedBefore: "2099-01-01T00:00:00Z" },
    { limit: 0 },
    { limit: 11 },
    { cursor: "invalid" },
    { projectUid },
    { detail: "full" },
  ])("rejects invalid session input before HTTP: %j", async (override) => {
    const run = await setup();
    try {
      const result = await run.client.callTool({
        name: SESSION,
        arguments: { ...window, ...override },
      });
      expect(result.isError).toBe(true);
      expect(run.requests).toEqual([]);
    } finally {
      await run.close();
    }
  });

  it.each([
    [
      "exact unsampled interpretation",
      (p: SessionPayload): void => {
        p.measurement.count_interpretation = "exact";
      },
    ],
    [
      "invented end-time ordering",
      (p: SessionPayload): void => {
        p.measurement.sample_order = "ended_at_desc";
      },
    ],
    [
      "invented scan budget",
      (p: SessionPayload): void => {
        p.measurement.per_status_scan_limit = 1001;
      },
    ],
    [
      "missing sampling coverage",
      (p: SessionPayload): void => {
        p.measurement.count_coverage = "all_sessions";
      },
    ],
    [
      "count beyond sample",
      (p: SessionPayload): void => {
        p.definitions[0].current_sessions.ready = 1001;
      },
    ],
    [
      "false complete flag",
      (p: SessionPayload): void => {
        p.definitions[0].current_sessions.finished = 1000;
        p.definitions[0].status_counts_complete.finished = false;
      },
    ],
    [
      "false incomplete flag",
      (p: SessionPayload): void => {
        p.definitions[0].counts_complete = false;
      },
    ],
    [
      "truncated undersized sample",
      (p: SessionPayload): void => {
        p.definitions[0].counts_complete = false;
        p.definitions[0].status_counts_complete.finished = false;
      },
    ],
    [
      "negative count",
      (p: SessionPayload): void => {
        p.definitions[0].current_sessions.ready = -1;
      },
    ],
    [
      "expired exceeds assigned",
      (p: SessionPayload): void => {
        p.definitions[0].attention.expired_assigned = 4;
      },
    ],
    [
      "window exceeds terminal count",
      (p: SessionPayload): void => {
        p.definitions[0].terminal_sessions_in_window.finished = 5;
      },
    ],
    [
      "unknown ends overlap window",
      (p: SessionPayload): void => {
        p.definitions[0].terminal_sessions_with_unknown_end_time = 7;
      },
    ],
    [
      "fabricated throughput",
      (p: SessionPayload): void => {
        p.measurement.task_completion_throughput_supported = true;
      },
    ],
    [
      "fabricated queue visibility",
      (p: SessionPayload): void => {
        p.measurement.queue_visibility_verified = true;
      },
    ],
    [
      "wrong window",
      (p: SessionPayload): void => {
        p.measurement.ended_from = "2026-09-07T12:00:00Z";
      },
    ],
    [
      "wrong time source",
      (p: SessionPayload): void => {
        p.measurement.terminal_time_source = "updated_at";
      },
    ],
    [
      "future provider window",
      (p: SessionPayload): void => {
        p.generated_at = "2026-09-08T12:00:00Z";
      },
    ],
    [
      "naive timestamp",
      (p: SessionPayload): void => {
        p.generated_at = "2026-09-09T12:00:00";
      },
    ],
    [
      "duplicate row",
      (p: SessionPayload): void => {
        p.definitions.push(p.definitions[0]);
      },
    ],
    [
      "private field",
      (p: SessionPayload): void => {
        Object.assign(p.definitions[0], {
          coworker_email: "private-marker@example.invalid",
        });
      },
    ],
    [
      "PII task name",
      (p: SessionPayload): void => {
        p.definitions[0].task_name = "private-marker@example.invalid";
      },
    ],
    [
      "partial continuation",
      (p: SessionPayload): void => {
        p.has_more = true;
        p.next_cursor = definitionUid;
      },
    ],
    [
      "unexpected continuation",
      (p: SessionPayload): void => {
        p.next_cursor = definitionUid;
      },
    ],
  ] as const)(
    "refuses malformed session evidence: %s",
    async (_name, mutate) => {
      const payload: SessionPayload = structuredClone(sessionFixture);
      mutate(payload);
      const run = await setup(payload);
      try {
        const result = await run.client.callTool({
          name: SESSION,
          arguments: window,
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain(
          "private-marker@example.invalid",
        );
      } finally {
        await run.close();
      }
    },
  );

  it.each([
    [
      "invented scan budget",
      (p: typeof stationFixture): void => {
        p.measurement.per_station_scan_limit = 1001;
      },
    ],
    [
      "count beyond sample",
      (p: typeof stationFixture): void => {
        p.stations[0].current_retained_links.ready.task_link_count = 1001;
      },
    ],
    [
      "truncated undersized sample",
      (p: typeof stationFixture): void => {
        p.stations[0].counts_complete = false;
      },
    ],
    [
      "unknown links exceed sample",
      (p: typeof stationFixture): void => {
        p.stations[0].unknown_status_task_links = 999;
      },
    ],
    [
      "item count",
      (p: typeof stationFixture): void => {
        p.stations[0].current_retained_links.ready.item_count = 3;
      },
    ],
    [
      "missing session",
      (p: typeof stationFixture): void => {
        p.stations[0].current_retained_links.ready.session_count = 0;
      },
    ],
    [
      "complete coverage",
      (p: typeof stationFixture): void => {
        p.measurement.historical_station_coverage = "complete";
      },
    ],
    [
      "additive totals",
      (p: typeof stationFixture): void => {
        p.measurement.cross_station_counts_additive = true;
      },
    ],
    [
      "private field",
      (p: typeof stationFixture): void => {
        Object.assign(p.stations[0], { name: "private-marker" });
      },
    ],
    [
      "duplicate station",
      (p: typeof stationFixture): void => {
        p.stations.push(p.stations[0]);
      },
    ],
  ] as const)(
    "refuses malformed station evidence: %s",
    async (_name, mutate) => {
      const payload = structuredClone(stationFixture);
      mutate(payload);
      const run = await setup(payload);
      try {
        const result = await run.client.callTool({
          name: STATION,
          arguments: {},
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain("private-marker");
      } finally {
        await run.close();
      }
    },
  );

  it.each([
    [
      SESSION,
      sessionFixture,
      { ...window, sessionDefinitionUid: "90000000000040008000000000000001" },
    ],
    [SESSION, sessionFixture, { ...window, cursor: definitionUid }],
    [
      STATION,
      stationFixture,
      { stationUid: "90000000000040008000000000000001" },
    ],
    [
      STATION,
      stationFixture,
      { projectUid: "90000000000040008000000000000001" },
    ],
    [
      STATION,
      stationFixture,
      { sessionDefinitionUid: "90000000000040008000000000000001" },
    ],
    [STATION, stationFixture, { cursor: stationUid }],
  ])(
    "binds %s to requested target and advancing cursor",
    async (name, payload, args) => {
      const run = await setup(payload);
      try {
        const result = await run.client.callTool({
          name: name as string,
          arguments: args as Record<string, unknown>,
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
      } finally {
        await run.close();
      }
    },
  );

  it("accepts a full advancing page and equivalent dashed/case-insensitive filter UUIDs", async () => {
    const payload: Omit<typeof sessionFixture, "next_cursor"> & {
      next_cursor: string | null;
    } = structuredClone(sessionFixture);
    payload.has_more = true;
    payload.next_cursor = definitionUid;
    const run = await setup(payload);
    try {
      const result = await run.client.callTool({
        name: SESSION,
        arguments: {
          ...window,
          limit: 1,
          cursor: "00000000000040008000000000000001",
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        hasMore: true,
        nextCursor: definitionUid,
      });
    } finally {
      await run.close();
    }
    const stationRun = await setup(stationFixture);
    try {
      const result = await stationRun.client.callTool({
        name: STATION,
        arguments: { stationUid: "20000000-0000-4000-8000-000000000001" },
      });
      expect(result.isError).not.toBe(true);
    } finally {
      await stationRun.close();
    }
  });

  it("preserves truncated terminal-window lower bounds even when the observed window is empty", async () => {
    const payload = structuredClone(sessionFixture);
    const row = payload.definitions[0];
    row.current_sessions.finished = 1000;
    row.status_counts_complete.finished = false;
    row.counts_complete = false;
    row.terminal_sessions_in_window = { finished: 0, abandoned: 0 };
    const run = await setup(payload);
    try {
      const result = await run.client.callTool({
        name: SESSION,
        arguments: window,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        measurement: {
          countCoverage: "bounded_recent_sessions_per_status",
          perStatusScanLimit: 1000,
          unknownEndTimeScope: "sampled_current_terminal_sessions",
        },
        definitions: [
          {
            countsComplete: false,
            statusCountsComplete: { finished: false, abandoned: true },
            terminalSessionsInWindow: { finished: 0, abandoned: 0 },
          },
        ],
      });
    } finally {
      await run.close();
    }
  });

  it("keeps a truncated retained-link sample separate from permanently incomplete historical station coverage", async () => {
    const payload = structuredClone(stationFixture);
    payload.stations[0].counts_complete = false;
    payload.stations[0].current_retained_links.ready.task_link_count = 999;
    payload.stations[0].unknown_status_task_links = 1;
    const run = await setup(payload);
    try {
      const result = await run.client.callTool({
        name: STATION,
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        measurement: {
          countCoverage: "bounded_retained_links",
          perStationScanLimit: 1000,
          historicalStationCoverage: "incomplete",
          historicalThroughputSupported: false,
        },
        stations: [
          {
            countsComplete: false,
            unknownStatusTaskLinks: 1,
            currentRetainedLinks: { ready: { taskLinkCount: 999 } },
          },
        ],
      });
      expect(run.requests[0].url.searchParams.get("limit")).toBe("5");
    } finally {
      await run.close();
    }
  });

  it("advertises exact read scopes and GET routes with fixed evidence schemas", async () => {
    const run = await setup();
    try {
      const { tools } = await run.client.listTools();
      expect(tools).toHaveLength(2);
      for (const tool of tools) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
        });
        expect(tool._meta).toMatchObject({
          "avala.ai/rest-method": "GET",
          "avala.ai/required-scope": "workforce.read",
          "avala.ai/toolset": "staff",
        });
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(tool.outputSchema?.additionalProperties).toBe(false);
      }
    } finally {
      await run.close();
    }
  });
});
