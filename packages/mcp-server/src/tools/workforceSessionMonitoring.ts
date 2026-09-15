import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { defineReadCatalogTool, registerReadCatalogTool } from "../catalog.js";
import type { GetClient } from "../client.js";

const uid = z
  .string()
  .regex(
    /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i,
  );
const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const normalizeUid = (value: string): string =>
  value.replaceAll("-", "").toLowerCase();
const statusCounts = z
  .object({
    pending: count.max(1000),
    ready: count.max(1000),
    assigned: count.max(1000),
    finished: count.max(1000),
    abandoned: count.max(1000),
  })
  .strict();
const pageInput = z
  .object({
    sessionDefinitionUid: uid
      .optional()
      .describe(
        "Optional exact session definition UID; definitions can span multiple projects.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("Maximum definitions or stations per page (1–10, default 5)."),
    cursor: uid
      .optional()
      .describe(
        "Previous nextCursor; preserve every other filter while paging.",
      ),
  })
  .strict();
const sessionInput = pageInput
  .extend({
    endedFrom: timestamp.describe(
      "Inclusive terminal-window start, with explicit UTC offset.",
    ),
    endedBefore: timestamp.describe(
      "Exclusive terminal-window end, with explicit UTC offset; in the past and at most 31 days after endedFrom.",
    ),
  })
  .superRefine((value, ctx) => {
    const start = Date.parse(value.endedFrom),
      end = Date.parse(value.endedBefore);
    if (end <= start || end - start > 31 * 86_400_000 || end > Date.now())
      ctx.addIssue({
        code: "custom",
        message:
          "Require an increasing past terminal window of at most 31 days.",
      });
  });
const stationInput = pageInput.extend({
  stationUid: uid
    .optional()
    .describe(
      "Optional exact production station UID; a station is a project/session-definition pair, not a physical capture rig.",
    ),
  projectUid: uid
    .optional()
    .describe(
      "Optional exact current station project UID; no historical project attribution is inferred.",
    ),
});

const definition = z
  .object({
    sessionDefinitionUid: uid,
    // Fixed Task.Name values from Django, including known legacy values. Never
    // let an unexpected provider field turn into a customer label or free text.
    taskName: z
      .enum([
        "",
        "root",
        "crop",
        "box",
        "cuboid",
        "classification",
        "polygon",
        "point cloud segmentation",
        "point cloud polyline",
        "image segmentation",
        "object mask",
        "cuboid 3d",
        "polyline 3d",
        "data collection",
        "_dummy",
      ])
      .nullable(),
    isReviewTask: z.boolean(),
    canBeAssigned: z.boolean(),
    canBeMatched: z.boolean(),
    countsComplete: z.boolean(),
    statusCountsComplete: z
      .object({
        pending: z.boolean(),
        ready: z.boolean(),
        assigned: z.boolean(),
        finished: z.boolean(),
        abandoned: z.boolean(),
      })
      .strict(),
    currentSessions: statusCounts,
    attention: z
      .object({
        expiredAssigned: count,
        expiredReady: count,
        terminalRedrivePending: count,
      })
      .strict(),
    terminalSessionsInWindow: z
      .object({ finished: count, abandoned: count })
      .strict(),
    terminalSessionsWithUnknownEndTime: count,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.countsComplete !==
        Object.values(value.statusCountsComplete).every(Boolean) ||
      Object.entries(value.statusCountsComplete).some(
        ([status, complete]) =>
          !complete &&
          value.currentSessions[
            status as keyof typeof value.currentSessions
          ] !== 1000,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Session sample completeness contradicts its bounded counts.",
      });
    const current = value.currentSessions,
      window = value.terminalSessionsInWindow;
    if (
      value.attention.expiredAssigned > current.assigned ||
      value.attention.expiredReady > current.ready ||
      value.attention.terminalRedrivePending >
        current.finished + current.abandoned ||
      window.finished > current.finished ||
      window.abandoned > current.abandoned ||
      window.finished +
        window.abandoned +
        value.terminalSessionsWithUnknownEndTime >
        current.finished + current.abandoned
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Session evidence exceeds the corresponding current-state counts.",
      });
  });
const sessionOutput = z
  .object({
    generatedAt: timestamp,
    measurement: z
      .object({
        scope: z.literal("session_definition_all_projects"),
        countCoverage: z.literal("bounded_recent_sessions_per_status"),
        perStatusScanLimit: z.literal(1000),
        countInterpretation: z.literal(
          "exact_if_complete_otherwise_lower_bound",
        ),
        sampleOrder: z.literal("created_at_desc_ties_unspecified"),
        endedFrom: timestamp,
        endedBefore: timestamp,
        boundary: z.literal("half_open"),
        terminalTimeSource: z.literal("ended_at"),
        unknownEndTimeScope: z.literal("sampled_current_terminal_sessions"),
        taskCompletionThroughputSupported: z.literal(false),
        infrastructureHealthSupported: z.literal(false),
        queueVisibilityVerified: z.literal(false),
      })
      .strict(),
    definitions: z.array(definition).max(10),
    hasMore: z.boolean(),
    nextCursor: uid.nullable(),
  })
  .strict();
const retainedLinks = z
  .object({ sessionCount: count, taskLinkCount: count, itemCount: count })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.sessionCount > value.taskLinkCount ||
      value.itemCount > value.taskLinkCount ||
      (value.sessionCount === 0) !== (value.taskLinkCount === 0)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Retained-link counts contradict their session or item evidence.",
      });
  });
const stationOutput = z
  .object({
    generatedAt: timestamp,
    measurement: z
      .object({
        scope: z.literal("retained_session_task_links"),
        countCoverage: z.literal("bounded_retained_links"),
        perStationScanLimit: z.literal(1000),
        countInterpretation: z.literal(
          "exact_if_complete_otherwise_lower_bound",
        ),
        historicalStationCoverage: z.literal("incomplete"),
        historicalThroughputSupported: z.literal(false),
        missingLinksMeanNoWork: z.literal(false),
        crossStationCountsAdditive: z.literal(false),
        queueVisibilityVerified: z.literal(false),
      })
      .strict(),
    stations: z
      .array(
        z
          .object({
            stationUid: uid,
            projectUid: uid,
            sessionDefinitionUid: uid,
            countsComplete: z.boolean(),
            unknownStatusTaskLinks: count,
            currentRetainedLinks: z
              .object({
                pending: retainedLinks,
                ready: retainedLinks,
                assigned: retainedLinks,
                finished: retainedLinks,
                abandoned: retainedLinks,
              })
              .strict(),
          })
          .strict()
          .superRefine((value, ctx) => {
            const sampledLinks =
              value.unknownStatusTaskLinks +
              Object.values(value.currentRetainedLinks).reduce(
                (sum, row) => sum + row.taskLinkCount,
                0,
              );
            if (
              sampledLinks > 1000 ||
              (!value.countsComplete && sampledLinks !== 1000)
            )
              ctx.addIssue({
                code: "custom",
                message:
                  "Station sample completeness contradicts its bounded counts.",
              });
          }),
      )
      .max(10),
    hasMore: z.boolean(),
    nextCursor: uid.nullable(),
  })
  .strict();

function validatePage(
  ids: readonly string[],
  hasMore: boolean,
  nextCursor: string | null,
  args: Readonly<Record<string, unknown>>,
): void {
  if (ids.length > Number(args.limit ?? 5))
    throw new Error("Provider exceeded requested page limit.");
  let previous =
    typeof args.cursor === "string" ? normalizeUid(args.cursor) : "";
  for (const id of ids) {
    const current = normalizeUid(id);
    if (current <= previous)
      throw new Error("Provider page did not advance in unique UID order.");
    previous = current;
  }
  if (
    hasMore
      ? ids.length !== Number(args.limit ?? 5) ||
        nextCursor === null ||
        normalizeUid(nextCursor) !== previous
      : nextCursor !== null
  )
    throw new Error("Provider continuation contradicts the returned page.");
}

function matchFilter(actual: string, expected: unknown): void {
  if (
    typeof expected === "string" &&
    normalizeUid(actual) !== normalizeUid(expected)
  )
    throw new Error("Provider substituted a different monitoring target.");
}

const sessionTool = defineReadCatalogTool({
  name: "get_workforce_session_monitoring",
  title: "Get workforce session monitoring",
  description:
    "Staff only: page current session-definition state, expired ready/assigned sessions, pending terminal redrive and observed session endings in a required past half-open window of at most 31 days. Counts span all projects in each definition; no project attribution is inferred. Endings use ended_at, never updated_at. Samples at most 1000 newest-created sessions per status and definition; counts are lower bounds when the corresponding statusCountsComplete is false, and countsComplete requires all statuses complete. Terminal-window evidence is complete only when both terminal statuses are complete; a truncated zero never proves no endings. Unknown end times cover sampled terminal rows only. Finished annotation or capture sessions do not establish completed tasks, uploaded/accepted data, coworker throughput, billing, Redis visibility or infrastructure health. Follow every nextCursor with identical filters before aggregating definitions. Returns opaque IDs, fixed task codes and counts; excludes names, coworker identities, payloads, URLs and pay.",
  inputSchema: sessionInput,
  outputSchema: sessionOutput,
  supportsDetail: false,
  route: {
    name: "workforce-session-monitoring",
    method: "GET",
    path: "/admin/workforce/session-monitoring/",
    query: {
      endedFrom: "ended_from",
      endedBefore: "ended_before",
      sessionDefinitionUid: "session_definition_uid",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
  project: (raw, _detail, args) => {
    const value = sessionOutput.parse(raw);
    if (
      Date.parse(value.measurement.endedFrom) !==
        Date.parse(String(args.endedFrom)) ||
      Date.parse(value.measurement.endedBefore) !==
        Date.parse(String(args.endedBefore)) ||
      Date.parse(value.measurement.endedBefore) > Date.parse(value.generatedAt)
    )
      throw new Error(
        "Provider did not preserve the requested past terminal window.",
      );
    validatePage(
      value.definitions.map((row) => row.sessionDefinitionUid),
      value.hasMore,
      value.nextCursor,
      args,
    );
    for (const row of value.definitions)
      matchFilter(row.sessionDefinitionUid, args.sessionDefinitionUid);
    if (args.sessionDefinitionUid && value.hasMore)
      throw new Error("An exact definition cannot have another page.");
    return value;
  },
});
const stationTool = defineReadCatalogTool({
  name: "get_workforce_station_monitoring",
  title: "Get workforce station monitoring",
  description:
    "Staff only: page production stations and retained SessionTask links by current session status. Samples at most 1000 retained links per station; countsComplete describes this retained sample only, and false means all counts are lower bounds. A station is a project/session-definition pair, not a physical capture rig. sessionCount deduplicates sessions, taskLinkCount includes redundancy and review-result bridge rows, itemCount deduplicates non-null items; unknownStatusTaskLinks counts sampled links outside known statuses. Recovery can delete links; historical coverage is incomplete and missing links never prove no work. Sessions/items can span stations, so counts are not additive across stations. No historical throughput, assignment safety, billing or Redis visibility is inferred. Follow every nextCursor with identical filters. Returns opaque IDs and counts only, excluding names, coworker identities, payloads, URLs and pay.",
  inputSchema: stationInput,
  outputSchema: stationOutput,
  supportsDetail: false,
  route: {
    name: "workforce-station-monitoring",
    method: "GET",
    path: "/admin/workforce/station-monitoring/",
    query: {
      stationUid: "station_uid",
      projectUid: "project_uid",
      sessionDefinitionUid: "session_definition_uid",
      limit: "limit",
      cursor: "cursor",
    },
    response: "single",
    scope: "workforce.read",
    toolset: "staff",
  },
  project: (raw, _detail, args) => {
    const value = stationOutput.parse(raw);
    validatePage(
      value.stations.map((row) => row.stationUid),
      value.hasMore,
      value.nextCursor,
      args,
    );
    for (const row of value.stations) {
      matchFilter(row.stationUid, args.stationUid);
      matchFilter(row.projectUid, args.projectUid);
      matchFilter(row.sessionDefinitionUid, args.sessionDefinitionUid);
    }
    if (args.stationUid && value.hasMore)
      throw new Error("An exact station cannot have another page.");
    return value;
  },
});

export const WORKFORCE_SESSION_MONITORING_TOOLS = [
  sessionTool,
  stationTool,
] as const;

export function registerWorkforceSessionMonitoringTools(
  server: McpServer,
  getClient: GetClient,
): void {
  registerReadCatalogTool(server, getClient, sessionTool);
  registerReadCatalogTool(server, getClient, stationTool);
}
