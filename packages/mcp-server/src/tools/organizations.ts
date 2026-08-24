import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "../client.js";
import { definePageOutputSchema, defineReadCatalogTool, registerReadCatalogTool } from "../catalog.js";
import { z } from "zod";

const organizationIdentitySchema = {
  uid: z.string(),
  name: z.string(),
  slug: z.string(),
  handle: z.string().nullable(),
  logo: z.string().nullable(),
  industry: z.string().nullable(),
  visibility: z.string().nullable(),
  plan: z.string().nullable(),
  isVerified: z.boolean(),
  isActive: z.boolean(),
  memberCount: z.number().nullable(),
  teamCount: z.number().nullable(),
  role: z.string().nullable(),
  billingStatus: z.string().nullable(),
  createdAt: z.string().nullable(),
};

const organizationListOutputSchema = z
  .object({
    ...organizationIdentitySchema,
    joinedAt: z.string().nullable(),
    publicSlug: z.string().nullable(),
  })
  .passthrough();

const organizationDetailOutputSchema = z
  .object({
    ...organizationIdentitySchema,
    description: z.string().nullable(),
    website: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    datasetCount: z.number().nullable(),
    projectCount: z.number().nullable(),
    sliceCount: z.number().nullable(),
    allowedDomains: z.array(z.string()).nullable(),
    slugEditsRemaining: z.number().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough();

const listOrganizationsTool = defineReadCatalogTool({
  name: "list_organizations",
  title: "List organizations",
  description: "List all organizations you are a member of.",
  inputSchema: z.object({
    limit: z.number().int().positive().optional().describe("Maximum number of organizations to return"),
    cursor: z.string().optional().describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(organizationListOutputSchema),
  route: {
    name: "organization-list-create",
    method: "GET",
    path: "/organizations/",
    query: { limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "organizations.read",
    toolset: "organizations",
  },
});

const getOrganizationTool = defineReadCatalogTool({
  name: "get_organization",
  title: "Get organization",
  description: "Get detailed information about a specific organization including member and dataset counts.",
  inputSchema: z.object({
    slug: z.string().describe("The slug identifier of the organization"),
  }),
  outputSchema: organizationDetailOutputSchema,
  route: {
    name: "organization-detail",
    method: "GET",
    path: "/organizations/{slug}/",
    response: "single",
    scope: "organizations.read",
    toolset: "organizations",
  },
});

export const ORGANIZATION_READ_CATALOG_TOOLS = [listOrganizationsTool, getOrganizationTool] as const;

export function registerOrganizationTools(server: McpServer, getClient: GetClient): void {
  registerReadCatalogTool(server, getClient, listOrganizationsTool);
  registerReadCatalogTool(server, getClient, getOrganizationTool);
}
