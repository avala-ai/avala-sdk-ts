import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "../client.js";
import { defineCompositeReadCatalogTool, registerCompositeReadCatalogTool } from "../catalog.js";
import { FLEET_ALERT_LIST_ROUTE, FLEET_DEVICE_LIST_ROUTE, FLEET_RECORDING_LIST_ROUTE } from "./fleet.js";
import { z } from "zod";

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
    const status = typeof r.statusCode === "number" ? ` (HTTP ${r.statusCode})` : "";
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
      .strip(),
    alerts: z
      .object({
        totalOpen: z.number().int().nonnegative(),
        bySeverity: z.record(z.number().int().nonnegative()),
      })
      .strip(),
    recordings: z.object({ recentCount: z.number().int().nonnegative() }).strip(),
    errors: z.array(z.string()).optional(),
  })
  .strip();

const getFleetHealthTool = defineCompositeReadCatalogTool({
  name: "get_fleet_health",
  title: "Get fleet health",
  description:
    "Get a fleet health overview — device counts by status, open alerts by severity, and recent recording count. Counts are from the first page of results (up to 100 devices, 100 alerts). Use when a user asks about fleet status or device health.",
  inputSchema: z.object({
    deviceType: z.string().optional().describe("Optional filter by device type"),
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
    const [devicesResult, alertsResult, recordingsResult] = await Promise.allSettled([
      read(FLEET_DEVICE_LIST_ROUTE.name),
      read(FLEET_ALERT_LIST_ROUTE.name),
      read(FLEET_RECORDING_LIST_ROUTE.name),
    ]);

    const devices =
      (settled(devicesResult) as { items?: Array<{ status?: string | null }> } | null)?.items ?? [];
    const alerts =
      (settled(alertsResult) as { items?: Array<{ severity?: string | null }> } | null)?.items ?? [];
    const recordings = (settled(recordingsResult) as { items?: unknown[] } | null)?.items ?? [];

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
      maintenance: devices.filter((device) => device.status === "maintenance").length,
    };
    if (devices.length >= 100) deviceSummary.note = "Capped at 100 — actual total may be higher";

    const summary: {
      devices: typeof deviceSummary;
      alerts: { totalOpen: number; bySeverity: Record<string, number> };
      recordings: { recentCount: number };
      errors?: string[];
    } = {
      devices: deviceSummary,
      alerts: { totalOpen: alerts.length, bySeverity: alertsBySeverity },
      recordings: { recentCount: recordings.length },
    };

    const errors: string[] = [];
    if (devicesResult.status === "rejected") errors.push(`devices: ${safeErrorSummary(devicesResult.reason)}`);
    if (alertsResult.status === "rejected") errors.push(`alerts: ${safeErrorSummary(alertsResult.reason)}`);
    if (recordingsResult.status === "rejected") errors.push(`recordings: ${safeErrorSummary(recordingsResult.reason)}`);
    if (errors.length > 0) summary.errors = errors;
    return summary;
  },
});

export const WORKFLOW_COMPOSITE_READ_CATALOG_TOOLS = [getFleetHealthTool] as const;

export function registerWorkflowTools(server: McpServer, getClient: GetClient, allowMutations = false): void {
  if (allowMutations) {
    server.tool(
      "create_annotation_pipeline",
      "Create a dataset and optionally trigger an export for a project. The dataset is always created first. If the export step fails, the response includes the dataset that was created and the export error so nothing is silently lost.",
      {
        name: z.string().describe("Display name for the new dataset"),
        slug: z.string().describe("URL-friendly identifier for the new dataset"),
        dataType: z.string().describe("Type of data: 'image', 'video', 'lidar', 'mcap', or 'splat'"),
        projectUid: z.string().optional().describe("If provided, an export will be created for this project after the dataset is created"),
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
            const exportJob = await avala.exports.create({ project: projectUid });
            summary.export = { uid: exportJob.uid, status: exportJob.status };
          } catch (err) {
            summary.export = {
              error: safeErrorSummary(err),
              note: "Dataset was created successfully but export failed. You can retry the export separately.",
            };
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
        };
      }
    );
  }

  registerCompositeReadCatalogTool(server, getClient, getFleetHealthTool);

  server.tool(
    "get_project_quality_summary",
    "Get a quality picture for a project — project details, quality target breach status, and consensus scores. Use when a user asks 'how is quality on project X?' or wants to check quality thresholds.",
    {
      projectUid: z.string().describe("The unique identifier (UUID) of the project"),
    },
    async ({ projectUid }) => {
      const avala = getClient("get_project_quality_summary");
      const [projectResult, targetsResult, consensusResult] = await Promise.allSettled([
        avala.projects.get(projectUid),
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

      const summary: Record<string, unknown> = {
        project: project ? { uid: project.uid, name: project.name, status: project.status } : null,
        qualityTargets: {
          total: targets.length,
          breached: targets.filter((t) => t.isBreached).length,
          targets,
        },
        consensus: consensus ?? null,
      };

      const errors: string[] = [];
      if (projectResult.status === "rejected") errors.push(`project: ${safeErrorSummary(projectResult.reason)}`);
      if (targetsResult.status === "rejected") errors.push(`qualityTargets: ${safeErrorSummary(targetsResult.reason)}`);
      if (consensusResult.status === "rejected") errors.push(`consensus: ${safeErrorSummary(consensusResult.reason)}`);
      if (errors.length > 0) summary.errors = errors;

      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "get_workspace_overview",
    "Get a high-level overview of the workspace — organizations, recent datasets, recent projects, and recent exports. Use when a user first connects or asks 'what do I have?' or 'show me my workspace.'",
    {},
    async () => {
      const avala = getClient("get_workspace_overview");
      const [orgsResult, datasetsResult, projectsResult, exportsResult] = await Promise.allSettled([
        avala.organizations.list({ limit: 10 }),
        avala.datasets.list({ limit: 5 }),
        avala.projects.list({ limit: 5 }),
        avala.exports.list({ limit: 5 }),
      ]);

      const summary: Record<string, unknown> = {
        organizations: (settled(orgsResult)?.items ?? []).map((o) => ({
          uid: o.uid,
          name: o.name,
          slug: o.slug,
          memberCount: o.memberCount,
          datasetCount: o.datasetCount,
          projectCount: o.projectCount,
        })),
        recentDatasets: (settled(datasetsResult)?.items ?? []).map((d) => ({
          uid: d.uid,
          name: d.name,
          dataType: d.dataType,
          itemCount: d.itemCount,
        })),
        recentProjects: (settled(projectsResult)?.items ?? []).map((p) => ({
          uid: p.uid,
          name: p.name,
          status: p.status,
        })),
        recentExports: (settled(exportsResult)?.items ?? []).map((e) => ({
          uid: e.uid,
          status: e.status,
          createdAt: e.createdAt,
        })),
      };

      const errors: string[] = [];
      if (orgsResult.status === "rejected") errors.push(`organizations: ${safeErrorSummary(orgsResult.reason)}`);
      if (datasetsResult.status === "rejected") errors.push(`datasets: ${safeErrorSummary(datasetsResult.reason)}`);
      if (projectsResult.status === "rejected") errors.push(`projects: ${safeErrorSummary(projectsResult.reason)}`);
      if (exportsResult.status === "rejected") errors.push(`exports: ${safeErrorSummary(exportsResult.reason)}`);
      if (errors.length > 0) summary.errors = errors;

      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    }
  );
}
