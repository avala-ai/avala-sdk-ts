import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import { z } from "zod";
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
    datasets: resourceCountSchema,
    projects: resourceCountSchema,
    exports: resourceCountSchema,
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
      const [datasets, projects, exports] = await Promise.all([
        avala.datasets.list({ limit: 1 }),
        // `listMine`, not `list`: `/projects/` is staff-only and 403s for a
        // customer credential. See ProjectsResource for both routes.
        avala.projects.listMine({ limit: 1 }),
        avala.exports.list({ limit: 1 }),
      ]);

      const stats = workspaceStatsOutputSchema.parse({
        datasets: summarizePageProbe(datasets),
        projects: summarizePageProbe(projects),
        exports: summarizePageProbe(exports),
      });

      const presented = presentReadDetail(
        stats,
        { detail },
        WORKSPACE_STATS_CONCISE_KEYS,
      );

      return {
        structuredContent: presented,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(presented, null, 2),
          },
        ],
      };
    },
  );
}
