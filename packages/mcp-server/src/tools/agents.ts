import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  definePageOutputSchema,
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import { z } from "zod";

const agentOutputFields = {
  uid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  events: z.array(z.string()),
  callbackUrl: z.string().nullable(),
  isActive: z.boolean(),
  project: z.string().nullable(),
  taskTypes: z.array(z.string()),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
};

const agentListOutputSchema = z.object(agentOutputFields).passthrough();
const agentDetailOutputSchema = z
  .object({
    ...agentOutputFields,
    executionStats: z.record(z.string(), z.number()),
  })
  .passthrough();

const AGENT_CONCISE_KEYS = [
  "uid",
  "name",
  "isActive",
  "project",
  "updatedAt",
] as const;

const listAgentsTool = defineReadCatalogTool({
  name: "list_agents",
  title: "List agents",
  description:
    "List automation agents. Default detail is identity and status. Callback URLs and execution stats require detail=full.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of agents to return. Defaults to 25 when omitted."),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(agentListOutputSchema),
  conciseKeys: AGENT_CONCISE_KEYS,
  route: {
    name: "agent-list",
    method: "GET",
    path: "/agents/",
    query: { limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "agents.read",
    toolset: "agents",
  },
});

const getAgentTool = defineReadCatalogTool({
  name: "get_agent",
  title: "Get agent",
  description:
    "Get an automation agent. Default detail is identity and status. Use detail=full for callback URL, events, and execution stats.",
  inputSchema: z.object({
    uid: z.string().describe("The unique identifier (UUID) of the agent"),
  }),
  outputSchema: agentDetailOutputSchema,
  conciseKeys: AGENT_CONCISE_KEYS,
  route: {
    name: "agent-detail",
    method: "GET",
    path: "/agents/{uid}/",
    response: "single",
    scope: "agents.read",
    toolset: "agents",
  },
});

export const AGENT_READ_CATALOG_TOOLS = [listAgentsTool, getAgentTool] as const;

export function registerAgentTools(
  server: McpServer,
  getClient: GetClient,
  allowMutations = false,
): void {
  registerReadCatalogTool(server, getClient, listAgentsTool);
  registerReadCatalogTool(server, getClient, getAgentTool);

  if (allowMutations) {
    server.registerTool(
      "create_agent",
      {
        description:
          "Create a new automation agent with event subscriptions and a callback URL.",
        inputSchema: z.object({
          name: z.string().describe("Name of the agent"),
          events: z
            .array(z.string())
            .describe("List of event types the agent subscribes to"),
          callbackUrl: z
            .string()
            .optional()
            .describe("URL to receive event callbacks"),
          description: z
            .string()
            .optional()
            .describe("Description of the agent"),
          project: z
            .string()
            .optional()
            .describe("Project UID to scope the agent to"),
          taskTypes: z
            .array(z.string())
            .optional()
            .describe("Task types the agent handles"),
        }),
      },
      async ({
        name,
        events,
        callbackUrl,
        description,
        project,
        taskTypes,
      }) => {
        const avala = getClient("create_agent");
        const agent = await avala.agents.create({
          name,
          events,
          callbackUrl,
          description,
          project,
          taskTypes,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(agent, null, 2),
            },
          ],
        };
      },
    );

    server.registerTool(
      "delete_agent",
      {
        description: "Delete an automation agent by its UID.",
        inputSchema: z.object({
          uid: z
            .string()
            .describe("The unique identifier (UUID) of the agent to delete"),
        }),
      },
      async ({ uid }) => {
        const avala = getClient("delete_agent");
        await avala.agents.delete(uid);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: `Agent ${uid} deleted.`,
              }),
            },
          ],
        };
      },
    );
  }
}
