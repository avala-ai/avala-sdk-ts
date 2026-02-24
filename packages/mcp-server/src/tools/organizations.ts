import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerOrganizationTools(server: McpServer, avala: Avala): void {
  server.tool(
    "list_organizations",
    "List all organizations you are a member of.",
    {
      limit: z.number().optional().describe("Maximum number of organizations to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ limit, cursor }) => {
      const page = await avala.organizations.list({ limit, cursor });
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
    "get_organization",
    "Get detailed information about a specific organization including member and dataset counts.",
    {
      slug: z.string().describe("The slug identifier of the organization"),
    },
    async ({ slug }) => {
      const org = await avala.organizations.get(slug);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(org, null, 2),
          },
        ],
      };
    }
  );
}
