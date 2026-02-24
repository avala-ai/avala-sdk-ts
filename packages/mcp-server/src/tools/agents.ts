import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerAgentTools(server: McpServer, avala: Avala): void {
  server.tool(
    "list_agents",
    "List all automation agents configured in your workspace.",
    {
      limit: z.number().optional().describe("Maximum number of agents to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ limit, cursor }) => {
      const page = await avala.agents.list({ limit, cursor });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(page, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_agent",
    "Get detailed information about a specific automation agent.",
    {
      uid: z.string().describe("The unique identifier (UUID) of the agent"),
    },
    async ({ uid }) => {
      const agent = await avala.agents.get(uid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(agent, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "create_agent",
    "Create a new automation agent with event subscriptions and a callback URL.",
    {
      name: z.string().describe("Name of the agent"),
      events: z.array(z.string()).describe("List of event types the agent subscribes to"),
      callbackUrl: z.string().optional().describe("URL to receive event callbacks"),
      description: z.string().optional().describe("Description of the agent"),
      project: z.string().optional().describe("Project UID to scope the agent to"),
      taskTypes: z.array(z.string()).optional().describe("Task types the agent handles"),
    },
    async ({ name, events, callbackUrl, description, project, taskTypes }) => {
      const agent = await avala.agents.create({ name, events, callbackUrl, description, project, taskTypes });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(agent, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "delete_agent",
    "Delete an automation agent by its UID.",
    {
      uid: z.string().describe("The unique identifier (UUID) of the agent to delete"),
    },
    async ({ uid }) => {
      await avala.agents.delete(uid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, message: `Agent ${uid} deleted.` }),
          },
        ],
      };
    }
  );
}
