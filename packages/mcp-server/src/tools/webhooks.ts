import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerWebhookTools(server: McpServer, avala: Avala, allowMutations = false): void {
  server.tool(
    "list_webhooks",
    "List all webhook subscriptions in your workspace.",
    {
      limit: z.number().optional().describe("Maximum number of webhooks to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ limit, cursor }) => {
      const page = await avala.webhooks.list({ limit, cursor });
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

  if (allowMutations) {
    server.tool(
      "create_webhook",
      "Create a new webhook subscription for specific events.",
      {
        targetUrl: z.string().describe("URL to receive webhook deliveries"),
        events: z.array(z.string()).describe("List of event types to subscribe to"),
      },
      async ({ targetUrl, events }) => {
        const webhook = await avala.webhooks.create({ targetUrl, events });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(webhook, null, 2),
            },
          ],
        };
      }
    );

    server.tool(
      "delete_webhook",
      "Delete a webhook subscription by its UID.",
      {
        uid: z.string().describe("The unique identifier (UUID) of the webhook to delete"),
      },
      async ({ uid }) => {
        await avala.webhooks.delete(uid);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, message: `Webhook ${uid} deleted.` }),
            },
          ],
        };
      }
    );
  }
}
