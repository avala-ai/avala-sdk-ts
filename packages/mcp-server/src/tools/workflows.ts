import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  defineCompositeReadCatalogTool,
  registerCompositeReadCatalogTool,
} from "../catalog.js";
import {
  FLEET_ALERT_LIST_ROUTE,
  FLEET_DEVICE_LIST_ROUTE,
  FLEET_RECORDING_LIST_ROUTE,
} from "./fleet.js";
import { z } from "zod";
import {
  describeUnavailable,
  degradedFieldsSchema,
  withDegraded,
  type UnavailablePart,
} from "../degraded.js";

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

/**
 * Render a rejected promise's reason as LLM-safe text.
 *
 * The raw `reason` often contains request URLs, body snippets, and stack
 * traces — anything in those ends up in the model's conversation context
 * and the MCP client's logs. We surface only an error class name and, for
 * Avala SDK errors, the HTTP status code.
 */
function safeErrorSummary(reason: unknown): string {
  if (reason && typeof reason === "object") {
    const r = reason as { name?: string; statusCode?: number };
    const name = r.name ?? "Error";
    const status =
      typeof r.statusCode === "number" ? ` (HTTP ${r.statusCode})` : "";
    return `${name}${status}`;
  }
  return "Error";
}

const fleetHealthOutputSchema = z
  .object({
    devices: z
      .object({
        total: z.number().int().nonnegative(),
        online: z.number().int().nonnegative(),
        offline: z.number().int().nonnegative(),
        maintenance: z.number().int().nonnegative(),
        note: z.string().optional(),
      })
      .strip()
      .optional(),
    alerts: z
      .object({
        totalOpen: z.number().int().nonnegative(),
        bySeverity: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strip()
      .optional(),
    recordings: z
      .object({ recentCount: z.number().int().nonnegative() })
      .strip()
      .optional(),
    ...degradedFieldsSchema,
  })
  .strip();

const getFleetHealthTool = defineCompositeReadCatalogTool({
  name: "get_fleet_health",
  title: "Get fleet health",
  description:
    "Get a fleet health overview — device counts by status, open alerts by severity, and recent recording count. Counts are from the first page of results (up to 100 devices, 100 alerts). Use when a user asks about fleet status or device health.",
  inputSchema: z.object({
    deviceType: z
      .string()
      .optional()
      .describe("Optional filter by device type"),
  }),
  outputSchema: fleetHealthOutputSchema,
  routes: [
    {
      ...FLEET_DEVICE_LIST_ROUTE,
      query: { deviceType: "type" },
      fixedQuery: { limit: "100" },
    },
    {
      ...FLEET_ALERT_LIST_ROUTE,
      fixedQuery: { status: "open", limit: "100" },
    },
    {
      ...FLEET_RECORDING_LIST_ROUTE,
      fixedQuery: { limit: "20" },
    },
  ],
  execute: async (_args, read) => {
    const [devicesResult, alertsResult, recordingsResult] =
      await Promise.allSettled([
        read(FLEET_DEVICE_LIST_ROUTE.name),
        read(FLEET_ALERT_LIST_ROUTE.name),
        read(FLEET_RECORDING_LIST_ROUTE.name),
      ]);

    const devices =
      (
        settled(devicesResult) as {
          items?: Array<{ status?: string | null }>;
        } | null
      )?.items ?? [];
    const alerts =
      (
        settled(alertsResult) as {
          items?: Array<{ severity?: string | null }>;
        } | null
      )?.items ?? [];
    const recordings =
      (settled(recordingsResult) as { items?: unknown[] } | null)?.items ?? [];

    const alertsBySeverity: Record<string, number> = {};
    for (const alert of alerts) {
      const severity = alert.severity ?? "unknown";
      alertsBySeverity[severity] = (alertsBySeverity[severity] ?? 0) + 1;
    }

    const deviceSummary: {
      total: number;
      online: number;
      offline: number;
      maintenance: number;
      note?: string;
    } = {
      total: devices.length,
      online: devices.filter((device) => device.status === "online").length,
      offline: devices.filter((device) => device.status === "offline").length,
      maintenance: devices.filter((device) => device.status === "maintenance")
        .length,
    };
    if (devices.length >= 100)
      deviceSummary.note = "Capped at 100 — actual total may be higher";

    // A failed leg is OMITTED, never defaulted to zero. `total: 0` reads as
    // "you have no devices"; absence reads as "this was not measured", which
    // is the truth.
    const summary: {
      devices?: typeof deviceSummary;
      alerts?: { totalOpen: number; bySeverity: Record<string, number> };
      recordings?: { recentCount: number };
    } = {};
    const unavailable: UnavailablePart[] = [];

    if (devicesResult.status === "rejected")
      unavailable.push(describeUnavailable("devices", devicesResult.reason));
    else summary.devices = deviceSummary;

    if (alertsResult.status === "rejected")
      unavailable.push(describeUnavailable("alerts", alertsResult.reason));
    else
      summary.alerts = {
        totalOpen: alerts.length,
        bySeverity: alertsBySeverity,
      };

    if (recordingsResult.status === "rejected")
      unavailable.push(
        describeUnavailable("recordings", recordingsResult.reason),
      );
    else summary.recordings = { recentCount: recordings.length };

    return withDegraded(summary, unavailable);
  },
});

export const WORKFLOW_COMPOSITE_READ_CATALOG_TOOLS = [
  getFleetHealthTool,
] as const;

export function registerWorkflowTools(
  server: McpServer,
  getClient: GetClient,
  allowMutations = false,
): void {
  if (allowMutations) {
    server.registerTool(
      "create_annotation_pipeline",
      {
        description:
          "Create a dataset and optionally trigger an export for a project. The dataset is always created first. If the export step fails, the response includes the dataset that was created and the export error so nothing is silently lost.",
        inputSchema: z.object({
          name: z.string().describe("Display name for the new dataset"),
          slug: z
            .string()
            .describe("URL-friendly identifier for the new dataset"),
          dataType: z
            .string()
            .describe(
              "Type of data: 'image', 'video', 'lidar', 'mcap', or 'splat'",
            ),
          projectUid: z
            .string()
            .optional()
            .describe(
              "If provided, an export will be created for this project after the dataset is created",
            ),
        }),
      },
      async ({ name, slug, dataType, projectUid }) => {
        const avala = getClient("create_annotation_pipeline");
        const dataset = await avala.datasets.create({ name, slug, dataType });

        const summary: Record<string, unknown> = {
          dataset: {
            uid: dataset.uid,
            name: dataset.name,
            slug: dataset.slug,
            dataType: dataset.dataType,
          },
        };

        if (projectUid) {
          try {
            const exportJob = await avala.exports.create({
              project: projectUid,
            });
            summary.export = { uid: exportJob.uid, status: exportJob.status };
          } catch (err) {
            summary.export = {
              error: safeErrorSummary(err),
              note: "Dataset was created successfully but export failed. You can retry the export separately.",
            };
          }
        }

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(summary, null, 2) },
          ],
        };
      },
    );
  }

  registerCompositeReadCatalogTool(server, getClient, getFleetHealthTool);

  server.registerTool(
    "get_project_quality_summary",
    {
      description:
        "Get a quality picture for a project — project details, quality target breach status, and consensus scores. Use when a user asks 'how is quality on project X?' or wants to check quality thresholds.",
      inputSchema: z.object({
        projectUid: z
          .string()
          .describe("The unique identifier (UUID) of the project"),
      }),
      _meta: {
        "avala.ai/required-scopes": ["projects.read", "qc.read"],
        "avala.ai/toolset": "quality",
      },
    },
    async ({ projectUid }) => {
      const avala = getClient("get_project_quality_summary");
      const [projectResult, targetsResult, consensusResult] =
        await Promise.allSettled([
          // `getMine`, not `get`: `/projects/{uid}/` is the staff-only
          // ProjectViewSet and 403s for a customer credential, which is what
          // made this whole summary return an empty shell.
          avala.projects.getMine(projectUid),
          avala.qualityTargets.list(projectUid, { limit: 50 }),
          avala.consensus.getSummary(projectUid),
        ]);

      const project = settled(projectResult);
      const targetsPage = settled(targetsResult);
      const consensus = settled(consensusResult);

      const targets = (targetsPage?.items ?? []).map((t) => ({
        uid: t.uid,
        name: t.name,
        metric: t.metric,
        threshold: t.threshold,
        operator: t.operator,
        isBreached: t.isBreached,
        lastValue: t.lastValue,
        severity: t.severity,
      }));

      const summary: Record<string, unknown> = {};

      // Omit what failed rather than emitting `null`/`0`. A null `project`
      // beside a zeroed `qualityTargets` is what made this tool report a
      // healthy-looking empty shell when the project fetch 403'd.
      const unavailable: UnavailablePart[] = [];
      if (projectResult.status === "rejected")
        unavailable.push(describeUnavailable("project", projectResult.reason));
      else if (project)
        summary.project = {
          uid: project.uid,
          name: project.name,
          status: project.status,
        };

      if (targetsResult.status === "rejected")
        unavailable.push(
          describeUnavailable("qualityTargets", targetsResult.reason),
        );
      else
        summary.qualityTargets = {
          total: targets.length,
          breached: targets.filter((t) => t.isBreached).length,
          targets,
        };

      if (consensusResult.status === "rejected")
        unavailable.push(
          describeUnavailable("consensus", consensusResult.reason),
        );
      else if (consensus) summary.consensus = consensus;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(withDegraded(summary, unavailable), null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_workspace_overview",
    {
      description:
        "Get a high-level overview of the workspace — organizations, recent datasets, recent projects, and recent exports. Use when a user first connects or asks 'what do I have?' or 'show me my workspace.'",
      inputSchema: z.object({}),
      _meta: {
        "avala.ai/required-scopes": [
          "organizations.read",
          "datasets.read",
          "projects.read",
          "exports.read",
        ],
        "avala.ai/toolset": "workspace",
      },
    },
    async () => {
      const avala = getClient("get_workspace_overview");
      const [orgsResult, datasetsResult, projectsResult, exportsResult] =
        await Promise.allSettled([
          avala.organizations.list({ limit: 10 }),
          avala.datasets.list({ limit: 5 }),
          // `listMine`, not `list`. The staff route 403s for a customer
          // credential, which is why this field used to render as an empty
          // array beside a buried error.
          avala.projects.listMine({ limit: 5 }),
          avala.exports.list({ limit: 5 }),
        ]);

      const summary: Record<string, unknown> = {};

      // `recentProjects: []` beside a buried 403 is the exact shape that made
      // an agent report "you have no projects" to a user with 100 of them.
      // A part we could not read is absent and named.
      const unavailable: UnavailablePart[] = [];
      if (orgsResult.status === "rejected")
        unavailable.push(
          describeUnavailable("organizations", orgsResult.reason),
        );
      else
        summary.organizations = (settled(orgsResult)?.items ?? []).map((o) => ({
          uid: o.uid,
          name: o.name,
          slug: o.slug,
          memberCount: o.memberCount,
          datasetCount: o.datasetCount,
          projectCount: o.projectCount,
        }));

      if (datasetsResult.status === "rejected")
        unavailable.push(
          describeUnavailable("recentDatasets", datasetsResult.reason),
        );
      else
        summary.recentDatasets = (settled(datasetsResult)?.items ?? []).map(
          (d) => ({
            uid: d.uid,
            name: d.name,
            dataType: d.dataType,
            itemCount: d.itemCount,
          }),
        );

      if (projectsResult.status === "rejected")
        unavailable.push(
          describeUnavailable("recentProjects", projectsResult.reason),
        );
      else
        summary.recentProjects = (settled(projectsResult)?.items ?? []).map(
          (p) => ({ uid: p.uid, name: p.name, status: p.status }),
        );

      if (exportsResult.status === "rejected")
        unavailable.push(
          describeUnavailable("recentExports", exportsResult.reason),
        );
      else
        summary.recentExports = (settled(exportsResult)?.items ?? []).map(
          (e) => ({ uid: e.uid, status: e.status, createdAt: e.createdAt }),
        );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(withDegraded(summary, unavailable), null, 2),
          },
        ],
      };
    },
  );
}
