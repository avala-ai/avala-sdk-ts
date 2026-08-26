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

const listTasksTool = defineReadCatalogTool({
  name: "list_tasks",
  title: "List tasks",
  description: "List tasks with optional filtering by project or status.",
  inputSchema: z.object({
    project: z.string().optional().describe("Filter by project UID"),
    status: z.string().optional().describe("Filter by task status"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of tasks to return"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(taskOutputSchema),
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
  description: "Get detailed information about a specific task.",
  inputSchema: z.object({
    uid: z.string().describe("The unique identifier (UUID) of the task"),
  }),
  outputSchema: taskOutputSchema,
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
