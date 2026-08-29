import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  definePageOutputSchema,
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import { z } from "zod";

const taskOutputSchema = z
  .object({
    uid: z.string(),
    type: z.string().nullable(),
    name: z.string().nullable(),
    status: z.string().nullable(),
    project: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough();

const TASK_CONCISE_KEYS = [
  "uid",
  "name",
  "type",
  "status",
  "project",
  "updatedAt",
] as const;

const listTasksTool = defineReadCatalogTool({
  name: "list_tasks",
  title: "List tasks",
  description:
    "List tasks with optional server-side filtering by project or status. Default detail is identity and status.",
  inputSchema: z.object({
    project: z.string().optional().describe("Filter by project UID"),
    status: z.string().optional().describe("Filter by task status"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of tasks to return. Defaults to 25 when omitted."),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(taskOutputSchema),
  conciseKeys: TASK_CONCISE_KEYS,
  route: {
    name: "customer-task-list",
    method: "GET",
    path: "/tasks/",
    query: {
      project: "project",
      status: "status",
      limit: "limit",
      cursor: "cursor",
    },
    response: "page",
    scope: "tasks.read",
    toolset: "tasks",
  },
});

const getTaskTool = defineReadCatalogTool({
  name: "get_task",
  title: "Get task",
  description:
    "Get a task. Default detail is identity and status. Use detail=full for the rest of the task record.",
  inputSchema: z.object({
    uid: z.string().describe("The unique identifier (UUID) of the task"),
  }),
  outputSchema: taskOutputSchema,
  conciseKeys: TASK_CONCISE_KEYS,
  route: {
    name: "customer-task-detail",
    method: "GET",
    path: "/tasks/{uid}/",
    response: "single",
    scope: "tasks.read",
    toolset: "tasks",
  },
});

export const TASK_READ_CATALOG_TOOLS = [listTasksTool, getTaskTool] as const;

export function registerTaskTools(
  server: McpServer,
  getClient: GetClient,
): void {
  registerReadCatalogTool(server, getClient, listTasksTool);
  registerReadCatalogTool(server, getClient, getTaskTool);
}
