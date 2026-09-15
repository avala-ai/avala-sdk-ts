import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import { z } from "zod";
import {
  degradedFieldsSchema,
  describeUnavailable,
  withDegraded,
  type UnavailablePart,
} from "../degraded.js";
import { detailInputField, presentReadDetail } from "../readDetail.js";

const WORKSPACE_STATS_CONCISE_KEYS = [
  "datasets",
  "projects",
  "exports",
] as const;

const exactResourceCountSchema = z
  .object({
    count: z.number().int().nonnegative(),
    minimumCount: z.number().int().nonnegative(),
    countStatus: z.literal("exact"),
    hasMore: z.literal(false),
  })
  .strip();

const lowerBoundResourceCountSchema = z
  .object({
    count: z.null(),
    minimumCount: z.number().int().positive(),
    countStatus: z.literal("lower_bound"),
    hasMore: z.literal(true),
  })
  .strip();

const resourceCountSchema = z.discriminatedUnion("countStatus", [
  exactResourceCountSchema,
  lowerBoundResourceCountSchema,
]);

const workspaceStatsOutputSchema = z
  .object({
    datasets: resourceCountSchema.optional(),
    projects: resourceCountSchema.optional(),
    exports: resourceCountSchema.optional(),
    ...degradedFieldsSchema,
  })
  .strip();

interface PageProbe {
  items: unknown[];
  hasMore: boolean;
}

function summarizePageProbe(
  page: PageProbe,
): z.infer<typeof resourceCountSchema> {
  const observedCount = page.items.length;
  if (!page.hasMore) {
    return {
      count: observedCount,
      minimumCount: observedCount,
      countStatus: "exact",
      hasMore: false,
    };
  }

  // Cursor pagination deliberately omits a total. With a one-row probe and a
  // next cursor we can prove only that at least one additional row exists.
  // Returning `count: 1` here used to turn that lower bound into a confident,
  // false workspace total.
  return {
    count: null,
    minimumCount: observedCount + 1,
    countStatus: "lower_bound",
    hasMore: true,
  };
}

export function registerStatsTools(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_workspace_stats",
    {
      description:
        "Get a bounded workspace presence summary for datasets, projects, and exports. Cursor-paginated routes do not expose totals: count is exact only when countStatus=exact, otherwise count is null and minimumCount is the proven lower bound. Project scope is the caller's own via /users/me/projects/, not every project on the instance. Already a small payload; detail is accepted for consistency with other get tools.",
      inputSchema: z.object({
        detail: detailInputField,
      }),
      outputSchema: workspaceStatsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        "avala.ai/required-scopes": [
          "datasets.read",
          "projects.read",
          "exports.read",
        ],
        "avala.ai/toolset": "workspace",
      },
    },
    async ({ detail }) => {
      const avala = getClient("get_workspace_stats");
      const [datasetsResult, projectsResult, exportsResult] =
        await Promise.allSettled([
          avala.datasets.list({ limit: 1 }),
          // Customer-scoped projects; the staff list cannot serve customer keys.
          avala.projects.listMine({ limit: 1 }),
          avala.exports.list({ limit: 1 }),
        ]);

      const stats: z.infer<typeof workspaceStatsOutputSchema> = {};
      const unavailable: UnavailablePart[] = [];
      const sections = [
        ["datasets", datasetsResult],
        ["projects", projectsResult],
        ["exports", exportsResult],
      ] as const;
      for (const [part, result] of sections) {
        if (result.status === "rejected") {
          unavailable.push(describeUnavailable(part, result.reason));
        } else {
          stats[part] = summarizePageProbe(result.value);
        }
      }

      const presented = presentReadDetail(
        stats,
        { detail },
        WORKSPACE_STATS_CONCISE_KEYS,
      );

      const output = workspaceStatsOutputSchema.parse(withDegraded(
        presented as Record<string, unknown>,
        unavailable,
      ));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    },
  );
}
