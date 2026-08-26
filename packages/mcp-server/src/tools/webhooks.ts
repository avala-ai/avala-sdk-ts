import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  definePageOutputSchema,
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import { z } from "zod";

const webhookOutputSchema = z
  .object({
    uid: z.string(),
    targetUrl: z.string(),
    events: z.array(z.string()),
    isActive: z.boolean(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough();

const listWebhooksTool = defineReadCatalogTool({
  name: "list_webhooks",
  title: "List webhooks",
  description: "List all webhook subscriptions in your workspace.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of webhooks to return"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(webhookOutputSchema),
  route: {
    name: "webhook-list",
    method: "GET",
    path: "/webhooks/",
    query: { limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "webhooks.read",
    toolset: "webhooks",
  },
});

export const WEBHOOK_READ_CATALOG_TOOLS = [listWebhooksTool] as const;

export function registerWebhookTools(
  server: McpServer,
  getClient: GetClient,
  allowMutations = false,
): void {
  registerReadCatalogTool(server, getClient, listWebhooksTool);

  if (allowMutations) {
    server.registerTool(
      "create_webhook",
      {
        description: "Create a new webhook subscription for specific events.",
        inputSchema: z.object({
          targetUrl: z.string().describe("URL to receive webhook deliveries"),
          events: z
            .array(z.string())
            .describe("List of event types to subscribe to"),
        }),
      },
      async ({ targetUrl, events }) => {
        const avala = getClient("create_webhook");
        const webhook = await avala.webhooks.create({ targetUrl, events });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(webhook, null, 2),
            },
          ],
        };
      },
    );

    server.registerTool(
      "delete_webhook",
      {
        description: "Delete a webhook subscription by its UID.",
        inputSchema: z.object({
          uid: z
            .string()
            .describe("The unique identifier (UUID) of the webhook to delete"),
        }),
      },
      async ({ uid }) => {
        const avala = getClient("delete_webhook");
        await avala.webhooks.delete(uid);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: `Webhook ${uid} deleted.`,
              }),
            },
          ],
        };
      },
    );
  }
}
